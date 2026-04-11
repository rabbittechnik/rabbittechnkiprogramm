import { useEffect, useState } from "react";
import { RtShell } from "../components/RtShell";
import { fetchWorkshop, fetchWorkshopBlob } from "../api";
import { formatDeBerlin } from "../lib/formatBerlin";
import { useWorkshopGate } from "../useWorkshopGate";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
};

type RepairHistoryRow = {
  id: string;
  tracking_code: string;
  status: string;
  total_cents: number;
  created_at: string;
  acceptance_pdf_path: string | null;
};

export function KundenPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [rows, setRows] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [testMailTo, setTestMailTo] = useState("");
  const [testMailBusy, setTestMailBusy] = useState(false);
  const [testMailMsg, setTestMailMsg] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [repairHistory, setRepairHistory] = useState<RepairHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    try {
      const data = await fetchWorkshop<Customer[]>("/api/customers");
      setRows(data);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    if (gate === "ok") void load();
  }, [gate]);

  useEffect(() => {
    if (!selectedCustomer) {
      setRepairHistory(null);
      return;
    }
    setHistoryLoading(true);
    fetchWorkshop<RepairHistoryRow[]>(`/api/customers/${encodeURIComponent(selectedCustomer.id)}/repairs`)
      .then(setRepairHistory)
      .catch(() => setRepairHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [selectedCustomer]);

  const openAcceptancePdf = (repairId: string) => {
    void fetchWorkshopBlob(`/api/repairs/${encodeURIComponent(repairId)}/acceptance.pdf`)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      })
      .catch((e) => alert(String(e)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetchWorkshop("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
        }),
      });
      setName("");
      setEmail("");
      setPhone("");
      setAddress("");
      await load();
    } catch (err) {
      alert(String(err));
    } finally {
      setSaving(false);
    }
  };

  const sendTestMail = async () => {
    const to = testMailTo.trim();
    if (!to) return;
    setTestMailBusy(true);
    setTestMailMsg(null);
    try {
      const r = await fetchWorkshop<{ ok: boolean; sentTo?: string; error?: string }>("/api/mail/test", {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      if (r.ok) setTestMailMsg(`Gesendet an ${r.sentTo ?? to}. Postfach prüfen.`);
      else setTestMailMsg(r.error ?? "Fehler");
    } catch (e) {
      setTestMailMsg(String(e));
    } finally {
      setTestMailBusy(false);
    }
  };

  if (gate === "loading") {
    return (
      <RtShell title="Kundenverwaltung">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Kundenverwaltung" subtitle="Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan">
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <p className="text-sm text-zinc-400">Werkstatt-Passwort (wie unter Werkstatt).</p>
            <div>
              <label className="rt-label-neon">Passwort</label>
              <input
                type="password"
                className="rt-input-neon"
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
      title="Kundenverwaltung"
      subtitle="Stammdaten"
      actions={
        <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
          Abmelden
        </button>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-5 rt-panel rt-panel-cyan space-y-4">
          <h2 className="text-sm font-bold text-white tracking-wide">Neuer Kunde</h2>
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div>
              <label className="rt-label-neon">Name *</label>
              <input className="rt-input-neon" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="rt-label-neon">E-Mail</label>
              <input className="rt-input-neon" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="rt-label-neon">Telefon</label>
              <input className="rt-input-neon" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="rt-label-neon">Adresse</label>
              <textarea
                className="rt-input-neon min-h-[88px] py-2 resize-y"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={3}
              />
            </div>
            <button type="submit" disabled={saving} className="rt-btn-confirm w-full">
              {saving ? "Speichern…" : "Kunde speichern"}
            </button>
          </form>

          <div className="pt-4 border-t border-white/10 space-y-2">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">E-Mail-Test</h3>
            <p className="text-xs text-zinc-500">
              Probed-Mail (Resend API oder SMTP). Auf Railway Hobby ohne Resend schlägt Gmail-SMTP oft mit Timeout fehl.
            </p>
            <div className="flex flex-col gap-2">
              <input
                type="email"
                className="rt-input-neon text-sm"
                placeholder="z. B. rabbit.technik@gmail.com"
                value={testMailTo}
                onChange={(e) => setTestMailTo(e.target.value)}
              />
              <button
                type="button"
                disabled={testMailBusy || !testMailTo.trim()}
                className="rt-btn-secondary w-full min-h-[44px] text-sm"
                onClick={() => void sendTestMail()}
              >
                {testMailBusy ? "Senden…" : "Test-E-Mail senden"}
              </button>
              {testMailMsg && <p className="text-xs text-zinc-400">{testMailMsg}</p>}
            </div>
          </div>
        </section>

        <section className="xl:col-span-7 rt-panel rt-panel-violet space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white tracking-wide">Kundenliste</h2>
            {selectedCustomer && (
              <button
                type="button"
                className="text-xs text-[#00d4ff] underline"
                onClick={() => setSelectedCustomer(null)}
              >
                Auswahl aufheben
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500">Zeile anklicken für Reparatur-Historie & gespeicherte Annahme-PDFs.</p>
          <div className="rt-table-wrap">
            <table className="rt-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden sm:table-cell">E-Mail</th>
                  <th className="hidden md:table-cell">Telefon</th>
                  <th className="hidden lg:table-cell">Angelegt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className={`cursor-pointer transition-colors ${
                      selectedCustomer?.id === c.id ? "bg-[#39ff14]/10" : "hover:bg-white/5"
                    }`}
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <td className="font-medium text-white">{c.name}</td>
                    <td className="hidden sm:table-cell text-zinc-400">{c.email ?? "—"}</td>
                    <td className="hidden md:table-cell text-zinc-400">{c.phone ?? "—"}</td>
                    <td className="hidden lg:table-cell text-zinc-500 text-xs">
                      {formatDeBerlin(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="text-zinc-500 text-sm mt-4 text-center">Noch keine Kunden manuell angelegt.</p>}

          {selectedCustomer && (
            <div className="border-t border-white/10 pt-4 space-y-3">
              <h3 className="text-sm font-bold text-violet-200">
                Historie – {selectedCustomer.name}
              </h3>
              {historyLoading && <p className="text-zinc-500 text-sm">Laden…</p>}
              {!historyLoading && repairHistory && repairHistory.length === 0 && (
                <p className="text-zinc-500 text-sm">Keine Reparaturaufträge mit diesem Kunden verknüpft.</p>
              )}
              {!historyLoading && repairHistory && repairHistory.length > 0 && (
                <div className="rt-table-wrap max-h-[40vh] overflow-y-auto">
                  <table className="rt-table text-sm">
                    <thead>
                      <tr>
                        <th>Tracking</th>
                        <th>Status</th>
                        <th className="hidden sm:table-cell">Datum</th>
                        <th>Summe</th>
                        <th>Annahme-PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repairHistory.map((r) => (
                        <tr key={r.id}>
                          <td className="font-mono text-[#00d4ff]">{r.tracking_code}</td>
                          <td className="text-zinc-300">{r.status.replace(/_/g, " ")}</td>
                          <td className="hidden sm:table-cell text-zinc-500 text-xs">
                            {formatDeBerlin(r.created_at)}
                          </td>
                          <td className="text-zinc-300">{(r.total_cents / 100).toFixed(2)} €</td>
                          <td>
                            {r.acceptance_pdf_path ? (
                              <button
                                type="button"
                                className="text-[#39ff14] underline text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAcceptancePdf(r.id);
                                }}
                              >
                                Öffnen
                              </button>
                            ) : (
                              <span className="text-zinc-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </RtShell>
  );
}
