import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { formatDeBerlin } from "../lib/formatBerlin";
import { parseScanToTrackingCode } from "../lib/trackingScan";
import { REPAIR_STATUSES_EXCEPT_ABGEHOLT, repairStatusLabelDe } from "../lib/workshopRepairStatuses";
import { RtShell } from "../components/RtShell";
import { RepairSoundEnableButton } from "../components/RepairSoundEnableButton";
import { useBenchGate } from "../useBenchGate";
import { getWorkshopTokenRole } from "../workshopAuth";
import {
  observeRepairListForNewNotifications,
  primeRepairNotificationAudio,
  useNewRepairNotification,
  useNewRepairParty,
} from "../hooks/useNewRepairNotification";
import { useWorkshopCustomerAmendmentAttention } from "../hooks/useWorkshopCustomerAmendmentAttention";
import { NewRepairPartyOverlay } from "../components/NewRepairPartyOverlay";

type Row = {
  id: string;
  tracking_code: string;
  repair_order_number?: string | null;
  status: string;
  updated_at: string;
  created_at: string;
  is_test?: number | boolean;
  customer_amendment_count?: number | boolean;
  customer_name: string;
  device_type: string;
  brand: string | null;
  model: string | null;
};

type RepairLogRow = {
  id: string;
  timestamp: string;
  action_type: string;
  description: string;
  duration_minutes: number | null;
  created_by?: string;
};

type RepairDetailPayload = {
  repair: Record<string, unknown>;
  customer: { id?: string; name?: string; phone?: string | null } | null;
  device: Record<string, unknown> | null;
  services?: { code: string; name: string; category?: string }[];
  parts: { id: string; name: string; status: string; barcode?: string | null }[];
  logs?: RepairLogRow[];
};

const START_STATUSES = ["angenommen", "diagnose", "wartet_auf_teile", "teilgeliefert"] as const;

const PART_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "bestellt", label: "Bestellt" },
  { value: "unterwegs", label: "Unterwegs" },
  { value: "angekommen", label: "Angekommen" },
  { value: "vor_ort", label: "Vor Ort / Lager" },
  { value: "eingebaut", label: "Eingebaut" },
];

const LOG_ACTION_PRESETS = [
  "Diagnose durchgeführt",
  "Reparatur durchgeführt",
  "Kunde informiert",
  "Ersatzteil bestellt / bearbeitet",
  "Software / Einrichtung",
] as const;

/** Detailansicht automatisch schließen (gemeinsames Tablet). */
const WORKSHOP_DETAIL_AUTO_CLOSE_MS = 30_000;

export function WorkshopBench() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout, noBenchHint } = useBenchGate();

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<RepairDetailPayload | null>(null);
  const [scanField, setScanField] = useState("");
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const scanConsumedRef = useRef<string | null>(null);

  const [partName, setPartName] = useState("");
  const [newPartStatus, setNewPartStatus] = useState<"bestellt" | "vor_ort">("bestellt");
  const [logPreset, setLogPreset] = useState<string>(LOG_ACTION_PRESETS[0]);
  const [logCustomAction, setLogCustomAction] = useState("");
  const [logDescription, setLogDescription] = useState("");
  const [logDuration, setLogDuration] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const refresh = useCallback(async (): Promise<Row[] | undefined> => {
    try {
      const data = await fetchWorkshop<Row[]>("/api/repairs");
      setRows(data);
      observeRepairListForNewNotifications(data);
      return data;
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (gate === "ok") void refresh();
  }, [gate, refresh]);

  useNewRepairNotification({ gate, refresh });
  const { highlightIds, partyActive } = useNewRepairParty();
  const { hasUnackedAmendment, acknowledgeAmendmentsForRepair } = useWorkshopCustomerAmendmentAttention(rows);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${id}`);
      setDetail(d);
    } catch (e) {
      console.error(e);
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void loadDetail(selected.id);
  }, [selected, loadDetail]);

  useEffect(() => {
    if (!selected || !detail) return;
    acknowledgeAmendmentsForRepair(selected.id);
  }, [selected?.id, detail, rows, acknowledgeAmendmentsForRepair]);

  useEffect(() => {
    if (!selected) return;
    const t = window.setTimeout(() => {
      setSelected(null);
    }, WORKSHOP_DETAIL_AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [selected?.id]);

  const openRepairByTrackingCode = useCallback(
    async (raw: string): Promise<boolean> => {
      const code = parseScanToTrackingCode(raw);
      if (!code) {
        setScanErr("Ungültiger Code oder Link.");
        return false;
      }
      setScanErr(null);
      try {
        const row = await fetchWorkshop<{ id: string; tracking_code: string; status: string }>(
          `/api/repairs/by-tracking/${encodeURIComponent(code)}`
        );
        const list = (await refresh()) ?? [];
        let fromList = list.find((r) => r.id === row.id);
        if (START_STATUSES.includes(row.status as (typeof START_STATUSES)[number])) {
          await fetchWorkshop(`/api/repairs/${row.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: "in_reparatur" }),
          });
          const list2 = (await refresh()) ?? [];
          fromList = list2.find((r) => r.id === row.id);
        }
        if (fromList) {
          setSelected(fromList);
          return true;
        }
        setScanErr("Auftrag nicht in der Liste.");
        return false;
      } catch (e) {
        setScanErr(String(e));
        return false;
      }
    },
    [refresh]
  );

  useEffect(() => {
    if (gate !== "ok") return;
    const raw = searchParams.get("scan");
    if (!raw) {
      scanConsumedRef.current = null;
      return;
    }
    if (scanConsumedRef.current === raw) return;
    scanConsumedRef.current = raw;
    let cancelled = false;
    void (async () => {
      try {
        let decoded = raw;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          decoded = raw;
        }
        await openRepairByTrackingCode(decoded);
      } finally {
        if (!cancelled) setSearchParams({}, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gate, searchParams, setSearchParams, openRepairByTrackingCode]);

  const setStatus = async (id: string, status: string) => {
    setStatusBusy(true);
    try {
      await fetchWorkshop(`/api/repairs/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      const list = await refresh();
      if (status === "fertig") {
        setSelected(null);
        setDetail(null);
        return;
      }
      if (selected?.id === id && list) {
        const row = list.find((r) => r.id === id);
        if (row) setSelected(row);
      }
      await loadDetail(id);
    } catch (e) {
      alert(String(e));
    } finally {
      setStatusBusy(false);
    }
  };

  const submitLog = async () => {
    if (!selected) return;
    const action = logPreset === "__custom__" ? logCustomAction.trim() : logPreset;
    if (!action || !logDescription.trim()) {
      alert("Tätigkeit und Beschreibung ausfüllen.");
      return;
    }
    setLogBusy(true);
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/log`, {
        method: "POST",
        body: JSON.stringify({
          action_type: action,
          description: logDescription.trim(),
          duration_minutes: logDuration.trim() === "" ? undefined : Number(logDuration),
        }),
      });
      setLogDescription("");
      setLogDuration("");
      setLogCustomAction("");
      await loadDetail(selected.id);
    } catch (e) {
      alert(String(e));
    } finally {
      setLogBusy(false);
    }
  };

  const addPart = async () => {
    if (!selected || !partName.trim()) return;
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/parts`, {
        method: "POST",
        body: JSON.stringify({ name: partName.trim(), status: newPartStatus, purchase_cents: 0, sale_cents: 0 }),
      });
      setPartName("");
      await loadDetail(selected.id);
      const list = await refresh();
      if (list) {
        const row = list.find((r) => r.id === selected.id);
        if (row) setSelected(row);
      }
    } catch (e) {
      alert(String(e));
    }
  };

  const patchPartStatus = async (partId: string, status: string) => {
    if (!selected) return;
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/parts/${partId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadDetail(selected.id);
      const list = await refresh();
      if (list) {
        const row = list.find((r) => r.id === selected.id);
        if (row) setSelected(row);
      }
    } catch (e) {
      alert(String(e));
    }
  };

  if (getWorkshopTokenRole() === "workshop") {
    return <Navigate to="/werkstatt" replace />;
  }

  const repairStatus = selected?.status ?? "";
  const canLog = repairStatus === "in_reparatur";
  const canFertig = repairStatus === "in_reparatur" && (detail?.logs?.length ?? 0) > 0;

  if (gate === "loading") {
    return (
      <RtShell title="Montage-Tablet" subtitle="Laden…">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "no_bench") {
    return (
      <RtShell title="Montage-Tablet" subtitle="Nicht verfügbar">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <p className="text-sm text-zinc-300">{noBenchHint}</p>
        </div>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Montage-Tablet" subtitle="Anmeldung">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <form
            onSubmit={(e) => {
              primeRepairNotificationAudio();
              void tryLogin(e);
            }}
            className="space-y-4"
          >
            <p className="text-sm text-zinc-400">
              Passwort für das zweite Tablet (Umgebungsvariable <span className="font-mono">RABBIT_BENCH_PASSWORD</span>).
              Keine Preise oder Buchhaltung.
            </p>
            <div>
              <label className="rt-label-neon">Montage-Passwort</label>
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
      title="Montage-Tablet"
      subtitle="Offene Aufträge · ohne Preise"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <RepairSoundEnableButton />
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <NewRepairPartyOverlay active={partyActive} />
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rt-panel rt-panel-cyan min-h-[200px]">
          <h2 className="text-sm font-bold text-white mb-3 tracking-wide">Offene Aufträge</h2>
          <div className="mb-3 space-y-1">
            <label className="block text-[11px] uppercase tracking-wide text-cyan-200/80">Label / QR scannen</label>
            <input
              className="rt-input-neon font-mono text-sm w-full"
              placeholder="https://…/track/… oder RT-…"
              value={scanField}
              onChange={(e) => {
                setScanField(e.target.value);
                setScanErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const v = scanField;
                void (async () => {
                  if (await openRepairByTrackingCode(v)) setScanField("");
                })();
              }}
              autoComplete="off"
              autoFocus
            />
            {scanErr && <p className="text-xs text-red-400">{scanErr}</p>}
            <p className="text-[10px] text-zinc-500">Scan setzt den Auftrag auf „In Reparatur“, wenn er noch wartet.</p>
          </div>
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                  highlightIds.has(r.id)
                    ? "animate-rt-party-row "
                    : hasUnackedAmendment(r.id)
                      ? "animate-rt-amendment-row "
                      : ""
                }${
                  selected?.id === r.id
                    ? "border-[#39ff14]/60 bg-[#39ff14]/10 shadow-[0_0_20px_rgba(57,255,20,0.15)]"
                    : "border-[#00d4ff]/20 bg-[#060b13]/60 hover:border-[#00d4ff]/40"
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-[#00d4ff] flex flex-wrap items-center gap-1">
                    {r.is_test ? <span className="text-red-400 font-bold mr-1 text-[10px] uppercase">Test</span> : null}
                    {Number(r.customer_amendment_count ?? 0) > 0 ? (
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/25 border border-amber-400/60 text-amber-200 shrink-0"
                        title={
                          hasUnackedAmendment(r.id)
                            ? "Neuer Nachtrag aus der Annahme – Zeile blinkt bis zur Ansicht"
                            : "Kundennachtrag / Zusatz aus der Annahme dokumentiert"
                        }
                        aria-label="Kundennachtrag dokumentiert"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                        </svg>
                      </span>
                    ) : null}
                    {r.tracking_code}
                    {r.repair_order_number ? (
                      <span className="block text-[10px] text-zinc-500 font-mono mt-0.5">{r.repair_order_number}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-amber-300/90">{repairStatusLabelDe(r.status)}</span>
                </div>
                <p className="text-sm text-zinc-300 mt-1">
                  {r.customer_name} · {r.device_type} {[r.brand, r.model].filter(Boolean).join(" ")}
                </p>
              </button>
            ))}
            {rows.length === 0 && <p className="text-zinc-500 text-sm">Keine offenen Aufträge.</p>}
          </div>
        </section>

        <section className="rt-panel rt-panel-violet min-h-[320px]">
          {!selected && <p className="text-zinc-500">Auftrag wählen oder scannen.</p>}
          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-between gap-2 items-start">
                <h2 className="font-display font-bold text-lg text-[#00d4ff]">
                  {selected.is_test && (
                    <span className="rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 text-[10px] font-bold text-red-300 uppercase tracking-wider mr-2">
                      Test
                    </span>
                  )}
                  {selected.tracking_code}
                </h2>
                <Link to={`/track/${selected.tracking_code}`} className="text-sm text-[#39ff14] underline underline-offset-2">
                  Öffentliche Ansicht
                </Link>
              </div>

              <div>
                <p className="rt-label-neon mb-2">Status</p>
                <div className="flex flex-wrap gap-2">
                  {REPAIR_STATUSES_EXCEPT_ABGEHOLT.map((s) => {
                    const isCurrent = selected.status === s;
                    const disabledFertig = s === "fertig" && !canFertig;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={statusBusy || disabledFertig}
                        title={
                          s === "fertig" && !canFertig
                            ? repairStatus === "in_reparatur"
                              ? "Zuerst Arbeitsprotokoll (Tätigkeit + Beschreibung) speichern"
                              : "„Fertig“ nur nach „In Reparatur“ mit Protokolleintrag"
                            : undefined
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                          isCurrent
                            ? "border-[#39ff14] text-[#39ff14] bg-[#39ff14]/10"
                            : disabledFertig
                              ? "border-zinc-600 text-zinc-600 cursor-not-allowed"
                              : "border-[#00d4ff]/25 text-zinc-400 hover:border-[#00d4ff]/50"
                        }`}
                        onClick={() => void setStatus(selected.id, s)}
                      >
                        {repairStatusLabelDe(s)}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  Abholung („Abgeholt“) und Zahlung nur an der vollen Werkstatt. Arbeitsprotokoll nur während „In
                  Reparatur“. Label-Scan setzt weiterhin „In Reparatur“, wenn der Auftrag noch wartet.
                </p>
              </div>

              {!detail && <p className="text-sm text-zinc-500">Details werden geladen…</p>}
              {detail && (
                <>
                  <div className="rounded-xl border border-white/10 bg-[#060b13]/80 px-3 py-3 space-y-2 text-sm">
                    <p className="text-xs font-semibold text-zinc-500 uppercase">Kunde & Gerät</p>
                    <p className="text-white">
                      <span className="text-zinc-400">Kunde:</span> {detail.customer?.name ?? "—"}
                    </p>
                    <p className="text-zinc-200">
                      {String(detail.device?.device_type ?? "")}{" "}
                      {[detail.device?.brand, detail.device?.model].filter(Boolean).join(" ")}
                    </p>
                    {detail.repair.problem_label ? (
                      <p>
                        <span className="text-zinc-500 text-xs block">Anliegen (Kategorie)</span>
                        <span className="text-zinc-200">{String(detail.repair.problem_label)}</span>
                      </p>
                    ) : null}
                    {detail.repair.description ? (
                      <p>
                        <span className="text-zinc-500 text-xs block">Beschreibung / Fehlerbild</span>
                        <span className="text-zinc-300 whitespace-pre-wrap">{String(detail.repair.description)}</span>
                      </p>
                    ) : null}
                    {detail.repair.accessories ? (
                      <p>
                        <span className="text-zinc-500 text-xs block">Zubehör</span>
                        <span className="text-zinc-300">{String(detail.repair.accessories)}</span>
                      </p>
                    ) : null}
                    {detail.repair.pre_damage_notes ? (
                      <p>
                        <span className="text-zinc-500 text-xs block">Vorschäden</span>
                        <span className="text-zinc-300 whitespace-pre-wrap">{String(detail.repair.pre_damage_notes)}</span>
                      </p>
                    ) : null}
                  </div>

                  {detail.services && detail.services.length > 0 && (
                    <div className="rounded-xl border border-cyan-500/20 px-3 py-2">
                      <p className="text-[11px] uppercase text-cyan-200/80 mb-1">Gebuchte Leistungen (ohne Preis)</p>
                      <ul className="text-sm text-zinc-300 space-y-0.5">
                        {detail.services.map((s) => (
                          <li key={s.code}>
                            {s.name}{" "}
                            <span className="text-zinc-600 text-xs">({s.category ?? "—"})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-semibold text-violet-300 mb-2">Ersatzteile</p>
                    <ul className="space-y-2 mb-3">
                      {detail.parts.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm border border-white/10 rounded-lg px-2 py-2">
                          <span className="text-zinc-200 flex-1 min-w-[120px]">{p.name}</span>
                          <select
                            className="rt-input-neon !min-h-[40px] text-xs flex-1 min-w-[140px]"
                            value={p.status}
                            onChange={(e) => void patchPartStatus(p.id, e.target.value)}
                          >
                            {PART_STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                      {detail.parts.length === 0 && <li className="text-xs text-zinc-500">Noch keine Teile.</li>}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <input
                        className="rt-input-neon flex-1 min-w-[160px]"
                        placeholder="Neues Teil"
                        value={partName}
                        onChange={(e) => setPartName(e.target.value)}
                      />
                      <select
                        className="rt-input-neon !min-h-[44px] w-40"
                        value={newPartStatus}
                        onChange={(e) => setNewPartStatus(e.target.value as "bestellt" | "vor_ort")}
                      >
                        <option value="bestellt">Bestellt</option>
                        <option value="vor_ort">Vor Ort</option>
                      </select>
                      <button type="button" className="rt-btn-confirm px-4 min-h-[44px]" onClick={() => void addPart()}>
                        Teil
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-violet-500/25 bg-violet-950/20 px-3 py-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-200/90">Arbeitsprotokoll</p>
                    <ul className="space-y-2 max-h-[180px] overflow-y-auto text-sm text-zinc-300 pr-1">
                      {(detail.logs ?? []).length === 0 ? (
                        <li className="text-xs text-zinc-500">Noch keine Einträge.</li>
                      ) : (
                        [...(detail.logs ?? [])]
                          .slice()
                          .reverse()
                          .map((lg) => (
                            <li key={lg.id} className="border-b border-white/5 pb-2">
                              <p className="text-[11px] text-zinc-500 font-mono">
                                {formatDeBerlin(lg.timestamp, { dateStyle: "short", timeStyle: "short" })}
                              </p>
                              <p className="text-violet-200/95 font-medium flex flex-wrap items-center gap-2">
                                {lg.action_type}
                                {lg.created_by === "annahme" ? (
                                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-400/50 text-amber-200/95 bg-amber-500/15">
                                    Annahme
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-zinc-400 text-xs whitespace-pre-wrap">{lg.description}</p>
                            </li>
                          ))
                      )}
                    </ul>
                    {canLog ? (
                      <div className="space-y-2 pt-2 border-t border-white/10">
                        <select
                          className="rt-input-neon w-full !min-h-[44px]"
                          value={logPreset}
                          onChange={(e) => setLogPreset(e.target.value)}
                        >
                          {LOG_ACTION_PRESETS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                          <option value="__custom__">Sonstiges</option>
                        </select>
                        {logPreset === "__custom__" && (
                          <input
                            className="rt-input-neon w-full"
                            placeholder="Kurzbezeichnung"
                            value={logCustomAction}
                            onChange={(e) => setLogCustomAction(e.target.value)}
                          />
                        )}
                        <textarea
                          className="rt-input-neon w-full min-h-[72px] text-sm resize-y"
                          placeholder="Was wurde gemacht?"
                          value={logDescription}
                          onChange={(e) => setLogDescription(e.target.value)}
                          rows={3}
                        />
                        <input
                          className="rt-input-neon w-full font-mono text-sm"
                          placeholder="Dauer Min. (optional)"
                          value={logDuration}
                          onChange={(e) => setLogDuration(e.target.value)}
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          className="rt-btn-confirm w-full min-h-[44px] text-sm disabled:opacity-50"
                          disabled={logBusy}
                          onClick={() => void submitLog()}
                        >
                          {logBusy ? "Speichern…" : "Protokoll speichern"}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 pt-2">Protokoll ist erst bei Status „In Reparatur“ möglich.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </RtShell>
  );
}
