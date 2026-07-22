// "On alert" panel. Always present: a panel that vanishes when all is well is indistinguishable
// from a panel that broke, so quiet is stated rather than implied.

import { KINDS, STATUS_COLOR, NO_INFO } from './config.js';
import { state, PREFS } from './state.js';
import { el, distKm, dkey } from './util.js';
import { flashTo } from './map.js';
import { nearestCam, byId } from './stations.js';
import { meter, sparkline, etaText } from './popup.js';

// Last count, so the panel only auto-collapses on the *change* to zero. Starts non-zero so a first
// load with nothing on alert still counts as a transition and collapses; a first load with alerts
// doesn't, leaving ui.js's saved open/closed preference alone.
let wasHot = -1;

export function alerts() {
  const hidden = new Set(PREFS.hidden || []);
  const hot = state.data.filter(s => !hidden.has(dkey(s)) && (
    (s.kind === 'river' && (s.status >= 3 || s.rising)) ||
    (s.kind === 'siren' && s.status > 0)));
  const rising = hot.filter(s => s.rising).length;
  const danger = hot.filter(s => s.kind === 'river' && s.status >= 3).length;
  const sirens = hot.filter(s => s.kind === 'siren').length;
  const hereAt = state.hereAt;

  // Icons rather than "(2 rising / 1 danger)": the tab is 300px wide and the words wrapped as soon
  // as all three counts were non-zero — which is exactly when the panel matters most. Each count
  // keeps its title/aria text, so nothing is conveyed by the glyph alone.
  const tally = [
    [rising, 'expand_less', 'rising', '#e8710a'],
    [danger, 'warning',     'at danger', '#d93025'],
    [sirens, 'campaign',    'sounding', '#d93025'],
  ].filter(([n]) => n)
   .map(([n, icon, what, c]) => `<b style="--c:${c}" title="${n} ${what}" aria-label="${n} ${what}"
        ><i>${icon}</i>${n}</b>`).join('');

  // The warning glyph is the at-a-glance signal, so it carries the size of the problem on the usual
  // status ramp: grey nothing, amber a handful, orange a bad night, red district-wide. The steps are
  // judgement, not a JPS definition — one rising station is normal, ten at once is not.
  const c = !hot.length ? NO_INFO
    : STATUS_COLOR[hot.length >= 10 ? 3 : hot.length >= 5 ? 2 : 1];

  el('alertTab').innerHTML =
    `<i class="lead" style="--c:${c}">warning</i><span>On alert${
      hot.length && hereAt ? ' <span class="muted">· nearest first</span>' : ''
    }</span><span class="tally">${tally}</span>`;

  // Collapse to the tab when there is nothing to list, and spring back open when something appears.
  // Only on the transition, so a user who opened the all-clear to read it isn't shut again on the
  // next poll — and reopening still respects their preference for a closed panel.
  if (!hot.length !== !wasHot) {
    const open = hot.length > 0 && PREFS.alertsOpen !== false;
    el('alerts').classList.toggle('open', open);
    el('alertTab').setAttribute('aria-expanded', open);
  }
  wasHot = hot.length;

  if (!hot.length) {
    // Name the place only when there is one place to name; otherwise say the view is filtered, so a
    // quiet panel is never mistaken for a quiet state when half the districts are switched off.
    const on = new Set(state.data.filter(s => !hidden.has(dkey(s))).map(s => s.district));
    const where = on.size === 1 ? ` in ${[...on][0]}`
                : hidden.size   ? ' in the districts you are showing' : '';
    el('alertBody').innerHTML =
      `<p class="empty muted">All clear${where}. Nothing rising or in danger.</p>`;
    return;
  }

  // Nearest-first once we know where you are; otherwise sirens, then closest-to-danger.
  el('alertBody').innerHTML = hot
    .sort(hereAt ? (a, b) => distKm(hereAt, a) - distKm(hereAt, b)
                 : (a, b) => (b.kind === 'siren') - (a.kind === 'siren') || (b.ratio || 0) - (a.ratio || 0))
    .map(s => {
      const kind = KINDS[s.kind];
      const cam = nearestCam(s);

      const detail = s.kind === 'siren'
        ? '<div class="state on">TRIGGERED</div>'
        : `${meter(s)}
           ${s.rate != null ? `<div class="muted">trend <b class="${s.rate > 0 ? 'up' : 'down'}">${
             s.rate > 0 ? '▲' : '▼'} ${Math.abs(s.rate)} m/h</b>${
             s.eta != null ? ` · danger <b class="${s.rising ? 'up' : ''}">${etaText(s.eta)}</b>` : ''}</div>` : ''}
           ${sparkline(s.history)}`;

      return `<div class="alert">
        <span class="badge" style="--c:${kind.color}"><i>${kind.icon}</i>${kind.one || kind.label}</span>
        <div class="popname name" data-go="${s.id}">${s.name}</div>
        <div class="muted">${[s.district, s.state].filter(Boolean).join(', ')} · ${s.basin || 'basin n/a'}${
          hereAt ? ` · <b>${distKm(hereAt, s).toFixed(1)} km from you</b>` : ''}</div>
        ${detail}
        ${cam ? `<button class="link" data-cam="${cam.id}">
          <i>photo_camera</i> Nearest station with a webcam · ${cam.name} (${distKm(s, cam).toFixed(1)} km)</button>` : ''}
        <div class="muted">updated ${s.updated || s.shot || 'unknown'}</div>
      </div>`;
    }).join('');

  // Bound here rather than delegated, because the phone case needs to collapse the panel first.
  el('alertBody').querySelectorAll('[data-go]').forEach(node => node.onclick = () => {
    const t = byId(node.dataset.go);
    if (!t) return;
    // On a phone the panel covers the map, so get out of the way of the flash.
    if (matchMedia('(max-width: 600px)').matches) {
      el('alerts').classList.remove('open');
      el('alertTab').setAttribute('aria-expanded', false);
    }
    flashTo(t);
  });
}
