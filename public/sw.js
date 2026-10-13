// Offline support for the POS and barista iPads. Each file below is fetched from the network
// when possible and from the saved copy when the internet is down.
const CACHE = 'pos-v5';
const OFFLINE_FILES = [
  '/pos', '/barista', '/common.js', '/style.css', '/socket.io/socket.io.js', '/pos.webmanifest', '/barista.webmanifest',
  '/brand/logo.png', '/brand/mark.png', '/brand/icon-192.png', '/brand/apple-touch-icon.png',
  '/fonts/cinzel-latin-600-normal.woff2', '/fonts/cinzel-latin-700-normal.woff2',
  '/fonts/nunito-latin-400-normal.woff2', '/fonts/nunito-latin-600-normal.woff2',
  '/fonts/nunito-latin-700-normal.woff2', '/fonts/nunito-latin-800-normal.woff2',
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(
  // Remove copies saved by older versions of this file.
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !OFFLINE_FILES.includes(url.pathname)) {
    return; // everything else (API calls, live updates) goes straight to the network
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Don't save the login page in place of the POS.
        if (response.ok && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
        }
        return response;
      })
      .catch(() => caches.match(url.pathname).then((cached) => cached || Response.error()))
  );
});
