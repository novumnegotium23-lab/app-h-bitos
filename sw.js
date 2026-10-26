// Guarda la app en el iPad para que funcione sin conexión.
// Sube CACHE de versión cada vez que cambies algún archivo.
var CACHE = 'fichaje-v3';
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
      // Solo las cachés antiguas de esta app (otras apps pueden compartir el mismo dominio github.io).
      return Promise.all(keys.filter(function (k) { return k.indexOf('fichaje-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Red primero (para recibir actualizaciones) y, si no hay conexión o tarda más de 3 s,
// la copia guardada (así la app abre al momento aunque el wifi no tenga internet).
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  var network = fetch(e.request).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return res;
  });
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    var finish = function (r) { if (!done && r) { done = true; resolve(r); } };
    var timer = setTimeout(function () { fromCache(e.request).then(finish); }, 3000);
    network.then(function (res) { clearTimeout(timer); finish(res); }, function () {
      clearTimeout(timer);
      fromCache(e.request).then(function (r) { finish(r || Response.error()); });
    });
  }));
});
