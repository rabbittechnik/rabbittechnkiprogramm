import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type Database from "better-sqlite3";

import { invoicesDir } from "./dataPaths.js";
import { PAYMENT_TERMS_HEADLINE_DE, PAYMENT_TERMS_LINES_DE, RABBIT_IBAN_FORMATTED } from "./paymentInfo.js";
import { formatDeBerlin, formatDeBerlinNow } from "./formatBerlin.js";

const W = 595;
const H = 842;
const M = 48;
const CONTENT_W = W - M * 2;
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
  totalBg: rgb(0.04, 0.08, 0.12),
};

function wrapLines(text: string, maxChars: number): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [""];
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Word-wrap to a maximum rendered width (Helvetica-like proportional spacing). */
function wrapLinesMaxWidth(text: string, maxWidth: number, f: PDFFont, size: number): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [""];
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  const fits = (s: string) => f.widthOfTextAtSize(s, size) <= maxWidth;

  const pushLongToken = (token: string) => {
    let chunk = "";
    for (const ch of token) {
      const next = chunk + ch;
      if (fits(next)) chunk = next;
      else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    if (chunk) lines.push(chunk);
  };

  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next)) cur = next;
    else {
      if (cur) lines.push(cur);
      if (fits(w)) cur = w;
      else {
        pushLongToken(w);
        cur = "";
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function drawDotLeader(
  page: PDFPage,
  yBaseline: number,
  xStart: number,
  xEnd: number,
  f: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>
) {
  const dot = "·";
  const dotW = f.widthOfTextAtSize(dot, size);
  if (xEnd <= xStart || dotW <= 0) return;
  let x = xStart;
  while (x + dotW <= xEnd) {
    page.drawText(dot, { x, y: yBaseline, size, font: f, color });
    x += dotW * 1.15;
  }
}

function drawHLine(page: PDFPage, x0: number, x1: number, yCenter: number, thickness: number, color: ReturnType<typeof rgb>) {
  const w = Math.max(0, x1 - x0);
  if (w <= 0) return;
  page.drawRectangle({
    x: x0,
    y: yCenter - thickness / 2,
    width: w,
    height: thickness,
    color,
  });
}

export async function writeInvoicePdf(
  db: Database.Database,
  repairId: string,
  invoiceNumber: string
): Promise<string> {
  const repair = db
    .prepare(
      `SELECT r.*, c.name as customer_name, c.email, c.phone, c.address,
       d.device_type, d.brand, d.model, d.serial_number,
       COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days')) AS payment_due_until
       FROM repairs r
       JOIN customers c ON c.id = r.customer_id
       JOIN devices d ON d.id = r.device_id
       LEFT JOIN invoices i ON i.id = (
         SELECT id FROM invoices WHERE repair_id = r.id AND document_kind = 'rechnung'
         ORDER BY datetime(created_at) DESC LIMIT 1
       )
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

  const repairLogs = db
    .prepare(
      `SELECT logged_at, action_type, description, duration_minutes FROM repair_logs WHERE repair_id = ? ORDER BY datetime(logged_at) ASC, id ASC`
    )
    .all(repairId) as {
      logged_at: string;
      action_type: string;
      description: string;
      duration_minutes: number | null;
    }[];

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([W, H]);
  let y = H - HEADER_H - 28;

  const line = (text: string, size: number, o: { bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; dy?: number } = {}) => {
    const x = o.x ?? M;
    const c = o.color ?? COL.text;
    const f = o.bold ? fontBold : font;
    page.drawText(text, { x, y, size, font: f, color: c });
    y -= size + (o.dy ?? 4);
  };

  const ensureBodySpace = (minYFromBottom: number) => {
    if (y >= minYFromBottom) return;
    page = pdf.addPage([W, H]);
    y = H - M;
  };

  const isTest = Number(repair.is_test) === 1;
  const dateStr = formatDeBerlinNow({ dateStyle: "long", timeStyle: "short" });
  const dateLine = `Rechnungsdatum (DE): ${dateStr}`;

  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: COL.headerBg });
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: isTest ? rgb(1, 0.3, 0.2) : COL.headerStripe });

  if (isTest) {
    page.drawText("TESTRECHNUNG – KEIN ZAHLUNGSBELEG", {
      x: M,
      y: H - 30,
      size: 10,
      font: fontBold,
      color: rgb(1, 0.35, 0.28),
    });
  }

  const yDocLabel = H - (isTest ? 56 : 42);
  const yBrand = H - (isTest ? 78 : 64);
  page.drawText(isTest ? "TESTRECHNUNG" : "RECHNUNG", {
    x: M,
    y: yDocLabel,
    size: 9,
    font,
    color: COL.subtitle,
  });
  page.drawText("Rabbit-Technik", {
    x: M,
    y: yBrand,
    size: 22,
    font: fontBold,
    color: COL.title,
  });

  const invLine = `Nr. ${invoiceNumber}`;
  const invSize = 11;
  page.drawText(invLine, {
    x: W - M - fontBold.widthOfTextAtSize(invLine, invSize),
    y: H - (isTest ? 54 : 42),
    size: invSize,
    font: fontBold,
    color: COL.accent,
  });
  const dateSize = 9;
  page.drawText(dateLine, {
    x: W - M - font.widthOfTextAtSize(dateLine, dateSize),
    y: H - (isTest ? 70 : 58),
    size: dateSize,
    font,
    color: COL.subtitle,
  });

  const metaLines: string[] = [`Kunde: ${String(repair.customer_name)}`];
  if (repair.address) {
    const rawAddr = String(repair.address).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const al of rawAddr.split("\n")) {
      const t = al.trim();
      if (t) metaLines.push(t);
    }
  }
  if (repair.email) metaLines.push(String(repair.email));
  if (repair.phone) metaLines.push(String(repair.phone));
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
  for (const ml of metaLines) {
    line(ml, 10, { color: COL.text, dy: 3 });
  }
  y -= pad + 14;

  const sectionTitle = (t: string) => {
    line(t.toUpperCase(), 9, { bold: true, color: COL.accent, dy: 6 });
    y -= 4;
  };

  sectionTitle("Auftrag / Gerät");
  line(`Tracking: ${String(repair.tracking_code)}`, 10, { dy: 3 });
  line(`${repair.device_type} – ${repair.brand ?? ""} ${repair.model ?? ""}`.trim(), 10, { dy: 3 });
  y -= 10;

  const X_RIGHT = W - M;
  const DESC_PRICE_GAP = 12;
  const itemRowSize = 10;
  const itemRowDy = 3;

  const drawDescriptionPriceRows = (description: string, priceCents: number) => {
    const priceLabel = `${(priceCents / 100).toFixed(2)} €`;
    const priceW = fontBold.widthOfTextAtSize(priceLabel, itemRowSize);
    const xPrice = X_RIGHT - priceW;
    const descMaxW = Math.max(80, xPrice - M - DESC_PRICE_GAP);
    const descLines = wrapLinesMaxWidth(description, descMaxW, font, itemRowSize);
    const lineStep = itemRowSize + itemRowDy;
    for (let i = 0; i < descLines.length; i++) {
      ensureBodySpace(M + lineStep + 48);
      const last = i === descLines.length - 1;
      const yy = y;
      page.drawText(descLines[i], { x: M, y: yy, size: itemRowSize, font, color: COL.text });
      if (last) {
        const textW = font.widthOfTextAtSize(descLines[i], itemRowSize);
        drawDotLeader(page, yy, M + textW + 4, xPrice - 3, font, 5.5, COL.muted);
        page.drawText(priceLabel, {
          x: xPrice,
          y: yy,
          size: itemRowSize,
          font: fontBold,
          color: COL.text,
        });
      }
      y -= lineStep;
    }
    y -= 2;
  };

  const drawPositionsSubheading = (label: string) => {
    ensureBodySpace(M + 36);
    page.drawText(label, { x: M, y, size: 9, font: fontBold, color: COL.muted });
    y -= 9 + 2;
    drawHLine(page, M, X_RIGHT, y + 6, 0.45, COL.boxBorder);
    y -= 6;
  };

  sectionTitle("Positionen");
  ensureBodySpace(M + 72);
  const thSize = 8;
  const betragLbl = "Betrag";
  page.drawText("Beschreibung", { x: M, y, size: thSize, font: fontBold, color: COL.muted });
  page.drawText(betragLbl, {
    x: X_RIGHT - fontBold.widthOfTextAtSize(betragLbl, thSize),
    y,
    size: thSize,
    font: fontBold,
    color: COL.muted,
  });
  y -= thSize + 2;
  drawHLine(page, M, X_RIGHT, y + 4, 0.6, COL.accent);
  y -= 10;

  if (services.length > 0) {
    drawPositionsSubheading("Leistungen");
    for (const s of services) {
      drawDescriptionPriceRows(s.name, s.price_cents);
    }
  }
  if (parts.length > 0) {
    drawPositionsSubheading("Ersatzteile / Material");
    for (const p of parts) {
      drawDescriptionPriceRows(p.name, p.sale_cents);
    }
  }
  if (services.length === 0 && parts.length === 0) {
    ensureBodySpace(M + 24);
    line("— keine Positionen erfasst —", 9, { color: COL.muted, dy: 3 });
  }
  y -= 6;

  if (repairLogs.length > 0) {
    ensureBodySpace(M + 100);
    sectionTitle("Arbeitsprotokoll");
    for (const lg of repairLogs) {
      ensureBodySpace(M + 72);
      const timeLbl = formatDeBerlin(lg.logged_at, { dateStyle: "short", timeStyle: "short" });
      const dur = lg.duration_minutes != null ? ` · ${lg.duration_minutes} Min.` : "";
      for (const ln of wrapLines(`${timeLbl} – ${lg.action_type}${dur}`, 82)) {
        line(ln, 9, { bold: true, dy: 2 });
      }
      for (const ln of wrapLines(lg.description, 82)) {
        line(ln, 9, { color: COL.muted, dy: 2 });
      }
      y -= 4;
    }
    y -= 6;
  }

  const total = Number(repair.total_cents);
  const totalBoxH = 44;
  ensureBodySpace(M + totalBoxH + 140);
  page.drawRectangle({
    x: M - 4,
    y: y - totalBoxH,
    width: CONTENT_W + 8,
    height: totalBoxH,
    color: COL.totalBg,
    borderColor: COL.accent,
    borderWidth: 1,
  });
  const totalStr = `${(total / 100).toFixed(2)} €`;
  const totalAmtSize = 20;
  const totalAmtW = fontBold.widthOfTextAtSize(totalStr, totalAmtSize);
  const xTotalAmt = X_RIGHT - totalAmtW;
  page.drawText("Gesamtbetrag", { x: M + 8, y: y - 16, size: 9, font, color: COL.subtitle });
  page.drawText(totalStr, {
    x: xTotalAmt,
    y: y - 36,
    size: totalAmtSize,
    font: fontBold,
    color: COL.accent,
  });
  y -= totalBoxH + 20;

  const dueUntil = repair.payment_due_until != null ? String(repair.payment_due_until) : "";
  const pm = String(repair.payment_method ?? "");
  const ps = String(repair.payment_status);

  line("Zahlung / Abwicklung", 12, { bold: true, color: COL.text, dy: 8 });
  y -= 4;

  const payChunk = (text: string, size: number, o: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    for (const ln of wrapLines(text, 82)) {
      line(ln, size, { ...o, dy: 2 });
    }
  };

  if (pm === "bar" && ps === "bezahlt") {
    payChunk("Barzahlung bei Abholung – beglichen.", 10, { color: COL.text });
  } else if (pm === "sumup" && ps === "bezahlt") {
    const ch = String(repair.sumup_channel ?? "");
    if (ch === "tap_to_pay" || ch === "terminal") {
      payChunk("Kartenzahlung per SumUp Tap to Pay (Smartphone / SumUp-App) – beglichen.", 10, { color: COL.text });
    } else {
      payChunk("EC-/Kreditkarte über SumUp (Online-Zahlung) – beglichen.", 10, { color: COL.text });
    }
    const ppa = repair.payment_paid_at != null ? String(repair.payment_paid_at) : "";
    if (ppa) {
      payChunk(`Zahlungseingang: ${formatDeBerlin(String(ppa), { dateStyle: "long", timeStyle: "short" })}`, 9, {
        color: COL.muted,
      });
    }
  } else if (pm === "ueberweisung" && ps === "offen") {
    payChunk("Zahlung per Überweisung (vereinbarte Frist).", 10, { bold: true, color: COL.text });
    if (dueUntil) {
      payChunk(`Zahlbar bis: ${formatDeBerlin(dueUntil, { dateStyle: "long", timeStyle: "short" })}`, 10, {
        color: COL.text,
      });
    }
    payChunk(`Konto (IBAN): ${RABBIT_IBAN_FORMATTED}`, 10, { color: COL.text });
    payChunk(`Verwendungszweck (Auftrag): ${String(repair.tracking_code)} · Rechnungsnr. ${invoiceNumber}`, 10, {
      bold: true,
      color: COL.lime,
    });
  } else {
    if (ps === "offen" && pm === "ueberweisung" && dueUntil) {
      payChunk(`Fälligkeit: ${formatDeBerlin(dueUntil, { dateStyle: "long", timeStyle: "short" })}`, 9, {
        color: COL.muted,
      });
    }
    payChunk(PAYMENT_TERMS_HEADLINE_DE, 10, { bold: true, color: COL.text });
    for (const t of PAYMENT_TERMS_LINES_DE) {
      payChunk(t, 9, { color: COL.muted });
    }
  }

  y = Math.max(M + 20, y - 6);
  if (isTest) {
    line("*** TESTRECHNUNG – NICHT FÜR BUCHHALTUNG / DATEV / BERICHTE ***", 8, { bold: true, color: rgb(1, 0.3, 0.2), dy: 4 });
  }
  line("Rabbit-Technik · Werkstatt", 8, { color: COL.muted, dy: 2 });

  const pdfDir = invoicesDir();
  const filePath = path.join(pdfDir, `${invoiceNumber}.pdf`);
  fs.writeFileSync(filePath, await pdf.save());
  return filePath;
}
