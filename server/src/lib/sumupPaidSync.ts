import type Database from "better-sqlite3";
import { getSumUpCheckout, type SumUpCheckoutResource } from "./sumupCheckout.js";
import { getSumUpTransaction, isSumUpTransactionPaid, type SumUpTransactionResource } from "./sumupTransaction.js";
import { syncPrimaryInvoicePaymentAndPdf } from "./invoiceGobd.js";
import { finalizeNetworkOrderInvoice } from "./networkOrderFinalize.js";

export type RepairRowLite = {
  id: string;
  status: string;
  total_cents: number;
  payment_status: string;
  payment_method: string | null;
  sumup_checkout_id: string | null;
  sumup_channel?: string | null;
  /** Payment Switch foreign-tx-id (Tap to Pay / SumUp-App). */
  sumup_foreign_tx_id?: string | null;
  /** @deprecated Nur Legacy-Reader-Zeilen; Abgleich über sumup_foreign_tx_id bevorzugen. */
  sumup_terminal_foreign_id?: string | null;
};

function getSumUpApiKey(): string | null {
  return process.env.RABBIT_SUMUP_API_KEY?.trim() || null;
}

function getSumUpKeys(): { apiKey: string; merchantCode: string } | null {
  const apiKey = getSumUpApiKey();
  const merchantCode = process.env.RABBIT_SUMUP_MERCHANT_CODE?.trim();
  if (!apiKey || !merchantCode) return null;
  return { apiKey, merchantCode };
}

function amountMatchesRepair(checkout: SumUpCheckoutResource, repair: RepairRowLite): boolean {
  const expected = Math.max(0.01, repair.total_cents / 100);
  const got = typeof checkout.amount === "number" ? checkout.amount : Number(checkout.amount);
  if (!Number.isFinite(got)) return false;
  return Math.abs(got - expected) < 0.02;
}

function amountMatchesAppTxn(txn: SumUpTransactionResource, repair: RepairRowLite): boolean {
  const expected = Math.max(0.01, repair.total_cents / 100);
  const got = typeof txn.amount === "number" ? txn.amount : Number(txn.amount);
  if (!Number.isFinite(got)) return false;
  return Math.abs(got - expected) < 0.02;
}

function extractWebhookString(body: unknown, keys: string[]): string | null {
  if (!body || typeof body !== "object") return null;
  const walk = (o: Record<string, unknown>): string | null => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const top = walk(body as Record<string, unknown>);
  if (top) return top;
  for (const nest of ["data", "transaction", "payload"]) {
    const inner = (body as Record<string, unknown>)[nest];
    if (inner && typeof inner === "object") {
      const w = walk(inner as Record<string, unknown>);
      if (w) return w;
    }
  }
  return null;
}

export function extractForeignTransactionIdFromWebhook(body: unknown): string | null {
  return extractWebhookString(body, [
    "foreign_transaction_id",
    "foreignTransactionId",
    "foreign-tx-id",
    "foreign_tx_id",
  ]);
}

/**
 * Markiert Auftrag + Rechnung als mit SumUp bezahlt (nur wenn Checkout wirklich PAID ist).
 * Idempotent: bereits bezahlt → kein Fehler, kein erneutes PDF nötig.
 */
export async function applySumUpPaidCheckout(
  db: Database.Database,
  checkout: SumUpCheckoutResource
): Promise<{ applied: boolean; repair_id?: string; reason?: string }> {
  const st = String(checkout.status ?? "").toUpperCase();
  if (st !== "PAID") {
    return { applied: false, reason: `checkout_status_${st || "unknown"}` };
  }

  const checkoutId = String(checkout.id ?? "");
  const ref = String(checkout.checkout_reference ?? "").trim();

  let repair = db
    .prepare(
      `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel FROM repairs WHERE sumup_checkout_id = ?`
    )
    .get(checkoutId) as RepairRowLite | undefined;

  if (!repair && ref) {
    repair = db
      .prepare(
        `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel FROM repairs WHERE id = ?`
      )
      .get(ref) as RepairRowLite | undefined;
    if (repair && repair.sumup_checkout_id && repair.sumup_checkout_id !== checkoutId) {
      return { applied: false, reason: "repair_reference_mismatch" };
    }
  }

  if (!repair) {
    return { applied: false, reason: "repair_not_found" };
  }

  if (!amountMatchesRepair(checkout, repair)) {
    return { applied: false, reason: "amount_mismatch" };
  }

  if (repair.payment_status === "bezahlt") {
    return { applied: false, repair_id: repair.id, reason: "already_paid" };
  }

  const newStatus = repair.status === "fertig" ? "abgeholt" : repair.status;

  db.prepare(
    `UPDATE repairs SET
       status = ?,
       payment_status = 'bezahlt',
       payment_method = 'sumup',
       sumup_channel = COALESCE(sumup_channel, 'online'),
       payment_paid_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(newStatus, repair.id);

  try {
    await syncPrimaryInvoicePaymentAndPdf(db, repair.id);
  } catch (e) {
    console.error("[sumup paid] Rechnung-PDF konnte nicht neu erzeugt werden:", e);
  }

  return { applied: true, repair_id: repair.id };
}

/**
 * Tap to Pay / Payment Switch (SumUp-App): Status aus Transactions-API (foreign_transaction_id).
 */
export async function applySumUpPaidTapToPayTransaction(
  db: Database.Database,
  txn: SumUpTransactionResource
): Promise<{ applied: boolean; repair_id?: string; reason?: string }> {
  if (!isSumUpTransactionPaid(txn)) {
    return { applied: false, reason: "transaction_not_successful" };
  }

  const foreign = String(txn.foreign_transaction_id ?? "").trim();
  if (!foreign) {
    return { applied: false, reason: "no_foreign_id_in_txn" };
  }

  const repair = db
    .prepare(
      `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel, sumup_foreign_tx_id, sumup_terminal_foreign_id
       FROM repairs WHERE sumup_foreign_tx_id = ? OR sumup_terminal_foreign_id = ?`
    )
    .get(foreign, foreign) as RepairRowLite | undefined;

  if (!repair) {
    return { applied: false, reason: "repair_not_found" };
  }

  if (!amountMatchesAppTxn(txn, repair)) {
    return { applied: false, reason: "amount_mismatch" };
  }

  if (repair.payment_status === "bezahlt") {
    return { applied: false, repair_id: repair.id, reason: "already_paid" };
  }

  const newStatus = repair.status === "fertig" ? "abgeholt" : repair.status;

  db.prepare(
    `UPDATE repairs SET
       status = ?,
       payment_status = 'bezahlt',
       payment_method = 'sumup',
       sumup_channel = 'tap_to_pay',
       payment_paid_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(newStatus, repair.id);

  try {
    await syncPrimaryInvoicePaymentAndPdf(db, repair.id);
  } catch (e) {
    console.error("[sumup paid] Rechnung-PDF konnte nicht neu erzeugt werden:", e);
  }

  return { applied: true, repair_id: repair.id };
}

export async function syncPaymentFromSumUpForeignTxId(
  db: Database.Database,
  foreignTransactionId: string
): Promise<{ updated: boolean; txn_status?: string; repair_id?: string }> {
  const keys = getSumUpKeys();
  if (!keys) {
    return { updated: false, txn_status: "NO_API_KEY" };
  }
  const ft = foreignTransactionId.trim();
  if (!ft) return { updated: false, txn_status: "NO_ID" };

  let txn: SumUpTransactionResource;
  try {
    txn = await getSumUpTransaction({
      apiKey: keys.apiKey,
      merchantCode: keys.merchantCode,
      foreignTransactionId: ft,
    });
  } catch {
    return { updated: false, txn_status: "FETCH_ERROR" };
  }

  const result = await applySumUpPaidTapToPayTransaction(db, txn);
  const st = String(txn.status ?? txn.simple_status ?? "");
  return {
    updated: result.applied,
    txn_status: st || undefined,
    repair_id: result.repair_id,
  };
}

/** SumUp POST /webhook/sumup: Online-Checkout; optionale Payloads mit foreign_transaction_id (App / Tap to Pay). */
export async function processSumUpWebhookPayload(db: Database.Database, body: unknown): Promise<void> {
  const o = body as { event_type?: string; id?: string };
  const et = String(o?.event_type ?? "");
  const checkoutId = String(o?.id ?? "").trim();

  if (et === "CHECKOUT_STATUS_CHANGED" && checkoutId) {
    await syncPaymentFromSumUpCheckoutId(db, checkoutId);
    return;
  }

  const foreign = extractForeignTransactionIdFromWebhook(body);
  if (foreign) {
    await syncPaymentFromSumUpForeignTxId(db, foreign);
  }
}

export async function syncRepairPaymentFromSumUp(
  db: Database.Database,
  repairId: string
): Promise<{ updated: boolean; checkout_status?: string; repair?: unknown }> {
  const keys = getSumUpKeys();
  const repair = db
    .prepare(
      `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel, sumup_foreign_tx_id, sumup_terminal_foreign_id
       FROM repairs WHERE id = ?`
    )
    .get(repairId) as RepairRowLite | null | undefined;

  if (!repair) {
    return { updated: false };
  }
  if (repair.payment_status === "bezahlt") {
    return { updated: false, repair: db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(repairId) };
  }
  if (!keys) {
    return { updated: false, checkout_status: "NO_API_KEY" };
  }

  const appForeign =
    String(repair.sumup_foreign_tx_id ?? "").trim() || String(repair.sumup_terminal_foreign_id ?? "").trim();
  const tapChannel = repair.sumup_channel === "tap_to_pay" || repair.sumup_channel === "terminal";

  if (tapChannel && appForeign) {
    try {
      const txn = await getSumUpTransaction({
        apiKey: keys.apiKey,
        merchantCode: keys.merchantCode,
        foreignTransactionId: appForeign,
      });
      const result = await applySumUpPaidTapToPayTransaction(db, txn);
      const full = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(repairId);
      const st = String(txn.status ?? txn.simple_status ?? "");
      if (result.applied) {
        return { updated: true, checkout_status: st || "SUCCESSFUL", repair: full };
      }
      return { updated: false, checkout_status: st || undefined, repair: full };
    } catch {
      return { updated: false, checkout_status: "ERROR" };
    }
  }

  if (!repair.sumup_checkout_id) {
    return { updated: false };
  }

  try {
    const checkout = await getSumUpCheckout({ apiKey: keys.apiKey, checkoutId: repair.sumup_checkout_id });
    const result = await applySumUpPaidCheckout(db, checkout);
    const full = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(repairId);
    if (result.applied) {
      return { updated: true, checkout_status: checkout.status, repair: full };
    }
    return { updated: false, checkout_status: checkout.status, repair: full };
  } catch {
    return { updated: false, checkout_status: "ERROR" };
  }
}

export async function syncPaymentFromSumUpCheckoutId(
  db: Database.Database,
  checkoutId: string
): Promise<{ updated: boolean; checkout_status?: string; repair_id?: string; network_order_id?: string }> {
  const keys = getSumUpKeys();
  if (!keys) {
    return { updated: false, checkout_status: "NO_API_KEY" };
  }
  let checkout: SumUpCheckoutResource;
  try {
    checkout = await getSumUpCheckout({ apiKey: keys.apiKey, checkoutId });
  } catch {
    return { updated: false, checkout_status: "FETCH_ERROR" };
  }
  const result = await applySumUpPaidCheckout(db, checkout);
  if (result.applied) {
    return {
      updated: true,
      checkout_status: checkout.status,
      repair_id: result.repair_id,
    };
  }
  const nw = await applySumUpPaidNetworkCheckout(db, checkout);
  return {
    updated: nw.applied,
    checkout_status: checkout.status,
    repair_id: result.repair_id,
    network_order_id: nw.network_order_id,
  };
}

type NetworkOrderCheckoutRow = {
  id: string;
  status: string;
  grand_total_cents: number;
  payment_status: string;
  sumup_checkout_id: string | null;
};

function amountMatchesNetworkOrder(checkout: SumUpCheckoutResource, order: NetworkOrderCheckoutRow): boolean {
  const expected = Math.max(0.01, order.grand_total_cents / 100);
  const got = typeof checkout.amount === "number" ? checkout.amount : Number(checkout.amount);
  if (!Number.isFinite(got)) return false;
  return Math.abs(got - expected) < 0.02;
}

/**
 * SumUp Hosted Checkout für Netzwerk-Auftrag (checkout_reference nw-…).
 * Wird von Webhooks / manuellem sumup-sync genutzt.
 */
export async function applySumUpPaidNetworkCheckout(
  db: Database.Database,
  checkout: SumUpCheckoutResource
): Promise<{ applied: boolean; network_order_id?: string; reason?: string }> {
  const st = String(checkout.status ?? "").toUpperCase();
  if (st !== "PAID") {
    return { applied: false, reason: `checkout_status_${st || "unknown"}` };
  }
  const checkoutId = String(checkout.id ?? "");
  const order = db
    .prepare(
      `SELECT id, status, grand_total_cents, payment_status, sumup_checkout_id FROM network_orders WHERE sumup_checkout_id = ?`
    )
    .get(checkoutId) as NetworkOrderCheckoutRow | undefined;

  if (!order) {
    return { applied: false, reason: "network_order_not_found" };
  }
  if (order.payment_status === "bezahlt") {
    return { applied: false, network_order_id: order.id, reason: "already_paid" };
  }
  if (!amountMatchesNetworkOrder(checkout, order)) {
    return { applied: false, reason: "amount_mismatch" };
  }
  if (order.status !== "geliefert") {
    return { applied: false, reason: `wrong_status_${order.status}` };
  }

  db.prepare(
    `UPDATE network_orders SET
       status = 'uebergeben',
       payment_status = 'bezahlt',
       payment_method = 'sumup',
       sumup_channel = COALESCE(sumup_channel, 'online'),
       payment_paid_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(order.id);

  try {
    await finalizeNetworkOrderInvoice(db, order.id);
  } catch (e) {
    console.error("[network-invoice] finalize after SumUp", e);
  }

  return { applied: true, network_order_id: order.id };
}

/** Werkstatt: SumUp-Status für Netzwerk-Auftrag nachziehen (Checkout PAID → bezahlt + Rechnung). */
export async function syncNetworkOrderPaymentFromSumUp(
  db: Database.Database,
  orderId: string
): Promise<{ updated: boolean; checkout_status?: string; order?: unknown }> {
  const keys = getSumUpKeys();
  const order = db
    .prepare(
      `SELECT id, status, grand_total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel FROM network_orders WHERE id = ?`
    )
    .get(orderId) as
    | (NetworkOrderCheckoutRow & { payment_method: string | null; sumup_channel: string | null })
    | undefined;

  if (!order) {
    return { updated: false };
  }
  if (order.payment_status === "bezahlt") {
    return { updated: false, order: db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(orderId) };
  }
  if (!keys) {
    return { updated: false, checkout_status: "NO_API_KEY" };
  }
  if (!order.sumup_checkout_id) {
    return { updated: false };
  }
  try {
    const checkout = await getSumUpCheckout({ apiKey: keys.apiKey, checkoutId: order.sumup_checkout_id });
    const result = await applySumUpPaidNetworkCheckout(db, checkout);
    const full = db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(orderId);
    const cst = String(checkout.status ?? "");
    if (result.applied) {
      return { updated: true, checkout_status: cst || "PAID", order: full };
    }
    return { updated: false, checkout_status: cst || undefined, order: full };
  } catch {
    return { updated: false, checkout_status: "ERROR" };
  }
}
