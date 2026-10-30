/**
 * Feste Texte rund um Widerruf und Sofortstart. Ohne Datenbankzugriff, damit auch
 * das Checkout-Formular im Browser sie verwenden kann.
 */

/**
 * Wortlaut der freiwilligen Sofortstart-Checkbox (§ 357a Abs. 2 BGB), wie ihn Christian
 * am 28.10.2026 nach dem Schreiben von RA Dr. Metzner (Az. 385/26) festgelegt hat.
 * Gleicher Text wie im Thrivecart-Checkout. Eine Änderung braucht eine neue Fassung.
 */
export const SOFORTSTART_TEXT =
  "Ich verlange ausdrücklich, dass die Investiere Dich Frei GmbH vor Ablauf der Widerrufsfrist mit den vertraglichen Leistungen beginnt und mir sofort Zugang zur Lernplattform gewährt.";
export const SOFORTSTART_VERSION = "2026-10-28";

/** Ohne Sofortstart beginnt der Zugang am Tag nach Ablauf der Widerrufsfrist: Vertragsschluss + 15 Tage. */
export const ACCESS_DELAY_DAYS = 15;
