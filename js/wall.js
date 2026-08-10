/* Every camera the feeds publish, on one page.
 *
 * The station panel answers one camera at a time. Almost every one of the 93 cameras publishes a
 * picture, and nobody scans a state by opening one card per camera. A camera is also the one
 * sensor that needs no mark to compare against — a picture of a flooded road answers by itself —
 * so a page of pictures is the fastest read this data supports.
 *
 * The grid is built once, on open. It is never rebuilt, and js/render.js calls paint() instead of
 * rebuilding it. A tile holds four things the payload does not: the frame it is showing, the frame
 * list it fetched, the images it warmed, and whether the observer reached it yet. A rebuild throws
 * all four away, which drops every visible tile back to the start of its lap.
 *
 * ponytail: one timer for the whole page, not one per tile. A timer per tile is a wakeup per tile
 * every second where one will do, and tiles that step together read as one thing rather than as
 * pictures out of phase. If a tile ever needs its own rate, this is the line to revisit.
 */
import { CLIP_WIN, CLIP_MS, camSrc } from './config.js';
import { state } from './state.js';
import { el, squash } from './util.js';
import { camAlert } from './stations.js';
import { camPhrase } from './popup.js';

/* Per-tile state, keyed by the element. Not in `dataset`: `at` moves once a second on every tile
   on screen, and a dataset write is a string round trip through the DOM for a number nothing
   outside this module reads. Clearing the map is also the whole teardown — see close(). */
const laps = new Map();
let timer = null;
let io = null;

/* Sorted by state, then district, then name — three separate comparisons, the same order
   js/table.js groups by, and two views both named "all" must not sort two ways.
   A joined string compared once looked like the same thing and was not: default collation ranks
   a space below `|`, so the day a "Petaling Jaya" sits beside a "Petaling", the joined strings
   would order on where that character falls rather than on the state and district each one names.
   `|| '—'` and `|| 'Unknown'` are js/table.js's own stand-ins for a missing state or district —
   without them a station with no state stringified to the literal word "undefined" and sorted on
   that instead. */
const cameras = () => state.data
  .filter(s => s.kind === 'camera' && s.image)
  .sort((a, b) => (a.state || '—').localeCompare(b.state || '—')
    || (a.district || 'Unknown').localeCompare(b.district || 'Unknown')
    || a.name.localeCompare(b.name));

/* `data-cam` is the numeric id the proxy takes, the same value `data-clip` carries in camImg() —
   present only on a tile whose coordinate is real, because js/ui.js's delegated click matches on
   that attribute and nothing else. `data-lap` carries the same id on every tile, mapped or not,
   because arm() and tick() still need it to keep a lap playing once the click path stops seeing it.
   `data-hay` is squashed here rather than at match time: it never changes, and the filter in
   js/ui.js runs on every keystroke.
   ponytail: no `data-mast`. js/table.js puts a site key on a row because a row is a mast. A tile
   is one camera, and the click resolves it by its own id. */

/* JPS publishes some cameras with no coordinate at all — `lat: 0, lng: 0` — and the picture is
   still the reason this page exists, so the tile still draws. What it must not do is answer a
   click: js/map.js falls through a missing coordinate to `focusOn([0, 0], 13)`, which is the
   Gulf of Guinea, and js/table.js already withholds its own jump attribute (`data-mast`) from the
   same stations for the same reason — see the "not on the map" row in docs/FEATURES.md. `disabled`
   keeps a keyboard reader from landing on a control that does nothing, and `.unmapped` gives the
   second wave a hook to stop the tile looking pressable in the first place. */
const tileHtml = c => {
  const id = c.id.split('-')[1], mapped = !!(c.lat && c.lng);
  return `<button class="camtile${mapped ? '' : ' unmapped'}"${mapped ? ` data-cam="${id}"` : ''
    } data-lap="${id}" data-hay="${squash(`${c.name} ${c.district || ''} ${c.state || ''}`)}"${
    mapped ? '' : ' disabled'}><img loading="lazy" alt="" src="${camSrc(c)}"><span class="camname"
    >${c.name}</span><span class="camsay"><i class="i i-warning"></i><b></b></span>${
    mapped ? '' : '<span class="camnote">Not on the map</span>'}</button>`;
};

/* A tile is armed the first time it comes into view, and never again. Arming costs one call to
   ?shots= and one warm-up of the lap. Eager, this page is one of those calls per camera and about
   80 MB of frames, which is why nothing loads until a reader looks at it.
   `ready` is set before the first await. Two intersections can arrive before the fetch returns,
   and the flag is the only thing stopping the second one fetching again.
   It also has to come back off on a failed fetch, or one dropped request latches a tile on its
   live still for the rest of the session: the catch below sets `rows = []`, which reads exactly
   like a camera the server never captured, and nothing past it can tell the two cases apart.
   js/clip.js clears its own `id` on the matching branch so the next poll checks the archive again
   — see the comment on that line. There is no poll to retry on here, so the observer has to be
   the one that tries again, and it only retries a tile whose `ready` is still false. */
async function arm(t, L) {
  L.ready = true;
  let rows = [];
  try { rows = await (await fetch(`api.php?shots=${t.dataset.lap}`)).json(); }
  catch { rows = []; L.ready = false; }
  /* close() clears the map on every tear-down, and a fetch already in flight outlives the dialog
     it was started for. The guard below therefore repeats after each fetch stage, not once at the
     end: a reader can close the wall while the request is in flight, or during the warm-up that
     follows it — the expensive half, one real ?shot= request per frame — so it is the one guard
     that must never let a warm-up run for a tile that no longer exists. One guard covers both
     awaits above: they share a try block, so no teardown can land between them. */
  if (!laps.has(t)) return;
  /* `?shots=` returns [ts, tier, stationId] rows and its answer is cached for 60 seconds, so a
     deploy leaves the old bare-number shape in flight. js/clip.js and js/timeline.js both carry
     this guard. Do not remove it while that cache header stands.
     On the GitHub Pages build there is no api.php at all: the fetch fails, `rows` stays empty, and
     the tile keeps the still it already drew. That is the same answer js/clip.js gives. */
  if (!Array.isArray(rows)) return;
  const cut = Date.now() / 1000 - CLIP_WIN;
  const shots = rows.map(r => Array.isArray(r) ? r[0] : r).filter(ts => ts >= cut);
  /* Fewer than two frames is not a lap. Keep the live still the tile already drew — an empty
     window means this server did not capture, not that the camera stopped, and reaching further
     back would replace a live picture with a stale one. */
  if (shots.length < 2) return;
  // Warm the whole lap before it starts. The frames come off local disk and the server marks them
  // immutable for a year, so every lap after the first costs nothing and the first does not flicker.
  await Promise.all(shots.map(ts => {
    const im = new Image();
    im.src = `api.php?shot=${t.dataset.lap}&t=${ts}`;
    return im.decode().catch(() => {});
  }));
  // Repeated once more: the warm-up above is itself an await, and the dialog can close while it
  // is still fetching frames for a tile that is already gone.
  if (!laps.has(t)) return;
  L.shots = shots;
}

function onSee(entries) {
  for (const e of entries) {
    const L = laps.get(e.target);
    if (!L) continue;
    L.seen = e.isIntersecting;
    if (e.isIntersecting && !L.ready) arm(e.target, L);
  }
}

/* The live still is the last position, the same way js/clip.js and the lightbox scrubber treat it:
   the lap is "how did it get to this", and one that stopped short of now never showed the this.
   A tile the filter hid reports as not intersecting, so `seen` goes false and its place freezes.
   The browser does that part — there is no filter check here. */
function tick() {
  for (const [t, L] of laps) {
    if (!L.seen || L.shots.length < 2) continue;
    L.at = (L.at + 1) % (L.shots.length + 1);
    const img = t.firstElementChild;
    if (img) img.src = L.at >= L.shots.length
      ? L.live : `api.php?shot=${t.dataset.lap}&t=${L.shots[L.at]}`;
  }
}

/* close() first. open() has no second entry point today — the menu that reaches it sits behind
   this dialog's own modal backdrop — but nothing in the function says so, and a second one added
   later (a deep link, a keyboard shortcut) would otherwise leak the interval and the observer of
   whatever grid was already running. One line makes the function safe to call twice. */
export function open() {
  close();
  const cams = cameras();
  const grid = el('camGrid');
  grid.innerHTML = cams.map(tileHtml).join('');
  laps.clear();
  [...grid.children].forEach((t, i) => laps.set(t, {
    cam: cams[i], live: camSrc(cams[i]), shots: [], at: 0, ready: false, seen: false,
  }));
  count();
  paint();
  /* `root` is the grid, because the grid scrolls and the page behind it does not. The margin arms
     a tile just before it arrives, so a lap is warm by the time a reader reaches it. */
  io = new IntersectionObserver(onSee, { root: grid, rootMargin: '200px' });
  for (const t of laps.keys()) io.observe(t);
  timer = setInterval(tick, CLIP_MS);
}

export function close() {
  clearInterval(timer);
  timer = null;
  io?.disconnect();
  io = null;
  laps.clear();
  el('camGrid').innerHTML = '';
}

/* The count line. `shown` is the number the filter left visible, and it defaults to all of them so
   open() and the filter write the same line through the same function.
   A filter that empties a view in silence reads as a broken view, so the empty case says so. */
export function count(shown = laps.size) {
  const total = laps.size;
  el('camCount').textContent = !total ? 'No cameras'
    : !shown ? 'No camera matches that name.'
    : shown === total ? `${total} cameras`
    : `${shown} of ${total} cameras`;
}

/* What a poll changes, and nothing else. js/render.js calls this instead of rebuilding the grid,
   because a rebuild drops every visible tile back to the first frame of its lap and throws away
   the frames it warmed. It creates and destroys no element, and it touches no <img>.
 *
 * The name matches paint() in js/timeline.js, which does the same job for the lightbox: rewrite
 * the parts of an existing player that changed, rather than build a new one.
 *
 * `L.cam` is the station object from the payload the grid was built on, and a poll replaces that
 * object. It stays correct anyway: the only field read here is the coordinate, off camAlert()'s
 * own distance check, and a camera does not move. That holds only as long as camPhrase() below
 * keeps taking its second argument: passed `a`, it never touches the `cam` parameter it also
 * receives. Call it camPhrase(L.cam) instead and its own default parameter fires, deriving a
 * second, independent alert from this same stale object through a fresh camAlert() call.
 * camAlert() reduces over the live `state.data` for everything else.
 *
 * `hidden` is left alone, so a filter survives a poll with no work.
 *
 * The threshold is camAlert()'s, which is the lightbox pill's. Same 2 km, same isIgnored(), same
 * exclusion of stale stations. This surface makes no new claim and widens no alert set, so it does
 * not go through the alert design standard as a fifth surface. Widening camAlert() would. */
export function paint() {
  for (const [t, L] of laps) {
    const a = camAlert(L.cam);
    t.classList.toggle('t-now', a?.tier === 'now');
    t.classList.toggle('t-soon', a?.tier === 'soon');
    // paint() runs on every poll, so a tile shape that ever ships without this element must not
    // throw here and stop every other tile behind it from getting its own update.
    const b = t.querySelector('.camsay b');
    if (b) b.textContent = a ? camPhrase(L.cam, a) : '';
  }
}
