import type Database from "better-sqlite3";
import {
  formatEuroFromCents,
  formatReparaturDetails,
  formatTeileListe,
  logMailOutcome,
  publicTrackingUrl,
  sendRepairReadyEmail,
  sendRepairStatusUpdateEmail,
  statusLabelDe,
} from "./mail.js";

/**
 * Sendet eine E-Mail an den Kunden zum aktuellen Auftragsstand (nach DB-Update).
 * Bei Status `fertig`: Fertig-Mail mit Preis; sonst Status-Update mit Teileliste.
 */
export function queueCustomerRepairNotification(
  db: Database.Database,
  repairId: string,
  zusatzInfo?: string
): void {
  const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(repairId) as
    | {
        id: string;
        tracking_code: string;
        status: string;
        customer_id: string;
        device_id: string;
        problem_label: string | null;
        description: string | null;
        total_cents: number;
      }
    | undefined;
  if (!repair) return;

  const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(repair.customer_id) as
    | { email: string | null; name: string }
    | undefined;
  const device = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(repair.device_id) as
    | { device_type: string; brand: string | null; model: string | null }
    | undefined;

  if (!customer?.email || !device) {
    if (customer && !customer.email) {
      console.warn(`[mail] Kunden-Update übersprungen: keine E-Mail [${repair.tracking_code}]`);
    }
    return;
  }

  const parts = db
    .prepare(`SELECT name, status FROM repair_parts WHERE repair_id = ?`)
    .all(repairId) as { name: string; status: string }[];
  const serviceNames = (
    db
      .prepare(`SELECT s.name FROM repair_services rs JOIN services s ON s.id = rs.service_id WHERE rs.repair_id = ?`)
      .all(repairId) as { name: string }[]
  ).map((x) => x.name);

  const trackingLink = publicTrackingUrl(repair.tracking_code);
  const statusAnzeige = [statusLabelDe(repair.status), zusatzInfo].filter(Boolean).join("\n\n");

  if (repair.status === "fertig") {
    logMailOutcome(
      "Fertigstellung",
      repair.tracking_code,
      customer.email,
      sendRepairReadyEmail({
        to: customer.email,
        kundenname: customer.name,
        geraetetyp: device.device_type,
        marke: device.brand?.trim() || "—",
        modell: device.model?.trim() || "—",
        reparaturDetails: formatReparaturDetails({
          problemLabel: repair.problem_label,
          description: repair.description,
          serviceNames,
        }),
        endpreisEuro: formatEuroFromCents(repair.total_cents),
        trackingLink,
      })
    );
    return;
  }

  logMailOutcome(
    "Status-Update",
    repair.tracking_code,
    customer.email,
    sendRepairStatusUpdateEmail({
      to: customer.email,
      kundenname: customer.name,
      geraetetyp: device.device_type,
      marke: device.brand?.trim() || "—",
      modell: device.model?.trim() || "—",
      statusAnzeige,
      teileListe: formatTeileListe(parts),
      trackingLink,
    })
  );
}
