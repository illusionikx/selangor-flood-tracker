# JPS Notice Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the JPS flood alert and the JPS MET mirror as rows in the warning surface that already exists. Add a link to the JPS media statements. Give a dead notice feed a way to announce itself.

**Architecture:** Five new page-cache keys feed three new pure parsers in `sources.php`. All three emit the row shape `metWarnings()` already emits, plus `kind` and `src`. One merge function concatenates, sorts and de-duplicates them into `warnings[]`. A new `sources.old` array names a source that answered with nothing recent. The client reads one array and picks a glyph from `kind`.

**Tech Stack:** PHP 8 with curl and PDO SQLite. ES modules with no build step. No test framework — `php api.php --selftest` is the offline harness and every pure function lands its assertions there.

**Spec:** [docs/superpowers/specs/2026-08-17-jps-notice-feeds-design.md](docs/superpowers/specs/2026-08-17-jps-notice-feeds-design.md)

## Global Constraints

- **Prose in files follows Simplified Technical English.** Use active voice and one instruction per sentence. Keep every sentence under 20 words. Use no semicolons and no contractions. Use American spelling. Check every file you write with `python "C:/Users/illus/.claude/ste-lint.py" < FILE` and aim for 0. The checker counts a list item as a sentence, so a long list raises a false `long_paragraph`. Ignore that one only.
- **No count moves.** Not the alert number, the icon badge, the app bar glyph, the toast or the window title. A notice is a claim JPS makes about an area.
- **The colour language keeps the traffic-light ramp for status.** A notice uses `--k-weather` or a new kind token, never `--s-alert`.
- **No new dependency, no build step, no CDN.** The browser contacts this origin and CARTO alone.
- **`session_write_close()` stays the first statement in `api.php`.** Add nothing above it.
- **Bump `?v=` on every `css/*.css` link you touch in `index.html`.**
- **All times are 24-hour and Malaysian.** `sources.php` runs pinned to `Asia/Kuala_Lumpur`.
- **Both new parsers emit `from` and `to` as ISO `Y-m-d\TH:i:s`.** `warnWhen()` in `js/ui.js:1189` matches `^(\d{4})-(\d\d)-(\d\d)T(\d\d:\d\d)` and falls back to the raw string. The merge sort is a `strcmp` over that field.
- **A scraper fails silently by design.** Every new parser that finds nothing must be distinguishable from one whose upstream moved.

## File Structure

| file | change | responsibility |
|---|---|---|
| `sources.php` | modify | `jsonLoose()`, `hereNames()`, `hereParts()`, `jpsMetWarnings()`, `floodAlerts()`, `mergeNotices()`, `noticeNewest()`, `noticeOld()`, `beatDead()`, and the five new URLs in `jpsUrls()` |
| `api.php` | modify | new TTLs, `pageHasData()` arms, the `sources.old` assembly, and the `--selftest` assertions for every function above |
| `watch.php` | modify | one line for `sources.old` |
| `js/config.js` | modify | the words for a flood notice |
| `js/alerts.js` | modify | `BANNER` gains a flood shell, `bannerCard()` picks per row |
| `js/ticker.js` | modify | the tile picks its glyph from `kind` |
| `js/ui.js` | modify | the modal head reads `kind` |
| `index.html` | modify | one link to the JPS media statement page |
| `docs/FEATURES.md` | modify | the narrative entry and the alert standard note |
| `CLAUDE.md` | modify | the new gotchas, the file table and the Verify block |

Every parser takes a string and an integer and touches nothing else. That is deliberate. `php api.php --selftest` then runs offline in milliseconds, and no assertion in this plan costs a request to JPS.

---

### Task 1: `jsonLoose()` — the JPS MET files are not valid JSON

**Files:**
- Modify: `sources.php` (add near the top of the MET warnings section, above `WARN_DROP` at line 616)
- Modify: `api.php` (assertions in the `--selftest` block, which starts at line 1366)

**Interfaces:**
- Produces: `jsonLoose(string $s): ?array` — the decoded array, or `null` when the text does not decode to an array. Tasks 3, 5 and 6 call it.

- [ ] **Step 1: Write the failing assertions**

Add to the `--selftest` block in `api.php`, after the existing `pageHasData` assertions:

```php
    /* --- jsonLoose(): JPS writes raw control characters inside JSON strings --- */
    $ok('valid JSON decodes',            jsonLoose('[{"a":1}]') === [['a' => 1]]);
    $ok('an empty list is an empty list', jsonLoose('[]') === []);
    $ok('a raw newline inside a string',  jsonLoose("[{\"a\":\"x\ny\"}]") === [['a' => "x\ny"]]);
    $ok('a raw tab inside a string',      jsonLoose("[{\"a\":\"x\ty\"}]") === [['a' => "x\ty"]]);
    $ok('a newline outside a string',     jsonLoose("[\n {\"a\":1}\n]") === [['a' => 1]]);
    $ok('an escaped quote survives',      jsonLoose('[{"a":"x\"y"}]') === [['a' => 'x"y']]);
    // A string ending in an escaped backslash. Without the escape tracking the parser reads the
    // closing quote as an opening one and every following newline goes unescaped.
    $ok('a trailing escaped backslash',   jsonLoose('[{"a":"x\\\\"},{"b":2}]') === [['a' => 'x\\'], ['b' => 2]]);
    $ok('an HTML notice is not an array', jsonLoose('<html>Notis Gangguan</html>') === null);
    $ok('an empty body is not an array',  jsonLoose('') === null);
    // The failure this exists for. A null decode and an empty feed look identical to a caller that
    // tests is_array(), which is why the return separates them.
    $ok('a bare scalar is not an array',  jsonLoose('"just a string"') === null);
```

- [ ] **Step 2: Run to verify it fails**

Run: `php api.php --selftest`
Expected: FAIL with `Call to undefined function jsonLoose()`

- [ ] **Step 3: Write the implementation**

Add to `sources.php`, immediately above the `/* --- MET Malaysia warnings --- */` banner comment at line 612:

```php
/* --- lenient JSON ---------------------------------------------------------------------------- */

/* JPS writes raw newline characters inside JSON string values, so `json_decode()` returns null on
   `met_gelora.json`. The failure is silent, because a null decode and an empty feed look the same
   to a caller that tests `is_array()`. So this returns null for one and an empty array for the
   other, and the liveness rule in api.php reads that difference.
 *
 * The scan tracks whether the cursor sits inside a string literal and honours the backslash escape.
 * It escapes any control character it finds inside a string. It changes nothing outside one.
 *
 * Measured 2026-08-17 against all five JPS MET files. Four decode the same either way.
 * `met_gelora.json` goes from a parse failure to 2 rows. */
function jsonLoose(string $s): ?array {
    $out = '';
    $in  = false;
    $esc = false;
    $n   = strlen($s);
    for ($i = 0; $i < $n; $i++) {
        $c = $s[$i];
        if ($esc)                { $out .= $c; $esc = false; continue; }
        if ($c === '\\' && $in)  { $out .= $c; $esc = true;  continue; }
        if ($c === '"')          { $in = !$in; $out .= $c;   continue; }
        if ($in && ord($c) < 0x20) {
            $out .= match ($c) {
                "\n"    => '\\n',
                "\r"    => '\\r',
                "\t"    => '\\t',
                default => sprintf('\\u%04x', ord($c)),
            };
            continue;
        }
        $out .= $c;
    }
    $j = json_decode($out, true);
    return is_array($j) ? $j : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `php api.php --selftest`
Expected: every new line reads `ok`

- [ ] **Step 5: Check it against the live files**

Run:

```bash
php -r 'require "sources.php";
foreach (["met_rain22","met_thunderain2","met_cyclone","met_earthquake","met_gelora"] as $f) {
  $u = "https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/$f.json";
  $c = curl_init($u); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
  $b = curl_exec($c); curl_close($c);
  printf("%-18s plain=%-8s loose=%s\n", $f,
    is_array(json_decode($b,true)) ? count(json_decode($b,true))." rows" : "NULL",
    ($j=jsonLoose($b)) === null ? "NULL" : count($j)." rows"); }'
```

Expected: every file reads a row count under `loose`. `met_gelora` reads `NULL` under `plain` and a row count under `loose`. A `NULL` under `loose` on any file is a failure.

- [ ] **Step 6: Commit**

```bash
git add sources.php api.php
git commit -m "Read the JPS MET files, which are not valid JSON

JPS writes raw newline characters inside JSON string values. json_decode()
returns null on met_gelora.json, and a null decode looks the same as an
empty feed to a caller that tests is_array().

jsonLoose() escapes a control character inside a string literal and returns
null only when the text is not an array at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Paragraph-level geography, which repairs the existing path too

**Files:**
- Modify: `sources.php:668-742` (`metWarnings()`, and two new functions above it)
- Modify: `api.php` (`--selftest` assertions)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `hereNames(string $text, bool $sea): bool` and `hereParts(string $text, bool $sea): string`. Tasks 3 and 4 call both.

**Why this task exists.** `met_gelora.json` carries a national bulletin in one row. Measured 2026-08-17: 1,795 characters across 16 lines. It names Sarawak, Sabah, Selangor, Perlis, Kedah and Perak together. `WARN_HERE` keeps that row on the word `selangor`. The panel then prints a wall of text that is mostly about Borneo.

**The gate does not change.** A row still qualifies on its combined English and Malay text. MET writes some rows in one language only. Only the displayed text narrows, and it falls back to the whole text when narrowing finds nothing. That keeps every row `metWarnings()` keeps today.

- [ ] **Step 1: Write the failing assertions**

Add to the `--selftest` block in `api.php`, after the Task 1 assertions:

```php
    /* --- hereNames() / hereParts(): a bulletin names six regions and one of them is ours --- */
    $ok('a land row naming Selangor',    hereNames('Heavy rain over Selangor', false) === true);
    $ok('a land row naming nowhere here', hereNames('Heavy rain over Sarawak', false) === false);
    $ok('a marine row naming the straits',
        hereNames('rough seas over the Straits of Melaka', true) === true);
    // The far stretch is CUT before the keep test reads it, so a row naming only the northern
    // straits has nothing left to match. See CLAUDE.md.
    $ok('a marine row naming the far straits',
        hereNames('rough seas over the Northern Straits of Melaka', true) === false);
    $ok('a marine row naming both stretches',
        hereNames('Northern Straits of Melaka and Central Straits of Melaka', true) === true);
    // The straits are open to a marine row only. A land row must name a place.
    $ok('a land row may not use the straits',
        hereNames('rough seas over the Straits of Melaka', false) === false);

    $BULLETIN = "Thunderstorms are expected over Sarawak until noon.\n"
              . "Heavy rain is expected over Selangor until 12:00 PM.\n"
              . "Strong winds are expected over Sabah until noon.";
    $ok('a bulletin keeps only the part naming here',
        hereParts($BULLETIN, false) === 'Heavy rain is expected over Selangor until 12:00 PM.');
    $ok('a bulletin naming nowhere here narrows to nothing',
        hereParts("Thunderstorms over Sarawak.\nStrong winds over Sabah.", false) === '');
    $ok('a single sentence naming here survives whole',
        hereParts('Heavy rain over Kuala Lumpur.', false) === 'Heavy rain over Kuala Lumpur.');
    $ok('two parts naming here both survive',
        hereParts("Rain over Selangor.\nWind over Putrajaya.", false)
        === 'Rain over Selangor. Wind over Putrajaya.');
    // A sentence split must not fire on a decimal or an abbreviation mid-sentence.
    $ok('a sentence splits on the period and the newline alone',
        hereParts('Waves reach 4.5 metres over Selangor.', false)
        === 'Waves reach 4.5 metres over Selangor.');

    /* metWarnings() must keep every row it kept before. A row qualifying on its Malay half alone
       narrows to nothing in English, and the whole English text stands. */
    $MY = json_encode([[
        'heading_en' => 'Warning on Thunderstorms',
        'text_en'    => 'Thunderstorms are expected until noon.',
        'text_bm'    => 'Ribut petir dijangka di negeri Selangor sehingga tengah hari.',
        'valid_from' => date('Y-m-d\TH:i:s', time() - 60),
        'valid_to'   => date('Y-m-d\TH:i:s', time() + 3600),
    ]]);
    $r = metWarnings($MY, time());
    $ok('a row qualifying on Malay text is kept',  count($r) === 1);
    $ok('and it shows its whole English text',
        ($r[0]['text'] ?? '') === 'Thunderstorms are expected until noon.');
    $ok('metWarnings stamps kind and src',
        ($r[0]['kind'] ?? '') === 'weather' && ($r[0]['src'] ?? '') === 'met');
```

- [ ] **Step 2: Run to verify it fails**

Run: `php api.php --selftest`
Expected: FAIL with `Call to undefined function hereNames()`

- [ ] **Step 3: Write the two functions**

Add to `sources.php` immediately above `function metWarnings(` at line 668:

```php
/* Does this text name somewhere this map covers?
 *
 * A marine text has a second way in: our stretch of the Straits of Melaka, with the far stretch cut
 * out before the keep test reads it. Cutting rather than testing is what keeps a text naming two
 * stretches — strip the northern mention from "Northern Straits of Melaka and Central Straits of
 * Melaka" and the central one still answers. See CLAUDE.md for the row this rule was written for.
 *
 * The straits are open to a marine text alone. A land text must name a state or a district. */
function hereNames(string $text, bool $sea): bool {
    $where = strtolower($text);
    foreach (WARN_HERE as $k) if (str_contains($where, $k)) return true;
    if (!$sea) return false;
    foreach (WARN_SEA_FAR as $f) $where = str_replace($f, '', $where);
    foreach (WARN_SEA_KEEP as $k) if (str_contains($where, $k)) return true;
    return false;
}

/* Keep only the parts of a bulletin that name somewhere this map covers.
 *
 * MET writes one warning across several regions in one row. `met_gelora.json` carried 1,795
 * characters across 16 lines on 2026-08-17, naming Sarawak, Sabah, Selangor, Perlis, Kedah and
 * Perak together. A row-level place test keeps that row on one word, and the panel then prints a
 * wall of text that is mostly about Borneo. On the measured row this returns a single
 * 203-character sentence.
 *
 * The split runs on a newline or on a period followed by a space. A period inside a number carries
 * no space after it, so "4.5 metres" stays whole.
 *
 * An empty return means the text names nowhere here. The caller decides what that means: the gate
 * is a separate test on the combined English and Malay text, and this narrows the English alone. */
function hereParts(string $text, bool $sea): string {
    $keep = [];
    foreach (preg_split('/\n+|(?<=\.)\s+/', $text) as $part) {
        $p = trim($part);
        if ($p !== '' && hereNames($p, $sea)) $keep[] = $p;
    }
    return implode(' ', $keep);
}
```

- [ ] **Step 4: Rewrite the place test inside `metWarnings()`**

In `sources.php`, replace this block inside `metWarnings()`:

```php
        $near = false;
        foreach (WARN_HERE as $k) if (str_contains($where, $k)) { $near = true; break; }
        if (!$near && $sea) {
            foreach (WARN_SEA_FAR as $f) $where = str_replace($f, '', $where);
            foreach (WARN_SEA_KEEP as $k) if (str_contains($where, $k)) { $near = true; break; }
        }
        if (!$near) continue;
```

with:

```php
        /* The gate reads the combined English and Malay text, because MET writes some rows in one
           language only. That is unchanged, so this keeps every row it kept before. */
        if (!hereNames($where, $sea)) continue;

        /* The displayed text narrows to the parts naming somewhere this map covers. It falls back
           to the whole English text, because a row can qualify on its Malay half alone and then
           have nothing to narrow. */
        $narrow = hereParts($text, $sea);
        if ($narrow !== '') $text = $narrow;
```

- [ ] **Step 5: Stamp `kind` and `src` on the emitted row**

In `sources.php`, replace the `$out[] = [...]` inside `metWarnings()`:

```php
        $out[] = ['title' => $title, 'text' => $text,
                  'from' => (string)$r['valid_from'], 'to' => (string)$r['valid_to'],
                  'fresh' => ($now - $from) < WARN_FRESH,
                  // One array carries every notice, and these two separate them. `weather` renders
                  // as this row always has. See mergeNotices().
                  'kind' => 'weather', 'src' => 'met'];
```

- [ ] **Step 6: Run to verify it passes**

Run: `php api.php --selftest`
Expected: every new line reads `ok`

- [ ] **Step 7: Confirm no existing row was lost**

Run:

```bash
curl -sk https://flood-exp.test/api.php?force=1 | php -r '$p=json_decode(stream_get_contents(STDIN),true);
echo "metwarn: ",json_encode($p["sources"]["metwarn"]),"\n";
foreach($p["warnings"] as $w) printf("  %-6s %-4s %s\n    %s\n",$w["kind"],$w["src"],substr($w["title"],0,60),substr($w["text"],0,140));'
```

Expected: `metwarn.parsed` reads the same number it read before this task. On the payload measured for the spec that is `0`, and the warnings list is empty.

- [ ] **Step 8: Commit**

```bash
git add sources.php api.php
git commit -m "Keep only the part of a bulletin that names somewhere this map covers

MET writes one warning across several regions in one row. met_gelora.json
carried 1,795 characters across 16 lines on 2026-08-17, naming Sarawak,
Sabah, Selangor, Perlis, Kedah and Perak together. A row-level place test
keeps that row on one word, and the panel then prints a wall of text that
is mostly about Borneo.

hereParts() narrows the displayed text. The gate is unchanged, so this
keeps every row metWarnings() kept before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `jpsMetWarnings()` — the fresher mirror

**Files:**
- Modify: `sources.php` (below `metWarnings()`)
- Modify: `api.php` (`--selftest` assertions)

**Interfaces:**
- Consumes: `jsonLoose()` from Task 1. `hereNames()` and `hereParts()` from Task 2. `WARN_DROP`, `WARN_SEA`, `WARN_WATER` and `WARN_FRESH`, which already exist.
- Produces: `jpsMetWarnings(string $json, int $now): array` — rows shaped `['title','text','from','to','fresh','kind','src']`, with `kind` `weather` and `src` `jps`. Task 5 merges them.

- [ ] **Step 1: Write the failing assertions**

Add to the `--selftest` block in `api.php`, after the Task 2 assertions:

```php
    /* --- jpsMetWarnings(): the JPS mirror of the MET bulletins --- */
    $jm = fn(array $r) => json_encode([$r]);
    $liveFrom = date('d-m-Y H:i:s', time() - 3600);
    $liveTo   = date('d-m-Y H:i:s', time() + 3600);
    $row = fn(array $o = []) => $jm($o + [
        'Heading_EN' => 'THUNDERSTORMS WARNING',
        'Msg_EN'     => 'Heavy rain is expected over Selangor until noon.',
        'Msg_MY'     => 'Hujan lebat dijangka di Selangor.',
        'Valid_from' => $liveFrom,
        'Valid_to'   => $liveTo,
    ]);

    $w = jpsMetWarnings($row(), time());
    $ok('a live JPS row survives',       count($w) === 1);
    $ok('it carries the JPS heading',    ($w[0]['title'] ?? '') === 'THUNDERSTORMS WARNING');
    $ok('it is stamped weather and jps',
        ($w[0]['kind'] ?? '') === 'weather' && ($w[0]['src'] ?? '') === 'jps');
    // warnWhen() in js/ui.js tests the ISO shape and prints the raw string otherwise.
    // A JPS stamp printed verbatim puts two date formats in one modal. The merge sort is a strcmp
    // over this field, so a stamp outside that shape also misorders every same-day row.
    $ok('the stamp is normalized to ISO',
        (bool)preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/', $w[0]['from'] ?? ''));
    $ok('and so is the end stamp',
        (bool)preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/', $w[0]['to'] ?? ''));
    $ok('a fresh row is marked fresh',   ($w[0]['fresh'] ?? null) === true);

    $ok('a row outside its window drops',
        jpsMetWarnings($row(['Valid_from' => date('d-m-Y H:i:s', time() - 7200),
                             'Valid_to'   => date('d-m-Y H:i:s', time() - 3600)]), time()) === []);
    $ok('a row naming nowhere here drops',
        jpsMetWarnings($row(['Msg_EN' => 'Heavy rain over Sarawak.', 'Msg_MY' => 'Hujan di Sarawak.']),
                       time()) === []);
    // WARN_DROP already holds these. A seismic row and an empty advisory say nothing about weather
    // here, and met_cyclone.json publishes "No Advisory" as its permanent heartbeat row.
    $ok('a seismic row drops',
        jpsMetWarnings($row(['Heading_EN' => 'Moderate Earthquake in Flores Region']), time()) === []);
    $ok('an empty advisory drops',
        jpsMetWarnings($row(['Heading_EN' => 'No Advisory']), time()) === []);

    /* The row this whole task exists for. met_gelora.json publishes one national bulletin naming
       six regions, and only one of them is ours. */
    $GEL = $jm(['Heading_EN' => 'SECOND CATEGORY WARNING ON STRONG WINDS AND ROUGH SEAS',
                'Msg_EN'     => "SECTION A: FOR MALAYSIAN WATERS\n"
                              . "1) THUNDERSTORMS WARNING\n"
                              . "Thunderstorms are expected over the waters of Western Sarawak, "
                              . "Western Sabah, Selangor and Perak until 12:00 PM.\n"
                              . "2) This condition may cause rough seas off Sarawak.",
                'Msg_MY'     => '',
                'Valid_from' => $liveFrom, 'Valid_to' => $liveTo]);
    $g = jpsMetWarnings($GEL, time());
    $ok('the gelora bulletin survives',  count($g) === 1);
    $ok('and it keeps only the part naming here',
        str_contains($g[0]['text'] ?? '', 'Selangor')
        && !str_contains($g[0]['text'] ?? '', 'SECTION A')
        && !str_contains($g[0]['text'] ?? '', 'rough seas off Sarawak'));

    $ok('an unreadable body yields nothing', jpsMetWarnings('<html>Notis</html>', time()) === []);
    $ok('an empty feed yields nothing',      jpsMetWarnings('[]', time()) === []);
```

- [ ] **Step 2: Run to verify it fails**

Run: `php api.php --selftest`
Expected: FAIL with `Call to undefined function jpsMetWarnings()`

- [ ] **Step 3: Write the implementation**

Add to `sources.php`, directly below the closing brace of `metWarnings()`:

```php
/* --- the JPS mirror of the MET bulletins ----------------------------------------------------- */

/* `publicinfobanjir.water.gov.my/ramalan/met-alert/` reads five static JSON files. They mirror the
 * same MET bulletins `api.data.gov.my/weather/warning` carries, and they mirror them fresher.
 *
 * Measured 2026-08-17. Every data.gov.my row carried an issue stamp of 2026-08-10. This mirror
 * answered with rows issued that morning. Two of them named the waters of Selangor.
 *
 * The row shape belongs to JPS. Every rule below is the rule `metWarnings()` already applies,
 * reading a differently named field.
 *
 * This app does not fetch `met_earthquake.json`. `WARN_DROP` holds `earthquake` and `tsunami`, so
 * every row of that file drops. Fetching it spends a request to discard the answer. */
function jpsMetWarnings(string $json, int $now): array {
    $rows = jsonLoose($json);
    if ($rows === null) return [];

    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;

        /* `Heading_EN` is the heading for this row. `Title_EN` names the bulletin kind, and it
           repeats across rows of different severities. So `Title_EN` is the fallback and never the
           first choice. `metWarnings()` already states this rule about `warning_issue.title_en`. */
        $title = trim((string)($r['Heading_EN'] ?? ''));
        if ($title === '') $title = trim((string)($r['Title_EN'] ?? ''));
        $text  = trim((string)($r['Msg_EN'] ?? ''));
        $bm    = trim((string)($r['Msg_MY'] ?? ''));
        if ($title === '' && $text === '') continue;

        /* JPS stamps `17-08-2026 08:00:00`. `strtotime()` reads that correctly, because PHP assumes
           the European d-m-y order when the separator is a dash. Measured 2026-08-17. */
        $from = strtotime((string)($r['Valid_from'] ?? ''));
        $to   = strtotime((string)($r['Valid_to'] ?? ''));
        if (!$from || !$to || $now < $from || $now > $to) continue;

        $hay = strtolower($title);
        foreach (WARN_DROP as $bad) if (str_contains($hay, $bad)) continue 2;

        /* Is this row about water? The heading is not enough on its own. MET files a storm over the
           sea as "Warning on Thunderstorms", the same words it uses over land. */
        $where = strtolower($text . ' ' . $bm);
        $sea = false;
        foreach (WARN_SEA as $s) if (str_contains($hay, $s)) { $sea = true; break; }
        if (!$sea) foreach (WARN_WATER as $s) if (str_contains($where, $s)) { $sea = true; break; }

        if (!hereNames($where, $sea)) continue;
        $narrow = hereParts($text, $sea);
        if ($narrow !== '') $text = $narrow;

        /* The ISO shape, because `warnWhen()` in js/ui.js tests for it and prints the raw string
           otherwise. The merge sort is a strcmp over this field for the same reason. */
        $out[] = ['title' => $title, 'text' => $text,
                  'from' => date('Y-m-d\TH:i:s', $from), 'to' => date('Y-m-d\TH:i:s', $to),
                  'fresh' => ($now - $from) < WARN_FRESH,
                  'kind' => 'weather', 'src' => 'jps'];
    }
    return $out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `php api.php --selftest`
Expected: every new line reads `ok`

- [ ] **Step 5: Check it against the live files**

Run:

```bash
php -r 'require "sources.php"; date_default_timezone_set("Asia/Kuala_Lumpur");
foreach (["met_rain22","met_thunderain2","met_gelora"] as $f) {
  $u = "https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/$f.json";
  $c = curl_init($u); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
  $b = curl_exec($c); curl_close($c);
  $w = jpsMetWarnings($b, time());
  printf("%-18s %d raw -> %d kept\n", $f, count(jsonLoose($b) ?: []), count($w));
  foreach ($w as $x) printf("    %s\n    %s\n", $x["title"], substr($x["text"],0,160)); }'
```

Expected: no row whose text names only Sarawak, Sabah or Thailand. A kept `met_gelora` row states one sentence about Selangor rather than the whole bulletin.

- [ ] **Step 6: Commit**

```bash
git add sources.php api.php
git commit -m "Read the JPS mirror of the MET bulletins

api.data.gov.my/weather/warning sat seven days without a new row on
2026-08-17. Every one of its 7 rows carried an issue stamp of 2026-08-10.
The JPS mirror answered with rows issued that morning, and two of them
named the waters of Selangor.

Stamps are normalized to ISO. warnWhen() in js/ui.js matches that shape
and prints the raw string otherwise, and the merge sort is a strcmp over
the same field.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `floodAlerts()` — the one true flood alarm

**Files:**
- Modify: `sources.php` (below `jpsMetWarnings()`)
- Modify: `api.php` (`--selftest` assertions)

**Interfaces:**
- Consumes: `hereNames()` from Task 2. `WARN_FRESH`, which already exists.
- Produces: `floodAlerts(string $json, int $now): array` — the same seven-field row, with `kind` `flood` and `src` `jps`. Task 5 merges them.

**Read this before you start.** This parser has never seen a row. `getdisse.php` answered `[]` on every fetch during the design. The field names come from the consumer JavaScript on the JPS page, which the spec quotes. That is evidence and not a guess, and it is still untested against real data. Do not widen the parser to handle shapes you have not seen.

- [ ] **Step 1: Write the failing assertions**

Add to the `--selftest` block in `api.php`, after the Task 3 assertions:

```php
    /* --- floodAlerts(): the JPS flood forecast --- */
    $fa = fn(array $o = []) => json_encode([$o + [
        'NotificationTypeCode' => 'NT_2D',
        'State'                => 'SELANGOR',
        'POINew'               => 'Sungai Klang di Jambatan Sulaiman!Sungai Gombak',
        'POIType'              => 'FP',
        'MessageDT'            => date('d-m-Y H:i:s', time() - 1800),
        'EstimatedDT'          => date('d-m-Y H:i:s', time() - 1800),
        'EstimatedEndDT'       => date('d-m-Y H:i:s', time() + 7200),
        'hide'                 => '0',
    ]]);

    $f = floodAlerts($fa(), time());
    $ok('a live flood alert survives',   count($f) === 1);
    $ok('it is stamped flood and jps',
        ($f[0]['kind'] ?? '') === 'flood' && ($f[0]['src'] ?? '') === 'jps');
    $ok('the title names the alert type', ($f[0]['title'] ?? '') === 'Flood alert · Final');
    // POINew is a `!`-delimited list. A reader needs the places, not the delimiter.
    $ok('the text lists the points',
        ($f[0]['text'] ?? '') === 'Sungai Klang di Jambatan Sulaiman, Sungai Gombak (SELANGOR)');
    $ok('the stamp is normalized to ISO',
        (bool)preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/', $f[0]['from'] ?? ''));

    $ok('an early alert survives',   count(floodAlerts($fa(['NotificationTypeCode' => 'NT_7D']), time())) === 1);
    $ok('an update survives',        count(floodAlerts($fa(['NotificationTypeCode' => 'NT_UP']), time())) === 1);
    $ok('a siren notification survives',
        count(floodAlerts($fa(['NotificationTypeCode' => 'NT_DF']), time())) === 1);

    /* The three withdrawals drop. Every surface renders a notice only inside its validity window,
       so an alert that ended leaves the panel without help. A withdrawal row restates that, and it
       appears alone whenever the alert it withdraws expired between two polls. */
    $ok('a termination drops',  floodAlerts($fa(['NotificationTypeCode' => 'NT_TM']), time()) === []);
    $ok('a recall drops',       floodAlerts($fa(['NotificationTypeCode' => 'NT_RC']), time()) === []);
    $ok('a no-flood drops',     floodAlerts($fa(['NotificationTypeCode' => 'NT_NF']), time()) === []);
    $ok('an unknown code drops', floodAlerts($fa(['NotificationTypeCode' => 'NT_XX']), time()) === []);

    // JPS operators hide a message through their own update_showhidefloodalert.php endpoint. That
    // flag is a decision the source made, and this app does not overrule a source.
    $ok('a hidden row drops',   floodAlerts($fa(['hide' => '1']), time()) === []);

    $ok('a row outside its window drops',
        floodAlerts($fa(['EstimatedDT'    => date('d-m-Y H:i:s', time() - 7200),
                         'EstimatedEndDT' => date('d-m-Y H:i:s', time() - 3600)]), time()) === []);
    // Nothing can retire a row with no end, and every surface here renders inside a window.
    $ok('a row with no end drops',  floodAlerts($fa(['EstimatedEndDT' => '']), time()) === []);
    $ok('a row for another state drops',
        floodAlerts($fa(['State' => 'SARAWAK', 'POINew' => 'Sungai Rajang']), time()) === []);
    // The state alone can carry a row. A point list this app cannot read is not a reason to drop it.
    $ok('the state alone can carry a row',
        count(floodAlerts($fa(['POINew' => '']), time())) === 1);
    $ok('and the text is then the state',
        (floodAlerts($fa(['POINew' => '']), time())[0]['text'] ?? '') === 'SELANGOR');

    $ok('an unreadable body yields nothing', floodAlerts('<html>Notis</html>', time()) === []);
    $ok('an empty feed yields nothing',      floodAlerts('[]', time()) === []);
```

- [ ] **Step 2: Run to verify it fails**

Run: `php api.php --selftest`
Expected: FAIL with `Call to undefined function floodAlerts()`

- [ ] **Step 3: Write the implementation**

Add to `sources.php`, directly below the closing brace of `jpsMetWarnings()`:

```php
/* --- the JPS flood alert --------------------------------------------------------------------- */

/* The notification types `getdisse.php` publishes, and the word each one gets on screen.
 *
 * The three withdrawals are absent on purpose. `NT_TM` Termination, `NT_RC` Recall and `NT_NF` No
 * Flood all cancel an earlier alert.
 *
 * Every surface here renders a notice only inside its validity window. An alert that ended leaves
 * the panel without help. A withdrawal row restates that. It also appears alone whenever the alert
 * it withdraws expired between two polls. */
const FLOOD_KEEP = [
    'NT_7D'  => 'Early',
    'NT_2D'  => 'Final',
    'NT_UP'  => 'Update',
    'NT_DF'  => 'Siren',
    'NT_MET' => 'Meteorological',
];

/* The JPS flood forecast, from `publicinfobanjir.water.gov.my/ramalan/amaran-banjir/`.
 *
 * This is the only true flood alarm among the three notice feeds. It carries a validity window, an
 * update type and a withdrawal path. That is what the alert design standard asks an alert to have.
 *
 * THIS PARSER HAS NEVER SEEN A ROW. `getdisse.php` answered `[]` on every fetch during the design.
 * The field names come from the consumer JavaScript on the JPS page.
 *
 * That is evidence and not a guess, and nobody has tested it against real data. The first non-empty
 * response is the moment to check it by hand. Do not widen it to handle a shape nobody has seen.
 *
 * The row carries map geometry too. Nothing plots it, so nothing here parses it. */
function floodAlerts(string $json, int $now): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];

    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;

        $code = (string)($r['NotificationTypeCode'] ?? '');
        if (!isset(FLOOD_KEEP[$code])) continue;

        /* JPS operators hide a message through their own `update_showhidefloodalert.php` endpoint.
           That flag is a decision the source made, and this app does not overrule a source. */
        if ((string)($r['hide'] ?? '0') === '1') continue;

        /* This needs both ends. Nothing can retire a row with no end, and every surface here
           renders inside a window. `EstimatedDT` is the forecast start and `MessageDT` is when JPS
           issued the message, so the first is the better start and the second is the fallback. */
        $from = strtotime((string)($r['EstimatedDT'] ?? '')) ?: strtotime((string)($r['MessageDT'] ?? ''));
        $to   = strtotime((string)($r['EstimatedEndDT'] ?? ''));
        if (!$from || !$to || $now > $to) continue;

        /* `POINew` is a `!`-delimited list of the points this alert names. A reader needs the
           places, not the delimiter. */
        $pois = array_values(array_filter(array_map('trim', explode('!', (string)($r['POINew'] ?? '')))));
        $state = trim((string)($r['State'] ?? ''));

        /* A flood alert is about land, so the straits test does not apply. The state carries a row
           alone. A point list this app cannot read is no reason to drop a flood forecast. */
        if (!hereNames($state . ' ' . implode(' ', $pois), false)) continue;

        $out[] = ['title' => 'Flood alert · ' . FLOOD_KEEP[$code],
                  'text'  => $pois ? implode(', ', $pois) . ($state !== '' ? " ($state)" : '') : $state,
                  'from'  => date('Y-m-d\TH:i:s', $from),
                  'to'    => date('Y-m-d\TH:i:s', $to),
                  'fresh' => ($now - $from) < WARN_FRESH,
                  'kind'  => 'flood', 'src' => 'jps'];
    }
    return $out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `php api.php --selftest`
Expected: every new line reads `ok`

- [ ] **Step 5: Confirm the live endpoint still answers the shape this expects**

Run:

```bash
curl -sk -m 30 -w '\n[%{http_code} %{size_download}b]\n' \
  "https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/getdisse.php"
```

Expected: `200` and a JSON array. `[]` is the state measured for the spec and is not a failure. Anything that is not JSON means the endpoint moved. Hold the parser until somebody looks.

- [ ] **Step 6: Commit**

```bash
git add sources.php api.php
git commit -m "Read the JPS flood alert

getdisse.php publishes a NotificationTypeCode per row, and the set maps
onto the CAP message types. This keeps Early, Final, Update, Siren and
Meteorological. It drops Termination, Recall and No Flood, because every
surface renders a notice inside its validity window and an alert that
ended leaves the panel without help.

The parser has never seen a row. The field names come from the consumer
JavaScript on the JPS page, and the first non-empty response is the moment
to check it by hand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The merge and the liveness rules

**Files:**
- Modify: `sources.php` (below `floodAlerts()`)
- Modify: `api.php` (`--selftest` assertions, and the `NOTICE_OLD` constant near `MET_WARN_TTL` at line 284)

**Interfaces:**
- Consumes: `jsonLoose()` from Task 1.
- Produces:
  - `mergeNotices(array ...$sets): array` — one sorted, de-duplicated array.
  - `noticeNewest(string $key, string $body): int` — the newest issue stamp in a raw body, 0 where there is none.
  - `noticeOld(string $key, string $body, int $now, int $max): bool`
  - `beatDead(string $body): bool`

  Task 6 calls all four.

- [ ] **Step 1: Add the constant**

In `api.php`, directly below `const MET_WARN_TTL = 900;` at line 285:

```php
/* How long a notice source can sit without a new row before this app calls it old.
 *
 * `api.data.gov.my/weather/warning` sat seven days on 2026-08-17. All 7 rows carried an issue stamp
 * of 2026-08-10, and most expired on 2026-08-13.
 *
 * Every counter stayed quiet. The fetch had succeeded, and the geography filter correctly refused
 * week-old warnings about Phuket.
 *
 * MET issues a bulletin at least daily, so 48 hours is a wide margin over the real cadence. */
const NOTICE_OLD = 172800;   // 48 h
```

- [ ] **Step 2: Write the failing assertions**

Add to the `--selftest` block in `api.php`, after the Task 4 assertions:

```php
    /* --- mergeNotices(): one array, fresher first, duplicates dropped --- */
    $mk = fn(string $t, string $x, string $from, string $src = 'met') =>
        ['title' => $t, 'text' => $x, 'from' => $from, 'to' => $from,
         'fresh' => true, 'kind' => 'weather', 'src' => $src];

    $m = mergeNotices([$mk('B', 'older', '2026-08-10T09:00:00')],
                      [$mk('A', 'newer', '2026-08-17T08:00:00')]);
    $ok('the merge sorts newest first', array_column($m, 'title') === ['A', 'B']);

    /* met_gelora.json held two identical rows on 2026-08-17, so the duplicate test earns its place
       inside one source as well as across two. */
    $ok('an exact duplicate drops',
        count(mergeNotices([$mk('A', 'x', '2026-08-17T08:00:00'),
                            $mk('A', 'x', '2026-08-17T08:00:00')])) === 1);

    /* JPS writes a heading in capitals and data.gov.my does not, so the key lowercases. */
    $ok('a duplicate in another case drops',
        count(mergeNotices([$mk('STORM WARNING', 'x', '2026-08-17T09:00:00', 'jps')],
                           [$mk('Storm Warning', 'x', '2026-08-10T09:00:00')])) === 1);
    $ok('and the fresher copy is the one kept',
        mergeNotices([$mk('STORM WARNING', 'x', '2026-08-17T09:00:00', 'jps')],
                     [$mk('Storm Warning', 'x', '2026-08-10T09:00:00')])[0]['src'] === 'jps');

    // Both sources emit ISO, so a strcmp orders two rows on one day correctly. A JPS stamp left
    // verbatim reads `17-08-2026 08:00:00`, and `T` sorts above a space at that position.
    $ok('two rows on one day sort by time',
        array_column(mergeNotices([$mk('early', 'a', '2026-08-17T08:00:00')],
                                  [$mk('late',  'b', '2026-08-17T09:00:00')]), 'title')
        === ['late', 'early']);
    $ok('an empty merge is an empty array', mergeNotices([], [], []) === []);

    /* --- noticeNewest() / noticeOld(): a page that answered with nothing recent --- */
    $DGM = json_encode([['valid_from' => '2026-08-10T09:00:00'],
                        ['valid_from' => '2026-08-09T09:00:00']]);
    $ok('the newest data.gov.my stamp wins',
        noticeNewest('met-warn', $DGM) === strtotime('2026-08-10T09:00:00'));
    $ok('a JPS body reads its own field',
        noticeNewest('jps-sea', json_encode([['Valid_from' => '17-08-2026 08:00:00']]))
        === strtotime('2026-08-17 08:00:00'));
    $ok('a body with no row has no stamp',   noticeNewest('met-warn', '[]') === 0);
    $ok('an unreadable body has no stamp',   noticeNewest('met-warn', '<html>') === 0);

    $T = strtotime('2026-08-17 10:00:00');
    $ok('a week-old feed is old',   noticeOld('met-warn', $DGM, $T, NOTICE_OLD) === true);
    $ok('a feed from this hour is not old',
        noticeOld('jps-sea', json_encode([['Valid_from' => '17-08-2026 08:00:00']]), $T, NOTICE_OLD) === false);
    /* Zero rows is NOT old. A calm day is the ordinary state of a warning feed, and an alarm on
       quiet is the cry-wolf failure the alert design standard rejects. The jps-beat heartbeat
       covers the empty case instead. */
    $ok('an empty feed is not old',          noticeOld('jps-rain', '[]', $T, NOTICE_OLD) === false);
    $ok('an unreadable feed is not old here', noticeOld('jps-rain', '<html>', $T, NOTICE_OLD) === false);

    /* --- beatDead(): the one feed that always carries a row --- */
    $ok('a heartbeat row is alive',
        beatDead(json_encode([['Heading_EN' => 'No Advisory']])) === false);
    $ok('an empty heartbeat is dead',      beatDead('[]') === true);
    $ok('an unreadable heartbeat is dead', beatDead('<html>Notis</html>') === true);
```

- [ ] **Step 3: Run to verify it fails**

Run: `php api.php --selftest`
Expected: FAIL with `Call to undefined function mergeNotices()`

- [ ] **Step 4: Write the implementation**

Add to `sources.php`, directly below the closing brace of `floodAlerts()`:

```php
/* --- one array, and the two ways a notice feed announces its own death ------------------------ */

/* Every producer emits one row shape. So the merge is a concatenation, a sort and the duplicate
 * test `metWarnings()` already ran inside one source.
 *
 * The sort puts the fresher copy of a repeated bulletin first, so the duplicate test drops the
 * older one. That is the whole of "prefer the fresher row". It is an order, not a comparison.
 *
 * The key lowercases the title. JPS writes a heading in capitals and `data.gov.my` does not.
 * `met_gelora.json` held two identical rows on 2026-08-17, so the test earns its place inside one
 * source as well as across two.
 *
 * KNOWN LIMIT. The two MET sources word one bulletin differently. JPS writes "SECOND CATEGORY
 * WARNING ON STRONG WINDS AND ROUGH SEAS" where data.gov.my writes "Warning on Strong Wind and
 * Rough Seas (Second Category)".
 *
 * An exact key cannot join those, so a reader can meet one bulletin twice while both sources run.
 * That is visible rather than silent, which is the trade taken here. A fuzzy key invents a match,
 * and a wrong join hides a real warning. */
function mergeNotices(array ...$sets): array {
    $all = array_merge(...$sets);
    /* A strcmp is enough because every producer emits ISO. See jpsMetWarnings() for why. */
    usort($all, fn($a, $b) => strcmp((string)$b['from'], (string)$a['from']));

    $out  = [];
    $seen = [];
    foreach ($all as $r) {
        $k = strtolower(trim((string)$r['title'] . '|' . (string)$r['text']));
        if (isset($seen[$k])) continue;
        $seen[$k] = true;
        $out[] = $r;
    }
    return $out;
}

/* The newest issue stamp in a RAW notice body, or 0 where the body holds no row.
 *
 * This reads the feed and not the filtered output. `met-warn` yielded 0 rows through the geography
 * filter on 2026-08-17 and still held 7 rows upstream, every one issued on 2026-08-10. The
 * staleness lives in the feed, so the test has to read the feed. */
function noticeNewest(string $key, string $body): int {
    $jps  = str_starts_with($key, 'jps-');
    $rows = $jps ? jsonLoose($body) : json_decode($body, true);
    if (!is_array($rows)) return 0;

    $field = $jps ? 'Valid_from' : 'valid_from';
    $t = 0;
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $t = max($t, strtotime((string)($r[$field] ?? '')) ?: 0);
    }
    return $t;
}

/* Did this source answer with nothing recent?
 *
 * Zero rows is NOT old. A calm day is the ordinary state of a warning feed, and an alarm on quiet
 * is the cry-wolf failure the alert design standard rejects.
 *
 * The heartbeat below covers a feed that goes legitimately empty. This is a different fault from
 * `sources.stale`, which names a page that did not answer at all. */
function noticeOld(string $key, string $body, int $now, int $max): bool {
    $t = noticeNewest($key, $body);
    return $t > 0 && $t < $now - $max;
}

/* `met_cyclone.json` carries a row at all times. It read `No Advisory` on 2026-08-17.
 * `WARN_DROP` already holds `no advisory`, so the heartbeat can never reach a surface. It needs no
 * new rule to keep it off one.
 *
 * An empty or unreadable file marks the whole JPS MET mirror as old. `jps-rain` goes legitimately
 * empty on most days, so this is the only liveness evidence it has. */
function beatDead(string $body): bool {
    $rows = jsonLoose($body);
    return $rows === null || $rows === [];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `php api.php --selftest`
Expected: every new line reads `ok`

- [ ] **Step 6: Commit**

```bash
git add sources.php api.php
git commit -m "Merge the notice sources, and let a dead one announce itself

One array carries every notice. The merge sorts newest first and drops an
exact duplicate, so the fresher copy of a repeated bulletin is the one
kept.

noticeOld() names a source that answered with nothing recent, which is a
different fault from sources.stale and needs a different name. Zero rows
is not old: a calm day is the ordinary state of a warning feed. The
jps-beat heartbeat covers the feeds that are legitimately empty.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire it into the payload

**Files:**
- Modify: `sources.php:604-610` (`metUrls()`, and a new `jpsUrls()` beside it)
- Modify: `api.php:277-290` (the URL constants), `api.php:885-895` (`pageHasData()`), `api.php:2638-2648` (`$ttlFor` and `$extraUrls`), `api.php:2740` (the parse calls), `api.php:3465-3490` (the `sources` assembly)
- Modify: `watch.php:42`

**Interfaces:**
- Consumes: every function from Tasks 1 to 5.
- Produces: `warnings[]` rows carrying `kind` and `src`. `sources.old`, an array of page keys. `sources.floodalert` and `sources.jpsmet`, each `['parsed' => int]`.

- [ ] **Step 1: Add the URL constants**

In `api.php`, directly below `const MET_WARN_URL = ...` and the `NOTICE_OLD` constant from Task 5:

```php
/* The three notice feeds at publicinfobanjir.water.gov.my/ramalan/. Each page renders its table
   with JavaScript, so the data sits behind these requests rather than in the HTML. */
const JPS_NOTICE = 'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/';

/* The flood alert takes the shorter clock because it is the only true flood alarm here. Its
   response was 2 bytes on every fetch during the design, and a late flood alert costs more than the
   request does. The four MET mirror files keep MET_WARN_TTL, the window MET warnings already use. */
const JPS_FLOOD_TTL = 300;
```

- [ ] **Step 2: Add `jpsUrls()`**

In `sources.php`, directly below `metUrls()` at line 610:

```php
/* The five requests behind the two notice pages this app reads.
 *
 * This app fetches `jps-beat` and never surfaces it. `met_cyclone.json` carries a row at all times.
 * `jps-rain` goes legitimately empty on most days, so that row is the only liveness evidence it
 * has. `WARN_DROP` already holds `no advisory`, so the permanent row can never reach a screen.
 *
 * `data/met_earthquake.json` is absent on purpose. `WARN_DROP` holds `earthquake` and `tsunami`, so
 * every row of that file drops. Fetching it spends a request to discard the answer. */
function jpsUrls(): array {
    return [
        'jps-flood' => JPS_NOTICE . 'query/getdisse.php',
        'jps-rain'  => JPS_NOTICE . 'data/met_rain22.json',
        'jps-storm' => JPS_NOTICE . 'data/met_thunderain2.json',
        'jps-sea'   => JPS_NOTICE . 'data/met_gelora.json',
        'jps-beat'  => JPS_NOTICE . 'data/met_cyclone.json',
    ];
}
```

- [ ] **Step 3: Teach `pageHasData()` the new keys**

In `api.php`, add one arm to the `match (true)` inside `pageHasData()`, above the `default`:

```php
        /* The JPS notice feeds. `jsonLoose()` and not `json_decode()`, because JPS writes raw
           newline characters inside JSON string values. Without it a good page reads as an outage.
           An empty list IS data. met_rain22.json is legitimately `[]` on a dry day, and
           getdisse.php answered `[]` on every fetch during the design. */
        str_starts_with($key, 'jps-')           => jsonLoose($body) !== null,
```

Then add the matching assertions to the `--selftest` block, beside the existing `pageHasData` ones:

```php
    $ok('a JPS empty list is data',      pageHasData('jps-rain', '[]') === true);
    $ok('a JPS row set is data',         pageHasData('jps-sea', '[{"Heading_EN":"x"}]') === true);
    // The one that plain json_decode() gets wrong.
    $ok('a raw newline is still data',   pageHasData('jps-sea', "[{\"a\":\"x\ny\"}]") === true);
    $ok('a JPS notice is not data',      pageHasData('jps-flood', '<html>Notis Gangguan</html>') === false);
```

- [ ] **Step 4: Fetch the pages**

In `api.php`, change the `$extraUrls` line at 2635:

```php
$extraUrls = nationalUrls() + klUrls() + metUrls($now) + portalRainUrls() + jpsUrls();
```

and add one arm to `$ttlFor`:

```php
$ttlFor = fn(string $k) => match ($k) {
    'met-day'   => MET_DAY_TTL,
    'met-warn'  => MET_WARN_TTL,
    'jps-flood' => JPS_FLOOD_TTL,
    default     => SCRAPE_TTL,
};
```

The four remaining `jps-` keys fall to `SCRAPE_TTL`, which is 900 and is the same number `MET_WARN_TTL` holds.

- [ ] **Step 5: Parse and merge**

In `api.php`, replace the single `$metWarn = metWarnings($page('met-warn'), $now);` line at 2740:

```php
/* Three producers, one array. See mergeNotices() for the sort and the duplicate rule.
   `warnings` counts toward nothing, and that separation is what let this surface pass the alert
   design standard — see the rule beside the payload key below. */
$warnMet   = metWarnings($page('met-warn'), $now);
$warnJps   = array_merge(jpsMetWarnings($page('jps-rain'),  $now),
                         jpsMetWarnings($page('jps-storm'), $now),
                         jpsMetWarnings($page('jps-sea'),   $now));
$warnFlood = floodAlerts($page('jps-flood'), $now);
$metWarn   = mergeNotices($warnMet, $warnJps, $warnFlood);

/* A source that answered with nothing recent. This is NOT sources.stale, which names a page that
   did not answer at all. api.data.gov.my/weather/warning sat seven days on 2026-08-17 with every
   counter quiet, because the fetch had succeeded. */
$pagesOld = [];
foreach (['met-warn', 'jps-rain', 'jps-storm', 'jps-sea', 'jps-beat'] as $k) {
    if (noticeOld($k, $page($k), $now, NOTICE_OLD)) $pagesOld[] = $k;
}
/* The heartbeat speaks for the whole mirror. jps-rain goes legitimately empty most days, so it
   holds no evidence itself. */
if (beatDead($page('jps-beat')) && !in_array('jps-beat', $pagesOld, true)) $pagesOld[] = 'jps-beat';
```

- [ ] **Step 6: Publish the counters and `sources.old`**

In `api.php`, inside the `sources` array, directly above the `'stale' => $pagesStale,` line:

```php
        // The JPS mirror of the MET bulletins, and the JPS flood forecast. Read `parsed` as
        // `met.parsed` reads. 0 means the scrape found nothing, which on these feeds is a real and
        // common state. `old` below is what names a feed that has stopped moving.
        'jpsmet'    => ['parsed' => count($warnJps)],
        'floodalert' => ['parsed' => count($warnFlood)],
        // Empty on a healthy poll. A key here names a source that answered with nothing recent,
        // which a parse counter cannot see: a week-old bulletin parses as well as a fresh one.
        'old'       => $pagesOld,
```

- [ ] **Step 7: Teach `watch.php` the new signal**

In `watch.php`, directly below the `stale pages` line at 42:

```php
    /* A stale answer is not a missing one, so `stale` above cannot see this. Every row of
       api.data.gov.my/weather/warning was seven days old on 2026-08-17 and every counter stayed
       quiet, because the fetch had succeeded. */
    if (!empty($p['sources']['old'])) $bad[] = 'old sources: ' . implode(' ', $p['sources']['old']);
```

Also extend the comment above the `foreach` at line 30, which names the keys deliberately left out:

```php
    /* `metwarn` is deliberately absent from this list. Zero warnings is the ordinary state of a
       calm day, not a broken scrape. It read 0 on the poll behind this file.

       `jpsmet` and `floodalert` are absent for the same reason, and `floodalert` more strongly.
       getdisse.php answered `[]` on every fetch during its design. `sources.old` below is what
       names a notice feed that has stopped moving.

       `gaz.pending` and `hist.pending` are absent too, on purpose. Both reach 0 when their drip
       finishes, which is the healthy end state. An alarm that fires on success is the cry-wolf
       failure the alert design standard in docs/FEATURES.md rejects. */
```

- [ ] **Step 8: Lint and run the offline checks**

Run:

```bash
php -l api.php && php -l sources.php && php -l watch.php
php api.php --selftest
```

Expected: three `No syntax errors`, and every `--selftest` line reads `ok`.

- [ ] **Step 9: Force a rebuild and read the payload**

Run:

```bash
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0");'
curl -sk 'https://flood-exp.test/api.php?force=1' | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$s=$p["sources"];
echo "metwarn:    ",json_encode($s["metwarn"]),"\n";
echo "jpsmet:     ",json_encode($s["jpsmet"]),"\n";
echo "floodalert: ",json_encode($s["floodalert"]),"\n";
echo "stale:      ",json_encode($s["stale"]),"\n";
echo "old:        ",json_encode($s["old"]),"\n";
foreach($p["warnings"] as $w) printf("  %-8s %-4s %s\n    %s\n",$w["kind"],$w["src"],substr($w["title"],0,58),substr($w["text"],0,150));'
```

Expected: `stale` is empty. `old` holds `met-warn`, which is the seven-day fault this work exists to name. Every warning row carries a `kind` and a `src`. No row states text naming only a region this map does not cover.

- [ ] **Step 10: Confirm `watch.php` reports the new fault once**

Run:

```bash
rm -f .watch.state
curl -sk https://flood-exp.test/api.php | php watch.php; echo "first  -> $?"
curl -sk https://flood-exp.test/api.php | php watch.php; echo "again  -> $?  (must not log twice)"
tail -2 .php-error.log
```

Expected: exit 1 both times, and exactly one new line in the log naming `old sources: met-warn`.

- [ ] **Step 11: Measure the cost of the five new requests**

Run:

```bash
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0");'
curl -sk -o /dev/null -w 'cold rebuild %{time_total}s\n' 'https://flood-exp.test/api.php?force=1'
curl -sk -o /dev/null -w 'warm poll    %{time_total}s\n' 'https://flood-exp.test/api.php'
```

Expected: the cold rebuild stays inside the range `CLAUDE.md` records for one, which is about 28 s with a page-cache miss. A jump past that means one of the five new URLs hangs. The fix is the one `pageRow()` already applies. Record the two numbers in the commit message.

- [ ] **Step 12: Commit**

```bash
git add api.php sources.php watch.php
git commit -m "Publish the JPS notice feeds in the payload

Five new page-cache keys. The flood alert keeps a 300 s clock because it is
the only true flood alarm here. The four MET mirror files keep the window
MET warnings already use.

sources.old names a source that answered with nothing recent. It is not
sources.stale, which names a page that did not answer at all. On this
payload it holds met-warn, which has not moved since 2026-08-10.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The client surfaces and the media statement link

**Files:**
- Modify: `js/config.js` (below `ALERT_TITLE` at line 36)
- Modify: `js/alerts.js:169-172` (`BANNER`) and `js/alerts.js:178-198` (`bannerCard`)
- Modify: `js/ticker.js:82-86` (the warning tiles)
- Modify: `js/ui.js:1225-1231` (the modal head)
- Modify: `index.html:353-357` (the disclaimer block)

**Interfaces:**
- Consumes: `warnings[]` rows carrying `kind` from Task 6.
- Produces: nothing later tasks read.

**The rule this task keeps.** No count moves. `alerts()` reads the station list for the tally, the badge, the tab title and the warning glyph. Nothing here touches any of them.

- [ ] **Step 1: Add the words**

In `js/config.js`, directly below the `ALERT_TITLE` object at line 36:

```javascript
/* The shell each kind of regional notice draws in. `kind` arrives on every row in `warnings[]`.
   The words live here beside ALERT_TITLE and HOTLINES, because that is where this app keeps its
   strings, and because three surfaces read them: the panel card, the ticker tile and the modal. */
export const NOTICE_KIND = {
  weather: { icon: 'rainy_heavy', c: 'var(--k-weather)', head: 'Forecast Warning' },
  // A flood forecast from JPS. It counts toward nothing, exactly as a weather warning does — see
  // the alert design standard in docs/FEATURES.md.
  flood:   { icon: 'flood',       c: 'var(--k-river)',   head: 'Flood Alert' },
};
```

- [ ] **Step 2: Confirm the two icons exist**

Run:

```bash
grep -c -- '--i-rainy_heavy\|--i-flood\b' css/icons.css
```

Expected: `2`. If `--i-flood` is absent, add it to `css/icons.css` following the generation note in `docs/FEATURES.md`, then bump the `?v=` on the `css/icons.css` link in `index.html`.

- [ ] **Step 3: Make `bannerCard()` read the row**

In `js/alerts.js`, replace the `BANNER` object at line 169:

```javascript
/* The outage shell. The two notice shells live in NOTICE_KIND in config.js, because the ticker and
   the modal read them too and this module is not importable from either. */
const BANNER = {
  notice: { cls: 'noticegrp', icon: 'public_off', c: 'var(--k-source)', head: 'Service Notice' },
};
```

Then replace `bannerCard()`:

```javascript
/* One card for both kinds. An outage publishes an id rather than prose, so its words come from
   NOTICE in config.js. A warning carries its own.
 *
 * A warning card is split by `kind`, so a JPS flood forecast and a MET thunderstorm never share a
 * heading. They are different claims, and one heading over both makes the app state something
 * neither source said. */
function bannerCard(list, kind) {
  if (!list || !list.length) return '';
  if (kind === 'notice') {
    const rows = list.map((w, i) => {
      const t = NOTICE[w.id];
      if (!t) return '';                  // an id this build has no words for says nothing
      return `<button class="warnrow" data-banner="notice:${i}">
          <b>${esc(t.title)}</b><span class="warntext">${esc(t.line)}</span>
        </button>`;
    }).join('');
    return rows ? shell(BANNER.notice, 'noticegrp', rows) : '';
  }

  /* `data-banner` indexes state.warnings, so the index is taken BEFORE the split. Renumbering
     after it opens the wrong warning — the same rule the ticker already obeys. */
  return Object.entries(NOTICE_KIND).map(([k, b]) => {
    const rows = list.map((w, i) => [w, i]).filter(([w]) => (w.kind || 'weather') === k)
      .map(([w, i]) => `<button class="warnrow" data-banner="warn:${i}">
          <b>${esc(w.title)}</b><span class="warntext">${esc(w.text)}</span>
        </button>`).join('');
    return rows ? shell(b, 'warngrp', rows) : '';
  }).join('');
}

// The shared card shell. Split out because bannerCard() now builds up to three of them.
const shell = (b, cls, rows) => `<div class="alertgrp ${cls}">
      <div class="alerthead">
        <i class="i i-${b.icon}" style="--c:${b.c}"></i>
        <b>${b.head}</b>
      </div>
      ${rows}
    </div>`;
```

Then add `NOTICE_KIND` to the `config.js` import at the top of `js/alerts.js`.

- [ ] **Step 4: Make the ticker tile read the row**

In `js/ticker.js`, replace the `warns` block at line 82:

```javascript
  const warns = state.warnings
    .map((w, i) => [w, i])
    .filter(([w]) => w.fresh)
    // `data-warn` indexes state.warnings, so the index comes from the map above and never from the
    // filtered position. The glyph and the colour come from the row's own kind.
    .map(([w, i]) => {
      const b = NOTICE_KIND[w.kind] || NOTICE_KIND.weather;
      return tile('warn', b.icon, b.c, w.title, w.text, i);
    });
```

Then add `NOTICE_KIND` to the `config.js` import at the top of `js/ticker.js`.

- [ ] **Step 5: Make the modal read the row**

In `js/ui.js`, replace the warning branch at line 1225:

```javascript
    const b = NOTICE_KIND[it.kind] || NOTICE_KIND.weather;
    icon.className = `i i-${b.icon}`;
    icon.style.color = b.c;
    el('warnBoxTitle').textContent = b.head;
    el('warnBody').innerHTML = `<h3>${esc(it.title)}</h3><p>${esc(it.text)}</p>
      <p class="muted">Valid ${esc(warnWhen(it.from))} to ${esc(warnWhen(it.to))}</p>`;
```

Read the three lines above it in the file first. Keep whatever selector already resolves `icon`. Change only the values this block writes to it. Add `NOTICE_KIND` to the `config.js` import at the top of `js/ui.js`.

- [ ] **Step 6: Add the media statement link**

In `index.html`, inside the `<p class="notice">` block, after the APM link and before `</span>`:

```html
<br>
     JPS publishes its own flood statements at
     <a href="https://publicinfobanjir.water.gov.my/ramalan/pernyataan-media/?lang=en"
        target="_blank" rel="noopener">publicinfobanjir.water.gov.my</a>.
```

The page is a list of PDF documents. It is not an alarm, and it fails the alert design standard on that alone. The milling literature calls for an outbound link. That link is the whole of what a document list can honestly give.

- [ ] **Step 7: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 8: Look at the page**

Open `https://flood-exp.test` and hard-reload with Ctrl+Shift+R, because an ES module change has no `?v=` guard.

Check each of these:
- The alert list draws no flood card while `warnings[]` holds no flood row. An empty card shell is a heading over nothing.
- The ticker still reads `No alerts` when nothing happens. Quiet is a state.
- The About dialog carries the media statement link, and it opens the JPS page.
- The alert count, the icon badge, the app bar glyph and the tab title do not move.

Then run test mode from the About dialog and confirm the counts still describe stations alone.

- [ ] **Step 9: Prove a flood card draws, since the live feed cannot**

`getdisse.php` answered `[]` on every fetch during the design, so the flood shell has nothing real to draw. Check it against a faked row in the browser console:

```javascript
// Paste into the console on the live page. This fakes the payload the client would receive.
state.warnings.unshift({ title: 'Flood alert · Final', text: 'Sungai Klang di Jambatan Sulaiman (SELANGOR)',
  from: '2026-08-17T09:00:00', to: '2026-08-17T21:00:00', fresh: true, kind: 'flood', src: 'jps' });
alerts();
```

Expected: a second card headed `Flood Alert` under the `Forecast Warning` card, drawing the river blue glyph. Its row opens a modal headed `Flood Alert`. The alert count does not move. Reload to clear the fake.

- [ ] **Step 10: Commit**

```bash
git add js/config.js js/alerts.js js/ticker.js js/ui.js index.html
git commit -m "Draw a flood notice apart from a weather one

One array carries every notice and the row's own kind picks the shell. A
JPS flood forecast and a MET thunderstorm are different claims, and one
heading over both makes the app state something neither source said.

No count moves. The alert number, the icon badge, the app bar glyph and
the tab title still read the station list alone.

The media statement page is a list of PDF documents rather than an alarm,
so it gets one outbound link in About and nothing else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/FEATURES.md`
- Modify: `CLAUDE.md`

`CLAUDE.md` tells you to document a feature as part of the change. It is never a follow-up task. This task sits inside the same plan, so it lands before you call the work done.

- [ ] **Step 1: Write the FEATURES.md entry**

Append a section to `docs/FEATURES.md`. State what the feature does and why. Record what this work deliberately did not build. Cover each of these, because each one is a decision somebody will otherwise revisit:

- The MET warning source sat seven days dead and every counter stayed quiet. Give the measured numbers. `data.gov.my` held 7 rows, all issued 2026-08-10, and most expired 2026-08-13. The JPS mirror answered at 08:21 and 08:31 on 2026-08-17.
- This work merges both sources rather than swapping them, so either one can go quiet.
- The known limit in `mergeNotices()`. The two sources word one bulletin differently, so a reader can meet it twice while both run. Say why a fuzzy key is worse.
- Paragraph-level geography, with the 1,795-character bulletin as the worked example.
- `sources.old` beside `sources.stale`, and why an age test cannot live in `pageHasData()`.
- The three withdrawal codes, and why the validity window already retires an alert.
- The media statement is a link, with the milling argument.
- Not built: siren backing from `NT_DF`, POI geometry, a flood-alert count, a reader-facing staleness notice.

- [ ] **Step 2: Add the note to the alert design standard**

Append to the alert design standard section of `docs/FEATURES.md`, at line 2061 onward. State that this work checked the flood alert and the JPS MET mirror against the standard. Both clear it on the ground the MET warning already cleared on. A notice counts toward nothing. Name the one gap this work leaves open. `NT_DF` gives an official siren notification, and `sirenBacked()` does not read it yet.

- [ ] **Step 3: Update the CLAUDE.md file table**

Add the five new page keys to the data sources table. Note that `sources.php` now holds the two JPS notice parsers.

- [ ] **Step 4: Add the new gotchas to CLAUDE.md**

Each of these cost real time to find and each fails silently. Write them in the voice the existing list uses.

- **The JPS MET JSON files are not valid JSON.** They hold raw newline characters inside string values. `json_decode()` returns null. A null decode looks identical to an empty feed to a caller that tests `is_array()`. `jsonLoose()` is the reader. `pageHasData()` needs it for a `jps-` key, or a good page reads as an outage.
- **A stale feed and a calm feed look the same, and `parsed: 0` cannot tell them apart.** `sources.stale` names a page that did not answer. `sources.old` names one that answered with nothing recent. An age test cannot live in `pageHasData()`. That function asks what kind of document arrived, and a failure there discards the stored copy.
- **Zero rows is not old.** An alarm on a quiet warning feed is the cry-wolf failure the standard rejects. `jps-beat` covers the empty case. `met_cyclone.json` carries a row at all times.
- **A warning stamp needs the ISO shape.** `warnWhen()` in `js/ui.js` matches `^\d{4}-\d\d-\d\dT\d\d:\d\d` and prints the raw string otherwise. JPS stamps `17-08-2026 08:00:00`. Left verbatim it puts two date formats in one modal. It also misorders the merge, which is a `strcmp` over that field.
- **A national bulletin names six regions and one of them is ours.** A row-level place test keeps the whole wall of text. `hereParts()` narrows the display. The gate stays on the combined English and Malay text, so every row that used to survive still survives.
- **`floodAlerts()` has never seen a row.** The field names come from the consumer JavaScript JPS publishes. The first non-empty response is the moment to check the parser by hand.

- [ ] **Step 5: Replace the deferred-feeds convention entry**

`CLAUDE.md` carries a convention entry beginning "Three official notice feeds wait for a design". That wait is over for two of the three, and the third became a link. Replace it with what shipped. Keep the one part still true. A parser that has never met a real row cannot tell a quiet feed from a moved layout. That is why `floodAlerts()` carries the open risk above.

- [ ] **Step 6: Add the Verify block**

Append the commands from the verify section in the spec to the Verify block in `CLAUDE.md`. Include the paragraph-filter check. It asserts that no notice row names only places this map does not cover.

- [ ] **Step 7: Run the STE checker on both files**

Run:

```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
```

Aim for 0 on every prose rule. A table, a long list or a shell block raises a false `long_paragraph`. Confirm which is which before you accept a count. Run:

```bash
python -c "
import importlib.util,re,sys
spec=importlib.util.spec_from_file_location('l','C:/Users/illus/.claude/ste-lint.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
t=open(sys.argv[1],encoding='utf-8').read()
for p in [p for p in re.split(r'\n\s*\n',t) if p.strip()]:
    n=len(m.sentences(m.strip_code(p)))
    if n>6:
        kind='TABLE' if p.lstrip().startswith('|') else 'LIST' if re.match(r'^\s*[-*\d]',p) else 'PROSE'
        print(f'{n:3d} {kind:6s} | '+' '.join(p.split())[:70])
" docs/FEATURES.md
```

Any line reading `PROSE` is a real violation. Split it.

- [ ] **Step 8: Run every check in the repo**

Run:

```bash
php -l api.php && php -l sources.php && php -l watch.php
php api.php --selftest
php shots-test.php
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "Document the JPS notice feeds

Records the seven-day MET outage that nothing reported, the two liveness
signals and why they need two names, the paragraph-level geography filter,
and the four things this work deliberately did not build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task.

| spec section | task |
|---|---|
| Five page-cache keys | 6 |
| `jsonLoose()` | 1 |
| `jpsMetWarnings()` | 3 |
| `floodAlerts()` | 4 |
| Paragraph-level geography | 2 |
| The merge | 5 |
| Liveness, `sources.old`, the heartbeat | 5 and 6 |
| Client, `kind` glyph and heading | 7 |
| The media statement link | 7 |
| What this work does not build | 8 |
| Open risk | 4 and 8 |

**Type consistency.** Every producer emits the same seven keys: `title`, `text`, `from`, `to`, `fresh`, `kind`, `src`. All three write `from` and `to` in the ISO shape `Y-m-d\TH:i:s`. Task 2 holds the existing `metWarnings()` path to the same shape, because `data.gov.my` already stamps ISO and Task 2 keeps those stamps verbatim. `jsonLoose()` returns `?array` in Task 1, and every caller in Tasks 3, 5 and 6 tests for `null`. `hereNames()` and `hereParts()` take the same two arguments everywhere.

**One deviation from the spec, and it narrows rather than widens.** The spec says the flood alert keeps its row. This plan drops a row that carries no `EstimatedEndDT`. Every surface renders inside a validity window, and nothing can retire a row with no end. Task 4 states the reason and asserts it.

**Two things a reviewer can reject.**

1. `mergeNotices()` cannot join the same bulletin worded two ways. While both MET sources run, a reader can meet one warning twice. The alternative is a fuzzy key, and a wrong join hides a real warning. Task 5 documents the trade in the code.
2. `NOTICE_OLD` is 48 hours. The argument is that MET issues a bulletin at least daily. Nobody measured a record of quiet periods. If a real 48-hour calm arrives, `watch.php` reports a fault that is not one. The cost is one log line to a self-hosted operator, not a reader-facing alarm.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-17-jps-notice-feeds.md`.
