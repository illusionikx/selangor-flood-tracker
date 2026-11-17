/* The router. One address for each view, and the Back button steps through the views.

   **The address follows the page, and the page follows the address. Both halves are here.**
   Many places open a view: a pin, a table row, a menu row, a key. Each one calls `sync()` after it
   changes the page. `sync()` reads which view is on top and writes that view's path to the address
   bar. The other half is `apply()`. It runs on Back, on Forward and on landing, and it makes the page
   show the view that the address names. The first half has about ten call sites. A router that sends
   every press through `navigate()` would have more than thirty, and every one would need a change.

   **Each view registers itself with `view()`.** This module imports nothing, so `map.js` and `ui.js`
   can both import it. A view states its path, how to match a path, how to open and close, and a
   title. `z` ranks the views that can be open together. The camera viewer sits over the camera wall,
   so the viewer has the higher rank, and its path is the one that shows.

   **`sync()` waits one microtask.** An opener often closes one view and then opens another in the
   same task. For example, the table closes the station card and then shows its own dialog. Without
   the wait, the history would get a stray entry for the moment between the two.

   **A close steps back when it can.** If the view that the page now shows is the entry that the app
   pushed from, `sync()` calls `history.back()`. Otherwise it pushes. So Escape on Settings leaves
   the history as it was before Settings opened. The state of each entry holds `from`, the path
   before it, and `i`, its depth.

   **`apply()` raises `applying`, and `sync()` does nothing while it is up.** `apply()` closes views
   one at a time. Between two of those closes, the page matches neither the old address nor the new
   one. A `sync()` then would push that middle state.

   **A pending `history.back()` holds the next `sync()`.** `back()` is asynchronous. A `pushState`
   in the same task would run first, and the late `popstate` would then undo it. So `backing` holds
   the next write until the `popstate` that the app asked for has come. That `popstate` skips
   `apply()`, because the page is already right.

   **The path is the whole address.** The map position and the chips are not in it. `PREFS` owns
   them, and a shared link must not overwrite the stored settings of the person who opens it. */

const ROOT = new URL(document.baseURI).pathname;   // `<base href>`: "/" on a host, "/repo/" on Pages
const href = p => ROOT + p.slice(1);
/* `/index.html` is the map as well. The render checks load that name, and a reader can type it. */
export const path = () => {
  const p = '/' + location.pathname.slice(ROOT.length);
  return p === '/index.html' ? '/' : p;
};

const views = [];
let applying = false, queued = false, backing = false, dirty = false, name = '';

/* `{ z, path(), match(p), open(p), close(), title(), overlay }`. `path()` answers null while the view
   is shut. An `overlay` opens over whatever is open, and `apply()` closes nothing for it. */
export const view = v => views.push(v);

/* The words the tab and the history list carry for the view on top. `alerts.js` puts the count in
   front, so it listens for `route`. */
export const routeName = () => name;

const top = () => {
  let best = null;
  for (const v of views) {
    const p = v.path();
    if (p !== null && (!best || v.z > best.v.z)) best = { v, p };
  }
  return best;
};

/* The state is `{ i, from }`. The write can fail in a sandboxed frame, and a router that fails must
   leave the app working. */
const put = (how, p, from) => {
  try {
    const i = history.state?.i ?? 0;
    how === 'replace'
      ? history.replaceState({ i, from: history.state?.from ?? null }, '', href(p))
      : history.pushState({ i: i + 1, from }, '', href(p));
  } catch { /* no history API here */ }
};

function unback() {
  backing = false;
  if (dirty) { dirty = false; sync(); }
}

function retitle(t) {
  name = t?.v.title?.() || '';
  document.dispatchEvent(new Event('route'));
}

function flush() {
  if (backing) { dirty = true; return; }
  const t = top(), want = t ? t.p : '/', have = path();
  retitle(t);
  if (want === have) return;
  if (history.state?.from === want) {
    backing = true;
    history.back();
    /* A `popstate` that never comes would hold every later write. A frame of a test page can do
       that, so this lets go after a second. */
    setTimeout(() => backing && unback(), 1000);
    return;
  }
  put('push', want, have);
}

export function sync() {
  if (applying || queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; flush(); });
}

/* A dialog fires `close` for every way out: Escape, the X, the backdrop, the Android back gesture,
   and `close()` from script. The event does not bubble, so this listens in the capture phase. */
document.addEventListener('close', sync, true);

function apply(p) {
  const hit = views.find(v => v.match(p));
  applying = true;
  try {
    if (!hit?.overlay) for (const v of views) if (v !== hit && v.path() !== null) v.close();
    if (hit && hit.path() !== p) hit.open(p);
    else if (!hit && p !== '/') put('replace', '/');
  } finally { applying = false; }
  /* No `sync()` here. An open that waits on the payload or on a module has not shown its view yet,
     and a `sync()` now would read the empty page as a close. Its own `sync()` runs when the view
     lands, and finds the address already right. */
  retitle(top());
}

/* The address names a view by a path, and a view can answer to a different path than the one asked.
   A notification names a station by its id, and the card is keyed by its site. The opener calls
   this to put the path that the page really shows in place of the path that was asked for. */
export const rewrite = p => put('replace', p);

/* A new entry, then the view. `replace` swaps the current entry instead, for a path the app cannot
   open: a station that left the payload, or a link that names nothing. */
export function navigate(p, replace) {
  put(replace ? 'replace' : 'push', p, path());
  apply(p);
}

/* A notification carries `#station=<id>` or `#alerts`, from before the app had paths. `push.php` and
   `sw.js` still send them, and an installed copy can hold an old one. They become paths here. */
const fromHash = h => {
  const m = /^#(?:station=(.+)|(alerts))$/.exec(h);
  return m ? (m[2] ? '/alerts' : '/station/' + encodeURIComponent(m[1])) : null;
};

export function start() {
  const p = fromHash(location.hash) || path();
  try { history.replaceState({ i: 0, from: null }, '', href(p)); } catch { /* see put() */ }
  /* A station is not in the page before the first poll, so a landing waits for it. A reader who
     opened something in the meantime keeps it. */
  if (p !== '/')
    document.addEventListener('poll', () => { if (!top()) apply(p); }, { once: true });
  addEventListener('popstate', () => (backing ? unback() : apply(path())));
  addEventListener('hashchange', () => { const h = fromHash(location.hash); if (h) navigate(h); });
}
