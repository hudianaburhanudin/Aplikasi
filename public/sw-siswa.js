// Service worker aplikasi siswa: hanya menyimpan cangkang aplikasi. Soal, jawaban, dan nilai (/api) TIDAK pernah disimpan.
const CACHE = 'siswa-v2';
const SHELL = ['/siswa', '/siswa.css', '/siswa.js', '/manifest-siswa.webmanifest', '/icons/icon-192.png', '/logo/yayasan.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith('siswa-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/siswa'))));
});
