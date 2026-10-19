// Entry point. Importing a module runs its wiring; this file only decides what happens on landing.
// Load order matters in one place: ./ui.js builds the layer chips that render() reads back, so it
// must be imported before the first load().

import './oops.js';   // first, and it must stay first — see the file for why
import { POLL_MS } from './config.js';
import './ui.js';
import { findMe } from './locate.js';
import { load } from './net.js';
import './keys.js';     // last: nothing imports it, and it reads `#locate`, which locate.js builds

requestAnimationFrame(() => document.body.classList.add('ready')); // no drawer slide on first paint

/* Register the worker that makes this installable (see sw.js). Resolved against this module's own
   URL rather than passing a bare 'sw.js', so it is the root worker on both hosts — the file sits
   beside index.html, one level up from here. Failures are ignored on purpose: no worker means no
   install button and nothing else, so there is nothing to tell anyone about. */
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});

findMe(false);   // locate on landing for the proximity sort, but leave the view where they left it

/* **A hidden tab polls too, since 2026-10-14, on the repository owner's request.** The rule before
   this one polled only while the tab was visible, to spare JPS. That argument did not hold. A poll
   reaches this server's 5-minute cache, never JPS, and an unchanged payload costs one 304 of about
   200 bytes. So a reader who switches back sees current readings and a current weather layer at
   once. The weather layer rides render(), so this one timer refreshes both.
   A browser can still freeze a hidden tab, and a phone always does. The listener below catches up
   on return, the moment the tab is visible again. */
let polled = 0;
const poll = () => { polled = Date.now(); load(); };

poll();
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - polled > POLL_MS) poll();
});

/* **No `resize` handler, and there was one until 2026-09-15.** It ran a whole `render()` after every
   resize, because the map popup baked its width in at render time. The popup is gone, and nothing
   `render()` draws reads a width. On a phone the address bar fires `resize` as it hides, so the
   handler rebuilt every pin on a scroll. The pins, the heat layers and the ticker each follow their
   own box already. */
