import { useEffect, useState } from "react";
import { RtShell } from "../components/RtShell";
import { fetchWorkshop } from "../api";
import { useWorkshopGate } from "../useWorkshopGate";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
};

export function KundenPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [rows, setRows] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

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
        </section>

        <section className="xl:col-span-7 rt-panel rt-panel-violet">
          <h2 className="text-sm font-bold text-white tracking-wide mb-4">Kundenliste</h2>
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
                  <tr key={c.id}>
                    <td className="font-medium text-white">{c.name}</td>
                    <td className="hidden sm:table-cell text-zinc-400">{c.email ?? "—"}</td>
                    <td className="hidden md:table-cell text-zinc-400">{c.phone ?? "—"}</td>
                    <td className="hidden lg:table-cell text-zinc-500 text-xs">
                      {new Date(c.created_at).toLocaleString("de-DE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="text-zinc-500 text-sm mt-4 text-center">Noch keine Kunden manuell angelegt.</p>}
        </section>
      </div>
    </RtShell>
  );
}
