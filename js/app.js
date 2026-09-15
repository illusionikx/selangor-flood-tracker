// Entry point. Importing a module runs its wiring; this file only decides what happens on landing.
// Load order matters in one place: ./ui.js builds the layer chips that render() reads back, so it
// must be imported before the first load().

import './oops.js';   // first, and it must stay first — see the file for why
import { POLL_MS } from './config.js';
import './ui.js';
import { findMe } from './locate.js';
import { load } from './net.js';

requestAnimationFrame(() => document.body.classList.add('ready')); // no drawer slide on first paint

/* Register the worker that makes this installable (see sw.js). Resolved against this module's own
   URL rather than passing a bare 'sw.js', so it is the root worker on both hosts — the file sits
   beside index.html, one level up from here. Failures are ignored on purpose: no worker means no
   install button and nothing else, so there is nothing to tell anyone about. */
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});

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

/* **No `resize` handler, and there was one until 2026-09-15.** It ran a whole `render()` after every
   resize, because the map popup baked its width in at render time. The popup is gone, and nothing
   `render()` draws reads a width. On a phone the address bar fires `resize` as it hides, so the
   handler rebuilt every pin on a scroll. The pins, the heat layers and the ticker each follow their
   own box already. */
