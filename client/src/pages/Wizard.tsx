import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import { RabbitMark, BrandWordmark } from "../components/RabbitMark";

const DEVICE_TYPES = ["Laptop", "PC", "Smartphone", "Tablet", "Konsole", "Sonstiges"];

type Problem = { key: string; label: string };
type ServiceRow = { id: string; code: string; name: string; price_cents: number };
type PartSuggestion = { id: string; name: string; sale_cents: number; score: number; notes: string | null };

export function Wizard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [deviceType, setDeviceType] = useState("Laptop");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [deviceImageUrl, setDeviceImageUrl] = useState<string | null>(null);
  const [deviceImageHint, setDeviceImageHint] = useState<string | null>(null);
  const [problemKey, setProblemKey] = useState("");
  const [description, setDescription] = useState("");
  const [accessories, setAccessories] = useState("");
  const [preDamage, setPreDamage] = useState<string[]>([]);
  const [legal, setLegal] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [extraServiceCodes, setExtraServiceCodes] = useState<string[]>([]);
  const [allServices, setAllServices] = useState<ServiceRow[]>([]);

  const [preview, setPreview] = useState<{ services: ServiceRow[]; total_cents: number } | null>(null);
  const [partSuggestions, setPartSuggestions] = useState<PartSuggestion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ tracking: string; id: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetchJson<Problem[]>("/api/problems").then(setProblems).catch(console.error);
    fetchJson<ServiceRow[]>("/api/services").then(setAllServices).catch(console.error);
  }, []);

  const refreshPreview = useCallback(async () => {
    if (!problemKey) {
      setPreview(null);
      return;
    }
    const data = await fetchJson<{
      services: ServiceRow[];
      total_cents: number;
      suggested_service_codes: string[];
    }>("/api/repairs/preview", {
      method: "POST",
      body: JSON.stringify({ problem_key: problemKey, extra_service_codes: extraServiceCodes }),
    });
    setPreview({ services: data.services, total_cents: data.total_cents });
  }, [problemKey, extraServiceCodes]);

  useEffect(() => {
    void refreshPreview();
  }, [problemKey, extraServiceCodes, refreshPreview]);

  const suggestionQuery = useMemo(() => {
    const p = problems.find((x) => x.key === problemKey)?.label ?? "";
    return `${p} ${description}`.trim();
  }, [problemKey, description, problems]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!suggestionQuery) {
        setPartSuggestions([]);
        return;
      }
      fetchJson<{ suggestions: PartSuggestion[] }>(`/api/suggestions/parts?q=${encodeURIComponent(suggestionQuery)}`)
        .then((d) => setPartSuggestions(d.suggestions))
        .catch(() => setPartSuggestions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [suggestionQuery]);

  const loadDeviceImage = async () => {
    const q = [brand, model, deviceType].filter(Boolean).join(" ");
    const d = await fetchJson<{ image_url: string; source?: string; hint?: string }>(
      `/api/device-image?q=${encodeURIComponent(q || "device")}`
    );
    setDeviceImageUrl(d.image_url);
    setDeviceImageHint(d.hint ?? (d.source ? `Quelle: ${d.source}` : null));
  };

  const problemLabel = problems.find((x) => x.key === problemKey)?.label ?? "";

  const statusHeadline = useMemo(() => {
    if (!problemKey) return "Status: Annahme – Daten ergänzen";
    return `Status: Vorgesehen – ${problemLabel || "Diagnose / Bearbeitung"}`;
  }, [problemKey, problemLabel]);

  const toggleExtraService = (code: string) => {
    setExtraServiceCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const canvasPos = (e: React.PointerEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const startDraw = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c) return;
    drawing.current = true;
    c.setPointerCapture(e.pointerId);
    lastPoint.current = canvasPos(e, c);
  };

  const draw = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = canvasRef.current;
    if (!c || !lastPoint.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = canvasPos(e, c);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
  };

  const endDraw = (e: React.PointerEvent) => {
    drawing.current = false;
    lastPoint.current = null;
    const c = canvasRef.current;
    if (c?.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
  };

  const clearSignature = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#060b13";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  const submit = async () => {
    const c = canvasRef.current;
    const signature_data_url = c ? c.toDataURL("image/png") : "";
    if (!customerName.trim()) {
      alert("Bitte Kundenname eingeben.");
      return;
    }
    if (!legal) {
      alert("Bitte Zustimmung bestätigen.");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        customer: { name: customerName, email: customerEmail || null, phone: customerPhone || null },
        device: {
          device_type: deviceType,
          brand: brand || null,
          model: model || null,
          serial_number: serial || null,
          device_image_url: deviceImageUrl,
        },
        problem_key: problemKey,
        description: description || null,
        accessories: accessories || null,
        pre_damage_notes: preDamage.length ? JSON.stringify(preDamage) : null,
        legal_consent: true,
        signature_data_url,
        extra_service_codes: extraServiceCodes,
      };
      const res = await fetchJson<{ repair: { id: string }; tracking_code: string }>("/api/repairs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDone({ tracking: res.tracking_code, id: res.repair.id });
    } catch (e) {
      alert(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center rt-dashboard-bg -mx-4 px-4">
        <div className="max-w-lg w-full rounded-2xl border-2 border-[#39ff14]/40 bg-[#0a1220]/95 p-8 text-center space-y-6 shadow-[0_0_40px_rgba(57,255,20,0.15)]">
          <h2 className="font-display text-2xl font-bold text-[#39ff14] drop-shadow-[0_0_12px_rgba(57,255,20,0.5)]">Auftrag gespeichert</h2>
          <p className="text-zinc-400">Tracking-Code für den Kunden:</p>
          <p className="text-3xl font-mono font-bold tracking-wider text-white">{done.tracking}</p>
          <div className="flex justify-center">
            <img
              src={`/api/repairs/${done.id}/qr.png`}
              alt="QR Tracking"
              className="w-40 h-40 rounded-xl border border-[#00d4ff]/40 bg-white p-2"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to={`/track/${encodeURIComponent(done.tracking)}`}
              className="inline-flex items-center justify-center rounded-xl min-h-[52px] px-6 font-semibold bg-gradient-to-r from-[#39ff14] to-[#00d4ff] text-[#060b13]"
            >
              Status anzeigen
            </Link>
            <a
              href={`/api/repairs/${done.id}/invoice.pdf`}
              className="inline-flex items-center justify-center rounded-xl min-h-[52px] px-6 font-semibold border border-[#00d4ff]/50 text-[#00d4ff]"
              target="_blank"
              rel="noreferrer"
            >
              Rechnung PDF
            </a>
          </div>
          <button
            type="button"
            className="w-full rounded-xl min-h-[48px] border border-zinc-600 text-zinc-300"
            onClick={() => window.location.reload()}
          >
            Weitere Annahme
          </button>
        </div>
      </div>
    );
  }

  const panel = (border: string, title: string, children: ReactNode) => (
    <section
      className={`rounded-2xl border-2 ${border} bg-[#0a1220]/90 p-4 sm:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}
    >
      <h2 className="text-sm font-bold text-white/90 mb-4 tracking-wide">{title}</h2>
      {children}
    </section>
  );

  return (
    <div className="rt-dashboard-bg -mx-4 min-h-[calc(100vh-1rem)] flex flex-col">
      <header className="relative flex flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-4 border-b border-[#00d4ff]/20 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <RabbitMark className="w-9 h-9 sm:w-10 sm:h-10" />
            <BrandWordmark />
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm sm:text-base text-[#00d4ff] font-medium hidden sm:inline">Reparaturannahme</span>
          <div className="relative">
            <button
              type="button"
              className="p-2 rounded-lg border border-[#00d4ff]/30 text-white hover:bg-white/5"
              aria-label="Menü"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-[#00d4ff]/30 bg-[#0a1220] py-2 shadow-xl z-50">
                <Link to="/" className="block px-4 py-2 text-sm hover:bg-white/5" onClick={() => setMenuOpen(false)}>
                  Hauptseite
                </Link>
                <Link to="/werkstatt" className="block px-4 py-2 text-sm hover:bg-white/5" onClick={() => setMenuOpen(false)}>
                  Werkstatt
                </Link>
                <Link to="/track" className="block px-4 py-2 text-sm hover:bg-white/5" onClick={() => setMenuOpen(false)}>
                  Kunden-Tracking
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-4 p-4 max-w-[1600px] mx-auto w-full">
        <div className="xl:col-span-4 min-w-0">
        {panel(
          "border-[#00d4ff]/45 shadow-[0_0_24px_rgba(0,212,255,0.12)]",
          "Kunden & Gerät",
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-wider">Kunde – Name *</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2.5 text-white outline-none focus:border-[#00d4ff]/60"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-zinc-500 text-xs">E-Mail</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-zinc-500 text-xs">Telefon</label>
                <input
                  type="tel"
                  className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Gerätetyp</label>
              <select
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2.5 text-white outline-none"
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
              >
                {DEVICE_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Marke</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="z. B. Acer"
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Modell</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Seriennummer</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Problem</label>
              <select
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2.5 text-white outline-none"
                value={problemKey}
                onChange={(e) => setProblemKey(e.target.value)}
              >
                <option value="">— wählen —</option>
                {problems.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Fehlerbeschreibung</label>
              <textarea
                className="mt-1 w-full min-h-[88px] rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none resize-y"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Symptome, Details…"
              />
            </div>
            <div>
              <label className="text-zinc-500 text-xs">Zubehör mitgegeben</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#00d4ff]/25 bg-[#060b13] px-3 py-2 text-white outline-none"
                value={accessories}
                onChange={(e) => setAccessories(e.target.value)}
                placeholder="Netzteil, Maus…"
              />
            </div>
            <div>
              <p className="text-zinc-500 text-xs mb-2">Vorschäden</p>
              <div className="flex flex-wrap gap-2">
                {["Gehäuse Kratzer", "Display Risse", "Fehlende Tasten", "Keine"].map((x) => (
                  <label key={x} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preDamage.includes(x)}
                      onChange={() =>
                        setPreDamage((p) => (p.includes(x) ? p.filter((y) => y !== x) : [...p, x]))
                      }
                      className="rounded border-[#00d4ff]/40"
                    />
                    {x}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>

        <div className="xl:col-span-4 min-w-0">
        {panel(
          "border-amber-400/40 shadow-[0_0_24px_rgba(241,196,15,0.1)]",
          "Auftragsdetails",
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => void loadDeviceImage()}
              className="w-full rounded-lg border border-amber-400/40 py-2 text-sm text-amber-200/90 hover:bg-amber-400/10"
            >
              Gerätebild laden
            </button>
            {deviceImageHint && <p className="text-[10px] text-zinc-500">{deviceImageHint}</p>}
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden border border-amber-400/30 bg-[#060b13]">
              {deviceImageUrl ? (
                <img src={deviceImageUrl} alt="Gerät" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">Kein Bild</div>
              )}
            </div>
            <p className="text-center text-white font-medium">
              {[brand, model].filter(Boolean).join(" ") || deviceType}
            </p>
            <p className="text-center text-[#f1c40f] text-sm font-semibold">{statusHeadline}</p>
            {accessories && (
              <p className="text-xs text-[#39ff14] flex items-start gap-2">
                <span className="text-[#39ff14]">✓</span>
                Zubehör: {accessories}
              </p>
            )}
            {preDamage.length > 0 && !preDamage.includes("Keine") && (
              <p className="text-xs text-[#39ff14] flex items-start gap-2">
                <span>✓</span>
                Vorschäden: {preDamage.filter((x) => x !== "Keine").join(", ")}
              </p>
            )}
            <div className="border-t border-white/10 pt-3 space-y-2">
              <p className="text-xs text-zinc-500 uppercase">Geplante Leistungen</p>
              {preview?.services.map((s) => (
                <div key={s.code} className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="text-[#39ff14]">✓</span>
                  {s.name}
                </div>
              ))}
              {!(preview?.services?.length) && <p className="text-zinc-600 text-sm">Problem wählen für Vorschau</p>}
            </div>
          </div>
        )}
        </div>

        <div className="xl:col-span-4 min-w-0">
        {panel(
          "border-[#9b59b6]/50 shadow-[0_0_24px_rgba(155,89,182,0.15)]",
          "Kostenübersicht",
          <div className="space-y-3">
            {preview?.services.map((s) => (
              <div key={s.code} className="flex justify-between text-sm text-zinc-300">
                <span>{s.name}</span>
                <span className="font-mono text-[#00d4ff]">{(s.price_cents / 100).toFixed(2)} €</span>
              </div>
            ))}
            {partSuggestions.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <p className="text-xs font-semibold text-[#39ff14] mb-2">Teile (Vorschlag)</p>
                {partSuggestions.slice(0, 4).map((p) => (
                  <div key={p.id} className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{p.name}</span>
                    <span className="text-amber-400/90">ab {(p.sale_cents / 100).toFixed(0)} €</span>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-4 mt-2 border-t-2 border-[#39ff14]/40">
              <div className="flex justify-between items-baseline">
                <span className="text-zinc-400 text-sm">GESAMT</span>
                <span className="text-2xl font-bold text-[#39ff14] drop-shadow-[0_0_12px_rgba(57,255,20,0.45)] font-mono">
                  {preview ? `${(preview.total_cents / 100).toFixed(2)} €` : "—"}
                </span>
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">zzgl. eingebuchter Ersatzteile in der Werkstatt</p>
            </div>
            <div className="pt-3">
              <p className="text-xs text-zinc-500 mb-2">Zusatz-Services</p>
              <div className="flex flex-wrap gap-1.5">
                {allServices.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => toggleExtraService(s.code)}
                    className={`px-2 py-1 rounded-md text-[10px] border ${
                      extraServiceCodes.includes(s.code)
                        ? "border-[#39ff14] bg-[#39ff14]/15 text-[#39ff14]"
                        : "border-zinc-600 text-zinc-500"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      <div className="border-t border-[#00d4ff]/15 bg-[#060b13]/95 px-4 py-5 max-w-[1600px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-end">
          <div className="lg:col-span-2 space-y-3">
            <label className="text-xs text-zinc-500">Kundenunterschrift</label>
            <canvas
              ref={canvasRef}
              width={900}
              height={200}
              className="w-full max-h-[180px] rounded-xl border border-[#00d4ff]/30 touch-none bg-[#060b13] cursor-crosshair"
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerLeave={endDraw}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500">Hiermit akzeptiere ich die Reparaturbedingungen.</p>
              <button type="button" className="text-xs text-[#00d4ff] underline" onClick={clearSignature}>
                Unterschrift leeren
              </button>
            </div>
            <label className="flex items-start gap-2 cursor-pointer text-sm text-zinc-400">
              <input type="checkbox" checked={legal} onChange={(e) => setLegal(e.target.checked)} className="mt-1 rounded" />
              DSGVO & Haftungshinweise gelesen und zugestimmt.
            </label>
          </div>
          <div className="flex flex-col justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="w-full min-h-[64px] rounded-2xl font-bold text-lg flex items-center justify-center gap-2 bg-gradient-to-b from-[#4dff6e] to-[#1aad2e] text-[#060b13] shadow-[0_0_28px_rgba(57,255,20,0.45)] border border-white/20 active:scale-[0.99] disabled:opacity-50"
            >
              <span className="w-8 h-8 rounded-full bg-[#060b13]/20 flex items-center justify-center text-[#060b13]">✓</span>
              {submitting ? "Speichern…" : "Auftrag bestätigen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
