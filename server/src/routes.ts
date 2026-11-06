import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, Request, Response } from "express";
import { assertBenchStatusAllowed, isBenchRequest } from "./lib/benchRepairGuards.js";
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import QRCode from "qrcode";
import { PROBLEMS } from "./seed.js";
import { getServiceRowsByCodes, getSuggestedServiceCodes, sumServiceCents } from "./lib/pricing.js";
import { toPublicServiceRow } from "./lib/serviceCategoryMeta.js";
import { computeRevenueBreakdownForRepairIds } from "./lib/dayClosing.js";
import { recalculateRepairTotal, syncRepairStatusForParts } from "./lib/repairTotals.js";
import { writeInvoicePdf } from "./lib/pdfInvoice.js";
import { writeAdjustmentDocumentPdf } from "./lib/pdfInvoiceAdjustments.js";
import {
  finalizePrimaryRechnungOnFertig,
  getInvoiceById,
  getPrimaryRechnung,
  hasStornoForInvoice,
  setPrimaryInvoicePaymentStatus,
  sha256File,
  syncPrimaryInvoicePaymentAndPdf,
} from "./lib/invoiceGobd.js";
import { writeAcceptancePdf } from "./lib/pdfAcceptance.js";
import { allocateRepairOrderNumber, berlinCalendarYear } from "./lib/repairOrderSequence.js";
import { scheduleSyncRepairOrderPdfs, syncRepairOrderPdfs } from "./lib/syncRepairOrderPdf.js";
import { makeTrackingCode } from "./lib/trackingCode.js";
import { resolveDeviceImage } from "./lib/deviceImage.js";
import {
  isWorkshopPasswordConfigured,
  isBenchPasswordConfigured,
  verifyWorkshopPassword,
  verifyBenchPassword,
  signWorkshopToken,
  requireWorkshopAuth,
  requireWorkshopFullAuth,
  allowUnprotectedWorkshopAccess,
} from "./lib/workshopAuth.js";
import {
  sendRepairAcceptedEmail,
  sendTestProbeEmail,
  logMailOutcome,
  publicTrackingUrl,
  formatEuroFromCents,
  formatVorschaeden,
  partStatusLabelDe,
} from "./lib/mail.js";
import { buildPublicTrackingUrl } from "./lib/publicUrl.js";
import { formatDeBerlinNow } from "./lib/formatBerlin.js";
import { queueCustomerRepairNotification } from "./lib/repairCustomerNotify.js";
import { uploadsDir } from "./lib/dataPaths.js";
import { runDataBackup } from "./lib/dataBackup.js";
import { getWorkshopStatsOverview } from "./lib/workshopStats.js";
import { PAYMENT_TERMS_HEADLINE_DE, PAYMENT_TERMS_LINES_DE, transferPurposeFromTracking } from "./lib/paymentInfo.js";
import { createSumUpHostedCheckout } from "./lib/sumupCheckout.js";
import { resolveSumUpWebhookUrl } from "./lib/publicUrl.js";
import { processSumUpWebhookPayload, syncRepairPaymentFromSumUp } from "./lib/sumupPaidSync.js";
import { appendSumupWebhookLog } from "./lib/sumupWebhookLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureUploadDir() {
  const dir = uploadsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Route-Parameter als string (Express-Typ kann string | string[] sein). */
export function paramStr(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function resolveServiceCodesForRequest(body: {
  problem_key?: unknown;
  service_codes?: unknown;
  extra_service_codes?: unknown;
}): string[] {
  const problemKey = String(body.problem_key ?? "");
  const defaultCodes = getSuggestedServiceCodes(problemKey);
  if (Array.isArray(body.service_codes)) {
    return [...new Set(body.service_codes.map(String).filter(Boolean))];
  }
  const extraCodes = Array.isArray(body.extra_service_codes) ? body.extra_service_codes.map(String) : [];
  return [...new Set([...defaultCodes, ...extraCodes])];
}

type MobileIntakePayload = {
  customer: { name: string; email: string | null; phone: string | null; address: string | null };
  device: { device_type: string; brand: string | null; model: string | null; serial_number: string | null };
  problem_key: string | null;
  problem_label: string | null;
  description: string | null;
  accessories: string | null;
  pre_damage_notes: string | null;
  legal_consent: boolean;
  signature_data_url: string | null;
  service_codes: string[];
  source_created_at: string | null;
};

function optionalMobileText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Ungültiges Textfeld");
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`Textfeld ist länger als ${maxLength} Zeichen`);
  return text || null;
}

/** Speichert nur den dokumentierten Mobile-Vertrag, keine unbekannten Objekte. */
function parseMobileIntakePayload(body: unknown): MobileIntakePayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON-Objekt erwartet");
  const input = body as Record<string, unknown>;
  const customer = input.customer;
  const device = input.device;
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) throw new Error("customer fehlt");
  if (!device || typeof device !== "object" || Array.isArray(device)) throw new Error("device fehlt");
  const c = customer as Record<string, unknown>;
  const d = device as Record<string, unknown>;
  const name = optionalMobileText(c.name, 160);
  const deviceType = optionalMobileText(d.device_type, 80);
  if (!name) throw new Error("customer.name fehlt");
  if (!deviceType) throw new Error("device.device_type fehlt");
  const serviceCodes = input.service_codes === undefined ? [] : input.service_codes;
  if (!Array.isArray(serviceCodes) || serviceCodes.some((code) => typeof code !== "string" || code.length > 80)) {
    throw new Error("service_codes ist ungültig");
  }
  const signature = optionalMobileText(input.signature_data_url, 500_000);
  if (signature && !signature.startsWith("data:image/")) throw new Error("signature_data_url ist ungültig");
  return {
    customer: { name, email: optionalMobileText(c.email, 254), phone: optionalMobileText(c.phone, 80), address: optionalMobileText(c.address, 500) },
    device: { device_type: deviceType, brand: optionalMobileText(d.brand, 100), model: optionalMobileText(d.model, 160), serial_number: optionalMobileText(d.serial_number, 160) },
    problem_key: optionalMobileText(input.problem_key, 80),
    problem_label: optionalMobileText(input.problem_label, 160),
    description: optionalMobileText(input.description, 4_000),
    accessories: optionalMobileText(input.accessories, 1_000),
    pre_damage_notes: optionalMobileText(input.pre_damage_notes, 2_000),
    legal_consent: input.legal_consent === true,
    signature_data_url: signature,
    service_codes: [...new Set(serviceCodes.map((code) => code.trim()).filter(Boolean))],
    source_created_at: optionalMobileText(input.source_created_at, 40),
  };
}

function hasValidMobileSyncKey(req: Request): boolean {
  const configured = process.env.RABBIT_MOBILE_SYNC_KEY;
  const supplied = req.header("x-rabbit-mobile-key");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function passwordHash(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const digest = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}
function passwordMatches(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return actual.length === digest.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(digest));
}

export function registerRoutes(app: Express, db: Database.Database) {
  ensureUploadDir();

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  /** Öffentliche Namensliste für das Außendienst-Tablet; niemals Passwortdaten. */
  app.get("/api/field/employees", (_req, res) => {
    res.json(db.prepare(`SELECT id, name FROM employees WHERE active = 1 AND role = 'field' ORDER BY name COLLATE NOCASE`).all());
  });
  /** Persönliche Tablet-Anmeldung. Das Ergebnis wird erst im nächsten UI-Schritt als eingeschränkter Token verwendet. */
  app.post("/api/field/login", (req, res) => {
    const id = String(req.body?.employee_id ?? ""); const password = String(req.body?.password ?? "");
    const employee = db.prepare(`SELECT id, name, password_hash FROM employees WHERE id = ? AND active = 1 AND role = 'field'`).get(id) as { id: string; name: string; password_hash: string } | undefined;
    if (!employee || !passwordMatches(password, employee.password_hash)) { res.status(401).json({ error: "Anmeldung fehlgeschlagen" }); return; }
    res.json({ token: signWorkshopToken("field"), employee: { id: employee.id, name: employee.name } });
  });
  app.get("/api/admin/employees", requireWorkshopFullAuth, (_req, res) => {
    res.json(db.prepare(`SELECT id, name, role, active, created_at FROM employees ORDER BY name COLLATE NOCASE`).all());
  });
  app.get("/api/field/customers", requireWorkshopAuth, (_req, res) => {
    res.json(db.prepare(`SELECT id, name, email, phone, address FROM customers ORDER BY name COLLATE NOCASE LIMIT 500`).all());
  });
  app.post("/api/admin/employees", requireWorkshopFullAuth, (req, res) => {
    const name = String(req.body?.name ?? "").trim(); const password = String(req.body?.password ?? ""); const role = req.body?.role === "admin" ? "admin" : "field";
    if (!name || password.length < 10) { res.status(400).json({ error: "Name und ein Passwort mit mindestens 10 Zeichen sind erforderlich" }); return; }
    try { const id = nanoid(); db.prepare(`INSERT INTO employees (id, name, password_hash, role) VALUES (?,?,?,?)`).run(id, name, passwordHash(password), role); res.status(201).json({ id, name, role }); }
    catch { res.status(409).json({ error: "Mitarbeitername existiert bereits" }); }
  });
  app.get("/api/calendar/business", requireWorkshopFullAuth, (req, res) => {
    const from = String(req.query.from ?? ""); const to = String(req.query.to ?? "");
    res.json(db.prepare(`SELECT e.*, c.name AS customer_name, r.tracking_code FROM business_calendar_events e LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN repairs r ON r.id=e.repair_id WHERE e.ends_at >= ? AND e.starts_at <= ? ORDER BY e.starts_at`).all(from, to));
  });
  app.post("/api/calendar/business", requireWorkshopFullAuth, (req, res) => {
    const title=String(req.body?.title??"").trim(), starts=String(req.body?.starts_at??""), ends=String(req.body?.ends_at??"");
    if(!title || !starts || !ends || Date.parse(ends)<=Date.parse(starts)){res.status(400).json({error:"Titel sowie gültige Start- und Endzeit erforderlich"});return;}
    const conflicts=db.prepare(`SELECT id,title,starts_at,ends_at FROM business_calendar_events WHERE starts_at < ? AND ends_at > ?`).all(ends,starts);
    const id=nanoid(); db.prepare(`INSERT INTO business_calendar_events (id,customer_id,repair_id,title,starts_at,ends_at,kind,reminder_minutes,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run(id,req.body?.customer_id||null,req.body?.repair_id||null,title,starts,ends,String(req.body?.kind??"kundentermin"),Number(req.body?.reminder_minutes??60),req.body?.notes?String(req.body.notes):null);
    res.status(201).json({id,conflicts});
  });

  /** Mobile-Eingang: keine produktiven Kunden oder Aufträge ohne Werkstatt-Prüfung erzeugen. */
  app.post("/api/mobile-intake/submissions", (req, res) => {
    if (!process.env.RABBIT_MOBILE_SYNC_KEY) {
      res.status(503).json({ error: "Mobile-Synchronisation ist nicht eingerichtet" });
      return;
    }
    if (!hasValidMobileSyncKey(req)) {
      res.status(401).json({ error: "Mobile-Anmeldung erforderlich" });
      return;
    }
    const idempotencyKey = req.header("idempotency-key")?.trim() ?? "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      res.status(400).json({ error: "Idempotency-Key fehlt oder ist ungültig" });
      return;
    }
    try {
      const payload = parseMobileIntakePayload(req.body);
      const existing = db.prepare(`SELECT id, status FROM mobile_intake_submissions WHERE idempotency_key = ?`)
        .get(idempotencyKey) as { id: string; status: string } | undefined;
      if (existing) {
        res.status(200).json({ id: existing.id, status: existing.status, duplicate: true });
        return;
      }
      const id = nanoid();
      db.prepare(`INSERT INTO mobile_intake_submissions (id, idempotency_key, payload_json) VALUES (?,?,?)`)
        .run(id, idempotencyKey, JSON.stringify(payload));
      res.status(202).json({ id, status: "pending", duplicate: false });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Ungültige Mobile-Daten" });
    }
  });

  /** Werkstatt-Vollzugriff: Eingänge zur späteren, expliziten Übernahme prüfen. */
  app.get("/api/mobile-intake/submissions", requireWorkshopFullAuth, (req, res) => {
    const status = String(req.query.status ?? "pending");
    const rows = db.prepare(
      `SELECT id, status, payload_json, submitted_at, reviewed_at, reviewed_by, review_note
       FROM mobile_intake_submissions
       WHERE (? = 'all' OR status = ?)
       ORDER BY datetime(submitted_at) ASC LIMIT 200`
    ).all(status, status) as Array<Record<string, unknown> & { payload_json: string }>;
    res.json(rows.map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) })));
  });

  /**
   * Übernahme ist absichtlich eine explizite Werkstatt-Aktion. Es gibt keinen
   * automatischen Namensabgleich: die aufrufende Oberfläche muss die Wahl
   * "bestehender Kunde" oder "neuen Kunden anlegen" sichtbar bestätigen.
   */
  app.post("/api/mobile-intake/submissions/:id/import", requireWorkshopFullAuth, async (req, res) => {
    const submissionId = paramStr(req.params.id);
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "Übernahme muss ausdrücklich bestätigt werden" });
      return;
    }
    const existingCustomerId = typeof req.body?.customer_id === "string" ? req.body.customer_id.trim() : "";
    const createCustomer = req.body?.create_customer === true;
    if (!existingCustomerId && !createCustomer) {
      res.status(400).json({ error: "Bitte bestehenden Kunden wählen oder Neuanlage ausdrücklich bestätigen" });
      return;
    }
    if (existingCustomerId && createCustomer) {
      res.status(400).json({ error: "Kundenauswahl ist widersprüchlich" });
      return;
    }

    const submission = db.prepare(
      `SELECT id, status, payload_json FROM mobile_intake_submissions WHERE id = ?`
    ).get(submissionId) as { id: string; status: string; payload_json: string } | undefined;
    if (!submission) {
      res.status(404).json({ error: "Mobile-Eingang nicht gefunden" });
      return;
    }
    if (submission.status === "imported") {
      res.status(409).json({ error: "Dieser Mobile-Eingang wurde bereits übernommen" });
      return;
    }
    if (submission.status === "rejected") {
      res.status(409).json({ error: "Abgelehnte Eingänge können nicht übernommen werden" });
      return;
    }

    try {
      const payload = parseMobileIntakePayload(JSON.parse(submission.payload_json));
      if (existingCustomerId) {
        const customer = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(existingCustomerId);
        if (!customer) {
          res.status(400).json({ error: "Ausgewählter Kunde wurde nicht gefunden" });
          return;
        }
      }
      const serviceRows = getServiceRowsByCodes(db, payload.service_codes);
      const repairId = nanoid();
      const deviceId = nanoid();
      const trackingCode = makeTrackingCode();
      const orderYear = berlinCalendarYear();

      const tx = db.transaction(() => {
        const customerId = existingCustomerId || nanoid();
        if (!existingCustomerId) {
          db.prepare(`INSERT INTO customers (id, name, email, phone, address) VALUES (?,?,?,?,?)`).run(
            customerId, payload.customer.name, payload.customer.email, payload.customer.phone, payload.customer.address
          );
        }
        db.prepare(
          `INSERT INTO devices (id, customer_id, device_type, brand, model, serial_number, device_image_url)
           VALUES (?,?,?,?,?,?,?)`
        ).run(
          deviceId, customerId, payload.device.device_type, payload.device.brand, payload.device.model,
          payload.device.serial_number, null
        );
        const problemLabel = PROBLEMS.find((problem) => problem.key === payload.problem_key)?.label
          ?? payload.problem_label ?? payload.problem_key;
        const repairOrderNumber = allocateRepairOrderNumber(db, orderYear);
        db.prepare(
          `INSERT INTO repairs (id, tracking_code, repair_order_number, customer_id, device_id, problem_key, problem_label,
             description, accessories, pre_damage_notes, legal_consent_at, signature_data_url, intake_location, status, total_cents,
             payment_status, is_test)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          repairId, trackingCode, repairOrderNumber, customerId, deviceId, payload.problem_key, problemLabel,
          payload.description, payload.accessories, payload.pre_damage_notes,
          payload.legal_consent ? new Date().toISOString() : null, payload.signature_data_url,
          "aussendienst", "angenommen", 0, "offen", 0
        );
        const insertService = db.prepare(`INSERT INTO repair_services (repair_id, service_id, price_cents) VALUES (?,?,?)`);
        for (const service of serviceRows) insertService.run(repairId, service.id, service.price_cents);
        if (payload.signature_data_url) {
          db.prepare(`INSERT INTO signatures (id, repair_id, image_data_url) VALUES (?,?,?)`).run(
            nanoid(), repairId, payload.signature_data_url
          );
        }
        recalculateRepairTotal(db, repairId);
        const total = (db.prepare(`SELECT total_cents FROM repairs WHERE id = ?`).get(repairId) as { total_cents: number }).total_cents;
        const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${repairId.slice(0, 6).toUpperCase()}`;
        db.prepare(
          `INSERT INTO invoices (id, repair_id, invoice_number, total_cents, payment_status, document_status, document_kind)
           VALUES (?,?,?,?,?,?,?)`
        ).run(nanoid(), repairId, invoiceNumber, total, "offen", "entwurf", "rechnung");
        const imported = db.prepare(
          `UPDATE mobile_intake_submissions
           SET status = 'imported', reviewed_at = datetime('now'), reviewed_by = 'workshop', review_note = ?
           WHERE id = ? AND status IN ('pending', 'reviewed')`
        ).run(`Übernommen als Reparatur ${trackingCode}`, submissionId);
        if (imported.changes !== 1) throw new Error("Mobile-Eingang wurde parallel verändert");
      });
      tx();

      const warnings: string[] = [];
      try {
        const acceptancePdfPath = await writeAcceptancePdf(db, repairId);
        db.prepare(`UPDATE repairs SET acceptance_pdf_path = ? WHERE id = ?`).run(acceptancePdfPath, repairId);
      } catch (error) {
        console.error("[mobile-import] Annahme-PDF fehlgeschlagen:", error);
        warnings.push("Annahme-PDF konnte nicht erzeugt werden");
      }
      try {
        await syncRepairOrderPdfs(db, repairId);
      } catch (error) {
        console.error("[mobile-import] Reparaturauftrag-PDF fehlgeschlagen:", error);
        warnings.push("Reparaturauftrag-PDF konnte nicht erzeugt werden");
      }
      const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(repairId);
      res.status(201).json({ repair, tracking_code: trackingCode, imported_submission_id: submissionId, warnings });
    } catch (error) {
      console.error("[mobile-import]", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Mobile-Eingang konnte nicht übernommen werden" });
    }
  });

  /**
   * SumUp: Online-Checkout (CHECKOUT_STATUS_CHANGED → GET /checkouts/{id}).
   * Antwortet sofort mit 200 JSON, Verarbeitung asynchron.
   * @see https://developer.sumup.com/online-payments/webhooks/
   */
  app.post("/webhook/sumup", (req, res) => {
    try {
      console.log("[webhook/sumup] body:", JSON.stringify(req.body));
      appendSumupWebhookLog(req.body);
    } catch (e) {
      console.error("[webhook/sumup] log", e);
    }

    res.status(200).type("application/json").json({ ok: true });

    setImmediate(() => {
      void (async () => {
        try {
          await processSumUpWebhookPayload(db, req.body);
        } catch (e) {
          console.error("[webhook/sumup] async", e);
        }
      })();
    });
  });

  /** Interne Kennzahlen fuer die Hauptseite. */
  app.get("/api/dashboard/summary", requireWorkshopFullAuth, (_req, res) => {
    const openRow = db
      .prepare(`SELECT COUNT(*) as c FROM repairs WHERE status NOT IN ('abgeholt') AND is_test = 0`)
      .get() as { c: number };
    const fertigRow = db
      .prepare(`SELECT COUNT(*) as c FROM repairs WHERE status IN ('fertig') AND is_test = 0`)
      .get() as { c: number };
    const revRow = db
      .prepare(
        `SELECT COALESCE(SUM(total_cents), 0) as s FROM repairs WHERE date(created_at) = date('now') AND is_test = 0`
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

  app.get("/api/stats/overview", requireWorkshopFullAuth, (_req, res) => {
    res.json(getWorkshopStatsOverview(db));
  });

  app.get("/api/customers", requireWorkshopFullAuth, (_req, res) => {
    const rows = db
      .prepare(`SELECT id, name, email, phone, address, created_at FROM customers ORDER BY datetime(created_at) DESC LIMIT 500`)
      .all();
    res.json(rows);
  });

  app.post("/api/customers", requireWorkshopFullAuth, (req, res) => {
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

  /** Reparatur-Historie pro Kunde (Werkstatt) – inkl. Link zur gespeicherten Annahme-PDF */
  app.get("/api/customers/:id/repairs", requireWorkshopAuth, (req, res) => {
    const cid = paramStr(req.params.id);
    const exists = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(cid);
    if (!exists) {
      res.status(404).json({ error: "Kunde nicht gefunden" });
      return;
    }
    const rows = db
      .prepare(
        `SELECT r.id, r.tracking_code, r.status, r.total_cents,
                COALESCE((SELECT SUM(amount_cents) FROM repair_payments p WHERE p.repair_id = r.id), 0) AS paid_cents,
                r.created_at, r.acceptance_pdf_path
         FROM repairs r
         WHERE r.customer_id = ?
         ORDER BY datetime(r.created_at) DESC
         LIMIT 200`
      )
      .all(cid);
    res.json(rows);
  });

  app.get("/api/auth/status", (_req, res) => {
    res.json({
      workshopAuthRequired: !allowUnprotectedWorkshopAccess(),
      benchAuthConfigured: isBenchPasswordConfigured(),
      workshopAuthConfigured: isWorkshopPasswordConfigured(),
    });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!isWorkshopPasswordConfigured()) {
      if (!allowUnprotectedWorkshopAccess()) {
        res.status(503).json({
          error: "Werkstatt-Passwort nicht eingerichtet (RABBIT_WORKSHOP_PASSWORD setzen).",
          code: "WORKSHOP_AUTH_NOT_CONFIGURED",
        });
        return;
      }
      res.json({
        token: null as string | null,
        workshopAuthRequired: false,
        benchAuthConfigured: isBenchPasswordConfigured(),
      });
      return;
    }
    const password = String(req.body?.password ?? "");
    const wantBench = String((req.body as { role?: string })?.role ?? "").toLowerCase() === "bench";
    if (wantBench) {
      if (!isBenchPasswordConfigured()) {
        res.status(503).json({
          error: "Montage-Anmeldung nicht eingerichtet (RABBIT_BENCH_PASSWORD in der Server-Umgebung setzen).",
        });
        return;
      }
      if (!verifyBenchPassword(password)) {
        res.status(401).json({ error: "Ungültiges Montage-Passwort" });
        return;
      }
      res.json({
        token: signWorkshopToken("bench"),
        role: "bench" as const,
        workshopAuthRequired: true,
        benchAuthConfigured: true,
        expiresInDays: 7,
      });
      return;
    }
    if (!verifyWorkshopPassword(password)) {
      res.status(401).json({ error: "Ungültiges Passwort" });
      return;
    }
    res.json({
      token: signWorkshopToken("workshop"),
      role: "workshop" as const,
      workshopAuthRequired: true,
      benchAuthConfigured: isBenchPasswordConfigured(),
      expiresInDays: 7,
    });
  });

  /** Auftragsliste: Werkstatt voll; Montage ohne Preise/Zahlungsfelder, nur nicht abgeholt. */
  app.get("/api/repairs", requireWorkshopAuth, (req, res) => {
    if (isBenchRequest(req)) {
      const rows = db
        .prepare(
          `SELECT r.id, r.tracking_code, r.repair_order_number, r.status, r.intake_location, r.field_outcome, r.updated_at, r.created_at, r.is_test,
           c.name AS customer_name, d.device_type, d.brand, d.model,
           (SELECT COUNT(1) FROM repair_logs l WHERE l.repair_id = r.id AND l.created_by = 'annahme') AS customer_amendment_count
           FROM repairs r
           JOIN customers c ON c.id = r.customer_id
           JOIN devices d ON d.id = r.device_id
           WHERE r.status != 'abgeholt'
           ORDER BY r.created_at ASC, r.id ASC`
        )
        .all();
      res.json(rows);
      return;
    }
    const rows = db
      .prepare(
        `SELECT r.id, r.tracking_code, r.repair_order_number, r.status, r.intake_location, r.field_outcome, r.total_cents, r.payment_status, r.payment_method, r.sumup_channel, r.payment_due_at, r.updated_at, r.created_at,
         r.is_test,
         c.name as customer_name, d.device_type, d.brand, d.model,
         (SELECT COUNT(1) FROM repair_logs l WHERE l.repair_id = r.id AND l.created_by = 'annahme') AS customer_amendment_count
         FROM repairs r
         JOIN customers c ON c.id = r.customer_id
         JOIN devices d ON d.id = r.device_id
         ORDER BY r.created_at ASC, r.id ASC`
      )
      .all();
    res.json(rows);
  });

  /** Probed-Mail (nur mit Werkstatt-Token); prüft SMTP inkl. Gmail-App-Passwort */
  app.post("/api/mail/test", requireWorkshopFullAuth, async (req, res) => {
    const to = String(req.body?.to ?? "").trim();
    if (!to) {
      res.status(400).json({ error: "Empfänger-Adresse (to) fehlt" });
      return;
    }
    const result = await sendTestProbeEmail(to);
    if (!result.sent) {
      res.status(503).json({ ok: false, error: result.reason ?? "Versand fehlgeschlagen" });
      return;
    }
    res.json({ ok: true, sentTo: to });
  });

  /** Manueller Snapshot: SQLite + Rechnungs-/Annahme-PDFs + Uploads → Datenwurzel/backups/… */
  app.post("/api/system/backup", requireWorkshopFullAuth, async (_req, res) => {
    const r = await runDataBackup(db);
    if (!r.ok) {
      res.status(500).json({ ok: false, error: r.error });
      return;
    }
    res.json({ ok: true, dir: r.dir, at: r.at });
  });

  app.get("/api/services", (_req, res) => {
    const rows = db
      .prepare(`SELECT id, code, name, price_cents, sort_order, category FROM services ORDER BY sort_order`)
      .all() as { id: string; code: string; name: string; price_cents: number; sort_order: number; category: string }[];
    res.json(rows.map((r) => toPublicServiceRow(r)));
  });

  app.get("/api/problems", (_req, res) => {
    res.json(PROBLEMS);
  });

  /** Live-Preis + Vorschlag Services */
  app.post("/api/repairs/preview", (req, res) => {
    const problemKey = String(req.body?.problem_key ?? "");
    const defaultCodes = getSuggestedServiceCodes(problemKey);
    const codes = resolveServiceCodesForRequest(req.body ?? {});
    const rows = getServiceRowsByCodes(db, codes);
    const total_cents = sumServiceCents(rows);
    res.json({
      default_service_codes: defaultCodes,
      suggested_service_codes: codes,
      services: rows,
      total_cents,
    });
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

  app.post("/api/repairs", requireWorkshopAuth, async (req, res) => {
    try {
      const body = req.body ?? {};
      const existingCustomerId = body.customer_id ? String(body.customer_id).trim() : "";

      const customer = {
        name: String(body.customer?.name ?? "").trim(),
        email: body.customer?.email ? String(body.customer.email) : null,
        phone: body.customer?.phone ? String(body.customer.phone) : null,
        address: body.customer?.address ? String(body.customer.address) : null,
      };

      if (!existingCustomerId && !customer.name) {
        res.status(400).json({ error: "Kundenname fehlt" });
        return;
      }

      if (existingCustomerId) {
        const row = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(existingCustomerId) as { id: string } | undefined;
        if (!row) {
          res.status(400).json({ error: "Kunde nicht gefunden" });
          return;
        }
      }

      const problemKey = String(body.problem_key ?? "");
      const problemLabel =
        PROBLEMS.find((p) => p.key === problemKey)?.label ?? body.problem_label ?? problemKey;
      const serviceCodes = resolveServiceCodesForRequest(body);
      const serviceRows = getServiceRowsByCodes(db, serviceCodes);

      const isTest = body.is_test === true ? 1 : 0;
      const intakeLocation = body.intake_location === "aussendienst" ? "aussendienst" : "werkstatt";
      const fieldOutcome = body.field_outcome === "vor_ort" || body.field_outcome === "mitnehmen" ? body.field_outcome : null;
      if (intakeLocation === "aussendienst" && !fieldOutcome) {
        res.status(400).json({ error: "Bitte festlegen: vor Ort erledigt oder Gerät mitnehmen" });
        return;
      }

      const did = nanoid();
      const rid = nanoid();
      const tracking = makeTrackingCode();
      const legal = body.legal_consent === true ? new Date().toISOString() : null;
      const signatureDataUrl = body.signature_data_url ? String(body.signature_data_url) : null;

      const deviceImageUrl = body.device?.device_image_url ? String(body.device.device_image_url) : null;

      let customerForMail!: { name: string; email: string | null };

      const orderYear = berlinCalendarYear();
      const tx = db.transaction(() => {
        const repairOrderNumber = allocateRepairOrderNumber(db, orderYear);
        const cid = existingCustomerId || nanoid();
        if (!existingCustomerId) {
          db.prepare(
            `INSERT INTO customers (id, name, email, phone, address) VALUES (?,?,?,?,?)`
          ).run(cid, customer.name, customer.email, customer.phone, customer.address);
          customerForMail = { name: customer.name, email: customer.email };
        } else {
          const row = db
            .prepare(`SELECT name, email FROM customers WHERE id = ?`)
            .get(cid) as { name: string; email: string | null };
          customerForMail = { name: row.name, email: row.email };
        }

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
          `INSERT INTO repairs (id, tracking_code, repair_order_number, customer_id, device_id, problem_key, problem_label, description, accessories, pre_damage_notes, legal_consent_at, signature_data_url, intake_location, field_arrived_at, field_completed_at, field_outcome, quote_accepted_at, status, total_cents, payment_status, is_test)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          rid,
          tracking,
          repairOrderNumber,
          cid,
          did,
          problemKey || null,
          problemLabel,
          body.description ? String(body.description) : null,
          body.accessories ? String(body.accessories) : null,
          body.pre_damage_notes ? String(body.pre_damage_notes) : null,
          legal,
          signatureDataUrl,
          intakeLocation,
          intakeLocation === "aussendienst" ? String(body.field_arrived_at ?? new Date().toISOString()) : null,
          intakeLocation === "aussendienst" ? new Date().toISOString() : null,
          fieldOutcome,
          intakeLocation === "aussendienst" && signatureDataUrl ? new Date().toISOString() : null,
          "angenommen",
          0,
          "offen",
          isTest
        );

        const insRS = db.prepare(
          `INSERT INTO repair_services (repair_id, service_id, price_cents) VALUES (?,?,?)`
        );
        const serviceNotes = body.service_notes && typeof body.service_notes === "object" ? body.service_notes as Record<string, unknown> : {};
        const insNote = db.prepare(`INSERT INTO repair_service_notes (id, repair_id, service_id, service_code, note, created_by) VALUES (?,?,?,?,?,?)`);
        for (const s of serviceRows) {
          insRS.run(rid, s.id, s.price_cents);
          const rawNote = serviceNotes[s.code];
          const note = typeof rawNote === "string" ? rawNote.trim() : "";
          if (note) insNote.run(nanoid(), rid, s.id, s.code, note.slice(0, 4000), intakeLocation === "aussendienst" ? "field" : "workshop");
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
        const invPrefix = isTest ? "TEST-INV" : "INV";
        const invNo = `${invPrefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${rid.slice(0, 6).toUpperCase()}`;
        const total = (db.prepare(`SELECT total_cents FROM repairs WHERE id = ?`).get(rid) as { total_cents: number }).total_cents;
        db.prepare(
          `INSERT INTO invoices (id, repair_id, invoice_number, total_cents, payment_status, document_status, document_kind)
           VALUES (?,?,?,?,?,?,?)`
        ).run(invId, rid, invNo, total, "offen", "entwurf", "rechnung");
      });

      tx();

      let acceptancePdfPath: string | null = null;
      try {
        acceptancePdfPath = await writeAcceptancePdf(db, rid);
        db.prepare(`UPDATE repairs SET acceptance_pdf_path = ? WHERE id = ?`).run(acceptancePdfPath, rid);
      } catch (pdfErr) {
        console.error("[pdf] Auftragsbestätigung fehlgeschlagen:", pdfErr);
      }
      try {
        await syncRepairOrderPdfs(db, rid);
      } catch (roPdfErr) {
        console.error("[pdf] Reparaturauftrag fehlgeschlagen:", roPdfErr);
      }

      const row = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(rid);
      const confirmationEmailSkipped = !customerForMail.email;
      res.status(201).json({ repair: row, tracking_code: tracking, confirmationEmailSkipped });

      if (customerForMail.email) {
        const repairRow = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(rid) as {
          description: string | null;
          problem_label: string | null;
          accessories: string | null;
          pre_damage_notes: string | null;
          total_cents: number;
        };
        const deviceRow = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(did) as {
          device_type: string;
          brand: string | null;
          model: string | null;
        };
        const fehler =
          (repairRow.description && repairRow.description.trim()) ||
          (repairRow.problem_label && repairRow.problem_label.trim()) ||
          "—";
        const annPdf = acceptancePdfPath && fs.existsSync(acceptancePdfPath) ? acceptancePdfPath : null;
        const safeFile = `Auftragsbestaetigung-${tracking.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
        logMailOutcome(
          "Annahme-Bestätigung",
          tracking,
          customerForMail.email,
          sendRepairAcceptedEmail({
            to: customerForMail.email,
            kundenname: customerForMail.name,
            geraetetyp: deviceRow.device_type,
            marke: deviceRow.brand?.trim() || "—",
            modell: deviceRow.model?.trim() || "—",
            fehlerbeschreibung: fehler,
            vorschaeden: formatVorschaeden(repairRow.pre_damage_notes),
            zubehoer: repairRow.accessories?.trim() || "—",
            preisEuro: formatEuroFromCents(repairRow.total_cents),
            trackingLink: publicTrackingUrl(tracking),
            attachments: annPdf ? [{ filename: safeFile, path: annPdf }] : undefined,
          })
        );
      } else {
        console.warn(`[mail] Annahme-Bestätigung übersprungen: keine Kunden-E-Mail [${tracking}]`);
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/repairs/by-tracking/:code", requireWorkshopAuth, (req, res) => {
    const code = paramStr(req.params.code).trim();
    if (!code) {
      res.status(400).json({ error: "Code fehlt" });
      return;
    }
    const row = db
      .prepare(`SELECT id, tracking_code, status FROM repairs WHERE tracking_code = ?`)
      .get(code) as { id: string; tracking_code: string; status: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    res.json(row);
  });

  app.get("/api/repairs/:id", requireWorkshopAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!repair) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    if (isBenchRequest(req) && String(repair.status) === "abgeholt") {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    const customer = db.prepare(`SELECT * FROM customers WHERE id = (SELECT customer_id FROM repairs WHERE id = ?)`).get(id);
    const device = db.prepare(`SELECT * FROM devices WHERE id = (SELECT device_id FROM repairs WHERE id = ?)`).get(id);
    const services = db
      .prepare(
        `SELECT s.code, s.name, rs.price_cents, COALESCE(s.category, 'sonstiges') AS category
         FROM repair_services rs JOIN services s ON s.id = rs.service_id WHERE rs.repair_id = ?`
      )
      .all(id);
    const parts = db.prepare(`SELECT * FROM repair_parts WHERE repair_id = ?`).all(id);
    const media = db.prepare(`SELECT id, kind, file_path, mime, created_at FROM repair_media WHERE repair_id = ?`).all(id);
    const revenue_breakdown = computeRevenueBreakdownForRepairIds(db, [id]);
    const logs = db
      .prepare(
        `SELECT id, logged_at AS timestamp, action_type, description, duration_minutes, created_by
         FROM repair_logs WHERE repair_id = ? ORDER BY datetime(logged_at) DESC, id DESC`
      )
      .all(id);

    if (isBenchRequest(req)) {
      const { total_cents: _tc, payment_status: _ps, payment_method: _pm, payment_due_at: _pda, payment_paid_at: _ppa, sumup_checkout_id: _sc, sumup_checkout_url: _su, sumup_channel: _sch, ...repairRest } = repair;
      const cust = customer as Record<string, unknown> | undefined;
      const customerBench = cust
        ? { id: cust.id, name: cust.name, phone: cust.phone }
        : null;
      const servicesBench = (services as { code: string; name: string; category: string }[]).map((s) => ({
        code: s.code,
        name: s.name,
        category: s.category,
      }));
      const partsBench = (parts as Record<string, unknown>[]).map((p) => {
        const { purchase_cents: _pc, sale_cents: _sc2, ...rest } = p;
        return rest;
      });
      res.json({
        repair: repairRest,
        customer: customerBench,
        device,
        services: servicesBench,
        parts: partsBench,
        media,
        logs,
      });
      return;
    }

    res.json({ repair, customer, device, services, parts, media, revenue_breakdown, logs });
  });

  app.post("/api/repairs/:id/log", requireWorkshopAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const row = db.prepare(`SELECT id, status FROM repairs WHERE id = ?`).get(id) as { id: string; status: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    if (isBenchRequest(req) && row.status !== "in_reparatur") {
      res.status(403).json({ error: "Protokoll nur während „In Reparatur“ (zuerst Label scannen / Status setzen)." });
      return;
    }
    const action_type = String(req.body?.action_type ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const dmRaw = req.body?.duration_minutes;
    let duration_minutes: number | null = null;
    if (dmRaw !== undefined && dmRaw !== null && String(dmRaw).trim() !== "") {
      const n = Number(dmRaw);
      if (!Number.isFinite(n) || n < 0 || n > 24 * 60) {
        res.status(400).json({ error: "Ungültige Dauer (Minuten)" });
        return;
      }
      duration_minutes = Math.round(n);
    }
    if (!action_type || !description) {
      res.status(400).json({ error: "Tätigkeit und Beschreibung erforderlich" });
      return;
    }
    const logId = nanoid();
    const createdBy = isBenchRequest(req) ? "bench" : "workshop";
    db.prepare(
      `INSERT INTO repair_logs (id, repair_id, logged_at, action_type, description, duration_minutes, created_by)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?)`
    ).run(logId, id, action_type, description, duration_minutes, createdBy);
    const log = db
      .prepare(
        `SELECT id, logged_at AS timestamp, action_type, description, duration_minutes, created_by FROM repair_logs WHERE id = ?`
      )
      .get(logId);
    res.status(201).json({ log });
  });

  /** Kundennachtrag an der Annahme (Zusatzleistungen + dokumentierte Zusage; Werkstatt-Hinweis & Rechnung). */
  app.post("/api/repairs/:id/customer-amendment", requireWorkshopFullAuth, async (req, res) => {
    if (isBenchRequest(req)) {
      res.status(403).json({ error: "Nur an der vollen Werkstatt / Annahme." });
      return;
    }
    const id = paramStr(req.params.id);
    const row = db.prepare(`SELECT id, status, tracking_code FROM repairs WHERE id = ?`).get(id) as
      | { id: string; status: string; tracking_code: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Auftrag nicht gefunden" });
      return;
    }
    if (row.status === "abgeholt") {
      res.status(400).json({ error: "Abgeholte Aufträge können nicht mehr nachträglich geändert werden." });
      return;
    }
    const body = req.body as { channel?: unknown; note?: unknown; service_codes?: unknown };
    const channel = String(body.channel ?? "").trim();
    if (channel !== "telefon" && channel !== "vor_ort") {
      res.status(400).json({ error: 'channel: "telefon" oder "vor_ort" erforderlich' });
      return;
    }
    const note = String(body.note ?? "").trim();
    if (note.length < 3) {
      res.status(400).json({ error: "Notiz (mindestens 3 Zeichen) erforderlich." });
      return;
    }
    const rawCodes = Array.isArray(body.service_codes) ? body.service_codes.map(String).filter(Boolean) : [];
    const codes = [...new Set(rawCodes)];
    const serviceRows = codes.length ? getServiceRowsByCodes(db, codes) : [];
    if (codes.length && serviceRows.length !== codes.length) {
      res.status(400).json({ error: "Unbekannter Leistungscode in service_codes." });
      return;
    }
    const channelDe = channel === "telefon" ? "telefonisch" : "persönlich vor Ort";
    const whenDe = formatDeBerlinNow({ dateStyle: "long", timeStyle: "short" });
    const logLines = [
      `Feststellung (Annahme): Der Kunde hat am ${whenDe} (${channelDe}) folgendes mitgeteilt bzw. genehmigt:`,
      "",
      note,
      "",
    ];
    if (serviceRows.length) {
      logLines.push("Zusätzlich gebuchte Leistungen (Katalogpreise):");
      for (const s of serviceRows) {
        logLines.push(`- ${s.name}: ${(s.price_cents / 100).toFixed(2)} €`);
      }
      logLines.push("");
    }
    logLines.push("Dieser Eintrag dient der Nachvollziehbarkeit gegenüber der Werkstatt und auf der Rechnung.");

    const logDescription = logLines.join("\n");
    const actionType = `Kundennachtrag (${channelDe})`;
    const logId = nanoid();
    try {
      const tx = db.transaction(() => {
        const ins = db.prepare(
          `INSERT OR REPLACE INTO repair_services (repair_id, service_id, price_cents) VALUES (?,?,?)`
        );
        for (const s of serviceRows) {
          ins.run(id, s.id, s.price_cents);
        }
        recalculateRepairTotal(db, id);
        db.prepare(
          `INSERT INTO repair_logs (id, repair_id, logged_at, action_type, description, duration_minutes, created_by)
           VALUES (?, ?, datetime('now'), ?, ?, NULL, 'annahme')`
        ).run(logId, id, actionType, logDescription);
        db.prepare(`UPDATE repairs SET updated_at = datetime('now') WHERE id = ?`).run(id);
      });
      tx();
      scheduleSyncRepairOrderPdfs(db, id, req);
      res.status(201).json({ ok: true, log_id: logId });
    } catch (e) {
      console.error("[repair] customer-amendment:", e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.patch("/api/repairs/:id/status", requireWorkshopAuth, async (req, res) => {
    const id = paramStr(req.params.id);
    const previous = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) as
      | {
          id: string;
          status: string;
          tracking_code: string;
          customer_id: string;
          device_id: string;
          problem_label: string | null;
          description: string | null;
          total_cents: number;
        }
      | undefined;
    if (!previous) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    const status = String(req.body?.status ?? "");
    const allowed = [
      "angenommen",
      "diagnose",
      "wartet_auf_teile",
      "teilgeliefert",
      "in_reparatur",
      "fertig",
      "abgeholt",
    ];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "Ungültiger Status" });
      return;
    }
    if (previous.status === status) {
      const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id);
      res.json({ repair });
      return;
    }
    if (isBenchRequest(req)) {
      const g = assertBenchStatusAllowed(db, id, previous.status, status);
      if (!g.ok) {
        res.status(403).json({ error: g.error });
        return;
      }
    }
    const sinceRow = db
      .prepare(`SELECT in_reparatur_since FROM repairs WHERE id = ?`)
      .get(id) as { in_reparatur_since: string | null } | undefined;
    let nextSince: string | null = sinceRow?.in_reparatur_since ?? null;
    const nowT = (db.prepare(`SELECT datetime('now') AS t`).get() as { t: string }).t;
    if (status === "in_reparatur" && previous.status !== "in_reparatur") {
      nextSince = nowT;
    } else if (previous.status === "in_reparatur" && status !== "in_reparatur") {
      nextSince = null;
    }
    const r = db
      .prepare(`UPDATE repairs SET status = ?, updated_at = datetime('now'), in_reparatur_since = ? WHERE id = ?`)
      .run(status, nextSince, id);
    if (r.changes === 0) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    if (status === "fertig" && previous.status !== "fertig") {
      db.prepare(`UPDATE repairs SET payment_due_at = datetime('now', '+7 days') WHERE id = ?`).run(id);
      try {
        await finalizePrimaryRechnungOnFertig(db, id);
      } catch (e) {
        console.error("[invoice] Finalisierung bei „fertig“ fehlgeschlagen:", e);
      }
    }
    const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) as typeof previous;
    queueCustomerRepairNotification(db, id);
    try {
      await syncRepairOrderPdfs(db, id, req);
    } catch (e) {
      console.error("[pdf] Reparaturauftrag (Status):", e);
    }

    res.json({ repair });
  });

  /** Teilzahlung: dokumentiert jede Vor-Ort-Zahlung, ohne den Auftrag vorzeitig als vollständig bezahlt zu markieren. */
  app.post("/api/repairs/:id/payments", requireWorkshopAuth, (req, res) => {
    const repairId = paramStr(req.params.id);
    const amount = Number(req.body?.amount_cents);
    const method = String(req.body?.method ?? "").trim();
    const repair = db.prepare(`SELECT total_cents FROM repairs WHERE id = ?`).get(repairId) as { total_cents: number } | undefined;
    if (!repair || !Number.isInteger(amount) || amount <= 0 || !method) { res.status(400).json({ error: "Ungültige Teilzahlung" }); return; }
    const paid = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM repair_payments WHERE repair_id = ?`).get(repairId) as { cents: number }).cents;
    if (amount > repair.total_cents - paid) { res.status(400).json({ error: "Teilzahlung ist höher als der offene Betrag" }); return; }
    db.prepare(`INSERT INTO repair_payments (id, repair_id, amount_cents, method, note, created_by) VALUES (?,?,?,?,?,?)`).run(nanoid(), repairId, amount, method, req.body?.note ? String(req.body.note) : null, req.workshopRole === "field" ? "field" : "workshop");
    const newPaid = paid + amount;
    if (newPaid === repair.total_cents) db.prepare(`UPDATE repairs SET payment_status = 'bezahlt', payment_paid_at = datetime('now') WHERE id = ?`).run(repairId);
    res.status(201).json({ paid_cents: newPaid, open_cents: repair.total_cents - newPaid });
  });

  app.patch("/api/repairs/:id/payment", requireWorkshopFullAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const ps = String(req.body?.payment_status ?? "");
    if (ps !== "offen" && ps !== "bezahlt") {
      res.status(400).json({ error: "Ungültig" });
      return;
    }
    if (ps === "bezahlt") {
      db.prepare(
        `UPDATE repairs SET payment_status = ?, payment_paid_at = COALESCE(payment_paid_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`
      ).run(ps, id);
    } else {
      db.prepare(`UPDATE repairs SET payment_status = ?, payment_paid_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(ps, id);
    }
    setPrimaryInvoicePaymentStatus(db, id, ps);
    res.json({ ok: true });
  });

  /**
   * Abholung am Tablet: Zahlungsart wählen → Status/Rechnung anpassen.
   * SumUp Online: type=sumup_link (QR/URL). Tap to Pay: nur manuell im UI; Abschluss mit type=sumup_complete und sumup_channel=tap_to_pay.
   */
  app.post("/api/repairs/:id/pickup", requireWorkshopFullAuth, async (req, res) => {
    const id = paramStr(req.params.id);
    const type = String((req.body as { type?: string })?.type ?? "").trim();

    const row = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) as
      | { id: string; status: string; total_cents: number; tracking_code: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Auftrag nicht gefunden" });
      return;
    }

    if (type === "sumup_link") {
      if (row.status !== "fertig") {
        res.status(400).json({ error: "SumUp nur bei Status „fertig zur Abholung“ (vor Abschluss der Abholung)." });
        return;
      }
      const fullRow = db
        .prepare(
          `SELECT r.id, r.status, r.total_cents, r.tracking_code, r.payment_status, c.name AS customer_name
           FROM repairs r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`
        )
        .get(id) as
        | { id: string; status: string; total_cents: number; tracking_code: string; payment_status: string; customer_name: string }
        | undefined;
      if (!fullRow || fullRow.payment_status === "bezahlt") {
        res.status(400).json({ error: "Auftrag bereits als bezahlt markiert oder nicht gefunden." });
        return;
      }
      const apiKey = process.env.RABBIT_SUMUP_API_KEY?.trim();
      const merchantCode = process.env.RABBIT_SUMUP_MERCHANT_CODE?.trim();
      if (!apiKey || !merchantCode) {
        res.status(503).json({
          error:
            "SumUp nicht konfiguriert: RABBIT_SUMUP_API_KEY und RABBIT_SUMUP_MERCHANT_CODE setzen (SumUp → Entwickler / Geschäftskonto).",
        });
        return;
      }
      const checkoutRef = fullRow.id.slice(0, 90);
      const amountEuro = Math.max(0.01, fullRow.total_cents / 100);
      const webhookUrl = resolveSumUpWebhookUrl(req);
      try {
        const checkout = await createSumUpHostedCheckout({
          apiKey,
          merchantCode,
          amountEuro,
          checkoutReference: checkoutRef,
          description: `Rabbit-Technik ${fullRow.tracking_code} · ${String(fullRow.customer_name).slice(0, 120)}`,
          returnUrl: webhookUrl,
        });
        db.prepare(
          `UPDATE repairs SET sumup_checkout_id = ?, sumup_checkout_url = ?, sumup_channel = 'online',
             sumup_foreign_tx_id = NULL, sumup_terminal_foreign_id = NULL, sumup_terminal_client_transaction_id = NULL,
             payment_method = 'sumup', updated_at = datetime('now') WHERE id = ?`
        ).run(checkout.checkoutId, checkout.hostedCheckoutUrl, id);
        const qrDataUrl = await QRCode.toDataURL(checkout.hostedCheckoutUrl, {
          margin: 1,
          width: 280,
          errorCorrectionLevel: "M",
        });
        res.json({
          payment_url: checkout.hostedCheckoutUrl,
          sumupUrl: checkout.hostedCheckoutUrl,
          checkoutId: checkout.checkoutId,
          checkoutReference: checkoutRef,
          qrDataUrl,
          hint: "Warten auf Zahlung – der Kunde scannt den QR-Code oder öffnet den Link. Sobald SumUp die Zahlung bestätigt hat, schließt sich die Abholung automatisch (alternativ „Zahlung erhalten“).",
        });
      } catch (e) {
        res.status(502).json({ error: String(e) });
      }
      return;
    }

    if (type === "sumup_complete") {
      const ch = String((req.body as { sumup_channel?: string })?.sumup_channel ?? "").trim();
      const tapManual = ch === "tap_to_pay";
      const cur = db.prepare(`SELECT status, payment_status FROM repairs WHERE id = ?`).get(id) as
        | { status: string; payment_status: string }
        | undefined;
      if (!cur) {
        res.status(404).json({ error: "Auftrag nicht gefunden" });
        return;
      }
      if (cur.payment_status === "bezahlt") {
        res.json({ ok: true, repair: db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id), already: true });
        return;
      }
      if (cur.status !== "fertig") {
        res.status(400).json({ error: "Abholung mit SumUp nur solange der Auftrag noch „fertig“ ist." });
        return;
      }
      if (tapManual) {
        db.prepare(
          `UPDATE repairs SET
             status = 'abgeholt',
             payment_status = 'bezahlt',
             payment_method = 'sumup',
             sumup_channel = 'tap_to_pay',
             sumup_checkout_id = NULL,
             sumup_checkout_url = NULL,
             sumup_foreign_tx_id = NULL,
             sumup_terminal_foreign_id = NULL,
             sumup_terminal_client_transaction_id = NULL,
             payment_paid_at = datetime('now'),
             updated_at = datetime('now')
           WHERE id = ?`
        ).run(id);
      } else {
        db.prepare(
          `UPDATE repairs SET status = 'abgeholt', payment_status = 'bezahlt', payment_method = 'sumup', payment_paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(id);
      }
      await syncPrimaryInvoicePaymentAndPdf(db, id);
      try {
        await syncRepairOrderPdfs(db, id, req);
      } catch (e) {
        console.error("[pdf] Reparaturauftrag (Abholung):", e);
      }
      res.json({ ok: true, repair: db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) });
      return;
    }

    if (type === "bar") {
      if (row.status !== "fertig") {
        res.status(400).json({ error: "Abholung nur bei Status „fertig“." });
        return;
      }
      db.prepare(
        `UPDATE repairs SET status = 'abgeholt', payment_status = 'bezahlt', payment_method = 'bar', payment_paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(id);
      await syncPrimaryInvoicePaymentAndPdf(db, id);
      try {
        await syncRepairOrderPdfs(db, id, req);
      } catch (e) {
        console.error("[pdf] Reparaturauftrag (Abholung):", e);
      }
      res.json({ ok: true, repair: db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) });
      return;
    }

    if (type === "ueberweisung") {
      if (row.status !== "fertig") {
        res.status(400).json({ error: "Abholung nur bei Status „fertig“." });
        return;
      }
      db.prepare(
        `UPDATE repairs SET status = 'abgeholt', payment_status = 'offen', payment_method = 'ueberweisung', updated_at = datetime('now') WHERE id = ?`
      ).run(id);
      const dueRow = db.prepare(`SELECT payment_due_at FROM repairs WHERE id = ?`).get(id) as { payment_due_at: string | null } | undefined;
      if (dueRow && !dueRow.payment_due_at) {
        db.prepare(`UPDATE repairs SET payment_due_at = datetime('now', '+7 days') WHERE id = ?`).run(id);
      }
      await syncPrimaryInvoicePaymentAndPdf(db, id);
      try {
        await syncRepairOrderPdfs(db, id, req);
      } catch (e) {
        console.error("[pdf] Reparaturauftrag (Abholung):", e);
      }
      res.json({ ok: true, repair: db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id) });
      return;
    }

    res.status(400).json({ error: "Unbekannter Typ. Erlaubt: bar, ueberweisung, sumup_link, sumup_complete." });
  });

  /**
   * SumUp-Checkout wie sumup_link (repair_id = checkout_reference), mit Prüfung von Betrag & Kundenname.
   * Rückgabe: payment_url, checkout_id, qrDataUrl (wie Pickup).
   * Zusätzlich: POST /create-sumup-checkout (Root-Pfad) – identische Logik für externe Clients.
   */
  const postCreateSumupCheckout = async (req: Request, res: Response) => {
    const repairId = String((req.body as { repair_id?: string })?.repair_id ?? "").trim();
    const amountEuro = Number((req.body as { amount?: unknown })?.amount);
    const customerNameBody =
      (req.body as { customer_name?: unknown })?.customer_name != null
        ? String((req.body as { customer_name?: unknown }).customer_name).trim()
        : "";
    if (!repairId) {
      res.status(400).json({ error: "repair_id fehlt" });
      return;
    }
    const row = db
      .prepare(
        `SELECT r.id, r.status, r.total_cents, r.tracking_code, r.payment_status, c.name AS customer_name
         FROM repairs r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`
      )
      .get(repairId) as
      | { id: string; status: string; total_cents: number; tracking_code: string; payment_status: string; customer_name: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Auftrag nicht gefunden" });
      return;
    }
    if (row.status !== "fertig") {
      res.status(400).json({ error: "Checkout nur bei Status „fertig zur Abholung“." });
      return;
    }
    if (row.payment_status === "bezahlt") {
      res.status(400).json({ error: "Auftrag ist bereits bezahlt." });
      return;
    }
    const expected = Math.max(0.01, row.total_cents / 100);
    if (!Number.isFinite(amountEuro) || Math.abs(amountEuro - expected) > 0.02) {
      res.status(400).json({ error: "Betrag entspricht nicht der Auftragssumme." });
      return;
    }
    if (
      customerNameBody &&
      customerNameBody.toLowerCase() !== String(row.customer_name).trim().toLowerCase()
    ) {
      res.status(400).json({ error: "Kundenname stimmt nicht mit dem Auftrag überein." });
      return;
    }
    const apiKey = process.env.RABBIT_SUMUP_API_KEY?.trim();
    const merchantCode = process.env.RABBIT_SUMUP_MERCHANT_CODE?.trim();
    if (!apiKey || !merchantCode) {
      res.status(503).json({
        error:
          "SumUp nicht konfiguriert: RABBIT_SUMUP_API_KEY und RABBIT_SUMUP_MERCHANT_CODE setzen (SumUp → Entwickler / Geschäftskonto).",
      });
      return;
    }
    const checkoutRef = row.id.slice(0, 90);
    const webhookUrl = resolveSumUpWebhookUrl(req);
    try {
      const checkout = await createSumUpHostedCheckout({
        apiKey,
        merchantCode,
        amountEuro: expected,
        checkoutReference: checkoutRef,
        description: `Rabbit-Technik ${row.tracking_code} · ${String(row.customer_name).slice(0, 120)}`,
        returnUrl: webhookUrl,
      });
      db.prepare(
        `UPDATE repairs SET sumup_checkout_id = ?, sumup_checkout_url = ?, sumup_channel = 'online',
           sumup_foreign_tx_id = NULL, sumup_terminal_foreign_id = NULL, sumup_terminal_client_transaction_id = NULL,
           payment_method = 'sumup', updated_at = datetime('now') WHERE id = ?`
      ).run(checkout.checkoutId, checkout.hostedCheckoutUrl, repairId);
      const qrDataUrl = await QRCode.toDataURL(checkout.hostedCheckoutUrl, {
        margin: 1,
        width: 280,
        errorCorrectionLevel: "M",
      });
      res.json({
        payment_url: checkout.hostedCheckoutUrl,
        sumupUrl: checkout.hostedCheckoutUrl,
        checkout_id: checkout.checkoutId,
        qrDataUrl,
        hint: "Warten auf Zahlung – nach erfolgreicher Kartenzahlung aktualisiert sich der Status automatisch.",
      });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  };

  app.post("/api/create-sumup-checkout", requireWorkshopFullAuth, postCreateSumupCheckout);
  app.post("/create-sumup-checkout", requireWorkshopFullAuth, postCreateSumupCheckout);

  /** Tablet: SumUp-Status per API nachziehen (Webhook-Fallback / sofortige Aktualisierung). */
  app.get("/api/repairs/:id/sumup-sync", requireWorkshopFullAuth, async (req, res) => {
    const id = paramStr(req.params.id);
    const exists = db.prepare(`SELECT id FROM repairs WHERE id = ?`).get(id);
    if (!exists) {
      res.status(404).json({ error: "Auftrag nicht gefunden" });
      return;
    }
    const out = await syncRepairPaymentFromSumUp(db, id);
    res.json(out);
  });

  /** Rechnungen & Zahlungsübersicht (Werkstatt) */
  app.get("/api/invoices", requireWorkshopFullAuth, (_req, res) => {
    const invoices = db
      .prepare(
        `SELECT r.id, r.tracking_code, r.status, r.total_cents, r.payment_status, r.payment_method, r.payment_due_at,
                r.created_at, r.updated_at,
                r.is_test,
                i.id AS invoice_id,
                i.invoice_number, i.created_at AS invoice_created_at,
                i.document_status AS invoice_document_status,
                i.document_kind AS invoice_document_kind,
                i.retention_until AS invoice_retention_until,
                EXISTS (
                  SELECT 1 FROM invoices s WHERE s.references_invoice_id = i.id AND s.document_kind = 'storno'
                ) AS has_storno,
                c.name AS customer_name,
                COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days')) AS due_at,
                CASE
                  WHEN r.payment_status = 'bezahlt' THEN 'bezahlt'
                  WHEN datetime('now') > datetime(COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days')))
                    THEN 'offen_ueberfaellig'
                  ELSE 'offen_in_frist'
                END AS payment_bucket
         FROM repairs r
         JOIN invoices i ON i.id = (
           SELECT id FROM invoices WHERE repair_id = r.id AND document_kind = 'rechnung'
           ORDER BY datetime(created_at) DESC LIMIT 1
         )
         JOIN customers c ON c.id = r.customer_id
         WHERE r.status IN ('fertig', 'abgeholt') AND r.total_cents > 0
         ORDER BY
           CASE
             WHEN r.payment_status = 'bezahlt' THEN 2
             WHEN datetime('now') > datetime(COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days'))) THEN 0
             ELSE 1
           END,
           datetime(COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days'))) ASC,
           r.tracking_code DESC`
      )
      .all();
    res.json({
      invoices,
      paymentTerms: {
        headline: PAYMENT_TERMS_HEADLINE_DE,
        lines: PAYMENT_TERMS_LINES_DE,
      },
    });
  });

  /** Storno- / Korrektur-PDF (Werkstatt) – alle document_kind. */
  app.get("/api/invoices/:id/document.pdf", requireWorkshopFullAuth, (req, res) => {
    const invId = paramStr(req.params.id);
    const inv = getInvoiceById(db, invId);
    if (!inv?.pdf_path || !fs.existsSync(inv.pdf_path)) {
      res.status(404).send("Dokument nicht gefunden");
      return;
    }
    res.sendFile(path.resolve(inv.pdf_path));
  });

  /** GoBD: Storno-Rechnung zur referenzierten finalen Ausgangsrechnung. */
  app.post("/api/invoices/:id/storno", requireWorkshopFullAuth, async (req, res) => {
    const invId = paramStr(req.params.id);
    const src = getInvoiceById(db, invId);
    if (!src) {
      res.status(404).json({ error: "Rechnung nicht gefunden" });
      return;
    }
    if (src.document_kind !== "rechnung") {
      res.status(400).json({ error: "Nur Ausgangsrechnungen (rechnung) können storniert werden." });
      return;
    }
    if (src.document_status !== "final") {
      res.status(400).json({ error: "Storno nur nach Finalisierung (Status „fertig“ / festgeschriebene Rechnung)." });
      return;
    }
    if (hasStornoForInvoice(db, invId)) {
      res.status(409).json({ error: "Zu dieser Rechnung existiert bereits ein Storno." });
      return;
    }
    const repair = db.prepare(`SELECT tracking_code FROM repairs WHERE id = ?`).get(src.repair_id) as
      | { tracking_code: string }
      | undefined;
    const customer = db
      .prepare(`SELECT c.name FROM customers c JOIN repairs r ON r.customer_id = c.id WHERE r.id = ?`)
      .get(src.repair_id) as { name: string } | undefined;
    if (!repair || !customer) {
      res.status(404).json({ error: "Auftrag/Kunde nicht gefunden" });
      return;
    }
    const reason = String((req.body as { reason?: string })?.reason ?? "").trim();
    const stornoId = nanoid();
    const stornoNo = `STOR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${nanoid(6).toUpperCase()}`;
    const amountCents = -Math.abs(src.total_cents);
    try {
      const pdfPath = await writeAdjustmentDocumentPdf({
        invoiceNumber: stornoNo,
        kind: "storno",
        referenceInvoiceNumber: src.invoice_number,
        amountCents,
        trackingCode: repair.tracking_code,
        customerName: customer.name,
        reason: reason || undefined,
      });
      const hash = sha256File(pdfPath);
      db.prepare(
        `INSERT INTO invoices (
           id, repair_id, invoice_number, pdf_path, total_cents, payment_status,
           document_status, document_kind, finalized_at, retention_until, pdf_sha256, references_invoice_id
         ) VALUES (?,?,?,?,?,?,?,?, datetime('now'), datetime('now', '+10 years'), ?, ?)`
      ).run(
        stornoId,
        src.repair_id,
        stornoNo,
        pdfPath,
        amountCents,
        src.payment_status,
        "final",
        "storno",
        hash,
        src.id
      );
      res.status(201).json({ ok: true, id: stornoId, invoice_number: stornoNo });
    } catch (e) {
      console.error("[invoice] Storno:", e);
      res.status(500).json({ error: String(e) });
    }
  });

  /** GoBD: Korrekturrechnung (Differenzbetrag, referenziert Ausgangsrechnung). */
  app.post("/api/invoices/:id/korrektur", requireWorkshopFullAuth, async (req, res) => {
    const invId = paramStr(req.params.id);
    const src = getInvoiceById(db, invId);
    if (!src) {
      res.status(404).json({ error: "Rechnung nicht gefunden" });
      return;
    }
    if (src.document_kind !== "rechnung") {
      res.status(400).json({ error: "Korrektur nur bezogen auf eine Ausgangsrechnung (rechnung)." });
      return;
    }
    if (src.document_status !== "final") {
      res.status(400).json({ error: "Korrektur nur nach Finalisierung der Ausgangsrechnung." });
      return;
    }
    const deltaCents = Math.round(Number((req.body as { delta_cents?: unknown })?.delta_cents));
    if (!Number.isFinite(deltaCents) || deltaCents === 0) {
      res.status(400).json({ error: "delta_cents (ungleich 0) erforderlich" });
      return;
    }
    const repair = db.prepare(`SELECT tracking_code FROM repairs WHERE id = ?`).get(src.repair_id) as
      | { tracking_code: string }
      | undefined;
    const customer = db
      .prepare(`SELECT c.name FROM customers c JOIN repairs r ON r.customer_id = c.id WHERE r.id = ?`)
      .get(src.repair_id) as { name: string } | undefined;
    if (!repair || !customer) {
      res.status(404).json({ error: "Auftrag/Kunde nicht gefunden" });
      return;
    }
    const reason = String((req.body as { reason?: string })?.reason ?? "").trim();
    const kid = nanoid();
    const kNo = `KOR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${nanoid(6).toUpperCase()}`;
    try {
      const pdfPath = await writeAdjustmentDocumentPdf({
        invoiceNumber: kNo,
        kind: "korrektur",
        referenceInvoiceNumber: src.invoice_number,
        amountCents: deltaCents,
        trackingCode: repair.tracking_code,
        customerName: customer.name,
        reason: reason || undefined,
      });
      const hash = sha256File(pdfPath);
      db.prepare(
        `INSERT INTO invoices (
           id, repair_id, invoice_number, pdf_path, total_cents, payment_status,
           document_status, document_kind, finalized_at, retention_until, pdf_sha256, references_invoice_id
         ) VALUES (?,?,?,?,?,?,?,?, datetime('now'), datetime('now', '+10 years'), ?, ?)`
      ).run(
        kid,
        src.repair_id,
        kNo,
        pdfPath,
        deltaCents,
        "offen",
        "final",
        "korrektur",
        hash,
        src.id
      );
      res.status(201).json({ ok: true, id: kid, invoice_number: kNo });
    } catch (e) {
      console.error("[invoice] Korrektur:", e);
      res.status(500).json({ error: String(e) });
    }
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
    const initialStatus = String(req.body?.status ?? "bestellt").trim();
    const allowedInit = ["bestellt", "vor_ort"];
    if (!allowedInit.includes(initialStatus)) {
      res.status(400).json({ error: "Ungültiger Teile-Status (bestellt oder vor_ort)" });
      return;
    }
    let purchase_cents = Math.round(Number(req.body?.purchase_cents ?? 0));
    let sale_cents = Math.round(Number(req.body?.sale_cents ?? 0));
    if (isBenchRequest(req)) {
      purchase_cents = 0;
      sale_cents = 0;
    }
    let barcode: string | null = null;
    const rawBc = req.body?.barcode;
    if (rawBc != null && String(rawBc).trim() !== "") {
      barcode = String(rawBc).trim();
      const dup = db.prepare(`SELECT id FROM repair_parts WHERE barcode = ?`).get(barcode) as { id: string } | undefined;
      if (dup) {
        res.status(400).json({ error: "Barcode bereits vergeben" });
        return;
      }
    }
    const pid = nanoid();
    db.prepare(
      `INSERT INTO repair_parts (id, repair_id, part_id, name, purchase_cents, sale_cents, status, barcode) VALUES (?,?,?,?,?,?,?,?)`
    ).run(pid, repairId, null, name, purchase_cents, sale_cents, initialStatus, barcode);
    recalculateRepairTotal(db, repairId);
    syncRepairStatusForParts(db, repairId);
    queueCustomerRepairNotification(
      db,
      repairId,
      `Neues Ersatzteil: „${name}“ – ${partStatusLabelDe(initialStatus)}`
    );
    scheduleSyncRepairOrderPdfs(db, repairId, req);
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(pid) as Record<string, unknown>;
    if (isBenchRequest(req)) {
      const { purchase_cents: _pc, sale_cents: _sc, ...pub } = part;
      res.status(201).json({ part: pub });
      return;
    }
    res.status(201).json({ part });
  });

  app.patch("/api/repairs/:repairId/parts/:partId", requireWorkshopAuth, (req, res) => {
    const repairId = paramStr(req.params.repairId);
    const partId = paramStr(req.params.partId);
    const body = req.body as { status?: unknown; barcode?: unknown };
    const wantStatus = body.status !== undefined;
    const wantBarcode = body.barcode !== undefined;
    if (!wantStatus && !wantBarcode) {
      res.status(400).json({ error: "Keine Änderung (status oder barcode angeben)" });
      return;
    }

    const prevRow = db
      .prepare(`SELECT name, status, barcode FROM repair_parts WHERE id = ? AND repair_id = ?`)
      .get(partId, repairId) as { name: string; status: string; barcode: string | null } | undefined;
    if (!prevRow) {
      res.status(404).json({ error: "Teil nicht gefunden" });
      return;
    }

    const allowedPart = ["bestellt", "unterwegs", "angekommen", "eingebaut", "vor_ort"];
    let nextStatus = prevRow.status;
    if (wantStatus) {
      const status = String(body.status ?? "");
      if (!allowedPart.includes(status)) {
        res.status(400).json({ error: "Ungültiger Teile-Status" });
        return;
      }
      nextStatus = status;
    }

    let nextBarcode: string | null = prevRow.barcode;
    if (wantBarcode) {
      const raw = body.barcode;
      if (raw === null || raw === "") {
        nextBarcode = null;
      } else {
        const b = String(raw).trim();
        if (!b) {
          nextBarcode = null;
        } else {
          const dup = db
            .prepare(`SELECT id FROM repair_parts WHERE barcode = ? AND id != ?`)
            .get(b, partId) as { id: string } | undefined;
          if (dup) {
            res.status(400).json({ error: "Barcode bereits vergeben" });
            return;
          }
          nextBarcode = b;
        }
      }
    }

    const r = db
      .prepare(`UPDATE repair_parts SET status = ?, barcode = ? WHERE id = ? AND repair_id = ?`)
      .run(nextStatus, nextBarcode, partId, repairId);
    if (r.changes === 0) {
      res.status(404).json({ error: "Teil nicht gefunden" });
      return;
    }
    syncRepairStatusForParts(db, repairId);
    if (wantStatus && prevRow.status !== nextStatus) {
      const zusatz = `Ersatzteil „${prevRow.name}“: ${partStatusLabelDe(nextStatus)}${
        prevRow.status ? ` (vorher: ${partStatusLabelDe(prevRow.status)})` : ""
      }`;
      queueCustomerRepairNotification(db, repairId, zusatz);
    }
    scheduleSyncRepairOrderPdfs(db, repairId, req);
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(partId) as Record<string, unknown>;
    if (isBenchRequest(req)) {
      const { purchase_cents: _pc, sale_cents: _sc, ...pub } = part;
      res.json({ part: pub });
      return;
    }
    res.json({ part });
  });

  app.get("/api/lager/parts", requireWorkshopFullAuth, (_req, res) => {
    const parts = db
      .prepare(
        `SELECT rp.id, rp.repair_id, rp.name, rp.status, rp.sale_cents, rp.purchase_cents, rp.barcode, rp.created_at,
                r.tracking_code, r.status AS repair_status,
                c.name AS customer_name,
                d.device_type, d.brand, d.model
         FROM repair_parts rp
         JOIN repairs r ON r.id = rp.repair_id
         JOIN customers c ON c.id = r.customer_id
         JOIN devices d ON d.id = r.device_id
         WHERE rp.status IN ('bestellt', 'unterwegs', 'angekommen')
         ORDER BY datetime(rp.created_at) DESC
         LIMIT 500`
      )
      .all();
    res.json({ parts });
  });

  app.post("/api/lager/scan-barcode", requireWorkshopFullAuth, (req, res) => {
    const barcode = String(req.body?.barcode ?? "").trim();
    if (!barcode) {
      res.status(400).json({ error: "Barcode leer" });
      return;
    }
    const prevRow = db.prepare(`SELECT * FROM repair_parts WHERE barcode = ?`).get(barcode) as
      | {
          id: string;
          repair_id: string;
          name: string;
          status: string;
          barcode: string | null;
        }
      | undefined;
    if (!prevRow) {
      res.status(404).json({ error: "Barcode unbekannt" });
      return;
    }
    const repairId = prevRow.repair_id;

    if (prevRow.status === "angekommen" || prevRow.status === "eingebaut") {
      const repair = db.prepare(`SELECT id, tracking_code, status FROM repairs WHERE id = ?`).get(repairId);
      res.json({
        ok: true,
        already: true,
        part: db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(prevRow.id),
        repair,
        message:
          prevRow.status === "eingebaut"
            ? "Dieses Teil ist bereits eingebaut."
            : "Dieses Teil war bereits als angekommen gebucht.",
      });
      return;
    }

    if (prevRow.status === "vor_ort") {
      res.status(409).json({ error: "Teil ist als vor Ort/Lager markiert – kein Wareneingang per Scan nötig." });
      return;
    }

    if (prevRow.status !== "bestellt" && prevRow.status !== "unterwegs") {
      res.status(400).json({ error: `Teil hat Status „${prevRow.status}“ – Scan nicht möglich.` });
      return;
    }

    const oldStatus = prevRow.status;
    db.prepare(`UPDATE repair_parts SET status = 'angekommen' WHERE id = ?`).run(prevRow.id);
    syncRepairStatusForParts(db, repairId);
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(prevRow.id);
    const repair = db.prepare(`SELECT id, tracking_code, status FROM repairs WHERE id = ?`).get(repairId);
    const zusatz = `Ersatzteil „${prevRow.name}“ per Barcode-Scan: ${partStatusLabelDe("angekommen")} (vorher: ${partStatusLabelDe(oldStatus)})`;
    queueCustomerRepairNotification(db, repairId, zusatz);
    res.json({
      ok: true,
      part,
      repair,
      message: "Teil als angekommen gebucht; Auftragsstatus wurde angepasst.",
    });
  });

  /** QR-Bild für öffentliche SumUp-Zahlungsseite (ohne Workshop-Login). */
  app.get("/api/track/:code/sumup-qr.png", async (req, res) => {
    const code = paramStr(req.params.code).trim();
    const row = db
      .prepare(`SELECT sumup_checkout_url FROM repairs WHERE tracking_code = ?`)
      .get(code) as { sumup_checkout_url: string | null } | undefined;
    if (!row?.sumup_checkout_url) {
      res.status(404).send("Kein SumUp-Link");
      return;
    }
    try {
      const png = await QRCode.toBuffer(row.sumup_checkout_url, { type: "png", width: 280, margin: 1 });
      res.type("png").send(png);
    } catch {
      res.status(500).send("QR fehlgeschlagen");
    }
  });

  /** Öffentliches Tracking (?sumup_sync=1 = SumUp-Status per API nachziehen, Fallback zum Webhook). Alias: GET /api/repair/:code */
  const handlePublicTrackByCode = async (req: Request, res: Response) => {
    const code = paramStr(req.params.code).trim();
    const trackSql = `SELECT r.id, r.tracking_code, r.status, r.total_cents, r.payment_status, r.payment_method, r.payment_due_at,
                r.sumup_checkout_url, r.sumup_channel, r.payment_paid_at,
                r.updated_at, r.created_at,
                r.problem_label, r.description, r.accessories,
                c.name AS customer_name,
                d.device_type, d.brand, d.model,
                i.invoice_number,
                COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days')) AS payment_due_until,
                CASE
                  WHEN r.payment_status = 'bezahlt' THEN 'bezahlt'
                  WHEN datetime('now') > datetime(COALESCE(r.payment_due_at, datetime(i.created_at, '+7 days'), datetime(r.created_at, '+7 days')))
                    THEN 'offen_ueberfaellig'
                  ELSE 'offen_in_frist'
                END AS payment_bucket
         FROM repairs r
         JOIN customers c ON c.id = r.customer_id
         JOIN devices d ON d.id = r.device_id
         LEFT JOIN invoices i ON i.id = (
           SELECT id FROM invoices WHERE repair_id = r.id AND document_kind = 'rechnung'
           ORDER BY datetime(created_at) DESC LIMIT 1
         )
         WHERE r.tracking_code = ?`;
    let row = db.prepare(trackSql).get(code);
    if (!row) {
      res.status(404).json({ error: "Code unbekannt" });
      return;
    }
    const wantSync = String(req.query.sumup_sync ?? "") === "1";
    if (wantSync) {
      const rid = (row as { id: string }).id;
      await syncRepairPaymentFromSumUp(db, rid);
      row = db.prepare(trackSql).get(code);
    }
    if (!row) {
      res.status(404).json({ error: "Code unbekannt" });
      return;
    }
    const repair = row as {
      id: string;
      tracking_code: string;
      status: string;
      total_cents: number;
      payment_status: string;
      payment_method: string | null;
      payment_due_at: string | null;
      sumup_checkout_url: string | null;
      sumup_channel: string | null;
      payment_paid_at: string | null;
      updated_at: string;
      created_at: string;
      problem_label: string | null;
      description: string | null;
      accessories: string | null;
      customer_name: string;
      device_type: string;
      brand: string | null;
      model: string | null;
      invoice_number: string | null;
      payment_due_until: string;
      payment_bucket: string;
    };
    const {
      id: repairIdForParts,
      customer_name,
      device_type,
      brand,
      model,
      invoice_number,
      payment_due_until,
      payment_bucket,
      ...trackingRest
    } = repair;
    const parts = db
      .prepare(`SELECT name, status, sale_cents FROM repair_parts WHERE repair_id = ?`)
      .all(repairIdForParts) as { name: string; status: string; sale_cents: number }[];
    const logs = db
      .prepare(
        `SELECT logged_at AS timestamp, action_type, description, duration_minutes
         FROM repair_logs WHERE repair_id = ? ORDER BY datetime(logged_at) ASC, id ASC`
      )
      .all(repairIdForParts) as { timestamp: string; action_type: string; description: string; duration_minutes: number | null }[];
    const pendingParts = parts.some((p) => p.status === "bestellt" || p.status === "unterwegs");
    const anyHere = parts.some(
      (p) => p.status === "angekommen" || p.status === "eingebaut" || p.status === "vor_ort"
    );
    let message: string | null = null;
    if (pendingParts && anyHere) {
      message =
        "Ein oder mehrere Ersatzteile sind bereits bei uns eingetroffen; weitere Teile folgen. Sobald alle Bestellungen vollständig da sind, geht die Bearbeitung nahtlos weiter.";
    } else if (pendingParts) {
      message = "Sobald alle bestellten Teile bei uns eingetroffen sind, geht es mit der Reparatur weiter.";
    }
    res.json({
      tracking: trackingRest,
      customer: { name: customer_name },
      device: {
        device_type,
        brand: brand ?? null,
        model: model ?? null,
      },
      invoice_number,
      payment_due_until,
      payment_bucket,
      paymentTerms: {
        headline: PAYMENT_TERMS_HEADLINE_DE,
        lines: PAYMENT_TERMS_LINES_DE,
      },
      transfer_verwendungszweck: transferPurposeFromTracking(repair.tracking_code),
      parts,
      message,
      logs,
    });
  };
  app.get("/api/track/:code", handlePublicTrackByCode);
  app.get("/api/repair/:code", handlePublicTrackByCode);

  /** Öffentlich per Link nach Annahme (kein Workshop-Login auf dem Tablet) */
  app.get("/api/repairs/:id/invoice.pdf", async (req, res) => {
    const id = paramStr(req.params.id);
    const inv = getPrimaryRechnung(db, id);
    if (!inv) {
      res.status(404).send("Keine Rechnung");
      return;
    }
    if (inv.document_status === "final") {
      if (!inv.pdf_path || !fs.existsSync(inv.pdf_path)) {
        res.status(404).send("Rechnungs-PDF fehlt (revisionssicher gespeichert).");
        return;
      }
      res.sendFile(path.resolve(inv.pdf_path));
      return;
    }
    const p = await writeInvoicePdf(db, id, inv.invoice_number);
    db.prepare(`UPDATE invoices SET pdf_path = ? WHERE id = ?`).run(p, inv.id);
    res.sendFile(path.resolve(p));
  });

  /** Gespeicherte Auftragsbestätigung (PDF mit Unterschrift) – nur Werkstatt */
  app.get("/api/repairs/:id/acceptance.pdf", requireWorkshopFullAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const row = db.prepare(`SELECT acceptance_pdf_path FROM repairs WHERE id = ?`).get(id) as
      | { acceptance_pdf_path: string | null }
      | undefined;
    if (!row?.acceptance_pdf_path || !fs.existsSync(row.acceptance_pdf_path)) {
      res.status(404).send("Keine Auftragsbestätigung");
      return;
    }
    res.type("pdf").sendFile(path.resolve(row.acceptance_pdf_path));
  });

  /** Reparaturauftrag A4 (wie Rechnung: nur mit unratbarem `id`); fehlt die Datei, wird sie nachgezogen. */
  app.get("/api/repairs/:id/repair-order.pdf", async (req, res) => {
    const id = paramStr(req.params.id);
    let row = db.prepare(`SELECT repair_order_pdf_path FROM repairs WHERE id = ?`).get(id) as
      | { repair_order_pdf_path: string | null }
      | undefined;
    if (!row) {
      res.status(404).send("Nicht gefunden");
      return;
    }
    if (!row.repair_order_pdf_path || !fs.existsSync(row.repair_order_pdf_path)) {
      try {
        await syncRepairOrderPdfs(db, id, req);
      } catch (e) {
        console.error("[pdf] Reparaturauftrag nachladen:", e);
      }
      row = db.prepare(`SELECT repair_order_pdf_path FROM repairs WHERE id = ?`).get(id) as typeof row;
    }
    if (!row?.repair_order_pdf_path || !fs.existsSync(row.repair_order_pdf_path)) {
      res.status(404).send("Reparaturauftrag-PDF nicht verfügbar");
      return;
    }
    res.type("pdf").sendFile(path.resolve(row.repair_order_pdf_path));
  });

  /** Kompaktes Etiketten-PDF zum Auftrag (Zugriff wie `repair-order.pdf`). */
  app.get("/api/repairs/:id/repair-order-label.pdf", async (req, res) => {
    const id = paramStr(req.params.id);
    let row = db.prepare(`SELECT repair_order_label_pdf_path FROM repairs WHERE id = ?`).get(id) as
      | { repair_order_label_pdf_path: string | null }
      | undefined;
    if (!row) {
      res.status(404).send("Nicht gefunden");
      return;
    }
    if (!row.repair_order_label_pdf_path || !fs.existsSync(row.repair_order_label_pdf_path)) {
      try {
        await syncRepairOrderPdfs(db, id, req);
      } catch (e) {
        console.error("[pdf] Etikett nachladen:", e);
      }
      row = db.prepare(`SELECT repair_order_label_pdf_path FROM repairs WHERE id = ?`).get(id) as typeof row;
    }
    if (!row?.repair_order_label_pdf_path || !fs.existsSync(row.repair_order_label_pdf_path)) {
      res.status(404).send("Etiketten-PDF nicht verfügbar");
      return;
    }
    res.type("pdf").sendFile(path.resolve(row.repair_order_label_pdf_path));
  });

  /** PDFs neu erzeugen (A4 + Etikett). */
  app.post("/api/repairs/:id/repair-order-pdf", requireWorkshopFullAuth, async (req, res) => {
    const id = paramStr(req.params.id);
    const exists = db.prepare(`SELECT id FROM repairs WHERE id = ?`).get(id);
    if (!exists) {
      res.status(404).json({ error: "Nicht gefunden" });
      return;
    }
    try {
      await syncRepairOrderPdfs(db, id, req);
      const repair = db.prepare(`SELECT * FROM repairs WHERE id = ?`).get(id);
      res.json({ ok: true, repair });
    } catch (e) {
      console.error("[pdf] Reparaturauftrag manuell:", e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/repairs/:id/qr.png", async (req, res) => {
    const id = paramStr(req.params.id);
    const row = db.prepare(`SELECT tracking_code FROM repairs WHERE id = ?`).get(id) as { tracking_code: string } | undefined;
    if (!row) {
      res.status(404).send("Not found");
      return;
    }
    const url = buildPublicTrackingUrl(row.tracking_code, req);
    const png = await QRCode.toBuffer(url, { type: "png", width: 256, margin: 1 });
    res.type("png").send(png);
  });
}
