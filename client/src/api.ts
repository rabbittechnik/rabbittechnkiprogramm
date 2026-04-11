import { getWorkshopToken } from "./workshopAuth";

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

/** Werkstatt: sendet Bearer-Token wenn gesetzt */
export async function fetchWorkshop<T>(path: string, init?: RequestInit): Promise<T> {
  const h = new Headers(init?.headers);
  h.set("Content-Type", "application/json");
  const t = getWorkshopToken();
  if (t) h.set("Authorization", `Bearer ${t}`);

  const r = await fetch(`${API}${path}`, { ...init, headers: h });
  if (r.status === 401) {
    const err = new Error("Anmeldung erforderlich") as Error & { code?: string };
    err.code = "WORKSHOP_AUTH";
    throw err;
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

/** Werkstatt: Binär (z. B. PDF) mit Bearer-Token */
export async function fetchWorkshopBlob(path: string): Promise<Blob> {
  const h = new Headers();
  const t = getWorkshopToken();
  if (t) h.set("Authorization", `Bearer ${t}`);

  const r = await fetch(`${API}${path}`, { headers: h });
  if (r.status === 401) {
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
