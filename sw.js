const CACHE_NAME = 'ftb-v15';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=15',
  './js/config.js?v=15',
  './js/veto.js?v=15',
  './js/ev.js?v=15',
  './js/asian.js?v=15',
  './js/decision.js?v=15',
  './js/storage.js?v=15',
  './js/stats.js?v=15',
  './js/vision.js?v=15',
  './js/ui.js?v=15',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
