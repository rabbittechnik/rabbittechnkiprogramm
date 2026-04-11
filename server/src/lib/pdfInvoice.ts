import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type Database from "better-sqlite3";

import { invoicesDir } from "./dataPaths.js";

export async function writeInvoicePdf(
  db: Database.Database,
  repairId: string,
  invoiceNumber: string
): Promise<string> {
  const repair = db
    .prepare(
      `SELECT r.*, c.name as customer_name, c.email, c.phone, c.address,
       d.device_type, d.brand, d.model, d.serial_number
       FROM repairs r
       JOIN customers c ON c.id = r.customer_id
       JOIN devices d ON d.id = r.device_id
       WHERE r.id = ?`
    )
    .get(repairId) as Record<string, unknown> | undefined;
  if (!repair) throw new Error("Repair not found");

  const services = db
    .prepare(
      `SELECT s.name, rs.price_cents FROM repair_services rs
       JOIN services s ON s.id = rs.service_id WHERE rs.repair_id = ?`
    )
    .all(repairId) as { name: string; price_cents: number }[];

  const parts = db
    .prepare(`SELECT name, sale_cents FROM repair_parts WHERE repair_id = ?`)
    .all(repairId) as { name: string; sale_cents: number }[];

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  let y = page.getSize().height - 50;
  const left = 50;
  const line = 14;

  const draw = (text: string, size = 11, bold = false) => {
    page.drawText(text, { x: left, y, size, font: bold ? fontBold : font, color: rgb(0.1, 0.1, 0.12) });
    y -= line;
  };

  draw("Rabbit-Technik – Rechnung", 18, true);
  y -= 6;
  draw(`Rechnungsnr. ${invoiceNumber}`);
  draw(`Datum: ${new Date().toLocaleDateString("de-DE")}`);
  y -= 10;
  draw(`Kunde: ${String(repair.customer_name)}`, 12, true);
  if (repair.email) draw(String(repair.email));
  if (repair.phone) draw(String(repair.phone));
  y -= 10;
  draw("Auftrag / Gerät", 12, true);
  draw(`Tracking: ${String(repair.tracking_code)}`);
  draw(`${repair.device_type} – ${repair.brand ?? ""} ${repair.model ?? ""}`.trim());
  y -= 10;
  draw("Positionen", 12, true);
  for (const s of services) {
    draw(`Leistung: ${s.name} … ${(s.price_cents / 100).toFixed(2)} €`);
  }
  for (const p of parts) {
    draw(`Ersatzteil: ${p.name} … ${(p.sale_cents / 100).toFixed(2)} €`);
  }
  y -= 8;
  const total = Number(repair.total_cents);
  draw(`Gesamt: ${(total / 100).toFixed(2)} €`, 13, true);
  y -= 20;
  draw(`Zahlungsstatus: ${String(repair.payment_status)}`);

  const pdfDir = invoicesDir();
  const filePath = path.join(pdfDir, `${invoiceNumber}.pdf`);
  fs.writeFileSync(filePath, await pdf.save());
  return filePath;
}
