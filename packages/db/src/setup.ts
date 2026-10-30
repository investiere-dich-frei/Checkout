import type pg from "pg";

/**
 * Einrichtung vor dem ersten Verkauf: Zugänge zur Verwaltung, Steuerkategorie je
 * Produkt und der MWST-Satz für die Schweiz. Jede Änderung läuft mit handelnder
 * Stelle, damit das Audit-Log zeigt, wer sie veranlasst hat.
 */

export type UserRole = "admin" | "vertrieb" | "freelancer" | "pruefer";

export interface UserInput {
  email: string;
  display_name: string;
  role: UserRole;
  sales_code?: string | null;
}

async function setActor(client: pg.ClientBase, actor: string) {
  if (!/^(user|cli|system):\S+$/.test(actor)) throw new Error(`Ungültige handelnde Stelle: ${actor}`);
  await client.query(`select set_config('app.actor', $1, true)`, [actor]);
}

/** Legt Zugänge an oder setzt Name und Rolle bestehender Zugänge neu. E-Mail-Adressen werden klein geschrieben. */
export async function upsertUsers(client: pg.ClientBase, users: UserInput[], actor: string): Promise<number> {
  await setActor(client, actor);
  for (const u of users) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) throw new Error(`Ungültige E-Mail-Adresse: ${u.email}`);
    await client.query(
      `insert into app.users (email, display_name, role, sales_code) values (lower($1), $2, $3, $4)
       on conflict (email) do update set display_name = excluded.display_name, role = excluded.role,
         sales_code = coalesce(excluded.sales_code, app.users.sales_code), active = true`,
      [u.email, u.display_name, u.role, u.sales_code ?? null],
    );
  }
  return users.length;
}

export interface TaxDecisionInput {
  thrivecart_product_id: number;
  tax_category: "standard" | "steuerfrei_4_21";
  source: string;
}

export interface TaxConfirmResult {
  confirmed: number;
  activated: number;
  /** Thrivecart-IDs aus der Datei, die es im Katalog nicht gibt. */
  unknown: number[];
}

/**
 * Bestätigt die Steuerkategorie je Produkt im Namen einer Admin-Person.
 * Freigeschaltet wird nur, was in Thrivecart „live“ ist. Bereits bestätigte
 * Produkte bleiben, wie sie sind.
 */
export async function confirmTaxCategories(
  client: pg.ClientBase,
  decisions: TaxDecisionInput[],
  adminEmail: string,
): Promise<TaxConfirmResult> {
  const admin = (
    await client.query<{ id: string }>(`select id from app.users where email = lower($1) and role = 'admin' and active`, [adminEmail])
  ).rows[0];
  if (!admin) throw new Error(`Keine aktive Admin-Person mit dieser E-Mail-Adresse`);
  await setActor(client, `user:${admin.id}`);

  const result: TaxConfirmResult = { confirmed: 0, activated: 0, unknown: [] };
  for (const d of decisions) {
    if (d.tax_category !== "standard" && d.tax_category !== "steuerfrei_4_21") {
      throw new Error(`Unbekannte Steuerkategorie bei Thrivecart-Produkt ${d.thrivecart_product_id}`);
    }
    const { rows } = await client.query<{ active: boolean }>(
      `update app.products
          set tax_category = $2, tax_source = $3, tax_confirmed_at = now(), tax_confirmed_by = $4,
              active = (source_status = 'live')
        where thrivecart_product_id = $1 and tax_confirmed_at is null
        returning active`,
      [d.thrivecart_product_id, d.tax_category, d.source, admin.id],
    );
    if (rows[0]) {
      result.confirmed++;
      if (rows[0].active) result.activated++;
    } else {
      const exists = await client.query(`select 1 from app.products where thrivecart_product_id = $1`, [d.thrivecart_product_id]);
      if (!exists.rowCount) result.unknown.push(d.thrivecart_product_id);
    }
  }
  return result;
}

/** MWST-Satz für Kundinnen in der Schweiz in Basispunkten (8,1 % = 810), wie bisher in Thrivecart. */
export async function setSwissVatRate(client: pg.ClientBase, companyId: string, rateBp: number, actor: string) {
  if (!Number.isInteger(rateBp) || rateBp < 1 || rateBp > 10000) throw new Error("Satz in Basispunkten zwischen 1 und 10000");
  await setActor(client, actor);
  const r = await client.query(`update app.companies set ch_vat_rate_bp = $2 where id = $1`, [companyId, rateBp]);
  if (r.rowCount !== 1) throw new Error("Gesellschaft gibt es nicht");
}

const ROLES: readonly UserRole[] = ["admin", "vertrieb", "freelancer", "pruefer"];

/** Prüft eine Liste von Zugängen, z. B. aus einer JSON-Datei. */
export function parseUsers(raw: unknown): UserInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Erwartet eine nicht leere Liste von Zugängen");
  return raw.map((u, i) => {
    if (typeof u?.email !== "string" || typeof u?.display_name !== "string" || !u.display_name.trim()) {
      throw new Error(`Zugang ${i + 1}: email und display_name sind Pflicht`);
    }
    if (!ROLES.includes(u.role)) throw new Error(`Zugang ${i + 1}: Rolle muss ${ROLES.join(", ")} sein`);
    return { email: u.email, display_name: u.display_name.trim(), role: u.role, sales_code: u.sales_code ?? null };
  });
}

/** Liest die Entscheidungen aus steuer-je-produkt.json (Feld „entscheidungen“). */
export function parseTaxFile(raw: unknown): TaxDecisionInput[] {
  const list = (raw as { entscheidungen?: unknown })?.entscheidungen;
  if (!Array.isArray(list)) throw new Error("Datei hat kein Feld „entscheidungen“");
  return list.map((d, i) => {
    if (!Number.isInteger(d?.thrivecart_product_id) || typeof d?.source !== "string" || !d.source) {
      throw new Error(`Eintrag ${i + 1}: thrivecart_product_id und source sind Pflicht`);
    }
    return { thrivecart_product_id: d.thrivecart_product_id, tax_category: d.tax_category, source: d.source };
  });
}
