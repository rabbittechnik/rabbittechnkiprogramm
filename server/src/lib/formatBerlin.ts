/** Kunden- und PDF-Ausgabe: feste Zeitzone Deutschland (Railway/SQLite liefern oft UTC). */

export const TZ_BERLIN = "Europe/Berlin";

/**
 * SQLite `datetime('now')` liefert UTC ohne Offset (z. B. "2026-04-11 12:34:56").
 * Ohne "Z" interpretiert ECMAScript das oft als **lokale Serverzeit** → auf UTC-Servern erscheint
 * die Uhrzeit in DE-Ansicht um 1–2 h verschoben. Wir parsen daher explizit als UTC.
 */
export function parseStoredInstant(s: string | null | undefined): Date | null {
  if (s == null || !String(s).trim()) return null;
  const t = String(s).trim();
  if (t.includes("T") && (t.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(t))) return new Date(t);
  const norm = t.includes("T") ? t : t.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(norm)) return new Date(norm + "Z");
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDeBerlin(
  isoOrSqlite: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }
): string {
  const d = parseStoredInstant(isoOrSqlite);
  if (!d) return "—";
  return d.toLocaleString("de-DE", { timeZone: TZ_BERLIN, ...options });
}

export function formatDeBerlinNow(options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  return new Date().toLocaleString("de-DE", { timeZone: TZ_BERLIN, ...options });
}
