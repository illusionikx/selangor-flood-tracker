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
  camSrc(c)}"><span class="camname">${c.name}</span></button>`;

export function open() {
  const cams = cameras();
  const grid = el('camGrid');
  grid.innerHTML = cams.map(tileHtml).join('');
  laps.clear();
  [...grid.children].forEach((t, i) => laps.set(t, {
    cam: cams[i], live: camSrc(cams[i]), shots: [], at: 0, ready: false, seen: false,
  }));
  count();
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
