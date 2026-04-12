/**
 * Festes Katalog-Layout „Teile bestellen“ – keine dynamischen Kategorien.
 * Einkaufspreis intern; Verkauf = Einkauf + Aufschlag (BPS).
 */

export const DEFAULT_MARKUP_BPS = 1000; // 10 %

export type TeileProduct = {
  id: string;
  category_id: string;
  category_label: string;
  subcategory_id: string;
  subcategory_label: string;
  name: string;
  description: string;
  purchase_cents: number;
  sale_cents: number;
  image_url: string | null;
};

export type TeileSubcategory = {
  id: string;
  label: string;
  products: TeileProduct[];
};

export type TeileCategory = {
  id: string;
  label: string;
  subcategories: TeileSubcategory[];
};

type RawSub = { id: string; label: string; purchase: number };
type RawCat = { id: string; label: string; subs: RawSub[] };

const RAW_TREE: RawCat[] = [
  {
    id: "monitore",
    label: "Monitore",
    subs: [
      { id: "office", label: "Office Monitore", purchase: 11900 },
      { id: "gaming", label: "Gaming Monitore", purchase: 24900 },
      { id: "curved", label: "Curved Monitore", purchase: 18900 },
      { id: "ultrawide", label: "Ultrawide Monitore", purchase: 32900 },
      { id: "4k", label: "4K / High-Resolution Monitore", purchase: 39900 },
      { id: "zubehoer", label: "Monitor Zubehör (Halterungen, Ständer, Kabel)", purchase: 2900 },
    ],
  },
  {
    id: "kabel",
    label: "Kabel",
    subs: [
      { id: "lan", label: "LAN / Ethernet Kabel (Cat5e / Cat6 / Cat7 / Cat8)", purchase: 800 },
      { id: "hdmi_dp", label: "HDMI / DisplayPort Kabel", purchase: 900 },
      { id: "usb", label: "USB Kabel (USB-A / USB-C / Micro / Lightning)", purchase: 700 },
      { id: "strom", label: "Stromkabel / Verlängerungen", purchase: 600 },
      { id: "patch", label: "Netzwerk Patchkabel", purchase: 500 },
      { id: "adapter", label: "Adapter (USB / HDMI / VGA / DVI)", purchase: 1200 },
      { id: "mgmt", label: "Kabelmanagement", purchase: 1500 },
    ],
  },
  {
    id: "drucker",
    label: "Drucker",
    subs: [
      { id: "laser", label: "Laserdrucker", purchase: 14900 },
      { id: "tinte", label: "Tintenstrahldrucker", purchase: 9900 },
      { id: "mfp", label: "Multifunktionsdrucker", purchase: 17900 },
      { id: "etikett", label: "Etikettendrucker", purchase: 8900 },
      { id: "thermo", label: "Thermodrucker", purchase: 2200 },
      { id: "zubehoer", label: "Druckerzubehör (Toner, Patronen, Papier)", purchase: 4500 },
    ],
  },
  {
    id: "speicher",
    label: "Festplatten / SSD",
    subs: [
      { id: "hdd_int", label: "HDD Festplatten (intern)", purchase: 5900 },
      { id: "ssd_sata", label: "SSD SATA", purchase: 4900 },
      { id: "ssd_nvme", label: "SSD NVMe / M.2", purchase: 6900 },
      { id: "extern", label: "Externe Festplatten", purchase: 7900 },
      { id: "nas", label: "NAS Speicher", purchase: 24900 },
      { id: "zubehoer", label: "Speicherzubehör", purchase: 1900 },
    ],
  },
  {
    id: "netzwerk",
    label: "Router / Netzwerk",
    subs: [
      { id: "dsl", label: "DSL Router", purchase: 6900 },
      { id: "kabel", label: "Kabel Router", purchase: 8900 },
      { id: "fiber", label: "Glasfaser Router", purchase: 12900 },
      { id: "lte", label: "LTE / 5G Router", purchase: 14900 },
      { id: "mesh", label: "Mesh Systeme", purchase: 19900 },
      { id: "ap", label: "Access Points", purchase: 7900 },
      { id: "switch", label: "Switches", purchase: 5900 },
      { id: "repeater", label: "Repeater", purchase: 4900 },
      { id: "powerline", label: "Powerline Adapter", purchase: 6900 },
      { id: "zubehoer", label: "Netzwerk Zubehör", purchase: 2200 },
    ],
  },
  {
    id: "pc_komponenten",
    label: "PC-Komponenten",
    subs: [
      { id: "cpu", label: "CPU", purchase: 19900 },
      { id: "mb", label: "Mainboard", purchase: 12900 },
      { id: "ram", label: "RAM", purchase: 4900 },
      { id: "gpu", label: "GPU", purchase: 34900 },
      { id: "psu", label: "Netzteile", purchase: 7900 },
      { id: "case", label: "Gehäuse", purchase: 6900 },
      { id: "luft", label: "Lüfter / Air Cooling", purchase: 2900 },
      { id: "wakue", label: "Wasserkühlung", purchase: 8900 },
      { id: "intern", label: "interne SSD / HDD", purchase: 5900 },
      { id: "sound", label: "Soundkarten", purchase: 4900 },
      { id: "nic", label: "Netzwerkkarten", purchase: 2900 },
    ],
  },
  {
    id: "zubehoer",
    label: "Zubehör",
    subs: [
      { id: "tastatur", label: "Tastaturen", purchase: 3900 },
      { id: "maus", label: "Mäuse", purchase: 2900 },
      { id: "headset", label: "Headsets", purchase: 5900 },
      { id: "webcam", label: "Webcams", purchase: 4900 },
      { id: "mikro", label: "Mikrofone", purchase: 6900 },
      { id: "docking", label: "Docking Stations", purchase: 12900 },
      { id: "hub", label: "USB Hubs", purchase: 2400 },
      { id: "adapter", label: "Adapter", purchase: 1500 },
      { id: "laptop", label: "Laptop Zubehör", purchase: 2200 },
      { id: "smartphone", label: "Smartphone Zubehör", purchase: 1800 },
    ],
  },
  {
    id: "sonstiges",
    label: "Sonstiges",
    subs: [
      { id: "unsortiert", label: "Unsortierte Artikel", purchase: 1000 },
      { id: "spezial", label: "Spezialhardware", purchase: 5000 },
      { id: "individuell", label: "Individuelle Kundenanfragen", purchase: 2000 },
      { id: "reparatur", label: "Reparaturteile", purchase: 3500 },
    ],
  },
];

export function saleFromPurchase(purchaseCents: number, markupBps: number): number {
  return Math.round((purchaseCents * (10000 + markupBps)) / 10000);
}

function buildProduct(cat: RawCat, sub: RawSub, markupBps: number): TeileProduct {
  const id = `${cat.id}__${sub.id}`;
  const sale = saleFromPurchase(sub.purchase, markupBps);
  return {
    id,
    category_id: cat.id,
    category_label: cat.label,
    subcategory_id: sub.id,
    subcategory_label: sub.label,
    name: `${sub.label} – Standard`,
    description:
      `Katalogposition für „${sub.label}“. Konkretes Modell wird im Auftrag festgehalten; Lieferzeit nach Absprache.`,
    purchase_cents: sub.purchase,
    sale_cents: sale,
    image_url: null,
  };
}

export function buildTeileBestellenCatalog(markupBps: number = DEFAULT_MARKUP_BPS): TeileCategory[] {
  return RAW_TREE.map((cat) => ({
    id: cat.id,
    label: cat.label,
    subcategories: cat.subs.map((sub) => ({
      id: sub.id,
      label: sub.label,
      products: [buildProduct(cat, sub, markupBps)],
    })),
  }));
}

const PRODUCT_INDEX: Map<string, TeileProduct> = new Map();

function ensureIndex(): void {
  if (PRODUCT_INDEX.size > 0) return;
  for (const c of buildTeileBestellenCatalog()) {
    for (const s of c.subcategories) {
      for (const p of s.products) {
        PRODUCT_INDEX.set(p.id, p);
      }
    }
  }
}

export function getTeileProductById(id: string): TeileProduct | undefined {
  ensureIndex();
  return PRODUCT_INDEX.get(id);
}

export function listAllTeileProducts(): TeileProduct[] {
  ensureIndex();
  return [...PRODUCT_INDEX.values()];
}

export function searchTeileProducts(query: string, limit = 80): TeileProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = listAllTeileProducts();
  const scored = all
    .map((p) => {
      const hay = `${p.name} ${p.description} ${p.category_label} ${p.subcategory_label}`.toLowerCase();
      if (!hay.includes(q)) return null;
      let score = 0;
      if (p.name.toLowerCase().includes(q)) score += 3;
      if (p.subcategory_label.toLowerCase().includes(q)) score += 2;
      if (p.category_label.toLowerCase().includes(q)) score += 1;
      return { p, score };
    })
    .filter(Boolean) as { p: TeileProduct; score: number }[];
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.p);
}
