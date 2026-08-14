// Queries over the current station set.

import { state } from './state.js';
import { distKm, hasInfo, hasWx, isHot, atDanger, isStale, isIgnored, tier, TIER_RANK } from './util.js';
import { CAM_MAX_KM, CAM_ALERT_KM } from './config.js';

// Nearest station of one kind that is actually reporting something.
export const nearestOf = (kind, from) => state.data.reduce((best, s) =>
  s.kind === kind && hasInfo(s) && (!best || distKm(from, s) < distKm(from, best)) ? s : best, null);

/* The cap lives here and nowhere else. camNear(), camLink() and the "you are here" card all call
   this, so one number keeps the three surfaces saying the same thing. Past the cap the callers
   print nothing. */
export const nearestCam = from => state.data.reduce((best, c) =>
  c.kind === 'camera' && c.image && c.online && distKm(from, c) <= CAM_MAX_KM &&
  (!best || distKm(from, c) < distKm(from, best)) ? c : best, null);

/* The mirror of nearestCam(): which water level is this camera standing near. Same cap, because it
   is the same question turned around — past 5 km "the river in this picture" stops being a claim
   this app can make, whichever end you ask it from. 45 of the 62 cameras that do not share a mast
   with a river keep a line; the other 17 print nothing, which is the same answer camLink() gives at
   the same distance. */
export const nearestLevel = from => {
  const s = nearestOf('river', from);
  return s && distKm(from, s) <= CAM_MAX_KM ? s : null;
};

/* Whose weather covers this point. `api.php` hangs the MET outlook on a station, so a point that is
   not a station has to borrow one — and the nearest station carrying a whole outlook is the closest
   this app can get to "the forecast here". No cap, the same way nearestOf() has none: the one caller
   applies NEAR_MAX_KM, so the cap stays beside the rows that state the same number. */
export const nearestWx = from => state.data.reduce((best, s) =>
  hasWx(s.met) && (!best || distKm(from, s) < distKm(from, best)) ? s : best, null);

export const byId = id => state.data.find(s => s.id === id);

/* The worst alert within CAM_ALERT_KM of a camera, or null. Distance breaks a tie between two of
   the same tier.
 *
 * `isHot()` **or** `atDanger()`, which is wider than every other alert surface here and deliberately
 * so. `isHot()` is rivers at danger, rivers forecast to reach it, and sounding sirens — the set the
 * panel, the badge, the ticker and the toast all draw from, and widening that set is an alert design
 * decision that goes through the standard in docs/FEATURES.md. This is not that. `atDanger()` asks
 * whether a sensor is at the top of its own scale, and it is already what paints a pin red on the
 * map. A camera two streets from a flood gauge under water sat beside a red pin and showed a clean
 * picture, which reads as the picture disagreeing with the map. So the pill answers the map's
 * question, not the panel's, and nothing about what alerts you has moved.
 *
 * Everything `atDanger()` adds is observed, so it is `now`. There is no forecast for standing water
 * or for rain that is falling: only a river publishes a rate, and `tier()` already says so.
 *
 * `stale` is excluded rather than ranked last. A stale alert stays in the panel, where a sentence
 * explains that the telemetry died and the situation may have changed either way. A colored glyph
 * on a photograph has no room for that sentence, and a warning nobody can qualify is the wrong
 * claim to put on a picture.
 *
 * isIgnored() is applied here, not by the callers. PREFS.ignored is the one alarm-suppression
 * control in this app and it already holds past the district filter, on the ticker and on the
 * toast. This is a sixth surface and it obeys the same rule. */
export const camAlert = cam => state.data.reduce((best, s) => {
  const hot = isHot(s);
  if ((!hot && !atDanger(s)) || isIgnored(s) || isStale(s)) return best;
  const t = hot ? tier(s) : 'now';
  const km = distKm(cam, s);
  if (km > CAM_ALERT_KM) return best;
  return !best || TIER_RANK[t] < TIER_RANK[best.tier] || (t === best.tier && km < best.km)
    ? { tier: t, station: s, km } : best;
}, null);
