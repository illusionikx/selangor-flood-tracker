// Small pure helpers plus the rules for "does this station actually know anything".

import { KINDS, KIND_RANK, RIVER_COLOR, RAIN_COLOR, STATUS_COLOR, GAUGE_COLOR, NO_INFO,
         LEVEL_FLOOR } from './config.js';
import { PREFS } from './state.js';

export const el  = id => document.getElementById(id);

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
  if (s.kind === 'rainfall') return RAIN_COLOR[s.status]  || KINDS.rainfall.color;
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

// Is this station the reason someone opens the map at all: a river at danger, or a siren sounding.
export const isCritical = s =>
  (s.kind === 'river' && s.status >= 3) || (s.kind === 'siren' && s.status > 0);

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
  siren:    s.status > 0,
  gauge:    gaugeTone(s) === 3,
  rainfall: s.status >= 4,
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
export const tier = s => !isHot(s) ? null
  : isStale(s)   ? 'stale'
  : isCritical(s) ? 'now'
                  : 'soon';

// Worst first. Stale sorts last everywhere: it is the one tier you cannot act on.
// The tier *colours* live in CSS, keyed off `.t-now` / `.t-soon` / `.t-stale`, so light and dark
// can differ without a second palette in here.
export const TIER_RANK = { now: 0, soon: 1, stale: 2 };

/* Which sensor speaks for a mast when several share one — trouble first, then the standing rank in
   config.js. Lives here rather than in render.js because the table needs the same order and a view
   importing another view would put a cycle in the graph. */
export const leads = (a, b) =>
  atDanger(b) - atDanger(a) || !!b.rising - !!a.rising ||
  KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind);
