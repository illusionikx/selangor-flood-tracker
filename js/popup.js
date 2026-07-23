// Every popup shares one template: badge + name + region header, then a kind-specific body, then a
// status footer. The same meter/state blocks are reused by the alert panel.

import { KINDS, SOURCES, SPARK_H, camSrc } from './config.js';
import { num, ago, noSec, parseMY, distKm, hasInfo, isStale, statusColor, scalePos,
         levelStops, gaugeStops } from './util.js';
import { nearestOf, nearestCam, oneLiner } from './stations.js';

// Spinner lives on the wrapper; the img clears it on load, or swaps itself out on failure.
export const camImg = (c, alt) => `<div class="shotwrap">
  <img class="shot" src="${camSrc(c)}" alt="${alt}" data-name="${c.name}"
       onload="this.parentNode.classList.add('done')"
       onerror="this.parentNode.classList.add('done');
                this.replaceWith(Object.assign(document.createElement('div'),
                  {className:'muted',textContent:'image unavailable'}))"></div>`;

/* The ⋮ on every sensor. A menu rather than a bare "ignore" button: one unlabelled glyph that takes
   a station off the map on a single tap is the wrong affordance for something you scan with a thumb,
   and this is where the next per-sensor action will go.
   `popover` + `popovertarget` gives toggle, light dismiss and Esc for nothing; the panel lands in the
   top layer, so the popup's own scrolling box can't clip it. Placement is ui.js's — CSS anchor
   positioning is still Chromium-only. Ids are safe because Leaflet only builds the DOM of the popup
   that is actually open, and there is only ever one. */
export const dots = s => `<button class="icon dots" popovertarget="mnu-${s.id}"
    title="More" aria-label="More actions for ${s.name}"><i class="i i-more_vert"></i></button>
  <div id="mnu-${s.id}" class="menu surface" popover>
    <button class="mi" data-ignore="${s.id}"><i class="i i-visibility_off"></i>
      <span>Ignore this sensor<br><small class="muted">hides it and stops it alerting you</small></span>
    </button>
  </div>`;

const metric = (k, v, cls = '') => `<div class="k muted">${k}</div><div class="v ${cls}">${v}</div>`;

/* Rate of rise, drawn the same way everywhere it appears. The arrow animates — a river climbing is
   the one thing on this page that is *happening* rather than merely being the case, and a static
   triangle said it in the same voice as a station name. Nudged, not spun: it has to be noticeable
   from across a room and still be ignorable while you read the number beside it.
   A rate of exactly zero gets no arrow at all; "steady" is not a direction. */
export const rateHtml = s => s.rate == null ? '' : !s.rate
  ? '<b class="rate">steady</b>'
  : `<b class="rate ${s.rate > 0 ? 'up' : 'down'}"><i class="i i-arrow_drop_${
      s.rate > 0 ? 'up' : 'down'}"></i>${Math.abs(s.rate)} m/h</b>`;

/* Hours until this station hits its own danger mark at the rate it is climbing now. Deliberately
   coarse past a couple of hours: a straight-line projection off an hour of samples is a rough
   signal, and "in 7 h" would read as a forecast it has no right to imply. */
export const etaText = h => h <= 0 ? 'already at it'
  : h < 1 ? `in ~${Math.round(h * 60)} min`
  : h <= 6 ? `in ~${h.toFixed(1)} h`
  : 'over 6 h away';

const camLink = (from, cam) => cam
  ? `<button class="link" data-cam="${cam.id}">
       <i class="i i-photo_camera"></i> Nearest station with a webcam · ${cam.name} (${distKm(from, cam).toFixed(1)} km)
     </button>`
  : '<div class="muted">no camera nearby</div>';

export function meter(s) {
  const max = s.danger || s.warning || s.alert;
  const stops = levelStops(s);   // shared with the heat weight — see util.js
  if (s.level == null || !stops) return '<div class="muted">no level reading</div>';

  const col = statusColor(s.status);
  const marks = stops.slice(1, -1).map(([v, p], i) =>
    `<i class="tick" style="left:${p}%" title="${i ? 'warning' : 'alert'} ${v} m"></i>`).join('');
  const names = ['alert', 'warning', 'danger'].slice(-stops.length + 1);
  const labels = stops.slice(1).map(([v, p], i) =>
    `<span style="left:${p}%"><b>${v}</b>${names[i]}</span>`).join('');

  return `<div class="meter">
    <div class="mtop">
      <b style="color:${col}">${s.level} m</b>
      <span class="muted">${(s.level / max * 100).toFixed(0)}% of danger (${max} m)</span>
    </div>
    <div class="track">
      <span class="fill" style="width:${scalePos(s.level, stops).toFixed(1)}%;background:${col}"></span>
      ${marks}
    </div>
    <div class="mscale muted">${labels}</div>
  </div>`;
}

/* The gauge's answer in words, in the same block the siren and the rainfall station use. A gauge
   carries a status like they do, and until now it was the one kind whose state you had to infer from
   a number and a bar — "0.22 m of water" is a fact you interpret, "WARNING" is the reading.
   Bands are the server's own thresholds (0.15 m / 0.3 m), so block and pin colour cannot disagree.
   Water below the warning mark gets no tone at all: it is neither the green of dry ground nor a
   warning, and painting it either way would overstate what a couple of centimetres means. */
/* Third element is the table's short form: a pill in a scannable column cannot carry "water on
   ground", but it must not disagree with the popup either, so both come out of here. */
export const gaugeState = s => s.depth <= 0
  ? ['off', 'DRY GROUND', 'dry']
  : s.status >= 2 ? ['on', 'FLOODED', 'flooded']
  : s.status >= 1 ? ['mid', 'WATER RISING', 'rising']
  : ['', 'WATER ON GROUND', 'water'];

// A flood gauge measures water depth OVER a flood-prone spot: negative means the ground is dry.
// Several offline gauges are frozen on old flood readings, so staleness is stated, never implied.
function gaugeBlock(s) {
  if (s.depth == null) return '<div class="state">NO READING</div>';
  const wet = s.depth > 0;
  const stale = isStale(s);   // same rule the alert tiers use — see util.js
  const [tone, word] = gaugeState(s);   // shared with the table, so the two views cannot disagree
  const pct = scalePos(s.depth, gaugeStops(s));   // shared with the heat weight — see util.js
  const col = statusColor(s.status >= 2 ? 3 : s.status);   // gauges only go normal / warning / danger

  return `<div class="state ${stale ? '' : tone}">${stale ? 'OFFLINE' : word}</div>
    <div class="meter">
      ${wet ? `<div class="mtop">
          <b style="color:${stale ? 'var(--muted)' : col}">${s.depth} m of water</b>
        </div>
        <div class="track">
          <span class="fill" style="width:${pct.toFixed(1)}%;background:${stale ? 'var(--muted)' : col}"></span>
          <i class="tick" style="left:68%"></i>
        </div>
        <div class="mscale muted">
          <span style="left:68%">warning ${s.warning}</span><span style="left:100%">danger ${s.danger}</span>
        </div>`
        : `<div class="muted">${s.depth < 0 ? `water is ${Math.abs(s.depth)} m below the gauge marker`
                                            : 'water is level with the gauge marker'}</div>`}
    </div>`;
}

/* Same job as the siren's state block: answer the one question the pin is opened to answer, before
   the numbers. "3.4 mm" is a fact you have to interpret; "MODERATE RAIN" is the reading. Bands are
   the server's own rainStatus() cutoffs (>0 / >10 / >30 / >60 mm an hour), so the block, the pin
   colour and the status code can never disagree. */
const RAIN_STATE = ['NOT RAINING', 'LIGHT RAIN', 'MODERATE RAIN', 'HEAVY RAIN', 'VERY HEAVY RAIN'];
const rainState = s => !hasInfo(s)
  ? '<div class="state">NO READING</div>'
  : `<div class="state ${s.status >= 3 ? 'on' : s.status >= 1 ? 'mid' : 'off'}"
      >${RAIN_STATE[s.status] || 'NOT RAINING'}</div>`;

/* Everything one sensor has to say, without its name or region — those belong to the place, and a
   site with five sensors on one mast would otherwise repeat them five times. */
function sensorBody(s, withCam = true) {
  const body = [];

  if (s.kind === 'river' && s.rate != null) body.push(metric('Trend', rateHtml(s)));
  // The number the "rising" flag is actually a cutoff on. Shown whenever it is climbing, flagged or
  // not, so "not rising" can be read as "still hours away" rather than taken on trust.
  if (s.kind === 'river' && s.eta != null) body.push(metric('Reaches danger',
    etaText(s.eta), s.rising ? 'up' : ''));
  if (s.kind === 'rainfall') {
    body.push(metric('Last hour', `<b>${num(s.hourly, ' mm')}</b>`));
    body.push(metric('Today', num(s.daily, ' mm')));
  }
  const rain = s.kind === 'rainfall' ? rainBars(s.history) : '';
  // The meter says where the level is against its own thresholds; this says how it got there. The
  // alert panel has carried it all along — the popup you reach by clicking the pin had the numbers
  // for the trend (m/h, hours to danger) but not the shape they came from.
  // Gauges get one too, in their own taupe: "0.12 m of water" is a fact, "filling for three hours"
  // is the answer. Only where there is history — offline gauges are not sampled at all.
  const spark = s.kind === 'river' ? sparkline(s.history)
    : s.kind === 'gauge' && s.history?.length ? sparkline(s.history, 'gauge') : '';
  const wet = s.kind === 'rainfall' ? rainState(s) : '';
  // A siren has exactly one thing to say, so it gets a centred state block instead of a metric row.
  // "No signal" is only half the story — a siren that fell off the network last March must not read
  // as one that is quietly working — but the *when* is footLine()'s job now, on one line with the
  // date and the source, rather than a sentence here and the same moment again three lines down.
  const siren = s.kind !== 'siren' ? '' : !hasInfo(s)
    ? '<div class="state">OUT OF CONTACT</div>'
    : `<div class="state ${s.status > 0 ? 'on' : 'off'}">${s.status > 0 ? 'TRIGGERED' : 'IDLE'}</div>
       ${sirenBand(s.history)}`;
  const gauge = s.kind !== 'gauge' ? '' : gaugeBlock(s);

  // Only camera popups carry an image; everything else links to the closest one — but a site that
  // already holds a camera has the picture right there, so the link would point at itself.
  // The picture *is* the reading for a camera, so it leads. The nearest-webcam link on every other
  // kind stays at the bottom: it is an action to take after reading the numbers, not one of them.
  const still = s.kind !== 'camera' ? ''
    : s.image ? camImg(s, `Latest still from ${s.name}`) : '<div class="muted">no camera feed</div>';
  const link = s.kind !== 'camera' && withCam ? camLink(s, nearestCam(s)) : '';

  return `${still}${siren}${gauge}${wet}
    ${s.kind === 'river' ? meter(s) : ''}
    ${body.length ? `<div class="popbody">${body.join('')}</div>` : ''}
    ${spark}${rain}${link}`;
}

/* The one place a timestamp is printed: `OFFLINE · last reported 06/07/2026 10:19 · 411.0h ago ·
   via JPS Selangor`. The stale state blocks above used to carry the elapsed time while this carried
   the date, which put the same moment on screen twice, a couple of lines apart. Elapsed time only
   where it is the point — on a live station the date is the answer and "· 4m ago" is padding. */
const footLine = s => {
  const t = s.updated || s.shot;
  const at = parseMY(t);
  const late = at && (!s.online || isStale(s));
  return `<div class="popfoot muted">${s.online ? 'online' : 'OFFLINE'}${
    t ? `${s.online ? ' · ' : ' · last reported '}${noSec(t)}${late ? ` · ${ago(at)}` : ''}`
      : s.online ? '' : ' · never reported'}${
    SOURCES[s.source] ? ` · via ${SOURCES[s.source].short}` : ''}</div>`;
};

const region = s => `<div class="muted">${
  [s.district, s.state].filter(Boolean).join(', ') || 'district n/a'} · ${s.basin || 'basin n/a'}</div>`;

export function popup(s) {
  const kind = KINDS[s.kind];
  const tone = hasInfo(s) ? kind.color : 'var(--muted)';
  // Place first, sensor second: you look up a popup by where it is, and the badge answers the
  // follow-up question ("what is this reading?") rather than the opening one.
  return `<div class="pophead">
      <div class="popname">${s.name}</div>
      ${region(s)}
      <div class="popact">
        <span class="badge" style="--c:${tone}">
          <i class="i i-${kind.icon}"></i>${kind.one || kind.label}
        </span>
        ${dots(s)}
      </div>
    </div>
    ${sensorBody(s)}
    ${footLine(s)}`;
}

/* One mast, several sensors: a rainfall gauge, a river gauge, a siren and a camera are published as
   four stations at one coordinate, and drawing four pins on top of each other made a place look like
   four places. The site gets one pin and one popup — the place named once, then a section per
   sensor. Members arrive already sorted by how much each matters (see render.js). */
/* `leads` ranks the camera last — it is the least urgent *reading*. In a popup it is the opposite:
   the picture is what you opened the pin to look at, and scrolling past four sensors to reach it
   defeats the point. Stable sort, so everything else keeps the order render.js chose. */
const camFirst = members =>
  [...members].sort((a, b) => (b.kind === 'camera') - (a.kind === 'camera'));

export function sitePopup(members) {
  if (members.length === 1) return popup(members[0]);
  const lead = members[0];
  const hasCam = members.some(m => m.kind === 'camera');

  /* The count sits beside the close button as a chip, not as a "6 sensors at this location" line —
     that spent a whole row of a popup that is mostly rows, restating what the badges under it
     already list. Same `layers` glyph as the mast pin, so the pin you tapped and the header you got
     say the same thing. Number alone on screen, so the sentence moves into title/aria — it is the
     only place that count is stated in words now. Emitted before .popname because the CSS reserves
     room for it with an adjacent-sibling rule. */
  return `<div class="pophead">
      <span class="sitecount" role="img" title="${members.length} sensors at this location"
            aria-label="${members.length} sensors at this location"
        ><i class="i i-layers"></i>${members.length}</span>
      <div class="popname">${lead.name}</div>
      ${region(lead)}
      <div class="badges">${members.map(m => {
        const k = KINDS[m.kind];
        return `<span class="badge" style="--c:${hasInfo(m) ? k.color : 'var(--muted)'}"
                ><i class="i i-${k.icon}"></i>${k.one || k.label}</span>`;
      }).join('')}</div>
    </div>
    ${camFirst(members).map(m => `<div class="sensor">
      <div class="sensorhead">
        <i class="glyph i i-${KINDS[m.kind].icon}" style="color:${hasInfo(m) ? KINDS[m.kind].color : 'var(--muted)'}"
          ></i>
        <b>${KINDS[m.kind].one || KINDS[m.kind].label}</b>
        ${m.name !== lead.name ? `<span class="muted">${m.name}</span>` : ''}
        ${dots(m)}
      </div>
      ${sensorBody(m, false)}
      ${footLine(m)}
    </div>`).join('')}
    ${hasCam ? '' : camLink(lead, nearestCam(lead))}`;
}

// Built fresh on every open, so it reflects the latest poll rather than the fix's timestamp.
export function herePopup(e, loaded) {
  if (!loaded) return '<b>You are here</b><br><span class="muted">stations still loading…</span>';
  const rows = ['river', 'rainfall', 'siren', 'gauge'].map(k => {
    const s = nearestOf(k, e.latlng);
    if (!s) return `<div class="near"><i class="glyph i i-${KINDS[k].icon}" style="color:${KINDS[k].color}"></i>
      <div><div class="muted">no ${KINDS[k].label.toLowerCase()} reporting</div></div></div>`;
    return `<div class="near" data-go="${s.id}">
      <i class="glyph i i-${KINDS[k].icon}" style="color:${KINDS[k].color}"></i>
      <div>
        <div>${s.name} <span class="muted">${distKm(e.latlng, s).toFixed(1)} km</span></div>
        <div class="muted">${oneLiner(s)}</div>
      </div></div>`;
  }).join('');

  return `<div class="pophead">
      <span class="badge" style="--c:#1a73e8"><i class="i i-person"></i>You are here</span>
      <div class="muted">accurate to about ${Math.round(e.accuracy)} m</div>
    </div>
    ${rows}
    ${camLink(e.latlng, nearestCam(e.latlng))}`;
}

/* Hours are Malaysian, not the viewer's, so the axis agrees with every other timestamp on the page —
   JPS stamps its readings in MYT with no offset, and we print those verbatim. Reading the map from
   another timezone must not put "14:00" on the axis beside a reading stamped 06:00. */
const MYT_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
});

// Tick spacings, coarsening until about five fit across the axis. All divide an hour evenly, so a
// tick always lands on a round clock time rather than an arbitrary offset from the first reading.
const TICK_STEPS = [900, 1800, 3600, 7200, 10800];   // 15m · 30m · 1h · 2h · 3h

/* Shared by both graphs: the window (data extent, capped at SPARK_H), and ticks on round clock
   times inside it. MYT is a whole-hour offset, so rounding up to a multiple of the step in epoch
   seconds lands on :00, :15 or :30 as intended. */
function timeAxis(points) {
  const last = points.at(-1)[0];
  const t0 = Math.max(points[0][0], last - SPARK_H * 3600);
  const inWin = points.filter(([t]) => t >= t0);
  const t1 = last, secs = t1 - t0;
  const x = t => ((t - t0) / (secs || 1) * 100).toFixed(2);

  const step = TICK_STEPS.find(s => secs / s <= 5) ?? TICK_STEPS.at(-1);
  const ticks = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    ticks.push({ x: x(t), at: MYT_CLOCK.format(t * 1000) });
  }
  return { t0, t1, secs, inWin, x, ticks, step };
}

const axisHtml = ticks => `<div class="axis muted" aria-hidden="true">${ticks.map(t =>
  `<span style="left:${t.x}%">${t.at}</span>`).join('')}</div>`;

const rules = ticks => ticks.map(t =>
  `<line x1="${t.x}" x2="${t.x}" y1="0" y2="28" vector-effect="non-scaling-stroke"/>`).join('');

/* Area fill under a line. Two stops rather than a fade to nothing: at the bottom the shape has to
   read as a mass, at the top it has to not compete with the line drawn on it. Ids are minted
   per call because several of these can be on the page at once — a duplicate id and every chart
   silently takes the first one's colour. */
let fillId = 0;
const areaFill = c => {
  const id = `af${++fillId}`;
  return [id, `<defs><linearGradient id="${id}" x1="0" x2="0" y1="1" y2="0">
    <stop offset="0" stop-color="${c}" stop-opacity=".6"/>
    <stop offset="1" stop-color="${c}" stop-opacity=".1"/>
  </linearGradient></defs>`];
};

const spanText = secs => secs < 3600
  ? `${Math.round(secs / 60)} min` : `${(secs / 3600).toFixed(secs < 36000 ? 1 : 0)} h`;

/* Level over the last SPARK_H hours, plotted against the clock rather than against sample index.
   Sample index lied whenever polling was uneven — and it always is, because the cache only refreshes
   when someone loads the page. A flat stretch that was really a 6-hour gap looked identical to a
   flat stretch that was six hours of steady readings.

   The x axis spans the readings actually held, capped at SPARK_H hours. Times are 24-hour, like
   every other clock in this app and in the JPS data behind it. */
export function sparkline(points, kind = 'river') {
  if (!points || points.length < 2) return '<div class="muted">trend graph builds as we poll</div>';

  // The axis spans the readings we actually hold, up to a 12-hour cap — so two hours of history
  // draws as two labelled hours rather than a sliver at the edge of a mostly empty 12-hour frame.
  const { secs, inWin, x, ticks } = timeAxis(points);
  if (inWin.length < 2) return `<div class="muted">no readings in the last ${SPARK_H} hours</div>`;

  const vals = inWin.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const y = v => (26 - (v - lo) / span * 24).toFixed(2);
  const pts = inWin.map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
  // The station's own colour, not a red-for-rising / green-for-falling line. Direction is already
  // stated next to it as a rate with an arrow, and a traffic-light hue on a *type* is the one thing
  // the colour language here does not allow — green on a graph reads as "fine", which is not
  // something a shape over 12 hours is entitled to say.
  const col = KINDS[kind].color;
  const [id, defs] = areaFill(col);

  return `<div class="spark">
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${defs}
      ${rules(ticks)}
      <polygon points="${x(inWin[0][0])},28 ${pts} ${x(inWin.at(-1)[0])},28" fill="url(#${id})"/>
      <polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"
        stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">${lo.toFixed(2)}–${hi.toFixed(2)} m over ${spanText(secs)}</div>
  </div>`;
}

/* A siren's last 12 hours, as a band rather than a graph. Its samples are 0 or 1, so there is no
   shape to plot: a polyline between them would draw ramps up and down that never happened, and an
   axis of "0–1" is not a quantity anyone reads. What the pin is opened to ask is "has this thing
   gone off today", and a strip that is either quiet or red answers it at a glance.

   Each sample owns the span up to the next one. A gap longer than an hour and a half is left blank
   for the same reason the rain chart breaks its area there: an unbroken quiet band across a hole in
   the record says the siren was silent, in exactly the same shape as a siren that was measured
   silent. Quiet is drawn in the outline colour, not green — the state block above already carries
   the green, and a 12-hour reassurance is more than a log of samples is entitled to give. */
export function sirenBand(points) {
  if (!points || !points.length) return '<div class="muted">siren log builds as we poll</div>';

  const { t1, secs, inWin, x, ticks } = timeAxis(points);
  if (!inWin.length) return `<div class="muted">no readings in the last ${SPARK_H} hours</div>`;

  const on = statusColor(3);
  const bars = inWin.map(([t, v], i) => {
    const nxt = inWin[i + 1]?.[0];
    const end = nxt && nxt - t <= 5400 ? nxt : Math.min(t + 900, t1);
    // A lone sample at the right edge has no width of its own; give it enough to be visible.
    const x0 = +x(t), w = Math.max(+x(end) - x0, 0.8);
    // `style`, not a `fill` attribute: var() in a presentation attribute is not reliable everywhere.
    return `<rect x="${x0.toFixed(2)}" y="9" width="${w.toFixed(2)}" height="10" rx="1"
      style="fill:${v > 0 ? on : 'var(--outline)'}"/>`;
  }).join('');

  const fired = inWin.filter(([, v]) => v > 0).length;
  return `<div class="spark">
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${rules(ticks)}${bars}
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">${fired ? `sounded in ${fired} of ${inWin.length} readings`
      : `silent for the last ${spanText(secs)}`}</div>
  </div>`;
}

/* Rain over the same window — as bars, not a line.

   A line between two readings claims the values in between, which is meaningful for a water level
   (it really was somewhere between 1.74 m and 1.82 m) and meaningless for rainfall: 5 mm at 13:00
   and 0 mm at 14:00 does not mean 2.5 mm fell at 13:30. Rain is an amount collected over a period,
   so each period gets its own bar and no claim is made between them.

   One bar per clock hour, because `hourly` is a rolling one-hour total — the server buckets to
   RAIN_BUCKET for the same reason, so two samples 15 minutes apart can't show the same rain twice. */
export function rainBars(points) {
  if (!points || !points.length) return '<div class="muted">rain graph builds as we poll</div>';

  const { secs, inWin, x, ticks } = timeAxis(points);
  if (!inWin.length) return `<div class="muted">no readings in the last ${SPARK_H} hours</div>`;

  const hi = Math.max(...inWin.map(([, v]) => v));
  // All zeroes is a real answer, and a row of flat bars states it worse than a sentence does.
  if (!hi) return `<div class="muted">no rain in the last ${spanText(secs)}</div>`;

  /* An area, not bars — but cut into segments wherever an hour is missing, so a gap in the record
     still draws as a gap. That was the whole reason bars were used here: an unbroken line across a
     six-hour hole says it did not rain, and it says it in the same shape as six hours of measured
     zeroes. The area is what changed; the honesty is not. */
  const y = v => (28 - v / hi * 26).toFixed(2);
  const segs = [[]];
  for (const p of inWin) {
    const prev = segs.at(-1).at(-1);
    if (prev && p[0] - prev[0] > 5400) segs.push([]);   // more than an hour and a half apart
    segs.at(-1).push(p);
  }
  const [id, defs] = areaFill(KINDS.rainfall.color);

  return `<div class="spark">
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${defs}
      ${rules(ticks)}
      ${segs.filter(s => s.length).map(s => {
        const pts = s.map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
        // A lone reading has no line to draw, so it gets a sliver wide enough to see.
        if (s.length === 1) return `<rect x="${Math.min(+x(s[0][0]), 99).toFixed(2)}" y="${y(s[0][1])}"
          width="1.6" height="${(28 - y(s[0][1])).toFixed(2)}" fill="url(#${id})"/>`;
        return `<polygon points="${x(s[0][0])},28 ${pts} ${x(s.at(-1)[0])},28" fill="url(#${id})"/>
          <polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"
            stroke="${KINDS.rainfall.color}" stroke-width="1.5" stroke-linejoin="round"/>`;
      }).join('')}
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">peak ${hi} mm in an hour · last ${spanText(secs)}</div>
  </div>`;
}
