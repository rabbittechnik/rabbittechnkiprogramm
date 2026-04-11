import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { openDatabase } from "./db/init.js";
import { ensureServices, seedIfEmpty } from "./seed.js";
import { registerRoutes, paramStr } from "./routes.js";
import { registerErpOverlayRoutes } from "./erp/overlayRoutes.js";
import { registerDayClosingRoutes } from "./dayClosingRoutes.js";
import { registerMonthReportRoutes } from "./monthReportRoutes.js";
import { startDayClosingScheduler } from "./lib/dayClosingScheduler.js";
import { startDataBackupScheduler } from "./lib/dataBackupScheduler.js";
import { isAutomaticDataBackupWanted } from "./lib/dataBackup.js";
import { requireWorkshopAuth } from "./lib/workshopAuth.js";
import { isMailConfigured, isResendConfigured, smtpMissingVars } from "./lib/mail.js";
import { getPublicTrackingBaseUrl } from "./lib/publicUrl.js";
import { getDataRoot, getDbFilePath, uploadsDir } from "./lib/dataPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** .env: zuerst Projektroot, dann server/.env (überschreibt) – unabhängig vom Startordner (nicht nur cwd). */
const envRoot = path.resolve(__dirname, "../../.env");
const envServer = path.resolve(__dirname, "../.env");
if (fs.existsSync(envRoot)) dotenv.config({ path: envRoot });
if (fs.existsSync(envServer)) dotenv.config({ path: envServer, override: true });

const UPLOAD_ROOT = uploadsDir();
/** Vite-Build (Production): relativ zu server/dist → ../../client/dist */
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();
/** Hinter einem Reverse-Proxy (z. B. Railway): HTTPS/Host für öffentliche Links korrekt erkennen */
if (process.env.RABBIT_TRUST_PROXY !== "0") {
  app.set("trust proxy", 1);
}
app.use(cors({ origin: true }));
app.use(express.json({ limit: "12mb" }));

const db = openDatabase();
seedIfEmpty(db);
ensureServices(db);

const dataRoot = getDataRoot();
const dbPath = getDbFilePath();
console.log(`[data] RABBIT_DATA_DIR=${process.env.RABBIT_DATA_DIR ?? "(nicht gesetzt)"}`);
console.log(`[data] effektives Datenverzeichnis: ${dataRoot}`);
console.log(`[data] SQLite-Datei: ${dbPath}`);
if (dataRoot === path.resolve("/data")) {
  console.log("[data] Persistenz: /data (Volume) – Kunden, Aufträge, Rechnungen, Zahlungen, Abschlüsse/Berichte (SQLite) und Dateien liegen hier.");
}
if (process.env.RAILWAY_ENVIRONMENT && !process.env.RABBIT_DATA_DIR?.trim() && !process.env.RABBIT_DB_PATH?.trim()) {
  console.warn(
    "[data] Railway: Ohne RABBIT_DATA_DIR oder RABBIT_DB_PATH auf ein Volume zeigt die DB ins Image – Deploy kann Daten leeren. Volume z. B. /data mounten und RABBIT_DATA_DIR=/data setzen."
  );
}
registerRoutes(app, db);
registerErpOverlayRoutes(app, db);
registerDayClosingRoutes(app, db);
registerMonthReportRoutes(app, db);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    cb(null, UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${nanoid()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

app.post("/api/repairs/:id/media", requireWorkshopAuth, upload.array("files", 12), (req, res) => {
  const repairId = paramStr(req.params.id);
  const exists = db.prepare(`SELECT id FROM repairs WHERE id = ?`).get(repairId);
  if (!exists) {
    res.status(404).json({ error: "Auftrag nicht gefunden" });
    return;
  }
  const files = req.files as Express.Multer.File[];
  const kind = String(req.body?.kind ?? "damage");
  const ins = db.prepare(
    `INSERT INTO repair_media (id, repair_id, kind, file_path, mime) VALUES (?,?,?,?,?)`
  );
  const ids: string[] = [];
  for (const f of files ?? []) {
    const mid = nanoid();
    ins.run(mid, repairId, kind, f.filename, f.mimetype);
    ids.push(mid);
  }
  res.status(201).json({ ids, paths: files?.map((f) => `/uploads/${f.filename}`) ?? [] });
});

app.use("/uploads", express.static(UPLOAD_ROOT));

app.get("/api/repairs", requireWorkshopAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.tracking_code, r.status, r.total_cents, r.payment_status, r.payment_method, r.sumup_channel, r.payment_due_at, r.updated_at, r.created_at,
       r.is_test,
       c.name as customer_name, d.device_type, d.brand, d.model
       FROM repairs r
       JOIN customers c ON c.id = r.customer_id
       JOIN devices d ON d.id = r.device_id
       ORDER BY r.created_at DESC`
    )
    .all();
  res.json(rows);
});

if (fs.existsSync(CLIENT_DIST)) {
  const indexHtml = path.join(CLIENT_DIST, "index.html");
  const staticMw = express.static(CLIENT_DIST);
  /** SumUp-Webhooks & API dürfen niemals index.html vom SPA bekommen. */
  app.use((req, res, next) => {
    const p = req.path.split("?")[0] ?? req.path;
    if (p.startsWith("/webhook")) {
      next();
      return;
    }
    staticMw(req, res, next);
  });
  app.get("*", (req, res, next) => {
    const p = req.path.split("?")[0] ?? req.path;
    if (p.startsWith("/webhook")) {
      res
        .status(200)
        .type("application/json")
        .json({ ok: true, message: "Webhook-Endpunkt – nur POST (z. B. SumUp CHECKOUT_STATUS_CHANGED)." });
      return;
    }
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (req.path.startsWith("/uploads")) {
      res.status(404).send("Not found");
      return;
    }
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });
} else {
  app.get("/", (_req, res) => {
    res.type("html").send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rabbit-Technik</title></head><body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
      <h1>API läuft – kein Frontend-Build</h1>
      <p>Ordner <code>client/dist</code> fehlt. Lokal: <code>npm run build</code> im Projektroot ausführen und erneut deployen.</p>
      <p><a href="/api/health" style="color:#7dd3fc">/api/health</a> prüfen</p>
      </body></html>`
    );
  });
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Rabbit-Technik http://0.0.0.0:${PORT} (API + ${fs.existsSync(CLIENT_DIST) ? "SPA" : "nur API"})`);
  const hasEnvFile = fs.existsSync(envRoot) || fs.existsSync(envServer);
  if (!hasEnvFile) {
    console.warn(`Konfiguration: keine .env-Datei gefunden. Erwartet: ${envServer} oder ${envRoot}`);
  }
  if (isMailConfigured()) {
    const mode = isResendConfigured() ? "Resend API" : "SMTP";
    console.log(`E-Mail: aktiv (${mode})`);
  } else {
    const miss = smtpMissingVars();
    console.warn(
      `E-Mail: nicht konfiguriert – SMTP fehlt (${miss.join(", ")}). Auf Railway Hobby: RABBIT_RESEND_API_KEY setzen (resend.com) oder Pro für SMTP. Siehe server/.env.example`
    );
  }
  if (isMailConfigured()) {
    const pub = getPublicTrackingBaseUrl();
    if (/localhost|127\.0\.0\.1/i.test(pub)) {
      console.warn(
        `Öffentliche URL: Tracking-Links in E-Mails zeigen auf "${pub}". Bitte PUBLIC_TRACKING_URL oder RABBIT_PUBLIC_SITE_URL setzen (oder Railway RAILWAY_STATIC_URL / RAILWAY_PUBLIC_DOMAIN).`
      );
    }
  }
  startDayClosingScheduler(db);
  startDataBackupScheduler(db);
  if (isAutomaticDataBackupWanted()) {
    console.log("[backup] Geplante Snapshots aktiv (siehe RABBIT_BACKUP_* in server/.env.example).");
  }
});
