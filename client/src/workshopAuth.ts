const KEY = "rabbit_workshop_token";

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
