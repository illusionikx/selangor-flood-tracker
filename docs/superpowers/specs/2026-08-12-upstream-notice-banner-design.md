# An upstream outage notice on the ticker and the alert panel — design

Date: 2026-08-12
Status: approved, ready to plan

## Problem

On 2026-08-12 the national portal stopped serving its water-level tables. It answered every request
with a 320-byte notice page instead. The map lost the authoritative reading for Kuala Lumpur and
Putrajaya. `national.applied` fell from 71 stations to 47.

Nothing on screen said so. The map drew every station, each with the last reading its own feed gave.
A reader saw a normal map.

That is the failure this app must not have. The alert design standard already names it, in the
words of EEMUA: a reader has to be able to tell *no alarms* from *the alarm system is dead*. A quiet map
during an upstream outage says the first and means the second.

The status popover carries `upstreamOk` and `cacheAge` today. That is the right home for a timeout.
It is the wrong home for an outage the source itself has announced, because a reader who is not
already suspicious never opens it.

## What the notice is

The page carries no text. It carries one PNG, at
`/maintenance-files/MaintenancePublicinfobanjir/notifikasi.png`.

The picture holds the message. Translated from the Malay:

> **NOTIS GANGGUAN PERKHIDMATAN SISTEM PUBLIC INFOBANJIR**
>
> We will be back shortly. We greatly appreciate your patience. The PublicinfoBanjir website is
> currently receiving very high traffic, and this may affect your access. Our team is working to
> restore access and to return the service to normal as soon as possible. In the meantime you can
> get important information through the **MyPublicInfoBanjir** app, available on the **App Store**
> and **Google Play Store**. We regret any inconvenience.

It then names four channels: `publicinfobanjir.water.gov.my`, `PublicInfoBanjir` on Facebook,
`JPS_InfoBanjir` on X, and the MyPublicInfoBanjir app on both stores.

Four facts follow from this, and each one shapes the design.

**It is not a maintenance window.** JPS states the cause as high traffic. A flood portal takes its
highest traffic during a flood, so this source is most likely to fail at the moment it matters most.
That is the argument for putting it above the weather warnings.

**It carries no end time.** The app must not invent one.

**It carries no machine-readable text.** The message is pixels. This app writes any wording it shows. The
picture is available only as a link.

**It names where to look instead.** The cry-wolf and PADM literature calls this milling: people seek
confirmation across channels before they act. Outbound links are what milling needs, so the modal
exists to carry them.

## What already exists, and is reused

The MET warning feature shipped this week and built the exact plumbing this needs.

| piece | file | what it does |
|---|---|---|
| `warnCard()` | `js/alerts.js:158` | one card above every station group in `#side` |
| `tk-warn` tiles | `js/ticker.js:55` | warnings lead the strip |
| `[data-warn]` handler | `js/ui.js:1114` | one delegated click, opens `warnBox` |

That code also settled a question this feature otherwise reopens. A MET warning
counts toward **nothing** — not the badge, not the tab title, not the tally glyphs, not the warning
glyph. A warning names a region and a station reading names a place, so the two never share a total.
A notice follows the same rule for a stronger reason. It is not a reading at all.

## Design

### 1. Detection, in `api.php`

`fetchAll()` blanks any status of 400 or above. The notice answers **200**, so its body reaches the
page loop whole.

One function reads it:

```php
noticeOf(string $body): ?string      // a notice id, or null
```

Order matters, because the page loop blanks a rejected body by assigning over it. `pageHasData()`
runs first and answers a question. `noticeOf()` then reads the **raw** body, before the loop clears
it, and only when `pageHasData()` already rejected that body. A healthy table never reaches it.

Recognition is on `Notis Gangguan` inside the `<title>`. Those are the words the agency uses. They are
stable across incidents and absent from every real table. Recognition is **not** on the image path,
because that is a file name JPS can rename without telling anyone.

### 2. One notice, not one per feed

Three national pages carry the same notice right now: `nat-SEL`, `nat-WLH` and `nat-PTJ`. That is one
outage. Keys collapse by notice id, and the surviving entry carries the union of their regions.
Without this the ticker shows the same tile three times.

Page keys map to regions:

| key | region |
|---|---|
| `nat-SEL` | Selangor |
| `nat-WLH` | Kuala Lumpur |
| `nat-PTJ` | Putrajaya |

### 3. Payload

```json
"notices": [{ "id": "publicinfobanjir", "regions": ["Kuala Lumpur", "Putrajaya"] }]
```

Two fields. The title, the sentence and the links live in a `NOTICE` table in `js/config.js`, beside
`ALERT_TITLE` and `HOTLINES`. Three reasons. That is where this app keeps its strings. A payload that
reships the same paragraph every five minutes pays for it every poll. And a new recogniser needs a
server change and a client string in either arrangement, so the split adds no work.

`notices` is an empty array on a healthy poll, so a reader of it needs no special case.

### 4. Client

`warnCard()` generalises to `bannerCard(list, kind)`. Both `state.notices` and `state.warnings` call
it. The panel draws notices, then MET warnings, then the station groups. The ticker orders the same
way, notices first.

`[data-warn]` becomes `[data-banner]`, carrying a kind and an index. One handler serves both. The
modal body switches on the kind: a MET warning prints its valid-from and valid-to, and a notice
prints its regions and its links.

Nothing else moves. The counts, the badge, the tab title and the warning glyph stay station-only.

### 5. What it says

The one line, on the ticker tile and on the panel row:

> JPS PublicInfoBanjir is down. Some water levels may be behind.

62 characters, inside the CAP limit of 160.

The modal:

> **JPS PublicInfoBanjir is down**
>
> JPS says the site is overloaded by high traffic. No end time was given.
>
> Kuala Lumpur and Putrajaya water levels may be behind. Stations still show their last known
> reading.
>
> Where JPS says to look instead:
> MyPublicInfoBanjir on the App Store · MyPublicInfoBanjir on Google Play ·
> PublicInfoBanjir on Facebook · JPS\_InfoBanjir on X · publicinfobanjir.water.gov.my ·
> Read the notice from JPS

The client builds the regions sentence from `regions`, so it states what the outage actually hit.

`Read the notice from JPS` points at the PNG itself,
`/maintenance-files/MaintenancePublicinfobanjir/notifikasi.png`. The glyph for a notice is a new rule
in `css/icons.css`, and the plan picks which one.

Every link is an outbound `<a href>`. The browser fetches nothing new, so the claim in the About pane
about third parties stays true and needs no proxy.

The wording follows the three message rules in `CLAUDE.md`. Sentence case. No hedge. None of the internal
vocabulary of this app — the words `page cache`, `stale`, `upstream` and `payload` appear nowhere.

### 6. Colour and glyph

It takes the MET warning treatment, and it must **not** take a traffic-light hue. A dead source is
not a status, and this app reserves the four status colors. A reader tells a notice from a weather warning
by its own glyph in `css/icons.css`, never by color.

### 7. Test mode

`js/test.js` gets a knob that fakes a notice. `CLAUDE.md` requires this of anything that alerts,
because a feature nobody can see is a feature nobody reviews. This one is otherwise visible only
while JPS is down.

## Against the alert design standard

| rule | how it lands |
|---|---|
| ISA-18.2 — an alarm requires a response | The response is to check another channel. The modal carries them. |
| ISA-18.2 — 10 in 10 minutes is a flood | It counts toward no total, so it cannot contribute to one. |
| ISA-18.2 — priority must not be flat | It sits above the weather warnings, which sit above the stations. |
| CAP — certainty | Observed. JPS states it. This app never infers it from a timeout. |
| CAP — severity is not urgency | It claims neither. It reports a condition and names its scope. |
| CAP — headline at most 160 characters | 62. |
| CAP — alerts can be withdrawn | It leaves the payload the poll the tables parse again. |
| Cry-wolf | It fires only on positive identification. A blip shows nothing. |
| PADM — who says so | It names JPS, and links to JPS. |

Two open gaps in the standard stay open, and this work touches neither. Shelving still has
no time limit. `$mark` still falls back through three severities.

`CLAUDE.md` warns against adding a fifth alert surface. This adds none. It is a new tenant of the two
surfaces that already exist.

## Deliberately not built

- **No duration.** "Down for 20 minutes" needs a first-seen time, and `pageRow()` moves `ts` on every
  attempt. One sentence does not earn a schema change.
- **No embed of the notice image, and no proxy for it.** It is 1280 by 720 pixels of Malay text. No
  screen reader reads it, and a phone draws it too small. A link serves the reader who wants it.
- **No rule for a silent hang.** A timeout is not a statement. It stays in the status popover.
- **No toast.** An interruption is for news that needs action now.
- **No all-clear.** MET warnings set that precedent, and a source coming back is not an event.
- **No second recogniser.** Only the national portal publishes a notice today. If the KL host or MET
  starts doing the same, each one needs its own evidence before it gets a rule.

## Verification

- `php api.php --selftest` gains assertions on `noticeOf()`: the notice body returns its id, a real
  table returns null, an empty body returns null, and a page that merely mentions the words in its
  text does not match.
- `php -l` on both PHP files, and `node --check` on the changed modules.
- The outage is live today, so the whole path runs against real data once. Test mode covers it
  after that.
- Confirm the badge, the tab title and the warning glyph do not move when a notice is on screen.

## What breaks it

JPS changing the notice title. `noticeOf()` returns null, the banner never appears, and the feed
still reports itself through `sources.stale`. The failure is silence rather than a wrong claim, which
is the correct direction for this feature to fail in.
