// Polling the proxy, and the status chip that reports honestly on what came back.

import { state, PREFS } from './state.js';
import { el, ago } from './util.js';
import { render } from './render.js';
import { alerts } from './alerts.js';

// Everything here is measured, not assumed: green needs a 200, a live upstream, and readings
// stamped within the last 2h (JPS publishes hourly).
function network(j, err) {
  const stale = j && j.sourceUpdated && (Date.now() - new Date(j.sourceUpdated)) / 3.6e6 > 2;
  const [color, text] = err          ? ['#ff4d4d', 'proxy unreachable']
    : j.upstreamOk === false         ? ['#ff4d4d', 'upstream down — showing cache']
    : stale                          ? ['#ffd166', 'connected, readings stale']
                                     : ['#06d6a0', 'live'];
  const sections = err ? [['Feed', [['error', err]]]] : [
    ['Feed', [
      ['stations', j.stations.length],
      ['offline', `${j.offline} (${(j.offline / j.stations.length * 100).toFixed(0)}%)`],
      ['readings', j.sourceUpdated ? ago(j.sourceUpdated) : 'unknown'],
      ['polled', ago(j.fetched)],
    ]],
    ['Network', [
      ['upstream', j.upstreamOk === false ? 'unreachable' : 'HTTP 200'],
      ['detail calls', `${j.details.ok}/${j.details.requested}`],
      ['fetch time', j.tookMs + ' ms'],
      ['served from', j.cacheAge ? `cache, ${j.cacheAge}s old` : 'upstream'],
    ]],
  ];
  const table = sections.map(([head, rows], i) =>
    `<tr class="${i ? 'gap' : ''}"><td class="head muted" colspan="2">${head}</td></tr>` +
    rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join('')).join('');

  el('net').style.setProperty('--c', color);   // chip tint, dot and halo all follow the state
  el('net').innerHTML = `<span class="swatch"></span><span>${text}</span>` +
    `<table id="netstats" class="surface">${table}</table>`;
}

export async function load() {
  try {
    const r = await fetch('api.php');
    const j = await r.json();
    if (!j.stations) throw new Error(j.error || 'HTTP ' + r.status);
    state.data = j.stations;

    network(j);
    render(); alerts();
    el('splash').classList.add('gone');
  } catch (e) {
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
