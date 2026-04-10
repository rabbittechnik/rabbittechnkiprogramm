import { useEffect, useState, type ReactNode } from "react";
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
  glow: string;
  border: string;
  icon: ReactNode;
}[] = [
  {
    to: "/annahme",
    label: "Reparaturannahme",
    glow: "shadow-[0_0_28px_rgba(57,255,20,0.35)]",
    border: "border-[#39ff14]/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    to: "/kunden",
    label: "Kundenkonten",
    glow: "shadow-[0_0_28px_rgba(0,150,255,0.35)]",
    border: "border-cyan-400/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Teile-Bestellung",
    glow: "shadow-[0_0_28px_rgba(255,140,50,0.4)]",
    border: "border-orange-400/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Alle Aufträge",
    glow: "shadow-[0_0_28px_rgba(0,212,255,0.35)]",
    border: "border-[#00d4ff]/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    to: "/lager",
    label: "Lager & Ersatzteile",
    glow: "shadow-[0_0_28px_rgba(180,255,80,0.35)]",
    border: "border-lime-300/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Rechnungen & Zahlungen",
    glow: "shadow-[0_0_28px_rgba(155,89,182,0.45)]",
    border: "border-violet-400/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    to: "/werkstatt",
    label: "Auftragsboard",
    glow: "shadow-[0_0_28px_rgba(100,180,255,0.4)]",
    border: "border-blue-400/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    to: "/statistik",
    label: "Statistik & Auswertung",
    glow: "shadow-[0_0_28px_rgba(0,212,255,0.3)]",
    border: "border-cyan-300/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    to: "/einstellungen",
    label: "Einstellungen",
    glow: "shadow-[0_0_28px_rgba(155,89,182,0.35)]",
    border: "border-purple-400/50",
    icon: (
      <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

function activityColor(status: string): string {
  if (status.includes("wartet") || status.includes("teile")) return "bg-[#39ff14]";
  if (status === "fertig") return "bg-amber-400";
  return "bg-[#00d4ff]";
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
    <div className="min-h-[calc(100vh-2rem)] rt-dashboard-bg -mx-4 px-4 pt-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-3">
          <RabbitMark />
          <BrandWordmark />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500 hidden sm:block">Tablet-Ansicht</span>
          <div
            className="w-11 h-11 rounded-full border-2 border-[#00d4ff]/60 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center text-sm font-semibold text-white shadow-[0_0_16px_rgba(0,212,255,0.3)]"
            title="Profil"
          >
            RT
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6 xl:gap-8">
        <div className="xl:col-span-8 space-y-4">
          <h1 className="sr-only">Hauptseite Rabbit-Technik</h1>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {tiles.map((t) => {
              const inner = (
                <>
                  <div className="text-[#00d4ff]/90 mb-2">{t.icon}</div>
                  <span className="text-sm sm:text-base font-semibold text-white text-center leading-tight">{t.label}</span>
                </>
              );
              const className = `rt-neon-tile flex flex-col items-center justify-center min-h-[120px] sm:min-h-[140px] rounded-2xl border-2 ${t.border} bg-[#0a1220]/90 ${t.glow} px-3 py-4 transition-transform active:scale-[0.98] hover:brightness-110`;
              return t.to === "#" ? (
                <button key={t.label} type="button" className={`${className} cursor-not-allowed opacity-60`} disabled title="Demnächst">
                  {inner}
                </button>
              ) : (
                <Link key={t.label} to={t.to} className={className}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="xl:col-span-4 space-y-5">
          <div className="rounded-2xl border border-[#00d4ff]/30 bg-[#0a1220]/95 p-5 shadow-[0_0_32px_rgba(0,212,255,0.12)]">
            <p className="text-lg font-semibold text-white mb-1">Willkommen zurück, Team!</p>
            <p className="text-xs text-zinc-500 mb-5">Überblick Werkstatt</p>

            <ul className="space-y-4">
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-zinc-300 text-sm">
                  <span className="w-8 h-8 rounded-lg bg-[#39ff14]/20 flex items-center justify-center text-[#39ff14]">🔧</span>
                  Offen
                </span>
                <span className="text-white font-bold">{sum?.openCount ?? "–"}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-zinc-300 text-sm">
                  <span className="w-8 h-8 rounded-lg bg-amber-400/20 flex items-center justify-center">✓</span>
                  Fertig
                </span>
                <span className="text-white font-bold">{sum?.fertigCount ?? "–"}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-zinc-300 text-sm">
                  <span className="w-8 h-8 rounded-lg bg-[#00d4ff]/20 flex items-center justify-center">€</span>
                  Umsatz heute
                </span>
                <span className="text-[#00d4ff] font-bold font-mono">
                  {sum ? `${(sum.revenueTodayCents / 100).toFixed(0)} €` : "–"}
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-violet-500/25 bg-[#0a1220]/95 p-5">
            <p className="text-sm font-semibold text-violet-300 mb-3">Aktivität</p>
            <ul className="space-y-3 text-sm text-zinc-400">
              {(sum?.recent?.length ? sum.recent : []).map((r, i) => (
                <li key={`${r.tracking_code}-${i}`} className="flex gap-2 items-start">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${activityColor(r.status)}`} />
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
              to={`/werkstatt`}
              className="block w-full text-center rounded-xl border-2 border-[#39ff14]/50 py-3 text-[#39ff14] font-semibold hover:bg-[#39ff14]/10 transition-colors"
            >
              Letzter Auftrag {sum.lastTrackingCode} in der Werkstatt
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
