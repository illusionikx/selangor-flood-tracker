/* The header ticker: everything on alert, scrolling continuously, centred in the app bar.
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

import { KINDS, HOTLINES, NOTICE, NOTICE_KIND } from './config.js';
import { state } from './state.js';
import { el, isHot, dkey, tier, isIgnored, esc } from './util.js';
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
   about rivers reaching their danger mark.
   An ignored sensor is the exception, and for the same reason: that one *is* a request, made about
   that named sensor. See isIgnored() in util.js. */
export function ticker() {
  const box = el('ticker');
  const run = box.querySelector('.tk-run');
  /* Ordered by place, then by severity within a place. The panel is sorted worst-first because you
     read it deliberately, top down; the ticker is read a glance at a time, so what matters is that
     two alerts in the same district arrive together instead of forty minutes apart. Sorted, not
     grouped — no headers, no merging. Every item stays a station you can click, and the ordering
     does the work silently. */
  const hot = state.data.filter(s => isHot(s) && !isIgnored(s)).sort((a, b) =>
    (a.district || '').localeCompare(b.district || '')
    || dkey(a).localeCompare(dkey(b))
    || (b.kind === 'siren') - (a.kind === 'siren')
    || (b.ratio || 0) - (a.ratio || 0));

  /* Regional notices lead the strip, an outage ahead of a weather warning. Each tile carries the
     full sentence, not a clipped one: the strip has one line and nothing under it to crowd, unlike
     the panel row in alerts.js.
     A tile carries data-banner and no data-go. Neither kind is a station, so neither opens a card.
     The same [data-banner] click in js/ui.js serves this tile and the panel row alike.

     A warning rides here only while `fresh` — the first WARN_FRESH hours of its own validity,
     scored in sources.php because MET stamps Malaysian wall clock with no offset. The panel keeps
     listing it for the whole window. A warning valid for three days would otherwise repeat here for
     three days, which is the standing banner the alert design standard exists to prevent.

     An outage carries no such filter and needs none. The server remembers the notice between the
     polls that refetch nothing, so it rides here for as long as the source serves it, and it leaves
     the poll the tables parse again. See noticeRow() in api.php. A timer would take it off the one
     surface that is never covered, while the map is still degraded.

     Each index is captured before its filter, so it stays the index into the list the click handler
     reads. Renumbering after would open the wrong item, or none. */
  const tile = (kind, icon, c, title, why, i) =>
    `<button class="tk-i tk-warn" data-banner="${kind}:${i}" tabindex="-1">
      <i class="i i-${icon}" style="--c:${c}"></i>
      <b>${esc(title)}</b><span class="tk-why">${esc(why)}</span>
      <span class="tk-dot">•</span>
    </button>`;

  const notes = state.notices
    .map((n, i) => [NOTICE[n.id], i])
    .filter(([t]) => t)                   // an id this build has no words for says nothing
    // `source` is the bare name of the feed, and `line` already states that it is down. `title` is
    // the whole of that sentence, so the tile printed it twice over.
    .map(([t, i]) => tile('notice', 'public_off', 'var(--k-source)', t.title, t.line, i));

  const warns = state.warnings
    .map((w, i) => [w, i])
    .filter(([w]) => w.fresh)
    // `data-warn` indexes state.warnings, so the index comes from the map above and never from the
    // filtered position. The glyph and the colour come from the row's own kind.
    .map(([w, i]) => {
      const b = NOTICE_KIND[w.kind] || NOTICE_KIND.weather;
      return tile('warn', b.icon, b.c, w.title, w.text, i);
    });

  const banners = notes.concat(warns);

  /* Quiet is a state, not an absence: a ticker that empties itself looks broken, and on a flood map
     "broken" and "nothing is happening" must never look the same. All-clear gets its own card —
     centred, grey and perfectly still. Stillness is the message: the strip moves when, and only
     when, there is something to report. A warning counts as something to report too. */
  if (!hot.length && !banners.length) {
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
  const items = banners.concat(hot.map(s => {
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
  }));

  /* What to do, on the strip that is never covered. The threshold is not arbitrary: below it the
     strip is calm, and a standing hotline banner would be the sort of permanent warning nobody
     reads by the second day. Above it the list is long enough that "which of these is about me"
     stops being obvious, and a phone number starts being the useful thing on screen.
     It counts `hot`, and `pace()` counts `items`, so the two no longer move together — they did
     once, and the comment here said so. A MET warning fills the strip and earns the faster lap,
     but it is not a flood: this line tells somebody to call the flood emergency number, and rough
     seas in the straits are no reason to say that to anybody. A response instruction belongs to
     the thing that needs the response. Do not re-couple these two by counting `items` here. */
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
  /* The app's own name closes every set, and it is a divider rather than an item. With one alert the
     strip had nothing but that alert on it, wrapping into itself several times a lap — which reads
     as a stuck ticker rather than as one river in trouble. A second tile gives the eye the seam.

     It sits after the map rather than inside `items`, so the advisory's `i % ADVISE_EVERY` cannot
     land on it, and it is a `<span>` with no `data-go` and no `data-banner`, so nothing opens.

     Same lockup as the app bar and the splash: plain text, then a `<b>` the accent colour picks up.
     The name is one `<span>` and not two flex items, because `.tk-i` is a flex row with a 6px gap
     and a bare text node beside a `<b>` would take that gap instead of an ordinary word space. */
  const brand = `<span class="tk-i tk-brand"><i class="i i-flood"></i>
      <span>Klang Valley <b>Flood Watch</b></span><span class="tk-dot">•</span></span>`;

  const set = items.map((tile, i) => i % ADVISE_EVERY === 0 ? advise + tile : tile).join('') + brand;
  run.style.removeProperty('--dur');
  run.innerHTML = set;
  const one = run.scrollWidth;
  // items.length, not hot.length: a banner with no hot station still fills the strip and needs
  // a real pace. hot.length alone divides by zero on a banner-only poll.
  // The `+ 1` is the brand tile. MIN_TILES counts what is on the belt, and the brand is on it.
  const reps = Math.max(
    one > 0 ? Math.ceil(box.clientWidth / one) : 2,
    Math.ceil(MIN_TILES / (items.length + 1)),
  );

  run.innerHTML = set.repeat(reps * 2);
  // Floored: measured before the webfont lands, `scrollWidth` can come back tiny, and a near-zero
  // duration is a strip that flickers rather than scrolls. The next poll re-measures anyway.
  run.style.setProperty('--dur',
    `${Math.max(8, Math.round(one * reps / pace(items.length)))}s`);
}

// Delegated once: the strip is rebuilt on every poll and holds several copies of every station, so
// per-item listeners would be rebound in bulk for the life of the page.
el('ticker').onclick = e => {
  const t = byId(e.target.closest('[data-go]')?.dataset.go);
  if (t) flashTo(t);
};
