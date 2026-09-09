/* The build. It writes `site/`, which is what a browser gets. The repository is what a person gets.
   Run it with `npm run build`, or `npm run build:static` for the GitHub Pages bake.

   **The repository stays the source of truth and keeps every comment.** Those comments are how this
   app records why each line is the way it is. They are 71% of the raw bytes of `js/` and `css/`, and
   327 KB of every cold load gzipped. This file is what stops a reader paying for them. It does not
   delete one.

   Six steps:
     1. Bundle and minify the JavaScript, with code splitting at the five `import()` sites.
     2. Minify the stylesheets.
     3. Copy everything that ships unprocessed.
     4. Rewrite `index.html` against the hashed names, and generate the `modulepreload` list.
     5. Rewrite `sw.js` against the same names, so the shell is cache-first and offline on first load.
     6. Precompress every text output with gzip and brotli.

   **Every output name carries a content hash**, so a server can answer `immutable` and a browser
   can keep the file for a year. That replaces three cache-busting rituals: the `?v=` query on the
   stylesheets, Herd's three-hour `max-age`, and the service worker's network-first refusal to trust
   its own cache. See docs/GOTCHAS.md for what each of those cost.

   **Source maps ship beside the code.** A browser fetches one only when a person opens developer
   tools. So a reader pays nothing, and this app stays debuggable on a box that nobody can reach. */

import { build } from 'esbuild';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const STATIC = process.argv.includes('--static');
const OUT = 'site';

/* Fail loudly, and never write a half-built site. Every rewrite below asserts that it matched
   something. A silent no-match is the failure mode this whole file exists to remove, so it must not
   be the failure mode of the file itself. */
const need = (ok, msg) => { if (!ok) { console.error(`build: ${msg}`); process.exit(1); } };

/* **This deletes `site/`, and the server build puts `api.php` in there.** `api.php` writes its state
   into its own directory: `.history.db`, `.cache.json`, `shots/` and the two logs. So a build run
   against a LIVE document root would take a year of camera frames with it. docs/GOTCHAS.md already
   records `rm -rf shots/` as exactly that loss.
   The rule in docs/DEPLOY.md is that a live root is never built into. A build writes `site/` inside
   the checkout, and a deploy copies it across. This check is the backstop for the day somebody
   points a document root at the build directory anyway. */
for (const state of ['shots', '.history.db', '.cache.json'])
  need(!fs.existsSync(path.join(OUT, state)),
       `${OUT}/ holds runtime state (${state}). This looks like a live document root, and a build `
       + 'would delete it. Build inside the checkout and deploy with rsync. See docs/DEPLOY.md.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- 1. JavaScript

   `splitting` honors the five `import()` call sites, so `lazy()` keeps its deferred modules and
   their loading skeletons. The eager graph lands in one chunk set, which compresses better than 26
   separate files: gzip carries a 32 KB window and cannot see across a file boundary. */

const staticFlag = {
  name: 'static-flag',
  setup(b) {
    b.onLoad({ filter: /[\\/]config\.js$/ }, async args => {
      const src = await fs.promises.readFile(args.path, 'utf8');
      const out = src.replace(/^export const STATIC = false;$/m, 'export const STATIC = true;');
      need(out !== src, 'js/config.js: the STATIC line moved. Fix this plugin.');
      return { contents: out, loader: 'js' };
    });
  },
};

const js = await build({
  entryPoints: ['js/app.js', 'js/probe.js'],
  outdir: `${OUT}/js`,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  metafile: true,
  legalComments: 'none',
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  plugins: STATIC ? [staticFlag] : [],
});

const outs = js.metafile.outputs;
const entryFor = src => {
  const o = Object.keys(outs).find(k => outs[k].entryPoint === src);
  need(o, `esbuild produced no entry point for ${src}`);
  return o;
};
const entry = entryFor('js/app.js');
/* The check fixture. It is never referenced by `index.html`, so it is never fetched by a reader,
   and it is never in the eager set below. See js/probe.js for why it is built at all. */
const probe = entryFor('js/probe.js');

/* The eager set is the entry plus every chunk it reaches through a static import. A chunk reached
   only by `import()` is deliberately absent, which is the rule the hand-written list already stated.
   A build reads it off the real graph, so it cannot drift. */
const eager = [];
for (const queue = [entry]; queue.length; ) {
  const cur = queue.shift();
  if (eager.includes(cur)) continue;
  eager.push(cur);
  for (const im of outs[cur].imports || [])
    if (im.kind === 'import-statement') queue.push(im.path);
}

/* ---------------------------------------------------------------- 2. Stylesheets

   Four entry points and no bundling. Each one is a separate `<link>` in `index.html`, and they must
   stay separate: `icons.css` is generated and changes on its own schedule. The four `url()` values
   in these files are same-document SVG fragments, so nothing here resolves to a file. */

const cssFiles = ['icons', 'base', 'chrome', 'map'];
const css = await build({
  entryPoints: cssFiles.map(n => `css/${n}.css`),
  outdir: `${OUT}/css`,
  minify: true,
  sourcemap: true,
  metafile: true,
  legalComments: 'none',
  entryNames: '[name]-[hash]',
});

const cssOut = {};
for (const [file, meta] of Object.entries(css.metafile.outputs))
  if (meta.entryPoint) cssOut[path.basename(meta.entryPoint, '.css')] = file;
for (const n of cssFiles) need(cssOut[n], `esbuild produced no output for css/${n}.css`);

/* ---------------------------------------------------------------- 3. Copy

   `vendor/` is hand-managed and already minified, so it is copied whole and keeps its own `?v=`
   query. It changes by hand and rarely. Everything else here is committed data or an icon. */

const copy = (src, optional = false) => {
  if (!fs.existsSync(src)) { need(optional, `missing ${src}`); return false; }
  fs.cpSync(src, path.join(OUT, src), { recursive: true });
  return true;
};

copy('vendor');
for (const f of ['manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png',
                 'water.json', 'border.json']) copy(f);
/* Optional, for the reason pages.yml already states: a missing decoration must never stop the map
   from updating. */
for (const f of ['img', 'api.json', 'wx.json']) copy(f, true);

/* The server build ships the PHP as well, so `site/` is a complete document root and a deploy is
   one directory. GitHub Pages runs no PHP, so the static build leaves all of it out and takes the
   baked `api.json` instead.

   `lib/` holds Composer's output and is gitignored, so it is optional here: a build machine that
   has not run `composer install` still produces a front end. The runtime state stays out on
   purpose. `.history.db` and `shots/` are written in the document root, and a deploy must not
   carry either. See docs/DEPLOY.md for the rsync that keeps them. */
if (!STATIC) {
  for (const f of ['api.php', 'sources.php', 'shots.php', 'log.php', 'watch.php',
                   '.user.ini', 'composer.json']) copy(f);
  for (const f of ['composer.lock', 'lib']) copy(f, true);
}

/* ---------------------------------------------------------------- 4. index.html */

const rel = p => path.relative(OUT, p).split(path.sep).join('/');
let html = fs.readFileSync('index.html', 'utf8');

const swap = (re, to, what) => {
  need(re.test(html), `index.html: no match for ${what}`);
  html = html.replace(re, to);
};

swap(
  /(?:[ \t]*<link rel="modulepreload"[^>]*>\r?\n)+/,
  eager.map(f => `<link rel="modulepreload" href="${rel(f)}">\n`).join(''),
  'the modulepreload block',
);
for (const n of cssFiles)
  swap(new RegExp(`href="css/${n}\\.css(?:\\?v=\\d+)?"`),
       `href="${rel(cssOut[n])}"`, `the ${n}.css link`);
swap(/src="js\/app\.js"/, `src="${rel(entry)}"`, 'the app.js script tag');

/* Drop the markup comments. They are 51% of this file, and 15 KB of every cold load compressed.
   A plain regular expression is enough here and is not enough in general: an HTML comment cannot
   nest, this file carries no inline `<style>` or `<script>` block for a false `-->` to hide in, and
   no attribute value holds that sequence. The build asserts the second and third of those, so the
   day somebody adds an inline block this fails rather than truncating the page.

   Only blank lines collapse after that. Whitespace between elements is left exactly as written,
   because it is significant between inline boxes and this app has no rule saying which are which. */
need(!/<(?:style|script)(?![^>]*\bsrc=)/.test(html),
     'index.html: an inline style or script block appeared. The comment stripper is no longer safe.');
need(!/<[^!][^>]*-->/.test(html), 'index.html: "-->" inside a tag. The comment stripper is no longer safe.');
html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n[ \t]*(?=\n)/g, '');

fs.writeFileSync(path.join(OUT, 'index.html'), html);

/* ---------------------------------------------------------------- 5. sw.js

   The worker keeps its own name, because a browser remembers the path it registered. Its cache name
   takes the entry hash, so a new build activates a new cache and the old one is dropped.

   **The shell is cache-first now, and it was network-first.** The comment this replaces argued that
   cache-first needs a cache-busting ritual, and that an edit nobody could see was worse than a slow
   load. Content hashing is that ritual, done by a build rather than by a person. A hashed file can
   never hold stale content, because different content is a different name.

   The precache list holds the eager shell alone. A deferred chunk is cached when something asks for
   it, which is what keeps the five lazy modules off a first load. */

const buildId = path.basename(entry, '.js').split('-').pop();
const shell = ['./', ...eager.map(rel), ...cssFiles.map(n => rel(cssOut[n])),
               'vendor/leaflet.js', 'vendor/leaflet-heat.js', 'vendor/leaflet.css',
               'vendor/fonts.css?v=52', 'vendor/m3/tokens.css?v=2', 'vendor/roboto.woff2'];

let sw = fs.readFileSync('sw.js', 'utf8');
const swap2 = (re, to, what) => {
  need(re.test(sw), `sw.js: no match for ${what}`);
  sw = sw.replace(re, to);
};
swap2(/^const CACHE = .*$/m, `const CACHE = 'shell-${buildId}';`, 'the CACHE name');
swap2(/^const SHELL = \[\];$/m,
      `const SHELL = ${JSON.stringify(shell)};`, 'the SHELL list');
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

/* The name index. Everything here is already written into `index.html`, so nothing the app does
   reads this file. It is for anything OUTSIDE the app that has to name a hashed file: the four
   rendered-pixel checks, and a deploy script that wants to know what it just built. */
fs.writeFileSync(path.join(OUT, 'build.json'), `${JSON.stringify({
  id: buildId,
  static: STATIC,
  entry: rel(entry),
  probe: rel(probe),
  css: Object.fromEntries(cssFiles.map(n => [n, rel(cssOut[n])])),
  eager: eager.map(rel),
}, null, 2)}\n`);

/* ---------------------------------------------------------------- 6. Precompress

   Level 11 brotli is too slow to run for each request, and free when a build runs it once. nginx
   serves these with `brotli_static on;` and `gzip_static on;`. See docs/DEPLOY.md.

   GitHub Pages ignores them and compresses on its own. The files cost a little space there and
   nothing else. */

const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(js|css|html|json|svg|map)$/.test(e.name)) continue;
    const buf = fs.readFileSync(p);
    fs.writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
    fs.writeFileSync(`${p}.br`, brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }));
  }
};
walk(OUT);

/* The cold load is the number this whole file exists to move, so the build prints it. It is what a
   first visit fetches: the document, the eager chunks and the four stylesheets. A deferred chunk, a
   source map and the two committed data files are all absent, because none of them is fetched to
   draw the first frame. */
const brSize = f => fs.statSync(path.join(OUT, `${f}.br`)).size;
const cold = ['index.html', ...eager.map(rel), ...cssFiles.map(n => rel(cssOut[n]))]
  .reduce((n, f) => n + brSize(f), 0);
const deferred = Object.keys(outs).filter(o => o.endsWith('.js')).length - eager.length;

console.log(`build: ${STATIC ? 'static' : 'server'}, id ${buildId}`);
console.log(`build: ${eager.length} eager chunks, ${deferred} deferred`);
console.log(`build: cold load ${(cold / 1024).toFixed(0)} KB brotli`);
