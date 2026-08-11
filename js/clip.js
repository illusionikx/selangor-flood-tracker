/* The station panel's camera clip: what we have of the last three hours, a frame a second.
 *
 * A card used to show one still and call it current at any age. Three hours is the line, because
 * that is the question a flood camera is opened with — "is it like this now" — and a picture from
 * yesterday answers a different one. That question is also why a lap never stops on an archived
 * frame: the last position in every lap is a fresh live still, not the newest cell of the strip,
 * because the strip's own newest cell is only ever as fresh as the last capture — up to SHOT_EVERY
 * (30 min) old in shots.php — and a lap that stopped there never showed the "now" the card was
 * opened to answer.
 *
 * No controls. The lightbox holds the transport, the scrubber and the compare divider, and two
 * places to learn one control is one too many. This is a picture that moves.
 *
 * The hard part is not the timer. `render()` rebuilds the open card on every poll, so the <img>
 * this module is writing to is replaced under it every few minutes. Restarting on each rebuild
 * would jump back to frame 0 while someone watched, so `start()` rebinds to the new nodes and keeps
 * its place instead. That is the whole reason this is a module with state rather than four lines in
 * popup.js.
 *
 * The clip plays a strip for its archived cells, not a list of individually-fetched frames.
 * shots.php builds one derived image holding the whole window side by side (see the comment above
 * buildSheet() there), and this module reads how many cells it holds straight off the decoded
 * picture's own width — `naturalWidth / SHEET_W` — the same trick js/wall.js uses for the camera
 * wall. One request for the whole archived stretch of the lap, not six or seven — plus the one live
 * request every lap always paid, at the position that answers "now". js/wall.js dropped that live
 * position on purpose: ninety tiles cannot each pay for a fresh still, and paint() over a poll is
 * fresh enough for a wall. A station panel shows one camera, and one live still is one request — so
 * this module keeps paying it.
 */
import { CLIP_WIN, CLIP_MS, SHEET_W, camSrc } from './config.js';
import { noSec, parseMY, ago } from './util.js';

const CLIP_HOURS = CLIP_WIN / 3600;   // the caption names the window; keep the two numbers tied

let id = null;      // camera id the running loop belongs to, or null
let gen = 0;        // bumped on every stop(); a stale await compares against this, not against id
let n = 0;          // cells in the current strip; 0 means no strip is playing
let at = 0;         // position in the lap, 0..n-1 a strip cell, n the live still
let live = '';      // the live still's URL for this camera, fixed for the life of the loop
let timer = null;
let img = null, cap = null, capText = '';

const sheetUrl = () => `api.php?sheet=${id}`;

export function stop() {
  clearInterval(timer);
  timer = null;
  id = null;
  gen += 1;
  n = 0;
  at = 0;
  live = '';
  img = cap = null;
  capText = '';
}

/* One lap is n+1 positions: cells 0..n-1 off the strip, then position n, the live still — the same
   shape `srcAt()` gave this module before the strip existed, kept because the reason for it did not
   change. Two branches do real work; every other step is just `--i`.
   Entering the live position (`at === n`) clears `.strip`, which clears the strip's own `width` and
   `transform` along with it — css/chrome.css's and css/base.css's `.strip` rules are the only place
   either is set, so removing the class is the whole of "restore the live still to its own size and
   position" and there is nothing left over to reset by hand.
   Leaving it (`at === 0`, which by construction only ever follows `at === n`) restores both: the
   class, and the `<img>`'s own `src`. The strip itself is still the exact bytes this loop decoded
   when the lap started — `?sheet=` is cached, not re-encoded, inside its own 900s window (see
   CLAUDE.md) — so coming back to it costs nothing. */
function tick() {
  /* A frame can fail. camImg()'s onerror replaces the failed <img> with a plain div, so the node
     this loop writes to can vanish between one tick and the next. Writing to a detached element
     does nothing useful and never recovers on its own, so stop and let the next openSide() rebuild
     the card and start a clean loop. */
  if (!img || !img.isConnected) return stop();
  const wrap = img.parentNode;
  at = (at + 1) % (n + 1);
  if (at === n) {
    wrap?.classList.remove('strip');
    img.src = live;
    return;
  }
  if (at === 0) {
    wrap?.classList.add('strip');
    img.src = sheetUrl();
  }
  img.style.setProperty('--i', at);
}

/* Bind to whatever nodes the card holds right now. Called on a fresh card and on every rebuild of
   the same card, so it must never reset `at` or `n` — those live at module scope precisely so a
   rebuild can be repainted rather than restarted.
   `capText` is the caption's own state, kept here for the same reason `at` is: `render()` swaps in
   a blank `<p class="clipcap">` on every poll, and without this the caption would read for one
   poll and then go empty for as long as the card stayed open.
   A rebuild hands this a brand new `<img>` with none of the strip machinery on it — `render()`
   replaces the card's markup wholesale, so `img.src`, the `.strip` class and the `--n`/`--i` custom
   properties all have to be repainted here, not just the frame position. The fresh node carries no
   `.strip` class of its own, which is already the right state for a rebind that lands on the live
   position (`at === n`) — only the archived-cell branch below has anything to add. */
function bind(box) {
  img = box.querySelector('img.shot');
  cap = box.querySelector('.clipcap');
  if (img && n >= 2) {
    if (at === n) {
      img.src = live;
    } else {
      img.src = sheetUrl();   // cached from the strip that got us here — this paints, it does not
                               // cost a real fetch inside SHEET's 900s window
      box.classList.add('strip');
      img.style.setProperty('--n', n);
      img.style.setProperty('--i', at);
    }
  }
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
  bind(box);            // paints nothing yet — n is still 0 here — but wires up img/cap for idle()

  /* A detached probe, never the card's own `<img>`. camImg()'s template wires that element's
     `onerror` to replace itself with "image unavailable" on ANY failed load, which is right for a
     dead live still and wrong for a thin archive: setting the real `<img>`'s src straight to
     ?sheet= and letting a 404 hit that handler would swap a perfectly good live picture for an
     error placeholder just because this camera has not built three hours of history yet. Probing
     off to the side keeps a failure silent and leaves the still exactly as it was. */
  const probe = new Image();
  probe.src = sheetUrl();
  try {
    await probe.decode();
  } catch {
    return finishEmpty(cam);
  }
  /* `id !== want` alone missed the case where the reader closed the card and reopened the same
     camera before this decode returned: stop() clears id, the second start() sets id back to the
     same value, and both continuations would then read id === want as true. `gen` catches it —
     stop() bumps it on every call, so a stale run's captured `myGen` can never match again. */
  if (myGen !== gen) return;

  const cells = Math.round(probe.naturalWidth / SHEET_W);
  /* Fewer than two cells is not a clip. shots.php never actually serves this — a strip under two
     frames 404s instead of shipping a useless one, so this floor is defensive rather than the
     common path. Keep the live still the card already drew — it came from JPS when the card
     opened, and no playable strip means this server did not capture, not that the camera stopped. */
  if (cells < 2) return finishEmpty(cam);

  n = cells;
  at = 0;
  capText = `Last ${CLIP_HOURS} hours`;
  if (img) {
    img.src = probe.src;   // already decoded and cached — this paints, it does not fetch again
    box.classList.add('strip');
    img.style.setProperty('--n', n);
    img.style.setProperty('--i', 0);
  }
  if (cap) cap.textContent = capText;
  timer = setInterval(tick, CLIP_MS);
}

/* The no-strip ending, shared by a 404 and a too-thin strip: park on the live still the card already
   drew, set the idle caption, and clear `id` rather than parking on this camera. A card can stay
   open for hours, and the archive can cross the two-cell line while it does — clearing `id` makes
   the next poll's start() treat this as a fresh camera and check the strip again, instead of
   parking here in the idle state for as long as the card stays open. */
function finishEmpty(cam) {
  capText = idle(cam);
  if (cap) cap.textContent = capText;
  id = null;
}

/* Now, as Malaysian wall-clock components, parsed back through the same function that reads a JPS
   stamp. `parseMY()` builds its Date from MYT components in the *viewer's* zone, so what it returns
   is only comparable against another Date built the same way. Both sides then carry the same
   distortion and it cancels.
   `isStale()` compares a parseMY() date against a raw clock and is right anyway, because its window
   is 24 hours and no offset on earth is that wide. Three hours is narrower than the offset itself: a
   reader at UTC+0 is eight hours out, so a nine-hour-old still captioned LATEST IMAGE.
   `hourCycle: 'h23'` because `hour12: false` alone can print midnight as 24:00 on the day before,
   which parses a day late. */
const MYT_STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const nowMY = () => parseMY(MYT_STAMP.format(new Date()).replace(', ', ' '));

/* What the caption says when there is no clip: when this picture was taken, and whether that is
   still current. "Not current" is the words the cards already print on a reading over a day old. */
function idle(cam) {
  const d = parseMY(cam.shot);
  const now = nowMY();
  if (!d || !now) return 'Latest image';
  const gap = now - d;
  const old = gap > CLIP_WIN * 1000;
  // ago() measures against the real clock, so hand it the true instant: the same gap, back from now.
  return `${old ? 'Not current' : 'Latest image'} · ${noSec(cam.shot)}${
    old ? ` · ${ago(Date.now() - gap)}` : ''}`;
}
