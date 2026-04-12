import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import type { ServiceCategoryKey } from "./lib/serviceCategoryMeta.js";

/** Katalog: typische Werkstattleistungen (Festpreise als Richtwert, zzgl. Teile) */
const SERVICES: { code: string; name: string; price_cents: number; sort: number; category: ServiceCategoryKey }[] = [
  { code: "anfahrt", name: "Anfahrt / Wegepauschale", price_cents: 1500, sort: 5, category: "anfahrt" },
  { code: "diagnose", name: "Diagnose / Erstbefund", price_cents: 4900, sort: 10, category: "diagnose_basis" },
  { code: "cleaning", name: "Reinigung (Staub, Lüfter)", price_cents: 6900, sort: 20, category: "reinigung_kuehlung" },
  { code: "thermal_paste", name: "Wärmeleitpaste CPU/GPU erneuern", price_cents: 3900, sort: 30, category: "reinigung_kuehlung" },
  { code: "luefter_service", name: "Lüfter reinigen oder tauschen", price_cents: 4900, sort: 35, category: "reinigung_kuehlung" },
  { code: "software", name: "Software-Fehlerbehebung", price_cents: 6900, sort: 40, category: "software_os" },
  { code: "virus_remove", name: "Viren- & Malware-Entfernung", price_cents: 7900, sort: 45, category: "software_os" },
  { code: "driver_update", name: "Treiber & Windows-Updates", price_cents: 4900, sort: 50, category: "software_os" },
  { code: "win_install", name: "Windows Neuinstallation", price_cents: 7900, sort: 55, category: "software_os" },
  { code: "os_clone", name: "System klonen (z. B. auf neue SSD)", price_cents: 8900, sort: 60, category: "daten" },
  { code: "backup", name: "Datensicherung", price_cents: 2900, sort: 65, category: "daten" },
  { code: "migration", name: "Datenmigration / -übernahme", price_cents: 7900, sort: 70, category: "daten" },
  { code: "data_recovery_ext", name: "Datenrettung (erweitert)", price_cents: 14900, sort: 75, category: "daten" },
  { code: "ssd_install", name: "SSD einbauen / HDD ersetzen (Arbeit)", price_cents: 6900, sort: 80, category: "speicher_ram" },
  { code: "ram_upgrade", name: "RAM erweitern / einbauen", price_cents: 4900, sort: 85, category: "speicher_ram" },
  { code: "hardware", name: "Hardware-Reparatur (allgemein)", price_cents: 5900, sort: 90, category: "hardware_komponenten" },
  { code: "display", name: "Display / Bildschirm Reparatur", price_cents: 11900, sort: 95, category: "hardware_komponenten" },
  { code: "laptop_battery", name: "Akku-Austausch (Arbeit)", price_cents: 4900, sort: 100, category: "hardware_komponenten" },
  { code: "keyboard_replace", name: "Tastatur-Austausch", price_cents: 6900, sort: 105, category: "hardware_komponenten" },
  { code: "psu_desktop", name: "Netzteil prüfen/tauschen (Desktop)", price_cents: 4900, sort: 110, category: "hardware_komponenten" },
  { code: "wlan_network", name: "WLAN / Netzwerk einrichten", price_cents: 4900, sort: 115, category: "netzwerk" },
  { code: "bios_update", name: "BIOS / UEFI Update", price_cents: 3900, sort: 120, category: "software_os" },
  { code: "office_setup", name: "Office & Software nach Wunsch", price_cents: 5900, sort: 125, category: "software_os" },
];

/**
 * Problem-Key → empfohlene Service-Codes (Vorauswahl; im Wizard änderbar).
 * Diagnose/Erstbefund nur, wenn der Fehler unklar oder nicht sauber einzuordnen ist
 * (z. B. „startet nicht“, „Windows bootet nicht“, Sonstiges). Bei klar umrissenen
 * Themen (langsam, Display, Software, Daten, Neuinstallation, Wasserschaden) nicht vorselektieren.
 */
export const PROBLEM_TO_SERVICES: Record<string, string[]> = {
  startet_nicht: ["diagnose", "hardware", "psu_desktop"],
  langsam: ["cleaning", "software"],
  display_defekt: ["display"],
  software: ["software", "virus_remove"],
  wasser: ["hardware", "cleaning"],
  datenrettung: ["backup", "data_recovery_ext"],
  neuinstallation: ["win_install", "backup"],
  sonstiges: ["diagnose"],
};

export const PROBLEMS: { key: string; label: string }[] = [
  { key: "startet_nicht", label: "Startet nicht / Windows bootet nicht" },
  { key: "langsam", label: "Langsam / hängt" },
  { key: "display_defekt", label: "Display defekt" },
  { key: "software", label: "Software / Windows Fehler" },
  { key: "wasser", label: "Wasserschaden" },
  { key: "datenrettung", label: "Datenrettung / -sicherung" },
  { key: "neuinstallation", label: "Neuinstallation gewünscht" },
  { key: "sonstiges", label: "Sonstiges" },
];

const PART_RULES: { keywords: string[]; part: string; sale_cents: number; notes?: string }[] = [
  { keywords: ["display", "bildschirm", "screen", "glas"], part: "Ersatz-Display (modellspezifisch)", sale_cents: 8900 },
  { keywords: ["akku", "battery"], part: "Ersatz-Akku", sale_cents: 4900 },
  { keywords: ["lade", "usb-c", "buchse", "connector"], part: "Ladebuchse / Flexkabel", sale_cents: 3900 },
  { keywords: ["tastatur", "keyboard"], part: "Ersatz-Tastatur", sale_cents: 6900 },
  { keywords: ["festplatte", "ssd", "hdd"], part: "SSD / Speicher (nach Absprache)", sale_cents: 5900 },
  { keywords: ["lüfter", "fan", "kühl"], part: "Lüfter / Kühlkörper", sale_cents: 2900 },
];

export function seedIfEmpty(db: Database.Database): void {
  const count = db.prepare("SELECT COUNT(*) as c FROM services").get() as { c: number };
  if (count.c > 0) return;

  const insertService = db.prepare(
    `INSERT INTO services (id, code, name, price_cents, sort_order, category) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertRule = db.prepare(
    `INSERT INTO part_suggestion_rules (id, keywords, suggested_part_name, suggested_sale_cents, notes) VALUES (?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (const s of SERVICES) {
      insertService.run(nanoid(), s.code, s.name, s.price_cents, s.sort, s.category);
    }
    for (const r of PART_RULES) {
      insertRule.run(
        nanoid(),
        JSON.stringify(r.keywords),
        r.part,
        r.sale_cents,
        r.notes ?? null
      );
    }
  });
  tx();
}

/** Fehlende Katalog-Codes nachziehen (bestehende DBs behalten Daten; neue Codes werden ergänzt). */
export function ensureServices(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO services (id, code, name, price_cents, sort_order, category) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const s of SERVICES) {
      insert.run(nanoid(), s.code, s.name, s.price_cents, s.sort, s.category);
    }
  });
  tx();
}

/** Kategorie & Stammdaten aus Katalog nachziehen (bestehende Installationen). */
export function syncServiceCatalogFromSeed(db: Database.Database): void {
  const upd = db.prepare(`UPDATE services SET name = ?, price_cents = ?, sort_order = ?, category = ? WHERE code = ?`);
  const tx = db.transaction(() => {
    for (const s of SERVICES) {
      upd.run(s.name, s.price_cents, s.sort, s.category, s.code);
    }
  });
  tx();
}
