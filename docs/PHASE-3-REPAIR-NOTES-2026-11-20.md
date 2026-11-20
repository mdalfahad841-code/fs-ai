# FS AI — Phase 3 Repair Notes (implementation phase, local only)

**Date:** 2026-11-20
**Starting commit:** 28b65bf (the Phase 3 prompt says 98b2349 — that is STALE; 28b65bf is the true HEAD after the unslop round-2 deploy)
**Scope:** implementation only. No deploy, no push, no live browser work, no live D1 writes, no Article #31 creation, no weekly workflow run. The parent deploys, applies migrations 016–018 live, and runs the live #31 E2E afterwards, then writes `FS_AI_PHASE_3_FINAL_VERIFICATION_REPORT.md`.

**Full-suite result:** `npm test` → **839 tests pass / 0 fail / 194 suites** (baseline 783 + 56; exit 0, run 2026-11-20 after all edits). The 6 new test files hold 45 tests; the updated `tests/indexing-canonical.test.js` contributes the remainder of the +56.

**Live D1 state at end of implementation (read-only checks, 2026-11-20):** articles #26–#30 unchanged from the parent baseline (15:44): #26 body 4895 / desc 77, #27 245 / 61, #28 2157 / 150, #29 593 / 158, #30 4615 / 132 — all draft, `fact_checked` 0. `article_corrections`: 31 rows, **0 pending** (7 applied / 12 failed / 12 removed) — so migration 017's partial unique index cannot conflict with live data. No live writes were made by this implementation.

**Flags unchanged:** auto_research ON, auto_generation ON, auto_factcheck ON, auto_correction **OFF**, auto_publishing **OFF**, publishing_mode `approved_only`, social OFF. Emergency Stop ends OFF. Workers AI is the only LLM provider; $0 added cost.

---

## P1 — Source URL normalization — DONE

**Root cause (Phase 2 finding):** `resolveEvidence` in `backend/agents/autonomy/content.js` matched `research_items.url` by EXACT string (`content.js:350`), and `convertScaffoldToDraft` did the same lookup. The Phase 2 live E2E failed generation for #29 because the supplied Guardian URL had a trailing slash while the stored URL did not — an "insufficient-evidence" no-op on a URL that was in the database all along.

**Change:**
- NEW `backend/services/urls.js` — `normalizeUrl` (unifies scheme to https, lowercases scheme/host, strips `www`, drops default ports, drops fragments, collapses duplicate slashes, drops a trailing slash except at root, preserves and sorts query params), `canonicalUrl`, `urlsMatch`, `matchDecision` (`'exact' | 'normalized' | 'no-match'`). Invalid or non-http(s) URLs return null and never match, not even each other. Genuinely different articles (different path/query) never conflate.
- `backend/agents/autonomy/content.js` — NEW shared `findResearchItemByUrl(env, suppliedUrl, urlIndexCache)`: exact match first, then a normalised match over a lazily-fetched id+url+fetched_at index (latest fetch wins); the full row is fetched by id only for the match used. `resolveEvidence` uses it, dedupes by canonical URL, and every resolved item records `canonicalUrl`, `matchMethod` (`'exact' | 'normalized'`) and `matchedStoredUrl`; `url` stays the original supplied URL for display/audit. `convertScaffoldToDraft` source lookup uses the same fallback.
- **No migration needed for P1.** The resolver works without a `url_canonical` column; adding one would duplicate data the resolver already derives. (Documented here deliberately — the prompt listed it as an example, not a requirement.)

**Tests:** `tests/url-normalization.test.js` — 11/11 pass, including the exact Phase 2 Guardian pair (Austin guide with/without trailing slash). `tests/url-resolution.test.js` — 5/5 pass (exact / normalised / www+http+fragment dedupe / different-article / unfetched, node:sqlite fake-D1 harness).

---

## P2 — Correction truncation — DONE

**Root cause (Phase 2 finding):** the rewrite call in `backend/agents/autonomy/factcheck.js` used `maxTokens: 200` and `cleanCandidate` took only the first sentence, so a long corrected sentence was cut mid-sentence and the fragment was spliced into the body. `isValidReplacementSentence` did NOT reject a leading meta sentence with a period ("Here is the corrected sentence." would pass and be spliced in as the correction). #30's attempt burned 10 LLM calls / 98 Neurons on doomed attempts. Evidence quotes passed to the model were already bounded (bestQuote ≤ 300 chars).

**Change** (`backend/agents/autonomy/factcheck.js`):
- Rewrite call: `maxTokens` 200 → 500; prompt tightened (ONLY the corrected sentence, under 40 words, ending with a period, no introduction/explanation/quotation marks).
- `cleanCandidate` drops a leading meta sentence and uses the next sentence. NEW export `isTruncatedReply` (true when the trimmed reply lacks terminal punctuation; empty → false). `isValidReplacementSentence` rejects meta replies ("Here is the corrected sentence." / "The corrected sentence is:").
- Retry: up to 2 attempts per claim (2nd with the evidence quote sliced to 150 chars). Failure reasons recorded: `truncated-reply`, `rewrite-rejected`, `rewrite-error`, `validation-rejected`, `rewrite-circuit-open`, `sentence-not-found`, `context-dangling`. Run-level circuit breaker stops LLM rewrites after 2 consecutive truncations (saves Neurons).
- `failureReason` is kept in the returned `results` even when the claim is later corrected/removed (it explains why it was removed rather than corrected), but the stored correction row records a failure reason only when the attempt FAILED (success rows get null). The validation-rejected results mapping also sets `failureReason: 'validation-rejected'`.
- Passage-level scope preserved: correction still rewrites only the unsupported sentence (the "passage") and never touches unrelated paragraphs/structure; only the article's own evidence pool is passed to the model.
- auto_correction stays OFF. The live proof of a clean correction happens in the parent's live #31 E2E, not here.

**Tests:** in `tests/factcheck-phase3.test.js` — truncated-first-reply retried and saved; meta-wrapped reply never spliced; circuit-breaker test (two wrong-number claims — 2nd claim gets `failureReason: 'rewrite-circuit-open'` and exactly 2 LLM calls).

---

## P3 — Claim extraction cleanup — DONE

**Root cause (Phase 2 finding, Article #30's latest fact_check, 20 claims):** claims 1–2 were the AI-DRAFT banner's 2nd/3rd lines ("This draft was written by workers-ai (@cf/openai/gpt-oss-20b)." / "It has NOT been fact-checked…") — the banner strip regex `/^AI-DRAFT[^\n]*\n?/im` removed only line 1. Claims 7, 11, 15, 17, 20 carried a leading "[The Guardian]" prefix. Claims 11/15/17 are bold day lead-ins ("**Day 1 – Ferry Ride** …") — real statements, to be kept after stripping the prefix.

**Change** (`backend/agents/autonomy/factcheck.js`):
- NEW exports: `stripCitationPrefix` (strips a leading `[...]` label up to 60 chars; the citation survives via `evidence_url`), `claimKey` (strip prefix, lowercase, collapse whitespace, trim, slice 200 — stable identity across runs), `isBannerOrMetaLine` + `BANNER_LINE_RE` (AI-DRAFT / "This draft was written by" / "It has NOT been fact-checked" / SCAFFOLD lines) + `EDITORIAL_LINE_RE` (bracketed lines containing write/todo/placeholder/no content yet).
- `stripCitationLines` now drops banner/meta lines first (it is shared with the corrected-body validator, so the banner is excluded there too); the old single-line AI-DRAFT replace in `extractClaims` removed as redundant. `extractClaims` strips the citation prefix from each sentence BEFORE the length/assertion checks, so no genuine claim is silently discarded.
- `claimPattern` (tolerant matcher for `replaceSentence`) now tolerates an optional leading bracketed citation label before the sentence, so a corrected claim is still found in the body.

**Tests:** in `tests/factcheck-phase3.test.js` — `extractClaims` on a #30-like banner body returns exactly 3 real claims; banner lines and "[The Guardian]" prefixes gone; the day lead-in kept.

---

## P4 — Guardian 406 — DONE

**Root cause (Phase 2 finding):** `checkBrokenLinks` in `backend/agents/autonomy/seo.js` did a HEAD fetch with `ok` = 2xx/3xx, so a 406 → `ok: false`, check level 'failed'. Every Guardian-sourced article could therefore never pass SEO, even though the link is live and the publisher simply rejects the checker's HEAD request.

**Change** (`backend/agents/autonomy/seo.js`):
- NEW export `classifyLinkStatus(status, error)`: `'ok'` for 2xx/3xx; `'broken'` ONLY for 404/410/400; `'unverifiable'` for 406 (reason names the HEAD-request cause), 401/403 (auth/paywall — never bypassed), 429, 5xx, timeout, unreachable — each with an exact reason string.
- `checkBrokenLinks` rewritten: plain HEAD first; on an unverifiable 406/403/429 outcome, ONE retry with a legitimate browser-like User-Agent (Chrome 126 UA string + Accept header). Result rows carry `classification`, `reason`, `retriedWithBrowserUa`, `error`, and `ok` (true only when classification is `'ok'`) for backward compat.
- Check 10 in `runSeoCheckSuite`: broken → level `'failed'`; unverifiable-only → level `'needs-review'` (never a pass, never a confirmed-broken fail) with an actionable Fix line telling the owner to open the link in a browser (a publisher 406 usually means the link is fine but the checker was blocked).
- No migration needed for P4.

**Tests:** `tests/seo-links-phase3.test.js` — 5/5 pass: classify matrix (200/301 ok; 404/410/400 broken; 406/401/403/429/5xx/timeout/unreachable unverifiable); 406 Guardian link → needs-review, not failed; 406→200 browser-UA retry passes (asserts both the plain HEAD and the UA retry happened); 404 still confirmed-broken/failed; timeout unverifiable.

---

## P5 — Duplicate correction rows — DONE

**Root cause (Phase 2 finding):** 11 rows / 6 distinct claims on #30 — TWO correction runs against DIFFERENT fact_check `claim_check_id`s (first run ids 111,112,116,117,118,124; second run 131,132,136,138,144, all attempt 1, status 'failed'). Identity was keyed to `claim_check_id`, which changes every fact-check, so the attempts counter saw 0 on the second run. The gate counted rows; the corrections endpoint returned all open rows with `total` = row count; the dashboard panel deduped by claim (6 entries) — three different numbers for the same thing.

**Change:**
- `backend/agents/autonomy/factcheck.js` — `claimKey` identity (see P3). `runCorrection` loads existing correction rows once, counts attempts per claim key across runs (not per `claim_check_id`), and records via NEW `recordCorrection(env, articleId, p)` helper: success (applied/removed) always INSERTs; failure with an existing OPEN row (pending/failed) UPDATEs it in place (attempt + latest `claim_check_id` + `failure_reason` + `claim_key`) instead of inserting a duplicate; `claim_key` + `failure_reason` written when migration 017 is applied, with try/catch fallback to the old column list when the columns don't exist yet (matches the Phase 2 protection.js tolerance pattern). Within-run same-key collisions handled via a `failedRowByKey` map at both record sites. History is never deleted.
- `backend/publishing/gate.js` — gate check 4 now counts unresolved CLAIMS: a claim is unresolved when its LATEST correction row is pending/failed (subquery `GROUP BY COALESCE(claim_key, original_text)`, join on max id); try/catch fallback to the old row-count query when `claim_key` doesn't exist yet. Detail text now says "correction claim(s)".
- `backend/routes/orchestrator.js` — `handleListCorrections` dedupes rows by claim_key server-side (earliest open row per claim); `total` = distinct claims, plus `rows` = raw row count and `duplicateRows` for reconciliation; imports `claimKey` from factcheck.js.
- `deriveFailureReason` prefers the stored `failure_reason` (via the `FAILURE_REASON_TEXT` map) when present; derived text is the fallback for pre-migration rows.
- Migration 017 (below) adds `claim_key` + `failure_reason` and a partial unique index on pending rows only — failed rows are deliberately NOT covered, so history is preserved.

**Tests:** in `tests/factcheck-phase3.test.js` — second correction run updates the open row (1 row, attempt 2, `failure_reason: 'validation-rejected'`); gate check 4 counts 1 claim; migration 017 backfill test (checks via `pragma_table_info` first). Concurrent/repeated-run behaviour is covered by the same-key update path + the partial unique index (a concurrent second pending insert for the same claim key is rejected by the DB, not silently duplicated).

---

## P6 — Verdict consistency — DONE

**Root cause (Phase 2 finding):** claim 8 flipped UNSUPPORTED → VERIFIED with no correction saved. The mechanism is the LLM entailment judge (borderline score 0.3–0.5) re-run non-deterministically in `runCorrection`'s final `checkArticle` recheck. `fact_checks` had no `check_kind`; `claim_checks` had no `previous_verdict` — so nothing distinguished an original verdict from a post-correction re-check verdict, and nothing could explain the flip.

**Change:**
- `backend/agents/autonomy/factcheck.js` — `loadEvidence` pool items now carry `fetchedAt` (both SELECTs gained `fetched_at`).
- `checkArticle(env, article, options = {})` rewritten: `checkKind` (`'initial' | 'recheck' | 'correction-recheck'`); evidence signature = sorted `researchItemId:fetchedAt` pairs joined; the previous fact_check + its claim_checks are loaded into `previousByKey` (claimKey → verdict/explanation/evidenceUrl/evidenceQuote); a claim with identical text AND an unchanged signature (the previous row must have a non-null signature — pre-migration rows never carry forward) is CARRIED FORWARD with its previous verdict and explanation + "(Unchanged — verdict carried forward: same claim text, same evidence.)" — no LLM judge call, no flip, no Neurons; changed-text or changed-evidence claims are evaluated fresh; `previous_verdict` is stored on every `claim_checks` row; the `fact_checks` insert gains `check_kind` + `evidence_signature` with fallback to the old column list; the return value gains `checkKind` + `carriedForward` count.
- `runCorrection`'s three recheck calls pass `{ checkKind: 'correction-recheck' }` (pool-empty path, validation-rejected path, final path). `runFactChecking` passes `{ checkKind: payload.check_kind || 'initial' }`.
- `backend/routes/orchestrator.js` — `handleRecheckArticle`: new tasks get payload `check_kind: 'recheck'`; reused tasks get their stored payload updated to include it (try/catch falls back to the old status-only update). `parsePayload` handles string or object payloads (verified).
- A correction attempt alone never flips a claim to VERIFIED: an unchanged claim is carried forward (above), and a changed claim is independently re-evaluated against the article's own evidence. Historical verdicts + timestamps are preserved in `fact_checks`/`claim_checks` (never overwritten); the latest verdict is visible via the latest fact_check.
- Migration 018 (below) adds `check_kind`, `evidence_signature`, `previous_verdict`.

**Tests:** in `tests/factcheck-phase3.test.js` — unchanged claim carried forward despite a NOT_SUPPORTED judge reply (1 LLM call total, signature equal, `previous_verdict` 'VERIFIED'); new evidence re-evaluates fresh and records the flip; a correction attempt alone never flips unchanged claims.

---

## P7 — Neurons / usage reconciliation — DONE

**Root cause (Phase 2 finding):** two read paths over the same `llm_usage` table disagreed — header (`/api/autonomy/llm` → `providerStatus` → `getDailyUsage`, UTC-date substr) vs KPI (orchestrator `COUNT(*)`/`SUM(neurons)` with `date(created_at) = date('now')`). D1 analytics showed 23 calls / 259 Neurons on 2026-11-20 vs the dashboard header's 55. Two real causes found: (1) the header `loadLlm()` was called ONLY once at dashboard init (`autonomy.js:1288`) — never refreshed after runs, so 55 was a stale snapshot; (2) cap-refusal `'quota-exhausted'` rows are written per `generateText` call and inflate `COUNT(*)` — the KPI counted every row regardless of outcome. Additionally, Workers AI neuron figures are ESTIMATES from pricing rates (`estimateNeurons`) and token counts are estimated from char length when the API returns no usage block — never labelled as estimated in the dashboard. `recordUsage` is called once per attempt (no duplicate recording in code).

**Change:**
- `backend/llm/usage.js` — `recordUsage` accepts `neuronsEstimated` and writes it to the new column (migration 016) with fallback to the old INSERT when the column is absent. `getDailyUsage` is now THE authoritative rule (documented in the file): requests = outcome IN ('ok','error') only (cap-refusal 'quota-exhausted' and 'not-configured' are audit-only); neurons/tokens summed from 'ok' rows only; `neuronsEstimated` = the estimated part of today's Neurons, null when the column is absent (unknown, never 0-as-known). NEW `getAllProvidersDailyUsage(env, date)` (workers-ai/groq/gemini via the one rule). `isCapHit` unchanged in behaviour (uses `getDailyUsage`; the 'ok' 9000-Neuron seed still caps).
- `backend/llm/index.js` — ok-path `recordUsage` now passes `neuronsEstimated: !!result.neuronsEstimated`.
- `backend/routes/orchestrator.js` — analytics payload: `llmToday` now comes from `getAllProvidersDailyUsage` (same shape `calls`/`neurons` plus `neuronsEstimated` when known and a `byProvider` breakdown); `llm7d` SQL now filters `outcome IN ('ok','error')`. Both read paths (header via `providerStatus` → `getDailyUsage`, KPI via this payload) now share the one rule. UTC-date handling is consistent (`todayStr()` vs SQLite `date('now')`, both UTC).
- `frontend/scripts/autonomy.js` — `loadLlm()` is now re-called after task runs complete — in `runTask`, `runWeekly`, the daily-run handler, and `recheckArticle` (which runs the LLM judge). The header line and the 'LLM calls today' KPI card append "(N estimated)" when `neuronsEstimated > 0`. (The `loadPipeline()` edit matched 3 identical sites; only the first — `recheckArticle` — was replaced, which was the intended one; SEO check/optimize don't consume LLM.)
- `backend/middleware/validation.js` — NEW shared `isMissingColumnError(err)`: SQLite (local tests) says "table X has no column named Y"; Cloudflare D1 says "no such column: Y". This was a real bug found by the new tests (the `recordUsage` fallback test failed until the helper covered both messages). All 7 migration-fallback sites (factcheck.js ×4, usage.js ×2, gate.js ×1) now use it, so fallbacks work both locally and on D1.
- Migration 016 (below) adds `llm_usage.neurons_estimated`.

**Tests:** `tests/llm-usage-phase3.test.js` — 5/5 pass: `getDailyUsage` rule (3 requests from 2 ok + 1 error; quota-exhausted/not-configured excluded; neurons 150 from ok rows; neuronsEstimated 100); neuronsEstimated null without migration 016; `getAllProvidersDailyUsage` aggregation; `recordUsage` flag storage + fallback without the column; `generateText` estimated-flag flow (provider-reported usage → 0; no usage block → 1).

---

## P8 — Canonical / nav / sitemap — DONE

**Root cause (Phase 2 finding):** the sitemap generator emitted 35 entries (1 home + 8 divisions + 25 published articles from the static `ARTICLES` in `backend/routes/articles.js` + 1 tools) vs the committed `public/sitemap.xml` 58 locs and `frontend/sitemap.xml` 60 locs. Missing from the generator: `/pages/division` (all-divisions), 20 per-tool pages (`?tool=`), privacy, terms (58) + about, contact (60). The generator had NO production callers (only `tests/indexing-canonical.test.js`). Separately, `division.html`'s static canonical + JS canonical still used the `.html` form (`.../pages/division.html?division=`), and nav `.html` links existed in `app.js` renderHeader, footer, division cards, tool cards, `index.html`, `navigation.js` active-state matching, and about/contact/privacy/terms/tools/dashboard/owner-setup canonicals + og:url + JSON-LD. Clean forms DO resolve on Pages (live-verified in Phase 2: `/pages/division?division=automotive`, `/pages/tools?tool=fuel-cost`, `/pages/article?id=1` all work). **Note: backend D1 tool slugs differ from frontend ids** (D1 'currency-manual-rate' vs frontend 'currency-converter', D1 'storage' vs 'storage-converter', D1 'distance' vs 'distance-planner', D1 'age' vs 'age-calculator', D1 'date' vs 'date-calculator', D1 'unit' vs 'unit-converter', D1 'time' vs 'time-calculator') — the sitemap must list frontend ids because `?tool=` is read by the frontend.

**Change:**
- `backend/routes/tools.js` — NEW export `FRONTEND_TOOL_IDS` (the 20 frontend ids in sitemap order) with a comment explaining they differ from the D1 slugs.
- `backend/services/seo.js` — `sitemapEntries()` extended to **60 entries** (home, `/pages/division`, 8 divisions, 25 published articles, `/pages/tools`, 20 per-tool pages from `FRONTEND_TOOL_IDS`, about, contact, privacy, terms); drafts/private routes never listed; doc comment records the old 35-vs-58/60 gap.
- NEW `scripts/regenerate-sitemap.mjs` — writes both sitemaps from `sitemapXml()`, checks for duplicate locs, exits 1 on duplicates. Run once 2026-11-20: both `public/sitemap.xml` and `frontend/sitemap.xml` now have 60 entries, are byte-identical (`diff` clean), no duplicate locs. Article entries gained `<lastmod>` from `publishedAt` (generator behaviour).
- Canonical/nav cleanup: all `.html` removed from internal hrefs/canonicals/og/JSON-LD in `frontend/pages/*.html`, `frontend/index.html`, `frontend/404.html` via sed (verified with grep — NONE remain; includes `division.html:75` JS canonical now `.../pages/division?division=` + div.id, back-links `../index.html` → `../`, sibling links `contact.html` → `contact`, etc.). `frontend/scripts/app.js` renderHeader nav now `[['/', 'Home'], ['pages/division', 'Divisions'], ['pages/tools', 'Tools']]` (Home href is absolute `/`; brand `prefix || '/'`), footer division/about/contact/privacy/terms links, division cards (`pages/division?division=`), tool cards (`pages/tools?tool=`) all clean. `frontend/scripts/tools.js` card link clean. `frontend/scripts/navigation.js` active-state now strips a trailing `.html` from both path and href before matching (`/division`, `/tools`, `/dashboard`, home `/`/`../`/`index`), so a visitor landing on a `.html` URL directly still gets the active state. Article JS canonical was already clean — untouched. The google-verification filename text in app.js (lines 157/168) is NOT a link and was left alone.
- 9 pre-existing tests that pinned the OLD `.html` forms were updated to the intended clean forms (2 analytics deep-equals for the new `byProvider` shape, dashboard-gating ×3, division-not-found ×2, sitewide-admin-security canonical regex, pages-contact-about ×2). No test was weakened — each now asserts the clean form and, where relevant, asserts the `.html` form is absent.
- No migration needed for P8.

**Tests:** NEW `tests/sitemap-canonical.test.js` — 5/5 pass (backend `FRONTEND_TOOL_IDS` == frontend DEFS ids parsed from `frontend/scripts/tools.js`; every tool id has a sitemap entry; no `.html` in any canonical/og/JSON-LD/internal href across all 11 frontend HTML files; division.html JS canonical clean; app.js/tools.js/navigation.js build no `.html` internal links; navigation.js strips `.html` before matching). UPDATED `tests/indexing-canonical.test.js` — generator now asserted at 60 entries (was 35) with breakdown; both committed sitemaps asserted at 60 each (public was 58); generator output EQUALS both committed loc sets (was subset); both files byte-identical; tool pages + legal/about pages asserted in both; no drafts/private routes. Combined Phase 3 sitemap run: 73 tests across 7 files, 73 pass.

---

## Migrations (written, NOT applied live — parent applies after verifying)

All three are additive, safe, and carry try/catch fallbacks in code so the Worker keeps working while they are unapplied. Console-chunks copies written under `database/console-chunks/` in the established `migration-0NN_<name>.sql` pattern. All three were verified to apply cleanly on a fresh DB built from `database/schema.sql` + migrations 005/006/008/009/010/011/012 + 014/015 (migration 013 is already folded into `schema.sql` line 137 — `is_protected` — so applying 013 on top fails with "duplicate column name", which is why tests don't include 013). All new columns + both new indexes confirmed present via pragma.

- **016 `database/migrations/016_llm_usage_estimated.sql`** (P7): `llm_usage.neurons_estimated INTEGER CHECK (neurons_estimated IN (0, 1))`, nullable, no default (existing rows → NULL = unknown). Safe/additive. Rollback: leave the column (code falls back) or rebuild the table.
- **017 `database/migrations/017_correction_claim_key.sql`** (P5): `article_corrections.claim_key TEXT` + `failure_reason TEXT`; backfill `claim_key = lower(trim(substr(original_text, 1, 200)))` (stored texts were already whitespace-normalised by `extractClaims`, so this matches `claimKey()` for realistic rows; the bracket-prefix strip can't be expressed in plain SQL but the key stays stable/unique); partial unique index `idx_corrections_claim_pending ON article_corrections(article_id, claim_key) WHERE status = 'pending'` (failed rows deliberately NOT covered — history preserved) + plain index `idx_corrections_claim_key`. Safe: live D1 has 0 pending rows (verified 2026-11-20, before and after implementation). Rollback: DROP INDEXes.
- **018 `database/migrations/018_factcheck_verdict_history.sql`** (P6): `fact_checks.check_kind TEXT NOT NULL DEFAULT 'initial' CHECK (... 'initial'|'recheck'|'correction-recheck')`, `fact_checks.evidence_signature TEXT`, `claim_checks.previous_verdict TEXT CHECK (verdict words)`. Safe/additive; existing rows get 'initial'/NULL signature (never carried forward). Rollback: leave the columns (code falls back).
- **No migration needed for P1** (resolver works without a `url_canonical` column), **P4**, or **P8** — stated explicitly per priority.

---

## P9 — Article #31 source recommendation (preparation only — NOT created)

**Recommended source (ONE):**
- **Inside Higher Ed — "Will More International Students Enroll Next Year?"**, by Kathryn Palmer, 19 Nov 2026
- **Exact stored URL (research item id 675, division 8 Education & Learning, fetched 2026-11-19 17:11:43):**
  `https://www.insidehighered.com/news/admissions/traditional-age/2026/11/19/will-more-international-students-enroll-next-year`
- **Stored evidence (307 chars, real prose):** "Will More International Students Enroll Next Year? kathryn.palmer… Thu, 11/19/2026 - 03:00 AM Although international enrollment is down this fall, preliminary data from Common App shows a 9 percent uptick in the number of international applicants for the 2026–27 academic year. Byline(s) Kathryn Palmer" — contains a concrete, checkable fact (9% uptick, Common App data) for generation + fact-check.
- **Retrievability verified 2026-11-20 (curl):** HEAD 200 in 0.59s; GET 200, 150,819 bytes — the page is live and fetchable.
- **Why this one:** non-Guardian (avoids the 406 class entirely); 307 chars of real prose evidence — the other education candidates were weaker (EdSurge item 694: 98 chars; Higher Ed Dive item 696: 114 chars; Higher Ed Dive item 695 Pell Grant: 368 chars but starts with an `<img>`/figure HTML tag, no real prose in the first 200 chars); a single clear topic; recent (19 Nov 2026).
- **P1 live test:** supply the URL **WITH a trailing slash** (`.../will-more-international-students-enroll-next-year/`) — the stored URL has no trailing slash, so this is the exact Phase 2 failure shape and proves the normalizer resolves it. The parent's live E2E should also confirm the resolved item records `matchMethod: 'normalized'`.

**Not created:** no article row, no D1 writes, no generation/fact-check run — the parent runs the live #31 E2E after deploy.

---

## P10 — Weekly run — NOT TESTED, NOT TOUCHED

Scheduled run due 22 Nov 2026 06:00 Dhaka — not yet due; schedule unchanged; nothing claimed. The separate MANUAL weekly run ordered by the owner on 2026-11-20 15:58 is the parent's browser task; this implementation did not touch any weekly workflow.

---

## Files changed (Phase 3 implementation)

**Backend:** `backend/services/urls.js` (new), `backend/agents/autonomy/content.js`, `backend/agents/autonomy/factcheck.js`, `backend/agents/autonomy/seo.js`, `backend/services/seo.js`, `backend/llm/usage.js`, `backend/llm/index.js`, `backend/publishing/gate.js`, `backend/routes/orchestrator.js`, `backend/routes/tools.js`, `backend/middleware/validation.js` (new `isMissingColumnError` helper). `backend/llm/registry.js` unchanged — it already uses `getDailyUsage`.

**Frontend:** `frontend/scripts/autonomy.js`, `frontend/scripts/app.js`, `frontend/scripts/tools.js`, `frontend/scripts/navigation.js`, `frontend/pages/*.html` (canonicals/og/JSON-LD/hrefs), `frontend/index.html`, `frontend/404.html`, `public/sitemap.xml` + `frontend/sitemap.xml` (regenerated, 60 entries, byte-identical).

**Migrations:** `database/migrations/016_llm_usage_estimated.sql`, `017_correction_claim_key.sql`, `018_factcheck_verdict_history.sql` + console-chunks copies.

**Scripts:** `scripts/regenerate-sitemap.mjs` (new).

**Tests (new):** `tests/url-normalization.test.js` (11), `tests/url-resolution.test.js` (5), `tests/factcheck-phase3.test.js` (14), `tests/llm-usage-phase3.test.js` (5), `tests/seo-links-phase3.test.js` (5), `tests/sitemap-canonical.test.js` (5). **Tests (updated):** `tests/indexing-canonical.test.js` (60-entry generator + committed-file equality), `tests/autonomy-analytics.test.js` (new `byProvider` shape), `tests/dashboard-gating.test.js` (×3), `tests/division-not-found.test.js` (×2), `tests/sitewide-admin-security.test.js` (canonical regex), `tests/pages-contact-about.test.js` (×2).

---

## NOT TESTED

- The live #31 E2E (generation, fact-check, correction attempt, SEO, gate) — parent's job after deploy; NOT run here by design.
- The scheduled weekly run (22 Nov 2026 06:00 Dhaka) — not yet due.
- Live migration application (016–018) — parent applies after verifying; code fallbacks mean the Worker works either way, but the new behaviours (claim-key dedupe, verdict carry-forward, estimated-neurons flag) only take full effect once the columns exist.
- Live browser verification of the clean canonicals/nav — parent's live check after deploy (clean forms were verified to resolve on Pages during Phase 2).

## OWNER AUTHORIZATION REQUIRED

- Google Search Console retry (sitemap re-submit + Request indexing) — due 2026-11-21, separate track; NOT done here.
- Any article publish (including #31 after the E2E) — needs his explicit item-named approval.
- The manual weekly run ordered 2026-11-20 — parent's browser task; no action by this implementation.

## Remaining limitations

- **Correction quality is still unproven live.** The P2/P5/P6 fixes make correction attempts safer and idempotent, but no live correction has ever produced a clean, saved correction (Phase 2 #30's attempt was rejected by validation). auto_correction stays OFF; the #31 E2E is the proof.
- **Evidence text is capped at 500 chars per stored item** and some stored items carry HTML fragments or very thin evidence (e.g. the Pell Grant item's evidence starts with an image tag). The #31 pick was chosen to avoid that, but the fetcher's evidence extraction quality is a separate, unrepaired item.
- **Neurons remain estimates.** Workers AI reports no usage block for the model in use, so neuron figures are derived from pricing rates and token counts from char length. They are now labelled "(N estimated)" in the dashboard when known, and the authoritative rule excludes cap-refusal rows — but the numbers are still estimates, not provider-reported usage.
- **SEO link checking still cannot verify a 406/403 link.** It now reports 'unverifiable / needs-review' honestly instead of failing it, but the owner must still open such links in a browser to confirm them.
- **The 017 backfill `claim_key` is an approximation** (plain-SQL `lower(trim(substr(original_text, 1, 200)))` — it cannot strip a "[Source]" prefix the way `claimKey()` does). It is stable and unique for the realistic stored rows, and the gate's `COALESCE(claim_key, original_text)` grouping tolerates any mismatch; new rows written after the migration use the exact `claimKey()`.
