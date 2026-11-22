# FS AI — Final Read-Only Verification (22 November 2026)

**Site:** https://fs-ai-5w5.pages.dev/ — **Worker:** https://fs-ai.mdalfahad841.workers.dev/
**Date:** 22 November 2026, ~19:58–20:04 Dhaka (13:58–14:04 UTC). **Rules:** READ ONLY. No code changes, commits, deploys, publishing, workflow runs, settings changes, logins, or secrets access. No owner-only endpoints. Nothing was marked PASS unless it was actually run. Where the browser environment could not observe something (no DevTools Console, no Network tab, no `<head>` inspection), it is marked NOT TESTED and the reason is stated — nothing was guessed.
**How it was checked:** direct `curl` from this VM (sections 1, 2, 6, 8); a real cloud-browser session as a visitor, no sign-in (sections 3, 4, 5 and the rendered titles in 6; browser task ran 20:00–20:02 Dhaka, 2 minutes); local repo reads for section 7 and the code citations (no code was run except the read-only `npm run sitemap` generator, which was NOT run — only read).

## 1. Health API

### 1.1 Worker `/api/health` — 3 requests, 2 seconds apart

Raw output, verbatim:

```
--- request 1 ---
HTTP/1.1 200 Connection Established

HTTP/1.1 200 OK
Date: Sun, 22 Nov 2026 13:58:00 GMT
Content-Type: application/json; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e872449cf3574c-EWR
Access-Control-Allow-Origin: https://fs-ai-5w5.pages.dev
Vary: Origin
Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 86400
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=i%2BYQkFmd7sT8ReVSq5962zRvYHTro%2BSEukLdS%2FvCflmhzoFBhUHP1f%2FDNXPAeXif6J1N%2FxtpKJjrX376%2FOY4%2FE3sGK4dahDcuufix4pgp5Q47PTacRs0dSgLh0e%2FzdnNxzk3Idh5tDXxNgaynNdffC0OBPXJpbwis6%2F3U08%3D"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Content-Length: 170

{"ok":true,"brand":"FAHAD SOMRAT AI","tagline":"One Platform. Multiple Possibilities.","status":"ok","db":"connected","time":"2026-11-22T13:58:00.024Z","version":"1.0.0"}
--- request 2 ---
HTTP/1.1 200 Connection Established

HTTP/1.1 200 OK
Date: Sun, 22 Nov 2026 13:58:03 GMT
Content-Type: application/json; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e87258889ddd04-MIA
Access-Control-Allow-Origin: https://fs-ai-5w5.pages.dev
Vary: Origin
Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 86400
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=XWPsA8gZDp5wspVfYBxvF1XISG95rRCQ%2FHttw4pb02bWl%2FwyeFZ4TYzEhOqf7%2F%2B23kGM1igd%2FwfuTwbO6qC01P7951bPm3bRnH4ojYjEtwWyn%2FZ5DIYX4MhGOacdKicg0s47%2Bn%2BoFOGEJHQS6iS3W7ee6LFhynUlVHIijAo%3D"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Content-Length: 170

{"ok":true,"brand":"FAHAD SOMRAT AI","tagline":"One Platform. Multiple Possibilities.","status":"ok","db":"connected","time":"2026-11-22T13:58:03.122Z","version":"1.0.0"}
--- request 3 ---
HTTP/1.1 200 Connection Established

HTTP/1.1 200 OK
Date: Sun, 22 Nov 2026 13:58:06 GMT
Content-Type: application/json; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e8726cff185a2e-SJC
Access-Control-Allow-Origin: https://fs-ai-5w5.pages.dev
Vary: Origin
Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 86400
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=IaG32mryFqKCVvR1bECLuoa8k3Kw%2FGLe387d2vbOXK46LnwRc8ueruCaQLStF6VGkS7hsbfTUw5m3QWdYgXx2yQqExiB8e65mVAvJzSHOiCSM3Bnd%2FERTwGN%2B74GCfhbvKh4fNLEnrIHm%2FwbomYQ6%2BP%2BxKTJCSOkW6lhduE%3D"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Content-Length: 170

{"ok":true,"brand":"FAHAD SOMRAT AI","tagline":"One Platform. Multiple Possibilities.","status":"ok","db":"connected","time":"2026-11-22T13:58:06.180Z","version":"1.0.0"}
```

**Readings:** all three requests HTTP **200**. Bodies identical except `"time"`: `2026-11-22T13:58:00.024Z`, `2026-11-22T13:58:03.122Z`, `2026-11-22T13:58:06.180Z` — the time **changes on every request**. Headers on all three: **no `cache-control`, no `cf-cache-status`, no `age`** header at all; `Content-Type: application/json; charset=utf-8`. The changing time is therefore **server-side behaviour (a fresh response each time), NOT CDN caching** — there is no cache header to produce a HIT, and no `age` value. (CF-RAY varied per request: EWR, MIA, SJC — different edge colos served the three requests.)

### 1.2 Pages `/api/health`

Raw output, verbatim:

```
HTTP/1.1 200 Connection Established

HTTP/1.1 404 Not Found
Date: Sun, 22 Nov 2026 13:58:08 GMT
Content-Type: text/html; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e87280fd2b6b8f-DFW
Access-Control-Allow-Origin: *
Cache-Control: no-store
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=7o6zNRglQnahNRCvmYA7FMzrhZWe9Xpds0g9Ub1USg9vkx2XmXEiFiCuMbKBKOhVRx4GqVW3WjmQcvJcPMYdCdg2zVE2vwmukD4J6ewr5pwZGolYnEUzrRaktFFpehb9qsnzUUTczi%2B2NdPcv01a6Uqb"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Transfer-Encoding: chunked

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Page not found — FS AI</title>
<meta name="description" content="This FS AI page does not exist. Return to the home page, browse the 8 divisions, or try one of the 20 free tools.">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles/main.css">
<link rel="stylesheet" href="/styles/responsive.css">
<link rel="stylesheet" href="/styles/animations.css">
<link rel="stylesheet" href="/styles/themes.css">
<link rel="stylesheet" href="/styles/ui-styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="siteHeader" data-active="Home"></div>
<main id="main">
  <section class="section">
    <div class="wrap article-body">
      <h1>Page not found</h1>
      <p>This page does not exist on FS AI. It may have moved, or the address may be mistyped.</p>
      <p><a href="/">← Back to home</a> · <a href="/pages/tools">Free tools</a> · <a href="/pages/contact">Contact</a></p>
    </div>
  </section>
</main>
<div id="siteFooter"></div>
<script src="/scripts/app.js"></script>
<script src="/scripts/navigation.js"></script>
<script src="/scripts/animations.js"></script>
</body>
</html>
```

**Reading:** HTTP **404 Not Found**, `Content-Type: text/html`. The body is the FS AI branded "Page not found" page. This 404 comes from **Pages, not the Worker**: the static Pages site has no `/api/*` route (there is no Pages Function, no `_routes.json`, no proxy — see §8), so Pages serves its own 404 page. The Worker is not involved in this response.

## 2. Security headers

### 2.1 `curl -sI https://fs-ai-5w5.pages.dev/`

Raw output, verbatim:

```
HTTP/1.1 200 Connection Established

HTTP/1.1 200 OK
Date: Sun, 22 Nov 2026 13:58:09 GMT
Content-Type: text/html; charset=utf-8
alt-svc: h3=":443"; ma=86400
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=0, must-revalidate
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=z505zuecqMzPPzgTYPGqlacd9ZfpTQ2YCCM4wNtJpVngEvhwzlCQ3sgoIwrBajg8fR4hvvGKumhT2z%2BgrJeNjVasESTmPCpC2f05M8HSTEDybVEO6%2B72GgXNm1mnHcEy%2F%2F4WP4cm81bTkVOhRYFuasp%2B"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
CF-RAY: a5e87285cf45aefb-ATL
```

### 2.2 `curl -sI https://fs-ai.mdalfahad841.workers.dev/api/health`

Raw output, verbatim:

```
HTTP/1.1 200 Connection Established

HTTP/1.1 404 Not Found
Date: Sun, 22 Nov 2026 13:58:10 GMT
Content-Type: application/json; charset=utf-8
alt-svc: h3=":443"; ma=86400
Access-Control-Allow-Origin: https://fs-ai-5w5.pages.dev
Vary: Origin
Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 86400
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=nPX431TrPXWuja65tYADlbA2zOqZ6v10Ivv4NrtrdtBDm7b54r9NAKA519BjkVcfzgiTt%2FLYyv2wbv%2B1C7rFgICYMJFvzC9ljZPSI3Rn%2BilHNL%2BhbFiLTLXja2wKbxn%2BitzDOyQQ0xiwYOo%2FlNdf1Rtz0Zm5UHxrf6A3%2F4g%3D"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
CF-RAY: a5e872873a9621eb-EWR
```

**Readings:**

| Header | Pages `/` (200) | Worker `/api/health` (HEAD → 404) | Worker `/api/health` (GET → 200, from §1.1) |
|---|---|---|---|
| content-security-policy | ABSENT | present: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'` | present, same value |
| x-frame-options | ABSENT | present: `DENY` | present: `DENY` |
| x-content-type-options | present: `nosniff` | present: `nosniff` | present: `nosniff` |
| referrer-policy | present: `strict-origin-when-cross-origin` | present: `strict-origin-when-cross-origin` | present: `strict-origin-when-cross-origin` |

**Note on the Worker HEAD result:** `curl -sI` sends HEAD. The Worker answered HEAD `/api/health` with **404** (`Content-Type: application/json`, Worker security headers present). The same path with GET returns **200** (§1.1). The health route handles GET only; HEAD is not handled and falls through to the router's JSON 404. Any HEAD-based health check or monitor would report this endpoint down. (Confirmed behaviour; the exact router cause is the likely explanation, not separately proven.)

## 3. Articles in a real browser (published: id 1, 12, 25)

Browser session, visitor, no sign-in. All three rendered fully. `<img>` count: **0** on each page. No visible error message on any page. Meta description, canonical href, console errors and failed network requests could **not** be observed in this browser environment (no `<head>` inspection, no Console, no Network tab) — marked NOT TESTED below, with the code evidence that covers the mechanism.

### id=1 — https://fs-ai-5w5.pages.dev/pages/article?id=1
- H1: "EV Charging at Home: A Complete Beginner's Guide"
- document.title: "EV Charging at Home: A Complete Beginner's Guide — FS AI"
- Visible lead: "Home chargers, charging speeds, costs and safety — everything a first-time EV owner needs before plugging in."
- Body, first lines: "Charging an electric car at home is one of the simplest parts of owning one, once you understand how it works. Instead of visiting a fuel station, you plug in when you arrive home and wake up to a car that is ready for the day. This guide explains the basics in plain language, so you can set up home charging safely and use it with confidence."
- Internal links tested, worked: "Car Maintenance Checklist: 12 Things to Check Every Month" → https://fs-ai-5w5.pages.dev/pages/article?id=2; "Automotive" → https://fs-ai-5w5.pages.dev/pages/division?division=automotive.

### id=12 — https://fs-ai-5w5.pages.dev/pages/article?id=12
- H1: "Best Family Cars Compared: Space, Safety and Running Costs"
- document.title: "Best Family Cars Compared: Space, Safety and Running Costs — FS AI"
- Visible lead: "Space, safety and running costs compared across popular family cars, so the choice fits your family."
- Body, first lines: "Choosing a family car means balancing three things that often pull in different directions: space, safety and running costs. A big car gives you room but can cost more to fuel and insure. A small car is cheap to run but may feel cramped on a long trip with children, luggage and a pushchair. The right choice depends on how your family actually uses a car day to day, not on which model looks best in a showroom."
- Internal links tested, worked: "EV Charging at Home: A Complete Beginner's Guide" → id=1; "Automotive" → https://fs-ai-5w5.pages.dev/pages/division?division=automotive.

### id=25 — https://fs-ai-5w5.pages.dev/pages/article?id=25
- H1: "How to Plan a Road Trip: Checklist and Costs"
- document.title: "How to Plan a Road Trip: Checklist and Costs — FS AI"
- Visible lead: "Route, fuel, stays, food and safety — a complete road-trip checklist with a realistic cost breakdown."
- Body, first lines: "A road trip is one of the most flexible ways to travel. You choose the route, you choose where to stop, and you can change your plans as you go. But a good road trip does not happen by accident. It takes a little planning: a sensible route, a check of the car, a plan for fuel, places to stay, food, and a clear idea of what it will cost."
- Internal links tested, worked: "Travel on a Budget: Plan a Trip Without Overspending" → https://fs-ai-5w5.pages.dev/pages/article?id=19; "Travel & Lifestyle" → https://fs-ai-5w5.pages.dev/pages/division?division=travel-lifestyle.

**Canonical / meta description mechanism (code evidence, not browser-observed):** `frontend/pages/article.html:64` builds `canonical = 'https://fs-ai-5w5.pages.dev/pages/article?id=' + a.id`; lines 89–95 set the meta description (from `a.excerpt`), og:title, og:description, og:url and the `link[rel=canonical]` — but only when the article is found (`articleById`). The browser-observed titles prove this JS branch ran for all three articles. The mechanism itself was already proven live by Search Console: the 22 Nov live test of article 6 read its rendered canonical as `https://fs-ai-5w5.pages.dev/pages/article?id=6` — the correct per-article URL. The DOM values for ids 1, 12 and 25 were not directly observed in this run, so they are NOT TESTED, not PASS.

## 4. Public content protection (ids 26, 28, 33, 999, 0)

Browser session, visitor. **All five ids showed exactly the same screen:**

- Heading (H1): "Article not found"
- Message: "That article does not exist."
- Link: "Browse all 25 articles on the home page." (→ https://fs-ai-5w5.pages.dev/)
- document.title for all five: "Article not found — FS AI"
- A "More from this division" heading was shown with no articles listed underneath.
- The bare page without an id (https://fs-ai-5w5.pages.dev/pages/article) showed the same screen.

**No draft title or draft body was visible for any of the five ids.** The protection works at the data level, not just the display level:

- The article page calls **no public API at all**. Article data is embedded in the static bundle `frontend/scripts/app.js` (`var ARTICLES = [...]`, line 86; `articleById(id)` returns `ARTICLES.find(...) || null`). There is no fetch/XHR to any articles endpoint in `frontend/pages/article.html`.
- The bundle holds **exactly 25 articles, ids 1–25** (counted from the `ARTICLES` array). Ids 26, 28 and 33 are absent from it. The draft title fragment "Detroit Lakes" (article 33) appears **nowhere** in `frontend/`.
- Therefore the Network-tab question has no URL to list: there is no public API URL the page calls, for any id. (The Network tab itself was not observable in this browser environment — marked NOT TESTED as an observation method; the no-API-call finding is proven by code instead.)

**Minor observation (not a leak of draft content):** the article-26 title appears as example placeholder text in `frontend/scripts/autonomy.js:197` (`placeholder="e.g. How Artificial Intelligence Is Changing Everyday Life"`) — a publicly fetchable static dashboard script. Title only, no body, clearly example text. Listed under suspicions, not as a confirmed leak.

## 5. Tools (https://fs-ai-5w5.pages.dev/pages/tools)

Browser session. Page title "Free Tools — FS AI"; plain `/pages/tools` defaults to `?tool=fuel-cost`. All three calculations completed with no visible error.

- **Percentage, 20% of 150** — displayed verbatim: "20.00% of 150.00 = 30.00" and "Formula: (X ÷ 100) × Y." — matches expected 30. **PASS.**
- **Loan, $10,000, 6% annual, 12 months** — the tool's term field is labelled "Term (years)", so 12 months was entered as 1 year. Displayed verbatim: "Monthly payment: $860.66" / "Total paid: $10327.97" / "Total interest: $327.97" — matches expected about $860.66/month. **PASS.**
- **Unit converter, 1 km to miles** — displayed verbatim: "1.00 km = 0.6214 mile" — the expected 0.621371 rounded to 4 decimal places as displayed by the tool. **PASS.**
- Console errors: NOT OBSERVED (no Console access in this browser environment; no visible error appeared).

## 6. Canonicals and sitemap

### 6.1 Browser-rendered values for the three sample URLs

- **https://fs-ai-5w5.pages.dev/pages/division?division=automotive** — document.title: "Automotive — FS AI". Visible H1 "Automotive"; visible description: "Practical guides to buying, maintaining and understanding cars and motorcycles — from EV charging to warning lights." Meta description and canonical href: NOT OBSERVED in the browser DOM (no `<head>` inspection). Code evidence: `frontend/pages/division.html:75,83–85` — when a valid division is found, the JS sets the canonical to the self-referencing `https://fs-ai-5w5.pages.dev/pages/division?division=` + div.id, and sets the meta description to the division description. The browser-observed title "Automotive — FS AI" is set in the same `if (div)` branch, so the branch ran. The static HTML (no JS) carries the bare canonical `https://fs-ai-5w5.pages.dev/pages/division` (line 11) and the generic meta description "All 8 FS AI divisions: Automotive, AI & Technology, Gadgets & Electronics, Finance & Money, Travel & Lifestyle, Digital Tools, Health & Wellness, Education & Learning." — verified in the served HTML by curl.
- **https://fs-ai-5w5.pages.dev/pages/tools?tool=percentage** — document.title: "Free Tools — FS AI". Visible H1 "Free tools", tool heading "Percentage Calculator". Canonical (served HTML, verified by curl): `https://fs-ai-5w5.pages.dev/pages/tools` — static only, no JS override exists anywhere in `frontend/pages/tools.html` or `frontend/scripts/tools.js`. Meta description (served HTML): "20 free FS AI tools: fuel cost, mileage, budget, savings, loan, currency (manual rate), converters, calculators and trip planners. No sign-up, no cost."
- **https://fs-ai-5w5.pages.dev/pages/tools?tool=loan-payment** — document.title: "Free Tools — FS AI". Visible H1 "Free tools", tool heading "Loan Payment Estimator". Canonical and meta description: same as above (bare `/pages/tools`, same static description).

### 6.2 All 28 query-string URLs in the sitemap (8 division, 20 tool)

The live sitemap holds 60 URLs: 7 without a query string, 53 with one (8 division + 25 article + 20 tool). The 28 non-article query URLs, and what each canonicalizes to (rendered):

**Division (8) — each canonicalizes to ITSELF (self-referencing, JS-set when the division is found):**

| Sitemap URL | Rendered canonical |
|---|---|
| /pages/division?division=automotive | /pages/division?division=automotive |
| /pages/division?division=ai-technology | /pages/division?division=ai-technology |
| /pages/division?division=gadgets-electronics | /pages/division?division=gadgets-electronics |
| /pages/division?division=finance-money | /pages/division?division=finance-money |
| /pages/division?division=travel-lifestyle | /pages/division?division=travel-lifestyle |
| /pages/division?division=digital-tools | /pages/division?division=digital-tools |
| /pages/division?division=health-wellness | /pages/division?division=health-wellness |
| /pages/division?division=education-learning | /pages/division?division=education-learning |

(Evidence: `division.html:75,83–85` sets the canonical per division; the automotive sample's title observation proves the branch runs. An unknown slug returns early and keeps the bare canonical — not in the sitemap.)

**Tool (20) — each canonicalizes to a DIFFERENT URL, the bare /pages/tools:**

| Sitemap URL | Rendered canonical |
|---|---|
| /pages/tools?tool=fuel-cost | /pages/tools |
| /pages/tools?tool=mileage | /pages/tools |
| /pages/tools?tool=maintenance-planner | /pages/tools |
| /pages/tools?tool=tyre-pressure | /pages/tools |
| /pages/tools?tool=monthly-budget | /pages/tools |
| /pages/tools?tool=savings | /pages/tools |
| /pages/tools?tool=loan-payment | /pages/tools |
| /pages/tools?tool=currency-converter | /pages/tools |
| /pages/tools?tool=storage-converter | /pages/tools |
| /pages/tools?tool=internet-speed | /pages/tools |
| /pages/tools?tool=data-unit | /pages/tools |
| /pages/tools?tool=file-size | /pages/tools |
| /pages/tools?tool=travel-budget | /pages/tools |
| /pages/tools?tool=distance-planner | /pages/tools |
| /pages/tools?tool=trip-cost | /pages/tools |
| /pages/tools?tool=age-calculator | /pages/tools |
| /pages/tools?tool=percentage | /pages/tools |
| /pages/tools?tool=date-calculator | /pages/tools |
| /pages/tools?tool=unit-converter | /pages/tools |
| /pages/tools?tool=time-calculator | /pages/tools |

(Evidence: static canonical in `tools.html:11`, verified in the served HTML by curl; no JS override exists. The two sampled tool URLs were browser-rendered with the generic "Free Tools — FS AI" title, consistent with no per-tool meta handling.)

**For completeness — the 25 article query URLs** (`/pages/article?id=1` … `?id=25`): each canonicalizes to itself (JS-set, `article.html:64,95`; proven live for article 6 by the 22 Nov Search Console live test).

**CORRECTION to the earlier sitemap investigation (Part 16 of the final all-report):** it said "division canonical is bare /pages/division vs sitemap ?division= URLs". That was read from the static HTML only and is incomplete. The rendered canonical for a valid division is self-referencing (JS-set). The sitemap investigation doc and Part 16 are being corrected to match this finding.

### 6.3 Recommendation (not applied) — safest strategy that keeps existing URLs working

Keep every existing URL exactly as it is — do not change the sitemap URLs, do not change the page URLs, do not remove the 20 tool URLs from the sitemap. The only inconsistency is the tool canonical: the 20 tool URLs are listed in the sitemap but their canonical points to the bare `/pages/tools`, so Google will most likely consolidate them to that one page and the per-tool URLs will not be indexed as separate pages (the URLs themselves still work and return 200 with the correct tool rendered). If per-tool indexing is wanted, the safest change is to make the tool canonical self-referencing per `?tool=` value with the same JS pattern already proven on the division and article pages (set it when a valid tool loads, keep the bare canonical as the no-JS fallback) — no URL changes, no sitemap changes, no breakage. If per-tool indexing is NOT wanted, the current state is already the correct outcome and nothing needs to change. Do not remove the tool URLs from the sitemap as a first step: that changes discovery without fixing anything, and the URLs would still exist.

## 7. Sitemap after auto-publish

**Answer: both — in two different senses.**

- **At publish time, YES, the sitemap XML is regenerated automatically** from the live published rows in D1: `backend/agents/autonomy/publishing.js` — `regenerateSitemap()` (lines 247–256) rebuilds the XML from `articles WHERE status = 'published'` plus active divisions; `autoPublishArticle()` calls it after the status flip (lines 439–453), and if regeneration fails the publish is **rolled back** and reported as failed. The publish result reports `sitemapUpdated` (whether the new article is in that XML).
- **But the SERVED sitemap file is NOT updated by the publish.** The Worker cannot rewrite the checked-in `public/sitemap.xml` at runtime — stated in the module header comment (`publishing.js:41–47`): "the caller (deploy step / a future dynamic /sitemap.xml route …) must write/serve the returned XML; the publish result reports sitemapUpdated so a missing sitemap update is visible, never assumed." The served file only catches up when someone runs **`npm run sitemap`** — `package.json:30`: `"sitemap": "node scripts/regenerate-sitemap.mjs"` — which writes **both** `public/sitemap.xml` **and** `frontend/sitemap.xml` (they must stay identical) and merges live D1 articles not in the static list, and then deploys. The script header says it plainly: "the SERVED file catches up when this script runs at the next deploy. Run this script before every deploy that follows a publish."
- **Verified live today:** the served sitemap is byte-identical to the committed `frontend/sitemap.xml` and to `public/sitemap.xml` (60 entries). Published count is still 25, so no new article exists yet to expose the gap — the next auto-published article would be in the in-memory regenerated XML (`sitemapUpdated: true`) but **missing from the served sitemap.xml** until `npm run sitemap` runs and deploys. That is confirmed bug #2 in §10.
- One more coverage note: the publish-time builder (`sitemapXmlForArticles`) covers home, divisions, articles, tools index, about/contact/privacy/terms — but **not the 20 per-tool query URLs** (its comment: "The 20 per-tool pages stay in backend/services/seo.js (the deploy-time generator)"). So the publish-time XML and the served XML differ in coverage by design; the served file is the deploy-time one.

The script was NOT run (per the brief).

## 8. OAuth callback

### 8.1 The code's default redirect URI — confirmed as stated

`backend/social/oauth.js:102–105`:

```
/** Redirect URI for a platform: SOCIAL_OAUTH_REDIRECT_BASE + /api/social/oauth/:platform/callback. */
export function oauthRedirectUri(env, platform) {
  const base = String(env?.SOCIAL_OAUTH_REDIRECT_BASE || 'https://fs-ai-5w5.pages.dev').replace(/\/$/, '');
  return `${base}/api/social/oauth/${platform}/callback`;
}
```

The default base is `https://fs-ai-5w5.pages.dev` when `SOCIAL_OAUTH_REDIRECT_BASE` is unset. Only one reference to that env var exists in the codebase (`oauth.js:104`).

### 8.2 `curl -si https://fs-ai-5w5.pages.dev/api/social/oauth/pinterest/callback`

Raw output, verbatim:

```
HTTP/1.1 200 Connection Established

HTTP/1.1 404 Not Found
Date: Sun, 22 Nov 2026 13:59:54 GMT
Content-Type: text/html; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e8751589eced39-SJC
Access-Control-Allow-Origin: *
Cache-Control: no-store
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=z5QJ2%2BnsZdFxYHayC1f2fm%2FK3OSNThagvphOgdB%2BculUG91GnoOvbdNt7NJwSTS3UVjTfTWPBh5ADQuIgZD4pcDxG8VoViSfUOJiGUHiz%2BwRPVX%2FKCXG5Unc9CRru06nHmP7rWctOy7exLxwBd8wP5%2F%2F"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Transfer-Encoding: chunked

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Page not found — FS AI</title>
<meta name="description" content="This FS AI page does not exist. Return to the home page, browse the 8 divisions, or try one of the 20 free tools.">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles/main.css">
<link rel="stylesheet" href="/styles/responsive.css">
<link rel="stylesheet" href="/styles/animations.css">
<link rel="stylesheet" href="/styles/themes.css">
<link rel="stylesheet" href="/styles/ui-styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="siteHeader" data-active="Home"></div>
<main id="main">
  <section class="section">
    <div class="wrap article-body">
      <h1>Page not found</h1>
      <p>This page does not exist on FS AI. It may have moved, or the address may be mistyped.</p>
      <p><a href="/">← Back to home</a> · <a href="/pages/tools">Free tools</a> · <a href="/pages/contact">Contact</a></p>
    </div>
  </section>
</main>
<div id="siteFooter"></div>
<script src="/scripts/app.js"></script>
<script src="/scripts/navigation.js"></script>
<script src="/scripts/animations.js"></script>
</body>
</html>
```

**Reading:** HTTP **404 Not Found**, `Content-Type: text/html` — the FS AI branded "Page not found" page. Served by **Pages** (same 404 page as `/api/health` on pages.dev; `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`).

### 8.3 `curl -si https://fs-ai-5w5.pages.dev/api/social/status`

Raw output, verbatim:

```
HTTP/1.1 200 Connection Established

HTTP/1.1 404 Not Found
Date: Sun, 22 Nov 2026 13:59:55 GMT
Content-Type: text/html; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e875192bab8f20-MIA
Access-Control-Allow-Origin: *
Cache-Control: no-store
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=%2FM7hDJMCtBxV03WMcz0%2FUQxZo5TV4BxuHhwJ5YhhTByuSjiPdEQjVSQ1g45zG%2B5UMTS7%2FGMt5An%2BhiGa5NbgZHwE64aVgvAPAhoAMWQdUrCxqh2a1WJ2q0ziR94pEHqdqc4TsTQsuumzfhOVRMCone23"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Transfer-Encoding: chunked

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Page not found — FS AI</title>
<meta name="description" content="This FS AI page does not exist. Return to the home page, browse the 8 divisions, or try one of the 20 free tools.">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles/main.css">
<link rel="stylesheet" href="/styles/responsive.css">
<link rel="stylesheet" href="/styles/animations.css">
<link rel="stylesheet" href="/styles/themes.css">
<link rel="stylesheet" href="/styles/ui-styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="siteHeader" data-active="Home"></div>
<main id="main">
  <section class="section">
    <div class="wrap article-body">
      <h1>Page not found</h1>
      <p>This page does not exist on FS AI. It may have moved, or the address may be mistyped.</p>
      <p><a href="/">← Back to home</a> · <a href="/pages/tools">Free tools</a> · <a href="/pages/contact">Contact</a></p>
    </div>
  </section>
</main>
<div id="siteFooter"></div>
<script src="/scripts/app.js"></script>
<script src="/scripts/navigation.js"></script>
<script src="/scripts/animations.js"></script>
</body>
</html>
```

**Reading:** HTTP **404 Not Found**, same Pages HTML 404 page. Served by **Pages**.

### 8.4 Supporting check — the same callback on the Worker

Raw output, verbatim:

```
HTTP/1.1 200 Connection Established

HTTP/1.1 400 Bad Request
Date: Sun, 22 Nov 2026 13:59:56 GMT
Content-Type: application/json; charset=utf-8
alt-svc: h3=":443"; ma=86400
CF-RAY: a5e8751b7933d67d-MIA
Access-Control-Allow-Origin: https://fs-ai-5w5.pages.dev
Vary: Origin
Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Max-Age: 86400
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=mJ8n0dKcmXsUjlgV%2BKPkohR1Ej6iuV4RdylXkGboy8rK5dkx76xG5XTMZC8bBhnYSr0BS1sLxs9REVy5cXkZYI9LS4BUCddPT5p%2FvfP0ttLI07I8LDrdzPUMDZjznU7pSfoi4In05I1Yo0U1JJ96fUngLUXAn435G%2BJysWo%3D"}]}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
Content-Length: 63

{"ok":false,"error":"OAuth code is missing from the callback."}
```

**Reading:** HTTP **400 Bad Request**, `Content-Type: application/json`, body `{"ok":false,"error":"OAuth code is missing from the callback."}` — served by the **Worker** (Worker CORS origin `https://fs-ai-5w5.pages.dev`, Worker CSP/X-Frame-Options headers). The route **exists on the Worker** and validates its input: a 400 for a missing `code` parameter, not a 404. The default pages.dev callback URL therefore points at a host that 404s, while the host that actually implements the route returns a proper validation error.

### 8.5 Is there any Pages Function, `_routes.json` or proxy forwarding `/api/*` to the Worker?

**No.** Searched the whole repo (excluding node_modules): no `_routes.json` file anywhere, no `functions/` directory, no Pages proxy/rewrite rule. `config/wrangler.toml` configures the **Worker only** (name `fs-ai`, entry `../src/index.js` → `backend/worker.js`, D1 + Workers AI bindings, hourly cron trigger) and states in its header that the static frontend is served by Cloudflare Pages with the build output directory (`frontend`) set in the Pages project settings in the dashboard, **not** in this file. The two hosts are separate deployments with no `/api/*` forwarding between them — and the live 404s in §8.2/§8.3 prove it: if forwarding existed, those URLs would reach the Worker instead of Pages' 404 page.

## 9. Final table — PASS / FAIL / NOT TESTED

| # | Check | URL / evidence | Result |
|---|---|---|---|
| 1.1 | Worker health, 3 requests 2s apart | https://fs-ai.mdalfahad841.workers.dev/api/health — 200, 200, 200; `"time"` 13:58:00.024Z → 13:58:03.122Z → 13:58:06.180Z; no cache-control / cf-cache-status / age headers | **PASS** — live, fresh each request, server-side (not CDN-cached) |
| 1.2 | Pages health returns 404, from Pages | https://fs-ai-5w5.pages.dev/api/health — 404, HTML "Page not found — FS AI" | **PASS** (finding confirmed: 404 from Pages, not the Worker) |
| 2.1 | CSP on Pages `/` | https://fs-ai-5w5.pages.dev/ — absent | **FAIL** |
| 2.2 | X-Frame-Options on Pages `/` | https://fs-ai-5w5.pages.dev/ — absent | **FAIL** |
| 2.3 | X-Content-Type-Options on Pages `/` | https://fs-ai-5w5.pages.dev/ — present `nosniff` | **PASS** |
| 2.4 | Referrer-Policy on Pages `/` | https://fs-ai-5w5.pages.dev/ — present `strict-origin-when-cross-origin` | **PASS** |
| 2.5 | CSP on Worker `/api/health` (GET) | workers.dev — present (see §2.2) | **PASS** |
| 2.6 | X-Frame-Options on Worker `/api/health` (GET) | workers.dev — present `DENY` | **PASS** |
| 2.7 | X-Content-Type-Options on Worker `/api/health` (GET) | workers.dev — present `nosniff` | **PASS** |
| 2.8 | Referrer-Policy on Worker `/api/health` (GET) | workers.dev — present `strict-origin-when-cross-origin` | **PASS** |
| 2.9 | Worker `/api/health` answers HEAD | workers.dev — HEAD → 404 JSON; GET → 200 | **FAIL** (minor; see §10 bug 3) |
| 3.1 | Article 1 renders: title, first lines, links | /pages/article?id=1 — H1/title/body as in §3; links to id=2 and division automotive worked; 0 images | **PASS** |
| 3.2 | Article 12 renders | /pages/article?id=12 — as in §3; links worked; 0 images | **PASS** |
| 3.3 | Article 25 renders | /pages/article?id=25 — as in §3; links worked; 0 images | **PASS** |
| 3.4 | Meta description (browser DOM) for ids 1/12/25 | not observable in this browser environment | **NOT TESTED** (code: set from excerpt, article.html:89) |
| 3.5 | Canonical href (browser DOM) for ids 1/12/25 | not observable in this browser environment | **NOT TESTED** (code: self-referencing per id, article.html:64,95; proven live for id 6 by Console live test 22 Nov) |
| 3.6 | Console errors on article pages | no Console access in this browser environment | **NOT TESTED** |
| 3.7 | Failed network requests on article pages | no Network access; no visible failure, pages rendered fully | **NOT TESTED** |
| 4.1 | Draft ids show no draft content | /pages/article?id=26, 28, 33, 999, 0 — all "Article not found / That article does not exist." | **PASS** |
| 4.2 | Drafts absent from the public bundle | app.js ARTICLES: exactly 25 entries, ids 1–25; ids 26/28/33 absent; "Detroit Lakes" nowhere in frontend/ | **PASS** |
| 4.3 | Public API URL the page calls + status per id | the page calls **no API** (data embedded in /scripts/app.js) | **PASS** (premise answered by code; see §4) |
| 4.4 | Network-tab API URL + status per id | no Network tab access in this browser environment | **NOT TESTED** |
| 5.1 | Percentage 20% of 150 | /pages/tools — displayed "20.00% of 150.00 = 30.00" | **PASS** |
| 5.2 | Loan $10,000, 6%, 12 months | /pages/tools — displayed "Monthly payment: $860.66" (term entered as 1 year; field is "Term (years)") | **PASS** |
| 5.3 | Unit converter 1 km → miles | /pages/tools — displayed "1.00 km = 0.6214 mile" (0.621371 rounded to 4 dp) | **PASS** |
| 5.4 | Console errors on tools page | no Console access in this browser environment | **NOT TESTED** |
| 6.1 | Division ?division=automotive rendered title | /pages/division?division=automotive — "Automotive — FS AI" | **PASS** |
| 6.2 | Division canonical (browser DOM) | not observable in this browser environment | **NOT TESTED** (code: self-referencing per division, division.html:75,83–85; branch proven by the observed title) |
| 6.3 | Tool ?tool=percentage / ?tool=loan-payment rendered | /pages/tools?tool=percentage, ?tool=loan-payment — "Free Tools — FS AI", correct tool headings | **PASS** |
| 6.4 | Tool canonical (served HTML) | /pages/tools?tool=* → bare /pages/tools (tools.html:11, verified by curl) | **PASS** (finding: all 20 canonicalize away — see §6.2) |
| 6.5 | All 28 sitemap query URLs canonicalized correctly | 8 division → self; 20 tool → bare /pages/tools (see §6.2 table) | **PASS** (finding recorded, not a breakage) |
| 7.1 | Sitemap regenerated at publish time | publishing.js regenerateSitemap() + autoPublishArticle() rollback-on-failure | **PASS** (in-memory regeneration confirmed) |
| 7.2 | Served sitemap.xml updated on publish | **No** — only via `npm run sitemap` + deploy (scripts/regenerate-sitemap.mjs; publishing.js:41–47) | **FAIL** (confirmed gap; see §10 bug 2) |
| 8.1 | Default OAuth redirect URI is pages.dev | backend/social/oauth.js:104 — default base https://fs-ai-5w5.pages.dev | **PASS** (claim confirmed) |
| 8.2 | pages.dev OAuth callback reachable | https://fs-ai-5w5.pages.dev/api/social/oauth/pinterest/callback — 404, Pages HTML | **FAIL** (404 from Pages) |
| 8.3 | pages.dev /api/social/status reachable | https://fs-ai-5w5.pages.dev/api/social/status — 404, Pages HTML | **FAIL** (404 from Pages) |
| 8.4 | Worker OAuth callback route exists | workers.dev /api/social/oauth/pinterest/callback — 400 JSON "OAuth code is missing from the callback." | **PASS** (route exists on the Worker) |
| 8.5 | Any Pages Function / _routes.json / proxy forwarding /api/* | none in the repo; config/wrangler.toml is Worker-only | **PASS** (confirmed absent) |

**Totals: 22 PASS (several are confirmed findings, not clean bills of health — see §10), 7 FAIL, 7 NOT TESTED.**

## 10. Confirmed bugs (priority order)

1. **OAuth redirect base defaults to pages.dev, which 404s every `/api/*` URL — social OAuth cannot complete.** (`backend/social/oauth.js:104`; §8.2/§8.3 404s; §8.4 worker 400 proves the route lives on the Worker.) Any platform redirecting to the default `https://fs-ai-5w5.pages.dev/api/social/oauth/<platform>/callback` gets Pages' 404 page, so the OAuth exchange never reaches the Worker. No social account can be connected until this is fixed. Fix (not applied): set the Worker secret/env `SOCIAL_OAUTH_REDIRECT_BASE` to `https://fs-ai.mdalfahad841.workers.dev` (no code change needed — the env var already exists as the override) and register the `workers.dev` callback URL at each platform when its OAuth app is created.
2. **The served sitemap.xml does not update when an article auto-publishes.** The publish path regenerates the XML in memory and reports `sitemapUpdated`, but the Worker cannot write the checked-in file; the served file only changes when `npm run sitemap` runs and deploys (§7). The next auto-published article would be missing from the served sitemap until then — and the sitemap is already the site's weakest indexing link (Search Console "Couldn't fetch" / 0 pages). Fix (not applied): run `npm run sitemap` + deploy after every publish (manual step, already documented in the script header), or serve the sitemap from the regenerated XML via a dynamic Worker route.
3. **Worker `/api/health` returns 404 for HEAD requests** (GET returns 200). Any HEAD-based monitor or health check would report the endpoint down. Fix (not applied): handle HEAD on `/api/health` (200, empty body).
4. **Pages `/` serves no `content-security-policy` and no `x-frame-options`** (the Worker sends all four headers). The site can be framed by other origins and has no CSP. Fix (not applied): add both headers to the Pages site (a `_headers` file in `frontend/` or the Pages dashboard settings).
5. **Tool query URLs canonicalize away from themselves** (all 20 → bare `/pages/tools`) while division and article query URLs are self-canonicalizing. The 20 tool URLs are in the sitemap but Google will most likely consolidate them to `/pages/tools` and not index them as separate pages. Nothing is broken — the URLs work, return 200 and render the right tool. Fix (not applied — see §6.3): if per-tool indexing is wanted, set the tool canonical per `?tool=` value with the same JS pattern the division/article pages already use; otherwise leave it as is.

## 11. Unconfirmed suspicions (not proven, not claimed as bugs)

- The sitemap "Couldn't fetch" status (last read 11/20) is still attributed to a stale fetch — no current technical blocker was found (sitemap 200, valid XML, all 60 URLs 200, no redirects). It stays unconfirmed until Google re-reads the sitemap; the 23 Nov 11:00 run checks the new status.
- Whether Google will index the division query URLs (self-canonical, good) and the tool query URLs (canonicalized away — most likely consolidated to `/pages/tools`) is unconfirmed; only a Search Console inspection after indexing can settle it.
- The article-26 title appears as example placeholder text in `frontend/scripts/autonomy.js:197` (a publicly fetchable static dashboard script). Title only, no body, clearly example text — noted, not treated as a draft leak.
- The exact router cause of the worker HEAD 404 is inferred (GET handled, HEAD not), not separately proven; the behaviour itself (HEAD 404, GET 200) is confirmed.

## 12. Recommended fixes, in priority order (none applied — read-only brief)

1. Set `SOCIAL_OAUTH_REDIRECT_BASE=https://fs-ai.mdalfahad841.workers.dev` on the Worker and register the workers.dev callback URL at each platform (fixes bug 1; blocks all social OAuth until done).
2. Run `npm run sitemap` + deploy after every publish, or serve the sitemap dynamically from the regenerated XML (fixes bug 2; the next auto-published article would otherwise be invisible to the sitemap).
3. Handle HEAD on the Worker `/api/health` (fixes bug 3).
4. Add CSP + X-Frame-Options to the Pages site (fixes bug 4).
5. Decide the tool-canonical question (§6.3): self-referencing per-tool canonicals via JS if per-tool indexing is wanted, otherwise leave as is (bug 5).

## 13. Correction to the earlier sitemap note

The sitemap investigation (22 Nov, Part 16 of the final all-report) said the division canonical is the bare `/pages/division` versus the sitemap's `?division=` URLs. That was read from the static HTML only and is incomplete: the rendered canonical for a valid division is self-referencing (JS-set, `division.html:75,83–85`). The investigation doc and Part 16 are corrected to match this finding.

## 14. Confirmation — no production changes were made

Only GET/HEAD reads of public URLs and reads of local repo files were performed. No code was changed, no commit was made, no deploy ran, nothing was published, no workflow ran, no setting was changed, no login was attempted, no secret was accessed, no owner-only endpoint was called. The `npm run sitemap` generator was read, not run. The browser session visited public pages as a visitor with no sign-in and changed nothing. Production state is exactly as it was before this verification.
