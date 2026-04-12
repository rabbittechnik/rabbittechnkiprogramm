import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { invoicesDir } from "./dataPaths.js";
import { formatDeBerlinNow } from "./formatBerlin.js";

const W = 595;
const H = 842;
const M = 48;
const HEADER_H = 108;

export async function writeAdjustmentDocumentPdf(opts: {
  invoiceNumber: string;
  kind: "storno" | "korrektur";
  referenceInvoiceNumber: string;
  amountCents: number;
  trackingCode: string;
  customerName: string;
  reason?: string;
}): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);
  let y = H - 40;

  const title = opts.kind === "storno" ? "STORNO-RECHNUNG" : "KORREKTURRECHNUNG";
  const subtitle =
    opts.kind === "storno"
      ? "Vollständige Aufhebung der referenzierten Rechnung (GoBD-konform, revisionssicher gespeichert)."
      : "Korrekturposition zur referenzierten Rechnung (GoBD-konform, revisionssicher gespeichert).";

  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: rgb(0.12, 0.06, 0.06) });
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: rgb(0.95, 0.35, 0.35) });

  const line = (text: string, size: number, bold = false, color = rgb(0.1, 0.1, 0.12)) => {
    page.drawText(text, { x: M, y, size, font: bold ? fontBold : font, color });
    y -= size + 5;
  };

  line(title, 16, true, rgb(1, 0.85, 0.85));
  line(`Nr. ${opts.invoiceNumber}`, 11, true, rgb(1, 0.55, 0.55));
  line(`Datum: ${formatDeBerlinNow({ dateStyle: "long", timeStyle: "short" })}`, 9, false, rgb(0.75, 0.75, 0.8));
  y -= 10;
  line(subtitle, 9, false, rgb(0.2, 0.2, 0.24));
  y -= 14;
  line(`Bezug: Rechnung ${opts.referenceInvoiceNumber}`, 10, true);
  line(`Auftrag (Tracking): ${opts.trackingCode}`, 10);
  line(`Kunde: ${opts.customerName}`, 10);
  y -= 8;
  const amt = (opts.amountCents / 100).toFixed(2).replace(".", ",") + " €";
  line(opts.kind === "storno" ? `Stornobetrag (negativ): ${amt}` : `Korrekturbetrag: ${amt}`, 12, true);
  if (opts.reason?.trim()) {
    y -= 6;
    line(`Begründung: ${opts.reason.trim()}`, 9, false, rgb(0.35, 0.35, 0.4));
  }
  y = Math.max(M + 24, y - 20);
  line("Dieses Dokument ist nach Erstellung unveränderbar; Aufbewahrung 10 Jahre (gesetzliche Anforderung).", 8, false, rgb(0.45, 0.45, 0.5));
  line("Rabbit-Technik · Werkstatt", 8, false, rgb(0.45, 0.45, 0.5));

  const dir = invoicesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${opts.invoiceNumber}.pdf`);
  fs.writeFileSync(filePath, await pdf.save());
  return filePath;
}
