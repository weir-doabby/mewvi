/**
 * Mewvi Service Worker for PWA
 * Caches app shell, fonts, icons, and instant home showcase for blazing performance.
 */

const CACHE_NAME = 'mewvi-pwa-v8.4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/data/home_showcase.json',
  '/data/top_series_cache.json',
  '/js/tailwind.min.js',
  '/js/qrcode.min.js',
  '/js/stream.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Purging legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for dynamic API calls, stream redirects, and large JSON catalog files (>1MB)
  if (
    url.searchParams.has('action') ||
    url.pathname.includes('api.php') ||
    url.pathname.includes('download.php') ||
    url.pathname.endsWith('series.json') ||
    url.pathname.includes('series.json') ||
    url.pathname.includes('catalog')
  ) {
    return;
  }

  // Network-first for home_showcase and version.json to ensure instant updates and no stale caches
  if (url.pathname.includes('home_showcase.json') || url.pathname.includes('version.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // Document Navigation (Deep links like /?item=slug or offline PWA launch)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
