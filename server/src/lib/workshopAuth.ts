import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      /** Gesetzt wenn Werkstatt-Passwort aktiv und Bearer gültig: `workshop` oder `bench`. */
      workshopRole?: "workshop" | "bench";
    }
  }
}

function getSecret(): string {
  return process.env.RABBIT_AUTH_SECRET ?? process.env.RABBIT_WORKSHOP_PASSWORD ?? "dev-insecure-change-me";
}

export function isWorkshopPasswordConfigured(): boolean {
  return Boolean(process.env.RABBIT_WORKSHOP_PASSWORD?.length);
}

export function isBenchPasswordConfigured(): boolean {
  return Boolean(process.env.RABBIT_BENCH_PASSWORD?.length);
}

/** Login: Klartext-Vergleich mit konfiguriertem Passwort */
export function verifyWorkshopPassword(password: string): boolean {
  const expected = process.env.RABBIT_WORKSHOP_PASSWORD;
  if (!expected) return true;
  const a = Buffer.from(password, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyBenchPassword(password: string): boolean {
  const expected = process.env.RABBIT_BENCH_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(password, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type WorkshopTokenRole = "workshop" | "bench";

export function signWorkshopToken(role: WorkshopTokenRole = "workshop"): string {
  const payload = { role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** @deprecated Nutze parseWorkshopToken für Rolle */
export function verifyWorkshopToken(token: string): boolean {
  return parseWorkshopToken(token) !== null;
}

export function parseWorkshopToken(token: string): { role: WorkshopTokenRole; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
  try {
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as {
      exp?: number;
      role?: string;
    };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    const role: WorkshopTokenRole = payload.role === "bench" ? "bench" : "workshop";
    return { role, exp: payload.exp };
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function isWorkshopFullAccess(req: Request): boolean {
  if (!isWorkshopPasswordConfigured()) return true;
  return req.workshopRole === "workshop";
}

/**
 * Wenn RABBIT_WORKSHOP_PASSWORD gesetzt ist: Bearer-Token nötig (Werkstatt oder Montage).
 * Ohne Passwort: öffentlich (nur für Entwicklung) – keine Rolle gesetzt.
 */
export function requireWorkshopAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isWorkshopPasswordConfigured()) {
    delete req.workshopRole;
    next();
    return;
  }
  const tok = bearerToken(req);
  if (!tok) {
    res.status(401).json({ error: "Anmeldung erforderlich", code: "WORKSHOP_AUTH" });
    return;
  }
  const parsed = parseWorkshopToken(tok);
  if (!parsed) {
    res.status(401).json({ error: "Anmeldung erforderlich", code: "WORKSHOP_AUTH" });
    return;
  }
  req.workshopRole = parsed.role;
  next();
}

/**
 * Nur Werkstatt-Vollzugriff (kein Montage-Tablet-Token).
 * Wenn kein Werkstatt-Passwort konfiguriert: wie bisher offen (Dev).
 */
export function requireWorkshopFullAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isWorkshopPasswordConfigured()) {
    delete req.workshopRole;
    next();
    return;
  }
  const tok = bearerToken(req);
  if (!tok) {
    res.status(401).json({ error: "Anmeldung erforderlich", code: "WORKSHOP_AUTH" });
    return;
  }
  const parsed = parseWorkshopToken(tok);
  if (!parsed) {
    res.status(401).json({ error: "Anmeldung erforderlich", code: "WORKSHOP_AUTH" });
    return;
  }
  if (parsed.role !== "workshop") {
    res.status(403).json({
      error: "Nur mit Werkstatt-Vollzugriff möglich (Montage-Anmeldung reicht nicht).",
      code: "WORKSHOP_FULL_REQUIRED",
    });
    return;
  }
  req.workshopRole = "workshop";
  next();
}
