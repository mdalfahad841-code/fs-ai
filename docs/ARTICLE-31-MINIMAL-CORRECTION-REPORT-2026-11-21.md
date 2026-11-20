# Article #31 — Minimal Evidence-Based Correction: Verification Report

**Date:** 2026-11-21 (work 2026-11-21 01:38–01:43 Dhaka)
**Task:** remove the one unsupported concluding sentence from Article #31,
keep everything else, run completely fresh fact-check and SEO analyses,
and verify the publishing gate uses the current body hash and the fresh
fact-check result. **Article #31 remains a draft. Nothing was published.**

## Verdict

**The unsupported sentence is gone and the article is now fully verified
on facts: fresh fact-check PASS, 3/3 claims verified, 0 failed.** The
gate confirms the fresh result against the current body hash. #31 stays
Blocked — now only because of SEO needs-review (internal-links by
editorial choice, plus readability at 6.6 chars) and the standing
approved_only rule.

## 1. Exact body changes

One sentence removed, nothing else changed. Body **684 → 551 chars**
(−133 chars, the removed sentence plus its preceding space).

**Removed** (from the Conclusion — the sentence the previous fresh
fact-check had judged UNSUPPORTED, with no evidence):

> Until the final 2026–27 figures arrive, the rise in applications
> remains an early signal — not proof that more students will enroll.

**Not replaced** — no new conclusion sentence was added, as instructed.

**Kept byte-identical:** all three Introduction sentences (the two
verified facts + "Final enrollment figures for 2026–27 are not yet
known."), the single Palmer / Inside Higher Ed citation, the
Conclusion heading and its remaining sentence "The data so far are
preliminary.", title, excerpt, division (education-learning), draft
status.

**Final body (as stored in D1, 551 chars, updated 2026-11-20T19:40:57Z):**

> ## Introduction
>
> Enrollment from abroad is down this fall. Early data from the Common
> App show a 9% rise in the number of students from abroad who applied
> for the 2026–27 school year. Final enrollment figures for 2026–27
> are not yet known.
>
> ## Sources and further reading
>
> - Palmer, Kathryn. "Will More International Students Enroll Next
> Year?" *Inside Higher Ed*, 19 Nov 2026.
> https://www.insidehighered.com/news/admissions/traditional-age/2026/11/19/will-more-international-students-enroll-next-year/
>
> ## Conclusion
>
> The data so far are preliminary.

Verified in D1: no "early signal", no "not proof", no "temporary" anywhere
in the body; "9%" ×1; citation present. The edit was made in the
dashboard editor and the saved body was read back in full before any
check ran.

Transparency note: after verifying the saved body, the browser agent
pressed Save once more (mistaking it for Cancel) with the identical
body before pressing Cancel. That re-saved the same verified text —
the body is unchanged — but it added one extra revision row (#31 now
has 6 revisions). Audit history only; no content effect.

## 2. Fresh fact-check — claims and verdicts

**fact_check 21, `check_kind='recheck'`, verdict PASS — 3 claims total,
3 verified, 0 failed** (created 2026-11-20 19:41:58 UTC; run #124,
task #34 reused). Previous was fact_check 20 (needs-review, 4 total /
3 verified / 1 failed) — retained in history, untouched.

| # | Claim | Verdict | Previous verdict |
|---|-------|---------|------------------|
| 1 | Enrollment from abroad is down this fall. | VERIFIED | VERIFIED |
| 2 | Early data from the Common App show a 9% rise in the number of students from abroad who applied for the 2026–27 school year. | VERIFIED | VERIFIED |
| 3 | Final enrollment figures for 2026–27 are not yet known. | VERIFIED | VERIFIED |

All three claims cite the same Inside Higher Ed evidence URL. The
removed claim ("…early signal — not proof…", UNSUPPORTED in run 20)
has **no row in the new run** — removed claims do not remain active,
as the integrity fix requires. The three kept claims carried forward
legitimately: identical full claim text + identical evidence-content
signature, exactly the reuse the owner's objective 3 permits. No new
claim was invented; no unsupported claim was marked VERIFIED.

**Body-hash proof:** the new run's stored body hash is
`e5885f0627b07b99991073d8d114717016905e24d16924cde87c33529b1a6a8c` —
identical to the hash the parent computed with the real `bodyHash`
function over the live 551-char body. The fresh fact-check genuinely
corresponds to the current body.

## 3. Fresh SEO analysis

**seo_checks 15, verdict needs-review, 9/11 checks passed** (created
2026-11-20 19:42:38 UTC; check-only — the article was not modified,
no repair, no revision row from the SEO check).

| Check | Result | Detail |
|-------|--------|--------|
| seo-title | PASS | 50 characters (target 30–60) |
| meta-description | PASS | 155 characters (target 120–160) |
| slug-unique | PASS | Slug is unique |
| heading-hierarchy | PASS | 0 H1, 3 H2, 0 H3 |
| keyword-relevance | PASS | 5/5 title keywords appear in the body (100%) |
| internal-links | **FAIL** | "1 related published article(s) available to link — none linked yet." |
| image-alt | PASS | No images, nothing to check |
| readability | **FAIL** | "Estimate: 72 words, 6 sentences, avg sentence 12.0 words, avg word 6.6 chars." (target: average word under 6.5) |
| duplicate | PASS | Highest 5-word shingle overlap 0% |
| broken-links | PASS | All 1 external link(s) responded |
| structured-metadata | PASS | Title, excerpt, slug and division are set |

**Honest note on readability:** it PASSED before this edit (94 words,
avg word 6.2 chars) and FAILS now (72 words, avg word 6.6 chars).
Removing the sentence took out mostly shorter words, which raised the
average word length above the 6.5 threshold. The internal-links failure
is unchanged and deliberate (no unrelated link was added, per the
standing order). No SEO repair was run — the Optimize action would have
appended the unrelated Related Reading link. SEO is 9/11, not 10/11,
and the report does not hide the second failure.

## 4. Publishing gate

**Before the fresh checks** (body just edited, latest check still row
20): checks 1–3 all FAILED with the stale detail — "fact-check is
stale: article body changed after the latest fact-check — run a fresh
fact-check." Content-ready NO · fact-check NO · SEO NO · eligible NO ·
authorized NO. The gate correctly refused the pre-edit result.

**After the fresh checks** (row 21 latest, hash matches): the stale
detail is GONE. Full gate state:

- fact-check-pass ✓ "Latest fact-check verdict: pass (3/3 claims
  verified)."
- no-unresolved-errors ✓ "No unresolved claim errors."
- sources-verified ✓ "1 source(s) recorded for this article."
- correction-recheck ✓ "No open corrections (re-check passes or
  nothing to correct)."
- seo-pass ✗ "Latest SEO verdict: needs-review."
- duplicate-pass ✓ 0% overlap.
- special-review ✓ "Not a high-risk division."
- emergency-stop-off ✓ "Emergency Stop is OFF."
- daily-limit ✓ "Published today: 0/1."
- publishing-rules ✗ "publishing_mode is 'approved_only' —
  gate-passed articles wait for owner approval, nothing
  auto-publishes."

States: **content-ready NO · fact-check passed YES · SEO passed NO ·
eligible NO · authorized to publish NO.** Blocked-by: "Latest SEO
verdict: needs-review.; publishing_mode is 'approved_only' —
gate-passed articles wait for owner approval, nothing auto-publishes."
#31 stays Blocked — now only because of SEO needs-review plus
approved_only. Fact-check is no longer a blocker.

## 5. Deployment status

**No code changed, no deployment needed.** This task was content-only.
The live system is the fact-check integrity fix already deployed as
commit `d0cd8a0` with migration 019 live (verified in the previous
report). No new commit for code; this report is the only new file
(docs-only push, base `e24bca5`).

## 6. Confirmation that no article was published

- Published count: **25 before and after** (D1: total articles 31,
  published 25; published today 0/1). #31 still a draft (Blocked).
- **No other article modified:** #26/#27/#28/#29/#30 byte-identical
  (body lengths and `updated_at` match the baselines: #26 4895, #27
  245, #28 2157, #29 593, #30 4615). The edit forms of #26/#27 were
  never opened; no Publish/Unpublish, Correct/Optimize, or SEO
  Optimize/repair action was clicked on anything.
- **Protected articles unchanged:** #26 and #27 still PROTECTED
  drafts, untouched.
- **Settings unchanged** (D1 + dashboard): publishing_mode
  `approved_only`; auto-publishing OFF; auto-correction OFF; social
  auto-post Off; Emergency Stop OFF.
- **No invented sources or facts.** The only source remains the single
  Inside Higher Ed citation. No unrelated internal link was added.

## 7. Actual cost

**0 LLM calls, 0 Neurons, $0.00.** D1 `llm_usage` since 19:38 UTC: 0
calls / 0 Neurons; dashboard usage unchanged (33 calls / 502 Neurons
today, 46 / 762 in 7 days). The fresh fact-check cost nothing because
all three claims legitimately carried forward (no LLM judge call), and
the SEO check is deterministic. Workers AI only; no paid service.

---

## What blocks publication now

Two things, both visible in the gate: (1) SEO needs-review — the
internal-links check (deliberate: no unrelated link) and readability
(6.6 vs the 6.5 target, a side effect of this edit); (2) the standing
approved_only rule, which always requires the owner's explicit
approval. Fact-check is green for the first time on #31 (pass 3/3).
**#31 stays a draft until the owner decides.** No further action will
be taken without the owner's explicit authorization.
