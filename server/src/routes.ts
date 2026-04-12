import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, Request, Response } from "express";
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
  verifyWorkshopPassword,
  signWorkshopToken,
  requireWorkshopAuth,
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

export function registerRoutes(app: Express, db: Database.Database) {
  ensureUploadDir();

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

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

  /** Öffentliche Kennzahlen für die Hauptseite */
  app.get("/api/dashboard/summary", (_req, res) => {
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

  app.get("/api/stats/overview", requireWorkshopAuth, (_req, res) => {
    res.json(getWorkshopStatsOverview(db));
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
        `SELECT r.id, r.tracking_code, r.status, r.total_cents, r.created_at, r.acceptance_pdf_path
         FROM repairs r
         WHERE r.customer_id = ?
         ORDER BY datetime(r.created_at) DESC
         LIMIT 200`
      )
      .all(cid);
    res.json(rows);
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

  /** Probed-Mail (nur mit Werkstatt-Token); prüft SMTP inkl. Gmail-App-Passwort */
  app.post("/api/mail/test", requireWorkshopAuth, async (req, res) => {
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
  app.post("/api/system/backup", requireWorkshopAuth, async (_req, res) => {
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

  app.post("/api/repairs", async (req, res) => {
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
          `INSERT INTO repairs (id, tracking_code, repair_order_number, customer_id, device_id, problem_key, problem_label, description, accessories, pre_damage_notes, legal_consent_at, signature_data_url, status, total_cents, payment_status, is_test)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
          "angenommen",
          0,
          "offen",
          isTest
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
        `SELECT s.code, s.name, rs.price_cents, COALESCE(s.category, 'sonstiges') AS category
         FROM repair_services rs JOIN services s ON s.id = rs.service_id WHERE rs.repair_id = ?`
      )
      .all(id);
    const parts = db.prepare(`SELECT * FROM repair_parts WHERE repair_id = ?`).all(id);
    const media = db.prepare(`SELECT id, kind, file_path, mime, created_at FROM repair_media WHERE repair_id = ?`).all(id);
    const revenue_breakdown = computeRevenueBreakdownForRepairIds(db, [id]);
    res.json({ repair, customer, device, services, parts, media, revenue_breakdown });
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
    const r = db.prepare(`UPDATE repairs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
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

  app.patch("/api/repairs/:id/payment", requireWorkshopAuth, (req, res) => {
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
  app.post("/api/repairs/:id/pickup", requireWorkshopAuth, async (req, res) => {
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

  app.post("/api/create-sumup-checkout", requireWorkshopAuth, postCreateSumupCheckout);
  app.post("/create-sumup-checkout", requireWorkshopAuth, postCreateSumupCheckout);

  /** Tablet: SumUp-Status per API nachziehen (Webhook-Fallback / sofortige Aktualisierung). */
  app.get("/api/repairs/:id/sumup-sync", requireWorkshopAuth, async (req, res) => {
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
  app.get("/api/invoices", requireWorkshopAuth, (_req, res) => {
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
  app.get("/api/invoices/:id/document.pdf", requireWorkshopAuth, (req, res) => {
    const invId = paramStr(req.params.id);
    const inv = getInvoiceById(db, invId);
    if (!inv?.pdf_path || !fs.existsSync(inv.pdf_path)) {
      res.status(404).send("Dokument nicht gefunden");
      return;
    }
    res.sendFile(path.resolve(inv.pdf_path));
  });

  /** GoBD: Storno-Rechnung zur referenzierten finalen Ausgangsrechnung. */
  app.post("/api/invoices/:id/storno", requireWorkshopAuth, async (req, res) => {
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
         ) VALUES (?,?,?,?,?,?,?, datetime('now'), datetime('now', '+10 years'), ?, ?)`
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
  app.post("/api/invoices/:id/korrektur", requireWorkshopAuth, async (req, res) => {
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
         ) VALUES (?,?,?,?,?,?,?, datetime('now'), datetime('now', '+10 years'), ?, ?)`
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
    const purchase_cents = Math.round(Number(req.body?.purchase_cents ?? 0));
    const sale_cents = Math.round(Number(req.body?.sale_cents ?? 0));
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
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(pid);
    queueCustomerRepairNotification(
      db,
      repairId,
      `Neues Ersatzteil: „${name}“ – ${partStatusLabelDe(initialStatus)}`
    );
    scheduleSyncRepairOrderPdfs(db, repairId, req);
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
    const part = db.prepare(`SELECT * FROM repair_parts WHERE id = ?`).get(partId);
    if (wantStatus && prevRow.status !== nextStatus) {
      const zusatz = `Ersatzteil „${prevRow.name}“: ${partStatusLabelDe(nextStatus)}${
        prevRow.status ? ` (vorher: ${partStatusLabelDe(prevRow.status)})` : ""
      }`;
      queueCustomerRepairNotification(db, repairId, zusatz);
    }
    scheduleSyncRepairOrderPdfs(db, repairId, req);
    res.json({ part });
  });

  app.get("/api/lager/parts", requireWorkshopAuth, (_req, res) => {
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

  app.post("/api/lager/scan-barcode", requireWorkshopAuth, (req, res) => {
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

  /** Öffentliches Tracking (?sumup_sync=1 = SumUp-Status per API nachziehen, Fallback zum Webhook) */
  app.get("/api/track/:code", async (req, res) => {
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
    });
  });

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
  app.get("/api/repairs/:id/acceptance.pdf", requireWorkshopAuth, (req, res) => {
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
  app.post("/api/repairs/:id/repair-order-pdf", requireWorkshopAuth, async (req, res) => {
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
