import type Database from "better-sqlite3";
import { getSumUpCheckout, type SumUpCheckoutResource } from "./sumupCheckout.js";
import { getSumUpTransaction, isSumUpTransactionPaid, type SumUpTransactionResource } from "./sumupTransaction.js";
import { writeInvoicePdf } from "./pdfInvoice.js";

export type RepairRowLite = {
  id: string;
  status: string;
  total_cents: number;
  payment_status: string;
  payment_method: string | null;
  sumup_checkout_id: string | null;
  sumup_channel?: string | null;
  sumup_terminal_foreign_id?: string | null;
  sumup_terminal_client_transaction_id?: string | null;
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

async function regenerateInvoicePdf(db: Database.Database, repairId: string): Promise<void> {
  const inv = db.prepare(`SELECT invoice_number FROM invoices WHERE repair_id = ?`).get(repairId) as
    | { invoice_number: string }
    | undefined;
  if (!inv) return;
  const pdfPath = await writeInvoicePdf(db, repairId, inv.invoice_number);
  db.prepare(`UPDATE invoices SET pdf_path = ?, payment_status = (SELECT payment_status FROM repairs WHERE id = ?) WHERE repair_id = ?`).run(
    pdfPath,
    repairId,
    repairId
  );
}

function amountMatchesRepair(checkout: SumUpCheckoutResource, repair: RepairRowLite): boolean {
  const expected = Math.max(0.01, repair.total_cents / 100);
  const got = typeof checkout.amount === "number" ? checkout.amount : Number(checkout.amount);
  if (!Number.isFinite(got)) return false;
  return Math.abs(got - expected) < 0.02;
}

function amountMatchesTerminalTxn(txn: SumUpTransactionResource, repair: RepairRowLite): boolean {
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

export function extractTerminalForeignTransactionIdFromWebhook(body: unknown): string | null {
  return extractWebhookString(body, ["foreign_transaction_id", "foreignTransactionId"]);
}

export function extractTerminalClientTransactionIdFromWebhook(body: unknown): string | null {
  return extractWebhookString(body, ["client_transaction_id", "clientTransactionId"]);
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

  db.prepare(`UPDATE invoices SET payment_status = 'bezahlt' WHERE repair_id = ?`).run(repair.id);
  try {
    await regenerateInvoicePdf(db, repair.id);
  } catch (e) {
    console.error("[sumup paid] Rechnung-PDF konnte nicht neu erzeugt werden:", e);
  }

  return { applied: true, repair_id: repair.id };
}

/**
 * Terminal-/Reader-Zahlung: Status aus Transactions-API (foreign_transaction_id).
 */
export async function applySumUpPaidTerminalTransaction(
  db: Database.Database,
  txn: SumUpTransactionResource
): Promise<{ applied: boolean; repair_id?: string; reason?: string }> {
  if (!isSumUpTransactionPaid(txn)) {
    return { applied: false, reason: "transaction_not_successful" };
  }

  const foreign = String(txn.foreign_transaction_id ?? "").trim();
  const client = String(txn.client_transaction_id ?? "").trim();

  let repair = foreign
    ? (db
        .prepare(
          `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel, sumup_terminal_foreign_id, sumup_terminal_client_transaction_id
           FROM repairs WHERE sumup_terminal_foreign_id = ?`
        )
        .get(foreign) as RepairRowLite | undefined)
    : undefined;

  if (!repair && client) {
    repair = db
      .prepare(
        `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel, sumup_terminal_foreign_id, sumup_terminal_client_transaction_id
         FROM repairs WHERE sumup_terminal_client_transaction_id = ?`
      )
      .get(client) as RepairRowLite | undefined;
  }

  if (!repair) {
    return { applied: false, reason: "repair_not_found" };
  }

  if (!amountMatchesTerminalTxn(txn, repair)) {
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
       sumup_channel = 'terminal',
       payment_paid_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(newStatus, repair.id);

  db.prepare(`UPDATE invoices SET payment_status = 'bezahlt' WHERE repair_id = ?`).run(repair.id);
  try {
    await regenerateInvoicePdf(db, repair.id);
  } catch (e) {
    console.error("[sumup paid] Rechnung-PDF konnte nicht neu erzeugt werden:", e);
  }

  return { applied: true, repair_id: repair.id };
}

export async function syncPaymentFromSumUpTerminalForeignId(
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

  const result = await applySumUpPaidTerminalTransaction(db, txn);
  const st = String(txn.status ?? txn.simple_status ?? "");
  return {
    updated: result.applied,
    txn_status: st || undefined,
    repair_id: result.repair_id,
  };
}

export async function syncPaymentFromSumUpTerminalClientId(
  db: Database.Database,
  clientTransactionId: string
): Promise<{ updated: boolean; txn_status?: string; repair_id?: string }> {
  const keys = getSumUpKeys();
  if (!keys) {
    return { updated: false, txn_status: "NO_API_KEY" };
  }
  const cid = clientTransactionId.trim();
  if (!cid) return { updated: false, txn_status: "NO_ID" };

  let txn: SumUpTransactionResource;
  try {
    txn = await getSumUpTransaction({
      apiKey: keys.apiKey,
      merchantCode: keys.merchantCode,
      clientTransactionId: cid,
    });
  } catch {
    return { updated: false, txn_status: "FETCH_ERROR" };
  }

  const result = await applySumUpPaidTerminalTransaction(db, txn);
  const st = String(txn.status ?? txn.simple_status ?? "");
  return {
    updated: result.applied,
    txn_status: st || undefined,
    repair_id: result.repair_id,
  };
}

/** SumUp POST /webhook/sumup: Online-Checkout und Reader-return_url. */
export async function processSumUpWebhookPayload(db: Database.Database, body: unknown): Promise<void> {
  const o = body as { event_type?: string; id?: string };
  const et = String(o?.event_type ?? "");
  const checkoutId = String(o?.id ?? "").trim();

  if (et === "CHECKOUT_STATUS_CHANGED" && checkoutId) {
    await syncPaymentFromSumUpCheckoutId(db, checkoutId);
    return;
  }

  const foreign = extractTerminalForeignTransactionIdFromWebhook(body);
  if (foreign) {
    await syncPaymentFromSumUpTerminalForeignId(db, foreign);
    return;
  }

  const client = extractTerminalClientTransactionIdFromWebhook(body);
  if (client) {
    await syncPaymentFromSumUpTerminalClientId(db, client);
  }
}

export async function syncRepairPaymentFromSumUp(
  db: Database.Database,
  repairId: string
): Promise<{ updated: boolean; checkout_status?: string; repair?: unknown }> {
  const keys = getSumUpKeys();
  const repair = db
    .prepare(
      `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id, sumup_channel, sumup_terminal_foreign_id, sumup_terminal_client_transaction_id
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

  if (repair.sumup_channel === "terminal" && repair.sumup_terminal_foreign_id) {
    try {
      const txn = await getSumUpTransaction({
        apiKey: keys.apiKey,
        merchantCode: keys.merchantCode,
        foreignTransactionId: repair.sumup_terminal_foreign_id,
      });
      const result = await applySumUpPaidTerminalTransaction(db, txn);
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
): Promise<{ updated: boolean; checkout_status?: string; repair_id?: string }> {
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
  return {
    updated: result.applied,
    checkout_status: checkout.status,
    repair_id: result.repair_id,
  };
}
