import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type LagerPart = {
  id: string;
  repair_id: string;
  name: string;
  status: string;
  sale_cents: number;
  purchase_cents: number;
  barcode: string | null;
  created_at: string;
  tracking_code: string;
  repair_status: string;
  customer_name: string;
  device_type: string;
  brand: string | null;
  model: string | null;
};

const PART_LABEL: Record<string, string> = {
  bestellt: "Bestellt",
  unterwegs: "Unterwegs",
  angekommen: "Angekommen",
};

type LagerTab = "open" | "arrived" | "all";

function tabButtonClass(active: boolean): string {
  return `px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
    active
      ? "border-[#39ff14] text-[#39ff14] bg-[#39ff14]/10 shadow-[0_0_12px_rgba(57,255,20,0.12)]"
      : "border-[#00d4ff]/25 text-zinc-400 hover:border-[#00d4ff]/45 hover:text-zinc-200"
  }`;
}

export function LagerPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [parts, setParts] = useState<LagerPart[]>([]);
  const [tab, setTab] = useState<LagerTab>("open");
  const [scan, setScan] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const filteredParts = useMemo(() => {
    if (tab === "open") return parts.filter((p) => p.status === "bestellt" || p.status === "unterwegs");
    if (tab === "arrived") return parts.filter((p) => p.status === "angekommen");
    return parts;
  }, [parts, tab]);

  const load = useCallback(async () => {
    const d = await fetchWorkshop<{ parts: LagerPart[] }>("/api/lager/parts");
    setParts(d.parts);
  }, []);

  useEffect(() => {
    if (gate === "ok") void load().catch(console.error);
  }, [gate, load]);

  const onScan = async (e: FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setFeedback(null);
    try {
      const r = await fetchWorkshop<{
        ok?: boolean;
        message?: string;
        already?: boolean;
        repair?: { tracking_code: string; status: string };
      }>("/api/lager/scan-barcode", { method: "POST", body: JSON.stringify({ barcode: code }) });
      setScan("");
      const extra = r.repair ? ` · Auftrag ${r.repair.tracking_code} (${r.repair.status.replace(/_/g, " ")})` : "";
      setFeedback({
        kind: "ok",
        text: (r.message ?? "OK") + (r.already ? "" : extra),
      });
      await load();
    } catch (err) {
      setFeedback({ kind: "err", text: String(err) });
    }
  };

  if (gate === "loading") {
    return (
      <RtShell title="Lager & Ersatzteile">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Lager & Ersatzteile" subtitle="Anmeldung erforderlich">
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
      title="Lager & Ersatzteile"
      subtitle="Bestellte und eingetroffene Teile · Barcode-Scan für Wareneingang"
      actions={
        <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
          Abmelden
        </button>
      }
    >
      <div className="space-y-6 max-w-5xl mx-auto">
        <section className="rt-panel rt-panel-cyan space-y-3">
          <h2 className="text-sm font-bold text-white tracking-wide">Barcode scannen</h2>
          <p className="text-xs text-zinc-500">
            USB-Scanner sendet wie Tastatur: Feld fokussieren, scannen, Enter. Das Teil wird auf „angekommen“ gesetzt;
            der Auftrag wechselt bei offenen Nachlieferungen auf „teilgeliefert“, sonst nach vollständigem Eingang auf
            „in Reparatur“. Der Kunde erhält eine E-Mail.
          </p>
          <form onSubmit={(e) => void onScan(e)} className="flex flex-col sm:flex-row gap-2">
            <input
              className="rt-input-neon flex-1 font-mono"
              placeholder="Barcode (Scan oder eingeben)"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="rt-btn-confirm px-6 shrink-0 min-h-[48px]">
              Buchen
            </button>
          </form>
          {feedback && (
            <p className={`text-sm ${feedback.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{feedback.text}</p>
          )}
        </section>

        <section className="rt-panel rt-panel-violet">
          <div className="flex flex-wrap justify-between gap-2 mb-4">
            <h2 className="text-sm font-bold text-violet-200 tracking-wide">Teile-Übersicht</h2>
            <button type="button" className="text-xs text-[#00d4ff] underline" onClick={() => void load()}>
              Aktualisieren
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Teile filtern">
            <button type="button" role="tab" aria-selected={tab === "open"} className={tabButtonClass(tab === "open")} onClick={() => setTab("open")}>
              Offene Bestellungen
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "arrived"}
              className={tabButtonClass(tab === "arrived")}
              onClick={() => setTab("arrived")}
            >
              Nur angekommen
            </button>
            <button type="button" role="tab" aria-selected={tab === "all"} className={tabButtonClass(tab === "all")} onClick={() => setTab("all")}>
              Alle
            </button>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Nach Teilebestellung in der{" "}
            <Link to="/werkstatt" className="text-[#39ff14] underline">
              Auftragsverwaltung
            </Link>{" "}
            erscheinen Einträge hier automatisch. Einkaufspreis und Barcode pflegen Sie dort beim Anlegen oder nachträglich.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500 text-xs uppercase border-b border-white/10">
                <tr>
                  <th className="p-3">Teil</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Barcode</th>
                  <th className="p-3">Auftrag</th>
                  <th className="p-3">Kunde / Gerät</th>
                </tr>
              </thead>
              <tbody>
                {filteredParts.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="p-3 text-zinc-200">{p.name}</td>
                    <td className="p-3 text-amber-200/90">{PART_LABEL[p.status] ?? p.status}</td>
                    <td className="p-3 font-mono text-xs text-[#39ff14]">{p.barcode ?? "—"}</td>
                    <td className="p-3">
                      <Link to="/werkstatt" className="text-[#00d4ff] underline font-mono text-xs">
                        {p.tracking_code}
                      </Link>
                      <span className="text-zinc-600 text-xs block mt-0.5">{p.repair_status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="p-3 text-zinc-400 text-xs">
                      {p.customer_name}
                      <br />
                      {p.device_type} {[p.brand, p.model].filter(Boolean).join(" ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredParts.length === 0 && (
              <p className="p-6 text-zinc-500 text-sm text-center">
                {parts.length === 0
                  ? "Keine Teile in dieser Übersicht."
                  : tab === "open"
                    ? "Keine offenen Bestellungen (alles eingetroffen oder andere Ansicht wählen)."
                    : tab === "arrived"
                      ? "Keine angekommenen Teile in der Liste (noch nicht gescannt oder nur „offen“)."
                      : "Keine Einträge."}
              </p>
            )}
          </div>
        </section>
      </div>
    </RtShell>
  );
}
