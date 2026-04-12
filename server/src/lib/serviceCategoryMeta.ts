/**
 * Leistungs-Kategorien: einheitlich für DB (`services.category`), API und Abrechnung.
 * Schlüssel stabil halten (Auswertungen / Migrationen).
 */

export const SERVICE_CATEGORY_ORDER = [
  "diagnose_basis",
  "reinigung_kuehlung",
  "software_os",
  "daten",
  "speicher_ram",
  "hardware_komponenten",
  "netzwerk",
  "anfahrt",
  "sonstiges",
] as const;

export type ServiceCategoryKey = (typeof SERVICE_CATEGORY_ORDER)[number];

export const SERVICE_CATEGORY_LABEL_DE: Record<ServiceCategoryKey, string> = {
  diagnose_basis: "Diagnose & Basis",
  reinigung_kuehlung: "Reinigung & Kühlung",
  software_os: "Software & Betriebssystem",
  daten: "Daten",
  speicher_ram: "Speicher & Arbeitsspeicher",
  hardware_komponenten: "Hardware & Komponenten",
  netzwerk: "Netzwerk",
  anfahrt: "Anfahrt & Wege",
  sonstiges: "Sonstiges",
};

export const ANFAHRT_CATEGORY_KEY: ServiceCategoryKey = "anfahrt";

/** Default-Kategorie für unbekannte / alte Codes */
export const SERVICE_CATEGORY_FALLBACK: ServiceCategoryKey = "sonstiges";

export function normalizeServiceCategoryKey(raw: string | null | undefined): ServiceCategoryKey {
  const s = (raw ?? "").trim();
  return (SERVICE_CATEGORY_ORDER as readonly string[]).includes(s) ? (s as ServiceCategoryKey) : SERVICE_CATEGORY_FALLBACK;
}

export type PublicServiceRow = {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  sort_order: number;
  category_key: ServiceCategoryKey;
  category_label_de: string;
  category_sort_index: number;
};

/** API-/Wizard-Zeile aus DB-Zeile `services`. */
export function toPublicServiceRow(r: {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  sort_order: number;
  category?: string | null;
}): PublicServiceRow {
  const category_key = normalizeServiceCategoryKey(r.category);
  const category_sort_index = SERVICE_CATEGORY_ORDER.indexOf(category_key);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    price_cents: r.price_cents,
    sort_order: r.sort_order,
    category_key,
    category_label_de: SERVICE_CATEGORY_LABEL_DE[category_key],
    category_sort_index: category_sort_index === -1 ? 99 : category_sort_index,
  };
}
