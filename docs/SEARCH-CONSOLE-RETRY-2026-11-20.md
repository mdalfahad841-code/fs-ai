# Search Console Retry — 2026-11-20 (18:35–18:37 Dhaka)

Owner-approved retry (his order "koro sob", 2026-11-20 18:34), after the Phase 3 final report. Account: mdalfahad841@gmail.com (Md.Al-Fahad) — the browser was initially signed in as mdalfahad406@gmail.com (no properties there) and switched to the saved 841 login, which worked with no two-step step. Property: the VERIFIED URL-prefix property https://fs-ai-5w5.pages.dev/ (not the sc-domain property).

## 1. Sitemap — re-submitted, still "Couldn't fetch"
- Before: Status "Couldn't fetch", Type "Unknown", Submitted Nov 20, 2026, Last read blank, Discovered pages 0, Discovered videos 0.
- Re-submit: entered "sitemap.xml", SUBMIT → "Sitemap submitted successfully — Google will periodically process it and look for changes."
- After (page reloaded): status UNCHANGED — still "Couldn't fetch", 0 pages, 0 videos. Google had not re-fetched it at that moment. The sitemap file itself is fine (200, valid XML, 60 URLs — verified live in Phase 3). This is the 6th submission with the same outcome.

## 2. Article 1 — still "URL is not on Google"
- URL taken from the live sitemap (first article `<loc>`, lastmod 2026-11-01): https://fs-ai-5w5.pages.dev/pages/article?id=1
- Inspection: "URL is not on Google" — "This page is not indexed." Detail: "Page is not indexed: URL is unknown to Google". Discovery: "No referring sitemaps detected", Referring page "None detected". Crawl / Last crawl / Crawled as / Crawl allowed / Page fetch / Indexing allowed: all "N/A". User-declared and Google-selected canonical: "N/A".

## 3. Request indexing — Quota Exceeded, 6th time
- Clicked ONCE, after the live-URL test. Dialog headed "Quota Exceeded": "Sorry — we couldn't process this request because you've exceeded your daily quota. Please try submitting this again tomorrow."
- Not clicked again. Next try: tomorrow, 2026-11-21 (the quota is daily; the 5th failure was 10:13 today).

## 4. Homepage — still indexed
- URL inspection: "URL is on Google" — "It can appear in Google Search results." Page indexing: "Page is indexed"; HTTPS: "Page is served over HTTPS".
- Overview still shows 0 total clicks, 1 not indexed page, 0 indexed pages — the Overview count is stale against URL Inspection (same discrepancy as 19 Nov).

## Verdict
No change from the last 5 attempts: sitemap accepted on submit but never fetched, Article 1 unknown to Google, indexing quota exhausted for today. Nothing was changed in Search Console besides the sitemap re-submit and the single indexing request. Signed in as mdalfahad841@gmail.com at the end (tab left open, signed in).

## Note — saved login for 841 worked
The saved Google login for mdalfahad841@gmail.com signed in successfully here (18:36, no two-step). The earlier standing note that both saved Google passwords are wrong was from the YouTube sign-in failures on 19 Nov; for a plain Google sign-in the 841 saved login worked today. The 406 saved password remains unverified-bad in this run (not tried).
