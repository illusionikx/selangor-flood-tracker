// "On alert" panel. Always present: a panel that vanishes when all is well is indistinguishable
// from a panel that broke, so quiet is stated rather than implied.

import { KINDS, STATUS_COLOR, NO_INFO } from './config.js';
import { state, PREFS } from './state.js';
import { el, distKm, dkey, isHot, tier, TIER_RANK, isIgnored } from './util.js';
import { flashTo } from './map.js';
import { nearestCam, byId } from './stations.js';
import { meter, sparkline, etaText, rateHtml } from './popup.js';

// Last count, so the panel only auto-collapses on the *change* to zero. Starts non-zero so a first
// load with nothing on alert still counts as a transition and collapses; a first load with alerts
// doesn't, leaving ui.js's saved open/closed preference alone.
let wasHot = -1;

export function alerts() {
  const hidden = new Set(PREFS.hidden || []);
  const hot = state.data.filter(s => !hidden.has(dkey(s)) && !isIgnored(s) && isHot(s));
  // Counts describe what is actually known right now, so anything stale is excluded from all three
  // and counted separately. A number that silently includes a reading from April is a lie with a
  // digit in front of it.
  const live   = hot.filter(s => tier(s) !== 'stale');
  const rising = live.filter(s => s.rising).length;
  const danger = live.filter(s => s.kind === 'river' && s.status >= 3).length;
  const sirens = live.filter(s => s.kind === 'siren').length;
  const stale  = hot.length - live.length;
  const hereAt = state.hereAt;

  // Icons rather than "(2 rising / 1 danger)": the tab is 300px wide and the words wrapped as soon
  // as all three counts were non-zero — which is exactly when the panel matters most. Each count
  // keeps its title/aria text, so nothing is conveyed by the glyph alone.
  const tally = [
    [danger, 'warning',     'at danger', '#d93025'],
    [sirens, 'campaign',    'sounding', '#d93025'],
    [rising, 'expand_less', 'rising', '#e8710a'],
    [stale,  'wifi_off',    'not current', 'var(--muted)'],
  ].filter(([n]) => n)
   .map(([n, icon, what, c]) => `<b style="--c:${c}" title="${n} ${what}" aria-label="${n} ${what}"
        ><i class="i i-${icon}"></i>${n}</b>`).join('');

  // The warning glyph is the at-a-glance signal, so it carries the size of the problem on the usual
  // status ramp: grey nothing, amber a handful, orange a bad night, red district-wide. The steps are
  // judgement, not a JPS definition — one rising station is normal, ten at once is not.
  // Counted on `live`, not `hot`: a list made entirely of stations we can no longer read is a
  // maintenance problem, not a flood, and must not paint the glyph red.
  const c = !live.length ? NO_INFO
    : STATUS_COLOR[live.length >= 10 ? 3 : live.length >= 5 ? 2 : 1];

  el('alertTab').innerHTML =
    `<i class="lead i i-warning" style="--c:${c}"></i><span>On alert${
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
    /* An ignored sensor that is *itself* on alert is the one case where "All clear" would be a plain
       lie, so it is stated — not listed, because listing it would undo the thing the user asked for,
       but counted, so the all-clear is one the reader can weigh. The number they need is the ignored
       sensors that are hot right now, not how many are ignored in total. */
    const muted = state.data.filter(s => isIgnored(s) && isHot(s)).length;
    el('alertBody').innerHTML =
      `<p class="empty muted">All clear${where}. Nothing rising or in danger.</p>${
        muted ? `<p class="empty muted"><i class="i i-visibility_off"></i> ${muted} ignored sensor${
          muted > 1 ? 's are' : ' is'} on alert — restore ${
          muted > 1 ? 'them' : 'it'} under Ignored sensors in the filters.</p>` : ''}`;
    return;
  }

  /* Tier before anything else. Nearest-first is the more useful order *within* a tier, but across
     tiers it would put a forecast two streets away above a river already over its danger mark on
     the other side of town — and only one of those is happening. Stale sinks to the bottom whatever
     the distance: it is the one group you cannot act on. */
  el('alertBody').innerHTML = hot
    .sort((a, b) => TIER_RANK[tier(a)] - TIER_RANK[tier(b)]
      || (hereAt ? distKm(hereAt, a) - distKm(hereAt, b)
                 : (b.kind === 'siren') - (a.kind === 'siren') || (b.ratio || 0) - (a.ratio || 0)))
    .map(s => {
      const kind = KINDS[s.kind];
      const cam = nearestCam(s);
      const t = tier(s);

      const detail = s.kind === 'siren'
        ? '<div class="state on">TRIGGERED</div>'
        : `${meter(s)}
           ${s.rate != null ? `<div class="muted">trend ${rateHtml(s)}${
             s.eta != null ? ` · danger <b class="${s.rising ? 'up' : ''}">${etaText(s.eta)}</b>` : ''}</div>` : ''}
           ${sparkline(s.history)}`;

      /* Says which of the three this is, in words, above the reading. The left rule carries the same
         thing in colour for a glance; neither is alone, because a colour nobody has been taught is
         a decoration. */
      const head = t === 'now'  ? '<span class="tg tg-now">HAPPENING NOW</span>'
                 : t === 'soon' ? '<span class="tg tg-soon">FORECAST</span>'
                                : '<span class="tg tg-stale">NOT CURRENT</span>';

      return `<div class="alert t-${t}">
        <span class="badge" style="--c:${kind.color}"><i class="i i-${kind.icon}"></i>${kind.one || kind.label}</span>${head}
        <div class="popname name" data-go="${s.id}">${s.name}</div>
        <div class="muted">${[s.district, s.state].filter(Boolean).join(', ')} · ${s.basin || 'basin n/a'}${
          hereAt ? ` · <b>${distKm(hereAt, s).toFixed(1)} km from you</b>` : ''}</div>
        ${detail}
        ${t === 'stale' ? `<p class="muted">This station has stopped reporting. The reading above is
             the last one it sent and the situation there may have changed either way.</p>` : ''}
        ${cam ? `<button class="link" data-cam="${cam.id}">
          <i class="i i-photo_camera"></i> Nearest station with a webcam · ${cam.name} (${distKm(s, cam).toFixed(1)} km)</button>` : ''}
        <div class="muted">updated ${s.updated || s.shot || 'unknown'}</div>
      </div>`;
    }).join('');
  // No advisory here. It lives on the ticker, which is the strip that stays visible while this panel
  // is scrolled, collapsed or covered — and repeating it in both would make it furniture.

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
