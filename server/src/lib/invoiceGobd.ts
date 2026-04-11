import crypto from "node:crypto";
import fs from "node:fs";
import type Database from "better-sqlite3";
import { writeInvoicePdf } from "./pdfInvoice.js";

export type InvoiceRow = {
  id: string;
  repair_id: string;
  invoice_number: string;
  pdf_path: string | null;
  total_cents: number;
  payment_status: string;
  created_at: string;
  document_status: string;
  document_kind: string;
  finalized_at: string | null;
  retention_until: string | null;
  pdf_sha256: string | null;
  references_invoice_id: string | null;
};

export function sha256File(filePath: string): string {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex");
}

/** Letzte Ausgangsrechnung je Auftrag (nur document_kind = rechnung). */
export function getPrimaryRechnung(db: Database.Database, repairId: string): InvoiceRow | undefined {
  return db
    .prepare(
      `SELECT * FROM invoices WHERE repair_id = ? AND document_kind = 'rechnung'
       ORDER BY datetime(created_at) DESC LIMIT 1`
    )
    .get(repairId) as InvoiceRow | undefined;
}

export function getInvoiceById(db: Database.Database, invoiceId: string): InvoiceRow | undefined {
  return db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId) as InvoiceRow | undefined;
}

export function setPrimaryInvoicePaymentStatus(
  db: Database.Database,
  repairId: string,
  paymentStatus: "bezahlt" | "offen"
): void {
  const inv = getPrimaryRechnung(db, repairId);
  if (!inv) return;
  db.prepare(`UPDATE invoices SET payment_status = ? WHERE id = ?`).run(paymentStatus, inv.id);
}

/**
 * Entwurf: PDF darf neu erzeugt werden. Final: nur Zahlungsstatus aus Auftrag übernehmen (kein PDF-Overwrite).
 */
export async function syncPrimaryInvoicePaymentAndPdf(
  db: Database.Database,
  repairId: string
): Promise<void> {
  const inv = getPrimaryRechnung(db, repairId);
  if (!inv) return;
  if (inv.document_status === "final") {
    db.prepare(`UPDATE invoices SET payment_status = (SELECT payment_status FROM repairs WHERE id = ?) WHERE id = ?`).run(
      repairId,
      inv.id
    );
    return;
  }
  const pdfPath = await writeInvoicePdf(db, repairId, inv.invoice_number);
  db.prepare(
    `UPDATE invoices SET pdf_path = ?, payment_status = (SELECT payment_status FROM repairs WHERE id = ?) WHERE id = ?`
  ).run(pdfPath, repairId, inv.id);
}

/** Beim ersten Wechsel auf „fertig“: Rechnung finalisieren (PDF + SHA-256, 10-Jahres-Frist). */
export async function finalizePrimaryRechnungOnFertig(db: Database.Database, repairId: string): Promise<void> {
  const inv = getPrimaryRechnung(db, repairId);
  if (!inv || inv.document_status !== "entwurf" || inv.document_kind !== "rechnung") return;
  const pdfPath = await writeInvoicePdf(db, repairId, inv.invoice_number);
  const hash = sha256File(pdfPath);
  db.prepare(
    `UPDATE invoices SET
        pdf_path = ?,
        pdf_sha256 = ?,
        document_status = 'final',
        finalized_at = datetime('now'),
        retention_until = datetime('now', '+10 years'),
        payment_status = (SELECT payment_status FROM repairs WHERE id = ?)
     WHERE id = ?`
  ).run(pdfPath, hash, repairId, inv.id);
}

export function hasStornoForInvoice(db: Database.Database, invoiceId: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS o FROM invoices WHERE references_invoice_id = ? AND document_kind = 'storno' LIMIT 1`)
    .get(invoiceId) as { o: number } | undefined;
  return !!row;
}
