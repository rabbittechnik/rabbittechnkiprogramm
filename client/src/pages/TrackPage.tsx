import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { RtShell } from "../components/RtShell";

const STATUS_LABEL: Record<string, string> = {
  angenommen: "Angenommen",
  diagnose: "Diagnose",
  wartet_auf_teile: "Wartet auf Teile",
  in_reparatur: "In Reparatur",
  fertig: "Fertig",
  abgeholt: "Abgeholt",
};

const PART_STATUS: Record<string, string> = {
  bestellt: "Bestellt",
  unterwegs: "Unterwegs",
  angekommen: "Angekommen",
  eingebaut: "Eingebaut",
};

export function TrackPage() {
  const { code: pathCode } = useParams();
  const [search] = useSearchParams();
  const [code, setCode] = useState(pathCode ?? search.get("c") ?? "");
  const [data, setData] = useState<{
    tracking: {
      tracking_code: string;
      status: string;
      total_cents: number;
      payment_status: string;
      updated_at: string;
      problem_label: string | null;
    };
    parts: { name: string; status: string; sale_cents: number }[];
    message: string | null;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (pathCode) setCode(pathCode);
  }, [pathCode]);

  const load = async (c: string) => {
    setErr(null);
    try {
      const d = await fetchJson<typeof data>(`/api/track/${encodeURIComponent(c)}`);
      setData(d as typeof data);
    } catch (e) {
      setErr(String(e));
      setData(null);
    }
  };

  useEffect(() => {
    if (code) void load(code);
  }, [code]);

  const steps = ["angenommen", "diagnose", "wartet_auf_teile", "in_reparatur", "fertig", "abgeholt"];

  return (
    <RtShell title="Auftragsstatus" subtitle="Öffentliche Ansicht für Kund:innen">
      <div className="max-w-lg mx-auto space-y-6">
        {!pathCode && (
          <div className="rt-panel rt-panel-cyan flex flex-col sm:flex-row gap-3 p-4">
            <input
              className="rt-input-neon flex-1"
              placeholder="Tracking-Code (z. B. RT-…)"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="button" className="rt-btn-confirm px-6 shrink-0" onClick={() => code && void load(code)}>
              Anzeigen
            </button>
          </div>
        )}

        {err && <p className="text-red-400 text-center text-sm">{err}</p>}

        {data && (
          <div className="rt-panel rt-panel-violet space-y-6">
            <div className="text-center">
              <p className="text-zinc-500 text-xs uppercase tracking-wide">Tracking-Code</p>
              <p className="font-mono text-2xl text-[#39ff14] drop-shadow-[0_0_12px_rgba(57,255,20,0.35)]">
                {data.tracking.tracking_code}
              </p>
            </div>

            <div>
              <p className="text-sm text-zinc-500 mb-2">Fortschritt</p>
              <div className="flex justify-between text-[10px] sm:text-xs text-zinc-500 mb-1 gap-0.5 overflow-x-auto">
                {steps.map((s) => (
                  <span key={s} className={data.tracking.status === s ? "text-[#00d4ff] font-bold whitespace-nowrap" : "whitespace-nowrap"}>
                    {STATUS_LABEL[s]?.slice(0, 3)}
                  </span>
                ))}
              </div>
              <div className="h-2 rounded-full bg-[#060b13] overflow-hidden border border-[#00d4ff]/20">
                <div
                  className="h-full bg-gradient-to-r from-[#00d4ff] to-[#9b59b6] transition-all"
                  style={{
                    width: `${((Math.max(0, steps.indexOf(data.tracking.status)) + 1) / steps.length) * 100}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-center font-semibold text-white">
                {STATUS_LABEL[data.tracking.status] ?? data.tracking.status}
              </p>
            </div>

            <div className="flex justify-between text-sm border-t border-white/10 pt-3">
              <span className="text-zinc-500">Summe (geschätzt)</span>
              <span className="font-mono text-[#00d4ff]">{(data.tracking.total_cents / 100).toFixed(2)} €</span>
            </div>

            {data.tracking.problem_label && (
              <p className="text-zinc-400 text-sm text-center">Anliegen: {data.tracking.problem_label}</p>
            )}

            {data.message && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200 text-sm text-center">
                {data.message}
              </p>
            )}

            {data.parts.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-violet-300 mb-2">Ersatzteile</p>
                <ul className="space-y-2">
                  {data.parts.map((p, i) => (
                    <li key={i} className="flex justify-between text-sm border-b border-white/10 pb-2 gap-2">
                      <span className="text-zinc-300">{p.name}</span>
                      <span className="text-zinc-400 text-right shrink-0">
                        {PART_STATUS[p.status] ?? p.status} · {(p.sale_cents / 100).toFixed(2)} €
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs text-zinc-600 text-center">
              Letzte Aktualisierung: {new Date(data.tracking.updated_at).toLocaleString("de-DE")}
            </div>
          </div>
        )}
      </div>
    </RtShell>
  );
}
