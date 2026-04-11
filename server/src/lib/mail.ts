import dns from "node:dns";
import fs from "node:fs";
import nodemailer from "nodemailer";
import type { TransportOptions } from "nodemailer";
import { buildPublicTrackingUrl } from "./publicUrl.js";

/**
 * SMTP-Optionen für nodemailer – bewusst lokal typisiert.
 * Subpaths wie `nodemailer/lib/smtp-transport` sind unter moduleResolution NodeNext oft nicht auflösbar (Railway-Build).
 */
type MailSmtpOptions = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
  tls: { rejectUnauthorized: boolean; minVersion?: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  pool: boolean;
  debug?: boolean;
  logger?: Pick<typeof console, "info" | "debug" | "warn" | "error">;
};

/** IPv4 zuerst (Container/Cloud), statt custom lookup – vermeidet TS-Overload-Probleme bei createTransport */
let smtpDnsOrderApplied = false;
function ensureSmtpPreferIpv4(): void {
  if (smtpDnsOrderApplied || process.env.RABBIT_SMTP_IPV4 === "0") return;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* ältere Node-Versionen */
  }
  smtpDnsOrderApplied = true;
}

const COMPANY = {
  name: "Rabbit-Technik",
  street: "Oberhausenerstr. 20",
  zipCity: "72411 Bodelshausen",
  phone: "015172294882",
  email: "rabbit.technik@gmail.com",
} as const;

/** Host aus RABBIT_SMTP_HOST oder bei PRESET=gmail automatisch smtp.gmail.com */
function resolveSmtpHost(): string {
  const trimmed = process.env.RABBIT_SMTP_HOST?.trim();
  if (trimmed) return trimmed;
  if (process.env.RABBIT_SMTP_PRESET?.toLowerCase() === "gmail") return "smtp.gmail.com";
  return "";
}

/** True, wenn klassisches SMTP (Gmail & Co.) vollständig konfiguriert ist. */
export function isSmtpConfigured(): boolean {
  const from = process.env.RABBIT_SMTP_FROM?.trim();
  const user = process.env.RABBIT_SMTP_USER?.trim();
  const pass = process.env.RABBIT_SMTP_PASS?.trim();
  const host = resolveSmtpHost();
  return Boolean(from && user && pass && host);
}

/** Resend (HTTPS-API) – auf Railway Hobby empfohlen, da ausgehendes SMTP dort oft gesperrt ist. */
export function isResendConfigured(): boolean {
  return Boolean(process.env.RABBIT_RESEND_API_KEY?.trim());
}

/** Mindestens ein Versandweg (Resend oder SMTP). */
export function isMailConfigured(): boolean {
  return isResendConfigured() || isSmtpConfigured();
}

/** Für Fehlermeldungen: welche SMTP-Variablen fehlen (ohne Werte). */
export function smtpMissingVars(): string[] {
  const m: string[] = [];
  if (!process.env.RABBIT_SMTP_FROM?.trim()) m.push("RABBIT_SMTP_FROM");
  if (!process.env.RABBIT_SMTP_USER?.trim()) m.push("RABBIT_SMTP_USER");
  if (!process.env.RABBIT_SMTP_PASS?.trim()) m.push("RABBIT_SMTP_PASS");
  if (!resolveSmtpHost()) m.push("RABBIT_SMTP_HOST oder RABBIT_SMTP_PRESET=gmail");
  return m;
}

function createTransporter() {
  const host = resolveSmtpHost();
  if (!host) {
    throw new Error("SMTP: RABBIT_SMTP_HOST setzen oder RABBIT_SMTP_PRESET=gmail");
  }

  const user = (process.env.RABBIT_SMTP_USER ?? "").trim();
  const pass = (process.env.RABBIT_SMTP_PASS ?? "").trim();
  const explicitSecure = process.env.RABBIT_SMTP_SECURE === "1" || process.env.RABBIT_SMTP_SECURE === "true";
  const isGmail = host === "smtp.gmail.com" || process.env.RABBIT_SMTP_PRESET?.toLowerCase() === "gmail";

  /**
   * Standard Gmail: 465 + SSL – in vielen Cloud-Umgebungen (z. B. Railway) zuverlässiger als 587/STARTTLS.
   * Bei Timeout: RABBIT_SMTP_PORT=465 belassen oder RABBIT_SMTP_PORT=587 testen.
   */
  const defaultPort = isGmail ? 465 : 587;
  const port = Number(process.env.RABBIT_SMTP_PORT ?? defaultPort);

  /** Gmail: 587 = STARTTLS (secure: false + requireTLS). 465 = SSL (secure: true). */
  const secure = explicitSecure || port === 465;
  const useStartTls = isGmail && port === 587 && !explicitSecure;

  if (process.env.RABBIT_SMTP_IPV4 !== "0") ensureSmtpPreferIpv4();

  const opts: MailSmtpOptions = {
    host,
    port,
    secure,
    requireTLS: useStartTls || undefined,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 90_000,
    greetingTimeout: 45_000,
    socketTimeout: 120_000,
    pool: false,
  };
  if (process.env.RABBIT_SMTP_DEBUG === "1") {
    opts.debug = true;
    opts.logger = console;
  }

  return nodemailer.createTransport(opts as TransportOptions);
}

/** Öffentlicher Tracking-Link (ohne Request-Kontext → siehe `PUBLIC_TRACKING_URL`). */
export function publicTrackingUrl(trackingCode: string): string {
  return buildPublicTrackingUrl(trackingCode);
}

/** Deutsche Anzeige: 12,34 */
export function formatEuroFromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2).replace(".", ",");
}

export function statusLabelDe(status: string): string {
  const m: Record<string, string> = {
    angenommen: "Reparatur angenommen",
    diagnose: "In Diagnose",
    wartet_auf_teile: "Warte auf Ersatzteile / Teile bestellt",
    teilgeliefert: "Ersatzteil(e) teilweise geliefert",
    in_reparatur: "Reparatur in Bearbeitung",
    fertig: "Fertig zur Abholung",
    abgeholt: "Abgeholt",
  };
  return m[status] ?? status.replace(/_/g, " ");
}

/** Lesbare Teile-Status für E-Mail & Tracking */
export function partStatusLabelDe(status: string): string {
  const m: Record<string, string> = {
    bestellt: "beim Lieferanten bestellt",
    unterwegs: "unterwegs zu uns",
    angekommen: "bei uns angekommen",
    eingebaut: "eingebaut",
    vor_ort: "bereits vor Ort / aus Lager",
  };
  return m[status] ?? status.replace(/_/g, " ");
}

export function formatTeileListe(
  parts: { name: string; status: string }[]
): string {
  if (!parts.length) return "—";
  return parts.map((p) => `${p.name} – ${partStatusLabelDe(p.status)}`).join("\n");
}

export function formatVorschaeden(raw: string | null): string {
  if (!raw || !String(raw).trim()) return "—";
  const s = String(raw).trim();
  try {
    const j = JSON.parse(s) as unknown;
    if (Array.isArray(j) && j.every((x) => typeof x === "string")) {
      return j.length ? j.join(", ") : "—";
    }
  } catch {
    /* plain text */
  }
  return s;
}

export function formatReparaturDetails(opts: {
  problemLabel: string | null;
  description: string | null;
  serviceNames: string[];
}): string {
  const lines: string[] = [];
  if (opts.description?.trim()) lines.push(`Beschreibung: ${opts.description.trim()}`);
  if (opts.problemLabel) lines.push(`Anlass / Diagnose: ${opts.problemLabel}`);
  if (opts.serviceNames.length) lines.push(`Leistungen: ${opts.serviceNames.join(", ")}`);
  return lines.length ? lines.join("\n") : "—";
}

function textFooter(): string {
  return `Mit freundlichen Grüßen
${COMPANY.name}

${COMPANY.street}
${COMPANY.zipCity}

Telefon: ${COMPANY.phone}
E-Mail: ${COMPANY.email}`;
}

/** Footer-Zeile innerhalb des HTML-Layouts (dunkler Tech-Look). */
function htmlFooterRow(): string {
  return `<tr>
  <td style="padding:22px 24px 26px;background:#050810;border-top:1px solid rgba(0,212,255,0.12);">
    <p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#e2e8f0;">
      Mit freundlichen Grüßen<br/>
      <strong style="color:#00d4ff;">${escapeHtml(COMPANY.name)}</strong>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
      ${escapeHtml(COMPANY.street)}<br/>
      ${escapeHtml(COMPANY.zipCity)}<br/>
      <span style="color:#64748b;">Telefon:</span>
      <a href="tel:${escapeHtml(COMPANY.phone.replace(/\s/g, ""))}" style="color:#39ff14;text-decoration:none;">${escapeHtml(COMPANY.phone)}</a><br/>
      <span style="color:#64748b;">E-Mail:</span>
      <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#7ee8ff;text-decoration:underline;">${escapeHtml(COMPANY.email)}</a>
    </p>
  </td>
</tr>`;
}

/**
 * Einheitliches Kunden-E-Mail-Layout (dunkel, cyan/lime Akzente, werkstatt-typisch).
 * Inhalt = zusammenhängende &lt;tr&gt;…&lt;/tr&gt;-Zeilen für die innere Tabelle.
 */
function wrapCustomerEmailHtml(innerRows: string, preheader?: string): string {
  const pre = preheader ? escapeHtml(preheader.slice(0, 140)) : "";
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${escapeHtml(COMPANY.name)}</title>
  <!--[if mso]><style type="text/css">table { border-collapse: collapse; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#030508;">
  ${pre ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${pre}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#030508;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border-radius:18px;overflow:hidden;border:1px solid rgba(0,212,255,0.28);background:#0a1220;box-shadow:0 0 48px rgba(0,212,255,0.12);">
          <tr>
            <td style="padding:22px 24px 18px;background:linear-gradient(135deg,rgba(0,212,255,0.14) 0%,rgba(15,23,42,0.9) 42%,#0a1220 100%);border-bottom:1px solid rgba(0,212,255,0.18);">
              <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7ee8ff;font-weight:700;">Werkstatt · Service</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#f8fafc;line-height:1.2;">
                ${escapeHtml(COMPANY.name)}
              </p>
              <p style="margin:8px 0 0;font-size:13px;color:#94a3b8;line-height:1.45;">Reparatur · Diagnose · Ersatzteile</p>
            </td>
          </tr>
          ${innerRows}
          ${htmlFooterRow()}
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#475569;max-width:560px;text-align:center;line-height:1.5;">
          Diese Nachricht wurde automatisch versendet. Bitte antworten Sie bei Rückfragen direkt auf diese E-Mail oder rufen Sie uns an.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Inhalt als Abschnitt mit kleinem Label (innen &lt;td&gt;). */
function emailContentBlock(title: string, bodyHtml: string): string {
  return `<tr>
  <td style="padding:18px 24px 4px;">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a5b4fc;font-weight:700;">${escapeHtml(title)}</p>
    <div style="font-size:14px;line-height:1.6;color:#e2e8f0;">${bodyHtml}</div>
  </td>
</tr>`;
}

/** Hervorgehobener Bereich für den Tracking-Link (Button + Link als Fallback). */
function emailTrackingHero(trackingLink: string, eyebrow: string, introLine?: string): string {
  const intro = introLine
    ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#cbd5e1;">${introLine}</p>`
    : "";
  return `<tr>
  <td style="padding:22px 24px;background:linear-gradient(160deg,rgba(0,212,255,0.14) 0%,rgba(57,255,20,0.06) 55%,rgba(10,18,32,0.95) 100%);border-top:1px solid rgba(0,212,255,0.2);border-bottom:1px solid rgba(57,255,20,0.12);">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7ee8ff;font-weight:700;">${escapeHtml(eyebrow)}</p>
    ${intro}
    <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 14px;">
      <tr>
        <td style="border-radius:12px;background:#00d4ff;box-shadow:0 0 28px rgba(0,212,255,0.45);">
          <a href="${escapeHtml(trackingLink)}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:800;color:#030712;text-decoration:none;letter-spacing:0.02em;">
            Live-Status öffnen
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;color:#64748b;text-align:center;line-height:1.5;">
      Oder kopieren Sie diesen Link:<br/>
      <a href="${escapeHtml(trackingLink)}" style="color:#39ff14;word-break:break-all;text-decoration:underline;">${escapeHtml(trackingLink)}</a>
    </p>
  </td>
</tr>`;
}

function emailGreeting(kundenname: string): string {
  return `<tr><td style="padding:22px 24px 6px;">
    <p style="margin:0;font-size:15px;line-height:1.65;color:#e2e8f0;">Hallo <strong style="color:#f8fafc;">${escapeHtml(kundenname)}</strong>,</p>
  </td></tr>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nlToBr(s: string): string {
  return escapeHtml(s).replace(/\r\n/g, "<br/>").replace(/\n/g, "<br/>");
}

const RAILWAY_SMTP_HINT =
  "Railway Hobby/Free: ausgehendes SMTP zu Gmail ist oft gesperrt (Timeout). Lösung: RABBIT_RESEND_API_KEY (HTTPS, resend.com) oder Railway Pro für SMTP.";

/**
 * Resend: Absender muss eine bei Resend verifizierte Domain nutzen (@gmail.com geht nicht).
 * Ohne RABBIT_RESEND_FROM: Resend-Testadresse (Onboarding).
 */
function resolveResendFrom(): string {
  const explicit = process.env.RABBIT_RESEND_FROM?.trim();
  if (explicit) return explicit;
  return "Rabbit-Technik <onboarding@resend.dev>";
}

export type MailFileAttachment = { filename: string; path: string };

async function sendViaResend(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailFileAttachment[];
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RABBIT_RESEND_API_KEY!.trim();
  const from = resolveResendFrom();
  const payload: Record<string, unknown> = {
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.attachments?.length) {
    payload.attachments = opts.attachments.map((a) => ({
      filename: a.filename,
      content: fs.readFileSync(a.path).toString("base64"),
    }));
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const errJson = (await r.json().catch(() => ({}))) as { message?: string };
  if (!r.ok) {
    return { sent: false, reason: errJson.message ?? `${r.status} ${r.statusText}` };
  }
  return { sent: true };
}

async function sendSmtp(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailFileAttachment[];
}): Promise<{ sent: boolean; reason?: string }> {
  if (isResendConfigured()) {
    try {
      return await sendViaResend(opts);
    } catch (e) {
      return { sent: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  if (!isSmtpConfigured()) {
    const miss = smtpMissingVars().join(", ");
    return {
      sent: false,
      reason: `Kein Versand: weder RABBIT_RESEND_API_KEY noch vollständiges SMTP (${miss}). ${RAILWAY_SMTP_HINT} Siehe server/.env.example`,
    };
  }

  const from = process.env.RABBIT_SMTP_FROM!.trim();
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        path: a.path,
        contentType: "application/pdf",
      })),
    });
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|ETIMEDOUT|timed out/i.test(msg)) {
      return { sent: false, reason: `${msg} — ${RAILWAY_SMTP_HINT}` };
    }
    return { sent: false, reason: msg };
  }
}

/** Probed-Mail (nur manuell / geschützter Endpunkt aufrufen). */
export async function sendTestProbeEmail(to: string): Promise<{ sent: boolean; reason?: string }> {
  const subject = `E-Mail-Test – ${COMPANY.name}`;
  const text = `Dies ist eine Test-E-Mail vom Rabbit-Technik Server.

Wenn Sie diese Nachricht lesen, funktioniert der Versand (Resend oder SMTP).

${textFooter()}`;
  const inner = `${emailGreeting("Test")}
<tr><td style="padding:6px 24px 18px;">
  <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#cbd5e1;">Dies ist eine <strong style="color:#00d4ff;">Test-E-Mail</strong> vom Server.</p>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#94a3b8;">Wenn Sie diese Nachricht lesen, funktioniert der Versand (Resend oder SMTP) zuverlässig.</p>
</td></tr>`;
  const html = wrapCustomerEmailHtml(inner, "E-Mail-Test Rabbit-Technik");
  try {
    const r = await sendSmtp({ to, subject, text, html });
    if (!r.sent) return r;
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 1. Reparaturannahme (nach Unterschrift am Tablet) */
export async function sendRepairAcceptedEmail(opts: {
  to: string;
  kundenname: string;
  geraetetyp: string;
  marke: string;
  modell: string;
  fehlerbeschreibung: string;
  vorschaeden: string;
  zubehoer: string;
  preisEuro: string;
  trackingLink: string;
  /** PDF-Auftragsbestätigung mit Unterschrift (optional) */
  attachments?: MailFileAttachment[];
}): Promise<{ sent: boolean; reason?: string }> {
  const {
    kundenname,
    geraetetyp,
    marke,
    modell,
    fehlerbeschreibung,
    vorschaeden,
    zubehoer,
    preisEuro,
    trackingLink,
  } = opts;

  const subject = `Reparatur angenommen – ${COMPANY.name}`;

  const text = `Hallo ${kundenname},

vielen Dank für Ihr Vertrauen in ${COMPANY.name}.

Wir bestätigen hiermit die Annahme Ihres Geräts zur Reparatur.

Gerät:
${geraetetyp} – ${marke} ${modell}

Fehlerbeschreibung:
${fehlerbeschreibung}

Festgestellte Vorschäden:
${vorschaeden}

Abgegebenes Zubehör:
${zubehoer}

Aktueller Status:
Reparatur angenommen

Voraussichtliche Kosten (aktuell):
${preisEuro} €

Hinweis: Der endgültige Preis kann sich ändern, falls während der Diagnose weitere Schäden festgestellt werden.

Im Anhang finden Sie Ihre Auftragsbestätigung als PDF (inkl. Unterschrift, sofern erfasst).

Reparaturstatus verfolgen:
Scannen Sie einfach den QR-Code oder klicken Sie auf den folgenden Link:

${trackingLink}

Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.

${textFooter()}`;

  const inner = `${emailGreeting(kundenname)}
<tr><td style="padding:6px 24px 14px;">
  <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#cbd5e1;">
    vielen Dank für Ihr Vertrauen in <strong style="color:#00d4ff;">${escapeHtml(COMPANY.name)}</strong>.
    Wir bestätigen die <strong style="color:#f8fafc;">Annahme Ihres Geräts</strong> zur Reparatur.
  </p>
</td></tr>
${emailContentBlock("Gerät", `<p style="margin:0;">${nlToBr(`${geraetetyp} – ${marke} ${modell}`)}</p>`)}
${emailContentBlock("Fehlerbeschreibung", `<p style="margin:0;">${nlToBr(fehlerbeschreibung)}</p>`)}
${emailContentBlock("Festgestellte Vorschäden", `<p style="margin:0;">${nlToBr(vorschaeden)}</p>`)}
${emailContentBlock("Abgegebenes Zubehör", `<p style="margin:0;">${nlToBr(zubehoer)}</p>`)}
<tr><td style="padding:8px 24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;border:1px solid rgba(57,255,20,0.25);background:rgba(57,255,20,0.06);">
    <tr><td style="padding:14px 16px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#86efac;font-weight:700;">Aktueller Status</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:#f0fdf4;">Reparatur angenommen</p>
    </td></tr>
  </table>
</td></tr>
${emailContentBlock(
    "Voraussichtliche Kosten (aktuell)",
    `<p style="margin:0;"><span style="font-size:20px;font-weight:800;color:#00d4ff;">${escapeHtml(preisEuro)} €</span></p>
     <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">Hinweis: Der endgültige Preis kann sich ändern, falls während der Diagnose weitere Schäden festgestellt werden.</p>`
  )}
<tr><td style="padding:12px 24px 8px;">
  <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.55;">
    <span style="color:#7ee8ff;font-weight:600;">Anhang:</span> Auftragsbestätigung als PDF (inkl. Unterschrift, sofern erfasst). Den QR-Code auf dem Auftrag können Sie jederzeit scannen.
  </p>
</td></tr>
${emailTrackingHero(
    trackingLink,
    "Ihr persönlicher Auftragslink",
    "Hier sehen Sie den Live-Status, Teile-Lieferungen und alle Updates zu Ihrer Reparatur – übersichtlich und jederzeit abrufbar."
  )}
<tr><td style="padding:16px 24px 22px;">
  <p style="margin:0;font-size:14px;color:#94a3b8;">Bei Fragen erreichen Sie uns telefonisch oder per E-Mail – wir helfen gern weiter.</p>
</td></tr>`;
  const html = wrapCustomerEmailHtml(inner, `Reparatur angenommen – ${COMPANY.name}`);

  return sendSmtp({
    to: opts.to,
    subject,
    text,
    html,
    attachments: opts.attachments,
  });
}

/** 2. Statusupdate (Teile / Bearbeitung) */
export async function sendRepairStatusUpdateEmail(opts: {
  to: string;
  kundenname: string;
  geraetetyp: string;
  marke: string;
  modell: string;
  statusAnzeige: string;
  teileListe: string;
  trackingLink: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { kundenname, geraetetyp, marke, modell, statusAnzeige, teileListe, trackingLink } = opts;
  const subject = `Update zu Ihrer Reparatur – ${COMPANY.name}`;

  const text = `Hallo ${kundenname},

es gibt ein Update zu Ihrer Reparatur.

Gerät:
${geraetetyp} – ${marke} ${modell}

Aktueller Status:
${statusAnzeige}

Ersatzteile (falls vorhanden):
${teileListe}

Den aktuellen Stand und alle Ersatzteile sehen Sie unter Ihrem persönlichen Link.
Bei Rückfragen erreichen Sie uns telefonisch oder per E-Mail.

Status jederzeit live verfolgen:
${trackingLink}

Vielen Dank für Ihr Vertrauen.

${textFooter()}`;

  const inner = `${emailGreeting(kundenname)}
<tr><td style="padding:6px 24px 10px;">
  <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#cbd5e1;">
    es gibt ein <strong style="color:#00d4ff;">Update</strong> zu Ihrer Reparatur – Teile, Status oder Bearbeitung haben sich verändert.
  </p>
</td></tr>
${emailContentBlock("Gerät", `<p style="margin:0;">${nlToBr(`${geraetetyp} – ${marke} ${modell}`)}</p>`)}
<tr><td style="padding:8px 24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;border:1px solid rgba(0,212,255,0.35);background:rgba(0,212,255,0.08);">
    <tr><td style="padding:14px 16px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#7ee8ff;font-weight:700;">Aktueller Status</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:#f8fafc;line-height:1.45;">${nlToBr(statusAnzeige)}</p>
    </td></tr>
  </table>
</td></tr>
${emailContentBlock("Ersatzteile", `<p style="margin:0;">${nlToBr(teileListe)}</p>`)}
<tr><td style="padding:8px 24px 4px;">
  <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.55;">Den vollständigen Stand und alle Details sehen Sie unter Ihrem persönlichen Link. Bei Rückfragen sind wir für Sie da.</p>
</td></tr>
${emailTrackingHero(
    trackingLink,
    "Live einsehen",
    "Ein Klick genügt – aktuelle Infos zu Ihrem Auftrag, übersichtlich dargestellt."
  )}
<tr><td style="padding:16px 24px 22px;">
  <p style="margin:0;font-size:14px;color:#cbd5e1;">Vielen Dank für Ihr Vertrauen in <strong style="color:#39ff14;">${escapeHtml(COMPANY.name)}</strong>.</p>
</td></tr>`;
  const html = wrapCustomerEmailHtml(inner, `Reparatur-Update – ${COMPANY.name}`);

  return sendSmtp({ to: opts.to, subject, text, html });
}

/** 3. Fertigstellung & Abholung */
export async function sendRepairReadyEmail(opts: {
  to: string;
  kundenname: string;
  geraetetyp: string;
  marke: string;
  modell: string;
  reparaturDetails: string;
  endpreisEuro: string;
  trackingLink: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { kundenname, geraetetyp, marke, modell, reparaturDetails, endpreisEuro, trackingLink } = opts;
  const subject = `Ihre Reparatur ist fertig – ${COMPANY.name}`;

  const text = `Hallo ${kundenname},

gute Nachrichten – Ihre Reparatur ist abgeschlossen!

Gerät:
${geraetetyp} – ${marke} ${modell}

Durchgeführte Arbeiten:
${reparaturDetails}

Endpreis:
${endpreisEuro} €

Abholung:
Ihr Gerät ist ab sofort zur Abholung bereit.

Adresse:
${COMPANY.name}
${COMPANY.street}
${COMPANY.zipCity}

Bitte bringen Sie nach Möglichkeit den Abholschein oder Ihren Namen zur Identifikation mit.

Zahlung: Bar, Kartenzahlung (SumUp) oder – nur falls mit uns vereinbart – Überweisung; die Abwicklung erfolgt bei Abholung bzw. nach Absprache (keine pauschale 7-Tage-Überweisungspflicht).

Reparaturdetails einsehen:
${trackingLink}

Vielen Dank für Ihr Vertrauen!

Mit freundlichen Grüßen
${COMPANY.name}

Telefon: ${COMPANY.phone}
E-Mail: ${COMPANY.email}`;

  const inner = `${emailGreeting(kundenname)}
<tr><td style="padding:6px 24px 12px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;border:1px solid rgba(57,255,20,0.4);background:linear-gradient(135deg,rgba(57,255,20,0.12) 0%,rgba(0,212,255,0.08) 100%);">
    <tr><td style="padding:16px 18px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-weight:700;">Fertig</p>
      <p style="margin:0;font-size:18px;font-weight:800;color:#f0fdf4;line-height:1.35;">Gute Nachrichten – Ihre Reparatur ist abgeschlossen!</p>
    </td></tr>
  </table>
</td></tr>
${emailContentBlock("Gerät", `<p style="margin:0;">${nlToBr(`${geraetetyp} – ${marke} ${modell}`)}</p>`)}
${emailContentBlock("Durchgeführte Arbeiten", `<p style="margin:0;">${nlToBr(reparaturDetails)}</p>`)}
<tr><td style="padding:8px 24px;">
  <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#7ee8ff;font-weight:700;">Endpreis</p>
  <p style="margin:0;font-size:24px;font-weight:800;color:#00d4ff;">${escapeHtml(endpreisEuro)} €</p>
</td></tr>
${emailContentBlock(
    "Abholung",
    `<p style="margin:0 0 10px;">Ihr Gerät ist <strong style="color:#f8fafc;">ab sofort zur Abholung bereit</strong>.</p>
     <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.55;">
       <strong style="color:#cbd5e1;">Adresse:</strong><br/>
       ${escapeHtml(COMPANY.name)}<br/>
       ${escapeHtml(COMPANY.street)}<br/>
       ${escapeHtml(COMPANY.zipCity)}
     </p>
     <p style="margin:12px 0 0;font-size:12px;color:#64748b;">Bitte bringen Sie nach Möglichkeit den Abholschein oder Ihren Namen zur Identifikation mit.</p>
     <p style="margin:14px 0 0;font-size:12px;line-height:1.55;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">
       <strong style="color:#7ee8ff;">Zahlung:</strong> Bar, Kartenzahlung (SumUp) oder – nur bei Vereinbarung – Überweisung; bei Abholung in der Werkstatt. Keine pauschale 7-Tage-Überweisungspflicht.
     </p>`
  )}
${emailTrackingHero(
    trackingLink,
    "Details & Übersicht",
    "Hier sehen Sie die abschließende Übersicht zu Ihrer Reparatur – jederzeit abrufbar."
  )}
<tr><td style="padding:16px 24px 22px;">
  <p style="margin:0;font-size:15px;color:#e2e8f0;">Vielen Dank für Ihr Vertrauen!</p>
</td></tr>`;
  const html = wrapCustomerEmailHtml(inner, `Reparatur fertig – ${COMPANY.name}`);

  return sendSmtp({ to: opts.to, subject, text, html });
}

/** Server-Logs für Reparatur-Mails (Promise lehnt nur bei echten Exceptions ab, nicht bei `{ sent: false }`). */
export function logMailOutcome(
  kind: string,
  trackingCode: string,
  recipient: string | null | undefined,
  result: Promise<{ sent: boolean; reason?: string }>
): void {
  void result
    .then((r) => {
      if (r.sent) {
        console.log(`[mail] ${kind} gesendet → ${recipient ?? "?"} [${trackingCode}]`);
      } else {
        console.error(`[mail] ${kind} fehlgeschlagen [${trackingCode}]: ${r.reason ?? "unbekannt"}`);
      }
    })
    .catch((err) => {
      console.error(`[mail] ${kind} Exception [${trackingCode}]:`, err);
    });
}
