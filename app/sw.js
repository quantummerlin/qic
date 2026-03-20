// ============================================================
// SERVICE WORKER — Quantum Council PWA
// Cache-first for app shell, network-only for API calls
// ============================================================

const CACHE_NAME = "qc-v6";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/memory.js",
  "/personas.js",
  "/api.js",
  "/orchestrator.js",
  "/app.js",
  "/manifest.json",
  "/icon.svg"
];

// Install: pre-cache the app shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// Activate: purge old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - API calls (Worker proxy) → network only, never cache
// - App shell → cache first, fall back to network, update cache in background
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and cross-origin API calls
  if (e.request.method !== "GET") return;
  if (url.hostname.includes("workers.dev") || url.hostname.includes("openrouter")) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchAndCache = fetch(e.request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });

      // Return cache immediately if available, revalidate in background
      return cached || fetchAndCache;
    })
  );
});
