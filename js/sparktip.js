// The value under the pointer, on any graph in the app.
//
// The three graphs are 100-unit SVGs stretched to whatever width they land in, so not one number on
// them is written down: the axis names the hours, the caption names the range, and everything
// between is shape. "About two thirds of the way up, somewhere around noon" was as close as the eye
// could get to a reading it can get exactly.
//
// One delegated listener serves every graph there is — the station card, the alert list, the
// table's hover panels — because they are all the same markup wherever they are drawn. Each graph
// ships its own samples in `data-pts`: `[x%, label]` per sample, worded by the function that drew
// it (see `readout()` in popup.js). So nothing here knows a unit, a clock or a kind of sensor.

let tip;                 // the readout itself, made on first use and then moved around
let last, pts;           // the graph it is currently reading, and that graph's parsed samples
let xh;                  // the crosshair, which lives inside whichever graph is being read

/* A popover rather than a plain fixed div, for one reason: the table draws its graphs inside
   `.tipbox`, which is a popover itself and therefore in the top layer, where no z-index reaches.
   The only thing that paints over a top-layer element is another one. `manual`, so opening this
   cannot light-dismiss the panel it is sitting on. */
const box = () => tip || (tip = document.body.appendChild(Object.assign(
  document.createElement('div'), { className: 'sparktip', popover: 'manual' })));

const hide = () => {
  xh?.remove(); xh = null;
  if (tip?.matches(':popover-open')) tip.hidePopover();
};

/* The line down the graph at the sample being read. It goes *inside* the graph's own SVG rather
   than being a second floating element: the readout has to float because it is a box of text over a
   scrolling card, but the crosshair is 1px of the picture and belongs in it. That also settles the
   top-layer question for free — a table graph draws inside a popover, and anything painted over it
   from outside would need to be a popover too.
   `non-scaling-stroke` in the CSS is what keeps it a hairline: the viewBox is stretched, so a
   stroke-width of 1 comes out as wide as the graph is stretched — three pixels in a 300px card. */
function crosshair(svg, x) {
  if (!xh?.isConnected || xh.ownerSVGElement !== svg) {
    xh?.remove();
    xh = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
    xh.setAttribute('class', 'xhair');
    xh.setAttribute('y1', 0);
    xh.setAttribute('y2', svg.viewBox.baseVal.height);
  }
  xh.setAttribute('x1', x);
  xh.setAttribute('x2', x);
}

function show(e) {
  const spark = e.target.closest?.('.spark[data-pts]');
  const svg = spark?.querySelector('svg');
  if (!svg) return hide();

  if (spark !== last) { last = spark; pts = JSON.parse(spark.dataset.pts); }
  const r = svg.getBoundingClientRect();
  const at = Math.max(0, Math.min(100, (e.clientX - r.left) / (r.width || 1) * 100));
  /* The crosshair goes where the pointer is. It used to jump to the nearest sample, which made the
     line a set of 48 positions on a graph you drag a pointer across — you could move a centimetre
     and see nothing move, then have it snap past where you were aiming.

     The *reading* is still a sample, because the graph holds nothing else: the last one at or before
     the line. Not the nearest one, which is what the readout did while it was also the crosshair's
     position. Nearest means the reading changes half a step before the line reaches the sample it
     belongs to, so a level appeared to arrive early. Last-before is what a level does between two
     readings anyway — it holds the last thing the station said. */
  let hit = pts[0];
  for (const p of pts) { if (p[0] > at) break; hit = p; }
  const label = hit[1];

  crosshair(svg, at);

  const t = box();
  t.textContent = label;
  if (!t.matches(':popover-open')) t.showPopover();
  // Above the graph, unless there is no room — the table's panels open near the top of the screen.
  // Measured after it is shown, because a popover that is closed has no width to clamp against.
  const above = r.top > t.offsetHeight + 10;
  t.classList.toggle('below', !above);
  t.style.top = `${above ? r.top - 6 : r.bottom + 6}px`;
  // Over the crosshair, and clamped to the viewport: the graph runs to the edge of a phone.
  const half = t.offsetWidth / 2;
  t.style.left = `${Math.min(Math.max(r.left + at / 100 * r.width, half + 4), innerWidth - half - 4)}px`;
}

addEventListener('pointermove', show);
// Touch has no hover, and a graph is exactly the kind of thing a thumb wants to drag along: a tap
// reads one sample, a drag scrubs, letting go puts the readout away.
addEventListener('pointerdown', show);
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') hide(); });
addEventListener('pointercancel', hide);
// The card and the table both scroll under a pointer that has not moved, which would leave the
// readout naming a sample that is no longer under it.
addEventListener('scroll', hide, true);
