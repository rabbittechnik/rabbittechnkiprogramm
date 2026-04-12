import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AppShell, PageLoadingFallback } from "./components/AppShell";
import { getWorkshopToken, getWorkshopTokenRole } from "./workshopAuth";
import { parseScanToTrackingCode } from "./lib/trackingScan";

// ─── UI Layer (PWA) ────────────────────────────────────────────────────────
// AppShell = persistente Navigation, Dashboard, Menü „Buchhaltung & Reports",
// Layout/UX. Wird sofort gerendert und vom Service Worker gecacht.

// ─── Business Layer (lazy-loaded, Code-Split) ──────────────────────────────
// Jedes Modul wird erst bei Navigation geladen → schneller App-Start,
// kleinerer initialer Bundle.
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const Wizard = lazy(() => import("./pages/Wizard").then((m) => ({ default: m.Wizard })));
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

export default function App() {
  return (
    <Routes>
      {/* AppShell = UI Layer: Header, Navigation, Menü, Offline-Banner, Layout */}
      <Route element={<AppShell />}>
        {/* Business Layer: Datengetriebene Seiten */}
        <Route path="/" element={<SuspenseWrap><Home /></SuspenseWrap>} />
        <Route path="/annahme" element={<SuspenseWrap><Wizard /></SuspenseWrap>} />
        <Route path="/werkstatt" element={<SuspenseWrap><Workshop /></SuspenseWrap>} />
        <Route path="/werkstatt-montage" element={<SuspenseWrap><WorkshopBench /></SuspenseWrap>} />
        <Route path="/auftraege" element={<SuspenseWrap><Workshop pageTitle="Auftragsverwaltung" /></SuspenseWrap>} />
        <Route path="/kunden" element={<SuspenseWrap><KundenPage /></SuspenseWrap>} />
        <Route path="/teile-bestellen" element={<SuspenseWrap><TeileBestellenPage /></SuspenseWrap>} />
        <Route path="/track" element={<SuspenseWrap><TrackPage /></SuspenseWrap>} />
        <Route path="/track/:code" element={<SuspenseWrap><TrackPage /></SuspenseWrap>} />
        <Route path="/repair/:code" element={<RepairAliasRedirect />} />
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
