/* Every camera the feeds publish, on one page.
 *
 * The station panel answers one camera at a time. 91 of the 93 cameras publish a picture, and
 * nobody scans a state by opening 91 cards. A camera is also the one sensor that needs no mark to
 * compare against — a picture of a flooded road answers by itself — so a page of pictures is the
 * fastest read this data supports.
 *
 * The grid is built once, on open. It is never rebuilt, and js/render.js calls paint() instead of
 * rebuilding it. A tile holds four things the payload does not: the frame it is showing, the frame
 * list it fetched, the images it warmed, and whether the observer reached it yet. A rebuild throws
 * all four away, which drops every visible tile back to the start of its lap.
 *
 * ponytail: one timer for the whole page, not one per tile. 91 timers at 1 Hz is 91 wakeups a
 * second where one will do, and tiles that step together read as one thing rather than as 91
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

/* Sorted by state, then district, then name. That is the order js/table.js groups by, and two
   views both named "all" must not sort two ways. */
const cameras = () => state.data
  .filter(s => s.kind === 'camera' && s.image)
  .sort((a, b) => `${a.state}|${a.district}|${a.name}`
    .localeCompare(`${b.state}|${b.district}|${b.name}`));

/* `data-cam` is the numeric id the proxy takes, the same value `data-clip` carries in camImg().
   `data-hay` is squashed here rather than at match time: it never changes, and the filter in
   js/ui.js runs on every keystroke.
   ponytail: no `data-mast`. js/table.js puts a site key on a row because a row is a mast. A tile
   is one camera, and the click resolves it by its own id. */
const tileHtml = c => `<button class="camtile" data-cam="${c.id.split('-')[1]}" data-hay="${
  squash(`${c.name} ${c.district || ''} ${c.state || ''}`)}"><img loading="lazy" alt="" src="${
  camSrc(c)}"><span class="camname">${c.name}</span><span class="camsay"><i class="i i-warning"
  ></i><b></b></span></button>`;

/* A tile is armed the first time it comes into view, and never again. Arming costs one call to
   ?shots= and one warm-up of the lap. Eager, this page is 91 of those calls and about 80 MB of
   frames, which is why nothing loads until a reader looks at it.
   `ready` is set before the first await. Two intersections can arrive before the fetch returns,
   and the flag is the only thing stopping the second one fetching again. */
async function arm(t, L) {
  L.ready = true;
  let rows = [];
  try { rows = await (await fetch(`api.php?shots=${t.dataset.cam}`)).json(); } catch { rows = []; }
  /* close() clears the map on every tear-down, and a fetch already in flight outlives the dialog
     it was started for. The check therefore repeats after every await in this function, not once
     at the end: a reader can close the wall between any two of them, and the warm-up below is the
     expensive half — one real ?shot= request per frame — so it is the one this guard must never
     let run for a tile that no longer exists. */
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
    im.src = `api.php?shot=${t.dataset.cam}&t=${ts}`;
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
      ? L.live : `api.php?shot=${t.dataset.cam}&t=${L.shots[L.at]}`;
  }
}

export function open() {
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
 * object. It stays correct anyway: the only fields read here are the coordinate and the id, and a
 * camera does not move. camAlert() reduces over the live `state.data` for everything else.
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
    t.querySelector('.camsay b').textContent = a ? camPhrase(L.cam, a) : '';
  }
}
