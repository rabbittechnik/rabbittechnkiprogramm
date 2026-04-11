/** API-Datumswerte (SQLite-ähnlich) in Europe/Berlin anzeigen. */

const TZ = "Europe/Berlin";

export function parseApiInstant(s: string): Date {
  const t = s.trim();
  if (t.includes("T") && (t.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(t))) return new Date(t);
  const norm = t.includes("T") ? t : t.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(norm)) return new Date(norm + "Z");
  return new Date(t.replace(" ", "T"));
}

export function formatDeBerlin(
  s: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }
): string {
  if (s == null || !String(s).trim()) return "—";
  try {
    return parseApiInstant(String(s)).toLocaleString("de-DE", { timeZone: TZ, ...options });
  } catch {
    return s;
  }
}

export function formatDeBerlinDateOnly(s: string | null | undefined): string {
  return formatDeBerlin(s, { dateStyle: "medium" });
}
