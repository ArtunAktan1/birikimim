// Uygulama dosyalarını önbelleğe alır; internet olmadan da açılır.
// Yalnızca bu sitenin kendi dosyaları önbelleğe alınır; fiyat isteklerine ve verilere dokunulmaz.
// İnternet varken her zaman en yeni sürüm yüklenir (ağ öncelikli); yoksa kayıtlı sürüm açılır.
const CACHE = 'birikimim-v4';
const SHELL = ['./', './index.html', './app.js', './chart.umd.min.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const NET_TIMEOUT = 4000; // zayıf bağlantıda en fazla bu kadar bekle, sonra kayıtlı sürümü aç

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    const timeout = new Promise(res => setTimeout(res, NET_TIMEOUT, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch { /* çevrimdışı */ }
    const cached = await cache.match(e.request, { ignoreSearch: true });
    return cached || network;
  })());
});
