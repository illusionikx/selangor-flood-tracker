// Constants shared across modules. No imports here — everything else may depend on this.

// Station types. Colours are deliberately NOT traffic-light hues: green/amber/orange/red and grey
// are reserved for status, so a type colour can never be mistaken for an alert level.
export const KINDS = {
  river:    { label: 'Water level', color: '#4da3ff', icon: 'water_drop' },
  rainfall: { label: 'Rainfall',    color: '#8f7bff', icon: 'rainy' },
  siren:    { label: 'Sirens',      color: '#f06292', icon: 'campaign',    one: 'Siren' },
  gauge:    { label: 'Flood gauge', color: '#a1887f', icon: 'straighten' },
  camera:   { label: 'Cameras',     color: '#26c6da', icon: 'photo_camera', one: 'Camera' },
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

// Upstream status codes: river -1 offline, 0 normal, 1 alert, 2 warning, 3 danger.
export const RIVER_COLOR = { '-1': '#555', 0: '#4da3ff', 1: '#ffd166', 2: '#ff9f1c', 3: '#ff4d4d' };
export const RAIN_COLOR  = { '-1': '#555', 0: '#3a3a6a', 1: '#6f7bff', 2: '#8f7bff', 3: '#c77dff', 4: '#ff4d4d' };

// Which sensor speaks for a mast when several share one: a river gauge says more about a flood than
// the rainfall gauge strapped to the same pole, and a camera says least until you open it. Used for
// the pin's lead sensor and for the order sensors are listed in, so both tell the same story.
export const KIND_RANK = ['river', 'siren', 'gauge', 'rainfall', 'camera'];

// Traffic light by status: normal → alert → warning → danger.
export const STATUS_COLOR = ['#188038', '#f9ab00', '#e8710a', '#d93025'];

export const NO_INFO = '#9aa0a6';   // grey: offline or reporting nothing
// "rising" is decided in api.php — a station reaching its own danger mark within its RISE_ETA at the
// rate it is climbing now. One definition, server-side, so the panel and the filter can never
// disagree about what counts as an alert. The client never re-derives it: it reads `s.rising`, or
// the published `eta` where it wants to show the number. Nothing here mirrors the constant any more
// — the heat ramp was the last thing that did, and it is keyed on thresholds now.

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

export const HEAT_KM     = 4;      // ground size of one blob
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
