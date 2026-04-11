import { msUntilBerlinPostMidnight } from "./berlinCalendar.js";
import { ensureClosingThroughYesterday } from "./dayClosing.js";
import { ensureMonthReportsThroughPrevious } from "./monthReport.js";
import { sendReportDigestEmails } from "./reportDigestEmail.js";

/** Gleiche DB-Instanz wie Tagesabschluss/Monatsbericht – ohne direkten better-sqlite3-Import (IDE/tsconfig). */
type ClosingDb = Parameters<typeof ensureClosingThroughYesterday>[0];

/**
 * Tagesabschluss & Monatsbericht: einmalig beim Start (Nachholen), danach kurz nach der Berliner Tagesgrenze
 * (00:00 + kurze Grace) – fachlich „nach 23:59“ des abgelaufenen Kalendertags bzw. Monatsendes.
 */
export function startDayClosingScheduler(db: ClosingDb): void {
  const run = () => {
    let newBusinessDates: string[] = [];
    let newYearMonths: string[] = [];
    try {
      const r = ensureClosingThroughYesterday(db);
      newBusinessDates = r.newBusinessDates;
      if (r.created > 0) {
        console.log(`[tagesabschluss] ${r.created} neue Tagesabschlüsse erzeugt`);
      }
    } catch (e) {
      console.error("[tagesabschluss]", e);
    }
    try {
      const r = ensureMonthReportsThroughPrevious(db);
      newYearMonths = r.newYearMonths;
      if (r.created > 0) {
        console.log(`[monatsbericht] ${r.created} neue Monatsberichte erzeugt`);
      }
    } catch (e) {
      console.error("[monatsbericht]", e);
    }
    void sendReportDigestEmails(db, newBusinessDates, newYearMonths).catch((err) => {
      console.error("[report-mail]", err);
    });
  };

  run();

  const scheduleNext = (): void => {
    const ms = msUntilBerlinPostMidnight(new Date(), 8000);
    setTimeout(() => {
      run();
      scheduleNext();
    }, ms);
  };
  scheduleNext();
}
