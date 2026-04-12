import fs from "node:fs";
import type Database from "better-sqlite3";
import type { Request } from "express";
import { buildPublicTrackingUrl } from "./publicUrl.js";
import { writeRepairOrderPdfs } from "./pdfRepairOrder.js";

/**
 * Erzeugt bzw. aktualisiert A4- und Etikett-PDF zum Reparaturauftrag und speichert die Pfade in `repairs`.
 */
export async function syncRepairOrderPdfs(
  db: Database.Database,
  repairId: string,
  req?: Pick<Request, "get" | "protocol" | "secure">
): Promise<void> {
  const r = db.prepare(`SELECT repair_order_number, tracking_code FROM repairs WHERE id = ?`).get(repairId) as
    | { repair_order_number: string | null; tracking_code: string }
    | undefined;
  if (!r?.repair_order_number?.trim()) return;

  const trackingUrl = buildPublicTrackingUrl(r.tracking_code, req);
  const paths = await writeRepairOrderPdfs(db, repairId, { trackingUrl });

  const prev = db
    .prepare(`SELECT repair_order_pdf_path, repair_order_label_pdf_path FROM repairs WHERE id = ?`)
    .get(repairId) as
    | { repair_order_pdf_path: string | null; repair_order_label_pdf_path: string | null }
    | undefined;

  for (const p of [prev?.repair_order_pdf_path, prev?.repair_order_label_pdf_path]) {
    if (!p) continue;
    if (p !== paths.a4Path && p !== paths.labelPath) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }

  db.prepare(
    `UPDATE repairs SET repair_order_pdf_path = ?, repair_order_label_pdf_path = ? WHERE id = ?`
  ).run(paths.a4Path, paths.labelPath, repairId);
}

export function scheduleSyncRepairOrderPdfs(
  db: Database.Database,
  repairId: string,
  req?: Pick<Request, "get" | "protocol" | "secure">
): void {
  void syncRepairOrderPdfs(db, repairId, req).catch((e) => console.error("[pdf] Reparaturauftrag:", e));
}
