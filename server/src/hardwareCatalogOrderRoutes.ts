import type { Express } from "express";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { requireWorkshopAuth } from "./lib/workshopAuth.js";
import {
  DEFAULT_MARKUP_BPS,
  buildTeileBestellenCatalog,
  getTeileProductById,
} from "./lib/teileBestellenCatalog.js";
import { makeHardwareOrderRef } from "./lib/trackingCode.js";
import { formatEuroFromCents, sendTeileBestellenOrderEmail } from "./lib/mail.js";

function paramStr(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function uniqueRef(db: Database.Database): string {
  for (let i = 0; i < 20; i++) {
    const code = makeHardwareOrderRef();
    const ex = db.prepare(`SELECT 1 FROM hardware_catalog_orders WHERE reference_code = ?`).get(code);
    if (!ex) return code;
  }
  return `HB-${nanoid(10).toUpperCase()}`;
}

export function registerHardwareCatalogOrderRoutes(app: Express, db: Database.Database): void {
  app.get("/api/teile-bestellen/katalog", requireWorkshopAuth, (_req, res) => {
    const categories = buildTeileBestellenCatalog(DEFAULT_MARKUP_BPS).map((c) => ({
      id: c.id,
      label: c.label,
      subcategories: c.subcategories.map((s) => ({
        id: s.id,
        label: s.label,
        products: s.products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          sale_cents: p.sale_cents,
          category_id: p.category_id,
          subcategory_id: p.subcategory_id,
          image_url: p.image_url,
        })),
      })),
    }));
    res.json({ markup_bps: DEFAULT_MARKUP_BPS, categories });
  });

  app.get("/api/teile-bestellen/orders", requireWorkshopAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT o.id, o.reference_code, o.customer_id, c.name AS customer_name, o.status, o.total_sale_cents,
                o.total_purchase_cents, o.markup_bps, o.send_customer_email, o.customer_email_sent, o.created_at
         FROM hardware_catalog_orders o
         JOIN customers c ON c.id = o.customer_id
         ORDER BY datetime(o.created_at) DESC LIMIT 200`
      )
      .all();
    res.json({ orders: rows });
  });

  app.get("/api/teile-bestellen/orders/:id", requireWorkshopAuth, (req, res) => {
    const id = paramStr(req.params.id);
    const o = db
      .prepare(
        `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
         FROM hardware_catalog_orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!o) {
      res.status(404).json({ error: "Auftrag nicht gefunden" });
      return;
    }
    const lines = db
      .prepare(
        `SELECT id, product_id, product_name, category_id, category_label, subcategory_id, subcategory_label,
                quantity, unit_sale_cents, unit_purchase_cents, line_sale_cents, line_purchase_cents
         FROM hardware_catalog_order_lines WHERE order_id = ? ORDER BY id`
      )
      .all(id);
    res.json({ order: o, lines });
  });

  app.post("/api/teile-bestellen/orders", requireWorkshopAuth, async (req, res) => {
    const body = req.body as {
      customer_id?: string;
      lines?: { product_id: string; quantity: number }[];
      signature_data_url?: string;
      status?: string;
      send_customer_email?: boolean;
    };
    const customerId = String(body?.customer_id ?? "").trim();
    if (!customerId) {
      res.status(400).json({ error: "customer_id erforderlich" });
      return;
    }
    const cust = db.prepare(`SELECT id, name, email FROM customers WHERE id = ?`).get(customerId) as
      | { id: string; name: string; email: string | null }
      | undefined;
    if (!cust) {
      res.status(400).json({ error: "Kunde nicht gefunden" });
      return;
    }
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length === 0) {
      res.status(400).json({ error: "Mindestens eine Position erforderlich" });
      return;
    }
    const status = body.status === "bestaetigt" ? "bestaetigt" : "angebot";
    const sendMail = body.send_customer_email === true;
    const sig = body.signature_data_url ? String(body.signature_data_url) : null;

    const resolved: {
      product: NonNullable<ReturnType<typeof getTeileProductById>>;
      quantity: number;
    }[] = [];
    for (const row of rawLines) {
      const pid = String(row?.product_id ?? "").trim();
      const qty = Math.max(1, Math.min(999, Math.round(Number(row?.quantity) || 1)));
      const p = getTeileProductById(pid);
      if (!p) {
        res.status(400).json({ error: `Unbekanntes Produkt: ${pid}` });
        return;
      }
      resolved.push({ product: p, quantity: qty });
    }

    let totalSale = 0;
    let totalPurchase = 0;
    const lineRows: {
      id: string;
      product_id: string;
      product_name: string;
      category_id: string;
      category_label: string;
      subcategory_id: string;
      subcategory_label: string;
      quantity: number;
      unit_sale_cents: number;
      unit_purchase_cents: number;
      line_sale_cents: number;
      line_purchase_cents: number;
    }[] = [];

    for (const { product: p, quantity: q } of resolved) {
      const lineSale = p.sale_cents * q;
      const linePurchase = p.purchase_cents * q;
      totalSale += lineSale;
      totalPurchase += linePurchase;
      lineRows.push({
        id: nanoid(),
        product_id: p.id,
        product_name: p.name,
        category_id: p.category_id,
        category_label: p.category_label,
        subcategory_id: p.subcategory_id,
        subcategory_label: p.subcategory_label,
        quantity: q,
        unit_sale_cents: p.sale_cents,
        unit_purchase_cents: p.purchase_cents,
        line_sale_cents: lineSale,
        line_purchase_cents: linePurchase,
      });
    }

    const orderId = nanoid();
    const ref = uniqueRef(db);
    const insOrder = db.prepare(
      `INSERT INTO hardware_catalog_orders (
         id, reference_code, customer_id, status, markup_bps, total_sale_cents, total_purchase_cents,
         signature_data_url, send_customer_email, customer_email_sent, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`
    );
    const insLine = db.prepare(
      `INSERT INTO hardware_catalog_order_lines (
         id, order_id, product_id, product_name, category_id, category_label, subcategory_id, subcategory_label,
         quantity, unit_sale_cents, unit_purchase_cents, line_sale_cents, line_purchase_cents
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const tx = db.transaction(() => {
      insOrder.run(
        orderId,
        ref,
        customerId,
        status,
        DEFAULT_MARKUP_BPS,
        totalSale,
        totalPurchase,
        sig,
        sendMail ? 1 : 0,
        0
      );
      for (const lr of lineRows) {
        insLine.run(
          lr.id,
          orderId,
          lr.product_id,
          lr.product_name,
          lr.category_id,
          lr.category_label,
          lr.subcategory_id,
          lr.subcategory_label,
          lr.quantity,
          lr.unit_sale_cents,
          lr.unit_purchase_cents,
          lr.line_sale_cents,
          lr.line_purchase_cents
        );
      }
    });
    tx();

    let mailReason: string | undefined;
    let customerEmailSent = false;
    if (sendMail && cust.email?.trim()) {
      const linesText = lineRows
        .map((l) => `${l.quantity}× ${l.product_name} … je ${formatEuroFromCents(l.unit_sale_cents)} € = ${formatEuroFromCents(l.line_sale_cents)} €`)
        .join("\n");
      const r = await sendTeileBestellenOrderEmail({
        to: cust.email.trim(),
        kundenname: cust.name,
        referenceCode: ref,
        statusLabel: status === "bestaetigt" ? "Bestellung bestätigt" : "Angebot",
        linesText,
        totalEuro: formatEuroFromCents(totalSale),
      });
      if (r.sent) {
        customerEmailSent = true;
        db.prepare(`UPDATE hardware_catalog_orders SET customer_email_sent = 1 WHERE id = ?`).run(orderId);
      } else {
        mailReason = r.reason;
      }
    } else if (sendMail && !cust.email?.trim()) {
      mailReason = "Keine Kunden-E-Mail hinterlegt.";
    }

    res.status(201).json({
      id: orderId,
      reference_code: ref,
      total_sale_cents: totalSale,
      customer_email_attempted: sendMail,
      customer_email_sent: customerEmailSent,
      mail_reason: mailReason,
    });
  });
}
