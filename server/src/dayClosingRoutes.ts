import type { Express } from "express";
import type Database from "better-sqlite3";
import { requireWorkshopAuth } from "./lib/workshopAuth.js";
import {
  getRegisterOpeningCents,
  recalculateAllRegisterBalances,
  setRegisterOpeningCents,
} from "./lib/registerBalance.js";

function paramStr(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export function registerDayClosingRoutes(app: Express, db: Database.Database): void {
  app.get("/api/tagesabschluesse/kasse/eroeffnungsbestand", requireWorkshopAuth, (_req, res) => {
    res.json({ opening_cents: getRegisterOpeningCents(db) });
  });

  app.put("/api/tagesabschluesse/kasse/eroeffnungsbestand", requireWorkshopAuth, (req, res) => {
    const raw = (req.body as { opening_cents?: unknown })?.opening_cents;
    const opening_cents = Math.round(Number(raw));
    if (!Number.isFinite(opening_cents)) {
      res.status(400).json({ error: "opening_cents (Zahl, Cent) erforderlich" });
      return;
    }
    setRegisterOpeningCents(db, opening_cents);
    recalculateAllRegisterBalances(db);
    res.json({ ok: true, opening_cents });
  });

  app.get("/api/tagesabschluesse", requireWorkshopAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, business_date, generated_at, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
                ueberweisung_cents, other_cents, invoice_count, transaction_count, register_balance_eod_cents
         FROM tagesabschluesse ORDER BY business_date DESC LIMIT 400`
      )
      .all();
    res.json({ closings: rows });
  });

  app.get("/api/tagesabschluesse/:date", requireWorkshopAuth, (req, res) => {
    const date = paramStr(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Datum im Format YYYY-MM-DD (Kalendertag Europe/Berlin)" });
      return;
    }
    const row = db
      .prepare(
        `SELECT id, business_date, generated_at, total_cents, bar_cents, online_sumup_cents, tap_to_pay_cents,
                ueberweisung_cents, other_cents, invoice_count, transaction_count, register_balance_eod_cents,
                transactions_json
         FROM tagesabschluesse WHERE business_date = ?`
      )
      .get(date) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Kein Tagesabschluss für dieses Datum" });
      return;
    }
    const { transactions_json: tj, ...rest } = row;
    let transactions: unknown[] = [];
    try {
      transactions = JSON.parse(String(tj ?? "[]")) as unknown[];
    } catch {
      transactions = [];
    }
    res.json({ ...rest, transactions });
  });
}
