import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type Database from "better-sqlite3";
import { formatVorschaeden } from "./mail.js";
import { acceptanceDir } from "./dataPaths.js";
import { formatDeBerlin } from "./formatBerlin.js";
import { SIGNATURE_PAD_BG, signatureDrawSize } from "./pdfSignatureBox.js";

const W = 595;
const H = 842;
const M = 48;
const CONTENT_W = W - M * 2;
/** Dunkler Kopf: genug Platz für 22pt-Titel + Cap-Höhe (pdf-lib: y = Baseline). */
const HEADER_H = 128;

const COL = {
  headerBg: rgb(0.04, 0.07, 0.13),
  headerStripe: rgb(0, 0.83, 1),
  title: rgb(0.95, 0.97, 1),
  subtitle: rgb(0.55, 0.65, 0.78),
  accent: rgb(0, 0.83, 1),
  lime: rgb(0.22, 0.95, 0.2),
  text: rgb(0.12, 0.14, 0.18),
  muted: rgb(0.38, 0.42, 0.48),
  boxBg: rgb(0.94, 0.97, 1),
  boxBorder: rgb(0.65, 0.78, 0.92),
  sigFrame: rgb(0.45, 0.55, 0.65),
};

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

/** Auftragsbestätigung (Design wie Kunden-E-Mail / Rechnung-PDF). */
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
  let page = pdf.addPage([W, H]);
  let y = H - 36;

  const line = (text: string, size: number, o: { bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; dy?: number } = {}) => {
    const x = o.x ?? M;
    const c = o.color ?? COL.text;
    const f = o.bold ? fontBold : font;
    page.drawText(text, { x, y, size, font: f, color: c });
    y -= size + (o.dy ?? 4);
  };

  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: COL.headerBg });
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: COL.headerStripe });

  line("AUFTRAGSBESTÄTIGUNG", 9, { color: COL.subtitle, dy: 5 });
  y -= 2;
  line("Rabbit-Technik", 22, { bold: true, color: COL.title, dy: 7 });
  line(`Tracking: ${String(row.tracking_code)}`, 11, { bold: true, color: COL.accent, dy: 5 });

  y = H - HEADER_H - 22;
  const aufnahme = formatDeBerlin(String(row.created_at ?? ""), { dateStyle: "long", timeStyle: "short" });
  line(`Aufnahme (Werkstattzeit Deutschland): ${aufnahme}`, 10, { color: COL.text, dy: 6 });
  y -= 10;

  const metaLines = [
    `Kunde: ${String(row.customer_name)}`,
    row.email ? String(row.email) : "",
    row.phone ? String(row.phone) : "",
    row.address ? String(row.address) : "",
  ].filter(Boolean);
  const pad = 12;
  const metaH = pad * 2 + metaLines.length * 14 + 6;
  page.drawRectangle({
    x: M - 4,
    y: y - metaH,
    width: CONTENT_W + 8,
    height: metaH,
    color: COL.boxBg,
    borderColor: COL.boxBorder,
    borderWidth: 0.8,
  });
  y -= pad;
  for (const ml of metaLines) line(ml, 10, { color: COL.text, dy: 3 });
  y -= pad + 14;

  const sectionTitle = (t: string) => {
    line(t.toUpperCase(), 9, { bold: true, color: COL.accent, dy: 6 });
    y -= 4;
  };

  sectionTitle("Gerät");
  line(`${row.device_type} – ${row.brand ?? ""} ${row.model ?? ""}`.trim(), 10, { dy: 3 });
  if (row.serial_number) line(`SN: ${String(row.serial_number)}`, 10, { dy: 3 });
  y -= 8;

  if (row.problem_label) line(`Anliegen: ${String(row.problem_label)}`, 10, { dy: 3 });

  const drawWrapped = (label: string, body: string, size = 9) => {
    line(label, 10, { bold: true, color: COL.text, dy: 4 });
    y -= 2;
    const words = body.split(/\s+/);
    let lineBuf = "";
    const maxW = CONTENT_W;
    for (const w of words) {
      const test = lineBuf ? `${lineBuf} ${w}` : w;
      const wTest = font.widthOfTextAtSize(test, size);
      if (wTest > maxW && lineBuf) {
        page.drawText(lineBuf, { x: M, y, size, font, color: COL.muted });
        y -= size + 3;
        lineBuf = w;
      } else {
        lineBuf = test;
      }
    }
    if (lineBuf) {
      page.drawText(lineBuf, { x: M, y, size, font, color: COL.muted });
      y -= size + 3;
    }
    y -= 6;
  };

  if (row.description) drawWrapped("Beschreibung:", String(row.description));
  if (row.accessories) drawWrapped("Zubehör:", String(row.accessories));
  drawWrapped("Vorschäden:", formatVorschaeden(row.pre_damage_notes as string | null));

  sectionTitle("Vorgesehene Leistungen");
  for (const s of services) {
    line(`• ${s.name} … ${(s.price_cents / 100).toFixed(2)} €`, 10, { dy: 2 });
  }
  y -= 6;
  line(`Voraussichtliche Summe: ${(Number(row.total_cents) / 100).toFixed(2)} €`, 12, { bold: true, color: COL.accent, dy: 8 });
  y -= 6;

  if (row.legal_consent_at) {
    const consent = formatDeBerlin(String(row.legal_consent_at), { dateStyle: "long", timeStyle: "short" });
    line(`Hinweise / Einwilligung bestätigt: ${consent}`, 9, { color: COL.muted, dy: 4 });
    y -= 4;
  }

  y -= 8;
  line("Kundenunterschrift", 11, { bold: true, color: COL.text, dy: 6 });
  y -= 4;

  const sigBoxH = 100;
  const sigBoxW = 280;
  if (y < sigBoxH + 100) {
    page = pdf.addPage([W, H]);
    y = H - 52;
    line("Kundenunterschrift (Fortsetzung)", 12, { bold: true, color: COL.accent, dy: 8 });
    y -= 6;
  }

  if (img) {
    try {
      const embedded = img.kind === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
      const pad = 8;
      const innerW = sigBoxW - pad * 2;
      const innerH = sigBoxH - pad * 2;
      const { width: w, height: h } = signatureDrawSize(embedded.width, embedded.height, innerW, innerH);
      const boxH = h + pad * 2;
      const boxBottom = y - boxH;
      page.drawRectangle({
        x: M - 2,
        y: boxBottom,
        width: sigBoxW + 12,
        height: boxH,
        borderColor: COL.sigFrame,
        borderWidth: 1,
        color: SIGNATURE_PAD_BG,
      });
      page.drawImage(embedded, { x: M + pad, y: boxBottom + pad, width: w, height: h });
      y = boxBottom - 14;
    } catch {
      line("(Unterschrift konnte nicht eingebettet werden.)", 9, { color: COL.muted });
    }
  } else {
    line("Keine Unterschrift erfasst.", 9, { color: COL.muted });
  }

  y -= 6;
  line("Dieses Dokument entspricht der Annahme am Service-Terminal.", 8, { color: COL.muted, dy: 2 });

  const safeTracking = String(row.tracking_code).replace(/[^a-zA-Z0-9_-]/g, "_");
  const pdfDir = acceptanceDir();
  const filePath = path.join(pdfDir, `Annahme-${safeTracking}.pdf`);
  fs.writeFileSync(filePath, await pdf.save());
  return filePath;
}
