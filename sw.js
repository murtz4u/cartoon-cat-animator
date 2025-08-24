// Simple offline cache for Cartoon Cat Animator
const CACHE = 'cat-animator-v1';
const ASSETS = [
  './',
  './index.html',
  './script.js',
  './manifest.webmanifest'
  // icons are optional; add when you upload them:
  // './icons/icon-192.png',
  // './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
    if (res) return res;
    return fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('./index.html'));
  })
  );
});
