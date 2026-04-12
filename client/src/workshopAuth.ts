const KEY = "rabbit_workshop_token";

export type WorkshopTokenRole = "workshop" | "bench";

/**
 * Token in localStorage (statt sessionStorage), damit die PWA am Tablet
 * bei Neustart / App-Wechsel eingeloggt bleibt – kein Login-Loop.
 */
export function getWorkshopToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function decodePayloadBase64Url(data: string): { role?: string } {
  const pad = "=".repeat((4 - (data.length % 4)) % 4);
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return JSON.parse(atob(b64)) as { role?: string };
}

/** Rolle aus dem gespeicherten Bearer-Token (ohne Signaturprüfung – nur für UI). */
export function getWorkshopTokenRole(): WorkshopTokenRole | null {
  const token = getWorkshopToken();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0]) return null;
  try {
    const json = decodePayloadBase64Url(parts[0]);
    return json.role === "bench" ? "bench" : "workshop";
  } catch {
    return "workshop";
  }
}

export function setWorkshopToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(KEY, token);
      sessionStorage.setItem(KEY, token);
    } else {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      clearSensitiveCaches();
    }
    try {
      window.dispatchEvent(new CustomEvent("rt-workshop-token-changed"));
    } catch {
      /* ignore */
    }
  } catch {
    /* Private-Browsing oder Storage voll – stiller Fallback */
  }
}

/**
 * Bei Logout: Service-Worker-Cache mit API-Daten räumen,
 * damit keine sensiblen Daten auf dem Gerät verbleiben.
 */
function clearSensitiveCaches(): void {
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const mc = new MessageChannel();
      navigator.serviceWorker.controller.postMessage(
        { type: "CLEAR_SENSITIVE_CACHES" },
        [mc.port2]
      );
    }
    caches.delete("rt-data-v1").catch(() => {});
  } catch {
    /* SW nicht verfügbar – kein Problem */
  }
}
