const CACHE_NAME = 'ftb-v17';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=17',
  './js/config.js?v=17',
  './js/veto.js?v=17',
  './js/ev.js?v=17',
  './js/asian.js?v=17',
  './js/decision.js?v=17',
  './js/storage.js?v=17',
  './js/stats.js?v=17',
  './js/vision.js?v=17',
  './js/ui.js?v=17',
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

  // index.html 用网络优先：保证每次拿到最新版本
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // JS/CSS 等静态资源用缓存优先（已带版本号，更新时 URL 变化）
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
