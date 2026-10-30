import type pg from "pg";

/**
 * Kündigung (§ 312k BGB) und Widerruf (§ 356a BGB) über die Website.
 *
 * Die Erklärung, ihre Zuordnung und die Eingangsbestätigung per E-Mail entstehen
 * in der Transaktion des Aufrufers, oder gar nicht. Gespeichert wird immer, auch
 * wenn sich kein Vertrag zuordnen lässt: Eine eingegangene Erklärung darf nicht
 * verloren gehen.
 */

export interface NoticeInput {
  kind: "kuendigung" | "widerruf";
  fullName: string;
  email: string;
  contractReference: string;
  /** Nur Kündigung. */
  cancellationType?: "ordentlich" | "ausserordentlich";
  reason?: string | null;
  /** Nur Kündigung, YYYY-MM-DD; null = zum nächstmöglichen Zeitpunkt. */
  requestedEnd?: string | null;
  message?: string | null;
}

export interface SubmittedNotice {
  id: string;
  receivedAt: Date;
  /** Ob die Erklärung einem Vertrag zugeordnet werden konnte. */
  matched: "bestellung" | "thrivecart" | null;
  mailId: string;
  confirmation: { subject: string; body: string };
}

export class NoticeError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const berlinTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "long",
  timeStyle: "medium",
});

function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

/** Vertrag zur Angabe der Kundin suchen. Zugeordnet wird nur, wenn auch die E-Mail-Adresse passt. */
async function match(
  client: pg.ClientBase,
  reference: string,
  email: string,
): Promise<{ orderId: string | null; thrivecartOrderId: string | null; customerId: string | null }> {
  const none = { orderId: null, thrivecartOrderId: null, customerId: null };
  const tokens = reference.match(/[0-9a-f-]{36}|IDF-\d+|\d{1,12}/gi) ?? [];
  for (const token of tokens) {
    if (UUID.test(token)) {
      const r = await client.query<{ id: string; customer_id: string }>(
        `select o.id, o.customer_id from app.orders o join app.customers c on c.id = o.customer_id
          where o.id = $1 and lower(c.email) = lower($2)`,
        [token, email],
      );
      if (r.rows[0]) return { orderId: r.rows[0].id, thrivecartOrderId: null, customerId: r.rows[0].customer_id };
    } else if (/^IDF-\d+$/i.test(token)) {
      const r = await client.query<{ order_id: string; customer_id: string }>(
        `select i.order_id, i.customer_id from app.invoices i join app.customers c on c.id = i.customer_id
          where upper(i.invoice_number) = upper($1) and lower(c.email) = lower($2) and i.order_id is not null`,
        [token, email],
      );
      if (r.rows[0]) return { orderId: r.rows[0].order_id, thrivecartOrderId: null, customerId: r.rows[0].customer_id };
    } else {
      // Thrivecart: Bestell- oder Rechnungsnummer eines Altkaufs.
      const r = await client.query<{ order_id: string; customer_id: string | null }>(
        `select order_id, customer_id from legacy.thrivecart_orders
          where (order_id = $1::bigint or invoice_number = $1::bigint) and lower(email) = lower($2)
          order by ordered_at desc limit 1`,
        [token, email],
      );
      if (r.rows[0]) return { orderId: null, thrivecartOrderId: r.rows[0].order_id, customerId: r.rows[0].customer_id };
    }
  }
  return none;
}

export function confirmationText(input: NoticeInput, receivedAt: Date): { subject: string; body: string } {
  const when = berlinTime.format(receivedAt);
  const lines: string[] = [`Hallo ${input.fullName},`, ""];
  if (input.kind === "kuendigung") {
    lines.push(`deine Kündigung ist am ${when} Uhr bei uns eingegangen.`, "", "Deine Angaben:");
    lines.push(`- Art der Kündigung: ${input.cancellationType === "ausserordentlich" ? "außerordentlich" : "ordentlich"}`);
    if (input.reason) lines.push(`- Grund: ${input.reason}`);
    lines.push(`- Vertrag: ${input.contractReference}`);
    lines.push(`- Gewünschtes Vertragsende: ${input.requestedEnd ? formatDay(input.requestedEnd) : "zum nächstmöglichen Zeitpunkt"}`);
  } else {
    lines.push(`dein Widerruf ist am ${when} Uhr bei uns eingegangen.`, "", "Deine Angaben:");
    lines.push(`- Vertrag: ${input.contractReference}`);
  }
  lines.push(`- Name: ${input.fullName}`, `- E-Mail: ${input.email}`);
  if (input.message) lines.push(`- Nachricht: ${input.message}`);
  lines.push(
    "",
    input.kind === "kuendigung"
      ? "Wir prüfen die Kündigung und bestätigen dir den Zeitpunkt, zu dem der Vertrag endet."
      : "Wir prüfen den Widerruf und melden uns zur Rückzahlung bei dir.",
    "",
    "Diese E-Mail ist die Eingangsbestätigung nach " + (input.kind === "kuendigung" ? "§ 312k BGB." : "§ 356a BGB."),
    "",
    "Investiere Dich Frei",
  );
  return {
    subject: input.kind === "kuendigung" ? "Eingangsbestätigung deiner Kündigung" : "Eingangsbestätigung deines Widerrufs",
    body: lines.join("\n"),
  };
}

function clean(value: string | null | undefined, max: number): string | null {
  const v = (value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

export async function submitNotice(client: pg.ClientBase, raw: NoticeInput, now = new Date()): Promise<SubmittedNotice> {
  const input: NoticeInput = {
    kind: raw.kind,
    fullName: clean(raw.fullName, 200) ?? "",
    email: (clean(raw.email, 254) ?? "").toLowerCase(),
    contractReference: clean(raw.contractReference, 500) ?? "",
    cancellationType: raw.kind === "kuendigung" ? (raw.cancellationType ?? "ordentlich") : undefined,
    reason: clean(raw.reason, 2000),
    requestedEnd: raw.kind === "kuendigung" ? (raw.requestedEnd ?? null) : null,
    message: clean(raw.message, 2000),
  };
  if (!input.fullName) throw new NoticeError("Name fehlt");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new NoticeError("E-Mail-Adresse ungültig");
  if (!input.contractReference) throw new NoticeError("Vertrag fehlt");
  if (input.cancellationType === "ausserordentlich" && !input.reason) throw new NoticeError("Grund fehlt");
  if (input.requestedEnd && !/^\d{4}-\d{2}-\d{2}$/.test(input.requestedEnd)) throw new NoticeError("Datum ungültig");

  const found = await match(client, input.contractReference, input.email);
  const confirmation = confirmationText(input, now);
  const mail = await client.query<{ id: string }>(
    `insert into app.mail_outbox (purpose, to_address, subject, body_text, created_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.kind === "kuendigung" ? "kuendigung_bestaetigung" : "widerruf_bestaetigung", input.email, confirmation.subject, confirmation.body, now],
  );
  const mailId = mail.rows[0]!.id;
  const notice = await client.query<{ id: string }>(
    `insert into app.contract_notices (kind, full_name, email, contract_reference, cancellation_type, reason, requested_end,
       message, order_id, thrivecart_order_id, customer_id, confirmation_mail_id, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [
      input.kind,
      input.fullName,
      input.email,
      input.contractReference,
      input.cancellationType ?? null,
      input.reason,
      input.requestedEnd,
      input.message,
      found.orderId,
      found.thrivecartOrderId,
      found.customerId,
      mailId,
      now,
    ],
  );
  return {
    id: notice.rows[0]!.id,
    receivedAt: now,
    matched: found.orderId ? "bestellung" : found.thrivecartOrderId ? "thrivecart" : null,
    mailId,
    confirmation,
  };
}
