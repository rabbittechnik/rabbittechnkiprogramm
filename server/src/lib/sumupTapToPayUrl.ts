/**
 * SumUp Payment Switch – SumUp-App auf dem Smartphone (Tap to Pay / kontaktlos).
 * Kein physischer Reader; der Händler startet die Zahlung in der SumUp Business App.
 * @see https://developer.sumup.com/terminal-payments/payment-switch/
 * @see https://github.com/sumup/sumup-android-url-scheme
 */

export function buildSumUpPaymentSwitchUrl(params: {
  /** Betrag mit Punkt als Dezimaltrenner, z. B. "12.34" */
  amountMajor: string;
  currency: string;
  affiliateKey: string;
  /** Muss zur Affiliate-Key-Konfiguration passieren (Android: applicationId, iOS: Bundle ID). */
  appId: string;
  title: string;
  /** Eindeutige Referenz (z. B. UUID), max. 128 Zeichen – Abgleich über Transactions-API / Callback. */
  foreignTxId: string;
  /** HTTPS bevorzugt (SumUp Mobile Web / Callback). */
  callbackSuccessUrl: string;
  callbackFailUrl: string;
}): string {
  const u = new URL("sumupmerchant://pay/1.0");
  u.searchParams.set("amount", params.amountMajor);
  u.searchParams.set("currency", params.currency);
  u.searchParams.set("affiliate-key", params.affiliateKey);
  u.searchParams.set("app-id", params.appId);
  u.searchParams.set("title", params.title.slice(0, 120));
  u.searchParams.set("foreign-tx-id", params.foreignTxId.slice(0, 128));
  u.searchParams.set("callbacksuccess", params.callbackSuccessUrl);
  u.searchParams.set("callbackfail", params.callbackFailUrl);
  /** Android Payment Switch (mobile Web / neure App-Versionen): ein Callback-Parameter. */
  u.searchParams.set("callback", params.callbackSuccessUrl);
  return u.toString();
}
