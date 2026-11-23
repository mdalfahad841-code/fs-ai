# Search Console — sitemap resubmit + indexing requests

Date: 2026-11-23. Owner-only steps. Do NOT act on this doc by itself —
it is the instruction sheet for the owner (or for the assistant on the
owner's explicit go-ahead for a specific step).

## Why now

Fix Pass 2 item 2 shipped (run #58, HEAD 1b52f98): the site now serves
server-side heads for crawlers — per-article title, canonical, og:url,
Article JSON-LD, `datePublished` and a noscript body — without any
JavaScript. Before this, a no-JS crawler saw only the generic "Article —
FS AI" head. The sitemap is still the discovery path, and it is the
thing that is stuck (see below), so resubmitting it now is the right
moment.

## Current state (checked 2026-11-23 11:00 Dhaka, Search Console)

Property: https://fs-ai-5w5.pages.dev/ — signed in as
mdalfahad841@gmail.com.

- **Sitemap /sitemap.xml:** status **"Couldn't fetch"** — detail
  "Sitemap could not be read". Submitted Nov 22, 2026. Last read
  11/22/26. Discovered pages **0**. Type Unknown. The sitemap itself is
  fine (checked 22 Nov: HTTP 200, valid XML, 60 URLs, all 60 URLs return
  200, zero redirects, robots Allow-all) — the Console status is the
  stale 11/20 fetch. It has not been resubmitted since.
- **Overview / Pages (last update 11/16/26):** Indexed **0**. Not
  indexed **1**. 0 total clicks, 3 total impressions. No crawl errors.
  Only not-indexed reason: "Crawled - currently not indexed", 1 page —
  the homepage https://fs-ai-5w5.pages.dev/ (last crawled Nov 18, 2026;
  first detected 11/17/26).
- **Article 1** (https://fs-ai-5w5.pages.dev/pages/article?id=1): live
  test 23 Nov 10:58 — "URL is available to Google", "Page can be
  indexed". Request indexing clicked once → **"Quota Exceeded"** —
  "Sorry--we couldn't process this request because you've exceeded your
  daily quota. Please try submitting this again tomorrow." **This is the
  8th consecutive quota hit** (the 7th was 22 Nov); the quota did NOT
  clear after the expected overnight reset. Do NOT keep retrying it in
  the same day.
- **Article 6** (https://fs-ai-5w5.pages.dev/pages/article?id=6):
  "URL is not on Google" / "Page is not indexed: URL is unknown to
  Google". Indexing NOT requested for it yet. Its canonical was verified
  correct (the per-article URL, not the homepage).

## Step 1 — resubmit the sitemap (once)

1. Open Google Search Console, property https://fs-ai-5w5.pages.dev/
   (sign in as mdalfahad841@gmail.com if asked).
2. Left menu → **Sitemaps**.
3. If the /sitemap.xml row still shows "Couldn't fetch", click the row
   to open it, then use **Resubmit** (or remove it and add it again with
   the URL `https://fs-ai-5w5.pages.dev/sitemap.xml`).
4. Expect the status to stay "Couldn't fetch" for a while — Google
   re-reads on its own schedule (hours to days). **Do NOT resubmit it
   repeatedly**; one resubmission is enough, then wait.
5. What success looks like: status becomes "Success", "Discovered
   pages" rises above 0 (the sitemap lists 60 URLs: 25 articles + 8
   divisions + tools + static pages). If it still says "Couldn't
   fetch" after 3–4 days, tell the assistant — the sitemap itself is
   verified healthy, so a persistent failure is a Console-side problem
   to investigate, not a site fix.

Note: the sitemap is regenerated automatically — a GitHub Actions
workflow (`sitemap-refresh.yml`) runs hourly and commits a new sitemap
only when something changed, so a newly published article joins the
served sitemap within about an hour of publication.

## Step 2 — request indexing, ONE URL per day

The quota is the binding constraint: Article 1 has hit "Quota
Exceeded" 8 days running, and the quota did not reset overnight on
23 Nov. So:

1. Left menu → **URL Inspection**.
2. Paste ONE article URL, e.g. `https://fs-ai-5w5.pages.dev/pages/article?id=1`.
3. Click **Request indexing** once. If the "Quota Exceeded" dialog
   appears, STOP for the day — do not retry it, do not request a
   different URL the same day.
4. Suggested order (one per day, only on days the quota allows):
   Article 1 first (already verified "available to Google"), then the
   newest articles (25, 24, 23 …), then the rest. The homepage is
   already known to Google ("Crawled - currently not indexed") — do not
   spend a quota request on it.
5. What success looks like: "Indexing requested" (no quota dialog),
   and 1–3 days later the URL Inspection status changes to "URL is on
   Google". "Crawled - currently not indexed" after that means Google
   crawled it and chose not to index it yet — that is a Google decision
   (content quality, time), not an error to fix by re-requesting.

## How to read the results

- **Pages report** (left menu → Indexing → Pages): "Indexed" should
  rise from 0; "Not indexed" lists the reasons. "Crawled - currently
  not indexed" is the common one for a new small site — it usually
  clears over weeks as Google re-crawls, it is not fixed by clicking
  more.
- **URL Inspection** per article: "URL is on Google" = indexed;
  "URL is not on Google" = not yet; the live test ("Test live URL")
  shows whether Google can render the page — since item 2, the live
  test should show the per-article title/canonical/JSON-LD even before
  indexing.
- **Sitemaps**: "Discovered pages" is the count Google found in the
  sitemap — 0 means it has not read it yet.
- **Performance** (left menu → Performance): clicks/impressions appear
  only after pages are indexed; 0 clicks / 3 impressions (23 Nov) is
  the current baseline.

## What NOT to do

- Do not request indexing for many URLs in one day — the quota is
  small and shared across the property; one per day is the safe pace.
- Do not resubmit the sitemap more than once — repeated resubmission
  does not speed Google up.
- Do not treat "Crawled - currently not indexed" as a site bug — the
  site is verified healthy (200s, valid sitemap, correct canonicals,
  server-side heads). It is Google's scheduling/quality decision.
- Do not pay anyone for "indexing services" — there is no paid shortcut
  that helps here, and the zero-investment rule forbids it anyway.

## If something looks wrong

- Sitemap still "Couldn't fetch" after 3–4 days → tell the assistant
  (the sitemap file itself is verified healthy; the next step is a
  Console-side check, not a site change).
- Quota still exceeded after several days → keep to one request per
  day; the quota is per-property and resets on Google's schedule, not
  on a fixed clock the owner controls.
- A live test says "Page cannot be indexed" (not "available to
  Google") → tell the assistant immediately — that would be a new
  technical problem, unlike the quota issue.
