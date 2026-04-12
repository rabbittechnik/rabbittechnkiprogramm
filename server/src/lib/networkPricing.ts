import type Database from "better-sqlite3";

function getSetting(db: Database.Database, key: string, fallback: string): string {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function getMarkupPercent(db: Database.Database): number {
  const v = parseFloat(getSetting(db, "network_markup_percent", "10"));
  return Number.isFinite(v) && v >= 0 ? v : 10;
}

export function getServiceFeeCents(db: Database.Database): number {
  const v = parseInt(getSetting(db, "network_service_fee_cents", "8900"), 10);
  return Number.isFinite(v) && v >= 0 ? v : 8900;
}

export function getServiceFeeMode(db: Database.Database): "flat" | "hourly" {
  const v = getSetting(db, "network_service_fee_mode", "flat");
  return v === "hourly" ? "hourly" : "flat";
}

export function calculateItemPrice(baseCents: number, markupPercent: number): number {
  return Math.round(baseCents * (1 + markupPercent / 100));
}

/** USt-Betrag aus Bruttopreis (Preise inkl. 19 % USt, DE-Standard). */
export const NETWORK_VAT_RATE_PERCENT = 19;

export function vatFromGrossCents(grossCents: number): { netCents: number; vatCents: number; vatRatePercent: number } {
  const netCents = Math.round(grossCents / (1 + NETWORK_VAT_RATE_PERCENT / 100));
  return { netCents, vatCents: grossCents - netCents, vatRatePercent: NETWORK_VAT_RATE_PERCENT };
}

export type OrderItem = { device_id: string; quantity: number };
export type PricedItem = OrderItem & { base_price_cents: number; unit_price_cents: number; line_total_cents: number; model: string; brand: string; type: string };

export function calculateOrderTotals(
  db: Database.Database,
  items: OrderItem[]
): { pricedItems: PricedItem[]; hardwareTotalCents: number; serviceFeeCents: number; grandTotalCents: number } {
  const markup = getMarkupPercent(db);
  const serviceFeeCents = getServiceFeeCents(db);

  const pricedItems: PricedItem[] = [];
  let hardwareTotalCents = 0;

  for (const item of items) {
    const dev = db.prepare(`SELECT id, model, brand, type, base_price_cents FROM network_devices WHERE id = ?`).get(item.device_id) as
      | { id: string; model: string; brand: string; type: string; base_price_cents: number }
      | undefined;
    if (!dev) continue;

    const unitPrice = calculateItemPrice(dev.base_price_cents, markup);
    const lineTotal = unitPrice * item.quantity;
    hardwareTotalCents += lineTotal;

    pricedItems.push({
      device_id: dev.id,
      quantity: item.quantity,
      base_price_cents: dev.base_price_cents,
      unit_price_cents: unitPrice,
      line_total_cents: lineTotal,
      model: dev.model,
      brand: dev.brand,
      type: dev.type,
    });
  }

  return {
    pricedItems,
    hardwareTotalCents,
    serviceFeeCents,
    grandTotalCents: hardwareTotalCents + serviceFeeCents,
  };
}
