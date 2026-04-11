import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schemaText.js";
import { getDbFilePath } from "../lib/dataPaths.js";

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
  return db;
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
