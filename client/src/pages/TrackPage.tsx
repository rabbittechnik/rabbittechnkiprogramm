import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { PublicTrackShell } from "../components/PublicTrackShell";

const STATUS_LABEL: Record<string, string> = {
  angenommen: "Angenommen",
  diagnose: "Diagnose",
  wartet_auf_teile: "Warte auf Teile",
  teilgeliefert: "Ersatzteil teilweise da",
  in_reparatur: "In Reparatur",
  fertig: "Fertig zur Abholung",
  abgeholt: "Abgeholt",
};

/** Ausführliche, beruhigende Statuserklärung für Kund:innen */
const STATUS_ERKLAERUNG: Record<string, string> = {
  angenommen:
    "Ihr Gerät wurde ordnungsgemäß angenommen und befindet sich in unserer Werkstatt. Als Nächstes prüfen wir die von Ihnen gemeldeten Symptome und planen die Arbeitsschritte.",
  diagnose:
    "Wir untersuchen Ihr Gerät gerade gezielt auf die beschriebenen Probleme. Ziel ist, die technische Ursache zu finden und Ihnen im Anschluss eine belastbare Einschätzung zu geben.",
  wartet_auf_teile:
    "Für die Reparatur sind spezielle Ersatzteile notwendig. Diese sind bestellt oder bereits unterwegs. Sobald alle Teile bei uns sind, starten wir unverzüglich mit der weiteren Bearbeitung.",
  teilgeliefert:
    "Mindestens ein bestelltes Ersatzteil ist bereits bei uns eingetroffen; auf weitere Lieferungen wird noch gewartet. Sobald alle Teile vollständig da sind, geht die Reparatur ohne Verzögerung weiter.",
  in_reparatur:
    "Ihr Gerät befindet sich aktuell in aktiver Reparatur. Unsere Techniker arbeiten an der vereinbarten Fehlerbehebung. Bei Rückfragen erreichen Sie uns telefonisch oder per E-Mail.",
  fertig:
    "Die Reparatur ist abgeschlossen. Ihr Gerät kann abgeholt werden. Bitte bringen Sie zur Identifikation diesen Auftrag, den Abholschein oder einen gültigen Ausweis mit.",
  abgeholt:
    "Dieser Auftrag ist erledigt und das Gerät wurde übergeben. Vielen Dank für Ihr Vertrauen in Rabbit-Technik.",
};

const PART_STATUS: Record<string, string> = {
  bestellt: "Bestellt",
  unterwegs: "Unterwegs",
  angekommen: "Angekommen",
  eingebaut: "Eingebaut",
  vor_ort: "Vor Ort / Lager",
};

const WERKSTATT = {
  name: "Rabbit-Technik",
  street: "Oberhausenerstr. 20",
  city: "72411 Bodelshausen",
  phone: "015172294882",
};

function formatElapsedSince(iso: string): string {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return "—";
  const ms = Math.max(0, Date.now() - start);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days} Tag(e), ${hours} Std.`;
  if (hours > 0) return `${hours} Std., ${mins} Min.`;
  return `${mins} Min.`;
}

function paymentLabelDe(ps: string): string {
  if (ps === "bezahlt") return "Bezahlt";
  if (ps === "offen") return "Noch offen";
  return ps;
}

function firstName(full: string): string {
  const t = full.trim();
  if (!t) return "";
  return t.split(/\s+/)[0] ?? t;
}

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
      created_at: string;
      problem_label: string | null;
      description: string | null;
      accessories: string | null;
    };
    customer: { name: string };
    device: { device_type: string; brand: string | null; model: string | null };
    parts: { name: string; status: string; sale_cents: number }[];
    message: string | null;
    invoice_number?: string | null;
    payment_due_until?: string;
    payment_bucket?: string;
    paymentTerms?: { headline: string; lines: string[] };
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

  const steps = [
    "angenommen",
    "diagnose",
    "wartet_auf_teile",
    "teilgeliefert",
    "in_reparatur",
    "fertig",
    "abgeholt",
  ];

  const activeIndex = useMemo(() => {
    if (!data) return 0;
    const i = steps.indexOf(data.tracking.status);
    return i < 0 ? 0 : i;
  }, [data]);

  const deviceLine = useMemo(() => {
    if (!data) return "";
    const { device_type, brand, model } = data.device;
    const mid = [brand, model].filter(Boolean).join(" ");
    return mid ? `${device_type} · ${mid}` : device_type;
  }, [data]);

  return (
    <PublicTrackShell title="Auftragsstatus" subtitle="Ihre Reparatur auf einen Blick">
      <div className="max-w-2xl mx-auto space-y-6 px-1">
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
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#00d4ff]/30 bg-[#0a1220]/95 p-5 sm:p-6 shadow-[0_0_32px_rgba(0,212,255,0.08)]">
              <p className="text-zinc-400 text-sm mb-1">Hallo {firstName(data.customer.name)},</p>
              <p className="text-white text-lg font-semibold leading-snug">
                hier sehen Sie den aktuellen Stand zu Ihrem Auftrag bei {WERKSTATT.name}.
              </p>
              <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mb-0.5">Name im Auftrag</p>
                  <p className="text-white font-medium">{data.customer.name}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mb-0.5">Tracking-Code</p>
                  <p className="font-mono text-[#39ff14] text-lg drop-shadow-[0_0_10px_rgba(57,255,20,0.35)]">
                    {data.tracking.tracking_code}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-violet-500/25 bg-[#0a1220]/95 p-5 sm:p-6 space-y-4">
              <h2 className="text-sm font-bold text-violet-200 uppercase tracking-wider">Gerät & Anliegen</h2>
              <p className="text-white text-base">{deviceLine}</p>
              {data.tracking.problem_label && (
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Vereinbartes Anliegen (Kategorie)</p>
                  <p className="text-zinc-200">{data.tracking.problem_label}</p>
                </div>
              )}
              {data.tracking.description?.trim() && (
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Ihre Beschreibung / Details</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{data.tracking.description}</p>
                </div>
              )}
              {data.tracking.accessories?.trim() && (
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Mitgegebenes Zubehör</p>
                  <p className="text-zinc-300 text-sm">{data.tracking.accessories}</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#00d4ff]/35 bg-[#0a1220]/95 p-5 sm:p-6 space-y-5">
              <h2 className="text-sm font-bold text-[#00d4ff] uppercase tracking-wider">Fortschritt</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {steps.map((s, i) => {
                  const done = i < activeIndex;
                  const current = i === activeIndex;
                  return (
                    <div
                      key={s}
                      className={`rounded-xl border px-3 py-2.5 text-center transition-colors ${
                        current
                          ? "border-[#00d4ff] bg-[#00d4ff]/10 text-[#7ee8ff] font-semibold shadow-[0_0_16px_rgba(0,212,255,0.2)]"
                          : done
                            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300/90"
                            : "border-zinc-700/80 text-zinc-500"
                      }`}
                    >
                      <span className="text-xs sm:text-sm leading-tight block">{STATUS_LABEL[s] ?? s}</span>
                      {current && <span className="text-[10px] text-[#00d4ff]/80 mt-1 block">aktuell</span>}
                    </div>
                  );
                })}
              </div>
              <div className="h-2.5 rounded-full bg-[#060b13] overflow-hidden border border-[#00d4ff]/20">
                <div
                  className="h-full bg-gradient-to-r from-[#00d4ff] to-[#9b59b6] transition-all duration-500"
                  style={{
                    width: `${((activeIndex + 1) / steps.length) * 100}%`,
                  }}
                />
              </div>
              <div className="rounded-xl bg-[#060b13]/80 border border-white/10 p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Aktueller Schritt</p>
                <p className="text-lg font-semibold text-white mb-3">{STATUS_LABEL[data.tracking.status] ?? data.tracking.status}</p>
                <p className="text-zinc-300 text-sm leading-relaxed">
                  {STATUS_ERKLAERUNG[data.tracking.status] ??
                    "Ihr Auftrag wird bearbeitet. Bei Fragen erreichen Sie uns jederzeit."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-white/10 bg-[#0a1220]/90 p-4">
                <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Bearbeitungszeit bisher</p>
                <p className="text-white text-lg font-mono">{formatElapsedSince(data.tracking.created_at)}</p>
                <p className="text-zinc-600 text-xs mt-2">Seit Auftrag vom {new Date(data.tracking.created_at).toLocaleString("de-DE")}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0a1220]/90 p-4">
                <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Letzte Aktualisierung</p>
                <p className="text-white text-sm">{new Date(data.tracking.updated_at).toLocaleString("de-DE")}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[#39ff14]/25 bg-[#0a1220]/95 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wide">Geschätzte Summe</p>
                <p className="font-mono text-2xl text-[#00d4ff]">{(data.tracking.total_cents / 100).toFixed(2)} €</p>
                <p className="text-zinc-500 text-xs mt-1">Zahlung: {paymentLabelDe(data.tracking.payment_status)}</p>
              </div>
              <div className="text-sm text-zinc-400 sm:text-right max-w-xs">
                Der endgültige Preis kann sich je nach Diagnose noch leicht ändern – Sie werden vor größeren Mehrkosten
                informiert.
              </div>
            </div>

            {(data.tracking.status === "fertig" || data.tracking.status === "abgeholt") &&
              data.tracking.payment_status === "offen" &&
              data.payment_due_until && (
                <div className="rounded-2xl border border-amber-500/40 bg-[#0a1220]/95 p-5 space-y-3">
                  <h2 className="text-sm font-bold text-amber-200 uppercase tracking-wider">Zahlung</h2>
                  {data.invoice_number && (
                    <p className="text-sm text-zinc-300">
                      Rechnungsnr. <span className="font-mono text-[#00d4ff]">{data.invoice_number}</span>
                    </p>
                  )}
                  <p className="text-sm text-zinc-300">
                    Bitte begleichen Sie den Betrag innerhalb von <strong className="text-white">7 Tagen</strong>.{" "}
                    {data.payment_bucket === "offen_ueberfaellig" ? (
                      <span className="text-red-400">Die Zahlungsfrist ist überschritten – bitte umgehend begleichen oder Rücksprache.</span>
                    ) : (
                      <span>
                        Fällig bis:{" "}
                        <strong className="text-white">
                          {new Date(data.payment_due_until.replace(" ", "T")).toLocaleString("de-DE", {
                            dateStyle: "long",
                            timeStyle: "short",
                          })}
                        </strong>
                      </span>
                    )}
                  </p>
                  {data.paymentTerms && (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs font-semibold text-amber-100/90 mb-2">{data.paymentTerms.headline}</p>
                      <ul className="text-xs text-zinc-400 space-y-1.5 list-disc list-inside leading-relaxed">
                        {data.paymentTerms.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

            {(data.tracking.status === "fertig" || data.tracking.status === "abgeholt") && (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/5 p-5">
                <h2 className="text-sm font-bold text-amber-200 uppercase tracking-wider mb-2">Abholung</h2>
                {data.tracking.status === "fertig" ? (
                  <>
                    <p className="text-zinc-200 text-sm mb-3">
                      Ihr Gerät ist <strong>abholbereit</strong>. Ein fester Abgabetermin liegt uns nicht vor – holen Sie
                      bitte zu den üblichen Zeiten ab oder rufen Sie kurz an.
                    </p>
                    <p className="text-zinc-300 text-sm">
                      <strong>{WERKSTATT.name}</strong>
                      <br />
                      {WERKSTATT.street}
                      <br />
                      {WERKSTATT.city}
                      <br />
                      Tel.{" "}
                      <a href={`tel:${WERKSTATT.phone}`} className="text-[#00d4ff] underline">
                        {WERKSTATT.phone}
                      </a>
                    </p>
                  </>
                ) : (
                  <p className="text-zinc-300 text-sm">
                    Abholung erledigt am {new Date(data.tracking.updated_at).toLocaleString("de-DE")} (letzte Statusänderung).
                  </p>
                )}
              </div>
            )}

            {data.message && (
              <p className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-cyan-100 text-sm leading-relaxed">
                {data.message}
              </p>
            )}

            {data.parts.length > 0 && (
              <div className="rounded-2xl border border-violet-500/25 bg-[#0a1220]/95 p-5">
                <p className="text-sm font-semibold text-violet-200 mb-3">Ersatzteile zu diesem Auftrag</p>
                <ul className="space-y-2">
                  {data.parts.map((p, i) => (
                    <li key={i} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 border-b border-white/10 pb-2 last:border-0 last:pb-0">
                      <span className="text-zinc-200">{p.name}</span>
                      <span className="text-zinc-400 text-sm">
                        {PART_STATUS[p.status] ?? p.status} · {(p.sale_cents / 100).toFixed(2)} €
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-center text-xs text-zinc-600">
              Fragen? Rufen Sie uns an:{" "}
              <a href={`tel:${WERKSTATT.phone}`} className="text-[#00d4ff]">
                {WERKSTATT.phone}
              </a>
            </p>
          </div>
        )}
      </div>
    </PublicTrackShell>
  );
}
