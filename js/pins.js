/* The station marks, drawn on ONE canvas instead of on one DOM node each.
 *
 * **Why this file exists.** Every station pin used to be a Leaflet `divIcon`: an absolutely
 * positioned `<span>` holding an inline `<svg>`. Leaflet scales the whole marker pane through a zoom
 * animation, so 260 of those rasterize again on each frame of it. Measured over one scripted gesture
 * of six zoom steps and two pans, three runs of each condition taken alternately, medians:
 *
 *     DOM pins, clustered, 260 icons     103 frames in 4.2 s   95th pct frame 140 ms   967 ms of JS
 *     this layer, 460 marks, no cluster  230 frames            95th pct frame  25 ms   323 ms of JS
 *     no marks on the map at all         232 frames            95th pct frame  29 ms   351 ms of JS
 *
 * The canvas draws twice as many marks as the DOM did and costs what drawing nothing costs. That is
 * the whole argument. See docs/FEATURES.md for the four other repairs that were measured and left.
 *
 * **It takes no dependency.** No WebGL, no Pixi, no vector tiles. Leaflet gives a layer a pane and a
 * zoom transform, and the rest is `drawImage`.
 *
 * **The marker objects stay.** `render.js` still builds an `L.Marker` per site, and this layer draws
 * from that same array. A click here fires the marker's own `click` event, so `openSide()`,
 * `flashTo()`, `siteMark` and the mast hover ring all work with no change. Nothing about this file
 * knows what a station is.
 *
 * **What is NOT on the canvas.** The selected pin stays a DOM marker, so `markSel()` keeps the
 * teardrop it already draws in CSS and this file needs no selected state. "You are here", a searched
 * place and the weather pins are all DOM too — there are at most a handful of them, and each is a
 * different mark with its own rules.
 */

/* Every number here comes out of `css/map.css`, after the `scale(.7)` that rule applies to `.pin`.
   **Change a number there and change it here**, or the canvas mark and the DOM marks beside it
   (the legend, the glossary, "you are here") stop reading as one set.
   `.pin` is a 39px box with a 36px glyph. `.pinglyph.disc` draws in a 40-unit viewBox: a disc at
   r 17.5 with a 2.5 stroke, the shadow circle 1.3 lower at r 17.6, and the kind glyph in a 24-unit
   box at x8 y8. The rings are pseudo-elements sized by `inset` off the 39px box. */
const SCALE = 0.7;
const GLYPH_BOX = 36 * SCALE;                       // 25.2 — what one `.pinglyph` covers on screen
const U = GLYPH_BOX / 40;                           // one viewBox unit, in screen pixels
export const R_DISC = 17.5 * U;                     // 11.03 — the disc a hit test aims at
const W_DISC = 2.5 * U;
const R_SHADE = 17.6 * U, DY_SHADE = 1.3 * U;
const G_SIZE = 24 * U;                              // 15.12 — the glyph knocked out of the disc
const R_RISE = (49 / 2 - 3 / 2) * SCALE, W_RING = 3 * SCALE;
const R_HALO = (51 / 2 - 3 / 2) * SCALE;
const FAV_SIZE = 17 * SCALE, FAV_OFF = 14 * SCALE;  // the heart, on the pin's lower trailing corner
/* `.cluster` is a 21px chip with a 1px border and a 10px 500-weight count. It is the one mark on the
   map whose size is a literal rather than a transform, which `css/map.css` states from its side. */
const R_CHIP = 21 / 2, W_CHIP = 1, CHIP_FONT = '500 10px system-ui, sans-serif';
const R_CHIP_GLOW = R_CHIP + 2;
const SHADOW = 'rgba(0, 0, 0, .45)';                // the one lift every mark on this map casts

/* Half the sprite, in screen pixels. The rise ring is the widest thing a sprite holds, at
   `R_RISE + W_RING / 2`. The danger halo is not in the sprite at all — it animates, so it is drawn
   live on the second canvas. */
const HALF = Math.ceil(R_RISE + W_RING / 2) + 1;

/* Material's own icons carry a `0 -960 960 960` viewBox, so a path's y runs from -960 to 0. The
   sprite draws into a box of `G_SIZE` centred on the origin. */
const VIEW = 960;

/* One `Path2D` per icon name, built from the same `--i-<name>` rule in `css/icons.css` that
   `pinGlyph()` in `js/map.js` reads for the DOM marks. **There is still one home for the path data.**
   This does not go through `pinGlyph()`, because that would make this module import `map.js` and
   `map.js` import this one, and CLAUDE.md holds the import graph acyclic. */
const paths = new Map();
function glyph(name) {
  if (paths.has(name)) return paths.get(name);
  const url = getComputedStyle(document.documentElement).getPropertyValue('--i-' + name);
  const body = url.match(/<svg[^>]*>(.*)<\/svg>/s);
  let p = null;
  if (body) {
    p = new Path2D();
    for (const m of body[1].matchAll(/\sd=['"]([^'"]+)['"]/g)) p.addPath(new Path2D(m[1]));
  }
  paths.set(name, p);
  return p;
}

/* **A TOKEN IS RESOLVED AGAINST A `.pin`, NEVER AGAINST THE ROOT, AND THAT IS NOT A DETAIL.**
   `css/base.css` gives the map its own palette block: `:root[data-theme="dark"], .pin` hands the pin
   the dark set on both themes, and `.pin, #side` states the six kinds again at their own lightness.
   So `--k-river` has one value on the page and another on a pin. A DOM pin resolved `var(--c)` in
   its own context for free. A canvas cannot, so this probe stands in for that context.
   It is one hidden `<span class="pin">`, off screen, holding no size. Reading every token off it
   rather than off the root also means a token the pin block does not override still answers with the
   page value, through ordinary inheritance. */
let probe;
function token(v) {
  if (!probe) {
    probe = document.createElement('span');
    probe.className = 'pin';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden';
    document.body.appendChild(probe);
  }
  v = (v || '').trim();
  if (!v.startsWith('var(')) return v;
  const name = v.slice(4, -1).split(',')[0].trim();
  return getComputedStyle(probe).getPropertyValue(name).trim();
}

/* The sprite cache: one small canvas per distinct pin appearance, drawn once and blitted after that.
   The live payload produces 18 of them. The key names every input the drawing depends on, so a
   station that changes status gets a different sprite rather than a stale one.
   **Cleared on a theme swap.** `--surface`, `--fav` and the kind colours all move with the theme,
   and a sprite is a picture rather than a token. `map.js` calls `resetSprites()` from
   `applyTheme()`. */
let sprites = new Map(), spriteDpr = 0;
export function resetSprites() { sprites = new Map(); }

function sprite(p, dpr) {
  const key = `${p.icon}|${p.c}|${p.ink}|${p.off ? 1 : 0}|${p.rise ? 1 : 0}|${p.fav ? 1 : 0}`;
  const hit = sprites.get(key);
  if (hit) return hit;

  const surface = token('var(--surface)') || '#fff';
  const danger = token('var(--s-danger)') || '#f33';
  const favCol = token('var(--fav)') || '#cc1f7a';
  const fill = token(p.c) || '#4a86e8';

  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(HALF * 2 * dpr);
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.translate(HALF, HALF);
  /* `.pin.off` is `opacity: .6` on the whole mark, so it goes on the sprite rather than on the blit.
     A per-blit alpha would cost a state change for every offline pin on screen. */
  if (p.off) x.globalAlpha = 0.6;

  // The shadow, as a circle. `css/map.css` states why this is not a `filter: drop-shadow`.
  x.beginPath(); x.arc(0, DY_SHADE, R_SHADE, 0, 7); x.fillStyle = 'rgba(0, 0, 0, .38)'; x.fill();

  // The disc, in the station's own colour, with the page's plate colour as its edge.
  x.beginPath(); x.arc(0, 0, R_DISC, 0, 7);
  x.fillStyle = fill; x.fill();
  x.lineWidth = W_DISC; x.strokeStyle = surface; x.stroke();

  // The kind glyph, knocked out of the disc.
  const g = glyph(p.icon);
  if (g) {
    x.save();
    x.translate(-G_SIZE / 2, -G_SIZE / 2);
    x.scale(G_SIZE / VIEW, G_SIZE / VIEW);
    x.translate(0, VIEW);
    x.fillStyle = p.ink;
    x.fill(g);
    x.restore();
  }

  // Forecast to reach danger: a ring outside the disc, in the danger red. `.pin.rise::before`.
  if (p.rise) {
    x.beginPath(); x.arc(0, 0, R_RISE, 0, 7);
    x.lineWidth = W_RING; x.strokeStyle = danger; x.stroke();
  }

  /* The favorite heart, on the lower trailing corner. It carries its own lift in the DOM, and here
     that is one offset copy in the shadow colour under it. */
  const heart = p.fav && glyph('favorite');
  if (heart) {
    for (const [dy, fill] of [[1, SHADOW], [0, favCol]]) {
      x.save();
      x.translate(FAV_OFF - FAV_SIZE / 2, FAV_OFF - FAV_SIZE / 2 + dy);
      x.scale(FAV_SIZE / VIEW, FAV_SIZE / VIEW);
      x.translate(0, VIEW);
      x.fillStyle = fill;
      x.fill(heart);
      x.restore();
    }
  }

  sprites.set(key, cv);
  return cv;
}

/* Greedy grid clustering, one pass per zoom, which is what markercluster does at each of its own
   levels. A mark joins the first cluster already within `r` of it, and starts one otherwise.
   **It runs in PROJECTED pixels at a whole zoom, never in container pixels.** A container point
   moves with every pan, so clustering on one would re-group the map under the reader's finger. */
function group(items, project, r) {
  const cells = new Map(), out = [];
  const r2 = r * r;
  for (const it of items) {
    const p = project(it.marker.getLatLng());
    if (it.loose) { out.push({ x: p.x, y: p.y, n: 1, items: [it] }); continue; }
    const cx = Math.floor(p.x / r), cy = Math.floor(p.y / r);
    let found = null;
    for (let a = cx - 1; a <= cx + 1 && !found; a++)
      for (let b = cy - 1; b <= cy + 1 && !found; b++) {
        const bucket = cells.get(a + ':' + b);
        if (!bucket) continue;
        for (const c of bucket) {
          const dx = c.x - p.x, dy = c.y - p.y;
          if (dx * dx + dy * dy < r2) { found = c; break; }
        }
      }
    if (found) { found.items.push(it); found.n++; continue; }
    const made = { x: p.x, y: p.y, n: 1, items: [it] };
    out.push(made);
    const k = cx + ':' + cy;
    cells.has(k) ? cells.get(k).push(made) : cells.set(k, [made]);
  }
  return out;
}

export const PinLayer = L.Layer.extend({
  /* `radius` answers the cluster radius for a zoom, and `off` is the first zoom that clusters
     nothing. Both come from `map.js`, so the two numbers that set the zoom ceiling stay in one
     place. */
  initialize(opts) {
    L.setOptions(this, opts);
    this._items = [];
    this._drawn = [];
    this._zoom = null;
  },

  /* The marker pane, so the pins draw over the heat wash and over the coverage mask, exactly where
     the DOM markers drew. **It takes no pointer events.** A canvas the size of the map that answered
     a press would swallow every drag. The map's own handlers below do the hit testing instead, which
     is what every canvas marker layer does. */
  onAdd(map) {
    const c = this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated pincanvas');
    const h = this._halo = L.DomUtil.create('canvas', 'leaflet-zoom-animated pincanvas');
    for (const el of [c, h]) {
      el.style.pointerEvents = 'none';
      map.getPanes().markerPane.appendChild(el);
    }
    map.on('moveend zoomend resize', this._reset, this);
    map.on('click', this._click, this);
    map.on('mousemove', this._hover, this);
    if (map.options.zoomAnimation && L.Browser.any3d) map.on('zoomanim', this._anim, this);
    this._reset();
  },

  onRemove(map) {
    map.off('moveend zoomend resize', this._reset, this);
    map.off('click', this._click, this);
    map.off('mousemove', this._hover, this);
    map.off('zoomanim', this._anim, this);
    cancelAnimationFrame(this._pulse); this._pulse = 0;
    L.DomUtil.remove(this._canvas); L.DomUtil.remove(this._halo);
    this._canvas = this._halo = null;
    this._map = null;
  },

  /* What this layer draws. Each item is `{ marker, pin, loose }` — the Leaflet marker for its
     position and its events, the appearance descriptor `render.js` wrote, and whether it may be
     swallowed by a cluster chip. */
  setItems(items) {
    this._items = items;
    this._zoom = null;                // the grouping is per zoom, so a new set invalidates it
    if (this._map) this._reset();
    return this;
  },

  // Draw again with what it already holds. `applyTheme()` in `js/map.js` calls it after clearing the
  // sprite cache, because every colour in a sprite is a token that moved.
  redraw() { if (this._map) this._reset(); return this; },

  /* Leaflet scales the pane through a zoom, so the canvas rides along under one transform and the
     real redraw waits for `zoomend`. That is the same contract the vendored heat layer keeps. */
  _anim(e) {
    const m = this._map, s = m.getZoomScale(e.zoom);
    const o = m._latLngToNewLayerPoint(m.getBounds().getNorthWest(), e.zoom, e.center);
    for (const el of [this._canvas, this._halo]) L.DomUtil.setTransform(el, o, s);
  },

  _reset() {
    const m = this._map;
    if (!m || !this._canvas) return;
    const size = m.getSize();
    const dpr = Math.min(3, devicePixelRatio || 1);
    /* A sprite is rasterized for one device ratio. A window dragged to a second monitor changes it,
       and a sprite drawn for the old one then blits soft. */
    if (dpr !== spriteDpr) { spriteDpr = dpr; resetSprites(); }
    const tl = m.containerPointToLayerPoint([0, 0]);
    for (const el of [this._canvas, this._halo]) {
      L.DomUtil.setTransform(el, tl, 1);
      el.width = Math.round(size.x * dpr);
      el.height = Math.round(size.y * dpr);
      el.style.width = size.x + 'px';
      el.style.height = size.y + 'px';
    }
    this._draw(size, dpr);
  },

  _draw(size, dpr) {
    const m = this._map, z = Math.round(m.getZoom());
    const ctx = this._canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    /* The grouping is projected at a whole zoom and cached, so a pan reuses it and only the blit
       runs again. `_zoom` holds the zoom the cache was built at. */
    if (this._zoom !== z) {
      const r = this.options.radius(z);
      this._groups = z >= this.options.off
        ? this._items.map(it => ({ n: 1, items: [it] }))
        : group(this._items, ll => m.project(ll, z), r);
      this._zoom = z;
    }

    /* Draw order is the `zIndexOffset` the DOM markers carried: a quiet pin first, then one forecast
       to rise, then anything at its danger mark. A cluster chip draws over every pin, because it
       stands for pins it is hiding. */
    const rank = g => (g.n > 1 ? 3 : g.items[0].pin.danger ? 2 : g.items[0].pin.rise ? 1 : 0);
    const drawn = this._drawn = [];
    const hot = this._hot = [];
    const pad = HALF + R_CHIP;
    const seen = [];
    for (const g of this._groups) {
      const p = m.latLngToContainerPoint(g.items[0].marker.getLatLng());
      if (p.x < -pad || p.y < -pad || p.x > size.x + pad || p.y > size.y + pad) continue;
      seen.push([rank(g), p, g]);
    }
    seen.sort((a, b) => a[0] - b[0]);
    for (const [, p, g] of seen) {
      if (g.n > 1) { this._chip(ctx, p, g); drawn.push({ x: p.x, y: p.y, r: R_CHIP, g }); continue; }
      const it = g.items[0];
      const img = sprite(it.pin, dpr);
      ctx.drawImage(img, p.x - HALF, p.y - HALF, HALF * 2, HALF * 2);
      drawn.push({ x: p.x, y: p.y, r: R_DISC, g });
      if (it.pin.danger) hot.push(p);
    }

    /* The danger halo pulses, so it cannot be a sprite. It is drawn on a second canvas by a frame
       loop that runs only while a pin at its danger mark is on screen. A calm map starts no loop at
       all, and a flooded one animates a handful of rings rather than repainting 460 marks. */
    const hctx = this._halo.getContext('2d');
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, size.x, size.y);
    cancelAnimationFrame(this._pulse); this._pulse = 0;
    if (!hot.length) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const danger = token('var(--s-danger)') || '#f33';
    /* `@keyframes halo` in `css/base.css`: scale .85 to 2 and opacity .9 to 0 over 1.8 s, ease out.
       Reduced motion holds it still at opacity .8, which is what that media query already does. */
    const frame = (t) => {
      hctx.clearRect(0, 0, size.x, size.y);
      const u = reduce ? 0 : ((t % 1800) / 1800);
      const ease = 1 - Math.pow(1 - u, 3);
      const scale = reduce ? 1 : 0.85 + ease * 1.15;
      hctx.globalAlpha = reduce ? 0.8 : 0.9 * (1 - ease);
      hctx.lineWidth = W_RING;
      hctx.strokeStyle = danger;
      for (const p of hot) {
        hctx.beginPath();
        hctx.arc(p.x, p.y, R_HALO * scale, 0, 7);
        hctx.stroke();
      }
      hctx.globalAlpha = 1;
      if (!reduce) this._pulse = requestAnimationFrame(frame);
    };
    this._pulse = requestAnimationFrame(frame);
  },

  // A cluster chip: the count on a neutral disc, red where a child is at its danger mark, dashed
  // where the children are not all one kind. `map.js` states why the badge carries no kind hue.
  _chip(ctx, p, g) {
    const surface = token('var(--surface)') || '#fff';
    let critical = false;
    const kinds = new Set();
    for (const it of g.items) { kinds.add(it.pin.kind); critical ||= it.pin.danger; }

    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y + 1, R_CHIP, 0, 7);
    ctx.fillStyle = SHADOW; ctx.fill();
    if (critical) {
      ctx.beginPath(); ctx.arc(p.x, p.y, R_CHIP_GLOW, 0, 7);
      ctx.fillStyle = 'rgba(217, 48, 37, .35)'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, R_CHIP, 0, 7);
    ctx.fillStyle = critical ? '#d93025' : '#5f6368'; ctx.fill();
    ctx.lineWidth = W_CHIP; ctx.strokeStyle = surface;
    if (kinds.size > 1) ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = CHIP_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(g.n), p.x, p.y + 0.5);
    ctx.restore();
  },

  // What the reader pressed, or null. Nearest first, so two overlapping marks answer with the one
  // whose middle is closer rather than with whichever drew last.
  _at(p) {
    let best = null, bestD = Infinity;
    for (const d of this._drawn) {
      const dx = d.x - p.x, dy = d.y - p.y, dd = dx * dx + dy * dy;
      if (dd <= d.r * d.r && dd < bestD) { best = d; bestD = dd; }
    }
    return best;
  },

  /* A press on a pin fires that marker's own `click`, so every handler `render.js` already bound
     runs unchanged. A press on a chip zooms to what it holds, which is markercluster's
     `zoomToBoundsOnClick`. */
  _click(e) {
    const d = this._at(e.containerPoint);
    if (!d) return;
    if (d.g.n === 1) { d.g.items[0].marker.fire('click'); return; }
    const b = L.latLngBounds(d.g.items.map(it => it.marker.getLatLng()));
    this._map.fitBounds(b.pad(0.2), { maxZoom: this._map.getMaxZoom() });
  },

  /* The pointer, for the cursor and for the mast ring. A marker with no `mouseover` handler costs
     nothing here, so this needs no test for which pins are masts. */
  _hover(e) {
    const d = this._at(e.containerPoint);
    const now = d ? d.g : null;
    this._map._container.style.cursor = d ? 'pointer' : '';
    if (now === this._over) return;
    if (this._over && this._over.n === 1) this._over.items[0].marker.fire('mouseout');
    this._over = now;
    if (now && now.n === 1) now.items[0].marker.fire('mouseover');
  },
});
