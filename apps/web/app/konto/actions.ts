"use server";

import { requestPortalLink } from "@idf/db/customer-portal";
import { headers } from "next/headers";
import { transaction } from "../../lib/db";

export async function portalBaseUrl(): Promise<string> {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
}

export async function requestPortalLinkAction(_prev: { sent: boolean }, form: FormData): Promise<{ sent: boolean }> {
  const email = String(form.get("email") ?? "").trim();
  if (email) {
    const base = await portalBaseUrl();
    await transaction("system:kundenbereich", (c) => requestPortalLink(c, email, base)).catch((err) =>
      console.error("Link zum Kundenbereich nicht erstellt", (err as Error).message),
    );
  }
  // Immer dieselbe Antwort, egal ob es Bestellungen zu der Adresse gibt.
  return { sent: true };
}
