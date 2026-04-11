/**
 * SumUp Online Checkout (Hosted) – Betrag geht auf das SumUp-Konto der hinterlegten merchant_code.
 * @see https://developer.sumup.com/api/checkouts/create
 * Webhook: return_url bei Checkout-Erstellung = Backend-URL (CHECKOUT_STATUS_CHANGED).
 */

export type SumUpHostedCheckoutResult = {
  checkoutId: string;
  hostedCheckoutUrl: string;
};

/** Checkout-Ressource (Auszug) laut GET /v0.1/checkouts/{id} */
export type SumUpCheckoutResource = {
  id?: string;
  status?: string;
  checkout_reference?: string | null;
  amount?: number;
  currency?: string;
  merchant_code?: string;
  description?: string | null;
};

export async function createSumUpHostedCheckout(params: {
  apiKey: string;
  merchantCode: string;
  amountEuro: number;
  checkoutReference: string;
  description: string;
  /** SumUp POSTet CHECKOUT_STATUS_CHANGED an diese URL (nicht Kunden-Redirect). */
  returnUrl?: string;
}): Promise<SumUpHostedCheckoutResult> {
  const amount = Math.round(params.amountEuro * 100) / 100;
  const payload: Record<string, unknown> = {
    checkout_reference: params.checkoutReference.slice(0, 90),
    amount,
    currency: "EUR",
    merchant_code: params.merchantCode,
    description: params.description.slice(0, 255),
    hosted_checkout: { enabled: true },
  };
  const ru = params.returnUrl?.trim();
  if (ru) {
    payload.return_url = ru;
  }
  const res = await fetch("https://api.sumup.com/v0.1/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof j.detail === "string" ? j.detail : null;
    const title = typeof j.title === "string" ? j.title : null;
    const msg = detail ?? title ?? JSON.stringify(j);
    throw new Error(`SumUp API (${res.status}): ${msg}`);
  }

  const checkoutId = String(j.id ?? "");
  const hostedCheckoutUrl = String(
    (j.hosted_checkout_url as string | undefined) ||
      ((j.hosted_checkout as { url?: string } | undefined)?.url) ||
      ""
  );
  if (!hostedCheckoutUrl) {
    throw new Error("SumUp: Antwort ohne hosted_checkout_url – prüfen Sie API-Version und Konto.");
  }
  return { checkoutId, hostedCheckoutUrl };
}

export async function getSumUpCheckout(params: {
  apiKey: string;
  checkoutId: string;
}): Promise<SumUpCheckoutResource> {
  const res = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(params.checkoutId)}`, {
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
    const msg = detail ?? title ?? JSON.stringify(j);
    throw new Error(`SumUp GET checkout (${res.status}): ${msg}`);
  }
  return j as SumUpCheckoutResource;
}
