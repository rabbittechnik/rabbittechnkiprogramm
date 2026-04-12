/** Werkstatt / Montage: alle laufenden Status; „Abgeholt“ nur über Abholung an der vollen Werkstatt. */
export const REPAIR_STATUSES_EXCEPT_ABGEHOLT = [
  "angenommen",
  "diagnose",
  "wartet_auf_teile",
  "teilgeliefert",
  "in_reparatur",
  "fertig",
] as const;

export type RepairWorkflowStatus = (typeof REPAIR_STATUSES_EXCEPT_ABGEHOLT)[number];

export function repairStatusLabelDe(status: string): string {
  const m: Record<string, string> = {
    angenommen: "Angenommen",
    diagnose: "Analyse",
    wartet_auf_teile: "Wartet auf Teile",
    teilgeliefert: "Teilgeliefert",
    in_reparatur: "In Reparatur",
    fertig: "Fertig",
    abgeholt: "Abgeholt",
  };
  return m[status] ?? status.replace(/_/g, " ");
}
