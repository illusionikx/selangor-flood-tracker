// Constants shared across modules. No imports here — everything else may depend on this.

/* Station types. Colours are deliberately NOT traffic-light hues: green/amber/orange/red and grey
   are reserved for status, so a type colour can never be mistaken for an alert level.

   They are `var()` references, not hexes, because each one needs a different value per theme — see
   the palette block in `css/base.css` for the two sets and the contrast they are held to. Every
   consumer drops the value into an inline `style` or a `--c`, so a var reference works unchanged,
   and the theme swap needs no re-render. The one place that cannot take a var is a **canvas**: the
   heat layer paints pixels, not CSS, so its gradient keeps real values — see RAIN_HEAT below. */
export const KINDS = {
  river:    { label: 'Water level', color: 'var(--k-river)',    icon: 'water_drop' },
  rainfall: { label: 'Rainfall',    color: 'var(--k-rainfall)', icon: 'rainy' },
  siren:    { label: 'Sirens',      color: 'var(--k-siren)',    icon: 'campaign',    one: 'Siren' },
  gauge:    { label: 'Flood gauge', color: 'var(--k-gauge)',    icon: 'straighten' },
  camera:   { label: 'Cameras',     color: 'var(--k-camera)',   icon: 'photo_camera', one: 'Camera' },
};

// Who published the reading on a station. `api.php` stamps every station with one of these keys, so
// a popup can always say where its number came from — three feeds disagreeing by a few centimetres
// is normal, and unattributed numbers would make that look like a bug in the map.
export const SOURCES = {
  selangor: { short: 'JPS Selangor',  name: 'JPS Selangor Infobanjir',
              url: 'https://infobanjirjps.selangor.gov.my/' },
  national: { short: 'Public Infobanjir', name: 'JPS Malaysia · Public Infobanjir',
              url: 'https://publicinfobanjir.water.gov.my/' },
  kl:       { short: 'JPS WP Kuala Lumpur', name: 'JPS Wilayah Persekutuan (SPHTN)',
              url: 'https://infobanjirjpskl.water.gov.my/' },
};

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

export const NO_INFO = 'var(--s-none)';   // grey: offline or reporting nothing

// "rising" is decided in api.php — a station reaching its own danger mark within its RISE_ETA at the
// rate it is climbing now. One definition, server-side, so the panel and the filter can never
// disagree about what counts as an alert. The client never re-derives it: it reads `s.rising`, or
// the published `eta` where it wants to show the number. Nothing here mirrors the constant any more
// — the heat ramp was the last thing that did, and it is keyed on thresholds now.

// A mast carrying several sensors: no single kind's colour or glyph can speak for a mixed stack, so
// it gets its own indigo and a "layers" glyph, and keeps the sensor count badge. Indigo because it
// has to miss every other meaning on the map — the five type hues, the traffic-light statuses, and
// the offline grey. Only worn while the mast is quiet; anything signalling keeps its status colour.
export const MAST = { color: 'var(--k-mast)', icon: 'layers' };

/* APM's flood emergency line directory — every state's number, kept current by the agency that
   answers them. The one outbound link on this page that is an *action* rather than a source, which
   is why it is a constant and not buried in a template: the About dialog and the ticker advisory
   must never drift to two different numbers. */
export const HOTLINES = 'https://www.civildefence.gov.my/talian-kecemasan-bencana-banjir/';

// CARTO styles. 'auto' follows the theme; the rest are an explicit choice in the drawer.
// One basemap per theme. ponytail: a picker existed and nobody needs three flavours of grey.
export const TILES = { light: 'rastertiles/voyager', dark: 'dark_all' };

// Sparkline window. Must not exceed the server's own SPARK_WIN — it sends nothing older.
export const SPARK_H     = 12;     // hours on the graph's x axis

export const HEAT_KM     = 5;      // ground size of one blob
/* Heat weight is a position on the threshold scale, not a fraction of danger: the popup meter's
   piecewise slots (alert 38%, warning 68%, danger 100%) keyed straight into the gradient, so a
   blob's colour names the band a station has crossed. The floor is the alert slot — below its first
   published mark a station paints nothing, because a map that is warm everywhere says nothing.
   These three numbers, heat.js's gradient stops and the legend's ramp are one scale in four places;
   change them together. */
export const HEAT_ALERT   = 0.38;
export const HEAT_WARNING = 0.68;
export const HEAT_FLOOR   = HEAT_ALERT;
export const HEAT_MAX_PX = 220;    // blur cost is quadratic; past this the layer fades instead

/* Rainfall heat, on JPS's own intensity classes (`rainStatus()` in sources.php: >0 light, >10
   moderate, >30 heavy, >60 very heavy, mm in the last hour). The slots are evenly spaced because the
   *class* is what the reader is being told — the millimetres between two classes are not a quantity
   anyone acts on, exactly as the water scale spaces alert/warning/danger rather than metres.
   The first class starts at 25, not 0, and that is the whole trick: leaflet.heat uses a point's
   weight as its alpha, so a scale starting at zero would have drawn real rain as almost nothing.
   Light rain is most of the rain most of the time — 10 of 233 gauges reporting, none above 4 mm/h,
   on the day this was written — and an invisible layer is a broken one. The water layer gets this
   for free because its floor is the alert slot; here the floor has to be built in. Above 60 mm the
   scale is already full, which is right: the class is open-ended and the blob is as red as it goes.
   Paired with heat.js's rain gradient (RAIN_HEAT above — the same hues as the rainfall pins, as real
   values, because a canvas cannot resolve a token) and `.ramp.rain` in chrome.css — change the three
   together. */
export const RAIN_STOPS = [[0, 25], [10, 50], [30, 75], [60, 100]];

/* How far a camera may be and still be offered as this station's nearest view. It reached 24 km
   before this cap, which is a different river with different weather over it. 441 of 591 stations
   keep a link at 5 km; the 150 that lose one now say "no camera nearby", which is true and was not.
   CAM_ALERT_KM is a tighter, separate question — see stations.js. */
export const CAM_MAX_KM = 5;

/* How close an alert must be before the picture is allowed to claim it. Separate from CAM_MAX_KM
   on purpose: 5 km answers "which camera do I offer", 2 km answers "does this frame show the
   trouble". So the app can offer a camera at 4.8 km and draw no warning on it, which is correct.
   api.php carries the same 2 for the timeline join. Change both together. */
export const CAM_ALERT_KM = 2;

export const FLASH_MS    = 2400;   // how long the jump-to ripple runs
export const POLL_MS     = 300000; // matches the proxy's cache TTL

// GitHub Pages has no PHP. The Actions bake flips STATIC to true and drops api.php's output next to
// index.html as api.json; nothing sniffs the hostname, and the two builds differ by this one line.
// Camera stills need no proxy in that build: upstream serves the same file over TLS, so an https
// page can hotlink it. api.php still fetches them server-side because it also validates the host.
export const STATIC = false;
export const FEED   = STATIC ? 'api.json' : 'api.php';
export const camSrc = s =>
  STATIC ? s.image.replace(/^http:/i, 'https:') : `api.php?cam=${s.id.split('-')[1]}`;
