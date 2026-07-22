/* A station going on alert between two polls is the one event on this page worth interrupting for.
 * Everything else — a level nudging up, a camera refreshing — is why the panel and the map are
 * already there. So this fires on the *transition* only: stations that were not on alert last poll
 * and are now.
 *
 * Desktop only, by CSS (see chrome.css). On a phone the toast would land on the map in the one
 * band that is already the search box, the alert panel and whatever the user is looking at, and a
 * thing that covers the map to tell you to look at the map is self-defeating. The alert panel is
 * the mobile answer and it springs open by itself.
 */

import { KINDS } from './config.js';
import { state } from './state.js';
import { el, isHot, isStale, tier, isIgnored } from './util.js';
import { flashTo } from './map.js';
import { byId } from './stations.js';

const SHOW_MS = 12000;   // long enough to read three names and reach for one, short enough to leave
const LIST = 3;          // named in the toast; the rest are counted

/* Alarm-flood control, straight out of ISA-18.2, which calls more than ten alarms in ten minutes a
   system failure rather than a busy day. Its remedy is not to interrupt faster: it is to *stop*
   interrupting and defer to the overview display. Past FLOOD_N stations on alert this page is
   already an overview display — the panel springs open, the ticker is running, the map is red — and
   a popup repeating what all three are saying is only in the way. Below that, one interruption per
   COOL_MS at most; anything held back is not lost, it simply lands in the next one. */
const FLOOD_N = 10;
const COOL_MS = 600000;   // 10 minutes

let seen = null;         // ids on alert at the last poll — null until the first one lands
let seenNow = null;      // and the subset that was actually happening, for the all-clear
let lastShown = 0;
let hide;

/* Deliberately *not* filtered by the district picker. The panel is filtered because it is a list you
   are reading; this is a notification, and a filter you set an hour ago to tidy the map is not
   consent to be kept in the dark about a river reaching its danger mark. Ignoring one named sensor
   is that consent, so it does apply here — see isIgnored() in util.js. */
const rows = list => list.slice(0, LIST).map(s => {
  const t = tier(s);
  // `null` only reaches here from the all-clear list: off the alert set entirely. A cleared station
  // that is still climbing keeps its forecast line, because that is still true of it.
  const why = t === null   ? 'back below its danger mark'
    : t === 'stale'        ? 'stopped reporting'
    : s.kind === 'siren'   ? 'siren sounding'
    : s.status >= 3        ? 'at danger'
    : `reaches danger ${s.eta != null && s.eta < 1 ? 'within the hour' : `in ~${s.eta} h`}`;
  return `<button class="trow" data-go="${s.id}">
    <i class="i i-${KINDS[s.kind].icon}" style="--c:${KINDS[s.kind].color}"></i>
    <span class="tname">${s.name}</span>
    <span class="twhy muted">${why}</span>
  </button>`;
}).join('');

function show(kind, head, list) {
  const box = el('toast');
  box.className = `surface ${kind}`;
  box.innerHTML = `<div class="thead">
      <i class="i i-${kind === 'clear' ? 'check_circle' : 'warning'}"></i>
      <b>${head}</b>
      <button class="tclose icon" aria-label="Dismiss"><i class="i i-close"></i></button>
    </div>${rows(list)}${
    list.length > LIST ? `<div class="tmore muted">and ${list.length - LIST} more — see the alert panel</div>` : ''}`;

  box.classList.add('open');
  lastShown = Date.now();
  clearTimeout(hide);
  hide = setTimeout(() => box.classList.remove('open'), SHOW_MS);
}

export function alertToast() {
  const hot = state.data.filter(s => isHot(s) && !isIgnored(s));
  const now = new Set(hot.map(s => s.id));
  const nowTier = new Set(hot.filter(s => tier(s) === 'now').map(s => s.id));

  // First poll of the session: everything on alert is "new", and announcing a state that was already
  // true before you opened the page is not news. Seed and say nothing.
  if (seen === null) { seen = now; seenNow = nowTier; return; }

  /* Cleared: was happening, and is not any more. Two exclusions, and both matter more than the
     feature does. A station that went *stale* has not cleared — its telemetry died, which is the one
     case where saying "back below danger" would be an actual lie. And a station that has vanished
     from the payload cannot be checked at all, so it is left alone rather than declared safe. */
  const cleared = state.data.filter(s =>
    seenNow.has(s.id) && !nowTier.has(s.id) && !isStale(s));
  const fresh = hot.filter(s => !seen.has(s.id));

  // Flooded: the panel, ticker and map are all already saying this. Keep the ledger current — the
  // news is being delivered, just not by a popup — and stay out of the way.
  if (hot.length >= FLOOD_N) { seen = now; seenNow = nowTier; return; }
  // Cooling down: do *not* advance `seen`, so anything held back is still new next poll and lands
  // in the following toast rather than being swallowed.
  if (Date.now() - lastShown < COOL_MS) return;

  seen = now; seenNow = nowTier;

  /* Bad news outranks good news. Both in one poll means the situation is moving, and "2 back below
     danger" over the top of "1 at danger" is the wrong headline for that. */
  if (fresh.length) {
    const nowN = fresh.filter(s => tier(s) === 'now').length;
    const soonN = fresh.length - nowN;
    // Says which kind of alert, because "3 stations have gone on alert" covered a river already over
    // its mark and a forecast that may never happen, in the same six words.
    const head = nowN && soonN ? `${nowN} at danger, ${soonN} forecast to reach it`
      : nowN                   ? `${nowN} station${nowN > 1 ? 's' : ''} at danger now`
                               : `${soonN} station${soonN > 1 ? 's' : ''} forecast to reach danger`;
    show(fresh.some(s => tier(s) === 'now') ? 'now' : 'soon', head, fresh);
  } else if (cleared.length) {
    show('clear', `${cleared.length} station${cleared.length > 1 ? 's' : ''} back below danger`, cleared);
  }
}

/* One delegated handler for every toast this session — the markup is rebuilt each time, so binding
   per row would leak a listener per alert. */
el('toast').onclick = e => {
  const box = el('toast');
  if (e.target.closest('.tclose')) { box.classList.remove('open'); clearTimeout(hide); return; }
  const id = e.target.closest('[data-go]')?.dataset.go;
  const t = id && byId(id);
  if (!t) return;
  // Dismiss before flying: the toast sits over the map it is about to send you across.
  box.classList.remove('open');
  clearTimeout(hide);
  flashTo(t);
};

// Hovering means reading. Restart the clock on the way out rather than letting it expire under the
// pointer — losing the row you were about to click is a small betrayal.
el('toast').onmouseenter = () => clearTimeout(hide);
el('toast').onmouseleave = () => {
  if (el('toast').classList.contains('open'))
    hide = setTimeout(() => el('toast').classList.remove('open'), SHOW_MS / 2);
};
