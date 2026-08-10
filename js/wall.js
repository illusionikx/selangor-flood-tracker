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

/* The batch the progress bar tracks — not the whole grid, which is why this is not a count of 90.
   Tiles arm as they scroll into view (see onSee() below), so `waiting` only ever holds the tiles
   currently between "started loading its own first picture" and "settled", and `batchTotal` is how
   many the *current* batch began with — the denominator behind the fraction the bar draws. Both
   live at module scope, like `laps`, so close() can reset them without a third argument threading
   through every caller. */
let waiting = 0, batchTotal = 0;

/* Called once per tile, from onSee() at the moment it first comes into view — see the comment on
   `L.started` there for why that moment stands in for the image's own (nonexistent) "started
   fetching" event. A batch that finds nothing already in flight is a new one: the denominator resets
   before this tile joins it, rather than growing for as long as a reader keeps scrolling.
   Only ever called for a tile onSee has confirmed has not already settled — see the `.done` check
   guarding the call site there — so every increment this makes has a decrement to look forward to. */
function startBatch() {
  if (waiting === 0) batchTotal = 0;
  waiting++;
  batchTotal++;
  paintBar();
}

/* Called once per tile that actually started — see the guard in onSettle() below, which is what
   pairs this with startBatch() now. `Math.max(0, …)` stays as a backstop for a genuine race between
   two settle events, not as the mechanism: it used to be the only thing standing between a tile
   whose image resolved before its own first IntersectionObserver callback ran — a cached still,
   decoding synchronously, which api.php?cam='s 5-minute cache makes routine on a dialog reopened
   within the window — and a `waiting` count that never came back down. That tile used to settle for
   free, with nothing for the floor to swallow; onSettle() now simply does not call this for it. */
function settleBatch() {
  waiting = Math.max(0, waiting - 1);
  paintBar();
}

/* The only place `#camBar`'s DOM is touched. `--p` is a fraction, never a pixel — the bar's own CSS
   draws it with `transform: scaleX()`. `aria-hidden` and the `.on` class move together, because both
   answer the same question (is a batch actually running) and neither should lag the other by a
   frame: one hides the bar from a screen reader, the other from everyone else. */
function paintBar() {
  const bar = el('camBar');
  const running = waiting > 0;
  bar.classList.toggle('on', running);
  bar.setAttribute('aria-hidden', String(!running));
  const pct = batchTotal ? (batchTotal - waiting) / batchTotal : 0;
  bar.style.setProperty('--p', pct);
  bar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
}

/* The settle signal for both the skeleton (css/chrome.css: `.camtile.done::before`) and the failed
   state (`.camtile.fail .camfail`). `load` and `error` do not bubble, so a delegated listener has to
   run in the *capture* phase to see them at all — by the time either would reach this element on the
   way back up, it has already stopped propagating from the `<img>` itself. Bound once, below, rather
   than inside open(): `#camGrid` is static markup in index.html and is never recreated, only its
   children are, so one pair of listeners outlives every open()/close() cycle and needs no rebinding.
   `tick()` rewrites `img.src` once a second per visible tile once its lap is running, so `load`
   fires again on every frame after the first — the first branch below is what stops this counting a
   tile twice.
   A tile settles once, but the picture on it can still change afterwards, and the two halves below
   answer two different questions because of that. The first branch below decides whether `waiting`
   moves at all, and runs only on the tile's first load/error. The second decides what covers the
   `<img>` right now, and keeps running after that: api.php?cam= returns 502 on a failed upstream
   fetch (see CLAUDE.md's curl gotcha), so a camera whose *first* still fails this way would otherwise
   carry an opaque "No picture" cover for the rest of the session while the lap loop went on swapping
   perfectly good archived frames into the `<img>` underneath it, unseen. A later `load` clears that
   cover. A later `error` — one archived frame 404ing mid-lap, on an otherwise working camera — must
   not set it, which is the case the first branch already protects by only looking at the first
   event; letting a later `error` re-add `.fail` here would undo that. */
function onSettle(e) {
  const t = e.target.closest('.camtile');
  if (!t) return;
  if (!t.classList.contains('done')) {
    t.classList.add('done');
    /* Pairs with startBatch(): only a tile onSee actually started may decrement `waiting`. A tile
       whose image resolves before its own first IntersectionObserver callback runs reaches here with
       `L.started` still false — see the comment on startBatch() and on the guard in onSee() below.
       Calling settleBatch() for it anyway is exactly the bug this pairing exists to close: the
       decrement would land with nothing to cancel, the floor in settleBatch() would swallow it
       silently, and the tile's own `.done` class (set just above) is what then stops onSee() ever
       starting — and therefore ever properly settling — it later. */
    const L = laps.get(t);
    if (L?.started) settleBatch();
    if (e.type === 'error') t.classList.add('fail');
    return;
  }
  if (e.type === 'load') t.classList.remove('fail');
}
el('camGrid').addEventListener('load', onSettle, true);
el('camGrid').addEventListener('error', onSettle, true);

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

/* `data-cam` is the numeric id the proxy takes, present only on a tile whose coordinate is real.
   Two delegated handlers in js/ui.js read this attribute, and they read two different shapes of it.
   `el('camGrid').onclick` is this grid's own handler: it takes the bare number this tile writes and
   builds the station id itself before opening the panel. The other, a document-wide click listener,
   exists for js/popup.js's own `data-cam`, which already writes the full station id (`camera-1279`,
   not `1279`) and hands it straight to `byId()`. A click on a wall tile reaches both, because neither
   stops the event — the grid handler opens the right camera, and the document one calls `byId()` on
   the bare number, finds nothing and no-ops. That costs nothing today, but it means the two writers
   of `data-cam` cannot be brought into line with each other by changing only one of them: doing so
   would make the grid handler's own jump wrong, or wake the second handler into firing a jump of its
   own alongside the first. `data-lap` carries the same id on every tile, mapped or not,
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
    >${c.name}</span><span class="camsay"><i class="i i-warning"></i><b></b></span><span
    class="camfail"><i class="i i-videocam_off"></i><b>No picture</b></span>${
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
    /* The progress bar's start signal. A tile's own `<img>` has no "began fetching" event to hook —
       `loading="lazy"` leaves that decision to the browser — so this is the earliest point script
       can say "this tile's first picture is now expected soon", and it lines up with the browser's
       own lazy-load trigger closely enough that the bar reads as tracking the real thing. Guarded on
       `L.started`, not on arm()'s own `L.ready`: a failed `?shots=` fetch retries through this same
       branch on the next intersection, and a tile must count once for the bar no matter how many
       times arm() itself is retried.
       The second guard, `.done`, pairs this with onSettle(). A tile's image can resolve — load or
       error — before this callback ever runs for it: a cached still decodes synchronously, and
       api.php?cam= is served `max-age=300`, so reopening this dialog inside five minutes of closing
       it makes that the common case, not the rare one. onSettle() marks that tile `.done` without
       touching `waiting`, because nothing here has counted it yet — see the guard there. Without this
       check, this branch would still see `L.started` false on the tile's first intersection and add
       an increment that onSettle() can never cancel: every later load/error on that tile returns
       immediately once it is `.done`, so `waiting` would carry that one increment for the life of the
       dialog, and every further already-settled tile scrolling into view would add another. */
    if (e.isIntersecting && !L.started && !e.target.classList.contains('done')) {
      L.started = true;
      startBatch();
    }
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
    cam: cams[i], live: camSrc(cams[i]), shots: [], at: 0, ready: false, seen: false, started: false,
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
  // open() calls close() first, so resetting the batch counters here is what gives every fresh grid
  // a bar that starts hidden rather than carrying over whatever the last session left mid-batch.
  waiting = 0;
  batchTotal = 0;
  paintBar();
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
