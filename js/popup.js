// Every popup shares one template: badge + name + region header, then a kind-specific body, then a
// status footer. The same meter/state blocks are reused by the alert panel.

import { KINDS, SOURCES, SPARK_H, NO_INFO, ALERT_TITLE, RIVER_COLOR, RAIN_COLOR,
         GAUGE_COLOR, RAIN_STOPS, NEAR_MAX_KM, camSrc, WEATHER, MET_NAME,
         ACC_ROWS } from './config.js';
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

/* The words, with no markup around them. Two surfaces want them and they draw differently: the
   lightbox pill sits on the photograph, and a camera tile on the wall carries them under it. The
   phrase itself must stay one string in one place, or one river makes two claims. */
export const camPhrase = (cam, a = camAlert(cam)) => {
  if (!a) return '';
  const s = a.station;
  const [field, unit] = CAM_READ[s.kind] || [];
  // Gated on the kind having a reading at all, not on what was handed in: a siren's samples are 0
  // and 1, so an archive frame passes `level: 1` and a phrase that trusted it would print "1".
  const lv = !field ? null : 'level' in a ? a.level : s[field];
  const what = ALERT_TITLE[`${s.kind}|${a.tier}`]?.[0] || KINDS[s.kind].label;
  return `${what}${lv == null ? '' : `, ${lv}${unit}`}`;
};

export const camWarn = (cam, a = camAlert(cam)) => {
  const words = camPhrase(cam, a);
  return words
    ? `<span class="camwarn t-${a.tier}"><i class="i i-warning"></i><b>${words}</b></span>` : '';
};

/* JPS publishes no feed for this camera. A muted line stood here, which left the card a line of text
   where every other camera card holds a picture. The wall already had the shape for it — its own
   failed tile — so this is that box, in flow, with the same words. One fact, one look: see
   `.camfail` in css/base.css. `camImg()` below ships the same box for a feed that fails to load. */
const camNone = '<div class="camfail shotnone"><i class="i i-videocam_off"></i><b>No picture</b></div>';

/* Spinner lives on the wrapper; the img clears it on load, or takes itself off the card on failure.
   `data-clip` is the hook js/clip.js looks for — it carries the numeric camera id the proxy uses,
   not the station id, because that is what ?sheet=, ?shots= and ?shot= all take.
   No warning pill here any more. This still is a 3-hour clip that plays itself (see js/clip.js), so
   the pill stated the live alert over a frame from hours ago — the same wrong claim the lightbox was
   just fixed for, and this one has no scrubber, no seek bar and no room to answer it per frame. The
   card around the picture already carries the alerting sensor as a section of its own, with the
   reading, the meter and the graph. The lightbox keeps its pill, where every frame is scored.
   A failed picture leaves the same `No picture` box a camera with no feed at all gets, rather than
   the `image unavailable` line it printed before — that line collapsed the still's box to one line
   of text, and named in a third way a fact the wall and the no-feed card already name. The box ships
   with every card and css/base.css hides it while the picture is there, so the handler stays one
   expression. The picture is **removed**, not hidden: `tick()` in js/clip.js reads `isConnected` on
   that element as its signal to stop a clip whose frames have started failing. */
export const camImg = (c, alt) => `<div class="shotwrap" data-clip="${c.id.split('-')[1]}">
  <img class="shot" src="${camSrc(c)}" alt="${alt}" data-name="${c.name}"
       onload="this.parentNode.classList.add('done')"
       onerror="this.parentNode.classList.add('done'); this.remove()">
  ${camNone}
  <p class="clipcap"></p></div>`;

/* The favorite, as a menu row. `ids` is comma separated: ui.js's handler reads a full list as
   "remove every one" and anything short of full as "add every one", which is what lets one press on
   a mast act on all of its sensors. The glyph fills and turns `--fav` on the set state, the same two
   marks the heart wore in the card's corner, so the row still reports the state it is about to
   change. Never a `--s-*` colour: a favorite is not a status. */
const favItem = (ids, set) => `<button class="mi" data-fav="${ids}"
    ><i class="i i-favorite${set ? '' : '_outline'}"
       style="color:${set ? 'var(--fav)' : 'var(--muted)'}"></i>
    <span>${set ? 'Remove from favorites' : 'Add to favorites'}</span>
  </button>`;

/* The ⋮ on every sensor: where this reading came from, when, and everything you can do to it.
   The glyph has been round the loop. It was a ⋮ holding a single "ignore" item, which promised
   actions and held one, so it became an ⓘ — and the provenance moved into it from a footer line
   that printed three facts about *us* on every sensor of a six-sensor mast. The menu now carries
   the favorite, the nearest webcam or water level, the map link and the ignore, so it is four
   actions behind an information glyph. It is a ⋮ again, and the argument that took it away is what
   put it back: name the menu for what is in it. The first ⋮ was wrong for holding one action, not
   for being a ⋮.
   The provenance stays where it is. It is what you check when you doubt the number, so it lives one
   tap from the number, and the card is the reading again.
   `popover` + `popovertarget` gives toggle, light dismiss and Esc for nothing; the panel lands in
   the top layer, so the station panel's own scrolling box can't clip it. Placement is ui.js's — CSS
   anchor positioning is still Chromium-only. Ids are safe because the panel holds one card at a
   time, so only one copy of a given sensor's menu is ever in the document. */
/* `extra` is the nearest webcam or water level, and only the card *header* passes one. A mast lists
   its sensors with a menu on each, and that offer belongs to the place rather than to the rainfall
   gauge whose row happens to hold it. */
export const dots = (s, extra = '') => `<button class="icon dots" popovertarget="mnu-${s.id}"
    title="Details" aria-label="Details and actions for ${s.name}"><i class="i i-more_vert"></i></button>
  <div id="mnu-${s.id}" class="menu surface" popover>
    ${sourceInfo(s)}
    ${favItem(s.id, isFav(s))}
    ${extra}
    ${mapLink(s)}
    <button class="mi" data-ignore="${s.id}"><i class="i i-visibility_off"></i>
      <span>Ignore this sensor</span>
    </button>
  </div>`;

/* A mast's own menu, in the corner where a single-sensor card carries the sensor's ⋮.
   It holds what belongs to the whole place and nothing else. No provenance, because six sensors have
   six answers. No ignore, because that is a request about one sensor and every sensor's own row
   already offers it. The favorite acts on all of them, which is the one thing this menu can say that
   none of the rows below it can. */
const siteDots = (lead, ids, all, extra) => `<button class="icon dots" popovertarget="mnu-site-${lead.id}"
    title="Details" aria-label="Details and actions for ${lead.name}"><i class="i i-more_vert"></i></button>
  <div id="mnu-site-${lead.id}" class="menu surface" popover>
    ${favItem(ids, all)}
    ${extra}
    ${mapLink(lead)}
  </div>`;

/* Where this station is, on a map that knows about roads. This app answers "what is the water
   doing"; it holds no route, no street view and no satellite tile, and every one of those is the
   next question somebody asks about a place they can see is flooding.
   An `<a>`, not a button with a script behind it — the browser already knows how to open a link in a
   tab, and on a phone it hands the coordinate to the Maps app. `?api=1` is Google's documented
   cross-platform form, so it does the same thing on every device.
   It is a link and not a fetch, so the About pane's "loads no tracking script" claim is untouched:
   nothing reaches Google until the reader chooses to go there. The GitHub links in that same dialog
   are the same class of thing. A station with no coordinate simply has no item — the national portal
   publishes none, and those stations are only reachable from the table. */
const mapLink = s => !s.lat || !s.lng ? '' : `<a class="mi" target="_blank" rel="noopener"
      href="https://www.google.com/maps/search/?api=1&amp;query=${s.lat},${s.lng}"
    ><i class="i i-place"></i><span>Open in Google Maps</span></a>`;

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

/* Everywhere else — every station card, every mast card — the nearest thing is offered, not shown.
   The alert panel would be N proxied fetches at JPS for pictures of places you are scrolling past.
   A station card would be one picture you did not ask for.
   It is a row in the card's own menu. It was a full-width button under the header, carrying a second
   bold place name above the reading, and then a bare glyph in the header corner with the name in a
   `title` — which a phone never opens. A menu row is the shape that states the name, the distance
   and the reading in plain text and still costs the card no height.
   `.mi`, the same row the menu's other items use. The glyph names the kind, so a reader who opens
   the menu for the favorite reads what else is here without a legend.
   What the row *is* leads, and what it found follows. The station name led first, with the label and
   the distance underneath, which named a place before saying why it was on the menu. It also gave
   the row no fixed first line, so the empty case had nothing to be the short version of. Both rows
   now read `Nearest webcam` or `Nearest water level`, then the place and the distance, or the reason
   there is neither. */
const nearItem = (icon, attr, what, note, right = '') =>
  `<button class="mi" ${attr}><i class="i i-${icon}"></i>
     <span>${what}<br><small class="muted">${note}</small></span>${right}</button>`;

/* A camera on the *same mast* is not a nearest-anything. It is this station's own view, so it names
   no place and drops the distance, which would read "0.0 km". `from` may be a bare latlng from a map
   click, which has no `site` — hence the guard rather than a plain comparison.
   With nothing inside the cap the row is still drawn, `disabled`, saying so. It used to print
   nothing at all, so the menu on one station held five items and the menu on the next held four,
   and a reader who had seen the offer once had no way to tell "there is none" from "the app forgot".
   The empty row states no distance: the cap is ours, and a reader wants the verdict rather than our
   arithmetic. */
export const camLink = (from, cam) => !cam
  ? nearItem('photo_camera', 'disabled', 'Nearest webcam', 'No webcam nearby')
  : from.site && from.site === cam.site
    ? `<button class="mi" data-cam="${cam.id}"><i class="i i-photo_camera"></i>
         <span>Show webcam</span></button>`
    : nearItem('photo_camera', `data-cam="${cam.id}"`, 'Nearest webcam',
        `${cam.name} · ${distKm(from, cam).toFixed(1)} km away`);

/* The reverse, for a camera standing on its own. Every other card offers the nearest picture. A
   camera card offered nothing, and a picture of water is a question about a number — "is that high?"
   — which the frame cannot answer. So it carries the nearest water level, named, with its reading.
   The reading takes `color()`, the same function the pin and the card use, because the number alone
   means nothing without the mark it is measured against: 1.74 m is either a quiet river or a flood.
   The row jumps to that station, where the meter states it properly.
   Only on a camera that is not on a mast with a river. Where they share a mast the card already
   shows both, and this would point at the section under it. */
export const levelLink = (from, s) => !s
  ? nearItem(KINDS.river.icon, 'disabled', 'Nearest water level', 'No water level nearby')
  : nearItem(KINDS.river.icon, `data-go="${s.id}"`, 'Nearest water level',
      `${s.name} · ${distKm(from, s).toFixed(1)} km away`,
      `<b class="mv" style="color:${color(s)}">${s.level} m</b>`);

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
function sensorBody(s) {
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

  // A camera shows its own view. The offer of the nearest one, and a camera card's offer of the
  // nearest water level, are both in the card header now — see nearBtn() above.
  const still = s.kind !== 'camera' ? ''
    : s.image ? camImg(s, `Latest still from ${s.name}`) : camNone;

  return `${still}${siren}${gauge}${wet}
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

/* The card's title is also the way back to its pin. The panel does not move when the map does, so a
   pan or a zoom leaves a reader holding a card with no idea which part of the screen it describes —
   and the card is often opened from a list, a search or the alert panel, where the map was never
   looked at. `data-go` is the jump every other list already uses (see ui.js), so this costs one
   attribute: it centres the pin and names it on the map for the length of the ripple.
   Emitted after the heart, because the CSS reserves that corner with an adjacent-sibling rule. */
const goName = s =>
  `<div class="popname" data-go="${s.id}" title="Show ${s.name} on the map">${s.name}</div>`;

/* This code reads the hour in Malaysia. It does not read the hour where the reader sits.
   Every time on this page is MYT, because JPS stamps its readings that way. A moon beside a
   reading stamped 14:00 is a contradiction. Night runs 19:00 to 06:59. Near the equator the sun
   moves by under half an hour across the year. A fixed pair of hours needs no almanac. */
const MYT_H = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hour12: false,
});
const night = () => { const h = +MYT_H.format(new Date()); return h >= 19 || h < 7; };

/* One glyph name for a rung. Only a clear sky has a night form. */
const wxIcon = r => {
  const w = WEATHER[r] || WEATHER[0];
  return (night() && w.night) || w.icon;
};

/* The weather section's ⋮, and it holds provenance alone. Every other ⋮ on a card carries actions
   under the same block — favorite, map link, ignore — and not one of them applies here. A favorite
   is a place, a map link is a coordinate, and `PREFS.ignored` silences a sensor. The weather is none
   of those, and an action that acts on nothing is worse than an absent one.
   Two facts, the same two `sourceInfo()` gives a sensor: when the reading was made, and who made it.
   `stamp` is MET's own issue time and never our poll time, so the clock is the one MET published.
   Elapsed time is printed beside it always, where `sourceInfo()` prints it only on a stale station:
   a station card states a full date and this states a clock, and `14:50` alone cannot say whether
   MET has been quiet since yesterday.
   The nearest point and its distance are NOT here. They spent a revision in this menu, on the
   reading that a claim from 14 km away is a different claim from one made next door, and the ⋮ is
   where this app puts that kind of doubt. The doubt turned out to be the reading itself. `MET_KM`
   The distance IS here, and the point is not. The point names the reading and belongs in the head,
   beside the word Weather, where every other sensor on the card names its own. The distance is a
   number, and a number in a head is a claim the other heads then have to answer: a camera would owe
   its metres, a river its own. This card holds one distance in one place and this is the place.
   Two facts, then, and both are about the plumbing: when MET issued this, and how far away. */
const wxDots = m => `<button class="icon dots" popovertarget="mnu-met"
    title="Details" aria-label="Details about this weather"><i class="i i-more_vert"></i></button>
  <div id="mnu-met" class="menu surface" popover>
    <div class="mi info"><span>
      ${!m.stamp ? '' : `<small class="muted">Updated ${
        MYT_CLOCK.format(m.stamp * 1000)} · ${ago(m.stamp * 1000)}</small><br>`}
      <small class="muted">Via ${MET_NAME}${m.km == null ? '' : ` · ${m.km} km away`}</small>
    </span></div>
  </div>`;

/* The MET section. Two cells, `Now` and `Later`, each one glyph beside the words that belong to it.
   This section appears once per card and never once per sensor. Rain over a place is one fact, and
   sourceInfo() already taught this app what a per-place fact costs when it repeats down a mast.
   The point sits in the section head, in the `.muted` slot every other sensor head on this card
   uses for the same job. A camera section prints its own station name there, and this prints where
   the forecast was read. One slot, one meaning: what this reading is about, when the heading beside
   it does not say. `.sensorhead .muted` already right-aligns it and truncates it, so this costs one
   span and no rule. The distance stays in the ⋮ and the note on `wxDots()` says why.
   Two other placements came first. Beside the heading at the top of the card, where the place name
   competed with the station name. Then inside the ⋮ with the distance, which is a tap away and
   therefore unread. Both cost the same thing: without a visible name, a card states a local
   forecast from a point up to `MET_KM` away and gives a reader nothing to weigh it against. The
   point for ULU YAM is 11.7 km off over high ground, and `MET_KM` reaches 16.5 km. The gate above
   guarantees `at` is there, because MET fills it with `now`.
   `Later` reads rung, the worst rain in the three-hour window, so the glyph and the sentence beside
   it describe one window. It read hr1 once, which drew a clear sky next to the words `Rain 12:00`.
   hr1 stays in the payload to answer a different question: will it rain in one hour.
   The section is all or nothing. 53 of 677 stations sit inside a forecast district but outside
   MET_KM of any nowcast point, so they carry a temperature and no rain at all. That drew a heading,
   a glyph and two numbers under the word `Now`, which reads as a weather panel that failed to load
   rather than as the two facts MET published. A half-drawn section costs a reader more than the
   temperature is worth, so a station missing any part of the outlook shows no weather at all. The
   grid's first column stays `auto`, because a cell must still size to itself and not stretch. */
function metSection(s) {
  const m = s.met;
  // ponytail: one gate for the whole section. Widen only if a partial shape is worth drawing again.
  if (!m || m.now == null || m.hr1 == null || m.tmax == null || m.tmin == null) return '';

  const w = r => WEATHER[r] || WEATHER[0];

  /* Four shapes, and every one names both ends. `until` says the rain ends. `past` says the MET
     outlook ended, and never that the rain did. A fifth shape for the dry case: `metSpan()` returns
     null when no step in the window is wet, so there is no span to word. The cell said nothing at
     all then, and a glyph on its own is not an answer to "what happens next". */
  const rain = m.rung == null ? 'No rain in the next 3 hours' :
    `${w(m.rung).line}${m.from ? ` ${m.from}${m.open ? ',' : ''}` : ''} `
    + `${m.open ? 'past' : 'until'} ${m.to}`;

  /* The glyph is the state, so the state is not also written under it. The word rides on `data-tip`,
     which `js/sparktip.js` opens on hover and on a tap — a `title` would say nothing to a thumb.
     `aria-label` carries the same word for a reader who hears the card instead. */
  const big = r => `<i class="i wxbig i-${wxIcon(r)}" role="img"`
    + ` aria-label="${w(r).word}" data-tip="${w(r).word}"></i>`;

  /* Two columns, each one glyph and the words that belong to it. The two temperatures stack, high
     over low, and neither one is labelled — the order says which is which, and the same pair in
     one line made a reader work it out. `data-tip` names both ends for anyone the order does not
     answer, on the same hover and the same tap as the glyph beside it. */
  const now = m.now == null && m.tmax == null ? '' : `<div class="wxcol">
      <div class="wxrow">
        ${m.now == null ? '' : big(m.now)}
        ${m.tmax == null ? '' : `<span class="wxtemp" data-tip="Max ${m.tmax}° · Min ${m.tmin}°">
          <span>${m.tmax}°</span><span>${m.tmin}°</span>
        </span>`}
      </div>
      <span class="wxsub">Now</span>
    </div>`;

  const later = m.rung ?? 0;
  const out = m.hr1 == null ? '' : `<div class="wxcol">
      <div class="wxrow">
        ${big(later)}
        <span class="wxline">${rain}</span>
      </div>
      <span class="wxsub">Later</span>
    </div>`;

  return `<div class="sensor" data-sensor="@met">
      <div class="sensorhead">
        <i class="glyph i i-${wxIcon(m.rung ?? m.now ?? 0)}" style="color:var(--k-weather)"></i>
        <b>Weather</b>
        <span class="muted">${m.at}</span>
        ${wxDots(m)}
      </div>
      <div class="wx">${now}${out}</div>
    </div>`;
}

export function popup(s) {
  const kind = KINDS[s.kind];
  const tone = hasInfo(s) ? kind.color : 'var(--muted)';
  /* Place first, sensor second: you look up a popup by where it is, and the kind answers the
     follow-up question ("what is this reading?") rather than the opening one.
     The kind is said twice, and the two say it to two readers. The badge in the header answers
     "what is this place" at a glance, which is what a Monitoring Station's row of badges answers on
     the other card. The section heading below answers "what am I looking at" over the reading
     itself, which is the section a Monitoring Station gives each of its sensors. A node card and a
     station card now draw the reading the same way.
     One control in the corner, on the close button's line, and it is the ⋮. A favorite heart held
     that slot, and then a webcam glyph beside the heart — two controls owing the title 108px of a
     328px line, and standing a hair above the district under them. Both are rows in this menu now,
     which is the same menu that has always carried the favorite for the sensors listed on a mast and
     on the "near this point" card. The corner costs the title 68px for one control rather than 108
     for two, and the rows state a station name, a distance and a reading in text that a glyph could
     only have put in a `title`.
     Emitted first, because the CSS reserves the room with a sibling rule. */
  const near = s.kind === 'camera' ? levelLink(s, nearestLevel(s)) : camLink(s, nearestCam(s));
  return `<div class="pophead">
      ${dots(s, near)}
      ${goName(s)}
      ${region(s)}
      <span class="badge" style="--c:${tone}">
        <i class="i i-${kind.icon}"></i>${kind.one || kind.label}
      </span>
    </div>
    ${metSection(s)}
    <div class="sensor" data-sensor="${s.id}">
      <div class="sensorhead">
        <i class="glyph i i-${kind.icon}" style="color:${tone}"></i>
        <b>${kind.one || kind.label}</b>
      </div>
      ${sensorBody(s)}
    </div>`;
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
  /* Set only when every sensor here is a favorite, because this row acts on all of them and has to
     state exactly what one press will undo. The pin on the map uses the opposite rule — any one
     favorite draws a heart — because that badge is an indication and not a control. */
  const favAll = members.every(isFav);
  const favIdList = members.map(m => m.id).join(',');

  /* The mast's menu holds the corner beside the close button, the same slot a single-sensor card
     gives its sensor's ⓘ. A sensor-count chip held it first, then the favorite heart, then the heart
     and a webcam glyph together — and by then the pair owed the title 108px of a 328px line. One
     control costs it 68. Emitted first, because the CSS reserves the room with a sibling rule. */
  return `<div class="pophead">
      ${siteDots(lead, favIdList, favAll, hasCam ? '' : camLink(lead, nearestCam(lead)))}
      ${goName(lead)}
      ${region(lead)}
      <div class="badges">${members.map(m => {
        const k = KINDS[m.kind];
        return `<span class="badge" style="--c:${hasInfo(m) ? k.color : 'var(--muted)'}"
                ><i class="i i-${k.icon}"></i>${k.one || k.label}</span>`;
      }).join('')}</div>
    </div>
    ${metSection(lead)}
    ${camFirst(members).map(m => `<div class="sensor" data-sensor="${m.id}">
      <div class="sensorhead">
        <i class="glyph i i-${KINDS[m.kind].icon}" style="color:${hasInfo(m) ? KINDS[m.kind].color : 'var(--muted)'}"
          ></i>
        <b>${KINDS[m.kind].one || KINDS[m.kind].label}</b>
        ${m.name !== lead.name ? `<span class="muted">${m.name}</span>` : ''}
        ${dots(m)}
      </div>
      ${sensorBody(m)}
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
      ${sensorBody(s)}
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

  /* The station's own marks, drawn across the graph.
     **A river draws every mark it publishes, always.** The question a reader brings to a river graph
     is "how far is this from trouble", and a graph that answers it only once the river is already
     close answers it exactly when it has stopped being the interesting question. The marks are the
     scale. Without them the shape is 8 cm of movement with nothing to measure it against, and the
     reader has to carry the numbers down from the meter by eye.
     The cost is real and is accepted: the y axis has to grow to hold a danger mark three metres up,
     so a calm river draws as a near-flat line along the foot of the graph. That is a true picture —
     the river *is* flat, three metres under its mark — and the trend figure beside the graph states
     the movement in m/h for anyone who needs the centimetres. This reverses the earlier rule, which
     drew a mark only within one *data span* of the readings to protect the shape, and left 89 of 105
     rivers with no mark at all on a quiet day.
     A flood gauge keeps the proximity rule. Its two marks sit at 0.15 m and 0.3 m of *depth over a
     spot*, so they are never far from the readings in the first place, and its axis crosses zero
     where a river's does not — there is no distant mark to reach for and nothing to gain.
     No labels on them. Text in a stretched viewBox distorts, and the meter directly above names all
     three marks with their values, in these exact colours. */
  const named = kind === 'gauge' ? ['warning', 'danger'] : ['alert', 'warning', 'danger'];
  const top = st?.danger ?? st?.warning ?? st?.alert;
  const first = st?.alert ?? st?.warning ?? top;
  const reach = (hi0 - lo0) || (top > first ? top - first : 1);
  const marks = !st ? [] : named.map(n => [n, st[n]])
    .filter(([, v]) => v != null && (kind !== 'gauge' || (v <= hi0 + reach && v >= lo0 - reach)));

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
    // A lone sample at the right edge has no width of its own; give it enough to be visible — and
    // pull it back inside the plot, because the newest sample sits *on* x=100 and `.spark svg` is
    // `overflow: visible`, so the minimum width would hang off the plate as a stray sliver.
    const w = Math.max(+x(end) - +x(t), 0.8), x0 = Math.min(+x(t), 100 - w);
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

/* Rain totalled over five nested windows, as horizontal bars.

   This answers how much rain fell. It never answers how dangerous that is. `rainBars()` directly
   above already draws the JPS intensity classes across its plot, and `rainState()` above that
   prints the word — so this card answers the severity question twice before these bars start.
   There is deliberately no threshold mark here. Three sources were tried for one and each failed a
   different way, which the spec records in full:
   docs/superpowers/specs/2026-08-12-cumulative-rainfall-chart-design.md
   Anything proposing a fourth has to answer that section first.

   A window with no honest answer keeps its row and draws an em dash, so the five are always in the
   same place and nobody has to work out which one went missing. An asterisk marks a total this app
   worked out rather than read off a feed. */
export function rainAcc(acc) {
  if (!acc) return '';
  const rows = ACC_ROWS.map(([k, label]) => [label, acc[k]]);
  if (!rows.some(([, r]) => r)) return '';
  // The scale is the largest total, so the widest bar always fills the width. With no mark to hold,
  // the axis needs no other rule.
  const hi = Math.max(...rows.map(([, r]) => r ? r[0] : 0));
  if (!hi) return '<div class="muted">No rain in the last 72 hours</div>';

  const star = rows.some(([, r]) => r && r[1]);
  const row = ([label, r]) => {
    if (!r) return `<div class="accrow"><span class="acck">${label}</span>
      <span class="accbar"></span><span class="accv muted">—</span></div>`;
    const [mm, derived, span] = r;
    /* The measured span rides in the readout rather than on the row. It answers "why does this say
       24 hours when the archive has a hole in it", which is a question you go looking for, not
       something to read at a glance. */
    const tip = `${label} · ${mm} mm${span ? ` · measured over ${span} h` : ''}`;
    return `<div class="accrow" data-tip="${tip}"><span class="acck">${label}</span>
      <span class="accbar"><i style="width:${(mm / hi * 100).toFixed(1)}%"></i></span>
      <span class="accv">${mm} mm${derived ? '<sup>*</sup>' : ''}</span></div>`;
  };

  return `<div class="acc">${rows.map(row).join('')}${
    star ? '<div class="muted">* Value derived from archived readings.</div>' : ''}</div>`;
}
