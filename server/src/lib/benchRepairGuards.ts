import type Database from "better-sqlite3";
import type { Request } from "express";
import { isWorkshopPasswordConfigured } from "./workshopAuth.js";

export function isBenchRequest(req: Request): boolean {
  return isWorkshopPasswordConfigured() && req.workshopRole === "bench";
}

/** Mindestens ein Protokolleintrag seit letztem Eintritt in „in_reparatur“ (Montage-Tablet: vor „fertig“). */
export function benchHasCompletionLog(db: Database.Database, repairId: string): boolean {
  const r = db
    .prepare(`SELECT in_reparatur_since FROM repairs WHERE id = ?`)
    .get(repairId) as { in_reparatur_since: string | null } | undefined;
  if (!r?.in_reparatur_since) return false;
  const ok = db
    .prepare(
      `SELECT 1 FROM repair_logs WHERE repair_id = ? AND datetime(logged_at) >= datetime(?) LIMIT 1`
    )
    .get(repairId, r.in_reparatur_since);
  return Boolean(ok);
}

export function assertBenchStatusAllowed(
  db: Database.Database,
  repairId: string,
  previousStatus: string,
  nextStatus: string
): { ok: true } | { ok: false; error: string } {
  if (previousStatus === nextStatus) return { ok: true };

  const deny = (msg: string) => ({ ok: false as const, error: msg });

  if (nextStatus === "abgeholt" || nextStatus === "angenommen" || nextStatus === "diagnose") {
    return deny("Dieser Statuswechsel ist mit der Montage-Anmeldung nicht erlaubt.");
  }

  if (nextStatus === "in_reparatur") {
    const from = ["angenommen", "diagnose", "wartet_auf_teile", "teilgeliefert"];
    if (!from.includes(previousStatus)) {
      return deny("„In Reparatur“ ist von diesem Status aus nicht freigegeben.");
    }
    return { ok: true };
  }

  if (nextStatus === "fertig") {
    if (previousStatus !== "in_reparatur") {
      return deny("„Fertig“ nur nach „In Reparatur“.");
    }
    if (!benchHasCompletionLog(db, repairId)) {
      return deny("Bitte zuerst ein Arbeitsprotokoll (Tätigkeit + Beschreibung) eintragen.");
    }
    return { ok: true };
  }

  if (nextStatus === "wartet_auf_teile" || nextStatus === "teilgeliefert") {
    const from = ["in_reparatur", "wartet_auf_teile", "teilgeliefert"];
    if (!from.includes(previousStatus)) {
      return deny("Dieser Teile-Statuswechsel ist mit der Montage-Anmeldung nicht erlaubt.");
    }
    return { ok: true };
  }

  return deny("Unbekannter oder nicht freigegebener Zielstatus.");
}
