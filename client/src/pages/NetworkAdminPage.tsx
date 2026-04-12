import { useCallback, useEffect, useState } from "react";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { useWorkshopGate } from "../useWorkshopGate";

type Settings = {
  network_markup_percent: string;
  network_service_fee_cents: string;
  network_service_fee_mode: string;
  network_email_intro_text: string;
  network_dealer_order_url: string;
};

type Device = {
  id: string; type: string; brand: string; model: string; connection_type: string | null;
  wifi_standard: string; speed: string; mesh_support: number; base_price_cents: number;
};

export function NetworkAdminPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [settings, setSettings] = useState<Settings>({
    network_markup_percent: "10",
    network_service_fee_cents: "8900",
    network_service_fee_mode: "flat",
    network_email_intro_text: "",
    network_dealer_order_url: "",
  });
  const [devices, setDevices] = useState<Device[]>([]);
  const [saved, setSaved] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [newDev, setNewDev] = useState({
    type: "router",
    brand: "AVM",
    model: "",
    connection_type: "",
    wifi_standard: "WiFi 6",
    speed: "",
    mesh_support: 0,
    base_price_cents: "",
  });

  const loadSettings = useCallback(async () => {
    try {
      const d = await fetchWorkshop<{ settings: Settings }>("/api/network/admin/settings");
      setSettings((prev) => ({ ...prev, ...d.settings }));
    } catch { /* */ }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const d = await fetchWorkshop<{ devices: Device[] }>("/api/network/admin/devices");
      setDevices(d.devices ?? []);
    } catch { /* */ }
  }, []);

  useEffect(() => { if (gate === "ok") { void loadSettings(); void loadDevices(); } }, [gate, loadSettings, loadDevices]);

  const saveSettings = async () => {
    setSaved(false);
    await fetchWorkshop("/api/network/admin/settings", { method: "PUT", body: JSON.stringify({ settings }) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addDevice = async () => {
    const base = parseInt(newDev.base_price_cents, 10);
    if (!newDev.model.trim() || !Number.isFinite(base)) {
      setRefreshMsg("Modell und Basispreis (Cent) erforderlich");
      return;
    }
    setRefreshMsg(null);
    try {
      await fetchWorkshop("/api/network/admin/devices", {
        method: "POST",
        body: JSON.stringify({
          type: newDev.type,
          brand: newDev.brand,
          model: newDev.model.trim(),
          connection_type: newDev.connection_type.trim() || null,
          wifi_standard: newDev.wifi_standard,
          speed: newDev.speed || "–",
          mesh_support: newDev.mesh_support,
          base_price_cents: base,
        }),
      });
      setNewDev((s) => ({ ...s, model: "", base_price_cents: "" }));
      void loadDevices();
      setRefreshMsg("Gerät angelegt");
    } catch (e) {
      setRefreshMsg(String(e));
    }
  };

  const patchDeviceBase = async (id: string, cents: string) => {
    const v = Math.round(parseFloat(cents.replace(",", ".")) * 100);
    if (!Number.isFinite(v) || v < 0) return;
    await fetchWorkshop(`/api/network/admin/devices/${id}`, { method: "PATCH", body: JSON.stringify({ base_price_cents: v }) });
    void loadDevices();
  };

  const refreshCatalog = async () => {
    setRefreshMsg(null);
    try {
      const r = await fetchWorkshop<{ updated: number; errors: string[] }>("/api/network/catalog/refresh", { method: "POST" });
      setRefreshMsg(r.errors.length > 0 ? r.errors.join("; ") : `${r.updated} Modelle geprüft`);
      void loadDevices();
    } catch (e) { setRefreshMsg(String(e)); }
  };

  if (gate === "loading") return <RtShell title="Netzwerk-Admin"><p className="text-zinc-500 text-center py-12">Laden…</p></RtShell>;
  if (gate === "login") return (
    <RtShell title="Netzwerk-Admin" subtitle="Anmeldung erforderlich">
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
    <RtShell title="Netzwerk-Admin" subtitle="Aufschlag, Dienstleistungspreise, Gerätekatalog"
      actions={<button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 min-h-0 min-w-0">Abmelden</button>}>
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Einstellungen */}
        <div className="rt-panel rt-panel-cyan space-y-4">
          <h2 className="text-base font-bold text-white">Preiseinstellungen</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="rt-label-neon">Aufschlag (%)</label>
              <input type="number" className="rt-input-neon" value={settings.network_markup_percent} onChange={(e) => setSettings((s) => ({ ...s, network_markup_percent: e.target.value }))} />
              <p className="text-[11px] text-zinc-600 mt-1">Wird automatisch auf den Einkaufspreis gerechnet. Im Frontend nicht sichtbar.</p>
            </div>
            <div>
              <label className="rt-label-neon">Dienstleistung (Cent)</label>
              <input type="number" className="rt-input-neon" value={settings.network_service_fee_cents} onChange={(e) => setSettings((s) => ({ ...s, network_service_fee_cents: e.target.value }))} />
              <p className="text-[11px] text-zinc-600 mt-1">z. B. 8900 = 89,00 €</p>
            </div>
            <div>
              <label className="rt-label-neon">Abrechnungsmodus</label>
              <select className="rt-input-neon" value={settings.network_service_fee_mode} onChange={(e) => setSettings((s) => ({ ...s, network_service_fee_mode: e.target.value }))}>
                <option value="flat">Pauschale</option>
                <option value="hourly">Stundenpreis</option>
              </select>
            </div>
          </div>
          <div>
            <label className="rt-label-neon">E-Mail Standardtext (optional)</label>
            <textarea className="rt-input-neon min-h-[80px]" value={settings.network_email_intro_text} onChange={(e) => setSettings((s) => ({ ...s, network_email_intro_text: e.target.value }))} />
          </div>
          <div>
            <label className="rt-label-neon">Händler-Link Vorlage (optional)</label>
            <input
              className="rt-input-neon font-mono text-sm"
              placeholder="https://…?q={{ITEMS}}"
              value={settings.network_dealer_order_url}
              onChange={(e) => setSettings((s) => ({ ...s, network_dealer_order_url: e.target.value }))}
            />
            <p className="text-[11px] text-zinc-600 mt-1">
              Platzhalter: <code className="text-zinc-500">{"{{ITEMS}}"}</code> (kommagetrennt URL-kodiert),{" "}
              <code className="text-zinc-500">{"{{ITEMS_LINE}}"}</code> (zeilenweise). Wird nach Auftragserstellung im Wizard als Button angeboten.
            </p>
          </div>
          <button type="button" onClick={() => void saveSettings()} className="rt-btn-confirm min-h-[52px] px-8">
            {saved ? "Gespeichert ✓" : "Einstellungen speichern"}
          </button>
        </div>

        {/* Katalog */}
        <div className="rt-panel rt-panel-violet space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-white">Gerätekatalog ({devices.length} Geräte)</h2>
            <button type="button" onClick={() => void refreshCatalog()} className="text-xs text-violet-300 underline min-h-0 min-w-0">Von AVM aktualisieren</button>
          </div>
          {refreshMsg && <p className="text-xs text-zinc-400">{refreshMsg}</p>}

          <div className="rounded-xl border border-violet-500/20 bg-black/20 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Neues Gerät</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="rt-label-neon text-[11px]">Typ</label>
                <select className="rt-input-neon" value={newDev.type} onChange={(e) => setNewDev((s) => ({ ...s, type: e.target.value }))}>
                  <option value="router">router</option>
                  <option value="repeater">repeater</option>
                </select>
              </div>
              <div>
                <label className="rt-label-neon text-[11px]">Marke</label>
                <input className="rt-input-neon" value={newDev.brand} onChange={(e) => setNewDev((s) => ({ ...s, brand: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="rt-label-neon text-[11px]">Modell *</label>
                <input className="rt-input-neon" value={newDev.model} onChange={(e) => setNewDev((s) => ({ ...s, model: e.target.value }))} placeholder="z. B. FRITZ!Box 5530" />
              </div>
              <div>
                <label className="rt-label-neon text-[11px]">Anschluss</label>
                <select className="rt-input-neon" value={newDev.connection_type} onChange={(e) => setNewDev((s) => ({ ...s, connection_type: e.target.value }))}>
                  <option value="">–</option>
                  <option value="dsl">dsl</option>
                  <option value="kabel">kabel</option>
                  <option value="glasfaser">glasfaser</option>
                  <option value="lte_5g">lte_5g</option>
                </select>
              </div>
              <div>
                <label className="rt-label-neon text-[11px]">WLAN</label>
                <input className="rt-input-neon" value={newDev.wifi_standard} onChange={(e) => setNewDev((s) => ({ ...s, wifi_standard: e.target.value }))} />
              </div>
              <div>
                <label className="rt-label-neon text-[11px]">Basispreis (Cent) *</label>
                <input type="number" className="rt-input-neon" value={newDev.base_price_cents} onChange={(e) => setNewDev((s) => ({ ...s, base_price_cents: e.target.value }))} placeholder="19900" />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={!!newDev.mesh_support} onChange={(e) => setNewDev((s) => ({ ...s, mesh_support: e.target.checked ? 1 : 0 }))} />
                  Mesh
                </label>
              </div>
            </div>
            <button type="button" onClick={() => void addDevice()} className="rt-btn-secondary text-sm min-h-[44px] px-4">
              Gerät speichern
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="rt-table w-full">
              <thead><tr><th>Modell</th><th>Typ</th><th>Anschluss</th><th>WLAN</th><th className="text-right">Basispreis (€)</th></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium text-white">{d.brand} {d.model}</td>
                    <td className="capitalize">{d.type}</td>
                    <td>{d.connection_type ?? "–"}</td>
                    <td>{d.wifi_standard}</td>
                    <td className="text-right">
                      <input
                        type="text"
                        className="rt-input-neon font-mono text-right text-sm py-1 max-w-[100px] ml-auto"
                        defaultValue={(d.base_price_cents / 100).toFixed(2)}
                        key={`${d.id}-${d.base_price_cents}`}
                        onBlur={(e) => void patchDeviceBase(d.id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RtShell>
  );
}
