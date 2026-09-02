const CACHE = 'terra-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/data.js',
  './src/engine.js',
  './src/globe.js',
  './src/output.js',
  './src/state.js',
  './src/webmcp.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/earth-texture.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

async function putInCache(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

async function offlineFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  if (request.mode === 'navigate') {
    const shell = await caches.match('./index.html');
    if (shell) return shell;
  }
  return Response.error();
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await putInCache(request, response);
    return response;
  } catch {
    return offlineFallback(request);
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(async (response) => {
    await putInCache(request, response);
    return response;
  });
  if (cached) {
    refresh.catch(() => {});
    return cached;
  }
  return refresh.catch(() => offlineFallback(request));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isShell = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/styles.css');
  const isVersionedAsset = url.pathname.includes('/src/') || url.pathname.includes('/assets/');
  if (isShell) {
    event.respondWith(networkFirst(event.request));
  } else if (isVersionedAsset) {
    event.respondWith(staleWhileRevalidate(event.request));
  } else {
    event.respondWith(caches.match(event.request).then((cached) => cached || networkFirst(event.request)));
  }
});
