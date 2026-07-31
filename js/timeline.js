/* Replay of a camera's archive, inside the lightbox and nowhere else.
 *
 * A river level has had a graph all along; a camera had only "now" — which is the wrong tense for
 * the question people actually bring to a flood camera ("was it like this an hour ago?"). The server
 * keeps one frame per camera every 30 minutes and thins them by age (see SHOT_TIERS in shots.php);
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

import { el, isIgnored } from './util.js';
import { byId } from './stations.js';

/* Named windows rather than a free zoom. The retention tiers mean the archive is *already* a set of
   resolutions — half-hourly for a day, then 3-hourly, then 12-hourly, then weekly — so a continuous
   zoom would promise detail that is not on disk between the stops. These are the stops.
   `step` is that tier's spacing and the playback *thins to it*: retention works on a frame's age, so
   a week window holds six days of 3-hourly frames and then 48 half-hourly ones at the near end, and
   playing the lot spends most of the clip on the last day. The window says "a week"; the clip has to
   move through it at one pace — and the tick strip is drawn off the same thinned list, so the
   ruler's spacing and the clip's spacing cannot disagree.
   Every step is picked so its window lands near 50 frames: 48, 56, 60, 52. That is a clip of about a
   minute at one frame a second, the same weight of thing to sit through whichever range is chosen —
   and it means a range and its tier are one decision, so `SHOT_TIERS` cannot be loosened without a
   range going thin and short.
   No 6-hour stop: the capture rate is `SHOT_EVERY` (30 min), so a "keep every frame" window is a
   30-minute window with a second name — the finest resolution that exists is one frame per half
   hour, and 24 h is where it is already offered. */
const RANGES = [
  { label: '24 h',  win: 24 * 3600,   step: 1800,       every: 'one frame every 30 minutes' },
  { label: 'week',  win: 7 * 86400,   step: 3 * 3600,   every: 'one frame every 3 hours' },
  { label: 'month', win: 30 * 86400,  step: 12 * 3600,  every: 'one frame every 12 hours' },
  { label: 'year',  win: 365 * 86400, step: 7 * 86400,  every: 'one frame a week' },
];
/* One frame a second. Not an animation frame rate — consecutive frames here are 30 minutes to a week
   apart, so nothing on screen is continuous with what preceded it and there is no motion to smooth.
   Every frame is a separate scene that has to be read: has the water risen, is the road still there.
   The first pass ran at 320ms, paced as if this were video, and pushed the whole archive past before
   any of it registered. A second a frame is the pace of looking rather than the pace of playback; a
   typical 30-60 frame range takes 30-60s, and the scrubber is there for anyone after one moment.
   Every frame, including live: a longer dwell on the last one was tried and it reads as the clip
   having stalled, not as an arrival. There is nothing on screen saying a pause is deliberate. */
const FRAME_MS = 1000;

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
const ticks = box.querySelector('.tlticks');
const meta  = box.querySelector('.tlmeta');
const play  = box.querySelector('.tlplay');
const cmp   = box.querySelector('.tlcmp');

let cam = null;      // camera id while the lightbox is showing one, else null
let all = [];        // every stored frame, unix seconds, ascending
let tierAt = new Map();   // frame ts -> {tier, id}, for the tick colors. Empty is the calm case.
let frames = [];     // the subset inside the chosen range
let liveSrc = '';    // the live proxied still — always the last position on the scrubber
let range = RANGES[0];
let timer = null;

const srcOf = ts => `api.php?shot=${cam}&t=${ts}`;
// One past the end of `frames` is the live still. It is not in the archive — it is what the lightbox
// was opened on — but on the scrubber it is simply the newest thing there is, which is what it is.
const isLive = i => i >= frames.length;
const srcAt  = i => isLive(i) ? liveSrc : srcOf(frames[i]);
const labelAt = i => isLive(i) ? 'live' : stamp(frames[i]);

tl.querySelector('.tlranges').innerHTML = RANGES.map((r, i) =>
  `<button class="tlr" data-i="${i}">${r.label}</button>`).join('');

function paint() {
  if (!cam) return;   // nothing to paint from, and the img belongs to whoever opened the lightbox
  const i = +scrub.value;
  /* B is the live still and holds still; A — the clipped side — is what scrubs and plays. The fixed
     side is the one you already know, the picture the lightbox was opened on, so every position of
     the scrubber reads as "then, against now" and playing a range slides the past across a present
     that stays put. Keeping it on B rather than A also steadies the box: `.stage` is sized by the
     in-flow base image, so a base that never changes is a stage that never resizes mid-playback.
     Only while comparing, though. With the divider off there is no A on screen, so the base image is
     the only thing there is and it has to be the one that moves — otherwise scrubbing a lightbox
     with compare turned off would change the timestamp and nothing else. */
  const on = !ab.hidden;
  imgB.src = on ? liveSrc : srcAt(i);
  box.querySelector('.btime').textContent = on ? 'live' : labelAt(i);
  if (on) {
    imgA.src = srcAt(i);
    box.querySelector('.abtime').textContent = labelAt(i);
  }
}

/* One frame per `step`-wide bucket, newest in the bucket winning — the same rule and the same bucket
   keys the server prunes by (`pruneShots()` in shots.php), so a window that has already been thinned
   to this step comes through untouched and one that has not is thinned the same way it eventually
   will be. Ascending in, ascending out: a Map keeps insertion order, and re-setting a key does not
   move it. */
function thin(list, step) {
  const keep = new Map();
  for (const ts of list) keep.set(Math.floor(ts / step), ts);
  return [...keep.values()];
}

/* A ruler under the scrubber: one mark per frame. Marks taken while a river within CAM_ALERT_KM was
   at danger, or forecast to reach it, carry that tier as a color — so the strip answers "when did
   this start" without playing the whole clip.
   The reader's own ignore list is applied here rather than on the server, which never learns it. A
   tick raised by an ignored sensor falls back to plain, not to the next worst river. */
function drawTicks() {
  ticks.innerHTML = frames.map((ts, i) => {
    const a  = tierAt.get(ts);
    const st = a ? byId(a.id) : null;
    const on = !!a && !(st && isIgnored(st));
    const why = on ? ` · ${a.tier === 'now' ? 'at danger' : 'forecast'}` : '';
    return `<i data-i="${i}" title="${stamp(ts)}${why}" class="${on ? 't-' + a.tier : ''}"
               style="left:${i / scrub.max * 100}%"></i>`;
  }).join('') + (frames.length
    ? `<i class="now" data-i="${frames.length}" title="live" style="left:100%"></i>` : '');
}

function setRange(r) {
  range = r;
  const cut = Date.now() / 1000 - r.win;
  frames = thin(all.filter(ts => ts >= cut), r.step);
  scrub.max = frames.length;         // the extra slot is "live"
  /* Rest on live normally — the newest thing there is, and what the lightbox was already showing.
     Start at the oldest frame instead whenever something is going to *move*: while comparing, live
     is the fixed side and resting there puts the picture against itself; while playing, the run
     should begin at the far end of the range that was just asked for. Both mean "further back",
     which is the only reason to reach for a wider range in the first place. */
  scrub.value = (timer || !ab.hidden) ? 0 : frames.length;
  tl.querySelectorAll('.tlr').forEach((b, i) => b.classList.toggle('on', RANGES[i] === r));
  /* The pace, and only the pace. It is the one thing not guessable from the picture — every range
     plays at a frame a second, so while running they look identical and differ only in what each
     second is worth. The frame count and the span were here too and are gone: both are already on
     screen as the tick strip, which shows the count by being countable and the span by starting at
     the left edge, and a caption repeating them in words made three lines of chrome out of one. */
  meta.textContent = frames.length ? r.every : 'nothing stored this far back — live only';
  drawTicks();
  // Warm the whole window at once. It is at most ~60 frames off local disk, served immutable, and
  // the alternative is a scrubber that stutters on every drag — the one interaction this exists for.
  frames.forEach(ts => { new Image().src = srcOf(ts); });
  paint();
}

function stop() {
  clearInterval(timer);
  timer = null;
  play.firstElementChild.className = 'i i-play_arrow';
  // Title and label diverge: the tooltip carries the key, the accessible name must not — a screen
  // reader announcing "Play open-paren k" reads the binding as part of the control's name.
  play.title = 'Play (k)';
  play.ariaLabel = 'Play';
}

/* The last position a run reaches. Live is part of the clip: the question a flood camera is opened
   with is "how did it get to *this*", and a playback that stopped 30 minutes short of now and jumped
   straight back to the oldest frame never answered it — it showed every photo except the one on
   screen when play was pressed. Live was skipped originally because it is a full-size JPEG landing
   at the end of a run of 720p WebP; it does land visibly, but arriving at the present is what the
   clip is for.
   Skipped only while comparing, where live is the *fixed* side — playing onto it would lay the
   picture over itself, the same empty-divider state setCompare() steps around. */
const lastPos = () => ab.hidden ? frames.length : frames.length - 1;

/* Every deliberate move to a position goes through here: the step buttons, "now", and a click on a
   tick. All three stop playback for the same reason `scrub.oninput` does — having asked for one
   frame you are not asking to be carried off it a second later.
   Clamped, not wrapped. Playback loops because a clip that stops dead means pressing play again;
   a step is a nudge, and a nudge off the oldest frame that lands on the newest is a jump, not a
   nudge. The ceiling is `lastPos()`, so while comparing the steps stay off live for the same reason
   playback does — it is the fixed side, and stepping onto it lays the picture over itself. */
function go(i) {
  stop();
  scrub.value = Math.max(0, Math.min(lastPos(), i));
  paint();
}

/* Restarting a CSS animation needs the class off, a style flush, then the class on. `offsetWidth` is
   the flush; requestAnimationFrame is not, because its callbacks run before the frame's style recalc
   — the same trap `#gotoBox`'s focus hit. Without it a second press inside the animation's 350ms
   adds a class that is already there and paints nothing. */
function flash(b) {
  b.classList.remove('flash');
  b.offsetWidth;
  b.classList.add('flash');
}

/* Loops. A camera clip is 12–60 frames — under 20 seconds — and stopping dead at the end of a river
   rising means pressing play again to see it, which is how you end up watching the same 20 seconds
   three times anyway. */
function toggle() {
  if (!timer && frames.length < 2) return;
  if (timer) return stop();
  /* Starts from wherever the scrubber already is — no rewind. It used to jump to frame 0 whenever it
     was resting at the end, which meant opening a camera replaced the picture you had just asked to
     see with one from hours ago before you had looked at it. The scrubber rests on live, so a clip
     now opens on the live frame, wraps to the oldest and plays back up to it: "here is now, here is
     how it got here". Costs nothing to arrange — the modulo already wraps, and the resting position
     is already painted. */
  play.firstElementChild.className = 'i i-pause';
  play.title = 'Pause (k)';
  play.ariaLabel = 'Pause';
  timer = setInterval(() => {
    // The range can change underneath a running clip. A range holding nothing would make this a
    // modulo by zero, which lands NaN in the scrubber and freezes the picture mid-play.
    if (frames.length < 2) return stop();
    scrub.value = (+scrub.value + 1) % (lastPos() + 1);
    paint();
  }, FRAME_MS);
}

function setCompare(on) {
  ab.hidden = grip.hidden = !on || !frames.length;
  cmp.setAttribute('aria-pressed', String(!ab.hidden));
  cmp.classList.toggle('on', !ab.hidden);
  // ui.js reads this back for its cursor; here it is the reason the picture stops being a play
  // button — while the divider is up a press on the picture is a drag, not a press.
  box.classList.toggle('cmp', !ab.hidden);
  /* The scrubber rests on "live", and so is the fixed side — turning compare on there would lay the
     picture over itself and read as a broken divider rather than an empty one. Open on the oldest
     frame in range instead: the widest gap available, and the pairing this feature used to show by
     default. */
  if (!ab.hidden && isLive(+scrub.value)) scrub.value = 0;
  // Both ways, not just on. Switching compare *off* has to hand the moving frame back to the base
  // image, which is holding the live still while the divider is up.
  paint();
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

/* The picture is the play button. It is the largest target in the dialog and the thing being looked
   at, so reaching to the footer to pause a clip means looking away from the frame you paused it on.
   Nothing was on this click before — the lightbox closes on its backdrop only, deliberately, because
   the old tap-anywhere overlay could not tell a dismissal from a scrub.
   Not while comparing: there a press on the stage is the start of a drag on the divider, and the
   same gesture cannot be both. `frames.length < 2` is toggle()'s own guard, so a camera with no
   archive behind it keeps an inert picture rather than one that swallows clicks. */
stage.onclick = () => { if (ab.hidden && !tl.hidden) { flash(play); toggle(); } };

scrub.oninput = () => { stop(); paint(); };
/* A mark is its frame. Clicking one is the same act as dragging the thumb onto it — with the
   timestamp already read off the tooltip, which is the case the scrubber serves worst: it has no
   labels, so finding 18:00 on it is a drag-and-watch. Stops playback for the reason `oninput` does,
   that having gone to a specific frame you are not asking to be carried off it a second later. */
ticks.onclick = e => {
  const t = e.target.closest('[data-i]');
  if (t) go(+t.dataset.i);
};
const prevBtn = tl.querySelector('.tlstep[data-d="-1"]');
const nextBtn = tl.querySelector('.tlstep[data-d="1"]');
const nowBtn  = tl.querySelector('.tlnow');
const trans   = tl.querySelector('.tltransport');

play.onclick = toggle;
tl.querySelectorAll('.tlstep').forEach(b => { b.onclick = () => go(+scrub.value + +b.dataset.d); });
/* "Now" is `lastPos()`, not `frames.length`, so while comparing it lands on the newest *archived*
   frame instead of on live. Live is the fixed side there; the nearest thing to now that the moving
   side can hold is the frame before it, and that is what the button is asking for.
   It pauses, like every step does — `go()` calls `stop()`. Arriving at the newest frame and then
   being carried off it a second later is the one thing "go to now" must not do. */
nowBtn.onclick = () => go(lastPos());

/* One flash rule for the whole cluster, on the group rather than per button: whatever was pressed
   lights up, whether the press came from a pointer, from Enter on a focused button, or from the
   keyboard map below — which reaches these controls by calling `.click()`, so it lands here too.
   The picture is the play button as well (see `stage.onclick`), and that is the press this exists
   for: eyes on the frame, and the only other feedback an icon 200px away swapping between two
   glyphs nobody is looking at. */
trans.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) flash(b);
});

/* YouTube's bindings, because a full-screen player is where people have already learned them, and
   inventing a second set for the one dialog on this page that *is* a player would be a set to
   learn. Space or `k` plays and pauses, `,` `.` and the arrows step a frame, End goes to now.
   `j`/`l` are absent: on YouTube they are a coarser jump than the arrows, and here the coarse
   control is the range — a frame is already 30 minutes to a week, so there is no second granularity
   to bind. `0`/Home are absent for a different reason: there is no button for "oldest frame", and
   every key here maps to a button so the press has something to light up.
   Bound on the dialog, so the whole lightbox answers. A key you must focus something to use is a
   key you must find first. */
const KEYS = {
  ' ': play, k: play,
  ',': prevBtn, ArrowLeft: prevBtn,
  '.': nextBtn, ArrowRight: nextBtn,
  End: nowBtn,
};
/* The scrubber is an `<input type="range">` and handles these itself when it holds focus. Firing
   here as well would move two frames per press. */
const NATIVE = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
play.addEventListener('blur', () => play.classList.remove('noring'));
box.addEventListener('keydown', e => {
  if (tl.hidden || e.ctrlKey || e.altKey || e.metaKey) return;
  play.classList.remove('noring');   // any key means someone is navigating: give the ring back
  if (e.target === scrub && NATIVE.has(e.key)) return;
  /* Space on a focused button is that button's own press, and the browser fires it on keyup — so
     handling it here too would run the action twice. Left alone, which is why the play button takes
     focus when the timeline appears: space then lands on it natively and does the right thing.
     Every *other* button in the dialog keeps its own space, including the close button. */
  if (e.key === ' ' && e.target.closest('button')) return;
  // Caps lock should not turn the bindings off. Only `k` is a letter, so one fallback covers it.
  const b = KEYS[e.key] || KEYS[e.key.toLowerCase()];
  if (!b) return;
  e.preventDefault();       // space scrolls the page, arrows scroll the dialog
  b.click();                // the button, not the action — so it flashes, exactly as if pressed
});
// Pausing first: reaching for compare means you have found the frame you want to hold against the
// live one, and playback would carry it away a second later. Same reason the scrubber stops on input.
cmp.onclick = () => { stop(); setCompare(ab.hidden); };
tl.querySelector('.tlranges').onclick = e => {
  // Deliberately does not stop playback. A range is a zoom level on one timeline, not a different
  // thing to watch — changing it while a clip runs should widen what is being played, not end it.
  // setRange restarts the run at the oldest frame of the new range.
  const b = e.target.closest('[data-i]');
  if (!b) return;
  setRange(RANGES[+b.dataset.i]);
  /* And starts one if none was running. Asking for "week" is asking to see the week, not to be
     handed a single still from the far end of it and left to find the play button — setRange has
     already parked the scrubber on the oldest frame in the new window, which is the start of exactly
     the clip that was just asked for.
     Not while comparing: there the range is choosing *which* past frame to hold against live, and a
     clip would carry it away a second later — the same reason the compare button pauses first. */
  if (ab.hidden && !timer) toggle();   // `!timer`: toggle() on a running clip would stop it
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
  let rows = [];
  try {
    rows = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { rows = []; }
  // Still the camera we opened? An impatient close-and-open-another beats a slow fetch otherwise.
  if (cam !== id || !Array.isArray(rows)) return;
  /* Rows are [ts, tier, stationId]. A bare number is the shape this endpoint returned before the
     tiers landed, and a response cached for its 60 seconds can still be that old — so read both
     rather than blank the scrubber for a minute after every deploy. */
  all = rows.map(r => Array.isArray(r) ? r[0] : r);
  tierAt = new Map(rows.filter(r => Array.isArray(r) && r[1]).map(r => [r[0], { tier: r[1], id: r[2] }]));
  if (all.length < 2) return;
  tl.hidden = false;
  /* Open on the narrowest window that actually holds a clip. 6 h is the right default on a server
     that has been capturing all along and empty on one that has not — and an empty scrubber under a
     camera with a week of frames behind it reads as "no archive", which is the state this whole
     footer exists to replace. */
  const t0 = Date.now() / 1000;
  setRange(RANGES.find(r => all.filter(ts => ts >= t0 - r.win).length >= 2) ?? RANGES[0]);
  /* And plays, without being asked. Opening a camera full-screen *is* the request to look at it
     properly, and the archive is the only thing here that has to be set in motion to be seen at all
     — a still that opens paused looks exactly like a camera with no history behind it, which is what
     the lightbox showed before this feature existed. The controls are right there the moment it
     starts, so stopping it costs one press; finding out there was anything to play cost a press
     nobody knew to make. Compare is always off at this point (reset() turns it off), so this is the
     unconditional case of the same rule the range buttons follow. */
  toggle();
  /* And takes focus. `<dialog>` focuses the first focusable thing it finds, which was the × — so
     space, the key everyone reaches for first in a player, closed the lightbox. The footer does not
     exist yet when showModal() runs (it is `hidden` until the archive has been fetched), so
     `autofocus` in the markup cannot win that race; this is the moment it can. Programmatic focus is
     not `:focus-visible` in most cases — but Chrome carries the modality of the *previous* focus
     across, so opening the lightbox from a keyboard-focused control lands a ring on a button nobody
     asked to focus. `.noring` suppresses that one ring and nothing else: the first key press or the
     first blur takes it off, so a reader who is actually navigating gets the indicator back before
     it can matter. */
  play.focus({ preventScroll: true });
  play.classList.add('noring');
}

export function reset() {
  stop();
  /* Cleared *before* setCompare, which now repaints in both directions. openTimeline() resets first
     and ui.js has already put the new camera's live still in the img by then — a repaint carrying
     the previous camera's `cam` and `frames` would overwrite it with a frame from the last one. */
  cam = null;
  all = frames = [];
  tierAt = new Map();
  setCompare(false);
  tl.hidden = true;
  stage.style.removeProperty('--ab');
  box.querySelector('.btime').textContent = '';
}
