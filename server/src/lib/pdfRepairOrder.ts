import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type Database from "better-sqlite3";
import { formatDeBerlin } from "./formatBerlin.js";
import { statusLabelDe } from "./mail.js";
import { reparaturenLabelsDir, reparaturenPdfsDir } from "./dataPaths.js";

const W = 595;
const H = 842;
const M = 48;
const CONTENT_W = W - M * 2;

const COL = {
  headerBg: rgb(0.04, 0.07, 0.13),
  headerStripe: rgb(0, 0.83, 1),
  title: rgb(0.95, 0.97, 1),
  subtitle: rgb(0.55, 0.65, 0.78),
  accent: rgb(0, 0.83, 1),
  text: rgb(0.12, 0.14, 0.18),
  muted: rgb(0.38, 0.42, 0.48),
  rule: rgb(0.75, 0.8, 0.88),
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

/** Dateiname: Windows-sicher, ohne Pfadtrenner. */
export function safePdfFileStem(customerName: string, maxLen = 80): string {
  const base = customerName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const s = base || "Kunde";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export type RepairOrderPdfPaths = { a4Path: string; labelPath: string };

function wantQrInPdf(): boolean {
  return process.env.RABBIT_REPAIR_ORDER_QR !== "0";
}

async function loadQrPng(trackingUrl: string): Promise<Uint8Array | null> {
  if (!wantQrInPdf() || !trackingUrl) return null;
  try {
    return await QRCode.toBuffer(trackingUrl, { type: "png", width: 132, margin: 1, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

/**
 * Druckfertiges Reparaturauftrags-PDF (A4) + kompakte Etiketten-Version (eigenes PDF).
 * Speicherort: `data/reparaturen/pdfs/` bzw. `data/reparaturen/labels/`.
 */
export async function writeRepairOrderPdfs(
  db: Database.Database,
  repairId: string,
  opts: { trackingUrl: string }
): Promise<RepairOrderPdfPaths> {
  const row = db
    .prepare(
      `SELECT r.*, c.name AS customer_name, c.email, c.phone,
              d.device_type, d.brand, d.model,
              s.image_data_url AS sig_row_url
       FROM repairs r
       JOIN customers c ON c.id = r.customer_id
       JOIN devices d ON d.id = r.device_id
       LEFT JOIN signatures s ON s.repair_id = r.id
       WHERE r.id = ?`
    )
    .get(repairId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Repair not found");

  const orderNo = String(row.repair_order_number ?? "").trim();
  if (!orderNo) throw new Error("repair_order_number fehlt");

  const sigUrl = (row.signature_data_url as string | null) || (row.sig_row_url as string | null);
  const img = parseDataUrlImage(sigUrl);

  const deviceLine = [row.device_type, row.brand, row.model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const fehlerParts = [row.problem_label ? String(row.problem_label) : "", row.description ? String(row.description) : ""]
    .map((x) => x.trim())
    .filter(Boolean);
  const fehler = fehlerParts.length ? fehlerParts.join("\n\n") : "—";

  const statusDe = statusLabelDe(String(row.status ?? ""));
  const kostenvoranschlag = `${(Number(row.total_cents) / 100).toFixed(2).replace(".", ",")} €`;
  const erstellt = formatDeBerlin(String(row.created_at ?? ""), { dateStyle: "long", timeStyle: "short" });
  const generiert = formatDeBerlin(new Date().toISOString(), { dateStyle: "long", timeStyle: "short" });

  const qrPng = await loadQrPng(opts.trackingUrl);

  const drawRule = (page: { drawLine: (o: object) => void }, y: number) => {
    page.drawLine({ start: { x: M, y }, end: { x: M + CONTENT_W, y }, thickness: 0.6, color: COL.rule });
  };

  // ——— A4 ———
  const pdfA4 = await PDFDocument.create();
  const font = await pdfA4.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfA4.embedFont(StandardFonts.HelveticaBold);

  let page = pdfA4.addPage([W, H]);
  let y = H - 52;

  const line = (
    text: string,
    size: number,
    o: { bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; dy?: number } = {}
  ) => {
    const x = o.x ?? M;
    const c = o.color ?? COL.text;
    const f = o.bold ? fontBold : font;
    page.drawText(text, { x, y, size, font: f, color: c });
    y -= size + (o.dy ?? 4);
  };

  page.drawRectangle({ x: 0, y: H - 88, width: W, height: 88, color: COL.headerBg });
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: COL.headerStripe });

  if (qrPng) {
    try {
      const qEmb = await pdfA4.embedPng(qrPng);
      page.drawImage(qEmb, { x: W - M - 72, y: H - 78, width: 72, height: 72 });
    } catch {
      /* optional */
    }
  }

  line("REPARATURAUFTRAG", 9, { color: COL.subtitle, dy: 6 });
  y -= 2;
  line("Rabbit Technik Reparatur System", 11, { bold: true, color: COL.title, dy: 6 });
  y -= 10;

  drawRule(page, y);
  y -= 14;
  line("AUFTRAGSNUMMER:", 9, { bold: true, color: COL.accent, dy: 2 });
  line(`#${orderNo}`, 14, { bold: true, color: COL.text, dy: 6 });
  line(`Tracking: ${String(row.tracking_code)}`, 9, { color: COL.muted, dy: 4 });
  y -= 6;
  drawRule(page, y);
  y -= 14;

  line("KUNDE:", 9, { bold: true, color: COL.accent, dy: 2 });
  line(String(row.customer_name), 11, { bold: true, dy: 4 });
  y -= 2;
  line("KONTAKT:", 9, { bold: true, color: COL.accent, dy: 2 });
  const tel = row.phone ? String(row.phone) : "—";
  const mail = row.email ? String(row.email) : "—";
  line(`Telefon: ${tel}`, 10, { dy: 2 });
  line(`E-Mail: ${mail}`, 10, { dy: 4 });
  y -= 6;
  drawRule(page, y);
  y -= 14;

  line("GERÄT:", 9, { bold: true, color: COL.accent, dy: 2 });
  line(deviceLine || "—", 10, { dy: 6 });
  line("FEHLERBESCHREIBUNG:", 9, { bold: true, color: COL.accent, dy: 2 });
  const words = fehler.split(/\s+/);
  let buf = "";
  const bodySize = 9;
  for (const w of words) {
    const test = buf ? `${buf} ${w}` : w;
    if (font.widthOfTextAtSize(test, bodySize) > CONTENT_W && buf) {
      page.drawText(buf, { x: M, y, size: bodySize, font, color: COL.muted });
      y -= bodySize + 3;
      buf = w;
    } else {
      buf = test;
    }
  }
  if (buf) {
    page.drawText(buf, { x: M, y, size: bodySize, font, color: COL.muted });
    y -= bodySize + 3;
  }
  y -= 8;
  drawRule(page, y);
  y -= 14;

  line("STATUS:", 9, { bold: true, color: COL.accent, dy: 2 });
  line(statusDe, 11, { bold: true, dy: 6 });
  y -= 6;
  drawRule(page, y);
  y -= 14;

  line("KOSTENVORANSCHLAG:", 9, { bold: true, color: COL.accent, dy: 2 });
  line(kostenvoranschlag, 13, { bold: true, color: COL.text, dy: 8 });
  y -= 6;
  drawRule(page, y);
  y -= 14;

  line("UNTERSCHRIFT KUNDE:", 9, { bold: true, color: COL.accent, dy: 4 });
  y -= 4;

  const sigBoxH = 90;
  const sigBoxW = 260;
  if (y < sigBoxH + 120) {
    page = pdfA4.addPage([W, H]);
    y = H - 60;
    line("UNTERSCHRIFT KUNDE (Fortsetzung)", 11, { bold: true, color: COL.accent, dy: 8 });
    y -= 6;
  }

  if (img) {
    try {
      const embedded = img.kind === "png" ? await pdfA4.embedPng(img.bytes) : await pdfA4.embedJpg(img.bytes);
      const scale = Math.min(sigBoxW / embedded.width, sigBoxH / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      page.drawRectangle({
        x: M - 2,
        y: y - h - 10,
        width: sigBoxW + 12,
        height: h + 12,
        borderColor: COL.sigFrame,
        borderWidth: 1,
        color: rgb(0.98, 0.99, 1),
      });
      page.drawImage(embedded, { x: M + 4, y: y - h - 4, width: w, height: h });
      y -= h + 24;
    } catch {
      line("(Unterschrift konnte nicht eingebettet werden.)", 9, { color: COL.muted });
    }
  } else {
    line("Keine Unterschrift erfasst.", 9, { color: COL.muted });
  }

  y -= 8;
  line(`DATUM (Erstellung): ${erstellt}`, 9, { color: COL.muted, dy: 2 });
  line(`Dokument erzeugt: ${generiert}`, 8, { color: COL.muted, dy: 2 });
  y -= 12;
  drawRule(page, y);
  y -= 12;
  line("SYSTEM: Rabbit Technik Reparatur System", 8, { color: COL.muted, dy: 2 });

  // ——— Etikett (kompakt, ca. 80×120 mm) ———
  const LW = 226;
  const LH = 340;
  const pdfLabel = await PDFDocument.create();
  const lBold = await pdfLabel.embedFont(StandardFonts.HelveticaBold);
  const lFont = await pdfLabel.embedFont(StandardFonts.Helvetica);
  const lp = pdfLabel.addPage([LW, LH]);
  let ly = LH - 14;
  lp.drawRectangle({ x: 0, y: LH - 4, width: LW, height: 4, color: COL.headerStripe });
  lp.drawText("REPARATUR", { x: 10, y: ly, size: 8, font: lFont, color: COL.muted });
  ly -= 22;
  lp.drawText(orderNo, { x: 10, y: ly, size: 13, font: lBold, color: COL.text });
  ly -= 16;
  const shortName =
    String(row.customer_name).length > 28 ? `${String(row.customer_name).slice(0, 26)}…` : String(row.customer_name);
  lp.drawText(shortName, { x: 10, y: ly, size: 9, font: lFont, color: COL.text });
  ly -= 14;
  const shortDev =
    deviceLine.length > 34 ? `${deviceLine.slice(0, 32)}…` : deviceLine || "—";
  lp.drawText(shortDev, { x: 10, y: ly, size: 8, font: lFont, color: COL.muted });
  ly -= 14;
  lp.drawText(statusDe, { x: 10, y: ly, size: 8, font: lBold, color: COL.accent });
  ly -= 18;
  if (qrPng) {
    try {
      const q2 = await pdfLabel.embedPng(qrPng);
      lp.drawImage(q2, { x: 10, y: ly - 70, width: 70, height: 70 });
    } catch {
      /* ignore */
    }
  }
  lp.drawText(String(row.tracking_code), { x: 10, y: 16, size: 7, font: lFont, color: COL.muted });

  const stem = safePdfFileStem(String(row.customer_name));
  const safeOrder = orderNo.replace(/[^a-zA-Z0-9_-]/g, "_");
  const baseName = `${safeOrder}_${stem}.pdf`;
  const pdfDir = reparaturenPdfsDir();
  const labelDir = reparaturenLabelsDir();
  const a4Path = path.join(pdfDir, baseName);
  const labelPath = path.join(labelDir, `Label_${baseName}`);

  fs.writeFileSync(a4Path, await pdfA4.save());
  fs.writeFileSync(labelPath, await pdfLabel.save());

  return { a4Path, labelPath };
}
