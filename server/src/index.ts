import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { openDatabase } from "./db/init.js";
import { seedIfEmpty } from "./seed.js";
import { registerRoutes } from "./routes.js";
import { requireWorkshopAuth } from "./lib/workshopAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, "../data/uploads");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "12mb" }));

const db = openDatabase();
seedIfEmpty(db);
registerRoutes(app, db);

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
  const repairId = req.params.id;
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
      `SELECT r.id, r.tracking_code, r.status, r.total_cents, r.payment_status, r.updated_at, r.created_at,
       c.name as customer_name, d.device_type, d.brand, d.model
       FROM repairs r
       JOIN customers c ON c.id = r.customer_id
       JOIN devices d ON d.id = r.device_id
       ORDER BY r.created_at DESC`
    )
    .all();
  res.json(rows);
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`Rabbit-Technik API http://localhost:${PORT}`);
});
