import type { Metadata } from "next";
import { todayBerlin } from "../../lib/format";
import { NoticeForm } from "../../lib/notice-form-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verträge hier kündigen – Investiere Dich Frei" };

// § 312k BGB: Kündigung ohne Anmeldung, mit Bestätigungsseite und sofortiger Eingangsbestätigung.
export default function CancelPage() {
  return <NoticeForm kind="kuendigung" today={todayBerlin()} />;
}
