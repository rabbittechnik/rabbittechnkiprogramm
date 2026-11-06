/** Embedded so `npm run build` works without copying .sql files. */
export const SCHEMA_SQL = `
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
  sort_order INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'sonstiges'
);

CREATE TABLE IF NOT EXISTS repair_order_sequences (
  year TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repairs (
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  repair_order_number TEXT,
  repair_order_pdf_path TEXT,
  repair_order_label_pdf_path TEXT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  problem_key TEXT,
  problem_label TEXT,
  description TEXT,
  accessories TEXT,
  pre_damage_notes TEXT,
  legal_consent_at TEXT,
  signature_data_url TEXT,
  intake_location TEXT NOT NULL DEFAULT 'werkstatt' CHECK (intake_location IN ('werkstatt', 'aussendienst')),
  field_arrived_at TEXT,
  field_completed_at TEXT,
  field_outcome TEXT CHECK (field_outcome IN ('vor_ort', 'mitnehmen')),
  quote_accepted_at TEXT,
  status TEXT NOT NULL DEFAULT 'angenommen',
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'offen',
  payment_method TEXT,
  payment_due_at TEXT,
  sumup_checkout_id TEXT,
  sumup_checkout_url TEXT,
  payment_paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acceptance_pdf_path TEXT,
  is_test INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repair_services (
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id),
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (repair_id, service_id)
);

CREATE TABLE IF NOT EXISTS repair_service_notes (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id),
  service_code TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT 'field'
);
CREATE INDEX IF NOT EXISTS idx_repair_service_notes_repair ON repair_service_notes(repair_id);

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
  barcode TEXT,
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

CREATE TABLE IF NOT EXISTS repair_logs (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INTEGER,
  created_by TEXT NOT NULL DEFAULT 'workshop'
);

CREATE INDEX IF NOT EXISTS idx_repair_logs_repair ON repair_logs(repair_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  pdf_path TEXT,
  total_cents INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'offen',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  document_status TEXT NOT NULL DEFAULT 'entwurf',
  document_kind TEXT NOT NULL DEFAULT 'rechnung',
  finalized_at TEXT,
  retention_until TEXT,
  pdf_sha256 TEXT,
  references_invoice_id TEXT
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

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'field' CHECK (role IN ('admin', 'field')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_calendar_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  repair_id TEXT REFERENCES repairs(id),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'kundentermin',
  reminder_minutes INTEGER NOT NULL DEFAULT 60,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_business_calendar_window ON business_calendar_events(starts_at, ends_at);

-- Eingang aus separater Mobile-Annahme; erst nach Werkstatt-Prüfung importieren.
CREATE TABLE IF NOT EXISTS mobile_intake_submissions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected', 'imported')),
  payload_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_mobile_intake_status_submitted
  ON mobile_intake_submissions(status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS tagesabschluesse (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_cents INTEGER NOT NULL,
  bar_cents INTEGER NOT NULL DEFAULT 0,
  online_sumup_cents INTEGER NOT NULL DEFAULT 0,
  tap_to_pay_cents INTEGER NOT NULL DEFAULT 0,
  ueberweisung_cents INTEGER NOT NULL DEFAULT 0,
  other_cents INTEGER NOT NULL DEFAULT 0,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  transactions_json TEXT NOT NULL,
  register_balance_eod_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tagesabschluesse_date ON tagesabschluesse(business_date DESC);

CREATE TABLE IF NOT EXISTS monatsberichte (
  id TEXT PRIMARY KEY,
  year_month TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_cents INTEGER NOT NULL,
  bar_cents INTEGER NOT NULL DEFAULT 0,
  online_sumup_cents INTEGER NOT NULL DEFAULT 0,
  tap_to_pay_cents INTEGER NOT NULL DEFAULT 0,
  ueberweisung_cents INTEGER NOT NULL DEFAULT 0,
  other_cents INTEGER NOT NULL DEFAULT 0,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  parts_purchase_cents INTEGER NOT NULL DEFAULT 0,
  gross_profit_cents INTEGER NOT NULL,
  overview_json TEXT NOT NULL,
  transactions_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monatsberichte_ym ON monatsberichte(year_month DESC);
CREATE INDEX IF NOT EXISTS idx_repairs_tracking ON repairs(tracking_code);
CREATE INDEX IF NOT EXISTS idx_repairs_customer ON repairs(customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_repair ON repair_parts(repair_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_parts_barcode_unique ON repair_parts(barcode) WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS network_devices (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'AVM',
  model TEXT NOT NULL,
  connection_type TEXT,
  wifi_standard TEXT,
  speed TEXT,
  mesh_support INTEGER NOT NULL DEFAULT 0,
  base_price_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS network_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'bestellt',
  service_fee_cents INTEGER NOT NULL DEFAULT 0,
  hardware_total_cents INTEGER NOT NULL DEFAULT 0,
  grand_total_cents INTEGER NOT NULL DEFAULT 0,
  signature_data_url TEXT,
  confirmation_pdf_path TEXT,
  payment_status TEXT NOT NULL DEFAULT 'offen',
  payment_method TEXT,
  payment_paid_at TEXT,
  payment_due_at TEXT,
  sumup_checkout_id TEXT,
  sumup_checkout_url TEXT,
  sumup_channel TEXT,
  invoice_number TEXT UNIQUE,
  invoice_pdf_path TEXT,
  invoice_pdf_sha256 TEXT,
  invoice_finalized_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS network_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES network_orders(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES network_devices(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_network_orders_customer ON network_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_network_orders_status ON network_orders(status);
CREATE INDEX IF NOT EXISTS idx_network_order_items_order ON network_order_items(order_id);

CREATE TABLE IF NOT EXISTS hardware_catalog_orders (
  id TEXT PRIMARY KEY,
  reference_code TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'angebot',
  markup_bps INTEGER NOT NULL DEFAULT 1000,
  total_sale_cents INTEGER NOT NULL,
  total_purchase_cents INTEGER NOT NULL,
  signature_data_url TEXT,
  send_customer_email INTEGER NOT NULL DEFAULT 0,
  customer_email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hardware_catalog_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES hardware_catalog_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL,
  subcategory_id TEXT NOT NULL,
  subcategory_label TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_sale_cents INTEGER NOT NULL,
  unit_purchase_cents INTEGER NOT NULL,
  line_sale_cents INTEGER NOT NULL,
  line_purchase_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hardware_orders_customer ON hardware_catalog_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_hardware_orders_created ON hardware_catalog_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hardware_order_lines_order ON hardware_catalog_order_lines(order_id);
`;
