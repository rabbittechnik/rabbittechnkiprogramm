import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const newSw = reg.installing;
          if (!newSw) return;
          newSw.addEventListener("statechange", () => {
            if (newSw.state === "activated" && navigator.serviceWorker.controller) {
              showUpdateBanner();
            }
          });
        });
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {});
  });
}

function showUpdateBanner() {
  if (document.getElementById("rt-update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "rt-update-banner";
  bar.setAttribute("role", "alert");
  Object.assign(bar.style, {
    position: "fixed", bottom: "0", left: "0", right: "0", zIndex: "9999",
    background: "#00d4ff", color: "#060b13", padding: "12px 16px",
    display: "flex", alignItems: "center", justifyContent: "center", gap: "12px",
    fontFamily: "system-ui,sans-serif", fontSize: "14px", fontWeight: "600",
  });
  bar.textContent = "Neue Version verfügbar";
  const btn = document.createElement("button");
  Object.assign(btn.style, {
    background: "#060b13", color: "#00d4ff", border: "none", borderRadius: "8px",
    padding: "8px 20px", fontWeight: "700", fontSize: "14px", cursor: "pointer",
    minHeight: "40px",
  });
  btn.textContent = "Jetzt aktualisieren";
  btn.onclick = () => window.location.reload();
  bar.appendChild(btn);
  document.body.appendChild(bar);
}
