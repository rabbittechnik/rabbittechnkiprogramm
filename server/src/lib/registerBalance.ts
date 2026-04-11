import type Database from "better-sqlite3";

const KEY_OPENING = "kasse_opening_cents";

export function getRegisterOpeningCents(db: Database.Database): number {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY_OPENING) as { value: string } | undefined;
  if (!row) return 0;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) ? n : 0;
}

export function setRegisterOpeningCents(db: Database.Database, cents: number): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY_OPENING, String(Math.round(cents)));
}

/** Summe Bar aus bereits gespeicherten Abschlüssen vor businessYmd (YYYY-MM-DD, lexikographisch). */
export function sumBarCentsStrictlyBefore(db: Database.Database, businessYmd: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(bar_cents), 0) AS s FROM tagesabschluesse WHERE business_date < ?`)
    .get(businessYmd) as { s: number };
  return row.s;
}

export function computeRegisterBalanceEodForNewRow(
  db: Database.Database,
  businessYmd: string,
  barCents: number
): number {
  return getRegisterOpeningCents(db) + sumBarCentsStrictlyBefore(db, businessYmd) + barCents;
}

/** Alle Tage neu durchlaufen (z. B. nach Änderung des Anfangsbestands). */
export function recalculateAllRegisterBalances(db: Database.Database): void {
  const opening = getRegisterOpeningCents(db);
  const rows = db
    .prepare(`SELECT business_date, bar_cents FROM tagesabschluesse ORDER BY business_date ASC`)
    .all() as { business_date: string; bar_cents: number }[];
  let run = opening;
  const upd = db.prepare(`UPDATE tagesabschluesse SET register_balance_eod_cents = ? WHERE business_date = ?`);
  for (const r of rows) {
    run += r.bar_cents;
    upd.run(run, r.business_date);
  }
}
