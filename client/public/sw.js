/// <reference lib="webworker" />

// ---------------------------------------------------------------------------
// Rabbit-Technik Service Worker
// ---------------------------------------------------------------------------
// - App Shell Cache: UI-Grundstruktur für sofortigen Start
// - API Data Cache: Dashboard, Kunden, Reparaturen offline verfügbar
// - Mutations (POST/PATCH/DELETE): immer Network-only
// ---------------------------------------------------------------------------

const SHELL_CACHE = "rt-shell-v2";
const DATA_CACHE = "rt-data-v1";

// App Shell: bei Install komplett vorladen
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icon.svg",
  "/icon-maskable.svg",
  "/favicon.svg",
];

// ── Cacheable API (nur aggregierte / nicht-personenbezogene Daten) ──────────
// Personenbezogene Daten (Kunden-E-Mails, Telefon, Adressen, Rechnungsdetails)
// werden NICHT im Cache gespeichert → network-only für diese Endpunkte.
const CACHEABLE_API_PATTERNS = [
  "/api/dashboard/summary",    // nur Zähler, kein PII
  "/api/services",             // Dienstleistungskatalog (öffentlich)
  "/api/problems",             // Problemkategorien (öffentlich)
  "/api/stats/overview",       // aggregierte Statistik
  "/api/erp/overview",         // aggregierte Kennzahlen
  "/api/auth/status",          // nur Boolean
  "/api/tagesabschluesse",     // Tagesberichte (aggregiert)
  "/api/monatsberichte",       // Monatsberichte (aggregiert)
];

// Einzeldaten – nur aggregierte Reports, keine Kundendaten
const CACHEABLE_API_PREFIXES = [
  "/api/tagesabschluesse/",
  "/api/monatsberichte/",
];

// NICHT gecacht (personenbezogene / sensible Daten):
// /api/customers, /api/customers/:id, /api/repairs, /api/repairs/:id,
// /api/invoices, /api/track/:code – bleiben network-only

// ---------------------------------------------------------------------------
// Install: App Shell vorladen
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate: alte Caches aufräumen
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Message Handler: Cache-Cleanup bei Logout
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_SENSITIVE_CACHES") {
    caches.delete(DATA_CACHE).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ cleared: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isCacheableApiGet(pathname) {
  if (CACHEABLE_API_PATTERNS.some((p) => pathname === p)) return true;
  if (CACHEABLE_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    // PDF-Downloads und Binärdaten nicht cachen
    if (pathname.endsWith(".pdf") || pathname.endsWith(".png")) return false;
    return true;
  }
  return false;
}

function isApiRequest(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/webhook/") ||
    pathname.startsWith("/uploads/") ||
    pathname.startsWith("/create-sumup-checkout")
  );
}

function isMutatingRequest(method) {
  return method !== "GET" && method !== "HEAD";
}

// ---------------------------------------------------------------------------
// Fetch Handler
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const { pathname } = url;
  const { method } = event.request;

  // ── Mutations (POST/PATCH/DELETE): Network-only, bei Offline
  //    durchreichen an Client (offlineQueue fängt den TypeError) ──
  if (isMutatingRequest(method)) {
    return;
  }

  // ── Cacheable API GET: Network-first mit Data-Cache Fallback ──
  if (isApiRequest(pathname) && isCacheableApiGet(pathname)) {
    event.respondWith(networkFirstApi(event.request));
    return;
  }

  // ── Nicht-cacheable API / Webhooks / Uploads: Network-only ──
  if (isApiRequest(pathname)) {
    return; // Browser default
  }

  // ── Navigation (HTML): Network-first, Fallback auf gecachte Shell ──
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstShell(event.request));
    return;
  }

  // ── Statische Assets (JS/CSS/Fonts/Bilder): Stale-while-revalidate ──
  event.respondWith(staleWhileRevalidate(event.request));
});

// ---------------------------------------------------------------------------
// Strategien
// ---------------------------------------------------------------------------

const DATA_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 Stunden

/** Prüft ob ein gecachter Response älter als DATA_MAX_AGE_MS ist. */
function isCacheExpired(response) {
  const dateHeader = response.headers.get("date") || response.headers.get("sw-cached-at");
  if (!dateHeader) return false;
  return Date.now() - new Date(dateHeader).getTime() > DATA_MAX_AGE_MS;
}

/** Erstellt eine Kopie des Response mit Cache-Zeitstempel, ohne Authorization-Informationen. */
function stampResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("sw-cached-at", new Date().toISOString());
  headers.delete("authorization");
  headers.delete("set-cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** API: Network-first → bei Offline den letzten gecachten Stand liefern. */
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, stampResponse(response.clone()));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached && !isCacheExpired(cached)) return cached;
    if (cached) return cached;
    return new Response(
      JSON.stringify({
        error: "Offline – keine gecachten Daten verfügbar",
        offline: true,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/** Navigation: Network-first → gecachte index.html als Fallback. */
async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // SPA: alle Routen liefern die Shell (index.html)
    const shell = await caches.match("/");
    if (shell) return shell;
    return new Response(offlineHtml(), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

/** Statische Assets: Cache-first, im Hintergrund aktualisieren. */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        const cache = caches.open(SHELL_CACHE);
        cache.then((c) => c.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// ---------------------------------------------------------------------------
// Offline-Fallback HTML (wenn gar nichts gecacht ist)
// ---------------------------------------------------------------------------
function offlineHtml() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="theme-color" content="#060b13"/>
  <title>Rabbit Technik – Offline</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#060b13;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem;text-align:center}
    h1{font-size:1.5rem;margin-bottom:1rem;color:#00d4ff}
    p{color:#94a3b8;line-height:1.6;max-width:28rem}
    button{margin-top:1.5rem;padding:.75rem 2rem;border:1px solid #00d4ff;background:transparent;color:#00d4ff;border-radius:.75rem;font-size:.875rem;cursor:pointer}
    button:hover{background:rgba(0,212,255,.1)}
  </style>
</head>
<body>
  <div>
    <h1>Keine Verbindung</h1>
    <p>Rabbit Technik ist gerade offline. Sobald die Verbindung wiederhergestellt ist, funktioniert die App wie gewohnt.</p>
    <button onclick="location.reload()">Erneut versuchen</button>
  </div>
</body>
</html>`;
}
