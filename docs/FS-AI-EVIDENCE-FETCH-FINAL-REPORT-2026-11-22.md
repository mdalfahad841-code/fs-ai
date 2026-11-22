# FS AI — Full-Article Evidence Fetching Feature: Final Implementation Report

**Date:** 2026-11-22
**Deployed commit:** `54c7b3d1bc7031961998bf92af9a2540b9ffa2f6` (parent `295764c`)
**Status:** Feature deployed and verified live. #33 fetched successfully. #29 correctly refused on Guardian terms. #33 correction BLOCKED by a corrector defect (validation caught it; nothing saved). #30 correction awaits owner authorization.

---

## 1. What was built

The research engine could only learn from RSS summaries. Articles whose sources had left the feed (#29 Austin, #30 NYC) could never be regenerated or properly fact-checked. The feature adds a full-article evidence fetcher, integrated into the whole research and fact-check pipeline.

### Code changes (local tree → deployed commit 54c7b3d)

| File | Change |
|---|---|
| `backend/services/article-fetch.js` (NEW, 817 lines) | SSRF validation; robots.txt parse/obey + AI-use-terms detection; fetch with timeout, ≤3 manual redirects re-validated per hop, 2 MB streamed cap, ≤2 attempts on transient errors only; readability-style extraction; completeness assessment; storage as a `research_items` row for the RECORDED URL + re-pointing `article_sources.research_item_id`; per-host throttle max(10s, robots Crawl-delay); already-current dedupe 7 days; `article_fetch_runs` audit log. Fetched text is internal verification evidence only, never republished verbatim. |
| `backend/agents/autonomy/research.js` | Re-exports `runArticleFetch` (RSS ingestion untouched). |
| `backend/agents/autonomy-runner.js` | Kind-level dispatch for `research` / `article-fetch`, mirroring `scaffold-regeneration` — manual tasks only, NEVER the scheduled daily run. |
| `database/migrations/029_article_fetch_runs.sql` (NEW) | `article_fetch_runs` table + `research_items.source_kind` / `content_hash` / `extraction_status`. Touches no existing row. |
| `package.json` | `db:migrate` chain extended with 029. |
| `frontend/scripts/autonomy.js` | "Fetch evidence" button per pipeline row + delegated handler enqueuing via the existing `enqueueAgentTask`; available for protected drafts too (read-only research, not a body modification). |
| `tests/article-fetch.test.js` (NEW, 39 tests) | SSRF rejection, robots allow/deny/crawl-delay, AI-use-prohibition detection, extraction incl. `<article>`-preference and byline-teaser regressions, assessment, happy path, all refusal modes, HTTP failures, throttle, already-current, the regen precondition, the fact-check flip (a claim UNSUPPORTED on the fragment becomes VERIFIED once the fetched item exists), the dashboard task shape through `runAutonomyTask`, migration 029 applying cleanly after 001–028. |

**Exact task payload:** `{ agent: 'research', kind: 'article-fetch', payload: { article_id } }` (`url` optional, defaults to the article's first recorded source).

### Parent-found fix (not in the coordinator's report)

The parent's own independent `npm test` run FAILED first: EXIT=1, exactly 1 failure — the JSON-LD `published_at` test (`2026-11-19T17:56:00` with no timezone designator) read as `11:56:00Z` instead of `17:56:00Z`. Root cause: `new Date()` parses a timezone-less ISO string as **local** time, and the parent's runtime is Asia/Dhaka (+06); the coordinator's run passed because its runtime was UTC. Fix (code, not the test — the test's expectation is correct): `extractPublishedAt` now goes through a `parsePublishedAt` helper that treats a timezone-less ISO datetime as UTC (appends `Z`), so the stored value is identical in every timezone, including the Worker (UTC). Re-run after the fix: **1305 pass / 0 fail, 333 suites, EXIT=0** in the +06 runtime. No test weakened. The existing JSON-LD test is the regression test for this bug.

### Test results

| Run | Result |
|---|---|
| Coordinator (implementation) | 1305 pass / 0 fail, 333 suites |
| Parent, first independent run | 1304 pass / 1 fail (the timezone bug above) |
| Parent, after the code fix | **1305 pass / 0 fail, 333 suites, EXIT=0** |
| Migration chain 001–029 on a scratch SQLite DB | Applies cleanly in order (54 tables) |

---

## 2. Deployment (P0) — done and verified live

1. **Pre-deploy D1 backup:** `hidden_files/d1-backup-2026-11-22-pre-deploy.json` (1,582,497 bytes, 52 tables) — articles 32, agent_tasks 40, fact_checks 30, claim_checks 292, research_items 713.
2. **Migration 029 applied live:** all 7 statements success. `article_fetch_runs` exists (0 rows at apply time); `research_items` has `source_kind` / `content_hash` / `extraction_status`.
3. **Push:** zip regenerated (1,628,529 bytes, 350 files, top-level `fs-ai/`, only `.env.example` — placeholders only, no real secrets). Browser task verified base `295764c`, uploaded the zip (commit `78c74ba`), created the one-time workflow (commit `854caa3`, content recovered verbatim from the 21 Nov push commit `020031b` via the public GitHub API), ran workflow_dispatch — **run #29, Success in 9 seconds**. New HEAD `54c7b3d1bc7031961998bf92af9a2540b9ffa2f6`, exactly 1 parent (`295764c`), 13 files changed (+4,656/−9). Workflow file + zip both gone (404 verified).
4. **Post-deploy verification (parent, live):**
   - Served `dashboard.html` SHA-256-identical to the deployed tree (23,379 bytes). Served `autonomy.js` SHA-256-identical, contains the "Fetch evidence" button (`data-autonomy-fetch-evidence`, line 841).
   - Raw `main` content: `article-fetch.js` SHA-256-identical to local; migration 029 on main. (GitHub API metadata check was rate-limited unauthenticated; the browser task's commit-page verification + raw content hashes stand as the evidence.)
   - Counts unchanged: published 25, drafts 7, total 32.
   - Article bodies unchanged: #26 4895, #27 245, #28 2157, #29 601, #30 4623, #31 549, #33 4801.
   - Settings unchanged: publishing_mode auto, auto_publishing on, cutoff 2026-11-22T04:55:28Z, social_auto_post off, auto_correction off, max_articles_per_day 1, autonomy_level 3. E-Stop OFF. Cost $0.00.
   - Rollback prepared: revert the push + restore the D1 backup (DROP TABLE `article_fetch_runs` if needed; the three `research_items` columns are nullable and safe to leave). Not needed.

---

## 3. Live extraction results (P1, P2)

Run from the owner dashboard (signed in as Owner mdalfahad841@gmail.com; session expires 2026-11-29). No Correct / Re-check / Publish button was touched for these steps; #28, #30, #31 untouched.

### P1 — Article #33: SUCCESS

- Dashboard: **Task 42: done (run #169)**.
- D1 `article_fetch_runs` id 1: Higher Ed Dive, HTTP 200, extraction_status `ok`, **extracted_chars 3,985**, research_item_id **714**, fetched 2026-11-22T06:41:27Z.
- Research item 714: source_kind `article-fetch`, 3,985 chars, extraction_status `ok`, content_hash present. `article_sources` for #33 re-pointed from item 696 (114 chars) to 714.
- Content spot-check of item 714: summer-2028 closure, ~111 students, board vote, enrolment down from ~600, "100 million" deficit, 40 employees, "struggling" — all present. No "scholarship" or "placement" in the source (confirming those article claims are invented). Ends with proper punctuation, no teaser leakage.
- **The feature unblocks #33 completely.** Body unchanged (4801, draft).

### P2 — Article #29: CORRECT REFUSAL

- Dashboard: **Task 43: no-op (run #170) — terms-prohibit-ai-use**: "this site states its content may not be used for LLM / machine-learning / AI purposes — the fetch is refused on the publisher's own terms, not attempted."
- D1 `article_fetch_runs` id 2: Guardian, http_status NULL (never fetched), extraction_status `failed`, reason `terms-prohibit-ai-use`, 0 chars, no research item. Body unchanged (601, draft). No regeneration attempted.
- **The Guardian's robots.txt prohibits AI/LLM use of its content. The feature refuses Guardian fetches by design, and mirrors are out of scope (fetching Guardian content from an unlicensed mirror to evade the terms would violate the compliance rules).** #29 and #30 stay blocked on this. Their unblocker is the **Guardian Open Platform API** (owner registers a free key; a follow-up worker path — licensed route, NOT built here) or an owner-written body.

### P2b — Article #30 fetch (expected refusal, not run separately)

The #30 Guardian NYC URL is the same publisher with the same robots.txt AI-use prohibition, so a live attempt would refuse identically. It was not run — the refusal is already proven by #29's run and the local verification (both Guardian URLs refused locally with `terms-prohibit-ai-use`, 11 seconds apart, per-host throttle working). The human investigation of #30's claims against the real Guardian article (audit §4.3) stands as the evidence of record.

---

## 4. Article #33 correction (P4) — BLOCKED by a corrector defect

**What happened:** Dashboard Correct → task #44 → run #171 → **FAILED: "VALIDATION REJECTED — nothing was saved; the article needs human review."** Then dashboard Re-check → run #172 → needs-review, **11/20 verified, 9 failed** (fact_checks id 32, evidence signature `714:2026-11-22 06:41:28:5bd067a7064456e4`, body_hash matches the current body).

**Verified state (D1):** body still 4801 chars, updated_at unchanged, 0 `article_revisions` rows for #33 — **nothing was saved, exactly as the dashboard said**. Still draft, gate Blocked.

**Root cause (from run #171's recovery report):** the corrector attempted 8 corrections + 5 removals, but the WHOLE corrected body was rejected by whole-body validation because one corrected sentence contained the **raw source URL** (`https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/`). Validation reasons, all about that one sentence:
1. broken sentence fragment (starts with a lowercase letter): the URL;
2. sentence contains a raw URL (citation not stripped);
3. unsupported number 875256 in the corrected sentence — not in the article's evidence.

Recovery report: root cause "Corrected body failed whole-body validation (garbled, repeated, incomplete or unsupported content)"; `retryable: false`; status `BLOCKED_WITH_REASON`; ownerAction "Human review: inspect the failed claims and correct by hand, or fix the underlying cause (see validation reasons) and re-run"; nextStep "Do NOT re-run the correction on this unchanged input — it will fail the same way. Fix the underlying cause first (see root cause), then re-run."

**This is the validation working as designed** — it stopped a garbled body (with a raw URL pasted in as a sentence) from being saved. The defect is in the corrector: it does not strip citations/URLs from corrected text. It is a code defect to fix, not an evidence problem.

**The good news — the full evidence DID improve the fact-check:** fc 30 (fragment evidence 696) was 7/20 verified; fc 31 (correction-recheck, evidence 714) and fc 32 (re-check, carried all 20 forward from fc 31) are **11/20 verified**. Four claims flipped UNSUPPORTED → VERIFIED on the full evidence:
- "This article explains what led to the decision, how it fits into the broader financial picture…"
- "The move is part of a larger plan to address budget woes…"
- "Students currently enrolled at Detroit Lakes will be offered transfer options…"
- "- **Impact:** Students will be transferred to other campuses; faculty and staff will receive support."

(One more flipped UNSUPPORTED → CONFLICTING: the "For readers interested…" resources paragraph — still failed.)

**9 claims still failed (fc 32, ids 313–332):** 8 UNSUPPORTED + 1 CONFLICTING:
- "While the exact numbers of the budget shortfall are not publicly disclosed…" — contradicted (source gives $1M/yr operating savings, $18M capital avoided, ~$100M deficit).
- "The closure will also free up funds that can be redirected toward initiatives such as scholarship programs, online course expansion, and technology upgrades" — invented (source: up to $25M/yr reallocated to struggling institutions).
- "Although the exact financial details are not public, the university's leadership has indicated that the closure will help stabilize the system's budget…" — unsupported.
- "By consolidating operations and focusing on core campuses, M State aims to preserve overall academic quality while addressing fiscal deficits." — unsupported.
- "Faculty and staff will receive support through career placement services and, where possible, opportunities for relocation within the system." — invented (source: 40 employees, no placement mention).
- "As universities across the nation face similar fiscal challenges, the M State experience serves as a case study…" — unsupported.
- "- **Reason:** Ongoing budget woes make continued operation unsustainable." — unsupported.
- "- **Broader context:** The decision reflects a wider trend of campus consolidations driven by financial pressures." — unsupported.
- "For readers interested in the broader context…" (resources list) — CONFLICTING.

**Next step for #33 (planned, autonomous):** fix the corrector's citation-stripping defect (strip raw URLs from corrected text / reject-and-regenerate the offending sentence, with a regression test), deploy, then re-run the #33 correction. The alternative — hand-correcting the 13 unsupported claims as exact text edits — is the recovery report's other named path. #33 stays a blocked draft either way; it can never auto-publish (legacy, pre-cutoff).

**Known weak-verify (flagged, not a blocker):** claim #273 ("close-knit community") was VERIFIED on the fragment and survives the automated correction — a human editorial call, not a blocker.

---

## 5. Article #30 — prepared correction, awaiting owner authorization

Per the owner's 22 Nov decisions, #30's body must NOT change without separate authorization. The prepared correction (vs fact-check id 29; the 5 VERIFIED claims preserved) is ready to apply as exact text edits with an `article_revisions` row preserving the 4623-char body:

**4 removals:** #253, #256, #260, #271.
**2 rewords:**
- #254 → "The Guardian's March 2024 feature, 'A local's travel guide to New York City…,' gives a clear snapshot of the city's best experiences."
- #264 → "The guide opens the trip with the ferry ride."
**9 keeps:** #258, #259, #261, #263, #265, #266, #267, #269, #270 — including the day headings and the TRUE anecdote #270 (the accidental-first-visit story), which the fragment-based Correct flow would wrongly delete.

Do NOT use the dashboard Correct button for #30 (it would delete true claims on fragment evidence). **Limitation to state plainly:** a fresh Re-check will still judge the kept claims against the stored fragment, so it will likely still read `needs-review` — the human verification (audit §4.3) is the evidence of record until licensed full evidence exists (Guardian Open Platform API key).

**After authorization + correction:** fresh Re-check (expected new `fact_checks` row, id 33+, claims_total < 20, body_hash equal to the corrected body's hash, verdict expected `needs-review`, fact_checked stays 0, stays draft).

---

## 6. Article statuses (verified live, 2026-11-22)

| Article | Status | Body | Fact-check | Notes |
|---|---|---|---|---|
| #26 | draft, protected | 4895 | 0/16 | Untouched |
| #27 | draft, protected | 245 | 0/2 | Untouched |
| #28 | draft, legacy | 2157 | 6/7 | Untouched; needs separate authorization |
| #29 | draft, legacy | 601 | failed (fc 9/10) | Scaffold shell; Guardian terms block evidence fetch; regen blocked; needs Guardian API key or owner-written body |
| #30 | draft, protected | 4623 | 5/20 (fc 29) | Prepared correction ready; body edits need owner authorization |
| #31 | draft, legacy | 549 | PASS 3/3 | Gate Blocked; stays draft until owner authorization |
| #33 | draft, legacy | 4801 | 11/20 (fc 32) | Full evidence stored (item 714); correction blocked by corrector defect; stays draft |

Counts: published 25, drafts 7, total 32. Queue: done 34, queued 4 (ids 36, 37 ageing from 21 Nov; 39, 40 from 22 Nov — watch the 23 Nov daily run's drain). E-Stop OFF. Cost $0.00.

---

## 7. Remaining blockers

1. **#30 correction — owner authorization required.** The prepared correction above (§5). One tap authorizes the exact text edits; publication still needs a separate editorial authorization afterwards.
2. **#33 correction — corrector defect.** The corrector pastes raw URLs into corrected sentences; whole-body validation correctly rejects the result. Fix the citation-stripping defect, deploy, re-run. (Planned next autonomous step.)
3. **#29 / #30 evidence — Guardian Open Platform API key.** The fetch feature refuses Guardian on terms. The licensed route needs the owner's free-key registration + a small follow-up worker path (API fetch variant of article-fetch, same compliance envelope). Not built yet.
4. **Live Worker verification of the fetch path** — done: runs #169/#170/#171/#172 all executed on the live Worker via the dashboard, with D1-verified outcomes.
5. **#33 SEO** — runs in the next daily run (23 Nov 00:00 UTC); no per-article SEO button exists. Verify it appears.
6. **Optional cleanup (low priority):** `llm_provider_order` in live D1 reads `workers-ai,groq,gemini` (writer unknown; neutralised by the code allowlist). Set to `workers-ai` or delete the row when convenient.

---

## 8. What does not change

- #28 / #31 untouched. No social connections (social_auto_post OFF; Pinterest OAuth begins separately, later). YouTube: #09 Short on 23 Nov, #07 long-form on 5 Dec — unchanged. Search Console: Article 1 indexing retry 23 Nov 11:00 Dhaka (runonce cron set; quota reset).
- No article was published by this work. #33 can never auto-publish (legacy, pre-cutoff). Auto-publish remains on for eligible NEW post-cutoff articles only, 1/day max.
