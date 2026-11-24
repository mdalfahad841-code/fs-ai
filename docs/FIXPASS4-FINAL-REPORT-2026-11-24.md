# FS AI — FIX PASS 4 FINAL REPORT — 2026-11-24

Owner brief: 2026-11-24 11:08 (side chat, English). Phase 1 READ first,
then fixes F1–F6, then this report. Full detail lives in the ledger:
`docs/FIXPASS4-LEDGER-2026-11-24.md`. Findings doc:
`docs/FIXPASS4-READ-FINDINGS-2026-11-24.md`.

## Headline

Six fixes/docs, four deploys, all green. Tests 1746/0 → **1796/0**
(461 suites). Nothing was published, edited, deleted or loosened.
The daily health report's subrequest failure, the CSP GA4 noise, the
research double-fetch and the lying daily counts are fixed in code.
IndexNow got its first 60-URL submit (HTTP 202). Bing Webmaster and
the gate bottleneck are documented for the owner.

**Two things are still NOT proven live and can only be seen after
the 25 Nov 00:00 UTC daily run** — the health report's checks and
the research counts. A verification run on 25 Nov ~07:00 Dhaka is
required (see "Re-check tomorrow").

## What the READ found (Phase 1 — DONE 11:28)

- **R1 — Research "stall": NOT a stall.** The fetch engine is healthy
  (73/73 audit rows `completed`, all 24 sources `ok`). The daily
  counts only measure the inline step, which re-fetches the same 2
  divisions the queue drain already fetched ~90 s earlier — 0 is the
  correct dedupe answer. The drain stored 13 new items on 24 Nov;
  the counts never show them. Real defects: a double-fetch design +
  a 500-char evidence cap on every RSS item.
- **R2 — Gate bottleneck: 0 of 7 drafts auto-publishable; closest
  #31 at 11/14.** Binding constraint is thin evidence: 6 of 7 drafts
  were fact-checked against ≤500 chars of RSS summary; the one draft
  with full-text evidence (#33, 3,985 chars) passed 15/15. #34 was
  refused twice (publication_logs rows 1–2). One fail-closed cosmetic
  bug found: the duplicate detail said "overlap with another
  **published** article" while all five non-zero overlaps are vs other
  drafts.
- **R3 — Health budget: proven fetches total only 24–26 of 50.**
  The report runs last (step 15); its sitemap + serverSideHeads
  fetches hit the wall. Residual ~24 most plausibly redirect hops
  (UNVERIFIED). `oldestQueuedAt` is a correct pre-drain snapshot,
  not a bug.
- **R4 — CSP: all 16 rows are the site's own GA4 beacons**
  (`connect-src`, `https://www.google.com/g/collect…`), Report-Only
  so nothing broke — but GA4 beacons never reach Google.

## F1. Health report subrequests — DONE (deployed run #73)

The five external-fetch checks (pages, sitemap, recentArticles,
sitemapRefresh, serverSideHeads) now run in the authenticated
internal route `POST /api/admin/health-report-external`, in its own
Worker invocation with a fresh 50-subrequest budget. The daily run
calls it exactly once at step (15); if the call fails, the builder
falls back to the in-process checks — a fetch failure is still
reported as FAIL, never OK. Auth: owner Bearer OR a timestamped
HMAC (SESSION_SECRET, one path, 5-minute window) — the cron holds no
owner session, and minting one would be a live D1 write. No new
secret, no live D1 write. `oldestQueuedAt` was NOT "fixed" as a bug:
the queue detail now carries its `checkedAt` so the snapshot is
labelled. Tests 1746/0 → 1775/0 (+29), negative control passed.
Deployed run #73 GREEN, HEAD a05e5d5. Live: the route answers 401
without auth (old code would 404); home 200; Worker health 200.
**Definitive proof only after the 25 Nov daily run.**

One honest blemish: the run #73 retry retyped the workflow YAML
from memory and dropped the `git reset --soft HEAD~2` line, so the
squash never ran (repo 98 → 101 commits instead of 99; the zip +
workflow file are permanent history). The tree and the live site
are correct; future squashes are unaffected. No history rewrite
was attempted — that needs the owner's say-so. Lesson recorded in
AGENTS.md.

## F2. CSP connect-src — DONE (deployed run #74)

Added `https://www.google.com` to connect-src in the **Report-Only**
header only (`frontend/_headers`). Nothing enforced, no other
directive, X-Frame-Options untouched. Tests 1775/0 → 1776/0 (+1),
negative control passed. Deployed run #74 GREEN, HEAD 94cb4a3
(squash worked). Live: raw GET shows the new connect-src, still
Report-Only, home 200. **Re-check in 1–2 days:** `csp_reports`
should stay at 16 with no new rows dated after the deploy.

## F3. Research fix — DONE (deployed run #75)

- The inline `researchFetch` step now skips any division the queue
  drain already fetched cleanly in the same run, and the daily
  counts report the drain's stored items instead of the inline
  step's 0. Each feed URL is fetched exactly once per run.
- New `evidenceEnrich` step: full-text evidence (via the existing
  `fetchArticleEvidence` service, with all its robots/terms
  compliance) for drafts the drain just converted — max 1/day, only
  to the draft's recorded source URL; any refusal or failure falls
  back to the RSS snippet, never blocks the run. This fixes the thin
  evidence cause for FUTURE drafts, not for the existing 7.
- Drive-by fix the tests caught: the queueDrain step's return dropped
  `draftsConverted`, so the daily report's `queueDraftsConverted`
  always read 0 — same "counts lie by omission" defect class.
- Wording fix: the duplicate detail now says "overlap with another
  article" (the comparator is unchanged — the 0% rule still refuses;
  changing the comparator would loosen a gate and belongs in F6).
- Tests 1776/0 → 1792/0 (+16), negative control passed. Deployed
  run #75 GREEN, HEAD 8d2c204. Live: code present at HEAD, home 200,
  Worker health 200. **Behavioural proof only after the 25 Nov run**
  (counts ≠ 0, each feed fetched once, `queueDraftsConverted` reading
  1 on a convert day).

## F4. IndexNow — DONE (deployed run #76, submitted once)

Public key file at the site root
(`frontend/c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228.txt`,
key is meant to be public). One-off submit of the 60 sitemap URLs
to https://api.indexnow.org/indexnow — **HTTP 202 Accepted**
(2026-11-24 ~12:36 Dhaka; 202 is IndexNow's documented accepted
response). Doc: `docs/indexnow-submit.md` (incl. an auto-ping-on-
publish proposal — proposal only, NOT implemented). Tests 1792/0 →
1796/0 (+4), negative control passed. Deployed run #76 GREEN, HEAD
9a22e934. Live: key file returns 200 with exactly the key; home 200.
**IndexNow covers Bing and some other engines, NOT Google** — it
does nothing for the Google Search Console sitemap problem. Any Bing
indexing effect is NOT TESTED yet (days, not minutes).

## F5. Bing Webmaster steps — DONE (doc; setup BLOCKED-OWNER)

`docs/BING-WEBMASTER-2026-11-24.md` — exact owner steps: sign in,
add the site, verify, submit the sitemap, what success looks like,
where to watch crawl/index movement (3–7 days). **Correction found
while writing it:** the IndexNow key file does NOT verify the site
in Bing Webmaster Tools (checked against nine independent setup
guides — verification is XML file / meta tag / DNS only). The doc
recommends Option A — import from Google Search Console, since the
site is already verified there. The setup itself (sign-in + import)
can only be done by the owner in his own browser: **BLOCKED-OWNER**.

## F6. Gate proposals — DONE (proposals only; nothing changed)

`docs/GATE-BOTTLENECK-2026-11-24.md` — per draft, options +
trade-offs + recommendation, all numbers grounded in R2. No gate
was changed, no article touched, nothing published.

| Draft | Verdict | Recommendation |
|---|---:|---|
| #28 | 7/14 | HOLD — correction round (1 failed claim + #14 link), then fresh fc + SEO |
| #29 | 9/14 | DISCARD in principle — 601 chars, 0 verified claims, no evidence |
| #30 | 9/14 | HOLD — correction plan after the Guardian key, then fresh fc + SEO |
| #31 | 11/14 | **PUBLISH** — fc PASS 3/3, duplicate 0%; dashboard Publish with `PUBLISH DESPITE GATE` |
| #33 | 10/14 | **PUBLISH** — Owner Pack condition met (SEO ran 24 Nov: 10/11); same override step |
| #34 | 9/14 | HOLD — correction round (10 failed claims), then fresh fc + SEO |
| #35 | 7/14 | HOLD — correction round (12 failed claims) + first SEO run |

Gate-design proposals (no change): keep the duplicate comparator
against ALL articles (published-only would let #29's 32% overlap vs
draft #30 pass); internal-links — publish #31 first, then re-measure
#33/#34 SEO (relaxing the rule is forbidden — `internal-links` is
in `NEVER_WAIVABLE_SEO_CHECKS`). **Correction to the F6 doc made by
the parent before shipping:** the doc said "#29 Delete hits the
known B4 foreign-key error today" — that is WRONG. Delete was fixed
in Fix Pass 2 (FK-safe batch delete, deployed run #62; code in
`backend/routes/admin-articles.js`). A live delete has NOT been
tested since the fix, so the owner should click Delete once and, if
it errors, report the exact error and not retry.

## Why nothing has auto-published since 22 Nov (plain summary)

Three reasons, in order of weight:

1. **The drafts are genuinely weak.** 0 of 7 are auto-publishable.
   The binding constraint is evidence: 6 of 7 were fact-checked
   against ≤500-char RSS snippets, and fact-check fails or
   needs-review on thin evidence every time. The one draft with
   full-text evidence passed 15/15.
2. **The gate is working as designed, not broken.** Legacy ids
   (#28–#31) and the pre-cutoff timestamp (#33) block auto-publish
   by rule; the duplicate 0% rule and the internal-links relevance
   rule refuse drafts that would otherwise pass. Nothing here is a
   bug to fix by loosening — the fixes that were possible (F3's
   evidence enrichment, the duplicate wording) are in.
3. **The pipeline itself was mis-measured, not stalled.** Research
   fetched and stored items every day (13 on 24 Nov) — the daily
   counts just never counted the drain's work. F3 fixes the counting
   and the double-fetch. The health report's FAIL was a subrequest
   budget failure, not real breakage (F1 fixes it).

## What the owner must decide / do

1. **#31 — publish?** Dashboard → Publish → type exactly
   `PUBLISH DESPITE GATE`. (Recommended: yes.)
2. **#33 — publish?** Same step, id 33. (Recommended: yes — the SEO
   check the Owner Pack was waiting for has run: 10/11.)
3. **#29 — discard?** Dashboard → Delete. (Recommended: discard in
   principle. Delete was fixed in Fix Pass 2; if it errors, report
   the exact error — do not retry.)
4. **#28 / #30 / #34 / #35 — authorize a correction round?** Each
   needs a go-ahead naming the article.
5. **Guardian Open Platform API key?** Free registration — the
   precondition for fixing #29/#30's Guardian-sourced claims
   (steps in `docs/OWNER-ACTIONS-2026-11-23.md` §4).
6. **Bing Webmaster setup** (`docs/BING-WEBMASTER-2026-11-24.md`) —
   sign in and import from Search Console (Option A). Owner-only.
7. **Duplicate comparator — keep or change?** Recommended: keep
   comparing against all articles. Changing it needs an explicit
   owner decision naming the change.
8. **History rewrite?** Run #73 left the zip + workflow file as
   permanent history (tree is correct). Leave as-is, or say so and
   a history repair can be done — not attempted without say-so.

## Re-check tomorrow (after the 25 Nov 00:00 UTC daily run)

Verify ~07:00 Dhaka on 25 Nov (same shape as Fix Pass 3 A6(a)):
- Daily report: `healthReport.checks.sitemap` and
  `serverSideHeads` are real OK/FAIL (not the subrequest error);
  `sitemapRefresh` no longer NOT TESTED-on-subrequests; queue detail
  carries `checkedAt`; overall health no longer FAIL on subrequests.
- `researchFetched` / `researchItemsStored` ≠ 0; `rss_fetch_audit`
  shows each feed fetched once; `queueDraftsConverted` reads 1 on a
  convert day; a new draft's `article_sources` points at an
  `article-fetch` research item.
- `csp_reports` still 16 (no new rows dated after the F2 deploy).
- Article 1 indexing retry in Search Console (25 Nov, 11th attempt —
  do not double-request on the same day).
- Sitemap status in Search Console (still "Couldn't fetch" until
  Google re-reads it; do not resubmit repeatedly).

## Final confirmation

- [x] No protected article (#26–#31, #33) touched
- [x] #34/#35 untouched (read-only)
- [x] No auto-publish setting, Emergency Stop, schedule or cron changed
- [x] No OAuth connection, no secret touched
- [x] Nothing uploaded or published
- [x] Live D1 writes: **none** (read-only throughout; the only live
  writes in this pass are the four GitHub deploys and the one-off
  IndexNow submit)
- [x] Tests before/after: 1746/0 (450 suites) → 1796/0 (461 suites),
  0 weakened, negative control passed on F1/F2/F3/F4
- Deploys: run #73 a05e5d5 (F1), run #74 94cb4a3 (F2), run #75 8d2c204
  (F3), run #76 9a22e934 (F4) — all GREEN; F5/F6 docs ship with this
  report (run #77, docs-only).
- Rollback for each code item is in the ledger (restore from the
  fixpass4 backup, redeploy).
