import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { writeNetworkInvoicePdf, sha256File } from "./pdfNetworkOrder.js";
import { sendNetworkInvoiceEmail } from "./networkMail.js";

/** Rechnung erzeugen + finalisieren (GoBD-Pfad wie Pickup bar/Überweisung/SumUp). */
export async function finalizeNetworkOrderInvoice(db: Database.Database, orderId: string): Promise<void> {
  const invNo = `NW-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${nanoid(6).toUpperCase()}`;
  db.prepare(`UPDATE network_orders SET invoice_number = ? WHERE id = ? AND invoice_number IS NULL`).run(invNo, orderId);
  const pdfPath = await writeNetworkInvoicePdf(db, orderId);
  const hash = sha256File(pdfPath);
  db.prepare(
    `UPDATE network_orders SET invoice_pdf_path = ?, invoice_pdf_sha256 = ?, invoice_finalized_at = datetime('now') WHERE id = ?`
  ).run(pdfPath, hash, orderId);
  void sendNetworkInvoiceEmail(db, orderId, pdfPath).catch((e) => console.error("[network-mail]", e));
}
