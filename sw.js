/* Service worker. Two jobs, and deliberately no third.
   1. Exist, with a fetch handler — that is what makes Chrome offer "Install app".
   2. Keep the shell (html, css, js, fonts, Leaflet) reachable with no connection, so an offline
      launch shows this app's own "NO INTERNET CONNECTION" screen instead of the browser's.

   Network-first, cache-as-you-go. Not cache-first, and there is no precache list:
   - Cache-first would add a *third* cache-busting ritual to a repo that already has two (the `?v=`
     on the stylesheets and Herd's 3-hour max-age). An edit that showed up for nobody, invisibly,
     until a cache name was bumped is a worse bug than a slightly slower load.
   - A precache list is a copy of index.html's asset list, kept in a second file, that goes wrong
     silently the first time someone adds a module. The first page view warms the cache with exactly
     what the page actually asked for.

   The readings are never cached, at any age. The splash already refuses to draw a map without a
   connection, on the grounds that during a flood an out-of-date water level is worse than nothing;
   a service worker quietly answering with yesterday's flood would defeat that from underneath. */
const CACHE = 'shell';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Cross-origin (map tiles), non-GET, and the readings themselves: not ours. No respondWith at
  // all, so the request behaves exactly as it does with no worker installed, error handling
  // included. wx.json carries the weather layer, the same kind of reading api.json carries.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/(api\.(php|json)|wx\.json)$/.test(url.pathname)) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Only store real answers. Herd replies to a missing file with index.html and a 200
        // (see CLAUDE.md), which is worth remembering here: `res.ok` is not proof the file exists,
        // it is only proof the network answered, which is all this cache claims.
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
