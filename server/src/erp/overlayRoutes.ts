import type { Express } from "express";
import type Database from "better-sqlite3";
import { requireWorkshopFullAuth } from "../lib/workshopAuth.js";
import { generateDatevExport, datevExportPreview } from "../lib/datevExport.js";

/**
 * ERP-/Buchhaltungs-Overlay: ausschließlich lesend auf bestehende Tabellen (customers, repairs, invoices, Zahlungsfelder).
 * Keine neuen Kern-Tabellen, keine Änderung am Annahme-/Werkstatt-Flow.
 */
export function registerErpOverlayRoutes(app: Express, db: Database.Database): void {
  app.get("/api/erp/overview", requireWorkshopFullAuth, (_req, res) => {
    const customers = db.prepare(`SELECT COUNT(*) AS c FROM customers`).get() as { c: number };
    const invoices = db.prepare(`SELECT COUNT(*) AS c FROM invoices`).get() as { c: number };
    const repairs = db.prepare(`SELECT COUNT(*) AS c FROM repairs`).get() as { c: number };
    const paid = db
      .prepare(`SELECT COALESCE(SUM(total_cents), 0) AS s FROM repairs WHERE payment_status = 'bezahlt' AND is_test = 0`)
      .get() as { s: number };
    const open = db
      .prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS s FROM repairs
         WHERE payment_status = 'offen' AND status IN ('fertig', 'abgeholt') AND is_test = 0`
      )
      .get() as { s: number };
    res.json({
      layer: "erp-overlay",
      readOnly: true,
      customers: { count: customers.c },
      invoices: { count: invoices.c },
      repairs: { count: repairs.c },
      totals: {
        paidCents: paid.s,
        openReceivablesCents: open.s,
      },
    });
  });

  app.get("/api/erp/customers", requireWorkshopFullAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, email, phone, address, created_at FROM customers
         ORDER BY datetime(created_at) DESC LIMIT 500`
      )
      .all();
    res.json({ source: "customers", readOnly: true, rows });
  });

  app.get("/api/erp/invoices", requireWorkshopFullAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT i.id, i.repair_id, i.invoice_number, i.total_cents, i.payment_status, i.created_at AS invoice_created_at,
                i.document_status, i.document_kind, i.finalized_at, i.retention_until, i.references_invoice_id,
                r.tracking_code, r.status AS repair_status, r.payment_method,
                c.name AS customer_name
         FROM invoices i
         JOIN repairs r ON r.id = i.repair_id
         JOIN customers c ON c.id = r.customer_id
         ORDER BY datetime(i.created_at) DESC
         LIMIT 500`
      )
      .all();
    res.json({ source: "invoices", readOnly: true, rows });
  });

  app.get("/api/erp/repairs-financial", requireWorkshopFullAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT r.id, r.tracking_code, r.status, r.total_cents, r.payment_status, r.payment_method,
                r.payment_paid_at, r.payment_due_at, r.created_at, r.updated_at, c.name AS customer_name
         FROM repairs r
         JOIN customers c ON c.id = r.customer_id
         ORDER BY datetime(r.updated_at) DESC
         LIMIT 500`
      )
      .all();
    res.json({ source: "repairs", readOnly: true, rows });
  });

  /**
   * DATEV Buchungsstapel – Vorschau (Zusammenfassung für Zeitraum, kein CSV).
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  app.get("/api/erp/datev/preview", requireWorkshopFullAuth, (req, res) => {
    const from = String(req.query.from ?? "").trim();
    const to = String(req.query.to ?? "").trim();
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: "from und to als YYYY-MM-DD angeben" });
      return;
    }
    res.json({ readOnly: true, ...datevExportPreview(db, { from, to }) });
  });

  /**
   * DATEV Buchungsstapel – CSV-Download (UTF-8 mit BOM, Semikolon-getrennt).
   * Rein lesend – Originaldaten werden nicht verändert.
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  app.get("/api/erp/datev/export.csv", requireWorkshopFullAuth, (req, res) => {
    const from = String(req.query.from ?? "").trim();
    const to = String(req.query.to ?? "").trim();
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: "from und to als YYYY-MM-DD angeben" });
      return;
    }
    const result = generateDatevExport(db, { from, to });
    res
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="${result.filename}"`)
      .send(result.csv);
  });
}
