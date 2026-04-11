import type Database from "better-sqlite3";
import { getSumUpCheckout, type SumUpCheckoutResource } from "./sumupCheckout.js";
import { writeInvoicePdf } from "./pdfInvoice.js";

export type RepairRowLite = {
  id: string;
  status: string;
  total_cents: number;
  payment_status: string;
  payment_method: string | null;
  sumup_checkout_id: string | null;
};

function getSumUpKeys(): { apiKey: string } | null {
  const apiKey = process.env.RABBIT_SUMUP_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey };
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
      `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id FROM repairs WHERE sumup_checkout_id = ?`
    )
    .get(checkoutId) as RepairRowLite | undefined;

  if (!repair && ref) {
    repair = db
      .prepare(
        `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id FROM repairs WHERE id = ?`
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

export async function syncRepairPaymentFromSumUp(
  db: Database.Database,
  repairId: string
): Promise<{ updated: boolean; checkout_status?: string; repair?: unknown }> {
  const keys = getSumUpKeys();
  const repair = db
    .prepare(
      `SELECT id, status, total_cents, payment_status, payment_method, sumup_checkout_id FROM repairs WHERE id = ?`
    )
    .get(repairId) as RepairRowLite | null | undefined;

  if (!repair?.sumup_checkout_id) {
    return { updated: false };
  }
  if (repair.payment_status === "bezahlt") {
    return { updated: false, repair: db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(repairId) };
  }
  if (!keys) {
    return { updated: false, checkout_status: "NO_API_KEY" };
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
