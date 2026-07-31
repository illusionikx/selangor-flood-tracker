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

const CLIP_HOURS = CLIP_WIN / 3600;   // the caption names the window; keep the two numbers tied

let id = null;      // camera id the running loop belongs to, or null
let gen = 0;        // bumped on every stop(); a stale await compares against this, not against id
let shots = [];     // frame timestamps inside the window, ascending
let at = 0;         // position in `shots`; shots.length is the live still
let timer = null;
let img = null, cap = null, live = '', capText = '';

export function stop() {
  clearInterval(timer);
  timer = null;
  id = null;
  gen += 1;
  shots = [];
  at = 0;
  img = cap = null;
  capText = '';
}

// The live still is the last position, the same way the lightbox scrubber treats it: the clip is
// "how did it get to this", and a lap that stopped 30 minutes short of now never showed the this.
const srcAt = i => i >= shots.length ? live : `api.php?shot=${id}&t=${shots[i]}`;

function tick() {
  /* A frame can fail. camImg()'s onerror replaces the failed <img> with a plain div, so the node
     this loop writes to can vanish between one tick and the next — most likely at the live
     position, where a 60-second-old proxy response can go stale mid-lap. Writing to a detached
     element does nothing useful and never recovers on its own, so stop and let the next
     openSide() rebuild the card and start a clean loop. */
  if (!img || !img.isConnected) return stop();
  at = (at + 1) % (shots.length + 1);
  img.src = srcAt(at);
}

/* Bind to whatever nodes the card holds right now. Called on a fresh card and on every rebuild of
   the same card, so it must never reset `at`.
   `capText` is the caption's own state, kept here for the same reason `at` is: `render()` swaps in
   a blank `<p class="clipcap">` on every poll, and without this the caption would read for one
   poll and then go empty for as long as the card stayed open. */
function bind(box) {
  img = box.querySelector('img.shot');
  cap = box.querySelector('.clipcap');
  if (img && timer) img.src = srcAt(at);
  if (cap) cap.textContent = capText;
}

export async function start(root, cam) {
  const box = root?.querySelector('[data-clip]');
  if (!box) return stop();
  const want = box.dataset.clip;
  if (want === id) return bind(box);     // same camera, same loop, new nodes
  stop();
  id = want;
  const myGen = gen;   // this run's generation; stop() bumps gen, id alone cannot tell two runs apart
  live = camSrc(cam);
  bind(box);

  let rows = [];
  try {
    rows = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { rows = []; }
  /* `id !== want` alone missed the case where the reader closed the card and reopened the same
     camera before this fetch returned: stop() clears id, the second start() sets id back to the
     same value, and both continuations would then read id === want as true. `gen` catches it —
     stop() bumps it on every call, so a stale run's captured `myGen` can never match again. */
  if (myGen !== gen || !Array.isArray(rows)) return;

  const cut = Date.now() / 1000 - CLIP_WIN;
  shots = rows.map(r => Array.isArray(r) ? r[0] : r).filter(ts => ts >= cut);

  /* Fewer than two frames is not a clip. Keep the live still the card already drew — it came from
     JPS when the card opened, and an empty window means this server did not capture, not that the
     camera stopped. Reaching into the archive for an older frame here would replace a live picture
     with a stale one. */
  if (shots.length < 2) {
    shots = [];
    capText = idle(cam);
    if (cap) cap.textContent = capText;
    /* Clear `id` rather than park on this camera. A card can stay open for hours, and the archive
       can cross the two-frame line while it does — clearing `id` makes the next poll's start()
       treat this as a fresh camera and check the archive again, instead of parking here in the
       idle state for as long as the card stays open. */
    id = null;
    return;
  }

  capText = `LAST ${CLIP_HOURS} HOURS · ${shots.length} frames`;
  if (cap) cap.textContent = capText;
  // Warm the whole lap before it starts. Six frames off local disk, served immutable for a year, so
  // every lap after the first is free — and without this the first lap flickers on every swap.
  await Promise.all(shots.map(ts => {
    const im = new Image();
    im.src = `api.php?shot=${id}&t=${ts}`;
    return im.decode().catch(() => {});
  }));
  if (myGen !== gen) return;
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
