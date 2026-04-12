import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { formatDeBerlin, formatDeBerlinDateOnly } from "../lib/formatBerlin";
import { parseScanToTrackingCode } from "../lib/trackingScan";
import { RtShell } from "../components/RtShell";
import { TapToPayPhoneAnimation } from "../components/TapToPayPhoneAnimation";
import { RepairSoundEnableButton } from "../components/RepairSoundEnableButton";
import { useWorkshopGate } from "../useWorkshopGate";
import { getWorkshopTokenRole } from "../workshopAuth";
import {
  observeRepairListForNewNotifications,
  primeRepairNotificationAudio,
  useNewRepairNotification,
} from "../hooks/useNewRepairNotification";

type Row = {
  id: string;
  tracking_code: string;
  repair_order_number?: string | null;
  status: string;
  total_cents: number;
  payment_status: string;
  payment_method?: string | null;
  sumup_channel?: string | null;
  payment_due_at: string | null;
  updated_at: string;
  created_at: string;
  is_test?: number | boolean;
  customer_name: string;
  device_type: string;
  brand: string | null;
  model: string | null;
};

const STATUSES = [
  "angenommen",
  "diagnose",
  "wartet_auf_teile",
  "teilgeliefert",
  "in_reparatur",
  "fertig",
  "abgeholt",
];

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
  services?: { code: string; name: string; price_cents: number; category?: string }[];
  logs?: RepairLogRow[];
  parts: {
    id: string;
    name: string;
    status: string;
    sale_cents: number;
    purchase_cents: number;
    barcode?: string | null;
  }[];
  revenue_breakdown?: {
    teile_cents: number;
    leistungen_cents: number;
    anfahrt_cents: number;
    by_category: { category_key: string; category_label_de: string; cents: number }[];
  };
};

function euroFromCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

const LOG_ACTION_PRESETS = [
  "Diagnose durchgeführt",
  "Reparatur durchgeführt",
  "Kunde informiert",
  "Ersatzteil bestellt / bearbeitet",
  "Software / Einrichtung",
] as const;

/** Nach Abholung (Status `abgeholt`) nicht mehr in der Werkstatt-Liste. */
function workshopListRows(data: Row[]): Row[] {
  return data.filter((r) => r.status !== "abgeholt");
}

/** Rahmenfarbe nach Status: neu rot, Diagnose blau, in Reparatur türkis, Teile gelb, fertig grün. */
function workshopListRowClass(status: string, isSelected: boolean): string {
  const byStatus: Record<string, string> = {
    angenommen: "border-red-500/90 bg-red-950/35 hover:border-red-400",
    diagnose: "border-blue-500/90 bg-blue-950/30 hover:border-blue-400",
    in_reparatur: "border-cyan-400/90 bg-cyan-950/30 hover:border-cyan-300",
    wartet_auf_teile: "border-amber-400/90 bg-amber-950/30 hover:border-amber-300",
    teilgeliefert: "border-amber-400/90 bg-amber-950/30 hover:border-amber-300",
    fertig: "border-emerald-500/90 bg-emerald-950/30 hover:border-emerald-400",
  };
  const base = byStatus[status] ?? "border-zinc-600/70 bg-[#060b13]/70 hover:border-zinc-500";
  const selectedRing = isSelected
    ? " ring-2 ring-[#39ff14] ring-offset-2 ring-offset-[#060b13] shadow-[0_0_22px_rgba(57,255,20,0.22)]"
    : "";
  return `border-2 ${base}${selectedRing}`;
}

export function Workshop({ pageTitle = "Auftragsverwaltung" }: { pageTitle?: string }) {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<RepairDetailPayload | null>(null);
  const [partName, setPartName] = useState("");
  const [sale, setSale] = useState("");
  const [buy, setBuy] = useState("");
  const [newPartStatus, setNewPartStatus] = useState<"bestellt" | "vor_ort">("bestellt");
  const [newPartBarcode, setNewPartBarcode] = useState("");
  const [pickupOpen, setPickupOpen] = useState(false);
  const [sumupStep, setSumupStep] = useState<"qr" | "tap" | null>(null);
  const [sumupData, setSumupData] = useState<{
    sumupUrl?: string;
    payment_url?: string;
    qrDataUrl?: string;
    hint: string;
  } | null>(null);
  const [pickupErr, setPickupErr] = useState<string | null>(null);
  const [pdfRegenBusy, setPdfRegenBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [scanField, setScanField] = useState("");
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [logPreset, setLogPreset] = useState<string>(LOG_ACTION_PRESETS[0]);
  const [logCustomAction, setLogCustomAction] = useState("");
  const [logDescription, setLogDescription] = useState("");
  const [logDuration, setLogDuration] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const scanConsumedRef = useRef<string | null>(null);

  const PART_STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "bestellt", label: "Bestellt" },
    { value: "unterwegs", label: "Unterwegs" },
    { value: "angekommen", label: "Angekommen" },
    { value: "vor_ort", label: "Bereits vor Ort / Lager" },
    { value: "eingebaut", label: "Eingebaut" },
  ];

  const refresh = useCallback(async (): Promise<Row[] | undefined> => {
    try {
      const data = await fetchWorkshop<Row[]>("/api/repairs");
      const next = workshopListRows(data);
      setRows(next);
      observeRepairListForNewNotifications(next);
      return next;
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "WORKSHOP_AUTH" || err.message === "Anmeldung erforderlich") {
        logout();
      } else {
        console.error(e);
      }
      return undefined;
    }
  }, [logout]);

  useEffect(() => {
    if (gate === "ok") void refresh();
  }, [gate, refresh]);

  useNewRepairNotification({ gate, refresh });

  const openRepairByTrackingCode = useCallback(
    async (raw: string): Promise<boolean> => {
      const code = parseScanToTrackingCode(raw);
      if (!code) {
        setScanErr("Ungültiger Code oder Link.");
        return false;
      }
      setScanErr(null);
      try {
        const row = await fetchWorkshop<{ id: string; tracking_code: string }>(
          `/api/repairs/by-tracking/${encodeURIComponent(code)}`
        );
        const list = (await refresh()) ?? [];
        const fromList = list.find((r) => r.id === row.id);
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

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`)
      .then(setDetail)
      .catch((e) => {
        const err = e as Error & { code?: string };
        if (err.code === "WORKSHOP_AUTH") logout();
        else console.error(e);
      });
  }, [selected, logout]);

  const setStatus = async (id: string, status: string) => {
    await fetchWorkshop(`/api/repairs/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    const list = await refresh();
    if (selected?.id === id && list) {
      const row = list.find((r) => r.id === id);
      if (row) setSelected(row);
      else {
        setSelected(null);
        setDetail(null);
      }
    }
  };

  const addPart = async () => {
    if (!selected || !partName.trim()) return;
    await fetchWorkshop(`/api/repairs/${selected.id}/parts`, {
      method: "POST",
      body: JSON.stringify({
        name: partName,
        status: newPartStatus,
        sale_cents: Math.round(parseFloat(sale.replace(",", ".")) * 100) || 0,
        purchase_cents: Math.round(parseFloat(buy.replace(",", ".")) * 100) || 0,
        ...(newPartBarcode.trim() ? { barcode: newPartBarcode.trim() } : {}),
      }),
    });
    setPartName("");
    setSale("");
    setBuy("");
    setNewPartStatus("bestellt");
    setNewPartBarcode("");
    const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`);
    setDetail(d);
    await refresh();
  };

  const updatePartStatus = async (partId: string, status: string) => {
    if (!selected) return;
    await fetchWorkshop(`/api/repairs/${selected.id}/parts/${partId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`);
    setDetail(d);
    await refresh();
  };

  const savePartBarcode = async (partId: string, raw: string) => {
    if (!selected || !detail) return;
    const v = raw.trim();
    const p = detail.parts.find((x) => x.id === partId);
    if (!p) return;
    if (v === (p.barcode ?? "").trim()) return;
    await fetchWorkshop(`/api/repairs/${selected.id}/parts/${partId}`, {
      method: "PATCH",
      body: JSON.stringify({ barcode: v || null }),
    });
    const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`);
    setDetail(d);
    await refresh();
  };

  const setPaymentStatus = async (payment_status: "offen" | "bezahlt") => {
    if (!selected) return;
    await fetchWorkshop(`/api/repairs/${selected.id}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ payment_status }),
    });
    await refresh();
    setSelected((prev) => (prev ? { ...prev, payment_status } : null));
    const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`);
    setDetail(d);
  };

  const regenerateRepairOrderPdf = async () => {
    if (!selected) return;
    setPdfRegenBusy(true);
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/repair-order-pdf`, {
        method: "POST",
        body: "{}",
        skipQueue: true,
      });
      const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`);
      setDetail(d);
      await refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setPdfRegenBusy(false);
    }
  };

  const reloadSelectedFromServer = async (repairId: string) => {
    const list = await fetchWorkshop<Row[]>("/api/repairs");
    const visible = workshopListRows(list);
    setRows(visible);
    observeRepairListForNewNotifications(visible);
    const next = visible.find((x) => x.id === repairId);
    if (next) {
      setSelected(next);
      const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${repairId}`);
      setDetail(d);
    } else {
      setSelected(null);
      setDetail(null);
    }
  };

  const submitLog = async () => {
    if (!selected) return;
    const action_type = logPreset === "__custom__" ? logCustomAction.trim() : logPreset;
    const description = logDescription.trim();
    if (!action_type || !description) return;
    setLogBusy(true);
    try {
      const body: { action_type: string; description: string; duration_minutes?: number } = {
        action_type,
        description,
      };
      if (logDuration.trim()) {
        const n = Number(logDuration.replace(",", "."));
        if (Number.isFinite(n) && n >= 0) body.duration_minutes = Math.round(n);
      }
      await fetchWorkshop(`/api/repairs/${selected.id}/log`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setLogDescription("");
      setLogDuration("");
      if (logPreset === "__custom__") setLogCustomAction("");
      const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${selected.id}`);
      setDetail(d);
    } catch (e) {
      alert(String(e));
    } finally {
      setLogBusy(false);
    }
  };

  const closePickupModal = () => {
    setPickupOpen(false);
    setSumupStep(null);
    setSumupData(null);
    setPickupErr(null);
  };

  const doPickupBarOrUeberweisung = async (type: "bar" | "ueberweisung") => {
    if (!selected) return;
    setPickupErr(null);
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/pickup`, {
        method: "POST",
        body: JSON.stringify({ type }),
      });
      closePickupModal();
      await reloadSelectedFromServer(selected.id);
    } catch (e) {
      setPickupErr(String(e));
    }
  };

  const startSumupLink = async () => {
    if (!selected) return;
    setPickupErr(null);
    try {
      const r = await fetchWorkshop<{
        sumupUrl?: string;
        payment_url?: string;
        qrDataUrl?: string;
        hint: string;
      }>(`/api/repairs/${selected.id}/pickup`, { method: "POST", body: JSON.stringify({ type: "sumup_link" }) });
      setSumupData(r);
      setSumupStep("qr");
    } catch (e) {
      setPickupErr(String(e));
    }
  };

  /** SumUp Online: Webhook-Fallback – Checkout-Status per API (alle 45 s + sofort beim QR-Schritt). */
  useEffect(() => {
    if (!pickupOpen || sumupStep !== "qr" || !selected?.id) return;
    const repairId = selected.id;
    const syncOnce = async () => {
      try {
        const out = await fetchWorkshop<{ updated: boolean }>(`/api/repairs/${repairId}/sumup-sync`);
        if (out.updated) {
          setPickupOpen(false);
          setSumupStep(null);
          setSumupData(null);
          setPickupErr(null);
          const list = await fetchWorkshop<Row[]>("/api/repairs");
          const visible = workshopListRows(list);
          setRows(visible);
          observeRepairListForNewNotifications(visible);
          const next = visible.find((x) => x.id === repairId);
          if (next) {
            setSelected(next);
            const d = await fetchWorkshop<RepairDetailPayload>(`/api/repairs/${repairId}`);
            setDetail(d);
          } else {
            setSelected(null);
            setDetail(null);
          }
        }
      } catch {
        /* z. B. SumUp nicht konfiguriert */
      }
    };
    void syncOnce();
    const t = window.setInterval(() => void syncOnce(), 45_000);
    return () => window.clearInterval(t);
  }, [pickupOpen, sumupStep, selected?.id]);

  const startSumupTapToPay = () => {
    setPickupErr(null);
    setSumupStep("tap");
  };

  const completeSumupPickup = async (opts?: { tapToPayManual?: boolean }) => {
    if (!selected) return;
    setPickupErr(null);
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/pickup`, {
        method: "POST",
        body: JSON.stringify({
          type: "sumup_complete",
          ...(opts?.tapToPayManual ? { sumup_channel: "tap_to_pay" } : {}),
        }),
      });
      closePickupModal();
      await reloadSelectedFromServer(selected.id);
    } catch (e) {
      setPickupErr(String(e));
    }
  };

  if (getWorkshopTokenRole() === "bench") {
    return <Navigate to="/werkstatt-montage" replace />;
  }

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
          <form
            onSubmit={(e) => {
              primeRepairNotificationAudio();
              void tryLogin(e);
            }}
            className="space-y-4"
          >
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <RepairSoundEnableButton />
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rt-panel rt-panel-cyan min-h-[200px]">
          <h2 className="text-sm font-bold text-white mb-3 tracking-wide">Auftragsliste</h2>
          <div className="mb-3 space-y-1">
            <label className="block text-[11px] uppercase tracking-wide text-cyan-200/80">QR / Tracking (Scanner)</label>
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
            />
            {scanErr && <p className="text-xs text-red-400">{scanErr}</p>}
          </div>
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className={`w-full text-left rounded-xl px-4 py-3 transition-all ${workshopListRowClass(r.status, selected?.id === r.id)}`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-[#00d4ff]">
                    {r.is_test ? <span className="text-red-400 font-bold mr-1 text-[10px] uppercase">Test</span> : null}
                    {r.tracking_code}
                    {r.repair_order_number ? (
                      <span className="block text-[10px] text-zinc-500 font-mono mt-0.5">{r.repair_order_number}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-amber-300/90">{r.status.replace(/_/g, " ")}</span>
                </div>
                <p className="text-sm text-zinc-300 mt-1">
                  {r.customer_name} · {r.device_type} {[r.brand, r.model].filter(Boolean).join(" ")}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {(r.total_cents / 100).toFixed(2)} € ·{" "}
                  {r.payment_status === "bezahlt" ? (
                    <span className="text-emerald-400/90">bezahlt</span>
                  ) : (
                    <span className="text-amber-300/90">offen</span>
                  )}
                  {(r.status === "fertig" || r.status === "abgeholt") && r.payment_status === "offen" && r.payment_due_at && (
                    <span className="text-zinc-600"> · bis {formatDeBerlinDateOnly(r.payment_due_at)}</span>
                  )}
                  {r.payment_method && (r.status === "fertig" || r.status === "abgeholt") && (
                    <span className="text-zinc-600">
                      {" "}
                      ·{" "}
                      {r.payment_method === "ueberweisung"
                        ? "Überweisung"
                        : r.payment_method === "sumup"
                          ? r.sumup_channel === "tap_to_pay" || r.sumup_channel === "terminal"
                            ? "Tap to Pay (Handy)"
                            : "SumUp (Online)"
                          : r.payment_method === "bar"
                            ? "Bar"
                            : r.payment_method}
                    </span>
                  )}
                </p>
              </button>
            ))}
            {rows.length === 0 && <p className="text-zinc-500 text-sm">Noch keine Aufträge.</p>}
          </div>
        </section>

        <section className="rt-panel rt-panel-violet min-h-[320px]">
          {!selected && <p className="text-zinc-500">Auftrag in der Liste wählen.</p>}
          {selected && (
            <div className="space-y-5">
              <div className="flex flex-wrap justify-between gap-2 items-start">
                <h2 className="font-display font-bold text-lg text-[#00d4ff]">
                  {selected.is_test && <span className="rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 text-[10px] font-bold text-red-300 uppercase tracking-wider mr-2">Test</span>}
                  {selected.tracking_code}
                  {selected.repair_order_number && (
                    <span className="block text-xs font-mono text-zinc-400 font-normal mt-1">{selected.repair_order_number}</span>
                  )}
                </h2>
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
              {selected.status === "fertig" && (
                <div className="rounded-xl border border-[#39ff14]/35 bg-[#39ff14]/5 p-4">
                  <p className="text-sm font-semibold text-[#39ff14] mb-2">Abholung &amp; Zahlung</p>
                  <p className="text-xs text-zinc-500 mb-3">
                    Sobald der Kunde das Gerät abholt: Zahlungsart wählen (Bar, SumUp online, Tap to Pay oder
                    Überweisung). Die
                    Rechnung-PDF passt sich automatisch an.
                  </p>
                  <button
                    type="button"
                    className="rt-btn-confirm w-full min-h-[48px] text-base"
                    onClick={() => {
                      setPickupErr(null);
                      setSumupStep(null);
                      setSumupData(null);
                      setPickupOpen(true);
                    }}
                  >
                    Kunde holt Gerät ab – Zahlungsart wählen
                  </button>
                </div>
              )}
              {!detail && (
                <p className="text-sm text-zinc-500 border border-white/10 rounded-lg px-3 py-2">Auftragsdetails werden geladen…</p>
              )}
              {detail && (
                <>
              <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3 py-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">Leistungen & Summen</p>
                {detail.services && detail.services.length > 0 ? (
                  <ul className="space-y-1 text-sm text-zinc-300">
                    {detail.services.map((s) => (
                      <li key={s.code} className="flex justify-between gap-2">
                        <span>{s.name}</span>
                        <span className="font-mono text-[#00d4ff]/90 shrink-0">{euroFromCents(s.price_cents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-zinc-500">Keine Leistungszeilen gebucht.</p>
                )}
                {detail.revenue_breakdown && (
                  <div className="pt-2 border-t border-white/10 space-y-1.5 text-xs text-zinc-400">
                    <div className="flex justify-between gap-2">
                      <span>Dienstleistungen (ohne Anfahrt)</span>
                      <span className="font-mono text-zinc-200">{euroFromCents(detail.revenue_breakdown.leistungen_cents)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Anfahrt & Wege</span>
                      <span className="font-mono text-zinc-200">{euroFromCents(detail.revenue_breakdown.anfahrt_cents)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Teile (Verkauf)</span>
                      <span className="font-mono text-zinc-200">{euroFromCents(detail.revenue_breakdown.teile_cents)}</span>
                    </div>
                    {detail.revenue_breakdown.by_category.length > 0 && (
                      <div className="pt-2 mt-1 border-t border-white/5">
                        <p className="text-[10px] uppercase text-zinc-500 mb-1">Nach Kategorie</p>
                        <ul className="space-y-0.5">
                          {detail.revenue_breakdown.by_category.map((c) => (
                            <li key={c.category_key} className="flex justify-between gap-2">
                              <span>{c.category_label_de}</span>
                              <span className="font-mono text-zinc-300">{euroFromCents(c.cents)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {typeof detail.repair.total_cents === "number" && (
                  <p className="text-[10px] text-zinc-500 pt-1">
                    Auftragssumme laut Karte:{" "}
                    <span className="font-mono text-emerald-200/90">{euroFromCents(detail.repair.total_cents as number)}</span>
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-violet-500/25 bg-violet-950/20 px-3 py-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-200/90">Arbeitsprotokoll</p>
                <ul className="space-y-2 max-h-[220px] overflow-y-auto text-sm text-zinc-300 pr-1">
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
                            {lg.duration_minutes != null ? ` · ${lg.duration_minutes} Min.` : ""}
                          </p>
                          <p className="text-violet-200/95 font-medium">{lg.action_type}</p>
                          <p className="text-zinc-400 text-xs whitespace-pre-wrap">{lg.description}</p>
                        </li>
                      ))
                  )}
                </ul>
                <div className="space-y-2 pt-1 border-t border-white/10">
                  <label className="block text-[11px] text-zinc-500">Tätigkeit</label>
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
                    <option value="__custom__">Sonstiges (Freitext)</option>
                  </select>
                  {logPreset === "__custom__" && (
                    <input
                      className="rt-input-neon w-full"
                      placeholder="Kurzbezeichnung der Tätigkeit"
                      value={logCustomAction}
                      onChange={(e) => setLogCustomAction(e.target.value)}
                    />
                  )}
                  <textarea
                    className="rt-input-neon w-full min-h-[72px] text-sm resize-y"
                    placeholder="Beschreibung der Arbeit…"
                    value={logDescription}
                    onChange={(e) => setLogDescription(e.target.value)}
                    rows={3}
                  />
                  <input
                    className="rt-input-neon w-full font-mono text-sm"
                    placeholder="Dauer in Min. (optional)"
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
                    {logBusy ? "Speichern…" : "Eintrag speichern"}
                  </button>
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
                <label className="block text-xs text-zinc-500 mb-1">Start-Status (Kunde wird per E-Mail informiert)</label>
                <select
                  className="rt-input-neon w-full mb-2 !min-h-[44px]"
                  value={newPartStatus}
                  onChange={(e) => setNewPartStatus(e.target.value as "bestellt" | "vor_ort")}
                >
                  <option value="bestellt">Beim Lieferanten bestellt</option>
                  <option value="vor_ort">Bereits vor Ort / aus Lager</option>
                </select>
                <input
                  className="rt-input-neon mb-2 font-mono text-sm"
                  placeholder="Barcode (optional, für Wareneingang per Scan)"
                  value={newPartBarcode}
                  onChange={(e) => setNewPartBarcode(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-[11px] text-zinc-600 mb-2">
                  Einkaufspreis = tatsächlicher EK bis ggf. spätere Lieferanten-Anbindung; erscheint auf der Lager-Übersicht
                  mit Status „bestellt“.
                </p>
                <button type="button" className="rt-btn-confirm w-full text-base" onClick={() => void addPart()}>
                  Teil erfassen & Kunde benachrichtigen
                </button>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2 text-zinc-300">Teile im Auftrag</p>
                <ul className="space-y-2">
                  {detail.parts.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2 border-b border-white/10 pb-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-sm text-zinc-300">{p.name}</span>
                        <select
                          className="rt-input-neon !min-h-[40px] !py-1 max-w-[200px]"
                          value={p.status}
                          onChange={(e) => void updatePartStatus(p.id, e.target.value)}
                        >
                          {PART_STATUS_OPTIONS.map((x) => (
                            <option key={x.value} value={x.value}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                        <input
                          key={`${p.id}-${p.barcode ?? ""}`}
                          className="rt-input-neon !min-h-[36px] !py-1 text-xs font-mono flex-1"
                          placeholder="Barcode (optional)"
                          defaultValue={p.barcode ?? ""}
                          onBlur={(e) => void savePartBarcode(p.id, e.target.value)}
                          autoComplete="off"
                        />
                        <span className="text-[10px] text-zinc-600 shrink-0">Speichern: Feld verlassen</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <a
                  href={`/api/repairs/${selected.id}/repair-order.pdf`}
                  className="inline-flex justify-center items-center w-full min-h-[48px] rounded-xl border border-[#39ff14]/40 text-[#39ff14] hover:bg-[#39ff14]/10"
                  target="_blank"
                  rel="noreferrer"
                >
                  Reparaturauftrag A4 (PDF)
                </a>
                <a
                  href={`/api/repairs/${selected.id}/repair-order-label.pdf`}
                  className="inline-flex justify-center items-center w-full min-h-[44px] rounded-xl border border-zinc-500/40 text-zinc-300 hover:bg-white/5"
                  target="_blank"
                  rel="noreferrer"
                >
                  Etikett (PDF)
                </a>
                <a
                  href={`/api/repairs/${selected.id}/invoice.pdf`}
                  className="inline-flex justify-center items-center w-full min-h-[48px] rounded-xl border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10"
                  target="_blank"
                  rel="noreferrer"
                >
                  Rechnung PDF
                </a>
                <button
                  type="button"
                  className="inline-flex justify-center items-center w-full min-h-[44px] rounded-xl border border-zinc-600 text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                  disabled={pdfRegenBusy}
                  onClick={() => void regenerateRepairOrderPdf()}
                >
                  {pdfRegenBusy ? "PDF wird erzeugt…" : "Reparatur-PDFs neu erzeugen"}
                </button>
              </div>
              {selected.status === "abgeholt" && (
                <div className="rounded-xl border border-white/10 bg-[#060b13]/80 p-3 space-y-2">
                  <p className="text-xs text-zinc-500">Zahlungsstatus (Korrektur)</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`px-3 py-2 rounded-lg text-xs border ${
                        selected.payment_status === "offen"
                          ? "border-amber-400 text-amber-200 bg-amber-500/10"
                          : "border-white/15 text-zinc-400 hover:border-amber-400/40"
                      }`}
                      onClick={() => void setPaymentStatus("offen")}
                    >
                      Offen
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-2 rounded-lg text-xs border ${
                        selected.payment_status === "bezahlt"
                          ? "border-emerald-400 text-emerald-200 bg-emerald-500/10"
                          : "border-white/15 text-zinc-400 hover:border-emerald-400/40"
                      }`}
                      onClick={() => void setPaymentStatus("bezahlt")}
                    >
                      Bezahlt
                    </button>
                  </div>
                  <Link to="/rechnungen" className="text-xs text-[#39ff14] underline inline-block">
                    Zur Rechnungsübersicht
                  </Link>
                </div>
              )}
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {pickupOpen && selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pickup-title"
        >
          <div className="max-w-md w-full rt-panel rt-panel-violet p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-[0_0_40px_rgba(0,0,0,0.6)]">
            <div className="flex justify-between items-start gap-2">
              <h3 id="pickup-title" className="text-lg font-bold text-white pr-4">
                Abholung &amp; Zahlung
              </h3>
              <button
                type="button"
                className="text-zinc-500 hover:text-white text-xl leading-none shrink-0"
                onClick={closePickupModal}
                aria-label="Schließen"
              >
                ×
              </button>
            </div>
            {pickupErr && <p className="text-sm text-red-400">{pickupErr}</p>}
            {sumupStep === null ? (
              <>
                <p className="text-sm text-zinc-400">
                  Auftrag <span className="font-mono text-[#00d4ff]">{selected.tracking_code}</span> · Summe{" "}
                  <span className="font-mono">{(selected.total_cents / 100).toFixed(2)} €</span>
                </p>
                <button
                  type="button"
                  className="rt-btn-confirm w-full min-h-[48px] text-base"
                  onClick={() => void doPickupBarOrUeberweisung("bar")}
                >
                  Barzahlung (sofort bezahlt)
                </button>
                <button
                  type="button"
                  className="w-full min-h-[48px] rounded-xl border border-violet-400/50 text-violet-200 hover:bg-violet-500/10 text-sm font-medium"
                  onClick={() => void doPickupBarOrUeberweisung("ueberweisung")}
                >
                  Überweisung (7 Tage – Gerät abholen, Zahlung folgt)
                </button>
                <button
                  type="button"
                  className="w-full min-h-[48px] rounded-xl border border-[#00d4ff]/50 text-[#7ee8ff] hover:bg-[#00d4ff]/10 text-sm font-medium"
                  onClick={() => void startSumupLink()}
                >
                  EC / Kreditkarte online (SumUp-Link &amp; QR)
                </button>
                <button
                  type="button"
                  className="w-full min-h-[48px] rounded-xl border border-emerald-500/45 text-emerald-200 hover:bg-emerald-500/10 text-sm font-medium"
                  onClick={() => startSumupTapToPay()}
                >
                  SumUp Tap to Pay (Handyzahlung)
                </button>
                <p className="text-[11px] text-zinc-600">
                  Online-Karte: API-Key + Merchant-Code; Webhook{" "}
                  <span className="font-mono text-zinc-500">…/webhook/sumup</span>. Tap to Pay: Zahlung extern im SumUp
                  auf dem Handy, danach Bestätigung im Dialog.
                </p>
              </>
            ) : sumupStep === "qr" ? (
              <>
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 text-center font-medium">
                  Warten auf Zahlung
                </p>
                <p className="text-xs text-zinc-400">{sumupData?.hint}</p>
                {(sumupData?.qrDataUrl || sumupData?.payment_url || sumupData?.sumupUrl) && selected && (
                  <img
                    src={
                      sumupData?.qrDataUrl ||
                      `/api/track/${encodeURIComponent(selected.tracking_code)}/sumup-qr.png`
                    }
                    alt="QR-Code SumUp-Zahlung"
                    className="mx-auto w-56 h-56 rounded-lg border border-white/10"
                  />
                )}
                {(sumupData?.payment_url || sumupData?.sumupUrl) && (
                  <div className="flex flex-col gap-2">
                    <a
                      href={sumupData.payment_url || sumupData.sumupUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rt-btn-confirm w-full min-h-[48px] text-center flex items-center justify-center no-underline"
                    >
                      Zahlungslink öffnen
                    </a>
                    <p className="text-[10px] text-zinc-600 text-center break-all">{sumupData.payment_url || sumupData.sumupUrl}</p>
                  </div>
                )}
                <button type="button" className="rt-btn-confirm w-full min-h-[48px]" onClick={() => void completeSumupPickup()}>
                  Zahlung erhalten – Abholung abschließen
                </button>
                <button
                  type="button"
                  className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-2"
                  onClick={() => {
                    setSumupStep(null);
                    setSumupData(null);
                  }}
                >
                  Zurück zur Auswahl
                </button>
              </>
            ) : (
              <>
                <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 text-center font-medium">
                  SumUp Tap to Pay (Handyzahlung)
                </p>
                <TapToPayPhoneAnimation />
                <p className="text-sm text-zinc-200 text-center leading-relaxed px-1">
                  Bitte führen Sie die Zahlung auf dem Handy über SumUp Tap to Pay durch.
                </p>
                <button
                  type="button"
                  className="rt-btn-confirm w-full min-h-[52px] text-base"
                  onClick={() => void completeSumupPickup({ tapToPayManual: true })}
                >
                  Zahlung erfolgreich
                </button>
                <button
                  type="button"
                  className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-2"
                  onClick={() => {
                    setSumupStep(null);
                  }}
                >
                  Zurück zur Auswahl
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </RtShell>
  );
}
