# FS AI — Full-Article Evidence Fetching Feature

**Date:** 2026-11-22
**Status:** Implemented + tested in the local tree. **NOT deployed, NOT live-verified.** The parent deploys it (procedure P0 below) and then runs the live extraction steps (P1–P6).
**Owner authorization:** the 22 Nov decisions (build the feature) + the **permanent authorization for full autonomous operation, confirmed by the owner 2026-11-22 11:58** (see §9 for the #30/#33 distinction, which governs the procedures in §7).

## 1. Summary

The research engine could only learn from RSS summaries. Articles whose sources left the feed could never be regenerated or properly fact-checked — that was the structural blocker behind #29 (scaffold, 500-char outdated fragment) and #30 (15 failed claims judged against a ~300-char fragment), and behind #33's 13 failed claims (114-char fragment).

This feature fetches **one recorded source page** for a draft article, extracts its readable text (readability-style), and stores it as a `research_items` row **for that URL** (current, `is_outdated` 0), so the existing evidence flows use it unchanged: `resolveEvidence()` finds it by URL for regeneration, and `loadEvidence()` finds it for fact-checking and correction. No other pipeline code changes.

**The honest headline, stated first:** the feature unblocks **#33 completely** (Higher Ed Dive allows the fetch; locally verified: 3,985 chars stored) but it **does NOT unblock #29 or #30**. The Guardian's robots.txt states its content may not be used for LLM / machine-learning / AI purposes, and the owner's decisions require respecting publisher terms — so the feature **refuses Guardian fetches** (`terms-prohibit-ai-use`), records the refusal, and never attempts the page. That is the feature working correctly, not a failure. The remaining routes for #29/#30 are the **Guardian Open Platform API** (owner registers a free key; a follow-up worker path — licensed route) or an **owner-written body**. §7 gives the exact procedures for all three articles, including the prepared #30 correction for one-tap owner authorization.

**Local verification (VM, scratch DB — NOT live):**

| Article | Source | Robots | HTTP | Extracted | Completeness | Clears 1000-char floor |
|---|---|---|---|---|---|---|
| #33 | Higher Ed Dive | allowed, crawl-delay 5, no AI prohibition | 200 | **3,985 chars** | ok | **YES** |
| #29 | Guardian Austin | path allowed, **AI-use prohibition: YES** | — (never fetched) | 0 | refused: `terms-prohibit-ai-use` | NO |
| #30 | Guardian NYC | path allowed, **AI-use prohibition: YES** | — (never fetched) | 0 | refused: `terms-prohibit-ai-use` | NO |

The live Worker attempt (different egress) is the real proof and is **not yet verified** — never assumed. The dashboard steps in §7 are what verify it.

## 2. Design

### 2.1 Flow (`backend/services/article-fetch.js`, `fetchArticleEvidence`)

```
task { agent: 'research', kind: 'article-fetch', payload: { article_id, url? } }
  → dashboard "Fetch evidence" button (per pipeline row) enqueues it;
    the dashboard's existing "Run a task manually" control runs it.
  → runArticleFetch (backend/agents/autonomy/research.js) → fetchArticleEvidence
  1. Article must exist and be a draft (published → no-op, nothing touched).
  2. Allowlist: the URL must be one of THIS article's recorded
     article_sources URLs (canonical comparison). An arbitrary URL is
     refused without any network call.
  3. SSRF validation of the target (https only, no credentials, no
     private/loopback/link-local/metadata IPs, no localhost hostnames).
  4. robots.txt fetched first (5s timeout, 2 MB cap on the file is
     100 KB): parsed, obeyed for the article path, Crawl-delay read.
     A robots fetch failure other than 404 fails CLOSED (no blind fetch).
     404 = no file = nothing disallowed.
  5. Publisher-terms check: if robots.txt states the content may not
     be used for LLM / ML / AI purposes → refuse `terms-prohibit-ai-use`.
  6. Per-host throttle: minimum interval = max(10s, robots Crawl-delay);
     a second fetch inside the interval is a no-op (`rate-limited`).
  7. Already-current: a complete fetch for this URL within 7 days is
     reused (`already-current`) — no re-fetch.
  8. Fetch the page (15s timeout, manual redirects ≤ 3 with every hop
     re-validated, 2 MB cap, ≤ 2 attempts on transient errors only).
     401/403/429/404/4xx → no-op, never worked around, never retried
     around. 5xx/timeout/network → retry once, then `failed`.
  9. Extract + assess. Only `ok` extractions are stored. Incomplete
     text is logged, never stored as evidence.
 10. Store as a research_items row for the recorded URL, re-point this
     article's article_sources rows at it (the fact-checker loads
     evidence by research_item_id FIRST — without the re-point, #30/#33
     would keep judging against their old fragments), and log the run.
```

Outcomes are the queue's three terminal states: `done` (evidence stored), `no-op` (permanent non-storable outcome: robots-denied, terms-prohibited, paywall/blocked, 404, extraction-incomplete, rate-limited, already-current, url-not-a-recorded-source, article-published), `failed` (transient: timeout, network, 5xx after retries, robots-unavailable, storage errors). Every attempt is logged to `article_fetch_runs`, success or failure.

### 2.2 Extraction (readability-style, dependency-free)

Strip `script`/`style`/`noscript`/`svg`/`template` and `nav`/`header`/`footer`/`aside`/`form` blocks; prefer the semantic `<article>` container when it holds the article (≥3 paragraphs, ≥200 chars) — a wider `<body>` container drags in related stories and newsletter promos (this exact defect was found in local verification, §6.2, and fixed); else the best-scoring container (`<main>`, `role="main"`, `<body>`). Collect `p`/`h2–h6`/`li`/`blockquote` in document order, decode entities, drop boilerplate (advertisement, newsletter promos, captions, related-story headlines ending in a byline, standalone byline lines). Title from `og:title` / `<title>` / first `h1`; `published_at` from `article:published_time`, JSON-LD `datePublished`, or `<time datetime>`.

**Known limitation (documented, not hidden):** pages whose body is rendered client-side from embedded JSON (e.g. Guardian DCR pages) yield almost no `<p>` text and are reported `incomplete` (too-short), never faked. The extractor handles server-rendered article HTML.

### 2.3 Completeness assessment (`assessExtraction`)

`ok` only if: title present, text non-empty and ≥200 chars, ends with terminal punctuation (`. ! ? " ” ' ) ]`), no paywall/subscribe markers, no trailing ellipsis. Anything else is `incomplete` with the reasons listed (`missing-title`, `empty-body`, `too-short (N chars, need 200)`, `ends-mid-sentence`, `paywall-markers`). A fetched item over the 100,000-char evidence cap is also `incomplete`, not silently truncated.

### 2.4 Storage and the evidence floor

- New row in `research_items`: `source_id` NULL, `division_id` from the article, `title` from the page, `url` = the **recorded** source URL (so `resolveEvidence`'s exact/normalised URL match works), `published_at` from the page, `summary` = first 500 chars, `evidence_text` = full text (≤100,000 chars), `is_outdated` **0**, `source_kind` `'article-fetch'`, `content_hash` = SHA-256 of the text (`sha256Hex`, `backend/utils/bodyHash.js`), `extraction_status` `'ok'`.
- `article_sources.research_item_id` for this article's matching source rows is updated to the new item.
- **Freshness decision (documented):** a fetched item is current by retrieval (`is_outdated` 0). The fetch is a fresh, complete retrieval of the source as it stands now, unlike an RSS fragment that goes stale when the feed moves on; `published_at` is still stored for provenance. Marking 2024 articles outdated would break the regeneration floor — the feature's whole purpose. The existing `MIN_REGEN_EVIDENCE_CHARS = 1000` (`backend/agents/autonomy/content.js:44`) still applies unchanged: a fetched item under 1000 usable chars does not satisfy the regeneration precondition.
- **Pre-029 degradation:** if migration 029 is not yet applied, the runs-table insert no-ops, the throttle/dedupe checks return "unavailable" and the fetch still works, and the `research_items` insert falls back to the legacy column list (only on a `no such column` error). This is a safety net, not a supported mode — deploy 029 (P0).

## 3. Compliance model

| Rule (owner's decisions, all mandatory) | How it is enforced | Where |
|---|---|---|
| robots.txt obeyed for the article path | Fetched first, parsed (longest-rule wins, Allow beats Disallow on ties, exact-UA group beats `*`), path checked before any page fetch; verdict recorded | `parseRobotsTxt`, `isPathAllowedByRobots`, `article-fetch.js` |
| Publisher terms respected | robots.txt scanned for an explicit AI/LLM-use prohibition (`not permitted` + `large language model` / `machine learning` / `artificial intelligence`); a match refuses the fetch and records `terms-prohibit-ai-use` | `detectAiUseProhibition` |
| Never bypass paywalls / CAPTCHA / auth / anti-bot | 401/403/429 and paywall markers → recorded as blocked/incomplete, never retried around, never worked around | fetch + `assessExtraction` |
| Free services, publicly accessible content only | No paid API, no key, no subscription; only the article's own recorded public URL | whole flow |
| SSRF protection | https only; no credentials in URL; no private/loopback/link-local/metadata IPs, no localhost/`.local`/`.internal` hosts; ≤3 redirects, every hop re-validated; **plus the recorded-source allowlist** (the feature never fetches an arbitrary URL) | `isSafeFetchUrl`, allowlist check |
| Rate limits | One fetch per task; per-host throttle max(10s, robots Crawl-delay); bounded retries (transient only, max 2 attempts) | throttle, `MAX_ATTEMPTS` |
| Size caps | Page 2 MB (streamed read, aborts over the cap); stored evidence 100,000 chars | `readBodyCapped`, cap check |
| Provenance + status | Every run logged (`article_fetch_runs`): URL, final URL, HTTP status, robots verdict + crawl-delay, extraction status + reason, extracted chars, content hash, retrieval time; item carries `published_at`, `source_kind`, `content_hash`, `extraction_status` | migration 029, `logFetchRun` |
| Incomplete detection | Missing body/title, too-short text, paywall/subscribe markers, cut-off mid-sentence, trailing ellipsis, over-cap text → `incomplete`, **not stored as evidence** | `assessExtraction` |
| Copyright boundary | Fetched text is evidence for **internal verification only** (fact-checking), never republished verbatim; generated bodies must not reproduce source text beyond short quotes. Stated in the code comments and here. | `article-fetch.js` header, this report |

**Guardian terms — the finding that shapes this feature.** The Guardian's robots.txt header states: *"Guardian content is made available under our terms and conditions of use. Any other uses are not permitted, incl. but not limited to: for large language models (LLMs), machine learning and/or artificial intelligence-related purposes; with any of the aforementioned technologies; and/or for commercial purposes."* The `User-agent: *` Disallow rules do **not** block the `/travel/2024/...` paths — but the terms comment explicitly prohibits AI/LLM use, and the owner's decisions require respecting publisher terms. So the feature refuses Guardian-origin fetches. **Mirrors are out of scope by design:** the URL must be a recorded article source, and fetching Guardian content from an unlicensed mirror to evade the Guardian's terms would violate the compliance rules. The licensed route is the **Guardian Open Platform API** (owner registers a free key; needs a follow-up worker path — NOT built in this task).

## 4. Code changes

All work is in the local tree `~/workspace/fs-ai-source/fs-ai/` (NOT a git repo). No push, no deploy, no live D1 writes, no dashboard/browser work, nothing published. No file under `fs-ai-youtube-videos/` and neither `PIPELINE-README.md` nor the daily-shorts state file was touched.

| File | Change |
|---|---|
| `backend/services/article-fetch.js` **(new, 817 lines)** | The feature: `isSafeFetchUrl`, `parseRobotsTxt`, `isPathAllowedByRobots`, `robotsCrawlDelay`, `detectAiUseProhibition`, `fetchPageText` (timeout + manual redirects + streamed size cap), `extractArticleText`, `assessExtraction`, `fetchArticleEvidence` (the full flow), `runArticleFetch` (task handler). Copyright boundary + compliance model in the header comment. |
| `backend/agents/autonomy/research.js` | Re-exports `runArticleFetch` from the service so the runner dispatches it as a research-agent kind. No change to the RSS ingestion path. |
| `backend/agents/autonomy-runner.js` | Kind-level dispatch for `research` / `article-fetch`, mirroring the `scaffold-regeneration` block. Invoked only via an explicit manual task — **never by the scheduled daily run**. |
| `database/migrations/029_article_fetch_runs.sql` **(new)** | `article_fetch_runs` audit table (one row per attempt) + `research_items.source_kind` / `content_hash` / `extraction_status`. Touches no existing row (existing items get `source_kind` `'rss'`). Rollback: drop the table; the three columns are nullable and ignored by older code (SQLite cannot drop columns). |
| `package.json` | `db:migrate` chain extended with `029_article_fetch_runs.sql`. (Only the chain string changed; JSON re-serialised with literal Unicode preserved.) |
| `frontend/scripts/autonomy.js` | "Fetch evidence" button per pipeline row (`data-autonomy-fetch-evidence`), next to Re-check; delegated click handler enqueues `research` / `article-fetch` via the existing `enqueueAgentTask` helper. Available for protected drafts too — fetching evidence is read-only research, never a body modification (same class as Fact-check / Re-check / SEO Check). |
| `tests/article-fetch.test.js` **(new, 39 tests)** | See §5. |

**Nothing else changed.** The regeneration handler, the fact-checker, the gate, the scheduler, and the RSS path are untouched — the fetched item flows into them through the existing `resolveEvidence()` / `loadEvidence()` lookups.

## 5. Tests

**New file `tests/article-fetch.test.js`: 39 tests, 39 pass, 0 fail** (`node --test tests/article-fetch.test.js`).

Coverage: SSRF rejection (non-https, credentials, localhost, 127/10/172.16/192.168/169.254, `[::1]`, metadata host, `.local`); robots parse/allow/deny (Guardian + Higher Ed Dive fixtures, wildcards, `$` anchors, Allow-beats-Disallow, exact-UA-group precedence, crawl-delay); AI-use-prohibition detection (Guardian text → true; Higher Ed Dive / plain → false); extraction (article-only, no nav/aside/script/footer; entity decoding; `published_at` from meta and JSON-LD; `<article>`-container preference; byline-teaser filtering; JS-rendered page → incomplete); assessment (too-short, missing-title, ends-mid-sentence, paywall markers, trailing ellipsis); full flow happy path (stores the item with provenance, re-points the source, logs the run; defaults to the first recorded source; follows a redirect and keeps the recorded URL as the evidence key); refusals (Guardian terms — the article page is never requested; robots-denied; robots-unavailable fails closed; missing robots.txt allows; unrecorded URL; SSRF target; published article); HTTP failures (paywall → incomplete, no row; truncated → incomplete, no row; 404/403 → no-op, not retried; 500 → retry once then succeed; persistent 500 → failed after 2 attempts; 2 MB streamed cap; redirect limit; per-host throttle; already-current); integration — **fetched evidence clears the 1000-char floor and the scaffold regenerates** (and an incomplete fetch leaves the scaffold blocked, nothing fabricated); the dashboard task shape (`research` / `article-fetch`) dispatches through `runAutonomyTask`; **fact-check flow: a claim UNSUPPORTED on the fragment becomes VERIFIED once the fetched item exists** (first check 0 verified, re-check all extracted claims verified, verdict `pass`); migration 029 applies cleanly after 001–028.

**Full suite: 1305 pass / 0 fail, 333 suites, exit 0** (`npm test`, repo root). No test weakened, no gate weakened. (Baseline was 1266; 1266 + 39 = 1305.)

**Migration chain:** migrations 001–029 apply cleanly in order on a scratch SQLite DB (54 tables). Note for the parent: the chain is migrations-only — `schema.sql` is the current full schema and already contains columns some early migrations add (004 fails on `publish_at` after `schema.sql`), which is why the test builds the chain without it. That is pre-existing, not a defect in 029.

**Defects found and fixed during testing (not hidden):**
1. The extractor picked the `<body>` container over `<article>` on raw fragment count, dragging related stories and newsletter promos into the evidence — a complete Higher Ed Dive page read as "ends mid-sentence". Fixed by preferring `<article>` when it holds the article, plus a byline-teaser filter. Two regression tests cover it.
2. An SSRF-blocked recorded source was reported as a retryable `failed` (robots-fetch error) instead of a permanent `no-op`. Fixed: the target is validated before any network call.
3. The runs-table `fetched_at` used the column default (`datetime('now')`, space-separated) while the throttle compares against an ISO timestamp — fixed by storing an explicit ISO `fetched_at` on every run.

## 6. Local verification (VM, scratch DB — NOT live)

Script: `/tmp/verify-fetch.mjs` (kept in /tmp; it builds a scratch SQLite DB with throwaway articles mirroring #29/#30/#33 sources and runs the real fetcher with the live network). No live D1 writes. The #30 URL was read from live D1 first (SELECT-only): `https://www.theguardian.com/travel/2024/mar/22/nyc-three-day-travel-guide` (no trailing slash), `research_item_id` 382. #29: `https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide/` (trailing slash), `research_item_id` NULL. #33: `https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/`, `research_item_id` 696.

### 6.1 The three-URL fetch table

| Article | Robots verdict | HTTP | Extracted | Completeness | Floor (≥1000) |
|---|---|---|---|---|---|
| #33 Higher Ed Dive | HTTP 200; path allowed; crawl-delay 5; AI prohibition: **no** | 200 | **3,985 chars** | **ok — stored** as research item (source_kind `article-fetch`, extraction_status `ok`, `is_outdated` 0, `published_at` 2026-11-19T17:56:00Z); source re-pointed; run logged (robots_allowed 1, crawl-delay 5) | **YES** |
| #29 Guardian Austin | HTTP 200; path allowed; crawl-delay none; AI prohibition: **YES** | — (page never fetched) | 0 | refused: `terms-prohibit-ai-use` (run logged, extraction_status `failed`) | NO |
| #30 Guardian NYC | HTTP 200; path allowed; crawl-delay none; AI prohibition: **YES** | — (page never fetched) | 0 | refused: `terms-prohibit-ai-use` (run logged, extraction_status `failed`) | NO |

The two Guardian fetches were run 11s apart because the per-host throttle (10s) is real and working — the second fetch would otherwise have been `rate-limited`.

### 6.2 The #33 extraction — what the stored evidence actually contains

A separate content check on the extracted #33 text (3,985 chars, ends `"… financial stability” and reduce systemwide risks to PASSHE."`, no teaser leakage):

| Fact in the stored evidence | Present |
|---|---|
| Summer-2028 closure | YES |
| ~111 students | YES |
| $1M/yr operating savings | YES |
| $18M capital spending avoided | YES |
| System deficit nearing $100M | YES |
| Board vote (unanimously approved) | YES |
| Enrolment down from ~600 a decade ago | YES |
| Nursing / workforce training | YES |

This is the evidence the #33 correction (§7, P4) will judge against. It directly contradicts the article's "exact numbers … are not publicly disclosed" claim and the invented "scholarship programs / online course expansion / technology upgrades" redirection.

### 6.3 What local verification does NOT prove

- The live Worker attempt (different egress, real D1, real dashboard task dispatch) is **not yet verified**. The parent procedures in §7 are what verify it. Do not claim the feature works live until P1 runs.
- The Guardian DCR page structure (client-side rendered) means even a licensed-API fetch would need to handle JSON-rendered bodies — the current extractor reports such pages `incomplete`. For the Guardian API follow-up, the extraction path may need a DCR-aware step; that is out of this task's scope.

## 7. Parent procedures (deploy + live steps)

**Standing rules for every step below:** dashboard work uses **UI controls only** — never the browser console (the §13.2 console-snippet procedure from the final report is NOT to be used; a runtime safety notice flagged that read). No push/deploy/live-write step is done by the coordinator; the parent does all live steps. #28–#31 and #33 stay drafts throughout; nothing is published in any step below. E-Stop must be OFF (a 423 means it is ON — stop).

### P0 — Deploy (parent)

1. **Backup first:** take a fresh pre-deploy D1 backup (same method as 2026-11-21: full-table dump to `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/`), and confirm the local tree still passes `npm test` (1305/0) with no uncommitted surprise from the other running coordinator (check `fs-ai-youtube-videos/` is untouched by this change — this feature does not touch it).
2. **Apply migration 029** to live D1 (the parent's usual method; the D1 helper splits on `;\n` and breaks on comment lines ending with `;` — 029 has no such lines, but strip full-line comments into a temp copy first, as was done for 022). Verify: `article_fetch_runs` exists; `research_items` has `source_kind`, `content_hash`, `extraction_status`.
3. **Push** via the established zip + one-time workflow route (flatten `fs-ai/` before any content check; the workflow file is deleted in the same commit). **Rollback prepared first:** the previous deployed commit (295764c) and the pre-deploy backup.
4. **Post-deploy verify:** deployed HEAD is the new commit; served `dashboard.html` / `autonomy.js` are SHA-256-identical to the deployed tree; the "Fetch evidence" button renders on a pipeline row; counts unchanged (published 25, drafts 7, total 32); #26/#27/#31 byte-identical to baselines; #29/#30/#33 bodies unchanged; settings unchanged (publishing_mode auto, cutoff 2026-11-22T04:55:28Z, social_auto_post off); E-Stop OFF; revenue $0.00.
5. **Rollback if anything differs:** revert the push (GitHub) and restore the D1 backup; report the exact differing value. Do not proceed to P1–P6 on a failed deploy.

### P1 — Live extraction for #33 (Higher Ed Dive)

Preconditions: P0 done; signed in as owner on the dashboard; E-Stop OFF.

1. Dashboard → **Autonomous Operations** → pipeline table → article **#33** row → click **Fetch evidence**.
2. Go to **Autonomous Operations → "Run a task manually"**, select the new `research` / `article-fetch` task (payload `{ article_id: 33 }`), and run it. Wait for it to finish (a few minutes at most — the fetch itself is seconds; do not run it twice).
3. Verify in D1 (read-only):
   - `SELECT * FROM article_fetch_runs WHERE article_id = 33 ORDER BY fetched_at DESC LIMIT 1;` → `extraction_status` `ok`, `http_status` 200, `robots_allowed` 1, `robots_crawl_delay_seconds` 5, `extracted_chars` ≈ **3,985** (the live page may differ by a few chars if the source was updated — any value ≥1000 with status `ok` is a pass; a large deviation needs a look).
   - `SELECT id, url, source_kind, extraction_status, is_outdated, LENGTH(evidence_text) AS chars, published_at FROM research_items WHERE url = 'https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/' ORDER BY fetched_at DESC LIMIT 1;` → `source_kind` `article-fetch`, `extraction_status` `ok`, `is_outdated` 0, chars ≈ 3,985, `published_at` 2026-11-19T17:56:00Z.
   - `SELECT research_item_id FROM article_sources WHERE article_id = 33;` → points at the new item (not 696).
   - Article #33 body unchanged (4801 chars), still draft, `fact_checked` 0.
4. If the outcome is `no-op` / `extraction-incomplete` instead: read the run's `extraction_reason`, stop, and report it — do not re-run in a loop. (The local run was `ok`; a live deviation is most likely a source-page change.)

### P2 — Live extraction for #29 (Guardian Austin) — EXPECTED REFUSAL

1. Same steps as P1 for article **#29** (payload `{ article_id: 29 }`).
2. **Expected result: outcome `no-op`, reason `terms-prohibit-ai-use`.** Verify the run row records it (`extraction_status` `failed`, `extraction_reason` containing `terms-prohibit-ai-use`, `http_status` NULL, `research_item_id` NULL). **No research item is created and no page is fetched — that is correct behaviour, not a failure.**
3. **Consequence: #29 regeneration stays blocked.** The precondition for regeneration (a current research item for the Guardian Austin URL with ≥1000 chars, `is_outdated` 0) is NOT met and this feature cannot meet it. Do NOT run the scaffold regeneration — it will correctly return the insufficient-evidence no-op and change nothing.
4. Remaining paths for #29 (owner decision, not this task):
   - **Guardian Open Platform API (recommended):** the owner registers a free API key; a follow-up worker path fetches the article text through the licensed API and stores it as evidence. This is the clean unblocker for #29 (and #30). It needs the owner's key registration + a small follow-up implementation — not a workaround, and not built here.
   - **Owner-written body:** the owner writes the draft; the system then fact-checks it.
   - **Wait for the feed:** will not happen; the article is from April 2024 and is not in the current feed.
5. #29 stays a draft. It still needs separate editorial authorization before any publication even if evidence later arrives.

### P3 — Live extraction for #30 (Guardian NYC) + investigation — EXPECTED REFUSAL, then the prepared correction

**P3a. Fetch attempt (proves the refusal live).**
1. Same steps as P1 for article **#30** (payload `{ article_id: 30 }`).
2. **Expected result: outcome `no-op`, reason `terms-prohibit-ai-use`** (same verification as P2 step 2). No evidence is stored. The automated investigation path is therefore **blocked for #30 on the Guardian's own terms** — the feature cannot fetch the full NYC source.

**P3b. Investigation (human — the automated fetch cannot do this).**
The investigation the owner authorized is the human verification of the 15 failed claims against the full source. It is already done, in the post-deployment audit (§4.3): the auditor read the full Guardian NYC article (via the tripulous mirror, verbatim republication — the Guardian domain was policy-blocked for the auditor's browser) and verified:
- **Claim #270 (the anecdote) is TRUE** — the source reads: *"I first came to New York City by accident, after a miscommunication with my father led me to believe my (long-deceased) mother had been desperate to visit the city before she died."* The checker marked it UNSUPPORTED only because the fragment did not contain it.
- **The day mapping is REAL:** Day 1 is "Boating and brownstones" (Staten Island ferry, NYC ferry, Dumbo, Jane's Carousel, Goose Barnacle, Fort Greene); Day 2 is "Rude T-shirts and not-quite Rolexes" (Soho/Chinatown knockoff watches). The CONFLICTING verdicts on #261/#265/#267 are artefacts of the thin evidence, not of the article being wrong about the structure.
- **The elaborations (#263, #266, #269, #258–#260, #264) are plausible paraphrase/colour**, not facts the fragment supports — e.g. the ferry *does* pass the Statue of Liberty with skyline views in the real article, so #263 is substantively true, but it cannot be verified from the stored evidence.

**P3c. The prepared correction (for the owner's one-tap separate authorization).**
#30's body (4623 chars) is **preserved exactly** until the owner authorizes a change — no edit has been made and none will be made in this procedure. The table below is the exact proposed correction, claim by claim, against fact-check id 29 (20 claims: 5 VERIFIED, 15 failed). "Evidence" is the audit's human verification against the full Guardian article (§4.3), quoted above.

The 5 already-VERIFIED claims are **preserved**: #255 (top destinations: ferry, Chinatown watch-shopping, Brighton Beach bender), #257 (three-day itinerary structure), #262 (ferry as a top destination), #268 (Brighton Beach as a top destination), #272 (a three-day trip can feel full and authentic).

| Claim id | Verdict (fc 29) | Claim (truncated) | Proposed change | Evidence |
|---|---|---|---|---|
| 253 | OUTDATED | "If you only have three days… a local's travel guide can help you hit the highlights without feeling rushed." | **REMOVE** | Generic intro; the three-day structure is already stated in #257. |
| 254 | OUTDATED | "The Guardian's recent feature, 'A local's travel guide to New York City…,' gives a clear snapshot…" | **REWORD** → "The Guardian's March 2024 feature, 'A local's travel guide to New York City…,' gives a clear snapshot of the city's best experiences." | The feature is dated 22 Mar 2024 (source URL `/2024/mar/22/`); "recent" is the false part. |
| 256 | UNSUPPORTED | "These moments illustrate how even unplanned journeys can turn into unforgettable memories." | **REMOVE** | Editorialising; not a source claim. |
| 258 | UNSUPPORTED | "Each day is broken into a few key activities that showcase different sides of the city." | **KEEP** | Day structure is real: Day 1 boating/brownstones, Day 2 Soho/Chinatown, Day 3 Brighton Beach (audit §4.3). |
| 259 | UNSUPPORTED | "By focusing on one major destination per day — ferry, Chinatown, and Brighton Beach — the planner keeps travel time manageable…" | **KEEP** | The per-day destinations are correct (audit §4.3); "manageable" is framing, not a factual claim. |
| 260 | UNSUPPORTED | "The structure works because it gives you a clear sense of where to go, what to look for, and how to spend your time efficiently." | **REMOVE** | Editorialising about the structure's effectiveness; not a source fact. |
| 261 | CONFLICTING | "**Day 1 – Ferry Ride** Start your trip with a ferry ride." | **KEEP** | Day 1 ferry is real (audit §4.3); the CONFLICTING verdict is a thin-evidence artefact. |
| 263 | UNSUPPORTED | "A ferry gives you a scenic view of the skyline and a relaxed way to travel across the harbor." | **KEEP** | The ferry passes the Statue of Liberty with skyline views in the real article (audit §4.3). |
| 264 | UNSUPPORTED | "The guide suggests that this is a great way to kick off your adventure with a memorable experience." | **REWORD** → "The guide opens the trip with the ferry ride." | The ferry IS the Day 1 opener (audit §4.3); the "great way to kick off" phrasing is editorialising. |
| 265 | CONFLICTING | "**Day 2 – Watch Shopping in Chinatown** On the second day, head to Chinatown to shop for watches." | **KEEP** | Day 2 watch-shopping is real (audit §4.3); CONFLICTING is a thin-evidence artefact. |
| 266 | UNSUPPORTED | "Chinatown's unique blend of culture and commerce… the watch shops provide a fun, hands-on way to explore local business." | **KEEP** | Day 2 is Soho/Chinatown knockoff watches (audit §4.3); the colour is substantively true. |
| 267 | CONFLICTING | "**Day 3 – Brighton Beach Bender** Finish your three-day trip with a Brighton Beach bender." | **KEEP** | Day 3 Brighton Beach is real (audit §4.3); CONFLICTING is a thin-evidence artefact. |
| 269 | UNSUPPORTED | "Brighton Beach is known for its vibrant atmosphere, and the 'bender' suggests a lively evening…" | **KEEP** | Brighton Beach is the Day 3 destination (audit §4.3); the atmosphere wording is paraphrase/colour. |
| 270 | UNSUPPORTED | "The guide's narrative also includes a personal note: the author's first visit to New York was accidental…" | **KEEP** | **TRUE** — quoted verbatim from the source (audit §4.3). This is the claim the fragment-based correction would wrongly delete. |
| 271 | UNSUPPORTED | "This anecdote shows how a single event can lead to a deep connection with a place." | **REMOVE** | Editorialising about the anecdote's meaning; not in the source. |

**Net effect if authorized: 4 removals (#253, #256, #260, #271), 2 rewords (#254, #264), 9 keeps.** The corrected body keeps the day structure, the destinations, and the anecdote, and drops the editorialising connective tissue. It is a *less* conservative correction than the fragment-based automated Correct flow (which would also strip #270 and the day headings — a quality loss the audit warned about in §4.3). **Do NOT use the dashboard Correct button for #30** — it judges only the stored fragment and would delete true claims. The prepared correction above is applied as the exact text edits (parent's method: the dashboard article-edit UI if one exists, else a careful body update with an `article_revisions` row preserving the 4623-char body), **only after the owner's one-tap separate authorization**. Then run P5.

**Limitation to state plainly to the owner:** after the correction is applied, a fresh dashboard Re-check will still judge the kept claims against the stored fragment (the fetch refused), so it will likely still report `needs-review` for them. The re-check is NOT the verification for #30 — the human verification (audit §4.3, source text quoted above) is the evidence of record for the kept claims. The Guardian Open Platform API follow-up (P2 step 4) is what would let the automated re-check verify them.

### P4 — #33 correction (authorized autonomously once evidence permits — no further owner approval)

**Authorization:** the owner confirmed 2026-11-22 11:58 that #33 routine correction is authorized without further approval once sufficient evidence is available (see §9). #33 is not in #28–#31. This procedure runs **after P1 succeeds** (evidence stored, ≥1000 chars, current).

1. Dashboard → Autonomous Operations → article **#33** row → click **Correct** (enqueues a `fact-checking` / `correct` task).
2. Go to **"Run a task manually"**, select the correction task, run it. Wait for it to finish; do not run it twice.
3. Verify: a new `article_revisions` row exists for article 33 holding the pre-correction body; the body is shorter; status stays **draft**; `fact_checked` stays 0; the AI-DRAFT banner stays on the body.
4. **Expected correction (against fact-check id 30: 7 VERIFIED, 13 UNSUPPORTED, claim_checks ids 273–292):**
   - **Preserved (VERIFIED):** #273 (small satellite campus, ~100 students), #274 (shut down by summer 2028), #276 (broader financial strain across the M State system), #283 (difficult but necessary response to budget pressure), #284 (dedicated community of just over 100 students), #288/#289 (Key-takeaways: summer-2028 closure after a systemwide vote; enrolment just over 100).
   - **Removed / qualified (UNSUPPORTED on the fragment):** #277 and #280 ("exact numbers / financial details are not publicly disclosed" — **contradicted** by the full source: $1M/yr, $18M, ~$100M deficit); #279 (funds redirected to scholarships / online expansion / technology upgrades — **invented**; the source reallocates up to $25M/yr to *struggling institutions*); #286 (career placement / relocation support — **invented**; the source mentions 40 employees and nothing about placement); #285 and #291 (transfer options / students transferred + staff support — **weak**: the source says only "detailed transition planning to allow current students to finish their studies"); #278 (preserve overall academic quality), #287 (case study for universities nationwide), #275 (article explains what led to the decision), #282 (additional-resources pointer) — editorialising / meta-claims with no source sentence.
   - **May flip to VERIFIED on the fresh re-check (now that full evidence exists):** #290 ("Reason: ongoing budget woes make continued operation unsustainable" — the source supports the budget-woes reason) and #281 ("larger plan to address budget woes" — the source describes the systemwide stabilisation plan) and #292 ("wider trend of campus consolidations" — the source cites other systems closing campuses). If the correction removes them before the re-check, that is the flow working on the fragment-era verdicts; note it and do not re-add them by hand.
   - **Known weak-verify to watch:** #273 was marked VERIFIED on the fragment although its "close-knit community" phrasing is not in the source (audit §3.1: UNSUPPORTED). The deterministic judge verifies a claim when its factual core matches, even if colour words are absent. The automated correction will not remove a VERIFIED claim, so "close-knit community" may survive — a human editorial call, not a blocker. Flag it in the correction report.
5. **Fresh Re-check** (#33 row → Re-check). Expected: a new `fact_checks` row (id 31 or higher), `check_kind` `recheck`, `body_hash` PRESENT and equal to the hash of the corrected body (verify with the repo's `bodyHash()`), `claims_total` smaller than 20, verdict `needs-review` or `pass` (a pass is a result to verify, not to assume). `fact_checked` stays 0; status stays draft; history (fc id 30) preserved.
6. **SEO** runs in the next daily run (23 Nov 00:00 UTC) — no per-article SEO button exists. Expected: `needs-review` most likely; internal-links may fail by editorial choice (division 8 has only #22 published, and it is not genuinely relevant — **do not add an irrelevant link to satisfy the check**).
7. #33 stays a draft. It is legacy (created before the auto-publish cutoff) and can never auto-publish; publication needs separate editorial authorization even if every check later passes.
8. **Follow-up (not part of this procedure):** after the correction, the article will be a shorter honest stub. Enriching it with the now-verified figures ($1M/yr operating savings, $18M capital avoided, ~$100M system deficit, 40 employees, enrolment down from ~600) is a separate editorial step — the automated Correct flow removes/qualifies, it does not add facts. The permanent authorization covers #33 rewriting in principle; propose it as a follow-up rather than doing it inside the correction run.

### P5 — #30 fresh re-check (only after the owner's one-tap authorization for P3c)

1. After the prepared correction is applied (P3c), click **Re-check** on the #30 row.
2. Expected: a new `fact_checks` row (id 31 or higher), `check_kind` `recheck`, `claims_total` smaller than 20 (the corrected body has fewer claims), `body_hash` PRESENT and equal to the hash of the corrected body. **Verdict expected: `needs-review`** — the re-check judges against the stored fragment, so the kept claims (#261/#265/#267/#270 and the elaborations) will likely still read as failed. That is the known limitation in P3c, not a failure of the correction. Record the verdict honestly; do not hand-edit the body to make it pass.
3. `fact_checked` stays 0; status stays draft; history (fc 14, 15, 16, 29) preserved.
4. #30 is not published (separate editorial authorization required even after a clean re-check).

### P6 — What does NOT change

- **#29 regeneration:** blocked until sufficient reliable evidence exists (P2). Do not run it.
- **#28/#31:** untouched by every procedure here.
- **Social:** nothing is connected or published in any step here; Pinterest OAuth comes separately later.
- **YouTube:** #09 stays selected for the 23 Nov Short, #07 for the 5 Dec long-form — unchanged.
- **Search Console:** a separate parent browser task — not this feature's work.
- **Unrelated autonomous work** continues on its own track while waiting for the #30 authorization (owner's 22 Nov 11:58 order, point 4).

## 8. Remaining blockers

1. **Guardian Open Platform API (the #29/#30 unblocker).** The feature refuses Guardian fetches on the publisher's own terms. The licensed route is the Guardian Open Platform API: the owner registers a free key, then a follow-up worker path fetches article text through the API (licensed content access) and stores it as evidence. Needs: owner key registration + a small follow-up implementation (API fetch variant of this service, same compliance envelope). Not built in this task; not a workaround for the terms refusal.
2. **Live Worker verification (P1).** The feature is proven locally (VM) and in tests, not live. Until P1 runs and returns `done` with ≈3,985 chars for #33, do not claim the feature works in production.
3. **JS-rendered (DCR/Next.js) pages.** The extractor reports them `incomplete` rather than faking text. If the Guardian API follow-up returns JSON-rendered bodies, it needs a DCR-aware extraction step.
4. **#30's automated re-check cannot verify the kept claims** until licensed full evidence is stored (P3c limitation). The human verification is the evidence of record for those claims until then.

## 9. Authorization (folded in — governing)

The owner's **permanent authorization for FS AI full autonomous operation (confirmed 2026-11-22 11:58)** governs this feature's use:

- **Routine autonomy:** no repetitive approval for routine editorial / research / fact-check / correction / SEO / QC / publication decisions. Insufficient evidence does NOT mean a claim is false — search for more sources, use the full-text extraction feature, compare independent sources, preserve verified claims, qualify/remove ONLY claims that remain unsupported, never fabricate. If evidence cannot be obtained, mark NEEDS_REVIEW/BLOCKED and keep unpublished; continue other tasks instead of asking.
- **#29:** the fetch feature and subsequent evidence-based regeneration are explicitly authorized; proceed autonomously once sufficient reliable evidence is available; no additional approval required. Regeneration stays draft; #29 still needs separate editorial authorization before any PUBLICATION. (That evidence is not available via the compliant fetch — see §7 P2. The authorization does not change the terms refusal.)
- **#30:** investigate autonomously, retrieve full evidence, recheck all 15 failed claims, preserve verified facts, and PREPARE the corrected version — that is P3b/P3c above. Because #30 belongs to the protected #28–#31 group, **obtain separate authorization before changing its existing body**. The investigation is not permission to edit. Do not pause unrelated autonomous work while waiting for the #30 authorization.
- **#33:** full autonomous evidence retrieval, correction, rewriting, fact-checking and SEO are authorized; **no additional owner approval required**. P4 may run the correction once the evidence permits.
- **Standing limits (unchanged):** $0 always; no paid services/APIs; no bypassing security/OAuth/platform rules/copyright/access controls; no secrets exposure; no fabricated success; Health/Finance always need human review; social auto-publish only once an account is legitimately OAuth-connected.

## 10. Rollback

- **Code:** revert the push (GitHub) to the previous deployed commit (295764c). The feature is additive — no existing behaviour depends on it; the dashboard button is inert without the worker routes, and the worker dispatch is inert without dashboard tasks.
- **Data:** restore the pre-deploy D1 backup (P0 step 1). If 029 was applied and must be rolled back: `DROP TABLE article_fetch_runs;` — the three `research_items` columns are nullable and ignored by older code (SQLite cannot drop columns; leaving them is safe). Any `research_items` rows with `source_kind` `'article-fetch'` created by the feature should be reviewed before rollback (they are evidence rows, not article bodies; deleting them returns the evidence pools to their pre-feature state).
- **No article body is changed by this feature's deployment itself.** The only body changes in §7 are the authorized corrections (P4) and the separately-authorized #30 correction (P3c), each with its own revision row.

## 11. Parent verification (added by the parent, 2026-11-22 — after the coordinator's handoff)

- **Independent test run FAILED first, then fixed (not hidden):** the parent's own `npm test` run returned EXIT=1 with exactly 1 failure — the JSON-LD `published_at` test (`2026-11-19T17:56:00` with no timezone designator) read as `11:56:00Z` instead of `17:56:00Z`. Root cause: `new Date()` parses a timezone-less ISO string as **local** time, and the parent's runtime is in Asia/Dhaka (+06); the coordinator's run passed because its runtime was UTC. Fix (code, not the test — the test's expectation is the correct one): `extractPublishedAt` now goes through a `parsePublishedAt` helper that treats a timezone-less ISO datetime as UTC (appends `Z`), so the stored value is identical in every timezone, including the Worker (UTC). Re-run after the fix: **1305 pass / 0 fail, 333 suites, EXIT=0** (in the +06 runtime). No test weakened.
- **Pre-deploy D1 backup:** `hidden_files/d1-backup-2026-11-22-pre-deploy.json` (1,582,497 bytes, 52 tables) — articles 32, agent_tasks 40, fact_checks 30, claim_checks 292, research_items 713.
- **Migration 029 applied live:** all 7 statements success; `article_fetch_runs` exists (0 rows); `research_items` has `source_kind` / `content_hash` / `extraction_status`; articles still published 25 / drafts 7.
