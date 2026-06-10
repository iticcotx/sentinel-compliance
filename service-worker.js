/* Sentinel service worker — caches core files so the app works offline once installed. */
const CACHE = "sentinel-v1";
const CORE = ["index.html", "styles.css", "app.js", "sha256.js", "config.js", "data.js", "manifest.json", "icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = e.request.url;
  // never cache the email/api calls
  if (url.indexOf("/api/") >= 0) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      // cache same-origin GETs as we go
      if (e.request.method === "GET" && resp && resp.status === 200 && url.indexOf(self.location.origin) === 0) {
        const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => hit))
  );
});
