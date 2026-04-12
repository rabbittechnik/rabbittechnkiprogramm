import { useEffect, useRef, useState } from "react";
import { getRepairNotificationSoundUrl } from "../lib/repairNotificationSounds";

export const REPAIR_NOTIFICATION_POLL_MS = 18_000;

/** Sichtbare Party-Animation + Klingelton-Dauer (ms). */
export const NEW_REPAIR_PARTY_DURATION_MS = 30_000;

export type RepairNotifyRow = {
  id: string;
  is_test?: number | boolean | string | null;
  /** Optional, für Erkennung „frischer“ Testauftrag beim ersten Listen-Abruf */
  created_at?: string | null;
};

const FRESH_TEST_NOTIFY_MS = 180_000;

function rowIsTest(r: RepairNotifyRow): boolean {
  const v = r.is_test;
  return v === true || v === 1 || v === "1";
}

function parseCreatedAtMs(created_at: string | null | undefined): number | null {
  if (created_at == null || String(created_at).trim() === "") return null;
  const raw = String(created_at).trim();
  const normalized = /T\d/.test(raw) ? raw : raw.replace(" ", "T");
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? t : null;
}

let activeNotificationAudio: HTMLAudioElement | null = null;

export function stopRepairNotificationSound(): void {
  if (!activeNotificationAudio) return;
  try {
    activeNotificationAudio.pause();
    activeNotificationAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
  activeNotificationAudio = null;
}

export function playNewRepairNotificationSound(): void {
  stopRepairNotificationSound();
  const url = getRepairNotificationSoundUrl();
  try {
    const a = new Audio(url);
    activeNotificationAudio = a;
    a.volume = 1;
    const onEnded = () => {
      if (activeNotificationAudio === a) activeNotificationAudio = null;
      a.removeEventListener("ended", onEnded);
    };
    a.addEventListener("ended", onEnded);
    void a.play().catch(() => {
      if (activeNotificationAudio === a) activeNotificationAudio = null;
    });
  } catch {
    activeNotificationAudio = null;
  }
}

/**
 * Nach Nutzerklick: kurz hörbar abspielen (Anfang des Clips), dann stoppen — entsperrt Autoplay
 * und bestätigt, dass Ton funktioniert. Rückgabe: ob `play()` erfolgreich war.
 */
export async function enableRepairNotificationSoundFromUserClick(): Promise<boolean> {
  const url = getRepairNotificationSoundUrl();
  try {
    const a = new Audio(url);
    a.currentTime = 0;
    a.volume = 1;
    await a.play();
    window.setTimeout(() => {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* ignore */
      }
    }, 450);
    return true;
  } catch {
    return false;
  }
}

/** Kurz stumm abspielen (vom Login-Klick aus), damit spätere Poll-Töne eher erlaubt sind. */
export function primeRepairNotificationAudio(): void {
  const url = getRepairNotificationSoundUrl();
  try {
    const a = new Audio(url);
    a.volume = 0;
    const p = a.play();
    if (p !== undefined) {
      void p
        .then(() => {
          a.pause();
          a.currentTime = 0;
        })
        .catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

let baselineSeenIds: Set<string> | null = null;

export function resetNewRepairNotificationBaseline(): void {
  baselineSeenIds = null;
}

let onNewRealRepairsHandler: ((ids: string[]) => void) | null = null;

export function setOnNewRealRepairsHandler(handler: ((ids: string[]) => void) | null): void {
  onNewRealRepairsHandler = handler;
}

/**
 * Nach jedem frischen Abruf der Reparatur-Liste aufrufen.
 * Erster Aufruf: Baseline setzen; zusätzlich frische Testaufträge (letzte ~3 min) → Ton (Navigation nach Annahme).
 * Danach: jede neue Auftrags-ID (inkl. Test) → Handler + Klingelton.
 */
export function observeRepairListForNewNotifications(rows: ReadonlyArray<RepairNotifyRow>): void {
  if (baselineSeenIds === null) {
    baselineSeenIds = new Set(rows.map((r) => r.id));
    const now = Date.now();
    const freshTestIds = rows
      .filter((r) => {
        if (!rowIsTest(r)) return false;
        const t = parseCreatedAtMs(r.created_at);
        if (t === null) return false;
        return now - t <= FRESH_TEST_NOTIFY_MS;
      })
      .map((r) => r.id);
    if (freshTestIds.length > 0) {
      queueMicrotask(() => {
        onNewRealRepairsHandler?.(freshTestIds);
        playNewRepairNotificationSound();
      });
    }
    return;
  }
  const newIds: string[] = [];
  for (const r of rows) {
    if (baselineSeenIds.has(r.id)) continue;
    baselineSeenIds.add(r.id);
    newIds.push(r.id);
  }
  if (newIds.length === 0) return;
  onNewRealRepairsHandler?.(newIds);
  playNewRepairNotificationSound();
}

type GateForNotify = "loading" | "login" | "ok" | "no_bench";

/**
 * Session: Baseline zurücksetzen wenn nicht eingeloggt; Liste pollen + bei Sichtbarkeit refreshen.
 * `refresh` muss nach erfolgreichem Abruf `observeRepairListForNewNotifications` aufrufen.
 */
export function useNewRepairNotification(opts: {
  gate: GateForNotify;
  refresh: () => Promise<unknown>;
}): void {
  const { gate, refresh } = opts;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (gate === "login" || gate === "loading" || gate === "no_bench") resetNewRepairNotificationBaseline();
  }, [gate]);

  useEffect(() => {
    if (gate !== "ok") return;
    const id = window.setInterval(() => {
      void refreshRef.current();
    }, REPAIR_NOTIFICATION_POLL_MS);
    return () => window.clearInterval(id);
  }, [gate]);

  useEffect(() => {
    if (gate !== "ok") return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [gate]);
}

/**
 * Registriert Handler für neue Aufträge (inkl. Test): 30s blinkende Zeilen + Party-Overlay; Klingelton nach max. Dauer stoppen.
 */
export function useNewRepairParty() {
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const tHighlight = useRef<number | null>(null);
  const tAudio = useRef<number | null>(null);

  useEffect(() => {
    const h = (ids: string[]) => {
      if (tHighlight.current) window.clearTimeout(tHighlight.current);
      if (tAudio.current) window.clearTimeout(tAudio.current);
      stopRepairNotificationSound();
      setHighlightIds(new Set(ids));
      tAudio.current = window.setTimeout(() => {
        stopRepairNotificationSound();
        tAudio.current = null;
      }, NEW_REPAIR_PARTY_DURATION_MS);
      tHighlight.current = window.setTimeout(() => {
        setHighlightIds(new Set());
        tHighlight.current = null;
      }, NEW_REPAIR_PARTY_DURATION_MS);
    };
    setOnNewRealRepairsHandler(h);
    return () => {
      setOnNewRealRepairsHandler(null);
      if (tHighlight.current) window.clearTimeout(tHighlight.current);
      if (tAudio.current) window.clearTimeout(tAudio.current);
    };
  }, []);

  const partyActive = highlightIds.size > 0;
  return { highlightIds, partyActive };
}
