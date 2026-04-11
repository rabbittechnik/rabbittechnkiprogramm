import { backupIntervalMs, isAutomaticDataBackupWanted, runDataBackup } from "./dataBackup.js";

type BackupDb = Parameters<typeof runDataBackup>[0];

/**
 * Periodische Snapshots unter DATA/backups/ (SQLite + invoices + acceptance + uploads).
 * Aktiv, wenn Railway oder RABBIT_DATA_DIR / RABBIT_DB_PATH gesetzt, sofern nicht RABBIT_BACKUP_ENABLED=0.
 */
export function startDataBackupScheduler(db: BackupDb): void {
  if (!isAutomaticDataBackupWanted()) {
    console.log(
      "[backup] Automatische Snapshots aus (setze RABBIT_DATA_DIR oder deploy auf Railway mit /data-Volume; oder RABBIT_BACKUP_ENABLED=1)."
    );
    return;
  }
  const ms = backupIntervalMs();
  console.log(`[backup] Automatische Snapshots alle ${Math.round(ms / 3600000)} h unter backups/ (erster Lauf in 2 Min.)`);

  const tick = () => {
    void runDataBackup(db).then((r) => {
      if (r.ok) console.log(`[backup] Snapshot OK → ${r.dir}`);
      else console.error("[backup] Snapshot fehlgeschlagen:", r.error);
    });
  };

  setTimeout(() => {
    tick();
    setInterval(tick, ms);
  }, 120_000);
}
