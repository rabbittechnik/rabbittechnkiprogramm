import type { Express } from "express";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import { requireWorkshopAuth } from "./lib/workshopAuth.js";
import { calculateOrderTotals, getMarkupPercent, getServiceFeeCents, getServiceFeeMode, vatFromGrossCents, type OrderItem } from "./lib/networkPricing.js";
import { seedNetworkCatalog, refreshFromAvm } from "./lib/networkCatalog.js";
import { writeNetworkConfirmationPdf } from "./lib/pdfNetworkOrder.js";
import { sendNetworkConfirmationEmail, sendNetworkDeliveryEmail } from "./lib/networkMail.js";
import { finalizeNetworkOrderInvoice } from "./lib/networkOrderFinalize.js";
import { syncNetworkOrderPaymentFromSumUp } from "./lib/sumupPaidSync.js";
import { createSumUpHostedCheckout } from "./lib/sumupCheckout.js";
import { resolveSumUpWebhookUrl } from "./lib/publicUrl.js";

export function registerNetworkRoutes(app: Express, db: Database.Database): void {
  seedNetworkCatalog(db);

  // ── Katalog ─────────────────────────────────────────────────────────────
  app.get("/api/network/catalog", (_req, res) => {
    const markup = getMarkupPercent(db);
    const rows = db.prepare(`SELECT * FROM network_devices ORDER BY type, model`).all() as {
      id: string; type: string; brand: string; model: string; connection_type: string | null;
      wifi_standard: string; speed: string; mesh_support: number; base_price_cents: number;
    }[];
    const devices = rows.map((r) => ({
      id: r.id,
      type: r.type,
      brand: r.brand,
      model: r.model,
      connection_type: r.connection_type,
      wifi_standard: r.wifi_standard,
      speed: r.speed,
      mesh_support: !!r.mesh_support,
      price_cents: Math.round(r.base_price_cents * (1 + markup / 100)),
    }));
    res.json({ devices, serviceFee: { cents: getServiceFeeCents(db), mode: getServiceFeeMode(db) } });
  });

  app.post("/api/network/catalog/refresh", requireWorkshopAuth, async (_req, res) => {
    const result = await refreshFromAvm(db);
    res.json(result);
  });

  // ── Preisvorschau ───────────────────────────────────────────────────────
  app.post("/api/network/orders/preview", (req, res) => {
    const items = (req.body?.items ?? []) as OrderItem[];
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Mindestens ein Gerät erforderlich" });
      return;
    }
    const totals = calculateOrderTotals(db, items);
    const vat = vatFromGrossCents(totals.grandTotalCents);
    res.json({
      items: totals.pricedItems.map(({ base_price_cents: _b, ...rest }) => rest),
      hardwareTotalCents: totals.hardwareTotalCents,
      serviceFeeCents: totals.serviceFeeCents,
      grandTotalCents: totals.grandTotalCents,
      netTotalCents: vat.netCents,
      vatCents: vat.vatCents,
      vatRatePercent: vat.vatRatePercent,
    });
  });

  // ── Auftrag anlegen ─────────────────────────────────────────────────────
  app.post("/api/network/orders", async (req, res) => {
    try {
      const body = req.body ?? {};
      const customerId = String(body.customer_id ?? "").trim();
      const items = (body.items ?? []) as OrderItem[];
      const signatureDataUrl = body.signature_data_url ? String(body.signature_data_url) : null;
      const notes = body.notes ? String(body.notes) : null;

      if (!customerId) { res.status(400).json({ error: "customer_id fehlt" }); return; }
      if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "Mindestens ein Gerät" }); return; }

      const customer = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(customerId);
      if (!customer) { res.status(404).json({ error: "Kunde nicht gefunden" }); return; }

      const totals = calculateOrderTotals(db, items);
      const orderId = nanoid();

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO network_orders (id, customer_id, service_fee_cents, hardware_total_cents, grand_total_cents, signature_data_url, notes)
           VALUES (?,?,?,?,?,?,?)`
        ).run(orderId, customerId, totals.serviceFeeCents, totals.hardwareTotalCents, totals.grandTotalCents, signatureDataUrl, notes);

        const insItem = db.prepare(
          `INSERT INTO network_order_items (id, order_id, device_id, quantity, unit_price_cents) VALUES (?,?,?,?,?)`
        );
        for (const pi of totals.pricedItems) {
          insItem.run(nanoid(), orderId, pi.device_id, pi.quantity, pi.unit_price_cents);
        }
      });
      tx();

      let confirmationPdf: string | null = null;
      try {
        confirmationPdf = await writeNetworkConfirmationPdf(db, orderId);
        db.prepare(`UPDATE network_orders SET confirmation_pdf_path = ? WHERE id = ?`).run(confirmationPdf, orderId);
      } catch (e) { console.error("[network-pdf]", e); }

      void sendNetworkConfirmationEmail(db, orderId, confirmationPdf ?? undefined).catch((e) => console.error("[network-mail]", e));

      const order = db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(orderId);
      const listLines = totals.pricedItems.map((pi) => `${pi.quantity}× ${pi.brand} ${pi.model}`);
      const tplRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'network_dealer_order_url'`).get() as { value: string } | undefined;
      let dealer_order_url: string | null = null;
      const tpl = tplRow?.value?.trim();
      if (tpl) {
        dealer_order_url = tpl
          .replace(/\{\{ITEMS\}\}/g, encodeURIComponent(listLines.join(", ")))
          .replace(/\{\{ITEMS_LINE\}\}/g, encodeURIComponent(listLines.join("\n")));
      }
      res.status(201).json({ order, hardware_order: { lines: listLines, dealer_order_url } });
    } catch (e) {
      console.error("[network-order]", e);
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Auftragsliste / Einzelauftrag ───────────────────────────────────────
  app.get("/api/network/orders", requireWorkshopAuth, (_req, res) => {
    const orders = db.prepare(
      `SELECT o.*, c.name AS customer_name, c.email AS customer_email
       FROM network_orders o JOIN customers c ON c.id = o.customer_id
       ORDER BY datetime(o.created_at) DESC LIMIT 200`
    ).all();
    res.json({ orders });
  });

  app.get("/api/network/orders/:id", requireWorkshopAuth, (req, res) => {
    const id = String(req.params.id);
    const order = db.prepare(
      `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.address AS customer_address
       FROM network_orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
    ).get(id);
    if (!order) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    const items = db.prepare(
      `SELECT i.*, d.model, d.brand, d.type AS device_type, d.wifi_standard, d.connection_type
       FROM network_order_items i JOIN network_devices d ON d.id = i.device_id WHERE i.order_id = ?`
    ).all(id);
    res.json({ order, items });
  });

  // ── PDFs ────────────────────────────────────────────────────────────────
  app.get("/api/network/orders/:id/confirmation.pdf", requireWorkshopAuth, async (req, res) => {
    const id = String(req.params.id);
    const row = db.prepare(`SELECT confirmation_pdf_path FROM network_orders WHERE id = ?`).get(id) as { confirmation_pdf_path: string | null } | undefined;
    if (row?.confirmation_pdf_path) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      if (fs.existsSync(row.confirmation_pdf_path)) { res.sendFile(path.resolve(row.confirmation_pdf_path)); return; }
    }
    try {
      const p = await writeNetworkConfirmationPdf(db, id);
      db.prepare(`UPDATE network_orders SET confirmation_pdf_path = ? WHERE id = ?`).run(p, id);
      const path = await import("node:path");
      res.sendFile(path.resolve(p));
    } catch (e) { res.status(404).send(String(e)); }
  });

  app.get("/api/network/orders/:id/invoice.pdf", requireWorkshopAuth, async (req, res) => {
    const id = String(req.params.id);
    const row = db.prepare(`SELECT invoice_pdf_path, invoice_finalized_at FROM network_orders WHERE id = ?`).get(id) as { invoice_pdf_path: string | null; invoice_finalized_at: string | null } | undefined;
    if (row?.invoice_pdf_path) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      if (fs.existsSync(row.invoice_pdf_path)) { res.sendFile(path.resolve(row.invoice_pdf_path)); return; }
    }
    if (!row?.invoice_finalized_at) { res.status(404).send("Rechnung noch nicht erstellt"); return; }
    res.status(404).send("PDF nicht gefunden");
  });

  // ── Lieferung markieren ─────────────────────────────────────────────────
  app.patch("/api/network/orders/:id/delivery", requireWorkshopAuth, async (req, res) => {
    const id = String(req.params.id);
    const order = db.prepare(`SELECT status FROM network_orders WHERE id = ?`).get(id) as { status: string } | undefined;
    if (!order) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    if (order.status !== "bestellt") { res.status(400).json({ error: "Nur Aufträge mit Status 'bestellt' können als geliefert markiert werden" }); return; }

    db.prepare(`UPDATE network_orders SET status = 'geliefert', updated_at = datetime('now') WHERE id = ?`).run(id);
    void sendNetworkDeliveryEmail(db, id).catch((e) => console.error("[network-mail]", e));

    res.json({ ok: true, order: db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(id) });
  });

  // ── Übergabe + Zahlung (analog repairs pickup) ──────────────────────────
  app.post("/api/network/orders/:id/pickup", requireWorkshopAuth, async (req, res) => {
    const id = String(req.params.id);
    const type = String((req.body as { type?: string })?.type ?? "").trim();

    const order = db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(id) as {
      id: string; status: string; grand_total_cents: number; payment_status: string;
    } | undefined;
    if (!order) { res.status(404).json({ error: "Nicht gefunden" }); return; }
    if (order.status !== "geliefert") { res.status(400).json({ error: "Übergabe nur bei Status 'geliefert'" }); return; }

    const finalizeInvoice = async () => {
      try {
        await finalizeNetworkOrderInvoice(db, id);
      } catch (e) {
        console.error("[network-invoice]", e);
      }
    };

    if (type === "bar") {
      db.prepare(
        `UPDATE network_orders SET status = 'uebergeben', payment_status = 'bezahlt', payment_method = 'bar', payment_paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(id);
      await finalizeInvoice();
      res.json({ ok: true, order: db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(id) });
      return;
    }

    if (type === "ueberweisung") {
      db.prepare(
        `UPDATE network_orders SET status = 'uebergeben', payment_status = 'offen', payment_method = 'ueberweisung', payment_due_at = datetime('now', '+7 days'), updated_at = datetime('now') WHERE id = ?`
      ).run(id);
      await finalizeInvoice();
      res.json({ ok: true, order: db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(id) });
      return;
    }

    if (type === "sumup_link") {
      const apiKey = process.env.RABBIT_SUMUP_API_KEY?.trim();
      const merchantCode = process.env.RABBIT_SUMUP_MERCHANT_CODE?.trim();
      if (!apiKey || !merchantCode) { res.status(503).json({ error: "SumUp nicht konfiguriert" }); return; }

      const amountEuro = Math.max(0.01, order.grand_total_cents / 100);
      const webhookUrl = resolveSumUpWebhookUrl(req);
      try {
        const checkout = await createSumUpHostedCheckout({
          apiKey, merchantCode, amountEuro,
          checkoutReference: `nw-${id.slice(0, 80)}`,
          description: `Rabbit-Technik Netzwerkeinrichtung`,
          returnUrl: webhookUrl,
        });
        db.prepare(
          `UPDATE network_orders SET sumup_checkout_id = ?, sumup_checkout_url = ?, sumup_channel = 'online', payment_method = 'sumup', updated_at = datetime('now') WHERE id = ?`
        ).run(checkout.checkoutId, checkout.hostedCheckoutUrl, id);
        const qrDataUrl = await QRCode.toDataURL(checkout.hostedCheckoutUrl, { margin: 1, width: 280, errorCorrectionLevel: "M" });
        res.json({ payment_url: checkout.hostedCheckoutUrl, checkoutId: checkout.checkoutId, qrDataUrl });
      } catch (e) { res.status(502).json({ error: String(e) }); }
      return;
    }

    if (type === "sumup_complete") {
      const ch = String((req.body as { sumup_channel?: string })?.sumup_channel ?? "").trim();
      if (order.payment_status === "bezahlt") {
        res.json({ ok: true, already: true, order: db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(id) });
        return;
      }
      if (ch === "tap_to_pay") {
        db.prepare(
          `UPDATE network_orders SET status = 'uebergeben', payment_status = 'bezahlt', payment_method = 'sumup', sumup_channel = 'tap_to_pay', payment_paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(id);
      } else {
        db.prepare(
          `UPDATE network_orders SET status = 'uebergeben', payment_status = 'bezahlt', payment_method = 'sumup', payment_paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(id);
      }
      await finalizeInvoice();
      res.json({ ok: true, order: db.prepare(`SELECT * FROM network_orders WHERE id = ?`).get(id) });
      return;
    }

    res.status(400).json({ error: "Unbekannter Typ. Erlaubt: bar, ueberweisung, sumup_link, sumup_complete." });
  });

  app.get("/api/network/orders/:id/sumup-sync", requireWorkshopAuth, async (req, res) => {
    const id = String(req.params.id);
    const out = await syncNetworkOrderPaymentFromSumUp(db, id);
    res.json(out);
  });

  /** Bestellliste als Klartext (Händler / manuelle Bestellung). */
  app.get("/api/network/orders/:id/order-list.txt", requireWorkshopAuth, (req, res) => {
    const id = String(req.params.id);
    const rows = db
      .prepare(
        `SELECT i.quantity, d.brand, d.model, d.type FROM network_order_items i
         JOIN network_devices d ON d.id = i.device_id WHERE i.order_id = ? ORDER BY i.created_at`
      )
      .all(id) as { quantity: number; brand: string; model: string; type: string }[];
    if (!rows.length) {
      const ex = db.prepare(`SELECT id FROM network_orders WHERE id = ?`).get(id);
      if (!ex) {
        res.status(404).type("text/plain").send("Auftrag nicht gefunden");
        return;
      }
    }
    const lines = rows.map((r) => `${r.quantity}x ${r.brand} ${r.model} (${r.type})`);
    res.type("text/plain; charset=utf-8").send(lines.join("\n"));
  });

  // ── Zahlungsstatus manuell ──────────────────────────────────────────────
  app.patch("/api/network/orders/:id/payment", requireWorkshopAuth, async (req, res) => {
    const id = String(req.params.id);
    const ps = String(req.body?.payment_status ?? "");
    if (ps !== "offen" && ps !== "bezahlt") { res.status(400).json({ error: "Ungültig" }); return; }
    if (ps === "bezahlt") {
      db.prepare(`UPDATE network_orders SET payment_status = 'bezahlt', payment_paid_at = COALESCE(payment_paid_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(id);
      const row = db.prepare(`SELECT invoice_finalized_at FROM network_orders WHERE id = ?`).get(id) as { invoice_finalized_at: string | null } | undefined;
      if (row && !row.invoice_finalized_at) {
        try {
          await finalizeNetworkOrderInvoice(db, id);
        } catch (e) {
          console.error("[network-invoice] nach manueller Zahlung", e);
        }
      }
    } else {
      db.prepare(`UPDATE network_orders SET payment_status = 'offen', payment_paid_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
    }
    res.json({ ok: true });
  });

  // ── Admin-Einstellungen ─────────────────────────────────────────────────
  app.get("/api/network/admin/devices", requireWorkshopAuth, (_req, res) => {
    const devices = db.prepare(`SELECT * FROM network_devices ORDER BY type, model`).all();
    res.json({ devices });
  });

  app.post("/api/network/admin/devices", requireWorkshopAuth, (req, res) => {
    const b = req.body ?? {};
    const type = String(b.type ?? "").trim();
    const brand = String(b.brand ?? "AVM").trim() || "AVM";
    const model = String(b.model ?? "").trim();
    const wifi_standard = String(b.wifi_standard ?? "").trim() || "–";
    const speed = String(b.speed ?? "").trim() || "–";
    const base = Number(b.base_price_cents);
    if (!type || !model || !Number.isFinite(base) || base < 0) {
      res.status(400).json({ error: "type, model, base_price_cents erforderlich" });
      return;
    }
    const id = nanoid();
    const conn = b.connection_type != null ? String(b.connection_type).trim() || null : null;
    const mesh = Number(b.mesh_support) === 1 || b.mesh_support === true ? 1 : 0;
    db.prepare(
      `INSERT INTO network_devices (id, type, brand, model, connection_type, wifi_standard, speed, mesh_support, base_price_cents, source)
       VALUES (?,?,?,?,?,?,?,?,?,'manual')`
    ).run(id, type, brand, model, conn, wifi_standard, speed, mesh, Math.round(base));
    res.status(201).json({ id });
  });

  app.patch("/api/network/admin/devices/:id", requireWorkshopAuth, (req, res) => {
    const id = String(req.params.id);
    const exists = db.prepare(`SELECT id FROM network_devices WHERE id = ?`).get(id);
    if (!exists) {
      res.status(404).json({ error: "Gerät nicht gefunden" });
      return;
    }
    const b = req.body ?? {};
    const fields: string[] = [];
    const vals: (string | number | null)[] = [];
    const set = (col: string, v: string | number | null) => {
      fields.push(`${col} = ?`);
      vals.push(v);
    };
    if (typeof b.type === "string") set("type", String(b.type).trim());
    if (typeof b.brand === "string") set("brand", String(b.brand).trim());
    if (typeof b.model === "string") set("model", String(b.model).trim());
    if ("connection_type" in b) set("connection_type", b.connection_type == null ? null : String(b.connection_type).trim() || null);
    if (typeof b.wifi_standard === "string") set("wifi_standard", String(b.wifi_standard).trim());
    if (typeof b.speed === "string") set("speed", String(b.speed).trim());
    if (typeof b.mesh_support !== "undefined") set("mesh_support", Number(b.mesh_support) === 1 || b.mesh_support === true ? 1 : 0);
    if (typeof b.base_price_cents !== "undefined" && Number.isFinite(Number(b.base_price_cents))) {
      set("base_price_cents", Math.max(0, Math.round(Number(b.base_price_cents))));
    }
    if (!fields.length) {
      res.status(400).json({ error: "Keine Felder" });
      return;
    }
    fields.push(`updated_at = datetime('now')`);
    vals.push(id);
    db.prepare(`UPDATE network_devices SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  const ADMIN_KEYS = [
    "network_markup_percent",
    "network_service_fee_cents",
    "network_service_fee_mode",
    "network_email_intro_text",
    "network_dealer_order_url",
  ] as const;

  app.get("/api/network/admin/settings", requireWorkshopAuth, (_req, res) => {
    const settings: Record<string, string> = {};
    for (const key of ADMIN_KEYS) {
      const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
      settings[key] = row?.value ?? "";
    }
    res.json({ settings });
  });

  app.put("/api/network/admin/settings", requireWorkshopAuth, (req, res) => {
    const body = req.body?.settings as Record<string, string> | undefined;
    if (!body || typeof body !== "object") { res.status(400).json({ error: "settings-Objekt fehlt" }); return; }
    const upsert = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    const tx = db.transaction(() => {
      for (const key of ADMIN_KEYS) {
        if (key in body) upsert.run(key, String(body[key]));
      }
    });
    tx();
    res.json({ ok: true });
  });
}
