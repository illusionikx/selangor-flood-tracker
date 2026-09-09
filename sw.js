/* Service worker. Two jobs, and deliberately no third.
   1. Exist, with a fetch handler — that is what makes Chrome offer "Install app".
   2. Keep the shell (html, css, js, fonts, Leaflet) reachable with no connection, so an offline
      launch shows this app's own "NO INTERNET CONNECTION" screen instead of the browser's.

   **The two lines below are written by `build.mjs`.** The repository holds them empty. A worker
   served straight from the repository therefore precaches nothing and treats every file as
   network-first, which is exactly how this file behaved before the build existed. So a source
   checkout still runs.

   **The shell is cache-first now, and it was network-first.** The comment this replaces argued that
   cache-first would add a third cache-busting ritual to a repository that already had two, and that
   an edit which reached nobody was worse than a slow load. That argument was right at the time and
   is answered now: every built file carries a content hash in its name, so a name can never hold
   stale content. Different content is a different name.

   **`index.html` is the one exception and stays network-first.** It is the only unhashed entry
   point, so it is what tells a browser which hashed files the current build uses. Serve it from the
   cache first and a new build never reaches a reader.

   The readings are never cached, at any age. The splash already refuses to draw a map without a
   connection, on the grounds that during a flood an out-of-date water level is worse than nothing.
   A service worker quietly answering with yesterday's flood would defeat that from underneath. */
const CACHE = 'shell';
const SHELL = [];

/* A built file carries an 8-character content hash before its extension, and `vendor/` carries a
   `?v=` of its own. Both are safe to answer from the cache without asking the network. */
const immutable = url =>
  /-[A-Z0-9]{8}\.(?:js|css)$/.test(url.pathname) || /\/vendor\//.test(url.pathname);

/* One failed file must not fail the whole install, because a failed install leaves no worker and
   no "Install app" offer. Each entry is added on its own and a miss is dropped. */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

/* A new build opens a new cache name, so every older one is dead the moment this activates. */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Cross-origin (map tiles), non-GET, and the readings themselves: not ours. No respondWith at
  // all, so the request behaves exactly as it does with no worker installed, error handling
  // included. wx.json carries the weather layer, the same kind of reading api.json carries.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/(api\.(php|json)|wx\.json)$/.test(url.pathname)) return;

  // Cache-first for a hashed file. It cannot go stale, so the network is never asked twice for it.
  // A miss falls through to the network and stores the answer, which is what serves a deferred
  // chunk the install never precached.
  if (immutable(url)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })),
    );
    return;
  }

  // Everything else, `index.html` included: network-first, cache-as-you-go.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Only store real answers. Herd replies to a missing file with index.html and a 200
        // (see CLAUDE.md), which is worth remembering here: `res.ok` is not proof the file exists,
        // it is only proof the network answered, which is all this cache claims.
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
