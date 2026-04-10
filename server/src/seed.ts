import { nanoid } from "nanoid";
import type Database from "better-sqlite3";

const SERVICES: { code: string; name: string; price_cents: number; sort: number }[] = [
  { code: "win_install", name: "Windows Neuinstallation", price_cents: 7900, sort: 10 },
  { code: "diagnose", name: "Diagnose", price_cents: 4900, sort: 20 },
  { code: "cleaning", name: "Reinigung", price_cents: 6900, sort: 30 },
  { code: "display", name: "Display Reparatur", price_cents: 11900, sort: 40 },
  { code: "hardware", name: "Hardware Reparatur", price_cents: 5900, sort: 50 },
  { code: "software", name: "Software Fehlerbehebung", price_cents: 6900, sort: 60 },
  { code: "backup", name: "Datensicherung", price_cents: 2900, sort: 70 },
  { code: "migration", name: "Datenmigration", price_cents: 7900, sort: 80 },
];

/** Problem-Key → empfohlene Service-Codes (Preis-Engine) */
export const PROBLEM_TO_SERVICES: Record<string, string[]> = {
  startet_nicht: ["diagnose", "hardware"],
  langsam: ["diagnose", "cleaning", "software"],
  display_defekt: ["display", "diagnose"],
  software: ["software", "diagnose"],
  wasser: ["diagnose", "hardware"],
  datenrettung: ["backup", "diagnose"],
  neuinstallation: ["win_install", "backup"],
  sonstiges: ["diagnose"],
};

export const PROBLEMS: { key: string; label: string }[] = [
  { key: "startet_nicht", label: "Startet nicht" },
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
    `INSERT INTO services (id, code, name, price_cents, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  const insertRule = db.prepare(
    `INSERT INTO part_suggestion_rules (id, keywords, suggested_part_name, suggested_sale_cents, notes) VALUES (?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (const s of SERVICES) {
      insertService.run(nanoid(), s.code, s.name, s.price_cents, s.sort);
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
