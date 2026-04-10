import nodemailer from "nodemailer";

function configured(): boolean {
  return Boolean(process.env.RABBIT_SMTP_HOST && process.env.RABBIT_SMTP_FROM);
}

export async function sendRepairConfirmation(opts: {
  to: string;
  customerName: string;
  trackingCode: string;
  trackingUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!configured()) {
    return { sent: false, reason: "SMTP nicht konfiguriert (RABBIT_SMTP_*)" };
  }

  const host = process.env.RABBIT_SMTP_HOST!;
  const port = Number(process.env.RABBIT_SMTP_PORT ?? 587);
  const secure = process.env.RABBIT_SMTP_SECURE === "1" || process.env.RABBIT_SMTP_SECURE === "true";
  const user = process.env.RABBIT_SMTP_USER ?? "";
  const pass = process.env.RABBIT_SMTP_PASS ?? "";
  const from = process.env.RABBIT_SMTP_FROM!;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  const subject = `Rabbit-Technik – Auftrag ${opts.trackingCode}`;
  const text = `Hallo ${opts.customerName},

Ihr Reparaturauftrag wurde angenommen.

Tracking-Code: ${opts.trackingCode}
Status online: ${opts.trackingUrl}

Mit freundlichen Grüßen
Rabbit-Technik`;

  const html = `<p>Hallo ${escapeHtml(opts.customerName)},</p>
<p>Ihr Reparaturauftrag wurde angenommen.</p>
<p><strong>Tracking-Code:</strong> ${escapeHtml(opts.trackingCode)}<br/>
<a href="${escapeHtml(opts.trackingUrl)}">Status online ansehen</a></p>
<p>Mit freundlichen Grüßen<br/>Rabbit-Technik</p>`;

  await transporter.sendMail({
    from,
    to: opts.to,
    subject,
    text,
    html,
  });
  return { sent: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
