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
      if (!r.ok) {
        const err = Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        // A 404 or a 400 will not become a 200 on a second try, and the rate limiter behind
        // ?place= counts every arrival. Give up at once on anything the server answered clearly.
        if (r.status < 500) throw err;
        last = err;
        continue;
      }
      return await r.json();
    } catch (e) {
      // AbortSignal.timeout() rejects with a TimeoutError. Retrying that is the point.
      last = e;
    }
  }
  throw last;
}
