import { getWorkshopToken, setWorkshopToken } from "./workshopAuth";
import { enqueue } from "./lib/offlineQueue";

const API = "";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const h = new Headers(init?.headers);
  h.set("Content-Type", "application/json");
  const r = await fetch(`${API}${path}`, { ...init, headers: h });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

/**
 * Werkstatt-API mit Offline-Queue:
 * - GET: normal (Service Worker cached)
 * - POST/PATCH/DELETE: bei Netzwerkfehler → Aktion wird lokal gespeichert
 *   und bei Reconnect automatisch nachgesendet.
 *
 * opts.offlineLabel: kurze Beschreibung für die Queue-Anzeige
 * opts.skipQueue: true → Mutation nicht queuen (z. B. Login)
 */
export type WorkshopFetchOpts = RequestInit & {
  offlineLabel?: string;
  skipQueue?: boolean;
};

export async function fetchWorkshop<T>(path: string, init?: WorkshopFetchOpts): Promise<T> {
  const h = new Headers(init?.headers);
  h.set("Content-Type", "application/json");
  const t = getWorkshopToken();
  if (t) h.set("Authorization", `Bearer ${t}`);

  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";

  try {
    const r = await fetch(`${API}${path}`, { ...init, headers: h });
    if (r.status === 401) {
      setWorkshopToken(null);
      const err = new Error("Anmeldung erforderlich") as Error & { code?: string };
      err.code = "WORKSHOP_AUTH";
      throw err;
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? r.statusText);
    }
    return r.json() as Promise<T>;
  } catch (e) {
    const isNetworkError =
      e instanceof TypeError ||
      (e instanceof Error && /fetch|network|aborted|offline/i.test(e.message));

    if (isMutation && isNetworkError && !init?.skipQueue) {
      const headersObj: Record<string, string> = {};
      h.forEach((v, k) => { headersObj[k] = v; });
      const label = init?.offlineLabel ?? `${method} ${path}`;
      enqueue({
        url: `${API}${path}`,
        method,
        headers: headersObj,
        body: (init?.body as string) ?? null,
        label,
      });
      const queued = { queued: true, offline: true } as unknown as T;
      return queued;
    }
    throw e;
  }
}

/** Werkstatt: Binär (z. B. PDF) mit Bearer-Token */
export async function fetchWorkshopBlob(path: string): Promise<Blob> {
  const h = new Headers();
  const t = getWorkshopToken();
  if (t) h.set("Authorization", `Bearer ${t}`);

  const r = await fetch(`${API}${path}`, { headers: h });
  if (r.status === 401) {
    setWorkshopToken(null);
    const err = new Error("Anmeldung erforderlich") as Error & { code?: string };
    err.code = "WORKSHOP_AUTH";
    throw err;
  }
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(msg.trim() || r.statusText);
  }
  return r.blob();
}

export async function fetchAuthStatus(): Promise<{ workshopAuthRequired: boolean }> {
  return fetchJson("/api/auth/status");
}

export async function loginWorkshop(password: string): Promise<{
  token: string | null;
  workshopAuthRequired?: boolean;
}> {
  return fetchJson("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
}
