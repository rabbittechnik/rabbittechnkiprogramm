import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type Row = {
  id: string;
  tracking_code: string;
  status: string;
  total_cents: number;
  payment_status: string;
  updated_at: string;
  created_at: string;
  customer_name: string;
  device_type: string;
  brand: string | null;
  model: string | null;
};

const STATUSES = ["angenommen", "diagnose", "wartet_auf_teile", "in_reparatur", "fertig", "abgeholt"];

export function Workshop({ pageTitle = "Auftragsverwaltung" }: { pageTitle?: string }) {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<{
    repair: Record<string, unknown>;
    parts: { id: string; name: string; status: string; sale_cents: number; purchase_cents: number }[];
  } | null>(null);
  const [partName, setPartName] = useState("");
  const [sale, setSale] = useState("");
  const [buy, setBuy] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await fetchWorkshop<Row[]>("/api/repairs");
      setRows(data);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "WORKSHOP_AUTH" || err.message === "Anmeldung erforderlich") {
        logout();
      } else {
        console.error(e);
      }
    }
  }, [logout]);

  useEffect(() => {
    if (gate === "ok") void refresh();
  }, [gate, refresh]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    fetchWorkshop<typeof detail>(`/api/repairs/${selected.id}`)
      .then(setDetail)
      .catch((e) => {
        const err = e as Error & { code?: string };
        if (err.code === "WORKSHOP_AUTH") logout();
        else console.error(e);
      });
  }, [selected, logout]);

  const setStatus = async (id: string, status: string) => {
    await fetchWorkshop(`/api/repairs/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refresh();
    if (selected?.id === id) setSelected((prev) => (prev ? { ...prev, status } : null));
  };

  const addPart = async () => {
    if (!selected || !partName.trim()) return;
    await fetchWorkshop(`/api/repairs/${selected.id}/parts`, {
      method: "POST",
      body: JSON.stringify({
        name: partName,
        sale_cents: Math.round(parseFloat(sale.replace(",", ".")) * 100) || 0,
        purchase_cents: Math.round(parseFloat(buy.replace(",", ".")) * 100) || 0,
      }),
    });
    setPartName("");
    setSale("");
    setBuy("");
    const d = await fetchWorkshop<typeof detail>(`/api/repairs/${selected.id}`);
    setDetail(d);
    await refresh();
  };

  const updatePartStatus = async (partId: string, status: string) => {
    if (!selected) return;
    await fetchWorkshop(`/api/repairs/${selected.id}/parts/${partId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const d = await fetchWorkshop<typeof detail>(`/api/repairs/${selected.id}`);
    setDetail(d);
    await refresh();
  };

  if (gate === "loading") {
    return (
      <RtShell title={pageTitle}>
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title={pageTitle} subtitle="Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <p className="text-sm text-zinc-400">Bitte mit dem Werkstatt-Passwort anmelden (Umgebungsvariable RABBIT_WORKSHOP_PASSWORD).</p>
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
      title={pageTitle}
      subtitle="Aufträge & Teile"
      actions={
        <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
          Abmelden
        </button>
      }
    >
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rt-panel rt-panel-cyan min-h-[200px]">
          <h2 className="text-sm font-bold text-white mb-4 tracking-wide">Auftragsliste</h2>
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                  selected?.id === r.id
                    ? "border-[#39ff14]/60 bg-[#39ff14]/10 shadow-[0_0_20px_rgba(57,255,20,0.15)]"
                    : "border-[#00d4ff]/20 bg-[#060b13]/60 hover:border-[#00d4ff]/40"
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-[#00d4ff]">{r.tracking_code}</span>
                  <span className="text-xs text-amber-300/90">{r.status.replace(/_/g, " ")}</span>
                </div>
                <p className="text-sm text-zinc-300 mt-1">
                  {r.customer_name} · {r.device_type} {[r.brand, r.model].filter(Boolean).join(" ")}
                </p>
                <p className="text-xs text-zinc-500 mt-1">{(r.total_cents / 100).toFixed(2)} € · {r.payment_status}</p>
              </button>
            ))}
            {rows.length === 0 && <p className="text-zinc-500 text-sm">Noch keine Aufträge.</p>}
          </div>
        </section>

        <section className="rt-panel rt-panel-violet min-h-[320px]">
          {!selected && <p className="text-zinc-500">Auftrag in der Liste wählen.</p>}
          {selected && detail && (
            <div className="space-y-5">
              <div className="flex flex-wrap justify-between gap-2 items-start">
                <h2 className="font-display font-bold text-lg text-[#00d4ff]">{selected.tracking_code}</h2>
                <Link
                  to={`/track/${selected.tracking_code}`}
                  className="text-sm text-[#39ff14] underline underline-offset-2"
                >
                  Kundenansicht
                </Link>
              </div>
              <div>
                <p className="rt-label-neon mb-2">Status</p>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                        selected.status === s
                          ? "border-[#39ff14] text-[#39ff14] bg-[#39ff14]/10"
                          : "border-[#00d4ff]/25 text-zinc-400 hover:border-[#00d4ff]/50"
                      }`}
                      onClick={() => void setStatus(selected.id, s)}
                    >
                      {s.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-violet-300 mb-2">Ersatzteil hinzufügen</p>
                <input
                  className="rt-input-neon mb-2"
                  placeholder="Bezeichnung"
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    className="rt-input-neon"
                    placeholder="Verkauf €"
                    value={sale}
                    onChange={(e) => setSale(e.target.value)}
                  />
                  <input
                    className="rt-input-neon"
                    placeholder="Einkauf €"
                    value={buy}
                    onChange={(e) => setBuy(e.target.value)}
                  />
                </div>
                <button type="button" className="rt-btn-confirm w-full text-base" onClick={() => void addPart()}>
                  Teil buchen
                </button>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2 text-zinc-300">Teile im Auftrag</p>
                <ul className="space-y-2">
                  {detail.parts.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-2"
                    >
                      <span className="text-sm text-zinc-300">{p.name}</span>
                      <select
                        className="rt-input-neon !min-h-[40px] !py-1 max-w-[200px]"
                        value={p.status}
                        onChange={(e) => void updatePartStatus(p.id, e.target.value)}
                      >
                        {["bestellt", "unterwegs", "angekommen", "eingebaut"].map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
              <a
                href={`/api/repairs/${selected.id}/invoice.pdf`}
                className="inline-flex justify-center items-center w-full min-h-[48px] rounded-xl border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10"
                target="_blank"
                rel="noreferrer"
              >
                Rechnung PDF
              </a>
            </div>
          )}
        </section>
      </div>
    </RtShell>
  );
}
