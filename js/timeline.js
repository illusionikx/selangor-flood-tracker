/* Replay of a camera's archive, inside the lightbox and nowhere else.
 *
 * A river level has had a graph all along; a camera had only "now" — which is the wrong tense for
 * the question people actually bring to a flood camera ("was it like this an hour ago?"). The server
 * keeps one frame per camera every 30 minutes and thins them by age (see SHOT_TIERS in api.php);
 * this scrubs through what survived.
 *
 * The lightbox only, deliberately. A popup is 300px of readings you glance at; a timeline is
 * something you sit with, and the lightbox is already the full-screen "look at this properly" view.
 * Putting a scrubber in the popup would mean two places to learn and one of them too small to use.
 *
 * If the archive is empty — a new install, a camera JPS only just published, or the static GitHub
 * Pages build where there is no PHP to have stored anything — the bar simply does not appear. A
 * disabled scrubber over one frame explains nothing that its absence doesn't.
 */

import { el } from './util.js';

/* Named windows rather than a free zoom. The retention tiers mean the archive is *already* a set of
   resolutions — every frame for 6 hours, then 6-hourly, then 12-hourly, then weekly — so a
   continuous zoom would promise detail that is not on disk between the stops. These are the stops. */
const RANGES = [
  ['6 h',   6 * 3600],
  ['24 h',  24 * 3600],
  ['week',  7 * 86400],
  ['month', 30 * 86400],
  ['year',  365 * 86400],
];
const FRAME_MS = 320;   // playback pace: fast enough to read as motion, slow enough to see a frame

// Malaysian, like every other clock on this page — the frames are stamped in unix seconds, and a
// viewer in another timezone must not see an axis that disagrees with the readings beside it.
const MYT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const stamp = ts => MYT.format(ts * 1000);

const box   = el('lightbox');
const stage = box.querySelector('.stage');
const imgB  = box.querySelector('.stage > img');
const ab    = box.querySelector('.ab');
const imgA  = box.querySelector('.abimg');
const grip  = box.querySelector('.abgrip');
const tl    = el('tl');
const scrub = el('tlscrub');
const play  = box.querySelector('.tlplay');
const cmp   = box.querySelector('.tlcmp');

let cam = null;      // camera id while the lightbox is showing one, else null
let all = [];        // every stored frame, unix seconds, ascending
let frames = [];     // the subset inside the chosen range
let liveSrc = '';    // the live proxied still — always the last position on the scrubber
let range = RANGES[0][1];
let timer = null;

const srcOf = ts => `api.php?shot=${cam}&t=${ts}`;
// One past the end of `frames` is the live still. It is not in the archive — it is what the lightbox
// was opened on — but on the scrubber it is simply the newest thing there is, which is what it is.
const isLive = i => i >= frames.length;
const srcAt  = i => isLive(i) ? liveSrc : srcOf(frames[i]);
const labelAt = i => isLive(i) ? 'live' : stamp(frames[i]);

tl.querySelector('.tlranges').innerHTML = RANGES.map(([label, secs]) =>
  `<button class="tlr" data-secs="${secs}">${label}</button>`).join('');

function paint() {
  const i = +scrub.value;
  imgB.src = srcAt(i);
  box.querySelector('.btime').textContent = labelAt(i);
  // The comparison is always against the oldest frame still in view, so widening the range widens
  // what "before" means — which is the whole reason the ranges exist.
  if (frames.length) {
    imgA.src = srcOf(frames[0]);
    box.querySelector('.abtime').textContent = stamp(frames[0]);
  }
}

function setRange(secs) {
  range = secs;
  const cut = Date.now() / 1000 - secs;
  frames = all.filter(ts => ts >= cut);
  scrub.max = frames.length;         // the extra slot is "live"
  scrub.value = frames.length;
  tl.querySelectorAll('.tlr').forEach(b =>
    b.classList.toggle('on', +b.dataset.secs === secs));
  // Warm the whole window at once. It is at most ~60 frames off local disk, served immutable, and
  // the alternative is a scrubber that stutters on every drag — the one interaction this exists for.
  frames.forEach(ts => { new Image().src = srcOf(ts); });
  paint();
}

function stop() {
  clearInterval(timer);
  timer = null;
  play.firstElementChild.className = 'i i-play_arrow';
  play.title = play.ariaLabel = 'Play';
}

/* Loops. A camera clip is 12–60 frames — under 20 seconds — and stopping dead at the end of a river
   rising means pressing play again to see it, which is how you end up watching the same 20 seconds
   three times anyway. Live is skipped while playing: it is a different image at a different
   resolution, and a full-size JPEG flashing in at the end of a run of WebP reads as a glitch. */
function toggle() {
  if (timer) return stop();
  if (frames.length < 2) return;
  if (+scrub.value >= frames.length - 1) scrub.value = 0;
  play.firstElementChild.className = 'i i-pause';
  play.title = play.ariaLabel = 'Pause';
  timer = setInterval(() => {
    scrub.value = (+scrub.value + 1) % frames.length;
    paint();
  }, FRAME_MS);
}

function setCompare(on) {
  ab.hidden = grip.hidden = !on || !frames.length;
  cmp.setAttribute('aria-pressed', String(!ab.hidden));
  cmp.classList.toggle('on', !ab.hidden);
  // ui.js reads this back: a click on the picture normally closes the lightbox, and while the
  // divider is live a click on the picture is a drag, not a dismissal.
  box.classList.toggle('cmp', !ab.hidden);
  if (!ab.hidden) paint();
}

/* Drag anywhere on the stage, not only on the handle: on a phone the divider is 2px wide and a
   2px drag target is a target nobody hits. Pointer events, so mouse and touch are one path. */
function slide(e) {
  const r = stage.getBoundingClientRect();
  stage.style.setProperty('--ab',
    `${Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)).toFixed(1)}%`);
}
stage.addEventListener('pointerdown', e => {
  if (ab.hidden) return;
  stage.setPointerCapture(e.pointerId);
  slide(e);
});
stage.addEventListener('pointermove', e => {
  if (!ab.hidden && stage.hasPointerCapture(e.pointerId)) slide(e);
});

scrub.oninput = () => { stop(); paint(); };
play.onclick = toggle;
cmp.onclick = () => setCompare(ab.hidden);
tl.querySelector('.tlranges').onclick = e => {
  const b = e.target.closest('[data-secs]');
  if (b) { stop(); setRange(+b.dataset.secs); }
};

/* Called by ui.js the moment the lightbox opens, with whatever URL it put in the img. The camera id
   is read back out of that URL rather than threaded through two call sites in markup: `?cam=<n>` is
   the proxy's own shape, and its absence is exactly the condition under which there is no archive to
   offer — the static build hotlinks upstream and stores nothing. */
export async function openTimeline(src) {
  reset();
  const id = /[?&]cam=(\d+)/.exec(src || '')?.[1];
  if (!id) return;
  cam = id;
  liveSrc = src;
  try {
    all = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { all = []; }
  // Still the camera we opened? An impatient close-and-open-another beats a slow fetch otherwise.
  if (cam !== id || !Array.isArray(all) || all.length < 2) return;
  tl.hidden = false;
  setRange(RANGES[0][1]);
}

export function reset() {
  stop();
  setCompare(false);
  cam = null;
  all = frames = [];
  tl.hidden = true;
  stage.style.removeProperty('--ab');
  box.querySelector('.btime').textContent = '';
}
