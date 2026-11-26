'use strict';

// The Pages build stamps the worker so changes to any shell asset trigger an update check.
const version = '__EMA_BUILD_VERSION__';
const appRoot = new URL(self.registration.scope);
const cachePrefix = 'ema-web-shell:' + appRoot.pathname + ':';
const cacheName = cachePrefix + version;
const indexUrl = new URL('index.html', appRoot).href;

async function installShell() {
  const manifestUrl = new URL('precache.json', appRoot);
  const response = await fetch(manifestUrl, {cache: 'no-store', credentials: 'omit'});
  if (!response.ok) throw new Error('No se pudo leer la lista de archivos.');
  const manifest = await response.json();
  if (manifest.version !== version || !Array.isArray(manifest.files)) {
    throw new Error('La publicación aún no está completa.');
  }
  const files = new Set();
  for (const file of manifest.files) {
    if (typeof file !== 'string') throw new Error('Archivo de publicación inválido.');
    const url = new URL(file, appRoot);
    if (url.origin !== appRoot.origin || !url.pathname.startsWith(appRoot.pathname) ||
        url.search || url.hash || url.username || url.password) {
      throw new Error('Archivo fuera del directorio de EMA.');
    }
    files.add(url.href);
  }
  if (!files.has(indexUrl)) throw new Error('Falta la página de inicio.');
  const cache = await caches.open(cacheName);
  // addAll commits atomically. A failed fetch never leaves a partially installed shell.
  await cache.addAll(Array.from(files, url => new Request(url, {cache: 'reload', credentials: 'omit'})));
}

self.addEventListener('install', event => {
  event.waitUntil(installShell());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(cachePrefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== appRoot.origin || !url.pathname.startsWith(appRoot.pathname)) return;
  if (request.headers.has('range') || request.headers.has('authorization')) return;
  // Only respond from the allowlisted build assets. Imported records stay in device storage.
  const isStart = request.mode === 'navigate' &&
      (url.pathname === appRoot.pathname || url.pathname === new URL(indexUrl).pathname);
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(isStart ? indexUrl : request, {ignoreSearch: isStart});
    return cached || fetch(request);
  })());
});
