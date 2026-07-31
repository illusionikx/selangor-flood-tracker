// "On alert": a warning glyph in the app bar, always present — a control that vanishes when all is
// well is indistinguishable from one that broke, so quiet is stated rather than implied — and the
// list itself in the station panel, which is the same popout a pin opens.

import { KINDS, STATUS_COLOR, NO_INFO } from './config.js';
import { state, PREFS } from './state.js';
import { el, distKm, dkey, isHot, tier, TIER_RANK, isIgnored, noSec } from './util.js';
import { side, openSide, closeSide } from './map.js';
import { nearestCam } from './stations.js';
import { meter, sparkline, etaText, rateHtml, camLink } from './popup.js';

/* The list shares #side with the station cards. `@`-prefixed, so render()'s per-poll refresh leaves
   it alone (see the tail of render.js) — this module refreshes it instead, on the same poll.
   Nothing springs it open by itself any more: on the right edge it would land on top of a card
   someone is reading, and the glyph's colour and count are on screen the whole time either way.
   The interruption for news is still the toast. */
const KEY = '@alerts';
let card = '';        // last built list, so the button can open it without waiting for a poll

export function toggleAlerts() {
  side.key === KEY ? closeSide() : openSide(KEY, card);
}

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

  /* The installed app's icon badge — the same number the tab's warning glyph is coloured by, so a
     home screen and this panel never disagree. `live`, not `hot`: a badge is a demand for attention
     and a list of stations we can no longer read is a maintenance problem, not a flood — the same
     line the counts above already draw.
     Zero clears it, per the spec, so there is no second branch. Optional chaining short-circuits the
     whole expression where the API is absent (every browser but Chrome and recent Safari), and the
     `.catch` swallows iOS refusing it until notification permission is granted — which is not asked
     for here, because a permission prompt on landing is exactly the trust-spending the alert
     standard warns about, and the badge is a nicety either way. */
  navigator.setAppBadge?.(live.length).catch(() => {});

  // Icons rather than "(2 rising / 1 danger)": the head is one panel-width and the words wrapped as
  // soon as all three counts were non-zero — which is exactly when the list matters most. Each count
  // keeps its title/aria text, so nothing is conveyed by the glyph alone.
  const tally = [
    [danger, 'warning',     'at danger', STATUS_COLOR[3]],
    [sirens, 'campaign',    'sounding', STATUS_COLOR[3]],
    [rising, 'expand_less', 'rising', STATUS_COLOR[2]],
    [stale,  'wifi_off',    'not current', 'var(--muted)'],
  ].filter(([n]) => n)
   .map(([n, icon, what, c]) => `<b style="--c:${c}" title="${n} ${what}" aria-label="${n} ${what}"
        ><i class="i i-${icon}"></i>${n}</b>`).join('');

  /* The warning glyph carries **severity, not headcount**: red the moment one station is at its
     danger mark or one siren is sounding, amber while the worst of it is still a forecast, grey when
     there is nothing. That is `tier()`'s own split — observed against projected — and the list below
     already draws it as a red or amber rule per row, so the button now agrees with the rows it opens.
     It used to ramp on the number instead (amber 1–4, orange 5–9, red 10+), which put an amber glyph
     over a river standing at danger and a red one over ten stations merely forecast to climb. CAP
     keeps severity and urgency on separate axes for exactly this reason, and the count was never
     missing from the button — it is the badge on the corner.
     Read from `live`, not `hot`: a list made entirely of stations we can no longer read is a
     maintenance problem, not a flood, and must not paint the glyph red. */
  const c = !live.length ? NO_INFO
    : STATUS_COLOR[live.some(s => tier(s) === 'now') ? 3 : 1];

  /* The bar's own signal. The badge counts `live` — the same number as the app icon's, for the same
     reason: it is a demand for attention, and stations we can no longer read are not one. The
     breakdown that used to sit under the tab is in the panel head instead, where there is width for
     it; the button carries the colour and the number, which is all a 40px control can say. */
  const btn = el('alertBtn');
  btn.style.setProperty('--c', c);
  btn.innerHTML = `<i class="i i-warning"></i><b class="abadge">${live.length || ''}</b>`;
  const what = live.length ? `${live.length} station${live.length > 1 ? 's' : ''} on alert`
                           : 'On alert — all clear';
  btn.title = what;
  btn.setAttribute('aria-label', what);

  // The head, lifted into #sideHead by openSide() — which is why it must stay the first element.
  const head = `<div class="pophead"><div class="popname">On alert${
    hot.length && hereAt ? ' <span class="muted">· nearest first</span>' : ''
  }</div><div class="tally">${tally}</div></div>`;

  const write = body => {
    card = head + body;
    if (side.key === KEY) openSide(KEY, card);
  };

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
    write(`<p class="empty muted">All clear${where}. Nothing rising or in danger.</p>${
      muted ? `<p class="empty muted"><i class="i i-visibility_off"></i> ${muted} ignored sensor${
        muted > 1 ? 's are' : ' is'} on alert — restore ${
        muted > 1 ? 'them' : 'it'} under Ignored sensors in the filters.</p>` : ''}`);
    return;
  }

  /* Tier before anything else. Nearest-first is the more useful order *within* a tier, but across
     tiers it would put a forecast two streets away above a river already over its danger mark on
     the other side of town — and only one of those is happening. Stale sinks to the bottom whatever
     the distance: it is the one group you cannot act on.
     Sirens then cluster inside their tier, after the rivers. A list that alternates between a
     water level and a triggered siren changes units on every row. A level is a number to judge.
     A siren is already a decision somebody else made. Grouping costs the strict nearest-first
     order inside a tier, which is why it sits below tier and not above it.
     This reverses the old no-location default, which led with sirens. Swap the two operands to put
     sirens back on top. */
  write(hot
    .sort((a, b) => TIER_RANK[tier(a)] - TIER_RANK[tier(b)]
      || (a.kind === 'siren') - (b.kind === 'siren')
      || (hereAt ? distKm(hereAt, a) - distKm(hereAt, b)
                 : (b.ratio || 0) - (a.ratio || 0)))
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
        ${cam ? camLink(s, cam) : ''}
        <div class="muted">updated ${noSec(s.updated || s.shot) || 'unknown'}</div>
      </div>`;
    }).join(''));
  // No advisory here. It lives on the ticker, which is the strip that stays visible while this list
  // is closed or covered — and repeating it in both would make it furniture.
  // Nor is anything bound to the rows: the list is in #side now, so ui.js's delegated [data-go]
  // handler reaches it, and the station card it opens *replaces* the list rather than sitting behind
  // it — which is the phone case the old per-row handler had to collapse the panel for.
}
