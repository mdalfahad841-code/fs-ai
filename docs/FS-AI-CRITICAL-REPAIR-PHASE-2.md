# FS AI — Critical Repair Phase 2: Final Report (2026-11-20)

**Commit:** `98b2349` (on top of `8e8d24b`, 33 commits total on main)
**Repo:** https://github.com/mdalfahad841-code/fs-ai
**Live:** https://fs-ai-5w5.pages.dev — Worker https://fs-ai.mdalfahad841.workers.dev
**Tests:** **779 pass / 0 fail / 178 suites** (651 baseline + 128 new, parent-verified by own `npm test` run, exit 0)
**Migrations applied live:** 013 (article protection), 014 (RSS fetch audit), 015 (correction resolutions)
**Live E2E:** two test articles, #29 (scaffold — generation no-op) and #30 (real 634-word draft)
**Publishing:** nothing published. auto_correction stays OFF. auto_publishing stays OFF, mode approved_only.
**#26 / #27:** untouched — verified in live D1 after every live test (see §17).

## Verdict

- **Level 1 — Implementation: PASS.** All 12 Phase 1 blockers + 6 minor fixes implemented, 779/0 tests, deployed.
- **Level 2 — Live verification: PARTIAL.** 10 of 12 fixes proven live end-to-end. The two partials are the two that matter most for autonomy: correction quality (§3) and citation-aware extraction (§4) — the safety nets work, but no clean live correction was ever produced, and extraction still leaks banner lines and citation prefixes.
- **Level 3 — Autonomous publishing readiness: NOT achieved.** No article produced in this phase can pass the gate. #30 is blocked on fact-check (5/20), a failed correction, and a Guardian 406 that can never pass the SEO broken-links check while that URL is the cited source. Nothing may auto-publish, and auto_correction must stay OFF.

## 1. Scope and method — PASS

Ordered 2026-11-20 10:13: fix the 12 remaining blockers from the Phase 1 report + minor fixes, add regression tests, deploy, live-verify with a NEW test article. $0, Workers AI only, never publish, approved_only, auto_correction OFF until independently verified, never modify #26/#27, no live restore.

Method: a coordinator subagent implemented everything locally (parent-verified: full suite 779/0 on my own run; code spot-checks of protection.js, the correction validator, citation extraction, the new endpoints, and the three updated test expectations — all URL-form updates with identical intent, not weakenings). Migrations 013/014/015 applied to live D1 by the parent via the token helper (013's ALTER exactly once). Source pushed as one clean commit `98b2349` (44 files, +6,696/−263). Live verification ran in the owner dashboard session (owner signed in once via the Secure Vault card; session to 2026-11-27), first with article #29, then a retry with article #30 after the #29 generation failure was diagnosed (see §14).

## 2. Fix 1 — Database-backed protection — PASS

Migration 013 added `articles.is_protected` and flagged #26/#27 (verified live: exactly 2 protected articles). `protection.js` checks the DB flag first and falls back to the constant list only when the column is absent; the constant cannot contradict the DB. Enforcement is wired into `runTask` / `retryTask` / `handleCreateTask` (403 before any change) and into the daily workflow's `seoRun` / `correctionRun` SQL exclusions.

Live proof: both articles show "PROTECTED — AUTOMATIC MODIFICATION DISABLED" in the dashboard; the Optimize SEO and Correct buttons for #26 render disabled ("Protected — automatic modification disabled") so no modification can even be attempted from the UI. No server 403 was reachable through the UI — because the buttons are disabled, which is the better outcome, but the 403 path itself is proven by the 19 protection tests, not by a live 403. See §17 for the D1 proof that #26/#27 content is byte-identical after two live tests including a full daily workflow run.

## 3. Fix 2 — Correction quality — PARTIAL

The validator works live, exactly as designed. On article #30 the correction LLM produced truncated fragments ("If you only have three days to explore New York City, a local's travel guide can" — cut off mid-sentence; "The guide is organized around a simple three-day itinerary. Three days are broke" — cut off). `validateCorrectedBody` rejected the correction, **nothing was saved**, the body stayed byte-identical and coherent, and the failure was recorded in all 11 correction rows as `VALIDATION REJECTED — incomplete paragraph (no closing sentence punctuation)`. No garble, no splice, no imported fact, no changed meaning. The #28 garble pattern (fragment + second sentence saved as one "sentence", `$&`/`$'` splice via raw `String.replace`) is fixed in code and pinned in tests.

What is NOT proven: that the correction agent can ever produce a clean correction on a real article. The live attempt on a 634-word body truncated — the reply was cut off, most likely a token limit in the correction call. Until a live correction succeeds end-to-end, the "correction improves the article" half is unproven. **auto_correction stays OFF** (see §16).

## 4. Fix 3 — Citation-aware claim extraction — PARTIAL

What works live: no bare URL, bibliography line, or "Related reading" line became a claim in #29 or #30, and the body's trailing `Sources:` line was not extracted. Every evidence URL in #30 was the article's own Guardian URL (12 claims) or "no evidence" (8 claims) — no unrelated evidence was imported, unlike the Phase 1 #27 correction that pulled a motorcycle statistic from another article.

What still leaks: (a) the AI-DRAFT banner sentences were extracted as claims 1–2 of #30 ("This draft was written by workers-ai (@cf/openai/gpt-oss-20b)." / "It has NOT been fact-checked…") — meta text about the draft itself, which can never verify against the source and inflates the failure count; (b) five claims (7, 11, 15, 17, 20) carry a "[The Guardian]" citation prefix in the claim text — the prefix was not stripped. Both are extraction gaps the fix was meant to close, now narrowed to these two forms.

## 5. Fix 4 — Failed-correction review — PASS

The Correction review panel listed #30's 6 unresolved corrections (one per distinct claim) with original claim, attempted correction, status, evidence, and failure reason. Resolving one to "pending human review" worked from the dashboard, and the audit trail is verified in live D1: one row in `correction_resolutions` (correction 21, `pending-human-review`, previous_status `failed`, 2026-11-20 05:48 UTC). The original correction row was not deleted and its status was not rewritten — the resolution lives alongside it, as designed. No click can mark a claim VERIFIED by hand. The count stayed 6 after one resolution because pending-human-review is still an open state, not a clearing one. Gate check 4 counts all 11 open correction rows (see §18 for the 6-vs-11 explanation).

## 6. Fix 5 — Fact-check re-run — PASS

The Re-check button reused the article's existing task (task #31 for #30, task #27 for #29) — no duplicate task was created, task queue counts confirm it. Latest + previous verdicts were both shown (#30: latest needs-review 5/20, previous needs-review 5/20). `fact_checked` stayed 0 in both cases (advisory only). Re-check is deliberately NOT blocked on protected articles: it writes only `fact_checks` / `claim_checks` rows and never touches article content, the same as the daily `factCheckRun` — the two tests that pin this return 200 with byte-identical body/excerpt/seo_description on #26.

## 7. Fix 6 — Per-article SEO — PASS

SEO Check is check-only and it proved it live: #30's check ran all 11 checks (9/11 passed) with the message "the article was not modified — no repair, no revision row", and the body was unchanged afterwards. Optimize SEO repaired what it could from the article's own content: #29's seo_description regenerated to 158 chars; #30's internal-links fixed by adding a Related reading link to published article #25 (10/11 after optimize). The readability Fix line ("split long sentences — aim for 15-20 words per sentence…") is present when readability fails (#29, avg 34.0 words); #30's readability passed (avg 19.2 words), so correctly no Fix line. Optimize on protected #26 is refused by the disabled UI button (see §2).

## 8. Fix 7 — Gate logic — PASS

`gate.js` was read end-to-end and is UNCHANGED — the 10 checks stay exactly as strict. Live proof that the gate does its job: #29 NOT eligible (fact-check failed 0/0, SEO failed, approved_only), #30 NOT eligible (fact-check needs-review 5/20, 15 failed claims, 11 corrections open, SEO failed, approved_only). Nothing was published, the Publishing agent was never run, and publishing_mode stayed approved_only through both tests. The gate blocked two weak articles correctly; it has not yet been shown passing a strong one, because no strong article exists yet.

## 9. Fix 8 — Content-task idempotency — PASS

Creating a second content task with #29's exact title and day but a different source URL returned "existing-reused" with "new sources rejected: … (task already done — sources cannot reach the already-converted article; create a new task)". No new task was created, nothing was converted, and #29's recorded sources were verified unchanged afterwards (still 1 source). The done-task rejection and the failed-task merge allowance are both pinned in tests.

## 10. Fix 9 — Weekly workflow — PASS (manual); scheduled run NOT TESTED

The scheduled trigger (Sundays 00:00 UTC, `worker.js:174-178`) is verified in code. The manual control was exercised live: first click "Weekly workflow completed (report #10)"; second click "Weekly workflow already ran this week (report #10) — no re-run" — no duplicate report was created. The weekly-only scope holds (no daily row was written by the weekly run). The scheduled Sunday run itself is due 22 Nov 00:00 UTC and remains NOT TESTED live.

## 11. Fix 10 — RSS fetch audit log — PASS

Migration 014's `rss_fetch_audit` table is live. After the manual daily workflow run, the dashboard Fetch history showed 6 audit rows (all 20 Nov 2026, trigger daily-workflow, status completed, found 0 / new 0 / duplicates 10–50). Reconciliation reads "0 of 24 sources reconcile" — expected, not a failure: audit rows exist only for fetches after migration 014 and history is deliberately not backfilled, so the other 18 sources have no rows to reconcile against. The 19 Nov anomaly (digital-tools duplicates 0→50/10/40 with no new items) is still unexplained — no audit rows exist for it and no reason was invented; the log exists so the next anomaly can be proven from rows. One honesty note: the audit rows carry date only, so they cannot be proven to be from the manual run rather than the scheduled 00:00 UTC run — both fetched 0 new items.

## 12. Minor fixes A–F — PASS

Observed live where applicable: the daily-run status line reports real statuses (completed / already_completed / blocked / no-op with counts, never a bare "finished"); the 20 Nov daily report renders readable step results with no "[object Object]" (one older 14 Nov report still contains a JSON fragment — pre-existing, untouched); the pipeline/drafts table refreshed without a full page reload after the daily run; the automation flags render from the live backend payload; the readability Fix line renders in the SEO detail. Minor A (step attribution) and C (queue refresh) were verified by the DOM harness in tests and behaved correctly in the live runs.

## 13. Indexing fix (canonical + sitemap) — PARTIAL

Our side is fixed and live-verified: the wrong static canonical (one shared URL for all 25 articles, no id) is removed from `article.html`; the page JS injects the clean canonical `…/pages/article?id=N` with matching og:url and JSON-LD; the sitemap generator emits only clean forms; both committed sitemaps (`public/sitemap.xml` 58 locs, `frontend/sitemap.xml` 60 locs) contain **0 `.html` URLs**; every owned article-link builder now uses the clean form. No indexing guarantee is claimed — Google crawls on its own schedule. The Search Console retry is due 2026-11-21 (separate track). Known remaining defect, out of scope: the same `.html` defect class remains on `division.html` canonical + nav links; the sitemap generator emits 35 URLs vs 58/60 committed (entry set not yet reconciled).

## 14. Live E2E — article #29 — PARTIAL (generation failed; everything else passed)

#29 ("A local's travel guide to Austin…", Guardian URL supplied WITH a trailing slash) ran as a content task and returned no-op: "insufficient-evidence: no supplied source resolves to stored research — generation paused, no sourceless draft written." Converting the scaffold still created draft #29 (body 593 chars of placeholders, 1 source recorded). Fact-check failed 0/2 (both claims were scaffold meta-sentences, no citation fragments, no unrelated evidence). Correction ran and correctly saved nothing. Re-check reused the task, fact_checked stayed 0. SEO check 11 results + optimize repaired the description to 158 chars. Gate correctly NOT eligible.

Root cause (parent-verified in code + D1): the resolver matches `research_items.url` by **exact string** (`content.js:350`). The stored URL for item 381 has NO trailing slash; the URL I supplied in the test task HAD one. My error in the task text, not a code bug — but it exposes a real brittleness: any trailing-slash, http/https, or www variation silently kills generation. Follow-up proposed in §21: normalize URLs at resolve time.

## 15. Live E2E — article #30 — PARTIAL (generation works; article cannot pass the gate)

#30 ("A local's travel guide to New York City…", exact stored URL, no trailing slash) generated a REAL 634-word draft in 1 LLM call / 46 Neurons: ferry ride, Chinatown watch shopping, Brighton Beach bender, three-day itinerary, the author's accidental first trip. Fact-check: needs-review, 4/20 → 5/20 verified after the correction run (claim 8 flipped UNSUPPORTED → VERIFIED — mechanism unexplained, see §18). The 15 failed claims are mostly defensible strictness: the draft structured the guide into Day 1/2/3, but the 500-char evidence never assigns days, so the day mappings fail; the "recent feature" wording fails as OUTDATED against a March 2024 article. Correction: rejected by validation (see §3), nothing saved. Re-check: task reused, 5/20 shown as latest + previous. SEO: 9/11 → 10/11 after optimize. Gate: NOT eligible — correct. The article stays a draft.

## 16. auto_correction decision — STAYS OFF

The master condition was: activate auto_correction ONLY if a live correction passes an independent coherence + factual check. No live correction passed: #29's correction had nothing to correct (scaffold), and #30's correction was rejected by validation (truncated fragments). The validator did its job and the article was never harmed — but there is no evidence yet that the correction agent produces good corrections. Enabling it now would burn Neurons (the #30 attempt cost 10 calls / 98 Neurons) and queue failed corrections for human review, with no demonstrated benefit. **auto_correction stays OFF in code and in live settings.** Revisit only after a live correction succeeds end-to-end on a real article.

## 17. #26 / #27 protection proof — PASS

Verified by the parent directly in live D1 after BOTH live tests (including the full manual daily workflow run and the weekly run):

| Article | Protected | Body | SEO desc | Updated at | New revisions | New seo_checks |
|---|---|---|---|---|---|---|
| #26 | 1 | 4,895 chars | 77 | 2026-11-19T18:53:30Z | 0 | 0 |
| #27 | 1 | 245 chars | 61 | 2026-11-19T18:53:32Z | 0 | 0 |

Both values are byte-identical to the Phase 1 restore. #28 is also untouched (body 2,157, seo 150, updated_at 2026-11-19T18:53:35Z). The only changes to #26/#28 were fact-check COUNTS from re-extraction (#26 0/20 → 0/18, #28 6/8 → 6/7) — advisory-only `fact_checks` / `claim_checks` rows written by the citation-aware extractor, never article content. That is the expected effect of Fix 3, not a protection failure.

## 18. New findings from live testing (not in Phase 2 scope)

- **Guardian 406 blocks SEO for every Guardian-sourced article.** The link checker gets HTTP 406 from theguardian.com (bot protection) on a valid, live URL, so the SEO broken-links check can never pass while that URL is the cited source. #29 and #30 both failed SEO on this alone. The checker needs a browser-like User-Agent or a Guardian exemption — otherwise every Guardian article is gate-blocked on a check that measures the checker's fingerprint, not the link.
- **Neurons counters disagree.** D1 analytics counted 23 calls / 259 Neurons today at the end of the #30 test; the dashboard provider header read 55 (it rose 9→55 during generation and never moved again). One of the two counters is stale. The analytics counter kept rising with every run, so it is the more credible one — but the discrepancy is unresolved.
- **Claim 8 flipped UNSUPPORTED → VERIFIED after the correction run** (4/20 → 5/20) with no correction saved. The correction path apparently re-evaluates at least one claim; the mechanism was not traced. Minor, but unexplained.
- **Duplicate correction rows:** 11 failed rows cover only 6 distinct claims for #30 (five claims have 2 rows each). The review panel shows one entry per claim (6); the gate counts rows (11). The counts are consistent once the scoping is known, but the double-recording itself should be traced — the failure path likely writes a row per claim-check and again per claim.
- **Generation repeats itself:** the #30 body tells the accidental-first-trip anecdote twice (Introduction and after Day 3). A generation-quality note, not a pipeline failure.
- **E-Stop probe side effect:** the manual 423 probe left task #28 as "skipped" (0/3 attempts); skipped-task count rose 4 → 5. The task is re-runnable; nothing was lost.

## 19. Weekly scheduled run — NOT TESTED

Due Sunday 22 Nov 2026 00:00 UTC (06:00 Dhaka). The manual control is proven (§10); the cron trigger is verified in code only.

## 20. Publishing — OWNER AUTHORIZATION REQUIRED

Nothing was published in this phase and nothing may publish without his say-so. #29 and #30 stay drafts; #26/#27 must never publish; auto_publishing stays OFF and publishing_mode stays approved_only. The first real publishable article does not exist yet: #30 cannot pass its gate, and no article has passed fact-check + SEO + correction in this phase. When a gate-passed article exists, publishing it still needs his explicit item-named approval.

## 21. What remains (in order)

1. **Normalize source URLs at resolve time** (trailing slash, scheme, www) — the #29 failure was one character. Small fix, needs tests + its own deploy; it removes the brittleness that killed an otherwise-valid generation.
2. **Investigate the correction truncation** — the #30 correction reply was cut off mid-sentence on a 634-word body. Likely a token limit in the correction call; check `max_tokens` / prompt size before the next live correction attempt. Until this is fixed, auto_correction cannot be judged fairly.
3. **Fix the Guardian 406** — browser-like User-Agent on the link checker, or treat 406 as "unverifiable" rather than "broken". Without this, no Guardian-sourced article can ever pass SEO.
4. **Exclude banner/meta lines from claim extraction** (the AI-DRAFT banner sentences) and **strip "[Source]" citation prefixes** from claim text — the two remaining Fix 3 gaps, both visible in #30's claim list.
5. **Trace the duplicate correction rows** (11 rows / 6 claims) and the claim-8 flip; reconcile the Neurons counters.
6. **Scheduled weekly run** — observe Sun 22 Nov 00:00 UTC.
7. **Search Console retry** — due 2026-11-21 (sitemap re-submit + Request indexing), separate track from this repair.
8. **division.html canonical + nav `.html` links** and the **sitemap generator's 35-vs-58 entry gap** — known follow-ups from the repair notes, still open.

---

*Evidence: local tests 779/0 (178 suites); migrations 013/014/015 verified live in D1; dashboard live tests 2026-11-20 11:15 (#29, 12 phases) and 11:17–11:54 (#30, 7 phases); D1 verification of #26/#27/#28/#29/#30 after both tests. Full implementation notes: `docs/PHASE-2-REPAIR-NOTES-2026-11-20.md` (597 lines).*
