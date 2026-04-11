import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type Stats = {
  totals: {
    repairs: number;
    customers: number;
    openRepairs: number;
    fertigRepairs: number;
    abgeholtRepairs: number;
  };
  revenueCents: {
    today: number;
    last7Days: number;
    last30Days: number;
    allTime: number;
  };
  avgLeadTimeDaysFertig: number | null;
  byStatus: { status: string; count: number }[];
  problemReasons: { label: string; count: number }[];
  deviceTypes: { device_type: string; count: number }[];
  topServices: { code: string; name: string; bookings: number; revenue_cents: number }[];
  parts: { lines: number; sale_cents: number; purchase_cents: number };
  paymentOnCompleted: { payment_status: string; count: number; total_cents: number }[];
  monthly: { month: string; repairs: number; revenue_cents: number }[];
};

function euroFromCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

const STATUS_DE: Record<string, string> = {
  angenommen: "Angenommen",
  diagnose: "Diagnose",
  wartet_auf_teile: "Warte auf Teile",
  teilgeliefert: "Teilgeliefert",
  in_reparatur: "In Reparatur",
  fertig: "Fertig",
  abgeholt: "Abgeholt",
};

function statusLabel(s: string): string {
  return STATUS_DE[s] ?? s.replace(/_/g, " ");
}

function BarRow({ label, value, max, tone = "cyan" }: { label: string; value: number; max: number; tone?: "cyan" | "violet" | "amber" }) {
  const pct = max > 0 ? Math.min(100, Math.max(2, (value / max) * 100)) : 0;
  const grad =
    tone === "violet"
      ? "from-violet-400 to-fuchsia-600"
      : tone === "amber"
        ? "from-amber-400 to-orange-500"
        : "from-[#00d4ff] to-[#9b59b6]";
  return (
    <div className="mb-3">
      <div className="flex justify-between gap-2 text-xs text-zinc-400 mb-1">
        <span className="truncate min-w-0">{label}</span>
        <span className="text-zinc-200 shrink-0 font-mono">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[#060b13] border border-white/10 overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${grad} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#00d4ff]/25 bg-[#060b13]/80 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{title}</p>
      <p className="text-lg font-semibold text-white font-mono">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

export function StatistikPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await fetchWorkshop<Stats>("/api/stats/overview");
      setStats(d);
    } catch (e) {
      setErr(String(e));
      setStats(null);
    } finally {
      setStatsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (gate !== "ok") {
      setStatsLoaded(false);
      setStats(null);
      setErr(null);
      return;
    }
    setStatsLoaded(false);
    void load();
  }, [gate, load]);

  const maxProblem = stats ? Math.max(1, ...stats.problemReasons.map((p) => p.count)) : 1;
  const maxStatus = stats ? Math.max(1, ...stats.byStatus.map((p) => p.count)) : 1;
  const maxDevice = stats ? Math.max(1, ...stats.deviceTypes.map((p) => p.count)) : 1;
  const maxServiceBook = stats ? Math.max(1, ...stats.topServices.map((p) => p.bookings)) : 1;

  if (gate === "loading") {
    return (
      <RtShell title="Statistik & Auswertung">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Statistik & Auswertung" subtitle="Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <p className="text-sm text-zinc-400">Bitte mit dem Werkstatt-Passwort anmelden.</p>
            <div>
              <label className="rt-label-neon">Passwort</label>
              <input
                type="password"
                className="rt-input-neon"
                placeholder="Passwort"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {loginErr && <p className="text-sm text-red-400">{loginErr}</p>}
            <button type="submit" className="rt-btn-confirm w-full min-h-[52px]">
              Anmelden
            </button>
          </form>
        </div>
      </RtShell>
    );
  }

  return (
    <RtShell
      title="Statistik & Auswertung"
      subtitle="Umsatz, Aufträge, häufige Anliegen & Leistungen"
      actions={
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs text-[#00d4ff] underline px-2" onClick={() => void load()}>
            Aktualisieren
          </button>
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {err && <p className="text-red-400 text-sm text-center">{err}</p>}
        {!statsLoaded && !err && <p className="text-zinc-500 text-center py-12">Statistik wird geladen…</p>}

        {stats && (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi title="Aufträge gesamt" value={String(stats.totals.repairs)} />
              <Kpi title="Kunden" value={String(stats.totals.customers)} />
              <Kpi title="Noch in Bearbeitung" value={String(stats.totals.openRepairs)} sub="nicht abgeholt" />
              <Kpi
                title="Ø Dauer (fertig/abgeholt)"
                value={stats.avgLeadTimeDaysFertig != null ? `${stats.avgLeadTimeDaysFertig} Tage` : "—"}
                sub="Annahme → letzte Aktualisierung"
              />
            </section>

            <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi title="Umsatz heute (Summe Aufträge)" value={euroFromCents(stats.revenueCents.today)} />
              <Kpi title="Umsatz 7 Tage" value={euroFromCents(stats.revenueCents.last7Days)} />
              <Kpi title="Umsatz 30 Tage" value={euroFromCents(stats.revenueCents.last30Days)} />
              <Kpi title="Umsatz gesamt" value={euroFromCents(stats.revenueCents.allTime)} sub="Summe aller Aufträge" />
            </section>

            <div className="grid lg:grid-cols-2 gap-6">
              <section className="rt-panel rt-panel-violet">
                <h2 className="text-sm font-bold text-violet-200 tracking-wide mb-4">Häufigste Reparatur-Anliegen</h2>
                <p className="text-xs text-zinc-500 mb-4">Nach Kategorie aus der Annahme (Bezeichnung bzw. Auswahl).</p>
                {stats.problemReasons.length === 0 && <p className="text-zinc-500 text-sm">Noch keine Daten.</p>}
                {stats.problemReasons.map((p) => (
                  <BarRow key={p.label} label={p.label} value={p.count} max={maxProblem} tone="violet" />
                ))}
              </section>

              <section className="rt-panel rt-panel-cyan">
                <h2 className="text-sm font-bold text-[#00d4ff] tracking-wide mb-4">Aufträge nach Status</h2>
                {stats.byStatus.map((p) => (
                  <BarRow key={p.status} label={statusLabel(p.status)} value={p.count} max={maxStatus} />
                ))}
              </section>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <section className="rt-panel rt-panel-cyan">
                <h2 className="text-sm font-bold text-[#00d4ff] tracking-wide mb-4">Gerätetypen</h2>
                {stats.deviceTypes.length === 0 && <p className="text-zinc-500 text-sm">Noch keine Daten.</p>}
                {stats.deviceTypes.map((p) => (
                  <BarRow key={p.device_type} label={p.device_type} value={p.count} max={maxDevice} tone="amber" />
                ))}
              </section>

              <section className="rt-panel rt-panel-amber">
                <h2 className="text-sm font-bold text-amber-200 tracking-wide mb-4">Ersatzteil-Zeilen (Summen)</h2>
                <p className="text-xs text-zinc-500 mb-3">Alle erfassten Teilepositionen über alle Aufträge.</p>
                <ul className="text-sm text-zinc-300 space-y-2 font-mono">
                  <li>Zeilen: {stats.parts.lines}</li>
                  <li>VK-Summe: {euroFromCents(stats.parts.sale_cents)}</li>
                  <li>EK-Summe: {euroFromCents(stats.parts.purchase_cents)}</li>
                  <li className="text-emerald-300/90">
                    Differenz (VK − EK): {euroFromCents(stats.parts.sale_cents - stats.parts.purchase_cents)}
                  </li>
                </ul>
              </section>
            </div>

            <section className="rt-panel rt-panel-violet">
              <h2 className="text-sm font-bold text-violet-200 tracking-wide mb-4">Meist gebuchte Leistungen</h2>
              <p className="text-xs text-zinc-500 mb-4">Aus den Auftrags-Services (Häufigkeit & Summe der Positionspreise).</p>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500 text-xs uppercase border-b border-white/10">
                    <tr>
                      <th className="p-3">Leistung</th>
                      <th className="p-3 text-right">Buchungen</th>
                      <th className="p-3 text-right">Summe VK</th>
                      <th className="p-3 hidden sm:table-cell">Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topServices.map((s) => (
                      <tr key={s.code} className="border-b border-white/5">
                        <td className="p-3 text-zinc-200">{s.name}</td>
                        <td className="p-3 text-right font-mono text-amber-200/90">{s.bookings}</td>
                        <td className="p-3 text-right font-mono text-[#39ff14]">{euroFromCents(s.revenue_cents)}</td>
                        <td className="p-3 hidden sm:table-cell w-[28%]">
                          <div className="h-1.5 rounded-full bg-[#060b13] overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-500"
                              style={{ width: `${Math.min(100, (s.bookings / maxServiceBook) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stats.topServices.length === 0 && <p className="p-6 text-zinc-500 text-sm text-center">Noch keine Services gebucht.</p>}
              </div>
            </section>

            <section className="rt-panel rt-panel-cyan">
              <h2 className="text-sm font-bold text-[#00d4ff] tracking-wide mb-4">Abgeschlossene Aufträge – Zahlung</h2>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500 text-xs uppercase border-b border-white/10">
                    <tr>
                      <th className="p-3">Zahlungsstatus</th>
                      <th className="p-3 text-right">Anzahl</th>
                      <th className="p-3 text-right">Summe Auftrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.paymentOnCompleted.map((p) => (
                      <tr key={p.payment_status} className="border-b border-white/5">
                        <td className="p-3 text-zinc-200">{p.payment_status === "bezahlt" ? "Bezahlt" : "Offen"}</td>
                        <td className="p-3 text-right font-mono">{p.count}</td>
                        <td className="p-3 text-right font-mono text-[#39ff14]">{euroFromCents(p.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stats.paymentOnCompleted.length === 0 && (
                  <p className="p-6 text-zinc-500 text-sm text-center">Noch keine fertigen/abgeholten Aufträge.</p>
                )}
              </div>
            </section>

            <section className="rt-panel rt-panel-amber">
              <h2 className="text-sm font-bold text-amber-200 tracking-wide mb-4">Letzte 6 Monate (Monatsübersicht)</h2>
              <p className="text-xs text-zinc-500 mb-4">Anzahl neuer Aufträge und Summe der Endpreise pro Monat (Erstellungsdatum).</p>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500 text-xs uppercase border-b border-white/10">
                    <tr>
                      <th className="p-3">Monat</th>
                      <th className="p-3 text-right">Neue Aufträge</th>
                      <th className="p-3 text-right">Summe Endpreis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.monthly.map((m) => (
                      <tr key={m.month} className="border-b border-white/5">
                        <td className="p-3 font-mono text-zinc-200">{m.month}</td>
                        <td className="p-3 text-right font-mono">{m.repairs}</td>
                        <td className="p-3 text-right font-mono text-[#00d4ff]">{euroFromCents(m.revenue_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stats.monthly.length === 0 && <p className="p-6 text-zinc-500 text-sm text-center">Noch keine Aufträge in diesem Zeitraum.</p>}
              </div>
            </section>

            <p className="text-center text-xs text-zinc-600">
              Details zu einzelnen Aufträgen in der{" "}
              <Link to="/werkstatt" className="text-[#39ff14] underline">
                Auftragsverwaltung
              </Link>
              .
            </p>
          </>
        )}

      </div>
    </RtShell>
  );
}
