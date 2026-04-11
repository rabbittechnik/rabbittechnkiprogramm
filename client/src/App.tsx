import { Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Wizard } from "./pages/Wizard";
import { TrackPage } from "./pages/TrackPage";
import { Workshop } from "./pages/Workshop";
import { KundenPage } from "./pages/KundenPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { LagerPage } from "./pages/LagerPage";
import { StatistikPage } from "./pages/StatistikPage";
import { RechnungenPage } from "./pages/RechnungenPage";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/annahme" element={<Wizard />} />
          <Route path="/werkstatt" element={<Workshop />} />
          <Route path="/auftraege" element={<Workshop pageTitle="Auftragsverwaltung" />} />
          <Route path="/kunden" element={<KundenPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/track/:code" element={<TrackPage />} />
          <Route path="/lager" element={<LagerPage />} />
          <Route path="/rechnungen" element={<RechnungenPage />} />
          <Route path="/statistik" element={<StatistikPage />} />
          <Route
            path="/einstellungen"
            element={
              <PlaceholderPage
                title="Einstellungen"
                description="Firmendaten, Benutzer, Drucklayouts und Anbindungen (E-Mail, APIs) lassen sich später zentral pflegen."
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}
