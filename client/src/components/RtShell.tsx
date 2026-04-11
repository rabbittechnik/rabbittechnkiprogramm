import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { RabbitMark, BrandWordmark } from "./RabbitMark";

const NAV = [
  { to: "/", label: "Hauptseite" },
  { to: "/annahme", label: "Reparaturannahme" },
  { to: "/werkstatt", label: "Auftragsverwaltung" },
  { to: "/rechnungen", label: "Rechnungen & Zahlung" },
  { to: "/kunden", label: "Kundenverwaltung" },
  { to: "/track", label: "Kunden-Tracking" },
  { to: "/lager", label: "Lager & Teile" },
  { to: "/statistik", label: "Statistik" },
  { to: "/einstellungen", label: "Einstellungen" },
];

type RtShellProps = {
  title: string;
  children: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
};

export function RtShell({ title, subtitle, children, actions }: RtShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="rt-dashboard-bg -mx-4 min-h-[calc(100vh-3rem)] px-4 py-5 sm:py-6">
      <header className="flex flex-wrap items-center gap-3 mb-6 pb-4 border-b border-[#00d4ff]/25 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link to="/" className="flex items-center gap-2 sm:gap-3">
            <RabbitMark className="w-9 h-9 sm:w-10 sm:h-10" />
            <span className="hidden xs:block sm:block">
              <BrandWordmark />
            </span>
          </Link>
        </div>
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <h1 className="text-lg sm:text-2xl font-bold text-[#00d4ff] drop-shadow-[0_0_14px_rgba(0,212,255,0.35)] truncate">
            {title}
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          {actions}
          <div className="relative">
            <button
              type="button"
              className="p-2.5 rounded-xl border border-[#00d4ff]/35 text-white hover:bg-white/5 shadow-[0_0_16px_rgba(0,212,255,0.15)]"
              aria-label="Menü"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default bg-black/50"
                  aria-label="Schließen"
                  onClick={() => setMenuOpen(false)}
                />
                <nav className="absolute right-0 top-full z-50 mt-2 w-56 max-h-[70vh] overflow-y-auto rounded-xl border border-[#00d4ff]/35 bg-[#0a1220] py-2 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                  {NAV.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="block px-4 py-2.5 text-sm text-zinc-200 hover:bg-[#00d4ff]/10 hover:text-[#00d4ff]"
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
