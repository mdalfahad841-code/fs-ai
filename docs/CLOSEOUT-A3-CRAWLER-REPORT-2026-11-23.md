# CLOSEOUT A3 — NON-JS CRAWLER REPORT — 2026-11-23

**Status:** A3 built + tests green (1408/0, 358 suites). This report is the
A3 deliverable on the non-JS crawler view. **Nothing in this report was
applied** — the proposed next step at the end is a proposal only.

## What a crawler that does not run JavaScript sees (evidence: raw curl, 2026-11-23)

All three pages return HTTP 200. The evidence below is from the live site
at the A2 deploy (HEAD 32b6c42); the A3 changes do not alter any static
tag, so the no-JS view is identical after the A3 deploy.

### Article page — `GET /pages/article?id=1` (curl, no JS)
- `<title>`: `Article — FS AI` (generic; the real title exists only after JS runs)
- meta description: `Read a free FS AI article.` (generic)
- canonical links: **0** (no `<link rel="canonical">` in the static HTML)
- `<meta property="og:url">` tags: **0**
- `<script type="application/ld+json">` tags: **0**
- `article:published_time` / `article:section` / `article:tag` metas: **0**
- Body: `<p class="muted">Loading article…</p>` — no article text at all.
- (Substring greps for `og:url` / `application/ld+json` DO hit the page:
  3 / 2 hits — but every hit is inside the inline `<script>` source and
  its explanatory comment, not a real tag. Tag counts above are the
  `<meta …>` / `<script type=…>` counts, which are 0.)

### Division page — `GET /pages/division?division=automotive` (curl, no JS)
- `<title>`: `Divisions — FS AI` (generic; the per-division title is JS-only)
- meta description / og:description: the generic all-divisions text
- canonical: `https://fs-ai-5w5.pages.dev/pages/division` (the BARE page —
  a crawler sees every `?division=` variant as the same page)
- og:url: the bare page (same as the canonical)
- JSON-LD: the static generic CollectionPage (`Divisions — FS AI`) — the
  per-division CollectionPage is JS-only.
- Body: `Loading divisions…` / `Loading articles…` — no division content.

### Tools page — `GET /pages/tools?tool=percentage` (curl, no JS)
- `<title>`: `Free Tools — FS AI` (generic; the per-tool title is JS-only)
- meta description / og:description: the generic all-tools text
- canonical: `https://fs-ai-5w5.pages.dev/pages/tools` (bare — every
  `?tool=` variant canonicalises to the same page for a no-JS crawler)
- og:url: the bare page.
- JSON-LD: the static generic WebPage block — the per-tool
  WebApplication block is JS-only.
- Body: the tool list/form shell renders only after JS runs.

## What a JS-running crawler / browser sees (after A3)
- Article: unique title, meta description, self-referencing canonical,
  og:title/description/url/image, twitter:title/description/image/card,
  `article:published_time` (= the Set B date), `article:section`
  (= division), `article:tag` (= category), Article JSON-LD
  (headline/description/datePublished/mainEntityOfPage/articleSection/
  author/publisher) + BreadcrumbList. Verified by tests in
  `tests/closeout-a3.test.js`, including a live-loaded article (id 26)
  that exists only in the merged list.
- Division: unique title, meta description, self-referencing canonical,
  og + twitter tags, per-division CollectionPage JSON-LD. The
  all-divisions view keeps the static generic tags (correct: its URL
  is the bare page).
- Tool: unique title, meta description, self-referencing canonical,
  og + twitter tags, per-tool WebApplication JSON-LD. A bare load
  (no `?tool=`) keeps the static generic tags + WebPage JSON-LD.

## Known limits (deliberate, not bugs)
- **No modified-date anywhere.** Neither the static bundle nor the live
  loader carries a modified date (D1 `updated_at` is not surfaced by
  `mapLiveArticle`), so no `dateModified` / `article:modified_time` is
  emitted. Inventing one would be false. The A2 test suite locks this
  in (`article.html` must not contain `dateModified`).
- **No per-article og:image.** There is one shared branded image
  (1200×630, A1.4); articles have no per-article image to use.
- **Social scrapers mostly do not run JS.** Facebook/Twitter/LinkedIn
  link preview fetchers read the static HTML: for an article URL they
  see the generic title/description and the shared og image, with NO
  og:url and NO canonical. Shared article links therefore preview
  generically until the step below is done.
- **Google is different:** Googlebot renders JavaScript, so it sees the
  JS-injected tags (subject to its render budget and timing). The
  weakness above bites hardest on social previews and on any crawler
  that skips JS.

## Proposed next step (DO NOT APPLY — proposal only)
Build-time static generation of the SEO-critical pages, keeping the
$0 static-hosting model:
1. A build script (run before each deploy, same step that regenerates
   the sitemap) reads the merged article list (static bundle + a live
   D1 export, or the live `GET /api/articles` endpoint) and writes one
   static HTML file per article (`pages/article-<id>.html` or a
   per-article directory) with the correct `<title>`, meta description,
   self-referencing canonical, og/twitter tags and Article JSON-LD
   baked in, plus the article body in a `<noscript>` block (or as
   server-rendered HTML) so a no-JS crawler sees the text too.
2. Same treatment for the 8 division pages and the 20 tool pages
   (smaller surface; same script).
3. The live loader stays as the runtime path (new articles still
   appear without a deploy); the generated files are the crawler
   surface. The sitemap already lists the `?id=` URLs, so the
   generated files must canonicalise to those URLs, not to their own
   filenames — or the sitemap + the generated filenames must be
   switched together, in one deploy, with redirects considered.
4. Estimated cost: $0 (a Node script in the repo + the existing deploy
   flow). Risk: the generated files can drift from the live data if a
   deploy is skipped after a D1 change — the A5 health report should
   gain a check that every published id has a matching generated file
   (a one-line addition to the A5 sitemap check).

Rejected alternatives: a Worker route that injects meta tags
server-side (works, but adds a runtime dependency on the Worker for
every page view and duplicates the Pages hosting); a Pages Function
(same cost, plus the Pages/Functions routing the project has avoided).
