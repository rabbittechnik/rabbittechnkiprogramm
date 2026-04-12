import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

type SeedDevice = {
  type: "router" | "repeater";
  brand: string;
  model: string;
  connection_type: string | null;
  wifi_standard: string;
  speed: string;
  mesh_support: boolean;
  base_price_cents: number;
};

const SEED_DEVICES: SeedDevice[] = [
  // ── Router ────────────────────────────────────────────────────────────────
  { type: "router", brand: "AVM", model: "FRITZ!Box 7590 AX", connection_type: "dsl", wifi_standard: "WiFi 6", speed: "VDSL 300 Mbit/s", mesh_support: true, base_price_cents: 24900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 7590", connection_type: "dsl", wifi_standard: "WiFi 5", speed: "VDSL 300 Mbit/s", mesh_support: true, base_price_cents: 19900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 7530 AX", connection_type: "dsl", wifi_standard: "WiFi 6", speed: "VDSL 300 Mbit/s", mesh_support: true, base_price_cents: 16900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 7530", connection_type: "dsl", wifi_standard: "WiFi 5", speed: "VDSL 100 Mbit/s", mesh_support: true, base_price_cents: 12900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 7510", connection_type: "dsl", wifi_standard: "WiFi 6", speed: "VDSL 100 Mbit/s", mesh_support: true, base_price_cents: 10900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 6690 Cable", connection_type: "kabel", wifi_standard: "WiFi 6E", speed: "Kabel 2.5 Gbit/s", mesh_support: true, base_price_cents: 28900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 6660 Cable", connection_type: "kabel", wifi_standard: "WiFi 6", speed: "Kabel 2.5 Gbit/s", mesh_support: true, base_price_cents: 21900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 6591 Cable", connection_type: "kabel", wifi_standard: "WiFi 5", speed: "Kabel 1.7 Gbit/s", mesh_support: true, base_price_cents: 17900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 5590 Fiber", connection_type: "glasfaser", wifi_standard: "WiFi 6", speed: "Glasfaser 10 Gbit/s", mesh_support: true, base_price_cents: 26900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 5530 Fiber", connection_type: "glasfaser", wifi_standard: "WiFi 6", speed: "Glasfaser 1 Gbit/s", mesh_support: true, base_price_cents: 17900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 6850 5G", connection_type: "lte_5g", wifi_standard: "WiFi 6", speed: "5G / LTE", mesh_support: true, base_price_cents: 52900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 6850 LTE", connection_type: "lte_5g", wifi_standard: "WiFi 5", speed: "LTE Cat. 12", mesh_support: true, base_price_cents: 26900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 4060", connection_type: null, wifi_standard: "WiFi 6E", speed: "Mesh-Router (kein Modem)", mesh_support: true, base_price_cents: 22900 },
  { type: "router", brand: "AVM", model: "FRITZ!Box 4040", connection_type: null, wifi_standard: "WiFi 5", speed: "Router (kein Modem)", mesh_support: true, base_price_cents: 8900 },

  // ── Repeater ──────────────────────────────────────────────────────────────
  { type: "repeater", brand: "AVM", model: "FRITZ!Repeater 6000", connection_type: null, wifi_standard: "WiFi 6E", speed: "Tri-Band bis 6000 Mbit/s", mesh_support: true, base_price_cents: 17900 },
  { type: "repeater", brand: "AVM", model: "FRITZ!Repeater 3000 AX", connection_type: null, wifi_standard: "WiFi 6", speed: "Tri-Band bis 4200 Mbit/s", mesh_support: true, base_price_cents: 14900 },
  { type: "repeater", brand: "AVM", model: "FRITZ!Repeater 2400", connection_type: null, wifi_standard: "WiFi 5", speed: "Dual-Band bis 2400 Mbit/s", mesh_support: true, base_price_cents: 8900 },
  { type: "repeater", brand: "AVM", model: "FRITZ!Repeater 1200 AX", connection_type: null, wifi_standard: "WiFi 6", speed: "Dual-Band bis 1800 Mbit/s", mesh_support: true, base_price_cents: 6900 },
  { type: "repeater", brand: "AVM", model: "FRITZ!Repeater 1200", connection_type: null, wifi_standard: "WiFi 5", speed: "Dual-Band bis 1266 Mbit/s", mesh_support: true, base_price_cents: 5400 },
  { type: "repeater", brand: "AVM", model: "FRITZ!Repeater 600", connection_type: null, wifi_standard: "WiFi 5", speed: "Single-Band bis 600 Mbit/s", mesh_support: true, base_price_cents: 3900 },
  { type: "repeater", brand: "AVM", model: "FRITZ!DECT Repeater 100", connection_type: null, wifi_standard: "DECT", speed: "DECT-Reichweite", mesh_support: false, base_price_cents: 4900 },
  { type: "repeater", brand: "AVM", model: "FRITZ!Powerline 1260E", connection_type: null, wifi_standard: "WiFi 5", speed: "Powerline 1200 + WLAN", mesh_support: true, base_price_cents: 9900 },
];

export function seedNetworkCatalog(db: Database.Database): void {
  const existing = db.prepare(`SELECT COUNT(*) as c FROM network_devices`).get() as { c: number };
  if (existing.c > 0) return;

  const ins = db.prepare(
    `INSERT OR IGNORE INTO network_devices (id, type, brand, model, connection_type, wifi_standard, speed, mesh_support, base_price_cents, source)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const tx = db.transaction(() => {
    for (const d of SEED_DEVICES) {
      ins.run(nanoid(), d.type, d.brand, d.model, d.connection_type, d.wifi_standard, d.speed, d.mesh_support ? 1 : 0, d.base_price_cents, "seed");
    }
  });
  tx();
  console.log(`[network] ${SEED_DEVICES.length} Geräte geseedet`);
}

export async function refreshFromAvm(db: Database.Database): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  try {
    const res = await fetch("https://avm.de/produkte/fritzbox/", {
      headers: { "User-Agent": "Rabbit-Technik/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const modelPattern = /FRITZ!(?:Box|Repeater)\s+[\w\s.]+/g;
    const found = [...new Set(html.match(modelPattern) ?? [])];

    if (found.length > 0) {
      for (const model of found) {
        const trimmed = model.trim();
        const exists = db.prepare(`SELECT id FROM network_devices WHERE model = ?`).get(trimmed);
        if (!exists) {
          console.log(`[network] Neues Modell gefunden: ${trimmed} (manuell Preis/Typ pflegen)`);
        }
      }
      updated = found.length;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`AVM-Scraping fehlgeschlagen: ${msg}`);
    console.warn("[network] AVM-Scraping fehlgeschlagen, Seed-Daten bleiben aktiv:", msg);
  }

  const count = (db.prepare(`SELECT COUNT(*) as c FROM network_devices`).get() as { c: number }).c;
  if (count === 0) {
    seedNetworkCatalog(db);
    errors.push("Katalog war leer → Seed-Daten geladen");
  }

  return { updated, errors };
}
