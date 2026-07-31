/* The station panel's camera clip: what we have of the last three hours, a frame a second.
 *
 * A card used to show one still and call it current at any age. Three hours is the line, because
 * that is the question a flood camera is opened with — "is it like this now" — and a picture from
 * yesterday answers a different one.
 *
 * No controls. The lightbox holds the transport, the scrubber and the compare divider, and two
 * places to learn one control is one too many. This is a picture that moves.
 *
 * The hard part is not the timer. `render()` rebuilds the open card on every poll, so the <img>
 * this module is writing to is replaced under it every few minutes. Restarting on each rebuild
 * would jump back to frame 0 while someone watched, so `start()` rebinds to the new nodes and keeps
 * its place instead. That is the whole reason this is a module with state rather than four lines in
 * popup.js.
 */
import { CLIP_WIN, CLIP_MS, camSrc } from './config.js';
import { noSec, parseMY, ago } from './util.js';

let id = null;      // camera id the running loop belongs to, or null
let shots = [];     // frame timestamps inside the window, ascending
let at = 0;         // position in `shots`; shots.length is the live still
let timer = null;
let img = null, cap = null, live = '';

export function stop() {
  clearInterval(timer);
  timer = null;
  id = null;
  shots = [];
  at = 0;
  img = cap = null;
}

// The live still is the last position, the same way the lightbox scrubber treats it: the clip is
// "how did it get to this", and a lap that stopped 30 minutes short of now never showed the this.
const srcAt = i => i >= shots.length ? live : `api.php?shot=${id}&t=${shots[i]}`;

function tick() {
  at = (at + 1) % (shots.length + 1);
  if (img) img.src = srcAt(at);
}

/* Bind to whatever nodes the card holds right now. Called on a fresh card and on every rebuild of
   the same card, so it must never reset `at`. */
function bind(box) {
  img = box.querySelector('img.shot');
  cap = box.querySelector('.clipcap');
  if (img && timer) img.src = srcAt(at);
}

export async function start(root, cam) {
  const box = root?.querySelector('[data-clip]');
  if (!box) return stop();
  const want = box.dataset.clip;
  if (want === id) return bind(box);     // same camera, same loop, new nodes
  stop();
  id = want;
  live = camSrc(cam);
  bind(box);

  let rows = [];
  try {
    rows = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { rows = []; }
  if (id !== want || !Array.isArray(rows)) return;   // the reader moved on while we fetched

  const cut = Date.now() / 1000 - CLIP_WIN;
  shots = rows.map(r => Array.isArray(r) ? r[0] : r).filter(ts => ts >= cut);

  /* Fewer than two frames is not a clip. Keep the live still the card already drew — it came from
     JPS when the card opened, and an empty window means this server did not capture, not that the
     camera stopped. Reaching into the archive for an older frame here would replace a live picture
     with a stale one. */
  if (shots.length < 2) {
    shots = [];
    if (cap) cap.textContent = idle(cam);
    return;
  }

  if (cap) cap.textContent = `LAST 3 HOURS · ${shots.length} frames`;
  // Warm the whole lap before it starts. Six frames off local disk, served immutable for a year, so
  // every lap after the first is free — and without this the first lap flickers on every swap.
  await Promise.all(shots.map(ts => {
    const im = new Image();
    im.src = `api.php?shot=${id}&t=${ts}`;
    return im.decode().catch(() => {});
  }));
  if (id !== want) return;
  at = 0;
  if (img) img.src = srcAt(0);
  timer = setInterval(tick, CLIP_MS);
}

/* What the caption says when there is no clip: when this picture was taken, and whether that is
   still current. NOT CURRENT is the word the cards already print on a reading over a day old. */
function idle(cam) {
  const d = parseMY(cam.shot);
  if (!d) return 'LATEST IMAGE';
  const old = Date.now() - d > CLIP_WIN * 1000;
  return `${old ? 'NOT CURRENT' : 'LATEST IMAGE'} · ${noSec(cam.shot)}${old ? ` · ${ago(d)}` : ''}`;
}
