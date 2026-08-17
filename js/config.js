// Constants shared across modules. No imports here — everything else may depend on this.

/* Station types. Colours are deliberately NOT traffic-light hues: green/amber/orange/red and grey
   are reserved for status, so a type colour can never be read as an alert level.
   `var()` references, not hexes, because each needs a different value per theme — see the palette
   block in `css/base.css` for the two sets and the contrast they are held to. Every consumer drops
   the value into an inline `style` or a `--c`, so the reference works unchanged and the theme swap
   needs no re-render. A **canvas** is the one thing that cannot take a var: the heat layer paints
   pixels, not CSS, so its gradient keeps real values — see RAIN_HEAT below. */
export const KINDS = {
  river:    { label: 'Water level', color: 'var(--k-river)',    icon: 'water_drop' },
  rainfall: { label: 'Rainfall',    color: 'var(--k-rainfall)', icon: 'rainy' },
  siren:    { label: 'Sirens',      color: 'var(--k-siren)',    icon: 'campaign',    one: 'Siren' },
  gauge:    { label: 'Flood gauge', color: 'var(--k-gauge)',    icon: 'straighten' },
  camera:   { label: 'Cameras',     color: 'var(--k-camera)',   icon: 'photo_camera', one: 'Camera' },
};

/* What an alert is called, per kind and tier. `[singular, plural]`.
   Here rather than in alerts.js because two surfaces say it now: the panel groups its rows under
   these titles, and the warning pill on a camera picture states the same phrase for the one station
   it names. The two must not drift — a reader who scans the panel and then opens the picture beside
   the river is reading one claim twice, and the second wording would read as a second claim.
   CAP separates severity from certainty, and these words are where that separation reaches a reader:
   `now` is observed, `soon` is a forecast, `stale` is a claim we can no longer stand behind. The tier
   colours say it too, and colour alone is not a message. */
export const ALERT_TITLE = {
  'siren|now':   ['Triggered siren', 'Triggered sirens'],
  'siren|stale': ['Siren out of contact', 'Sirens out of contact'],
  'river|now':   ['Water level at danger', 'Water levels at danger'],
  'river|soon':  ['Forecast to reach danger', 'Forecast to reach danger'],
  'river|stale': ['Water level not current', 'Water levels not current'],
  // These two reach the camera pill only. The panel draws from `isHot()`, which does not cover
  // either kind, so nothing here puts a flood gauge or a rain gauge in the list.
  'gauge|now':    ['Flood gauge at danger', 'Flood gauges at danger'],
  'rainfall|now': ['Very heavy rain', 'Very heavy rain'],
};

/* The shell each kind of regional notice draws in. `kind` arrives on every row in `warnings[]`.
   The words live here beside ALERT_TITLE and HOTLINES, because that is where this app keeps its
   strings, and because three surfaces read them: the panel card, the ticker tile and the modal. */
export const NOTICE_KIND = {
  weather: { icon: 'rainy_heavy', c: 'var(--k-weather)', head: 'Forecast Warning' },
  // A flood forecast from JPS. It counts toward nothing, exactly as a weather warning does — see
  // the alert design standard in docs/FEATURES.md.
  flood:   { icon: 'flood',       c: 'var(--k-river)',   head: 'Flood Alert' },
};

// Who published the reading on a station. `api.php` stamps every station with one of these keys, so
// a popup can always say where its number came from — three feeds disagreeing by a few centimetres
// is normal, and unattributed numbers would make that look like a bug in the map.
export const SOURCES = {
  selangor: { name: 'JPS Selangor Infobanjir' },
  national: { name: 'JPS Malaysia · Public Infobanjir' },
  kl:       { name: 'JPS Wilayah Persekutuan (SPHTN)' },
  portal:   { name: 'JPS Malaysia · Public Infobanjir' },
};

/* The department behind the weather section, named once. It is not in SOURCES, because that table
   answers "who published this station's water reading" and MET publishes none. The About dialog
   spells it the same way. */
export const MET_NAME = 'MET Malaysia';

// Upstream status codes: river -1 offline, 0 normal, 1 alert, 2 warning, 3 danger. A river above its
// first mark is wearing the traffic light, so it uses the status tokens themselves — there was never
// a second amber, only a second spelling of one.
export const RIVER_COLOR = { '-1': 'var(--s-none)', 0: 'var(--k-river)',
  1: 'var(--s-alert)', 2: 'var(--s-warning)', 3: 'var(--s-danger)' };
export const RAIN_COLOR  = { '-1': 'var(--s-none)', 0: 'var(--k-rain-dry)', 1: 'var(--k-rainfall)',
  2: 'var(--k-rainfall)', 3: 'var(--k-rain-heavy)', 4: 'var(--s-danger)' };

/* The same rainfall ramp as real values, for the heat layer's canvas gradient — leaflet.heat builds
   an ImageData from it, and `var(--k-rainfall)` means nothing to a 2D context. One theme's worth,
   because a translucent blob is composited over the basemap rather than read against it, and the
   layer already dims and brightens with what is under it. Keep these in step with RAIN_COLOR's
   *hues*: a violet blob and a violet rainfall pin have to mean the same thing. */
export const RAIN_HEAT = { 1: '#6f7bff', 2: '#8f7bff', 3: '#c77dff', 4: '#ff4d4d' };

// Which sensor speaks for a mast when several share one: a river gauge says more about a flood than
// the rainfall gauge strapped to the same pole, and a camera says least until you open it. Used for
// the pin's lead sensor and for the order sensors are listed in, so both tell the same story.
export const KIND_RANK = ['river', 'siren', 'gauge', 'rainfall', 'camera'];

// Traffic light by status: normal → alert → warning → danger.
export const STATUS_COLOR = ['var(--s-normal)', 'var(--s-alert)', 'var(--s-warning)', 'var(--s-danger)'];

/* A flood gauge's own ramp, indexed by `gaugeTone()` in util.js. The same four rungs, except that
   the first step off dry ground is `--s-trace` and not the alert amber. JPS marks a gauge at 0.15 m
   and 0.3 m only, so the band under the first mark is real water that upstream never named, and
   amber claims more about two centimetres than anyone knows. Green denies it outright. */
export const GAUGE_COLOR = ['var(--s-normal)', 'var(--s-trace)', 'var(--s-warning)', 'var(--s-danger)'];

export const NO_INFO = 'var(--s-none)';   // grey: offline or reporting nothing

// "rising" is decided in api.php — a station reaching its own danger mark within RISE_ETA at the
// rate it is climbing. One definition, server-side, so the panel and the filter cannot disagree
// about what counts as an alert. The client reads `s.rising`, or the published `eta` where it shows
// the number, and never re-derives it. Nothing here mirrors the constant.

// A mast carrying several sensors: no single kind's colour or glyph speaks for a mixed stack, so it
// gets its own indigo and a "layers" glyph. It carried a sensor count on a filled disc too. Both are
// gone, and the glyph is what says "a stack stands here". Indigo because it has to miss every other
// meaning on the map — the five type hues, the traffic-light statuses, the offline grey. Worn only
// while the mast is quiet. Anything signalling keeps its status colour.
export const MAST = { color: 'var(--k-mast)', icon: 'layers' };

/* APM's flood emergency line directory — every state's number, kept current by the agency that
   answers them. The one outbound link on this page that is an *action* rather than a source, which
   is why it is a constant and not buried in a template: the About dialog and the ticker advisory
   must never drift to two different numbers. */
export const HOTLINES = 'https://www.civildefence.gov.my/talian-kecemasan-bencana-banjir/';

/* Upstream outage notices. `api.php` publishes an id and the regions the outage hit. Every word a
   reader sees is here, beside ALERT_TITLE and HOTLINES, because that is where this app keeps its
   strings. A payload that reships this paragraph every five minutes pays for it on every poll.

   `title` is the bold half of the ticker tile and the panel row. `line` is the muted half. Together
   they read as one sentence, the same shape a weather warning tile already takes. Neither repeats
   the other, because a tile that prints the agency name twice reads as a bug.

   `text` and `effect` are the modal, and they are written as a notice rather than as an account of
   one. Two drafts failed before this one. The first opened both sentences with `JPS says`, which
   reports speech and puts this app between the reader and the agency. The second cut them to
   `Reported cause: heavy traffic. Expected end: not stated.`, which reads as a log line and not as
   a notice. A notice uses whole sentences and names its source at the foot.

   One link, and it names the source. An earlier draft listed the app, Facebook and X under the words
   `Where JPS says to look instead`. That heading narrates rather than states, and the list turned a
   two-line notice into a directory. A reader who wants the agency can reach the rest from it. */
export const NOTICE = {
  publicinfobanjir: {
    title:  'JPS PublicInfoBanjir is unavailable',
    line:   'Some readings are not current.',
    text:   'Heavy traffic has overloaded the portal. JPS has not announced a restoration time.',
    effect: 'Water levels for these areas are not current. Stations show their last recorded reading.',
    link:   ['publicinfobanjir.water.gov.my', 'https://publicinfobanjir.water.gov.my/'],
  },
};

// CARTO styles. 'auto' follows the theme; the rest are an explicit choice in the drawer.
// One basemap per theme. ponytail: a picker existed and nobody needs three flavours of grey.
export const TILES = { light: 'rastertiles/voyager', dark: 'dark_all' };

// Sparkline window. Must not exceed the server's own SPARK_WIN — it sends nothing older.
export const SPARK_H     = 12;     // hours on the graph's x axis

/* The foot of a water-level bar, in alert→danger gaps below the first mark. See `levelStops()`.
   Tuning knob, not a constant of nature: 6 on the payload it was picked from left 6 of 107 rivers
   resting on the floor and 4 still crowding the alert tick. Lower it and calm stations flatten to
   nothing; raise it and they bunch up under the tick again, which is the bug it was picked to fix. */
export const LEVEL_FLOOR = 6;

/* Ground size of one blob, as the distance the painted circle actually reaches — see `heatScale()`
   in heat.js, which splits it into simpleheat's radius and blur rather than handing it to either.
   Water is catchment scale, so one gauge speaks for 5 km of it.

   Rain spreads further because nothing stops it, not because one gauge knows more. A rain reading
   reaches `RAIN_KM` and stops where another station disagrees. **One number covers both readings.**
   A gauge reporting rain paints this far and a gauge reporting none erases this far, and where the
   two meet the boundary is halfway between them — see `SoftHeat` in heat.js. Two numbers stood here
   first, 9 km of paint against 4 km of erase, and there is no defending that: it is the same
   instrument, the same minute and the same question, so the answer "none" cannot carry less ground
   than the answer "12 mm". Symmetry cost 4% of the painted area on the payload it was measured on.

   Measured on 211 gauges over 12 hours of history: given one gauge is wet, the chance its neighbour
   is wet too runs 24% out to 4 km, halves to 13% by 6 km, and is back to the 5% background rate by
   12 km. So no rain claim survives 12 km. **This stood at 9 km first, which is the outer edge of a
   claim that survives rather than the middle of one**, and the same study puts the halving distance
   at 6. A convective cell over the Klang Valley is 1 to 2 km across, so the shorter number is the
   one the evidence already carried. `MET_KM` in api.php reasons the same way about a MET point.
   Moving this moves the erase, the thinning and the blob together, and it changes gauge spacing
   measured in blob radii — which is what `FEATHER` in heat.js is sized against. Re-run the spacing
   sweep in CLAUDE.md before and after. */
export const HEAT_KM     = 5;      // water level
export const RAIN_KM     = 6;      // rainfall, either way it reads
/* Heat weight is a position on the threshold scale, not a fraction of danger. The popup meter's
   piecewise slots (alert 38%, warning 68%, danger 100%) key straight into the gradient, so a blob's
   colour names the band a station crossed. The floor is the alert slot: below its first published
   mark a station paints nothing, because a map that is warm everywhere says nothing. These three
   numbers, heat.js's gradient stops and the legend's ramp are one scale in four places. */
export const HEAT_ALERT   = 0.38;
export const HEAT_WARNING = 0.68;
export const HEAT_FLOOR   = HEAT_ALERT;
/* Widest sprite one blob may be drawn at. Blur cost is quadratic, so past this the layer fades
   rather than quietly covering less ground. It reads 400 and not 220 because it now caps the whole
   painted circle, where it used to cap only the solid core and simpleheat added 80% more blur
   outside it — 220 there was 396 on the canvas. 400 is the same sprite and the same cost. */
export const HEAT_MAX_PX = 400;

/* Rainfall heat, on JPS's own intensity classes (`rainStatus()` in sources.php: >0 light, >10
   moderate, >30 heavy, >60 very heavy, mm in the last hour). The slots are evenly spaced because
   the *class* is what the reader is told. The millimetres between two classes are not a quantity
   anyone acts on, exactly as the water scale spaces alert/warning/danger rather than metres.
   The first class starts at 25, not 0, and that is the trick: leaflet.heat uses a point's weight as
   its alpha, so a scale from zero draws real rain as almost nothing. Light rain is most of the rain
   most of the time — 10 of 233 gauges reporting, none above 4 mm/h, the day this was written — and
   an invisible layer is a broken one. The water layer gets this free from its alert-slot floor.
   Above 60 mm the scale is full, which is right: the class is open-ended.
   Paired with heat.js's rain gradient (RAIN_HEAT above — the same hues as the rainfall pins, as
   real values, since a canvas cannot resolve a token) and `.ramp.rain` in chrome.css. */
export const RAIN_STOPS = [[0, 25], [10, 50], [30, 75], [60, 100]];

/* How far a camera may be and still be offered as this station's nearest view. It reached 24 km
   before this cap, which is a different river with different weather over it. 441 of 591 stations
   keep a link at 5 km; the 150 that lose one show no link, rather than one that named a wrong river.
   CAM_ALERT_KM is a tighter, separate question — see stations.js. */
export const CAM_MAX_KM = 5;

/* How close an alert must be before the picture is allowed to claim it. Separate from CAM_MAX_KM
   on purpose: 5 km answers "which camera do I offer", 2 km answers "does this frame show the
   trouble". So the app can offer a camera at 4.8 km and draw no warning on it, which is correct.
   api.php carries the same 2 for the timeline join. Change both together. */
export const CAM_ALERT_KM = 2;

/* How far a sensor may be and still answer "what is near this point". The location card had no cap,
   so it named a siren 60 km away — a different weather system and a different catchment. About the
   width of a district. The camera keeps CAM_MAX_KM (5), a narrower question: whether "the river in
   this picture" is a claim this app can make. */
export const NEAR_MAX_KM = 10;

/* The station panel plays what it has of the last three hours, at a frame a second. Capture runs
   every 30 minutes (SHOT_EVERY in shots.php), so a full window is six frames and a six-second lap.
   Past three hours a picture is not current, which is the same word the cards use for a reading
   past a day. */
export const CLIP_WIN = 3 * 3600;
export const CLIP_MS  = 1000;

/* A strip's cell width, in lockstep with SHEET_W in shots.php, the same pairing CLIP_WIN holds.
   `img.naturalWidth / SHEET_W` recovers how many cells a loaded strip carries with no header, no
   manifest and no separate fetch — the picture says how many frames it holds by how wide it is. */
export const SHEET_W = 480;

export const FLASH_MS    = 2400;   // how long the jump-to ripple runs
export const POLL_MS     = 300000; // matches the proxy's cache TTL

/* Under this width the app refuses to draw a map and asks for room instead. Measured: the app bar
   itself holds together down to 245px and overflows the document below that, so this number is a
   floor somebody chose and not the point where the layout breaks. Two consequences to weigh before
   moving it. A Galaxy Fold cover screen is 280 CSS pixels wide and lands inside this block, and this
   is a flood map, so a reader locked out is a reader with no water levels. Against that, a map in a
   240px keyhole during a flood is worse than a sentence telling somebody to turn the phone. */
export const NARROW_PX = 300;

// GitHub Pages has no PHP. The Actions bake flips STATIC to true and drops api.php's output next to
// index.html as api.json; nothing sniffs the hostname, and the two builds differ by this one line.
// Camera stills need no proxy in that build: upstream serves the same file over TLS, so an https
// page can hotlink it. api.php still fetches them server-side because it also validates the host.
export const STATIC = false;
export const FEED   = STATIC ? 'api.json' : 'api.php';
export const camSrc = s =>
  STATIC ? s.image.replace(/^http:/i, 'https:') : `api.php?cam=${s.id.split('-')[1]}`;

/* The three rungs MET publishes. `word` fills the narrow "now" column, so it has to be one word at
   about 64px. `line` opens the worst-rung sentence, which is why the two differ. */
export const WEATHER = [
  { icon: 'sunny', night: 'clear_night', word: 'Clear', line: '' },
  { icon: 'rainy',       word: 'Rain',  line: 'Rain' },
  { icon: 'rainy_heavy', word: 'Heavy', line: 'Heavy rain' },
];

/* The five windows of the rainfall accumulation chart, left to right.
   Each window contains the one to its left, so the columns normally climb across. There is one
   exception and it is real: near midnight "Today" is younger than "3 h", because at 01:00 today
   holds one hour of rain and the 3 hour window reaches back into yesterday. The dip stays.
   Labels are short because five of them share the width of one graph. They also open the hover
   readout, where `24 h · 180 mm` is the whole sentence and a longer word buys nothing. */
export const ACC_ROWS = [
  ['h1',  '1 h'],
  ['h3',  '3 h'],
  ['day', 'Today'],
  ['h24', '24 h'],
  ['h72', '72 h'],
];
