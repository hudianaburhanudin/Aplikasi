const V = "bb-v1", FILES = ["./", "index.html", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if(r.method !== "GET" || u.origin !== location.origin) return; // API & CDN langsung ke jaringan
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(r, {ignoreSearch: true});
    const net = fetch(r).then(res => { if(res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
