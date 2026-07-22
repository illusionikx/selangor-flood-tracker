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

// Traffic light by status: normal → alert → warning → danger.
export const STATUS_COLOR = ['#188038', '#f9ab00', '#e8710a', '#d93025'];

export const NO_INFO = '#9aa0a6';   // grey: offline or reporting nothing
// "rising" is decided in api.php — a station reaching its own danger mark within RISE_ETA hours at
// the rate it is climbing now. One definition, server-side, so the panel, filter and heat weight
// can never disagree about what counts as an alert.
// Mirrors api.php's RISE_ETA. Only the heat ramp needs the number itself: everything else reads the
// `rising` flag or the published `eta`. Keep the two in step.
export const RISE_ETA = 3;         // hours to danger that count as on alert

// CARTO styles. 'auto' follows the theme; the rest are an explicit choice in the drawer.
// One basemap per theme. ponytail: a picker existed and nobody needs three flavours of grey.
export const TILES = { light: 'rastertiles/voyager', dark: 'dark_all' };

// Sparkline window. Must not exceed the server's own SPARK_WIN — it sends nothing older.
export const SPARK_H     = 12;     // hours on the graph's x axis

export const HEAT_KM     = 4;      // ground size of one blob
export const HEAT_MAX_PX = 220;    // blur cost is quadratic; past this the layer fades instead
export const FLASH_MS    = 2400;   // how long the jump-to ripple runs
export const POLL_MS     = 300000; // matches the proxy's cache TTL
