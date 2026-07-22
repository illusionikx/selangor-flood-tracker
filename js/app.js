// Entry point. Importing a module runs its wiring; this file only decides what happens on landing.
// Load order matters in one place: ./ui.js builds the layer chips that render() reads back, so it
// must be imported before the first load().

import { POLL_MS } from './config.js';
import { state } from './state.js';
import './ui.js';
import { findMe } from './locate.js';
import { load } from './net.js';
import { render } from './render.js';

requestAnimationFrame(() => document.body.classList.add('ready')); // no drawer slide on first paint

load();
findMe(false);   // locate on landing for the proximity sort, but leave the view where they left it

setInterval(load, POLL_MS);

let resizeTimer;   // popup width is baked in at render, so rebuild markers after a rotate
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data.length && render(), 250);
});
