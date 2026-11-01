import type { OrderFilter } from "@idf/db/admin";

/** Filter der Bestellliste aus den URL-Parametern (deutsche Namen, damit die Adresse lesbar bleibt). */
export const FILTER_PARAMS = {
  q: "search",
  von: "from",
  bis: "to",
  status: "status",
  produkt: "productId",
  land: "country",
  zahlung: "payment",
  vertrieb: "sellerId",
  lage: "state",
} as const satisfies Record<string, keyof OrderFilter>;

export type FilterParams = Partial<Record<keyof typeof FILTER_PARAMS, string>>;

export function readOrderFilter(params: FilterParams | URLSearchParams): OrderFilter {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params as Record<string, unknown>)[k]);
  const filter: OrderFilter = {};
  for (const [param, key] of Object.entries(FILTER_PARAMS)) {
    const v = get(param);
    if (typeof v === "string" && v.trim()) filter[key] = v.trim();
  }
  return filter;
}

/** Die gesetzten Filter wieder als URL-Parameter, z. B. für Blättern und Export. */
export function filterQuery(params: FilterParams, extra: Record<string, string> = {}): string {
  const out = new URLSearchParams();
  for (const k of Object.keys(FILTER_PARAMS) as (keyof typeof FILTER_PARAMS)[]) {
    const v = params[k];
    if (v && v.trim()) out.set(k, v.trim());
  }
  for (const [k, v] of Object.entries(extra)) out.set(k, v);
  return out.toString();
}

export const STATUS_LABELS: Record<string, string> = {
  offen: "Offen",
  bezahlt: "Bezahlt",
  teilbezahlt: "Teilbezahlt",
  storniert: "Storniert",
  erstattet: "Erstattet",
};
export const PAYMENT_LABELS: Record<string, string> = {
  stripe: "Karte (Stripe)",
  paypal: "PayPal",
  ueberweisung: "Überweisung (manuell)",
  keine: "Noch keine Zahlung",
};
export const STATE_LABELS: Record<string, string> = {
  ueberfaellig: "Überfällig",
  pausiert: "Pausiert",
  abo: "Abos",
  raten: "Ratenpläne",
  einmal: "Einmalzahlung",
};
