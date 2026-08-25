// "On alert": a warning glyph in the app bar, always present — a control that vanishes when all is
// well is indistinguishable from one that broke, so quiet is stated rather than implied — and the
// list itself in the station panel, which is the same popout a pin opens.

import { KINDS, STATUS_COLOR, NO_INFO, ALERT_TITLE, NOTICE, NOTICE_KIND } from './config.js';
import { state, PREFS } from './state.js';
import { distKm, dkey, isHot, tier, TIER_RANK, isIgnored, noSec, isFav, esc,
         warnWhen } from './util.js';
import { side, openSide, closeSide } from './map.js';
import { etaText, stamp } from './popup.js';

/* The list shares #side with the station cards. `@`-prefixed, so render()'s per-poll refresh leaves
   it alone (see the tail of render.js) — this module refreshes it instead, on the same poll.
   Nothing springs it open by itself any more: on the right edge it would land on top of a card
   someone is reading, and the glyph's colour and count are on screen the whole time either way.
   The interruption for news is still the toast. */
const KEY = '@alerts';
let card = '';        // last built list, so the button can open it without waiting for a poll
const TITLE = document.title;   // the base, read once — alerts() prefixes a count onto it

/* Two panes, M3 primary tabs, sensors first. The station alerts and the regional notices answer two
   different questions, and a night that trips twenty sirens used to bury a flood forecast under
   them. The choice lives here rather than in the DOM, because `alerts()` rebuilds the whole card on
   every poll and a reader on the Notices tab must not be thrown back to the Sensors one.
   The count rides in each tab label. So a notice is still announced while the other pane is on
   screen — the tab reads `Notices 1`. That is the whole of what says a source is down while the
   sensor list says all clear, and it is weaker than the banner that used to sit above everything. */
let tab = 'sensors';
let parts = { head: '', sensors: '', notices: '', ns: 0, nn: 0 };

const tabBtn = (id, label, n) => `<button class="atab${tab === id ? ' on' : ''}" data-tab="${id}"
    role="tab" aria-selected="${tab === id}">${label}<span class="atabn">${n}</span></button>`;

const build = () => `${parts.head}<div class="atabs" role="tablist">${
    tabBtn('sensors', 'Sensors', parts.ns)}${tabBtn('notices', 'Notices', parts.nn)
  }</div><div class="apane" role="tabpanel">${
    tab === 'sensors' ? parts.sensors
      : parts.notices || '<p class="empty muted">No notices.</p>'}</div>`;

export function setAlertTab(t) {
  if (t === tab) return;
  tab = t;
  card = build();
  if (side.key !== KEY) return;
  openSide(KEY, card);
  // openSide() keeps the scroll position while the key is unchanged, which is what a poll wants and
  // not what a tab swap wants: forty rows deep in Sensors leaves Notices showing a blank pane.
  const b = document.getElementById('sideBody');
  if (b) b.scrollTop = 0;
}

export function toggleAlerts() {
  side.key === KEY ? closeSide() : openSide(KEY, card);
}

/* How many sensors stand where this one does. The glyph in the siren list says whether a place is
   a lone siren or a mast, because those are two different things to open: a mast has a river level
   sitting next to the siren, and that is the reading you actually want when a siren goes off. Same
   `layers` glyph the mast pin wears, so the map and the list name the same thing the same way. */
const siteSize = () => {
  const n = new Map();
  for (const s of state.data) {
    const k = s.site || s.id;
    n.set(k, (n.get(k) || 0) + 1);
  }
  return n;
};

/* Which places hold something starred. Keyed on `site`, and true when **any** sensor there is
   starred — the same rule the pin badge and the search group use, so a reader who starred the camera
   at a mast still sees that mast lifted when the river beside it goes over its mark. */
const favSites = () => {
  const k = new Set();
  for (const s of state.data) if (isFav(s)) k.add(s.site || s.id);
  return k;
};

/* One card per kind per tier, and **every row in it is a place**, not a sensor.
   The panel used to be one card per station, each carrying a meter, a trend line and a 12-hour
   graph. That is the right shape for one alert and the wrong shape for forty: a night that trips
   twenty sirens and pushes thirty rivers over their marks turned the panel into a scroll, and the
   one question it exists to answer — where is this happening — was spread over two screens of
   identical furniture. Now the answer is the list, and the reading behind any row is one tap away
   on that station's own card, where there is width for a graph.
   Grouped by `site`, so a mast with two river gauges over their marks is one row and not two, and
   the row wears the `layers` glyph when more than one sensor stands there.
   The titles themselves live in config.js as `ALERT_TITLE`, because the warning pill on a camera
   picture states the same phrase for the one station it names. The two must not drift. */
const TIER_TAG = {
  now:   '<span class="tg tg-now">HAPPENING NOW</span>',
  // Observed, and under the top of its own scale. The words are the app's own, the ones rainState()
  // already prints on a station card, so the panel and the card name one thing one way.
  heavy: '<span class="tg tg-heavy">HEAVY RAIN</span>',
  soon:  '<span class="tg tg-soon">FORECAST</span>',
  stale: '<span class="tg tg-stale">NOT CURRENT</span>',
};

/* The right-hand column of a row: the number, and the one thing that number needs beside it to be
   read. A siren has neither — it is sounding, which the card title already said. */
function reading(s, t) {
  if (s.kind === 'siren') return '';
  /* Rain before the `level` test, because a rain gauge has no level and would leave the column
     empty. The rate is the whole claim, so nothing goes under it. A stale row keeps the stamp, the
     one thing that column says for every other kind. */
  if (s.kind === 'rainfall') {
    if (s.hourly == null) return '';
    const when = t === 'stale' ? noSec(s.updated) || '' : '';
    return `<b class="rd">${s.hourly} mm/h${
      when ? `<br><small class="muted">${when}</small>` : ''}</b>`;
  }
  if (s.level == null) return '';
  const max = s.danger || s.warning || s.alert;
  const under = t === 'stale' ? noSec(s.updated) || ''
    : t === 'soon' && s.eta != null ? etaText(s.eta)
    : max ? `${(s.level / max * 100).toFixed(0)}% of danger` : '';
  return `<b class="rd">${s.level} m${under ? `<br><small class="muted">${under}</small>` : ''}</b>`;
}

function groupCard(items, kind, t, hereAt) {
  const size = siteSize();
  const fav = favSites();
  const k = KINDS[kind];

  // One row per place. The worst sensor there speaks for it and is what the row jumps to.
  const places = new Map();
  for (const s of items) {
    const key = s.site || s.id;
    const at = places.get(key);
    if (!at || (s.ratio || 0) > (at.lead.ratio || 0)) places.set(key, { lead: s, n: (at?.n || 0) + 1 });
    else places.set(key, { ...at, n: at.n + 1 });
  }
  /* Starred places first. Order only: the set of rows, the counts above them, the icon badge, the
     ticker and the toast are all unchanged, and `isHot()` is untouched. Widening what alerts is an
     alert-design decision and goes through the standard in docs/FEATURES.md. This is not that. */
  const rows = [...places.values()].sort((a, b) =>
    (fav.has(b.lead.site || b.lead.id) - fav.has(a.lead.site || a.lead.id))
    || (hereAt
      ? distKm(hereAt, a.lead) - distKm(hereAt, b.lead)
      : (b.lead.ratio || 0) - (a.lead.ratio || 0)));

  const [one, many] = ALERT_TITLE[`${kind}|${t}`] || [k.label, k.label];
  /* The kind chip and the tier tag share a flex row now. They were two inline-level boxes, and the
     chip is an M3 assist chip at 32dp against the tag's 18. See `.alerttop` in css/chrome.css.
     The rows are an M3 SEGMENTED list, which is `.mseg` in that same file. */
  return `<div class="alert t-${t} grouped">
    <div class="alerttop">
      <span class="badge" style="--c:${k.color}"><i class="i i-${k.icon}"></i>${k.one || k.label}</span>
      ${TIER_TAG[t]}
    </div>
    <div class="popname">${rows.length > 1 ? many : one}</div>
    <ul class="slist mseg">${rows.map(({ lead: s, n }) => `<li data-go="${s.id}"
        title="Show ${s.name} on the map">
        <i class="i i-${(size.get(s.site || s.id) || 1) > 1 ? 'layers' : k.icon}"></i>
        ${fav.has(s.site || s.id)
          ? '<i class="i i-favorite fvm" role="img" aria-label="Favorite"></i>' : ''}
        <span class="nm">${s.name}<br><small class="muted">${
          [s.district, s.state].filter(Boolean).join(', ')}${
          hereAt ? ` · ${distKm(hereAt, s).toFixed(1)} km` : ''}${
          n > 1 ? ` · ${n} sensors` : ''}</small></span>
        ${reading(s, t)}
      </li>`).join('')}</ul>
    ${t === 'stale' ? `<p class="muted">These stations have stopped reporting. Each reading above is
       the last one it sent, and the situation there may have changed either way.</p>` : ''}
  </div>`;
}

/* The tab mark, at the top rung only. A favicon is 16 pixels of one shape, so it can carry a state
   or a count but never both, and the count is already on the title in front of it. Red or the plain
   blue mark — nothing in between, because the middle rungs are exactly the ones 16 pixels cannot
   tell apart.
   Painted rather than shipped as a second PNG: `icon.svg` is the one drawing every other mark is
   baked from (see icon-build.php), and a hand-kept red copy is a file that goes stale the next time
   the glyph moves. `source-in` fills the alpha the glyph left behind — the same trick css/icons.css
   plays with a mask, and the reason the colour can come from `--s-danger` rather than a hex.
   Only repaints when the state flips: this runs on every poll. */
const FAV = document.querySelector('link[rel=icon]');
const FAV_SRC = FAV.getAttribute('href');   // the blue mark, to go back to
let favRed = false;
const favicon = red => {
  if (red === favRed) return;
  favRed = red;
  if (!red) return void (FAV.href = FAV_SRC);
  const im = new Image();
  im.src = 'icon.svg';
  im.decode().then(() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    x.drawImage(im, 0, 0, 64, 64);
    x.globalCompositeOperation = 'source-in';
    // The token, not a hex — the palette lives in base.css and has moved four times. It is read at
    // paint time, so a theme flip while red keeps the old red until the next flip. Both are red.
    x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--s-danger').trim();
    x.fillRect(0, 0, 64, 64);
    if (favRed) FAV.href = cv.toDataURL();   // the state may have cleared while the SVG decoded
  }).catch(() => {});                        // no drawing, no repaint — the blue mark stands
};

/* Two kinds of regional notice, and they do not take the same rank.

   A MET warning sits under HAPPENING NOW and above everything else. It led the panel first, and a
   forecast about a region then sat above a river already over its danger mark. Only one of those is
   happening, which is the same argument the tier sort below makes about a forecast two streets
   away. So it takes a place in that order: after the `now` groups, before `soon` and `stale`. With
   nothing happening now it is still the first thing under the head.

   An outage notice sits above all of it, including HAPPENING NOW. It is not another item in the
   list. It is a caveat on the list itself, and it says the list may be incomplete. The all-clear is
   why. "All clear. Nothing rising or in danger" can be false precisely because a source stopped
   answering, and EEMUA's point is that a reader must be able to tell no alarms from a dead alarm
   system.

   Neither adds anything to the counts below. The badge, the tab title, the tally glyphs and the
   warning glyph still read the station list alone. Merging the two tells a reader that stations are
   in trouble when none is.

   The row clips its text with CSS, not by cutting the string. The full sentence stays in the DOM
   for a screen reader. It stays too for anyone who copies it. The modal holds the same text as the
   row, not the source's original bulletin — `hereParts()` in sources.php already narrowed it to
   the part naming somewhere this map covers, before either surface ever sees it. */
/* The outage shell. The two notice shells live in NOTICE_KIND in config.js, because the ticker and
   the modal read them too and this module is not importable from either. */
const BANNER = {
  notice: { icon: 'public_off', c: 'var(--k-source)', head: 'Service Notice' },
};

/* Each category is an M3 list SUBHEADER over M3 three-line list items, drawn as an EMAIL LIST. The
   repository owner asked for that shape on 2026-08-25.

   An email list is the right analogy and not a decoration. Every row here is a bulletin somebody
   published, with a sender, a subject, a preview and a time. It is read down the column and opened
   one at a time. The card shell this replaced put a coloured left rule and a heading block around
   each category, which is the shape of an alert and not of a message.

   The category colour lives in the avatar alone now. It said the same thing three times before: a
   left rule, a heading glyph and a heading word. `--c` is on the row, so the avatar reads it.

   The preview clips to two lines with CSS, not by cutting the string. The full sentence stays in
   the DOM for a screen reader, and for anyone who copies it. That was already the rule at one line.

   The time is the start of the validity window, at the precision its age needs — a clock today, a
   date on any other day. `stamp()` is that rule and `popup.js` owns it. An outage publishes no
   window, so its row carries no time. An empty trailing slot is the honest answer.

   Neither kind adds anything to the counts on the Sensors pane. The badge, the tab title, the tally
   glyphs and the warning glyph still read the station list alone. */

// One category: a subheader carrying its own count, then its rows.
const nsec = (b, rows, n) => rows ? `<h3 class="nsub" style="--c:${b.c}">
      <i class="i i-${b.icon}"></i>${b.head}<b>${n}</b>
    </h3><div class="nlist">${rows}</div>` : '';

/* One row. `time` is empty for an outage. The avatar repeats the category glyph, which is what
   carries the colour once the shell is gone and what makes a scrolled list readable past its own
   subheader. */
const nrow = (b, tag, title, text, time) => `<button class="nrow" data-banner="${tag}"
      style="--c:${b.c}">
      <span class="avat"><i class="i i-${b.icon}"></i></span>
      <span class="nbody"><b>${esc(title)}</b><span class="nprev">${esc(text)}</span></span>
      ${time ? `<time class="ntime">${esc(time)}</time>` : ''}
    </button>`;

/* One list for both kinds. An outage publishes an id rather than prose, so its words come from
   NOTICE in config.js. A warning carries its own.
 *
 * A warning list is split by `kind`, so a JPS flood forecast and a MET thunderstorm never share a
 * subheader. They are different claims, and one heading over both makes the app state something
 * neither source said. */
function bannerCard(list, kind) {
  if (!list || !list.length) return '';
  if (kind === 'notice') {
    const keep = list.map((w, i) => [w, i]).filter(([w]) => NOTICE[w.id]);
    // An id this build has no words for says nothing, so it draws no row and joins no count.
    return nsec(BANNER.notice, keep.map(([w, i]) =>
      nrow(BANNER.notice, `notice:${i}`, NOTICE[w.id].title, NOTICE[w.id].line, '')).join(''),
      keep.length);
  }

  /* `data-banner` indexes state.warnings, so the index is taken BEFORE the split. Renumbering
     after it opens the wrong warning — the same rule the ticker already obeys.
     A row whose kind this build has no shell for falls back to weather, the same fallback the
     ticker and the modal already use — one rule stated three ways must not drift, and a dropped
     warning is worse than a mislabeled one. */
  return Object.entries(NOTICE_KIND).map(([k, b]) => {
    const mine = list.map((w, i) => [w, i])
      .filter(([w]) => (NOTICE_KIND[w.kind] ? w.kind : 'weather') === k);
    return nsec(b, mine.map(([w, i]) =>
      nrow(b, `warn:${i}`, w.title, w.text, w.from ? stamp(warnWhen(w.from)) : '')).join(''),
      mine.length);
  }).join('');
}

export function alerts() {
  const hidden = new Set(PREFS.hidden || []);
  const hot = state.data.filter(s => !hidden.has(dkey(s)) && !isIgnored(s) && isHot(s));
  // Counts describe what is actually known right now, so anything stale is excluded from all three
  // and counted separately. A number that silently includes a reading from April is a lie with a
  // digit in front of it.
  const live   = hot.filter(s => tier(s) !== 'stale');
  // Each chip counts a tier, because that is what the cards below draw. A river at its danger mark
  // and still climbing carries both flags, and counted twice it made the head promise two alerts
  // over one row. `tier()` already elected `now` for it, so the forecast chip reads `soon` alone.
  const rising = live.filter(s => s.rising && tier(s) === 'soon').length;
  const danger = live.filter(s => s.kind === 'river' && s.status >= 3).length;
  const sirens = live.filter(s => s.kind === 'siren').length;
  /* Rain needs a chip of its own, or the chips stop partitioning the list under them. No other chip
     counts it, so a heavy-rain alert used to raise the head count with nothing beside it to say what
     the alert was. It counts the KIND and not one tier, so class 3 and class 4 land in one chip.
     `--s-warning`, not the danger red the two chips above it take. That is the tier colour the
     `heavy` cards under it carry, and a red chip over amber cards is the mismatch this rung exists
     to remove. A class 4 gauge is red in its own card and counted here all the same: the chip says
     how much rain is on the list, and the cards say how bad each one is. */
  const rain   = live.filter(s => s.kind === 'rainfall').length;
  const stale  = hot.length - live.length;
  const hereAt = state.hereAt;

  /* The installed app's icon badge — the same number the tab's warning glyph is coloured by, so a
     home screen and this panel never disagree. `live`, not `hot`: a badge is a demand for attention
     and a list of stations we can no longer read is a maintenance problem, not a flood — the same
     line the counts above already draw.
     Zero clears it, per the spec, so there is no second branch. Optional chaining short-circuits the
     whole expression where the API is absent (every browser but Chrome and recent Safari), and the
     `.catch` swallows iOS refusing it until notification permission is granted — which is not asked
     for here, because a permission prompt on landing is exactly the trust-spending the alert
     standard warns about, and the badge is a nicety either way. */
  navigator.setAppBadge?.(live.length).catch(() => {});

  // Same number again, for the tab strip and the window title bar — the one alert surface that is
  // readable while the page is in a background tab.
  document.title = (live.length ? `(${live.length}) ` : '') + TITLE;

  /* **Every kind of alert in this head is an M3 assist chip, on a reader's instruction of
     2026-08-25.** They were `.tally b`, a 12px pill on a 16% tint of its own status colour. The
     chip is the same one the group heads below draw and the same one a station card's kinds draw,
     so the pane states a kind one way wherever it states one.
     **The colour splits M3's way**: the label takes `on-surface` and only the leading icon takes
     the status hue. A chip whose NUMBER is painted by the status reads as a reading, and a count of
     stations is not one.
     **Glyph and number, not "2 at danger".** That decision is older than the chip: the head is one
     panel-width and the words wrapped as soon as three counts were non-zero, which is exactly when
     the list matters most. Each count keeps its `title` and its `aria-label`, so nothing is
     conveyed by the glyph alone. */
  const tally = [
    [danger, 'warning',     'at danger', STATUS_COLOR[3]],
    [sirens, 'campaign',    'sounding', STATUS_COLOR[3]],
    [rain,   'rainy',       'in heavy rain', STATUS_COLOR[2]],
    [rising, 'expand_less', 'rising', STATUS_COLOR[2]],
    [stale,  'wifi_off',    'not current', 'var(--muted)'],
  ].filter(([n]) => n)
   .map(([n, icon, what, c]) => `<span class="badge" style="--c:${c}" title="${n} ${what}"
        aria-label="${n} ${what}"><i class="i i-${icon}"></i>${n}</span>`).join('');

  /* The warning glyph carries **severity, not headcount**: red the moment one station is at its
     danger mark or one siren is sounding, amber while the worst of it is still a forecast, grey when
     there is nothing. That is `tier()`'s own split — observed against projected — and the list below
     already draws it as a red or amber rule per row, so the button now agrees with the rows it opens.
     It used to ramp on the number instead (amber 1–4, orange 5–9, red 10+), which put an amber glyph
     over a river standing at danger and a red one over ten stations merely forecast to climb. CAP
     keeps severity and urgency on separate axes for exactly this reason, and the count was never
     missing from the button — it is the badge on the corner.
     Read from `live`, not `hot`: a list made entirely of stations we can no longer read is a
     maintenance problem, not a flood, and must not paint the glyph red. */
  const c = !live.length ? NO_INFO
    : STATUS_COLOR[live.some(s => tier(s) === 'now') ? 3 : 1];

  // The tab follows the button at the top rung, so a background tab says the same thing the bar does.
  favicon(c === STATUS_COLOR[3]);

  /* The bar's own signal. The badge counts `live` — the same number as the app icon's, for the same
     reason: it is a demand for attention, and stations we can no longer read are not one. The
     breakdown that used to sit under the tab is in the panel head instead, where there is width for
     it; the button carries the colour and the number, which is all a 40px control can say. */
  /* The rail item holds a pill, a glyph, a badge and a label. So this writes the count into the
     badge alone. Writing `innerHTML` on the button takes the label and the pill with it, and the
     item then draws as a bare number under nothing. */
  /* **Both controls, because the rail draws above 600px and the navigation bar below it.** Only one
     of the two is ever on screen, and this module has no width test. Writing one leaves the other
     holding the count from whichever side the reader landed on. */
  const what = live.length ? `${live.length} station${live.length > 1 ? 's' : ''} on alert`
                           : 'On alert — all clear';
  for (const btn of document.querySelectorAll('#railAlerts, #navAlerts')) {
    btn.style.setProperty('--c', c);
    btn.querySelector('.railbadge').textContent = live.length || '';
    btn.title = what;
    btn.setAttribute('aria-label', what);
  }

  /* The head. `openSide()` splits it: the `.popname` becomes the sheet's title and the rest stays
     here at the top of the body. Which is why `.pophead` must stay the card's first element. */
  /* **`Nearest first` is a chip too, and it had to leave the title to become one.** It was
     `· nearest first`, a muted fragment INSIDE `.popname`, which `openSide()` lifts whole into the
     app bar's headline. A 32dp chip inside a headline is not a chip.
     It states how the rows are ordered rather than what is in them, so it takes `--muted` on its
     glyph and no status hue. It comes LAST: the counts are what a reader scans for.
     **The row is `.badges`, which is what makes `openSide()` lift it.** That function moves
     `:scope > .badge, :scope > .badges` into `#sideKinds`, the app bar's own chip line, so the
     alert head now reads exactly as a station card does — a headline over a row of chips. `.tally`
     stayed in the body and left `.pophead` behind it, so the seam never emptied and never got
     removed.
     Emitted only when there is something in it. An empty `.badges` is a child, so `#sideKinds:empty`
     would not match it and the app bar would keep a line for nothing. */
  const near = hot.length && hereAt
    ? `<span class="badge" style="--c:var(--muted)"><i class="i i-near_me"></i>Nearest first</span>`
    : '';
  const chips = tally + near;
  const head = `<div class="pophead"><div class="popname">On alert</div>${
    chips ? `<div class="badges">${chips}</div>` : ''}</div>`;

  /* The Notices pane, in category order: the outage caveat, then the flood alert, then the weather
     warning. `bannerCard()` already draws one headed card per category, so the two calls are the
     whole of the split. The outage leads because it is a caveat on the sensor pane rather than an
     item beside the other two. */
  const warnHtml = bannerCard(state.warnings, 'warn');
  const noticeHtml = bannerCard(state.notices, 'notice');
  // The count in each tab label. A notice with no words in this build draws no row, so it is not
  // counted either — the tab must name what the pane holds.
  const nn = (state.notices || []).filter(w => NOTICE[w.id]).length + (state.warnings || []).length;
  const write = body => {
    parts = { head, sensors: body, notices: noticeHtml + warnHtml, ns: hot.length, nn };
    card = build();
    if (side.key === KEY) openSide(KEY, card);
  };

  if (!hot.length) {
    // Name the place only when there is one place to name; otherwise say the view is filtered, so a
    // quiet panel is never mistaken for a quiet state when half the districts are switched off.
    const on = new Set(state.data.filter(s => !hidden.has(dkey(s))).map(s => s.district));
    const where = on.size === 1 ? ` in ${[...on][0]}`
                : hidden.size   ? ' in the districts you are showing' : '';
    /* An ignored sensor that is *itself* on alert is the one case where "All clear" would be a plain
       lie, so it is stated — not listed, because listing it would undo the thing the user asked for,
       but counted, so the all-clear is one the reader can weigh. The number they need is the ignored
       sensors that are hot right now, not how many are ignored in total. */
    const muted = state.data.filter(s => isIgnored(s) && isHot(s)).length;
    write(`<p class="empty muted">All clear${where}. Nothing rising or in danger.</p>${
      muted ? `<p class="empty muted"><i class="i i-visibility_off"></i> ${muted} ignored sensor${
        muted > 1 ? 's are' : ' is'} on alert — restore ${
        muted > 1 ? 'them' : 'it'} under Ignored sensors in the filters.</p>` : ''}`);
    return;
  }

  /* Tier before anything else. Nearest-first is the more useful order *within* a tier, but across
     tiers it would put a forecast two streets away above a river already over its danger mark on
     the other side of town — and only one of those is happening. Stale sinks to the bottom whatever
     the distance: it is the one group you cannot act on.
     Sirens lead inside their tier. A level is a number to judge and a decision still to make. A
     siren is a decision that somebody has already made and acted on, which is the shorter road to
     doing something about it. Swap the two operands to put water levels back on top.
     Five groups at most, then, and usually two: the whole panel fits a screen at any size of flood,
     which is the point of it. Ordering inside a group is `groupCard()`'s. */
  const groups = new Map();
  for (const s of hot) {
    const key = `${tier(s)}|${s.kind}`;
    groups.has(key) ? groups.get(key).push(s) : groups.set(key, [s]);
  }
  const cards = [...groups.entries()]
    .sort(([a], [b]) => {
      const [ta, ka] = a.split('|'), [tb, kb] = b.split('|');
      return TIER_RANK[ta] - TIER_RANK[tb] || (kb === 'siren') - (ka === 'siren');
    })
    .map(([key, items]) => {
      const [t, kind] = key.split('|');
      return [t, groupCard(items, kind, t, hereAt)];
    });

  /* The warning section used to be spliced into this list, after the last `now` group and before the
     first `soon` one, so a forecast about a region never sat above a river already over its mark.
     The tabs answer that ordering question instead: the two claims are in two panes now, and neither
     one can outrank the other. */
  write(cards.map(([, html]) => html).join(''));
  // No advisory here. It lives on the ticker, which is the strip that stays visible while this list
  // is closed or covered — and repeating it in both would make it furniture.
  // Nor is anything bound to the rows: the list is in #side now, so ui.js's delegated [data-go]
  // handler reaches it, and the station card it opens *replaces* the list rather than sitting behind
  // it — which is the phone case the old per-row handler had to collapse the panel for.
}
