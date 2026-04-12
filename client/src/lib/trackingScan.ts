/** USB-Scanner / eingefügte URL: Tracking-Code extrahieren (RT-…). */
export function parseScanToTrackingCode(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.findIndex((p) => p.toLowerCase() === "track" || p.toLowerCase() === "repair");
      if (i >= 0 && parts[i + 1]) return decodeURIComponent(parts[i + 1]).trim().toUpperCase();
    } catch {
      return null;
    }
    return null;
  }
  const up = t.toUpperCase();
  if (/^RT-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(up)) return up;
  return null;
}
