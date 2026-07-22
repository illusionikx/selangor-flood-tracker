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

findMe(false);   // locate on landing for the proximity sort, but leave the view where they left it

/* Poll only while someone is looking. A tab left open in the background costs a request every five
   minutes for ever, and a handful of forgotten tabs is a steady drum of traffic from one address
   for data nobody is reading — the polite thing, and the thing least likely to get the server
   blocked by JPS. Coming back refreshes at once if the data has aged past a poll, so an unattended
   tab is never showing anything staler than it would have been. */
let polled = 0;
const poll = () => { polled = Date.now(); load(); };

poll();
setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - polled > POLL_MS) poll();
});

let resizeTimer;   // popup width is baked in at render, so rebuild markers after a rotate
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data.length && render(), 250);
});
