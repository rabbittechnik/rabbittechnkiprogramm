/**
 * Offline Action Queue – speichert gescheiterte Mutations (POST/PATCH/DELETE)
 * in localStorage und spielt sie bei Reconnect automatisch ab.
 *
 * Sicherheit:
 * - Authorization-Header wird NICHT gespeichert (kein Token im Klartext)
 * - Bei Replay wird der aktuelle Token frisch aus dem Auth-Modul geholt
 * - Sensible Header (Cookie, Set-Cookie) werden entfernt
 */

import { getWorkshopToken } from "../workshopAuth";

const STORAGE_KEY = "rabbit_offline_queue";

const STRIPPED_HEADERS = ["authorization", "cookie", "set-cookie"];

export type QueuedAction = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  queuedAt: string;
  label: string;
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedAction[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedAction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* Storage voll – älteste Einträge entfernen */
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-20)));
    } catch {
      /* aufgeben */
    }
  }
}

export function enqueue(action: Omit<QueuedAction, "id" | "queuedAt">): QueuedAction {
  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(action.headers)) {
    if (!STRIPPED_HEADERS.includes(k.toLowerCase())) {
      safeHeaders[k] = v;
    }
  }
  const entry: QueuedAction = {
    ...action,
    headers: safeHeaders,
    id: generateId(),
    queuedAt: new Date().toISOString(),
  };
  const queue = getQueue();
  queue.push(entry);
  saveQueue(queue);
  notifyListeners();
  return entry;
}

export function removeFromQueue(id: string): void {
  const queue = getQueue().filter((a) => a.id !== id);
  saveQueue(queue);
  notifyListeners();
}

export function clearQueue(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notifyListeners();
}

export function queueLength(): number {
  return getQueue().length;
}

export type SyncResult = {
  total: number;
  success: number;
  failed: number;
  errors: { id: string; label: string; error: string }[];
};

/**
 * Spielt alle wartenden Aktionen der Reihe nach ab.
 * Erfolgreich gesendete werden aus der Queue entfernt.
 */
export async function replayQueue(): Promise<SyncResult> {
  const queue = getQueue();
  if (queue.length === 0) return { total: 0, success: 0, failed: 0, errors: [] };

  const result: SyncResult = { total: queue.length, success: 0, failed: 0, errors: [] };

  for (const action of queue) {
    try {
      const replayHeaders = { ...action.headers };
      const token = getWorkshopToken();
      if (token) replayHeaders["Authorization"] = `Bearer ${token}`;

      const response = await fetch(action.url, {
        method: action.method,
        headers: replayHeaders,
        body: action.body,
      });
      if (response.ok || response.status === 409) {
        removeFromQueue(action.id);
        result.success++;
      } else {
        const msg = await response.text().catch(() => response.statusText);
        result.failed++;
        result.errors.push({ id: action.id, label: action.label, error: msg });
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ id: action.id, label: action.label, error: String(e) });
      break;
    }
  }

  notifyListeners();
  return result;
}

// ─── Change-Listener (für UI-Updates) ──────────────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}
