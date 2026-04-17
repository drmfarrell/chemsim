// ChemSim Service Worker.
// v2: navigation requests are NOT intercepted so the browser always receives
// the fresh COOP/COEP headers from the Vite server. Previously the SW cached
// index.html and re-served it on reload; the cached Response body was fine
// but certain browsers drop COOP/COEP on SW-provided responses, which makes
// `crossOriginIsolated` false and silently disables `SharedArrayBuffer` —
// which in turn disables wasm threading. Net effect: parallel physics never
// ran. This version leaves main-document navigation alone and only caches
// static asset GETs (wasm, json, css, js) for offline support.
const CACHE_NAME = 'chemsim-v2';

// Install: kick out any v1-era cache so a stale index.html can't stick around.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never intercept navigation — let the browser load index.html directly so
  // it receives COOP/COEP headers from the server (needed for SharedArrayBuffer).
  if (req.mode === 'navigate') {
    return;
  }

  // Only attempt to cache same-origin GETs for static assets.
  const url = new URL(req.url);
  const isStaticAsset =
    req.method === 'GET' &&
    url.origin === location.origin &&
    /\.(wasm|js|css|json|svg|png|jpg)$/i.test(url.pathname);

  if (!isStaticAsset) {
    return; // pass through to network
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || new Response('Offline', { status: 503 }))
      )
  );
});
