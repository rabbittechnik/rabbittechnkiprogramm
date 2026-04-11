-- Rabbit-Technik – SQLite Schema

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  device_image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repairs (
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  problem_key TEXT,
  problem_label TEXT,
  description TEXT,
  accessories TEXT,
  pre_damage_notes TEXT,
  legal_consent_at TEXT,
  signature_data_url TEXT,
  status TEXT NOT NULL DEFAULT 'angenommen',
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'offen',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acceptance_pdf_path TEXT
);

CREATE TABLE IF NOT EXISTS repair_services (
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id),
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (repair_id, service_id)
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_purchase_cents INTEGER,
  default_sale_cents INTEGER
);

CREATE TABLE IF NOT EXISTS repair_parts (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES parts(id),
  name TEXT NOT NULL,
  purchase_cents INTEGER NOT NULL DEFAULT 0,
  sale_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'bestellt',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repair_media (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL UNIQUE REFERENCES repairs(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  pdf_path TEXT,
  total_cents INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'offen',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL UNIQUE REFERENCES repairs(id) ON DELETE CASCADE,
  image_data_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS part_suggestion_rules (
  id TEXT PRIMARY KEY,
  keywords TEXT NOT NULL,
  suggested_part_name TEXT NOT NULL,
  suggested_sale_cents INTEGER NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_repairs_tracking ON repairs(tracking_code);
CREATE INDEX IF NOT EXISTS idx_repairs_customer ON repairs(customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_repair ON repair_parts(repair_id);
