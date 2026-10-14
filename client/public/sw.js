const scopePath = new URL(self.registration.scope).pathname;
const isRairock = scopePath.startsWith('/rairock/');
const CACHE = `five-way-${isRairock ? 'rairock' : 'ambiente'}-v2`;
const APP_SHELL = isRairock
  ? ['/rairock/', '/rairock/brand/logo.png', '/rairock/brand/background.png']
  : ['/', '/brand/logo.png', '/brand/mark.png', '/brand/icon-192.png', '/brand/apple-touch-icon.png'];
self.addEventListener('install', (event) => event.waitUntil(
  caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) =>
    key.startsWith(`five-way-${isRairock ? 'rairock' : 'ambiente'}-`) && key !== CACHE
  ).map((key) => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin ||
      (isRairock ? !url.pathname.startsWith('/rairock/') : url.pathname.startsWith('/rairock/')) ||
      url.pathname.includes('/api/') || url.pathname.startsWith('/socket.io/')) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && !response.redirected) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then((cached) =>
    cached || (request.mode === 'navigate' ? caches.match(scopePath) : Response.error())
  )));
});
