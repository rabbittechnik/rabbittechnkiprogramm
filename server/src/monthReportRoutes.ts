import type { Express } from "express";
import type Database from "better-sqlite3";
import { requireWorkshopFullAuth } from "./lib/workshopAuth.js";
import { formatBerlinYearMonthRangeDe } from "./lib/berlinCalendar.js";
import { computeMonthRevenueBreakdown } from "./lib/dayClosing.js";

function paramStr(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export function registerMonthReportRoutes(app: Express, db: Database.Database): void {
  app.get("/api/monatsberichte", requireWorkshopFullAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, year_month, generated_at, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
                ueberweisung_cents, other_cents, invoice_count, transaction_count,
                parts_purchase_cents, gross_profit_cents
         FROM monatsberichte ORDER BY year_month DESC LIMIT 120`
      )
      .all();
    res.json({ reports: rows });
  });

  app.get("/api/monatsberichte/:ym", requireWorkshopFullAuth, (req, res) => {
    const ym = paramStr(req.params.ym);
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      res.status(400).json({ error: "Monat als YYYY-MM (Kalender Europe/Berlin)" });
      return;
    }
    const row = db
      .prepare(
        `SELECT id, year_month, generated_at, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
                ueberweisung_cents, other_cents, invoice_count, transaction_count,
                parts_purchase_cents, gross_profit_cents, overview_json, transactions_json
         FROM monatsberichte WHERE year_month = ?`
      )
      .get(ym) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Kein Monatsbericht für diesen Monat" });
      return;
    }
    const { overview_json: oj, transactions_json: tj, ...rest } = row;
    let overview: unknown = {};
    let transactions: unknown[] = [];
    try {
      overview = JSON.parse(String(oj ?? "{}"));
    } catch {
      overview = {};
    }
    try {
      transactions = JSON.parse(String(tj ?? "[]")) as unknown[];
    } catch {
      transactions = [];
    }
    const revenue_breakdown = computeMonthRevenueBreakdown(db, ym);
    res.json({
      ...rest,
      overview,
      transactions,
      business_period_de: formatBerlinYearMonthRangeDe(ym),
      revenue_breakdown,
    });
  });
}
