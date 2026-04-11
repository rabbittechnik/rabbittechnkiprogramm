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
  payment_method?: string | null;
  payment_due_at: string | null;
  updated_at: string;
  created_at: string;
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

export function Workshop({ pageTitle = "Auftragsverwaltung" }: { pageTitle?: string }) {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<{
    repair: Record<string, unknown>;
    parts: {
      id: string;
      name: string;
      status: string;
      sale_cents: number;
      purchase_cents: number;
      barcode?: string | null;
    }[];
  } | null>(null);
  const [partName, setPartName] = useState("");
  const [sale, setSale] = useState("");
  const [buy, setBuy] = useState("");
  const [newPartStatus, setNewPartStatus] = useState<"bestellt" | "vor_ort">("bestellt");
  const [newPartBarcode, setNewPartBarcode] = useState("");
  const [pickupOpen, setPickupOpen] = useState(false);
  const [sumupStep, setSumupStep] = useState<"qr" | null>(null);
  const [sumupData, setSumupData] = useState<{
    sumupUrl?: string;
    payment_url?: string;
    qrDataUrl?: string;
    hint: string;
  } | null>(null);
  const [pickupErr, setPickupErr] = useState<string | null>(null);

  const PART_STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "bestellt", label: "Bestellt" },
    { value: "unterwegs", label: "Unterwegs" },
    { value: "angekommen", label: "Angekommen" },
    { value: "vor_ort", label: "Bereits vor Ort / Lager" },
    { value: "eingebaut", label: "Eingebaut" },
  ];

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
    const d = await fetchWorkshop<typeof detail>(`/api/repairs/${selected.id}`);
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
    const d = await fetchWorkshop<typeof detail>(`/api/repairs/${selected.id}`);
    setDetail(d);
  };

  const reloadSelectedFromServer = async (repairId: string) => {
    const list = await fetchWorkshop<Row[]>("/api/repairs");
    setRows(list);
    const next = list.find((x) => x.id === repairId);
    if (next) setSelected(next);
    const d = await fetchWorkshop<typeof detail>(`/api/repairs/${repairId}`);
    setDetail(d);
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

  /** SumUp: Webhook-Fallback – Checkout-Status per API prüfen (alle 45 s + sofort beim Öffnen des QR-Schritts). */
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
          setRows(list);
          const next = list.find((x) => x.id === repairId);
          if (next) setSelected(next);
          const d = await fetchWorkshop<typeof detail>(`/api/repairs/${repairId}`);
          setDetail(d);
        }
      } catch {
        /* z. B. SumUp nicht konfiguriert */
      }
    };
    void syncOnce();
    const t = window.setInterval(() => void syncOnce(), 45_000);
    return () => window.clearInterval(t);
  }, [pickupOpen, sumupStep, selected?.id]);

  const completeSumupPickup = async () => {
    if (!selected) return;
    setPickupErr(null);
    try {
      await fetchWorkshop(`/api/repairs/${selected.id}/pickup`, {
        method: "POST",
        body: JSON.stringify({ type: "sumup_complete" }),
      });
      closePickupModal();
      await reloadSelectedFromServer(selected.id);
    } catch (e) {
      setPickupErr(String(e));
    }
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
                <p className="text-xs text-zinc-500 mt-1">
                  {(r.total_cents / 100).toFixed(2)} € ·{" "}
                  {r.payment_status === "bezahlt" ? (
                    <span className="text-emerald-400/90">bezahlt</span>
                  ) : (
                    <span className="text-amber-300/90">offen</span>
                  )}
                  {(r.status === "fertig" || r.status === "abgeholt") && r.payment_status === "offen" && r.payment_due_at && (
                    <span className="text-zinc-600"> · bis {new Date(r.payment_due_at.replace(" ", "T")).toLocaleDateString("de-DE")}</span>
                  )}
                  {r.payment_method && (r.status === "fertig" || r.status === "abgeholt") && (
                    <span className="text-zinc-600">
                      {" "}
                      ·{" "}
                      {r.payment_method === "ueberweisung"
                        ? "Überweisung"
                        : r.payment_method === "sumup"
                          ? "SumUp"
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
              {selected.status === "fertig" && (
                <div className="rounded-xl border border-[#39ff14]/35 bg-[#39ff14]/5 p-4">
                  <p className="text-sm font-semibold text-[#39ff14] mb-2">Gerät wird abgeholt</p>
                  <p className="text-xs text-zinc-500 mb-3">
                    Wählen Sie die Zahlungsart – die PDF-Rechnung wird passend erzeugt (Bar/SumUp sofort beglichen,
                    Überweisung mit Frist und Verwendungszweck = Tracking-Code).
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
              <a
                href={`/api/repairs/${selected.id}/invoice.pdf`}
                className="inline-flex justify-center items-center w-full min-h-[48px] rounded-xl border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10"
                target="_blank"
                rel="noreferrer"
              >
                Rechnung PDF
              </a>
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
            {sumupStep !== "qr" ? (
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
                  EC / Kreditkarte (SumUp-Link &amp; QR)
                </button>
                <p className="text-[11px] text-zinc-600">
                  SumUp: RABBIT_SUMUP_API_KEY und RABBIT_SUMUP_MERCHANT_CODE setzen; Webhook-URL{" "}
                  <span className="font-mono text-zinc-500">…/webhook/sumup</span> (siehe RABBIT_SUMUP_WEBHOOK_URL in
                  .env.example). Nach erfolgreicher Zahlung schließt sich der Auftrag automatisch – „Zahlung erhalten“
                  bleibt als Fallback.
                </p>
              </>
            ) : (
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
            )}
          </div>
        </div>
      )}
    </RtShell>
  );
}
