import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchWorkshop } from "../api";
import { RtShell } from "../components/RtShell";
import { SignatureCanvas, type SignatureCanvasRef } from "../components/SignatureCanvas";
import { useWorkshopGate } from "../useWorkshopGate";

type Customer = { id: string; name: string; email: string | null; phone: string | null; address: string | null };

type ApiProduct = {
  id: string;
  name: string;
  description: string;
  sale_cents: number;
  category_id: string;
  subcategory_id: string;
  image_url: string | null;
};

type ApiSub = { id: string; label: string; products: ApiProduct[] };
type ApiCat = { id: string; label: string; subcategories: ApiSub[] };

function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function TeileBestellenPage() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin, logout } = useWorkshopGate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [creating, setCreating] = useState(false);

  const [catalog, setCatalog] = useState<ApiCat[]>([]);
  const [markupBps, setMarkupBps] = useState(1000);
  const [globalSearch, setGlobalSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);

  const [step, setStep] = useState<"kunde" | "katalog" | "abschluss">("kunde");
  const [orderStatus, setOrderStatus] = useState<"angebot" | "bestaetigt">("angebot");
  const [sendEmail, setSendEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ reference: string; mailReason?: string; emailSent?: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sigRef = useRef<SignatureCanvasRef>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const rows = await fetchWorkshop<Customer[]>("/api/customers");
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const d = await fetchWorkshop<{ markup_bps: number; categories: ApiCat[] }>("/api/teile-bestellen/katalog");
      setMarkupBps(d.markup_bps);
      setCatalog(d.categories);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    if (gate === "ok") void loadCustomers();
  }, [gate, loadCustomers]);

  useEffect(() => {
    if (gate === "ok" && step !== "kunde") void loadCatalog();
  }, [gate, step, loadCatalog]);

  const productById = useMemo(() => {
    const m = new Map<string, ApiProduct>();
    for (const c of catalog) {
      for (const s of c.subcategories) {
        for (const p of s.products) m.set(p.id, p);
      }
    }
    return m;
  }, [catalog]);

  const flatProducts = useMemo(() => [...productById.values()], [productById]);

  const filteredBySearch = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    return flatProducts.filter((p) => {
      const c = catalog.find((x) => x.id === p.category_id);
      const s = c?.subcategories.find((x) => x.id === p.subcategory_id);
      const blob = `${p.name} ${p.description} ${c?.label ?? ""} ${s?.label ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [globalSearch, flatProducts, catalog]);

  const filteredBrowse = useMemo(() => {
    if (globalSearch.trim()) return [];
    if (!activeCat) return [];
    const c = catalog.find((x) => x.id === activeCat);
    if (!c) return [];
    if (!activeSub) return [];
    const s = c.subcategories.find((x) => x.id === activeSub);
    return s?.products ?? [];
  }, [catalog, activeCat, activeSub, globalSearch]);

  const cartLines = useMemo(() => {
    const lines: { product: ApiProduct; qty: number }[] = [];
    for (const [id, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const p = productById.get(id);
      if (p) lines.push({ product: p, qty });
    }
    return lines;
  }, [cart, productById]);

  const cartTotalCents = useMemo(
    () => cartLines.reduce((s, l) => s + l.product.sale_cents * l.qty, 0),
    [cartLines]
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const addToCart = (id: string) => {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    setCartOpen(true);
  };

  const setQty = (id: string, qty: number) => {
    if (qty <= 0) {
      setCart((c) => {
        const n = { ...c };
        delete n[id];
        return n;
      });
      return;
    }
    setCart((c) => ({ ...c, [id]: Math.min(999, qty) }));
  };

  const createCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const r = await fetchWorkshop<{ customer: Customer }>("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim() || null,
          phone: newPhone.trim() || null,
          address: newAddress.trim() || null,
        }),
      });
      setSelectedCustomer(r.customer);
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewAddress("");
      await loadCustomers();
      setCart({});
      setCartOpen(false);
      setStep("katalog");
      setActiveCat(null);
      setActiveSub(null);
      setGlobalSearch("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setCreating(false);
    }
  };

  const goCatalog = () => {
    if (!selectedCustomer) return;
    setStep("katalog");
    setDone(null);
    setCart({});
    setCartOpen(false);
    setActiveCat(null);
    setActiveSub(null);
    setGlobalSearch("");
  };

  const submitOrder = async () => {
    if (!selectedCustomer || cartLines.length === 0) return;
    const sig = sigRef.current?.toDataURL() ?? "";
    if (!sig || sig.length < 500) {
      setErr("Bitte unterschreiben Sie für die Kundenbestätigung.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetchWorkshop<{
        reference_code: string;
        customer_email_sent?: boolean;
        mail_reason?: string;
      }>("/api/teile-bestellen/orders", {
        method: "POST",
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          lines: cartLines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
          signature_data_url: sig,
          status: orderStatus,
          send_customer_email: sendEmail,
        }),
      });
      setDone({
        reference: r.reference_code,
        mailReason: r.mail_reason,
        emailSent: r.customer_email_sent,
      });
      setCart({});
      setCartOpen(false);
      sigRef.current?.clear();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (gate === "loading") {
    return (
      <RtShell title="Teile bestellen">
        <p className="text-zinc-500 text-center py-12">Laden…</p>
      </RtShell>
    );
  }

  if (gate === "login") {
    return (
      <RtShell title="Teile bestellen" subtitle="Werkstatt-Anmeldung erforderlich">
        <div className="max-w-md mx-auto rt-panel rt-panel-cyan p-4">
          <form onSubmit={(e) => void tryLogin(e)} className="space-y-4">
            <input
              type="password"
              className="rt-input-neon w-full"
              placeholder="Passwort"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
            />
            {loginErr && <p className="text-sm text-red-400">{loginErr}</p>}
            <button type="submit" className="rt-btn-confirm w-full min-h-[48px]">
              Anmelden
            </button>
          </form>
        </div>
      </RtShell>
    );
  }

  return (
    <RtShell
      title="Teile bestellen"
      subtitle="Hardware & IT-Komponenten · tabletoptimiert"
      actions={
        <div className="flex flex-wrap gap-2 items-center">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            Dashboard
          </Link>
          <button type="button" onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 px-2">
            Abmelden
          </button>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-4 pb-28 sm:pb-8">
        {err && <p className="text-red-400 text-sm rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">{err}</p>}

        {done && (
          <div className="rt-panel rt-panel-cyan p-4 space-y-2">
            <p className="text-lg font-semibold text-emerald-300">Gespeichert</p>
            <p className="text-sm text-zinc-300">
              Referenz: <span className="font-mono text-[#00d4ff]">{done.reference}</span>
            </p>
            {sendEmail && (
              <p className="text-xs text-zinc-500">
                E-Mail an Kunde:{" "}
                {done.emailSent ? <span className="text-emerald-400">versendet</span> : <span className="text-amber-300">nicht versendet{done.mailReason ? ` (${done.mailReason})` : ""}</span>}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="rt-btn-confirm text-sm"
                onClick={() => {
                  setDone(null);
                  setStep("kunde");
                  setSelectedCustomer(null);
                  setCart({});
                  setErr(null);
                }}
              >
                Neuer Vorgang
              </button>
              <Link to="/" className="rt-btn-secondary text-sm inline-flex items-center px-4 min-h-[44px]">
                Dashboard
              </Link>
            </div>
          </div>
        )}

        {!done && step === "kunde" && (
          <div className="space-y-6">
            <p className="text-sm text-zinc-400 border-l-2 border-amber-400/50 pl-3">
              Wählen Sie einen Kunden aus den Stammdaten oder legen Sie einen neuen Kunden an. Ohne Kunde geht es nicht weiter.
            </p>
            <div className="rt-panel rt-panel-violet p-4">
              <p className="text-xs uppercase tracking-wide text-violet-300 mb-2">Kunde suchen</p>
              <input
                className="rt-input-neon w-full mb-3"
                placeholder="Name, E-Mail oder Telefon"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
              <ul className="max-h-[40vh] overflow-y-auto space-y-1">
                {filteredCustomers.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setErr(null);
                      }}
                      className={`w-full text-left rounded-xl px-3 py-3 border transition-colors ${
                        selectedCustomer?.id === c.id
                          ? "border-[#00d4ff]/60 bg-[#00d4ff]/10"
                          : "border-white/10 hover:border-white/20 bg-[#060b13]/60"
                      }`}
                    >
                      <span className="font-medium text-white">{c.name}</span>
                      <span className="block text-xs text-zinc-500 truncate">{c.email ?? "—"} · {c.phone ?? "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rt-panel rt-panel-cyan p-4">
              <p className="text-xs uppercase tracking-wide text-cyan-300 mb-2">Neuer Kunde</p>
              <form onSubmit={(e) => void createCustomer(e)} className="space-y-3">
                <input className="rt-input-neon w-full" placeholder="Name *" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                <input className="rt-input-neon w-full" placeholder="E-Mail" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" />
                <input className="rt-input-neon w-full" placeholder="Telefon" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                <input className="rt-input-neon w-full" placeholder="Adresse" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
                <button type="submit" className="rt-btn-confirm w-full min-h-[48px]" disabled={creating}>
                  {creating ? "Speichern…" : "Kunde anlegen & weiter"}
                </button>
              </form>
            </div>

            <button
              type="button"
              className="rt-btn-confirm w-full min-h-[52px] text-base"
              disabled={!selectedCustomer}
              onClick={() => goCatalog()}
            >
              Weiter zur Teileauswahl
            </button>
          </div>
        )}

        {!done && step === "katalog" && selectedCustomer && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="text-sm text-[#00d4ff] underline"
                onClick={() => {
                  setStep("kunde");
                  setActiveCat(null);
                  setActiveSub(null);
                }}
              >
                ← Kunde wechseln
              </button>
              <p className="text-sm text-zinc-400">
                Kunde: <span className="text-white font-medium">{selectedCustomer.name}</span>
              </p>
            </div>

            <input
              className="rt-input-neon w-full text-base min-h-[52px]"
              placeholder="Suche in allen Kategorien (z. B. SSD 1TB, LAN 10m, Monitor 27)…"
              value={globalSearch}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setActiveCat(null);
                setActiveSub(null);
              }}
            />

            {globalSearch.trim() ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {filteredBySearch.map((p) => (
                  <article key={p.id} className="rounded-xl border border-white/10 bg-[#060b13]/90 p-3 flex flex-col gap-2">
                    <div className="h-28 rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center text-4xl text-zinc-600 border border-white/5">
                      {p.image_url ? <img src={p.image_url} alt="" className="max-h-full max-w-full object-contain" /> : "◧"}
                    </div>
                    <h3 className="text-sm font-semibold text-white leading-snug">{p.name}</h3>
                    <p className="text-xs text-zinc-500 line-clamp-3">{p.description}</p>
                    <div className="flex items-center justify-between gap-2 mt-auto pt-2">
                      <span className="font-mono text-[#00d4ff]">{euro(p.sale_cents)}</span>
                      <button type="button" className="rt-btn-confirm text-sm px-4 py-2" onClick={() => addToCart(p.id)}>
                        Hinzufügen
                      </button>
                    </div>
                  </article>
                ))}
                {filteredBySearch.length === 0 && <p className="text-zinc-500 text-sm col-span-full">Keine Treffer.</p>}
              </div>
            ) : !activeCat ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {catalog.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveCat(c.id);
                      setActiveSub(null);
                    }}
                    className="min-h-[100px] rounded-2xl border-2 border-cyan-500/35 bg-gradient-to-br from-cyan-500/10 to-transparent p-4 text-left hover:border-cyan-400/60 active:scale-[0.99] transition-transform"
                  >
                    <span className="text-sm font-semibold text-cyan-100 leading-tight">{c.label}</span>
                  </button>
                ))}
              </div>
            ) : !activeSub ? (
              <div className="space-y-3">
                <button type="button" className="text-sm text-zinc-400 underline" onClick={() => setActiveCat(null)}>
                  ← Alle Kategorien
                </button>
                <div className="grid sm:grid-cols-2 gap-2">
                  {catalog
                    .find((x) => x.id === activeCat)
                    ?.subcategories.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setActiveSub(s.id)}
                        className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-4 py-4 text-left text-sm text-violet-100 hover:bg-violet-500/15 min-h-[56px]"
                      >
                        {s.label}
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  <button type="button" className="text-zinc-400 underline" onClick={() => setActiveSub(null)}>
                    ← Unterkategorien
                  </button>
                  <span className="text-zinc-600">|</span>
                  <button type="button" className="text-zinc-400 underline" onClick={() => setActiveCat(null)}>
                    Alle Kategorien
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {filteredBrowse.map((p) => (
                    <article key={p.id} className="rounded-xl border border-white/10 bg-[#060b13]/90 p-3 flex flex-col gap-2">
                      <div className="h-28 rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center text-4xl text-zinc-600 border border-white/5">
                        {p.image_url ? <img src={p.image_url} alt="" className="max-h-full max-w-full object-contain" /> : "◧"}
                      </div>
                      <h3 className="text-sm font-semibold text-white leading-snug">{p.name}</h3>
                      <p className="text-xs text-zinc-500 line-clamp-3">{p.description}</p>
                      <div className="flex items-center justify-between gap-2 mt-auto pt-2">
                        <span className="font-mono text-[#00d4ff]">{euro(p.sale_cents)}</span>
                        <button type="button" className="rt-btn-confirm text-sm px-4 py-2" onClick={() => addToCart(p.id)}>
                          Hinzufügen
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#060b13]/98 backdrop-blur-md px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-3 max-w-5xl mx-auto">
              <button
                type="button"
                onClick={() => setCartOpen((o) => !o)}
                className="flex-1 min-h-[52px] rounded-xl border border-[#00d4ff]/40 text-[#00d4ff] font-semibold flex items-center justify-center gap-2"
              >
                Warenkorb ({cartLines.length}) · {euro(cartTotalCents)}
              </button>
              <button
                type="button"
                disabled={cartLines.length === 0}
                onClick={() => {
                  setStep("abschluss");
                  setCartOpen(false);
                  setErr(null);
                }}
                className="flex-1 min-h-[52px] rt-btn-confirm disabled:opacity-40"
              >
                Angebot / Bestellung
              </button>
            </div>

            {cartOpen && (
              <div
                className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3"
                role="dialog"
                aria-modal
              >
                <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#0a1220] p-4 shadow-2xl">
                  <div className="flex justify-between items-center mb-3">
                    <p className="font-semibold text-white">Warenkorb</p>
                    <button type="button" className="text-zinc-400 text-sm underline" onClick={() => setCartOpen(false)}>
                      Schließen
                    </button>
                  </div>
                  <ul className="space-y-3 mb-4">
                    {cartLines.map(({ product: p, qty }) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
                        <span className="flex-1 min-w-[140px] text-sm text-zinc-300">{p.name}</span>
                        <div className="flex items-center gap-2">
                          <button type="button" className="w-10 h-10 rounded-lg border border-white/20" onClick={() => setQty(p.id, qty - 1)}>
                            −
                          </button>
                          <input
                            className="w-14 text-center rt-input-neon !min-h-[40px]"
                            inputMode="numeric"
                            value={qty}
                            onChange={(e) => setQty(p.id, parseInt(e.target.value, 10) || 0)}
                          />
                          <button type="button" className="w-10 h-10 rounded-lg border border-white/20" onClick={() => setQty(p.id, qty + 1)}>
                            +
                          </button>
                        </div>
                        <span className="font-mono text-emerald-300">{euro(p.sale_cents * qty)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-right text-lg font-mono text-white mb-2">
                    Summe <span className="text-[#00d4ff]">{euro(cartTotalCents)}</span>
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Preise inkl. internem Aufschlag ({(markupBps / 100).toFixed(0)} %); Einkaufspositionen für spätere Händler-API vorbereitet.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {!done && step === "abschluss" && selectedCustomer && (
          <div className="space-y-5 pb-8">
            <button
              type="button"
              className="text-sm text-[#00d4ff] underline"
              onClick={() => {
                setStep("katalog");
              }}
            >
              ← Zurück zur Auswahl
            </button>

            <div className="rt-panel rt-panel-violet p-4 space-y-3">
              <p className="text-sm text-zinc-400">Kunde</p>
              <p className="text-white font-medium text-lg">{selectedCustomer.name}</p>
              <p className="text-xs text-zinc-500">{selectedCustomer.email ?? "—"} · {selectedCustomer.phone ?? "—"}</p>
            </div>

            <div className="rt-panel rt-panel-cyan p-4">
              <p className="text-xs uppercase text-cyan-300 mb-2">Positionen</p>
              <ul className="space-y-2 text-sm">
                {cartLines.map(({ product: p, qty }) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {qty}× {p.name}
                    </span>
                    <span className="font-mono text-[#00d4ff]">{euro(p.sale_cents * qty)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-right text-xl font-mono text-white mt-3 pt-3 border-t border-white/10">
                Gesamt {euro(cartTotalCents)}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-zinc-300">Art der Erfassung</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <label
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 cursor-pointer ${
                    orderStatus === "angebot" ? "border-[#00d4ff]/50 bg-[#00d4ff]/10" : "border-white/15"
                  }`}
                >
                  <input type="radio" name="ordst" checked={orderStatus === "angebot"} onChange={() => setOrderStatus("angebot")} />
                  <span>Angebot erstellen</span>
                </label>
                <label
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 cursor-pointer ${
                    orderStatus === "bestaetigt" ? "border-emerald-400/50 bg-emerald-500/10" : "border-white/15"
                  }`}
                >
                  <input type="radio" name="ordst" checked={orderStatus === "bestaetigt"} onChange={() => setOrderStatus("bestaetigt")} />
                  <span>Bestellung bestätigen</span>
                </label>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-white/10 px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="mt-1" />
              <span className="text-sm text-zinc-400">Kunden-E-Mail mit Übersicht senden (wenn Adresse hinterlegt und Mail konfiguriert)</span>
            </label>

            <div>
              <p className="text-sm text-zinc-400 mb-2">Unterschrift Kunde</p>
              <SignatureCanvas ref={sigRef} width={900} height={200} className="w-full max-w-full rounded-xl border border-white/15 bg-white touch-none" />
              <p className="text-[10px] text-zinc-600 mt-1">Mit dem Finger oder Stift auf dem Tablet unterschreiben.</p>
            </div>

            <button
              type="button"
              className="rt-btn-confirm w-full min-h-[56px] text-base"
              disabled={submitting || cartLines.length === 0}
              onClick={() => void submitOrder()}
            >
              {submitting ? "Speichern…" : "Speichern & abschließen"}
            </button>
          </div>
        )}
      </div>
    </RtShell>
  );
}
