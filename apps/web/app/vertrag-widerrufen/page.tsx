import type { Metadata } from "next";
import { todayBerlin } from "../../lib/format";
import { NoticeForm } from "../../lib/notice-form-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vertrag widerrufen – Investiere Dich Frei" };

// § 356a BGB: Widerrufsbutton, ohne Anmeldung, mit sofortiger Eingangsbestätigung.
export default function WithdrawPage() {
  return <NoticeForm kind="widerruf" today={todayBerlin()} />;
}
