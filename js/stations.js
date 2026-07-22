// Queries over the current station set.

import { state } from './state.js';
import { distKm, hasInfo } from './util.js';

// Nearest station of one kind that is actually reporting something.
export const nearestOf = (kind, from) => state.data.reduce((best, s) =>
  s.kind === kind && hasInfo(s) && (!best || distKm(from, s) < distKm(from, best)) ? s : best, null);

export const nearestCam = from => state.data.reduce((best, c) =>
  c.kind === 'camera' && c.image && c.online && (!best || distKm(from, c) < distKm(from, best)) ? c : best, null);

export const byId = id => state.data.find(s => s.id === id);

// What each kind is worth saying in one line.
export const oneLiner = s => ({
  river:    `${s.level} m · ${s.danger ? (s.level / s.danger * 100).toFixed(0) + '% of danger' : 'no danger mark'}`,
  rainfall: `${s.hourly} mm last hour · ${s.daily ?? '—'} mm today`,
  siren:    s.status > 0 ? 'TRIGGERED' : 'idle',
  gauge:    s.depth > 0 ? `${s.depth} m of water` : `dry (${Math.abs(s.depth)} m below marker)`,
}[s.kind] || '');
