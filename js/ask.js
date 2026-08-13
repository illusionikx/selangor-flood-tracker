// One way to ask this server for JSON. Nothing else in the app calls fetch() for data.

/* Three things fetch() does not do on its own, each of which has cost this app something.
 *
 * It has no timeout. A hung worker leaves the promise pending forever. The splash screen waits on
 * that promise with no way out.
 *
 * It resolves on a 500. Calling r.json() on an HTML error page throws a SyntaxError whose message
 * is written for a browser vendor: `Unexpected token '<'`. That string reached the status popover.
 *
 * It does not retry. One dropped packet cost a red dot for the whole five minutes to the next poll.
 *
 * AbortSignal.timeout() is native, so there is no AbortController to wire up and nothing to clean
 * up on the way out.
 *
 * `cache` is passed through only when a caller asks for it. The payload poll must not set
 * `no-store`: the server sends an ETag, so an unchanged poll costs 304 and about 200 bytes, and
 * `no-store` skips the conditional request that earns it. The force refresh sets it on purpose,
 * because defeating that cache is the whole of what that button does.
 */
export async function askJson(url, { ms = 20000, tries = 2, cache } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    // A short pause before the second attempt. Long enough to outlast a dropped packet, short
    // enough that a reader waiting on the splash does not notice it.
    if (i) await new Promise(r => setTimeout(r, 400));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms), ...(cache ? { cache } : {}) });
      if (r.ok) return await r.json();
      last = Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      /* `break`, not `throw`. A throw here lands in this function's own catch one line below, which
         sets `last` and lets the loop run again — so a 404 cost two requests and a 400 ms wait
         before failing. A 4xx will not become a 2xx on a second try, and the rate limiter behind
         ?place= counts every arrival. `throw last` below then raises the error this sets. */
      if (r.status < 500) break;
    } catch (e) {
      // A network fault or an AbortSignal.timeout() rejection. Retrying either is the point.
      last = e;
    }
  }
  throw last;
}
