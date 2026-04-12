import { useMemo, useState } from "react";
import { slugForNetworkDeviceImage } from "../lib/networkDeviceImage";

type Props = {
  model: string;
  type: "router" | "repeater";
  className?: string;
};

/** Kompakte Vorschau: zuerst lokales Bild (offline nach erstem Laden), sonst vektor-Fallback. */
export function NetworkDeviceThumb({ model, type, className = "" }: Props) {
  const slug = useMemo(() => slugForNetworkDeviceImage(model), [model]);
  const candidates = useMemo(
    () => [`/network-devices/${slug}.webp`, `/network-devices/${slug}.png`, `/network-devices/${slug}.svg`],
    [slug]
  );
  const [idx, setIdx] = useState(0);

  const box = `shrink-0 h-[4.5rem] w-[5.25rem] rounded-lg border border-zinc-600/50 bg-zinc-900/80 overflow-hidden flex items-center justify-center ${className}`;

  if (idx >= candidates.length) {
    return (
      <div className={box} aria-hidden>
        <DeviceFallbackSvg type={type} />
      </div>
    );
  }

  return (
    <div className={box}>
      <img
        src={candidates[idx]}
        alt=""
        className="max-h-full max-w-full object-contain p-1"
        loading="lazy"
        decoding="async"
        onError={() => setIdx((i) => i + 1)}
      />
    </div>
  );
}

function DeviceFallbackSvg({ type }: { type: "router" | "repeater" }) {
  if (type === "repeater") {
    return (
      <svg viewBox="0 0 64 64" className="h-full w-full p-2" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="22" width="44" height="28" rx="5" fill="#1e293b" stroke="#a78bfa" strokeWidth="1.5" />
        <path d="M22 18v6M32 14v10M42 18v6" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="22" cy="36" r="2" fill="#22d3ee" opacity="0.9" />
        <circle cx="32" cy="36" r="2" fill="#22d3ee" opacity="0.6" />
        <circle cx="42" cy="36" r="2" fill="#22d3ee" opacity="0.35" />
        <rect x="24" y="44" width="16" height="3" rx="1" fill="#475569" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full p-2" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="20" width="48" height="32" rx="4" fill="#1e293b" stroke="#22d3ee" strokeWidth="1.5" />
      <path d="M16 20V12M32 20V8M48 20V12" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="14" y="26" width="36" height="18" rx="2" fill="#0f172a" stroke="#334155" strokeWidth="0.8" />
      <circle cx="24" cy="35" r="2.5" fill="#22d3ee" opacity="0.35" />
      <circle cx="32" cy="35" r="2.5" fill="#22d3ee" opacity="0.55" />
      <circle cx="40" cy="35" r="2.5" fill="#22d3ee" opacity="0.85" />
      <rect x="22" y="46" width="20" height="3" rx="1" fill="#475569" />
    </svg>
  );
}
