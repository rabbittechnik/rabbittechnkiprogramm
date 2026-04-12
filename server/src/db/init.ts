import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schemaText.js";
import { getDbFilePath } from "../lib/dataPaths.js";
import { recalculateAllRegisterBalances } from "../lib/registerBalance.js";
import { berlinCalendarYear } from "../lib/repairOrderSequence.js";

/** @deprecated Nutze `getDbFilePath` aus `lib/dataPaths` – bleibt für Kompatibilität. */
export function getDbPath(): string {
  return getDbFilePath();
}

export function openDatabase(): Database.Database {
  const dbPath = getDbFilePath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  migrateRepairsAcceptanceColumn(db);
  migrateRepairPartsBarcode(db);
  migrateRepairsPaymentDueAt(db);
  migrateRepairsPaymentMethod(db);
  migrateRepairsSumupCheckout(db);
  migrateRepairsSumupTerminal(db);
  migrateInvoicesGobd(db);
  migrateTagesabschluesse(db);
  migrateMonatsberichte(db);
  migrateAppSettingsAndRegister(db);
  migrateRepairsTestFlag(db);
  migrateServicesCategory(db);
  migrateHardwareCatalogOrders(db);
  migrateRepairOrderPdf(db);
  return db;
}

function migrateAppSettingsAndRegister(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const cols = db.prepare(`PRAGMA table_info(tagesabschluesse)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "register_balance_eod_cents")) {
    db.exec(`ALTER TABLE tagesabschluesse ADD COLUMN register_balance_eod_cents INTEGER`);
  }
  recalculateAllRegisterBalances(db);
}

function migrateTagesabschluesse(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tagesabschluesse (
      id TEXT PRIMARY KEY,
      business_date TEXT NOT NULL UNIQUE,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_cents INTEGER NOT NULL,
      bar_cents INTEGER NOT NULL DEFAULT 0,
      online_sumup_cents INTEGER NOT NULL DEFAULT 0,
      tap_to_pay_cents INTEGER NOT NULL DEFAULT 0,
      ueberweisung_cents INTEGER NOT NULL DEFAULT 0,
      other_cents INTEGER NOT NULL DEFAULT 0,
      invoice_count INTEGER NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      transactions_json TEXT NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tagesabschluesse_date ON tagesabschluesse(business_date DESC)`);
}

function migrateMonatsberichte(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monatsberichte (
      id TEXT PRIMARY KEY,
      year_month TEXT NOT NULL UNIQUE,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_cents INTEGER NOT NULL,
      bar_cents INTEGER NOT NULL DEFAULT 0,
      online_sumup_cents INTEGER NOT NULL DEFAULT 0,
      tap_to_pay_cents INTEGER NOT NULL DEFAULT 0,
      ueberweisung_cents INTEGER NOT NULL DEFAULT 0,
      other_cents INTEGER NOT NULL DEFAULT 0,
      invoice_count INTEGER NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      parts_purchase_cents INTEGER NOT NULL DEFAULT 0,
      gross_profit_cents INTEGER NOT NULL,
      overview_json TEXT NOT NULL,
      transactions_json TEXT NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_monatsberichte_ym ON monatsberichte(year_month DESC)`);
}

/** GoBD: Rechnungsdokumente, Finalisierung, Storno/Korrektur-Ketten (keine zweite Kern-DB). */
function migrateInvoicesGobd(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(invoices)`).all() as { name: string }[];
  if (cols.some((c) => c.name === "document_status")) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_rechnung_per_repair ON invoices(repair_id) WHERE document_kind = 'rechnung'`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_repair_kind ON invoices(repair_id, document_kind)`);
    return;
  }

  db.exec(`PRAGMA foreign_keys = OFF`);
  db.exec(`
    CREATE TABLE invoices_new (
      id TEXT PRIMARY KEY,
      repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL UNIQUE,
      pdf_path TEXT,
      total_cents INTEGER NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'offen',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      document_status TEXT NOT NULL DEFAULT 'entwurf',
      document_kind TEXT NOT NULL DEFAULT 'rechnung',
      finalized_at TEXT,
      retention_until TEXT,
      pdf_sha256 TEXT,
      references_invoice_id TEXT
    );
  `);
  db.exec(`
    INSERT INTO invoices_new (
      id, repair_id, invoice_number, pdf_path, total_cents, payment_status, created_at,
      document_status, document_kind, finalized_at, retention_until, pdf_sha256, references_invoice_id
    )
    SELECT
      i.id,
      i.repair_id,
      i.invoice_number,
      i.pdf_path,
      i.total_cents,
      i.payment_status,
      i.created_at,
      CASE WHEN r.status IN ('fertig', 'abgeholt') THEN 'final' ELSE 'entwurf' END,
      'rechnung',
      CASE WHEN r.status IN ('fertig', 'abgeholt') THEN COALESCE(i.created_at, datetime('now')) ELSE NULL END,
      CASE
        WHEN r.status IN ('fertig', 'abgeholt') THEN datetime(COALESCE(i.created_at, datetime('now')), '+10 years')
        ELSE NULL
      END,
      NULL,
      NULL
    FROM invoices i
    JOIN repairs r ON r.id = i.repair_id;
  `);
  db.exec(`DROP TABLE invoices`);
  db.exec(`ALTER TABLE invoices_new RENAME TO invoices`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_rechnung_per_repair ON invoices(repair_id) WHERE document_kind = 'rechnung'`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_repair_kind ON invoices(repair_id, document_kind)`);
  db.exec(`PRAGMA foreign_keys = ON`);
}

function migrateRepairsTestFlag(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "is_test")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`);
  }
}

function migrateServicesCategory(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(services)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "category")) {
    db.exec(`ALTER TABLE services ADD COLUMN category TEXT NOT NULL DEFAULT 'sonstiges'`);
  }
}

/** Fortlaufende Auftragsnummer R-JJJJ-NNNNNN + PDF-Pfade. */
function migrateRepairOrderPdf(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repair_order_sequences (
      year TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL
    )
  `);
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "repair_order_number")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN repair_order_number TEXT`);
  }
  if (!cols.some((c) => c.name === "repair_order_pdf_path")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN repair_order_pdf_path TEXT`);
  }
  if (!cols.some((c) => c.name === "repair_order_label_pdf_path")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN repair_order_label_pdf_path TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_order_number ON repairs(repair_order_number) WHERE repair_order_number IS NOT NULL`);

  const missing = db
    .prepare(`SELECT id, created_at FROM repairs WHERE repair_order_number IS NULL ORDER BY datetime(created_at)`)
    .all() as { id: string; created_at: string }[];
  if (missing.length) {
    const maxByYear = new Map<string, number>();
    for (const row of missing) {
      const yMatch = row.created_at?.match(/^(\d{4})/);
      const year = yMatch?.[1] ?? berlinCalendarYear();
      const next = (maxByYear.get(year) ?? 0) + 1;
      maxByYear.set(year, next);
      const ord = `R-${year}-${String(next).padStart(6, "0")}`;
      db.prepare(`UPDATE repairs SET repair_order_number = ? WHERE id = ?`).run(ord, row.id);
    }
    for (const [year, last] of maxByYear) {
      const existing = db.prepare(`SELECT last_seq FROM repair_order_sequences WHERE year = ?`).get(year) as
        | { last_seq: number }
        | undefined;
      const use = Math.max(existing?.last_seq ?? 0, last);
      db.prepare(`INSERT INTO repair_order_sequences (year, last_seq) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET last_seq = excluded.last_seq`).run(
        year,
        use
      );
    }
  }

  const allNums = db
    .prepare(`SELECT repair_order_number FROM repairs WHERE repair_order_number IS NOT NULL`)
    .all() as { repair_order_number: string }[];
  const hi = new Map<string, number>();
  for (const { repair_order_number: o } of allNums) {
    const m = o.match(/^R-(\d{4})-(\d+)$/);
    if (!m) continue;
    const yy = m[1];
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n)) continue;
    hi.set(yy, Math.max(hi.get(yy) ?? 0, n));
  }
  for (const [year, last] of hi) {
    const existing = db.prepare(`SELECT last_seq FROM repair_order_sequences WHERE year = ?`).get(year) as
      | { last_seq: number }
      | undefined;
    const use = Math.max(existing?.last_seq ?? 0, last);
    db.prepare(`INSERT INTO repair_order_sequences (year, last_seq) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET last_seq = excluded.last_seq`).run(
      year,
      use
    );
  }
}

function migrateHardwareCatalogOrders(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hardware_catalog_orders (
      id TEXT PRIMARY KEY,
      reference_code TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      status TEXT NOT NULL DEFAULT 'angebot',
      markup_bps INTEGER NOT NULL DEFAULT 1000,
      total_sale_cents INTEGER NOT NULL,
      total_purchase_cents INTEGER NOT NULL,
      signature_data_url TEXT,
      send_customer_email INTEGER NOT NULL DEFAULT 0,
      customer_email_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hardware_catalog_order_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES hardware_catalog_orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category_id TEXT NOT NULL,
      category_label TEXT NOT NULL,
      subcategory_id TEXT NOT NULL,
      subcategory_label TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_sale_cents INTEGER NOT NULL,
      unit_purchase_cents INTEGER NOT NULL,
      line_sale_cents INTEGER NOT NULL,
      line_purchase_cents INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hardware_orders_customer ON hardware_catalog_orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_hardware_orders_created ON hardware_catalog_orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hardware_order_lines_order ON hardware_catalog_order_lines(order_id);
  `);
}

function migrateRepairsAcceptanceColumn(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "acceptance_pdf_path")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN acceptance_pdf_path TEXT`);
  }
}

function migrateRepairPartsBarcode(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repair_parts)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "barcode")) {
    db.exec(`ALTER TABLE repair_parts ADD COLUMN barcode TEXT`);
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_parts_barcode_unique ON repair_parts(barcode) WHERE barcode IS NOT NULL`
  );
}

function migrateRepairsPaymentDueAt(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "payment_due_at")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN payment_due_at TEXT`);
  }
  db.exec(
    `UPDATE repairs SET payment_due_at = datetime(updated_at, '+7 days')
     WHERE payment_due_at IS NULL
       AND status IN ('fertig', 'abgeholt')
       AND payment_status = 'offen'`
  );
}

function migrateRepairsPaymentMethod(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "payment_method")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN payment_method TEXT`);
  }
}

function migrateRepairsSumupCheckout(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "sumup_checkout_id")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN sumup_checkout_id TEXT`);
  }
  if (!cols.some((c) => c.name === "sumup_checkout_url")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN sumup_checkout_url TEXT`);
  }
  if (!cols.some((c) => c.name === "payment_paid_at")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN payment_paid_at TEXT`);
  }
}

/** SumUp: Kanal online vs. Tap to Pay (Payment Switch / SumUp-App); Legacy-Spalten aus Reader-Phase. */
function migrateRepairsSumupTerminal(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(repairs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "sumup_channel")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN sumup_channel TEXT`);
  }
  if (!cols.some((c) => c.name === "sumup_terminal_foreign_id")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN sumup_terminal_foreign_id TEXT`);
  }
  if (!cols.some((c) => c.name === "sumup_terminal_client_transaction_id")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN sumup_terminal_client_transaction_id TEXT`);
  }
  if (!cols.some((c) => c.name === "sumup_foreign_tx_id")) {
    db.exec(`ALTER TABLE repairs ADD COLUMN sumup_foreign_tx_id TEXT`);
  }
  db.exec(
    `UPDATE repairs SET sumup_foreign_tx_id = sumup_terminal_foreign_id
     WHERE sumup_foreign_tx_id IS NULL AND sumup_terminal_foreign_id IS NOT NULL`
  );
  db.exec(`UPDATE repairs SET sumup_channel = 'tap_to_pay' WHERE sumup_channel = 'terminal'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_repairs_sumup_terminal_foreign ON repairs(sumup_terminal_foreign_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_repairs_sumup_foreign_tx ON repairs(sumup_foreign_tx_id)`);
}
