import type { ReactNode } from "react";
import { RabbitMark, BrandWordmark } from "./RabbitMark";

type PublicTrackShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/**
 * Nur für Kund:innen-Tracking: kein Zugriff auf Werkstatt-Navigation oder interne Routen.
 */
export function PublicTrackShell({ title, subtitle, children }: PublicTrackShellProps) {
  return (
    <div className="rt-dashboard-bg -mx-4 min-h-[calc(100vh-3rem)] px-4 py-5 sm:py-6">
      <header className="flex flex-wrap items-center gap-3 mb-6 pb-4 border-b border-[#00d4ff]/25 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 pointer-events-none select-none" aria-hidden>
          <RabbitMark className="w-9 h-9 sm:w-10 sm:h-10 opacity-95" />
          <span className="hidden xs:block sm:block">
            <BrandWordmark />
          </span>
        </div>
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <h1 className="text-lg sm:text-2xl font-bold text-[#00d4ff] drop-shadow-[0_0_14px_rgba(0,212,255,0.35)] truncate">
            {title}
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      {children}
      <p className="mt-10 text-center text-[10px] text-zinc-600 max-w-md mx-auto leading-relaxed">
        Hinweis: Diese Seite dient nur der Statusabfrage. Änderungen am Auftrag und Kundendaten sind hier nicht
        möglich – dafür wenden Sie sich bitte direkt an die Werkstatt.
      </p>
    </div>
  );
}
