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
const GAUGE_EVERY = 4;    // every Nth flood gauge goes under water
const WET_EVERY = 3;      // and every Nth of the rest gets the shallow rung, which has its own colour
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
const DROWN_MM = 45;   // what a gauge reports at a place already under water — see drown()
const DAY_X = 3.5;     // today's total, as a multiple of the hour under the cell

// Every Nth site holding both a camera and a river is pushed over the mark whatever the first pass
// decided — see the site pass at the foot of seedTest() for why the camera path needs its own knob.
const CAM_EVERY = 3;

/* Test mode fakes an outage too. Anything that alerts needs a knob here or it ships unseen, and this
   one is otherwise visible only while JPS is actually down — which is a few hours a year, and never
   when somebody is looking at the panel on purpose. The id must be a key of NOTICE in config.js. */
const TEST_NOTICE = { id: 'publicinfobanjir', regions: ['Kuala Lumpur', 'Putrajaya'] };

/* Every fake sample carries the status it was at, the third element real samples get from
   `sparkPoints()` in api.php. Without it the graph's hover readout printed a faked flood in plain
   ink, because the readout colours a sample by its own code and a two-element sample has none —
   so the one surface built to show a level crossing its mark was the one surface test mode could
   not show it on.
   These mirror `wlStatus()`, `gaugeStatus()` and `rainStatus()` in sources.php. They are copies,
   for the same reason the rainfall branch below already copies its cutoffs: nothing here reaches a
   server, so there is no scorer to ask. Real data is still scored server-side and never here. */
const wlCode = s => v => v >= (s.danger ?? Infinity) ? 3 : v >= (s.warning ?? Infinity) ? 2
  : v >= (s.alert ?? Infinity) ? 1 : 0;
const gaugeCode = s => v => v <= 0 ? 0 : v >= (s.danger ?? 0.3) ? 3
  : v >= (s.warning ?? 0.15) ? 2 : 1;
const rainCode = v => v > 60 ? 4 : v > 30 ? 3 : v > 10 ? 2 : v > 0 ? 1 : 0;

// Half a day of samples climbing into the current reading. A flat line under a station claiming to
// climb is the sort of detail that makes a screenshot useless.
const ramp = (now, step, code) => Array.from({ length: 24 }, (_, i) => {
  const v = +(now - (23 - i) * step).toFixed(2);
  return [Math.floor(Date.now() / 1000) - (23 - i) * 1800, v, code(v)];
});

/* Hourly buckets, building into the current reading: rainfall is an interval quantity, so its graph
   is bars over RAIN_BUCKET, and a flat set of identical bars would tell us nothing about whether the
   bars line up with the axis. */
const rainRamp = mm => Array.from({ length: 12 }, (_, i) => {
  const v = +(mm * (0.2 + 0.8 * (i / 11))).toFixed(1);
  return [Math.floor(Date.now() / 1000) - (11 - i) * 3600, v, rainCode(v)];
});

/* A number between 0 and 1 that belongs to one station and never moves. Deterministic for the same
   reason every knob above is: `seedTest()` runs on every poll, so anything drawn from `Math.random`
   would reshuffle each chart every five minutes and read as a bug rather than as weather.

   FNV-1a rather than the `h * 31 + c` one-liner, because that one does not avalanche: station ids
   run `rf-153`, `rf-154`, `rf-156`, so adjacent ids landed on adjacent values and twenty gauges in
   a row drew the same silhouette. A run of identical charts reads as a pattern, not as weather. */
const seed = id => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
};

/* One rain gauge reporting `mm` in the last hour, with everything that has to agree with it.
   Both callers come through here, so the hour, the day, the status, the graph and the accumulation
   chart cannot drift apart. They already had: `drown()` hard-coded a 158 mm day where the storm
   cell's own multiplier gives 157.5. */
function soak(s, mm) {
  s.hourly = mm;
  s.daily = +(mm * DAY_X).toFixed(1);
  /* The same cutoffs rainStatus() applies server-side. Set rather than derived because the client
     never recomputes a status — the pin colour, the popup's band and the heat weight all read this
     one field, so a fake that only moved `hourly` would contradict itself. */
  s.status = rainCode(mm);
  s.history = rainRamp(mm);
  s.acc = stormAcc(s, mm);
  /* The hour a short window starts from, which the chart names in its footnote and in the readout
     on the column. `reachOf()` decides how far back this station's records go, so the same number
     shapes the window and dates it — a footnote reading `Measured from 06:30` over a column marked
     `measured over 40 h` is the drift this whole function exists to stop. 80 h is past every
     window, so a station with a full archive states no short window and needs no date. */
  s.accFrom = Math.floor(Date.now() / 1000) - (reachOf(s) || 80) * 3600;
  /* Faked rain is rain the odometer saw. Without this the fake inherits whatever `rainBacked()`
     said about the real reading, so the four gauges measured stuck on 2026-08-14 would draw a storm
     cell that the card calls a faulty signal, with no pin colour and no heat blob under it. A fake
     that moves one field has to move every field read beside it, which is why this function exists
     at all — see `raining()` in util.js for what reads this one. */
  s.backed = true;
}

/* The five nested totals that hour would have left behind, so the accumulation chart agrees with
   the reading printed above it. Without this the card said `Last hour 75 mm` over a 1 h column
   holding whatever the real gauge reported, which is the contradiction `soak()` above exists to
   prevent.

   Shaped, not scaled. A violent cell is short: 75 mm in an hour held for three would be 225 mm, a
   once-in-decades total, while 4 mm/h of drizzle really does run all afternoon. So the 3 hour
   multiplier falls as the hour gets heavier. The two long windows are the day plus the night before
   it, and then two more days of monsoon behind that.

   This shape is chosen to look like weather. It is not a claim about weather, and it is allowed to
   be invented here for the one reason the threshold marks were not: nothing in test mode reaches a
   server, a history file or another reader.

   `derived` and the measured span are faked too. Both appear on real data only once the odometer
   has filled, so without a knob here the asterisk and its footnote ship unseen — the same rule the
   flood gauge's shallow rung follows below. KL publishes no 3 hour total, so a KL gauge carries the
   asterisk on that column that a summed one really would. */
function stormAcc(s, mm) {
  /* How wet the days before this one were, which is the one thing that does NOT follow from the
     hour on the gauge. A station can read 4 mm now after a soaking week, or 75 mm in the first
     hour of a dry month. Scaling the long windows off the hour alone gave every faked gauge the
     same silhouette, so the chart could not be looked at against the two cases it exists to tell
     apart: a flash burst, and a week of monsoon with a shower on top. */
  const t = seed(s.id || '');
  const reach = reachOf(s);
  const h3  = +(mm * (1.3 + 1.4 * Math.exp(-mm / 25))).toFixed(1);
  const day = +(mm * DAY_X).toFixed(1);
  const h24 = +(day * (1.05 + 0.40 * t)).toFixed(1);
  const h72 = +(h24 * (1.15 + 0.80 * t)).toFixed(1);
  /* Rain over `h` hours of records, interpolated between the two windows that hour falls between.
     Interpolated rather than scaled, because a window covering 40 of its 72 hours measured the rain
     in those 40 — so it sits between the neighbouring totals rather than at a fraction of one. */
  const over = h => h <= 24 ? +(h3 + (h24 - h3) * ((h - 3) / 21)).toFixed(1)
                            : +(h24 + (h72 - h24) * ((h - 24) / 48)).toFixed(1);
  return {
    h1:  [+mm.toFixed(1), 0, null],
    h3:  [h3, s.source === 'kl' ? 1 : 0, null],
    day: [day, 0, null],
    /* Three states across the station set, because all three are real and two of them were invisible
       in test mode. `reachOf()` picks which one a station is in.
       An archive past every window: both totals whole, spans a few minutes wide of the name, because
       a server polling every five minutes lands a baseline close to the far end.
       An archive between the two windows: 24 h whole, 72 h short.
       An archive inside both: BOTH short, both anchored on the same earliest record, so both draw one
       number over one span. That is the state a young archive is in, and it is what the remark under
       the chart exists to explain — see the pair of assertions in api.php that keep it. */
    h24: reach && reach < 24 ? [over(reach), 2, reach]
                             : [h24, 1, +(24.1 + t * 0.6).toFixed(1)],
    h72: reach ? [over(reach), 2, reach]
               : [h72, 1, +(72.1 + t * 0.8).toFixed(1)],
  };
}

/* How far back a faked archive reaches, in hours, or 0 where it reaches past every window. ONE
   number per station, because both long windows subtract from the same oldest sample and `accFrom`
   has to agree with both of them. A station whose records start 40 h back has a whole 24 hour window
   and a short 72 hour one. A station whose records start 18 h back has two short windows holding one
   number, which is what a real box draws for its first two days.
   Never between 22 and 26: a reach either side of 24 puts the fake in one of the two states cleanly,
   and a value at the boundary makes the 24 hour window's own span ambiguous for no gain. */
const reachOf = s => {
  const t = seed(s.id || '');
  return t < 0.25 ? +(12 + t * 40).toFixed(1)              // inside both windows
       : t < 0.55 ? +(26 + (t - 0.25) * 60).toFixed(1)     // between them
       : 0;                                                // past both
};

// One sensor, pushed to the worst its own kind can report. Used by the first pass on rivers and by
// the site pass on everything else at a place that is already under water.
function drown(s) {
  if (!s.online) return false;
  if (s.kind === 'river') {
    const mark = s.danger ?? s.warning ?? s.alert;
    if (mark == null) return false;
    // Already over: status 3 is what the popup, pin colour and alert panel all key off.
    s.level = +(mark * 1.04).toFixed(2);
    s.status = 3;
    s.rate = 0.22; s.eta = 0; s.rising = true;
    s.ratio = 1;
    s.history = ramp(s.level, s.rate / 2, wlCode(s));
  } else if (s.kind === 'rainfall') {
    // Heavy, not very heavy: the top class belongs to the middle of the storm cell, and a mast that
    // happens to sit under a flooding river is not automatically the worst of the weather. A gauge
    // already inside the cell keeps what the cell gave it — this may only ever raise a reading.
    if ((s.hourly ?? 0) >= DROWN_MM) return true;
    soak(s, DROWN_MM);
  } else if (s.kind === 'gauge') {
    const mark = s.danger ?? 0.3;
    s.depth = +(mark * 1.2).toFixed(2);
    s.status = 2;
    s.history = ramp(s.depth, mark / 40, gaugeCode(s));
  } else if (s.kind === 'siren') {
    s.status = 1;
    s.history = Array.from({ length: 12 }, (_, i) => [
      Math.floor(Date.now() / 1000) - (11 - i) * 1800, i > 8 ? 1 : 0,
    ]);
  } else return false;   // a camera has nothing of its own to fake — see the site pass
  return true;
}

export function seedTest(data) {
  let rivers = 0, sirens = 0, rains = 0, gauges = 0, offline = 0;

  /* The client's copy only, exactly like every other fake here. `state.notices` is overwritten and
     not appended to, so a real outage during a drill is replaced rather than doubled. The next poll
     with the switch off restores whatever the payload actually said. */
  state.notices = [TEST_NOTICE];

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
        drown(s);
        continue;
      } else if (rivers % RISE_EVERY === 0) {
        /* Climbing, not yet there — the case `rising` exists for, and the one worth eyeballing.
           The rate is derived from a target ETA rather than fixed, because a fixed m/h means the
           flag depends on how big the river is: 0.35 m/h reaches a 0.9 m drain in half an hour and
           a 6 m river in seventeen, so a flat rate lit up 8 of 26 and left the rest silently
           climbing. Spreading the target over 0.5–2.5 h also gives the ticker and the panel a range
           of countdowns to render instead of one repeated number. */
        /* Between the station's own marks, never a fraction of the danger mark. 82% of danger is
           35.20 m on a river that alerts at 35.80 and reads against an absolute datum, which is
           metres *below* its alert mark — so test mode stamped an alert on a station the scale put
           in the safe stretch, and the row drew an amber number over an empty bar. The marks are
           the only thing a level can be faked against. */
        const foot = s.alert ?? s.warning ?? mark * 0.82;
        s.level = +(foot + (mark - foot) * 0.4).toFixed(2);
        s.status = Math.max(s.status || 0, 1);
        s.eta = 0.5 + (rivers % 5) * 0.5;
        s.rate = +((mark - s.level) / s.eta).toFixed(2);
        s.rising = true;
      } else continue;
      s.ratio = mark ? Math.min(1, s.level / mark) : s.ratio;
      s.history = ramp(s.level, s.rate / 2, wlCode(s));
    } else if (s.kind === 'rainfall' && s.online && ++rains % RAIN_EVERY === 0) {
      const km = Math.hypot((s.lng - STORM[1]) * Math.cos(s.lat * Math.PI / 180),
                            s.lat - STORM[0]) * 111;
      const mm = STORM_BANDS.find(([r]) => km <= r)?.[1];
      if (!mm) continue;   // outside the cell — this one stays dry
      soak(s, mm);
    } else if (s.kind === 'gauge' && s.online && s.depth != null && ++gauges % GAUGE_EVERY === 0) {
      drown(s);
    } else if (s.kind === 'gauge' && s.online && s.depth != null && gauges % WET_EVERY === 0) {
      /* The two rungs between dry and flooded, alternating so both appear. 0.08 m is water standing
         on the ground under the 0.15 m mark JPS publishes — its own rung, its own colour, and one
         that almost never shows on real data (two gauges on the day it was built), so without a knob
         here that colour would ship unseen. 0.2 m is past the warning mark. */
      s.depth = gauges % 2 ? 0.08 : 0.2;
      s.status = s.depth > 0.15 ? 1 : 0;
      s.history = ramp(s.depth, s.depth / 50, gaugeCode(s));
    } else if (s.kind === 'siren' && s.online && ++sirens % 9 === 0) {
      s.status = 1;
    }
  }

  /* Second pass: a place tells one story.
     The pass above walks stations one at a time, so it could leave a river 4% over its danger mark
     on the same mast as a rainfall gauge reporting nothing, a dry flood gauge and an idle siren.
     That is not a flood. It is four unrelated faults on one pole, and the mast card read as a bug
     rather than as weather. Any site holding a river at danger now brings the rest of its sensors up
     to match: the rain that caused it, the gauge under water, the siren sounding.
     Offline members stay offline. A real flood does knock sensors off the network, and "one sensor
     on an alerting mast has stopped reporting" is a rendering path worth being able to look at.
     The camera is the reason for the second knob. It has nothing of its own to fake — the warning
     triangle on a picture is measured from the alert to the lens by camAlert() — so the only way to
     exercise it is to put an alert next to a camera. Leaving that to which stations happened to land
     on a multiple of four faked the camera path by luck: 6 of the 31 sites that hold both a camera
     and a river. Every third such site is now pushed over the mark on purpose. */
  const bySite = new Map();
  for (const s of data) {
    const k = s.site || s.id;
    bySite.has(k) ? bySite.get(k).push(s) : bySite.set(k, [s]);
  }

  let camSites = 0;
  for (const members of bySite.values()) {
    let flooded = members.some(m => m.online && m.kind === 'river' && m.status >= 3);
    if (!flooded && members.some(m => m.kind === 'camera') && members.some(m => m.kind === 'river')
        && ++camSites % CAM_EVERY === 0) {
      flooded = members.filter(m => m.kind === 'river').some(drown);
    }
    if (flooded) members.forEach(drown);   // idempotent: a station already there is re-set to it
  }
}

/* Everything that says "this is not real". Deliberately more than one signal: a single badge is a
   thing you stop seeing after ten minutes, and mistaking a drill for a flood is the worst failure
   this app could have. */
export function paintTestChrome() {
  document.body.classList.toggle('testmode', state.test);
}

// Rendered once and left in the DOM; CSS shows it only while `body.testmode`. Into #pills, not the
// body: the rising-only filter has a pill of its own and the two can be on together.
document.getElementById('pills').insertAdjacentHTML('beforeend',
  `<div id="testbadge"><i class="i i-warning"></i><b>TEST MODE</b>
     <span>Every alert on this map is fake</span>
     <button id="testOff">Turn off</button></div>`);

