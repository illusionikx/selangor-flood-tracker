# Verify

This text was part of [`../CLAUDE.md`](../CLAUDE.md) until 2026-08-27. It moved for the reason
[`GOTCHAS.md`](GOTCHAS.md) states.

Run the checks that cover what you changed.


```bash
composer install                                      # writes lib/ — required before first run
php -l api.php && php -l sources.php                  # lint proxy + scrapers

# Are all three sources actually contributing? parsed:0 means a scraped table moved.
curl -sk https://flood-exp.test/api.php | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'

# The portal migration's accounting. A fall in `applied` means a join broke. A rise in the stations
# left on an old feed means the portal dropped rows. ASSERT A RANGE, NEVER AN EQUALITY — two fetches
# an hour apart returned 311 rainfall rows and then 310, and the Selangor page returned 239 on
# 15 August. A station or two of drift is upstream churn, not a fault.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$s=$p["sources"]; echo json_encode(["portalrf"=>$s["portalrf"],"national"=>$s["national"],
  "gaz"=>$s["gaz"],"hist"=>$s["hist"]]),"\n";
$k=[]; foreach($p["stations"] as $x) $k[$x["kind"]."/".$x["source"]]++;
ksort($k); echo json_encode($k),"\n";'

# The spread of derived 3 hour rainfall windows, on stations with rain. This is a sanity check on
# the derivation, not a comparison against a referee.
# `api.php` reads `hour3`, the 3 hour total Selangor publishes for itself. It unsets that field
# before the payload ships, so no sweep can see it.
# A different check condemned the old summed approach, scored against that hidden figure before it
# shipped. `accHours()` was out by more than 5 mm on 14 of 176 stations, worst 60 mm.
# SCORE IT ON STATIONS WITH RAIN IN THE WINDOW. A dry station agrees with everything, and that is how
# a rolling field passed for a disjoint one while this was designed.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$d=[]; foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue;
 $a=$s["acc"]["h3"] ?? null; if(!$a || $a[0]<=0) continue;   // wet only
 if(($a[1]??0)===0) continue;                                 // the feed answered, nothing to score
 $d[]=$a[0]; }
sort($d); $n=count($d);
printf("%d wet derived 3h windows, median %.1f mm, p90 %.1f mm\n", $n,
  $n?$d[(int)($n*.5)]:0, $n?$d[(int)($n*.9)]:0);'

# This migration must not lose any station's reading. The count of rainfall and river stations with
# a null reading must not rise.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$n=0; $t=0; foreach($p["stations"] as $s){ if(!in_array($s["kind"],["rainfall","river"]))continue; $t++;
 $v = $s["kind"]==="rainfall" ? ($s["hourly"]??null) : ($s["level"]??null); if($v===null)$n++; }
echo "$n of $t river and rainfall stations hold no reading\n";'

# Expires every cached page and forces a rebuild.
# This demonstrates recovery, not failure. All three `prf-` keys reach `sources.stale` only when a
# fetch fails. An empty result here shows the pages refetched cleanly on the forced refresh.
# To test the failure path by hand: change one character in `PRF`. Expire the pages and force a
# refresh. Confirm all three `prf-` keys land in `sources.stale`. Then restore `PRF`.
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0");'
curl -sk 'https://flood-exp.test/api.php?force=1' \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]["stale"]),"\n";'

php api.php | head -c 400                             # cold fetch (~3s), writes .cache.json
curl -sk https://flood-exp.test/api.php | php -r '...' # served payload
curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?cam=1"   # 200, jpeg

# Syntax-check the modules. node --check treats a bare .js as CommonJS, so copy to .mjs first:
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# And that every file still serves. Check the *type*, not the status: Herd answers a missing file
# with index.html and a 200, so a typo'd path passes a status check and fails in the browser.
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'

# The rules in js/popup.js that fail silently and no linter reaches. `stamp()` chooses a clock
# against a date, so a wrong slice index prints an empty string. `spanText()` floors, so a wrong
# rounding claims minutes the record never held. `sirenBand()`, `sparkline()` and `rainBars()` all
# draw whatever they hold, so a degenerate window is a graph that renders nothing and errors
# nowhere. The last block runs every station in the payload through its own graph.
# There is no JS test harness here and this does not add one. The MODULE is evaluated as it ships,
# with only its imports stubbed, so no copy can drift from what runs.
# **Give the palette stubs real values.** `RAIN_COLOR` as a bare `[]` puts `undefined` in the
# readout for 96 rainfall stations, which reads as a fault in the code and is a fault in the check.
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/popup.js','utf8')
  .replace(/^import[\s\S]*?from '\.\/stations\.js';/m,'').replace(/\bexport /g,'');
const noSec = fs.readFileSync('js/util.js','utf8').match(/export const noSec = .*;/)[0].replace('export ','');
const stubs = \`
const SPARK_H=12, NO_INFO='', NEAR_MAX_KM=30, MET_NAME='', ACC_ROWS=[], WEATHER=[{}];
const RIVER_COLOR={1:'r1',2:'r2',3:'r3'},RAIN_COLOR={1:'c1',2:'c2',3:'c3',4:'c4'};
const GAUGE_COLOR={1:'g1',2:'g2',3:'g3'},RAIN_STOPS=[[0],[10],[30],[60]];
const KINDS={river:{color:'B',label:'Water level',one:'Water level',icon:'water_drop'},
  gauge:{color:'T',one:'Flood gauge',icon:'flood'},rainfall:{color:'V',one:'Rainfall',icon:'rainy'},
  siren:{color:'P',one:'Siren',icon:'siren'},camera:{color:'C',one:'Camera',icon:'videocam'}};
const SOURCES={selangor:{label:'Selangor'}},ALERT_TITLE={},camSrc=()=>'',distKm=()=>0;
const hasInfo=s=>s.info!==false,isStale=()=>false,statusColor=n=>'S'+n,scalePos=()=>0;
const levelStops=()=>null,gaugeStops=()=>null,gaugeColor=()=>'',color=()=>'',isFav=()=>false;
const nearestOf=()=>null,nearestCam=()=>null,nearestLevel=()=>null,camAlert=()=>null;\`;
const M = new Function(stubs+noSec+src+
  '; return { stamp, spanText, sirenBand, sparkline, rainBars, dots, kindChips, sensorBody, camLink, levelLink };')();
const now=Math.floor(Date.now()/1000), H=3600;
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const today=new Intl.DateTimeFormat('en-GB',
  {timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());

is(M.stamp(today+' 15:45:00'),'15:45','stamp: today -> clock, seconds trimmed');
is(M.stamp('19/09/2025 12:15:00'),'19/09/2025','stamp: another day -> date only');
is(M.stamp(today),today,'stamp: a date with no clock -> the date');
is(M.stamp(Date.parse('2025-09-19T12:15:00+08:00')),'19/09/2025','stamp: unix ms, another day -> date');
is(/^\d\d:\d\d\$/.test(M.stamp(Date.now())),true,'stamp: unix ms, today -> clock');
is(M.spanText(3600*9.6),'9 h','spanText: floors, never rounds up');
is(M.spanText(1800),'30 min','spanText: under an hour keeps minutes');

// dots() emits the favorite two ways and must never emit both. The card HEADER gets a button beside
// the kebab, and openSide() lifts it into the app bar. A sensor's inline menu keeps the row, which
// is what lets somebody star one gauge of six. A lift flag that stops taking the row out puts the
// same action on one card twice, and nothing on screen says which of the two is stale.
// Escape every double quote in here. The whole harness is one double-quoted shell string, and a
// bare backtick in a comment runs as a command substitution.
// The nearest-webcam offer is the same rule at a second control. It left the menu on 2026-08-26 and
// leads the row. A caller that emits it INSIDE the menu draws a correct-looking row that openSide()
// then throws away with the emptied pophead. No backtick and no double quote in this comment: the
// whole harness is one double-quoted shell string, and the rule above already states why.
const S={ id:'wl-1', name:'TEST', kind:'river', source:'selangor', site:'s1',
          updated:'01/01/2026 00:00:00', lat:3, lng:101 };
const near=M.camLink(S,{ id:'camera-9', name:'KG BARU', site:'s2' });
const head=M.dots(S,near,true), inline=M.dots(S);
is(/class=\"icon fav\"/.test(head),true,'dots: the card header emits a favorite BUTTON');
is((head.match(/data-fav/g)||[]).length,1,'dots: and exactly one favorite control, never two');
is(/class=\"mi\" data-fav/.test(head),false,'dots: so its menu carries no favorite ROW');
is(head.indexOf('icon fav')<head.indexOf('icon dots'),true,'dots: the heart comes before the kebab');
is(head.indexOf('icon near')<head.indexOf('icon fav'),true,'dots: and the offer before the heart');
is(head.indexOf('icon near')<head.indexOf('class=\"menu'),true,'dots: outside the menu, never in it');
is(/class=\"icon fav\"/.test(inline),false,'dots: a sensor row emits no button of its own');
is(/icon near/.test(inline),false,'dots: and no offer at all, which belongs to the place');
is(/class=\"mi\" data-fav/.test(inline),true,'dots: it keeps the favorite as a menu row');
// An empty offer still draws, and it must not take the disabled ATTRIBUTE: a disabled button fires
// no pointer event in Chrome, so the one thing it has to say never opens.
is(/aria-disabled=\"true\"/.test(M.camLink(S,null)),true,'camLink: no camera -> aria-disabled');
is(/disabled>|disabled /.test(M.camLink(S,null).replace(/aria-disabled/g,'')),false,
   'camLink: and never the attribute, which would close the tip');
// TWO LINES: what the button is, then what it found. sparktip.js writes the label with
// textContent, so the newline is the only break available and .sparktip takes white-space: pre.
is(M.levelLink(S,{id:'wl-2',name:'R',level:1.74})
   .includes('data-tip=\"Nearest water level\nR · 0.0 km · 1.74 m\"'),true,
   'levelLink: the tip carries the name, the distance and the reading a title could not');
is(M.levelLink(S,{id:'wl-2',name:'R',level:1.74})
   .includes('aria-label=\"Nearest water level. R · 0.0 km · 1.74 m\"'),true,
   'levelLink: and the aria-label keeps ONE line, because a reader announces a newline as a pause');

// kindChips() draws the station panel's app bar row: one chip per KIND, never one per sensor. A
// place with two sirens drew the word Siren twice, which reads as a rendering fault. Three things
// fail silently here. A count printed as x1 on a lone sensor is noise. Sorting the kinds moves the
// lead sensor's chip off the front. And the hue folds with OR, so a chip covering one reporting
// siren and one silent one must keep the kind colour. Grey is this app's no-reading tone, and a
// station with a reading must not look dead.
// No backticks in this comment, and no bare double quotes: the whole harness is one double-quoted
// shell string, so either one breaks the run before node sees it. The rule is stated above too.
const labels=h=>[...h.matchAll(/<\/i>([^<]*)</g)].map(m=>m[1]).join('|');
const hues=h=>[...h.matchAll(/--c:([^\"]*)\"/g)].map(m=>m[1]).join('|');
const K=(kind,info=true)=>({kind,info});
is(labels(M.kindChips([K('siren'),K('siren')])),'Siren ×2','chips: two sirens are one chip with the count');
is(labels(M.kindChips([K('siren')])),'Siren','chips: and one siren carries no multiplier');
is(labels(M.kindChips([K('river'),K('siren'),K('siren'),K('camera')])),
   'Water level|Siren ×2|Camera','chips: each kind once, in the order render.js ranked them');
is(labels(M.kindChips([K('rainfall'),K('river'),K('rainfall'),K('river'),K('river')])),
   'Rainfall ×2|Water level ×3','chips: several repeated kinds each count separately');
is(hues(M.kindChips([K('siren',false),K('siren')])),'P',
   'chips: one reporting siren and one silent one keeps the kind hue');
is(hues(M.kindChips([K('siren',false),K('siren',false)])),'var(--muted)',
   'chips: and goes grey only where none of them reports');

const rects=h=>[...h.matchAll(/<rect[\s\S]*?\/>/g)].map(m=>m[0]);
const A=M.sirenBand(null), B=M.sirenBand([[now-9.3*H,0]]);
const C=M.sirenBand([[now-11*H,0],[now-6*H,1],[now-5*H,0]]);
is(rects(A).length,1,'band: no history -> the empty rail alone');
is(/data-pts/.test(A),false,'band: no history -> no data-pts, or sparktip throws on pointermove');
const b=rects(B)[1];
is(Math.round(+b.match(/x=\"([\d.]+)\"/)[1] + +b.match(/width=\"([\d.]+)\"/)[1]),100,
   'band: one sample carries forward to now');
is(rects(C).filter(r=>r.includes('S3')).length,1,'band: exactly one bar takes the danger red');

const G={warning:0.15,danger:0.3}, R={alert:6.0,warning:7.0,danger:8.30};
const g0=M.sparkline(null,'gauge',G), g1=M.sparkline([[now-4*H,0.12]],'gauge',G);
is((g0.match(/class=\"mk\"/g)||[]).length,2,'spark: a gauge with no readings still draws both marks');
is(/polyline|data-pts/.test(g0),false,'spark: no readings -> no line and no readout');
is(rects(g1).length,1,'spark: one reading -> a dash, not a line');
const r2=M.sparkline([[now-9*H,3.42],[now-5*H,4.80],[now-1*H,5.32]],'river',R);
is(/3.42–5.32 m<\/div>/.test(r2),true,'spark: the caption states the READINGS, and the range alone');
is(/ m over /.test(r2),false,'spark: the span moved to the heading, so the caption cannot print it twice');
is(/8.30/.test(r2.match(/class=\"muted\">[^<]*/)[0]),false,'spark: and never the axis, which holds the marks');
is(/<div class=\"subhead\">Last 12 h</.test(M.sparkline(null,'river',null)),true,
   'spark: and it heads its own window, the same rule rainBars and sirenBand obey');
is(/<div class=\"subhead\">Last 12 h</.test(M.sirenBand(null)),true,
   'band: the clock frame, so the heading is the constant and never the record');
is((r2.match(/class=\"mk\"/g)||[]).length,3,'spark: a river still draws all three marks');
is(/<svg/.test(M.sparkline(null,'river',null)),true,'spark: no readings and no marks -> still a graph');
is(/data-pts|class=\"peak/.test(M.rainBars(null)),false,'bars: no readings -> no readout and no peak');
is(/Last 12 h/.test(M.rainBars(null)),true,'bars: no readings -> heading names the window it drew');

let drew=0, threw=0, faults=0, capBad=0;
for (const s of JSON.parse(fs.readFileSync('.cache.json','utf8')).stations) {
  const k=s.kind; if(!['river','gauge','rainfall','siren'].includes(k)) continue;
  let h=''; try { h = k==='rainfall'?M.rainBars(s.history):k==='siren'?M.sirenBand(s.history)
      :M.sparkline(s.history,k,s); } catch(e){ threw++; console.log('  THREW',s.id,e.message); continue; }
  if(/<svg/.test(h)) drew++; else console.log('  NO GRAPH',s.id,k);
  if(/NaN|Infinity|undefined/.test(h)){ faults++; if(faults<3) console.log('  BAD MARKUP',s.id,k); }
  const c=h.match(/([\d.-]+)–([\d.-]+) m<\/div>/);
  if(c && s.history?.length>1){ const v=s.history.map(r=>r[1]);
    if(Math.abs(+c[1]-Math.min(...v))>0.005||Math.abs(+c[2]-Math.max(...v))>0.005){ capBad++;
      console.log('  CAPTION STATES THE AXIS',s.id,c[0]); } } }
console.log('every station drew a graph:',drew,' threw:',threw,' bad markup:',faults,' bad captions:',capBad);
bad += threw + faults + capBad;

// Every segment of a sensor's body carries a title, and two mechanisms supply them. sensorBody()
// titles the block where it knows the kind. The block titles itself where only it knows its own
// span. A block that stops stating its heading leaves an untitled segment, and nothing on screen
// says which of the two failed. A group of ONE item takes no title, because the section head above
// it already named the only thing under it.
let one=0, many=0, untitled=0, lone=0;
for (const s of JSON.parse(fs.readFileSync('.cache.json','utf8')).stations) {
  let h; try { h = M.sensorBody(s); } catch(e){ untitled++; console.log('  THREW',s.id,e.message); continue; }
  const items = h.split('<li>').slice(1);
  if (!items.length) { untitled++; console.log('  NO SEGMENT',s.id,s.kind); continue; }
  if (items.length === 1) { one++;
    if (/class=\"subhead\"/.test(items[0])) { lone++; console.log('  LONE ITEM TITLED',s.id,s.kind); }
    continue; }
  many++;
  for (const it of items) if (!/<div class=\"subhead\">[^<]+</.test(it)) { untitled++;
    if (untitled<6) console.log('  UNTITLED SEGMENT',s.id,s.kind,it.slice(0,70)); } }
console.log('groups of one:',one,' of several:',many,' untitled:',untitled,' lone titled:',lone);
bad += untitled + lone;
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"
```

```bash
# Is any station plotted outside the district it is filed under? This is the sweep that found the
# shuffled camera batch. It measures each station against the median of its own district, so a large
# district reports real outliers too — BUKIT FRASER is 27 km from the centre of Hulu Selangor and is
# correct. Read it as a shortlist to check by name, never as a list of faults.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);$g=[];
foreach($p["stations"] as $s){if(!$s["lat"]||!$s["lng"])continue;$g[$s["state"]."|".$s["district"]][]=$s;}
$m=function($a){sort($a);$n=count($a);return $n%2?$a[($n-1)/2]:($a[$n/2-1]+$a[$n/2])/2;};$o=[];
foreach($g as $k=>$r){if(count($r)<4)continue;$cl=$m(array_column($r,"lat"));$cn=$m(array_column($r,"lng"));
foreach($r as $s){$km=hypot($s["lat"]-$cl,($s["lng"]-$cn)*cos(deg2rad($cl)))*111;
if($km>25)$o[]=sprintf("%6.1f km  %-24s %-14s %s",$km,$k,$s["id"],$s["name"]);}}
rsort($o);echo implode("\n",$o),"\n";'

# What each published camera point actually is. This is the sweep that solved the shuffle: it names
# the nearest non-camera station to every raw coordinate the feed publishes. A camera in the shuffle
# lands within ~550 m of a station that carries ANOTHER camera's name, and those pairs form one
# closed cycle. A camera near a station of its own name is published correctly. Run it against the
# live list, not .cache.json — the cache holds coordinates CAM_FIX has already rewritten.
php -r '$c=curl_init("https://infobanjirjps.selangor.gov.my/JPSAPI/api/CCTVS");
curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
$r=json_decode(curl_exec($c),true);curl_close($c);
$p=json_decode(file_get_contents(".cache.json"),true);
$km=fn($a,$b,$c2,$d)=>hypot($a-$c2,($b-$d)*cos(deg2rad($a)))*111;$non=[];
foreach($p["stations"] as $s) if($s["kind"]!=="camera"&&$s["lat"]&&$s["lng"]) $non[]=$s;
foreach($r as $s){$la=(float)$s["latitude"];$ln=(float)$s["longitude"];if(!$la)continue;
$b=null;$bd=1e9;foreach($non as $n){$d=$km($la,$ln,$n["lat"],$n["lng"]);if($d<$bd){$bd=$d;$b=$n;}}
printf("%-5d %-28s %6.0f m  %-30s %s\n",$s["stationId"],$s["stationName"],$bd*1000,$b["name"],$b["district"]);}'

# The vendored M3 token scales must match their source. What this catches is somebody editing a
# generated file by hand. What it cannot catch is upstream moving a number this app relies on, so
# read the diff rather than the exit code. It reaches the network, so run it beside the other
# by-hand bakes rather than on every change.
php m3-build.php
git diff --quiet vendor/m3/tokens.css && echo "OK: matches the source" || echo "MOVED: read the diff, then bump ?v="

# The build. It writes `site/`, which is what a browser gets: bundled, minified, and named by
# content hash. The repository is what a person edits. Run it before the four render checks below,
# or `?base=/site/` measures whatever the last build left behind.
npm ci                        # once, or after package.json moves
npm run build                 # the server build. `npm run build:static` is the GitHub Pages one.

# **THE FOUR RENDER CHECKS TAKE A TARGET, AND BOTH TARGETS ARE REAL.** They are m3-check,
# paint-check, title-test and narrow-test. With no query they load the source, which is what a
# person edits. With `?base=/site/` they load the build, which is what a browser gets. Run both.
#
# A check that only ever reads the source guards nothing about what ships, and minification is
# exactly the step that can break a rule these files measure. Two faults have already been found
# that way, and neither showed on the source target:
#   - `m3-check.html` filtered stylesheets on `href.includes('chrome.css')`. The build names that
#     file `chrome-SJKGO523.css`, so eight assertions read an empty rule list and failed.
#   - The same file drove the app with `import { openSide } from '/js/map.js'`. A bundle has no such
#     module, the injected script never resolved, and the check HUNG with no verdict at all.
# `js/probe.js` answers the second. `sheetRules()` answers the first.
#
# The other four checks are source-only and stay that way. `heat-test.html` and
# `map-limits-test.html` import app modules directly to test pure logic, which a bundle cannot
# expose and minification cannot change. `shots-test.php` and `api.php --selftest` are PHP.
#
# The four against the build. Same flags as the source runs below, same verdict line.
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
run() { "$CH" --headless=new --disable-gpu --ignore-certificate-errors \
  --virtual-time-budget=$2 --window-size=$3 --dump-dom "https://flood-exp.test/$1?base=/site/" \
  | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s' | tail -1; }
run m3-check.html    300000 1600,1000
run paint-check.html  60000 1600,1000
run title-test.html   40000 1800,1000
run narrow-test.html  35000 1200,900

php shots-test.php            # one of eight runnable checks. Guards camera retention. Must stay green.
php api.php --selftest       # another. Guards the force-refresh rate limit, cache choice, and the
                              # place-lookup validator/rate limit. Must stay green.
curl -sk "https://flood-exp.test/api.php?shots=1"                          # frame timestamps

# Which rain gauges are claiming rain their own odometer denies. The siren sweep below is the same
# question on the other sensor. Read the three counts together: `null` is the archive being unable
# to answer, not a pass, and it covers every KL gauge because only Selangor publishes an odometer.
# A `false` count climbing past a handful means either JPS broke a batch of gauges or the odometer
# stopped arriving — check `sources.stale` before believing the first one.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$r=array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall");$c=["true"=>0,"false"=>0,"null"=>0];
foreach($r as $s){$b=$s["backed"]??null;$c[$b===true?"true":($b===false?"false":"null")]++;}
echo count($r)," rainfall: ",json_encode($c),"\n";
foreach($r as $s) if(($s["backed"]??null)===false)
  printf("  %-9s %-26s hourly=%-5s status=%s daily=%s\n",$s["id"],substr($s["name"],0,26),
         $s["hourly"],$s["status"],json_encode($s["daily"]??null));'

# Which archived frames still carry an alert span, and which sensor raised each one. The siren rule
# lives in a closure inside the request handler and cannot be reached by --selftest, so this sweep is
# its check: a siren id appearing here must have had a river at its Amaran mark at that time. Both
# stuck relays (siren-50, siren-1081) coloured 14 frames before the rule and none after it.
for d in shots/*/; do id=$(basename "$d"); curl -sk "https://flood-exp.test/api.php?shots=$id"; done \
  | php -r 'while($l=fgets(STDIN)) foreach(json_decode($l,true)?:[] as $f) if($f[1]!==null) echo "$f[2] $f[1]\n";' \
  | sort | uniq -c
curl -sk -o /dev/null -w '%{http_code} %{content_type}\n' \
     "https://flood-exp.test/api.php?shot=1&t=$(curl -sk 'https://flood-exp.test/api.php?shots=1' \
     | php -r 'echo json_decode(stream_get_contents(STDIN))[0];')"          # 200 image/webp

# Place search. Run sparingly — an uncached query reaches Nominatim, a free service with a
# one-request-per-second policy this proxy is the only thing enforcing. Expect a 200 with a
# non-empty `places` array on a real place name.
curl -sk "https://flood-exp.test/api.php?place=Bandar+Utama" \
     | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)),"\n";'

# The two logs this app writes. Both are gitignored, and both are absent on a healthy day.
tail -20 .php-error.log        # PHP: an uncaught throw or a fatal, from api.php or log.php
tail -20 .client-errors.log    # the browser: one JSON line per report, from js/oops.js

# log.php is a public endpoint that writes to disk, so only a POST carrying a JSON object may write
# a line. Expect `wrote 1` from the four requests below. Any other number means a guard has gone.
B=$( [ -f .client-errors.log ] && wc -l < .client-errors.log || echo 0 )
curl -sk -o /dev/null                                     "https://flood-exp.test/log.php"  # GET
curl -sk -o /dev/null -X POST --data 'not json'           "https://flood-exp.test/log.php"
curl -sk -o /dev/null -X POST --data '"a bare string"'    "https://flood-exp.test/log.php"
curl -sk -o /dev/null -X POST --data '{"kind":"error","msg":"verify"}' "https://flood-exp.test/log.php"
echo "wrote $(( $(wc -l < .client-errors.log) - B ))"

# watch.php is the whole of the monitoring on a self-hosted box. The poll cron pipes the payload into
# it. Healthy is silent, and it reports a CHANGE of state so a fault logs once rather than every five
# minutes. Expect exit 0, 1, 1, 0 and exactly two new lines in the log.
rm -f .watch.state
curl -sk https://flood-exp.test/api.php | php watch.php; echo "healthy    -> $?"
printf '' | php watch.php;                               echo "no payload -> $?"
printf '' | php watch.php;                               echo "again      -> $?  (must not log twice)"
curl -sk https://flood-exp.test/api.php | php watch.php; echo "recovered  -> $?"
tail -2 .php-error.log

# metwarn.parsed reads 0 on any calm day, so watch.php must NOT treat it as a fault. Expect 0.
curl -sk https://flood-exp.test/api.php \
  | php -r '$p=json_decode(stream_get_contents(STDIN),true);$p["sources"]["metwarn"]["parsed"]=0;echo json_encode($p);' \
  | php watch.php; echo "metwarn 0  -> $?  (must be 0)"

# watch.php now reads sources.old as well as sources.stale. They name different faults: `stale` is a
# page that did not answer, `old` is a page that answered with nothing recent. On the payload this
# work measured, `old` holds met-warn and `stale` is empty, so watch.php reports a fault and exits 1.
rm -f .watch.state
curl -sk https://flood-exp.test/api.php | php watch.php; echo "first  -> $?"
curl -sk https://flood-exp.test/api.php | php watch.php; echo "again  -> $?  (must not log twice)"
tail -2 .php-error.log
```

```bash
# Are all three weather feeds contributing? Read met.parsed and met.fresh as a pair. parsed:0 means
# MET moved something and the scrape found nothing. parsed high with fresh:0 means the scrape works
# and the upstream has stopped updating, which is a different fault. Never read fresh alone.
curl -sk https://flood-exp.test/api.php | php -r '$s=json_decode(stream_get_contents(STDIN),true)["sources"];
echo json_encode(["met"=>$s["met"],"metday"=>$s["metday"],"metwarn"=>$s["metwarn"]]),"\n";'

# No station may hold a MET point beyond MET_KM. The radius is read out of api.php rather than
# copied here: this check sat at a hardcoded 15 after MET_KM moved to 16.5, and reported the 16
# stations that change was made to recover as failures.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
preg_match("/MET_KM\s*=\s*([\d.]+)/",file_get_contents("api.php"),$m);$k=(float)$m[1];
echo count(array_filter($p["stations"],fn($s)=>($s["met"]["km"]??0)>$k))," beyond MET_KM ($k km)\n";'

# The weather layer. `points` must hold about 50 rows. A fall means BOX, metPoints() or the MET
# page moved. `temp` reads 0 while api.data.gov.my/weather/forecast answers an empty array. That
# happened on 2026-08-17 — read it beside `metday.parsed` before calling it a fault.
curl -sk "https://flood-exp.test/api.php?wx=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true);
$p=$j["points"] ?? []; printf("points: %d, temp: %d, past: %d\n", count($p),
  count(array_filter($p, fn($x)=>isset($x["tmax"]))),
  count(array_filter($p, fn($x)=>($x["past"] ?? []) !== [])));'

# The ETag must not move between two MET issues. A 200 here means the body carries a field that
# changes without the data changing. Every poll then ships the full body, for as long as a tab
# stays open. That is the fault `cacheAge` caused on the payload.
E=$(curl -sk -D - -o /dev/null "https://flood-exp.test/api.php?wx=1" | tr -d '\r' | awk '/^ETag:/{print $2}')
curl -sk -o /dev/null -w 'must be 304: %{http_code}\n' -H "If-None-Match: $E" \
     "https://flood-exp.test/api.php?wx=1"

# A weather row must never borrow a district from a station. Every district must come from
# wx-places.json, which wx-build.php bakes from Nominatim.
php -r '$j=json_decode(file_get_contents("wx-places.json"),true);
$d=new PDO("sqlite:.history.db");
$w=json_decode($d->query("SELECT body FROM page WHERE url=\"wx:box\"")->fetchColumn(),true);
$bad=0; foreach($w["points"] ?? [] as $p){ if(!isset($p["tmax"])) continue;
 if(!isset($j[$p["id"]])){ $bad++; echo "  NOT BAKED: ",$p["id"],"\n"; } }
echo $bad ? "FAIL: $bad rows\n" : "OK: every temperature came from the baked table\n";'

# The weather archive. One row per point per MET issue, stamped with the issue time MET gives. A
# row stamped with the poll minute means something bypassed the stamp rule.
php -r '$d=new PDO("sqlite:.history.db");
printf("rows: %d, points: %d, newest: %s\n",
  $d->query("SELECT COUNT(*) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn(),
  $d->query("SELECT COUNT(DISTINCT station) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn(),
  date("Y-m-d H:i", (int)$d->query("SELECT MAX(ts) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn()));'

# The rain heat layer, in canvas pixels. Guards the paint distance, the dry-gauge erase and the
# handover between two neighbours — the rules that live in a canvas, where linting and node --check
# cannot reach them. It prints its own verdict. Must read PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=15000 --dump-dom \
  https://flood-exp.test/heat-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'

# The narrow-window block. Under NARROW_PX the app draws a full-screen dialog instead of a map.
# Three ways it fails with nothing wrong on screen: a dialog opened over it wins the top layer and
# the block covers nothing, a `cancel` that goes through hands back a broken map on one Escape, and
# a threshold in js/ui.js that drifts from NARROW_PX blocks a width that works. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=35000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/narrow-test.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'

# The on-map paint chooser. Its button states what the map paints with one glyph, off a `:has()`
# ladder in css/chrome.css. Three silent faults: a wrong rung draws a real glyph for the wrong layer,
# a missing `:not()` hands the answer to stylesheet order, and a rule left off the mask list in
# css/icons.css draws an empty plate. The last one shipped. Also measures the button against every
# other floating box, at 1536 and again at 360. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1600,1000 --dump-dom \
  https://flood-exp.test/paint-check.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'

# The M3 full-screen dialogs below 600px: the station panel, the search, the table, the camera
# wall, About and Help. Loads the app twice, at 360px and at 1200px. Four faults here put nothing
# wrong on screen. A sticky header with `top: 0` pins at the scroller's PADDING edge and holds the
# bar 18 or 20px down. A headline drifting off M3's 56dp is invisible on any one pane. A rule
# written outside the media query moves the desktop, where nothing is meant to move. And a variant
# with no scrim has to keep a way out, which is now the close X and Escape alone. Reads PASS.
# It also guards the warning dialog's body, which is the one scroller in a flex column of auto
# height. That one is asserted as a declaration as well as in pixels. Blink draws the broken rule
# and the fixed rule the same way, and WebKit drew an empty box. See docs/GOTCHAS.md.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=300000 --window-size=1600,1000 --dump-dom \
  https://flood-exp.test/m3-check.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'
# **A short budget TRUNCATES this check rather than failing it.** At 120000 it stopped as the desktop
# pass started, after 122 of 274 assertions, with nothing failed and no verdict printed. At 240000
# it printed the opening line alone, once the rail and the bar joined it. Read the last line: no
# `PASS` means the run did not finish, whatever the counts above it say. It holds 1,012 assertions.

# The coverage circle, the zoom floor, the pan limit and the two water floors. Every fault here is
# silent. A mask that draws nothing looks like a map. A circle rebaked against changed OpenStreetMap
# tagging slides back over the Strait of Malacca and still looks like a circle. A zoom floor the pan
# box refuses still answers its own number to `getMinZoom()`. And a water.json rebaked with the size
# floors removed simply puts six thousand shapes back on the map. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/map-limits-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
# It probes the mask with `isPointInFill`, which reads the fill rule the browser paints with. **Every
# probe has to be on screen.** Leaflet clips a polygon to the viewport, so a point off the edge is
# outside the clipped path whatever the map says. The page throws on a probe the view does not hold,
# rather than reporting a hole in the mask over Perak.

# The app bar wordmark ladder, in rendered pixels. Loads the app in an iframe at fifteen widths and
# asserts one spelling at a time, never wider than its rail, and never a longer spelling on a
# narrower rail. Both faults here are invisible: an overflowing spelling hides under the ellipsis,
# and a selector that loses on specificity draws the drop alone, which is a real rung. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1800,1000 --dump-dom \
  https://flood-exp.test/title-test.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'

# How far apart the stations stand, in blob radii. **Both heat layers, because FEATHER (0.20) is one
# module constant and governs both.** It is not a rain setting. Re-run this before moving it, before
# moving RAIN_KM or HEAT_KM, and before moving the join assertions in heat-test.html.
# The two rows should stay close to each other. Measured 2026-08-14 they are near identical —
# rainfall at 6 km reads 1.21/1.66/1.95 and water at 5 km reads 1.18/1.68/1.99 — so one FEATHER
# fits both. That is not luck: each radius was picked for its own network's density, so the ratio
# lands in the same place. If a future change pulls the two rows apart, FEATHER has to become a
# per-layer option beside `groundKm` rather than stay a shared constant.
# **It thins EVERY station, not the ones currently reporting.** The reporting set changes with the
# weather, and two snapshots an hour apart moved the widest rain pair from 1.58 to 1.90 radii. The
# station geometry does not move. thinHeat() guarantees 1.00 and no more, so read the spread rather
# than the floor. Both populations, because they answer different questions and their percentiles
# differ. A seam shows first between a station and its NEAREST neighbour, so heat-test.html takes its
# probe distances from that row. Join solidity is scored over EVERY overlapping pair instead, since
# any two blobs that meet can show one. At RAIN_KM 9 the rain row read 49 kept and nearest
# 1.13/1.48/1.96 — a SHORTER radius keeps stations relatively FURTHER apart, the opposite of the
# intuition.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);$c=file_get_contents("js/config.js");
preg_match("/RAIN_KM\s*=\s*([\d.]+)/",$c,$m);preg_match("/HEAT_KM\s*=\s*([\d.]+)/",$c,$m2);
$km=fn($a,$b,$c2,$d)=>hypot($a-$c2,($b-$d)*cos(deg2rad($a)))*111;
foreach(["rainfall"=>[["rainfall"],(float)$m[1]],"water"=>[["river","gauge"],(float)$m2[1]]] as $nm=>[$kinds,$R]){
$all=array_values(array_filter($p["stations"],fn($s)=>in_array($s["kind"],$kinds)&&$s["lat"]));
$k=[];foreach($all as $s){foreach($k as $x) if($km($x["lat"],$x["lng"],$s["lat"],$s["lng"])<$R) continue 2; $k[]=$s;}
$nn=[];foreach($k as $i=>$a){$n=1e9;foreach($k as $j=>$b) if($i!=$j) $n=min($n,$km($a["lat"],$a["lng"],$b["lat"],$b["lng"]));
if($n/$R<2)$nn[]=$n/$R;}
$ap=[];foreach($k as $i=>$a){foreach($k as $j=>$b){ if($j<=$i)continue;
$t=$km($a["lat"],$a["lng"],$b["lat"],$b["lng"])/$R; if($t<2)$ap[]=$t;}}
sort($nn);sort($ap);$q=fn($x,$f)=>$x[(int)(count($x)*$f)];
printf("%-9s @%.0fkm: %d stations -> %d kept\n",$nm,$R,count($all),count($k));
printf("  nearest neighbour : %d pairs, median %.2f, p90 %.2f, max %.2f\n",count($nn),$q($nn,.5),$q($nn,.9),end($nn));
printf("  all overlapping   : %d pairs, median %.2f, p90 %.2f, max %.2f\n",count($ap),$q($ap,.5),$q($ap,.9),end($ap));}'

# How much ground the rain layer claims, and how many gauges reporting no rain are left under it.
# This is the sweep that found the 1.8x paint bug: the wash covered 2,747 km2 with 58 dry gauges
# under it. It is a PHP replica of `_field()`, so RAIN_KM and FEATHER are read out of the source and
# never copied here. Expect about 77% of the reach kept, and at most a handful of dry gauges left
# under paint — those share a pole with a wet gauge, where the gate protects the wet reading.
# A dry count in the dozens means the denial stopped running. A kept figure near 96% means the
# per-pixel gate has been replaced by a per-gauge radius again, which under-denies by two thirds.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
preg_match("/RAIN_KM\s*=\s*([\d.]+)/",file_get_contents("js/config.js"),$m);$R=(float)$m[1];
preg_match("/FEATHER\s*=\s*([\d.]+)/",file_get_contents("js/heat.js"),$m2);$F=(float)$m2[1];
$km=fn($a,$b,$c2,$d)=>hypot($a-$c2,($b-$d)*cos(deg2rad($a)))*111;
$ramp=fn($t,$k)=>1-(($t-$k)/(1-$k))**2*(3-2*($t-$k)/(1-$k));
$ker=fn($t)=>$t>=1?0:($t>$F?$ramp($t,$F):1);
$all=array_values(array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall"&&$s["lat"]));
$wet=array_values(array_filter($all,fn($s)=>($s["hourly"]??0)>0));
$dry=array_values(array_filter($all,fn($s)=>($s["hourly"]??null)!==null&&$s["hourly"]<=0));
usort($wet,fn($a,$b)=>$b["hourly"]<=>$a["hourly"]);
$k=[];foreach($wet as $s){foreach($k as $x) if($km($x["lat"],$x["lng"],$s["lat"],$s["lng"])<$R) continue 2; $k[]=$s;}
$cell=function($y,$x)use($k,$dry,$km,$R,$ker){$cs=0;$wn=0;$dsum=0;$dn=0;
 foreach($k as $s){$d=$km($y,$x,$s["lat"],$s["lng"]);if($d>=$R)continue;$c=$ker($d/$R);$cs+=$c;$wn+=$c/($d*$d+0.01);}
 foreach($dry as $s){$d=$km($y,$x,$s["lat"],$s["lng"]);if($d>=$R)continue;$c=$ker($d/$R);$dsum+=$c;$dn+=$c/($d*$d+0.01);}
 $cov=1-(1-min(1,$cs))**2; $dcov=1-(1-min(1,$dsum))**2;
 return [$cov, $dn?1-$dcov*($dn/($wn+$dn)):1];};
$st=0.4;$dg=$st/111;$la=array_column($k,"lat");$ln=array_column($k,"lng");$full=0;$lit=0;
for($y=min($la)-0.1;$y<=max($la)+0.1;$y+=$dg){$dx=$dg/cos(deg2rad($y));
for($x=min($ln)-0.1;$x<=max($ln)+0.1;$x+=$dx){[$cov,$keep]=$cell($y,$x);
 if($cov<0.25)continue; $full+=$st*$st; if($cov*$keep>=0.25)$lit+=$st*$st;}}
$on=0;foreach($dry as $d){[$cov,$keep]=$cell($d["lat"],$d["lng"]); if($cov*$keep>=0.25)$on++;}
printf("%d wet -> %d blobs, %d dry. reach %.0f km2, violet %.0f km2 (%d%% kept), %d of %d dry under\n",
count($wet),count($k),count($dry),$full,$lit,round(100*$lit/max(1,$full)),$on,count($dry));'

# Which notices survive the filter, and where each one came from. `kind` names a flood alert or a
# weather warning. `src` names which of the two MET sources answered, or `jps` for the flood alert.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["warnings"] as $w) printf("%-8s %-5s %s\n  %s\n", $w["kind"], $w["src"]??"?",
  substr($w["title"],0,60), substr(preg_replace("/\s+/"," ",$w["text"]),0,150));'

# Every JPS MET file must decode. A raw newline inside a string breaks json_decode() and must not
# break jsonLoose(). met_gelora is the file that failed a plain decode on 2026-08-17.
php -r 'require "sources.php";
foreach (["met_rain22","met_thunderain2","met_cyclone","met_gelora"] as $f) {
  $u = "https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/$f.json";
  $c = curl_init($u); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
  $b = curl_exec($c); curl_close($c);
  $j = jsonLoose($b);
  printf("%-18s %s\n", $f, $j === null ? "NULL decode" : count($j)." rows"); }'

# The two liveness signals must stay apart. `stale` names a page that did not answer at all. `old`
# names a page that answered with nothing recent. On 2026-08-17, `old` held `met-warn` and `stale`
# was empty.
curl -sk https://flood-exp.test/api.php | php -r '$s=json_decode(stream_get_contents(STDIN),true)["sources"];
echo "stale: ",json_encode($s["stale"]),"\n  old: ",json_encode($s["old"]??null),"\n";'

# No notice text may name only places this map does not cover. A row naming Sarawak alone means the
# paragraph filter kept the wrong part of a national bulletin.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$here=["selangor","kuala lumpur","putrajaya","klang","melaka","malacca","west coast","pantai barat"];
$bad=0; foreach($p["warnings"] as $w){ $t=strtolower($w["text"]); $ok=false;
 foreach($here as $k) if(str_contains($t,$k)){$ok=true;break;}
 if(!$ok){$bad++; echo "  NAMES NOWHERE HERE: ",substr($w["title"],0,60),"\n";} }
echo $bad?"FAIL: $bad rows\n":"OK: every row names somewhere this map covers\n";'

# The media statement link must reach the JPS page.
curl -sk -o /dev/null -w '%{http_code}\n' "https://publicinfobanjir.water.gov.my/ramalan/pernyataan-media/?lang=en"

# Every pin sample in the Help legend must state its own `--c`. A `.pin` reads
# `color: var(--c, var(--accent))`, so a sample with no `--c` draws in the accent blue instead of the
# colour the sentence beside it names. The "at danger" sample shipped that way: an accent-blue drop
# inside the pulsing red halo, under a line promising the reader it fills red. The map was right the
# whole time, which is why this reads as a map fault and is not one.
grep -n 'class="pin[ "]' index.html | grep -v -- '--c:' \
  && echo "FAIL: a legend pin sample has no --c" || echo "OK: every legend pin states its colour"

# The tally chips in the alert panel head must partition the list under them, so the forecast chip
# reads a tier and not a flag. A river at its danger mark can also be rising, and `tier()` files it
# under `now` alone — so a chip counting `s.rising` claims a second alert the cards never draw.
# `alerts.js` evaluates the DOM at module scope, so node cannot load it. This grep is the check.
grep -q 'live.filter(s => s.rising && tier(s) === .soon.)' js/alerts.js \
  && echo "OK: the forecast chip counts a tier" || echo "FAIL: the forecast chip double-counts"

# Which stations hold two alert flags at once. Nothing is wrong when this lists a row. It names the
# case the check above guards, so a reader can see the chips against the cards on a live payload.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
foreach($p["stations"] as $s) if($s["kind"]==="river"&&($s["status"]??0)>=3&&!empty($s["rising"]))
  printf("%-8s %-26s at danger AND rising\n",$s["id"],$s["name"]);'

# color() in js/util.js, the three-colour rule. A sensor wears its own kind, the alert amber or the
# danger red, and never a fourth. Nothing else in this repo can see a fourth colour: the ladders live
# in three tables in config.js, each read by a different surface, and a rung added to one of them
# draws correctly and errors nowhere.
# Two halves. Where each ladder crosses, stated once per kind, so a moved cutoff fails here rather
# than on a wet afternoon. Then every station in the live payload, which is what catches a rung this
# file forgot to name.
# The MODULES are read as they ship, with only their own tables lifted out, so no copy can drift.
# **Grab RIVER_COLOR and RAIN_COLOR to `\};` and not to `;`.** Both are object literals spanning two
# lines, and a lazy `.*?;` stops at the semicolon inside the first line's `--s-none)`.
node --input-type=module -e "
import fs from 'fs';
const cfg = fs.readFileSync('js/config.js','utf8'), util = fs.readFileSync('js/util.js','utf8');
const grab = (s, re) => s.match(re)[0].replace(/export /g,'');
const C = re => grab(cfg, re), U = re => grab(util, re);
const M = new Function(
  C(/const KINDS = \{[\s\S]*?\n\};/) +
  C(/const RIVER_COLOR = [\s\S]*?\};/) + C(/const RAIN_COLOR  = [\s\S]*?\};/) +
  C(/const STATUS_COLOR = .*;/) + C(/const GAUGE_COLOR = .*;/) + C(/const NO_INFO = .*;/) +
  U(/const statusColor = .*;/) + U(/const gaugeTone = s =>[\s\S]*?: 1;/) +
  U(/const gaugeColor = .*;/) + U(/const hasInfo = s =>[\s\S]*?\?\? false\);/) +
  U(/const sounding = .*;/) + U(/const raining = .*;/) +
  U(/function color\(s\) \{[\s\S]*?\n\}/) + '; return { color, KINDS };')();
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const R=st=>({kind:'river',online:true,level:1,status:st});
is(M.color(R(0)),'var(--k-river)','river: normal -> its own blue');
is(M.color(R(1)),'var(--s-alert)','river: alert mark -> amber');
is(M.color(R(2)),'var(--s-alert)','river: warning mark -> the SAME amber');
is(M.color(R(3)),'var(--s-danger)','river: danger mark -> red');
const G=(d,st)=>({kind:'gauge',online:true,depth:d,status:st});
is(M.color(G(-0.2,0)),'var(--k-gauge)','gauge: dry ground -> its own taupe');
is(M.color(G(0.05,0)),'var(--k-gauge)','gauge: water under 0.15 m -> the SAME taupe');
is(M.color(G(0.2,1)),'var(--s-alert)','gauge: past the 0.15 m mark -> amber');
is(M.color(G(0.4,2)),'var(--s-danger)','gauge: past the 0.3 m mark -> red');
const P=(st,h,b=true)=>({kind:'rainfall',online:true,hourly:h,status:st,backed:b});
is(M.color(P(1,5)),'var(--k-rainfall)','rain: light -> its own violet');
is(M.color(P(2,20)),'var(--k-rainfall)','rain: moderate -> the SAME violet');
is(M.color(P(3,45)),'var(--s-alert)','rain: heavy, over 30 mm/h -> amber');
is(M.color(P(4,70)),'var(--s-danger)','rain: very heavy, over 60 -> red');
is(M.color(P(3,45,false)),'var(--k-rainfall)','rain: a gauge its own odometer denies keeps the violet');
is(M.color({kind:'siren',online:true,status:0}),'var(--k-siren)','siren: idle -> its own pink');
is(M.color({kind:'siren',online:true,status:1,backed:true}),'var(--s-danger)',
   'siren: sounding -> red, and no middle rung');
is(M.color({kind:'camera',online:true,image:'x'}),'var(--k-camera)','camera: always its own cyan');
is(M.color({kind:'river',online:false,level:1,status:3}),'var(--s-none)',
   'no reading outranks every rung');
const ok = k => new Set([M.KINDS[k].color,'var(--s-alert)','var(--s-danger)','var(--s-none)']);
const seen={};
for (const s of JSON.parse(fs.readFileSync('.cache.json','utf8')).stations) {
  const c = M.color(s); (seen[s.kind] ||= new Set()).add(c);
  if (!ok(s.kind).has(c)) { bad++; console.log('  FOURTH COLOUR',s.kind,s.id,c); } }
for (const k of Object.keys(seen).sort())
  console.log('    '+k.padEnd(9)+[...seen[k]].sort().join(' '));
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# tier() in js/util.js, the four-rung alert ladder. `js/alerts.js` evaluates the DOM at module scope
# so node cannot load it, and the rung itself lives here where node can.
# Two halves. The ladder in both directions, including the `raining()` guard that keeps a stuck gauge
# off five surfaces. Then the four places a tier NAME has to appear: TIER_TAG, chrome.css,
# ALERT_TITLE, and the line in camAlert() that keeps `heavy` off a camera. A tier missing any of
# those draws a card with a bare grey rule and errors nowhere.
# The isCritical grab ends `;[\r\n]` and not `;\n`. These files carry CRLF, and `;\n` matches nothing.
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/util.js','utf8');
const grab = re => src.match(re)[0].replace(/export /g,'');
const M = new Function(
  grab(/const sounding = .*;/) + grab(/const raining = .*;/) +
  grab(/const isCritical = s =>[\s\S]*?;[\r\n]/) + grab(/const isHot = .*;/) +
  'const hasInfo = s => s.info !== false; const isStale = s => !s.online;' +
  grab(/const tier = s =>[\s\S]*?'soon';/) + grab(/const TIER_RANK = .*;/) +
  '; return { tier, TIER_RANK };')();
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const R=(status,hourly=40,x={})=>({kind:'rainfall',status,hourly,backed:true,online:true,info:true,...x});
is(M.tier(R(2)),null,'rain: class 2 is not on the list at all');
is(M.tier(R(3)),'heavy','rain: class 3 takes the amber rung');
is(M.tier(R(4,70)),'now','rain: class 4 takes the red one');
is(M.tier(R(3,40,{backed:false})),null,'rain: an unbacked gauge raises nothing');
is(M.tier(R(3,0)),null,'rain: a gauge reading zero raises nothing');
is(M.tier(R(3,40,{online:false})),'stale','rain: stale still outranks the rung');
is(M.tier({kind:'river',status:3,online:true,info:true}),'now','river at danger untouched');
is(M.tier({kind:'river',status:1,rising:true,online:true,info:true}),'soon','a rising river untouched');
is(M.tier({kind:'siren',status:1,backed:true,online:true,info:true}),'now','a siren untouched');
is(M.TIER_RANK.now < M.TIER_RANK.heavy,true,'ranks: red sorts above amber rain');
is(M.TIER_RANK.heavy < M.TIER_RANK.soon,true,'ranks: observed rain sorts above a forecast');
is(M.TIER_RANK.soon < M.TIER_RANK.stale,true,'ranks: stale still sorts last');
const tags = fs.readFileSync('js/alerts.js','utf8').match(/const TIER_TAG = \{[\s\S]*?\};/)[0];
const css = fs.readFileSync('css/chrome.css','utf8');
for (const t of Object.keys(M.TIER_RANK)) {
  is(tags.includes(t+':'),true,'TIER_TAG names '+t);
  is(css.includes('.alert.t-'+t),true,'chrome.css paints .alert.t-'+t); }
const titles = fs.readFileSync('js/config.js','utf8');
for (const k of ['rainfall|heavy','rainfall|now','rainfall|stale'])
  is(titles.includes(\"'\"+k+\"'\"),true,'ALERT_TITLE holds '+k);
is(fs.readFileSync('js/stations.js','utf8').includes(\"t === 'heavy'\"),true,
   'camAlert drops the heavy rung before it ranks a camera');
// The M3 markup contract. m3-check.html measures a FIXED card, so only this half can say that the
// real groupCard() emits the classes those rules key on. A card missing either one still renders.
const src2 = fs.readFileSync('js/alerts.js','utf8');
is(/class=\"nsub\"/.test(src2),true,'groupCard heads itself with a list subheader');
// No glyph and no disc in that head. Three shapes were tried and all three were cut — see the
// gotcha list. The Notices pane keeps its own, so this reads alerts.js and never the stylesheet.
is(/nsub\">\$\{rows/.test(src2),true,'and it states the kind in words, with no glyph and no disc');
is(/class=\"alerttop\"/.test(src2),false,'and the chip row it replaced is gone');
is(/class=\"slist mseg\"/.test(src2),true,'groupCard declares its list segmented');
is(/<div class=\"badges\">/.test(src2),true,'the alert head emits a .badges row, so openSide lifts it');
is(/i-near_me/.test(src2),true,'and Nearest first is a chip in it, not a fragment in the headline');
is(/class=\"tally\"/.test(src2),false,'and the pill row it replaced is gone');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# Which rain gauges are on the alert list right now, and on which rung. Class 3 draws amber and class
# 4 draws red. A gauge here whose `backed` reads false is a fault in the guard, not weather.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue;
 if(($s["status"]??0)<3 || ($s["hourly"]??0)<=0 || ($s["backed"]??null)===false) continue;
 printf("%-6s %-30s %5s mm/h  class=%s  %s\n",$s["status"]>=4?"now":"heavy",
   substr($s["name"],0,30),$s["hourly"],$s["status"],$s["updated"]); }'

# The Selangor feed's own status field must never disagree with rainStatus(). It did, on 4 of 281
# gauges, and TAMAN FRIM KEPONG published class 2 over 51.5 mm an hour against its own spHeavy of 31.
# api.php scores every reading itself now. Expect 0.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$rs=fn($h)=>$h===null?-1:($h>60?4:($h>30?3:($h>10?2:($h>0?1:0))));
$n=0; foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue; $h=$s["hourly"]??null;
 if($h!==null && $rs((float)$h)!==(int)$s["status"]){ $n++;
   printf("  %-8s %-28s %s mm/h feed=%s derived=%s\n",$s["id"],substr($s["name"],0,28),$h,$s["status"],$rs((float)$h)); } }
echo $n?"FAIL: $n disagree\n":"OK: every rainfall status came from rainStatus()\n";'

# metSection() in js/popup.js, the station card's weather section. Every headline has to come out of
# the WEATHER ladder in config.js, and that ladder holds THREE rungs: Clear, Rain, Heavy rain. A
# phrase written in the template is a second name for a rung this app already names, and the dry
# case shipped as `No rain` for one revision. Two more words, `Cloudy` and `Thunderstorm`, came off
# the MET DAILY forecast and the repository owner cut both on 2026-08-25.
# The module is evaluated as it ships, with only its imports stubbed, so no copy can drift from what
# runs. Give the ladder stub its REAL values: a bare [] makes every headline `undefined`, which
# reads as a fault in the code and is a fault in the check.
# **Read the ITEMS and never the whole section.** The section head is a <b> too and WX_NOW carries a
# glyph, so a document-wide search reads the title `Weather` as a headline and the play arrow as the
# weather. That failed four assertions on markup that was right.
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/popup.js','utf8')
  .replace(/^import[\s\S]*?from '\.\/stations\.js';/m,'').replace(/\bexport /g,'');
const stubs = \`
const SPARK_H=12, NO_INFO='', NEAR_MAX_KM=30, MET_NAME='MET', ACC_ROWS=[];
const WEATHER=[{icon:'sunny',night:'clear_night',pin:'sunny',word:'Clear',line:''},
 {icon:'rainy_light',pin:'rainy_light',word:'Rain',line:'Rain'},
 {icon:'rainy_heavy',pin:'rainy_heavy',word:'Heavy',line:'Heavy rain'}];
const RIVER_COLOR={},RAIN_COLOR={},GAUGE_COLOR={},RAIN_STOPS=[[0],[10],[30],[60]];
const KINDS={},SOURCES={},ALERT_TITLE={},camSrc=()=>'',distKm=()=>0;
const hasInfo=()=>true,isStale=()=>false,statusColor=n=>'S'+n,scalePos=()=>0;
const hasWx=m=>!!m&&m.now!=null&&m.hr1!=null&&m.tmax!=null&&m.tmin!=null;
const levelStops=()=>null,gaugeStops=()=>null,gaugeColor=()=>'',color=()=>'',isFav=()=>false;
const titleCase=s=>s,noSec=s=>s;
const nearestOf=()=>null,nearestCam=()=>null,nearestLevel=()=>null,camAlert=()=>null,nearestWx=()=>null;
const PREFS={};\`;
const M = new Function(stubs+src+'; return { metSection };')();
let bad=0; const is=(g,w,n)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const items = met => M.metSection({ met: { at:'X', km:1, stamp:0, tmin:24, tmax:33, ...met } })
  .split('<li class=\"wxstep').slice(1).map(li => ({
    glyph: li.match(/class=\"i i-([a-z_]+)\" aria-hidden/)[1],
    head: li.match(/<b>([^<]*)<\/b>/)[1].trim(),
    sub: li.match(/class=\"wx(?:when|now)\"[^>]*>(?:<i[^>]*><\/i>)?([^<]*)</)[1].trim(),
  }));
const later = met => items(met)[1];
// **Rung 0 has TWO glyphs and the clock picks one.** metSection() passes no clock, so wxIcon()
// reads the hour in Malaysia. An assertion naming `sunny` therefore passes all day and fails all
// night, on code that is right. Assert the SET.
const CLEAR = ['sunny','clear_night'];
const r0 = (r, sub, n) => { is([r.head, r.sub], ['Clear', sub], n);
  is(CLEAR.includes(r.glyph), true, n + ': a rung 0 glyph, day or night -> ' + r.glyph); };
r0(later({now:0,hr1:0}), 'In the next 3 hours',
   'dry: the ladder word under the glyph it names, never a phrase written here');
r0(items({now:0,hr1:1,rung:1,to:'19:30'})[0], 'Now',
   'the Now row states the rung now and says Now');
is(later({now:0,hr1:1,rung:1,to:'19:30'}),{glyph:'rainy_light',head:'Rain',sub:'Until 19:30'},
   'wet: the span repeats no word from the headline');
is(later({now:0,hr1:1,rung:2,from:'18:00',open:true,to:'20:30'}),
   {glyph:'rainy_heavy',head:'Heavy rain',sub:'From 18:00, past 20:30'},
   'wet: an open span names both ends');
// A `sky` word must change NOTHING. It named a cloud on rung 0 and a bolt on the wet rungs, off the
// MET daily forecast, and it is deleted from api.php down. A stray refinement re-entering here is
// the map claiming what the nowcast never reported.
is(items({now:0,hr1:1,rung:1,to:'19:30',sky:'storm'}),items({now:0,hr1:1,rung:1,to:'19:30'}),
   'a storm sky changes nothing');
is(items({now:0,hr1:0,sky:'cloud'}),items({now:0,hr1:0}),'a cloud sky changes nothing');
// Three words, and no fourth. Sweep every rung and both shapes of the span.
const words = new Set(['Clear','Rain','Heavy rain']);
const all = [{now:0,hr1:0},{now:1,hr1:1,rung:1,to:'1'},{now:2,hr1:1,rung:2,to:'1'},
  {now:2,hr1:1,rung:2,from:'1',open:true,to:'2'},{now:1,hr1:1,rung:1,to:'1',sky:'storm'}]
  .flatMap(items).map(r => r.head);
is([...new Set(all)].filter(x => !words.has(x)),[],'every headline is one of the ladder three');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# titleCase() in js/util.js, the one rule that turns a JPS name into a title. It has three tests for
# an acronym and one exception list, and every one of them was measured against the live payload. A
# wrong branch here does not throw. It lowercases an acronym, or leaves a whole name in capitals.
# The module is read as it ships, so no copy can drift from what runs.
node --input-type=module -e "
import fs from 'fs';
const M = new Function(fs.readFileSync('js/util.js','utf8')
  .match(/const ABBR[\s\S]*?cap\(w\)\);/)[0].replace(/export /g,'') + '; return titleCase;')();
let bad = 0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
is(M('BATU 9, HULU LANGAT'),'Batu 9, Hulu Langat','plain capitals');
is(M('T.T.D.I JAYA, SHAH ALAM'),'T.T.D.I Jaya, Shah Alam','an acronym written with stops is kept');
is(M('SMK SRI AMAN PURI (F2)'),'SMK Sri Aman Puri (F2)','a vowel-less acronym is kept');
is(M('KG. SG. SELISIK'),'Kg. Sg. Selisik','the eight Malay abbreviations lower');
is(M('Pintu Air SG.PELEK'),'Pintu Air Sg. Pelek','and split when JPS runs one together');
is(M('Sg. Midah Di Lebuhraya KL-Seremban'),'Sg. Midah Di Lebuhraya KL-Seremban','a hyphen is a boundary');
is(M('P/A KG. BARU HICOM (F2)'),'P/A Kg. Baru Hicom (F2)','a slash is one too');
is(M('LN B27 RAWANG'),'LN B27 Rawang','a token holding a digit is a code');
is(M(null),'','null is empty, never the word null');
// No name may lose or gain a character. The one pass that inserts a space is the SG.PELEK split, so
// the comparison ignores whitespace.
const names = JSON.parse(fs.readFileSync('.cache.json','utf8')).stations.map(s=>s.name);
is(names.filter(n => M(n).replace(/\s/g,'').length !== n.replace(/\s/g,'').length).length, 0,
   'no name loses or gains a character');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# No `title` attribute anywhere, and no script that writes one. A `title` opens on no phone, so its
# words are missing on half the devices this runs on, and beside the styled tip it draws a second
# tooltip shape for one control. `data-tip` is the one channel — see js/sparktip.js. A `title` costs
# nothing to add and nothing on screen says it is there, so this grep is the only thing that catches
# one coming back. `document.title` is the window title bar and is not a tooltip.
grep -rn '\btitle=\|\.title *=' js/*.js index.html | grep -v 'document\.title' \
  && echo "FAIL: a title attribute is back" || echo "OK: data-tip is the only tooltip"

# Leaflet writes its own on the two zoom buttons, and js/map.js takes them off after `addTo()`. That
# repair is in an app file, so the grep above cannot see it go. Read the RENDERED page instead: it
# is the only check that covers a vendored library writing an attribute at runtime. Expect nothing.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=25000 --dump-dom https://flood-exp.test/ \
  | grep -o 'title="[^"]*"' | sort -u

# Every module must carry a modulepreload link, except the six loaded on demand. There is no build
# step to generate that list, so it goes stale silently when somebody adds a module.
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js|wx.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done
```

There is otherwise no test suite. Changes are verified four ways. Lint the PHP. Syntax-check the modules. Query `.cache.json` for
the data shape being relied on. Then look at the page.

`shots-test.php`, `php api.php --selftest`, `heat-test.html`, `title-test.html`,
`narrow-test.html`, `paint-check.html`, `m3-check.html` and `map-limits-test.html` are the eight
runnable checks here, and each guards a different risk.

`shots-test.php` is deliberately narrow: retention is the only rule in this repo that can *quietly
destroy* data. Everything else either works or visibly does not. A prune that buckets a frame
wrongly deletes months of camera history, and looks identical to one that worked. It also runs on
every capture. So a rule that shaves one extra frame per pass empties the archive over a week. It is
never wrong in a single run. Hence the idempotence assertion.

`api.php --selftest` guards the decisions that gate a request to an upstream — JPS **or** Nominatim,
now that `?place=` reaches a second one. `forceAllowed()`'s rate limit and `serveFromCache()`'s
cache-or-rebuild choice are the original two. Both are arithmetic on a few integers. So the check
runs offline in milliseconds, rather than through a 270-request fan-out. The place lookup added its
own block of the same shape. It covers `placeQuery()`'s validation: length, whitespace collapse, and
the invalid-UTF-8 case with no PHP notice. It covers `placeParam()`'s array-cast guard, from the
gotcha above. And it covers `forceAllowed()` reused at `PLACE_EVERY`'s window, for the per-second
Nominatim limit. That is fifteen assertions in all, half the check's total. All are offline for the
same reason. No test here must cost a real request to either upstream.

`heat-test.html` guards the one part of this app that lives in canvas pixels. The rain heat layer
paints a distance and then erases what a gauge reporting no rain denies. Neither rule is visible to
`php -l`, to `node --check`, or to any query over `.cache.json`. Both are wrong only on screen.
It needs a browser, so it runs headless and prints its own verdict rather than a picture. It earned
its place immediately. Six faults survived the code review that wrote the layer. The check and its
probes found all six:

- simpleheat's leaked `globalAlpha`
- an eraser reaching across a wet gauge and restating its rainfall as a lighter class
- a brush that peaked where no pixel sits
- a paint falloff that drew four rain classes out of one reading
- `heatScale()` sizing a layer the map had already dropped
- a gradient filled as a square, erasing its neighbour's blob

Two of the six had shipped for months, and no amount of reading found either. Anything else added to
a canvas here needs the same treatment. A canvas is where reading the code stops working.

**A seventh fault got past it, and how it did is the lesson.** `cov` took the max of the blend
weights and drew a Voronoi border on every equidistant line. The check held two assertions over
overlapping gauges and both passed. Both probe two gauges exactly one radius apart, which is the one
spacing where a max behaves. A reader found it on screen instead. **`thinHeat()` guarantees one
radius and nothing more, so one radius is the best case and never the typical one.** The assertions
added after it probe at 1.48 and 1.60 radii. The spacing sweep takes both off the station geometry.
Pick a probe distance from measured data. Otherwise the check reports on a case the map never draws.

`title-test.html` guards the app bar wordmark ladder, which is the same class of problem one layer
up. The rungs are container queries against measured font widths, and both ways they fail put
nothing wrong on screen. A threshold set too low draws a spelling wider than its rail, and the
ellipsis hides the overflow. A selector that loses on specificity draws no spelling at all, which is
a real rung of the ladder. The second one shipped for one run.

The check loads the app in an iframe at fifteen widths and reads the rungs back. The rail is a
rendered width, and no query over the source can state it.

`narrow-test.html` guards the narrow-window block, which is the one surface here that takes the
whole app away from a reader.

Three faults put nothing wrong on screen. A dialog opened over the block wins the top layer and the
block covers nothing. A `cancel` that goes through hands back a broken map on one Escape. A
threshold in `js/ui.js` that drifts from `NARROW_PX` blocks a width that works.

It reads `NARROW_PX` out of `js/config.js` rather than carrying a copy. A check that holds its own
copy of a constant reports on the number it remembers. It does not report on the number the app
uses.

**Assert the property, not the scenario, and two attempts here show why.** A `showModal()` call from
the check asserts a call the check made. It passes against an app put back to a plain `show()`.
Narrowing a live iframe reaches the call the app makes. That needs a layout, and headless virtual
time supplies no reliable clock to wait on.

Focus is the property. A modal dialog makes the page behind it inert, and a modal dialog is in the
top layer by definition.

`paint-check.html` guards the layer chips over the map. What it asserts is rendered pixels, and none
of it reaches `php -l`, `node --check` or any query over `.cache.json`.

**Five shapes came before this one and every one of them failed on the same axis.** A glyph plate in
the map's corner read as a map pin. An accent FAB with a label shouted. Then a panel behind a
`layers` button, a bottom sheet on a phone, connected button groups inside that panel, and size-lg
square outlined buttons. Each one put a settings dialog between a reader and a setting. The chips ARE
the control now.

**The deletions are asserted, and that is the assertion nothing else can make.** `#paintmenu`,
`#paint` and `#navLayers` are gone. Markup left behind by a half-finished revert draws a dead button
on the map and errors nowhere.

**Two chip kinds, told apart by shape.** A menu chip states its VALUE as its label and carries a
trailing arrow. A filter chip states a NAME and answers with a leading checkmark. The check reads
both halves on all four chips, because a chip carrying neither mark looks deliberate.

**Chromium does not restyle a `:has(input:checked)` subject when a SCRIPT changes that
checkedness.** `matches()` answers true and `getComputedStyle` hands back the unchecked value.
Measured on this build. So the selected chip's own pixels are read from a page that LANDS with the
filter on, never after a scripted click.

**A filter with no members is disabled, and `syncPins()` clears the preference when one empties.**
That is correct behaviour, and a scenario test reads it as a failure. So the check writes a real
station id into `PREFS.favs` first, taken out of the live payload. A made-up id leaves the filter
with nothing to match, and the app clears it again.

**A reload replaces the document, so every helper bound to the old one goes stale.** The favorite
block is last in the desktop pass for that reason, and it rebinds.

**A resolved token is not a painted pixel.** An early version asserted `--i` alone and passed on a
button drawing an empty plate, because a rule had never joined the mask list in `css/icons.css`. It
reads `mask-image` and the box size too.

**Headless virtual time does not run CSS transitions faithfully, so no check here can measure one
mid-flight.** Reading an animated collapse 120ms in returned a value that then stuck at 0 for the
rest of the run, on markup that works in a real browser.

So an animation is asserted as a DECLARATION, once, and then `paint-check.html` injects
`* { transition: none !important }` into the frame and measures every state settled. Assert the
declaration BEFORE that override, or the override is what gets read.

**Geometry is measured with a menu OPEN.** A closed popover is `display: none`, so every rect inside
it reads zero and an assertion compares 0 against 0.

**It paints after every assertion, not once at the end.** A check that reports only on completion
reports nothing at all when it hangs, and this one hung. The whole body is in a `try` for the same
reason.

**Nothing else in this app could see a box landing on its neighbour.** A box correct against the
pane, correct against the window and correct against the card is still wrong if it lands on the one
beside it. So the check intersects the chip row against every other box on the map, at both widths.

**Below 600px the row wraps, and that is asserted as two rows.** Four chips need about 440px and a
compact map is 360. A row that scrolled sideways would hide the chips past its edge with nothing on
screen to say they exist.

`m3-check.html` guards the six M3 full-screen dialogs below 600px. It is the same class of problem
as `paint-check.html`: rendered pixels, and no query over the source can state one of them.

Four faults here put nothing wrong on screen and three of them shipped during the work.

**A sticky header pins to the scroller's PADDING box.** So `top: 0` holds the bar 18 or 20px down
and the content scrolls through the gap above it. That reads as a browser artifact rather than as a
wrong number, and it happened in two panes.

**The headline starts on M3's 56dp across five panes built from four different paddings.** Drift
there is invisible on any one pane. It only shows when two stand side by side, which is the one
thing a reader never does.

**A rule written outside the media query moves the desktop**, where nothing here is meant to move.
So the check loads the app a second time at 1200px and reads the wide layout back: the 288px rail,
the 360px panel, the trailing ×, the two slide transforms and the four floating dialogs.

**A variant with no scrim has to keep a way out.** The scrim tap and the swipe both went with the
bottom sheet they belonged to. So the check asserts the station card has a close button at all, and
drives a real Escape through the document to reach the handler the app registered.

It reuses two rules the checks above it already state. Transitions are switched off in the frame
before anything is measured. And geometry is read with the pane OPEN, because a closed dialog is
`display: none` and every rect inside it reads zero.

**Press the control, never write `aria-current` by hand.** `railSync()` derives that attribute from
the live DOM and runs from a `MutationObserver`, so a hand-written value is cleared by the next
body-class write. The assertion then reads an unselected item and calls a correct rule broken.

**A second `const` of one name in one function is a parse error, and this file prints `running...`
and nothing else.** No assertion runs, no `THREW` line appears, and the whole page looks like a
hang. Extract the script and run `node --check` on it before blaming the app.

## The zoom ceiling

`maxZoom` is 15, and `disableClusteringAtZoom` is 15 as well. So 15 is the first zoom that merges
nothing. Three numbers hold that up: those two and `maxClusterRadius`. A new station near another one
moves the radius answer, and so does a change to the radius. Nothing warns about either. The map
draws a cluster chip at its own ceiling, and `spiderfyOnMaxZoom` is then the only way to open it.

Open `https://flood-exp.test`, wait for the pins, and paste this into the console. It prints how many
markers the radius alone still merges at each zoom.

```js
const M = await import('/js/map.js');
const pts = Object.values(M.marks).flat().map(m => m.getLatLng());
const radius = z => z >= 13 ? 26 : 34;   // keep in step with maxClusterRadius
for (let z = 12; z <= 18; z++) {
  const r = radius(z), p = pts.map(q => M.map.project(q, z));
  const merged = p.filter((a, i) => p.some((b, j) =>
    i !== j && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r)).length;
  console.log(z, 'radius', r, 'merged', merged);
}
```

Measured on 2026-09-03 over 460 sites, with the old three-band radius: 282 merged at zoom 12, 134 at
13, 72 at 14, 6 at 15, and none from 16. Those six at zoom 15 are what `disableClusteringAtZoom`
takes.

The second sweep asks the app itself, which is what a reader sees:

```js
const M = await import('/js/map.js');
const pts = Object.values(M.marks).flat().map(m => m.getLatLng());
const dense = pts.map(p => ({ p, n: pts.filter(q => q.distanceTo(p) < 800).length }))
                 .sort((a, b) => b.n - a.n).slice(0, 15);
for (const z of [13, 14, 15]) {
  let chips = 0;
  for (const s of dense) {
    M.map.setView(s.p, z, { animate: false });
    await new Promise(r => setTimeout(r, 420));
    chips += document.querySelectorAll('#map .cluster').length;   // `#map` skips the legend swatch
  }
  console.log('zoom', z, 'chips over the 15 densest views', chips);
}
```

It printed 487 at zoom 13, 112 at 14 and 0 at 15.

**Scope the selector to `#map`.** The Help glossary draws a `.cluster` of its own, and a bare
`querySelectorAll('.cluster')` counts it in every view. That reads as one stubborn cluster at every
zoom, and that fault does not exist.

## The map moves smoothly

Run this after any change to the pins, the cluster or the layers on the map. It drives one gesture
and counts animation frames. A condition runs against its rival in the order A B B A, three times
each, because the first minute of a session is slower than the fourth and a straight run of
conditions reports the last one as the fastest.

```js
const M = await import('/js/map.js');
const rec = ms => new Promise(res => {
  const f = [], t = []; let last = performance.now(); const t0 = last;
  const po = new PerformanceObserver(l => { for (const e of l.getEntries()) t.push(e.duration); });
  po.observe({ entryTypes: ['longtask'] });
  const tick = () => { const n = performance.now(); f.push(n - last); last = n;
    if (n - t0 < ms) requestAnimationFrame(tick);
    else { po.disconnect(); f.sort((a, b) => a - b);
      res({ frames: f.length, p95: +f[Math.floor(f.length * .95)].toFixed(1),
            ltSum: Math.round(t.reduce((a, b) => a + b, 0)) }); } };
  requestAnimationFrame(tick);
});
const gesture = async () => {
  M.map.setView([3.1390, 101.6869], 11, { animate: false });
  await new Promise(r => setTimeout(r, 400));
  for (const z of [12, 13, 14, 13, 12, 11]) {
    M.map.setZoom(z); await new Promise(r => setTimeout(r, 450));
  }
  M.map.panBy([300, 200]); await new Promise(r => setTimeout(r, 500));
  M.map.panBy([-300, -200]); await new Promise(r => setTimeout(r, 500));
};
const p = rec(4200); gesture(); console.log(await p);
```

Measured on 2026-09-03 at 1536 by 864, dark theme, water layer on, water heatmap on: 209 frames in
4.2 s, a 95th-percentile frame of 37 ms, and 675 ms of long tasks. Removing the pin layer outright
gives 215 frames, so the marks now cost what drawing nothing costs.

The same gesture reached 103 frames while the pins were DOM nodes, and 65 with a `drop-shadow`
filter on each of them. See `docs/FEATURES.md` for the whole ladder.

**The number is a comparison, never a grade.** It moves with the machine, the window and the
payload. Take a reading before a change and one after it, in the order above.
