// Service worker portal wali: hanya menyimpan cangkang aplikasi (HTML/JS/CSS/ikon).
// Data pribadi dari /api TIDAK pernah disimpan di cache.
const CACHE = 'wali-v9';
const SHELL = ['/wali', '/wali.css', '/wali.js', '/manifest.webmanifest', '/icons/icon-192.png', '/logo/yayasan.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // jaringan dulu supaya versi baru langsung terpakai; cadangkan ke cache saat offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/wali'))));
});
