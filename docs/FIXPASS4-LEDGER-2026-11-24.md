# FS AI — FIX PASS 4 LEDGER — 2026-11-24

Owner brief: 2026-11-24 11:08 (side chat, English). Goal: explain why
nothing has auto-published since 22 Nov, fix the daily health report's
subrequest failures, fix the CSP connect-src GA4 noise, fix the research
double-fetch/counting, submit to IndexNow, write Bing Webmaster steps
and gate proposals. Phase 1 READ first, then fixes, then report.

## Hard rules (in force for the whole pass)

- Do NOT publish, edit, delete or touch articles #26–#31 and #33.
  #34 and #35 are READ-ONLY. Do NOT change auto-publish settings,
  Emergency Stop, schedules or crons (no new cron either). Daily Shorts
  cron stays PAUSED. social_auto_post stays OFF. No OAuth, no uploads,
  no real publishing to test. $0 only. No secrets, passwords or tokens
  in code, logs, reports or screenshots.
- Do NOT loosen, bypass or weaken any quality, fact-check, SEO,
  duplication or publish gate. Health and Finance keep human review.
  No invented sources, claims or evidence.
- Live D1: read-only. If a fix needs a live write, STOP that item and
  list it for the owner with the exact statement.
- Before ANY code change: fresh source backup, fresh live D1 backup,
  full test-suite baseline. One code item at a time (change → tests
  with a negative control against pre-change code → deploy → raw live
  verification → next). If a live check fails, roll back that item.
- Existing URLs must keep returning 200 with the same content.
  Evidence: raw curl output (GET when a header matters). A browser
  agent's description is NOT proof. Mark anything not run as NOT
  TESTED. Never write PASS for something you did not run.
- The push workflow never deletes files removed from the local tree:
  any deletion needs an explicit removal step, verified live.
- Sign-ins (Bing, Google, Microsoft) are owner-only: never type or
  request a password; if a sign-in is needed, mark BLOCKED-OWNER and
  write the exact steps.

## Pre-change gates — DONE 2026-11-24 11:09–11:10

- Source backup: `~/workspace/fs-ai-source/fs-ai-backup-20261124-fixpass4.tar.gz`
  (1,911,240 B).
- Live D1 backup: `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-2026-11-24-fixpass4-pre-deploy.json`
  (56 tables, 2,086,613 B; script `d1-backup-pre-deploy-2026-11-24-fixpass4.py`).
- Baseline: `npm test` 1746 pass / 0 fail (matches the Fix Pass 3 final).

## Phase 1 — READ — DONE 2026-11-24 ~11:28

Findings doc: `docs/FIXPASS4-READ-FINDINGS-2026-11-24.md` (614 lines).
READ-ONLY respected: no source changes, no live D1 writes, no deploy.

- **R1 — Research "stall": NOT a stall.** Fetch engine healthy (73/73
  audit rows `completed`, all 24 sources `ok`). The daily counts only
  measure the inline `researchFetch` step, which re-fetches the same 2
  divisions the queue drain already fetched ~90 s earlier — 0 is the
  correct dedupe answer. The drain stored 13 new items on 24 Nov; the
  counts never show them. Real defects: a double-fetch design + a
  500-char evidence cap (`backend/rss/rss.js:80/84`,
  `backend/rss/sources.js:176–177`). Guardian key gates only full-text
  Guardian fetches, not the RSS stall.
- **R2 — Gate bottleneck: 0 of 7 drafts auto-publishable; closest #31
  at 11/14.** Binding constraint is thin evidence: 6 of 7 drafts were
  fact-checked against ≤500 chars of RSS summary; the one draft with
  full-text evidence (#33, 3,985 chars) passed 15/15. #34 refused
  twice (publication_logs rows 1–2): row 1 timing (no checks yet),
  row 2 fact-check 4/14 + 10 failed claims + SEO needs-review +
  duplicate 6% + internal-links. New bug found (fail-closed,
  cosmetic): the duplicate-zero-overlap detail says "overlap with
  another **published** article" but all five non-zero overlaps are vs
  other **drafts** (gate.js:665–668 comment disagrees with the SEO
  suite). Corrections to the Fix Pass 3 summary recorded in the doc
  (22/23 Nov drain attribution; #33's B6 correction count is 0 not 4;
  #34's internal-links row 2 failed; #30's verifiedClaimsWithoutEvidence
  is 0 not 1).
- **R3 — Health budget: proven fetches total only 24–26 of 50, so the
  budget is NOT fully accounted for.** The health report runs last
  (step 15); its sitemap + serverSideHeads fetches hit the wall.
  Residual ~24 subrequests most plausibly redirect hops (UNVERIFIED).
  `oldestQueuedAt` is a correct pre-drain snapshot, not a bug
  (healthcheck.js:151–177; drain calls runHealthCheck first,
  scheduler.js:992; the report reuses that object, scheduler.js:1584–1600).
- **R4 — CSP: all 16 rows are the site's own GA4 beacons**
  (`connect-src`, `https://www.google.com/g/collect?v=2&tid=G-JVSCJT2DHJ…`),
  Report-Only so nothing broke. Single root cause: GA4 not
  allow-listed in `connect-src`.

## F1. HEALTH REPORT SUBREQUESTS — DONE (built, deployed, live-verified; definitive proof awaits the 25 Nov daily run)

**Status: built (2026-11-24 ~12:30 Dhaka), NOT YET DEPLOYED.** Parent
deploys, live-verifies, and fills the deploy/live-evidence lines.

### Design choice — option (a): authenticated internal route, called once

The five external-fetch checks (pages, sitemap, recentArticles,
sitemapRefresh, serverSideHeads) now run in the internal route
`POST /api/admin/health-report-external`, which executes in its OWN
Worker invocation with a fresh 50-subrequest budget. The daily run
calls it exactly once at step (15) and embeds the returned checks in
the daily report; if the call fails for any reason, the builder falls
back to the in-process checks (today's behaviour — a fetch failure is
still reported as FAIL, never OK).

Why (a), and why the others were rejected:
- **(a) is the only option that provably solves the budget problem.**
  The route's invocation spends at most 8 fetches (pages 1, sitemap
  1, recentArticles 0–5, sitemapRefresh 1, serverSideHeads 5) plus
  redirect hops — comfortably under 50. The daily invocation spends
  exactly 1 subrequest on the call itself (plus its proven 16–18:
  12 RSS + 4–6 SEO HEADs), also comfortably under 50.
- **(b) cut earlier-step fetches — rejected as the sole fix.** Proven
  fetches total only 24–26 of 50; the residual ~24 is UNVERIFIED
  (most plausibly redirect hops, R3.4). No cut can be proven
  sufficient, and the 6 duplicate RSS fetches belong to F3's
  double-fetch fix, not to F1.
- **(c) batch — rejected.** Batching does not reduce subrequest
  count: each fetch is a subrequest regardless of batching.
- No new cron (the existing hourly trigger is untouched). No coverage
  removed: the same five check functions run, with the same
  semantics — sitemapRefresh fetch failure stays NOT TESTED, a
  fetch failure anywhere else stays FAIL. No gate, publish path,
  article, setting, schedule, or CSP header touched. Overall
  FAIL/WARN/OK semantics unchanged: the overall is still computed
  from the same 14 checks; only where the five external values come
  from changed.

### Auth — the requireOwner deviation, stated plainly

The route accepts EITHER a `requireOwner` Bearer session (a human
owner calling it directly — the same pattern as other admin routes)
OR the Worker's own HMAC-signed internal call. `requireOwner` alone
cannot be satisfied by a cron invocation: there is no owner session
in a scheduled event, and minting one would be a live D1 write plus
a transient full-owner credential. So the daily run signs its single
call with HMAC-SHA256 over `POST\n/api/admin/health-report-external
\n<timestamp>`, keyed by the existing `env.SESSION_SECRET` (no new
secret, no live write), valid 5 minutes, constant-time compare
(`backend/security/crypto.js` signInternalRequest /
verifyInternalSignature). The secret is never transmitted; a captured
signature is useless after the window and only for this one path.
The route is READ-ONLY (public-URL fetches + D1 reads through the
same check functions the builder uses; it writes nothing), so the
blast radius of a forged call is limited to running the public
checks. The route also validates its optional `{ checks: [...] }`
subset body (unknown name → 400, bad JSON → 400) and answers 405 to
non-POST.

### oldestQueuedAt — verified correct, presentation fix only

Verified in code (R3.6 confirmed): drain calls `runHealthCheck`
first (`scheduler.js:992`); `healthcheck.js:151–177` computes
`oldestQueuedAt` as the minimum `created_at` among queued tasks;
`runHealthCheck` returns `{ overall, checkedAt, checks, persisted }`
with `checkedAt` on every component; the report reuses that object
(`scheduler.js:1584–1600`, `daily-health-report.js:200`). The value
is a CORRECT pre-drain snapshot, not a bug — it was NOT "fixed" as
one. The fix is presentation: the queue check detail now carries
`checkedAt` (the drain-time instant), so the reader can see the
numbers are a snapshot from drain time. Re-computing at report time
was rejected: it would need a second `runHealthCheck` call, which
WRITES `system_health_checks` rows — explicitly forbidden by the
builder's own contract. (Dashboard note: the dashboard renders the
queue detail generically and does not surface the new `checkedAt`
field yet; the report JSON carries it, which is what the next READ
and the owner need.)

### Subrequest counter — left out, deliberately

R3.7 asked for a per-invocation counter "if it fits cleanly". It
does not: there is no shared fetch wrapper to instrument (fetch
sites are `rss.js` fetchFeed, `seo.js` HEADs, and the builder's
`fetchWithTimeout`), a module-level singleton would leak counts
across isolate reuses, and threading a counter object through all
three modules is a multi-file change for a diagnostic. The
structural fix removes the need for precise accounting: both
invocations now have 2–3× headroom (daily ~17–19 proven + hops,
route ≤8 + hops).

### Files changed (vs the fixpass4 backup — exactly 6 paths)

- `backend/routes/health-external.js` (NEW, 136 lines): the route
  handler + `verifyInternalHealthCall` + path/timeout constants.
- `backend/services/daily-health-report.js`: `EXTERNAL_HEALTH_CHECK_KEYS`
  + exported `runExternalHealthChecks` (same five functions, same
  semantics); builder accepts `externalChecks` (supplied checks used
  verbatim only with a valid honest status, else in-process);
  queue detail gains `checkedAt`.
- `backend/routes/scheduler.js`: `WORKER_BASE_URL` (precedent:
  `oauth.js:104`), `HEALTH_REPORT_EXTERNAL_TIMEOUT_MS` (60 s),
  exported `fetchExternalHealthChecks` (HMAC-signed single call,
  null on any failure); `runDailyWorkflow` gains a `fetchImpl`
  option (default global fetch); step (15) calls the route once,
  then builds the report with `externalChecks`.
- `backend/worker.js`: registers `POST
  /api/admin/health-report-external` (auth inside the handler —
  same exemption shape as the social OAuth callback).
- `backend/security/crypto.js`: `signInternalRequest` +
  `verifyInternalSignature` (HMAC-SHA256, 5-min window,
  timingSafeEqual).
- `tests/fixpass4-f1.test.js` (NEW, 741 lines, 29 tests, suites
  F1.1–F1.5).

No D1 schema change, no new dependency, no migration. No live D1
write is needed for this fix to work (the route needs only the
already-configured `SESSION_SECRET`; without it the daily run skips
the self-call and behaves exactly as before).

### Tests

- Baseline (before): 1746 pass / 0 fail, 450 suites (verified by
  the builder before starting).
- After: **1775 pass / 0 fail, 455 suites** (+29 tests, +5 suites,
  0 weakened). New file `tests/fixpass4-f1.test.js`: 29/29 pass —
  F1.1 HMAC (5), F1.2 route auth/behaviour/read-only (11), F1.3
  builder supplied-checks + queue label (6), F1.4 scheduler wiring
  (3 full `runDailyWorkflow` runs), F1.5 helper (3).
- One real failure caught during the build (fixed, not weakened):
  the full suite failed 1 test — `closeout-a5.test.js` A5.10
  ("builder never imports runHealthCheck", a source-string
  assertion). Cause: a comment I wrote in `daily-health-report.js`
  contained the literal strings `healthcheck.js` and
  `runHealthCheck (` (with a paren), which that test treats as an
  import/call. Fix: reworded the two comments (no code changed);
  full suite green again. Lesson: that file's comments must never
  spell `healthcheck.js` or `runHealthCheck (`.
- One test-assertion fix during the build: F1.4's first test
  expected overall OK, but the fixture's drain health is WARN (no
  backup run in a fresh DB — the same honest WARN A5.11 expects).
  The assertion now expects WARN + workerHealth WARN; the five
  external checks are still asserted verbatim from the route.

### Negative control — PASS (fix-dependent tests fail on pre-change code)

Procedure: saved the new files to /tmp, copied the four
pre-change production files from the fixpass4 backup tarball
(`daily-health-report.js`, `scheduler.js`, `worker.js`,
`crypto.js`), deleted the new route file, ran the new test file.
Result: **the file fails to load at all — 0 pass, 1 file-level
failure** (missing module `health-external.js` / missing exports).
Granular probes on the pre-change tree: `runExternalHealthChecks`
undefined, `EXTERNAL_HEALTH_CHECK_KEYS` undefined,
`signInternalRequest`/`verifyInternalSignature` undefined,
pre-change `scheduler.js` contains no `health-report-external` and
no `fetchExternalHealthChecks`. Restored the new files from /tmp
and re-ran: 29/29 green, full suite 1775/0.

### Live proof still needed (parent — deploy time + 25 Nov run)

- Deploy-time (provable without a live daily run): the route
  responds to a direct authenticated call — POST the route with a
  valid owner Bearer session and confirm 200 + all five checks with
  real statuses (pages/sitemap/serverSideHeads OK on the live site).
  Also confirm home 200, Worker health 200, and that no existing
  URL changed.
- The "next health report no longer fails on subrequests" proof can
  ONLY be observed after the **25 Nov 00:00 UTC daily run** (06:00
  Dhaka): read daily_reports for 25 Nov and confirm
  `healthReport.checks.sitemap` and `serverSideHeads` are real
  OK/FAIL (not the subrequest error), `sitemapRefresh` is no longer
  NOT TESTED-on-subrequests, and the queue detail carries
  `checkedAt`. If the route call itself failed, the report will
  show the old in-process subrequest FAILs — that outcome is
  honest, not hidden: check `agent_runs` for the health-report step
  detail if so.
- Rollback: restore the 4 modified production files + delete
  `backend/routes/health-external.js` and `tests/fixpass4-f1.test.js`
  from the fixpass4 backup, redeploy. The builder's
  `externalChecks` default (null) means the old code path is the
  fallback even before a rollback.

- **DEPLOYED: run #73 GREEN (2026-11-24 11:49–11:53 Dhaka, 10 s),
  HEAD a05e5d54109ca6a740434f61e4e4306ce8357006, 11 files +2,046/−56.**
  https://github.com/mdalfahad841-code/fs-ai/actions/runs/45335978717
  Parent re-ran the suite: 1775/0 exact match.
- **History blemish (parent's transcription error, recorded honestly):
  the retry browse call retyped the workflow YAML from memory and
  DROPPED the `git reset --soft HEAD~2` + second `git add -A` lines,
  so the squash never ran — the new commit's parent is 6b2a818 (the
  zip-upload commit), not ecad267, and the repo went 98 → 101 commits
  instead of 98 → 99. The two interim commits (workflow file cb357ce,
  zip 6b2a818) are now permanent history; the TREE is correct (both
  files deleted in a05e5d5). The live site is unaffected and future
  squashes are unaffected (relative HEAD~2 arithmetic). No history
  rewrite attempted — that needs the owner's say-so. Lesson added to
  AGENTS.md: never retype the workflow YAML on a retry; copy it
  verbatim.**
- Live evidence (raw curl ~11:54 Dhaka): home 200; Worker health 200
  ok:true db connected; deployed `backend/routes/health-external.js`
  at a05e5d5 returns 200; deployed `backend/worker.js` contains
  `health-report-external` ×1; **POST
  `/api/admin/health-report-external` with no auth → 401 "Owner
  session required" — the new route IS live on the Worker (old code
  would 404) and the auth gate works**; sitemap 60 URLs; article 1
  "Related guides" ×1. Protected #26–#33, #34/#35 untouched (no live
  D1 writes in this pass so far).
- NOT TESTED live: a direct authenticated call to the route (needs an
  owner session or the HMAC secret — neither is available to curl);
  the DEFINITIVE proof — the 25 Nov 00:00 UTC daily run's health
  report showing sitemap/serverSideHeads as real OK/FAIL (not
  subrequest errors) and sitemapRefresh no longer NOT TESTED-on-
  subrequests, with queue `checkedAt` present. A 25 Nov 07:00 Dhaka
  verification is required (same as Fix Pass 3 A6(a)).

## F2. CSP CONNECT-SRC — DONE (built, deployed, live-verified; GA4-violation re-check in 1–2 days)

- Status: BUILT (coordinator done 2026-11-24 ~12:05 Dhaka). NOT
  deployed yet — the parent deploys, live-verifies with raw GET, and
  completes the deploy/live-evidence lines below.
- Evidence (R4): all 16 csp_reports rows are directive connect-src,
  blocked_uri `https://www.google.com/g/collect?v=2&tid=G-JVSCJT2DHJ…`
  (the site's own GA4 beacons). Root cause: the Report-Only CSP's
  connect-src did not allow-list https://www.google.com.
- Live header read before the change (raw curl, HEAD and GET agree,
  2026-11-24 ~11:56 Dhaka, https://fs-ai-5w5.pages.dev/):
  `Content-Security-Policy-Report-Only: default-src 'self'; script-src
  'self' 'unsafe-inline' https://www.googletagmanager.com; style-src
  'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src 'self' https://fs-ai.mdalfahad841.workers.dev
  https://www.googletagmanager.com https://www.google-analytics.com;
  frame-ancestors 'none'; base-uri 'self'; report-uri
  https://fs-ai.mdalfahad841.workers.dev/api/csp-report`
  Note: https://www.googletagmanager.com WAS already in connect-src
  (R4 flagged it to check) — recorded, NOT added (the brief names
  https://www.google.com only).
- Change (frontend/_headers ONLY, 1 line + comment): connect-src old
  → new:
  old: `connect-src 'self' https://fs-ai.mdalfahad841.workers.dev https://www.googletagmanager.com https://www.google-analytics.com`
  new: `connect-src 'self' https://fs-ai.mdalfahad841.workers.dev https://www.googletagmanager.com https://www.google-analytics.com https://www.google.com`
  Nothing else changed: policy stays Content-Security-Policy-Report-Only
  (no enforcing CSP added), no other directive touched, X-Frame-Options:
  DENY untouched, report-uri untouched. The file's comment now says GA4
  beacons go to www.google-analytics.com AND www.google.com/g/collect.
- Files changed (exactly 2): frontend/_headers (1 policy line +
  3-line comment), tests/pages-headers.test.js (+1 test).
- Tests: new test "connect-src allows https://www.google.com for GA4
  beacons (Fix Pass 4 F2)" — extracts the connect-src directive and
  asserts it contains exactly https://www.google.com as a token, plus a
  deepEqual pin of the exact 5-entry host list (self + Worker +
  googletagmanager + google-analytics + google.com) so no host can be
  added or dropped silently. Full suite: before 1775/0 (455 suites,
  after F1) → after 1776/0 (455 suites). No test weakened.
- Negative control: the new test run against the pre-change
  frontend/_headers from the fixpass4 backup tarball fails exactly
  that test (4 pass / 1 fail); restoring the new header gives 5/5
  pass.
- Diff vs the fixpass4 backup: F1's files + exactly these 2 F2 files.
  No gate, publish path, article, setting, cron/schedule or Worker
  code touched. No live D1 write. No deploy by the coordinator.
- Live proof still needed (parent): raw GET on the live site showing
  the new connect-src with https://www.google.com; policy still
  Report-Only; home 200; protected articles unchanged.
- Re-check for "GA4 reports stop being new violations": no new
  violation rows appear until a real visit fires a GA4 beacon, so
  re-check after real traffic hits the site post-deploy — read
  csp_reports fresh in 1–2 days (and the next daily health report's
  cspViolations count): expect the total to stay at 16 with no new
  rows dated after the deploy. Old rows stay in the table (history,
  not an error).
- Rollback: restore frontend/_headers + tests/pages-headers.test.js
  from the fixpass4 backup and redeploy; no D1 change involved.

- **DEPLOYED: run #74 GREEN (2026-11-24 11:59–12:04 Dhaka, 11 s),
  HEAD 94cb4a3b0adab56452e9e5840021188411603814, parent a05e5d5 (F1),
  3 files +121/−4.** Squash worked this time (repo 103 → 102).
  https://github.com/mdalfahad841-code/fs-ai/actions/runs/45337153092
  Parent re-ran the suite: 1776/0 exact match.
- Live evidence (raw GET ~12:05 Dhaka): home 200; header
  `content-security-policy-report-only` carries connect-src
  `... https://www.google-analytics.com https://www.google.com`
  — the new host is live; NO enforcing `content-security-policy`
  header (still Report-Only only). Protected #26–#33, #34/#35
  untouched (no live D1 writes in this pass so far).
- NOT TESTED live: no new csp_reports rows after the deploy — that
  re-check needs real traffic + 1–2 days (see above); expect the
  total to stay at 16.

## F3. RESEARCH FIX — DONE (built, deployed, live-verified; behavioural proof awaits the 25 Nov daily run)

- Design (least-risky, in two parts):
  - **(a)+(b) Double-fetch + lying counts.** The drain (step 0) already
    runs yesterday's daily-research tasks for the same 2 thinnest
    divisions minutes before the inline `researchFetch` step, which
    re-fetched the same 6 feeds and stored 0 (pure duplicates) while
    the daily counts (`researchFetched`/`researchItemsStored`) measured
    only the inline step — so they read 0 on days the drain stored 13.
    Fix: `drainTaskQueue` now attaches a small `research` summary
    (`division`, `candidates`, `itemsStored`, `sourcesChecked`,
    `fetchErrors`) to each drained daily-research result entry
    (additive only — no other consumer reads those entries' keys);
    new exported pure helper `summarizeDrainedResearch()` aggregates
    them per division; the inline step skips a division the drain
    already fetched cleanly (`cleanExecutions > 0`, i.e. at least one
    drain execution fetched all its feeds with zero fetch errors) and
    counts the drain's candidates/itemsStored instead. The daily
    report lines are unchanged — they now read the run's real totals.
    A division is NOT skipped (inline fetch runs exactly as before)
    when the drain never ran it, failed it, skipped it, or any feed
    errored — the retry/fallback behaviour is preserved. Which sources
    are fetched is unchanged; the drain's behaviour is unchanged.
    Side benefit (R3.7): 6 RSS fetches + their redirect hops are saved
    every day, easing the subrequest budget F1 had to work around.
  - **Drive-by fix in the same defect class (found by the F3 tests):
    the daily report's `queueDraftsConverted` count always read 0.**
    The queueDrain step's return object dropped `draftsConverted`
    (the drain itself counted it correctly), so the summary line
    `steps.queueDrain.result?.draftsConverted ?? 0` was always 0 even
    on days the drain converted a draft. One line added
    (`draftsConverted: drain.draftsConverted` in the step return).
    Pre-existing bug, not introduced by F3; fixed here because it is
    the same "counts lie by omission" defect in the same report.
  - **(c) Full-text evidence — IMPLEMENTED (least-risky form).** New
    daily step `evidenceEnrich` (after `contentFromResearch`, before
    `factCheckQueue`): for each draft the drain converted THIS run
    (`conversion.converted === true`, at most maxArticlesPerDay = 1),
    call the existing `fetchArticleEvidence` (exported helper
    `enrichDraftEvidence(env, articleIds, { fetchImpl })`) so the
    fact-checker in the same run judges against full text, not the
    500-char RSS snippet. Only the recorded `article_sources` URL is
    fetched (the service's allowlist); robots.txt + publisher-terms
    compliance are enforced inside the service (Guardian URLs refuse
    with `terms-prohibit-ai-use` and keep the snippet — no workaround).
    A refusal or failure leaves the RSS evidence in place and never
    blocks the run (per-article try/catch in the helper; the step
    always returns outcome 'done'). Days with no new draft are a
    clean no-op (attempted: 0). A slug that already existed
    (`alreadyConverted`) is NOT enriched — it is an older draft, left
    to the manual article-fetch task. No new paid/keyed service; no
    change to which sources are allowed; +2 fetches per new draft
    (robots.txt + page) inside the main invocation's budget (drain 6
    RSS + SEO HEADs 4–6 + this 2 ≈ 12–14 + hops — comfortable now
    that the health report has its own invocation and the double-fetch
    is gone).
  - **NOT changed:** the 500-char `parseFeedXml` cap itself (raising
    it would not give full text — RSS summaries are short by nature;
    the fix is fetching the article, not widening the snippet);
    the duplicate comparator (still ALL articles — comparing only vs
    published would LOOSEN the 0% rule; that question goes to F6 as a
    proposal); any gate logic, publish path, article, setting,
    cron/schedule, OAuth flow, or the CSP header.
- Wording fixes (R2 bug, fail-closed, cosmetic):
  - `backend/publishing/gate.js`: the duplicate-zero-overlap detail
    now says "Highest 5-word shingle overlap with another article:
    X%" (was "another published article") in both the 0% and non-zero
    branches, and the section comment now states the comparator is
    every other non-archived article. The "No other published
    articles to compare against (0% overlap)." branch is UNCHANGED —
    with no other article at all, that statement is vacuously true,
    and the SEO suite's detail phrase it parses is deliberately kept
    (seo.js:490 comment; changing it would require changing the
    gate's parser too). Behaviour unchanged: the 0% rule still
    refuses on any overlap.
  - Stale `#31 -> #22` example (verified live: #31's body links no
    article, only the external Inside Higher Ed URL — read via the
    D1 helper 2026-11-24): removed the "(live #31 -> #22)" claim
    from the three present-tense comments
    (`divisions.js` module doc + `isInternalLinkRelevant` doc,
    `gate.js` internal-links comment). Deliberately LEFT:
    `seo.js:632` (past tense — "The old repair linked…" — a true
    historical statement) and `divisions.js:178` (hypothetical
    mechanism — "would otherwise pass" — no live claim).
- Files (exactly 4 paths vs the current tree; diff vs the fixpass4
  backup is F1's 6 + F2's 2 + these 4 + the 2 docs):
  `backend/routes/scheduler.js` (import; drain `research` summary;
  `summarizeDrainedResearch` + `enrichDraftEvidence` exports;
  `researchFetch` skip + counts; new `evidenceEnrich` step;
  `draftsConverted` passthrough; doc comment),
  `backend/publishing/gate.js` (duplicate wording + comment,
  internal-links comment), `backend/publishing/divisions.js` (two
  stale-example comments), NEW `tests/fixpass4-f3.test.js` (16 tests,
  suites F3.1–F3.5).
- Tests: before 1776/0 (455 suites, after F2) → after **1792/0 (460
  suites)**; parent re-ran the full suite: 1792/0 exact match. No test
  weakened. New tests: F3.1 `summarizeDrainedResearch` unit (6);
  F3.2 full-run skip + counts (2 — drain stores 12, inline skips
  both divisions, each feed URL fetched exactly once; partial-cover
  case fetches the uncovered division inline); F3.3 full-run enrich
  (2 — drain-converted draft gets 755-char full-text evidence,
  source re-pointed, fetch audited; no-draft day is a clean no-op);
  F3.4 helper fail-closed (3 — Guardian refusal keeps the snippet,
  fetch throw never escapes, invalid ids ignored); F3.5 wording (3 —
  0% and 6% vs a draft name "another article" and still refuse on
  6%; the pass case still passes with the old SEO phrasing).
  Two real defects caught by the tests during the build: the summary's
  `steps` map stores only `{ outcome, error }` (step results must be
  read from `agent_runs` detail — tests fixed, not the code), and the
  `queueDraftsConverted` always-0 bug above (code fixed).
- Negative control PASSED: with the three pre-change production files
  restored from the fixpass4 backup tarball, the new test file runs
  1 pass / 15 fail (exit 1); the single pass is F3.5's guard test
  ("pass case still passes with the old phrasing"), which correctly
  passes on both versions — it proves the wording fix did not break
  the pass path. Restored, re-ran: 16/16 + full suite 1792/0.
- Live proof still needed (parent): raw GET on the live site (home
  200, Worker health 200, sitemap 60 URLs); the deployed code
  containing `summarizeDrainedResearch` / `evidenceEnrich` /
  "another article". The BEHAVIOURAL proof can only be observed
  after the **25 Nov 00:00 UTC daily run**: the next report's
  `researchFetched`/`researchItemsStored` should equal what the drain
  stored (not 0), `rss_fetch_audit` should show each feed fetched
  once (no inline duplicate executions), `queueDraftsConverted`
  should read 1 on a day a draft converts, and a new draft's
  `article_sources` should point at an `article-fetch` research item
  with full-text evidence.
- Rollback: restore the 3 production files + delete
  `tests/fixpass4-f3.test.js` from the fixpass4 backup, redeploy.
  The old inline behaviour returns immediately (the drain's extra
  `research` field is ignored by old code).

- **DEPLOYED: run #75 GREEN (2026-11-24 12:21–12:24 Dhaka, 10 s),
  HEAD 8d2c204bbef8278cdcb0167847243d23f6f16b67, parent 94cb4a3 (F2),
  5 files +940/−16.** Squash worked (repo 104 → 103).
  https://github.com/mdalfahad841-code/fs-ai/actions/runs/45340073787
  Parent re-ran the suite: 1792/0 exact match.
- Live evidence (raw curl ~12:25 Dhaka): home 200; Worker health 200
  ok:true db connected; deployed `backend/routes/scheduler.js` at
  8d2c204 contains `evidenceEnrich`/`summarizeDrainedResearch` ×3;
  deployed `backend/publishing/gate.js` contains "overlap with
  another article" ×2 and the old "published article" phrasing ×0.
  Protected #26–#33, #34/#35 untouched (no live D1 writes in this
  pass so far).
- NOT TESTED live: the behavioural proof — only the 25 Nov 00:00 UTC
  daily run can show it (research counts ≠ 0, each feed fetched once
  in `rss_fetch_audit`, `queueDraftsConverted` reading 1 on a convert
  day, new drafts pointing at `article-fetch` evidence). A 25 Nov
  07:00 Dhaka verification is required (same check as F1).

## F4. INDEXNOW — BUILT, awaiting deploy

- Key (public by design — it lives in a public file, not a secret):
  `c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228`
  (64 hex chars, `openssl rand -hex 32`, 2026-11-24).
- Key file: `frontend/c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228.txt`
  (65 bytes: key + trailing newline, nothing else). It sits next to
  `frontend/sitemap.xml` — the copy Pages serves — so the live URL
  will be
  https://fs-ai-5w5.pages.dev/c7d67fb31e9d02bd8fbcaf6fbfbddc561fbc8838fe94d137939b4f19e7f2e228.txt
- Doc: `docs/indexnow-submit.md` (8,452 bytes) — what IndexNow is
  and is NOT (covers Bing + some other engines, NOT Google — stated
  plainly), the key + key file location, the exact one-off submit
  command with the full 60-URL list inlined, how to rebuild the list
  from the live sitemap, what success looks like (HTTP 200 =
  accepted, not indexed), and a SHORT auto-ping-on-publish proposal
  (proposal only — NOT implemented: publish-path helper, one URL per
  publish, ~5 s cap, failure must never block a publish).
- URL list: extracted from the live sitemap 2026-11-24 and verified —
  60 URLs, all on `fs-ai-5w5.pages.dev`, all unique (1 home + 9
  division + 25 article + 20 tool + 5 static). Extraction command in
  the doc. The sitemap itself was NOT changed.
- Files changed (exactly 3, all new): the key file above,
  `docs/indexnow-submit.md`, `tests/fixpass4-f4.test.js` (4 tests,
  following the existing frontend-file pattern —
  `fs.readFileSync(path.join(__dirname, '..', 'frontend', ...))` as
  in `tests/pages-headers.test.js` / `tests/indexing-canonical.test.js`).
  No gate, publish path, article, setting, cron/schedule, OAuth flow,
  CSP header or sitemap touched. No live D1 write. No deploy by the
  coordinator. Nothing submitted to IndexNow by the coordinator.
- Tests: before 1792/0 (460 suites, after F3) → after **1796/0
  (461 suites)**. No test weakened.
- Negative control: with the key file moved away, the new test file
  runs 2 pass / 2 fail (the exists + content tests fail; the key-format
  + doc-match tests pass, as they do not depend on the file); restored,
  4/4 pass.
- Diff vs the fixpass4 backup: F1 + F2 + F3 files + exactly these 3
  F4 files.
- Live proof still needed (parent): deploy → raw curl the key file
  live (must return exactly the key) → run the one-off submit ONCE
  from `docs/indexnow-submit.md` → record the HTTP status in the
  ledger. IndexNow's effect on Bing indexing is NOT observable
  immediately — mark it NOT TESTED / not yet available; re-check Bing
  Webmaster Tools after the F5 setup for any crawl/index movement.
- Rollback: delete the key file + `docs/indexnow-submit.md` +
  `tests/fixpass4-f4.test.js` and redeploy; no D1 change involved.
  (If the key is ever rotated, the key file AND the doc must change
  together — the test pins that they match.)

## F5. BING WEBMASTER STEPS — [PENDING]

## F6. GATE PROPOSALS — [PENDING]

## Final report — [PENDING]

## Final confirmation (to complete at the end)

- [ ] No protected article (#26–#31, #33) touched
- [ ] #34/#35 untouched (read-only)
- [ ] No auto-publish setting, Emergency Stop, schedule or cron changed
- [ ] No OAuth connection, no secret touched
- [ ] Nothing uploaded or published
- [ ] Live D1 writes: [list, or none]
