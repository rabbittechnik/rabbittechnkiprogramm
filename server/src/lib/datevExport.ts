import type Database from "better-sqlite3";

/**
 * DATEV-Buchungsstapel-Export (CSV, Semikolon-getrennt, UTF-8 mit BOM).
 *
 * Nur lesender Zugriff – Originaldaten werden nicht verändert.
 *
 * Kontenrahmen SKR03/04 konfigurierbar über Umgebungsvariablen:
 *   RABBIT_DATEV_ERLOES_KONTO     – Erlöskonto          (Standard 8400)
 *   RABBIT_DATEV_KASSE_KONTO      – Kasse-Konto         (Standard 1000)
 *   RABBIT_DATEV_BANK_KONTO       – Bank-Konto           (Standard 1200)
 *   RABBIT_DATEV_GELDTRANSIT_KONTO– Geldtransit (SumUp)  (Standard 1360)
 *   RABBIT_DATEV_BERATER_NR       – Beraternummer        (Standard 0)
 *   RABBIT_DATEV_MANDANTEN_NR     – Mandantennummer      (Standard 1)
 *   RABBIT_DATEV_WJ_BEGINN        – Wirtschaftsjahr-Beginn MM (Standard 01)
 *
 * @see https://developer.datev.de/datev/platform/en/dtvf/formate/buchungsstapel
 */

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// DATEV account mapping
// ---------------------------------------------------------------------------

function erloeseKonto(): number {
  return envInt("RABBIT_DATEV_ERLOES_KONTO", 8400);
}
function kasseKonto(): number {
  return envInt("RABBIT_DATEV_KASSE_KONTO", 1000);
}
function bankKonto(): number {
  return envInt("RABBIT_DATEV_BANK_KONTO", 1200);
}
function geldtransitKonto(): number {
  return envInt("RABBIT_DATEV_GELDTRANSIT_KONTO", 1360);
}

function paymentMethodToKonto(method: string | null): number {
  switch (method) {
    case "bar":
      return kasseKonto();
    case "ueberweisung":
      return bankKonto();
    case "sumup":
      return geldtransitKonto();
    default:
      return bankKonto();
  }
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface DatevInvoiceRow {
  invoice_number: string;
  total_cents: number;
  document_kind: string;
  document_status: string;
  invoice_created_at: string;
  finalized_at: string | null;
  payment_status: string;
  payment_method: string | null;
  payment_paid_at: string | null;
  tracking_code: string;
  customer_name: string;
  references_invoice_number: string | null;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** DATEV-Betrag: positiv, Komma als Dezimaltrenner, kein Tausendertrenner. */
function datevAmount(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2).replace(".", ",");
}

/** Belegdatum: TTMM (4-stellig ohne Jahreszahl, wie DATEV es erwartet). */
function datevBelegdatum(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}`;
}

/** DATEV-konformes Datum YYYYMMDD für den Header. */
function datevHeaderDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Escape für DATEV-Textfelder: Anführungszeichen verdoppeln, Semikolons entfernen. */
function esc(s: string): string {
  return s.replace(/"/g, '""').replace(/;/g, ",").replace(/\r?\n/g, " ");
}

// ---------------------------------------------------------------------------
// CSV builder
// ---------------------------------------------------------------------------

function buildHeaderRows(from: string, to: string): string[] {
  const beraterNr = env("RABBIT_DATEV_BERATER_NR", "0");
  const mandantenNr = env("RABBIT_DATEV_MANDANTEN_NR", "1");
  const wjBeginn = env("RABBIT_DATEV_WJ_BEGINN", "01");
  const sachkontenLaenge = "4";
  const now = new Date();

  const row1 = [
    '"EXTF"',                              // 1  Kennzeichen
    "700",                                 // 2  Versionsnummer
    "21",                                  // 3  Datenkategorie (Buchungsstapel)
    '"Buchungsstapel"',                    // 4  Formatname
    "12",                                  // 5  Formatversion
    `${datevHeaderDate(now)}`,             // 6  Erzeugt am
    "",                                    // 7  Importiert am
    '"RE"',                                // 8  Herkunft (RE = Rechnungswesen)
    '""',                                  // 9  Exportiert von
    '""',                                  // 10 Importiert von
    `${beraterNr}`,                        // 11 Beraternummer
    `${mandantenNr}`,                      // 12 Mandantennummer
    `${from}`,                             // 13 WJ-Beginn (YYYYMMDD)
    sachkontenLaenge,                      // 14 Sachkontenlänge
    `${from}`,                             // 15 Datum von
    `${to}`,                               // 16 Datum bis
    '""',                                  // 17 Bezeichnung
    '""',                                  // 18 Diktatkürzel
    "1",                                   // 19 Buchungstyp (1 = Fibu)
    "0",                                   // 20 Rechnungslegungszweck
    "0",                                   // 21 Festschreibung
    '"EUR"',                               // 22 WKZ
    "",                                    // 23 reserviert
    "",                                    // 24 Derivatskennzeichen
    "",                                    // 25 reserviert
    "",                                    // 26 reserviert
    `${wjBeginn}`,                         // 27 SKR (WJ-Beginn Monat)
  ];

  return [row1.join(";")];
}

const COLUMN_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
  "Postensperre",
  "Diverse Adressnummer",
  "Geschäftspartnerbank",
  "Sachverhalt",
  "Zinssperre",
  "Beleglink",
].map((h) => `"${h}"`);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DatevExportOptions {
  from: string;   // YYYY-MM-DD
  to: string;     // YYYY-MM-DD
}

export interface DatevExportResult {
  csv: string;
  filename: string;
  rowCount: number;
  periodFrom: string;
  periodTo: string;
}

/**
 * Erstellt einen DATEV-Buchungsstapel-Export als CSV-String (UTF-8 mit BOM).
 * Rein lesend – keine Änderung an der Datenbank.
 */
export function generateDatevExport(
  db: Database.Database,
  opts: DatevExportOptions
): DatevExportResult {
  const { from, to } = opts;

  const rows = db
    .prepare(
      `SELECT
         i.invoice_number,
         i.total_cents,
         i.document_kind,
         i.document_status,
         i.created_at   AS invoice_created_at,
         i.finalized_at,
         i.payment_status,
         r.payment_method,
         r.payment_paid_at,
         r.tracking_code,
         c.name          AS customer_name,
         ref.invoice_number AS references_invoice_number
       FROM invoices i
       JOIN repairs  r   ON r.id = i.repair_id
       JOIN customers c  ON c.id = r.customer_id
       LEFT JOIN invoices ref ON ref.id = i.references_invoice_id
       WHERE date(i.created_at) BETWEEN ? AND ?
         AND r.is_test = 0
       ORDER BY datetime(i.created_at) ASC`
    )
    .all(from, to) as DatevInvoiceRow[];

  const headerFrom = from.replace(/-/g, "");
  const headerTo = to.replace(/-/g, "");
  const lines: string[] = [];

  lines.push(...buildHeaderRows(headerFrom, headerTo));
  lines.push(COLUMN_HEADERS.join(";"));

  let rowCount = 0;
  for (const inv of rows) {
    const amountCents = inv.total_cents;
    if (amountCents === 0) continue;

    const isStorno = inv.document_kind === "storno";
    const isKorrektur = inv.document_kind === "korrektur";
    const isCredit = amountCents < 0;

    const sollHaben = isCredit ? "H" : "S";
    const konto = paymentMethodToKonto(inv.payment_method);
    const gegenKonto = erloeseKonto();

    const belegDatum = datevBelegdatum(inv.finalized_at ?? inv.invoice_created_at);
    const belegfeld1 = esc(inv.invoice_number);

    let buchungstext = `${esc(inv.customer_name)} / ${esc(inv.tracking_code)}`;
    if (isStorno && inv.references_invoice_number) {
      buchungstext = `Storno zu ${esc(inv.references_invoice_number)} / ${esc(inv.customer_name)}`;
    } else if (isKorrektur && inv.references_invoice_number) {
      buchungstext = `Korrektur zu ${esc(inv.references_invoice_number)} / ${esc(inv.customer_name)}`;
    }
    if (buchungstext.length > 60) buchungstext = buchungstext.slice(0, 60);

    const belegfeld2 = inv.payment_paid_at
      ? datevBelegdatum(inv.payment_paid_at)
      : "";

    const fields = [
      datevAmount(amountCents),  // 1  Umsatz
      `"${sollHaben}"`,          // 2  S/H
      '"EUR"',                   // 3  WKZ
      "",                        // 4  Kurs
      "",                        // 5  Basis-Umsatz
      "",                        // 6  WKZ Basis-Umsatz
      String(konto),             // 7  Konto
      String(gegenKonto),        // 8  Gegenkonto
      "",                        // 9  BU-Schlüssel
      belegDatum,                // 10 Belegdatum
      `"${belegfeld1}"`,         // 11 Belegfeld 1
      belegfeld2 ? `"${belegfeld2}"` : "", // 12 Belegfeld 2
      "",                        // 13 Skonto
      `"${buchungstext}"`,       // 14 Buchungstext
      "",                        // 15 Postensperre
      "",                        // 16 Diverse Adressnummer
      "",                        // 17 GP-Bank
      "",                        // 18 Sachverhalt
      "",                        // 19 Zinssperre
      "",                        // 20 Beleglink
    ];

    lines.push(fields.join(";"));
    rowCount++;
  }

  const BOM = "\uFEFF";
  const csv = BOM + lines.join("\r\n") + "\r\n";

  const safeFrom = from.replace(/-/g, "");
  const safeTo = to.replace(/-/g, "");
  const filename = `EXTF_Buchungsstapel_${safeFrom}_${safeTo}.csv`;

  return { csv, filename, rowCount, periodFrom: from, periodTo: to };
}

/**
 * Zusammenfassung für den Zeitraum (Vorschau, kein CSV).
 */
export function datevExportPreview(
  db: Database.Database,
  opts: DatevExportOptions
): {
  periodFrom: string;
  periodTo: string;
  invoiceCount: number;
  totalCents: number;
  paidCents: number;
  openCents: number;
  paymentMethods: Record<string, number>;
} {
  const { from, to } = opts;

  const rows = db
    .prepare(
      `SELECT
         i.total_cents,
         r.payment_status,
         r.payment_method
       FROM invoices i
       JOIN repairs r ON r.id = i.repair_id
       WHERE i.document_kind = 'rechnung'
         AND date(i.created_at) BETWEEN ? AND ?
         AND r.is_test = 0`
    )
    .all(from, to) as {
    total_cents: number;
    payment_status: string;
    payment_method: string | null;
  }[];

  let totalCents = 0;
  let paidCents = 0;
  let openCents = 0;
  const methods: Record<string, number> = {};

  for (const r of rows) {
    totalCents += r.total_cents;
    if (r.payment_status === "bezahlt") paidCents += r.total_cents;
    else openCents += r.total_cents;
    const m = r.payment_method ?? "unbekannt";
    methods[m] = (methods[m] ?? 0) + r.total_cents;
  }

  return {
    periodFrom: from,
    periodTo: to,
    invoiceCount: rows.length,
    totalCents,
    paidCents,
    openCents,
    paymentMethods: methods,
  };
}
