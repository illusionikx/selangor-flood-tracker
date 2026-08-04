// Every popup shares one template: badge + name + region header, then a kind-specific body, then a
// status footer. The same meter/state blocks are reused by the alert panel.

import { KINDS, SOURCES, SPARK_H, NO_INFO, ALERT_TITLE, RIVER_COLOR, RAIN_COLOR,
         GAUGE_COLOR, RAIN_STOPS, NEAR_MAX_KM, camSrc } from './config.js';
import { num, ago, noSec, parseMY, distKm, hasInfo, isStale, statusColor, scalePos,
         levelStops, gaugeStops, gaugeColor, color, isFav } from './util.js';
import { nearestOf, nearestCam, nearestLevel, camAlert } from './stations.js';

/* The warning that rides a camera picture, in the lightbox and nowhere else. Empty string when
   nothing near the lens is on alert, so it costs nothing to interpolate unconditionally.
 *
 * What is wrong, and its number. Not where — the place name is the one thing a camera picture does
 * not need told, because the dialog around it is already headed with it. The distance is gone for
 * the same reason: nothing within 2 km of this lens is far enough away for the figure to change what
 * the picture means.
 *
 * The words come from `ALERT_TITLE`, the same table the alert panel groups its rows under, so a
 * reader who scans the panel and then opens the picture beside that river reads one claim twice
 * rather than two claims. That is also what puts the tier *in the words* — `Water level at danger`
 * against `Forecast to reach danger`. The pill used to state the reading and leave red against amber
 * to carry the difference, and colour alone is not a message, least of all on a photograph where
 * nothing else is holding a scale. The figure trails the phrase and only where there is one.
 *
 * The alert is a parameter, defaulting to the live one. A camera in the lightbox is scrubbed through
 * its archive, and a pill saying what is wrong *now* over a picture from last Tuesday is a wrong
 * claim about that picture. timeline.js passes the alert that frame was taken under, including its
 * own `level` — which is null on a frame older than the levels we keep, and then the pill states the
 * phrase and no figure. `'level' in a` rather than `??`: on those frames the live number is the one
 * thing it must not fall back to. A siren has no reading either, and never had one.
 *
 * Every kind keeps its own field and its own unit. A river reads `level` in metres, a flood gauge
 * `depth` in metres, a rain gauge `hourly` in mm/h. The pill printed ` m` on whatever it was handed,
 * which was safe only while the river was the one kind that reached it with a number.
 *
 * A wrapper around the glyph, the same shape `.pin` uses: the mask is a background on the `<i>`, so
 * anything painting a background on the same element wins and the mask cuts that instead of the
 * colour. Keep them as two elements. */
const CAM_READ = {
  river:    ['level',  ' m'],
  gauge:    ['depth',  ' m'],
  rainfall: ['hourly', ' mm/h'],
};

export const camWarn = (cam, a = camAlert(cam)) => {
  if (!a) return '';
  const s = a.station;
  const [field, unit] = CAM_READ[s.kind] || [];
  // Gated on the kind having a reading at all, not on what was handed in: a siren's samples are 0
  // and 1, so an archive frame passes `level: 1` and a pill that trusted it would print "1".
  const lv = !field ? null : 'level' in a ? a.level : s[field];
  const what = ALERT_TITLE[`${s.kind}|${a.tier}`]?.[0] || KINDS[s.kind].label;
  return `<span class="camwarn t-${a.tier}"><i class="i i-warning"></i><b>${
    what}${lv == null ? '' : `, ${lv}${unit}`}</b></span>`;
};

/* Spinner lives on the wrapper; the img clears it on load, or swaps itself out on failure.
   `data-clip` is the hook js/clip.js looks for — it carries the numeric camera id the proxy uses,
   not the station id, because that is what ?shots= and ?shot= both take.
   No warning pill here any more. This still is a 3-hour clip that plays itself (see js/clip.js), so
   the pill stated the live alert over a frame from hours ago — the same wrong claim the lightbox was
   just fixed for, and this one has no scrubber, no seek bar and no room to answer it per frame. The
   card around the picture already carries the alerting sensor as a section of its own, with the
   reading, the meter and the graph. The lightbox keeps its pill, where every frame is scored. */
export const camImg = (c, alt) => `<div class="shotwrap" data-clip="${c.id.split('-')[1]}">
  <img class="shot" src="${camSrc(c)}" alt="${alt}" data-name="${c.name}"
       onload="this.parentNode.classList.add('done')"
       onerror="this.parentNode.classList.add('done');
                this.replaceWith(Object.assign(document.createElement('div'),
                  {className:'muted',textContent:'image unavailable'}))">
  <p class="clipcap"></p></div>`;

/* The ⓘ on every sensor: where this reading came from, when, and the one action there is.
   It was a ⋮ holding a single "ignore" item, with the provenance printed as a footer line under
   every card. Two problems with that. The glyph promised actions and held one, and the footer was
   three facts about *us* — our connection to the station, the stamp on the last packet, which feed
   won — sitting in the reading's own column, on every sensor of a six-sensor mast. None of it
   changes what the water is doing. It is what you check when you doubt the number, so it now lives
   where you go to look, one tap away, and the card is the reading again.
   `popover` + `popovertarget` gives toggle, light dismiss and Esc for nothing; the panel lands in
   the top layer, so the station panel's own scrolling box can't clip it. Placement is ui.js's — CSS
   anchor positioning is still Chromium-only. Ids are safe because the panel holds one card at a
   time, so only one copy of a given sensor's menu is ever in the document. */
export const dots = s => `<button class="icon dots" popovertarget="mnu-${s.id}"
    title="Details" aria-label="Details and actions for ${s.name}"><i class="i i-info"></i></button>
  <div id="mnu-${s.id}" class="menu surface" popover>
    ${sourceInfo(s)}
    <button class="mi" data-fav="${s.id}"
      ><i class="i i-favorite${isFav(s) ? '' : '_outline'}"
         style="color:${isFav(s) ? 'var(--fav)' : 'var(--muted)'}"></i>
      <span>${isFav(s) ? 'Remove from favorites' : 'Add to favorites'}<br><small class="muted">${
        isFav(s) ? 'stops listing it first'
                 : 'lists it first in the search box and the alert panel'}</small></span>
    </button>
    <button class="mi" data-ignore="${s.id}"><i class="i i-visibility_off"></i>
      <span>Ignore this sensor<br><small class="muted">Hides it and stops it alerting you</small></span>
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
  : `<b class="rate ${s.rate > 0 ? 'up' : 'down'}"><i class="i i-arrow_${
      s.rate > 0 ? 'upward' : 'downward'}"></i>${Math.abs(s.rate)} m/h</b>`;

/* Hours until this station hits its own danger mark at the rate it is climbing now. Deliberately
   coarse past a couple of hours: a straight-line projection off an hour of samples is a rough
   signal, and "in 7 h" would read as a forecast it has no right to imply. */
export const etaText = h => h <= 0 ? 'already at it'
  : h < 1 ? `in ~${Math.round(h * 60)} min`
  : h <= 6 ? `in ~${h.toFixed(1)} h`
  : 'over 6 h away';

/* The "you are here" card, and only that card, shows the nearest camera's picture rather than a link
   to it. There the camera is one of the five things you asked for — "what is around me" is the whole
   question, and a picture of it is an answer in a way "there is one 3 km away" is not. On a station
   card it is an aside: you opened a river gauge to read a river gauge, and a 250 KB still of
   somewhere else, fetched whether you wanted it or not, is not what you asked for.
   Built as a `.sensor` section like every other kind on that card, because that is what it is there —
   glyph and label, the distance where the other sections put it, the place name, then the reading,
   which here is the picture. `from` is a bare latlng, so there is no same-mast case to handle: your
   own position shares a mast with nothing.
   No camera in range prints nothing at all — not a section, not a line. A camera is an aside
   everywhere it appears, and an aside that is absent has nothing to report. */
export function camNear(from, cam) {
  if (!cam) return '';
  const k = KINDS.camera;
  return `<div class="sensor cam">
    <div class="sensorhead">
      <i class="glyph i i-${k.icon}" style="color:${k.color}"></i>
      <b>Nearest camera</b>
      <span class="muted">${distKm(from, cam).toFixed(1)} km away</span>
    </div>
    <div class="place" data-cam="${cam.id}" title="Show ${cam.name} on the map">${cam.name}</div>
    ${camImg(cam, `Latest still from ${cam.name}`)}
  </div>`;
}

/* Everywhere else — every station card, every alert row — the camera is offered, not shown. One
   line at the top of the card saying a picture exists and how far away it is, which is enough to
   decide whether you want it. The alert panel would be N proxied fetches at JPS for pictures of
   places you are scrolling past; a station card would be one you did not ask for.
   A camera on the *same mast* is not a nearest-anything — it is this station's own view, so it says
   so and drops the distance, which would read "0.0 km". `from` may be a bare latlng from a map
   click, which has no `site` — hence the guard rather than a plain comparison. */
/* The camera is named, and the name leads. A distance alone said a picture exists somewhere over
   there, and the reader had to open it to find out whether "over there" is their road or the next
   town. The name answers that before the fetch, and it is what the lightbox is about to be titled
   anyway.
   Three parts, the same shape as levelLink() below: the place, then what it is and how far away as a
   caption under it. Strung on one line — "Nearest webcam · Dataran Kajang · 3.2 km" — the name is a
   fragment in the middle of a sentence that never resolves, and it breaks in the wrong place when it
   wraps. The place is what the button opens, so it goes where a reader looks first. */
export const camLink = (from, cam) => !cam ? ''
  // Same mast: an action, not an offer. There is no other place to name and no distance to state, so
  // it stays the plain one-line button it has always been.
  : from.site && from.site === cam.site
    ? `<button class="link" data-cam="${cam.id}">
         <i class="i i-photo_camera"></i> Show webcam
       </button>`
    : `<button class="link" data-cam="${cam.id}">
         <i class="i i-photo_camera"></i>
         <span class="lt">
           <b>${cam.name}</b>
           <small>Nearest webcam · ${distKm(from, cam).toFixed(1)} km away</small>
         </span>
       </button>`;

/* The reverse, for a camera standing on its own. Every other card offers the nearest picture; a
   camera card offered nothing, and a picture of water is a question about a number — "is that high?"
   — which the frame cannot answer. So it carries the nearest water level, named, with its reading.
   The reading is coloured by `color()`, the same function the pin and the card use, because the
   number alone means nothing without the mark it is measured against: 1.74 m is either a quiet river
   or a flood, and the colour is the only part of that which fits on one line. The button jumps to
   that station, where the meter states it properly.
   Only on a camera that is not on a mast with a river. Where they share a mast the card is already
   showing both, and this would be a link to the section under it. */
/* Three parts, not one line of four. "Nearest water level · TAMAN MAYANG · 14.6 m · 1.2 km" is a
   place, a reading and a distance strung together with the same separator, so it reads as a sentence
   that never resolves and it breaks in the wrong place when it wraps. The place leads, because that
   is what the button opens; what it is and how far away it is drop to a caption under it; the
   reading goes right, where every other number in this app sits. Same shape as `.popbody`, and the
   same shape camLink() uses — this one has a fourth part to place, and that is the only difference
   between them. */
export const levelLink = (from, s) => s
  ? `<button class="link" data-go="${s.id}">
       <i class="i i-${KINDS.river.icon}"></i>
       <span class="lt">
         <b>${s.name}</b>
         <small>Nearest water level · ${distKm(from, s).toFixed(1)} km away</small>
       </span>
       <b class="lv" style="color:${color(s)}">${s.level} m</b>
     </button>`
  : '';

export function meter(s) {
  const max = s.danger || s.warning || s.alert;
  const stops = levelStops(s);   // shared with the heat weight — see util.js
  if (s.level == null || !stops) return '<div class="muted">No level reading</div>';

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
   Water below the warning mark used to get no tone at all, on the grounds that a couple of
   centimetres is neither dry ground nor a warning. It read as "no reading", which is worse: a gauge
   exists to say whether a flood-prone spot is wet, and grey is the colour this app uses for a sensor
   that cannot say. Every rung comes from `gaugeTone()` now — see util.js. */
/* Third element is the table's short form: a pill in a scannable column cannot carry "water on
   ground", but it must not disagree with the popup either, so both come out of here. */
export const gaugeState = s => s.depth <= 0
  ? ['off', 'DRY GROUND', 'dry']
  : s.status >= 2 ? ['on', 'FLOODED', 'flooded']
  : s.status >= 1 ? ['warn', 'WATER RISING', 'rising']
  : ['trace', 'WATER ON GROUND', 'water'];

// A flood gauge measures water depth OVER a flood-prone spot: negative means the ground is dry.
// Several offline gauges are frozen on old flood readings, so staleness is stated, never implied.
function gaugeBlock(s) {
  if (s.depth == null) return '<div class="state">NO READING</div>';
  const wet = s.depth > 0;
  const stale = isStale(s);   // same rule the alert tiers use — see util.js
  const [tone, word] = gaugeState(s);   // shared with the table, so the two views cannot disagree
  const pct = scalePos(s.depth, gaugeStops(s));   // shared with the heat weight — see util.js
  const col = gaugeColor(s);   // same rung the pin and the table cell take

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
  const spark = s.kind === 'river' ? sparkline(s.history, 'river', s)
    : s.kind === 'gauge' && s.history?.length ? sparkline(s.history, 'gauge', s) : '';
  const wet = s.kind === 'rainfall' ? rainState(s) : '';
  // A siren has exactly one thing to say, so it gets a centred state block instead of a metric row.
  // "No signal" is only half the story — a siren that fell off the network last March must not read
  // as one that is quietly working — but the *when* is sourceInfo()'s job now, inside the sensor's
  // own info menu, rather than a sentence here and the same moment again three lines down.
  /* A doubted one says both things. `TRIGGERED` stays, because that is what the station reports and
     this card is where you come to read what it reports — but the alert panel has dropped it, and a
     card that showed the same word as a real alarm would leave that looking like a fault in the
     panel. `off` tone, because the word is now a description of a stuck relay rather than a warning
     about water.
     The line under it is written for someone standing near this siren, not for someone reading the
     rule: the verdict first, then the one fact behind it. It said "no river within 5 km is at its
     warning mark, which is what makes a siren sound — read as a stuck relay and left out of the
     alert list", which is three clauses of plumbing and never answers "so is there a flood or not".
     `5 km`, `warning mark`, `stuck relay` and the alert list are all our vocabulary, and a reader
     who wants to check us has the rivers on the same map, one tap away.
     No hedge, by the writing standard and because a hedge would be dishonest twice over: we have
     already acted on this judgement — the station is out of the alert list, off the badge and off
     the ticker — so softening the words on the one screen that explains it would hide a decision
     rather than qualify it. Say it plainly and let it be checked. */
  const stuck = s.kind === 'siren' && s.backed === false;
  const siren = s.kind !== 'siren' ? '' : !hasInfo(s)
    ? '<div class="state">OUT OF CONTACT</div>'
    : `<div class="state ${s.status > 0 && !stuck ? 'on' : 'off'}">${s.status > 0 ? 'TRIGGERED' : 'IDLE'}</div>
       ${stuck ? '<div class="muted">Faulty signal. No river nearby is high.</div>' : ''}
       ${sirenBand(s.history)}`;
  const gauge = s.kind !== 'gauge' ? '' : gaugeBlock(s);

  // A camera shows its own view; everything else offers the closest one — but a site that already
  // holds a camera has the picture right there, so the link would point at itself.
  // Either way the view of the water leads, above the numbers: "can I see it?" is the first
  // question a level on a river prompts, not the last.
  const still = s.kind !== 'camera' ? ''
    : s.image ? camImg(s, `Latest still from ${s.name}`) : '<div class="muted">No camera feed</div>';
  const link = s.kind !== 'camera' && withCam ? camLink(s, nearestCam(s)) : '';
  // Under the picture, not over it: on a camera card the frame is the reading and this is the aside.
  // `withCam` is false for a member of a mast, which is exactly the case that must not draw it.
  const level = s.kind === 'camera' && withCam ? levelLink(s, nearestLevel(s)) : '';

  return `${link}${still}${level}${siren}${gauge}${wet}
    ${s.kind === 'river' ? meter(s) : ''}
    ${body.length ? `<div class="popbody">${body.join('')}</div>` : ''}
    ${spark}${rain}`;
}

/* The one place a timestamp is printed, and it now sits inside `dots()` rather than under the card.
   Three facts, all about the plumbing: whether we are hearing from the station, the stamp on the
   last thing it sent, and which of the three feeds won the reading. Elapsed time is appended only
   where it is the point — on a live station the date is the answer and "· 4m ago" is padding.
   Not a button. It is the panel's first item because it is what the ignore action underneath it is
   read against: you silence a sensor after you decide you cannot trust it. */
function sourceInfo(s) {
  const t = s.updated || s.shot;
  const at = parseMY(t);
  const late = at && (!s.online || isStale(s));
  const when = t
    ? `${s.online ? 'Updated ' : 'Last reported '}${noSec(t)}${late ? ` · ${ago(at)}` : ''}`
    : s.online ? '' : 'Never reported';
  /* The connection state is a badge, not a glyph and a word. It is the one thing in this panel that
     is a *state* rather than a fact, and the badge is what this app already uses to say so — the
     same pill the card's own header wears. Green when we are hearing from the station, grey when we
     are not, which is the grey `hasInfo()` paints everywhere else for the same reason. */
  return `<div class="mi info">
      <span><span class="badge" style="--c:${s.online ? 'var(--s-normal)' : NO_INFO}"
          ><i class="i i-${s.online ? 'wifi' : 'wifi_off'}"></i>${s.online ? 'Online' : 'Offline'}</span>${
        when ? `<br><small class="muted">${when}</small>` : ''}${
        SOURCES[s.source] ? `<br><small class="muted">Via ${SOURCES[s.source].name}</small>` : ''}
      </span>
    </div><hr>`;
}

const region = s => `<div class="muted">${
  [s.district, s.state].filter(Boolean).join(', ') || 'district n/a'} · ${s.basin || 'basin n/a'}</div>`;

/* The favorite heart in a card header's top-right corner, beside the close button. One card kind
   carries one sensor and the other carries a mast, and they differ only in how many ids a press
   acts on. One builder for both, so the two cannot grow different shapes or different wording.
   `ids` is comma separated. ui.js's handler reads a full list as "remove every one" and anything
   short of full as "add every one", which is what makes a mast's heart fill only when all of its
   sensors are favorites while one press still acts on all of them.
   The `title` is allowed under this project's rule that a tooltip may only duplicate something
   already on screen: the glyph and its colour already report the state, and this only names the
   action they are offering. Nothing lives in the tooltip alone, so a phone loses nothing. */
const favMark = (ids, set) => {
  const says = set ? 'Remove from favorites' : 'Add to favorites';
  return `<button class="favbtn${set ? ' on' : ''}" data-fav="${ids}"
              aria-pressed="${set}" title="${says}" aria-label="${says}"
        ><i class="i i-favorite${set ? '' : '_outline'}"></i></button>`;
};

export function popup(s) {
  const kind = KINDS[s.kind];
  const tone = hasInfo(s) ? kind.color : 'var(--muted)';
  /* Place first, sensor second: you look up a popup by where it is, and the badge answers the
     follow-up question ("what is this reading?") rather than the opening one.
     The heart sits in the same corner it holds on a mast card. A single-sensor card can also be
     favorited from its ⓘ menu, which is two ways to the same switch — kept on purpose, because the
     corner is where a reader learns to look across every card, and the menu item has to stay for
     the sensors listed on a mast and on the "near this point" cards, which have no corner of their
     own. Emitted before .popname because the CSS reserves the room with a sibling rule. */
  return `<div class="pophead">
      ${favMark(s.id, isFav(s))}
      <div class="popname">${s.name}</div>
      ${region(s)}
      <div class="popact">
        <span class="badge" style="--c:${tone}">
          <i class="i i-${kind.icon}"></i>${kind.one || kind.label}
        </span>
        ${dots(s)}
      </div>
    </div>
    ${sensorBody(s)}`;
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
  /* Solid only when every sensor here is a favorite, because this button acts on all of them and
     has to state exactly what one press will undo. The pin on the map uses the opposite rule — any
     one favorite draws a heart — because that badge is an indication and not a control. */
  const favAll = members.every(isFav);
  const favIdList = members.map(m => m.id).join(',');

  /* The heart holds the corner beside the close button, where a sensor-count chip used to sit. The
     count went because the badge row directly below the name already lists one badge per sensor, so
     the chip restated what was an inch under it — and this corner is the only place on the card with
     room for a control that belongs to the whole mast rather than to one sensor on it.
     Emitted before .popname because the CSS reserves room for it with an adjacent-sibling rule. */
  return `<div class="pophead">
      ${favMark(favIdList, favAll)}
      <div class="popname">${lead.name}</div>
      ${region(lead)}
      <div class="badges">${members.map(m => {
        const k = KINDS[m.kind];
        return `<span class="badge" style="--c:${hasInfo(m) ? k.color : 'var(--muted)'}"
                ><i class="i i-${k.icon}"></i>${k.one || k.label}</span>`;
      }).join('')}</div>
    </div>
    ${hasCam ? '' : camLink(lead, nearestCam(lead))}
    ${camFirst(members).map(m => `<div class="sensor" data-sensor="${m.id}">
      <div class="sensorhead">
        <i class="glyph i i-${KINDS[m.kind].icon}" style="color:${hasInfo(m) ? KINDS[m.kind].color : 'var(--muted)'}"
          ></i>
        <b>${KINDS[m.kind].one || KINDS[m.kind].label}</b>
        ${m.name !== lead.name ? `<span class="muted">${m.name}</span>` : ''}
        ${dots(m)}
      </div>
      ${sensorBody(m, false)}
    </div>`).join('')}`;
}

/* "What is near where you are". The nearest camera's picture leads, then one section per kind with
   the full sensor body — meter, trend, sparkline, footer. A line of summary is enough to rank four
   stations and not enough to answer "is this bad?", which is the question anyone opens this card to
   ask.
   The one thing this card must say that a mast's need not is *where each sensor is*. On a station
   card the header names the place once and every sensor shares it. Here the four are four different
   places, so each section carries its own name, district and distance — and the name is the jump to
   it, because that station is somewhere else on the map.
   `NEAR_MAX_KM` bounds every kind but the camera. Past it the section says so rather than naming a
   sensor that shares no catchment with the point asked about. A siren 60 km from a reader was never
   a useful answer.
   This took a head and a cap as parameters while a searched place drew the same card with an accent
   badge. That card is gone — a place search now answers with the stations near it, listed in the
   search box itself (see `nearPlace` in ui.js) — and with one caller left the two parameters were
   two ways to build one card. Built fresh on every open, so it reflects the latest poll rather than
   the fix's own timestamp. */
export function herePopup(e, loaded) {
  if (!loaded) return '<b>You are here</b><br><span class="muted">Stations still loading…</span>';
  const at = e.latlng;
  const rows = ['river', 'rainfall', 'siren', 'gauge'].map(k => {
    const kind = KINDS[k];
    let s = nearestOf(k, at);
    if (s && distKm(at, s) > NEAR_MAX_KM) s = null;
    /* `title`, not `head`: the card's own head is written below, and shadowing that name inside the
       callback would put a sensor's glyph where the card's badge belongs. */
    const title = `<i class="glyph i i-${kind.icon}"
        style="color:${s ? kind.color : 'var(--muted)'}"></i><b>${kind.one || kind.label}</b>`;
    // nearestOf() only ever returns a station that is reporting, so there is no "no reading" case
    // here — either the nearest one inside the cap has something to say or nothing does.
    if (!s) return `<div class="sensor">
      <div class="sensorhead">${title}</div>
      <div class="muted">No ${kind.label.toLowerCase()} within ${NEAR_MAX_KM} km</div>
    </div>`;
    return `<div class="sensor" data-sensor="${s.id}">
      <div class="sensorhead">${title}
        <span class="muted">${distKm(at, s).toFixed(1)} km</span>
        ${dots(s)}
      </div>
      <div class="place" data-go="${s.id}" title="Show ${s.name} on the map">${s.name}</div>
      ${region(s)}
      ${sensorBody(s, false)}
    </div>`;
  }).join('');

  return `<div class="pophead">
      <span class="badge" style="--c:var(--me)"><i class="i i-home_pin"></i>You are here</span>
      <div class="muted">Accurate to about ${Math.round(e.accuracy)} m</div>
    </div>${camNear(at, nearestCam(at))}${rows}`;
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
  /* The right edge, named. Every other label is a clock time, so the end of the line was one more
     hour to read against the clock in the corner of the screen — and it is the end a reader looks at
     first. `now` says which end that is without a second reading of the axis.
     It is the *newest sample*, not the wall clock, and those are up to half an hour apart: JPS moves
     a value about every 25 minutes. Within the hour that is what "now" means for this station,
     because there is nothing more recent to have. Past an hour the graph has stopped being current
     and takes no label at all rather than a false one — the same rule the rest of the app follows
     for a reading it can no longer vouch for.
     `now: 1` keeps it off `rules()`: a vertical line on the border of the plot is not a gridline. */
  if (Date.now() / 1000 - t1 < 3600) {
    if (100 - ticks.at(-1)?.x < 8) ticks.pop();   // no room for both labels at that end
    ticks.push({ x: '100.00', at: 'now', now: 1 });
  }
  return { t0, t1, secs, inWin, x, ticks, step };
}

/* A label is centred on its tick, unless that would hang it over an edge of the panel — then it sits
   inside the edge instead. The shift is decided from where the tick is on the axis, which is the
   thing that actually decides whether it fits. CSS used to do it with `:first-child` and
   `:last-child`, which is a guess at the same question: it is right whenever the first tick is at 0
   and the last at 100, and wrong the rest of the time. With one tick on the graph it was both, the
   right-hand rule won, and the only label on a new station's graph was dragged off the left of the
   card.
   8% of a 300px panel is 24px, and a label is about 34px wide — so a tick inside that band cannot be
   centred without crossing the edge, and outside it always can. */
const axisHtml = ticks => `<div class="axis muted" aria-hidden="true">${ticks.map(t =>
  `<span style="left:${t.x}%;transform:translateX(${t.x < 8 ? 0 : t.x > 92 ? -100 : -50}%)"
    >${t.at}</span>`).join('')}</div>`;

const rules = ticks => ticks.filter(t => !t.now).map(t =>
  `<line x1="${t.x}" x2="${t.x}" y1="0" y2="28" vector-effect="non-scaling-stroke"/>`).join('');

/* What the hover readout says, baked here rather than shipped as bare numbers: each graph knows its
   own units and its own words for a value, and js/sparktip.js is deliberately one listener for all
   three. `[x%, label]` per sample, so the module needs no scale, no clock and no notion of what it
   is pointing at. Single-quoted attribute, because JSON quotes with double ones. */
/* How a sample's own status is dressed in the readout: the colour to print it in, and whether it
   earns a warning glyph. **A normal reading is printed plain** — the readout's own ink, black on
   white or white on black with the theme — because a colour on every sample is a colour that says
   nothing on the samples that matter. Only a sample past a published mark takes a hue, and every
   sample that takes one also takes the glyph: the colour and the triangle are one statement, so a
   tinted number can never be the only warning a reader has to notice.
   Keyed by kind because the ramps answer different questions. A river takes the traffic light from
   its first mark up (`RIVER_COLOR`): amber at the alert mark, orange at the warning mark, red at
   danger. Rainfall has no marks of its own, only JPS's four intensity classes, so it stays plain up
   to *heavy* — light and moderate rain is most of the rain there ever is, and a warning triangle on
   a drizzle is the cry-wolf failure the alert standard is about.
   A flood gauge keeps `--s-trace` at rung 1 and no glyph with it: that is real water under the first
   published mark, so it is neither normal nor a threshold pass. Its glyph starts at rung 2, the
   0.15 m warning. This is not a new alert surface and does not widen `isCritical()`: it is a readout
   under a pointer, on a sample somebody went looking for, and it counts nothing, badges nothing and
   interrupts nobody. The alert standard is about what claims attention; this waits to be asked.
   The code itself is `api.php`'s — see `sparkPoints()`. Nothing here derives a status.
   A siren is the exception, and it needs no scorer anywhere: its samples *are* its status, 0 or 1,
   so it reads the value rather than a code. A sounding siren takes the danger red, the same answer
   `atDanger()` already gives for the pin beside it. Each scorer therefore takes both, and a kind
   that leaves a sample unscored hands its scorer `undefined` — every comparison below is false
   against that, which is the plain print. */
const TONE = {
  river:    c => [c > 0 ? RIVER_COLOR[c] : c < 0 ? NO_INFO : '', c >= 1],
  rainfall: c => [c > 2 ? RAIN_COLOR[c]  : c < 0 ? NO_INFO : '', c >= 3],
  gauge:    c => [c > 0 ? GAUGE_COLOR[c] : '', c >= 2],
  siren:    (c, v) => [v > 0 ? statusColor(3) : '', v > 0],
};

/* `[x%, text, colour, warn]` per sample. The last two are empty on a normal reading and on a kind
   with no status to give, and js/sparktip.js treats both as "print it plain" — so no reader needs a
   special case. */
const readout = (inWin, x, label, kind) => ` data-pts='${JSON.stringify(
  inWin.map(([t, v, c]) => {
    const [col, warn] = TONE[kind]?.(c, v) || [];
    return [+x(t), `${label(v)} · ${MYT_CLOCK.format(t * 1000)}`, col || '', warn ? 1 : 0];
  }))}'`;

/* Area fill under a line. Two stops rather than a fade to nothing: at the bottom the shape has to
   read as a mass, at the top it has to not compete with the line drawn on it. Ids are minted
   per call because several of these can be on the page at once — a duplicate id and every chart
   silently takes the first one's colour. */
let fillId = 0;
const areaFill = c => {
  const id = `af${++fillId}`;
  // `style`, not a `stop-color` attribute — the palette is `var()` tokens now (see config.js), and a
  // presentation attribute does not resolve one. Same rule as the siren band's bars below.
  return [id, `<defs><linearGradient id="${id}" x1="0" x2="0" y1="1" y2="0">
    <stop offset="0" style="stop-color:${c}" stop-opacity=".6"/>
    <stop offset="1" style="stop-color:${c}" stop-opacity=".1"/>
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
/* Which rung of the traffic light each published mark is. `statusColor()` and nothing else, because
   these are the same three marks the meter draws and a fourth spelling of amber is how palettes
   drift. A flood gauge publishes only the upper two, and they land on the same two rungs. */
const MARK_RUNG = { alert: 1, warning: 2, danger: 3 };

export function sparkline(points, kind = 'river', st = null) {
  // "As we poll" told the reader about our timer. What they need is that the graph fills itself in.
  if (!points || points.length < 2) return '<div class="muted">Graph builds as readings arrive</div>';

  // The axis spans the readings we actually hold, up to a 12-hour cap — so two hours of history
  // draws as two labelled hours rather than a sliver at the edge of a mostly empty 12-hour frame.
  const { secs, inWin, x, ticks } = timeAxis(points);
  if (inWin.length < 2) return `<div class="muted">No readings in the last ${SPARK_H} hours</div>`;

  const vals = inWin.map(([, v]) => v);
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals);

  /* The station's own marks, drawn across the graph — but only the ones the water is anywhere near.
     The y axis spans the readings and nothing else, because the readings are the point: a river that
     moved 8 cm in twelve hours has to draw those 8 cm as a shape. Stretching the axis up to a danger
     mark three metres above would flatten that shape to a flat line under a red rule, which says
     less than the graph did before, on the 89 of 105 rivers that are nowhere near their marks.
     So a mark is drawn only when it is within one *data span* of the readings, and the axis grows
     only that far. That is the rule stated as a guarantee: the readings always keep at least half
     the height of the graph, so the shape survives every mark that is ever drawn. A mark further
     away than the river has moved all day is not something this graph can show without becoming a
     worse graph, and the meter directly above states all three with their values anyway.
     Perfectly flat readings have no shape to protect, so they fall back to the alert→danger gap —
     the unit `levelStops()` uses for the foot of the meter, and the only thing the feed publishes
     about how far this river travels when it matters.
     On the payload this was measured: 10 of 105 rivers draw a mark on a quiet day, and any station
     climbing into trouble draws them all the way up, which is when they are worth having.
     No labels on them. Text in a stretched viewBox distorts, and the meter directly above names all
     three marks with their values, in these exact colours. */
  const named = kind === 'gauge' ? ['warning', 'danger'] : ['alert', 'warning', 'danger'];
  const top = st?.danger ?? st?.warning ?? st?.alert;
  const first = st?.alert ?? st?.warning ?? top;
  const reach = (hi0 - lo0) || (top > first ? top - first : 1);
  const marks = !st ? [] : named.map(n => [n, st[n]])
    .filter(([, v]) => v != null && v <= hi0 + reach && v >= lo0 - reach);

  const lo = Math.min(lo0, ...marks.map(m => m[1]));
  const hi = Math.max(hi0, ...marks.map(m => m[1]));
  const span = hi - lo || 1;
  const y = v => (26 - (v - lo) / span * 24).toFixed(2);
  const marked = marks.map(([n, v]) =>
    `<line class="mk" x1="0" x2="100" y1="${y(v)}" y2="${y(v)}" vector-effect="non-scaling-stroke"
      style="stroke:${statusColor(MARK_RUNG[n])}"/>`).join('');
  const pts = inWin.map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
  // The station's own colour, not a red-for-rising / green-for-falling line. Direction is already
  // stated next to it as a rate with an arrow, and a traffic-light hue on a *type* is the one thing
  // the colour language here does not allow — green on a graph reads as "fine", which is not
  // something a shape over 12 hours is entitled to say.
  const col = KINDS[kind].color;
  const [id, defs] = areaFill(col);

  return `<div class="spark"${readout(inWin, x, v => `${v} m`, kind)}>
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${defs}
      ${rules(ticks)}
      <polygon points="${x(inWin[0][0])},28 ${pts} ${x(inWin.at(-1)[0])},28" fill="url(#${id})"/>
      ${marked}
      <polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"
        style="stroke:${col}" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">${lo.toFixed(2)}–${hi.toFixed(2)} m over ${spanText(secs)}</div>
  </div>`;
}

/* A siren's last 12 hours, as a band rather than a graph. Its samples are status codes, not a
   quantity, so there is no shape to plot: a polyline between them would draw ramps up and down that
   never happened, and an axis of "0–2" is not a number anyone reads. What the pin is opened to ask is "has this thing
   gone off today", and a strip that is either quiet or red answers it at a glance.

   Each sample owns the span up to the next one. A gap longer than an hour and a half is left blank
   for the same reason the rain chart breaks its area there: an unbroken quiet band across a hole in
   the record says the siren was silent, in exactly the same shape as a siren that was measured
   silent. Quiet is drawn in the outline colour, not green — the state block above already carries
   the green, and a 12-hour reassurance is more than a log of samples is entitled to give. */
export function sirenBand(points) {
  if (!points || !points.length) return '<div class="muted">Log builds as readings arrive</div>';

  const { t1, secs, inWin, x, ticks } = timeAxis(points);
  if (!inWin.length) return `<div class="muted">No readings in the last ${SPARK_H} hours</div>`;

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

  /* A time, not a tally. "Sounded in 11 of 11 readings" counted our polls, which is our business and
     not the reader's — the same siren behind a slower poll would say "3 of 3" and mean the same
     thing, and neither number says when it went off. The question a siren log is opened with is when
     it last sounded, so that is what the line says. */
  let i = inWin.length - 1;
  const live = inWin[i][1] > 0;
  if (live) while (i > 0 && inWin[i - 1][1] > 0) i--;   // back to the start of the run still running
  else while (i >= 0 && !inWin[i][1]) i--;              // back to the last sample that was on
  // `.band` keeps the shorter box. A siren log is a state over time, not a shape — there is nothing
  // in it that a quarter more height would draw better, and the difference in height is what says
  // this is not a reading. See base.css.
  // Capitalised, because the readout prints this word where every other graph prints a number, and
  // a lower-case word beside `1.74 m` reads as a fragment of a sentence rather than a reading.
  return `<div class="spark band"${readout(inWin, x, v => v > 0 ? 'Sounding' : 'Quiet', 'siren')}>
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${rules(ticks)}${bars}
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">${i < 0 ? `silent for the last ${spanText(secs)}`
      : `${live ? 'sounding since' : 'last sounded'} ${MYT_CLOCK.format(inWin[i][0] * 1000)}`}</div>
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
  if (!points || !points.length) return '<div class="muted">Graph builds as readings arrive</div>';

  const { secs, inWin, x, ticks } = timeAxis(points);
  if (!inWin.length) return `<div class="muted">No readings in the last ${SPARK_H} hours</div>`;

  const hi0 = Math.max(...inWin.map(([, v]) => v));
  // All zeroes is a real answer, and a row of flat bars states it worse than a sentence does.
  if (!hi0) return `<div class="muted">No rain in the last ${spanText(secs)}</div>`;

  /* JPS's intensity classes, drawn across the plot — moderate at 10 mm/h, heavy at 30, the top class
     at 60. `RAIN_STOPS` holds the same boundaries for the heat gradient, so the graph and the map
     cannot disagree about where heavy rain starts, and index i is the lower bound of code i+1.
     Same rule as the level graph: a class is drawn only when it is within one data span of the
     readings, and the axis grows only that far, so the readings keep at least half the height. The
     axis is zero-based here, so the span is the peak itself — 4 mm/h of drizzle does not get its
     graph flattened to draw a line at 60. */
  const marks = RAIN_STOPS.map(([v], i) => [v, i + 1]).slice(1).filter(([v]) => v <= hi0 * 2);
  const hi = Math.max(hi0, ...marks.map(m => m[0]));

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

  return `<div class="spark"${readout(inWin, x, v => `${v} mm/h`, 'rainfall')}>
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      ${defs}
      ${rules(ticks)}
      ${marks.map(([v, code]) => `<line class="mk" x1="0" x2="100" y1="${y(v)}" y2="${y(v)}"
        vector-effect="non-scaling-stroke" style="stroke:${RAIN_COLOR[code]}"/>`).join('')}
      ${segs.filter(s => s.length).map(s => {
        const pts = s.map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
        // A lone reading has no line to draw, so it gets a sliver wide enough to see.
        if (s.length === 1) return `<rect x="${Math.min(+x(s[0][0]), 99).toFixed(2)}" y="${y(s[0][1])}"
          width="1.6" height="${(28 - y(s[0][1])).toFixed(2)}" fill="url(#${id})"/>`;
        return `<polygon points="${x(s[0][0])},28 ${pts} ${x(s.at(-1)[0])},28" fill="url(#${id})"/>
          <polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"
            style="stroke:${KINDS.rainfall.color}" stroke-width="1.5" stroke-linejoin="round"/>`;
      }).join('')}
    </svg>
    ${axisHtml(ticks)}
    <div class="muted">Peak ${hi} mm in an hour · last ${spanText(secs)}</div>
  </div>`;
}
