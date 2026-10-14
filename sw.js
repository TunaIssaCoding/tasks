/* Cache only explicitly allowlisted public shell resources. */
var CACHE = 'tasks-shell-v9';
var PREFIX = 'tasks-shell-';
var ROOT = new URL('./', self.location.href);
var SHELL = [
  './index.html',
  './styles.css?v=9',
  './app.js?v=9',
  './manifest.webmanifest',
  './icon.svg'
];

function shellKey(url) {
  if (url.origin !== ROOT.origin) return null;
  if (url.pathname === ROOT.pathname ||
      url.pathname === new URL('index.html', ROOT).pathname) {
    return new URL('index.html', ROOT).href;
  }
  for (var i = 0; i < SHELL.length; i++) {
    var entry = new URL(SHELL[i], ROOT);
    if (url.pathname === entry.pathname) return entry.href;
  }
  return null;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL.map(function (path) {
        return new URL(path, ROOT).href;
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf(PREFIX) === 0 && key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  /* Return before respondWith: no cross-origin/API interception at all. */
  if (url.origin !== ROOT.origin) return;

  var key = shellKey(url);
  if (!key) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return fetch(request).then(function (response) {
        if (!response || !response.ok ||
            response.type === 'opaque' || response.redirected) {
          return cache.match(key).then(function (hit) {
            return hit || response;
          });
        }
        return cache.put(key, response.clone()).then(function () {
          return response;
        }, function () {
          return response;
        });
      }, function () {
        return cache.match(key).then(function (hit) {
          if (hit) return hit;
          return new Response('Offline: shell resource unavailable', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      });
    })
  );
});
