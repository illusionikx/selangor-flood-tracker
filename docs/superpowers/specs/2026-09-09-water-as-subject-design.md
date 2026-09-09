# Water becomes the subject of the map, 2026-09-09

The repository owner asked for a map that puts water first. This is a hydrology map, and the water
on it is thin. This design keeps the mechanism that draws water. It replaces what that mechanism
holds and how it paints.

## What is there now

`water-build.php` asks Overpass for water. It writes `water.json`. `js/map.js` draws that file on a
canvas pane under the pins. The table below states the measured condition on 2026-09-09.

| item | state |
|---|---|
| `water.json` | 1,733 KB raw, 402 KB gzipped, 50,096 coordinate pairs |
| content | 866 rivers and 1,185 water bodies |
| when it draws | the dark theme only |
| the light theme | no water at all |
| the sea | never drawn, on either theme |

Three faults follow from that condition.

The sea is absent. OpenStreetMap tags the open sea as `natural=coastline`, which is a directed
line. Overpass cannot answer with a sea shape, so the bake never sees one. The Klang estuary
channels go the same way.

The light theme draws nothing. The Light Gray Canvas from Esri draws little water of its own, so a
light reader gets a grey map with pins on it.

The size floors cut most of the water. `MIN_AREA_KM2` and `MIN_RIVER_KM` removed 1,909 rivers and
5,209 water bodies on 2026-09-02.

## The measurements this design rests on

### The basemap paints water grey

One tile at zoom 11 over the Klang estuary, sampled from each Canvas service.

| service | land | sea |
|---|---|---|
| World Light Gray Canvas | `#e8e8e8` | `#d0cfd4` |
| World Dark Gray Canvas | `#4d4d4f` | `#232227` |

Esri separates its sea from its land. It does not make the sea blue.

### The size floors never bought bytes

Five floor settings, baked against the cached Overpass answer.

| floors | rivers | bodies | gzipped |
|---|---|---|---|
| 0.01 km² and 1.0 km, today | 866 | 1,185 | 402 KB |
| 0.005 km² and 0.5 km | 1,129 | 2,263 | 445 KB |
| 0.002 km² and 0.3 km | 1,336 | 4,236 | 493 KB |
| 0.001 km² and 0.15 km | 1,595 | 5,016 | 513 KB |
| none | 2,775 | 6,394 | 543 KB |

The full set holds 3.2 times the shapes for 35 percent more bytes. The floors bought a picture, not
a file size. Their own comment states the picture: 2,775 rivers drew as a blue web at zoom 10.

### The coastline is the easy topology

One Overpass query for `natural=coastline` over `BOX` returns 276 ways and 15,235 points. Only two
chain ends meet nothing. The coastline runs through the box as one chain, cut where it leaves the
north edge and the south edge.

### No free water overlay exists

The public Esri catalogue on `server.arcgisonline.com` holds Canvas, Elevation, Ocean, Polar,
Reference, Specialty and eight root services. `Reference/World_Hydro_Reference_Overlay` answers 404.
The `Reference` folder holds boundaries, places and transportation. No hydrography service is
published there.

A vector basemap can style water at source. `maplibre-spike.html` measured that route on 2026-09-03
and it does not ship. MapLibre GL JS costs 200 KB gzipped against the 42 KB of Leaflet. It also puts
two hosts in the browser that this app never contacts.

So water emphasis must come from the baked data of this app. That is the mechanism `water.json`
already is.

## What this design changes

### 1. The sea and the estuary draw

`water-build.php` gains a second Overpass query for `natural=coastline`.

The build walks the coastline ways end to end. The `rings()` helper already does that walk for a
lake relation. The walk gives closed rings and one open chain. A closed ring inside the box is an
island. The open chain is the mainland shore.

The build closes the open chain against `BOX` along the west edge. That gives the sea as one
polygon. Each island becomes a hole in it.

`water.json` gains a third feature with the property `t` set to `sea`. `js/map.js` styles it as a
fill in `--water`, the same as a pond. The estuary channels arrive with it, because that water is
coastline.

The added cost is about 15 KB gzipped.

One risk comes with a fill this large. The sea polygon covers every pixel of basemap under it. Esri
draws a shoreline from its own data, and OpenStreetMap draws a shoreline from another. Where the two
disagree, the fill hides the Esri answer and states the OpenStreetMap one. Check the estuary and the
islands at zoom 12 by eye before this ships.

### 2. The size floors become zoom bands

The build stops cutting a shape. It stamps each shape with the first zoom that draws it.

| zoom | draws | shapes |
|---|---|---|
| 10 and below | what draws today | 2,051 |
| 11 and 12 | 0.002 km² and 0.3 km and above | 5,572 |
| 13 and above | everything | 9,169 |

`js/map.js` holds one `L.LayerGroup` per band. A `zoomend` handler adds and removes a group.
Leaflet does the rest. There is no custom redraw and no per-frame work.

`MIN_AREA_KM2` and `MIN_RIVER_KM` keep their names and their values. They stop being a cut. They
become the edge of the first band.

The river stroke weight scales with the band. A 1.4 px line on 2,775 rivers is the same blue web at
zoom 13 that the floors removed from zoom 10.

### 3. Water draws on both themes

`--water` gains a light theme value. `setWater()` stops testing the theme and always draws.

The candidate values below come from OKLCh at hue 238, which is the hue the palette rule pins to
water. The table states contrast against the basemap land tone and against `--k-river`, the river
station pin.

| theme | candidate | OKLCh | against land | against the pin |
|---|---|---|---|---|
| light | `#8cc6ec` | L 0.80, C 0.08, H 238 | 1.50:1 | 1.22:1 |
| dark, today | `#15364e` | L 0.32, C 0.06, H 243 | 1.49:1 | 5.62:1 |
| dark, candidate | `#1b77a7` | L 0.54, C 0.11, H 238 | 1.70:1 | 2.21:1 |

The light candidate holds the same separation from land that the dark theme holds today. That makes
the two themes symmetric.

The dark candidate answers a fault the measurement exposed. The current `--water` separates from
land by 1.49:1. The untouched Esri sea separates by 1.87:1. So the water this app draws reads as
less distinct than the water it replaces. The candidate reverses the relation and makes water brighter
than land, which is how a hydrology map usually reads.

Take the final value from a rendered picture, not from the table. The tolerance in
`water-build.php` states that method, and two readers rejected a value derived by arithmetic alone.

## What this design does not change

The mechanism stays. A baked GeoJSON file, fetched once, drawn on a canvas pane, keeps every part of
its present shape.

The basemap stays. Esri Canvas draws until `CARTO_KEY` holds a key.

The file stays single. The fetch grows from 402 KB gzipped to about 560 KB. It is already deferred
behind `requestIdleCallback`. Split the detail bands into a second file only after somebody measures
that the landing suffers.

The palette rule stays. Water keeps hue 238. No status hue enters the map.

## Files

| file | change |
|---|---|
| `water-build.php` | the coastline query, the chain walk, the box closure, the band stamp |
| `water.json` | rebaked, three features, a band on each shape |
| `js/map.js` | three layer groups, a `zoomend` handler, no theme test in `setWater()` |
| `css/base.css` | a light theme `--water`, and a new dark value if the owner takes it |
| `map-limits-test.html` | reads `water.json`, so check it against the new shape |

Three comments in `js/map.js` are stale and this change corrects them. Line 450 states 242 KB
gzipped and the file is 402 KB. Line 481 states 6,635 shapes and the file holds 2,051. The
`--water` comment in `css/base.css` describes an SVG tint that this repository deleted on
2026-08-27.

## Checks

Run `map-limits-test.html`, because it reads `water.json`.

Run `paint-check.html` and `m3-check.html`, because the map card is in both.

Take a screenshot at zoom 10, zoom 12 and zoom 15, on each theme. Compare each against the build
before this change. A band that draws too much shows as a web, and no assertion can measure that.

## Open decisions

The dark `--water` value is the one item this design does not settle. The owner asked for the light
theme. Raising the dark value is a second change that the measurement argues for. Take it or leave
it before the build starts.
