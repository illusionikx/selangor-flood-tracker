/* Test mode: a pretend flood, so the alert paths can be looked at on a calm day.
 *
 * Most of this app only shows its real face during weather that happens a few times a year — the
 * ticker cycling, the toast firing, the alert panel filling past its scroll, red pins clustering,
 * the heatmap actually glowing. Waiting for a storm to find out that a panel overflows badly is not
 * a testing strategy. This fills the map with alerts on demand.
 *
 * It rewrites the *client's copy* of the payload after it is fetched and before anything renders.
 * Nothing is sent anywhere, nothing is written to the history db, and the next poll with the switch
 * off is clean data again — the fake never reaches disk, so it cannot pollute a trend.
 *
 * The one real hazard is someone leaving it on and believing what they see, so it is loud about
 * itself, and it does not survive a reload: a fixed badge over the map, a red-striped app bar, and `TEST` in the status chip. If you
 * can see a fake alert you can see that it is fake.
 */

import { state } from './state.js';

// Deterministic, not random: the same stations light up every time, so "does the panel scroll right
// at 40 alerts" is a question you can ask twice and get the same answer to.
const EVERY = 4;          // every Nth eligible river is pushed over its danger mark
const RISE_EVERY = 3;     // and every Nth of the rest is made to climb towards it
const RAIN_EVERY = 5;     // every Nth rain gauge is made to rain
const OFFLINE_EVERY = 11; // and every Nth station of any kind is knocked off the network

/* Rain falls as a storm cell over central KL, not as a stripe of every class in station order.
   Cycling the four intensities by index put violent rain next to light rain the length of the
   state, which is not weather — and it made the rainfall heatmap look broken in exactly the way a
   real bug does, because one violent gauge's blob covers its light neighbours. Intensity now falls
   off with distance, so the fake reads as a cell and the heat ramp has a shape to draw.
   Bands are km from the centre → mm in the last hour, one per JPS class, so all four still appear
   and the popup still gets all four wordings. Past the last band it is dry: a cell with no edge is
   a wet state, and the point is to see the gradient. */
const STORM = [3.14, 101.69];                                 // central KL
const STORM_BANDS = [[10, 75], [20, 42], [35, 18], [55, 4]];  // ≤ km → mm/h

export function seedTest(data) {
  let rivers = 0, sirens = 0, rains = 0, offline = 0;

  /* Knock stations off the network first, not last. Every branch below requires `s.online`, so an
     offlined station simply falls through and stays offline — which means the two fakes can never
     land on the same station, with no bookkeeping to track which ones the flood already claimed.
     Worth faking at all because "offline" is a whole rendering path — grey pins, the OFFLINE block,
     `NOT CURRENT` in the panel — that otherwise only appears on stations that happen to be down. */
  for (const s of data) if (++offline % OFFLINE_EVERY === 0) s.online = false;

  for (const s of data) {
    if (s.kind === 'river') {
      const mark = s.danger ?? s.warning ?? s.alert;
      if (mark == null || !s.online) continue;
      rivers++;
      if (rivers % EVERY === 0) {
        // Already over: status 3 is what the popup, pin colour and alert panel all key off.
        s.level = +(mark * 1.04).toFixed(2);
        s.status = 3;
        s.rate = 0.22; s.eta = 0; s.rising = true;
      } else if (rivers % RISE_EVERY === 0) {
        /* Climbing, not yet there — the case `rising` exists for, and the one worth eyeballing.
           The rate is derived from a target ETA rather than fixed, because a fixed m/h means the
           flag depends on how big the river is: 0.35 m/h reaches a 0.9 m drain in half an hour and
           a 6 m river in seventeen, so a flat rate lit up 8 of 26 and left the rest silently
           climbing. Spreading the target over 0.5–2.5 h also gives the ticker and the panel a range
           of countdowns to render instead of one repeated number. */
        s.level = +(mark * 0.82).toFixed(2);
        s.status = Math.max(s.status || 0, 1);
        s.eta = 0.5 + (rivers % 5) * 0.5;
        s.rate = +((mark - s.level) / s.eta).toFixed(2);
        s.rising = true;
      } else continue;
      s.ratio = mark ? Math.min(1, s.level / mark) : s.ratio;
      // A flat line under a station claiming to climb is the sort of detail that makes a screenshot
      // useless, so the sparkline gets a matching ramp: half a day, rising into the current reading.
      s.history = Array.from({ length: 24 }, (_, i) => [
        Math.floor(Date.now() / 1000) - (23 - i) * 1800,
        +(s.level - (23 - i) * (s.rate / 2)).toFixed(2),
      ]);
    } else if (s.kind === 'rainfall' && s.online && ++rains % RAIN_EVERY === 0) {
      const km = Math.hypot((s.lng - STORM[1]) * Math.cos(s.lat * Math.PI / 180),
                            s.lat - STORM[0]) * 111;
      const mm = STORM_BANDS.find(([r]) => km <= r)?.[1];
      if (!mm) continue;   // outside the cell — this one stays dry
      s.hourly = mm;
      s.daily = +(mm * 3.5).toFixed(1);
      // The same cutoffs rainStatus() applies server-side. Set rather than derived because the
      // client never recomputes a status — the pin colour, the popup's band and the heat weight all
      // read this one field, so a fake that only moved `hourly` would contradict itself.
      s.status = mm > 60 ? 4 : mm > 30 ? 3 : mm > 10 ? 2 : 1;
      // Hourly buckets, building into the current reading: rainfall is an interval quantity, so its
      // graph is bars over RAIN_BUCKET, and a flat set of identical bars would tell us nothing about
      // whether the bars line up with the axis.
      s.history = Array.from({ length: 12 }, (_, i) => [
        Math.floor(Date.now() / 1000) - (11 - i) * 3600,
        +(mm * (0.2 + 0.8 * (i / 11))).toFixed(1),
      ]);
    } else if (s.kind === 'siren' && s.online && ++sirens % 9 === 0) {
      s.status = 1;
    }
  }
}

/* Everything that says "this is not real". Deliberately more than one signal: a single badge is a
   thing you stop seeing after ten minutes, and mistaking a drill for a flood is the worst failure
   this app could have. */
export function paintTestChrome() {
  document.body.classList.toggle('testmode', state.test);
}

// Rendered once and left in the DOM; CSS shows it only while `body.testmode`.
document.body.insertAdjacentHTML('beforeend',
  `<div id="testbadge"><i class="i i-warning"></i><b>TEST MODE</b>
     <span>every alert on this map is fake</span>
     <button id="testOff">Turn off</button></div>`);

export const stationsFaked = () => state.data.filter(s => s.rising || s.status >= 3).length;
