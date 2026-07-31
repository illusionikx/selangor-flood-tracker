// Queries over the current station set.

import { state } from './state.js';
import { distKm, hasInfo } from './util.js';
import { CAM_MAX_KM } from './config.js';

// Nearest station of one kind that is actually reporting something.
export const nearestOf = (kind, from) => state.data.reduce((best, s) =>
  s.kind === kind && hasInfo(s) && (!best || distKm(from, s) < distKm(from, best)) ? s : best, null);

/* The cap lives here and nowhere else. camNear(), camLink() and the "you are here" card all call
   this, so one number keeps the three surfaces saying the same thing. Past the cap the callers
   already have the right words: "no camera nearby". */
export const nearestCam = from => state.data.reduce((best, c) =>
  c.kind === 'camera' && c.image && c.online && distKm(from, c) <= CAM_MAX_KM &&
  (!best || distKm(from, c) < distKm(from, best)) ? c : best, null);

export const byId = id => state.data.find(s => s.id === id);
