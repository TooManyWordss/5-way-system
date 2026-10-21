const scopePath = new URL(self.registration.scope).pathname;
const isRairock = scopePath.startsWith('/rairock/');
const CACHE = `five-way-${isRairock ? 'rairock' : 'ambiente'}-v5`;
const APP_SHELL = isRairock
  ? ['/rairock/', '/rairock/brand/logo.png', '/rairock/brand/icon-512.png', '/rairock/brand/background.png']
  : ['/', '/brand/logo.png', '/brand/mark.png', '/brand/icon-192.png', '/brand/apple-touch-icon.png'];
self.addEventListener('install', (event) => event.waitUntil(
  (async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // The first page's bundles load before this worker controls it. Precache
    // those build assets explicitly so the very first offline reload works.
    const shell = await cache.match(scopePath);
    const html = await shell.text();
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
      .map(match => new URL(match[1], self.registration.scope).href)
      .filter(url => new URL(url).origin === self.location.origin);
    await cache.addAll(assets);
    await self.skipWaiting();
  })()
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
      (isRairock ? !url.pathname.startsWith('/rairock/') && !url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/fonts/') : url.pathname.startsWith('/rairock/')) ||
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
