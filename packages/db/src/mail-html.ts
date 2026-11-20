import { BRAND } from "./brand.ts";

/**
 * HTML-Fassung einer Kundenmail im Design der Marke. Der Text im Postausgang bleibt die
 * maßgebliche Fassung (Nachweis); das HTML entsteht erst beim Versand daraus:
 *  - Absätze trennt eine Leerzeile,
 *  - Zeilen mit „- “ werden Aufzählungen; eine kurze Zeile ohne Satzzeichen über weiteren Zeilen
 *    wird eine Überschrift, ebenso „Widerrufsbelehrung (Fassung …)“ allein über einem Rechtstext,
 *  - „Text: https://…“ wird ein Knopf mit der Beschriftung „Text“, sonstige Adressen werden Links,
 *  - der letzte Absatz (Anschrift der Gesellschaft) steht klein und grau darunter.
 */

export const LOGO_CONTENT_ID = "idf-logo";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;
const linkify = (s: string) =>
  escape(s).replace(URL_RE, (u) => `<a href="${u}" style="color:${BRAND.darkRose};text-decoration:underline">${u}</a>`);

const FONT = "font-family:Helvetica,Arial,sans-serif";
const P = `margin:0 0 16px;${FONT};font-size:15px;line-height:1.55;color:${BRAND.black}`;

function button(label: string, url: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr>` +
    `<td style="background:${BRAND.darkRose};border-radius:6px">` +
    `<a href="${escape(url)}" style="display:inline-block;padding:12px 22px;${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">${escape(label)}</a>` +
    `</td></tr></table>`
  );
}

const isItem = (l: string) => l.startsWith("- ");
const isHeading = (l: string) => l.length <= 60 && !/[.,:;!?]$/.test(l) && !/https?:\/\//.test(l) && !isItem(l);

function block(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  // Überschrift: kurze Zeile ohne Satzzeichen über weiteren Zeilen, oder allein vor einem Rechtstext („… (Fassung 3.1)“).
  if ((lines.length > 1 && isHeading(lines[0]!)) || (lines.length === 1 && isHeading(lines[0]!) && /\(Fassung [^)]+\)$/.test(lines[0]!))) {
    out.push(`<h2 style="margin:8px 0 8px;${FONT};font-size:17px;color:${BRAND.darkRose}">${escape(lines[0]!)}</h2>`);
    i = 1;
  }
  let para: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p style="${P}">${para.map(linkify).join("<br>")}</p>`);
    if (items.length)
      out.push(
        `<ul style="margin:0 0 16px;padding-left:20px;${FONT};font-size:15px;line-height:1.55;color:${BRAND.black}">${items
          .map((t) => `<li style="margin:0 0 4px">${linkify(t)}</li>`)
          .join("")}</ul>`,
      );
    para = [];
    items = [];
  };
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const cta = /^(.{2,80}?):\s*(https?:\/\/\S+)$/.exec(l);
    if (cta && !isItem(l)) {
      flush();
      out.push(button(cta[1]!, cta[2]!));
    } else if (/^https?:\/\/\S+$/.test(l)) {
      flush();
      out.push(button("Link öffnen", l));
    } else if (isItem(l)) {
      if (para.length) flush();
      items.push(l.slice(2));
    } else {
      if (items.length) flush();
      para.push(l);
    }
  }
  flush();
  return out.join("");
}

export function renderMailHtml(subject: string, text: string, opts: { logo: boolean } = { logo: true }): string {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0))
    .filter((b) => b.length > 0);
  // Letzter Absatz ohne Link mit mehreren Zeilen: Anschrift der Gesellschaft.
  const last = blocks.at(-1);
  const footer = last && last.length > 1 && !last.some((l) => /https?:\/\//.test(l)) ? blocks.pop()! : null;
  const body = blocks.map(block).join("");
  const logo = opts.logo
    ? `<tr><td style="padding:28px 32px 18px;text-align:center"><img src="cid:${LOGO_CONTENT_ID}" width="240" alt="Investiere.Dich.Frei – Die Emilia Bolda Finanzakademie" style="display:inline-block;width:240px;max-width:100%;height:auto;border:0"></td></tr>`
    : "";
  return (
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escape(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BRAND.lightGrey}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.lightGrey}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;border-top:4px solid ${BRAND.darkRose}">` +
    logo +
    `<tr><td style="padding:8px 32px 16px">${body}</td></tr>` +
    (footer
      ? `<tr><td style="padding:16px 32px 28px;border-top:1px solid ${BRAND.lightGrey};${FONT};font-size:12px;line-height:1.5;color:${BRAND.textSoft}">${footer.map(linkify).join("<br>")}</td></tr>`
      : "") +
    `</table></td></tr></table></body></html>`
  );
}
