import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { acceptanceDir, getDataRoot, getDbFilePath, invoicesDir, uploadsDir } from "./dataPaths.js";

export type DataBackupResult = { ok: true; dir: string; at: string } | { ok: false; error: string };

/** Geplanter Snapshot: SQLite + PDF-/Upload-Ordner (Kunden, Aufträge, Rechnungen, Zahlungen, Abschlüsse liegen in der DB). */
export async function runDataBackup(db: Database.Database): Promise<DataBackupResult> {
  const root = getDataRoot();
  const at = new Date().toISOString();
  const stamp = at.replace(/[:.]/g, "-").slice(0, 19);
  const destDir = path.join(root, "backups", `backup-${stamp}`);
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const dbDest = path.join(destDir, "rabbit.db");
    const anyDb = db as unknown as { backup?: (p: string) => Promise<void> };
    try {
      if (typeof anyDb.backup === "function") {
        await anyDb.backup(dbDest);
      } else {
        throw new Error("backup() nicht verfügbar");
      }
    } catch {
      db.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(getDbFilePath(), dbDest);
    }
    for (const [name, abs] of [
      ["invoices", invoicesDir()],
      ["acceptance", acceptanceDir()],
      ["uploads", uploadsDir()],
    ] as const) {
      if (fs.existsSync(abs)) {
        fs.cpSync(abs, path.join(destDir, name), { recursive: true });
      }
    }
    pruneOldBackups(root);
    return { ok: true, dir: destDir, at };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg };
  }
}

export function pruneOldBackups(dataRoot: string, keep = defaultKeepCount()): void {
  const dir = path.join(dataRoot, "backups");
  if (!fs.existsSync(dir)) return;
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("backup-"))
    .map((d) => {
      const full = path.join(dir, d.name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (let i = keep; i < entries.length; i++) {
    try {
      fs.rmSync(entries[i].full, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function defaultKeepCount(): number {
  const n = parseInt(process.env.RABBIT_BACKUP_KEEP ?? "14", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 90) : 14;
}

/** Automatische Snapshots sinnvoll, sobald explizite Persistenz oder Railway erkannt wird. */
export function isAutomaticDataBackupWanted(): boolean {
  if (process.env.RABBIT_BACKUP_ENABLED === "0") return false;
  if (process.env.RABBIT_BACKUP_ENABLED === "1") return true;
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT?.trim() ||
      process.env.RABBIT_DATA_DIR?.trim() ||
      process.env.RABBIT_DB_PATH?.trim()
  );
}

export function backupIntervalMs(): number {
  const h = parseFloat(process.env.RABBIT_BACKUP_INTERVAL_HOURS ?? "24");
  const ms = Math.round((Number.isFinite(h) && h > 0 ? h : 24) * 3600 * 1000);
  return Math.min(Math.max(ms, 3600 * 1000), 168 * 3600 * 1000);
}
