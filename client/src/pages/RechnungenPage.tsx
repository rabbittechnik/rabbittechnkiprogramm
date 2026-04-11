import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { formatDeBerlin } from "../lib/formatBerlin";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type InvoiceRow = {
  id: string;
  tracking_code: string;
  status: string;
  total_cents: number;
  payment_status: string;
  payment_method: string | null;
  payment_due_at: string | null;
  created_at: string;
  updated_at: string;
  invoice_number: string;
  invoice_created_at: string;
  customer_name: string;
  due_at: string;
  payment_bucket: "bezahlt" | "offen_in_frist" | "offen_ueberfaellig";
};

type Tab = "alle" | "bezahlt" | "offen_frist" | "offen_ueberfaellig";

function formatDue(iso: string): string {
  return formatDeBerlin(iso, { dateStyle: "medium", timeStyle: "short" });
}

function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function tabClass(active: boolean): string {
  return `px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
    active
      ? "border-[#39ff14] text-[#39ff14] bg-[#39ff14]/10"
      : "border-[#00d4ff]/25 text-zinc-400 hover:border-[#00d4ff]/45"
  }`;
}

export function RechnungenPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [terms, setTerms] = useState<{ headline: string; lines: string[] } | null>(null);
  const [tab, setTab] = useState<Tab>("alle");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await fetchWorkshop<{ invoices: InvoiceRow[]; paymentTerms: { headline: string; lines: string[] } }>(
        "/api/invoices"
      );
      setRows(d.invoices);
      setTerms(d.paymentTerms);
    } catch (e) {
      setErr(String(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (gate === "ok") void load();
  }, [gate, load]);

  const filtered = useMemo(() => {
    if (tab === "alle") return rows;
    if (tab === "bezahlt") return rows.filter((r) => r.payment_bucket === "bezahlt");
    if (tab === "offen_frist") return rows.filter((r) => r.payment_bucket === "offen_in_frist");
    return rows.filter((r) => r.payment_bucket === "offen_ueberfaellig");
  }, [rows, tab]);

  const counts = useMemo(
    () => ({
      alle: rows.length,
      bezahlt: rows.filter((r) => r.payment_bucket === "bezahlt").length,
      offen_frist: rows.filter((r) => r.payment_bucket === "offen_in_frist").length,
      offen_ueberfaellig: rows.filter((r) => r.payment_bucket === "offen_ueberfaellig").length,
    }),
    [rows]
  );

  const setPaid = async (id: string) => {
    await fetchWorkshop(`/api/repairs/${id}/payment`, { method: "PATCH", body: JSON.stringify({ payment_status: "bezahlt" }) });
    await load();
  };

  const setOpen = async (id: string) => {
    await fetchWorkshop(`/api/repairs/${id}/payment`, { method: "PATCH", body: JSON.stringify({ payment_status: "offen" }) });
    await load();
  };

  if (gate === "loading") {
    return (
      <RtShell title="Rechnungen & Zahlungen">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Rechnungen & Zahlungen" subtitle="Anmeldung erforderlich">
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
      title="Rechnungen & Zahlungen"
      subtitle="Sortiert: offen in Frist, überfällig, bezahlt · 7-Tage-Ziel ab „Fertig“"
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
      <div className="max-w-6xl mx-auto space-y-6">
        {terms && (
          <section className="rt-panel rt-panel-amber space-y-2">
            <h2 className="text-sm font-bold text-amber-200 tracking-wide">{terms.headline}</h2>
            <ul className="text-sm text-zinc-300 space-y-1.5 list-disc list-inside">
              {terms.lines.map((line) => (
                <li key={line} className="leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}

        {err && <p className="text-red-400 text-sm text-center">{err}</p>}

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Zahlungen filtern">
          <button type="button" className={tabClass(tab === "alle")} onClick={() => setTab("alle")}>
            Alle ({counts.alle})
          </button>
          <button type="button" className={tabClass(tab === "offen_frist")} onClick={() => setTab("offen_frist")}>
            Offen – in Frist ({counts.offen_frist})
          </button>
          <button type="button" className={tabClass(tab === "offen_ueberfaellig")} onClick={() => setTab("offen_ueberfaellig")}>
            Offen – überfällig ({counts.offen_ueberfaellig})
          </button>
          <button type="button" className={tabClass(tab === "bezahlt")} onClick={() => setTab("bezahlt")}>
            Bezahlt ({counts.bezahlt})
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Es erscheinen fertige und abgeholte Aufträge mit Betrag &gt; 0. Das Zahlungsziel (7 Tage) setzt sich automatisch, sobald ein Auftrag auf{" "}
          <strong className="text-zinc-400">Fertig zur Abholung</strong> gestellt wird. Änderungen an der Zahlung sind hier und in der{" "}
          <Link to="/werkstatt" className="text-[#39ff14] underline">
            Auftragsverwaltung
          </Link>{" "}
          möglich.
        </p>

        <div className="overflow-x-auto rounded-xl border border-[#00d4ff]/20 bg-[#0a1220]/90">
          <table className="w-full text-left text-sm min-w-[720px]">
            <thead className="text-zinc-500 text-xs uppercase border-b border-white/10">
              <tr>
                <th className="p-3">Rechnung</th>
                <th className="p-3">Tracking</th>
                <th className="p-3">Kunde</th>
                <th className="p-3 text-right">Summe</th>
                <th className="p-3">Fälligkeit</th>
                <th className="p-3">Hinweis</th>
                <th className="p-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                  <td className="p-3 font-mono text-[#00d4ff]">{r.invoice_number}</td>
                  <td className="p-3 font-mono text-xs">{r.tracking_code}</td>
                  <td className="p-3 text-zinc-300 max-w-[160px] truncate" title={r.customer_name}>
                    {r.customer_name}
                  </td>
                  <td className="p-3 text-right font-mono text-white">{euro(r.total_cents)}</td>
                  <td className="p-3 text-xs text-zinc-400 whitespace-nowrap">{formatDue(r.due_at)}</td>
                  <td className="p-3">
                    {r.payment_bucket === "bezahlt" && <span className="text-emerald-400 text-xs font-medium">Bezahlt</span>}
                    {r.payment_bucket === "offen_in_frist" && (
                      <span className="text-amber-200/90 text-xs font-medium">Noch in der 7-Tage-Frist</span>
                    )}
                    {r.payment_bucket === "offen_ueberfaellig" && (
                      <span className="text-red-400 text-xs font-medium">Frist abgelaufen</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <a
                        href={`/api/repairs/${r.id}/invoice.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-2 py-1 rounded-lg border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10"
                      >
                        PDF
                      </a>
                      {r.payment_status !== "bezahlt" && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-lg border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10"
                          onClick={() => void setPaid(r.id)}
                        >
                          Als bezahlt
                        </button>
                      )}
                      {r.payment_status === "bezahlt" && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-lg border border-zinc-600 text-zinc-400 hover:bg-white/5"
                          onClick={() => void setOpen(r.id)}
                        >
                          Offen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-8 text-center text-zinc-500 text-sm">Keine Einträge in dieser Ansicht.</p>
          )}
        </div>
      </div>
    </RtShell>
  );
}
