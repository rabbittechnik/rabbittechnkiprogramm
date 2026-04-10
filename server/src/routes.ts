import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, Request, Response } from "express";
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import QRCode from "qrcode";
import { PROBLEMS } from "./seed.js";
import { getServiceRowsByCodes, getSuggestedServiceCodes, sumServiceCents } from "./lib/pricing.js";
import { recalculateRepairTotal, syncRepairStatusForParts } from "./lib/repairTotals.js";
import { writeInvoicePdf } from "./lib/pdfInvoice.js";
import { makeTrackingCode } from "./lib/trackingCode.js";
import { resolveDeviceImage } from "./lib/deviceImage.js";
import {
  isWorkshopPasswordConfigured,
  verifyWorkshopPassword,
  signWorkshopToken,
  requireWorkshopAuth,
} from "./lib/workshopAuth.js";
import { sendRepairConfirmation } from "./lib/mail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_DIR = path.join(__dirname, "../data/uploads");

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Route-Parameter als string (Express-Typ kann string | string[] sein). */
export function paramStr(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export function registerRoutes(app: Express, db: Database.Database) {
  ensureUploadDir();

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  /** Öffentliche Kennzahlen für die Hauptseite */
  app.get("/api/dashboard/summary", (_req, res) => {
    const openRow = db
      .prepare(`SELECT COUNT(*) as c FROM repairs WHERE status NOT IN ('abgeholt')`)
      .get() as { c: number };
    const fertigRow = db
      .prepare(`SELECT COUNT(*) as c FROM repairs WHERE status IN ('fertig')`)
      .get() as { c: number };
    const revRow = db
      .prepare(
        `SELECT COALESCE(SUM(total_cents), 0) as s FROM repairs WHERE date(created_at) = date('now')`
      )
      .get() as { s: number };
    const recent = db
      .prepare(
        `SELECT tracking_code, status, updated_at FROM repairs ORDER BY datetime(updated_at) DESC LIMIT 5`
      )
      .all() as { tracking_code: string; status: string; updated_at: string }[];
    const last = db
      .prepare(`SELECT tracking_code FROM repairs ORDER BY datetime(created_at) DESC LIMIT 1`)
      .get() as { tracking_code: string } | undefined;
    res.json({
      openCount: openRow.c,
      fertigCount: fertigRow.c,
      revenueTodayCents: revRow.s,
      recent,
      lastTrackingCode: last?.tracking_code ?? null,
    });
  });

  app.get("/api/customers", requireWorkshopAuth, (_req, res) => {
    const rows = db
      .prepare(`SELECT id, name, email, phone, address, created_at FROM customers ORDER BY datetime(created_at) DESC LIMIT 500`)
      .all();
    res.json(rows);
  });

  app.post("/api/customers", requireWorkshopAuth, (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "Name fehlt" });
      return;
    }
    const id = nanoid();
    db.prepare(`INSERT INTO customers (id, name, email, phone, address) VALUES (?,?,?,?,?)`).run(
      id,
      name,
      req.body?.email ? String(req.body.email) : null,
      req.body?.phone ? String(req.body.phone) : null,
      req.body?.address ? String(req.body.address) : null
    );
    const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id);
    res.status(201).json({ customer: row });
  });

  app.get("/api/auth/status", (_req, res) => {
    res.json({ workshopAuthRequired: isWorkshopPasswordConfigured() });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!isWorkshopPasswordConfigured()) {
      res.json({ token: null as string | null, workshopAuthRequired: false });
      return;
    }
    const password = String(req.body?.password ?? "");
    if (!verifyWorkshopPassword(password)) {
      res.status(401).json({ error: "Ungültiges Passwort" });
      return;
    }
    res.json({ token: signWorkshopToken(), workshopAuthRequired: true, expiresInDays: 7 });
  });

  app.get("/api/services", (_req, res) => {
    const rows = db.prepare(`SELECT id, code, name, price_cents, sort_order FROM services ORDER BY sort_order`).all();
    res.json(rows);
  });

  app.get("/api/problems", (_req, res) => {
    res.json(PROBLEMS);
  });

  /** Live-Preis + Vorschlag Services */
  app.post("/api/repairs/preview", (req, res) => {
    const problemKey = String(req.body?.problem_key ?? "");
    const extraCodes = Array.isArray(req.body?.extra_service_codes) ? req.body.extra_service_codes : [];
    const codes = [...new Set([...getSuggestedServiceCodes(problemKey), ...extraCodes.map(String)])];
    const rows = getServiceRowsByCodes(db, codes);
    const total_cents = sumServiceCents(rows);
    res.json({ suggested_service_codes: codes, services: rows, total_cents });
  });

  /** Automatische Teile-Vorschläge aus Freitext / Problem */
  app.get("/api/suggestions/parts", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const rules = db
      .prepare(`SELECT id, keywords, suggested_part_name, suggested_sale_cents, notes FROM part_suggestion_rules`)
      .all() as {
      id: string;
      keywords: string;
      suggested_part_name: string;
      suggested_sale_cents: number;
      notes: string | null;
    }[];
    const matched: { id: string; name: string; sale_cents: number; notes: string | null; score: number }[] = [];
    for (const r of rules) {
      let kws: string[] = [];
      try {
        kws = JSON.parse(r.keywords) as string[];
      } catch {
        continue;
      }
      let score = 0;
      for (const kw of kws) {
        if (q.includes(kw.toLowerCase())) score += 1;
      }
      if (score > 0) {
        matched.push({
          id: r.id,
          name: r.suggested_part_name,
          sale_cents: r.suggested_sale_cents,
          notes: r.notes,
          score,
        });
      }
    }
    matched.sort((a, b) => b.score - a.score);
    res.json({ suggestions: matched.slice(0, 8) });
  });

  /** Gerätebild: Wikimedia Commons (Standard), optional Unsplash, Fallback Picsum */
  app.get("/api/device-image", async (req, res) => {
    const query = String(req.query.q ?? "device");
    try {
      const result = await resolveDeviceImage(query);
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post("/api/repairs", async (req, res) => {
    try {
      const body = req.body ?? {};
      const customer = {
        name: String(body.customer?.name ?? "").trim(),
        email: body.customer?.email ? String(body.customer.email) : null,
        phone: body.customer?.phone ? String(body.customer.phone) : null,
        address: body.customer?.address ? String(body.customer.address) : null,
      };
      if (!customer.name) {
        res.status(400).json({ error: "Kundenname fehlt" });
        return;
      }

      const problemKey = String(body.problem_key ?? "");
      const problemLabel =
        PROBLEMS.find((p) => p.key === problemKey)?.label ?? body.problem_label ?? problemKey;
      const extraCodes = Array.isArray(body.extra_service_codes) ? body.extra_service_codes.map(String) : [];
      const serviceCodes = [...new Set([...getSuggestedServiceCodes(problemKey), ...extraCodes])];
      const serviceRows = getServiceRowsByCodes(db, serviceCodes);

      const cid = nanoid();
      const did = nanoid();
      const rid = nanoid();
      const tracking = makeTrackingCode();
      const legal = body.legal_consent === true ? new Date().toISOString() : null;
      const signatureDataUrl = body.signature_data_url ? String(body.signature_data_url) : null;

      const deviceImageUrl = body.device?.device_image_url ? String(body.device.device_image_url) : null;

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO customers (id, name, email, phone, address) VALUES (?,?,?,?,?)`
        ).run(cid, customer.name, customer.email, customer.phone, customer.address);

        db.prepare(
          `INSERT INTO devices (id, customer_id, device_type, brand, model, serial_number, device_image_url)
           VALUES (?,?,?,?,?,?,?)`
        ).run(
          did,
          cid,
          String(body.device?.device_type ?? "Sonstiges"),
          body.device?.brand ? String(body.device.brand) : null,
          body.device?.model ? String(body.device.model) : null,
          body.device?.serial_number ? String(body.device.serial_number) : null,
          deviceImageUrl
        );

        db.prepare(
          `INSERT INTO repairs (id, tracking_code, customer_id, device_id, problem_key, problem_label, description, accessories, pre_damage_notes, legal_consent_at, signature_data_url, status, total_cents, payment_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          rid,
          tracking,
          cid,
          did,
          problemKey || null,
          problemLabel,
          body.description ? String(body.description) : null,
          body.accessories ? String(body.accessories) : null,
          body.pre_damage_notes ? String(body.pre_damage_notes) : null,
          legal,
          signatureDataUrl,
          "angenommen",
          0,
          "offen"
        );

        const insRS = db.prepare(
          `INSERT INTO repair_services (repair_id, service_id, price_cents) VALUES (?,?,?)`
        );
        for (const s of serviceRows) {
          insRS.run(rid, s.id, s.price_cents);
        }

        if (signatureDataUrl) {
          const sigId = nanoid();
          db.prepare(`INSERT INTO signatures (id, repair_id, image_data_url) VALUES (?,?,?)`).run(
            sigId,
            rid,
            signatureDataUrl
          );
        }

        recalculateRepairTotal(db, rid);

        const invId = nanoid();
        const invNo = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${rid.slice(0, 6).toUpperCase()}`;
        const total = (db.prepare(`SELECT total_cents FROM repairs WHERE id = ?`).get(rid) as { total_cents: number }).total_cents;
        db.prepare(
          `INSERT INTO invoices (id, repair_id, invoice_number, total_cents, payment_status) VALUES (?,?,?,?,?)`
        ).run(invId, rid, invNo, total, "offen");
      });

      tx();

      const invRow = db.prepare(`SELECT invoice_number FROM invoices WHERE repair_id = ?`).get(rid) as { invoice_number: string };
      const pdfPath = await writeInvoicePdf(db, rid, invRow.invoice_number);
      db.prepare(`UPDATE invoices SET pdf_path = ? WHERE repair_id = ?`).run(pdfPath, rid);

      const row = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(rid);
      res.status(201).json({ repair: row, tracking_code: tracking });

      if (customer.email) {
        const base = process.env.PUBLIC_TRACKING_URL ?? "http://localhost:5173";
        const trackingUrl = `${base.replace(/\/$/, "")}/track/${encodeURIComponent(tracking)}`;
        void sendRepairConfirmation({
          to: customer.email,
          customerName: customer.name,
          trackingCode: tracking,
          trackingUrl,
        }).catch((err) => console.error("E-Mail:", err));
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/repairs/:id", requireWorkshopAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id);
    if (!repair) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    const customer = db.prepare(`SELECT * FROM customers WHERE id = (SELECT customer_id FROM repairs WHERE id = ?)`).get(id);
    const device = db.prepare(`SELECT * FROM devices WHERE id = (SELECT device_id FROM repairs WHERE id = ?)`).get(id);
    const services = db
      .prepare(
        `SELECT s.code, s.name, rs.price_cents FROM repair_services rs JOIN services s ON s.id = rs.service_id WHERE rs.repair_id = ?`
      )
      .all(id);
    const parts = db.prepare(`SELECT * FROM repair_parts WHERE repair_id = ?`).all(id);
    const media = db.prepare(`SELECT id, kind, file_path, mime, created_at FROM repair_media WHERE repair_id = ?`).all(id);
    res.json({ repair, customer, device, services, parts, media });
  });

  app.patch("/api/repairs/:id/status", requireWorkshopAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const status = String(req.body?.status ?? "");
    const allowed = ["angenommen", "diagnose", "wartet_auf_teile", "in_reparatur", "fertig", "abgeholt"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "Ungültiger Status" });
      return;
    }
    const r = db.prepare(`UPDATE repairs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
    if (r.changes === 0) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id);
    res.json({ repair });
  });

  app.patch("/api/repairs/:id/payment", requireWorkshopAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const ps = String(req.body?.payment_status ?? "");
    if (ps !== "offen" && ps !== "bezahlt") {
      res.status(400).json({ error: "Ungültig" });
      return;
    }
    db.prepare(`UPDATE repairs SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`).run(ps, id);
    db.prepare(`UPDATE invoices SET payment_status = ? WHERE repair_id = ?`).run(ps, id);
    res.json({ ok: true });
  });

  app.post("/api/repairs/:id/parts", requireWorkshopAuth, (req, res) => {
    const repairId = paramStr(req.params.id);
    const exists = db.prepare(`SELECT id FROM repairs WHERE id = ?`).get(repairId);
    if (!exists) {
      res.status(404).json({ error: "Auftrag nicht gefunden" });
      return;
    }
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "Teilename fehlt" });
      return;
    }
    const purchase_cents = Math.round(Number(req.body?.purchase_cents ?? 0));
    const sale_cents = Math.round(Number(req.body?.sale_cents ?? 0));
    const pid = nanoid();
    db.prepare(
      `INSERT INTO repair_parts (id, repair_id, part_id, name, purchase_cents, sale_cents, status) VALUES (?,?,?,?,?,?,?)`
    ).run(pid, repairId, null, name, purchase_cents, sale_cents, "bestellt");
    recalculateRepairTotal(db, repairId);
    syncRepairStatusForParts(db, repairId);
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(pid);
    res.status(201).json({ part });
  });

  app.patch("/api/repairs/:repairId/parts/:partId", requireWorkshopAuth, (req, res) => {
    const repairId = paramStr(req.params.repairId);
    const partId = paramStr(req.params.partId);
    const status = String(req.body?.status ?? "");
    const allowed = ["bestellt", "unterwegs", "angekommen", "eingebaut"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "Ungültiger Teile-Status" });
      return;
    }
    const r = db
      .prepare(`UPDATE repair_parts SET status = ? WHERE id = ? AND repair_id = ?`)
      .run(status, partId, repairId);
    if (r.changes === 0) {
      res.status(404).json({ error: "Teil nicht gefunden" });
      return;
    }
    syncRepairStatusForParts(db, repairId);
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(partId);
    res.json({ part });
  });

  /** Öffentliches Tracking */
  app.get("/api/track/:code", (req, res) => {
    const code = paramStr(req.params.code).trim();
    const repair = db.prepare(`SELECT id, tracking_code, status, total_cents, payment_status, updated_at, created_at, problem_label, description FROM repairs WHERE tracking_code = ?`).get(code);
    if (!repair) {
      res.status(404).json({ error: "Code unbekannt" });
      return;
    }
    const r = repair as { id: string };
    const parts = db
      .prepare(`SELECT name, status, sale_cents FROM repair_parts WHERE repair_id = ?`)
      .all(r.id) as { name: string; status: string; sale_cents: number }[];
    res.json({
      tracking: repair,
      parts,
      message:
        parts.some((p) => p.status === "bestellt" || p.status === "unterwegs")
          ? "Reparatur startet nach Eingang der Teile."
          : null,
    });
  });

  /** Öffentlich per Link nach Annahme (kein Workshop-Login auf dem Tablet) */
  app.get("/api/repairs/:id/invoice.pdf", async (req, res) => {
    const id = paramStr(req.params.id);
    const inv = db.prepare(`SELECT pdf_path, invoice_number FROM invoices WHERE repair_id = ?`).get(id) as
      | { pdf_path: string | null; invoice_number: string }
      | undefined;
    if (!inv?.pdf_path || !fs.existsSync(inv.pdf_path)) {
      if (inv) {
        const p = await writeInvoicePdf(db, id, inv.invoice_number);
        db.prepare(`UPDATE invoices SET pdf_path = ? WHERE repair_id = ?`).run(p, id);
        res.sendFile(path.resolve(p));
        return;
      }
      res.status(404).send("Keine Rechnung");
      return;
    }
    res.sendFile(path.resolve(inv.pdf_path));
  });

  app.get("/api/repairs/:id/qr.png", async (req, res) => {
    const id = paramStr(req.params.id);
    const row = db.prepare(`SELECT tracking_code FROM repairs WHERE id = ?`).get(id) as { tracking_code: string } | undefined;
    if (!row) {
      res.status(404).send("Not found");
      return;
    }
    const base = process.env.PUBLIC_TRACKING_URL ?? `http://localhost:5173`;
    const url = `${base.replace(/\/$/, "")}/track/${encodeURIComponent(row.tracking_code)}`;
    const png = await QRCode.toBuffer(url, { type: "png", width: 256, margin: 1 });
    res.type("png").send(png);
  });
}
