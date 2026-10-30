"use server";

import { canChange, resolveNotice } from "@idf/db/admin";
import { endSession, redeemLogin, requestLogin } from "@idf/db/auth";
import { endSubscription } from "@idf/db/billing";
import { cancelOrder, RefundError } from "@idf/db/refunds";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool, transaction } from "../../lib/db";
import { paypal } from "../../lib/paypal";
import { refundInvoice } from "../../lib/refund";
import { SESSION_COOKIE, requireUser } from "../../lib/session";
import { stripe } from "../../lib/stripe";

async function baseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
}

export async function requestLoginAction(_prev: { sent: boolean }, form: FormData): Promise<{ sent: boolean }> {
  const email = String(form.get("email") ?? "").trim();
  if (email) {
    const base = await baseUrl();
    await transaction("system:anmeldung", (c) => requestLogin(c, email, base)).catch((err) =>
      console.error("Anmeldelink nicht erstellt", (err as Error).message),
    );
  }
  // Immer dieselbe Antwort, egal ob die Adresse Zugang hat.
  return { sent: true };
}

export async function redeemLoginAction(form: FormData) {
  const token = String(form.get("token") ?? "");
  const s = await transaction("system:anmeldung", (c) => redeemLogin(c, token));
  if (!s) redirect("/admin/anmelden?abgelaufen=1");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, s.session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    expires: s.expiresAt,
  });
  redirect("/admin");
}

export async function logoutAction() {
  const jar = await cookies();
  const s = jar.get(SESSION_COOKIE)?.value;
  if (s) await endSession(pool(), s);
  jar.delete({ name: SESSION_COOKIE, path: "/admin" });
  redirect("/admin/anmelden");
}

export async function resolveNoticeAction(form: FormData) {
  const user = await requireUser();
  const noticeId = String(form.get("notice_id") ?? "");
  const resolution = String(form.get("resolution") ?? "").trim();
  const orderId = String(form.get("order_id") ?? "").trim() || null;
  if (!resolution) return;
  await transaction(`user:${user.id}`, (c) => resolveNotice(c, user, noticeId, resolution, orderId));
  revalidatePath("/admin");
}

export async function endSubscriptionAction(form: FormData) {
  const user = await requireUser();
  if (!canChange(user)) throw new Error("Keine Berechtigung");
  const orderId = String(form.get("order_id") ?? "");
  const endsOn = String(form.get("ends_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return;
  await transaction(`user:${user.id}`, (c) => endSubscription(c, orderId, endsOn, `user:${user.id}`));
  revalidatePath(`/admin/bestellungen/${orderId}`);
}

export async function refundInvoiceAction(_prev: { message: string | null }, form: FormData): Promise<{ message: string | null }> {
  const user = await requireUser();
  const orderId = String(form.get("order_id") ?? "");
  const invoiceId = String(form.get("invoice_id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { message: "Bitte einen Grund angeben." };
  try {
    const r = await refundInvoice(pool(), { stripe: stripe(), paypal: paypal() }, user, invoiceId, reason);
    revalidatePath(`/admin/bestellungen/${orderId}`);
    return { message: r.ok ? `Erstattet. Stornorechnung ${r.stornoNumber} ist erstellt und geht per E-Mail raus.` : r.message };
  } catch (err) {
    if (err instanceof RefundError) return { message: err.message };
    console.error("Erstattung fehlgeschlagen", (err as Error).message);
    return { message: "Erstattung nicht möglich. Bitte später erneut versuchen." };
  }
}

export async function cancelOrderAction(form: FormData) {
  const user = await requireUser();
  const orderId = String(form.get("order_id") ?? "");
  await transaction(`user:${user.id}`, (c) => cancelOrder(c, user, orderId));
  revalidatePath(`/admin/bestellungen/${orderId}`);
}
