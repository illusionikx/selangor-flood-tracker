// Mutable app state, in one object so modules share live values instead of importing each other.
// ponytail: a plain object, not a store library. Nothing here needs change notification — every
// consumer is already re-run by render() / alerts() after a poll.

export const state = {
  data: [],        // stations from the last successful poll
  hereAt: null,    // L.LatLng of the user's fix, once we have one
  pinned: null,    // id of a station a jump forced past the drawer filters, until the user pans off
  // render.js parks itself here so map.js can rebuild the markers without importing it — the two
  // already point the other way (render.js -> map.js) and a cycle would break the module graph.
  rerender: () => {},
};

// One blob for every user setting. ponytail: localStorage, not a settings service.
export const PREFS = { layers: {}, ...JSON.parse(localStorage.getItem('prefs') || '{}') };
export const save = () => localStorage.setItem('prefs', JSON.stringify(PREFS));
