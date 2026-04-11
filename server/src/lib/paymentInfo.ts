/** Anzeige & PDF: Zahlungsbedingungen Rabbit-Technik */

export const RABBIT_IBAN_RAW = "DE52641500200004543075";

/** Lesbare IBAN-Gruppierung (DE + Prüfziffern + BLZ/Konto) */
export const RABBIT_IBAN_FORMATTED = "DE52 6415 0020 0004 5430 75";

/** Neutral: keine pauschale 7-Tage-Überweisung (sofortzahler / individuelle Vereinbarungen). */
export const PAYMENT_TERMS_HEADLINE_DE = "Zahlung";

export const PAYMENT_TERMS_LINES_DE = [
  "Die Zahlungsart (Bar, Kartenzahlung mit SumUp oder Überweisung) wird bei Abholung bzw. nach individueller Absprache festgelegt.",
  "Sofern Überweisung vereinbart wurde: bitte die auf der Rechnung genannte Fälligkeit und den Verwendungszweck beachten.",
  `Unsere IBAN (nur bei Überweisung): ${RABBIT_IBAN_FORMATTED} — Verwendungszweck: Tracking-Code bzw. Rechnungsnummer.`,
];

/** Verwendungszweck für Überweisung = öffentliche Auftrags-/Tracking-Nummer */
export function transferPurposeFromTracking(trackingCode: string): string {
  return String(trackingCode ?? "").trim() || "—";
}
