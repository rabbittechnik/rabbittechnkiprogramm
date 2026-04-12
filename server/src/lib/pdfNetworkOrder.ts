import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type Database from "better-sqlite3";
import { networkOrdersDir } from "./dataPaths.js";
import { formatDeBerlinNow, formatDeBerlin } from "./formatBerlin.js";
import { vatFromGrossCents } from "./networkPricing.js";
import { SIGNATURE_PAD_BG, signatureDrawSize } from "./pdfSignatureBox.js";

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
  text: rgb(0.12, 0.14, 0.18),
  muted: rgb(0.38, 0.42, 0.48),
  boxBg: rgb(0.94, 0.97, 1),
  boxBorder: rgb(0.65, 0.78, 0.92),
  sigFrame: rgb(0.45, 0.55, 0.65),
};

function parseDataUrlImage(dataUrl: string | null | undefined): { kind: "png" | "jpg"; bytes: Uint8Array } | null {
  if (!dataUrl?.startsWith("data:")) return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase() === "png" ? "png" : "jpg";
  return { kind, bytes: new Uint8Array(Buffer.from(m[2], "base64")) };
}

function wrapLines(text: string, maxChars: number): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [""];
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else { if (cur) lines.push(cur); cur = w.length > maxChars ? w.slice(0, maxChars) : w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

type OrderRow = {
  id: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  service_fee_cents: number;
  hardware_total_cents: number;
  grand_total_cents: number;
  signature_data_url: string | null;
  created_at: string;
  payment_method: string | null;
  payment_status: string;
  payment_paid_at: string | null;
  payment_due_at: string | null;
  invoice_number: string | null;
};

type ItemRow = { model: string; brand: string; quantity: number; unit_price_cents: number };

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

async function buildPdf(opts: {
  docType: "confirmation" | "invoice";
  order: OrderRow;
  items: ItemRow[];
}): Promise<Uint8Array> {
  const { docType, order, items } = opts;
  const isInvoice = docType === "invoice";

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);
  let y = H - 36;

  const line = (text: string, size: number, o: { bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; dy?: number } = {}) => {
    page.drawText(text, { x: o.x ?? M, y, size, font: o.bold ? fontBold : font, color: o.color ?? COL.text });
    y -= size + (o.dy ?? 4);
  };

  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: COL.headerBg });
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: COL.headerStripe });

  line(isInvoice ? "RECHNUNG – NETZWERKEINRICHTUNG" : "AUFTRAGSBESTÄTIGUNG – NETZWERKEINRICHTUNG", 9, { color: COL.subtitle, dy: 5 });
  y -= 2;
  line("Rabbit-Technik", 22, { bold: true, color: COL.title, dy: 7 });
  if (isInvoice && order.invoice_number) {
    line(`Rechnungsnr. ${order.invoice_number}`, 11, { bold: true, color: COL.accent, dy: 5 });
  }

  y = H - HEADER_H - 22;
  line(`Datum: ${formatDeBerlinNow({ dateStyle: "long", timeStyle: "short" })}`, 10, { color: COL.text, dy: 6 });
  y -= 10;

  const metaLines = [
    `Kunde: ${order.customer_name}`,
    order.address ?? "",
    order.email ?? "",
    order.phone ?? "",
  ].filter(Boolean);
  const pad = 12;
  const metaH = pad * 2 + metaLines.length * 14 + 6;
  page.drawRectangle({ x: M - 4, y: y - metaH, width: CONTENT_W + 8, height: metaH, color: COL.boxBg, borderColor: COL.boxBorder, borderWidth: 0.8 });
  y -= pad;
  for (const ml of metaLines) line(ml, 10, { color: COL.text, dy: 3 });
  y -= pad + 14;

  line("LEISTUNG", 9, { bold: true, color: COL.accent, dy: 6 });
  y -= 2;
  line("Einrichtung Netzwerk / WLAN / Router / Mesh – Vor-Ort-Service", 10, { dy: 3 });
  y -= 10;

  line("HARDWARE", 9, { bold: true, color: COL.accent, dy: 6 });
  y -= 2;
  for (const item of items) {
    const text = `${item.quantity}× ${item.brand} ${item.model} … ${euro(item.unit_price_cents)} €${item.quantity > 1 ? ` (${euro(item.unit_price_cents * item.quantity)} €)` : ""}`;
    for (const ln of wrapLines(text, 78)) line(ln, 10, { dy: 2 });
  }
  y -= 6;

  line(`Dienstleistung (Einrichtung) … ${euro(order.service_fee_cents)} €`, 10, { dy: 6 });
  y -= 8;

  const totalBoxH = 44;
  page.drawRectangle({ x: M - 4, y: y - totalBoxH, width: CONTENT_W + 8, height: totalBoxH, color: COL.headerBg, borderColor: COL.accent, borderWidth: 1 });
  page.drawText("Gesamtbetrag", { x: M + 8, y: y - 16, size: 9, font, color: COL.subtitle });
  page.drawText(`${euro(order.grand_total_cents)} €`, { x: M + 8, y: y - 36, size: 20, font: fontBold, color: COL.accent });
  y -= totalBoxH + 8;

  const vat = vatFromGrossCents(order.grand_total_cents);
  line(`Enthaltene Umsatzsteuer (${vat.vatRatePercent} %): ${euro(vat.vatCents)} €`, 9, { color: COL.muted, dy: 2 });
  line(`Netto (ohne USt): ${euro(vat.netCents)} €`, 9, { color: COL.muted, dy: 2 });
  y -= 8;

  if (isInvoice && order.payment_method) {
    line("Zahlung", 10, { bold: true, color: COL.text, dy: 4 });
    if (order.payment_method === "bar" && order.payment_status === "bezahlt") {
      line("Barzahlung bei Übergabe – beglichen.", 10, { dy: 2 });
    } else if (order.payment_method === "sumup" && order.payment_status === "bezahlt") {
      line("Kartenzahlung über SumUp – beglichen.", 10, { dy: 2 });
    } else if (order.payment_method === "ueberweisung") {
      line("Zahlung per Überweisung.", 10, { dy: 2 });
      if (order.payment_due_at) {
        line(`Zahlbar bis: ${formatDeBerlin(order.payment_due_at, { dateStyle: "long" })}`, 10, { color: COL.muted, dy: 2 });
      }
    }
    y -= 8;
  }

  if (!isInvoice && order.signature_data_url) {
    const parsed = parseDataUrlImage(order.signature_data_url);
    if (parsed) {
      y -= 4;
      line("Unterschrift Kunde", 9, { bold: true, color: COL.accent, dy: 4 });
      const sigBoxW = 280;
      const sigBoxH = 88;
      const pad = 8;
      const innerW = sigBoxW - pad * 2;
      const innerH = sigBoxH - pad * 2;
      try {
        const emb = parsed.kind === "png" ? await pdf.embedPng(parsed.bytes) : await pdf.embedJpg(parsed.bytes);
        const { width: iw, height: ih } = signatureDrawSize(emb.width, emb.height, innerW, innerH);
        const boxH = ih + pad * 2;
        const boxBottom = y - boxH;
        page.drawRectangle({
          x: M,
          y: boxBottom,
          width: sigBoxW,
          height: boxH,
          borderColor: COL.sigFrame,
          borderWidth: 0.8,
          color: SIGNATURE_PAD_BG,
        });
        page.drawImage(emb, { x: M + pad, y: boxBottom + pad, width: iw, height: ih });
        y = boxBottom - 10;
      } catch {
        y -= sigBoxH + pad * 2 + 10;
      }
    }
  }

  y = Math.max(M + 10, y - 4);
  line("Rabbit-Technik · Netzwerkeinrichtung / Vor-Ort-Service", 8, { color: COL.muted });

  return pdf.save();
}

function loadOrder(db: Database.Database, orderId: string): { order: OrderRow; items: ItemRow[] } | null {
  const order = db.prepare(
    `SELECT o.*, c.name AS customer_name, c.email, c.phone, c.address
     FROM network_orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ?`
  ).get(orderId) as OrderRow | undefined;
  if (!order) return null;

  const items = db.prepare(
    `SELECT d.model, d.brand, i.quantity, i.unit_price_cents
     FROM network_order_items i JOIN network_devices d ON d.id = i.device_id
     WHERE i.order_id = ? ORDER BY i.created_at`
  ).all(orderId) as ItemRow[];

  return { order, items };
}

export async function writeNetworkConfirmationPdf(db: Database.Database, orderId: string): Promise<string> {
  const data = loadOrder(db, orderId);
  if (!data) throw new Error("Netzwerk-Auftrag nicht gefunden");
  const bytes = await buildPdf({ docType: "confirmation", ...data });
  const dir = networkOrdersDir();
  const filePath = path.join(dir, `NW-Bestaetigung-${orderId.slice(0, 10)}.pdf`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

export async function writeNetworkInvoicePdf(db: Database.Database, orderId: string): Promise<string> {
  const data = loadOrder(db, orderId);
  if (!data) throw new Error("Netzwerk-Auftrag nicht gefunden");
  const bytes = await buildPdf({ docType: "invoice", ...data });
  const dir = networkOrdersDir();
  const num = data.order.invoice_number ?? orderId.slice(0, 10);
  const filePath = path.join(dir, `${num}.pdf`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
