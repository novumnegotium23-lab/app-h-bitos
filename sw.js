// Guarda la app en el iPad para que funcione sin conexión.
// Sube CACHE de versión cada vez que cambies algún archivo.
var CACHE = 'fichaje-v1';
var FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/sha256.js',
  'js/store.js',
  'js/hours.js',
  'js/app.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Red primero (para recibir actualizaciones) y, si no hay conexión, la copia guardada.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
    })
  );
});
