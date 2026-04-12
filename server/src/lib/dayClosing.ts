import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

import {
  berlinYesterdayYmd,
  instantToBerlinYmd,
  instantToBerlinYearMonth,
  nextBerlinCalendarDay,
  prevBerlinCalendarDay,
} from "./berlinCalendar.js";
import { computeRegisterBalanceEodForNewRow } from "./registerBalance.js";
import {
  ANFAHRT_CATEGORY_KEY,
  SERVICE_CATEGORY_LABEL_DE,
  SERVICE_CATEGORY_ORDER,
  normalizeServiceCategoryKey,
  type ServiceCategoryKey,
} from "./serviceCategoryMeta.js";

export type DayClosingTransaction = {
  repair_id: string;
  tracking_code: string;
  customer_name: string | null;
  total_cents: number;
  payment_method: string | null;
  sumup_channel: string | null;
  payment_paid_at: string | null;
  invoice_number: string | null;
};

export type DayClosingSnapshot = {
  business_date: string;
  total_cents: number;
  bar_cents: number;
  online_sumup_cents: number;
  tap_to_pay_cents: number;
  ueberweisung_cents: number;
  other_cents: number;
  invoice_count: number;
  transaction_count: number;
  transactions: DayClosingTransaction[];
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

export function aggregateDayClosing(db: Database.Database, businessDateYmd: string): DayClosingSnapshot {
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

  const dayRows = rows.filter((r) => instantToBerlinYmd(r.payment_paid_at) === businessDateYmd);

  const snap: DayClosingSnapshot = {
    business_date: businessDateYmd,
    total_cents: 0,
    bar_cents: 0,
    online_sumup_cents: 0,
    tap_to_pay_cents: 0,
    ueberweisung_cents: 0,
    other_cents: 0,
    invoice_count: 0,
    transaction_count: dayRows.length,
    transactions: dayRows.map(({ payment_status: _ps, ...t }) => t),
  };

  let invoices = 0;
  for (const r of dayRows) {
    snap.total_cents += r.total_cents;
    const bk = bucketKey(r.payment_method, r.sumup_channel);
    if (bk === "bar_cents") snap.bar_cents += r.total_cents;
    else if (bk === "online_sumup_cents") snap.online_sumup_cents += r.total_cents;
    else if (bk === "tap_to_pay_cents") snap.tap_to_pay_cents += r.total_cents;
    else if (bk === "ueberweisung_cents") snap.ueberweisung_cents += r.total_cents;
    else snap.other_cents += r.total_cents;
    if (r.invoice_number) invoices += 1;
  }
  snap.invoice_count = invoices;

  snap.transactions.sort((a, b) => String(a.payment_paid_at).localeCompare(String(b.payment_paid_at)));
  return snap;
}

export function persistDayClosing(db: Database.Database, snap: DayClosingSnapshot): boolean {
  const exists = db.prepare(`SELECT 1 FROM tagesabschluesse WHERE business_date = ?`).get(snap.business_date);
  if (exists) return false;
  const id = nanoid();
  const registerEod = computeRegisterBalanceEodForNewRow(db, snap.business_date, snap.bar_cents);
  db.prepare(
    `INSERT INTO tagesabschluesse (
       id, business_date, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
       ueberweisung_cents, other_cents, invoice_count, transaction_count, transactions_json,
       register_balance_eod_cents
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    snap.business_date,
    snap.total_cents,
    snap.bar_cents,
    snap.online_sumup_cents,
    snap.tap_to_pay_cents,
    snap.ueberweisung_cents,
    snap.other_cents,
    snap.invoice_count,
    snap.transaction_count,
    JSON.stringify(snap.transactions),
    registerEod
  );
  return true;
}

function ymdMinusDays(ymd: string, days: number): string {
  let d = ymd;
  for (let i = 0; i < days; i++) d = prevBerlinCalendarDay(d);
  return d;
}

/** Alle Kalendertage von (früheste Zahlung, max. 365 Tage zurück) bis gestern – idempotent. */
export function ensureClosingThroughYesterday(
  db: Database.Database,
  maxLookbackDays = 365
): { created: number; newBusinessDates: string[] } {
  const yesterday = berlinYesterdayYmd(new Date());
  const earliestPaid = earliestPaidBerlinYmd(db);
  let start = earliestPaid ?? yesterday;
  const cap = ymdMinusDays(yesterday, maxLookbackDays);
  if (start < cap) start = cap;

  let created = 0;
  const newBusinessDates: string[] = [];
  for (let d = start; d <= yesterday; d = nextBerlinCalendarDay(d)) {
    const snap = aggregateDayClosing(db, d);
    if (persistDayClosing(db, snap)) {
      created++;
      newBusinessDates.push(d);
    }
  }
  return { created, newBusinessDates };
}

export function earliestPaidBerlinYmd(db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT payment_paid_at FROM repairs WHERE payment_status = 'bezahlt' AND payment_paid_at IS NOT NULL AND is_test = 0 ORDER BY payment_paid_at ASC LIMIT 1`
    )
    .get() as { payment_paid_at: string } | undefined;
  if (!row) return null;
  return instantToBerlinYmd(row.payment_paid_at);
}

export type DayRevenueBreakdownLine = {
  category_key: ServiceCategoryKey;
  category_label_de: string;
  cents: number;
};

/** Umsatz nach Teilen vs. Leistungen (Kalendertag Berlin, bezahlte Aufträge). */
export type DayRevenueBreakdown = {
  teile_cents: number;
  /** Summe aller Leistungszeilen außer Anfahrt */
  leistungen_cents: number;
  anfahrt_cents: number;
  /** Nur Kategorien mit Umsatz > 0 */
  by_category: DayRevenueBreakdownLine[];
};

/** Summen Teile + Leistungen nach Kategorie für eine Menge Aufträge (z. B. ein Tag oder ein Monat). */
export function computeRevenueBreakdownForRepairIds(db: Database.Database, repairIds: string[]): DayRevenueBreakdown {
  if (repairIds.length === 0) {
    return { teile_cents: 0, leistungen_cents: 0, anfahrt_cents: 0, by_category: [] };
  }

  const ph = repairIds.map(() => "?").join(",");

  const teileRow = db
    .prepare(`SELECT COALESCE(SUM(sale_cents), 0) AS s FROM repair_parts WHERE repair_id IN (${ph})`)
    .get(...repairIds) as { s: number };

  const catRows = db
    .prepare(
      `SELECT s.category AS cat, COALESCE(SUM(rs.price_cents), 0) AS cents
       FROM repair_services rs
       JOIN services s ON s.id = rs.service_id
       WHERE rs.repair_id IN (${ph})
       GROUP BY s.category`
    )
    .all(...repairIds) as { cat: string; cents: number }[];

  const byKey = new Map<ServiceCategoryKey, number>();
  for (const k of SERVICE_CATEGORY_ORDER) byKey.set(k, 0);
  for (const row of catRows) {
    const key = normalizeServiceCategoryKey(row.cat);
    byKey.set(key, (byKey.get(key) ?? 0) + row.cents);
  }

  const anfahrt_cents = byKey.get(ANFAHRT_CATEGORY_KEY) ?? 0;
  let leistungen_cents = 0;
  for (const k of SERVICE_CATEGORY_ORDER) {
    if (k === ANFAHRT_CATEGORY_KEY) continue;
    leistungen_cents += byKey.get(k) ?? 0;
  }

  const by_category: DayRevenueBreakdownLine[] = SERVICE_CATEGORY_ORDER.map((category_key) => ({
    category_key,
    category_label_de: SERVICE_CATEGORY_LABEL_DE[category_key],
    cents: byKey.get(category_key) ?? 0,
  })).filter((r) => r.cents > 0);

  return {
    teile_cents: teileRow.s,
    leistungen_cents,
    anfahrt_cents,
    by_category,
  };
}

export function computeDayRevenueBreakdown(db: Database.Database, businessDateYmd: string): DayRevenueBreakdown {
  const repairRows = db
    .prepare(
      `SELECT id, payment_paid_at FROM repairs WHERE payment_status = 'bezahlt' AND payment_paid_at IS NOT NULL AND is_test = 0`
    )
    .all() as { id: string; payment_paid_at: string | null }[];
  const ids = repairRows.filter((r) => instantToBerlinYmd(r.payment_paid_at) === businessDateYmd).map((r) => r.id);
  return computeRevenueBreakdownForRepairIds(db, ids);
}

/** Bezahlte Aufträge mit Zahlungseingang im Kalendermonat YYYY-MM (Europe/Berlin). */
export function computeMonthRevenueBreakdown(db: Database.Database, yearMonth: string): DayRevenueBreakdown {
  const repairRows = db
    .prepare(
      `SELECT id, payment_paid_at FROM repairs WHERE payment_status = 'bezahlt' AND payment_paid_at IS NOT NULL AND is_test = 0`
    )
    .all() as { id: string; payment_paid_at: string | null }[];
  const ids = repairRows.filter((r) => instantToBerlinYearMonth(r.payment_paid_at) === yearMonth).map((r) => r.id);
  return computeRevenueBreakdownForRepairIds(db, ids);
}
