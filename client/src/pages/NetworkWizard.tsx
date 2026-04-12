import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson, fetchWorkshop, fetchWorkshopBlob } from "../api";
import { SignatureCanvas, type SignatureCanvasRef } from "../components/SignatureCanvas";
import { NetworkDeviceThumb } from "../components/NetworkDeviceThumb";

type StammCustomer = { id: string; name: string; email: string | null; phone: string | null; address: string | null };
type CatalogDevice = {
  id: string; type: "router" | "repeater"; brand: string; model: string;
  connection_type: string | null; wifi_standard: string; speed: string;
  mesh_support: boolean; price_cents: number;
};
type ServiceFee = { cents: number; mode: "flat" | "hourly" };

type CartItem = { device: CatalogDevice; quantity: number };

type PreviewItem = { device_id: string; quantity: number; unit_price_cents: number; line_total_cents: number; model: string; brand: string; type: string };
type Preview = {
  items: PreviewItem[];
  hardwareTotalCents: number;
  serviceFeeCents: number;
  grandTotalCents: number;
  netTotalCents?: number;
  vatCents?: number;
  vatRatePercent?: number;
};

function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

const CONN_LABELS: Record<string, string> = { dsl: "DSL", kabel: "Kabel", glasfaser: "Glasfaser", lte_5g: "LTE / 5G" };
const CONN_FILTERS = [
  { value: "", label: "Alle" },
  { value: "dsl", label: "DSL" },
  { value: "kabel", label: "Kabel" },
  { value: "glasfaser", label: "Glasfaser" },
  { value: "lte_5g", label: "LTE / 5G" },
];

export function NetworkWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | "done">(1);

  // Step 1: Kunde
  const [stammCustomers, setStammCustomers] = useState<StammCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");

  // Step 2: Hardware
  const [catalog, setCatalog] = useState<CatalogDevice[]>([]);
  const [serviceFee, setServiceFee] = useState<ServiceFee>({ cents: 8900, mode: "flat" });
  const [connFilter, setConnFilter] = useState("");
  const [selectedRouter, setSelectedRouter] = useState<CatalogDevice | null>(null);
  const [repeaterCart, setRepeaterCart] = useState<CartItem[]>([]);

  // Step 3: Preis
  const [preview, setPreview] = useState<Preview | null>(null);

  // Step 4: Signatur
  const sigRef = useRef<SignatureCanvasRef>(null);
  const [submitting, setSubmitting] = useState(false);
  const [doneOrder, setDoneOrder] = useState<{ id: string } | null>(null);
  const [hardwareOrder, setHardwareOrder] = useState<{ lines: string[]; dealer_order_url: string | null } | null>(null);

  // Daten laden
  useEffect(() => {
    fetchWorkshop<StammCustomer[]>("/api/customers").then(setStammCustomers).catch(() => {});
    fetchJson<{ devices: CatalogDevice[]; serviceFee: ServiceFee }>("/api/network/catalog")
      .then((d) => { setCatalog(d.devices); setServiceFee(d.serviceFee); })
      .catch(console.error);
  }, []);

  const applyStamm = (id: string) => {
    setSelectedCustomerId(id);
    const c = stammCustomers.find((s) => s.id === id);
    if (c) { setCustomerName(c.name); setCustomerEmail(c.email ?? ""); setCustomerPhone(c.phone ?? ""); setCustomerAddress(c.address ?? ""); }
  };

  const routers = useMemo(() => catalog.filter((d) => d.type === "router" && (!connFilter || d.connection_type === connFilter)), [catalog, connFilter]);
  const repeaters = useMemo(() => catalog.filter((d) => d.type === "repeater"), [catalog]);

  const addRepeater = (dev: CatalogDevice) => {
    setRepeaterCart((c) => {
      const ex = c.find((i) => i.device.id === dev.id);
      if (ex) return c.map((i) => i.device.id === dev.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { device: dev, quantity: 1 }];
    });
  };

  const setRepeaterQty = (deviceId: string, qty: number) => {
    if (qty <= 0) setRepeaterCart((c) => c.filter((i) => i.device.id !== deviceId));
    else setRepeaterCart((c) => c.map((i) => i.device.id === deviceId ? { ...i, quantity: qty } : i));
  };

  const allItems = useMemo(() => {
    const items: { device_id: string; quantity: number }[] = [];
    if (selectedRouter) items.push({ device_id: selectedRouter.id, quantity: 1 });
    for (const ri of repeaterCart) items.push({ device_id: ri.device.id, quantity: ri.quantity });
    return items;
  }, [selectedRouter, repeaterCart]);

  const loadPreview = useCallback(async () => {
    if (allItems.length === 0) return;
    try {
      const p = await fetchJson<Preview>("/api/network/orders/preview", { method: "POST", body: JSON.stringify({ items: allItems }) });
      setPreview(p);
    } catch { setPreview(null); }
  }, [allItems]);

  const goToStep3 = () => { void loadPreview(); setStep(3); };

  const submit = async () => {
    setSubmitting(true);
    try {
      let custId = selectedCustomerId;
      if (!custId) {
        const res = await fetchWorkshop<{ customer: { id: string } }>("/api/customers", {
          method: "POST", body: JSON.stringify({ name: customerName, email: customerEmail || null, phone: customerPhone || null, address: customerAddress || null }),
        });
        custId = res.customer.id;
      }
      const sig = sigRef.current?.toDataURL() ?? "";
      const res = await fetchJson<{
        order: { id: string };
        hardware_order?: { lines: string[]; dealer_order_url: string | null };
      }>("/api/network/orders", {
        method: "POST",
        body: JSON.stringify({ customer_id: custId, items: allItems, signature_data_url: sig || null }),
      });
      setDoneOrder(res.order);
      setHardwareOrder(res.hardware_order ?? null);
      setStep("done");
    } catch (e) { alert(String(e)); }
    finally { setSubmitting(false); }
  };

  const canGoStep2 = selectedCustomerId ? true : (customerName.trim() && customerEmail.trim() && customerPhone.trim() && customerAddress.trim());

  // ── DONE ────────────────────────────────────────────────────────────────
  const downloadOrderList = async () => {
    if (!doneOrder) return;
    try {
      const blob = await fetchWorkshopBlob(`/api/network/orders/${doneOrder.id}/order-list.txt`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bestellliste-${doneOrder.id.slice(0, 8)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(String(e));
    }
  };

  if (step === "done" && doneOrder) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-lg w-full rounded-2xl border-2 border-emerald-400/40 bg-[#0a1220]/95 p-8 text-center space-y-6">
          <h2 className="font-display text-2xl font-bold text-emerald-400">Netzwerk-Auftrag gespeichert</h2>
          <p className="text-sm text-zinc-400">Auftragsbestätigung wurde per E-Mail gesendet (sofern konfiguriert).</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
            <a href={`/api/network/orders/${doneOrder.id}/confirmation.pdf`} target="_blank" rel="noreferrer" className="rt-btn-confirm px-6 min-h-[52px]">
              PDF Auftragsbestätigung
            </a>
            <button type="button" onClick={() => void downloadOrderList()} className="rt-btn-secondary px-6 min-h-[52px]">
              Bestellliste (.txt)
            </button>
            {hardwareOrder?.dealer_order_url && (
              <a href={hardwareOrder.dealer_order_url} target="_blank" rel="noreferrer" className="rt-btn-secondary px-6 min-h-[52px] flex items-center justify-center">
                Händler-Link
              </a>
            )}
            <Link to="/netzwerk-auftraege" className="rt-btn-secondary px-6 min-h-[52px] flex items-center justify-center">
              Zur Auftragsverwaltung
            </Link>
          </div>
          {hardwareOrder?.lines?.length ? (
            <div className="text-left rounded-xl border border-zinc-700 bg-black/20 p-3 text-xs text-zinc-400 font-mono whitespace-pre-wrap">
              {hardwareOrder.lines.join("\n")}
            </div>
          ) : null}
          <button type="button" onClick={() => window.location.reload()} className="text-sm text-zinc-500 hover:text-zinc-300 underline min-h-0 min-w-0">
            Neuer Auftrag
          </button>
        </div>
      </div>
    );
  }

  // ── WIZARD ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Schritt-Anzeige */}
      <div className="flex items-center gap-2 text-sm">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`flex items-center gap-1.5 ${step === s ? "text-[#00d4ff] font-bold" : step > s ? "text-emerald-400" : "text-zinc-600"}`}>
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${step === s ? "border-[#00d4ff] bg-[#00d4ff]/15" : step > s ? "border-emerald-500 bg-emerald-500/15" : "border-zinc-700"}`}>{s}</span>
            <span className="hidden sm:inline">{["Kunde", "Hardware", "Preis", "Bestätigung"][s - 1]}</span>
            {s < 4 && <span className="text-zinc-700 mx-1">→</span>}
          </div>
        ))}
      </div>

      {/* ── Schritt 1: Kunde ── */}
      {step === 1 && (
        <div className="rt-panel rt-panel-cyan space-y-4">
          <h2 className="text-lg font-bold text-white">Kunde auswählen oder anlegen</h2>
          <div>
            <label className="rt-label-neon">Bestandskunde</label>
            <select className="rt-input-neon" value={selectedCustomerId} onChange={(e) => applyStamm(e.target.value)}>
              <option value="">– Neuer Kunde –</option>
              {stammCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>)}
            </select>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className="rt-label-neon">Name *</label><input className="rt-input-neon" value={customerName} onChange={(e) => setCustomerName(e.target.value)} readOnly={!!selectedCustomerId} /></div>
            <div><label className="rt-label-neon">E-Mail *</label><input type="email" className="rt-input-neon" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} readOnly={!!selectedCustomerId} /></div>
            <div><label className="rt-label-neon">Telefon *</label><input className="rt-input-neon" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} readOnly={!!selectedCustomerId} /></div>
            <div><label className="rt-label-neon">Adresse *</label><input className="rt-input-neon" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} readOnly={!!selectedCustomerId} /></div>
          </div>
          <button type="button" disabled={!canGoStep2} onClick={() => setStep(2)} className="rt-btn-confirm w-full min-h-[56px]">
            Weiter → Hardware auswählen
          </button>
        </div>
      )}

      {/* ── Schritt 2: Hardware ── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="rt-panel rt-panel-cyan space-y-4">
            <h2 className="text-lg font-bold text-white">Router auswählen (Pflicht)</h2>
            <div className="flex flex-wrap gap-2">
              {CONN_FILTERS.map((f) => (
                <button key={f.value} type="button" onClick={() => setConnFilter(f.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${connFilter === f.value ? "border-[#00d4ff] text-[#00d4ff] bg-[#00d4ff]/10" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {routers.map((r) => (
                <button key={r.id} type="button" onClick={() => setSelectedRouter(r)}
                  className={`flex gap-3 items-stretch text-left rounded-xl border p-4 min-h-[7.5rem] transition-all active:scale-[0.97] ${selectedRouter?.id === r.id ? "border-[#00d4ff] bg-[#00d4ff]/10 ring-1 ring-[#00d4ff]/40" : "border-zinc-700 bg-[#0a1220] hover:border-zinc-500"}`}>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <p className="font-semibold text-white text-sm leading-snug">{r.model}</p>
                    <p className="text-xs text-zinc-400 mt-1">{r.connection_type ? CONN_LABELS[r.connection_type] ?? r.connection_type : "Ohne Modem"} · {r.wifi_standard}</p>
                    <p className="text-xs text-zinc-500 line-clamp-2">{r.speed}</p>
                    <p className="text-base font-mono text-[#00d4ff] mt-auto pt-2">{euro(r.price_cents)}</p>
                  </div>
                  <NetworkDeviceThumb model={r.model} type="router" />
                </button>
              ))}
            </div>
          </div>

          <div className="rt-panel rt-panel-violet space-y-4">
            <h2 className="text-lg font-bold text-white">Repeater hinzufügen (optional)</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {repeaters.map((r) => {
                const inCart = repeaterCart.find((c) => c.device.id === r.id);
                return (
                  <div key={r.id} className={`flex gap-3 items-stretch rounded-xl border p-4 min-h-[7.5rem] ${inCart ? "border-violet-400 bg-violet-500/10" : "border-zinc-700 bg-[#0a1220]"}`}>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <p className="font-semibold text-white text-sm leading-snug">{r.model}</p>
                      <p className="text-xs text-zinc-400 mt-1">{r.wifi_standard} · {r.mesh_support ? "Mesh" : "Standalone"}</p>
                      <p className="text-xs text-zinc-500 line-clamp-2">{r.speed}</p>
                      <p className="text-base font-mono text-violet-300 mt-auto pt-2">{euro(r.price_cents)}</p>
                      {inCart ? (
                        <div className="flex items-center gap-2 mt-2">
                          <button type="button" onClick={() => setRepeaterQty(r.id, inCart.quantity - 1)} className="w-9 h-9 rounded-lg border border-zinc-600 text-zinc-300 flex items-center justify-center min-h-0 min-w-0">−</button>
                          <span className="text-white font-mono w-8 text-center">{inCart.quantity}</span>
                          <button type="button" onClick={() => setRepeaterQty(r.id, inCart.quantity + 1)} className="w-9 h-9 rounded-lg border border-zinc-600 text-zinc-300 flex items-center justify-center min-h-0 min-w-0">+</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => addRepeater(r)} className="mt-2 self-start text-xs text-violet-300 underline min-h-0 min-w-0">Hinzufügen</button>
                      )}
                    </div>
                    <NetworkDeviceThumb model={r.model} type="repeater" />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="rt-btn-secondary flex-1 min-h-[52px]">← Zurück</button>
            <button type="button" disabled={!selectedRouter} onClick={goToStep3} className="rt-btn-confirm flex-1 min-h-[56px]">
              Weiter → Preisübersicht
            </button>
          </div>
        </div>
      )}

      {/* ── Schritt 3: Preis ── */}
      {step === 3 && (
        <div className="rt-panel rt-panel-cyan space-y-5">
          <h2 className="text-lg font-bold text-white">Preisübersicht</h2>
          {preview ? (
            <>
              <div className="space-y-2">
                {preview.items.map((i, idx) => (
                  <div key={idx} className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="text-sm text-zinc-200">{i.quantity}× {i.brand} {i.model}</span>
                    <span className="font-mono text-white">{euro(i.line_total_cents)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-sm text-zinc-200">Einrichtung Netzwerk / WLAN / Router / Mesh</span>
                  <span className="font-mono text-white">{euro(preview.serviceFeeCents)}</span>
                </div>
              </div>
              {preview.vatRatePercent != null && preview.vatCents != null && preview.netTotalCents != null && (
                <div className="rounded-lg border border-zinc-700/80 bg-black/20 px-3 py-2 space-y-1 text-xs text-zinc-400">
                  <div className="flex justify-between">
                    <span>Enthaltene Umsatzsteuer ({preview.vatRatePercent} %)</span>
                    <span className="font-mono text-zinc-300">{euro(preview.vatCents)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Netto (ohne USt)</span>
                    <span className="font-mono text-zinc-300">{euro(preview.netTotalCents)}</span>
                  </div>
                </div>
              )}
              <div className="flex justify-between items-center pt-3">
                <span className="text-base font-bold text-white">Gesamtbetrag (inkl. USt)</span>
                <span className="text-2xl font-mono font-bold text-[#00d4ff]">{euro(preview.grandTotalCents)}</span>
              </div>
            </>
          ) : (
            <p className="text-zinc-500 text-center py-8">Berechnung läuft…</p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(2)} className="rt-btn-secondary flex-1 min-h-[52px]">← Zurück</button>
            <button type="button" disabled={!preview} onClick={() => setStep(4)} className="rt-btn-confirm flex-1 min-h-[56px]">
              Weiter → Unterschrift
            </button>
          </div>
        </div>
      )}

      {/* ── Schritt 4: Unterschrift ── */}
      {step === 4 && (
        <div className="rt-panel rt-panel-cyan space-y-5">
          <h2 className="text-lg font-bold text-white">Auftragsbestätigung unterschreiben</h2>
          <p className="text-sm text-zinc-400">Kunde: <strong className="text-zinc-200">{customerName}</strong> · {customerEmail}</p>
          <p className="text-sm text-zinc-400">
            {preview?.items.map((i) => `${i.quantity}× ${i.model}`).join(", ")} · Gesamt: <strong className="text-[#00d4ff]">{preview ? euro(preview.grandTotalCents) : "–"}</strong>
          </p>
          <p className="text-xs text-zinc-500">Leistung: Einrichtung Netzwerk / WLAN / Router / Mesh – Vor-Ort-Service</p>

          <div>
            <label className="rt-label-neon">Unterschrift Kunde</label>
            <SignatureCanvas ref={sigRef} />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(3)} className="rt-btn-secondary flex-1 min-h-[52px]">← Zurück</button>
            <button type="button" disabled={submitting} onClick={() => void submit()} className="rt-btn-confirm flex-1 min-h-[56px]">
              {submitting ? "Speichern…" : "Auftrag bestätigen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
