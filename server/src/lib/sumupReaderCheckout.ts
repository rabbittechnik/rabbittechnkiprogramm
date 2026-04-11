/**
 * SumUp Reader (Cloud API) – Kartenzahlung am gekoppelten SumUp-Gerät (Solo o. ä.).
 * @see https://developer.sumup.com/api/readers/list
 */

export type SumUpReaderCheckoutResult = {
  client_transaction_id: string;
};

/**
 * Startet eine Terminal-Zahlung auf dem angegebenen Reader.
 * Affiliate-Block ist für Card-Present laut SumUp-Dokumentation erforderlich.
 */
export async function createSumUpReaderCheckout(params: {
  apiKey: string;
  merchantCode: string;
  readerId: string;
  totalCents: number;
  /** Eindeutig pro Zahlungsversuch (z. B. UUID), max. 128 Zeichen. */
  foreignTransactionId: string;
  affiliateAppId: string;
  affiliateKey: string;
  /** HTTPS-Webhook: Zahlungsergebnis (Status per Transactions-API verifizieren). */
  returnUrl?: string;
  description?: string;
}): Promise<SumUpReaderCheckoutResult> {
  const ft = params.foreignTransactionId.trim().slice(0, 128);
  if (!ft) throw new Error("SumUp Reader: foreign_transaction_id fehlt");

  const body: Record<string, unknown> = {
    total_amount: {
      currency: "EUR",
      minor_unit: 2,
      value: Math.max(0, Math.round(params.totalCents)),
    },
    affiliate: {
      app_id: params.affiliateAppId.trim(),
      key: params.affiliateKey.trim(),
      foreign_transaction_id: ft,
    },
  };
  const desc = params.description?.trim();
  if (desc) body.description = desc.slice(0, 255);
  const ru = params.returnUrl?.trim();
  if (ru) body.return_url = ru;

  const url = `https://api.sumup.com/v0.1/merchants/${encodeURIComponent(params.merchantCode)}/readers/${encodeURIComponent(params.readerId)}/checkout`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof j.detail === "string" ? j.detail : null;
    const title = typeof j.title === "string" ? j.title : null;
    const msg = detail ?? title ?? JSON.stringify(j);
    throw new Error(`SumUp Reader checkout (${res.status}): ${msg}`);
  }
  const data = j.data as Record<string, unknown> | undefined;
  const client_transaction_id = String(data?.client_transaction_id ?? "").trim();
  if (!client_transaction_id) {
    throw new Error("SumUp Reader: Antwort ohne client_transaction_id");
  }
  return { client_transaction_id };
}
