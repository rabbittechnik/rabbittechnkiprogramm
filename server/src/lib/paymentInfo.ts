/** Anzeige & PDF: Zahlungsbedingungen Rabbit-Technik */

export const RABBIT_IBAN_RAW = "DE52641500200004543075";

/** Lesbare IBAN-Gruppierung (DE + Prüfziffern + BLZ/Konto) */
export const RABBIT_IBAN_FORMATTED = "DE52 6415 0020 0004 5430 75";

export const PAYMENT_TERMS_HEADLINE_DE = "Zahlung (7 Tage Zahlungsziel)";

export const PAYMENT_TERMS_LINES_DE = [
  "Zahlungsziel: 7 Tage ab Rechnungsdatum bzw. ab Freigabe „Fertig zur Abholung“ (siehe Fälligkeit).",
  "Zahlungsarten: Barzahlung vor Ort · EC-/Kreditkarte am SumUp-Terminal · Überweisung auf die unten genannte IBAN.",
  `Überweisung: IBAN ${RABBIT_IBAN_FORMATTED} — bitte Tracking-Code bzw. Rechnungsnummer im Verwendungszweck angeben.`,
];

/** Verwendungszweck für Überweisung = öffentliche Auftrags-/Tracking-Nummer */
export function transferPurposeFromTracking(trackingCode: string): string {
  return String(trackingCode ?? "").trim() || "—";
}
