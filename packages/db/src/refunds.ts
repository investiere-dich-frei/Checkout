import type pg from "pg";
import type { SessionUser } from "./auth.ts";
import { endSubscription } from "./billing.ts";
import { enqueueInvoiceMail } from "./customer-mails.ts";
import { storeInvoicePdf } from "./invoice-pdf.ts";
import { enqueueWebhook } from "./webhooks.ts";

/**
 * Erstattung einer bezahlten Rechnung: anfordern, beim Anbieter auslösen, dann
 * Stornorechnung (voll) oder Rechnungskorrektur (Teil) und Erstattungsbuchung.
 * Der Anbieteraufruf liegt in der Web-App.
 */

export class RefundError extends Error {}

export interface RequestedRefund {
  refundId: string;
  provider: "stripe" | "paypal" | "ueberweisung";
  /** PaymentIntent-ID (Stripe) oder Capture-ID (PayPal) der ursprünglichen Zahlung. */
  paymentRef: string;
  amountCents: number;
  currency: string;
  /** voll = Stornorechnung über alles, teil = Rechnungskorrektur über einen Teil. */
  scope: "voll" | "teil";
}

/** Noch erstattbarer Betrag einer Rechnung (Rechnungsbetrag abzüglich laufender und erfolgter Erstattungen). */
export async function refundableCents(db: pg.ClientBase | pg.Pool, invoiceId: string): Promise<number> {
  const { rows } = await db.query<{ left: string }>(
    `select i.gross_cents - coalesce((select sum(r.amount_cents) from app.refunds r where r.invoice_id = i.id and r.status <> 'fehlgeschlagen'), 0) "left"
       from app.invoices i where i.id = $1`,
    [invoiceId],
  );
  return rows[0] ? Number(rows[0].left) : 0;
}

/**
 * Erstattung anfordern. Ohne amountCents wird der ganze noch offene Betrag erstattet. Ist noch
 * nichts erstattet und geht es um den ganzen Betrag, wird storniert, sonst korrigiert.
 */
export async function requestRefund(
  client: pg.ClientBase,
  user: SessionUser,
  invoiceId: string,
  reason: string,
  amountCents?: number,
): Promise<RequestedRefund> {
  if (user.role !== "admin") throw new RefundError("Keine Berechtigung");
  if (!reason.trim()) throw new RefundError("Grund fehlt");
  const { rows } = await client.query<{ kind: string; gross_cents: string; currency: string; payment_id: string | null; provider: string; provider_ref: string; storno: boolean }>(
    `select i.kind, i.gross_cents, i.currency, p.id payment_id, p.provider, p.provider_ref,
            exists (select 1 from app.invoices s where s.corrects_invoice_id = i.id and s.kind = 'storno') storno
       from app.invoices i
       left join app.order_installments x on x.invoice_id = i.id
       left join app.payments p on p.id = x.payment_id
      where i.id = $1
      for update of i`,
    [invoiceId],
  );
  const r = rows[0];
  if (!r) throw new RefundError("Rechnung gibt es nicht");
  if (r.kind !== "rechnung") throw new RefundError("Nur Rechnungen können erstattet werden");
  if (r.storno) throw new RefundError("Rechnung ist bereits storniert");
  if (!r.payment_id) throw new RefundError("Zu dieser Rechnung gibt es keine Zahlung");
  if (!["stripe", "paypal", "ueberweisung"].includes(r.provider)) throw new RefundError(`Erstattung über ${r.provider} nicht möglich`);
  const open = await client.query(`select 1 from app.refunds where invoice_id = $1 and status = 'angefordert'`, [invoiceId]);
  if (open.rowCount) throw new RefundError("Zu dieser Rechnung läuft schon eine Erstattung");
  const gross = Number(r.gross_cents);
  const left = await refundableCents(client, invoiceId);
  if (left <= 0) throw new RefundError("Rechnung ist bereits voll erstattet");
  const amount = amountCents ?? left;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RefundError("Bitte einen Betrag über 0 angeben");
  if (amount > left) throw new RefundError(`Höchstens ${(left / 100).toFixed(2).replace(".", ",")} ${r.currency} sind noch erstattbar`);
  const scope = amount === gross && left === gross ? "voll" : "teil";
  const ins = await client.query<{ id: string }>(
    `insert into app.refunds (invoice_id, payment_id, provider, amount_cents, currency, reason, requested_by, scope)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [invoiceId, r.payment_id, r.provider, amount, r.currency, reason.trim(), user.id, scope],
  );
  return {
    refundId: ins.rows[0]!.id,
    provider: r.provider as RequestedRefund["provider"],
    paymentRef: r.provider_ref,
    amountCents: amount,
    currency: r.currency,
    scope,
  };
}

/** Teilbetrag anteilig auf die Positionen verteilen; die letzte Position nimmt den Rundungsrest. */
export function splitRefund(
  items: { grossCents: number; taxRateBp: number }[],
  refundCents: number,
): { grossCents: number; netCents: number; taxCents: number }[] {
  const total = items.reduce((t, i) => t + i.grossCents, 0);
  if (total <= 0) throw new RefundError("Rechnung ohne Betrag");
  let rest = refundCents;
  return items.map((it, idx) => {
    const g = idx === items.length - 1 ? rest : Math.round((refundCents * it.grossCents) / total);
    rest -= g;
    const tax = it.taxRateBp > 0 ? Math.round((g * it.taxRateBp) / (10000 + it.taxRateBp)) : 0;
    return { grossCents: g, netCents: g - tax, taxCents: tax };
  });
}

export async function failRefund(client: pg.ClientBase, refundId: string, errorCode: string) {
  await client.query(`update app.refunds set status = 'fehlgeschlagen', error_code = $2 where id = $1 and status = 'angefordert'`, [
    refundId,
    errorCode.slice(0, 200),
  ]);
}

/**
 * Bestätigte Erstattung verbuchen. Voll: Stornorechnung über den ganzen Betrag mit umgekehrten
 * Positionen. Teil: Rechnungskorrektur über den Teilbetrag, anteilig je Position und Steuersatz.
 * Dazu PDF, E-Mail, Erstattungsbuchung und Statusfortschreibung. Ist mit der Teilerstattung die
 * ganze Rechnung erstattet, gilt die Rate als storniert wie bei der vollen Erstattung.
 */
export async function completeRefund(client: pg.ClientBase, refundId: string, providerRefundId: string): Promise<{ stornoInvoiceId: string; stornoNumber: string; scope: "voll" | "teil" }> {
  const ref = (
    await client.query<{ invoice_id: string; payment_id: string; provider: string; amount_cents: string; currency: string; status: string; storno_invoice_id: string | null; scope: "voll" | "teil" }>(
      `select invoice_id, payment_id, provider, amount_cents, currency, status, storno_invoice_id, scope from app.refunds where id = $1 for update`,
      [refundId],
    )
  ).rows[0];
  if (!ref) throw new RefundError("Erstattung gibt es nicht");
  if (ref.status === "erstattet") {
    const n = await client.query<{ invoice_number: string }>(`select invoice_number from app.invoices where id = $1`, [ref.storno_invoice_id]);
    return { stornoInvoiceId: ref.storno_invoice_id!, stornoNumber: n.rows[0]!.invoice_number, scope: ref.scope };
  }
  if (ref.status !== "angefordert") throw new RefundError(`Erstattung hat den Status ${ref.status}`);
  const amount = Number(ref.amount_cents);

  let s: { id: string; invoice_number: string; order_id: string };
  if (ref.scope === "voll") {
    const storno = await client.query<{ id: string; invoice_number: string; order_id: string }>(
      `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id,
         customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents, note)
       select company_id, 0, '', 'storno', id, order_id, customer_id, customer_snapshot, company_snapshot,
              (now() at time zone 'Europe/Berlin')::date, service_date_from, service_date_to, currency,
              -net_cents, -tax_cents, -gross_cents, 'Storno zu Rechnung ' || invoice_number || '. Der Betrag wird erstattet.'
         from app.invoices where id = $1
       returning id, invoice_number, order_id`,
      [ref.invoice_id],
    );
    s = storno.rows[0]!;
    await client.query(
      `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
       select $1, position, description, -quantity, unit_net_cents, -net_cents, tax_rate_bp, -tax_cents, -gross_cents, tax_exemption_note
         from app.invoice_items where invoice_id = $2 order by position`,
      [s.id, ref.invoice_id],
    );
  } else {
    const items = (
      await client.query<{ position: number; description: string; tax_rate_bp: number; gross_cents: string; tax_exemption_note: string | null }>(
        `select position, description, tax_rate_bp, gross_cents, tax_exemption_note from app.invoice_items where invoice_id = $1 order by position`,
        [ref.invoice_id],
      )
    ).rows;
    const parts = splitRefund(items.map((i) => ({ grossCents: Number(i.gross_cents), taxRateBp: i.tax_rate_bp })), amount);
    const lines = items.map((it, k) => ({ ...it, ...parts[k]! })).filter((l) => l.grossCents !== 0);
    const net = lines.reduce((t, l) => t + l.netCents, 0);
    const tax = lines.reduce((t, l) => t + l.taxCents, 0);
    const euro = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} ${ref.currency}`;
    const korr = await client.query<{ id: string; invoice_number: string; order_id: string }>(
      `insert into app.invoices (company_id, number_seq, invoice_number, kind, corrects_invoice_id, order_id, customer_id,
         customer_snapshot, company_snapshot, issue_date, service_date_from, service_date_to, currency, net_cents, tax_cents, gross_cents, note)
       select company_id, 0, '', 'korrektur', id, order_id, customer_id, customer_snapshot, company_snapshot,
              (now() at time zone 'Europe/Berlin')::date, service_date_from, service_date_to, currency,
              $2::bigint, $3::bigint, $4::bigint,
              'Rechnungskorrektur zu Rechnung ' || invoice_number || ': Teilerstattung über ' || $5 || '.'
         from app.invoices where id = $1
       returning id, invoice_number, order_id`,
      [ref.invoice_id, -net, -tax, -amount, euro(amount)],
    );
    s = korr.rows[0]!;
    let pos = 0;
    for (const l of lines) {
      await client.query(
        `insert into app.invoice_items (invoice_id, position, description, quantity, unit_net_cents, net_cents, tax_rate_bp, tax_cents, gross_cents, tax_exemption_note)
         values ($1, $2, $3, -1, $4, $5, $6, $7, $8, $9)`,
        [s.id, ++pos, `Teilerstattung: ${l.description}`, l.netCents, -l.netCents, l.tax_rate_bp, -l.taxCents, -l.grossCents, l.tax_exemption_note],
      );
    }
  }
  await client.query(
    `insert into app.payments (order_id, provider, provider_ref, status, currency, amount_cents, paid_at)
     values ($1, $2, $3, 'erstattet', $4, $5, now())`,
    [s.order_id, ref.provider, providerRefundId, ref.currency, -amount],
  );
  await client.query(
    `update app.refunds set status = 'erstattet', provider_refund_id = $2, storno_invoice_id = $3, completed_at = now() where id = $1`,
    [refundId, providerRefundId, s.id],
  );
  const whole = ref.scope === "voll" || (await refundableCents(client, ref.invoice_id)) === 0;
  if (whole) {
    await client.query(`update app.order_installments set status = 'storniert' where invoice_id = $1`, [ref.invoice_id]);
    // Ist nichts Bezahltes mehr übrig, ist die Bestellung erstattet.
    await client.query(
      `update app.orders o set status = 'erstattet'
        where o.id = $1 and not exists (select 1 from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt')`,
      [s.order_id],
    );
  }
  await storeInvoicePdf(client, s.id);
  await enqueueInvoiceMail(client, s.id);
  await enqueueWebhook(client, whole ? "zahlung.erstattet" : "zahlung.teilerstattet", s.order_id, {
    refund: { provider: ref.provider, gross_cents: amount, storno_number: s.invoice_number, scope: ref.scope },
  });
  return { stornoInvoiceId: s.id, stornoNumber: s.invoice_number, scope: ref.scope };
}

/** Bestellung beenden: offene Raten entfallen, Abo endet heute. Bereits Bezahltes bleibt (Erstattung separat). */
export async function cancelOrder(client: pg.ClientBase, user: SessionUser, orderId: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (user.role !== "admin") throw new RefundError("Keine Berechtigung");
  const actor = `user:${user.id}`;
  await client.query(`update app.order_installments set status = 'storniert' where order_id = $1 and status in ('offen', 'fehlgeschlagen')`, [orderId]);
  // Ein schon gesetztes Laufzeitende ist festgeschrieben (GoBD); ein früherer Storno wirkt über app.order_cancellations.
  await client.query(
    `update app.subscription_terms set ends_on = (now() at time zone 'Europe/Berlin')::date, ended_by = $2 where order_id = $1 and ends_on is null`,
    [orderId, actor],
  );
  await client.query(
    `update app.orders o set status = case when exists (select 1 from app.order_installments i where i.order_id = o.id and i.status = 'bezahlt')
                                          then o.status else 'storniert' end
      where o.id = $1`,
    [orderId],
  );
  await enqueueWebhook(client, "bestellung.beendet", orderId, { ended_by: actor, ...extra });
}

export type StornoKind = "ohne_rueckzahlung" | "mit_rueckzahlung";

export const STORNO_LABEL: Record<StornoKind, string> = {
  ohne_rueckzahlung: "Storno ohne Rückzahlung",
  mit_rueckzahlung: "Storno mit Rückzahlung",
};

export interface StornoInput {
  orderId: string;
  kind: StornoKind;
  reason: string;
  /** Heute (Europe/Berlin), JJJJ-MM-TT. */
  today: string;
  /** Nur Abo und ohne Rückzahlung: letzter Tag der Laufzeit. Leer = sofort. */
  endsOn?: string | null;
}

export interface StornoRecord {
  id: string;
  kind: StornoKind;
  effectiveOn: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
}

/**
 * Storno einer Bestellung (Verwaltung). Ohne Rückzahlung: offene Raten entfallen, das Abo endet
 * sofort oder zum gewählten Tag; Bezahltes bleibt. Mit Rückzahlung: Die Bestellung endet sofort;
 * die Erstattungen der gewählten Rechnungen löst danach die Web-App aus (refundInvoice), weil dafür
 * Stripe oder PayPal aufgerufen werden. Jeder Storno wird mit Grund festgeschrieben.
 */
export async function stornoOrder(client: pg.ClientBase, user: SessionUser, input: StornoInput): Promise<StornoRecord> {
  if (user.role !== "admin") throw new RefundError("Keine Berechtigung");
  const reason = input.reason.trim();
  if (!reason) throw new RefundError("Bitte einen Grund angeben");
  if (input.kind !== "ohne_rueckzahlung" && input.kind !== "mit_rueckzahlung") throw new RefundError("Unbekannte Storno-Art");
  const o = (
    await client.query<{ status: string; manual: boolean; is_abo: boolean; ends_on: string | null; paypal_abo: boolean; open: number }>(
      `select o.status,
              exists (select 1 from app.manual_orders m where m.order_id = o.id) manual,
              exists (select 1 from app.subscription_terms t where t.order_id = o.id) is_abo,
              -- Wirksames Ende: Laufzeitende oder ein früherer Storno, was zuerst kommt.
              nullif(least(coalesce((select max(t.ends_on) from app.subscription_terms t where t.order_id = o.id), 'infinity'::date),
                           coalesce((select min(x.effective_on) from app.order_cancellations x where x.order_id = o.id), 'infinity'::date)),
                     'infinity'::date)::text ends_on,
              exists (select 1 from app.thrivecart_takeovers t where t.order_id = o.id and t.route = 'paypal') paypal_abo,
              (select count(*)::int from app.order_installments i where i.order_id = o.id and i.status in ('offen', 'fehlgeschlagen')) open
         from app.orders o where o.id = $1 for update of o`,
      [input.orderId],
    )
  ).rows[0];
  if (!o) throw new RefundError("Bestellung gibt es nicht");
  if (o.manual) throw new RefundError("Bestellungen per Rechnung werden unter Manuelle Bestellungen storniert");
  const running = o.status !== "storniert" && o.status !== "erstattet" && (o.open > 0 || (o.is_abo && (o.ends_on === null || o.ends_on > input.today)));
  if (input.kind === "ohne_rueckzahlung" && !running) throw new RefundError("Die Bestellung ist bereits beendet");
  const endsOn = input.endsOn || null;
  if (endsOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw new RefundError("Ungültiges Datum");
    if (input.kind !== "ohne_rueckzahlung") throw new RefundError("Mit Rückzahlung endet die Bestellung sofort");
    if (!o.is_abo) throw new RefundError("Ein Enddatum gibt es nur bei Abos");
    if (endsOn < input.today) throw new RefundError("Das Enddatum liegt in der Vergangenheit");
    if (o.paypal_abo && endsOn > input.today) throw new RefundError("PayPal-Abos können nur sofort beendet werden");
  }
  const actor = `user:${user.id}`;
  const extra = { storno: input.kind, reason };
  if (endsOn && endsOn > input.today) {
    if (o.ends_on !== null && o.ends_on <= endsOn) throw new RefundError(`Das Abo endet schon am ${o.ends_on}`);
    // Ein schon gesetztes späteres Ende bleibt festgeschrieben; der Storno-Eintrag zieht es vor (siehe extendSubscriptions).
    if (o.ends_on !== null) {
      await client.query(
        `update app.order_installments set status = 'storniert' where order_id = $1 and due_date > $2 and status in ('offen', 'fehlgeschlagen')`,
        [input.orderId, endsOn],
      );
      await enqueueWebhook(client, "abo.beendet", input.orderId, { ends_on: endsOn, ...extra });
    } else {
      await endSubscription(client, input.orderId, endsOn, actor, extra);
    }
  } else if (running) {
    await cancelOrder(client, user, input.orderId, extra);
  } else {
    // Schon beendet (z. B. Einmalzahlung): Nur die Erstattung folgt; Empfänger erfahren den Storno trotzdem.
    await enqueueWebhook(client, "bestellung.beendet", input.orderId, { ended_by: actor, ...extra });
  }
  const r = await client.query<{ id: string; created_at: Date }>(
    `insert into app.order_cancellations (order_id, kind, effective_on, reason, created_by) values ($1, $2, $3, $4, $5) returning id, created_at`,
    [input.orderId, input.kind, endsOn ?? input.today, reason, actor],
  );
  return { id: r.rows[0]!.id, kind: input.kind, effectiveOn: endsOn ?? input.today, reason, createdBy: actor, createdAt: r.rows[0]!.created_at };
}

/** Stornos einer Bestellung, älteste zuerst. */
export async function stornosOfOrder(db: pg.ClientBase | pg.Pool, orderId: string): Promise<StornoRecord[]> {
  const { rows } = await db.query(
    `select c.id, c.kind, c.effective_on::text, c.reason, coalesce(u.display_name, c.created_by) created_by, c.created_at
       from app.order_cancellations c
       left join app.users u on c.created_by = 'user:' || u.id::text
      where c.order_id = $1 order by c.created_at`,
    [orderId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, effectiveOn: r.effective_on, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at }));
}
