import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type Order = {
  id: string; customer_name: string; customer_email: string | null;
  status: string; grand_total_cents: number; payment_status: string; payment_method: string | null;
  created_at: string; updated_at: string;
};

type OrderDetail = Order & {
  customer_phone: string | null; customer_address: string | null;
  service_fee_cents: number; hardware_total_cents: number;
  invoice_number: string | null; invoice_pdf_path: string | null;
  sumup_checkout_url: string | null;
  sumup_checkout_id: string | null;
  confirmation_pdf_path: string | null;
};

type OrderItem = {
  id: string; model: string; brand: string; device_type: string; wifi_standard: string;
  connection_type: string | null; quantity: number; unit_price_cents: number;
};

function euro(cents: number): string { return `${(cents / 100).toFixed(2).replace(".", ",")} €`; }

const STATUS_LABELS: Record<string, string> = { bestellt: "Bestellt", geliefert: "Geliefert", uebergeben: "Übergeben" };
const STATUS_COLORS: Record<string, string> = {
  bestellt: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  geliefert: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  uebergeben: "text-[#00d4ff] border-[#00d4ff]/40 bg-[#00d4ff]/10",
};

export function NetworkOrdersPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [pickupErr, setPickupErr] = useState<string | null>(null);
  const [sumupStep, setSumupStep] = useState<"qr" | "tap" | null>(null);
  const [sumupData, setSumupData] = useState<{ payment_url?: string; qrDataUrl?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await fetchWorkshop<{ orders: Order[] }>("/api/network/orders");
      setOrders(d.orders);
    } catch { /* handled by gate */ }
  }, []);

  useEffect(() => { if (gate === "ok") void refresh(); }, [gate, refresh]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await fetchWorkshop<{ order: OrderDetail; items: OrderItem[] }>(`/api/network/orders/${id}`);
      setSelected(d.order);
      setItems(d.items);
    } catch (e) { console.error(e); }
  }, []);

  const markDelivered = async () => {
    if (!selected) return;
    await fetchWorkshop(`/api/network/orders/${selected.id}/delivery`, { method: "PATCH" });
    await refresh();
    await loadDetail(selected.id);
  };

  const doPickup = async (type: string, extra?: Record<string, string>) => {
    if (!selected) return;
    setPickupErr(null);
    try {
      const body = { type, ...extra };
      if (type === "sumup_link") {
        const r = await fetchWorkshop<{ payment_url: string; qrDataUrl: string }>(`/api/network/orders/${selected.id}/pickup`, { method: "POST", body: JSON.stringify(body) });
        setSumupData(r);
        setSumupStep("qr");
        return;
      }
      await fetchWorkshop(`/api/network/orders/${selected.id}/pickup`, { method: "POST", body: JSON.stringify(body) });
      setPickupOpen(false);
      setSumupStep(null);
      setSumupData(null);
      await refresh();
      await loadDetail(selected.id);
    } catch (e) { setPickupErr(String(e)); }
  };

  const syncSumUp = async () => {
    if (!selected) return;
    setPickupErr(null);
    try {
      const out = await fetchWorkshop<{ updated?: boolean }>(`/api/network/orders/${selected.id}/sumup-sync`);
      if (out.updated) {
        await refresh();
        await loadDetail(selected.id);
        setPickupOpen(false);
        setSumupStep(null);
        setSumupData(null);
      } else {
        setPickupErr("SumUp: noch keine Zahlung erkannt (oder bereits verbucht).");
      }
    } catch (e) {
      setPickupErr(String(e));
    }
  };

  const completeSumup = async (tapToPay?: boolean) => {
    if (!selected) return;
    setPickupErr(null);
    try {
      await fetchWorkshop(`/api/network/orders/${selected.id}/pickup`, {
        method: "POST",
        body: JSON.stringify({ type: "sumup_complete", ...(tapToPay ? { sumup_channel: "tap_to_pay" } : {}) }),
      });
      setPickupOpen(false);
      setSumupStep(null);
      setSumupData(null);
      await refresh();
      await loadDetail(selected.id);
    } catch (e) { setPickupErr(String(e)); }
  };

  if (gate === "loading") return <RtShell title="Netzwerk-Aufträge"><p className="text-zinc-500 text-center py-12">Laden…</p></RtShell>;
  if (gate === "login") return (
    <RtShell title="Netzwerk-Aufträge" subtitle="Anmeldung erforderlich">
      <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
        <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
          <input type="password" className="rt-input-neon w-full" placeholder="Passwort" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} autoComplete="current-password" />
          {loginErr && <p className="text-sm text-red-400">{loginErr}</p>}
          <button type="submit" className="rt-btn-confirm w-full min-h-[52px]">Anmelden</button>
        </form>
      </div>
    </RtShell>
  );

  return (
    <RtShell title="Netzwerk-Aufträge" subtitle="Bestellungen, Lieferung, Übergabe & Zahlung"
      actions={<div className="flex gap-2 items-center">
        <Link to="/netzwerk" className="text-xs text-[#00d4ff] underline min-h-0 min-w-0">Neuer Auftrag</Link>
        <button type="button" onClick={() => void refresh()} className="text-xs text-zinc-500 hover:text-zinc-300 min-h-0 min-w-0">Aktualisieren</button>
        <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 min-h-0 min-w-0">Abmelden</button>
      </div>}>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Liste */}
        <div className="lg:col-span-4 space-y-2 max-h-[75vh] overflow-y-auto">
          {orders.map((o) => (
            <button key={o.id} type="button" onClick={() => void loadDetail(o.id)}
              className={`w-full text-left rounded-xl border p-3 transition-all active:scale-[0.98] ${selected?.id === o.id ? "border-[#00d4ff] bg-[#00d4ff]/5" : "border-zinc-700 bg-[#0a1220] hover:border-zinc-500"}`}>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-zinc-200 truncate">{o.customer_name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_COLORS[o.status] ?? "text-zinc-400 border-zinc-600"}`}>{STATUS_LABELS[o.status] ?? o.status}</span>
              </div>
              <p className="text-xs text-zinc-500 mt-1">{euro(o.grand_total_cents)} · {o.payment_status === "bezahlt" ? "Bezahlt" : "Offen"}</p>
            </button>
          ))}
          {orders.length === 0 && <p className="text-zinc-500 text-sm text-center py-8">Keine Aufträge vorhanden</p>}
        </div>

        {/* Detail */}
        <div className="lg:col-span-8">
          {selected ? (
            <div className="rt-panel rt-panel-cyan space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-bold text-white">{selected.customer_name}</h2>
                  <p className="text-xs text-zinc-400">{selected.customer_email} · {selected.customer_phone}</p>
                  {selected.customer_address && <p className="text-xs text-zinc-500">{selected.customer_address}</p>}
                </div>
                <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${STATUS_COLORS[selected.status] ?? ""}`}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
              </div>

              <div className="space-y-1">
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm py-1.5 border-b border-white/5">
                    <span className="text-zinc-200">{i.quantity}× {i.brand} {i.model} <span className="text-zinc-500">({i.wifi_standard})</span></span>
                    <span className="font-mono text-white">{euro(i.unit_price_cents * i.quantity)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm py-1.5 border-b border-white/5">
                  <span className="text-zinc-200">Einrichtungs-Service</span>
                  <span className="font-mono text-white">{euro(selected.service_fee_cents)}</span>
                </div>
                <div className="flex justify-between text-base font-bold pt-2">
                  <span className="text-white">Gesamt</span>
                  <span className="font-mono text-[#00d4ff]">{euro(selected.grand_total_cents)}</span>
                </div>
              </div>

              {selected.payment_status === "bezahlt" && <p className="text-emerald-400 text-sm font-medium">Bezahlt ({selected.payment_method})</p>}
              {selected.payment_status === "offen" && selected.status === "uebergeben" && <p className="text-amber-300 text-sm">Offen (Überweisung)</p>}

              {/* Aktions-Buttons */}
              <div className="flex flex-wrap gap-3">
                {selected.status === "bestellt" && (
                  <button type="button" onClick={() => void markDelivered()} className="rt-btn-confirm flex-1 min-h-[56px]">
                    Geräte als geliefert markieren
                  </button>
                )}
                {selected.status === "geliefert" && (
                  <button type="button" onClick={() => { setPickupOpen(true); setPickupErr(null); setSumupStep(null); setSumupData(null); }} className="rt-btn-confirm flex-1 min-h-[56px]">
                    Geräte übergeben + Zahlung
                  </button>
                )}
                {selected.confirmation_pdf_path && (
                  <a href={`/api/network/orders/${selected.id}/confirmation.pdf`} target="_blank" rel="noreferrer" className="rt-btn-secondary min-h-[48px] flex items-center justify-center px-4 text-sm">
                    Auftragsbestätigung PDF
                  </a>
                )}
                {selected.invoice_number && (
                  <a href={`/api/network/orders/${selected.id}/invoice.pdf`} target="_blank" rel="noreferrer" className="rt-btn-secondary min-h-[48px] flex items-center justify-center px-4 text-sm">
                    Rechnung PDF
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="text-zinc-500 text-center py-16">Auftrag aus der Liste auswählen</div>
          )}
        </div>
      </div>

      {/* ── Pickup-Modal ── */}
      {pickupOpen && selected && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm cursor-default" onClick={() => { setPickupOpen(false); setSumupStep(null); }} aria-label="Schließen" />
          <div className="fixed inset-x-4 top-[10%] z-50 max-w-md mx-auto rounded-2xl border border-[#00d4ff]/30 bg-[#0a1220] p-6 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white">Übergabe – Zahlungsart wählen</h3>
            <p className="text-sm text-zinc-400">{selected.customer_name} · <span className="font-mono text-[#00d4ff]">{euro(selected.grand_total_cents)}</span></p>
            {pickupErr && <p className="text-sm text-red-400">{pickupErr}</p>}

            {sumupStep === null && (
              <div className="space-y-3">
                <button type="button" onClick={() => void doPickup("bar")} className="rt-btn-confirm w-full min-h-[56px]">
                  Barzahlung (sofort bezahlt)
                </button>
                <button type="button" onClick={() => void doPickup("ueberweisung")} className="rt-btn-secondary w-full min-h-[52px]">
                  Überweisung (7 Tage Frist)
                </button>
                <button type="button" onClick={() => void doPickup("sumup_link")} className="rt-btn-secondary w-full min-h-[52px]">
                  EC / Kreditkarte online (SumUp-Link + QR)
                </button>
                <button type="button" onClick={() => setSumupStep("tap")} className="rt-btn-secondary w-full min-h-[52px]">
                  SumUp Tap to Pay (Smartphone)
                </button>
              </div>
            )}

            {sumupStep === "qr" && sumupData && (
              <div className="text-center space-y-4">
                <p className="text-sm text-zinc-300">Kunde scannt den QR-Code oder öffnet den Link:</p>
                {sumupData.qrDataUrl && <img src={sumupData.qrDataUrl} alt="QR" className="mx-auto w-48 h-48 rounded-xl bg-white p-2" />}
                {sumupData.payment_url && (
                  <a href={sumupData.payment_url} target="_blank" rel="noreferrer" className="text-xs text-[#00d4ff] underline break-all">{sumupData.payment_url}</a>
                )}
                <button type="button" onClick={() => void syncSumUp()} className="rt-btn-secondary w-full min-h-[48px]">
                  SumUp-Status prüfen (Webhook-Fallback)
                </button>
                <button type="button" onClick={() => void completeSumup()} className="rt-btn-confirm w-full min-h-[52px]">
                  Zahlung erhalten – Übergabe abschließen
                </button>
              </div>
            )}

            {sumupStep === "tap" && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-300">Tap to Pay in der SumUp-App starten, Betrag eingeben und Karte/Smartphone an das Gerät halten.</p>
                <button type="button" onClick={() => void completeSumup(true)} className="rt-btn-confirm w-full min-h-[56px]">
                  Zahlung erfolgreich – Übergabe abschließen
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </RtShell>
  );
}
