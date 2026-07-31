// Queries over the current station set.

import { state } from './state.js';
import { distKm, hasInfo, isHot, isIgnored, tier, TIER_RANK } from './util.js';
import { CAM_MAX_KM, CAM_ALERT_KM } from './config.js';

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

/* The worst alert within CAM_ALERT_KM of a camera, or null. Distance breaks a tie between two of
   the same tier.
   `stale` is excluded rather than ranked last. A stale alert stays in the panel, where a sentence
   explains that the telemetry died and the situation may have changed either way. A colored glyph
   on a photograph has no room for that sentence, and a warning nobody can qualify is the wrong
   claim to put on a picture.
   isIgnored() is applied here, not by the callers. PREFS.ignored is the one alarm-suppression
   control in this app and it already holds past the district filter, on the ticker and on the
   toast. This is a sixth surface and it obeys the same rule. */
export const camAlert = cam => state.data.reduce((best, s) => {
  if (!isHot(s) || isIgnored(s)) return best;
  const t = tier(s);
  if (t === 'stale') return best;
  const km = distKm(cam, s);
  if (km > CAM_ALERT_KM) return best;
  return !best || TIER_RANK[t] < TIER_RANK[best.tier] || (t === best.tier && km < best.km)
    ? { tier: t, station: s, km } : best;
}, null);
