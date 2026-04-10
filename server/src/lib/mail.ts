import dns from "node:dns";
import nodemailer from "nodemailer";
import type { TransportOptions } from "nodemailer";

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

export function publicTrackingUrl(trackingCode: string): string {
  const base = process.env.PUBLIC_TRACKING_URL ?? "http://localhost:5173";
  return `${base.replace(/\/$/, "")}/track/${encodeURIComponent(trackingCode)}`;
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
    in_reparatur: "Reparatur in Bearbeitung",
    fertig: "Fertig zur Abholung",
    abgeholt: "Abgeholt",
  };
  return m[status] ?? status.replace(/_/g, " ");
}

const PART_STATUS_DE: Record<string, string> = {
  bestellt: "bestellt",
  unterwegs: "unterwegs",
  angekommen: "angekommen",
  eingebaut: "eingebaut",
};

export function formatTeileListe(
  parts: { name: string; status: string }[]
): string {
  if (!parts.length) return "—";
  return parts
    .map((p) => {
      const st = PART_STATUS_DE[p.status] ?? p.status;
      return `${p.name} – ${st}`;
    })
    .join("\n");
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

function htmlFooter(): string {
  return `<p>Mit freundlichen Grüßen<br/><strong>${escapeHtml(COMPANY.name)}</strong></p>
<p style="font-size:13px;color:#444;">${escapeHtml(COMPANY.street)}<br/>${escapeHtml(COMPANY.zipCity)}<br/>
Telefon: ${escapeHtml(COMPANY.phone)}<br/>
E-Mail: <a href="mailto:${escapeHtml(COMPANY.email)}">${escapeHtml(COMPANY.email)}</a></p>`;
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

async function sendViaResend(opts: { to: string; subject: string; text: string; html: string }): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RABBIT_RESEND_API_KEY!.trim();
  const from = resolveResendFrom();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  const body = (await r.json().catch(() => ({}))) as { message?: string };
  if (!r.ok) {
    return { sent: false, reason: body.message ?? `${r.status} ${r.statusText}` };
  }
  return { sent: true };
}

async function sendSmtp(opts: { to: string; subject: string; text: string; html: string }): Promise<{ sent: boolean; reason?: string }> {
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
  const html = `<p>Dies ist eine <strong>Test-E-Mail</strong> vom Rabbit-Technik Server.</p>
<p>Wenn Sie diese Nachricht lesen, funktioniert der Versand (Resend oder SMTP).</p>
${htmlFooter()}`;
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

Reparaturstatus verfolgen:
Scannen Sie einfach den QR-Code oder klicken Sie auf den folgenden Link:

${trackingLink}

Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.

${textFooter()}`;

  const html = `<p>Hallo ${escapeHtml(kundenname)},</p>
<p>vielen Dank für Ihr Vertrauen in <strong>${escapeHtml(COMPANY.name)}</strong>.</p>
<p>Wir bestätigen hiermit die Annahme Ihres Geräts zur Reparatur.</p>
<p><strong>Gerät:</strong><br/>${nlToBr(`${geraetetyp} – ${marke} ${modell}`)}</p>
<p><strong>Fehlerbeschreibung:</strong><br/>${nlToBr(fehlerbeschreibung)}</p>
<p><strong>Festgestellte Vorschäden:</strong><br/>${nlToBr(vorschaeden)}</p>
<p><strong>Abgegebenes Zubehör:</strong><br/>${nlToBr(zubehoer)}</p>
<p><strong>Aktueller Status:</strong> Reparatur angenommen</p>
<p><strong>Voraussichtliche Kosten (aktuell):</strong> ${escapeHtml(preisEuro)} €</p>
<p style="font-size:13px;color:#555;">Hinweis: Der endgültige Preis kann sich ändern, falls während der Diagnose weitere Schäden festgestellt werden.</p>
<p><strong>Reparaturstatus verfolgen:</strong><br/>
Scannen Sie den QR-Code auf Ihrem Auftrag oder nutzen Sie den Link:<br/>
<a href="${escapeHtml(trackingLink)}">${escapeHtml(trackingLink)}</a></p>
<p>Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.</p>
${htmlFooter()}`;

  return sendSmtp({ to: opts.to, subject, text, html });
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

Unsere Techniker arbeiten aktuell an Ihrem Gerät.
Sobald es fertig ist, informieren wir Sie umgehend.

Status jederzeit live verfolgen:
${trackingLink}

Vielen Dank für Ihre Geduld.

${textFooter()}`;

  const html = `<p>Hallo ${escapeHtml(kundenname)},</p>
<p>es gibt ein Update zu Ihrer Reparatur.</p>
<p><strong>Gerät:</strong><br/>${nlToBr(`${geraetetyp} – ${marke} ${modell}`)}</p>
<p><strong>Aktueller Status:</strong><br/>${nlToBr(statusAnzeige)}</p>
<p><strong>Ersatzteile (falls vorhanden):</strong><br/>${nlToBr(teileListe)}</p>
<p>Unsere Techniker arbeiten aktuell an Ihrem Gerät.<br/>
Sobald es fertig ist, informieren wir Sie umgehend.</p>
<p><strong>Status jederzeit live verfolgen:</strong><br/>
<a href="${escapeHtml(trackingLink)}">${escapeHtml(trackingLink)}</a></p>
<p>Vielen Dank für Ihre Geduld.</p>
${htmlFooter()}`;

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

Reparaturdetails einsehen:
${trackingLink}

Vielen Dank für Ihr Vertrauen!

Mit freundlichen Grüßen
${COMPANY.name}

Telefon: ${COMPANY.phone}
E-Mail: ${COMPANY.email}`;

  const html = `<p>Hallo ${escapeHtml(kundenname)},</p>
<p><strong>gute Nachrichten – Ihre Reparatur ist abgeschlossen!</strong></p>
<p><strong>Gerät:</strong><br/>${nlToBr(`${geraetetyp} – ${marke} ${modell}`)}</p>
<p><strong>Durchgeführte Arbeiten:</strong><br/>${nlToBr(reparaturDetails)}</p>
<p><strong>Endpreis:</strong> ${escapeHtml(endpreisEuro)} €</p>
<p><strong>Abholung:</strong><br/>
Ihr Gerät ist ab sofort zur Abholung bereit.</p>
<p><strong>Adresse:</strong><br/>
${escapeHtml(COMPANY.name)}<br/>
${escapeHtml(COMPANY.street)}<br/>
${escapeHtml(COMPANY.zipCity)}</p>
<p style="font-size:13px;">Bitte bringen Sie nach Möglichkeit den Abholschein oder Ihren Namen zur Identifikation mit.</p>
<p><strong>Reparaturdetails einsehen:</strong><br/>
<a href="${escapeHtml(trackingLink)}">${escapeHtml(trackingLink)}</a></p>
<p>Vielen Dank für Ihr Vertrauen!</p>
<p>Mit freundlichen Grüßen<br/><strong>${escapeHtml(COMPANY.name)}</strong></p>
<p style="font-size:13px;color:#444;">Telefon: ${escapeHtml(COMPANY.phone)}<br/>
E-Mail: <a href="mailto:${escapeHtml(COMPANY.email)}">${escapeHtml(COMPANY.email)}</a></p>`;

  return sendSmtp({ to: opts.to, subject, text, html });
}
