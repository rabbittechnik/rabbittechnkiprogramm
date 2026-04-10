import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schemaText.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getDbPath(): string {
  const env = process.env.RABBIT_DB_PATH;
  if (env) return env;
  const dataDir = path.join(__dirname, "../../data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "rabbit.db");
}

export function openDatabase(): Database.Database {
  const dbPath = getDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}
