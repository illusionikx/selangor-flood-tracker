// Queries over the current station set.

import { state } from './state.js';
import { distKm, hasInfo } from './util.js';

// Nearest station of one kind that is actually reporting something.
export const nearestOf = (kind, from) => state.data.reduce((best, s) =>
  s.kind === kind && hasInfo(s) && (!best || distKm(from, s) < distKm(from, best)) ? s : best, null);

export const nearestCam = from => state.data.reduce((best, c) =>
  c.kind === 'camera' && c.image && c.online && (!best || distKm(from, c) < distKm(from, best)) ? c : best, null);

export const byId = id => state.data.find(s => s.id === id);
