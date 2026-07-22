/* The header ticker: everything currently on alert, scrolling continuously, left of the status chip.
 *
 * Why a ticker at all, when the alert panel already lists these: the panel is on the map, and the
 * map is the thing you cover with a popup, a table, a drawer or a lightbox. The header is the one
 * strip that is never covered, so this is the layer that keeps saying "two rivers are at danger"
 * while you are reading something else.
 *
 * It carries no information the panel does not. That is deliberate — it is a reminder, not a
 * source, and anything only available here would be information hidden inside an animation.
 *
 * Direction is the stock-ticker convention: the strip translates left, so items enter at the right
 * edge and leave at the left, and a name is read in the same direction it is written.
 */

import { KINDS, HOTLINES } from './config.js';
import { state } from './state.js';
import { el, isHot, dkey, tier } from './util.js';
import { flashTo } from './map.js';
import { byId } from './stations.js';

const PX_PER_SEC = 45;   // reading pace: slow enough to finish a station name, fast enough to cycle
const FAST_FROM = 5;     // above this many alerts, wind it up — see pace()
const MIN_TILES = 3;     // fewest items on the strip before it is padded out by repetition
const ADVISE_EVERY = 25; // alert items between hotline reminders; under this, once per set

/* One lap has to show everything, so with a lot of alerts a fixed pace means waiting a minute to see
   whether your river is on the list. Speed scales with the count from `FAST_FROM` up, capped at 2x:
   past that the names stop being readable and the ticker is just motion. */
const pace = n => PX_PER_SEC * Math.min(2, Math.max(1, n / FAST_FROM));

/* Unfiltered by the district picker, like the toast and unlike the panel. The panel is a list you
   went looking at; this is ambient. A filter set to tidy the map is not a request to be told less
   about rivers reaching their danger mark. */
export function ticker() {
  const box = el('ticker');
  const run = box.querySelector('.tk-run');
  /* Ordered by place, then by severity within a place. The panel is sorted worst-first because you
     read it deliberately, top down; the ticker is read a glance at a time, so what matters is that
     two alerts in the same district arrive together instead of forty minutes apart. Sorted, not
     grouped — no headers, no merging. Every item stays a station you can click, and the ordering
     does the work silently. */
  const hot = state.data.filter(isHot).sort((a, b) =>
    (a.district || '').localeCompare(b.district || '')
    || dkey(a).localeCompare(dkey(b))
    || (b.kind === 'siren') - (a.kind === 'siren')
    || (b.ratio || 0) - (a.ratio || 0));

  /* Quiet is a state, not an absence: a ticker that empties itself looks broken, and on a flood map
     "broken" and "nothing is happening" must never look the same. All-clear gets its own card —
     centred, grey and perfectly still. Stillness is the message: the strip moves when, and only
     when, there is something to report. */
  if (!hot.length) {
    box.classList.add('quiet');
    run.style.removeProperty('--dur');
    run.innerHTML = `<span class="tk-i tk-none"><i class="i i-check_circle"></i>No alerts</span>`;
    return;
  }
  box.classList.remove('quiet');

  /* The reason carries the tier, in colour and in wording. The kind icon cannot: the colour language
     reserves the traffic-light ramp for status, and a river's blue is what makes it a river. So the
     icon stays blue and the *reason* goes red for what is happening, amber for what is forecast,
     grey for what we can no longer vouch for. */
  const items = hot.map(s => {
    const t = tier(s);
    const why = t === 'stale'      ? 'last known · not current'
      : s.kind === 'siren'         ? 'siren sounding'
      : s.status >= 3              ? `at danger${s.level != null ? ` · ${s.level.toFixed(2)} m` : ''}`
      : `reaches danger ${s.eta != null && s.eta < 1 ? 'within the hour' : `in ~${s.eta} h`}`;
    return `<button class="tk-i" data-go="${s.id}" tabindex="-1">
      <i class="i i-${KINDS[s.kind].icon}" style="--c:${KINDS[s.kind].color}"></i>
      <b>${s.name}</b><span class="tk-why t-${t}">${s.district ? `${s.district} · ` : ''}${why}</span>
      <span class="tk-dot">•</span>
    </button>`;
  });

  /* What to do, on the strip that is never covered. It appears on exactly the condition that already
     winds the strip up — `pace()` leaving its base speed, i.e. more than FAST_FROM alerts at once.
     That threshold is not arbitrary twice over: the speed-up exists because the list has got long
     enough that one lap is a wait, and a list that long is also the point at which "which of these
     is about me" stops being obvious and a phone number starts being the useful thing on screen.
     Below it the strip is calm and a standing hotline banner would be the sort of permanent warning
     nobody reads by the second day. */
  const advise = hot.length > FAST_FROM
    ? `<span class="tk-i tk-say"><i class="i i-campaign"></i>
         <b>In danger? Call 999</b><span class="tk-why">flood emergency lines:
         <a href="${HOTLINES}" target="_blank" rel="noopener">civildefence.gov.my</a>
         — this is not an official warning channel</span>
         <span class="tk-dot">•</span></span>`
    : '';

  /* The loop works by rendering the strip twice and translating exactly -50%: the second copy lands
     where the first began, so the wrap has no seam. That only holds if one copy is at least as wide
     as the box — with a single short alert it is nowhere near, and the strip would scroll off and
     leave the bar empty for most of every lap. So the copy is padded out by repetition first, and
     *then* doubled. Measured, not guessed: one alert needs several repeats, ten need none.

     Two conditions, because width alone was not enough: a single alert wide enough to cover the box
     still popped, since one tile leaving the left edge is the whole strip leaving. `MIN_TILES` keeps
     at least three on the belt so there is always a neighbour following the one going out. */
  /* The advisory rides inside the repeated set, not outside it: the -50% loop only works if every
     copy is identical, so anything appended once would jump on the wrap.
     One at the head of the set, then one every ADVISE_EVERY alert items after that. With a short
     list that is just the single leading copy; with sixty alerts a lap would otherwise carry the
     phone number past once and then bury it under a minute of station names — which is the wrong
     way round, because the longer the list the more likely the reader is someone who needs the
     number rather than the telemetry. */
  const set = items.map((tile, i) => i % ADVISE_EVERY === 0 ? advise + tile : tile).join('');
  run.style.removeProperty('--dur');
  run.innerHTML = set;
  const one = run.scrollWidth;
  const reps = Math.max(
    one > 0 ? Math.ceil(box.clientWidth / one) : 2,
    Math.ceil(MIN_TILES / hot.length),
  );

  run.innerHTML = set.repeat(reps * 2);
  // Floored: measured before the webfont lands, `scrollWidth` can come back tiny, and a near-zero
  // duration is a strip that flickers rather than scrolls. The next poll re-measures anyway.
  run.style.setProperty('--dur',
    `${Math.max(8, Math.round(one * reps / pace(hot.length)))}s`);
}

// Delegated once: the strip is rebuilt on every poll and holds several copies of every station, so
// per-item listeners would be rebound in bulk for the life of the page.
el('ticker').onclick = e => {
  const t = byId(e.target.closest('[data-go]')?.dataset.go);
  if (t) flashTo(t);
};
