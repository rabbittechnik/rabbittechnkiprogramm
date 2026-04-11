import type { ReactNode } from "react";

type RtShellProps = {
  title: string;
  children: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
};

/**
 * Page-level content wrapper (Business Layer).
 *
 * Header + Navigation + Menü „Buchhaltung & Reports" kommen jetzt aus der
 * persistenten AppShell (UI Layer). RtShell rendert nur noch den Seiteninhalt
 * mit Titel-Leiste und optionalen Aktionen.
 */
export function RtShell({ title, subtitle, children, actions }: RtShellProps) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6 pb-4 border-b border-[#00d4ff]/20">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold text-[#00d4ff] drop-shadow-[0_0_14px_rgba(0,212,255,0.35)] truncate">
            {title}
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 sm:gap-3 ml-auto flex-wrap justify-end">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
