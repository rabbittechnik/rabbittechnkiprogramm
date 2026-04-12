import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchJson, fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { parseScanToTrackingCode } from "../lib/trackingScan";
import { useWorkshopGate } from "../useWorkshopGate";
import { getWorkshopTokenRole } from "../workshopAuth";

type ServiceRow = { id: string; code: string; name: string; price_cents: number; sort_order: number };

type RepairDetail = {
  repair: { id: string; tracking_code: string; status: string; total_cents: number };
  customer: { name?: string } | null;
  device: { device_type?: string; brand?: string | null; model?: string | null } | null;
  services?: { code: string; name: string; price_cents: number }[];
};

export function RepairAmendmentPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [allServices, setAllServices] = useState<ServiceRow[]>([]);
  const [trackInput, setTrackInput] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepairDetail | null>(null);
  const [channel, setChannel] = useState<"telefon" | "vor_ort">("telefon");
  const [note, setNote] = useState("");
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<ServiceRow[]>("/api/services").then(setAllServices).catch(() => setAllServices([]));
  }, []);

  const loadRepair = useCallback(async () => {
    setLoadErr(null);
    setDoneMsg(null);
    const code = parseScanToTrackingCode(trackInput.trim());
    if (!code) {
      setLoadErr("Bitte Tracking-Code (z. B. RT-…) oder Link einfügen.");
      setDetail(null);
      return;
    }
    try {
      const row = await fetchWorkshop<{ id: string }>(`/api/repairs/by-tracking/${encodeURIComponent(code)}`);
      const d = await fetchWorkshop<RepairDetail>(`/api/repairs/${encodeURIComponent(row.id)}`);
      setDetail(d);
      setSelectedCodes([]);
      setNote("");
    } catch (e) {
      setDetail(null);
      setLoadErr(String(e));
    }
  }, [trackInput]);

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail?.repair.id) return;
    const n = note.trim();
    if (n.length < 3) {
      setLoadErr("Notiz mindestens 3 Zeichen.");
      return;
    }
    setSaving(true);
    setLoadErr(null);
    try {
      await fetchWorkshop(`/api/repairs/${encodeURIComponent(detail.repair.id)}/customer-amendment`, {
        method: "POST",
        body: JSON.stringify({
          channel,
          note: n,
          service_codes: selectedCodes.length ? selectedCodes : undefined,
        }),
        offlineLabel: "Kundennachtrag",
      });
      setDoneMsg("Gespeichert. Werkstatt sieht den Hinweis in der Liste; der Eintrag erscheint auf der Rechnung.");
      setNote("");
      setSelectedCodes([]);
      const d = await fetchWorkshop<RepairDetail>(`/api/repairs/${encodeURIComponent(detail.repair.id)}`);
      setDetail(d);
    } catch (err) {
      setLoadErr(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (getWorkshopTokenRole() === "bench") {
    return <Navigate to="/werkstatt-montage" replace />;
  }

  if (gate === "loading") {
    return (
      <RtShell title="Auftrag nachtragen">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Auftrag nachtragen" subtitle="Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <p className="text-sm text-zinc-400 mb-4">
            Mit dem <strong>Werkstatt-Passwort</strong> anmelden (gleiches Login wie Auftragsverwaltung). Nachträge
            betreffen Preise und sind nur mit voller Berechtigung möglich.
          </p>
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <input
              type="password"
              className="rt-input-neon w-full"
              placeholder="Passwort"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              autoComplete="current-password"
            />
            {loginErr && <p className="text-sm text-red-400">{loginErr}</p>}
            <button type="submit" className="rt-btn-confirm w-full min-h-[52px]">
              Anmelden
            </button>
          </form>
        </div>
      </RtShell>
    );
  }

  const dev = detail?.device;
  const devLabel = dev ? [dev.device_type, dev.brand, dev.model].filter(Boolean).join(" · ") : "—";

  return (
    <RtShell
      title="Auftrag nachtragen"
      subtitle="Kunde ruft an oder kommt vorbei – Zusatz dokumentieren"
      actions={
        <div className="flex flex-wrap gap-2 items-center">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Dashboard
          </Link>
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-zinc-400">
          Hier legen Sie fest, <strong>wann</strong> und <strong>wie</strong> der Kunde Zusatzwünsche oder Zustimmungen
          geäußert hat, optional mit <strong>zusätzlichen Leistungen</strong> aus dem Katalog. Das erscheint in der
          Werkstatt mit Hinweis-Icon und auf der <strong>Rechnung</strong> unter „Kundennachträge“.
        </p>

        <div className="rt-panel rt-panel-cyan space-y-3">
          <h2 className="text-sm font-bold text-white">Auftrag laden</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="rt-input-neon font-mono flex-1"
              placeholder="RT-… oder Tracking-Link"
              value={trackInput}
              onChange={(e) => setTrackInput(e.target.value)}
            />
            <button type="button" className="rt-btn-confirm min-h-[48px] px-4" onClick={() => void loadRepair()}>
              Laden
            </button>
          </div>
          {loadErr && <p className="text-sm text-red-400">{loadErr}</p>}
        </div>

        {detail && (
          <form onSubmit={(e) => void submit(e)} className="rt-panel rt-panel-cyan space-y-4">
            <div className="text-sm text-zinc-300 space-y-1 border-b border-[#00d4ff]/20 pb-3">
              <p>
                <span className="text-zinc-500">Tracking:</span>{" "}
                <span className="font-mono text-[#00d4ff]">{detail.repair.tracking_code}</span>
              </p>
              <p>
                <span className="text-zinc-500">Kunde:</span> {detail.customer?.name ?? "—"}
              </p>
              <p>
                <span className="text-zinc-500">Gerät:</span> {devLabel}
              </p>
              <p>
                <span className="text-zinc-500">Status:</span> {detail.repair.status.replace(/_/g, " ")}
              </p>
              <p>
                <span className="text-zinc-500">Summe (aktuell):</span>{" "}
                {(detail.repair.total_cents / 100).toFixed(2).replace(".", ",")} €
              </p>
            </div>

            <div>
              <label className="rt-label-neon">Kontakt zum Kunden</label>
              <select
                className="rt-input-neon w-full mt-1"
                value={channel}
                onChange={(e) => setChannel(e.target.value as "telefon" | "vor_ort")}
              >
                <option value="telefon">Telefonisch</option>
                <option value="vor_ort">Persönlich vor Ort</option>
              </select>
            </div>

            <div>
              <label className="rt-label-neon">Was hat der Kunde gesagt / genehmigt?</label>
              <textarea
                className="rt-input-neon w-full mt-1 min-h-[120px]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="z. B. Zusätzlich Datensicherung gewünscht; Einverständnis für teureres Ersatzteil …"
                required
              />
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-2">Zusätzliche Leistungen aus dem Katalog (optional)</p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[#00d4ff]/25 bg-[#060b13]/60 p-2 space-y-1">
                {allServices.map((s) => (
                  <label key={s.code} className="flex items-start gap-2 text-sm text-zinc-200 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={selectedCodes.includes(s.code)}
                      onChange={() => toggleCode(s.code)}
                      className="mt-1"
                    />
                    <span>
                      {s.name}{" "}
                      <span className="text-cyan-400/90">
                        ({(s.price_cents / 100).toFixed(2).replace(".", ",")} €)
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {doneMsg && <p className="text-sm text-emerald-400/95">{doneMsg}</p>}

            <button type="submit" disabled={saving} className="rt-btn-confirm w-full min-h-[52px]">
              {saving ? "Speichern…" : "Nachtrag speichern"}
            </button>
          </form>
        )}
      </div>
    </RtShell>
  );
}
