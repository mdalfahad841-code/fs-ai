# FS AI — FIX PASS 3 LEDGER — 2026-11-23

Owner brief: 2026-11-23 19:04 (main chat, English). Goal: gate every publish
path (owner decision YES), clean the LLM provider order row, fix the
factCheckRun starvation, remove the duplicate "Related guides" heading,
clean up the duplicate Pages Function with proof, read-only checks (daily
run / CSP / auto-publish proof), then the owner tasks (Search Console
sitemap resubmit + one Article 1 indexing request + phone checks NOT TESTED).

## Hard rules (in force for the whole pass)

- Do NOT publish, edit, delete or touch articles #26–#31 and #33
  (fixtures / in-memory SQLite only; never a real publish, never live D1
  writes of article data). Do NOT change auto-publish settings, Emergency
  Stop, schedules or crons. Daily Shorts cron stays PAUSED.
  social_auto_post stays OFF. No OAuth flow, no account connections, no
  uploads, no real publishing to test. $0 only. No secrets, passwords or
  tokens in code, logs, reports or screenshots.
- BROWSER SAFETY: only the already signed-in Search Console session. Never
  type, request or store a password. Never bypass a login, 2-step
  verification, CAPTCHA or any platform restriction. If Google asks for a
  password, a code or CAPTCHA, or the session has expired, STOP that item
  and report it as BLOCKED-OWNER (owner takes over the browser). Do not
  sign out of any account.
- One code item at a time: change -> tests -> deploy -> raw live
  verification -> next. If a live check fails, roll back that item.
- Existing URLs must keep returning 200 with the same content. Dark and
  light themes must keep working.
- Evidence: raw curl output (GET, not HEAD, when a response header
  matters) for every live check. A browser agent's description is NOT
  proof. Mark anything not run as NOT TESTED. Never write PASS for
  something not run.
- The push workflow never deletes files removed from the local tree: any
  deletion needs an explicit removal step, verified live.

## Pre-change gates — DONE 2026-11-23 19:05–19:09 Dhaka

- Source backup: `~/workspace/fs-ai-source/fs-ai-backup-20261123-fixpass3.tar.gz`
  (1,891,483 B; re-taken after the baseline repair below so the backup
  tree is the green-baseline tree).
- Live D1 backup: `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-2026-11-23-fixpass3-pre-deploy.json`
  (56 tables; script `d1-backup-pre-deploy-2026-11-23-fixpass3.py`).
- Test baseline: **1714 pass / 0 fail, 439 suites** (after the repair below).

### Baseline repair (test-only, no production change)

- First baseline run: 1713 pass / 1 fail — `tests/closeout-a5.test.js:688`
  (A5.7 "is OK when yesterday's daily and a 2-day-old weekly exist"):
  expected 'OK', got 'WARN'.
- Root cause (proved, not guessed): a pre-existing time-of-day flake in
  the TEST fixture, not a regression — no source changed between the
  18:02 Instagram run (1714/0) and the 19:05 run. The production check
  ages a daily row from its date at 00:00 UTC, so a "yesterday" row is
  only <= 36 h old before 12:00 UTC; at 13:05 UTC it was 37.1 h old and
  the check correctly WARNs. `ageHoursFrom` rounds to 1 decimal, which
  is why the 12:02 UTC run still passed (36.0) and the 13:05 UTC run
  failed (37.1).
- Fix: pin the clock through the builder's existing `nowMs` option
  (today 06:00 UTC; yesterday's row then 30 h old). Same assertions,
  same production path, no assertion weakened. File:
  `tests/closeout-a5.test.js` (only that one test). Re-run: A5.7 file
  39/0; full suite 1714/0.

## A1. GATE EVERY PUBLISH PATH — PENDING

Owner decision: YES. POST /publish is gated (Fix Pass 2 item 1); create
with status:'published' and PUT draft->published are not.

- Status: PENDING
- Files:
- Tests before/after:
- Deployed commit:
- Raw live evidence:
- Rollback:

## A2. LLM PROVIDER ORDER CLEANUP — PENDING

Live D1 `llm_provider_order` is `workers-ai,groq,gemini`; change ONLY
that one settings row to `workers-ai`.

- Status: PENDING
- Statement / before / after / rollback:
- Verification:

## A3. factCheckRun STARVATION — PENDING

Same fix pattern as seoRun (Fix Pass 2 item 4): widen candidate fetch,
body_hash + body_length freshness on the latest fact_checks row (NULL or
unreadable = not fresh; never skip on unproven freshness), record
`skipped-fresh`, no slot consumed for fresh articles, stop after 3 real
checks, protected-article guards byte-identical. Tests including the
starvation case. No live fact-check of any protected draft.

- Status: PENDING
- Files:
- Tests before/after:
- Deployed commit:
- Raw live evidence:
- Rollback:

## A4. DUPLICATE "Related guides" HEADING — PENDING

On rewritten article pages (e.g. /pages/article?id=12) the server-side
output ends with "Related guides" followed by a second, empty "Related
guides" heading. Cause: the noscript body plus the existing
related-guides container. Remove the duplicate without breaking the
Function's fail-closed anchor checks or the JS-rendered page. Prove with
raw GET on ids 1, 12, 25: one heading only, related links present once.

- Status: PENDING
- Files:
- Tests before/after:
- Deployed commit:
- Raw live evidence:
- Rollback:

## A5. FUNCTION CLEANUP WITH PROOF — PENDING

Two byte-identical Pages Function copies (repo-root functions/ and
frontend/functions/) plus the x-seo-head diagnostic header.
Step A: deploy making frontend/functions/ emit a distinct marker
(x-seo-src: frontend); watch the live header with raw GET and state
which copy is live. Step B: second deploy removing the non-live copy
with an explicit file-removal step AND removing the diagnostic headers.
Verify with raw GET that article 1/12/25, division automotive and tool
percentage still serve the rewritten head (canonical, JSON-LD, noscript
body — not only a header), that 999 and draft 28 still fall back with
zero draft-title leaks, and that the removed copy is gone from the repo
and the served site. Update the pinned tests.

- Status: PENDING
- Step A deployed commit / live header observed:
- Step B deployed commit:
- Raw live evidence:
- Rollback:

## A6. READ-ONLY CHECKS — PENDING

Only if the data exists; otherwise NOT YET AVAILABLE with the time to
re-check.

- a) After the 24 Nov 00:00 UTC daily run: seoRun detail (checked +
  skippedFresh) for #28/#31/#29, new seo_checks rows for #33 and #30,
  the health report's check 14 (serverSideHeads) and the first daily
  health report overall. (Run is 24 Nov 06:00 Dhaka; re-check after that.)
- b) csp_reports: counts per directive and blocked URL for the rows
  received so far, and a reading of whether any violation is real.
  Do NOT enforce anything.
- c) If an article has been auto-published since 22 Nov: first-real-
  auto-publish proof checklist (page, division/home grid, sitemap after
  the next refresh, canonical/title/og, JSON-LD, counts). If none
  exists yet, say so.

- Status:
- Findings:

## B1. SEARCH CONSOLE SITEMAP RESUBMIT (once) — PENDING

After A4 is deployed. Follow docs/SEARCH-CONSOLE-RESUBMIT-2026-11-23.md.
NOTE: the sitemap was already resubmitted 23 Nov ~16:40 (remove +
re-add, "Sitemap submitted successfully"); the 17:17 check showed
still "Couldn't fetch", Last read blank, 0 discovered pages. This B1
resubmit is the post-A4 one, done once per the brief. Do not resubmit
again the same day.

- Status:
- Exact status text / discovered pages / time:

## B2. INDEXING REQUEST (ONE URL, ONE TIME TODAY) — PENDING

URL Inspection on https://fs-ai-5w5.pages.dev/pages/article?id=1,
Request indexing exactly once. NOTE: Article 1's request was already
clicked 23 Nov 11:00 and got "Quota Exceeded" (8th consecutive); this
B2 attempt is the brief's one ordered attempt for the pass — record the
outcome (accepted / "Quota exceeded" / other) with a screenshot. If
quota exceeded, do not retry and do not try other URLs today. Next URL
in order (newest articles after Article 1) is for the following day.

- Status:
- Inspection result / outcome / screenshot:

## B3. PHONE CHECKS — NOT TESTED

The cloud browser cannot resize the viewport. Mark as NOT TESTED and
list for the owner's real phone: 390 px layout, mobile hamburger menu,
light/dark theme toggle on a phone, fresh-visitor default theme. Do not
claim PASS from a desktop-width browser.

- Status: NOT TESTED (list for owner)

## Final confirmation (to complete at the end)

- [ ] No protected article (#26–#31, #33) touched
- [ ] No auto-publish setting, Emergency Stop, schedule or cron changed
- [ ] No OAuth connection, no secret touched
- [ ] Nothing uploaded or published
- [ ] Only live D1 write: the single llm_provider_order row (A2)
