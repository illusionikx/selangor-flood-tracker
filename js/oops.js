// Reports a browser error to this server. No imports, and app.js imports it first, on purpose.
//
// A static import runs before the body of the file that imports it. So an error thrown while another
// module evaluates arrives before any handler written inside app.js. That is a real case rather than
// a theoretical one: state.js reads the saved preferences with JSON.parse, and corrupt storage there
// throws before the map draws anything. This module has no imports of its own, so it evaluates
// first and is listening for the rest.
//
// There is no build step here, so a stack trace already names the file and the line in the source a
// reader is running. That is most of what an error tracker sells.

const MAX = 20;   // one throw inside a loop must not become a thousand requests
let sent = 0;

/* sendBeacon queues the request with the browser and returns. It cannot throw, cannot delay the
   page, and survives the tab closing, which the ordinary fetch in ask.js does not. GitHub Pages
   serves no PHP, so log.php is absent there and the browser drops the report. That is the wanted
   behaviour on a static host, and it needs no test for which host this is. */
const post = body => {
  if (sent++ >= MAX) return;
  navigator.sendBeacon?.('log.php', new Blob([JSON.stringify(body)], { type: 'text/plain' }));
};

const where = () => ({ url: location.href, ua: navigator.userAgent, at: new Date().toISOString() });

/* The third argument is the capture phase, and it is what catches a file that failed to load. That
   event does not bubble, so a listener without it sees script errors alone. Herd answers a missing
   file with index.html and HTTP 200, so a mistyped path in the module list reaches a reader as a
   parse error rather than as a failed request. This is how that arrives from a real visitor. */
addEventListener('error', e => {
  if (e.error || e.message)
    post({ kind: 'error', msg: e.message, file: e.filename, line: e.lineno, col: e.colno,
           stack: e.error?.stack, ...where() });
  else if (e.target?.src || e.target?.href)
    post({ kind: 'asset', msg: 'failed to load', file: e.target.src || e.target.href, ...where() });
}, true);

// A rejected promise nobody caught. The poll loop and every lazy import are promises, so this is the
// half of the app the error event above cannot see.
addEventListener('unhandledrejection', e => {
  const r = e.reason;
  post({ kind: 'reject', msg: String(r?.message ?? r), stack: r?.stack, ...where() });
});
