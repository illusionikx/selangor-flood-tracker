// Small pure helpers plus the rules for "does this station actually know anything".

import { KINDS, KIND_RANK, RIVER_COLOR, RAIN_COLOR, STATUS_COLOR, GAUGE_COLOR, NO_INFO,
         LEVEL_FLOOR } from './config.js';
import { PREFS } from './state.js';

export const el  = id => document.getElementById(id);

/* **M3's snackbar, and it replaced `#devMsg`.** That was a muted line under the buttons, inside a
   pane that scrolls. So the answer to a press could sit below the fold while the reader watched the
   button. A snackbar reports at the foot of the screen, whatever the pane is showing.
   **It is a `popover`.** The dialog it reports on is modal, so it is in the top layer, and no
   `z-index` reaches over that. `manual`, so a press anywhere else does not dismiss it.
   **One timer, cleared on every call.** Two messages in a row otherwise share the first one's clock,
   and the second vanishes early. `SNACK_MS` is M3's own short duration for a message with no
   action to take.
   **`togglePopover()`, never `showPopover()`/`hidePopover()`.** Both of those THROW rather than do
   nothing when the popover is already in the state they ask for: `hidePopover()` on a closed one
   raises `InvalidStateError`, and `showPopover()` on an open one does the same. The first version
   called `hidePopover()` first, to restart the enter animation, and every single call threw on the
   first line. So the snackbar never drew once, and nothing said so — the throw landed inside a
   handler with no surface. `togglePopover(force)` is the idempotent pair.
   The restart went with it. A second message replaces the text and resets the clock, and the
   messages this app raises are seconds apart.
   **It lives here rather than in js/ui.js, because js/locate.js raises one too.** That module is
   imported BY ui.js, so it cannot import it back. This file is the one both already reach. */
export const SNACK_MS = 4000;
let snackAt = 0;
export function snack(msg) {
  const b = el('snack');
  b.textContent = msg;
  clearTimeout(snackAt);
  b.togglePopover(true);
  snackAt = setTimeout(() => b.togglePopover(false), SNACK_MS);
}
/* **Set a radio and mirror the answer onto the chip around it, because `:has()` will not.** Chromium
   does not restyle a `:has(input:checked)` subject when a SCRIPT changes that checkedness. Measured:
   `matches()` answers true and `getComputedStyle` still hands back the unchecked value. Every box in
   this app is written by script — `PREFS` is the source of truth and no control carries a `checked`
   attribute — so a page that lands with a filter on drew the chip looking off.
   The class is written FROM the preference, the same direction the box is, so this adds no second
   source of truth. `.chip.on` sits beside `.chip:has(input:checked)` in css/base.css, and the second
   half is what still answers a real pointer press with no script involved. */
export const setBox = (id, on) => {
  const b = el(id);
  if (!b) return;
  b.checked = on;
  b.closest('.chip')?.classList.toggle('on', on);
};

/* Sensors the user has switched off one at a time, by station id.
 *
 * Not the same thing as the district filter, and it is applied in more places. Hiding a district is
 * a view — "I only care about Klang tonight" — so the ticker and the toast deliberately ignore it,
 * because tidying the map is not consent to be told less about a river reaching its danger mark.
 * Ignoring *one named sensor* is exactly that consent, given deliberately about that sensor, so it
 * holds everywhere: map, heat, alert panel, ticker and toast.
 *
 * An id that is no longer in the payload stays in the list harmlessly — the feeds drop and restore
 * stations, and forgetting the setting the one poll a station went missing would silently un-ignore
 * it. Nothing lists it while it is gone, because the list is drawn from state.data.
 */
export const ignoredIds = () => new Set(PREFS.ignored || []);
export const isIgnored = s => (PREFS.ignored || []).includes(s.id);

/* Sensors the reader has starred, by station id. The mirror of `ignoredIds()` above, stored the same
   way and for the same reason: an id that drops out of the payload for one poll must not be
   forgotten, because the feeds add and drop stations all the time.
 *
 * A sensor is never in both lists. `setFavs()` and `setIgnored()` in ui.js each drop the id from the
 * other, because "show me this first" and "never show me this" is not a state a person meant to be
 * in — and if the code picked a winner at read time, one of the two controls would silently do
 * nothing.
 *
 * Favorites are **not** an alarm control. They order lists and they filter the map. They suppress
 * nothing. `PREFS.ignored` stays the one suppression control in this app. */
export const favIds = () => new Set(PREFS.favs || []);
export const isFav = s => (PREFS.favs || []).includes(s.id);

// Filter key for a district. State-qualified because the names collide: Kuala Lumpur has a Gombak
// constituency and Selangor has a Gombak district, and hiding one must not hide the other.
export const dkey = s => `${s.state || '—'}|${s.district || 'Unknown'}`;
export const num = (v, u) => (v === null || v === undefined) ? '—' : v + u;

/* Text from an upstream, on its way into a template string.
   Every other string this app interpolates is one of ours: a station name from JPS, a number, a
   word out of a table in config.js. A MET warning is the first free prose we render, written by a
   department that owns its own publishing and never promised us any escaping. It happens to send
   entities today. That is an upstream choice, not a contract, and it can change without telling us.
   The service worker on this origin makes the cost of being wrong higher than the cost of the call,
   so warning text goes through here at every site that renders it. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* A place name as a title. JPS publishes one in capitals, and the national portal publishes the
   same place in Title Case, so the payload already spells one station two ways and a title has to
   pick one. `text-transform` cannot do this: `capitalize` raises a first letter and leaves the rest
   of the word as it found it, so capitals stay capitals.

   **An acronym is kept, and three tests find one, each measured against the live payload.**
   A token holding a digit is a code rather than a word: `F2`, `B27`, `FT29`, `KM11`, `BT.14`.
   A stop INSIDE a token marks an acronym written with stops: `T.K.P.M`, `S.J.K.C`, `J.P.S`.
   A token with no vowel is an acronym written without them: `SMK`, `KTM`, `LRT`, `TNB`, `PWTC`.

   **The exception is eight Malay place words, and the data is why they are the exception.** They
   are abbreviations of a word rather than initials of a name, and the portal's own Title Case rows
   already write them `Kg.` and `Sg.`. They are also most of what the vowel test catches: `KG` and
   `SG` alone are 316 of the 380 vowel-less tokens in the payload. Measured 2026-08-20.

   The first pass splits `SG.PELEK`, which JPS writes run together and elsewhere writes apart. Left
   whole, the stop inside it reads as an acronym and the name stays in capitals.

   Three names of 630 come out wrong, all the same shape: an acronym that holds a vowel, so no test
   here can see it. They are `USJ`, `REM` and `PRAB`. A list of them is a list somebody maintains,
   and the cost of being wrong is one word of a station name in Title Case. */
const ABBR = /^(KG|SG|JLN|BT|TMN|TG|BKT|KM)\.?$/i;
const acronym = w => /\d/.test(w) || /\.\S/.test(w) || !/[AEIOU]/i.test(w);
const cap = w => w[0].toUpperCase() + w.slice(1).toLowerCase();
export const titleCase = s => String(s ?? '')
  .replace(/\b(KG|SG|JLN|BT|TMN|TG|BKT|KM)\.(?=[A-Za-z])/gi, '$1. ')
  .replace(/[^\s,\/()-]+/g, w => acronym(w) && !ABBR.test(w) ? w : cap(w));

export const parseMY = t => {                // "21/07/2026 17:45:00" → Date
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)/.exec(t || '');
  return m ? new Date(m[3], m[2] - 1, m[1], m[4], m[5]) : null;
};

// JPS stamps to the second, but publishes on a 15-minute slot — the `:05` is noise, and it is noise
// that pushes a footer onto two lines on a phone. Trims the seconds off a printed MYT stamp only;
// nothing parses the result, so the underlying string stays verbatim for parseMY().
export const noSec = t => (t || '').replace(/(\d\d:\d\d):\d\d/, '$1');

export const ago = t => {
  const s = Math.max(0, (Date.now() - new Date(t)) / 1000);
  return s < 90 ? `${s | 0}s ago` : s < 5400 ? `${s / 60 | 0}m ago` : `${(s / 3600).toFixed(1)}h ago`;
};

// Equirectangular is plenty at Selangor scale and avoids a trig-heavy haversine.
export const distKm = (a, b) =>
  Math.hypot((a.lng - b.lng) * Math.cos(a.lat * Math.PI / 180), a.lat - b.lat) * 111;

export const statusColor = n => STATUS_COLOR[Math.max(0, Math.min(3, n))] ?? STATUS_COLOR[0];

/* Thresholds bunch up near the top (alert 4.4, warning 4.7, danger 5 on a 0–5 bar all land past
   88%), so the scale is piecewise instead of linear: each threshold gets a fixed slot and the long
   safe stretch below the first one is compressed into the opening 38%. */
export function scalePos(v, stops) {
  if (v <= stops[0][0]) return 0;
  for (let i = 1; i < stops.length; i++) {
    const [v0, p0] = stops[i - 1], [v1, p1] = stops[i];
    if (v <= v1) return p0 + (v - v0) / (v1 - v0 || 1) * (p1 - p0);
  }
  return 100;
}

/* The stops themselves, shared by the popup meter, the table bar and the heat weight. One
   definition, because they are all the same scale: a blob's colour is the band the station has
   crossed, so the meter's 38 / 68 / 100 slots have to be the numbers the gradient is keyed on. Null
   where there is no mark at all to measure against.

   The bar does *not* start at zero metres. Most of these stations read against an absolute datum —
   SERENDAH alerts at 35.80 m and sits at 34.06 — so a scale from 0 spent its whole safe stretch on
   metres the river never visits, and every calm station on such a datum drew a bar hard against the
   alert tick that never visibly moved. The only unit the feed gives us for "how far this river
   travels when it matters" is its own alert→danger gap, so the foot of the bar is `LEVEL_FLOOR`
   gaps below the first mark. Anything under that reads 0, which is the honest answer: well below.
   Stations on a bed datum (alert 2.40, danger 3.00) floor out negative and keep the old behaviour. */
export function levelStops(s) {
  const max = s.danger || s.warning || s.alert;
  if (!max) return null;
  const first = s.alert || s.warning || max;
  const gap = max - first;
  const stops = [[gap > 0 ? first - gap * LEVEL_FLOOR : 0, 0]];
  if (s.alert   && s.alert   < max) stops.push([s.alert, 38]);
  if (s.warning && s.warning < max && s.warning > (s.alert ?? 0)) stops.push([s.warning, 68]);
  stops.push([max, 100]);
  return stops;
}

// A gauge has no alert mark — only warning and danger — so it sits on the same slots minus the first.
export const gaugeStops = s => [[0, 0], [s.warning || 0.15, 68], [s.danger || 0.3, 100]];

/* Where a flood gauge sits on the traffic light. Upstream publishes three codes against its own two
   marks (0.15 m warning, 0.3 m danger), so any water shallower than 0.15 m shared code 0 with dry
   ground — and a spot with water standing on it painted the same quiet taupe as a spot with none.
   Water over a place known to flood is never the normal state, so it takes the alert rung at least,
   and the two published marks move up to warning and danger. Dry ground alone keeps 0.
   One definition for the pin, the card, the table cell and the table's hover panel. */
export const gaugeTone = s => s.depth == null || s.depth <= 0 ? 0
  : s.status >= 2 ? 3
  : s.status >= 1 ? 2 : 1;

// The colour that goes with it. Not `statusColor()` — a gauge's rung 1 is `--s-trace`, not the
// alert amber, because upstream never published a mark down there. See GAUGE_COLOR in config.js.
export const gaugeColor = s => GAUGE_COLOR[gaugeTone(s)];

/* The weather section is all or nothing — see metSection() in popup.js for why a half-drawn outlook
   costs a reader more than the temperature is worth. The rule sits here because two callers ask it:
   the section itself, and nearestWx(), which must not pick a station the section will then refuse to
   draw while a neighbour a kilometre further carries the whole outlook. */
export const hasWx = m => !!m && m.now != null && m.hr1 != null && m.tmax != null && m.tmin != null;

// A station with nothing to report gets grey everywhere — colour means "there is a reading here".
export const hasInfo = s => s.online && ({
  river:    s.level != null,
  rainfall: s.hourly != null,
  siren:    s.status != null,
  gauge:    s.depth != null,
  camera:   !!s.image,
}[s.kind] ?? false);

export function color(s) {
  if (!hasInfo(s)) return NO_INFO;
  if (s.kind === 'river')    return RIVER_COLOR[s.status] || KINDS.river.color;
  // A gauge whose own total denies its reading is painted as a gauge reporting nothing, the way a
  // siren that is not sounding drops back to its kind colour on the line below.
  if (s.kind === 'rainfall') return RAIN_COLOR[raining(s) ? s.status : 0] || KINDS.rainfall.color;
  if (s.kind === 'siren')    return s.status > 0 ? statusColor(3) : KINDS.siren.color;   // red only when sounding
  // Taupe only while the ground is dry. Any depth at all is a status, and wears a status colour.
  if (s.kind === 'gauge')    return gaugeTone(s) ? gaugeColor(s) : KINDS.gauge.color;
  return KINDS[s.kind].color;
}

/* `ink()` lived here: black or white, whichever stayed legible on a given pin fill, picked by
   relative luminance. Two things deleted it. Only one pin is filled now — the mast — and its glyph
   is `var(--surface)`, which is white on the light theme and near-black on the dark one, i.e. the
   answer this used to compute, from the token that already knows it. And the palette is `var()`
   references now, so there is no hex here to measure. */

/* Is this siren actually sounding? A siren has no scale: it reads 0 or 1, and until now 1 was taken
   at face value. It cannot be. Our own archive holds one that read 1 for 127 hours straight while
   the river on the same spot sat 2 metres below its Amaran mark, and 15 of the 17 alarms on record
   have no river anywhere near them up at all. Believing them put the app bar's glyph red every day
   of the week, which is the cry-wolf failure the alert design standard names outright.
   JPS publishes the rule: a siren sounds for a minute at Amaran and repeats every 3 hours while the
   water stays there, and at Bahaya every 5. So the alarm is a claim about a river level we already
   hold, and `backed` in api.php is that river answering — one definition, server-side, like
   `rising`. The client reads the flag and never re-derives it.
   `!== false`, not truthiness: `null` is "no river within 5 km to ask", and a siren nobody can check
   keeps the benefit of the doubt. Silencing a real evacuation alarm is the worse of the two errors.
   Both reds read this, the alert path's and the map's: a pin painted red off a siren the alert panel
   refuses to list is the map contradicting the panel, and one of them is wrong on screen. */
export const sounding = s => s.kind === 'siren' && s.status > 0 && s.backed !== false;

/* Is this gauge actually catching rain? The same question as `sounding()` and the same answer, on a
   different sensor. `hourlyRainfall` is a rolling one hour total and `cumulativeRainfall` only
   climbs, so rain the first claims has to show in the second — and `rainBacked()` in api.php asks
   exactly that, over the one hour the reading names. The client reads the flag and never re-derives
   it, the same rule `rising` and a siren's `backed` obey.
   `!== false` again: `null` is "the archive cannot reach back an hour", which covers every KL gauge,
   since only Selangor publishes an odometer. A gauge nobody can check keeps its reading.
   Measured 2026-08-14, 4 of the 25 live gauges with enough archive to ask were claiming rain their
   own total denied. One had held 4.5 mm for twelve hours against an odometer that never moved. */
export const raining = s => s.kind === 'rainfall' && s.hourly > 0 && s.backed !== false;

/* Is this station the reason someone opens the map at all: a river at danger, a siren sounding, or
   rain in JPS's heavy class and above.
   Rain joined on the repository owner's instruction, 2026-08-25. It is class 3 (> 30 mm an hour) and
   not class 4, because class 4 is > 60 and this network reaches it a handful of times a year.
   `raining()` and not `status` alone, the same guard `sounding()` carries: a gauge stuck on an old
   number must not raise five surfaces. */
export const isCritical = s => (s.kind === 'river' && s.status >= 3) || sounding(s)
  || (raining(s) && s.status >= 3);

/* Has this sensor reached the top of its own scale — whatever its own scale is? A river over its
   danger mark, a siren sounding, a flood gauge past 0.3 m of standing water, rainfall in JPS's top
   class. This is what the **map** paints red, and it is deliberately wider than `isCritical()`.
   A pin has to be red whenever anything at that place is at its worst, and a mast whose lead sensor
   is a quiet river used to draw blue over a flood gauge under water beside it. `isCritical()` stays
   narrow because it feeds `isHot()`, and through it the alert panel, the icon badge, the ticker and
   the toast. Widening those is an alert-design decision and goes through the standard in
   docs/FEATURES.md — this is a colour on a map, which is a different claim. */
export const atDanger = s => hasInfo(s) && ({
  river:    s.status >= 3,
  siren:    sounding(s),
  gauge:    gaugeTone(s) === 3,
  // `raining()` and not `status` alone, for the reason the siren line above it carries: the top
  // class paints a pin red and puts a warning on a camera, and a stuck field must not do either.
  rainfall: raining(s) && s.status >= 4,
}[s.kind] ?? false);

/* What the "On alert" panel lists — critical, plus rivers forecast to reach danger within RISE_ETA.
   Lives here so the panel and the toast cannot drift apart: a toast announcing something the panel
   then doesn't list would be worse than no toast. */
export const isHot = s => isCritical(s) || (s.kind === 'river' && s.rising);

/* Is the reading behind an alert still current? Offline, or stamped more than a day ago — exactly
   the rule the popups already draw `NOT CURRENT` from, shared so the two can never disagree about
   whether the same station is trustworthy. (`parseMY` builds the date from MYT components in local
   time; a viewer far from MYT is off by their offset, which a 24h window absorbs.) */
export const isStale = s => {
  if (!s.online) return true;
  const when = parseMY(s.updated);
  return !!when && Date.now() - when > 864e5;
};

/* The three things we currently call "an alert", separated.
 *
 * CAP splits certainty from urgency, and lumping them is the failure ISA-18.2 names: when every
 * alarm looks equally urgent, the operator learns to ignore all of them. `now` is observed and
 * happening; `soon` is a forecast that may not come true; `stale` is a claim we can no longer stand
 * behind.
 *
 * `stale` is deliberately still an alert. A river sitting at its danger mark whose telemetry dies
 * is the last thing that should quietly vanish from the list — silence rendered as safety. So it
 * stays visible, drops out of the counts and the heat, and says why.
 */
/* `heavy` is the fourth rung, added 2026-08-25 with heavy rain. It is the SEVERITY axis, which the
   other three do not carry: they split certainty and urgency alone. Four gauges at 38 mm an hour and
   a river over its danger mark are both observed and both immediate. They are not the same claim,
   and one red said they were.
   It sits above `soon` because it is observed and a forecast is not. It sits under `now` because
   class 3 is not the top of the rain scale — `atDanger()` still reads class 4, and a class 3 gauge
   keeps its violet pin. So the rung and the map agree.
   The test comes BEFORE `isCritical()`, which already answers true for a class 3 gauge.
   Rain is its only occupant and the tag names it. Do not widen it to another kind without a rung
   name that covers both, and without the alert design standard. */
export const tier = s => !isHot(s) ? null
  : isStale(s)   ? 'stale'
  : s.kind === 'rainfall' && s.status === 3 ? 'heavy'
  : isCritical(s) ? 'now'
                  : 'soon';

/* Worst first. Stale sorts last everywhere: it is the one tier you cannot act on.
   The tier *colours* live in CSS, keyed off `.t-now` / `.t-heavy` / `.t-soon` / `.t-stale`, so light
   and dark can differ without a second palette in here.
   `heavy` outranks `soon` because it is observed. `heavy` and `soon` share `--s-warning`, and the
   tag word is what tells them apart. That is the same shape `now` already has, where one red covers
   a river at its mark and a sounding siren. */
export const TIER_RANK = { now: 0, heavy: 1, soon: 2, stale: 3 };

/* Which sensor speaks for a mast when several share one — trouble first, then the standing rank in
   config.js. Lives here rather than in render.js because the table needs the same order and a view
   importing another view would put a cycle in the graph. */
export const leads = (a, b) =>
  atDanger(b) - atDanger(a) || !!b.rising - !!a.rising ||
  KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind);

/* JPS writes one place as `I.K.B.N.`, `IKBN` and `I K B N`. Squashing reads all three as one word.
   Two callers now: the go-to box's matcher in js/ui.js, and the camera filter's haystack in
   js/wall.js. */
export const squash = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/* Split on whitespace *only*, then strip punctuation inside each word. Splitting the query on
   punctuation instead turned `I.K.B.N` into four single-letter terms and matched 294 stations. */
export const termsOf = q => q.trim().split(/\s+/).map(squash).filter(Boolean);
export const matches = (text, terms) => terms.every(t => text.includes(t));

/* MET and JPS stamp a validity window "2026-08-10T09:00:00", Malaysian wall clock with no offset —
   the same shape JPS uses on a reading, and the same trap. `new Date()` on a string with no offset
   reads it as the reader's own zone, so a viewer outside Malaysia sees the window slide by their
   offset. This rearranges the characters and does no time arithmetic at all, which is what `noSec()`
   does to a JPS stamp for the same reason. 24-hour, because every clock in this app is.
   It lives here rather than in ui.js because the notice list reads it too, and ui.js imports
   alerts.js — so the other direction is a cycle. */
export const warnWhen = s => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d:\d\d)/.exec(String(s || ''));
  // The fallback hands back whatever arrived. That is upstream text, so the caller escapes it. Only
  // strtotime() in sources.php keeps a hostile stamp out today, and that guard lives in another file.
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : String(s || '');
};
