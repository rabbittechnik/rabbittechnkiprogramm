import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Persistenter Datenordner (SQLite, Uploads, Rechnungs-/Annahme-PDFs).
 * Railway: Volume z. B. auf `/data` mounten und `RABBIT_DATA_DIR=/data` setzen.
 */
export function getDataRoot(): string {
  const fromEnv = process.env.RABBIT_DATA_DIR?.trim();
  const root = fromEnv ? path.resolve(fromEnv) : path.resolve(__dirname, "../../data");
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Voller Pfad zur SQLite-Datei. `RABBIT_DB_PATH` setzt eine einzelne Datei (überschreibt Standard unter data root).
 */
export function getDbFilePath(): string {
  const explicit = process.env.RABBIT_DB_PATH?.trim();
  if (explicit) {
    const p = path.resolve(explicit);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return p;
  }
  return path.join(getDataRoot(), "rabbit.db");
}

export function uploadsDir(): string {
  return path.join(getDataRoot(), "uploads");
}

export function invoicesDir(): string {
  const d = path.join(getDataRoot(), "invoices");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

export function acceptanceDir(): string {
  const d = path.join(getDataRoot(), "acceptance");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
