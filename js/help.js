/* The Help screenshots, and the numbers that tie each one to its rows. Deferred: `openHelp()` in
   js/ui.js imports this on the first open, so a reader who never opens Help never pays for it.

   `php help-build.php` bakes the pictures and `img/help/marks.json`. That file holds, for each
   picture, the box of each labeled control in percent. A Help row names its control in `data-mark`,
   as `<picture>:<key>`. This module numbers the rows of each picture in page order, and puts the
   same number on the picture over that control.

   **The numbers are counted here, never written in the markup.** A control that does not draw at
   one width is absent from that width's marks, so its row gets no number there. Settings, Help and
   About sit behind the More button on a phone, for example. Counting at paint time keeps the numbers
   in a run with no gaps at both widths, and a new row needs no renumbering by hand.

   **The picture follows the window class, 600px, the app's one breakpoint.** A phone reader sees
   the navigation bar, and a desktop reader sees the rail. The listener repaints when a window
   crosses the line with Help open.

   **A failure shows the text alone.** Each figure carries `hidden` until its marks arrive. A missing
   `marks.json` leaves every figure hidden, and the rows read as they did before the pictures. */

const NARROW = matchMedia('(max-width: 600px)');
let marks = null;

/* Where a number sits on its control. `help-shot.html` picks the side for each control, so that the
   number covers no text: after a rail label, on the corner of a chip, under a row of buttons. The
   list of sides is in that file. `l` and `r` stand 14px outside the edge, which is the disc's own
   radius and a 3px gap. `clamp()` holds every disc inside the picture, so a control on the edge
   does not cut its own number in half. */
const H = 11;   // half the disc, in px
const inside = v => `clamp(${H}px, ${v}, calc(100% - ${H}px))`;
function place([x0, y0, x1, y1, side = 't']) {
  const mx = `${(x0 + x1) / 2}%`, my = `${(y0 + y1) / 2}%`;
  const [x, y] = {
    t: [mx, `${y0}%`], b: [mx, `${y1}%`], tl: [`${x0}%`, `${y0}%`], tr: [`${x1}%`, `${y0}%`],
    l: [`calc(${x0}% - 14px)`, my], r: [`calc(${x1}% + 14px)`, my],
  }[side] || [mx, `${y0}%`];
  return `left:${inside(x)};top:${inside(y)}`;
}

function paint(box) {
  const width = NARROW.matches ? 'phone' : 'desktop';
  for (const fig of box.querySelectorAll('.hshot')) {
    const shot = fig.dataset.shot;
    const m = marks[`${shot}-${width}`];
    const pic = fig.querySelector('.hpic');
    const rows = box.querySelectorAll(`[data-mark^="${shot}:"]`);
    pic.querySelectorAll('.hmark').forEach(e => e.remove());
    rows.forEach(r => r.querySelector(':scope > .hnum')?.remove());
    fig.hidden = !m;
    if (!m) continue;
    const img = pic.querySelector('img');
    img.width = m.w;
    img.height = m.h;
    img.src = `img/help/${shot}-${width}.webp`;
    pic.style.setProperty('--cssw', `${m.cssW}px`);
    let n = 0;
    for (const r of rows) {
      const b = m.marks[r.dataset.mark.split(':')[1]];
      if (!b) continue;
      n++;
      r.insertAdjacentHTML('afterbegin', `<b class="hnum" aria-hidden="true">${n}</b>`);
      pic.insertAdjacentHTML('beforeend',
        `<b class="hmark" aria-hidden="true" style="${place(b)}">${n}</b>`);
    }
  }
}

export async function paintHelp(box) {
  if (!marks) {
    const r = await fetch('img/help/marks.json');
    if (!r.ok) throw new Error(`img/help/marks.json: HTTP ${r.status}`);
    marks = await r.json();
    NARROW.addEventListener('change', () => paint(box));
  }
  paint(box);
}
