import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Persistenter Datenordner (SQLite, Uploads, Rechnungs-/Annahme-PDFs, Backups).
 * Produktion: Volume auf `/data` mounten und idealerweise `RABBIT_DATA_DIR=/data` setzen.
 * Auf Railway: wenn `RAILWAY_*` gesetzt ist, `/data` existiert und beschreibbar ist, wird es ohne explizite Variable verwendet (Deploy-Image bleibt flüchtig).
 */
export function getDataRoot(): string {
  const fromEnv = process.env.RABBIT_DATA_DIR?.trim();
  if (fromEnv) {
    const root = path.resolve(fromEnv);
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    return root;
  }
  if (process.env.RAILWAY_ENVIRONMENT?.trim() && fs.existsSync("/data")) {
    try {
      fs.accessSync("/data", fs.constants.W_OK);
      const root = path.resolve("/data");
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
      return root;
    } catch {
      /* nicht beschreibbar → Projekt-data */
    }
  }
  const root = path.resolve(__dirname, "../../data");
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

export function networkOrdersDir(): string {
  const d = path.join(getDataRoot(), "network-orders");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
