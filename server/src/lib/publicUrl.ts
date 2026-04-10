import type { Request } from "express";

function normalizeBaseUrl(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  let u = t.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/$/, "");
}

/**
 * Öffentliche Basis-URL nur aus Umgebungsvariablen (für E-Mails etc., ohne HTTP-Request).
 * Reihenfolge: PUBLIC_TRACKING_URL → RABBIT_PUBLIC_SITE_URL → RAILWAY_STATIC_URL → RAILWAY_PUBLIC_DOMAIN
 */
function publicBaseFromEnvironment(): string | undefined {
  for (const key of ["PUBLIC_TRACKING_URL", "RABBIT_PUBLIC_SITE_URL", "RAILWAY_STATIC_URL"] as const) {
    const v = normalizeBaseUrl(process.env[key]);
    if (v) return v;
  }
  const dom = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (dom) return normalizeBaseUrl(dom.includes("://") ? dom : `https://${dom}`);
  return undefined;
}

/**
 * Öffentliche Basis-URL für Tracking-Links (ohne trailing slash).
 * 1) Umgebung (PUBLIC_TRACKING_URL, Railway-Variablen, …)
 * 2) sonst aus der Anfrage (Host / X-Forwarded-*)
 * 3) Fallback nur für lokale Entwicklung
 */
export function getPublicTrackingBaseUrl(req?: Pick<Request, "get" | "protocol" | "secure">): string {
  const fromEnv = publicBaseFromEnvironment();
  if (fromEnv) return fromEnv;

  if (req) {
    const xfProto = req.get("x-forwarded-proto");
    const firstProto = xfProto?.split(",")[0]?.trim();
    const proto =
      firstProto === "https" || firstProto === "http"
        ? firstProto
        : req.secure || req.protocol === "https"
          ? "https"
          : "http";
    const xfHost = req.get("x-forwarded-host");
    const host = xfHost?.split(",")[0]?.trim() || req.get("host") || "";
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
  }

  return "http://localhost:5173";
}

export function buildPublicTrackingUrl(
  trackingCode: string,
  req?: Pick<Request, "get" | "protocol" | "secure">
): string {
  const base = getPublicTrackingBaseUrl(req);
  return `${base}/track/${encodeURIComponent(trackingCode)}`;
}
