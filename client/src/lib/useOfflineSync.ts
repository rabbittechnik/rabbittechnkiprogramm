import { useCallback, useEffect, useRef, useState } from "react";
import { queueLength, replayQueue, subscribeQueue, type SyncResult } from "./offlineQueue";

export type SyncState = "idle" | "syncing" | "done" | "error";

/**
 * Hook für Offline-Sync:
 * - Zeigt Anzahl der wartenden Aktionen
 * - Spielt Queue automatisch ab, sobald der Browser online geht
 * - Manueller Sync-Trigger
 */
export function useOfflineSync() {
  const [pending, setPending] = useState(queueLength);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const syncing = useRef(false);

  useEffect(() => {
    setPending(queueLength());
    return subscribeQueue(() => setPending(queueLength()));
  }, []);

  const doSync = useCallback(async () => {
    if (syncing.current || queueLength() === 0) return;
    syncing.current = true;
    setSyncState("syncing");
    try {
      const result = await replayQueue();
      setLastResult(result);
      setSyncState(result.failed > 0 ? "error" : "done");
      setPending(queueLength());
      if (result.failed === 0) {
        setTimeout(() => setSyncState("idle"), 3000);
      }
    } catch {
      setSyncState("error");
    } finally {
      syncing.current = false;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      if (queueLength() > 0) {
        void doSync();
      }
    };
    window.addEventListener("online", handleOnline);
    if (navigator.onLine && queueLength() > 0) {
      void doSync();
    }
    return () => window.removeEventListener("online", handleOnline);
  }, [doSync]);

  return { pending, syncState, lastResult, doSync };
}
