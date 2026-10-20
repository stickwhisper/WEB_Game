// Offline support for the home-screen app.
//   The page: network first, so a new deploy is picked up as soon as there is a connection;
//             the cached copy when offline.
//   Assets:   cache first. Their file names carry a content hash, so a cached file never goes stale;
//             files the latest page no longer references are deleted.
const CACHE = 'agame-v1';
const PAGE = './index.html';

self.addEventListener('install', (event) => {
  // On a first visit the page loaded its assets before this worker existed, so fetch
  // them here: read the page, then cache everything it references.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(['./manifest.webmanifest', './icon-192.png', './icon-512.png']);
      const res = await fetch(PAGE, { cache: 'no-cache' });
      const html = await res.clone().text();
      await cache.put(PAGE, res);
      await cache.addAll([...new Set([...html.matchAll(/assets\/[^"'\s)]+/g)].map((m) => './' + m[0]))]);
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(cachePage(copy));
          }
          return res;
        })
        .catch(() => caches.match(PAGE)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        }),
    ),
  );
});

/** Store the fresh page, then drop cached assets it no longer points to (older builds). */
async function cachePage(res) {
  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  await cache.put(PAGE, res);
  const current = new Set([...html.matchAll(/assets\/[^"'\s)]+/g)].map((m) => m[0]));
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    const i = path.indexOf('assets/');
    if (i >= 0 && !current.has(path.slice(i))) await cache.delete(key);
  }
}
