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

/* A popover rather than a plain fixed div, for one reason: the table draws its graphs inside
   `.tipbox`, which is a popover itself and therefore in the top layer, where no z-index reaches.
   The only thing that paints over a top-layer element is another one. `manual`, so opening this
   cannot light-dismiss the panel it is sitting on. */
const box = () => tip || (tip = document.body.appendChild(Object.assign(
  document.createElement('div'), { className: 'sparktip', popover: 'manual' })));

const hide = () => { if (tip?.matches(':popover-open')) tip.hidePopover(); };

function show(e) {
  const spark = e.target.closest?.('.spark[data-pts]');
  const svg = spark?.querySelector('svg');
  if (!svg) return hide();

  if (spark !== last) { last = spark; pts = JSON.parse(spark.dataset.pts); }
  const r = svg.getBoundingClientRect();
  const at = (e.clientX - r.left) / (r.width || 1) * 100;
  // The nearest sample, not the one under the pointer. Readings are a quarter of an hour apart and
  // the space between two of them is nothing at all, so a readout that went blank in the gaps would
  // flicker across the whole width of the graph.
  const [x, label] = pts.reduce((best, p) =>
    Math.abs(p[0] - at) < Math.abs(best[0] - at) ? p : best);

  const t = box();
  t.textContent = label;
  if (!t.matches(':popover-open')) t.showPopover();
  // Above the graph, unless there is no room — the table's panels open near the top of the screen.
  // Measured after it is shown, because a popover that is closed has no width to clamp against.
  const above = r.top > t.offsetHeight + 10;
  t.classList.toggle('below', !above);
  t.style.top = `${above ? r.top - 6 : r.bottom + 6}px`;
  // Clamped to the viewport: the first and last samples sit on the edges of a graph that is itself
  // against the edge of a phone.
  const half = t.offsetWidth / 2;
  t.style.left = `${Math.min(Math.max(r.left + x / 100 * r.width, half + 4), innerWidth - half - 4)}px`;
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
