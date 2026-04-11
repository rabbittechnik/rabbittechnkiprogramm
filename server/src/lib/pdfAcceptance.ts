import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type Database from "better-sqlite3";
import { formatVorschaeden } from "./mail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseDataUrlImage(
  dataUrl: string | null | undefined
): { kind: "png" | "jpg"; bytes: Uint8Array } | null {
  if (!dataUrl?.startsWith("data:")) return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase() === "png" ? "png" : "jpg";
  const buf = Buffer.from(m[2], "base64");
  return { kind, bytes: new Uint8Array(buf) };
}

/** Auftragsbestätigung inkl. Unterschrift (PNG/JPEG aus Data-URL) für Kunden-E-Mail und Archiv. */
export async function writeAcceptancePdf(db: Database.Database, repairId: string): Promise<string> {
  const row = db
    .prepare(
      `SELECT r.*, c.name AS customer_name, c.email, c.phone, c.address,
              d.device_type, d.brand, d.model, d.serial_number,
              s.image_data_url AS sig_row_url
       FROM repairs r
       JOIN customers c ON c.id = r.customer_id
       JOIN devices d ON d.id = r.device_id
       LEFT JOIN signatures s ON s.repair_id = r.id
       WHERE r.id = ?`
    )
    .get(repairId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Repair not found");

  const services = db
    .prepare(
      `SELECT s.name, rs.price_cents FROM repair_services rs
       JOIN services s ON s.id = rs.service_id WHERE rs.repair_id = ?`
    )
    .all(repairId) as { name: string; price_cents: number }[];

  const sigUrl = (row.signature_data_url as string | null) || (row.sig_row_url as string | null);
  const img = parseDataUrlImage(sigUrl);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = page.getSize().height - 48;
  const left = 48;
  const line = 13;
  const maxW = page.getSize().width - left * 2;

  const draw = (text: string, size = 10, bold = false) => {
    page.drawText(text, { x: left, y, size, font: bold ? fontBold : font, color: rgb(0.1, 0.1, 0.12) });
    y -= line;
  };

  const drawWrapped = (label: string, body: string, size = 9) => {
    draw(label, 10, true);
    y -= 2;
    const words = body.split(/\s+/);
    let lineBuf = "";
    for (const w of words) {
      const test = lineBuf ? `${lineBuf} ${w}` : w;
      const wTest = font.widthOfTextAtSize(test, size);
      if (wTest > maxW && lineBuf) {
        page.drawText(lineBuf, { x: left, y, size, font, color: rgb(0.2, 0.2, 0.22) });
        y -= line - 1;
        lineBuf = w;
      } else {
        lineBuf = test;
      }
    }
    if (lineBuf) {
      page.drawText(lineBuf, { x: left, y, size, font, color: rgb(0.2, 0.2, 0.22) });
      y -= line;
    }
    y -= 6;
  };

  draw("Rabbit-Technik – Auftragsbestätigung / Annahme", 16, true);
  y -= 4;
  draw(`Tracking: ${String(row.tracking_code)}`);
  draw(`Datum: ${new Date().toLocaleString("de-DE")}`);
  y -= 8;
  draw("Kundendaten", 12, true);
  draw(`${String(row.customer_name)}`);
  if (row.email) draw(String(row.email));
  if (row.phone) draw(String(row.phone));
  if (row.address) draw(String(row.address));
  y -= 8;
  draw("Gerät", 12, true);
  draw(`${row.device_type} – ${row.brand ?? ""} ${row.model ?? ""}`.trim());
  if (row.serial_number) draw(`SN: ${String(row.serial_number)}`);
  y -= 8;
  if (row.problem_label) draw(`Anliegen: ${String(row.problem_label)}`);
  if (row.description) drawWrapped("Beschreibung:", String(row.description));
  if (row.accessories) drawWrapped("Zubehör:", String(row.accessories));
  drawWrapped("Vorschäden:", formatVorschaeden(row.pre_damage_notes as string | null));
  y -= 4;
  draw("Vorgesehene Leistungen", 12, true);
  for (const s of services) {
    draw(`• ${s.name} … ${(s.price_cents / 100).toFixed(2)} €`);
  }
  y -= 6;
  draw(`Voraussichtliche Summe: ${(Number(row.total_cents) / 100).toFixed(2)} €`, 11, true);
  y -= 10;
  if (row.legal_consent_at) {
    draw(`Einwilligung / Hinweise bestätigt am: ${String(row.legal_consent_at)}`, 9);
    y -= 6;
  }

  y -= 8;
  draw("Kundenunterschrift", 12, true);
  y -= 4;

  const sigBoxH = 100;
  const sigBoxW = 280;
  if (y < sigBoxH + 80) {
    page = pdf.addPage([595, 842]);
    y = page.getSize().height - 60;
    draw("Kundenunterschrift (Fortsetzung)", 12, true);
    y -= 4;
  }

  if (img) {
    try {
      const embedded =
        img.kind === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
      const scale = Math.min(sigBoxW / embedded.width, sigBoxH / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      page.drawRectangle({
        x: left,
        y: y - h - 4,
        width: sigBoxW + 8,
        height: h + 8,
        borderColor: rgb(0.4, 0.4, 0.45),
        borderWidth: 0.5,
      });
      page.drawImage(embedded, { x: left + 4, y: y - h, width: w, height: h });
      y -= h + 24;
    } catch {
      draw("(Unterschrift konnte nicht eingebettet werden.)", 9);
      y -= line;
    }
  } else {
    draw("Keine Unterschrift erfasst.", 9);
    y -= line;
  }

  y -= 8;
  draw("Dieses Dokument entspricht der Annahme am Service-Terminal.", 8);

  const safeTracking = String(row.tracking_code).replace(/[^a-zA-Z0-9_-]/g, "_");
  const pdfDir = path.join(__dirname, "../../data/acceptance");
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  const filePath = path.join(pdfDir, `Annahme-${safeTracking}.pdf`);
  fs.writeFileSync(filePath, await pdf.save());
  return filePath;
}
