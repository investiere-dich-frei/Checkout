import type pg from "pg";

/**
 * Legt eine Verkäufergesellschaft samt Rechnungsnummernkreis an.
 * Beides entsteht in derselben Transaktion: Eine Gesellschaft ohne Nummernkreis
 * könnte keine Rechnung ausstellen, ein Nummernkreis ohne Gesellschaft gibt es nicht.
 */

export interface CompanyInput {
  legal_name: string;
  street: string;
  postal_code: string;
  city: string;
  country?: string;
  vat_id?: string | null;
  tax_number?: string | null;
  register_info?: string | null;
  /** Vorsilbe der Rechnungsnummern, z. B. "IDF-". Lässt sich später nicht mehr ändern. */
  invoice_prefix: string;
  /** Erste zu vergebende Nummer. */
  invoice_next_value: number;
}

export function parseCompany(raw: unknown): CompanyInput {
  const c = raw as CompanyInput;
  for (const key of ["legal_name", "street", "postal_code", "city"] as const) {
    if (typeof c?.[key] !== "string" || !c[key].trim()) throw new Error(`Pflichtfeld fehlt: ${key}`);
  }
  if (typeof c.invoice_prefix !== "string") throw new Error("Pflichtfeld fehlt: invoice_prefix (leer erlaubt)");
  if (!Number.isSafeInteger(c.invoice_next_value) || c.invoice_next_value < 1) {
    throw new Error("invoice_next_value muss eine ganze Zahl ab 1 sein");
  }
  if (c.country !== undefined && !/^[A-Z]{2}$/.test(c.country)) throw new Error(`Ungültiger Ländercode: ${c.country}`);
  return c;
}

export async function createCompany(client: pg.ClientBase, input: CompanyInput, actor: string): Promise<string> {
  if (!/^(user|cli|system):\S+$/.test(actor)) throw new Error(`Ungültige handelnde Stelle: ${actor}`);
  await client.query(`select set_config('app.actor', $1, true)`, [actor]);

  const existing = await client.query(`select id from app.companies where legal_name = $1`, [input.legal_name]);
  if (existing.rowCount) throw new Error(`Gesellschaft „${input.legal_name}“ gibt es schon (${existing.rows[0].id})`);

  const { rows } = await client.query<{ id: string }>(
    `insert into app.companies (legal_name, street, postal_code, city, country, vat_id, tax_number, register_info)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      input.legal_name,
      input.street,
      input.postal_code,
      input.city,
      input.country ?? "DE",
      input.vat_id ?? null,
      input.tax_number ?? null,
      input.register_info ?? null,
    ],
  );
  const id = rows[0]!.id;
  await client.query(`insert into app.invoice_number_series (company_id, prefix, next_value) values ($1, $2, $3)`, [
    id,
    input.invoice_prefix,
    input.invoice_next_value,
  ]);
  return id;
}
