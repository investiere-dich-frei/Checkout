const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function formatCents(cents: number, currency = "EUR"): string {
  if (currency === "EUR") return euro.format(cents / 100);
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

export function formatRate(rateBp: number): string {
  return `${(rateBp / 100).toLocaleString("de-DE")} %`;
}

/** Heutiger Kalendertag in Europe/Berlin, YYYY-MM-DD. */
export function todayBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
}
