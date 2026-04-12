import { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { RabbitMark, BrandWordmark } from "./RabbitMark";
import { useOfflineSync } from "../lib/useOfflineSync";

// ─── Navigation (UI Layer) ─────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: "Werkstatt",
    items: [
      { to: "/", label: "Dashboard" },
      { to: "/annahme", label: "Reparaturannahme" },
      { to: "/werkstatt", label: "Auftragsverwaltung" },
      { to: "/kunden", label: "Kundenverwaltung" },
      { to: "/track", label: "Kunden-Tracking" },
      { to: "/lager", label: "Lager & Teile" },
      { to: "/netzwerk", label: "Netzwerkeinrichtung" },
      { to: "/netzwerk-auftraege", label: "Netzwerk-Aufträge" },
    ],
  },
  {
    label: "Buchhaltung & Reports",
    items: [
      { to: "/buchhaltung-reports", label: "Übersicht" },
      { to: "/rechnungen", label: "Rechnungen & Zahlung" },
      { to: "/tagesabschluss", label: "Tagesabschluss" },
      { to: "/monatsbericht", label: "Monatsbericht" },
      { to: "/buchhaltung-erp", label: "ERP-Overlay" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/statistik", label: "Statistik" },
      { to: "/einstellungen", label: "Einstellungen" },
      { to: "/netzwerk-admin", label: "Netzwerk-Admin" },
    ],
  },
];

const FLAT_NAV = NAV_SECTIONS.flatMap((s) => s.items);

// ─── Offline-Erkennung ─────────────────────────────────────────────────────
function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

// ─── Standalone-Erkennung (PWA) ────────────────────────────────────────────
function useIsStandalone() {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    setStandalone(mq.matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    const handler = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return standalone;
}

// ─── App Shell ─────────────────────────────────────────────────────────────
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const online = useOnlineStatus();
  const standalone = useIsStandalone();
  const location = useLocation();
  const { pending, syncState, doSync } = useOfflineSync();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isHome = location.pathname === "/";
  const currentLabel = FLAT_NAV.find((n) => n.to === location.pathname)?.label;

  return (
    <div className="rt-dashboard-bg min-h-screen flex flex-col">
      {/* ── Offline-Banner ── */}
      {!online && (
        <div className="bg-amber-500/90 text-[#060b13] text-center text-xs font-semibold py-2 px-4 shrink-0">
          Keine Internetverbindung – zuletzt geladene Daten werden angezeigt
          {pending > 0 && (
            <span className="ml-2">· {pending} Aktion{pending !== 1 ? "en" : ""} warten auf Sync</span>
          )}
        </div>
      )}

      {/* ── Sync-Banner (online, Aktionen werden nachgesendet) ── */}
      {online && syncState === "syncing" && (
        <div className="bg-[#00d4ff]/90 text-[#060b13] text-center text-xs font-semibold py-2 px-4 shrink-0 flex items-center justify-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-[#060b13]/30 border-t-[#060b13] rounded-full animate-spin" />
          Synchronisiere {pending} wartende Aktion{pending !== 1 ? "en" : ""}…
        </div>
      )}
      {online && syncState === "done" && (
        <div className="bg-emerald-500/90 text-[#060b13] text-center text-xs font-semibold py-2 px-4 shrink-0">
          Alle Aktionen erfolgreich synchronisiert
        </div>
      )}
      {online && syncState === "error" && (
        <div className="bg-red-500/90 text-white text-center text-xs font-semibold py-2 px-4 shrink-0 flex items-center justify-center gap-2">
          Sync fehlgeschlagen – einige Aktionen konnten nicht gesendet werden
          <button
            type="button"
            onClick={() => void doSync()}
            className="underline ml-1 min-h-0 min-w-0"
          >
            Erneut
          </button>
        </div>
      )}

      {/* ── Persistent Header (UI Layer) – Tablet-optimiert ── */}
      <header className="shrink-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[#00d4ff]/20 bg-[#060b13]/95 backdrop-blur-sm sticky top-0 z-30">
        {/* Logo → Dashboard (großes Touch-Target) */}
        <Link
          to="/"
          className="flex items-center gap-2 sm:gap-3 rounded-xl shrink-0 p-1.5 -ml-1.5 active:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00d4ff]/60"
          title="Dashboard"
          aria-label="Rabbit Technik – Dashboard"
        >
          <RabbitMark className="w-9 h-9 sm:w-10 sm:h-10" />
          <span className="hidden sm:block">
            <BrandWordmark />
          </span>
        </Link>

        {/* Seitentitel (nur auf Unterseiten) */}
        {!isHome && currentLabel && (
          <h1 className="text-sm sm:text-lg font-semibold text-[#00d4ff] truncate ml-1">
            {currentLabel}
          </h1>
        )}

        <div className="flex-1" />

        {/* Quick Links – Tablet-Größe */}
        <Link
          to="/buchhaltung-reports"
          className="hidden sm:inline-flex items-center rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 hover:border-amber-300/50 active:scale-[0.97] transition-all whitespace-nowrap"
        >
          Buchhaltung & Reports
        </Link>

        {/* PWA-Indikator */}
        {standalone && (
          <span className="hidden sm:inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[10px] font-medium text-emerald-300 tracking-wide uppercase min-h-0 min-w-0">
            App
          </span>
        )}

        {/* Pending-Queue-Badge */}
        {pending > 0 && online && syncState === "idle" && (
          <button
            type="button"
            onClick={() => void doSync()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/50 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25 active:scale-95 transition-all min-h-0 min-w-0"
            title="Wartende Aktionen jetzt synchronisieren"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            {pending} sync
          </button>
        )}

        {/* Hamburger-Menü – großes Touch-Target */}
        <button
          type="button"
          className="p-3 -mr-1 rounded-xl border border-[#00d4ff]/30 text-white hover:bg-white/5 active:bg-[#00d4ff]/10 active:scale-[0.95] transition-all"
          aria-label="Menü"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </header>

      {/* ── Slide-over Navigation – Touch-optimiert ── */}
      {menuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm cursor-default"
            aria-label="Menü schließen"
            onClick={() => setMenuOpen(false)}
          />
          <nav className="fixed right-0 top-0 z-50 h-full w-80 max-w-[88vw] bg-[#0a1220] border-l border-[#00d4ff]/20 shadow-2xl overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <span className="text-base font-semibold text-zinc-200">Navigation</span>
              <button
                type="button"
                className="p-3 -mr-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 active:bg-white/15 active:scale-95 transition-all"
                onClick={() => setMenuOpen(false)}
                aria-label="Schließen"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {NAV_SECTIONS.map((section) => (
              <div key={section.label} className="py-2">
                <p className="px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                  {section.label}
                </p>
                {section.items.map((item) => {
                  const active = location.pathname === item.to;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center px-5 py-3.5 text-[15px] font-medium transition-colors active:bg-[#00d4ff]/15 ${
                        active
                          ? "text-[#00d4ff] bg-[#00d4ff]/10 border-r-[3px] border-[#00d4ff]"
                          : "text-zinc-200 hover:bg-white/5 hover:text-white"
                      }`}
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}

            {!online && (
              <div className="mx-5 mt-3 mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Offline – zuletzt geladene Daten sichtbar
              </div>
            )}
            {pending > 0 && (
              <div className="mx-5 mt-2 mb-5 rounded-xl border border-[#00d4ff]/30 bg-[#00d4ff]/5 px-4 py-3 text-sm text-[#7ee8ff]">
                <p className="font-medium">{pending} Aktion{pending !== 1 ? "en" : ""} warten auf Synchronisierung</p>
                <p className="text-xs text-zinc-400 mt-1">
                  {online ? "Werden automatisch gesendet" : "Wird bei Verbindung nachgeholt"}
                </p>
                {online && syncState === "idle" && (
                  <button
                    type="button"
                    onClick={() => void doSync()}
                    className="mt-2 text-xs text-[#00d4ff] underline min-h-0 min-w-0"
                  >
                    Jetzt synchronisieren
                  </button>
                )}
              </div>
            )}
          </nav>
        </>
      )}

      {/* ── Content Area (Business Layer wird hier eingefügt) ── */}
      <main key={location.pathname} className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-5 sm:py-6 rt-page-enter">
        <Outlet />
      </main>
    </div>
  );
}

// ─── Ladeindikator (Suspense-Fallback für Lazy-Loading) ────────────────────
export function PageLoadingFallback({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">{label ?? "Laden…"}</p>
      </div>
    </div>
  );
}
