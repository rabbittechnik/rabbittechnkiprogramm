import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import { RabbitMark, BrandWordmark } from "../components/RabbitMark";

type Summary = {
  openCount: number;
  fertigCount: number;
  revenueTodayCents: number;
  recent: { tracking_code: string; status: string; updated_at: string }[];
  lastTrackingCode: string | null;
};

const tiles: {
  to: string;
  label: string;
  glowRgb: string;
  border: string;
  iconWrap: string;
  icon: ReactNode;
}[] = [
  {
    to: "/annahme",
    label: "Reparaturannahme",
    glowRgb: "57, 255, 20",
    border: "border-[#39ff14]/55",
    iconWrap: "from-[#39ff14]/25 to-[#39ff14]/5 text-[#b8ff9a] shadow-[0_0_20px_rgba(57,255,20,0.35)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    to: "/kunden",
    label: "Kundenkonten",
    glowRgb: "0, 180, 255",
    border: "border-cyan-400/55",
    iconWrap: "from-cyan-400/25 to-cyan-500/5 text-cyan-200 shadow-[0_0_20px_rgba(0,180,255,0.35)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Teile-Bestellung",
    glowRgb: "255, 160, 60",
    border: "border-amber-400/55",
    iconWrap: "from-amber-400/30 to-orange-500/5 text-amber-200 shadow-[0_0_20px_rgba(255,160,60,0.4)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Alle Aufträge",
    glowRgb: "0, 212, 255",
    border: "border-[#00d4ff]/55",
    iconWrap: "from-[#00d4ff]/25 to-cyan-600/5 text-cyan-100 shadow-[0_0_20px_rgba(0,212,255,0.38)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    to: "/lager",
    label: "Lager & Ersatzteile",
    glowRgb: "180, 255, 80",
    border: "border-lime-300/55",
    iconWrap: "from-lime-300/25 to-lime-500/5 text-lime-100 shadow-[0_0_20px_rgba(180,255,80,0.35)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
  },
  {
    to: "/rechnungen",
    label: "Rechnungen & Zahlungen",
    glowRgb: "180, 100, 255",
    border: "border-violet-400/55",
    iconWrap: "from-violet-400/30 to-fuchsia-600/5 text-violet-100 shadow-[0_0_22px_rgba(180,100,255,0.42)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Auftragsboard",
    glowRgb: "100, 180, 255",
    border: "border-blue-400/55",
    iconWrap: "from-blue-400/25 to-blue-600/5 text-blue-100 shadow-[0_0_20px_rgba(100,180,255,0.4)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    to: "/statistik",
    label: "Statistik & Auswertung",
    glowRgb: "0, 220, 200",
    border: "border-teal-300/55",
    iconWrap: "from-teal-300/25 to-cyan-500/5 text-teal-100 shadow-[0_0_20px_rgba(0,220,200,0.35)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    to: "/einstellungen",
    label: "Einstellungen",
    glowRgb: "180, 80, 220",
    border: "border-purple-400/55",
    iconWrap: "from-purple-400/30 to-fuchsia-700/5 text-purple-100 shadow-[0_0_20px_rgba(180,80,220,0.38)]",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

function activityColor(status: string): string {
  if (status.includes("wartet") || status.includes("teile")) return "bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.7)]";
  if (status === "fertig") return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
  return "bg-[#00d4ff] shadow-[0_0_8px_rgba(0,212,255,0.6)]";
}

function HeroHeader() {
  return (
    <div className="relative w-full mb-8 sm:mb-10">
      <div className="flex justify-end items-center gap-3 mb-5 sm:mb-0 sm:absolute sm:right-0 sm:top-0 sm:z-20">
        <span className="text-xs font-hud uppercase tracking-wider text-zinc-500 hidden sm:inline">Tablet</span>
        <div
          className="w-12 h-12 rounded-full border-2 border-[#00d4ff]/70 bg-gradient-to-br from-zinc-600 to-zinc-900 flex items-center justify-center text-sm font-bold text-white shadow-[0_0_22px_rgba(0,212,255,0.45)] ring-2 ring-[#00d4ff]/20 animate-line-glow"
          title="Profil"
        >
          RT
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 sm:gap-6 w-full max-w-3xl mx-auto px-2 pt-1">
        <div className="hidden sm:flex flex-1 items-center justify-end min-w-0 gap-0">
          <div className="h-[3px] flex-1 max-w-[200px] rounded-full bg-gradient-to-r from-transparent via-[#00d4ff] to-[#00d4ff] shadow-[0_0_14px_rgba(0,212,255,0.85)] animate-line-glow origin-right -skew-x-12" />
          <div
            className="w-0 h-0 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent border-l-[12px] border-l-[#00d4ff] -ml-px drop-shadow-[0_0_10px_rgba(0,212,255,0.9)]"
            aria-hidden
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 shrink-0">
          <RabbitMark className="w-14 h-14 sm:w-16 sm:h-16 drop-shadow-[0_0_24px_rgba(255,255,255,0.35)]" />
          <BrandWordmark className="text-center" />
        </div>

        <div className="hidden sm:flex flex-1 items-center justify-start min-w-0 gap-0">
          <div
            className="w-0 h-0 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent border-r-[12px] border-r-[#00d4ff] -mr-px drop-shadow-[0_0_10px_rgba(0,212,255,0.9)]"
            aria-hidden
          />
          <div className="h-[3px] flex-1 max-w-[200px] rounded-full bg-gradient-to-l from-transparent via-[#00d4ff] to-[#00d4ff] shadow-[0_0_14px_rgba(0,212,255,0.85)] animate-line-glow origin-left skew-x-12" />
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const [sum, setSum] = useState<Summary | null>(null);

  useEffect(() => {
    fetchJson<Summary>("/api/dashboard/summary")
      .then(setSum)
      .catch(() =>
        setSum({
          openCount: 0,
          fertigCount: 0,
          revenueTodayCents: 0,
          recent: [],
          lastTrackingCode: null,
        })
      );
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-2rem)] rt-dashboard-bg -mx-4 px-4 pt-4 pb-10 overflow-hidden">
      <div className="rt-home-scanline pointer-events-none" aria-hidden />
      <div className="relative z-10">
        <header className="max-w-[1400px] mx-auto">
          <HeroHeader />
        </header>

        <div className="max-w-[1400px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6 xl:gap-8">
          <div className="xl:col-span-8 space-y-4">
            <h1 className="sr-only">Hauptseite Rabbit-Technik</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {tiles.map((t, i) => {
                const tileStyle = {
                  ["--tile-glow-rgb"]: t.glowRgb,
                  animationDelay: `${i * 0.12}s`,
                } as CSSProperties;

                const inner = (
                  <>
                    <div
                      className={`mb-3 flex h-[4.25rem] w-[4.25rem] sm:h-16 sm:w-16 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-white/10 ${t.iconWrap}`}
                    >
                      {t.icon}
                    </div>
                    <span className="text-sm sm:text-base font-hud font-semibold text-white text-center leading-tight tracking-wide drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]">
                      {t.label}
                    </span>
                  </>
                );

                const className = `rt-neon-tile animate-neon-breathe flex flex-col items-center justify-center min-h-[128px] sm:min-h-[148px] rounded-2xl border-2 ${t.border} bg-[#0a1220]/92 px-3 py-4 transition-transform active:scale-[0.98]`;

                return t.to === "#" ? (
                  <button
                    key={t.label}
                    type="button"
                    style={tileStyle}
                    className={`${className} cursor-not-allowed opacity-60`}
                    disabled
                    title="Demnächst"
                  >
                    {inner}
                  </button>
                ) : (
                  <Link key={t.label} to={t.to} style={tileStyle} className={className}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>

          <aside className="xl:col-span-4 space-y-5 font-hud">
            <div className="rounded-2xl border-2 border-[#00d4ff]/45 bg-[#060d18]/95 p-5 shadow-[0_0_40px_rgba(0,212,255,0.22),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
              <p className="text-lg font-semibold text-white mb-0.5 tracking-wide drop-shadow-[0_0_12px_rgba(255,255,255,0.2)]">
                Willkommen zurück, Mathias!
              </p>
              <p className="text-xs text-zinc-500 mb-5 uppercase tracking-widest">Überblick Werkstatt</p>

              <ul className="space-y-4">
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-3 text-zinc-300 text-sm">
                    <span className="w-10 h-10 rounded-xl bg-[#39ff14]/15 border border-[#39ff14]/40 flex items-center justify-center text-[#39ff14] text-lg shadow-[0_0_16px_rgba(57,255,20,0.25)]">
                      🔧
                    </span>
                    <span>
                      Offen
                      <span className="block text-[10px] text-zinc-500 uppercase tracking-wider">Reparaturen</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-white font-bold text-lg">
                    {sum?.openCount ?? "–"}
                    <span className="text-[#39ff14]/80 text-sm" aria-hidden>
                      ›
                    </span>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-3 text-zinc-300 text-sm">
                    <span className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-300 text-lg shadow-[0_0_16px_rgba(251,191,36,0.2)]">
                      ✓
                    </span>
                    <span>
                      Fertig
                      <span className="block text-[10px] text-zinc-500 uppercase tracking-wider">Geräte</span>
                    </span>
                  </span>
                  <span className="text-white font-bold text-lg">{sum?.fertigCount ?? "–"}</span>
                </li>
                <li className="mt-4 pt-4 border-t border-[#00d4ff]/20 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-3 text-zinc-300 text-sm">
                    <span className="w-12 h-12 rounded-xl bg-[#00d4ff]/15 border border-[#00d4ff]/45 flex items-center justify-center text-[#00d4ff] text-xl font-bold shadow-[0_0_20px_rgba(0,212,255,0.35)]">
                      €
                    </span>
                    <span className="leading-tight">
                      Umsatz heute
                      <span className="block text-[10px] text-zinc-500 uppercase tracking-wider">Live</span>
                    </span>
                  </span>
                  <span className="text-[#00d4ff] font-bold font-mono text-xl drop-shadow-[0_0_12px_rgba(0,212,255,0.5)]">
                    {sum ? `${(sum.revenueTodayCents / 100).toFixed(0)} €` : "–"}
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border-2 border-violet-500/35 bg-[#060d18]/95 p-5 shadow-[0_0_28px_rgba(139,92,246,0.15),inset_0_1px_0_rgba(255,255,255,0.05)]">
              <p className="text-xs font-semibold text-violet-300 mb-3 tracking-widest uppercase">Aktivität</p>
              <ul className="space-y-3 text-sm text-zinc-400">
                {(sum?.recent?.length ? sum.recent : []).map((r, i) => (
                  <li key={`${r.tracking_code}-${i}`} className="flex gap-3 items-start">
                    <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${activityColor(r.status)}`} />
                    <span>
                      Auftrag <span className="text-zinc-200 font-mono">{r.tracking_code}</span> – {r.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
                {!sum?.recent?.length && <li className="text-zinc-600">Noch keine Aktivität.</li>}
              </ul>
            </div>

            {sum?.lastTrackingCode && (
              <Link
                to="/werkstatt"
                className="block w-full text-center rounded-xl border-2 border-[#39ff14]/60 py-3.5 text-[#b8ff9a] font-semibold bg-[#39ff14]/5 hover:bg-[#39ff14]/15 transition-colors animate-cta-pulse shadow-[0_0_24px_rgba(57,255,20,0.25)]"
              >
                Letzter Auftrag #{sum.lastTrackingCode} ansehen →
              </Link>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
