// Polling the proxy, and the status chip that reports honestly on what came back.

import { FEED, POLL_MS } from './config.js';
import { state, PREFS } from './state.js';
import { el, ago } from './util.js';
import { render } from './render.js';
import { alerts } from './alerts.js';
import { alertToast } from './toast.js';
import { ticker } from './ticker.js';
import { seedTest } from './test.js';

/* One word and a dot. The chip answers one question — is what I am looking at current? — and every
   extra clause was answering a question nobody had asked yet ("upstream down — showing cache" is
   two facts and a dash in a 64px bar). The diagnostics that used to be in the chip are still one
   hover away; the ones that were only ever useful to me while building it (HTTP status, detail-call
   tally, fetch milliseconds, offline percentage) are gone.

   Still measured, not assumed: green needs a 200, a live upstream, and readings stamped within the
   last 2h (JPS publishes hourly). */
let last;   // the payload the chip is currently describing, so the ages can tick between polls

function network(j, err) {
  last = err ? null : j;
  const stale = j && j.sourceUpdated && (Date.now() - new Date(j.sourceUpdated)) / 3.6e6 > 2;
  // Test mode outranks every real state: whatever the feed is doing, the map is not showing it.
  const [color, text] = state.test   ? ['#e8710a', 'test mode']
    : err                            ? ['#ff4d4d', 'offline']
    : j.upstreamOk === false         ? ['#ff4d4d', 'cached']
    : stale                          ? ['#ffd166', 'stale']
                                     : ['#06d6a0', 'live'];
  const rows = err ? [['problem', err]] : [
    ['readings', j.sourceUpdated ? ago(j.sourceUpdated) : 'unknown'],
    ['last checked', ago(j.fetched)],
    ['stations', j.stations.length],
    ['from', j.cacheAge ? `cache, ${j.cacheAge}s old` : 'JPS'],
  ];

  el('net').style.setProperty('--c', color);   // chip tint, dot and halo all follow the state
  el('net').innerHTML = `<span class="swatch"></span><span>${text}</span>`
    + `<table id="netstats" class="surface">`
    + rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join('')
    // The one thing the chip can't show but everyone asks: it updates by itself, on a timer.
    + `<tr class="note"><td colspan="2" class="muted">Refreshes itself every ${
         POLL_MS / 60000} minutes. Nothing to reload.</td></tr></table>`;
}

/* The page updates itself every POLL_MS, but between polls the chip said "last checked 4 minutes
   ago" for four minutes without moving — which reads as a page that has stopped, not one that is
   waiting. Re-rendering the same payload every 30s costs nothing and makes the clock visibly run.
   `stale` also flips on its own this way, without needing a poll to notice the readings aged out. */
setInterval(() => last && network(last), 30000);

/* What the splash says while the first poll is in flight. Only stages we can actually observe get
   their own line — the fetch is one opaque round trip, so there is nothing to report between
   "asked" and "answered" except that it is taking a while, which is worth saying because a cold
   `api.php` fans out ~270 upstream calls and an expired page cache adds ~15s on top. A fake
   progress bar over a wait we cannot measure would be a lie the user has no way to check. */
const say = m => { if (!el('splash').classList.contains('gone')) el('splashMsg').textContent = m; };

export async function load() {
  const first = !el('splash').classList.contains('gone');
  let slow, slower;
  try {
    if (first) {
      say('contacting the proxy…');
      slow = setTimeout(() => say('asking JPS for stations — this can take a few seconds'), 2500);
      slower = setTimeout(() => say('still waiting on JPS. A cold start rebuilds the whole '
        + 'station list, water levels, rainfall and cameras, and can take up to 20 seconds'), 8000);
    }
    const r = await fetch(FEED);
    clearTimeout(slow); clearTimeout(slower);
    if (first) say('reading water levels, rainfall, sirens and cameras…');
    const j = await r.json();
    if (!j.stations) throw new Error(j.error || 'HTTP ' + r.status);
    state.data = j.stations;
    // Before anything reads it, and only in the client's copy — see test.js. Nothing downstream
    // needs to know it is looking at a drill, which is the point: the drill exercises the real code.
    if (state.test) seedTest(state.data);
    // render() blocks for as long as it takes to build 400-odd markers and popups, so the line
    // has to be given a frame to paint in — set and then rendered in the same task, it would
    // never appear at all.
    if (first) { say(`placing ${j.stations.length} stations on the map…`); await new Promise(requestAnimationFrame); }

    network(j);
    render(); alerts(); ticker();
    // After alerts(), and only from here — alerts() also runs on every filter change, and hiding a
    // district must not read as stations going on alert.
    alertToast();
    el('splash').classList.add('gone');
  } catch (e) {
    clearTimeout(slow); clearTimeout(slower);
    network(null, e.message);
    if (!el('splash').classList.contains('gone')) {
      // Nothing has ever loaded. With no connection there is nothing truthful to show, so hold the
      // splash; if we are online it is the feed that is down, so let them at the map.
      if (!navigator.onLine) {
        el('splash').classList.add('offline');
        el('splashWarn').hidden = false;
      } else {
        el('splashMsg').textContent = 'could not reach the feed — showing the map anyway';
        setTimeout(() => el('splash').classList.add('gone'), 1200);
      }
    }
  }
}
