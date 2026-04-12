import { useCallback, useEffect, useRef, useState } from "react";
import { enableRepairNotificationSoundFromUserClick } from "../hooks/useNewRepairNotification";
import {
  getRepairNotificationSoundId,
  REPAIR_SOUND_OPTIONS,
  setRepairNotificationSoundId,
} from "../lib/repairNotificationSounds";

/**
 * Klingelton wählen (pro Gerät, localStorage) + „Ton aktivieren“ für Browser-Autoplay.
 */
export function RepairSoundEnableButton() {
  const [soundId, setSoundId] = useState(getRepairNotificationSoundId);
  const [status, setStatus] = useState<"idle" | "ok" | "fail">("idle");
  const clearTimer = useRef<number | null>(null);

  const onSoundChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setRepairNotificationSoundId(v);
    setSoundId(v);
  }, []);

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
      <label className="flex items-center gap-2 text-[11px] text-zinc-400 whitespace-nowrap">
        <span className="hidden sm:inline">Klingelton</span>
        <select
          value={soundId}
          onChange={onSoundChange}
          className="rt-input-neon text-xs py-2 px-2 min-h-[40px] max-w-[200px] sm:max-w-[240px] truncate bg-[#060b13]/90 border border-cyan-500/35 rounded-lg text-cyan-100"
        >
          {REPAIR_SOUND_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onClick}
        className="text-xs rounded-lg border border-cyan-500/45 bg-cyan-950/40 text-cyan-100 hover:border-cyan-400/70 hover:bg-cyan-900/35 px-3 py-1.5 min-h-[40px] font-medium"
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
