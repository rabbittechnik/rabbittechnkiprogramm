import type Database from "better-sqlite3";
import { PROBLEM_TO_SERVICES } from "../seed.js";
import { toPublicServiceRow, type PublicServiceRow } from "./serviceCategoryMeta.js";

export function getSuggestedServiceCodes(problemKey: string): string[] {
  return PROBLEM_TO_SERVICES[problemKey] ?? ["diagnose"];
}

export function getServiceRowsByCodes(db: Database.Database, codes: string[]): PublicServiceRow[] {
  if (codes.length === 0) return [];
  const placeholders = codes.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, code, name, price_cents, sort_order, category FROM services WHERE code IN (${placeholders}) ORDER BY sort_order`
    )
    .all(...codes) as { id: string; code: string; name: string; price_cents: number; sort_order: number; category: string }[];
  const order = new Map(codes.map((c, i) => [c, i]));
  return [...rows]
    .sort((a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99))
    .map((r) => toPublicServiceRow(r));
}

export function sumServiceCents(rows: { price_cents: number }[]): number {
  return rows.reduce((s, r) => s + r.price_cents, 0);
}
