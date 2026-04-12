import type Database from "better-sqlite3";
import {
  isMailConfigured,
  sendInternalWorkshopReportEmail,
  formatEuroFromCents,
  logMailOutcome,
  type MailFileAttachment,
} from "./mail.js";

function nlToBr(s: string): string {
  return s.replace(/\n/g, "<br>");
}

type OrderMailData = {
  customerName: string;
  customerEmail: string;
  items: { model: string; brand: string; quantity: number; unitPriceCents: number }[];
  serviceFeeCents: number;
  grandTotalCents: number;
};

function loadOrderMailData(db: Database.Database, orderId: string): OrderMailData | null {
  const order = db.prepare(
    `SELECT o.grand_total_cents, o.service_fee_cents, c.name AS customer_name, c.email AS customer_email
     FROM network_orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
  ).get(orderId) as { grand_total_cents: number; service_fee_cents: number; customer_name: string; customer_email: string | null } | undefined;
  if (!order?.customer_email) return null;

  const items = db.prepare(
    `SELECT d.model, d.brand, i.quantity, i.unit_price_cents AS unitPriceCents
     FROM network_order_items i JOIN network_devices d ON d.id = i.device_id WHERE i.order_id = ?`
  ).all(orderId) as OrderMailData["items"];

  return {
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    items,
    serviceFeeCents: order.service_fee_cents,
    grandTotalCents: order.grand_total_cents,
  };
}

export async function sendNetworkConfirmationEmail(
  db: Database.Database,
  orderId: string,
  pdfPath?: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!isMailConfigured()) return { sent: false, reason: "E-Mail nicht konfiguriert" };
  const data = loadOrderMailData(db, orderId);
  if (!data) return { sent: false, reason: "Keine Kunden-E-Mail" };

  const lines = [
    `Auftragsbestätigung – Netzwerkeinrichtung`,
    "",
    `Hallo ${data.customerName},`,
    "",
    `vielen Dank für Ihren Auftrag zur Netzwerkeinrichtung.`,
    "",
    "Bestellte Geräte:",
    ...data.items.map((i) => `  ${i.quantity}× ${i.brand} ${i.model} – ${formatEuroFromCents(i.unitPriceCents)} €`),
    "",
    `Einrichtungs-Service: ${formatEuroFromCents(data.serviceFeeCents)} €`,
    `Gesamtbetrag: ${formatEuroFromCents(data.grandTotalCents)} €`,
    "",
    "Wir melden uns, sobald Ihre Geräte eingetroffen sind.",
    "",
    "Rabbit-Technik · Netzwerkeinrichtung",
  ];

  const { sendSmtp, wrapCustomerEmailHtml } = await import("./mail.js");
  const text = lines.join("\n");
  const inner = `<tr><td style="padding:22px 24px 8px;"><p style="margin:0;font-size:14px;line-height:1.65;color:#cbd5e1;">${nlToBr(text.replace(/</g, "&lt;"))}</p></td></tr>`;
  const html = wrapCustomerEmailHtml(inner, "Auftragsbestätigung Netzwerkeinrichtung");
  const attachments: MailFileAttachment[] = pdfPath ? [{ filename: "Auftragsbestaetigung-Netzwerk.pdf", path: pdfPath }] : [];

  return sendSmtp({ to: data.customerEmail, subject: `Auftragsbestätigung Netzwerkeinrichtung – Rabbit-Technik`, text, html, attachments });
}

export async function sendNetworkDeliveryEmail(
  db: Database.Database,
  orderId: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!isMailConfigured()) return { sent: false, reason: "E-Mail nicht konfiguriert" };
  const data = loadOrderMailData(db, orderId);
  if (!data) return { sent: false, reason: "Keine Kunden-E-Mail" };

  const lines = [
    `Ihre Geräte sind eingetroffen!`,
    "",
    `Hallo ${data.customerName},`,
    "",
    `Ihre bestellten Netzwerk-Geräte sind bei uns angekommen:`,
    ...data.items.map((i) => `  ${i.quantity}× ${i.brand} ${i.model}`),
    "",
    `Sie können die Geräte bei uns abholen und wir richten Ihr Netzwerk ein.`,
    "",
    "Rabbit-Technik · Netzwerkeinrichtung",
  ];

  const { sendSmtp, wrapCustomerEmailHtml } = await import("./mail.js");
  const text = lines.join("\n");
  const inner = `<tr><td style="padding:22px 24px 8px;"><p style="margin:0;font-size:14px;line-height:1.65;color:#cbd5e1;">${nlToBr(text.replace(/</g, "&lt;"))}</p></td></tr>`;
  const html = wrapCustomerEmailHtml(inner, "Geräte eingetroffen");

  return sendSmtp({ to: data.customerEmail, subject: `Ihre Netzwerk-Geräte sind da – Rabbit-Technik`, text, html });
}

export async function sendNetworkInvoiceEmail(
  db: Database.Database,
  orderId: string,
  pdfPath?: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!isMailConfigured()) return { sent: false, reason: "E-Mail nicht konfiguriert" };
  const data = loadOrderMailData(db, orderId);
  if (!data) return { sent: false, reason: "Keine Kunden-E-Mail" };

  const invNo = (db.prepare(`SELECT invoice_number FROM network_orders WHERE id = ?`).get(orderId) as { invoice_number: string | null })?.invoice_number ?? "";

  const lines = [
    `Rechnung${invNo ? ` ${invNo}` : ""} – Netzwerkeinrichtung`,
    "",
    `Hallo ${data.customerName},`,
    "",
    `anbei erhalten Sie die Rechnung für Ihre Netzwerkeinrichtung.`,
    "",
    `Gesamtbetrag: ${formatEuroFromCents(data.grandTotalCents)} €`,
    "",
    "Vielen Dank für Ihr Vertrauen!",
    "",
    "Rabbit-Technik · Netzwerkeinrichtung",
  ];

  const { sendSmtp, wrapCustomerEmailHtml } = await import("./mail.js");
  const text = lines.join("\n");
  const inner = `<tr><td style="padding:22px 24px 8px;"><p style="margin:0;font-size:14px;line-height:1.65;color:#cbd5e1;">${nlToBr(text.replace(/</g, "&lt;"))}</p></td></tr>`;
  const html = wrapCustomerEmailHtml(inner, `Rechnung ${invNo}`);
  const attachments: MailFileAttachment[] = pdfPath ? [{ filename: `Rechnung-${invNo || "Netzwerk"}.pdf`, path: pdfPath }] : [];

  return sendSmtp({ to: data.customerEmail, subject: `Rechnung ${invNo} – Netzwerkeinrichtung · Rabbit-Technik`, text, html, attachments });
}
