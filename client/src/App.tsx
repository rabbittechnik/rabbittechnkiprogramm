import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AppShell, PageLoadingFallback } from "./components/AppShell";
import { getWorkshopToken, getWorkshopTokenRole } from "./workshopAuth";
import { parseScanToTrackingCode } from "./lib/trackingScan";
import { useWorkshopGate } from "./useWorkshopGate";

// ─── UI Layer (PWA) ────────────────────────────────────────────────────────
// AppShell = persistente Navigation, Dashboard, Menü „Buchhaltung & Reports",
// Layout/UX. Wird sofort gerendert und vom Service Worker gecacht.

// ─── Business Layer (lazy-loaded, Code-Split) ──────────────────────────────
// Jedes Modul wird erst bei Navigation geladen → schneller App-Start,
// kleinerer initialer Bundle.
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const Wizard = lazy(() => import("./pages/Wizard").then((m) => ({ default: m.Wizard })));
const RepairAmendmentPage = lazy(() =>
  import("./pages/RepairAmendmentPage").then((m) => ({ default: m.RepairAmendmentPage }))
);
const Workshop = lazy(() => import("./pages/Workshop").then((m) => ({ default: m.Workshop })));
const WorkshopBench = lazy(() => import("./pages/WorkshopBench").then((m) => ({ default: m.WorkshopBench })));
const KundenPage = lazy(() => import("./pages/KundenPage").then((m) => ({ default: m.KundenPage })));
const TrackPage = lazy(() => import("./pages/TrackPage").then((m) => ({ default: m.TrackPage })));
const LagerPage = lazy(() => import("./pages/LagerPage").then((m) => ({ default: m.LagerPage })));
const StatistikPage = lazy(() => import("./pages/StatistikPage").then((m) => ({ default: m.StatistikPage })));
const RechnungenPage = lazy(() => import("./pages/RechnungenPage").then((m) => ({ default: m.RechnungenPage })));
const ErpOverlayPage = lazy(() => import("./pages/ErpOverlayPage").then((m) => ({ default: m.ErpOverlayPage })));
const BuchhaltungReportsPage = lazy(() => import("./pages/BuchhaltungReportsPage").then((m) => ({ default: m.BuchhaltungReportsPage })));
const TagesabschlussPage = lazy(() => import("./pages/TagesabschlussPage").then((m) => ({ default: m.TagesabschlussPage })));
const MonatsberichtPage = lazy(() => import("./pages/MonatsberichtPage").then((m) => ({ default: m.MonatsberichtPage })));
const PlaceholderPage = lazy(() => import("./pages/PlaceholderPage").then((m) => ({ default: m.PlaceholderPage })));
const NetworkWizard = lazy(() => import("./pages/NetworkWizard").then((m) => ({ default: m.NetworkWizard })));
const NetworkOrdersPage = lazy(() => import("./pages/NetworkOrdersPage").then((m) => ({ default: m.NetworkOrdersPage })));
const NetworkAdminPage = lazy(() => import("./pages/NetworkAdminPage").then((m) => ({ default: m.NetworkAdminPage })));
const TeileBestellenPage = lazy(() => import("./pages/TeileBestellenPage").then((m) => ({ default: m.TeileBestellenPage })));

function SuspenseWrap({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoadingFallback />}>{children}</Suspense>;
}

/** Alias `/repair/:code`: Werkstatt → Auftrag öffnen, sonst öffentliches Tracking. */
function RepairAliasRedirect() {
  const { code } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    const raw = (code ?? "").trim();
    if (!raw) {
      navigate("/", { replace: true });
      return;
    }
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    if (getWorkshopToken()) {
      if (getWorkshopTokenRole() === "bench") {
        navigate(`/werkstatt-montage?scan=${encodeURIComponent(decoded)}`, { replace: true });
      } else {
        navigate(`/werkstatt?scan=${encodeURIComponent(decoded)}`, { replace: true });
      }
      return;
    }
    const only = parseScanToTrackingCode(decoded) ?? decoded;
    navigate(`/track/${encodeURIComponent(only)}`, { replace: true });
  }, [code, navigate]);
  return <PageLoadingFallback />;
}

function InternalAppShell() {
  const { gate, loginPass, setLoginPass, loginErr, tryLogin } = useWorkshopGate();

  if (gate === "loading") {
    return <PageLoadingFallback label="Werkstatt-Anmeldung pruefen..." />;
  }

  if (gate === "login") {
    return (
      <div className="rt-dashboard-bg min-h-screen flex items-center justify-center px-4">
        <form
          onSubmit={(e) => {
            void tryLogin(e);
          }}
          className="rt-panel rt-panel-cyan w-full max-w-sm space-y-4 p-6"
        >
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Interner Bereich</p>
            <h1 className="text-2xl font-bold text-[#00d4ff] mt-1">Werkstatt-Anmeldung</h1>
            <p className="text-sm text-zinc-400 mt-2">
              Kunden koennen nur die Statusverfolgung sehen. Fuer Auftragsannahme und Verwaltung ist ein Passwort noetig.
            </p>
          </div>
          <input
            className="rt-input-neon w-full"
            type="password"
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
    );
  }

  return <AppShell />;
}

export default function App() {
  return (
    <Routes>
      {/* Oeffentliche Kundenseiten laufen ohne AppShell, damit kein Werkstatt-Menue sichtbar ist. */}
      <Route path="/track" element={<SuspenseWrap><TrackPage /></SuspenseWrap>} />
      <Route path="/track/:code" element={<SuspenseWrap><TrackPage /></SuspenseWrap>} />
      <Route path="/repair/:code" element={<RepairAliasRedirect />} />

      {/* AppShell = UI Layer: Header, Navigation, Menü, Offline-Banner, Layout */}
      <Route element={<InternalAppShell />}>
        {/* Business Layer: Datengetriebene Seiten */}
        <Route path="/" element={<SuspenseWrap><Home /></SuspenseWrap>} />
        <Route path="/annahme" element={<SuspenseWrap><Wizard /></SuspenseWrap>} />
        <Route path="/annahme/nachtrag" element={<SuspenseWrap><RepairAmendmentPage /></SuspenseWrap>} />
        <Route path="/werkstatt" element={<SuspenseWrap><Workshop /></SuspenseWrap>} />
        <Route path="/werkstatt-montage" element={<SuspenseWrap><WorkshopBench /></SuspenseWrap>} />
        <Route path="/auftraege" element={<SuspenseWrap><Workshop pageTitle="Auftragsverwaltung" /></SuspenseWrap>} />
        <Route path="/kunden" element={<SuspenseWrap><KundenPage /></SuspenseWrap>} />
        <Route path="/teile-bestellen" element={<SuspenseWrap><TeileBestellenPage /></SuspenseWrap>} />
        <Route path="/lager" element={<SuspenseWrap><LagerPage /></SuspenseWrap>} />
        <Route path="/rechnungen" element={<SuspenseWrap><RechnungenPage /></SuspenseWrap>} />
        <Route path="/buchhaltung-erp" element={<SuspenseWrap><ErpOverlayPage /></SuspenseWrap>} />
        <Route path="/buchhaltung-reports" element={<SuspenseWrap><BuchhaltungReportsPage /></SuspenseWrap>} />
        <Route path="/tagesabschluss" element={<SuspenseWrap><TagesabschlussPage /></SuspenseWrap>} />
        <Route path="/monatsbericht" element={<SuspenseWrap><MonatsberichtPage /></SuspenseWrap>} />
        <Route path="/netzwerk" element={<SuspenseWrap><NetworkWizard /></SuspenseWrap>} />
        <Route path="/netzwerk-auftraege" element={<SuspenseWrap><NetworkOrdersPage /></SuspenseWrap>} />
        <Route path="/netzwerk-admin" element={<SuspenseWrap><NetworkAdminPage /></SuspenseWrap>} />
        <Route path="/statistik" element={<SuspenseWrap><StatistikPage /></SuspenseWrap>} />
        <Route
          path="/einstellungen"
          element={
            <SuspenseWrap>
              <PlaceholderPage
                title="Einstellungen"
                description="Firmendaten, Benutzer, Drucklayouts und Anbindungen (E-Mail, APIs) lassen sich später zentral pflegen."
              />
            </SuspenseWrap>
          }
        />
      </Route>
    </Routes>
  );
}
