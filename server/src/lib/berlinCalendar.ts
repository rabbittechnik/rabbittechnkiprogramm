import { TZ_BERLIN, parseStoredInstant } from "./formatBerlin.js";

/** Kalendertag Europe/Berlin als YYYY-MM-DD. */
export function berlinYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ_BERLIN });
}

/** Voriger Kalendertag in Berlin (für Tagesabschluss nach Mitternacht). */
export function berlinYesterdayYmd(ref = new Date()): string {
  const today = berlinYmd(ref);
  let t = ref.getTime();
  for (let i = 0; i < 30; i++) {
    t -= 3600000;
    if (berlinYmd(new Date(t)) !== today) {
      return berlinYmd(new Date(t));
    }
  }
  return today;
}

/** ISO/SQLite-Zeitstempel → Kalendertag Berlin. */
export function instantToBerlinYmd(isoOrSqlite: string | null | undefined): string | null {
  const d = parseStoredInstant(isoOrSqlite);
  if (!d) return null;
  return berlinYmd(d);
}

export function prevBerlinCalendarDay(ymd: string): string {
  const [y, mo, da] = ymd.split("-").map(Number);
  const t = Date.UTC(y, mo - 1, da, 14, 0, 0) - 24 * 3600000;
  return berlinYmd(new Date(t));
}

export function nextBerlinCalendarDay(ymd: string): string {
  const [y, mo, da] = ymd.split("-").map(Number);
  const t = Date.UTC(y, mo - 1, da, 14, 0, 0) + 24 * 3600000;
  return berlinYmd(new Date(t));
}

/** YYYY-MM (Kalendermonat Europe/Berlin) aus Zeitstempel. */
export function instantToBerlinYearMonth(isoOrSqlite: string | null | undefined): string | null {
  const ymd = instantToBerlinYmd(isoOrSqlite);
  if (!ymd) return null;
  return ymd.slice(0, 7);
}

/** Aktueller Monat Berlin als YYYY-MM. */
export function berlinYearMonthNow(ref = new Date()): string {
  return berlinYmd(ref).slice(0, 7);
}

/** Vormonat (Kalender) zu einem Berlin-Datum. */
export function berlinPreviousYearMonth(ref = new Date()): string {
  const ymd = berlinYmd(ref);
  const [y, mo] = ymd.split("-").map(Number);
  if (mo === 1) return `${y - 1}-12`;
  return `${y}-${String(mo - 1).padStart(2, "0")}`;
}

export function nextBerlinYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Alle YYYY-MM-DD eines Monats YYYY-MM (Berlin-Kalender über UTC-Näherung). */
export function enumerateBerlinMonthDays(ym: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];
  const out: string[] = [];
  let d = `${ym}-01`;
  let guard = 0;
  while (d.slice(0, 7) === ym && guard++ < 40) {
    out.push(d);
    d = nextBerlinCalendarDay(d);
  }
  return out;
}

/**
 * Erster Zeitpunkt **streng nach** `ref`, an dem der Europe/Berlin-Kalendertag wechselt
 * (= Beginn des Folgetags, 00:00 Uhr Ortszeit).
 */
export function nextBerlinLocalMidnightAfter(ref: Date = new Date()): Date {
  const cur = berlinYmd(ref);
  let lo = ref.getTime();
  let hi = ref.getTime() + 36 * 3600 * 1000;
  while (berlinYmd(new Date(hi)) === cur) {
    hi += 6 * 3600 * 1000;
  }
  while (lo + 500 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (berlinYmd(new Date(mid)) === cur) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/**
 * Millisekunden bis kurz **nach** der nächsten Berliner Tagesgrenze (für Jobs „nach 23:59“ / neuer Tag 00:00).
 */
export function msUntilBerlinPostMidnight(ref: Date = new Date(), graceMs = 8000): number {
  const boundary = nextBerlinLocalMidnightAfter(ref).getTime();
  return Math.max(1500, boundary + graceMs - ref.getTime());
}
