// Small pure helpers plus the rules for "does this station actually know anything".

import { KINDS, KIND_RANK, RIVER_COLOR, RAIN_COLOR, STATUS_COLOR, NO_INFO } from './config.js';
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

// Phones: as wide as the screen allows. Desktop: readings stay compact, stills get room.
export const popWidth = kind => innerWidth <= 600
  ? Math.max(220, innerWidth - 24)
  : kind === 'camera' ? 440 : 300;

// Phones: autoPan off — map.js keepPopupVisible() drops the popup's foot to just above the heat
// legend deterministically, which autoPan's fit-anywhere logic can't. Desktop keeps the padded pan.
export const popPan = () => innerWidth <= 600
  ? { autoPan: false }
  : { autoPanPaddingTopLeft: [16, 24], autoPanPaddingBottomRight: [16, 56] };

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

/* The stops themselves, shared by the popup meter and the heat weight. One definition, because they
   are now the same scale: a blob's colour is the band the station has crossed, so the meter's 38 /
   68 / 100 slots have to be the numbers the gradient is keyed on. Null where there is no mark at
   all to measure against. */
export function levelStops(s) {
  const max = s.danger || s.warning || s.alert;
  if (!max) return null;
  const stops = [[0, 0]];
  if (s.alert   && s.alert   < max) stops.push([s.alert, 38]);
  if (s.warning && s.warning < max && s.warning > (s.alert ?? 0)) stops.push([s.warning, 68]);
  stops.push([max, 100]);
  return stops;
}

// A gauge has no alert mark — only warning and danger — so it sits on the same slots minus the first.
export const gaugeStops = s => [[0, 0], [s.warning || 0.15, 68], [s.danger || 0.3, 100]];

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
  if (s.kind === 'siren')    return s.status > 0 ? '#ff4d4d' : KINDS.siren.color;   // red only when sounding
  if (s.kind === 'gauge')    return s.status >= 2 ? '#ff4d4d' : s.status === 1 ? '#ff9f1c' : KINDS.gauge.color;
  return KINDS[s.kind].color;
}

// Black or white, whichever stays legible on a given pin fill. No single glyph colour works across
// this palette — it runs from #3a3a6a (no rain) to #ffd166 (river alert) — and a pin whose icon you
// cannot read is a pin with no kind. WCAG relative luminance; white wins below .179, the crossover
// where contrast against white and against near-black are equal.
export function ink(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  const n = parseInt(h, 16);
  const lin = shift => {
    const c = (n >> shift & 255) / 255;
    return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  };
  return .2126 * lin(16) + .7152 * lin(8) + .0722 * lin(0) < .179 ? '#fff' : '#14181c';
}

// Is this station the reason someone opens the map at all: a river at danger, or a siren sounding.
export const isCritical = s =>
  (s.kind === 'river' && s.status >= 3) || (s.kind === 'siren' && s.status > 0);

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
  isCritical(b) - isCritical(a) || !!b.rising - !!a.rising ||
  KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind);
