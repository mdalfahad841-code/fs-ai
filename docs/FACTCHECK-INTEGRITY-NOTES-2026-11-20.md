# Fact-Check Integrity Repair — Coordinator Notes (2026-11-20)

For the parent: implementation + local verification notes. The parent
writes the final report, applies migration 019 live, deploys, and runs
live verification. **Nothing was published. No article content was
changed. No settings were changed.** All work is in the local source
only; the current deployed HEAD is f2b0e35.

## 0. Verdict in one paragraph

The parent's root-cause hypothesis was **confirmed with one correction**
(§1): the #31 "carry-forward" was not the Phase 3 P6 claim-level
mechanism at all — it was a task-kind mismatch that made Re-check a
no-op. The fix closes that hole at two layers, adds a SHA-256 body
hash to every fact-check run (migration 019), tightens P6
carry-forward to full claim hashes + evidence-CONTENT signatures,
and makes the publish gate reject stale results fail-closed. Full
suite: **894 pass / 0 fail / 213 suites** (baseline 881/207; +13
tests, all new). The #31 read-only analysis (§6) shows the stored
PASS 5/5 does not describe the current body: 0 of its 5 stored claims
match the 4 claims the current body extracts, and a fresh check
would most likely NOT pass (2 of the 4 current claims are
unsupported by the stored evidence).

## 1. Root cause (confirmed, with file:line evidence)

### Layer 1 — the actual #31 failure: Re-check routed through runCorrection (CONFIRMED)

1. The dashboard **Correct** button creates a `kind='correct'` task
   row: `frontend/scripts/autonomy.js:1341`
   (`enqueueAgentTask('fact-checking', 'correct', …)` → POST
   `/api/autonomy/tasks` → generic `enqueueTask`). That is how live
   task #34 (agent `fact-checking`, kind `correct`, attempts 4) came
   to exist for #31.
2. `handleRecheckArticle` (`backend/routes/orchestrator.js:1209+`)
   reuses the article's NEWEST fact-checking task whatever its kind:
   `findFactCheckTasksForArticle` (`orchestrator.js:959`) matches ANY
   `agent='fact-checking'` row for the article (`ORDER BY id DESC`),
   and the handler took `existingTasks[0]` — the `correct` row #34.
   It set only `payload.check_kind='recheck'`; the row's `kind`
   stayed `'correct'`.
3. `runTask` (`backend/routes/scheduler.js:431`) re-reads the row and
   dispatches via `runAutonomyTask` → `runFactChecking(task, env)`
   with `task.kind='correct'`.
4. `runFactChecking` (`backend/agents/autonomy/factcheck.js`, old
   line ~1279) dispatched `kind === 'correct'` unconditionally to
   `runCorrection`, which returns early `{outcome:'no-op', reason:
   'Latest fact-check already passes — nothing to correct.'}` when
   the latest verdict is `pass` (`runCorrection`, old ~996) — writing
   NO `fact_checks` row and extracting NOTHING.
5. `runTask` treats outcome `'no-op'` as success (`scheduler.js:520`:
   `outcome = result.outcome === 'done' || 'no-op' ? … : 'failed'`),
   and the handler then read `latest` = the OLD row and returned it
   as a completed re-check (`orchestrator.js`, old ~1281). The
   dashboard displayed "task reused" + pass 5/5. That is runs #121
   and #122: no new rows, old PASS presented as a fresh result.

So the observed "carry-forward" was **not P6**. P6 never ran.

### Layer 2 — P6 carry-forward was lossy (CONFIRMED, latent)

`checkArticle` (`factcheck.js:440+`): `claimKey` truncated identity
to 200 chars (two different long claims can share a prefix), and
the evidence signature was only `id:fetched_at` — it did NOT cover
evidence CONTENT, so editing an evidence item's text (same id, same
`fetched_at`) would still carry verdicts forward.

### Layer 3 — the gate could not detect staleness (CONFIRMED)

`evaluatePublishGate` (`backend/publishing/gate.js`, old check 1)
read ONLY the latest `fact_checks` row's verdict. No body hash or
version existed anywhere in the schema, so an edited article kept
its old PASS at the gate indefinitely.

## 2. What was implemented

### 2a. Re-check always runs a real fact-check (two layers)

- `backend/routes/orchestrator.js:1251,1255` — when reusing a task,
  the handler now forces `kind = 'fact-check'` in the UPDATE (both
  the payload path and the fallback path), with a comment naming the
  live #31 failure.
- `backend/agents/autonomy/factcheck.js:1348` — `runFactChecking`
  routes to `runCorrection` ONLY when `task.kind === 'correct' AND
  payload.check_kind !== 'recheck'`. A recheck payload always runs
  `checkArticle`, whatever kind the task row carries. Genuine
  corrections (kind `correct`, no recheck payload — dashboard Correct
  button, daily `correctionRun` at `scheduler.js:833`) still route to
  `runCorrection`, including its legitimate no-op returns.
- `backend/routes/orchestrator.js:1290,1300` — the handler fails
  LOUDLY instead of presenting stale data: outcome other than
  `'done'` → HTTP 500 ("did not complete a fresh check… No new
  fact-check row was written"); and if the latest row after the run
  is still the pre-run row → HTTP 500 ("completed but wrote no new
  fact-check row"). The response's `latest` object now also carries
  `bodyHash`.

### 2b. Body-hash invalidation (migration 019)

- NEW `backend/utils/bodyHash.js` — `normaliseBodyForHash(body)`,
  `sha256Hex(text)`, `bodyHash(body)`. Normalisation treats
  formatting-only differences as identical (whitespace, blank
  lines, markdown heading/list markers, `[text](url)` → text,
  `` `code` `` ticks, `**bold**` markers, letter case) and ANY
  wording change as different. When in doubt it does NOT strip
  something (e.g. single-asterisk emphasis is left alone because a
  bare URL can contain `_x_` patterns) — an unrecognised change
  hashes as different, which only ever costs a fresh evaluation,
  never a wrong carry-forward. SHA-256 via WebCrypto
  (`crypto.subtle.digest`), the same pattern as
  `backend/security/crypto.js`; available in Workers and Node 20+.
- NEW `database/migrations/019_factcheck_body_hash.sql` — additive
  column only: `ALTER TABLE fact_checks ADD COLUMN body_hash TEXT;`
  (full text in §3). Existing rows keep NULL, which the code treats
  as unknown → never carry forward, always stale at the gate.
- `factcheck.js:479` — `checkArticle` computes `currentBodyHash`
  and stores it on EVERY new row (`factcheck.js:577`), with a
  two-level fallback (019 list → 018 list → base list) following the
  018 pattern, so a pre-migration deploy still writes verdicts (the
  gate treats hash-less rows as stale). The result object also
  returns `bodyHash`.

### 2c. Claim-level carry-forward tightened

- `factcheck.js` — new `claimHash(text)` (full SHA-256 of the
  normalised claim text) and `normaliseClaimText()`; `claimKey()`
  now delegates to it plus `.slice(0, 200)` and is KEPT exported
  for the correction flow (`article_corrections.claim_key`,
  migration 017 backfill) and the gate's open-correction grouping.
  The carry-forward match in `checkArticle` uses `claimHash` only
  (`factcheck.js:520,529`).
- `factcheck.js:485` — the evidence signature is now
  `id:fetched_at:contentHash16` per pool item (first 16 hex chars of
  the SHA-256 of the pool item's text), sorted. Edited evidence
  content changes the signature and forces fresh evaluation, even
  with identical ids and fetch times. The format change also means
  pre-fix signatures never match new ones (fail-closed).

### 2d. Gate staleness rejection

- `backend/publishing/gate.js:68-93` — the gate computes the
  article's current body hash and compares it with the latest
  check's stored hash. `factCheckStale` is true when the latest
  check exists and its hash is missing (legacy row) or differs.
  Checks 1 (`fact-check-pass`), 2 (`no-unresolved-errors`) and 3
  (`sources-verified`) all fail on a stale run; the detail says
  plainly: "fact-check is stale: article body changed after the
  latest fact-check — run a fresh fact-check." (legacy variant:
  "…was recorded before body-hash tracking — run a fresh
  fact-check."). `approved_only` / publishing-rules check
  untouched.

### 2e. Correction + re-check workflow

Verified (not changed beyond §2a): `runCorrection` calls
`checkArticle` with `checkKind: 'correction-recheck'` at the end of
every path (pool-empty, validation-rejected, normal). Its early
no-op returns (latest verdict `pass`; no failed claims) are
legitimate when there is nothing to correct, and are now
unreachable from the Re-check endpoint (dispatch guard + handler
kind forcing + loud-fail).

### ⚠ DEVIATION FROM THE BRIEF — flag for the parent (B.2)

The brief's B.2 said, literally: when the body hash differs, "the
run must do FRESH claim extraction with NO verdict carry-forward
from the old run". I implemented the closest correct behaviour,
which differs in one respect: **per-claim carry-forward is NOT
gated on the body hash**. An unchanged claim (same full text hash)
against unchanged evidence (same content signature) may still carry
forward after a sibling claim is edited; only the changed/new
claims are freshly evaluated, and removed claims leave no row.

Why: the user's own objective 3 permits reuse exactly on those
conditions — "Unchanged claims may reuse verdicts only when claim
identity AND evidence identity are demonstrably unchanged" — it
does NOT condition reuse on body identity. Gating carry-forward on
the body hash would force the non-deterministic LLM judge to
re-run on every unchanged claim after any edit, reintroducing the
live #30 flip (UNSUPPORTED → VERIFIED with no correction saved)
that P6 exists to prevent. The body hash still does its real job:
the GATE rejects the old run as stale until a fresh run exists, so
no stale verdict can ever publish. Fresh extraction always runs
on the current body, changed claims are always freshly judged, and
the active claim set is always the latest run's rows. Tests 1, 4
and 9 pin this behaviour. If the owner wants whole-run
invalidation instead, it is a one-line change
(`signatureUnchanged` gains a `bodyUnchanged` condition) — but it
would trade away the P6 flip protection.

## 3. Files changed

| File | Change |
|------|--------|
| `backend/utils/bodyHash.js` (NEW, 51 lines) | `normaliseBodyForHash`, `sha256Hex`, `bodyHash`. |
| `database/migrations/019_factcheck_body_hash.sql` (NEW) | `ALTER TABLE fact_checks ADD COLUMN body_hash TEXT;` + comment (fail-closed NULL semantics; rollback: leave the column). |
| `backend/agents/autonomy/factcheck.js` | `claimHash`/`normaliseClaimText`; content-hashed evidence signature; body-hash storage + double fallback; re-check dispatch guard; result returns `bodyHash`. |
| `backend/routes/orchestrator.js` | Re-check forces reused row kind to `fact-check`; fails loudly (500) on non-`done` outcome or no new row; response `latest` carries `bodyHash`. |
| `backend/publishing/gate.js` | Staleness rejection for checks 1–3 (fail-closed on missing hash). |
| `tests/factcheck-integrity.test.js` (NEW, 13 tests) | Regression suite (§4). |
| `tests/factcheck-phase3.test.js` | Setup only: freshEnv now also applies migration 019 (P6 tests need `body_hash` recorded; assertions unchanged). |
| `tests/publish-gate.test.js` | Setup only: freshEnv applies 019; `makeContentReady` is async and seeds a genuinely fresh fact-check (body hash of the current body); health-division test re-runs a fresh check after appending the disclaimer (a body edit stale-marks the previous check by design). |
| `tests/activation-repairs.test.js` | Setup only: freshEnv applies 019; the gate-visibility test seeds its passing fact-check with the matching body hash. |

No article content, settings, package.json scripts, or other
behaviour was touched. No existing test assertion was weakened —
the three setup updates above only make seeds represent genuinely
fresh runs, as a real post-019 run would write.

## 4. Test results

Parent's own runs (local source, Node v24.22.1):

- **Full suite: `npm test` — 894 pass / 0 fail / 213 suites, exit 0.**
  Baseline before this work: 881 pass / 0 fail / 207 suites.
  **+13 tests, all in the new file.**
- `node --check` clean on every touched file;
  `backend` `npm run check` clean (exit 0).
- No build script exists in `package.json`, so no build applies.

New file `tests/factcheck-integrity.test.js` (13 tests, 6 suites):

| # | Test | Result |
|---|------|--------|
| — | body-hash normalisation (formatting ≡, wording ≠; claimHash vs claimKey collision) | pass |
| 1 | material body edit → changed claim freshly judged CONFLICTING, unchanged claim carried, old text gone | pass |
| 2 | formatting-only change → both claims carry forward, identical body hash | pass |
| 3 | new claim added → fresh UNSUPPORTED evaluation, never carried VERIFIED | pass |
| 4 | removed claim → no active row in the new run | pass |
| 5 | changed evidence CONTENT (same id/fetch time) → fresh evaluation, signature changes, no LLM call | pass |
| 6 | unchanged claim + identical evidence → carries forward, no LLM call | pass |
| 7 | gate rejects stale check (body edited) and accepts a fresh one | pass |
| 7b | legacy hash-less fact-check → stale (fail-closed) | pass |
| 8 | re-check payload on a kind=`correct` task → real fact-check (`done`, new row); genuine correction still no-ops when nothing to correct | pass |
| 8b | Re-check endpoint reuses a kind=`correct` task row (live #31 shape), forces it to `fact-check`, writes a new row, fails loudly if none | pass |
| 9 | multi-round edit → re-check → edit → re-check stays correct (incl. revert re-verifying) | pass |

One test run during development initially failed (tests 1/4/9:
unchanged claim did not carry forward after a material edit) —
that failure exposed the B.2 deviation above and is what decided
the per-claim design; the code was changed, not the tests.

## 5. Migration 019 (contents)

```sql
-- FS AI migration 019 - body hash on fact_checks (fact-check integrity).
-- fact_checks.body_hash: SHA-256 of the article body as the run judged
-- it (normalised: whitespace, blank lines, markdown heading/list
-- markers, link markup, code ticks, **bold** markers and letter case
-- normalise away; any wording change hashes differently — see
-- backend/utils/bodyHash.js). Every fact-check run records the hash
-- of the body it actually checked, so the pipeline can tell a fresh
-- result from a stale one. Safe: additive column only. Existing
-- fact_checks rows keep a NULL body_hash, which the code treats as
-- "unknown — never carry forward, always stale at the gate", so old
-- rows can only ever be re-evaluated fresh. No existing data is
-- changed. Rollback: leave the column (inert — code falls back to
-- the pre-019 column lists when it is absent).
ALTER TABLE fact_checks ADD COLUMN body_hash TEXT;
```

**Deploy-order warning:** until 019 is applied live, the deployed
code's INSERT falls back to the pre-019 column list (verdicts still
written), but EVERY latest fact-check reads as hash-less → the gate
treats all of them as stale (fail-closed) and contentReady goes
false for every draft until a fresh re-check runs. Apply 019
immediately after (or with) the deploy, then run fresh re-checks.
The dashboard "Ready" state for #31 will flip to Blocked (stale)
right after deploy — that is expected, not a regression.

## 6. Article #31 — read-only test-case analysis

Current body (684 chars, as recorded in the parent's report — the
body lives in live D1, which this coordinator cannot query; the
analysis below uses the real `extractClaims` / `findEvidence` /
`judgeClaimDeterministic` functions run locally against that body,
and a simulated evidence pool built from the two known facts of
research item 675).

### 6a. What the current body extracts — exactly 4 claims

| # | Claim sentence (extracted) | Length |
|---|---------------------------|--------|
| 1 | Enrollment from abroad is down this fall. | 41 |
| 2 | Early data from the Common App show a 9% rise in the number of students from abroad who applied for the 2026–27 school year. | 124 |
| 3 | Final enrollment figures for 2026–27 are not yet known. | 55 |
| 4 | Until the final 2026–27 figures arrive, the rise in applications remains an early signal — not proof that more students will enroll. | 132 |

Not a claim: "The data so far are preliminary." (31 chars — below
the 40-char extraction minimum). The Sources section is excluded
by the citation rules, as is the citation line itself.

### 6b. Stored active claims (fact_check 19, 2026-11-20 14:17:26 UTC)

5 VERIFIED claims with PRE-edit phrasing, e.g. "International
enrollment is down this fall", a "9 percent" claim, and a claim
containing "the trend may be temporary" (a Key-takeaways bullet).
**0 of the 5 stored claims match any of the 4 current claims** —
verified for the two known stored texts by `claimKey` comparison
(neither matches), and the other three come from sections that no
longer exist in the body (Key takeaways removed in the final
correction; conclusion rewritten), so they cannot match either.
The stored set includes at least one claim whose sentence no longer
exists in the body at all ("…trend may be temporary") — a removed
claim that still "remains active" in the stored check.

### 6c. Evidence coverage (simulated pool — see caveat)

Simulated pool: research item 675 as described — title "Will More
International Students Enroll Next Year?" + the 307-char fragment
(enrollment down this fall; Common App 9% uptick in international
applicants for 2026–27), summary == evidence_text == the fragment.
**Caveat:** the fragment's exact wording is not available locally,
so the scores below are indicative, not definitive — the live
re-check must judge against the real D1 rows. The direction of each
verdict is robust to wording: claims 1–2 restate the fragment's two
facts; claims 3–4 assert things the fragment does not state.

| Current claim | Best evidence | Deterministic verdict |
|---|---|---|
| 1. Enrollment down this fall | score 0.75, numbers match | VERIFIED |
| 2. Common App 9% rise in applicants | score 0.64, numbers match | VERIFIED |
| 3. Final figures not yet known | score 0.33 (borderline band) | UNSUPPORTED (deterministic; the LLM judge would be consulted at 0.3–0.5, but "not yet known" is not entailed by the fragment, so NOT_SUPPORTED is the likely answer) |
| 4. Rise is only an early signal, not proof of enrollment | score 0.31 (borderline band) | UNSUPPORTED (same reasoning — the fragment states the uptick, not what it proves) |

### 6d. Conclusion for #31

- **The current fact-check (fact_check 19) is STALE, not fresh.**
  It judged a different body (14:17) than the one live now (17:08
  correction). Its 5 stored claims do not describe the current
  body, and its PASS verdict does not transfer.
- A fresh re-check of the current body would extract 4 claims and
  most likely return **needs-review, not pass** (2 VERIFIED, 2
  UNSUPPORTED on the deterministic judge; the 2 borderline claims
  would consult the LLM judge, which is instructed to use only the
  evidence text — the fragment does not support either statement).
  No claim is marked VERIFIED here that the evidence does not
  support; claims 3–4 are editorial hedges about unknown data, and
  the honest system verdict for them is UNSUPPORTED, which is why
  the article's gate will stay Blocked on fact-check even after a
  fresh re-check — until the owner decides the brief is acceptable
  as-is or the article gains verifiable content.
- Do NOT present the stored 5/5 PASS as #31's current state.

## 7. What live verification must check

1. Apply migration 019 live (D1 `fact_checks` gains `body_hash`).
   Confirm the column exists before relying on any hash.
2. Deploy the code (base f2b0e35). Confirm the deployed commit.
3. Dashboard Re-check on #31 (owner tap — the parent arranges the
   browser task): it must return 200 / outcome `done`, write a NEW
   `fact_checks` row with `check_kind='recheck'` and a `body_hash`
   equal to the SHA-256 of the current body, and its claim rows must
   be the 4 sentences of §6a (fresh texts, not the old phrasing).
   Expected verdict: needs-review (2 VERIFIED / 2 UNSUPPORTED,
   subject to the LLM judge on the 2 borderline claims) — NOT pass.
4. Gate on #31 after the fresh re-check: check 1 must reflect the
   NEW verdict (needs-review → fails on verdict, with the
   "Latest fact-check verdict: needs-review" detail — NOT the stale
   detail, because the check IS fresh). Before the fresh re-check,
   the gate must show the stale detail for checks 1–3.
5. Confirm the re-check reused task #34 (or the newest
   fact-checking task) and its kind is now `fact-check` in D1.
6. Confirm NO article was published and NO article body changed:
   published count stays 25; #31/#26/#27/#28/#29/#30 bodies
   byte-identical to the baselines in the parent's report;
   settings unchanged (approved_only, auto-publishing OFF,
   auto-correction OFF, social OFF, E-Stop OFF).
7. Confirm the old rows are untouched: fact_check 19 and claim rows
   188–192 remain in history (history is never deleted).

## 8. Known limitations

- **Strip path / renderer strip:** unchanged from the previous
  report — not part of this task.
- **Live verification not done by this coordinator:** no D1 access
  from this session, no browser. Everything live in §7 is for the
  parent to verify; nothing here claims a live result.
- **The #31 evidence scores in §6c use a simulated pool** (the
  fragment's exact wording is not available locally). The claim
  extraction (§6a) is exact (real function, real body text); the
  verdict direction is robust, but the live re-check is the
  authority.
- **Correction identity still uses the truncated claimKey** for
  `article_corrections.claim_key` (migration 017 backfill) and the
  gate's open-correction grouping. Only verdict carry-forward uses
  the full hash. A 200-char-prefix collision in the correction flow
  could merge attempt counts for two different long claims — a
  pre-existing, lower-severity issue, out of this task's scope.
- **`previous_verdict` covers only the immediately previous run.**
  A claim absent from the previous run (e.g. reverted after an
  edit) gets `previous_verdict = NULL`; its flip is traceable
  across the run history, not on that row. Test 9 pins this.
- **SEO staleness is out of scope** (per the brief): only the
  fact-check checks (1–3) reject stale results. An edited body
  keeps its old SEO verdict at the gate until a fresh SEO check.
- **Deploy window:** between deploy and migration 019, all gates
  read stale (§5). Apply the migration promptly.

## 9. Cost

Local work only: **0 LLM calls, 0 Neurons, $0.00.** The new tests
stub the Workers AI binding; no live LLM call was made. (The live
re-check in §7 may spend a small number of Neurons on the 2
borderline claims' LLM-judge calls — the parent should record the
actual count.)
