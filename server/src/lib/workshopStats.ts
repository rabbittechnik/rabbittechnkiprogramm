import type Database from "better-sqlite3";
import { PROBLEMS } from "../seed.js";

const problemLabelByKey: Record<string, string> = Object.fromEntries(
  PROBLEMS.map((p) => [p.key, p.label])
);

function problemDisplayLabel(problemKey: string | null, problemLabel: string | null): string {
  const pl = problemLabel?.trim();
  if (pl) return pl;
  const pk = problemKey?.trim();
  if (pk && problemLabelByKey[pk]) return problemLabelByKey[pk];
  if (pk) return pk;
  return "Ohne Angabe";
}

export type WorkshopStatsOverview = {
  totals: {
    repairs: number;
    customers: number;
    openRepairs: number;
    fertigRepairs: number;
    abgeholtRepairs: number;
  };
  revenueCents: {
    today: number;
    last7Days: number;
    last30Days: number;
    allTime: number;
  };
  /** Ø Kalendertage von Annahme bis letzte Änderung (nur fertig/abgeholt) */
  avgLeadTimeDaysFertig: number | null;
  byStatus: { status: string; count: number }[];
  problemReasons: { label: string; count: number }[];
  deviceTypes: { device_type: string; count: number }[];
  topServices: { code: string; name: string; bookings: number; revenue_cents: number }[];
  parts: {
    lines: number;
    sale_cents: number;
    purchase_cents: number;
  };
  paymentOnCompleted: { payment_status: string; count: number; total_cents: number }[];
  monthly: { month: string; repairs: number; revenue_cents: number }[];
};

export function getWorkshopStatsOverview(db: Database.Database): WorkshopStatsOverview {
  const totals = {
    repairs: (db.prepare(`SELECT COUNT(*) as c FROM repairs`).get() as { c: number }).c,
    customers: (db.prepare(`SELECT COUNT(*) as c FROM customers`).get() as { c: number }).c,
    openRepairs: (
      db.prepare(`SELECT COUNT(*) as c FROM repairs WHERE status NOT IN ('abgeholt')`).get() as { c: number }
    ).c,
    fertigRepairs: (db.prepare(`SELECT COUNT(*) as c FROM repairs WHERE status = 'fertig'`).get() as { c: number })
      .c,
    abgeholtRepairs: (
      db.prepare(`SELECT COUNT(*) as c FROM repairs WHERE status = 'abgeholt'`).get() as { c: number }
    ).c,
  };

  const revenueCents = {
    today: (db.prepare(`SELECT COALESCE(SUM(total_cents), 0) as s FROM repairs WHERE date(created_at) = date('now')`).get() as { s: number })
      .s,
    last7Days: (
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents), 0) as s FROM repairs WHERE date(created_at) >= date('now', '-7 days')`
        )
        .get() as { s: number }
    ).s,
    last30Days: (
      db
        .prepare(
          `SELECT COALESCE(SUM(total_cents), 0) as s FROM repairs WHERE date(created_at) >= date('now', '-30 days')`
        )
        .get() as { s: number }
    ).s,
    allTime: (db.prepare(`SELECT COALESCE(SUM(total_cents), 0) as s FROM repairs`).get() as { s: number }).s,
  };

  const avgRow = db
    .prepare(
      `SELECT AVG(julianday(updated_at) - julianday(created_at)) as avg_days
       FROM repairs WHERE status IN ('fertig', 'abgeholt')`
    )
    .get() as { avg_days: number | null };
  const avgLeadTimeDaysFertig =
    avgRow.avg_days != null && !Number.isNaN(avgRow.avg_days) ? Math.round(avgRow.avg_days * 10) / 10 : null;

  const byStatus = db
    .prepare(`SELECT status, COUNT(*) as count FROM repairs GROUP BY status ORDER BY count DESC`)
    .all() as { status: string; count: number }[];

  const rawProblems = db
    .prepare(
      `SELECT problem_key, problem_label, COUNT(*) as count
       FROM repairs
       GROUP BY problem_key, problem_label`
    )
    .all() as { problem_key: string | null; problem_label: string | null; count: number }[];

  const problemMap = new Map<string, number>();
  for (const row of rawProblems) {
    const label = problemDisplayLabel(row.problem_key, row.problem_label);
    problemMap.set(label, (problemMap.get(label) ?? 0) + row.count);
  }
  const problemReasons = [...problemMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const deviceTypes = db
    .prepare(
      `SELECT d.device_type as device_type, COUNT(*) as count
       FROM repairs r JOIN devices d ON d.id = r.device_id
       GROUP BY d.device_type
       ORDER BY count DESC
       LIMIT 12`
    )
    .all() as { device_type: string; count: number }[];

  const topServices = db
    .prepare(
      `SELECT s.code, s.name, COUNT(*) as bookings, SUM(rs.price_cents) as revenue_cents
       FROM repair_services rs
       JOIN services s ON s.id = rs.service_id
       GROUP BY s.id
       ORDER BY bookings DESC
       LIMIT 14`
    )
    .all() as { code: string; name: string; bookings: number; revenue_cents: number }[];

  const partsRow = db
    .prepare(
      `SELECT COUNT(*) as lines, COALESCE(SUM(sale_cents), 0) as sale_cents, COALESCE(SUM(purchase_cents), 0) as purchase_cents
       FROM repair_parts`
    )
    .get() as { lines: number; sale_cents: number; purchase_cents: number };

  const paymentOnCompleted = db
    .prepare(
      `SELECT payment_status, COUNT(*) as count, COALESCE(SUM(total_cents), 0) as total_cents
       FROM repairs WHERE status IN ('fertig', 'abgeholt')
       GROUP BY payment_status`
    )
    .all() as { payment_status: string; count: number; total_cents: number }[];

  const monthlyRaw = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as repairs, COALESCE(SUM(total_cents), 0) as revenue_cents
       FROM repairs
       WHERE datetime(created_at) >= datetime('now', '-6 months')
       GROUP BY month
       ORDER BY month ASC`
    )
    .all() as { month: string; repairs: number; revenue_cents: number }[];

  return {
    totals,
    revenueCents,
    avgLeadTimeDaysFertig,
    byStatus,
    problemReasons,
    deviceTypes,
    topServices,
    parts: {
      lines: partsRow.lines,
      sale_cents: partsRow.sale_cents,
      purchase_cents: partsRow.purchase_cents,
    },
    paymentOnCompleted,
    monthly: monthlyRaw,
  };
}
