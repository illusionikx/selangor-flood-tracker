// Polling the proxy, and the diagnostics popover that reports honestly on what came back.

import { FEED, POLL_MS, FEED_LATE_MS, SOURCES } from './config.js';
import { state, PREFS } from './state.js';
import { el, ago } from './util.js';
import { render } from './render.js';
import { alerts } from './alerts.js';
import { alertToast } from './toast.js';
import { ticker } from './ticker.js';
import { askJson } from './ask.js';

/* One question, answered by a word in a popover — is what I am looking at current? Every extra
   clause was answering a question nobody had asked yet ("upstream down — showing cache" is two
   facts and a dash). It was a pill with the word written in it until the bar ran out of room for
   both a ticker and six controls, and then a coloured dot on the mark's corner until the rail took
   the mark's own bar space. The word and the diagnostics are one hover away on the glyph now, and
   nothing paints a colour any more. The ones that were only ever useful to me while building it
   (HTTP status, detail-call tally, fetch milliseconds, offline percentage) are gone too.

   Still measured, not assumed: 'live' needs a 200, a live upstream, and readings stamped within the
   last 2h (JPS publishes hourly). */
let last;   // the payload the popover is currently describing, so the ages can tick between polls
/* The failure that goes with `last`, if any. The 30-second re-render below hands both back, so a
   refresh keeps the state it is refreshing and only the ages move. Without this the interval
   re-rendered a failed poll as a healthy one, and a reader watching a real outage saw the status
   read live again with no successful poll behind it. */
let lastErr;

/* The four facts behind the diagnostics popover. Exported because the Developer section in the About dialog
   shows the same numbers, and two copies of this list would drift the first time one of them gained
   a row. */
export const feedRows = j => [
  ['readings', j.sourceUpdated ? ago(j.sourceUpdated) : 'unknown'],
  ['last checked', ago(j.fetched)],
  ['stations', j.stations.length],
  ['from', j.cacheAge ? `cache, ${j.cacheAge}s old` : 'JPS'],
];

/* What the popover's status line has no room for. The scraped counters are the alarm for a scraper that broke —
   `parsed: 0` means a table moved upstream, not that the rivers went quiet — and until now they
   were in the payload and on no screen. */
export const sourceRows = j => [
  ['upstream', j.upstreamOk === false ? 'not answering' : 'ok'],
  ['fetch time', `${j.tookMs ?? '?'} ms`],
  ['detail calls', `${j.details?.ok ?? '?'} of ${j.details?.requested ?? '?'}`],
  ['kl scraped', `${j.sources?.kl?.parsed ?? '?'} parsed, ${j.sources?.kl?.added ?? '?'} added`],
  ['national scraped',
    `${j.sources?.national?.parsed ?? '?'} parsed, ${j.sources?.national?.applied ?? '?'} applied`],
  ['portal rainfall',
    `${j.sources?.portalrf?.parsed ?? '?'} parsed, ${j.sources?.portalrf?.applied ?? '?'} applied`],
  ['offline stations', j.offline ?? '?'],
];

/** The payload the popover is currently describing, so the About dialog reports the same poll. */
export const lastPayload = () => last;

/* Two messages, not a taxonomy of faults. Whatever broke, the reader's next move is the same:
   read the age on screen and decide whether to trust it. So the message says which of the two
   things a reader can act on has happened, and the age rows below it carry the rest.
   None of our own words for the plumbing: no status code, no exception text, no `proxy`. The raw
   `e.message` used to land here, and it reads `Unexpected token '<'` or `Failed to fetch`
   depending on the browser. */
const netMessage = () => navigator.onLine ? 'Could not reach the server.' : 'No connection.';

function network(j, err) {
  /* Keep describing what is on screen. A failed poll leaves the last good payload drawn on the
     map, so the age of those readings is exactly what a reader needs at that moment. Clearing this
     dropped the age rows precisely when they mattered, and left the popover with a problem and no
     way to judge it. */
  if (!err) last = j;
  lastErr = err;
  const stale = j && j.sourceUpdated && (Date.now() - new Date(j.sourceUpdated)) / 3.6e6 > 2;
  // Test mode outranks every real state: whatever the feed is doing, the map is not showing it.
  const text = state.test          ? 'test mode'
    : err                          ? 'offline'
    : j.upstreamOk === false       ? 'cached'
    : stale                        ? 'stale'
                                   : 'live';
  /* The problem line and the age rows are not alternatives. On a failure the reader wants both:
     what went wrong, and how old the map under it is. `last` survives a failure now, so the age
     rows still have a payload to describe. */
  const rows = [
    ['status', text],
    ...(err ? [['problem', netMessage()]] : []),
    ...(last ? feedRows(last) : []),
  ];

  el('netstats').innerHTML =
    rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join('')
    // The one thing the popover can't show but everyone asks: it updates by itself, on a timer.
    + `<tr class="note"><td colspan="2" class="muted">Refreshes itself every ${
         POLL_MS / 60000} minutes. Nothing to reload.</td></tr>`;
}

/* The page updates itself every POLL_MS, but between polls the popover said "last checked 4 minutes
   ago" for four minutes without moving — which reads as a page that has stopped, not one that is
   waiting. Re-rendering the same payload every 30s costs nothing and makes the clock visibly run.
   `stale` also flips on its own this way, without needing a poll to notice the readings aged out.
   The replay passes `lastErr` back in too, so a poll that failed keeps reading failed — the
   status word and the problem row hold their state, and only the ages underneath keep ticking. */
setInterval(() => {
  if (last) network(last, lastErr);
  if (late()) { alerts(); ticker(); }
}, 30000);

/* **A feed that stops updating raises a Service Notice**, on the repository owner's instruction of
   2026-10-14. JPS went offline for two to three hours one week, and only a stamp said so.
   The test runs here against the reader's own clock, never in api.php. So it fires for all three
   faults alike: a feed that stops answering, a feed that answers with old readings, and this server
   failing to refresh at all. That last one has no new payload to carry a server verdict.
   `api.php` publishes each feed's newest reading stamp in `feeds`. A feed past FEED_LATE_MS joins
   one `late` notice, so one outage reads as one tile. The national portal and its rainfall table
   share a name in SOURCES, and the Set folds them.
   **It counts toward nothing**, the way every notice here does: no badge, no count, no red glyph. A
   source outage is not water rising, and an alarm on it is the cry-wolf cost the alert design
   standard rejects. It is in the Notices tab, at the head of the ticker, and in a modal.
   A JPS-declared PublicInfoBanjir outage already names that portal, so its two feeds stay out of
   this one rather than stating the same outage twice.
   Returns true when the set changed, so a caller repaints only then and the ticker keeps its run. */
let baseNotices = [], feeds = {}, lateKey = '';
function late() {
  const declared = baseNotices.some(n => n.id === 'publicinfobanjir');
  const names = [...new Set(Object.entries(feeds)
    .filter(([k, iso]) => !(declared && (k === 'national' || k === 'portal'))
      && Date.now() - new Date(iso) > FEED_LATE_MS)
    .map(([k]) => SOURCES[k]?.name || k))];
  state.notices = names.length ? [...baseNotices, { id: 'late', regions: names }] : baseNotices;
  const key = names.join('|'), changed = key !== lateKey;
  lateKey = key;
  return changed;
}

/* What the splash says while the first poll is in flight. Only stages we can actually observe get
   their own line — the fetch is one opaque round trip, so there is nothing to report between
   "asked" and "answered" except that it is taking a while, which is worth saying because a cold
   `api.php` fans out ~270 upstream calls and an expired page cache adds ~15s on top. A fake
   progress bar over a wait we cannot measure would be a lie the user has no way to check. */
const say = m => { if (!el('splash').classList.contains('gone')) el('splashMsg').textContent = m; };

export async function load() {
  const first = !el('splash').classList.contains('gone');
  let slow, slower;
  /* Draws the poll bar on the map card, see `#map::before` in css/chrome.css. Never on the first
     load: the splash already says so, and the bar's z-index would paint it over the splash. */
  if (!first) el('map').setAttribute('aria-busy', 'true');
  try {
    if (first) {
      // "Proxy" and "cold start" were our words for our own plumbing. A reader waiting on a splash
      // screen wants to know that something is happening and roughly how long, which is all these
      // say now.
      say('Contacting the server…');
      slow = setTimeout(() => say('Asking JPS for stations. This can take a few seconds.'), 2500);
      slower = setTimeout(() => say('Still waiting on JPS. The first load reads every station, '
        + 'water level, rain gauge and camera. This can take up to 20 seconds.'), 8000);
    }
    /* A longer budget on the first load than on a poll. A cold rebuild measured 36.5 s, and a
       server kept warm by cron answers in 0.08 s. No `cache` option: the server sends an ETag, so
       an unchanged poll is a 304 of about 200 bytes, and `no-store` would throw that away. */
    const j = await askJson(FEED, { ms: first ? 45000 : 20000 });
    clearTimeout(slow); clearTimeout(slower);
    if (first) say('Reading water levels, rainfall, sirens and cameras…');
    /* askJson() already threw on any status outside 200 to 299, so reaching this line means the
       server answered 200 with a body that carries no stations. There is no status left worth
       naming, and `r` no longer exists: the wrapper owns the response object now. */
    if (!j.stations) throw new Error(j.error || 'payload carried no stations');
    state.data = j.stations;
    // Read before network()/alerts()/ticker() run below, in the same order every poll takes.
    state.warnings = j.warnings || [];
    baseNotices = j.notices || [];
    feeds = j.feeds || {};
    late();
    if (j.siteM) state.siteM = j.siteM;   // the radius api.php actually grouped these by
    // Before anything reads it, and only in the client's copy — see test.js. Nothing downstream
    // needs to know it is looking at a drill, which is the point: the drill exercises the real code.
    // Awaited, not fired and forgotten. render() below draws whatever state.data holds at that
    // moment, so a drill that arrives one tick late would draw the real payload first.
    if (state.test) (await import('./test.js')).seedTest(state.data);
    // render() blocks for as long as it takes to build 400-odd markers and popups, so the line
    // has to be given a frame to paint in — set and then rendered in the same task, it would
    // never appear at all.
    if (first) { say(`Placing ${j.stations.length} stations on the map…`); await new Promise(requestAnimationFrame); }

    network(j);
    render(); alerts(); ticker();
    // After alerts(), and only from here — alerts() also runs on every filter change, and hiding a
    // district must not read as stations going on alert.
    alertToast();
    el('splash').classList.add('gone');
    // A real poll landed, with a fresh payload behind lastPayload(). Dispatched rather than
    // imported straight into ui.js — that module already imports this one, and importing back the
    // other way would close the cycle. ui.js repaints the Developer table only while it is on
    // screen, the same rule openSide() already follows for the station panel.
    document.dispatchEvent(new Event('poll'));
  } catch (e) {
    clearTimeout(slow); clearTimeout(slower);
    network(null, e.message);
    // The map still draws the last good payload, so its feeds keep ageing against the clock.
    if (late()) { alerts(); ticker(); }
    if (!el('splash').classList.contains('gone')) {
      // Nothing has ever loaded. With no connection there is nothing truthful to show, so hold the
      // splash; if we are online it is the feed that is down, so let them at the map.
      if (!navigator.onLine) {
        el('splash').classList.add('offline');
        el('splashWarn').hidden = false;
      } else {
        el('splashMsg').textContent = 'Could not reach the flood data. Showing the map anyway.';
        setTimeout(() => el('splash').classList.add('gone'), 1200);
      }
    }
  } finally {
    /* Test mode holds the bar for 3 s. A warm poll ends before the bar's 400ms delay, so without
       this hold a reader never sees it. Not awaited, so Refresh now gets its answer at once. */
    const off = () => el('map').removeAttribute('aria-busy');
    state.test ? setTimeout(off, 3000) : off();
  }
}
