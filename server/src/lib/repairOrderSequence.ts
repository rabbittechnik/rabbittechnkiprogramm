import type Database from "better-sqlite3";

/** Kalenderjahr (Europe/Berlin) für Auftragsnummer-Präfix R-JJJJ-… */
export function berlinCalendarYear(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric" }).format(d);
}

/** Nächste laufende Nummer für das Jahr; muss innerhalb derselben DB-Transaktion wie `INSERT repairs` aufgerufen werden. */
export function allocateRepairOrderNumber(db: Database.Database, year: string): string {
  db.prepare(
    `INSERT INTO repair_order_sequences (year, last_seq) VALUES (?, 1)
     ON CONFLICT(year) DO UPDATE SET last_seq = last_seq + 1`
  ).run(year);
  const row = db.prepare(`SELECT last_seq FROM repair_order_sequences WHERE year = ?`).get(year) as
    | { last_seq: number }
    | undefined;
  const n = row?.last_seq ?? 1;
  return `R-${year}-${String(n).padStart(6, "0")}`;
}
