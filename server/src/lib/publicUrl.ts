import type { Request } from "express";

/**
 * Öffentliche Basis-URL für Tracking-Links (ohne trailing slash).
 * 1) `PUBLIC_TRACKING_URL` wenn gesetzt (empfohlen für E-Mails und feste Links)
 * 2) sonst aus der Anfrage (Host / X-Forwarded-*), z. B. gleiche Railway-Domain wie das Frontend
 * 3) Fallback nur für lokale Entwicklung
 */
export function getPublicTrackingBaseUrl(req?: Pick<Request, "get" | "protocol" | "secure">): string {
  const fromEnv = process.env.PUBLIC_TRACKING_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

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
