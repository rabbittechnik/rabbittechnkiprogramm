import { useCallback, useEffect, useRef, useState } from "react";
import { enableRepairNotificationSoundFromUserClick } from "../hooks/useNewRepairNotification";

/**
 * Sichtbarer „Ton aktivieren“-Hinweis für Werkstatt-Tablets (Browser-Autoplay).
 */
export function RepairSoundEnableButton() {
  const [status, setStatus] = useState<"idle" | "ok" | "fail">("idle");
  const clearTimer = useRef<number | null>(null);

  const onClick = useCallback(() => {
    void (async () => {
      const ok = await enableRepairNotificationSoundFromUserClick();
      setStatus(ok ? "ok" : "fail");
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setStatus("idle"), 5000);
    })();
  }, []);

  useEffect(
    () => () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    },
    []
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className="text-xs rounded-lg border border-cyan-500/45 bg-cyan-950/40 text-cyan-100 hover:border-cyan-400/70 hover:bg-cyan-900/35 px-3 py-1.5 min-h-[36px] font-medium"
      >
        Ton aktivieren
      </button>
      {status === "ok" ? (
        <span className="text-[11px] text-emerald-400/95">Ton aktiv</span>
      ) : status === "fail" ? (
        <span className="text-[11px] text-amber-400/95">Ton konnte nicht gestartet werden</span>
      ) : null}
    </div>
  );
}
