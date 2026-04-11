/**
 * SumUp Transaktionen (v2.1) – Abgleich per foreign_transaction_id (z. B. Payment Switch / Tap to Pay).
 * @see https://developer.sumup.com/api/transactions/get
 */

export type SumUpTransactionResource = {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string | null;
  simple_status?: string | null;
  foreign_transaction_id?: string | null;
  client_transaction_id?: string | null;
  merchant_code?: string;
};

export function isSumUpTransactionPaid(txn: SumUpTransactionResource): boolean {
  const st = String(txn.status ?? "").toUpperCase();
  if (st === "SUCCESSFUL") return true;
  const ss = String(txn.simple_status ?? "").toUpperCase();
  return ss === "SUCCESSFUL" || ss === "PAID_OUT";
}

export async function getSumUpTransaction(params: {
  apiKey: string;
  merchantCode: string;
  foreignTransactionId?: string;
  clientTransactionId?: string;
}): Promise<SumUpTransactionResource> {
  const q = new URLSearchParams();
  if (params.foreignTransactionId) q.set("foreign_transaction_id", params.foreignTransactionId);
  else if (params.clientTransactionId) q.set("client_transaction_id", params.clientTransactionId);
  else throw new Error("SumUp: foreign_transaction_id oder client_transaction_id erforderlich");

  const url = `https://api.sumup.com/v2.1/merchants/${encodeURIComponent(params.merchantCode)}/transactions?${q}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      Accept: "application/json",
    },
  });
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof j.detail === "string" ? j.detail : null;
    const title = typeof j.title === "string" ? j.title : null;
    const msg = typeof j.message === "string" ? j.message : null;
    const err = detail ?? title ?? msg ?? JSON.stringify(j);
    throw new Error(`SumUp GET transaction (${res.status}): ${err}`);
  }
  return j as SumUpTransactionResource;
}
