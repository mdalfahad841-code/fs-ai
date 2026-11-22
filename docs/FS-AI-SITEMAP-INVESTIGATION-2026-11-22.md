# Sitemap "Couldn't fetch" — Investigation (22 November 2026)

**Date:** 2026-11-22, ~19:38–19:45 Dhaka
**Brief:** owner's autonomous order — investigate why the resubmitted sitemap still reports "Couldn't fetch"; verify sitemap HTTP response, XML validity, robots.txt, URL accessibility and canonical consistency; do NOT repeatedly resubmit an unchanged sitemap; retry Article #1 indexing at the scheduled 23 Nov 11:00 (subject to quota); monitor Article #6; never claim indexing success without Search Console confirmation; record actual indexed URL counts and crawl errors; continue monitoring without unnecessary owner approval.
**Method:** direct HTTP checks from this VM (curl + Python urllib, no redirect-following for the first pass), plus repo inspection. No Search Console visit was made for this investigation — Console-side numbers (indexed counts, crawl errors, Article 6 status) are recorded at the scheduled 23 Nov 11:00 run.

## 1. Sitemap HTTP response — CLEAN

- URL: https://fs-ai-5w5.pages.dev/sitemap.xml
- **HTTP 200**, 10,007 bytes, `Content-Type: application/xml`, **no redirect**, fetched in 1.18s.
- No `_redirects` or `_headers` file exists anywhere under `frontend/` that could alter the sitemap response.

## 2. XML validity — CLEAN

- Parses as valid XML (sitemaps.org 0.9 namespace).
- **60 URLs**: home + 9 division pages + articles 1–25 + 21 tools pages + 4 static pages. First: `https://fs-ai-5w5.pages.dev/`; last: `https://fs-ai-5w5.pages.dev/pages/terms`. 25 URLs carry `<lastmod>`.
- No malformed entries, no empty `<loc>`, no non-HTTP(S) URLs.

## 3. robots.txt — CLEAN

- URL: https://fs-ai-5w5.pages.dev/robots.txt — **HTTP 200**, 153 bytes, `text/plain`.
- Content: `User-agent: *`, `Allow: /`, and `Sitemap: https://fs-ai-5w5.pages.dev/sitemap.xml`. Nothing is disallowed; no crawler-specific block.

## 4. URL accessibility — CLEAN (the old defect is gone)

- **All 60 sitemap URLs return HTTP 200. Zero redirects. Zero errors.**
- This directly re-tests the defect found in the 19–20 Nov verification (Phase 2/3): sitemap article URLs then 308-redirected to their clean form. That defect is FIXED — no sitemap URL redirects today.

## 5. Canonical consistency — TWO NOTES (neither blocks the sitemap fetch)

- **Home page:** canonical present in static HTML — `https://fs-ai-5w5.pages.dev/` — matches its sitemap URL.
- **Division pages:** the sitemap lists query URLs (`/pages/division?division=automotive` etc.). The STATIC HTML carries the bare canonical (`/pages/division`, division.html:11) — but the page's JavaScript, when a valid division loads, rewrites the canonical to the self-referencing query URL (`/pages/division?division=` + div.id, division.html:75,83–85). The 22 Nov browser run observed the title "Automotive — FS AI", which is set in the same `if (div)` branch, so the branch runs and the RENDERED canonical is self-referencing. (CORRECTED 22 Nov 20:04 — an earlier draft of this note read the static HTML only and said the canonical was bare.) A consistency note, not a fetch blocker.
- **Article pages (1, 6, 25):** NO canonical tag in the static HTML fetched by a plain HTTP client — the canonical is injected by JavaScript after load. Search Console's live test (22 Nov 12:16 PM) renders JS and read Article 6's declared canonical as `https://fs-ai-5w5.pages.dev/pages/article?id=6` — CORRECT per-article canonical. Googlebot renders JavaScript, so this is not expected to block indexing, but it is a fragility: server-rendered canonicals would be safer. It does NOT explain a sitemap "Couldn't fetch" — the sitemap file itself is what Google failed to read, not the article pages.

## 6. Diagnosis: why "Couldn't fetch"?

**No current technical blocker was found.** The sitemap is fetchable (200), valid XML, declared in robots.txt, and every URL it lists returns 200 without redirects.

The Console status seen at 22 Nov 12:17 — "Couldn't fetch", "Sitemap could not be read", Last read 11/20/26, Discovered 0 — most plausibly reflects Google's last fetch attempt on **20 November**, before the resubmission. The resubmission (22 Nov ~12:1x) was accepted ("Sitemap submitted successfully"), but Google had not re-read the file yet at 12:17 — the status shown was the stale 11/20 result, not a fresh failure.

What failed on 11/20 cannot be re-verified from the current file: the sitemap has changed since (the Phase 2/3 canonical + redirect fixes landed 20 Nov), and the 11/20 fetch predates or coincides with those fixes. The old 308-redirect defect is a credible cause for the 11/20 failure; it is gone today.

**The real test is Google's next fetch.** Per the owner's order, the sitemap is NOT resubmitted again while unchanged — resubmitting an unchanged file does nothing. The 23 Nov 11:00 run reads the sitemap status, discovered pages and last-read date from Console; if Google's re-read then still fails, that is a fresh failure with a fresh cause to investigate.

## 7. What is scheduled (23 November)

- **11:00 Dhaka** — runonce cron `fs-ai-search-console-article1-retry` (updated 22 Nov 19:4x for this brief): (1) sitemap status / discovered pages / last read, exactly as shown — no resubmission; (2) Overview / Pages figures — total indexed, total not-indexed, crawl errors with counts and example URLs; (3) Article 6 URL Inspection status (monitoring only, no indexing request); (4) Article 1 URL Inspection + live test if needed + Request indexing ONCE, subject to quota — a quota message is reported verbatim and the run stops; (5) report to the user in romanized Bangla. No indexing claim without Console evidence.
- The 07:00 daily-run verification cron is unchanged and separate.

## 8. Recorded Console numbers (latest, 22 Nov 12:17)

- Sitemap: "Couldn't fetch", Submitted Nov 22, 2026 (resubmitted that day), Last read 11/20/26, Discovered pages 0.
- Overview: 0 total web search clicks, 1 not indexed page, 0 indexed pages. Homepage indexed (established earlier; Overview figure stale against URL Inspection).
- Article 1: "URL is not on Google" / "Page is not indexed: URL is unknown to Google"; live test "URL is available to Google" / "Page can be indexed"; indexing request 22 Nov → "Quota Exceeded" (7th attempt).
- Article 6: not indexed; canonical verified correct via live test; no indexing requested.
- Next numbers are recorded at the 23 Nov 11:00 run (see §7).
