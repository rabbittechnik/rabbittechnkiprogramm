import { useCallback, useEffect, useRef, useState } from "react";

type RowLike = { id: string; customer_amendment_count?: number | boolean };

function amendmentCount(r: RowLike): number {
  const n = Number(r.customer_amendment_count ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Blink / Aufmerksamkeit: Sobald der Zähler für Annahme-Nachträge steigt (gegenüber dem
 * letzten „gesehen“-Stand), gilt der Auftrag als unbestätigt, bis die Detailansicht geladen wurde.
 */
export function useWorkshopCustomerAmendmentAttention(rows: RowLike[]) {
  const ackedRef = useRef<Record<string, number>>({});
  const [, setVer] = useState(0);

  useEffect(() => {
    let touched = false;
    for (const r of rows) {
      const c = amendmentCount(r);
      if (ackedRef.current[r.id] === undefined) {
        ackedRef.current[r.id] = c;
        touched = true;
      } else if (c > ackedRef.current[r.id]) {
        touched = true;
      }
    }
    if (touched) setVer((v) => v + 1);
  }, [rows]);

  const hasUnackedAmendment = (id: string): boolean => {
    const r = rows.find((x) => x.id === id);
    if (!r) return false;
    const c = amendmentCount(r);
    const ack = ackedRef.current[id];
    if (ack === undefined) return false;
    return c > ack;
  };

  const acknowledgeAmendmentsForRepair = useCallback((id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const c = amendmentCount(r);
    if (ackedRef.current[id] === c) return;
    ackedRef.current[id] = c;
    setVer((v) => v + 1);
  }, [rows]);

  return { hasUnackedAmendment, acknowledgeAmendmentsForRepair };
}
