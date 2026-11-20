# Fact-Check Carry-Forward — Investigation & Repair: Verification Report

**Date:** 2026-11-21 (work 2026-11-20 23:54 – 2026-11-21 00:19 Dhaka)
**Task:** focused investigation and repair of the fact-check carry-forward
mechanism. Scope limited to fact-check integrity — no other development
phase was begun. **Article #31 was NOT published and remains a draft.**

## Verdict

**The defect is fixed, deployed, and proven live.** A Re-check now runs a
real fact-check; every run stores a SHA-256 hash of the body it judged;
the publishing gate rejects stale results fail-closed. Article #31's
stored PASS 5/5 was **stale, not fresh** — a genuinely fresh re-check
now stands in its place (needs-review, 3 verified / 1 failed), and the
gate evaluates that fresh result on its own merits.

## 1. Root cause

The #31 "carry-forward" was **not** the Phase 3 P6 claim-level mechanism
— it was a task-kind mismatch that made Re-check a no-op. Confirmed in
code and in live D1, layer by layer:

**Layer 1 — the actual #31 failure (Re-check routed through runCorrection).**
1. The dashboard **Correct** button creates `kind='correct'` task rows
   (`frontend/scripts/autonomy.js:1341`). That is how live task #34
   (agent `fact-checking`, kind `correct`) came to exist for #31.
2. `handleRecheckArticle` (`backend/routes/orchestrator.js:1209`)
   reused the article's NEWEST fact-checking task whatever its kind:
   `findFactCheckTasksForArticle` (`orchestrator.js:959`) matches ANY
   `agent='fact-checking'` row (`ORDER BY id DESC`), and took #34. It
   set only `payload.check_kind='recheck'`; the row's `kind` stayed
   `'correct'`.
3. `runFactChecking` dispatched `kind === 'correct'` unconditionally
   to `runCorrection`, which returns early
   `{outcome:'no-op', reason:'Latest fact-check already passes —
   nothing to correct.'}` when the latest verdict is `pass` — writing
   NO `fact_checks` row and extracting NOTHING.
4. `runTask` treats `'no-op'` as success, and the handler read
   `latest` = the OLD row and returned it as a completed re-check.
   That is runs #121/#122: no new rows, old PASS 5/5 presented as a
   fresh result.

**Layer 2 — P6 carry-forward was lossy (latent).** `checkArticle`
(`backend/agents/autonomy/factcheck.js:440+`): `claimKey` truncated
claim identity to 200 chars (two different long claims can share a
prefix), and the evidence signature was only research-item ids +
fetch times (`id:fetched_at`) — it did NOT cover evidence CONTENT, so
editing an evidence item's text (same id, same `fetched_at`) would
still carry verdicts forward.

**Layer 3 — the gate could not detect staleness.** `evaluatePublishGate`
(`backend/publishing/gate.js`, check 1) read ONLY the latest
`fact_checks` row's verdict. No body hash or version existed anywhere
in the schema, so an edited article kept its old PASS at the gate
indefinitely.

## 2. Files changed

**Fix commit `d0cd8a0` (10 files, +1,287 −68):**

| File | Change |
|------|--------|
| `backend/utils/bodyHash.js` (NEW, 56 lines) | `normaliseBodyForHash` (formatting-only differences normalise away; any wording change differs), `sha256Hex` (WebCrypto), `bodyHash`. |
| `database/migrations/019_factcheck_body_hash.sql` (NEW) | `ALTER TABLE fact_checks ADD COLUMN body_hash TEXT;` (additive only; existing rows keep NULL = unknown). |
| `backend/agents/autonomy/factcheck.js` | Re-check dispatch guard (a `recheck` payload never routes to `runCorrection`); `claimHash` (full SHA-256 of normalised claim text — carry-forward match uses this, not the truncated `claimKey`); evidence signature now `id:fetched_at:contentHash16` per pool item; body hash stored on every run with a two-level fallback (019 → 018 → base column lists). |
| `backend/routes/orchestrator.js` | Re-check forces a reused task row's `kind` to `'fact-check'` (both UPDATE paths); fails LOUDLY with HTTP 500 when the outcome is not `'done'` or when no new fact-check row was written, instead of presenting the old row as a fresh result; response `latest` carries `bodyHash`. |
| `backend/publishing/gate.js` | Checks 1–3 (`fact-check-pass`, `no-unresolved-errors`, `sources-verified`) fail on a stale run. A missing hash (legacy row) counts as stale — fail-closed. Detail states plainly: "fact-check is stale: the latest fact-check was recorded before body-hash tracking — run a fresh fact-check." (or "article body changed after the latest fact-check" when a hash exists but differs). `approved_only` / publishing-rules check untouched. |
| `tests/factcheck-integrity.test.js` (NEW, 13 tests) | Regression suite (§4). |
| `tests/factcheck-phase3.test.js`, `tests/publish-gate.test.js`, `tests/activation-repairs.test.js` | Setup only: seeds now represent genuinely fresh runs (migration 019 applied; passing fact-checks seeded with the matching body hash). No assertion weakened. |
| `docs/FACTCHECK-INTEGRITY-NOTES-2026-11-20.md` (NEW) | Coordinator's implementation notes (this report is the verification). |

Two misleading comments were corrected by the parent before deploy (no
behaviour change): the migration file's comment and one code comment
had claimed carry-forward was gated on the body hash — it is not (see
the deviation note below). The comments now describe the implemented
behaviour.

**Deliberate deviation from the brief's B.2, stated openly:** per-claim
carry-forward is NOT gated on the body hash. An unchanged claim (same
full text hash) against unchanged evidence (same content signature) may
still carry forward after a sibling claim is edited; only changed/new
claims are freshly judged, and removed claims leave no row. Reason: the
user's own objective 3 permits reuse exactly on those conditions
("Unchanged claims may reuse verdicts only when claim identity AND
evidence identity are demonstrably unchanged") — it does NOT condition
reuse on body identity. Gating carry-forward on the body hash would
force the non-deterministic LLM judge to re-run on every unchanged
claim after any edit, reintroducing the live #30 flip
(UNSUPPORTED → VERIFIED with no correction saved) that P6 exists to
prevent. The body hash does its real job at the gate: the old run is
rejected as stale until a fresh run exists. Fresh extraction always
runs on the current body, changed claims are always freshly judged,
and the active claim set is always the latest run's rows. Tests 1, 4
and 9 pin this behaviour. If the owner wants whole-run invalidation
instead, it is a one-line change (`signatureUnchanged` gains a
`bodyUnchanged` condition) — but it would trade away the P6 flip
protection.

## 3. Commit and deployment status

- **Fix commit: `d0cd8a0d2afc853530ed6431c503d5448065835e`**
  ("fix: fact-check integrity — re-check always runs a real check,
  body-hash staleness, gate rejects stale results", 1 parent `f2b0e35`,
  10 files, +1,287 −68, workflow run #22 SUCCESS 2026-11-20 18:15 UTC;
  workflow file + zip gone from main; verified on GitHub).
- **Migration 019 applied LIVE** to D1 (2026-11-21 00:15 Dhaka):
  `body_hash` column exists on `fact_checks`; the pre-fix rows keep
  NULL (stale by design). Deploy-order note: between deploy and
  migration, every gate read stale (fail-closed) — the migration was
  applied immediately after the deploy, as planned.
- The fix is live: the dashboard gate produced the new stale detail
  on first load after deploy (§7).

## 4. Test results

**Parent's own run (not the builder's word): `npm test` — 894 pass /
0 fail / 213 suites, exit 0.** Baseline before this work: 881 pass /
0 fail / 207 suites. **+13 tests, all in the new file.**
`node --check` clean on every touched file; `backend` `npm run check`
clean. No existing test was weakened. No build script exists in
`package.json`, so no build applies.

New suite `tests/factcheck-integrity.test.js` (13 tests, 6 suites) —
all 9 required cases covered:

| # | Case | Result |
|---|------|--------|
| — | Body-hash normalisation (formatting ≡, wording ≠; claimHash vs claimKey collision) | pass |
| 1 | Material body edit → changed claim freshly judged, unchanged claim carried, old text gone | pass |
| 2 | Formatting-only change → both claims carry forward, identical body hash | pass |
| 3 | New claim added → fresh UNSUPPORTED evaluation, never carried VERIFIED | pass |
| 4 | Removed claim → no active row in the new run | pass |
| 5 | Changed evidence CONTENT (same id/fetch time) → fresh evaluation, signature changes | pass |
| 6 | Unchanged claim + identical evidence → carries forward, no LLM call | pass |
| 7 | Gate rejects stale check (body edited) and accepts a fresh one; legacy hash-less row → stale (fail-closed) | pass |
| 8 | Re-check payload on a kind=`correct` task → real fact-check (new row); genuine correction still no-ops when nothing to correct; endpoint reuses a kind=`correct` task row (live #31 shape), forces it to `fact-check`, fails loudly if no new row | pass |
| 9 | Multi-round edit → re-check → edit → re-check stays correct (incl. revert re-verifying) | pass |

## 5. Whether Article #31's current fact-check is fresh or stale

**FRESH — after the live re-check below. It was STALE before it.**

Read-only analysis (done before the fix, with the real `extractClaims`
run locally against the current 684-char body): the body extracts
exactly **4 claims**; "The data so far are preliminary." is not a
claim (31 chars, below the 40-char minimum). **0 of the 5 stored
claims (fact_check 19) matched any current claim** — verified by
`claimKey` comparison for the two known stored texts, and the other
three came from sections that no longer exist (Key takeaways removed;
conclusion rewritten). The stored set included a removed claim ("…trend
may be temporary") that still "remained active" in the stored check.
**The stored PASS 5/5 was stale, not fresh** — it judged a different
body (14:17) than the one live now (17:08 correction).

Live re-check (run #123, task #34, 2026-11-20 18:17:14 UTC) wrote a
NEW fact-check row **20**: `check_kind='recheck'`, verdict
**needs-review**, 4 claims total, **3 verified / 1 failed**, with a
stored body hash that matches the live body exactly (§7). Its 4 claim
rows are the current-body sentences, all with `previous_verdict`
NULL — fresh evaluation, no carry-forward from the old run. The
fresh fact-check is therefore the current one, and it does NOT pass:
the "early signal — not proof" claim is UNSUPPORTED (see §7 for the
one deviation from the predicted 2/2 split).

## 6. Whether the publishing gate rejects stale results

**YES — proven live, both directions.**

- **Before the fresh re-check** (new code live, legacy row 19 latest):
  checks 1–3 all FAILED with the exact stale detail: "fact-check is
  stale: the latest fact-check was recorded before body-hash tracking
  — run a fresh fact-check." Gate: content-ready NO, fact-check NO,
  SEO NO, eligible NO, authorized NO.
- **After the fresh re-check** (row 20 latest, hash matches): the
  stale detail is GONE. Check 1 now reads "Latest fact-check verdict:
  needs-review (3/4 claims verified)" — the gate evaluates the fresh
  result on its own merits (and fails it on verdict, correctly).
  Check 2: "1 claim(s) still failed in the latest fact-check."
  Check 3: ✓ "1 source(s) recorded for this article." #31 remains
  Blocked and cannot publish.

## 7. Live verification evidence

(Dashboard browser task 2026-11-21 00:15–00:19 Dhaka, signed in as
Owner; every item below was then confirmed independently by the parent
in D1.)

- **Gate stale (Step 1):** checks 1–3 failed with the stale detail on
  first load after deploy — no waiting or reloads needed. Published
  count 25. Usage before: 32 LLM calls / 484 Neurons today.
- **Fresh re-check (Step 2):** clicked once, completed in ~2 minutes,
  no error. Dashboard: "Re-check completed for article #31 (task #34,
  task reused, run #123): latest fact-check needs-review." Task #34
  was reused — and D1 confirms its `kind` is now `'fact-check'`
  (was `'correct'`), attempts 5, updated 2026-11-20T18:17:15Z.
- **New row (D1):** fact_check 20, `recheck`, needs-review, 4 total /
  3 verified / 1 failed, created 2026-11-20 18:17:14 UTC, evidence
  signature in the new content-hashed format
  (`675:2026-11-19 17:11:43:58208ba404d727d5`) vs row 19's old format
  (`675:2026-11-19 17:11:43`). Stored body hash:
  `2285cf760cc4668eb3ebbb59f85b63fff433429f88893d3325cb216ad9050ad9` —
  **identical** to the hash computed by the parent with the real
  `bodyHash` function over the live 684-char body. The fresh check
  genuinely corresponds to the current body.
- **Claim rows (D1, fact_check 20):**
  1. VERIFIED — "Enrollment from abroad is down this fall."
  2. VERIFIED — "Early data from the Common App show a 9% rise in the
     number of students from abroad who applied for the 2026–27 school
     year."
  3. VERIFIED — "Final enrollment figures for 2026–27 are not yet
     known."
  4. UNSUPPORTED — "Until the final 2026–27 figures arrive, the rise
     in applications remains an early signal — not proof that more
     students will enroll."
  All `previous_verdict` NULL. These are current-body sentences — no
  "International enrollment", no "9 percent", no "trend may be
  temporary". The old rows (fact_check 19, claim rows 188–192) remain
  untouched in history.
- **Deviation from prediction (reported honestly):** the analysis
  predicted 2 verified / 2 failed; the live result is 3/1. Claim 3
  ("not yet known") came back VERIFIED — its deterministic score fell
  in the borderline band (0.3–0.5) so the LLM judge was consulted,
  and the judge accepted it. Claim 4 stayed UNSUPPORTED. The verdict
  itself (needs-review, 4 claims) matched the prediction; only the
  split differed, by one borderline judge call. Nothing unsupported
  was marked VERIFIED by the parent or the coordinator at any point.
- **Gate after (Step 3):** stale detail gone; full gate state:
  content-ready NO · fact-check NO · SEO NO · eligible NO ·
  authorized NO; correction-recheck ✓; seo-pass ✗ (needs-review);
  duplicate ✓ 0%; special-review ✓; emergency-stop-off ✓;
  daily-limit ✓ (0/1); publishing-rules ✗ (approved_only). Blocked-by:
  "Latest fact-check verdict: needs-review (3/4 claims verified).;
  1 claim(s) still failed in the latest fact-check."

## 8. Confirmation that no article was published or modified

- Published count: **25 before and after** (D1: total articles 31,
  published 25; published today 0/1).
- **#31 body byte-identical** (684 chars, updated
  2026-11-20T17:08:31Z — the correction edit; unchanged by this work).
  #31 still a draft.
- **#26/#27/#28/#29/#30 byte-identical** (body lengths and
  `updated_at` match the baselines: #26 4895, #27 245, #28 2157, #29
  593, #30 4615). No edit form for #26 or #27 was opened; no Publish
  or Unpublish button was clicked on any article.
- The only D1 writes in this work: migration 019 (one column), the
  new fact-check row 20 + its 4 claim rows, task #34's kind change
  (`correct` → `fact-check`) by the re-check itself, and the run/task
  bookkeeping rows. No article row was written.

## 9. Confirmation that all protected articles and settings remain unchanged

- **#26 and #27 protected and untouched** (D1, byte-level): #26 "How
  Artificial Intelligence Is Changing Everyday Life" (body 4895,
  updated 2026-11-19T18:53:30Z); #27 "Tesla Cybercab Factory at Giga
  Berlin" (body 245, updated 2026-11-19T18:53:32Z). Both still
  PROTECTED drafts; the dashboard now shows them Blocked with the
  stale fact-check message (their legacy rows are hash-less — expected
  fail-closed behaviour, not a change to the articles).
- **Settings unchanged** (D1 + dashboard): publishing_mode
  `approved_only`; auto-publishing OFF; auto-correction OFF; social
  auto-post Off; Emergency Stop OFF. Auto-research, auto-generation
  and auto-fact-check remain ON, unchanged. The Emergency Stop was
  never toggled.
- **Workers AI only; no paid service.**

## 10. Actual cost

- **Live re-check: 1 LLM call, 18 Neurons** (D1 `llm_usage` in the
  18:15–18:20 UTC window: 1 call / 18 Neurons; dashboard: 32 → 33
  calls today, 484 → 502 Neurons today; 7-day: 45 → 46 calls,
  744 → 762 Neurons). Free allowance 10,000 Neurons/day — not
  approached.
- Implementation + tests: **0 LLM calls, 0 Neurons** (tests stub the
  Workers AI binding). Total cost of this work: **$0.00.**

---

## Appendix — what this means for Article #31

#31's current fact-check is fresh and honestly needs-review: 3 of its
4 sentences are verified against the single Inside Higher Ed fragment,
and the concluding hedge ("only an early signal — not proof") is
UNSUPPORTED by that fragment. The gate therefore stays Blocked on
fact-check (and on SEO needs-review, and on approved_only). That is the
correct outcome for a 94-word brief built on one 307-char source
fragment: the article is factually honest, but its conclusion reaches
beyond what its only source states. **#31 stays a draft until the owner
decides** — whether to accept the brief as-is, or to give it verifiable
content. No further action will be taken without the owner's explicit
authorization.

Known limitations (from the coordinator's notes, confirmed by the
parent): SEO staleness is out of scope — only fact-check checks 1–3
reject stale results; an edited body keeps its old SEO verdict until a
fresh SEO check. Correction identity still uses the truncated
`claimKey` for `article_corrections.claim_key` (a pre-existing,
lower-severity issue). `previous_verdict` covers only the immediately
previous run.
