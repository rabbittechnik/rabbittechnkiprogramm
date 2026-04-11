import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

import {
  berlinPreviousYearMonth,
  enumerateBerlinMonthDays,
  instantToBerlinYearMonth,
  nextBerlinYearMonth,
} from "./berlinCalendar.js";
import type { DayClosingTransaction } from "./dayClosing.js";
import { earliestPaidBerlinYmd } from "./dayClosing.js";

export type MonthReportOverview = {
  daily_from_closings: Record<string, number>;
  hinweis: string;
};

export type MonthReportSnapshot = {
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
  transactions: DayClosingTransaction[];
  overview: MonthReportOverview;
};

function bucketKey(
  pm: string | null,
  sumupChannel: string | null
): "bar_cents" | "online_sumup_cents" | "tap_to_pay_cents" | "ueberweisung_cents" | "other_cents" {
  const p = (pm ?? "").trim();
  const ch = (sumupChannel ?? "").trim().toLowerCase();
  if (p === "bar") return "bar_cents";
  if (p === "ueberweisung") return "ueberweisung_cents";
  if (p === "sumup") {
    if (ch === "tap_to_pay" || ch === "terminal") return "tap_to_pay_cents";
    return "online_sumup_cents";
  }
  return "other_cents";
}

function sumPartsPurchaseForRepairs(db: Database.Database, repairIds: string[]): number {
  if (repairIds.length === 0) return 0;
  const chunk = 400;
  let sum = 0;
  for (let i = 0; i < repairIds.length; i += chunk) {
    const slice = repairIds.slice(i, i + chunk);
    const ph = slice.map(() => "?").join(",");
    const row = db.prepare(`SELECT COALESCE(SUM(purchase_cents), 0) AS s FROM repair_parts WHERE repair_id IN (${ph})`).get(
      ...slice
    ) as { s: number };
    sum += row.s;
  }
  return sum;
}

function buildOverviewFromDayClosings(db: Database.Database, ym: string): MonthReportOverview {
  const daily_from_closings: Record<string, number> = {};
  for (const day of enumerateBerlinMonthDays(ym)) {
    const row = db.prepare(`SELECT total_cents FROM tagesabschluesse WHERE business_date = ?`).get(day) as
      | { total_cents: number }
      | undefined;
    daily_from_closings[day] = row?.total_cents ?? 0;
  }
  return {
    daily_from_closings,
    hinweis:
      "Rohertrag = Monatsumsatz (bezahlte Aufträge) − Wareneinsatz Teile (Summe purchase_cents der zugehörigen Ersatzteile). " +
      "Fixkosten, Lohn und sonstige Kosten sind in den Stammdaten nicht enthalten.",
  };
}

export function aggregateMonthReport(db: Database.Database, yearMonth: string): MonthReportSnapshot {
  const rows = db
    .prepare(
      `SELECT r.id AS repair_id, r.tracking_code, r.total_cents, r.payment_method, r.sumup_channel, r.payment_paid_at, r.payment_status,
              c.name AS customer_name,
              (SELECT i.invoice_number FROM invoices i
               WHERE i.repair_id = r.id AND i.document_kind = 'rechnung'
               ORDER BY datetime(i.created_at) DESC LIMIT 1) AS invoice_number
       FROM repairs r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE r.payment_status = 'bezahlt' AND r.payment_paid_at IS NOT NULL
         AND r.is_test = 0`
    )
    .all() as (DayClosingTransaction & { payment_status: string })[];

  const monthRows = rows.filter((r) => instantToBerlinYearMonth(r.payment_paid_at) === yearMonth);

  const snap: MonthReportSnapshot = {
    year_month: yearMonth,
    total_cents: 0,
    bar_cents: 0,
    online_sumup_cents: 0,
    tap_to_pay_cents: 0,
    ueberweisung_cents: 0,
    other_cents: 0,
    invoice_count: 0,
    transaction_count: monthRows.length,
    parts_purchase_cents: 0,
    gross_profit_cents: 0,
    transactions: monthRows.map(({ payment_status: _ps, ...t }) => t),
    overview: buildOverviewFromDayClosings(db, yearMonth),
  };

  let invoices = 0;
  const repairIds: string[] = [];
  for (const r of monthRows) {
    snap.total_cents += r.total_cents;
    const bk = bucketKey(r.payment_method, r.sumup_channel);
    if (bk === "bar_cents") snap.bar_cents += r.total_cents;
    else if (bk === "online_sumup_cents") snap.online_sumup_cents += r.total_cents;
    else if (bk === "tap_to_pay_cents") snap.tap_to_pay_cents += r.total_cents;
    else if (bk === "ueberweisung_cents") snap.ueberweisung_cents += r.total_cents;
    else snap.other_cents += r.total_cents;
    if (r.invoice_number) invoices += 1;
    repairIds.push(r.repair_id);
  }
  snap.invoice_count = invoices;
  snap.parts_purchase_cents = sumPartsPurchaseForRepairs(db, repairIds);
  snap.gross_profit_cents = snap.total_cents - snap.parts_purchase_cents;

  snap.transactions.sort((a, b) => String(a.payment_paid_at).localeCompare(String(b.payment_paid_at)));
  return snap;
}

export function persistMonthReport(db: Database.Database, snap: MonthReportSnapshot): boolean {
  const exists = db.prepare(`SELECT 1 FROM monatsberichte WHERE year_month = ?`).get(snap.year_month);
  if (exists) return false;
  const id = nanoid();
  db.prepare(
    `INSERT INTO monatsberichte (
       id, year_month, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
       ueberweisung_cents, other_cents, invoice_count, transaction_count,
       parts_purchase_cents, gross_profit_cents, overview_json, transactions_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    snap.year_month,
    snap.total_cents,
    snap.bar_cents,
    snap.online_sumup_cents,
    snap.tap_to_pay_cents,
    snap.ueberweisung_cents,
    snap.other_cents,
    snap.invoice_count,
    snap.transaction_count,
    snap.parts_purchase_cents,
    snap.gross_profit_cents,
    JSON.stringify(snap.overview),
    JSON.stringify(snap.transactions)
  );
  return true;
}

function ymMinusMonths(ym: string, months: number): string {
  let [y, mo] = ym.split("-").map(Number);
  let mm = mo - months;
  while (mm <= 0) {
    mm += 12;
    y -= 1;
  }
  return `${y}-${String(mm).padStart(2, "0")}`;
}

/** Bis zum letzten abgeschlossenen Kalendermonat (Vormonat, Europe/Berlin). */
export function ensureMonthReportsThroughPrevious(
  db: Database.Database,
  maxMonths = 36
): { created: number; newYearMonths: string[] } {
  const prevYm = berlinPreviousYearMonth(new Date());
  const earliestYmd = earliestPaidBerlinYmd(db);
  let start = earliestYmd ? earliestYmd.slice(0, 7) : prevYm;
  const cap = ymMinusMonths(prevYm, maxMonths);
  if (start < cap) start = cap;

  let created = 0;
  const newYearMonths: string[] = [];
  for (let ym = start; ym <= prevYm; ym = nextBerlinYearMonth(ym)) {
    const snap = aggregateMonthReport(db, ym);
    if (persistMonthReport(db, snap)) {
      created++;
      newYearMonths.push(ym);
    }
  }
  return { created, newYearMonths };
}
