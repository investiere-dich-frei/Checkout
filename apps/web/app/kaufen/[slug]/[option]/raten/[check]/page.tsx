import { creditTextData, usableCheck } from "@idf/db/credit";
import { creditWithdrawalInformation, precontractInformation } from "@idf/db/credit-texts";
import { notFound } from "next/navigation";
import { pool } from "../../../../../../lib/db";
import { formatCents, todayBerlin } from "../../../../../../lib/format";
import { CreditOrderForm } from "./credit-order-form";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zweiter Schritt beim Ratenkauf: Europäische Standardinformation lesen, Ratenvertrag abschließen.
 * Bei gelber Prüfung ohne Entscheidung: Hinweis, dass das Team prüft.
 */
export default async function CreditStepPage(props: { params: Promise<{ slug: string; option: string; check: string }> }) {
  const { option, check } = await props.params;
  if (!UUID.test(option) || !UUID.test(check)) notFound();
  const db = pool();
  const usable = await usableCheck(db, check);

  if (!usable || usable.priceOptionId !== option) {
    const { rows } = await db.query(
      `select c.result, c.expires_at < now() expired, d.decision,
              exists (select 1 from app.orders o where o.credit_check_id = c.id) used, p.name product
         from app.credit_checks c
         join app.price_options po on po.id = c.price_option_id join app.products p on p.id = po.product_id
         left join app.credit_check_decisions d on d.credit_check_id = c.id
        where c.id = $1 and c.price_option_id = $2`,
      [check, option],
    );
    const r = rows[0];
    if (!r) notFound();
    let title = "Diese Anfrage ist abgelaufen";
    let text = "Bitte starte die Bestellung über die Kaufseite neu.";
    if (r.used) {
      title = "Du hast schon bestellt";
      text = "Zu dieser Anfrage gibt es bereits eine Bestellung. Alle Unterlagen haben wir dir per E-Mail geschickt.";
    } else if (r.decision === "abgelehnt" || (r.result === "rot" && !r.decision)) {
      title = "Leider keine Ratenzahlung";
      text = "Eine Ratenzahlung können wir dir für dieses Angebot nicht anbieten. Die Einzelheiten stehen in unserer E-Mail an dich. Mit Einmalzahlung kannst du weiterhin kaufen.";
    } else if (r.result === "gelb" && !r.decision && !r.expired) {
      title = "Danke, wir prüfen deine Angaben";
      text = "Wir schauen uns deine Anfrage persönlich an und melden uns spätestens am nächsten Werktag per E-Mail. Mit dem Link darin kannst du die Bestellung dann abschließen.";
    }
    return (
      <section className="card">
        <h1>{title}</h1>
        <p>{r.product}</p>
        <p>{text}</p>
      </section>
    );
  }

  const data = await creditTextData(db, {
    priceOptionId: usable.priceOptionId,
    customer: usable.customer,
    couponCode: usable.couponCode,
    contractDay: todayBerlin(),
  });
  const immediate = (await db.query<{ immediate_access: boolean }>(
    `select p.immediate_access from app.price_options o join app.products p on p.id = o.product_id where o.id = $1`,
    [usable.priceOptionId],
  )).rows[0]?.immediate_access ?? false;
  const dueNow = data.schedule.filter((s) => s.dueDate === data.contractDay).reduce((t, s) => t + s.grossCents, 0);

  return (
    <>
      <section className="card" aria-labelledby="info">
        <h1 id="info">Informationen zu deiner Ratenzahlung</h1>
        <p className="note">
          Deine Ratenzahlung ist möglich. Bitte lies die folgenden Informationen, bevor du den Ratenvertrag abschließt. Wir haben sie dir auch per E-Mail an{" "}
          {usable.customer.email} geschickt.
        </p>
        <pre className="credit-info" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
          {precontractInformation(data)}
        </pre>
      </section>
      <CreditOrderForm
        checkId={usable.id}
        withdrawalText={creditWithdrawalInformation(data)}
        immediateAccess={immediate}
        dueNow={formatCents(dueNow, data.currency)}
      />
    </>
  );
}
