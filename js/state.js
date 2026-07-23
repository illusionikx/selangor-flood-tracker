// Mutable app state, in one object so modules share live values instead of importing each other.
// ponytail: a plain object, not a store library. Nothing here needs change notification — every
// consumer is already re-run by render() / alerts() after a poll.

export const state = {
  data: [],        // stations from the last successful poll
  hereAt: null,    // L.LatLng of the user's fix, once we have one
  // Test mode lives here, not in PREFS: a saved fake flood is one a later visitor inherits without
  // having asked for it, and the badge explaining why the map is on fire is easy to dismiss as
  // decoration. A reload is the one thing everyone tries, so a reload must clear it.
  test: false,
  pinned: null,    // id of a station a jump forced past the drawer filters, until the user pans off
  // Mast radius, in metres, for the hover ring. api.php's SITE_M is the real one and overwrites this
  // on every poll — this is only what to draw before the first payload lands.
  siteM: 50,
  // render.js parks itself here so map.js can rebuild the markers without importing it — the two
  // already point the other way (render.js -> map.js) and a cycle would break the module graph.
  rerender: () => {},
};

// One blob for every user setting. ponytail: localStorage, not a settings service.
export const PREFS = { layers: {}, ...JSON.parse(localStorage.getItem('prefs') || '{}') };
export const save = () => localStorage.setItem('prefs', JSON.stringify(PREFS));
