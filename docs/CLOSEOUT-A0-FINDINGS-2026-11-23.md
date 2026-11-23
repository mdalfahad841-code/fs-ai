# CLOSEOUT A0 FINDINGS — 2026-11-23

**Status:** COMPLETE. Read-only investigation; no code or data was changed by the investigation itself (this document is the only new file). Baseline tests 1341/0, 342 suites (unchanged).
**Sources:** frontend source investigation (A0.1/A0.2/A0.4), live-D1 read-only queries + static/sitemap/seed comparison (A0.3), GitHub docs web search (A0.5).

---

## A0.1 — Division cards blank space: YES, the reveal mechanism explains it

### How the cards render
- Shell is empty static HTML: `frontend/index.html:66` — `<div class="grid" id="divisionGrid"></div>` inside the section at `frontend/index.html:63-68` (`<h2>Eight divisions, one platform</h2>`).
- Renderer: `frontend/scripts/app.js:431-442` `renderDivisions(root)` — every one of the 8 cards carries class `reveal`. Data is the hard-coded `DIVISIONS` array, `frontend/scripts/app.js:75-84` (8 entries).
- Rendering is gated on the live merge: `frontend/scripts/app.js:495-512` `renderShared()` calls `renderDivisions(dg)`, and `document.addEventListener('DOMContentLoaded', function () { liveReady.then(renderShared); });`. `liveReady` (`app.js:332-361`) is a fetch to `https://fs-ai.mdalfahad841.workers.dev/api/articles?limit=100` (`app.js:265`) with a 5 s timeout (`app.js:266`, `LIVE_TIMEOUT_MS = 5000`). Cards are inserted only after that fetch resolves/rejects/times out.

### The reveal mechanism
- CSS, `frontend/styles/animations.css:7-8`: `.reveal { opacity: 0; transform: translateY(8px); transition: opacity .4s … }` / `.reveal.visible { opacity: 1; transform: translateY(0); }`. `opacity:0` elements **still occupy layout space** — an invisible 8-card grid looks exactly like a large blank block under the section heading.
- JS, `frontend/scripts/animations.js` (whole file, 24 lines), runs **once**, on `DOMContentLoaded` (`animations.js:10`): snapshots `document.querySelectorAll('.reveal')`; if reduced-motion or no `IntersectionObserver`, adds `visible` to all; else observes each with threshold 0.12.
- There is **no re-query, no MutationObserver, no timer, no re-run after rendering**. Fallbacks exist only for (a) `prefers-reduced-motion` (JS adds `visible`; CSS `animations.css:19-20` also forces `.reveal { opacity: 1; }`) and (b) browsers without `IntersectionObserver`. No fallback for late-inserted nodes, a slow fetch, or `animations.js` failing to load.

### The race that produces the blank space
1. `animations.js` is loaded after `app.js` on the homepage (`frontend/index.html:129-134`), and its `DOMContentLoaded` handler snapshots `.reveal` elements **at that moment**.
2. If the live-articles fetch has not yet resolved when `DOMContentLoaded` fires (slow/mobile network, worker cold start — up to 5 s), `renderShared()` has not run yet, `#divisionGrid` is still empty, and **no `.reveal` element exists anywhere in the static HTML** (verified by grep: `.reveal` occurs only in JS-generated markup). The observer therefore observes **zero** division cards.
3. `renderShared()` then inserts the 8 cards, but nothing ever observes them and nothing ever adds `visible`. They stay at `opacity:0` **permanently until reload**, while occupying full grid height. On a 390 px phone the grid is single-column (`frontend/styles/responsive.css:30`, `@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }`, plate height 104 px at `responsive.css:36-37`), so 8 invisible cards are a ~1000 px-scale blank area — consistent in magnitude with the report (exact height NOT measured — no browser).
4. If the fetch resolves **before** `DOMContentLoaded`, the cards are present when the observer snapshots and the section works — so the bug is **intermittent / network-dependent**, which fits "phone shows blank, desktop may not".

### Scope
- Same flaw hits article cards (`app.js:419`, `article-card reveal`) and `renderTools` tool cards (`app.js:453`, `tool-card reveal`).
- **Not** affected: hero preview (`app.js:468`, `<article class="card hero-preview">` — no `reveal` class); home tools grid via `frontend/scripts/tools.js:551` (`'reveal visible'` — pre-visible, immune); search results (`frontend/scripts/search.js:50`, no `reveal`); division-page article list (`frontend/pages/division.html`, no `reveal`).
- Ruled out as the cause of *blank space*: JS fully off / `app.js` failing would leave `#divisionGrid` empty, so the section would collapse, not show ~1000 px of blank. The blank-space symptom specifically points to rendered-but-`opacity:0` cards.

### Console checks for the parent (NOT TESTED — run in a live browser)
1. `document.querySelectorAll('#divisionGrid .reveal').length` (expect 8) and `document.querySelectorAll('#divisionGrid .reveal.visible').length` (expect 0 if the bug reproduced) and `getComputedStyle(document.querySelector('#divisionGrid .reveal')).opacity` (expect `0`).
2. Network tab: did `scripts/animations.js` load 200? Did `GET https://fs-ai.mdalfahad841.workers.dev/api/articles?limit=100` take longer than `DOMContentLoaded`? Reproduce with network throttling (Slow 3G) + hard reload.
3. `('IntersectionObserver' in window)` and `matchMedia('(prefers-reduced-motion: reduce)').matches` — to exclude the two real fallbacks.
4. Console errors from `app.js` / `animations.js`; after scrolling the section into view, confirm no `.reveal` gains `visible` (proves never-observed, not just below-fold).

**Implication for A1.1:** the fix must re-observe `.reveal` elements after every render (or observe the container), plus a loading state and a no-JS fallback list. A one-shot snapshot is the defect.

---

## A0.2 — "Latest guide" shows No. 01 (11 Nov): correct by the code's logic, but only via a date tie

### The picking code
`frontend/scripts/app.js:462-464`, `renderHeroPreview(root)`: `var latest = ARTICLES.slice().sort(function (a, b) { return b.date.localeCompare(a.date); })[0];`
"Latest" = **max `date` string only** (ISO `YYYY-MM-DD`, so lexicographic = chronological). **No secondary tie-breaker** (no id, no time). `Array.sort` is stable, so ties keep static-bundle order. The same sort is used for the "Latest articles" grid (`app.js:443-446`).

### Is No. 01 actually the newest?
In the static bundle (`app.js:86-111`, ids 1–25): id 1 (`app.js:87`, `date: '2026-11-11'`, "EV Charging at Home…") and id 13 (`app.js:99`, also `date: '2026-11-11'`, "What Is AI?") are **joint-newest**; id 1 wins only because it comes first in bundle order. Next newest are `2026-11-10` (ids 2, 14). The display is therefore not wrong, but it is arbitrary between two equally-new articles — nothing in the code prefers id 1 on merit.

### Will it follow newly published articles automatically?
**Yes, with four caveats.** The loader (`app.js:265-266, 273-361`): `mergeLiveArticles` (`app.js:296-313`) maps live D1 rows and **only ids absent from the static bundle are appended** (`app.js:306`: `if (byId[mapped.id]) continue; /* shared id: static wins, kept exactly */`); `applyLiveArticles` (`app.js:315-327`) mutates `ARTICLES` in place; `renderShared` waits on `liveReady` (`app.js:511-512`), so `renderHeroPreview` sees the merged list.
**Verdict: a newly published D1 article with a new id and a `publishedAt` date later than 2026-11-11 becomes the "Latest guide" with no deploy.** Caveats:
1. A new article dated **exactly 2026-11-11** would *not* displace No. 01 (stable sort, static id 1 first; live additions are appended after statics, `app.js:310-312`).
2. If the fetch fails, returns non-OK, or times out at 5 s, `liveReady` resolves `false` and the static bundle is used unchanged (`app.js:340-361`).
3. A live row with no parseable `YYYY-MM-DD` date gets `date: ''` (`app.js:278-279`) and sorts last; a row with bad id/title/division is skipped entirely (`app.js:273-294`).
4. Corrections to an already-published article's date/content in D1 **never surface** (static-wins, comment at `app.js:240-259`).

**Implication for A1.6:** "real newest" needs a deterministic tie-breaker in addition to max date. Recommended: date desc, then id desc (ids increase with publication order under the Set B dates in A0.3, so the highest id among the max-date group is the most recently published). Under the current static dates that picks id 13; after A2 fixes the dates to Set B it picks id 25. The rule is the same in both cases; A2's date fix changes the outcome.

---

## A0.3 — Date table: all 25 published articles

Columns: **S** = static `date` in `frontend/scripts/app.js` (ARTICLES) · **D1 pub** = D1 `published_at` · **D1 created** = D1 `created_at` · **Log** = earliest `publication_logs` row for the article · **JSON-LD** = served `datePublished` (`frontend/pages/article.html`, JS-generated from `a.date`) · **Sitemap** = `lastmod` in `public/sitemap.xml` = `frontend/sitemap.xml` (verified byte-identical with `diff`) · **Seed** = `database/seed.sql` `published_at` for that id. All dates 2026.

| id | title (short) | S (static) | D1 pub | D1 created | Log | JSON-LD | Sitemap | Seed |
|---|---|---|---|---|---|---|---|---|
| 1 | EV Charging at Home | 11-11 | 11-02 | 11-12 17:19:54 | — none — | 11-11 | 11-01 | 11-01 |
| 2 | Car Maintenance Checklist | 11-10 | 11-02 | 11-12 17:19:54 | — none — | 11-10 | 11-01 | 11-01 |
| 3 | Hybrid vs Petrol | 11-09 | 11-02 | 11-12 17:19:54 | — none — | 11-09 | 11-02 | 11-02 |
| 4 | Motorcycle Buying Guide | 11-08 | 11-02 | 11-12 17:19:54 | — none — | 11-08 | 11-02 | 11-02 |
| 5 | How to Read Warning Lights | 11-07 | 11-03 | 11-12 17:19:54 | — none — | 11-07 | 11-03 | 11-03 |
| 6 | Fuel Economy: 15 Ways | 11-06 | 11-03 | 11-12 17:19:54 | — none — | 11-06 | 11-03 | 11-03 |
| 7 | ADAS Explained | 11-05 | 11-04 | 11-12 17:19:54 | — none — | 11-05 | 11-04 | 11-04 |
| 8 | EV Range | 11-04 | 11-04 | 11-12 17:19:54 | — none — | 11-04 | 11-04 | 11-04 |
| 9 | Diagnose Engine Noises | 11-03 | 11-05 | 11-12 17:19:54 | — none — | 11-03 | 11-05 | 11-05 |
| 10 | New vs Used Cars | 11-02 | 11-05 | 11-12 17:19:54 | — none — | 11-02 | 11-05 | 11-05 |
| 11 | Car Safety Ratings | 11-01 | 11-06 | 11-12 17:20:12 | — none — | 11-01 | 11-06 | 11-06 |
| 12 | Best Family Cars | 10-31 | 11-06 | 11-12 17:20:12 | — none — | 10-31 | 11-06 | 11-06 |
| 13 | What Is AI? | 11-11 | 11-07 | 11-12 17:20:12 | — none — | 11-11 | 11-07 | 11-07 |
| 14 | 7 Free AI Tools | 11-10 | 11-07 | 11-12 17:20:12 | — none — | 11-10 | 11-07 | 11-07 |
| 15 | Smartphone Buying Guide | 11-09 | 11-08 | 11-12 17:20:12 | — none — | 11-09 | 11-08 | 11-08 |
| 16 | Laptop vs Tablet | 11-08 | 11-08 | 11-12 17:20:12 | — none — | 11-08 | 11-08 | 11-08 |
| 17 | Monthly Budgeting 50/30/20 | 11-07 | 11-09 | 11-12 17:20:12 | — none — | 11-07 | 11-09 | 11-09 |
| 18 | Start Saving, Small Income | 11-06 | 11-09 | 11-12 17:20:12 | — none — | 11-06 | 11-09 | 11-09 |
| 19 | Travel on a Budget | 11-05 | 11-10 | 11-12 17:20:12 | — none — | 11-05 | 11-10 | 11-10 |
| 20 | Free Digital Tools | 11-04 | 11-10 | 11-12 17:20:12 | — none — | 11-04 | 11-10 | 11-10 |
| 21 | Walking for Health | 11-03 | 11-11 | 11-13 08:40:43 | — none — | 11-03 | 11-11 | 11-11 |
| 22 | Learn a Digital Skill in 30 Days | 11-02 | 11-11 | 11-13 08:40:43 | — none — | 11-02 | 11-11 | 11-11 |
| 23 | Home Workout Basics | 11-01 | 11-11 | 11-13 08:40:43 | — none — | 11-01 | 11-11 | 11-11 |
| 24 | Understanding Interest: Loans | 10-31 | 11-11 | 11-13 08:40:43 | — none — | 10-31 | 11-11 | 11-11 |
| 25 | Plan a Road Trip | 10-30 | 11-11 | 11-13 08:40:43 | — none — | 10-30 | 11-11 | 11-11 |

Static dates verified by pairing each `id` with its `title` in the same ARTICLES object (titles match D1 titles for all 25); sitemap lastmods extracted per `?id=` URL (60 URLs total; non-article URLs carry no `lastmod`).

### Source-by-source findings
- **Publication logs: EMPTY for all 25.** `publication_logs` contains exactly **1 row in total**: article 34, `auto-publish-refused`, `2026-11-23 00:04:24`, `published_at NULL`. There is no contemporaneous publication record for ids 1–25. `article_revisions` likewise has **0 rows** for ids 1–25. No log can arbitrate the true date directly.
- **D1 `created_at` is seed time, not publication.** All 25 rows were bulk-created *after* every claimed publication date: ids 1–10 at `2026-11-12 17:19:54`, ids 11–20 at `2026-11-12 17:20:12`, ids 21–25 at `2026-11-13 08:40:43`. It proves the D1 rows were backfilled; it is not a publication date for any id. **Do NOT use `created_at` as a publication date anywhere.**
- **JSON-LD is not independent evidence.** `frontend/index.html` WebSite JSON-LD carries **no date at all**. The article-page JSON-LD (`frontend/pages/article.html:105`) is JS-generated as `datePublished: a.date` with **no `dateModified`** — and since the loader is static-wins for shared ids, served JSON-LD = the frontend static date on all 25. Backend `seo.js: structuredDataForArticle` would use the backend `publishedAt`, but it is **dead code** — grep finds no caller anywhere in the tree — so no served JSON-LD uses it.
- **Sitemap is not independent D1 evidence either.** `sitemapEntries()` (`backend/services/seo.js`) builds article `lastmod` from the **backend static fallback list** (`backend/routes/articles.js:105–129`), and `mergeLiveArticles()` in `scripts/regenerate-sitemap.mjs` explicitly *skips* any live D1 row whose loc is already listed — so the served sitemap can never reflect live D1 for ids 1–25. Sitemap lastmod = backend fallback `publishedAt` on all 25 (verified exact match).

### Disagreement counts (verified row by row from the table)
- Static vs D1 `published_at`: **disagree 23/25** (agree only ids 8 and 16). Deltas (static − D1): +9, +8, +7, +6, +4, +3, +1, 0, −2, −3, −5, −6, +4, +3, +1, 0, −2, −3, −5, −6, −8, −9, −10, −11, −12 days for ids 1–25.
- Static vs sitemap/seed: **disagree 23/25** (agree only ids 8, 16).
- **D1 vs sitemap/seed: disagree 2/25 — ids 1 and 2 only (D1 11-02 vs Set B 11-01); agree 23/25.** (An earlier draft "20/25" count was wrong; the table proves 2.)
- JSON-LD (= static) vs D1: disagree 23/25; vs sitemap: disagree 23/25.
- `created_at` vs every publication-date source: later by 1–13 days for all 25; never a publication date.

### Conclusion — which date is TRUE
**Rule: the TRUE first-publication date is the seed/backend/sitemap set (Set B) — 2 articles per day ascending 2026-11-01 → 2026-11-11, with ids 21–25 all on 2026-11-11.** Weighting: (1) no publication log exists, so the seed lineage is the best available origin record; (2) three sources agree on Set B — `seed.sql` (the actual source of the D1 rows), the backend fallback list, and the sitemap derived from it — against only live D1 for the variant, and live D1 is demonstrably a later backfill (created_at 11-12/11-13) whose `published_at` contradicts its own seed for 2 rows with no documented update; (3) the frontend static set is a synthetic-looking countdown — two descending runs (ids 1–12: 11-11→10-31; ids 13–25: 11-11→10-30), dates *decreasing* as id increases, dipping to 10-30 before any other source's earliest date — corroborated by nothing except coincidental agreement at ids 8 and 16. **Confidence: high but not absolute** — it is inference from seed lineage, not a contemporaneous log; the mechanism of D1's one-day slip for ids 1–2 is unknown and is an open question for A2, not an assumption.

**Per-article TRUE dates (Set B):** 1: 11-01, 2: 11-01, 3: 11-02, 4: 11-02, 5: 11-03, 6: 11-03, 7: 11-04, 8: 11-04, 9: 11-05, 10: 11-05, 11: 11-06, 12: 11-06, 13: 11-07, 14: 11-07, 15: 11-08, 16: 11-08, 17: 11-09, 18: 11-09, 19: 11-10, 20: 11-10, 21: 11-11, 22: 11-11, 23: 11-11, 24: 11-11, 25: 11-11. No article deviates from this rule.

### Exact before → after values A2 will need (nothing changed by this investigation)
If Set B is adopted as true:
- **`frontend/scripts/app.js` `date` (23 of 25 change; ids 8, 16 already correct):** 1: 11-11→**11-01**, 2: 11-10→**11-01**, 3: 11-09→**11-02**, 4: 11-08→**11-02**, 5: 11-07→**11-03**, 6: 11-06→**11-03**, 7: 11-05→**11-04**, 9: 11-03→**11-05**, 10: 11-02→**11-05**, 11: 11-01→**11-06**, 12: 10-31→**11-06**, 13: 11-11→**11-07**, 14: 11-10→**11-07**, 15: 11-09→**11-08**, 17: 11-07→**11-09**, 18: 11-06→**11-09**, 19: 11-05→**11-10**, 20: 11-04→**11-10**, 21: 11-03→**11-11**, 22: 11-02→**11-11**, 23: 11-01→**11-11**, 24: 10-31→**11-11**, 25: 10-30→**11-11**. This single fix also corrects the served JSON-LD `datePublished` (it reads `a.date`) and the on-page "Published …" line; no separate JSON-LD edit exists to make.
- **Live D1 `published_at` (only ids 1 and 2 change, each −1 day):** 1: 11-02→**11-01**, 2: 11-02→**11-01**. Ids 3–25 already match Set B.
- **Sitemap `lastmod`: no change needed** — already Set B on all 25 (but note: because the generator skips live D1 rows for listed locs, the sitemap will stay Set B regardless of any D1 fix; A2 should still regenerate/verify it after the static fix so the committed files match the generator output).
- **Backend fallback list (`backend/routes/articles.js`): no change needed** — already Set B on all 25.
- **`seed.sql`: no change needed** — already Set B; it is the source of truth for the D1 correction.
- **Caveat for A2's decision:** if A2 instead chose live D1 as true, the only consequence would be changing `seed.sql` + backend list + sitemap for ids 1–2 (11-01→11-02) — but that would mean the seed file that created the rows is wrong about its own first two rows while the frontend static set (which disagrees with D1 on 23/25) would still need correcting to D1. Set B requires the fewest, most consistent corrections: static 23 rows + D1 2 rows.

---

## A0.4 — Hard-coded "25 articles / 8 divisions / 20 tools": exhaustive list

Ground truth in code: `ARTICLES` = 25 static entries (ids 1–25, `app.js:86-111`); `DIVISIONS` = 8 (`app.js:75-84`); `TOOLS` = 20 entries (`app.js:114-135`). Per-division hard-coded counts in `DIVISIONS` (`app.js:76-83`: 12, 2, 2, 3, 2, 1, 2, 1 = 25) are rendered by `renderDivisions` (`app.js:439`) but are recomputed from the merged list in `applyLiveArticles` (`app.js:324-325`), so they self-correct after a live merge. All strings below are currently *true* for the static bundle; they go stale the moment a 26th article is published live (while the dynamic counters listed at the end would update).

### Homepage — `frontend/index.html` (all static HTML)
- `:10` meta description: `8 divisions, 25 free articles and 20 free tools.`
- `:16` og:description: same text.
- `:20` twitter:description: `8 divisions, 25 free articles and 20 free tools.`
- `:21` JSON-LD: `Zero-cost multi-niche platform: 8 divisions, 25 free articles and 20 free tools.`
- `:37` hero lead: `Eight divisions, free articles and free tools` (word "Eight", no numerals).
- `:48` hero stats: `<strong>8</strong> divisions · <strong>25</strong> articles · <strong>20</strong> free tools`
- `:59` search-results placeholder text: `Type to search all 25 articles.` — note: the search *input* placeholder itself (`:40`) is just `Search articles` (no number); the brief's "Type to search all N articles" phrasing matches this `<p>`, not the input.
- `:65` heading: `Eight divisions, one platform`
- `:72` "Latest articles" subhead: `25 articles across 8 divisions`
- `:79` tools link: `All 20 tools →`

### Other public pages (all static HTML unless noted)
- `frontend/pages/about.html:10` meta description: `25 articles across 8 divisions and 20 free tools.`; `:35` body: `25 articles across 8 divisions — Automotive, AI & Technology, … — plus 20 free tools (converters and calculators)…`
- `frontend/pages/dashboard.html:11` meta description: `25 articles, 8 divisions, 20 tools, 16 agents.`; `:202` body: `The 20 working tools on this site are the ones in the frontend catalogue; …`
- `frontend/pages/privacy.html:35`: `…using the 20 free tools needs no account…`
- `frontend/pages/terms.html:35`: `All 25 articles and all 20 tools on this site are free.`
- `frontend/pages/about.html` / `terms.html` / `privacy.html` counts are public-page copy (A1.5's generic-text rule covers the public pages; the dashboard is owner-only).
- `frontend/pages/tools.html:10` meta description: `20 free FS AI tools: …`; `:15` og:description: same; `:19` twitter:description: `20 free tools. No sign-up, no cost.`; `:20` JSON-LD: `20 free converters and calculators. No sign-up, no cost.`; `:34` lead: `20 converters and calculators. Free to use, no sign-up…`
- `frontend/404.html:7` meta description: `…browse the 8 divisions, or try one of the 20 free tools.`
- `frontend/pages/division.html:10` meta description / `:15` og:description: `All 8 FS AI divisions: Automotive, AI & Technology, …`; `:37` lead: `Eight divisions, one platform. Choose a division to see its articles.`
- `frontend/pages/article.html:62` JS-rendered not-found string: `Browse all 25 articles on the home page` (set via `innerHTML` in page script).
- `frontend/pages/contact.html`: no 25/8/20 count strings found.

### Non-rendered mentions (comments only — not user-visible)
- `frontend/pages/article.html:21,87`: comments about canonicals being "wrong for all 25 articles".
- `frontend/scripts/tools.js:1`: comment `all 20 free tools`.
- `frontend/scripts/app.js:245`: comment `the D1 rows for the existing 25 do NOT match the static bundle`.

### Dynamic counters — NOT hard-coded (these auto-update with the live merge)
- Footer, `frontend/scripts/app.js:414` (JS-generated): `'Articles: ' + ARTICLES.length + ' · Divisions: ' + DIVISIONS.length + ' · Tools: ' + TOOLS.length`.
- Search, `frontend/scripts/search.js:40` (JS, replaces the static `:59` text on input/preset query only): `'Type to search all ' + window.FSAI.ARTICLES.length + ' articles.'`
- Chart caption, `frontend/scripts/charts.js:55-56`: `F.ARTICLES.length + ' articles total'`.
- Dashboard KPIs, `frontend/scripts/dashboard.js:148,165,169,189`: `F.ARTICLES.length`, `F.DIVISIONS.length`, `F.TOOLS.length`.
- Mixed, `frontend/scripts/dashboard.js:444`: hard-coded `This site's 20 working tools are the frontend catalogue` + dynamic `' (' + F.TOOLS.length + ' tools)'`.
- `frontend/sitemap.xml:198` and `public/sitemap.xml:198`: last URL is `pages/article?id=25` — an implied count only, no count string. `public/` contains only `favicon.svg`, `robots.txt`, `sitemap.xml` (no HTML counts).

### A0.4 summary
Hard-coded count strings live in **8 files**: `frontend/index.html` (9 spots), `frontend/pages/about.html` (2), `dashboard.html` (2), `privacy.html` (1), `terms.html` (1), `tools.html` (5), `404.html` (1), `division.html` (3, incl. "All 8"), plus the JS string in `article.html:62`. The footer, search-after-typing, chart caption and dashboard KPIs are dynamic and would show 26+ automatically; the hero stats, all meta/OG/Twitter/JSON-LD descriptions, headings and body copy would stay at 25/8/20 until edited and redeployed.

---

## A0.5 — sitemap-refresh.yml: repo, schedule, inactivity risk

- **Repo:** public — `https://github.com/mdalfahad841-code/fs-ai` (public, main; verified via public raw.githubusercontent.com reads used throughout this project).
- **Could GitHub disable the hourly schedule after inactivity? YES.** GitHub's own documentation ("Disabling and enabling a workflow"; "Usage limits, billing, and administration"): *"In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days."* (docs.github.com). When it happens the workflow moves to state `disabled_inactivity`, runs simply stop, and nobody gets a failure notification. Any repository activity resets the 60-day clock; the workflow can be re-enabled from the Actions tab.
- **Is it enabled now, and when did it last run?** Last **verified** run: the manual force-run #1 on 2026-11-23 00:54 Dhaka (Success, 14 s, no commit — correct, sitemap unchanged). The repo has had frequent activity (deploys 22–23 Nov), so the 60-day rule is **not an immediate risk**. Whether the hourly scheduled runs since 00:54 fired is **NOT VERIFIED from here** — it needs the Actions tab or the API (GitHub REST API is rate-limited from this VM; no browser for the coordinator). Parent to confirm via browser. A5's staleness check (alert if the last successful run is older than 3 hours) and A7's workflow upkeep are the durable mitigations for this exact failure mode.

---

## Implications for the later items
- **A1.1:** fix the one-shot reveal snapshot (re-observe after every render; loading state; no-JS fallback).
- **A1.2:** internal wording lives on public pages — grep for `Revenue`, `GA4`, `Data unavailable`, agent counts; keep the GA4 tag; keep the info in the dashboard.
- **A1.3–A1.5:** newsletter flag (default OFF); 1200×630 og image to create locally; hero stats + search hint derived from the merged list; static meta/og/twitter/JSON-LD made generic (A0.4 is the exhaustive list to work from).
- **A1.6:** search hint moves under the search box; badge/circle spacing; Latest guide = max date + id-desc tie-break (A0.2).
- **A2:** adopt Set B (A0.3): static `date` fix for 23 rows + D1 `published_at` fix for ids 1–2 only; sitemap/backend/seed need no change; never touch article bodies; before/after table + one-statement rollback required.
- **A3:** note the served article JSON-LD is JS-generated from `a.date` with no `dateModified`, and backend `structuredDataForArticle` is dead code; non-JS crawler view is a known weakness to report.
- **A5/A7:** staleness alert for the sitemap-refresh schedule (A0.5's 60-day rule) + action-version upkeep.
