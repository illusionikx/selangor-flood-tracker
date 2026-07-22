// Small pure helpers plus the rules for "does this station actually know anything".

import { KINDS, KIND_RANK, RIVER_COLOR, RAIN_COLOR, STATUS_COLOR, NO_INFO } from './config.js';

export const el  = id => document.getElementById(id);

// Filter key for a district. State-qualified because the names collide: Kuala Lumpur has a Gombak
// constituency and Selangor has a Gombak district, and hiding one must not hide the other.
export const dkey = s => `${s.state || '—'}|${s.district || 'Unknown'}`;
export const num = (v, u) => (v === null || v === undefined) ? '—' : v + u;

export const parseMY = t => {                // "21/07/2026 17:45:00" → Date
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)/.exec(t || '');
  return m ? new Date(m[3], m[2] - 1, m[1], m[4], m[5]) : null;
};

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

// Is this station the reason someone opens the map at all: a river at danger, or a siren sounding.
export const isCritical = s =>
  (s.kind === 'river' && s.status >= 3) || (s.kind === 'siren' && s.status > 0);

/* Which sensor speaks for a mast when several share one — trouble first, then the standing rank in
   config.js. Lives here rather than in render.js because the table needs the same order and a view
   importing another view would put a cycle in the graph. */
export const leads = (a, b) =>
  isCritical(b) - isCritical(a) || !!b.rising - !!a.rising ||
  KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind);
