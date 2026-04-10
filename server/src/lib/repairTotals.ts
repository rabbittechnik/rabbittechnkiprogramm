import type Database from "better-sqlite3";

export function recalculateRepairTotal(db: Database.Database, repairId: string): number {
  const services = db
    .prepare(`SELECT price_cents FROM repair_services WHERE repair_id = ?`)
    .all(repairId) as { price_cents: number }[];
  const parts = db
    .prepare(`SELECT sale_cents FROM repair_parts WHERE repair_id = ?`)
    .all(repairId) as { sale_cents: number }[];
  const s = services.reduce((a, b) => a + b.price_cents, 0);
  const p = parts.reduce((a, b) => a + b.sale_cents, 0);
  const total = s + p;
  db.prepare(`UPDATE repairs SET total_cents = ?, updated_at = datetime('now') WHERE id = ?`).run(
    total,
    repairId
  );
  db.prepare(`UPDATE invoices SET total_cents = ? WHERE repair_id = ?`).run(total, repairId);
  return total;
}

export function syncRepairStatusForParts(db: Database.Database, repairId: string): void {
  const rows = db
    .prepare(`SELECT status FROM repair_parts WHERE repair_id = ?`)
    .all(repairId) as { status: string }[];
  if (rows.length === 0) return;
  const allArrivedOrBuilt = rows.every((r) =>
    r.status === "angekommen" || r.status === "eingebaut" || r.status === "vor_ort"
  );
  const anyPending = rows.some((r) => r.status === "bestellt" || r.status === "unterwegs");
  const cur = db.prepare(`SELECT status FROM repairs WHERE id = ?`).get(repairId) as
    | { status: string }
    | undefined;
  if (!cur) return;
  if (anyPending && cur.status !== "wartet_auf_teile") {
    db.prepare(`UPDATE repairs SET status = 'wartet_auf_teile', updated_at = datetime('now') WHERE id = ?`).run(
      repairId
    );
  } else if (!anyPending && allArrivedOrBuilt && cur.status === "wartet_auf_teile") {
    db.prepare(`UPDATE repairs SET status = 'in_reparatur', updated_at = datetime('now') WHERE id = ?`).run(
      repairId
    );
  }
}
