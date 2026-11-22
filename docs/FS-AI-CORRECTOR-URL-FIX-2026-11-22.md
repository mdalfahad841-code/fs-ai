# FS AI — Corrector Citation-URL Defect Fix (live #33)

**Date:** 2026-11-22
**Status:** Fixed in the local tree, full suite green. **Not deployed** — the parent deploys.
**Files changed (2):** `backend/agents/autonomy/factcheck.js`, `tests/factcheck-correction-validation.test.js`
**No migration.** No article body touched. No live D1 writes. No publish.

---

## 1. Root cause (exact)

**The URL was never inserted by the LLM.** The candidate guard is airtight: `cleanCandidate()` takes only the first sentence of a reply, and `isValidReplacementSentence()` rejects any candidate containing `https?://`. The URL was **pre-existing citation scaffolding in the original #33 body**, and the correction loop exposed it:

- The original body has a "Sources and further reading" bullet ending in a bare URL with **no terminal punctuation**:
  `- Higher Ed Dive. "M State's Detroit Lakes campus to close amid systemwide budget woes." *Higher Ed Dive*, 19 Nov 2026. https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/`
- `splitSentences()` (`backend/agents/autonomy/factcheck.js:672`) splits only after `.`/`!`/`?`, so it **glues that URL to the FOLLOWING paragraph** into one element: `"https://...875256/ For readers interested in the broader context ... across the country."`
- In the original body that glued element is pre-existing, so the "pre-existing issue" exemption in `validateCorrectedBody()` covers it.
- The correction rewrote the "For readers interested..." claim inside that paragraph (run #171: 8 corrections + 5 removals attempted). The glued element changed to `"https://...875256/ [clean candidate]."` — new text, exemption broken — and validation flagged it as a newly introduced defect with exactly these three reasons (reproduced byte-for-byte, see §2):
  1. `broken sentence fragment (starts with a lowercase letter): "https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-sy"`
  2. `sentence contains a raw URL (citation not stripped): "https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-sy"`
  3. `unsupported number 875256 in corrected sentence ("https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-sy") — not in the article's evidence`
- Result: the whole corrected body was rejected, nothing saved (body still 4801 chars, 0 revisions), status `BLOCKED_WITH_REASON`, `retryable: false`. **Any** rewrite of a claim in that paragraph would fail the same way — the correction could never succeed on this article.

**Exact location:** `validateCorrectedBody()` (`backend/agents/autonomy/factcheck.js:1036`) split the RAW bodies into sentences for the sentence / duplicate / evidence checks, while `paragraphIssues()` (same file) and `extractClaims()` already judge citation-stripped text. The documented intent of `stripCitationLines()` (line 200) is explicit: *"Remove citation-only lines from a body (shared by extractClaims and the corrected-body validator so both agree on what is a citation)."* The validator was not living up to it for the sentence-level checks.

## 2. Reproduction (before the fix)

A throwaway script (`/tmp/repro-33-url.cjs`, not in the repo) using the **real** #33 body and the **real** fetched evidence (research item 714) from live D1 (read-only), replacing the "For readers interested..." claim with a clean single sentence, produced exactly the three run-#171 reasons from `validateCorrectedBody()` — `ok: false`. `extractClaims()` on the real body returns 20 claims, matching fc 30/31/32. After the fix, the same script returns `ok: true` with no reasons.

## 3. The fix

In `validateCorrectedBody()` only — two lines changed:

```js
const originalSentences = splitSentences(stripCitationLines(originalBody));
const correctedSentences = splitSentences(stripCitationLines(correctedBody));
```

(Previously `splitSentences(originalBody)` / `splitSentences(correctedBody)`.) `paragraphIssues()` already strips internally and is unchanged; `balanceIssues()` still runs on the raw text; the truncation guards in `runCorrection()` are unchanged.

**What this does:** the validator now judges the PROSE on both sides, so citation scaffolding can neither be blamed on the correction nor hide a genuine prose defect.

**What it does NOT do (no gate lowered):**
- The whole-body validation itself is untouched — same checks, same reasons, same rejection path.
- A raw URL **inside** a prose sentence is still flagged: `stripCitationLines()` only drops whole citation-only lines.
- The candidate-level URL rejection (`isValidReplacementSentence()`) still bars any URL from entering through a rewrite — proven by regression test 4 below.
- **Documented boundary:** a bare-URL-only line is now treated as citation scaffolding by the sentence checks (consistent with `paragraphIssues()`, which already strips citation lines, and with `extractClaims()`). A URL can only reach the body through a candidate (rejected upstream) or from the original body (pre-existing, exempt by design). There is no path in `runCorrection()` that inserts a new bare-URL line.

## 4. Regression tests (4 new, all in `tests/factcheck-correction-validation.test.js`, new describe block "validateCorrectedBody — citation-glued bare URL (live #33)")

1. **Unit, the exact #33 shape** — synthetic body with a Sources bullet ending in the bare URL `.../875256/` glued to the following paragraph; correcting the wrong-number claim in that paragraph with a clean sentence → `validateCorrectedBody` returns `ok: true`, no reasons, no URL reason.
2. **Guard: a genuinely NEW mid-sentence raw URL is still rejected** — corrected body where a new sentence contains `see https://example.com/report for details` → `ok: false` with a raw-url reason.
3. **End-to-end `runCorrection` on the #33 shape** (real in-memory SQLite DB, LLM stubbed via `env.AI`) — outcome `done`, corrected 1, removed 0; saved body contains `100 million`, not `50 million`; **both** pre-existing sources URL lines survive untouched (URL occurs twice); one revision row preserves the original body.
4. **A rewrite containing a raw URL is never inserted** — stubbed LLM reply contains a raw URL → candidate rejected, claim removed instead; outcome `done`, corrected 0, removed 1; saved body contains neither the rewrite's URL nor the wrong number.

**Negative control (proves the tests catch the defect):** with the fix temporarily reverted, exactly tests 1 and 3 fail (17/19 pass); with the fix restored, 19/19 pass. Tests 2 and 4 pass both before and after, proving the validator is not blinded and the candidate guard is independent of this fix.

## 5. Test results

| Run | Result |
|---|---|
| `tests/factcheck-correction-validation.test.js` (with fix) | 19 pass / 0 fail (15 existing + 4 new) |
| Same file, fix temporarily reverted | 17 pass / **2 fail** (exactly the two #33-shape tests) |
| **Full suite, `npm test`** (repo's own runner) | **1309 pass / 0 fail, 334 suites, EXIT=0** |
| Suite before this fix | 1305 pass / 0 fail, 333 suites |

Delta is exactly +4 tests / +1 suite. No test weakened, none deleted. Migration chain 001–029 unchanged (no migration touched), so no re-verification of the chain was needed.

## 6. What the parent must do to deploy and re-run the #33 correction

1. **Pre-deploy D1 backup** (same method as 2026-11-22: `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-pre-deploy.py`, new dated copy). No new migration to apply.
2. **Push** via the established zip + one-time-workflow route (regenerate `~/workspace/fs-ai-source/fs-ai-source.zip`, verify base commit, upload, create `.github/workflows/push-source-once.yml`, run workflow_dispatch, verify new HEAD has exactly 1 parent and the workflow + zip are gone). Rollback: revert the push + restore the D1 backup.
3. **Post-deploy verify:** served `dashboard.html` / `autonomy.js` SHA-256-identical to the deployed tree; counts unchanged (published 25, drafts 7); #26/#27/#31 bodies unchanged; settings unchanged (publishing_mode auto, cutoff 2026-11-22T04:55:28Z, social_auto_post off); E-Stop OFF; $0.00.
4. **Re-run the #33 correction** from the owner dashboard (signed in as Owner): Autonomous Operations → #33 row → "Correct" → run the queued task manually → expect `done` (not `failed`). The correction should apply the 8 corrections + 5 removals attempted in run #171 (the same input, now with the glue fixed). Then "Re-check" → expect a new `fact_checks` row with claims_total < 20 (claims removed), body_hash equal to the corrected body's hash, verdict expected `needs-review` (9 failed claims remain, several genuinely unsupported/invented — the correction removes/qualifies them; the re-check judges the new body). #33 stays a draft; it can never auto-publish (legacy, pre-cutoff).
5. **Verify in D1 afterwards:** article #33 body length changed from 4801, exactly 1 new `article_revisions` row, `article_corrections` rows for the 13 claims show `applied`/`removed` (not `failed`), latest `fact_checks` row for #33 has `check_kind` `recheck` and `evidence_signature` starting `714:`.
6. **If the re-run still fails:** do NOT re-run in a loop. Read the run's `validationReasons` / recovery report from the `agent_runs` detail first — a new failure means a different defect, not this one.

## 7. Notes / limits

- The fix does not change the saved article: the Sources lines stay in the body (they are the article's in-body attribution; the correction's job is the failed claims, not deleting the sources section). The end-to-end test asserts both URL lines survive.
- The known weak-verify from the final report stands: claim #273 ("close-knit community") was VERIFIED on the fragment and survives the automated correction — a human editorial call, not a blocker.
- The #30 correction (prepared, awaiting owner authorization) is unaffected by this fix; do NOT use the dashboard Correct button for #30 (it would delete true claims on fragment evidence).
