/* Sentinel service worker — NETWORK-FIRST so updates always win; cache is only an offline fallback.
   (v1 was cache-first and served stale data.js forever — never go back to that.) */
const CACHE = "sentinel-v2";
const CORE = ["index.html", "styles.css", "app.js", "sha256.js", "config.js", "data.js", "manifest.json", "icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  // delete ALL old caches (including the stale-forever "sentinel-v1")
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (e.request.method !== "GET") return;
  if (url.indexOf("/api/") >= 0) return;          // never touch API calls
  if (url.indexOf(self.location.origin) !== 0) return; // let cross-origin (fonts, CDN, Supabase) pass through
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp && resp.status === 200) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request))        // offline → serve last known copy
  );
});
