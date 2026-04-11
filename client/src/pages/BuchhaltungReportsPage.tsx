import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop, fetchWorkshopBlob } from "../api";
import { RtShell } from "../components/RtShell";
import { getWorkshopToken } from "../workshopAuth";

type HubCard = {
  to: string;
  title: string;
  description: string;
  accent: "cyan" | "violet" | "amber" | "emerald" | "fuchsia";
};

const cards: HubCard[] = [
  {
    to: "/tagesabschluss",
    title: "Tagesberichte",
    description: "Historische Tagesabschlüsse, Zahlungsarten, Transaktionslisten, Kassenbestand Bar (Tagesende).",
    accent: "amber",
  },
  {
    to: "/monatsbericht",
    title: "Monatsberichte",
    description: "Kalendermonate, Umsatz nach Zahlungsarten, Rohertrag (Gewinn/Verlust aus vorhandenen Daten).",
    accent: "violet",
  },
  {
    to: "/monatsbericht",
    title: "Gewinn- / Verlustübersicht",
    description: "Im Monatsbericht: Rohertrag = Umsatz minus Teile-Einkauf; Hinweise zu fehlenden Fixkosten.",
    accent: "emerald",
  },
  {
    to: "/rechnungen",
    title: "Zahlungsübersichten",
    description: "Rechnungen, Zahlungsstatus, SumUp/Bar/Überweisung am Auftrag.",
    accent: "cyan",
  },
  {
    to: "/tagesabschluss",
    title: "Kassenbuch",
    description: "Anfangsbestand Bar und fortlaufender Kassen-Endbestand pro Kalendertag (Tagesabschluss).",
    accent: "fuchsia",
  },
];

const accentRing: Record<HubCard["accent"], string> = {
  cyan: "border-[#00d4ff]/40 hover:bg-[#00d4ff]/10",
  violet: "border-violet-400/45 hover:bg-violet-500/10",
  amber: "border-amber-400/45 hover:bg-amber-500/10",
  emerald: "border-emerald-400/40 hover:bg-emerald-500/10",
  fuchsia: "border-fuchsia-400/40 hover:bg-fuchsia-500/10",
};

const exportApis = [
  "POST /api/system/backup — Snapshot (DB + PDFs + Uploads) nach …/backups/ (Werkstatt-Token)",
  "GET /api/erp/datev/preview?from=YYYY-MM-DD&to=YYYY-MM-DD — DATEV-Vorschau",
  "GET /api/erp/datev/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD — DATEV-Buchungsstapel (CSV)",
  "GET /api/tagesabschluesse",
  "GET /api/tagesabschluesse/:YYYY-MM-DD",
  "GET /api/monatsberichte",
  "GET /api/monatsberichte/:YYYY-MM",
  "GET /api/erp/overview",
  "GET /api/erp/invoices",
  "GET /api/erp/repairs-financial",
];

function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

type DatevPreview = {
  periodFrom: string;
  periodTo: string;
  invoiceCount: number;
  totalCents: number;
  paidCents: number;
  openCents: number;
  paymentMethods: Record<string, number>;
};

function DatevExportSection() {
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(todayIso);
  const [preview, setPreview] = useState<DatevPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await fetchWorkshop<DatevPreview>(`/api/erp/datev/preview?from=${from}&to=${to}`);
      setPreview(p);
    } catch (e) {
      setErr(String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [from, to]);

  const downloadCsv = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const blob = await fetchWorkshopBlob(`/api/erp/datev/export.csv?from=${from}&to=${to}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `EXTF_Buchungsstapel_${from.replace(/-/g, "")}_${to.replace(/-/g, "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [from, to]);

  const methodLabel: Record<string, string> = {
    bar: "Bar",
    sumup: "SumUp (Karte)",
    ueberweisung: "Überweisung",
    unbekannt: "Unbekannt",
  };

  return (
    <div className="rounded-xl border border-emerald-400/40 bg-[#060b13]/90 overflow-hidden">
      <div className="px-4 py-3 border-b border-emerald-400/25 bg-[#0a1220]">
        <h2 className="text-sm font-semibold text-white tracking-wide">DATEV-Export (Buchungsstapel)</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Rechnungen, Zahlungsstatus und Buchungsdaten im DATEV-kompatiblen CSV-Format. Export ist rein lesend – keine
          Änderung an Originaldaten.
        </p>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wide">Von</span>
            <input
              type="date"
              className="block mt-1 rounded-lg border border-white/10 bg-[#0a1220] text-sm text-zinc-200 px-3 py-2 focus:border-emerald-400/50 focus:outline-none"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wide">Bis</span>
            <input
              type="date"
              className="block mt-1 rounded-lg border border-white/10 bg-[#0a1220] text-sm text-zinc-200 px-3 py-2 focus:border-emerald-400/50 focus:outline-none"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !getWorkshopToken()}
            onClick={() => void loadPreview()}
            className="rounded-lg border border-emerald-400/45 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
          >
            Vorschau
          </button>
          <button
            type="button"
            disabled={busy || !getWorkshopToken()}
            onClick={() => void downloadCsv()}
            className="rounded-lg border border-[#00d4ff]/45 bg-[#00d4ff]/10 px-4 py-2 text-xs font-semibold text-[#7ee8ff] hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-40"
          >
            CSV herunterladen
          </button>
        </div>

        {!getWorkshopToken() && (
          <p className="text-xs text-amber-300">
            Werkstatt-Anmeldung erforderlich. Bitte zuerst unter{" "}
            <Link to="/buchhaltung-erp" className="underline">
              Buchhaltung / ERP
            </Link>{" "}
            anmelden.
          </p>
        )}

        {err && <p className="text-xs text-red-400">{err}</p>}

        {preview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="rounded-lg border border-white/10 bg-[#0a1220] p-3">
              <p className="text-[10px] text-zinc-500 uppercase">Rechnungen</p>
              <p className="text-lg font-mono text-emerald-300">{preview.invoiceCount}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0a1220] p-3">
              <p className="text-[10px] text-zinc-500 uppercase">Gesamt</p>
              <p className="text-lg font-mono text-white">{euro(preview.totalCents)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0a1220] p-3">
              <p className="text-[10px] text-zinc-500 uppercase">Bezahlt</p>
              <p className="text-lg font-mono text-emerald-300">{euro(preview.paidCents)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0a1220] p-3">
              <p className="text-[10px] text-zinc-500 uppercase">Offen</p>
              <p className="text-lg font-mono text-amber-200">{euro(preview.openCents)}</p>
            </div>
          </div>
        )}

        {preview && Object.keys(preview.paymentMethods).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(preview.paymentMethods).map(([m, c]) => (
              <span key={m} className="rounded-full border border-white/10 bg-[#0a1220] px-3 py-1 text-[11px] text-zinc-400">
                {methodLabel[m] ?? m}: <span className="text-zinc-200 font-mono">{euro(c)}</span>
              </span>
            ))}
          </div>
        )}

        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Das CSV folgt dem DATEV-Buchungsstapel-Format (EXTF, Semikolon-getrennt, UTF-8 mit BOM). Konten konfigurierbar
          über Umgebungsvariablen (siehe <code className="text-zinc-500">server/.env.example</code>: RABBIT_DATEV_*).
          Import: DATEV Unternehmen online → Belege → Buchungsstapel importieren.
        </p>
      </div>
    </div>
  );
}

export function BuchhaltungReportsPage() {
  return (
    <RtShell
      title="Buchhaltung & Reports"
      subtitle="Navigation zu Tages- und Monatsauswertungen, Zahlungen und Export-Schnittstellen"
      actions={
        <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          Hauptseite
        </Link>
      }
    >
      <div className="max-w-5xl mx-auto space-y-8">
        <p className="text-sm text-zinc-400 leading-relaxed border-l-2 border-[#00d4ff]/40 pl-4">
          Die folgenden Bereiche nutzen die Werkstatt-Anmeldung, sobald Daten angezeigt werden. Lesende ERP-Ansicht und
          JSON-Exporte: gleiches Passwort wie bei Aufträgen und Rechnungen. Produktion: Volume z. B. auf{" "}
          <code className="text-xs text-zinc-500">/data</code> mounten und{" "}
          <code className="text-xs text-zinc-500">RABBIT_DATA_DIR=/data</code> setzen – dann bleiben DB und Dateien bei
          Deploys erhalten; zusätzlich legt der Server periodische Snapshots unter{" "}
          <code className="text-xs text-zinc-500">backups/</code> an (siehe server/.env.example).
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {cards.map((c) => (
            <Link
              key={`${c.to}-${c.title}`}
              to={c.to}
              className={`block rounded-xl border bg-[#060b13]/90 p-4 transition-colors ${accentRing[c.accent]}`}
            >
              <h2 className="text-base font-semibold text-white mb-2">{c.title}</h2>
              <p className="text-xs text-zinc-500 leading-relaxed">{c.description}</p>
              <p className="text-xs text-[#00d4ff] mt-3 font-medium">Öffnen →</p>
            </Link>
          ))}
        </div>

        <DatevExportSection />

        <div className="rounded-xl border border-white/10 bg-[#060b13]/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-[#0a1220]">
            <h2 className="text-sm font-semibold text-white tracking-wide">Exportfunktionen (API)</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Rohdaten für eigene Auswertungen (z. B. Excel/Power BI): mit Werkstatt-Login{" "}
              <code className="text-[10px] text-zinc-400">Authorization: Bearer …</code> aufrufen oder im Browser nach
              Anmeldung unter den jeweiligen Seiten nutzen.
            </p>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-xs text-zinc-500 mb-2">
              Zusätzlich: Übersicht der Endpunkte unter{" "}
              <Link to="/buchhaltung-erp" className="text-[#00d4ff] hover:underline">
                Buchhaltung / ERP-Overlay
              </Link>
              .
            </p>
            <ul className="font-mono text-[11px] text-zinc-400 space-y-1.5">
              {exportApis.map((line) => (
                <li key={line} className="break-all">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </RtShell>
  );
}
