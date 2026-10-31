// Argumente für den Testkauf (scripts/testkauf.ts), nur für die Testdatenbank.

export interface TestkaufArgs {
  option: string;
  email: string;
  /** Offizielle Stripe-Test-Zahlungsart, z. B. pm_card_visa oder pm_card_chargeCustomerFail. */
  karte: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function value(argv: string[], name: string): string | undefined {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const arg = argv[i]!;
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
}

export function parseTestkaufArgs(argv: string[]): TestkaufArgs {
  const option = value(argv, "option") ?? "";
  const email = value(argv, "email") ?? "";
  const karte = value(argv, "karte") ?? "pm_card_visa";
  if (!UUID.test(option)) throw new Error("--option erwartet die ID einer Preisoption");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email erwartet eine E-Mail-Adresse");
  // Nur Stripes feste Test-Kennungen, nie Kartennummern.
  if (!/^pm_card_[A-Za-z0-9]+$/.test(karte)) throw new Error("--karte erwartet eine Stripe-Test-Zahlungsart wie pm_card_visa");
  return { option, email, karte };
}
