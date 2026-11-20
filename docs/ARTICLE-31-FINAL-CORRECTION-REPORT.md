# Article #31 — Final Correction & AI-DRAFT Banner Defect Fix: Verification Report

**Date:** 2026-11-20 (code fix deployed 23:00 Dhaka; #31 correction 23:04–23:11 Dhaka)
**Task:** final correction of Article #31 + permanent fix of the AI-DRAFT banner
publishing defect. **Implementation task, NOT a publishing authorization.**
Article #31 was NOT published and remains a draft.

## Verdict

**The banner defect is fixed and live-proven at the publish layer. Article #31
is corrected to a short, honest news brief and remains a draft.**

- Publish layer: a banner-carrying article **cannot** publish — proven live
  (HTTP 422, twice, article stayed a draft).
- Article #31: banner gone, repetition gone, conclusion rewritten, single
  source citation, no unrelated link. Fact-check PASS 5/5, SEO 10/11 — the
  one failing check (internal-links) is the deliberate editorial choice
  ordered for this task, reported honestly below.
- Nothing was published. No protected article or setting was changed.
- Cost of this work: **0 LLM calls, 0 Neurons.**

---

## 1. Changed files and commit hash

**Fix commit: `c6ad67b1bd97258933fae0bebb83060a6ec85d0f`**
("fix: strip AI-DRAFT banner at publish layer, fail-closed validation,
renderer strip", 1 parent `c070b5f`, 7 files, +658 −21, workflow run #20
SUCCESS, 2026-11-20 17:00:26 UTC.)

| File | Change |
|------|--------|
| `backend/utils/draftBanner.js` (new, 101 lines) | Single shared definition of a banner line + `stripDraftBanner`, `hasDraftBanner`, `stripAllDraftBannerLines`. A line counts only when it STARTS with `AI-DRAFT`, `This draft was written by`, `It has NOT been fact-checked`, or `SCAFFOLD` (the same four markers the fact-checker already treats as non-claims). Prose that merely mentions "AI-DRAFT" mid-sentence is never touched. |
| `backend/routes/admin-articles.js` | Banner protection on EVERY transition into `published` via shared helper `preparePublishBody` (strip → validate → refuse with 422 if any banner line survives; save the cleaned body only if it changed). Covers manual publish (`setPublishState`), scheduled publish (`publishDueArticles` — un-strippable articles are skipped, stay `approved`, counted in new `skippedBanner`/`skippedBannerSlugs` fields and the activity log), create-with-status-published, and PUT draft→published (refusal happens BEFORE the revision is stored, so a failed publish leaves no trace). Two live bypasses were found and closed: create-as-published and PUT-flip-to-published (the dashboard status dropdown offers "Published" on save). A PUT that does NOT transition into published never touches the body. |
| `backend/routes/articles.js` | Public API strips banner lines from every returned article body (`publicArticle()` — single + list, D1 + fallback). The public API only serves `status='published'` rows, so this is defense-in-depth. |
| `frontend/scripts/app.js` | `window.FSAI.stripDraftBanner` (ES5, matching file style). |
| `frontend/pages/article.html` | The live article page now renders through `window.FSAI.stripDraftBanner(a.body)`. |
| `tests/draft-banner-publish.test.js` (new, 405 lines) | 23 regression tests (see §3). |
| `tests/fake-d1.js` | Extended the shared fake D1 with the two new SQL shapes the fix issues (due-list SELECT now fetches `body`; publish UPDATE with cleaned `body`). No existing fake behavior altered. |

This report (`docs/ARTICLE-31-FINAL-CORRECTION-REPORT.md`) is a separate
docs-only commit to be pushed after this verification.

## 2. Deployment status and deployed commit

- **Deployed commit: `c6ad67b`** (pushed to `main` via the established one-time
  zip workflow; run #20 SUCCESS; the workflow file and zip were deleted in
  the same commit, as before).
- The site auto-deploys from `main`. The backend fix is **proven live** by
  the block test in §4 (the deployed publish endpoint refused the test
  article at 17:04–17:11 UTC, after the 17:00 UTC push).
- The frontend renderer strip ships in the same commit and the same
  deployment, and is test-proven (vm test + wiring assertion). It was NOT
  independently observed live: observing it would require a published
  banner-carrying article, which this task forbids. That limitation is
  stated here, not hidden.

## 3. Tests passed/failed

**Parent's own run (not the builder's word): `npm test` — 881 pass / 0 fail,
207 suites, exit 0.** Baseline before the fix: 858 pass / 0 fail, 200 suites.
+23 tests, all in the new file. `node --check` clean on all touched files;
`backend` `npm run check` clean. No existing test was weakened. No build
script exists in `package.json`, so no build applies.

The 23 new tests cover: standard banner stripped (2-line and split 3-line
forms) with content byte-identical; mid-sentence "AI-DRAFT" mentions
untouched; no-op for banner-free bodies; detector variants (leading / middle
/ trailing, leading whitespace, lowercase, all four markers) and
non-firing cases; publish 422 + draft preserved + body unchanged; publish
strips + publishes cleaned body; PUT draft→published strips / is refused
with no trace; create-as-published strips / creates nothing on refusal;
scheduled run publishes 2 (one cleaned, one plain) and skips 1
banner-carrying article left `approved`; public API strips a published
banner body without mutating storage; fallback path no-op; live-page strip
via `window.FSAI.stripDraftBanner`.

## 4. Proof that the public publishing path strips or blocks internal draft banners

**LIVE — the block (fail-closed validation), proven 2026-11-20 23:04–23:11 Dhaka:**
A throwaway test draft #32 ("Banner validation test — delete me",
education-learning) was created with a mid-body banner line the stripper
cannot remove (`AI-DRAFT — custom text that must block publishing.` — not
at the top, so only the leading block is stripped and this line survives).
Clicking Publish was **REJECTED twice with HTTP 422**. Exact message:
"This article still contains an internal AI-DRAFT banner line that could
not be removed automatically. Remove the banner from the body and try
again. Nothing was published." The article stayed a draft, its body was
unchanged (verified by re-opening Edit), and the published count stayed at
25. The test draft was then deleted (see note below) and verified gone
(0 rows with id=32; total articles back to 31, published still 25).

**TEST-PROVEN ONLY — the strip path:** the 23 regression tests prove the
publish handler strips a standard banner and publishes the cleaned body,
and that the scheduled path publishes cleaned bodies and skips
un-strippable ones. The strip was **not** proven live, because proving it
live would require actually publishing a banner-carrying article — which
this task forbids. This distinction is deliberate and is recorded here.

**TEST-PROVEN ONLY — the renderer strip:** API + live-page strip tests pass
(§3). Live observation would likewise require a published banner article.

**Deletion note (observation, out of scope):** the dashboard Delete button
produced no effect for the browser agent in 8 attempts (no dialog, no
error, article remained after reloads). The test draft was removed instead
by the API-equivalent D1 delete, mirroring `deleteArticle` exactly
(`DELETE FROM articles WHERE id = 32`; revisions are kept by design — this
draft had 0 tags, 0 revisions, 0 fact-checks, 0 seo rows). Verified gone.
The unresponsive Delete button is worth a look on its own; it was not
fixed in this task.

## 5. Article #31's final word count

**94 words** (SEO tool's count: 7 sentences, avg sentence 13.4 words, avg
word 6.2 chars — under the 6.5 target). Body 684 chars. The article is a
short news brief by design (§7).

## 6. Updated fact-check and SEO results

**Fact-check: PASS — 5 claims, 5 verified, 0 failed** (fact_check 19,
`correction-recheck`; dashboard Re-check run #122 completed 17:09:15 UTC,
task #34; 0 LLM calls — deterministic judge).

**Honest note on the re-check mechanism:** run #122 wrote NO new
`fact_checks` or `claim_checks` rows (claim rows 188–192 still carry the
round-1 timestamps, 14:17:26–27 UTC). This is the Phase 3 P6 carry-forward:
the reworded sentences were treated as the same claims (same facts, same
evidence), so their VERIFIED verdicts carried forward and the stored claim
text still shows the earlier phrasing ("International enrollment",
"9 percent", "trend may be temporary"). The new body sentences ("Final
enrollment figures for 2026–27 are not yet known", "The data so far are
preliminary", "the rise in applications remains an early signal — not proof
that more students will enroll") were **not** freshly extracted or
individually judged by the system. The verdict is sound — the facts are
identical to the verified claims and rest on the same evidence — but this
report does not claim the new wording was freshly verified word-for-word.

**SEO: needs-review, 10/11** (seo_checks row 14, 2026-11-20 17:10:02 UTC):

| Check | Result | Detail |
|-------|--------|--------|
| seo-title | PASS | 50 characters (target 30–60) |
| meta-description | PASS | 155 characters (target 120–160) |
| slug-unique | PASS | Slug is unique |
| heading-hierarchy | PASS | 0 H1, 3 H2, 0 H3 |
| keyword-relevance | PASS | 5/5 title keywords (100%) |
| internal-links | **FAIL** | "1 related published article(s) available to link — none linked yet." |
| image-alt | PASS | No images, nothing to check |
| readability | PASS | 94 words, avg word 6.2 chars |
| duplicate | PASS | Highest 5-word shingle overlap 0% |
| broken-links | PASS | All 1 external link(s) responded |
| structured-metadata | PASS | Title, excerpt, slug and division are set |

The internal-links failure is **the deliberate editorial choice ordered for
this task**: the unrelated Related Reading link to #22 was removed and no
unrelated link was inserted merely to pass SEO. Editorial relevance takes
priority over an artificial 11/11, as instructed. No SEO check was bypassed
or weakened; the Optimize/repair action was never run.

**Publishing gate:** Blocked. fact-check-pass ✓, no-unresolved-errors ✓,
sources-verified ✓ (1 source), correction-recheck ✓, seo-pass ✗ (needs-review,
internal-links), duplicate-pass ✓ (0%), special-review ✓, emergency-stop-off
✓, daily-limit ✓ (0/1), publishing-rules ✗ (`approved_only`). States:
content-ready NO · fact-check passed YES · SEO passed NO · eligible NO ·
authorized to publish NO. Blocked-by: "Latest SEO verdict: needs-review.;
publishing_mode is 'approved_only' — gate-passed articles wait for owner
approval, nothing auto-publishes." Before the fresh SEO check the gate had
shown "Ready" with only the approved_only block; the fresh check moved it
to Blocked on the editorial internal-links decision.

**Publishing-banner validation:** the re-opened #31 body contains no
"AI-DRAFT" line (verified in D1: 0 banner lines). The public page
https://fs-ai-5w5.pages.dev/pages/article?id=31 shows "Article not found"
(a draft is not publicly served) — no title, no body, no banner text
anywhere.

## 7. Source limitations

- The available evidence is **one 307-character fragment** from Inside
  Higher Ed (research item 675; summary and evidence_text are the same
  single sentence: enrollment down this fall; preliminary Common App data
  show a 9 percent uptick in international applicants for 2026–27). The
  full source article was not retrieved through any available free source,
  and the article is retained as a clearly limited short news brief.
- **Nothing was invented:** no enrollment statistics beyond the fragment,
  no reasons for the decline, no country breakdowns, no projections, no
  additional sources, no fabricated research records. The two verified
  facts (enrollment down; applications up 9%) are the article's entire
  factual content; everything else is hedged framing of what is not yet
  known.
- The correction removed the two unsupported implications named in the
  audit ("the trend may be temporary", "if enrollment barriers persist")
  and states plainly that final 2026–27 figures are not yet known and the
  9% rise is only an early signal — not proof of higher enrollment.

## 8. Confirmation that Article #31 remains a draft

Confirmed in D1 (2026-11-20 23:11 Dhaka): id 31, status `draft`, body 684
chars, updated 2026-11-20T17:08:31Z (the correction edit). Title, division
(education-learning), excerpt (155 chars) unchanged. It was never published.

## 9. Confirmation that no article was published

- Published count: **25 before and after** this work (D1:
  `COUNT(*) WHERE status='published'` = 25; total articles 31 after the
  test draft's deletion).
- Gate: published today 0/1. The test draft's two publish attempts were
  both rejected (422). Article #31 was never published; no Publish or
  Unpublish button was clicked on any real article. No scheduled publish ran
  during this work.

## 10. Confirmation that all protected articles and automation settings remain unchanged

- **#26 and #27 protected and untouched** (D1, byte-level): #26 "How
  Artificial Intelligence Is Changing Everyday Life" — body 4895 / excerpt
  77 / updated 2026-11-19T18:53:30Z; #27 "Tesla Cybercab Factory at Giga
  Berlin" — body 245 / excerpt 61 / updated 2026-11-19T18:53:32Z. Both
  still PROTECTED, both still draft; their edit forms were never opened.
- **#28, #29, #30 untouched:** #28 body 2157 / excerpt 150 / updated
  2026-11-19T18:53:35Z; #29 body 593 / excerpt 95 / updated
  2026-11-20T05:09:54Z; #30 body 4615 / excerpt 132 / updated
  2026-11-20T05:52:22Z. (Baseline note: #29's excerpt is 95 chars; an
  earlier verification note recorded 158 — a transcription error, corrected
  in the previous report; updated_at is unchanged since creation.)
- **Settings unchanged** (fresh dashboard read 23:11 Dhaka): publishing
  mode "Approved only"; auto-publishing OFF; auto-correction OFF; social
  auto-post Off; Emergency Stop OFF. No setting was changed; the Emergency
  Stop was never toggled.
- **Workers AI only; no paid service.** 0 LLM calls / 0 Neurons in the
  whole work window (17:00 UTC onward).

---

## Appendix — final body of Article #31 (as stored in D1, 684 chars)

> ## Introduction
>
> Enrollment from abroad is down this fall. Early data from the Common App show a 9% rise in the number of students from abroad who applied for the 2026–27 school year. Final enrollment figures for 2026–27 are not yet known.
>
> ## Sources and further reading
>
> - Palmer, Kathryn. “Will More International Students Enroll Next Year?” *Inside Higher Ed*, 19 Nov 2026. https://www.insidehighered.com/news/admissions/traditional-age/2026/11/19/will-more-international-students-enroll-next-year/
>
> ## Conclusion
>
> The data so far are preliminary. Until the final 2026–27 figures arrive, the rise in applications remains an early signal — not proof that more students will enroll.

**What changed vs the previous body:** all three AI-DRAFT banner lines
removed; the two unsupported claims and two dangling fragments already
removed in the earlier quality work; repetition removed (each fact appears
once — "9%" ×1, "down this fall" ×1); the Key takeaways section removed
(it restated the introduction verbatim); the conclusion rewritten to answer
the title's question honestly (not known yet) instead of restating the
introduction; "the trend may be temporary" and "if enrollment barriers
persist" removed; the duplicate "Sources:" listing removed (one citation
kept); the unrelated Related Reading link to #22 removed.

**Next step (owner's decision):** Article #31 stays a draft until the owner
authorizes publication. No further action will be taken without the owner's
explicit authorization.
