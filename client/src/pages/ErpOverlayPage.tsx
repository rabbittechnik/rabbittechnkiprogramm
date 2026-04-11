import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type Overview = {
  layer: string;
  readOnly: boolean;
  customers: { count: number };
  invoices: { count: number };
  repairs: { count: number };
  totals: { paidCents: number; openReceivablesCents: number };
};

function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function ErpOverlayPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const o = await fetchWorkshop<Overview>("/api/erp/overview");
      setData(o);
    } catch (e) {
      setErr(String(e));
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (gate === "ok") void load();
  }, [gate, load]);

  if (gate === "loading") {
    return (
      <RtShell title="Buchhaltung / ERP" subtitle="Lesender Überblick">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Buchhaltung / ERP" subtitle="Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <p className="text-sm text-zinc-400">Werkstatt-Passwort wie bei Aufträgen und Rechnungen.</p>
            <input
              type="password"
              className="rt-input-neon w-full"
              placeholder="Passwort"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              autoComplete="current-password"
            />
            {loginErr && <p className="text-sm text-red-400">{loginErr}</p>}
            <button type="submit" className="rt-btn-confirm w-full min-h-[48px]">
              Anmelden
            </button>
          </form>
        </div>
      </RtShell>
    );
  }

  return (
    <RtShell
      title="Buchhaltung / ERP-Overlay"
      subtitle="Nur Lesen · gleiche Datenbasis wie Werkstatt & Rechnungen"
      actions={
        <div className="flex flex-wrap gap-2 items-center">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            Start
          </Link>
          <Link to="/rechnungen" className="text-xs text-[#39ff14] hover:underline">
            Rechnungen (klassisch)
          </Link>
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 mb-6">
        <strong className="font-semibold">Hinweis:</strong> Dieser Bereich ist ein zusätzlicher ERP-/Reporting-Layer.
        Es werden <strong>keine</strong> neuen Kern-Datenbanken angelegt und <strong>keine</strong> bestehenden Module
        ersetzt – nur lesende API (<code className="text-xs text-zinc-400">/api/erp/*</code>) auf Kunden, Aufträge,
        Rechnungen und Zahlungsfelder.
      </div>

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}

      {data && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="rt-panel rt-panel-cyan p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Kunden</p>
            <p className="text-2xl font-mono text-[#00d4ff]">{data.customers.count}</p>
          </div>
          <div className="rt-panel rt-panel-violet p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Rechnungen (Datensätze)</p>
            <p className="text-2xl font-mono text-violet-200">{data.invoices.count}</p>
          </div>
          <div className="rt-panel rt-panel-cyan p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Aufträge gesamt</p>
            <p className="text-2xl font-mono text-[#7ee8ff]">{data.repairs.count}</p>
          </div>
          <div className="rt-panel rt-panel-violet p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Offene Forderungen (fertig/abgeholt)</p>
            <p className="text-xl font-mono text-amber-200">{euro(data.totals.openReceivablesCents)}</p>
          </div>
        </div>
      )}

      {data && (
        <div className="rt-panel rt-panel-violet p-4 mb-6">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Bereits bezahlt (Summe Aufträge)</p>
          <p className="text-2xl font-mono text-emerald-300">{euro(data.totals.paidCents)}</p>
        </div>
      )}

      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100 mb-6">
        <strong className="font-semibold">DATEV-Export:</strong>{" "}
        Buchungsstapel (Rechnungen, Zahlungsstatus, Buchungsdaten) als CSV –{" "}
        <Link to="/buchhaltung-reports" className="underline text-emerald-200 hover:text-white">
          Buchhaltung &amp; Reports → DATEV-Export
        </Link>
        {" "}oder direkt: <code className="text-xs text-zinc-400">GET /api/erp/datev/export.csv?from=…&amp;to=…</code>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#060b13]/80 p-4 text-sm text-zinc-400 space-y-2">
        <p className="text-zinc-300 font-medium text-white">API-Endpunkte (Export/Reporting)</p>
        <ul className="list-disc list-inside space-y-1 font-mono text-xs text-zinc-500">
          <li>GET /api/erp/overview</li>
          <li>GET /api/erp/customers</li>
          <li>GET /api/erp/invoices</li>
          <li>GET /api/erp/repairs-financial</li>
          <li>GET /api/erp/datev/preview?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</li>
          <li>GET /api/erp/datev/export.csv?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</li>
          <li>
            GET /api/tagesabschluesse · GET /api/tagesabschluesse/:datum · GET/PUT
            /api/tagesabschluesse/kasse/eroeffnungsbestand
          </li>
          <li>GET /api/monatsberichte · GET /api/monatsberichte/:YYYY-MM</li>
        </ul>
        <button type="button" className="rt-btn-confirm text-sm mt-3" onClick={() => void load()}>
          Kennzahlen aktualisieren
        </button>
      </div>
    </RtShell>
  );
}
