/* A check fixture, and not part of the app. `index.html` never references this file, and no browser
   loading the app ever fetches it. It exists so that a rendered-pixel check can drive the station
   panel the way the app drives it.

   **The check has to reach the app's OWN module instance.** Importing `js/map.js` from the check
   page builds a second copy of the module graph, with an empty `state` and a map attached to no
   container. `m3-check.html` states that rule on `inFrame()`. So the check injects a module into the
   app's document, and that module needs a name it can import.

   Against the source that name is `/js/map.js`. Against the build there is no such file, because
   `build.mjs` bundles the graph into content-hashed chunks. This file is the one name that answers
   on both targets. The build emits it as a second entry point in the same esbuild call, so it shares
   every chunk with `js/app.js` rather than duplicating them. `site/build.json` carries its hashed
   name, and the check reads that.

   **The build emits it unconditionally, and not behind a flag.** Adding an entry point changes how
   esbuild splits the chunks. A build with the probe and a build without it are therefore different
   artifacts, and a check must measure the artifact that ships. The cost is one file of about 200
   bytes that nothing ever requests. */
import { openSide, closeSide } from './map.js';

window.__probe = { openSide, closeSide };
