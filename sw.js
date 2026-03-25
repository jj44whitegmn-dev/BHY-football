/**
 * sw.js — Service Worker for offline PWA support
 */

const CACHE_NAME = 'ftb-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/config.js',
  './js/engine.js',
  './js/storage.js',
  './js/parlay.js',
  './js/ui.js',
];

// CDN assets to cache on first fetch
const CDN_PATTERNS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Cache-first for local assets
  if (!url.startsWith('http')) return;

  // Stale-while-revalidate for CDN
  const isCDN = CDN_PATTERNS.some(p => url.includes(p));
  if (isCDN) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(resp => {
            cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Cache-first for local files
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp.ok) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      });
    })
  );
});
