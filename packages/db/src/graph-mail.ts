import { LOGO_PNG_BASE64 } from "./brand.ts";
import { LOGO_CONTENT_ID, renderMailHtml } from "./mail-html.ts";
import type { SendMail } from "./mail-outbox.ts";

/**
 * Versand über Microsoft Graph, wie die Alarm-Mails der Überwachung. Die Entra-App
 * darf per Application Access Policy nur als das hinterlegte Postfach senden.
 *
 * Umgebung: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MAIL_FROM
 */
export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
}

export function graphConfig(env: Record<string, string | undefined> = process.env): GraphConfig | null {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, MAIL_FROM } = env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !MAIL_FROM) return null;
  return { tenantId: GRAPH_TENANT_ID, clientId: GRAPH_CLIENT_ID, clientSecret: GRAPH_CLIENT_SECRET, from: MAIL_FROM };
}

export function graphSender(config: GraphConfig, fetchFn: typeof fetch = fetch): SendMail {
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
    });
    if (!res.ok) throw new Error(`Graph-Anmeldung fehlgeschlagen (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  return async (mail) => {
    const res = await fetchFn(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.from)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          // Gestaltete HTML-Fassung; maßgeblich bleibt der Text im Postausgang.
          body: { contentType: "HTML", content: renderMailHtml(mail.subject, mail.body) },
          toRecipients: [{ emailAddress: { address: mail.to } }],
          internetMessageHeaders: [{ name: "X-IDF-Mail-Id", value: mail.id }],
          attachments: [
            ...mail.attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.content.toString("base64"),
            })),
            // Logo im Kopf der Mail, eingebettet statt aus dem Netz geladen.
            {
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: "investiere-dich-frei.png",
              contentType: "image/png",
              contentBytes: LOGO_PNG_BASE64,
              isInline: true,
              contentId: LOGO_CONTENT_ID,
            },
          ],
        },
        // Im Postfach als Nachweis des Versands.
        saveToSentItems: true,
      }),
    });
    // Nur den Statuscode melden: Fehlertexte können die Empfängeradresse enthalten.
    if (res.status !== 202) throw new Error(`Graph-Versand fehlgeschlagen (${res.status})`);
    return { messageId: res.headers.get("request-id") };
  };
}
