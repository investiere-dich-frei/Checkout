import { canChange, canSeeAll, orderDetail } from "@idf/db/admin";
import { listPauses } from "@idf/db/billing";
import { activeHold, dunningHoldsOfOrder, dunningNoticesOfOrder, OVERDUE_STATE_LABEL, overduePayments } from "@idf/db/dunning";
import { takeoverOfOrder } from "@idf/db/takeover";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { formatCents, formatDay, formatRate, todayBerlin } from "../../../../lib/format";

const formatIsoDay = (d: Date) => todayBerlin(d);
import { requireUser } from "../../../../lib/session";
import { STORNO_LABEL, stornosOfOrder } from "@idf/db/refunds";
import {
  chargeNowAction,
  holdDunningAction,
  liftDunningHoldAction,
  pauseSubscriptionAction,
  resendInvoiceAction,
  resumeSubscriptionAction,
} from "../../kunden/actions";
import { creditWithdrawalEnd } from "@idf/core/credit";
import { ActionForm } from "../../produkte/forms";
import { RefundForm } from "./refund-form";
import { StornoForm, type StornoInvoice } from "./storno-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUNNING_LABELS: Record<string, string> = {
  erinnerung: "Erinnerung vor Abbuchung",
  fehlgeschlagen: "Abbuchung fehlgeschlagen",
  letzte_mahnung: "Letzte Mahnung",
  karte_ablauf: "Karte läuft ab",
};
const todayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

export default async function OrderAdminPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const d = await orderDetail(pool(), user, id);
  if (!d) notFound();
  const h = d.head;
  const name = h.company_name || [h.first_name, h.last_name].filter(Boolean).join(" ");
  const today = todayBerlin();
  const pauses = h.is_abo ? await listPauses(pool(), id) : [];
  const takeover = await takeoverOfOrder(pool(), id);
  const dunning = await dunningNoticesOfOrder(pool(), id);
  const holds = await dunningHoldsOfOrder(pool(), id);
  const hold = activeHold(holds, today);
  const dunningApplies = !h.is_manual && (h.is_abo || d.installments.length > 1);
  const overdue = new Map((await overduePayments(pool(), today, { orderId: id, includeManual: true })).map((o) => [o.installmentId, o]));
  const openPause = pauses.find((p) => !p.endedBy && (p.endsOn === null || p.endsOn >= today));
  const stornos = await stornosOfOrder(pool(), id);
  const paypalAbo = takeover?.route === "paypal";
  // Wirksames Abo-Ende: Laufzeitende oder ein früherer Storno.
  const aboEnd = [h.ends_on as string | null, ...stornos.map((x) => x.effectiveOn)].filter((x): x is string => !!x).sort()[0] ?? null;
  const running =
    h.status !== "storniert" &&
    h.status !== "erstattet" &&
    (d.installments.some((i) => i.status === "offen" || i.status === "fehlgeschlagen") || (h.is_abo && (!aboEnd || aboEnd > today)));
  // Rechnungen mit noch erstattbarem Betrag (Teilerstattungen sind als negative Korrekturen abgezogen).
  const refundable: StornoInvoice[] = d.invoices
    .filter((i) => i.kind === "rechnung" && !d.invoices.some((s) => s.corrects_invoice_id === i.id && s.kind === "storno"))
    .map((i) => ({
      id: i.id,
      number: i.invoice_number,
      refundableCents: Number(i.gross_cents) + d.invoices.filter((s) => s.corrects_invoice_id === i.id).reduce((t, s) => t + Number(s.gross_cents), 0),
    }))
    .filter((i) => i.refundableCents > 0);
  const pauseText = (p: { startsOn: string; endsOn: string | null }) =>
    p.endsOn !== null && p.endsOn < p.startsOn ? `${formatDay(p.startsOn)} (aufgehoben)` : `${formatDay(p.startsOn)} bis ${p.endsOn ? formatDay(p.endsOn) : "auf Weiteres"}`;

  return (
    <>
      <section className="card">
        <h1>
          {h.product} – {h.option}
        </h1>
        <p className="note">
          Bestellung {id} · {dateTime.format(h.created_at)} · Status {h.status}
          {h.seller && <> · Vertrieb: {h.seller}</>}
        </p>
        {h.is_manual && (
          <p className="notice-box">
            Bestellung per Rechnung (Überweisung). Zahlungen, Storno und Rückzahlung laufen über{" "}
            <a href={`/admin/manuell/${id}`}>Manuelle Bestellungen</a>.
          </p>
        )}
        {takeover && (
          <p className="notice-box">
            Aus Thrivecart übernommen (Abo {takeover.subscription_id}, {takeover.route === "paypal" ? "PayPal" : "Stripe"} {takeover.remote_subscription_id}).
            Zahlungen vor dem {formatDay(takeover.first_due_on)} stehen in Thrivecart.
            {takeover.remaining_payments ? ` Beim Umzug waren noch ${takeover.remaining_payments} Raten offen.` : ""}
            {takeover.thrivecart_stopped_at ? " Abrechnung in Thrivecart beendet." : " Abrechnung in Thrivecart noch nicht als beendet abgehakt (Verwaltung → Abo-Umzug)."}
          </p>
        )}
        <h2>Kundin</h2>
        <p>
          {canSeeAll(user) ? <a href={`/admin/kunden/${h.customer_id}`}>{name}</a> : name}
          <br />
          {h.email}
          <br />
          {[h.street, [h.postal_code, h.city].filter(Boolean).join(" "), h.country].filter(Boolean).join(", ")}
          {h.vat_id && (
            <>
              <br />
              USt-IdNr. {h.vat_id}
            </>
          )}
        </p>
        <p>
          Steuer: {formatRate(h.tax_rate_bp)}
          {h.tax_note && <> · {h.tax_note}</>}
          {h.withdrawal_waiver_at && <> · Verzicht auf Widerrufsrecht am {dateTime.format(h.withdrawal_waiver_at)}</>}
        </p>
        {h.credit_check_id && (
          <p>
            Ratenkauf mit Kredit: Ratenvertrag am {dateTime.format(h.credit_agreement_at)} (Texte {h.credit_texts_version}) · Widerruf möglich bis{" "}
            {formatDay(creditWithdrawalEnd(todayOf(h.created_at)))} (bei Fehlern in den Pflichtangaben länger, höchstens 12 Monate und 14 Tage)
            {h.value_compensation_consent_at
              ? ` · Sofortstart mit Wertersatz am ${dateTime.format(h.value_compensation_consent_at)}`
              : " · kein Sofortstart, Zugang nach Ablauf der Widerrufsfrist"}{" "}
            · <a href="/admin/ratenpruefung">Prüfung</a>
          </p>
        )}
        {h.coupon_code && (
          <p>
            Gutschein{" "}
            {h.coupon_id ? <a href={`/admin/gutscheine/${h.coupon_id}`}>{h.coupon_code}</a> : h.coupon_code}: −{" "}
            {formatCents(Number(h.coupon_discount_cents), h.currency)}
            {h.coupon_scope === "alle" ? " (auf jede Zahlung)" : " (auf die erste Zahlung)"}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Zahlplan</h2>
        <table className="admin-table">
          <tbody>
            {d.installments.map((i) => (
              <tr key={i.id}>
                <td>Rate {i.seq}</td>
                <td>{formatDay(i.due_date)}</td>
                <td>{formatCents(Number(i.gross_cents), h.currency)}</td>
                <td>
                  {i.status}
                  {overdue.has(i.id) && (
                    <>
                      {" "}
                      <span className="badge badge-warn">überfällig</span>
                      <br />
                      <span className="note">
                        {OVERDUE_STATE_LABEL[overdue.get(i.id)!.state]}
                        {overdue.get(i.id)!.nextTry && overdue.get(i.id)!.nextTry! > today && ` am ${formatDay(overdue.get(i.id)!.nextTry!)}`}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canChange(user) &&
          !h.is_manual &&
          d.installments
            .filter((i) => (i.status === "offen" || i.status === "fehlgeschlagen") && i.due_date <= today)
            .map((i) => (
              <ActionForm
                key={i.id}
                action={chargeNowAction}
                className="inline-form"
                submit={`Rate ${i.seq} jetzt abbuchen`}
                confirm={`Rate ${i.seq} über ${formatCents(Number(i.gross_cents), h.currency)} jetzt von der gespeicherten Zahlungsart abbuchen?`}
              >
                <input type="hidden" name="order_id" value={id} />
                <input type="hidden" name="installment_id" value={i.id} />
              </ActionForm>
            ))}
        {h.is_abo && pauses.length > 0 && (
          <>
            <h3>Pausen</h3>
            <ul>
              {pauses.map((p) => (
                <li key={p.id}>
                  {pauseText(p)}
                  {p.reason && <> · {p.reason}</>}
                </li>
              ))}
            </ul>
          </>
        )}
        {h.is_abo && canChange(user) && !aboEnd && h.status !== "storniert" && h.status !== "erstattet" &&
          (openPause ? (
            <ActionForm action={resumeSubscriptionAction} className="inline-form" submit="Pause beenden, Abo fortsetzen" confirm="Pause beenden? Ab heute fällige Zahlungen werden wieder eingezogen.">
              <input type="hidden" name="order_id" value={id} />
            </ActionForm>
          ) : (
            <details>
              <summary>Abo pausieren</summary>
              <p className="note">Zahlungen, die in die Pause fallen, entfallen. Danach läuft das Abo zum bisherigen Rhythmus weiter. Ohne Enddatum bis zum Fortsetzen.</p>
              <ActionForm action={pauseSubscriptionAction} className="inline-form" submit="Pausieren">
                <input type="hidden" name="order_id" value={id} />
                <label htmlFor="starts_on">Ab</label>
                <input id="starts_on" name="starts_on" type="date" min={today} defaultValue={today} required />
                <label htmlFor="pause_ends_on">Bis einschließlich (optional)</label>
                <input id="pause_ends_on" name="ends_on" type="date" min={today} />
                <label htmlFor="reason">Grund (optional)</label>
                <input id="reason" name="reason" type="text" placeholder="z. B. Elternzeit" />
              </ActionForm>
            </details>
          ))}
        {h.is_abo && <p>{aboEnd ? <>Abo {aboEnd < today ? "endete" : "endet"} am {formatDay(aboEnd)}.</> : <>Abo läuft.</>}</p>}
      </section>

      {(stornos.length > 0 || (canChange(user) && !h.is_manual && (running || refundable.length > 0))) && (
        <section className="card">
          <h2>Stornieren</h2>
          {stornos.length > 0 && (
            <ul>
              {stornos.map((s) => (
                <li key={s.id}>
                  <strong>{STORNO_LABEL[s.kind]}</strong> am {dateTime.format(s.createdAt)} durch {s.createdBy}
                  {s.effectiveOn > formatIsoDay(s.createdAt) && <> · Abo endet am {formatDay(s.effectiveOn)}</>} · Grund: {s.reason}
                </li>
              ))}
            </ul>
          )}
          {canChange(user) && !h.is_manual && (running || refundable.length > 0) && (
            <StornoForm
              orderId={id}
              isAbo={h.is_abo}
              running={running}
              canEndLater={!paypalAbo}
              paypalAbo={paypalAbo}
              today={today}
              invoices={refundable}
              currency={h.currency}
            />
          )}
        </section>
      )}

      <section className="card">
        <h2>Rechnungen</h2>
        {d.invoices.length === 0 ? (
          <p>Noch keine.</p>
        ) : (
          <table className="admin-table">
            <tbody>
              {d.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.has_pdf ? <a href={`/bestellung/${id}/rechnung/${i.id}`}>{i.invoice_number}</a> : i.invoice_number}</td>
                  <td>{i.kind}</td>
                  <td>{formatDay(i.issue_date)}</td>
                  <td>{formatCents(Number(i.gross_cents), h.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canChange(user) && !h.is_manual && refundable.length > 0 && (
          <details>
            <summary>Einzelne Rechnung erstatten (auch Teilbetrag), Bestellung läuft weiter</summary>
            <p className="note">Für einen Storno, der die Bestellung beendet, oben „Stornieren“ nutzen.</p>
            {refundable.map((i) => (
              <RefundForm
                key={i.id}
                orderId={id}
                invoiceId={i.id}
                invoiceNumber={i.number}
                refundableCents={i.refundableCents}
                grossCents={Number(d.invoices.find((x) => x.id === i.id)!.gross_cents)}
                currency={h.currency}
              />
            ))}
          </details>
        )}
        {canChange(user) && d.invoices.length > 0 && (
          <details>
            <summary>Rechnung erneut per E-Mail senden</summary>
            {d.invoices.map((i) => (
              <ActionForm key={i.id} action={resendInvoiceAction} className="inline-form" submit={`${i.invoice_number} senden`}>
                <input type="hidden" name="invoice_id" value={i.id} />
                <label htmlFor={`to-${i.id}`}>An</label>
                <input id={`to-${i.id}`} name="to" type="email" defaultValue={h.email} />
              </ActionForm>
            ))}
          </details>
        )}
      </section>

      {dunningApplies && (canChange(user) || holds.length > 0) && (
        <section className="card">
          <h2>Mahnungen</h2>
          {hold ? (
            <p>
              <span className="badge badge-warn">ausgesetzt</span> {hold.endsOn ? `bis einschließlich ${formatDay(hold.endsOn)}` : "bis auf Weiteres"} · {hold.reason}
            </p>
          ) : (
            <p className="note">Erinnerungen und Mahnungen gehen automatisch raus.</p>
          )}
          {canChange(user) && hold && (
            <ActionForm action={liftDunningHoldAction} className="inline-form" submit="Mahnungen wieder einschalten">
              <input type="hidden" name="order_id" value={id} />
            </ActionForm>
          )}
          {canChange(user) && !hold && (
            <details>
              <summary>Mahnungen aussetzen</summary>
              <p className="note">
                Zum Beispiel bei einem vereinbarten Zahlungsaufschub. In der Zeit gehen keine Erinnerungen und Mahnungen an die Kundin. Der automatische
                Einzug läuft weiter; wer auch nicht abbuchen will, pausiert das Abo.
              </p>
              <ActionForm action={holdDunningAction} className="inline-form" submit="Aussetzen">
                <input type="hidden" name="order_id" value={id} />
                <label htmlFor="hold_ends_on">Bis einschließlich (optional)</label>
                <input id="hold_ends_on" name="ends_on" type="date" min={today} />
                <label htmlFor="hold_reason">Grund</label>
                <input id="hold_reason" name="reason" type="text" required placeholder="z. B. Aufschub mit Vertrieb vereinbart" />
              </ActionForm>
            </details>
          )}
          {holds.filter((x) => x !== hold).length > 0 && (
            <ul className="note">
              {holds
                .filter((x) => x !== hold)
                .map((x) => (
                  <li key={x.id}>
                    Ausgesetzt am {dateTime.format(x.createdAt)} {x.endsOn ? `bis ${formatDay(x.endsOn)}` : "bis auf Weiteres"} · {x.reason}
                    {x.endedAt && ` · aufgehoben am ${dateTime.format(x.endedAt)}`}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {(d.notices.length > 0 || d.attempts.length > 0 || dunning.length > 0) && (
        <section className="card">
          {d.notices.length > 0 && (
            <>
              <h2>Kündigungen und Widerrufe</h2>
              <ul>
                {d.notices.map((n) => (
                  <li key={n.id}>
                    {n.kind === "kuendigung" ? "Kündigung" : "Widerruf"} vom {dateTime.format(n.received_at)}
                    {n.resolution ? ` · erledigt: ${n.resolution}` : " · offen"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {d.attempts.length > 0 && (
            <>
              <h2>Einzugsversuche</h2>
              <ul>
                {d.attempts.map((a, idx) => (
                  <li key={idx}>
                    Rate {a.seq} · {dateTime.format(a.attempted_at)} · {a.provider} · {a.outcome}
                    {a.error_code && ` (${a.error_code})`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {dunning.length > 0 && (
            <>
              <h2>Erinnerungen und Mahnungen</h2>
              <ul>
                {dunning.map((n, idx) => (
                  <li key={idx}>
                    {DUNNING_LABELS[n.kind] ?? n.kind}
                    {n.seq !== null && ` · Rate ${n.seq}`} · {dateTime.format(n.created_at)} · {n.sent_at ? "verschickt" : "im Postausgang"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
