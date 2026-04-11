import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { formatDeBerlin } from "../lib/formatBerlin";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type ClosingRow = {
  id: string;
  business_date: string;
  generated_at: string;
  total_cents: number;
  bar_cents: number;
  online_sumup_cents: number;
  tap_to_pay_cents: number;
  ueberweisung_cents: number;
  other_cents: number;
  invoice_count: number;
  transaction_count: number;
  register_balance_eod_cents: number | null;
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

export function TagesabschlussPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [list, setList] = useState<ClosingRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<(ClosingRow & { transactions: Tx[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openingEuro, setOpeningEuro] = useState("");
  const [openingBusy, setOpeningBusy] = useState(false);

  const loadList = useCallback(async () => {
    setErr(null);
    try {
      const d = await fetchWorkshop<{ closings: ClosingRow[] }>("/api/tagesabschluesse");
      setList(d.closings);
      setSelected((prev) => {
        if (prev && d.closings.some((c) => c.business_date === prev)) return prev;
        return d.closings[0]?.business_date ?? null;
      });
    } catch (e) {
      setErr(String(e));
      setList([]);
    }
  }, []);

  const loadDetail = useCallback(async (date: string) => {
    setErr(null);
    try {
      const d = await fetchWorkshop<ClosingRow & { transactions: Tx[] }>(
        `/api/tagesabschluesse/${encodeURIComponent(date)}`
      );
      setDetail(d);
    } catch (e) {
      setDetail(null);
      setErr(String(e));
    }
  }, []);

  const loadOpening = useCallback(async () => {
    try {
      const d = await fetchWorkshop<{ opening_cents: number }>("/api/tagesabschluesse/kasse/eroeffnungsbestand");
      setOpeningEuro((d.opening_cents / 100).toFixed(2).replace(".", ","));
    } catch {
      setOpeningEuro("0,00");
    }
  }, []);

  useEffect(() => {
    if (gate === "ok") void loadList();
  }, [gate, loadList]);

  useEffect(() => {
    if (gate === "ok") void loadOpening();
  }, [gate, loadOpening]);

  useEffect(() => {
    if (gate === "ok" && selected) void loadDetail(selected);
  }, [gate, selected, loadDetail]);

  if (gate === "loading") {
    return (
      <RtShell title="Tagesabschluss">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Tagesabschluss" subtitle="Anmeldung erforderlich">
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

  return (
    <RtShell
      title="Tagesabschluss"
      subtitle="Geschäftstag Europe/Berlin 00:00–23:59 · automatische Archivierung nach Tagesende"
      actions={
        <div className="flex flex-wrap gap-2 items-center">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            Start
          </Link>
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          Abschlüsse entstehen <strong>automatisch</strong> kurz nach der Berliner Tagesgrenze (00:00&nbsp;Uhr, mit kurzer
          technischer Verzögerung) für jeden abgeschlossenen Kalendertag bis <strong>gestern</strong>. Zusätzlich einmal
          beim Serverstart (Nachholen). Zuordnung nach <strong>Zahlungseingang</strong> (
          <code className="text-xs text-zinc-400">payment_paid_at</code>) in Europe/Berlin.{" "}
          <strong>Kassenbestand Tagesende</strong> = Anfangsbestand (Bar) + kumulierte Barumsätze aus allen
          Tagesabschlüssen bis einschließlich dieses Tages.
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}

        <div className="rt-panel rt-panel-cyan p-4 max-w-xl">
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Kasse: Anfangsbestand (Bar, netto)</p>
          <p className="text-xs text-zinc-500 mb-3">
            Physische Kasse vor dem ersten erfassten Tag bzw. vor Software-Start. Änderung setzt die Endbestände aller
            Tage neu durch.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              inputMode="decimal"
              className="rt-input-neon w-40 font-mono"
              value={openingEuro}
              onChange={(e) => setOpeningEuro(e.target.value)}
              aria-label="Anfangsbestand Kasse in Euro"
            />
            <span className="text-sm text-zinc-500">€</span>
            <button
              type="button"
              className="rt-btn-confirm text-sm"
              disabled={openingBusy}
              onClick={() => {
                setOpeningBusy(true);
                setErr(null);
                const n = parseFloat(openingEuro.replace(",", "."));
                (async () => {
                  try {
                    if (!Number.isFinite(n)) throw new Error("Bitte gültigen Betrag eingeben.");
                    await fetchWorkshop("/api/tagesabschluesse/kasse/eroeffnungsbestand", {
                      method: "PUT",
                      body: JSON.stringify({ opening_cents: Math.round(n * 100) }),
                    });
                    await loadList();
                    if (selected) await loadDetail(selected);
                  } catch (e) {
                    setErr(String(e));
                  } finally {
                    setOpeningBusy(false);
                  }
                })();
              }}
            >
              Speichern
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="rt-btn-confirm text-sm" onClick={() => void loadList()}>
            Liste aktualisieren
          </button>
        </div>

        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          <div className="rt-panel rt-panel-cyan p-3 max-h-[70vh] overflow-y-auto">
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Kalendertag</p>
            <ul className="space-y-1">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.business_date)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
                      selected === c.business_date
                        ? "bg-[#00d4ff]/20 text-[#7ee8ff] border border-[#00d4ff]/40"
                        : "text-zinc-400 hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    {c.business_date}
                    <span className="block text-[10px] text-zinc-500 font-sans">{euro(c.total_cents)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p className="text-xs text-zinc-500">Noch keine Abschlüsse.</p>}
          </div>

          {detail && (
            <div className="space-y-4">
              <div className="rt-panel rt-panel-violet p-4">
                <h2 className="text-lg font-semibold text-white mb-1 font-mono">{detail.business_date}</h2>
                <p className="text-xs text-zinc-500 mb-4">
                  erzeugt {detail.generated_at ? formatDeBerlin(String(detail.generated_at)) : "—"}
                </p>
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Gesamtumsatz</p>
                    <p className="text-2xl font-mono text-emerald-300">{euro(detail.total_cents)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Anzahl Vorgänge / Rechnungsnr.</p>
                    <p className="text-xl font-mono text-violet-200">
                      {detail.transaction_count} / {detail.invoice_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Bar (Kasse) / Endbestand Kasse</p>
                    <p className="text-lg font-mono text-amber-200">{euro(detail.bar_cents)}</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Kumuliert Tagesende:{" "}
                      <span className="font-mono text-emerald-200/90">
                        {euro(Number(detail.register_balance_eod_cents ?? 0))}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Online (SumUp)</p>
                    <p className="text-lg font-mono text-cyan-200">{euro(detail.online_sumup_cents)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">SumUp Tap to Pay</p>
                    <p className="text-lg font-mono text-fuchsia-200">{euro(detail.tap_to_pay_cents)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs uppercase">Überweisung</p>
                    <p className="text-lg font-mono text-zinc-300">{euro(detail.ueberweisung_cents)}</p>
                  </div>
                  {detail.other_cents > 0 && (
                    <div className="sm:col-span-2">
                      <p className="text-zinc-500 text-xs uppercase">Sonstige</p>
                      <p className="text-lg font-mono text-zinc-400">{euro(detail.other_cents)}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 overflow-hidden">
                <p className="text-xs text-zinc-500 uppercase tracking-wide px-4 py-2 bg-[#060b13] border-b border-white/10">
                  Transaktionsliste ({detail.transactions.length})
                </p>
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-left text-sm min-w-[720px]">
                    <thead className="text-zinc-500 text-xs uppercase sticky top-0 bg-[#0a1220] border-b border-white/10">
                      <tr>
                        <th className="p-2">Zeit (bezahlt)</th>
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
                          <td className="p-2 text-zinc-300 max-w-[140px] truncate" title={t.customer_name ?? ""}>
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
                    <p className="p-6 text-center text-zinc-500 text-sm">Keine Zahlungseingänge an diesem Kalendertag.</p>
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
