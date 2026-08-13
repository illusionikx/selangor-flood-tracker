// Load a module when a reader asks for the panel it serves, and say so while they wait.

/* One attribute drives both jobs. `aria-busy` is what a screen reader announces, and the CSS in
 * css/base.css draws the shimmer from the same attribute, so the two cannot drift apart. The
 * alternative is a class for the eye and an attribute for the reader, kept in step by hand.
 *
 * The 150 ms delay is the point of this function, not decoration. A same-origin import of a 9 KB
 * to 15 KB module takes about 10 ms to 40 ms warm. A skeleton that appears for 20 ms is a flash,
 * and a flash reads worse than no skeleton at all. Under 150 ms nothing is drawn. Over it, the
 * shimmer is already there before anyone perceives a wait.
 *
 * The mark is cleared in `finally`, so a failed import cannot leave a box shimmering forever. The
 * error is rethrown rather than swallowed: the caller knows which surface it owns and what to put
 * in it, and this function does not. */
export async function lazy(load, box) {
  const t = setTimeout(() => box?.setAttribute('aria-busy', 'true'), 150);
  try {
    return await load();
  } finally {
    clearTimeout(t);
    box?.removeAttribute('aria-busy');
  }
}
