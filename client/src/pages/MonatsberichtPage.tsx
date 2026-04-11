import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { formatDeBerlin } from "../lib/formatBerlin";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type ReportRow = {
  id: string;
  year_month: string;
  generated_at: string;
  total_cents: number;
  bar_cents: number;
  online_sumup_cents: number;
  tap_to_pay_cents: number;
  ueberweisung_cents: number;
  other_cents: number;
  invoice_count: number;
  transaction_count: number;
  parts_purchase_cents: number;
  gross_profit_cents: number;
};

type Overview = {
  daily_from_closings: Record<string, number>;
  hinweis: string;
};

type Tx = {
  repair_id: string;
  tracking_code: string;
  customer_name: string | null;
  total_cents: number;
  payment_method: string | null;
  sumup_channel: string | null;
  payment_paid_at: string | null;
  invoice_number: string | null;
};

function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function payLabel(m: string | null, ch: string | null): string {
  const p = (m ?? "").trim();
  const c = (ch ?? "").trim().toLowerCase();
  if (p === "bar") return "Bar";
  if (p === "ueberweisung") return "Überweisung";
  if (p === "sumup") {
    if (c === "tap_to_pay" || c === "terminal") return "SumUp Tap to Pay";
    return "Online (SumUp)";
  }
  return p || "—";
}

export function MonatsberichtPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [list, setList] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<(ReportRow & { overview: Overview; transactions: Tx[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setErr(null);
    try {
      const d = await fetchWorkshop<{ reports: ReportRow[] }>("/api/monatsberichte");
      setList(d.reports);
      setSelected((prev) => {
        if (prev && d.reports.some((r) => r.year_month === prev)) return prev;
        return d.reports[0]?.year_month ?? null;
      });
    } catch (e) {
      setErr(String(e));
      setList([]);
    }
  }, []);

  const loadDetail = useCallback(async (ym: string) => {
    setErr(null);
    try {
      const d = await fetchWorkshop<ReportRow & { overview: Overview; transactions: Tx[] }>(
        `/api/monatsberichte/${encodeURIComponent(ym)}`
      );
      setDetail(d);
    } catch (e) {
      setDetail(null);
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    if (gate === "ok") void loadList();
  }, [gate, loadList]);

  useEffect(() => {
    if (gate === "ok" && selected) void loadDetail(selected);
  }, [gate, selected, loadDetail]);

  if (gate === "loading") {
    return (
      <RtShell title="Monatsbericht">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Monatsbericht" subtitle="Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <p className="text-sm text-zinc-400">Werkstatt-Passwort.</p>
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

  const dailyRows =
    detail?.overview?.daily_from_closings != null
      ? Object.entries(detail.overview.daily_from_closings).sort(([a], [b]) => a.localeCompare(b))
      : [];

  return (
    <RtShell
      title="Monatsbericht (Gewinn / Verlust)"
      subtitle="Kalendermonat Europe/Berlin · automatisch kurz nach Monatswechsel (Berlin 00:00 Uhr, gleicher Job wie Tagesabschluss)"
      actions={
        <div className="flex flex-wrap gap-2 items-center">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            Start
          </Link>
          <Link to="/tagesabschluss" className="text-xs text-[#00d4ff] hover:underline">
            Tagesabschluss
          </Link>
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
          Der Bericht umfasst alle <strong>bezahlten</strong> Aufträge mit Zahlungseingang im Monat (
          <code className="text-xs text-zinc-400">payment_paid_at</code> in Berlin). Rohertrag = Umsatz − Teile-Einkauf (
          <code className="text-xs text-zinc-400">purchase_cents</code>). Die Tagesaufteilung stammt aus den
          gespeicherten Tagesabschlüssen, soweit vorhanden.
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}

        <button type="button" className="rt-btn-confirm text-sm" onClick={() => void loadList()}>
          Liste aktualisieren
        </button>

        <div className="grid lg:grid-cols-[220px_1fr] gap-6">
          <div className="rt-panel rt-panel-violet p-3 max-h-[70vh] overflow-y-auto">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Monat</p>
            <ul className="space-y-1">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.year_month)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
                      selected === r.year_month
                        ? "bg-violet-500/25 text-violet-100 border border-violet-400/40"
                        : "text-zinc-400 hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    {r.year_month}
                    <span className="block text-[10px] text-zinc-500 font-sans">{euro(r.total_cents)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p className="text-xs text-zinc-500">Noch keine Monatsberichte.</p>}
          </div>

          {detail && (
            <div className="space-y-4">
              <div className="rt-panel rt-panel-cyan p-4">
                <h2 className="text-lg font-semibold text-white mb-1 font-mono">{detail.year_month}</h2>
                <p className="text-xs text-zinc-500 mb-4">
                  erzeugt {detail.generated_at ? formatDeBerlin(String(detail.generated_at)) : "—"}
                </p>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm mb-4">
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Monatsumsatz</p>
                    <p className="text-2xl font-mono text-emerald-300">{euro(detail.total_cents)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Anzahl Vorgänge / mit Rechnungsnr.</p>
                    <p className="text-xl font-mono text-cyan-200">
                      {detail.transaction_count} / {detail.invoice_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Wareneinsatz Teile</p>
                    <p className="text-xl font-mono text-amber-200">{euro(detail.parts_purchase_cents)}</p>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3 rounded-lg border border-white/10 bg-[#060b13]/80 p-3">
                    <p className="text-zinc-500 text-xs uppercase mb-1">Rohertrag (vereinfacht)</p>
                    <p
                      className={`text-2xl font-mono ${detail.gross_profit_cents >= 0 ? "text-emerald-300" : "text-red-400"}`}
                    >
                      {euro(detail.gross_profit_cents)}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Einnahmen nach Zahlungsarten</p>
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-zinc-400">Bar</span>
                    <span className="font-mono text-amber-200">{euro(detail.bar_cents)}</span>
                  </div>
                  <div className="flex justify-between border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-zinc-400">Online (SumUp)</span>
                    <span className="font-mono text-cyan-200">{euro(detail.online_sumup_cents)}</span>
                  </div>
                  <div className="flex justify-between border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-zinc-400">SumUp Tap to Pay</span>
                    <span className="font-mono text-fuchsia-200">{euro(detail.tap_to_pay_cents)}</span>
                  </div>
                  <div className="flex justify-between border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-zinc-400">Überweisung</span>
                    <span className="font-mono text-zinc-300">{euro(detail.ueberweisung_cents)}</span>
                  </div>
                  {detail.other_cents > 0 && (
                    <div className="sm:col-span-2 flex justify-between border border-white/10 rounded-lg px-3 py-2">
                      <span className="text-zinc-400">Sonstige</span>
                      <span className="font-mono text-zinc-400">{euro(detail.other_cents)}</span>
                    </div>
                  )}
                </div>
              </div>

              {detail.overview?.hinweis && (
                <p className="text-xs text-zinc-500 leading-relaxed border-l-2 border-zinc-600 pl-3">{detail.overview.hinweis}</p>
              )}

              <div className="rounded-xl border border-white/10 overflow-hidden">
                <p className="text-xs text-zinc-500 uppercase tracking-wide px-4 py-2 bg-[#060b13] border-b border-white/10">
                  Monatsübersicht (Umsatz pro Kalendertag aus Tagesabschluss)
                </p>
                <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-zinc-500 text-xs uppercase sticky top-0 bg-[#0a1220] border-b border-white/10">
                      <tr>
                        <th className="p-2">Tag</th>
                        <th className="p-2 text-right">Umsatz (Tagesabschluss)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map(([day, cents]) => (
                        <tr key={day} className="border-b border-white/5">
                          <td className="p-2 font-mono text-xs">{day}</td>
                          <td className="p-2 text-right font-mono">{euro(cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {dailyRows.length === 0 && <p className="p-4 text-center text-zinc-500 text-sm">Keine Tagesdaten.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 overflow-hidden">
                <p className="text-xs text-zinc-500 uppercase tracking-wide px-4 py-2 bg-[#060b13] border-b border-white/10">
                  Transaktionen ({detail.transactions.length})
                </p>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-sm min-w-[720px]">
                    <thead className="text-zinc-500 text-xs uppercase sticky top-0 bg-[#0a1220] border-b border-white/10">
                      <tr>
                        <th className="p-2">Bezahlt</th>
                        <th className="p-2">Tracking</th>
                        <th className="p-2">Kunde</th>
                        <th className="p-2">Zahlungsart</th>
                        <th className="p-2 font-mono">Rechnung</th>
                        <th className="p-2 text-right">Betrag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.transactions.map((t) => (
                        <tr key={`${t.repair_id}-${t.payment_paid_at}`} className="border-b border-white/5">
                          <td className="p-2 text-xs text-zinc-400 whitespace-nowrap">
                            {t.payment_paid_at ? formatDeBerlin(t.payment_paid_at) : "—"}
                          </td>
                          <td className="p-2 font-mono text-xs">{t.tracking_code}</td>
                          <td className="p-2 text-zinc-300 max-w-[120px] truncate" title={t.customer_name ?? ""}>
                            {t.customer_name ?? "—"}
                          </td>
                          <td className="p-2 text-xs">{payLabel(t.payment_method, t.sumup_channel)}</td>
                          <td className="p-2 font-mono text-xs text-[#00d4ff]">{t.invoice_number ?? "—"}</td>
                          <td className="p-2 text-right font-mono">{euro(t.total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {detail.transactions.length === 0 && (
                    <p className="p-6 text-center text-zinc-500 text-sm">Keine Zahlungseingänge in diesem Monat.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </RtShell>
  );
}
