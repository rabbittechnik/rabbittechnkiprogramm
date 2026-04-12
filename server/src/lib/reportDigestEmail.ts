import type Database from "better-sqlite3";
import {
  formatEuroFromCents,
  isMailConfigured,
  sendInternalWorkshopReportEmail,
} from "./mail.js";
import { formatBerlinBusinessDayRangeDe, formatBerlinYearMonthRangeDe } from "./berlinCalendar.js";
import { computeDayRevenueBreakdown, computeMonthRevenueBreakdown } from "./dayClosing.js";

/**
 * Nach neu angelegtem Tages- bzw. Monatsbericht: eine E-Mail pro Lauf (jeweils letzter neuer Tag/Monat),
 * über die bestehende Mail-Pipeline (`sendInternalWorkshopReportEmail` → Resend/SMTP).
 */
export async function sendReportDigestEmails(
  db: Database.Database,
  newBusinessDates: string[],
  newYearMonths: string[]
): Promise<void> {
  if (!isMailConfigured()) {
    if (newBusinessDates.length > 0 || newYearMonths.length > 0) {
      console.warn("[report-mail] Tages-/Monatsbericht per E-Mail übersprungen: Versand nicht konfiguriert.");
    }
    return;
  }

  const day = newBusinessDates.length > 0 ? newBusinessDates[newBusinessDates.length - 1] : null;
  if (day) {
    const row = db
      .prepare(
        `SELECT business_date, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
                ueberweisung_cents, other_cents, invoice_count, transaction_count,
                COALESCE(register_balance_eod_cents, 0) AS register_balance_eod_cents
         FROM tagesabschluesse WHERE business_date = ?`
      )
      .get(day) as
      | {
          business_date: string;
          total_cents: number;
          bar_cents: number;
          online_sumup_cents: number;
          tap_to_pay_cents: number;
          ueberweisung_cents: number;
          other_cents: number;
          invoice_count: number;
          transaction_count: number;
          register_balance_eod_cents: number;
        }
      | undefined;
    if (row) {
      const bd = computeDayRevenueBreakdown(db, row.business_date);
      const lines: string[] = [
        `Tagesabschluss ${row.business_date}`,
        formatBerlinBusinessDayRangeDe(row.business_date),
        "(Zahlungseingänge je Auftrag, Europe/Berlin)",
        "",
        `Gesamtumsatz: ${formatEuroFromCents(row.total_cents)} €`,
        `Davon Leistungen (ohne Anfahrt): ${formatEuroFromCents(bd.leistungen_cents)} €`,
        `Anfahrt & Wege: ${formatEuroFromCents(bd.anfahrt_cents)} €`,
        `Teile / Hardware (Verkauf): ${formatEuroFromCents(bd.teile_cents)} €`,
      ];
      if (bd.by_category.length > 0) {
        lines.push("", "Leistungen nach Kategorie:");
        for (const c of bd.by_category) {
          lines.push(`  · ${c.category_label_de}: ${formatEuroFromCents(c.cents)} €`);
        }
      }
      lines.push(
        "",
        `Bar: ${formatEuroFromCents(row.bar_cents)} € | Online (SumUp): ${formatEuroFromCents(row.online_sumup_cents)} €`,
        `SumUp Tap to Pay: ${formatEuroFromCents(row.tap_to_pay_cents)} € | Überweisung: ${formatEuroFromCents(row.ueberweisung_cents)} €`
      );
      if (row.other_cents > 0) lines.push(`Sonstige: ${formatEuroFromCents(row.other_cents)} €`);
      lines.push(
        "",
        `Vorgänge (bezahlt): ${row.transaction_count} | mit Rechnungsnr.: ${row.invoice_count}`,
        `Kassenbestand Bar (Tagesende, kumuliert): ${formatEuroFromCents(row.register_balance_eod_cents)} €`,
        "",
        "Details und Transaktionsliste: Werkstatt → Tagesabschluss in der App."
      );
      const text = lines.join("\n");
      const r = await sendInternalWorkshopReportEmail({
        subject: `Tagesabschluss ${row.business_date} – Rabbit-Technik`,
        text,
        preheader: `Tagesabschluss ${row.business_date}`,
      });
      if (!r.sent) console.error("[report-mail] Tagesabschluss:", r.reason);
      else console.log(`[report-mail] Tagesabschluss ${row.business_date} gesendet`);
    }
  }

  const ym = newYearMonths.length > 0 ? newYearMonths[newYearMonths.length - 1] : null;
  if (ym) {
    const row = db
      .prepare(
        `SELECT year_month, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
                ueberweisung_cents, other_cents, invoice_count, transaction_count,
                parts_purchase_cents, gross_profit_cents
         FROM monatsberichte WHERE year_month = ?`
      )
      .get(ym) as
      | {
          year_month: string;
          total_cents: number;
          bar_cents: number;
          online_sumup_cents: number;
          tap_to_pay_cents: number;
          ueberweisung_cents: number;
          other_cents: number;
          invoice_count: number;
          transaction_count: number;
          parts_purchase_cents: number;
          gross_profit_cents: number;
        }
      | undefined;
    if (row) {
      const bd = computeMonthRevenueBreakdown(db, row.year_month);
      const lines: string[] = [
        `Monatsbericht ${row.year_month}`,
        formatBerlinYearMonthRangeDe(row.year_month),
        "(bezahlte Aufträge nach Zahlungseingang, Europe/Berlin)",
        "",
        `Monatsumsatz: ${formatEuroFromCents(row.total_cents)} €`,
        `Davon Leistungen (ohne Anfahrt): ${formatEuroFromCents(bd.leistungen_cents)} €`,
        `Anfahrt & Wege: ${formatEuroFromCents(bd.anfahrt_cents)} €`,
        `Teile / Hardware (Verkauf): ${formatEuroFromCents(bd.teile_cents)} €`,
      ];
      if (bd.by_category.length > 0) {
        lines.push("", "Leistungen nach Kategorie:");
        for (const c of bd.by_category) {
          lines.push(`  · ${c.category_label_de}: ${formatEuroFromCents(c.cents)} €`);
        }
      }
      lines.push(
        "",
        `Bar: ${formatEuroFromCents(row.bar_cents)} € | Online (SumUp): ${formatEuroFromCents(row.online_sumup_cents)} €`,
        `SumUp Tap to Pay: ${formatEuroFromCents(row.tap_to_pay_cents)} € | Überweisung: ${formatEuroFromCents(row.ueberweisung_cents)} €`
      );
      if (row.other_cents > 0) lines.push(`Sonstige: ${formatEuroFromCents(row.other_cents)} €`);
      lines.push(
        "",
        `Vorgänge: ${row.transaction_count} | mit Rechnungsnr.: ${row.invoice_count}`,
        `Wareneinsatz Teile: ${formatEuroFromCents(row.parts_purchase_cents)} €`,
        `Rohertrag (vereinfacht): ${formatEuroFromCents(row.gross_profit_cents)} €`,
        "",
        "Details: Werkstatt → Monatsbericht in der App."
      );
      const text = lines.join("\n");
      const r = await sendInternalWorkshopReportEmail({
        subject: `Monatsbericht ${row.year_month} – Rabbit-Technik`,
        text,
        preheader: `Monatsbericht ${row.year_month}`,
      });
      if (!r.sent) console.error("[report-mail] Monatsbericht:", r.reason);
      else console.log(`[report-mail] Monatsbericht ${row.year_month} gesendet`);
    }
  }
}
