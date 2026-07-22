// Every popup shares one template: badge + name + region header, then a kind-specific body, then a
// status footer. The same meter/state blocks are reused by the alert panel.

import { KINDS, SOURCES, SPARK_H } from './config.js';
import { num, ago, parseMY, distKm, hasInfo, statusColor, scalePos } from './util.js';
import { nearestOf, nearestCam, oneLiner } from './stations.js';

// Spinner lives on the wrapper; the img clears it on load, or swaps itself out on failure.
export const camImg = (c, alt) => `<div class="shotwrap">
  <img class="shot" src="api.php?cam=${c.id.split('-')[1]}" alt="${alt}"
       onload="this.parentNode.classList.add('done')"
       onerror="this.parentNode.classList.add('done');
                this.replaceWith(Object.assign(document.createElement('div'),
                  {className:'muted',textContent:'image unavailable'}))"></div>`;

const metric = (k, v, cls = '') => `<div class="k muted">${k}</div><div class="v ${cls}">${v}</div>`;

/* Hours until this station hits its own danger mark at the rate it is climbing now. Deliberately
   coarse past a couple of hours: a straight-line projection off an hour of samples is a rough
   signal, and "in 7 h" would read as a forecast it has no right to imply. */
export const etaText = h => h <= 0 ? 'already at it'
  : h < 1 ? `in ~${Math.round(h * 60)} min`
  : h <= 6 ? `in ~${h.toFixed(1)} h`
  : 'over 6 h away';

const camLink = (from, cam) => cam
  ? `<button class="link" data-cam="${cam.id}">
       <i>photo_camera</i> Nearest station with a webcam · ${cam.name} (${distKm(from, cam).toFixed(1)} km)
     </button>`
  : '<div class="muted">no camera nearby</div>';

export function meter(s) {
  const max = s.danger || s.warning || s.alert;
  if (s.level == null || !max) return '<div class="muted">no level reading</div>';

  const stops = [[0, 0]];
  if (s.alert   && s.alert   < max) stops.push([s.alert, 38]);
  if (s.warning && s.warning < max && s.warning > (s.alert ?? 0)) stops.push([s.warning, 68]);
  stops.push([max, 100]);

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

// A flood gauge measures water depth OVER a flood-prone spot: negative means the ground is dry.
// Several offline gauges are frozen on old flood readings, so staleness is stated, never implied.
function gaugeBlock(s) {
  if (s.depth == null) return '<div class="state">NO READING</div>';
  const wet = s.depth > 0;
  const when = parseMY(s.updated);
  const stale = !s.online || (when && Date.now() - when > 864e5);   // 24h
  const stops = [[0, 0], [s.warning || 0.15, 55], [s.danger || 0.3, 100]];
  const pct = scalePos(s.depth, stops);
  const col = statusColor(s.status >= 2 ? 3 : s.status);   // gauges only go normal / warning / danger

  return `<div class="meter">
      <div class="mtop">
        <b style="color:${stale ? 'var(--muted)' : wet ? col : 'inherit'}">${
          wet ? `${s.depth} m of water` : 'Dry ground'}</b>
      </div>
      ${wet ? `<div class="track">
          <span class="fill" style="width:${pct.toFixed(1)}%;background:${stale ? 'var(--muted)' : col}"></span>
          <i class="tick" style="left:55%"></i>
        </div>
        <div class="mscale muted">
          <span style="left:55%">warning ${s.warning}</span><span style="left:100%">danger ${s.danger}</span>
        </div>`
        : `<div class="muted">water is ${Math.abs(s.depth)} m below the gauge marker</div>`}
    </div>
    ${stale ? `<div class="state">NOT CURRENT · last reported ${s.updated || 'unknown'}</div>` : ''}`;
}

/* Everything one sensor has to say, without its name or region — those belong to the place, and a
   site with five sensors on one mast would otherwise repeat them five times. */
function sensorBody(s, withCam = true) {
  const body = [];

  if (s.kind === 'river' && s.rate != null) body.push(metric('Trend',
    `${s.rate > 0 ? '▲' : '▼'} ${Math.abs(s.rate)} m/h`, s.rate > 0 ? 'up' : 'down'));
  // The number the "rising" flag is actually a cutoff on. Shown whenever it is climbing, flagged or
  // not, so "not rising" can be read as "still hours away" rather than taken on trust.
  if (s.kind === 'river' && s.eta != null) body.push(metric('Reaches danger',
    etaText(s.eta), s.rising ? 'up' : ''));
  if (s.kind === 'rainfall') {
    body.push(metric('Last hour', `<b>${num(s.hourly, ' mm')}</b>`));
    body.push(metric('Today', num(s.daily, ' mm')));
  }
  const rain = s.kind === 'rainfall' ? rainBars(s.history) : '';
  // A siren has exactly one thing to say, so it gets a centred state block instead of a metric row.
  // "No signal" is only half the story: say when it last reported, so a siren that fell off the
  // network last March can't be mistaken for one that is quietly working.
  const siren = s.kind !== 'siren' ? '' : !hasInfo(s)
    ? `<div class="state">OUT OF CONTACT</div>
       <div class="muted">last reported ${s.updated ? `${s.updated} · ${ago(parseMY(s.updated))}`
                                                    : 'never — this station has no timestamp'}</div>`
    : `<div class="state ${s.status > 0 ? 'on' : 'off'}">${s.status > 0 ? 'TRIGGERED' : 'IDLE'}</div>`;
  const gauge = s.kind !== 'gauge' ? '' : gaugeBlock(s);

  // Only camera popups carry an image; everything else links to the closest one — but a site that
  // already holds a camera has the picture right there, so the link would point at itself.
  // The picture *is* the reading for a camera, so it leads. The nearest-webcam link on every other
  // kind stays at the bottom: it is an action to take after reading the numbers, not one of them.
  const still = s.kind !== 'camera' ? ''
    : s.image ? camImg(s, `Latest still from ${s.name}`) : '<div class="muted">no camera feed</div>';
  const link = s.kind !== 'camera' && withCam ? camLink(s, nearestCam(s)) : '';

  return `${still}${siren}${gauge}
    ${s.kind === 'river' ? meter(s) : ''}
    ${body.length ? `<div class="popbody">${body.join('')}</div>` : ''}
    ${rain}${link}`;
}

const footLine = s => `<div class="popfoot muted">${s.online ? 'online' : 'OFFLINE'}${
  s.updated || s.shot ? ' · ' + (s.updated || s.shot) : ''}${
  SOURCES[s.source] ? ` · via ${SOURCES[s.source].short}` : ''}</div>`;

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
      <span class="badge" style="--c:${tone}">
        <i>${kind.icon}</i>${kind.one || kind.label}
      </span>
    </div>
    ${sensorBody(s)}
    ${footLine(s)}`;
}

/* One mast, several sensors: a rainfall gauge, a river gauge, a siren and a camera are published as
   four stations at one coordinate, and drawing four pins on top of each other made a place look like
   four places. The site gets one pin and one popup — the place named once, then a section per
   sensor. Members arrive already sorted by how much each matters (see render.js). */
export function sitePopup(members) {
  if (members.length === 1) return popup(members[0]);
  const lead = members[0];
  const hasCam = members.some(m => m.kind === 'camera');

  return `<div class="pophead">
      <div class="popname">${lead.name}</div>
      ${region(lead)}
      <div class="muted">${members.length} sensors at this location</div>
      <div class="badges">${members.map(m => {
        const k = KINDS[m.kind];
        return `<span class="badge" style="--c:${hasInfo(m) ? k.color : 'var(--muted)'}"
                ><i>${k.icon}</i>${k.one || k.label}</span>`;
      }).join('')}</div>
    </div>
    ${members.map(m => `<div class="sensor">
      <div class="sensorhead">
        <i class="glyph" style="color:${hasInfo(m) ? KINDS[m.kind].color : 'var(--muted)'}"
          >${KINDS[m.kind].icon}</i>
        <b>${KINDS[m.kind].one || KINDS[m.kind].label}</b>
        ${m.name !== lead.name ? `<span class="muted">${m.name}</span>` : ''}
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
    if (!s) return `<div class="near"><i class="glyph" style="color:${KINDS[k].color}">${KINDS[k].icon}</i>
      <div><div class="muted">no ${KINDS[k].label.toLowerCase()} reporting</div></div></div>`;
    return `<div class="near" data-go="${s.id}">
      <i class="glyph" style="color:${KINDS[k].color}">${KINDS[k].icon}</i>
      <div>
        <div>${s.name} <span class="muted">${distKm(e.latlng, s).toFixed(1)} km</span></div>
        <div class="muted">${oneLiner(s)}</div>
      </div></div>`;
  }).join('');

  return `<div class="pophead">
      <span class="badge" style="--c:#1a73e8"><i>person</i>You are here</span>
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

const spanText = secs => secs < 3600
  ? `${Math.round(secs / 60)} min` : `${(secs / 3600).toFixed(secs < 36000 ? 1 : 0)} h`;

/* Level over the last SPARK_H hours, plotted against the clock rather than against sample index.
   Sample index lied whenever polling was uneven — and it always is, because the cache only refreshes
   when someone loads the page. A flat stretch that was really a 6-hour gap looked identical to a
   flat stretch that was six hours of steady readings.

   The x axis spans the readings actually held, capped at SPARK_H hours. Times are 24-hour, like
   every other clock in this app and in the JPS data behind it. */
export function sparkline(points) {
  if (!points || points.length < 2) return '<div class="muted">trend graph builds as we poll</div>';

  // The axis spans the readings we actually hold, up to a 12-hour cap — so two hours of history
  // draws as two labelled hours rather than a sliver at the edge of a mostly empty 12-hour frame.
  const { secs, inWin, x, ticks } = timeAxis(points);
  if (inWin.length < 2) return `<div class="muted">no readings in the last ${SPARK_H} hours</div>`;

  const vals = inWin.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const y = v => (26 - (v - lo) / span * 24).toFixed(2);
  const pts = inWin.map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
  const up = vals.at(-1) >= vals[0];

  return `<div class="spark">
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${rules(ticks)}
      <polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"
        stroke="${up ? '#d93025' : '#188038'}" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">${lo.toFixed(2)}–${hi.toFixed(2)} m over ${spanText(secs)}</div>
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

  // Bars are anchored at their hour and drawn one hour wide, so an hour with no reading leaves a
  // visible gap rather than a silent zero — missing is not the same as dry.
  const w = Math.max(1.5, Math.min(80, 3600 / (secs || 3600) * 100 * 0.8));
  // Centred on the hour, but kept inside the box: the newest bar sits at x=100 and the SVG is
  // overflow:visible (the line graph needs that for its stroke), so half of it would draw outside.
  const left = t => Math.min(Math.max(0, +x(t) - w / 2), 100 - w).toFixed(2);
  return `<div class="spark">
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${rules(ticks)}
      ${inWin.map(([t, v]) => v > 0 ? `<rect x="${left(t)}"
        y="${(28 - v / hi * 26).toFixed(2)}" width="${w.toFixed(2)}" height="${(v / hi * 26).toFixed(2)}"
        fill="${KINDS.rainfall.color}"/>` : '').join('')}
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">peak ${hi} mm in an hour · last ${spanText(secs)}</div>
  </div>`;
}
