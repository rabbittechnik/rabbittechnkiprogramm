import { useEffect, useRef } from "react";

export const NEW_REPAIR_SOUND_URL = "/sounds/musica-thegrefg-epica.mp3";

export const REPAIR_NOTIFICATION_POLL_MS = 18_000;

export type RepairNotifyRow = { id: string; is_test?: number | boolean | null };

let sharedAudio: HTMLAudioElement | null = null;

function getNotificationAudio(): HTMLAudioElement {
  if (!sharedAudio) sharedAudio = new Audio(NEW_REPAIR_SOUND_URL);
  return sharedAudio;
}

/**
 * Nach Nutzerklick: kurz hörbar abspielen (Anfang des Clips), dann stoppen — entsperrt Autoplay
 * und bestätigt, dass Ton funktioniert. Rückgabe: ob `play()` erfolgreich war.
 */
export async function enableRepairNotificationSoundFromUserClick(): Promise<boolean> {
  try {
    const a = getNotificationAudio();
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
  try {
    const a = getNotificationAudio();
    a.volume = 0;
    const p = a.play();
    if (p !== undefined) {
      void p
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.volume = 1;
        })
        .catch(() => {
          a.volume = 1;
        });
    } else {
      a.volume = 1;
    }
  } catch {
    /* ignore */
  }
}

let baselineSeenIds: Set<string> | null = null;

export function resetNewRepairNotificationBaseline(): void {
  baselineSeenIds = null;
}

function rowIsTest(r: RepairNotifyRow): boolean {
  return r.is_test === true || r.is_test === 1;
}

/**
 * Nach jedem frischen Abruf der Reparatur-Liste aufrufen.
 * Erster Aufruf: nur Baseline, kein Ton. Danach: neuer nicht-Test-Auftrag → einmal Ton.
 */
export function observeRepairListForNewNotifications(rows: ReadonlyArray<RepairNotifyRow>): void {
  if (baselineSeenIds === null) {
    baselineSeenIds = new Set(rows.map((r) => r.id));
    return;
  }
  let shouldPlay = false;
  for (const r of rows) {
    if (baselineSeenIds.has(r.id)) continue;
    baselineSeenIds.add(r.id);
    if (!rowIsTest(r)) shouldPlay = true;
  }
  if (!shouldPlay) return;
  try {
    const a = getNotificationAudio();
    a.currentTime = 0;
    a.volume = 1;
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
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
