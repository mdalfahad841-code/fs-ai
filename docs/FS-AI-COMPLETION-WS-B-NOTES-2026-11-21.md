# FS AI — Completion Workstream B Notes: Queue Engine + Content Pipeline Audit

**Date:** 2026-11-21 (work done 14:12–15:05 Dhaka)
**Author:** Workstream B subagent (depth 2)
**Scope:** `backend/routes/scheduler.js`, `backend/services/healthcheck.js` (edit);
read-only audit of `backend/agents/autonomy-runner.js`, `backend/agents/autonomy/*.js`,
`backend/publishing/gate.js`, `backend/agents/autonomy/publishing.js`.
**Foundation:** `docs/FS-AI-FULL-AUTONOMOUS-IMPLEMENTATION-2026-11-21.md`
(§2.3 queue backlog, §2.4 weekly readiness, §3.1 W1 queue engine, §4.3 stale-lock
re-queue, §5 zero-failure design). Baseline suite 1106 pass / 0 fail (coordinator,
2026-11-21 14:10). Local tree is NOT a git repo; no commit history invented.
Backup `~/workspace/fs-ai-source/fs-ai-backup-20261121.tar.gz` untouched.
Live D1 access was SELECT-only throughout; nothing was written live, nothing
deployed/pushed, no browser, no publishing, no test posts, no OAuth.

## 0. Authorization override (owner, 2026-11-21 14:12) — recorded

Deploy is authorized TONIGHT, before the 2026-11-22 06:00 Dhaka weekly run — so
the weekly run fires on the NEW code (this supersedes the foundation report's
§14.1 "weekly runs on current deployed code"). This workstream did NOT
deploy/push/write live D1; the parent executes. Permanent restrictions
preserved in this work:

- $0 always; Workers AI only; no paid service/API/model/credits/subscription.
- NEVER publish #28/#29/#30/#31 without separate editorial authorization each
  (auto-publish evaluator refuses them by id unconditionally; gate.js:47).
- Health/Finance always need special human review — never auto-eligible.
- Never claim a social account connected or a post/video published without
  verification.
- Auto-publishing only for NEW articles passing EVERY gate, one-per-day limit
  + E-Stop preserved; existing drafts excluded.
- Never weaken a test or a quality/safety rule. Articles #26/#27/#31 untouched.

## 1. Headline verdicts

| Area | Verdict |
|---|---|
| Queue engine (leases, backoff, dead-letter, idempotency, terminal states, scheduling) | VERIFIED end to end, with 4 fixes applied inside owned files (see §5) |
| Stale-lock self-healing (§4.3) wired into the drain path | VERIFIED — via the daily/weekly workflows, not inside `drainTaskQueue` itself (documented boundary, pinned by test) |
| 12 queued tasks, live re-verification | UNCHANGED since the foundation report — all 12 still `queued`, attempts 0, `scheduled_for` NULL; 0 running |
| Pipeline stages (11 stages) | VERIFIED stage by stage, with 2 gaps found outside WS-B ownership (GAP WS-B-S1 social, GAP WS-B-D1 dependencies) + 2 minor observations |
| Weekly path on the NEW code | VERIFIED READ-ONLY (except the one sanctioned mutation: stale-lock recovery) + E-Stop + duplicate guard; see §4 |
| Drain draft persistence | GAP FOUND AND FIXED — a drained content task used to report `done` while no article ever appeared; the drain now persists LLM drafts as CMS drafts |
| Health-check backlog blindness | GAP FOUND AND FIXED — the 12-task / 6-day backlog used to report `healthy` |
| First-run prediction, 2026-11-22 00:00 UTC | Drain processes tasks 3,4,5,6,7,8,22,23,24,35 (oldest-first, cap 10); #36/#37 wait until 23 Nov. This REVERSES the foundation report §14.2 order claim — see §2.3 |

## 2. Queue engine audit — per item

Evidence key: `scheduler.js` = `backend/routes/scheduler.js`,
`healthcheck.js` = `backend/services/healthcheck.js`. Tests cited are in
`tests/queue-recovery-audit.test.js` (new, 15 tests) unless stated otherwise.

| # | Item | Verdict + evidence |
|---|---|---|
| Q1 | Task leases (10-min) | VERIFIED. `TASK_RUN_LEASE_MS = 10*60*1000` (scheduler.js:86). `runTask` races execution against the lease (`runWithLease`) and resolves status in `try/finally` — a run ends done/failed/skipped, never stuck `running` (scheduler.js:619+). Tests: `tests/task-timeout-phase4.test.js` (4), reliability scenario 1. |
| Q2 | Lease expiration | VERIFIED. `isTaskStale` (scheduler.js:220) measures `updated_at` age vs the lease; unparseable timestamps are never guessed stale. Caveat: staleness is measured on `updated_at`, stamped only at claim — a legitimately long (>10 min) run looks stale even while progressing, and the lease cannot abort an in-flight AI call (documented in the Phase 4 header comment). Test: stale-recovery tests. |
| Q3 | Stale-lock recovery (§4.3) wired in the drain path | VERIFIED, with a boundary. `recoverStaleTask` (scheduler.js:258) RE-QUEUES with exponential backoff while attempts remain (terminal RETRYING) and only goes `failed` + FAILED_FINAL_WITH_RECOVERY_REPORT when attempts are exhausted. Wiring: `runDailyWorkflow` calls `recoverStaleTasks` before the drain step (scheduler.js:1144, drain at :1163-1164), `runWeeklyWorkflow` likewise (:1443), and the dashboard endpoint `POST /api/autonomy/tasks/recover-stale` (orchestrator.js:442). `drainTaskQueue` itself does NOT call it — it only selects `status='queued'` — so a bare drain leaves a stale `running` task untouched. That is the documented boundary, pinned by test ("drainTaskQueue alone does NOT recover…"). The only caller of `drainTaskQueue` is `runDailyWorkflow`, so the wiring is complete in production. |
| Q4 | Retry policies | VERIFIED. `max_attempts` 3 (enqueue, scheduler.js:518; migration 005). A failed run with attempts left re-queues with backoff; a permanent error never re-queues (`isPermanentTaskError`, scheduler.js:137 — deliberately narrow: unknown agent / malformed payload only; missing article, failed fetch, LLM quota, handler errors are TEMPORARY). Tests: dead-letter (3 attempts), permanent-error (unknown agent → BLOCKED_WITH_REASON, attempts stay 1). |
| Q5 | Exponential backoff | VERIFIED. `backoffMinutesForAttempt` (scheduler.js:123): 15·2^(n-1) min, cap 240 (`DRAIN_BACKOFF_CAP_MINUTES`, :97). Used identically by the runTask failure path and by stale-lock recovery. Test: 15/30/60/120/240/240 for attempts 1/2/3/4/5/10. |
| Q6 | Dead-letter handling | VERIFIED. Exhausted retries → status `failed` + terminal `FAILED_FINAL_WITH_RECOVERY_REPORT` + `buildRecoveryReport` (scheduler.js:150) embedded in the final `agent_runs.detail` (task id, component, root cause, timestamp, retry history, recovery action, owner-action-required). The task is never auto-retried afterwards; only an explicit owner `retryTask` resets it (attempts 0, terminal cleared). Test: dead-letter test (3 attempts, report asserted). |
| Q7 | Idempotency | VERIFIED. `enqueueTask` checks `idempotency_key` first, returns the existing row as `duplicate: true`; the column is `UNIQUE` (migration 005:27) and the INSERT race falls back to re-read (scheduler.js:518-560). The claim is a single conditional `UPDATE … WHERE id=? AND status='queued'` — exactly one racer wins (scheduler.js, runTask claim). Auto-publish adds a conditional `UPDATE … AND status IN ('draft','approved')` plus a publication-logs idempotency guard (publishing.js). Test: duplicate-prevention test + reliability scenario 3. |
| Q8 | Task dependency handling | GAP (partial — no fix applied; see §6 GAP WS-B-D1). There is NO `depends_on` column, no dependency graph, no dependency check anywhere in the queue engine. Ordering is oldest-first by `created_at` plus kind-specific guards (content handler resolves evidence from stored research items; fact-check needs the article row). For the current queue this happens to work — research tasks were created (00:00:53) before content tasks (00:01:00) on the same day — but nothing enforces it. Severity: low for the 12 live tasks (research items 696/709 already exist), medium for future pipeline correctness. |
| Q9 | Duplicate task prevention | VERIFIED. Idempotency keys per (kind, division/item, date) in the daily workflow (`daily-research-{division}-{date}`, `daily-content-{item.id}-{date}`); UNIQUE constraint; content duplicate slug/title guard (content.js:247) + convert slug-clash 409. Tests: duplicate test; drain "already-converted" tests. |
| Q10 | Worker crash recovery | VERIFIED. `recoverStaleTasks` sweep (scheduler.js:306) + per-task recovery; runTask `try/finally` always resolves status; a second run on a fresh `running` task answers in-flight (202-shape), a stale one is recovered first. Tests: crash-recovery tests (lease expiry → re-queue → drain → done exactly once, incl. via the daily workflow) + reliability scenario 9. Residual risk (documented, not fixable in owned files): the lease resolves TASK state only — an abandoned in-flight handler can still write rows afterwards (e.g. a late content insert). Mitigated by the content duplicate guard + idempotent source inserts; no silent double-article is possible. |
| Q11 | Queue health monitoring | VERIFIED (after WS-B fix — was a GAP). `runHealthCheck` (healthcheck.js:311) runs 10 checks; the drain refuses to start only when overall is `blocked` (E-Stop ON / DB unreachable). The queue check NOW degrades when queued ≥ 10 (one drain run) or the oldest queued task is > 24 h old (healthcheck.js:151-193; constants :60-63). Before this fix the live 12-task / 6-day backlog reported `healthy` — the exact blindness that let the queue sit for 6 days. Degraded never blocks the drain. Test: backlog test (0 queued → healthy; 12 queued, oldest 6 d → degraded, overall not blocked). |
| Q12 | Task timeout handling | VERIFIED. `runWithLease` (scheduler.js, lease race) + 120 s per-model AI timeout in the LLM layer (Phase 4, outside WS-B scope — cited from the foundation report §6 scenario 1). A lease timeout resolves the run as `failed` with a clear reason and re-queues with backoff. Limitation: see Q10 residual risk. |
| Q13 | Terminal states | VERIFIED. Five states only (`TERMINAL_STATES`, scheduler.js) + `setTerminalState` (:175) with pre-020 no-op fallback (missing-column → false, never breaks runTask). Every runTask path sets one: done/no-op → COMPLETED; permanent → BLOCKED_WITH_REASON; exhausted → FAILED_FINAL_WITH_RECOVERY_REPORT; retryable failure → RETRYING; E-Stop skip → BLOCKED_WITH_REASON; paused agent → WAITING_FOR_AUTHORIZATION. LIVE CAVEAT: `terminal_state` columns do not exist in live D1 until migration 020 is applied (verified: live SELECT on the column 400s) — until deploy, terminal states are not persisted and only the legacy `status` column speaks. Observation: legacy status `skipped` is not one of the five states; E-Stop/pause skips set status `skipped` AND a terminal state, and a `skipped` task can never be retried via `retryTask` (only `failed` can) — the 5 live skipped tasks stay skipped forever by design, superseded by new daily tasks. |
| Q14 | Daily scheduling | VERIFIED. Single hourly cron `0 * * * *` (config/wrangler.toml:51) + 00:00 UTC guard (worker.js:196) + `runDailyWorkflow` duplicate guard on `daily_reports` kind=`daily` (force override only). No duplicate schedule exists (one wrangler config in the tree; `setInterval` in frontend autonomy.js is dashboard polling, not scheduling). |
| Q15 | Weekly scheduling | VERIFIED. Sunday guard `getUTCDay() === 0` inside the 00:00 UTC branch (worker.js:199) + `runWeeklyWorkflow` duplicate guard on kind=`weekly`. See §4 for the new-code read-only verification. |

### Fixes applied inside owned files (queue engine)

- **F1 — Drain now persists LLM drafts (scheduler.js:874 `convertContentDraft`, drain loop).**
  Root cause found by this audit: `runContentCreation` returns its draft ONLY in
  `agent_runs.detail`; the only caller of `convertScaffoldToDraft` was the MANUAL
  dashboard endpoint `POST /api/autonomy/scaffolds/:runId/convert`
  (orchestrator.js:1495). The drain therefore reported content tasks `done`
  while NO article ever appeared — the task's output sat un-persisted. The
  drain now converts a completed LLM draft (`outcome==='done'` +
  `scaffold.llmGenerated` + non-empty body) immediately after the task, records
  `{converted, articleId}` / `{alreadyConverted, articleId}` / `{error}` on the
  drain result, counts `draftsConverted` (returned by `drainTaskQueue` and in
  the daily summary as `queueDraftsConverted`), and writes an `agent_runs` audit
  row on conversion failure. A conversion failure never flips the already
  COMPLETED task and never stops the drain. `no-op` scaffolds (insufficient
  evidence, LLM unavailable, cap reached, duplicate topic) are NEVER converted
  — converting them would mint empty placeholder articles. Drafts are stored
  as status `draft`, `fact_checked` 0, never published. The manual convert
  endpoint remains as fallback. DELIBERATE BEHAVIOUR CHANGE for the parent to
  confirm at deploy: previously the drain created zero articles; from the
  first post-deploy drain it creates draft articles automatically.
- **F2 — Stale-recovery messages lied (scheduler.js).** `handleNonQueuedRun`
  said "recovered as failed. Retry it to run it again." and the drain's
  recovered-stale reason said the same — false since §4.3: the task is
  RE-QUEUED with backoff and runs automatically. Both messages now say so;
  the Phase 4 header comment (which still described "marked failed") was
  corrected too. Test pins the new wording.
- **F3 — Health queue check blind to backlogs (healthcheck.js:151-193).** See Q11.
- **F4 — Dead code removed:** `failed += 0;` in the drain's runTask-refusal
  branch (scheduler.js).
- **F5 — Stale comment fixed:** `socialCheck` claimed "no social integration
  tables exist in this codebase"; migration 022 creates them and the code
  already queries them. Comment corrected (no behaviour change).

### Observations (no fix applied)

- **O1 — Drain LIMIT is fetched before no-handler/cap filtering** (scheduler.js:
  drain selects `LIMIT 10` rows, then skips no-handler / cap-reached tasks).
  A skipped task consumes a drain slot, so eligible tasks behind it wait for
  the next run. Minor; the current 12-task queue has no no-handler tasks.
  Proposed patch in §6.
- **O2 — Two different "articles created today" definitions.** The drain's
  `countArticlesCreatedToday` (scheduler.js) counts ALL articles with
  `date(created_at)=date('now')`; the handler's `articlesCreatedToday`
  (content.js) excludes articles published on an earlier date. On a fresh
  seed DB the drain skips EVERY content task (25 ≥ 1) while the handler would
  allow generation. Live impact is nil (live articles carry real `created_at`
  dates), but the definitions should be aligned. Proposed patch in §6.
- **O3 — Drain ignores the `priority` column** (write-only in the drain path;
  order is strictly oldest-first). See §2.3.

## 3. Live 12-task re-verification (SELECT-only, 2026-11-21 ~14:15 Dhaka)

Re-queried live D1 with the exact ids from foundation report §2.3. Result:
**NO CHANGE since the report.** All 12 still `queued`, attempts 0,
`max_attempts` 3, `scheduled_for` NULL.

| id | agent | kind | created_at (UTC) | idempotency_key |
|---|---|---|---|---|
| 3 | research | daily-research | 2026-11-15T00:00:54 | daily-research-digital-tools-2026-11-15 |
| 4 | research | daily-research | 2026-11-15T00:00:55 | daily-research-education-learning-2026-11-15 |
| 5 | research | daily-research | 2026-11-16T00:00:53 | daily-research-digital-tools-2026-11-16 |
| 6 | research | daily-research | 2026-11-16T00:00:53 | daily-research-education-learning-2026-11-16 |
| 7 | research | daily-research | 2026-11-17T00:00:52 | daily-research-digital-tools-2026-11-17 |
| 8 | research | daily-research | 2026-11-17T00:00:52 | daily-research-education-learning-2026-11-17 |
| 22 | research | daily-research | 2026-11-20T00:00:53 | daily-research-digital-tools-2026-11-20 |
| 23 | research | daily-research | 2026-11-20T00:00:54 | daily-research-education-learning-2026-11-20 |
| 24 | content-creation | daily-content | 2026-11-20T00:01:00 | daily-content-696-2026-11-20 |
| 35 | research | daily-research | 2026-11-21T00:00:55 | daily-research-digital-tools-2026-11-21 |
| 36 | research | daily-research | 2026-11-21T00:00:56 | daily-research-education-learning-2026-11-21 |
| 37 | content-creation | daily-content | 2026-11-21T00:01:11 | daily-content-709-2026-11-21 |

Live totals confirmed in the same pass: `done` 19, `failed` 1, `queued` 12,
`skipped` 5 (total 37); 0 tasks `running`. Live flags: `publishing_mode`
approved_only, `auto_publishing` off, `auto_correction` off, `auto_research` /
`auto_generation` / `auto_factcheck` on, `max_articles_per_day` 1,
Emergency Stop OFF (`website_settings.emergency_stop='0'`). Published still 25.
#26/#27 draft, `updated_at` 2026-11-19T18:53:30/32Z — unchanged. #31 draft,
`updated_at` 2026-11-21T01:19:10Z — unchanged. No `daily_reports` row dated
≥ 2026-11-22 (weekly run not yet fired; latest is daily id 11, 2026-11-21).
Migration state live (probed by SELECT): `terminal_state` column absent
(migration 020 not applied), `publication_logs` absent (021 not applied);
same 400-pattern for the 022/023 tables is consistent with not applied
(they were not probed individually by table name — see §7).

### 3.1 Safe processing order — CORRECTION to the foundation report

The §2.3 "proposed safe processing order" (#37 first, #35/#36 smoke test, #24
next day, #22/#23/#3–#8 superseded — leave queued) is a MANUAL order. The
implemented drain does not follow it: it is strictly oldest-first with a cap
of 10 per run and ignores `priority`. What the code will actually do at the
first post-deploy drain (2026-11-22 00:00 UTC, assuming E-Stop stays OFF and
the health check does not block):

- Run 1 (22 Nov): tasks **3, 4, 5, 6, 7, 8, 22, 23, 24, 35** — 8 research +
  #24 content + #35 research. #24 runs because the content cap counts
  articles created that UTC day (0 at 00:00 UTC). If Workers AI + research
  item 696 resolve, #24 becomes a draft article via the new drain conversion.
- Tasks **36, 37 stay queued** until the 23 Nov drain (alongside the new
  tasks the 22 Nov daily run enqueues after its drain).
- #22/#23/#3–#8 are NOT superseded by the code — they run as ordinary
  research tasks (fetch RSS, store new items, dedupe vs existing articles).
  Leaving them queued would require a manual decision + a code/DB change;
  this workstream does not recommend deleting them (history is never deleted).

This also corrects foundation report **§14.2**, which states "#24 waits until
the next day after #37" — the code does the reverse (#24 on 22 Nov, #37 on
23 Nov). The §14.2 sentence does not match the implemented drain order.
Whether #37-first is actually wanted is a parent decision: it would need a
priority-aware drain (proposed patch in §6, NOT applied — changing drain
order the night before deploy was judged riskier than reporting it).

## 4. Pipeline stage map (stage-by-stage verification)

Statuses used: SUCCESS (stage verifies its own result), FAILED (stage reports
failure honestly), PENDING, REQUIRES_REVIEW, BLOCKED, RETRYING, UNAVAILABLE.
"Outcome" is the handler's returned outcome; "verdict" is the domain verdict
(fact-check/SEO/gate) — the two are distinct by design and both must be read.
Tests: `tests/pipeline-stages.test.js` (24 tests, all pass).

| Stage | Real function / file | Input validation | Output validation | Error handling | Audit logging | Retry | Explicit status | Recovery | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Research | `runResearch`, autonomy/research.js:41 | Division must exist in D1; ad-hoc sources filtered to strings | Candidates deduped vs articles + stored items; outdated flagged, never proposed | Per-source fetch errors collected; all-failed → honest no-op with `fetchErrors`; D1 read failure → failed | `agent_runs` + `agent_logs` via runTask | Task-level backoff | done / no-op / failed | Re-run task; stored items deduped | SUCCESS — honest statuses. Observation: with no DB bound it reports no-op "No RSS source configured" (d1All returns null instead of throwing) — unreachable in production (runTask 503s first). |
| Evidence | `resolveEvidence`, autonomy/content.js:123 | http(s) URLs only, deduped | Resolved rows carry `researchItemId` + match method; unresolved listed by URL | Bad URL → unresolved, never throws | In run detail (`evidence`, `unresolved`) | Task-level | resolved / unresolved lists | Re-fetch via research task | SUCCESS |
| Draft | `runContentCreation`, autonomy/content.js:233 | Title ≥5 chars; valid division slug; division must exist; duplicate slug/title → no-op | LLM draft returned with provider/model + `needsFactCheck`; no body fabricated when LLM unavailable (scaffold only, no-op); generated body ALSO checked against existing articles by a cross-draft duplicate guard (shingle overlap; duplicate → honest no-op `duplicate-content`, near-duplicate allowed but flagged — added concurrently by workstream A, content.js:374; WS-B tests pass under it) | No evidence → no-op `insufficient-evidence`, no article written; LLM down → no-op, no fabrication; truncated generation → no-op `truncated-generation` | Run detail holds scaffold/draft | Task-level backoff | done / no-op / failed | Re-run; duplicate guard | SUCCESS after WS-B fix F1 — persistence was manual-only (GAP, fixed in drain). |
| Fact-check | `checkArticle`, autonomy/factcheck.js:469; `runFactChecking`, :1577 | article_id valid; article must exist | Claims ≤20 extracted; deterministic + LLM judge; verdict pass/needs-review/failed; `body_hash` stored (migration 019) with 3-level insert fallback (hash-less row → gate treats as stale, fail-closed) | Scaffold body → verdict failed (checker correct); missing article → failed | `fact_checks` + `claim_checks` rows | Task-level; re-check writes a NEW row (verified) | outcome done = "check completed"; verdict carries pass/fail — consumers must read verdict (gate does) | Fresh re-check | SUCCESS |
| Correction | `runCorrection`, autonomy/factcheck.js:1304 | `validateCorrectedBody` (para-idx dedup key, trailing-citation strip); `detectTruncatedBody` guard before validation | Corrected body validated before save; truncated output fails as `truncated-correction`, retryable, nothing saved | Validation rejection → outcome `failed` with recovery report + retryable flag (W2 honest-failure fix — the old `done`-on-rejection lie is gone) | `article_corrections` + correction-recheck `fact_checks` row | Retryable vs permanent distinguished (permanent → BLOCKED_WITH_REASON) | failed / done, with recovery report | Re-run / owner review | SUCCESS. Minor observation: `runCorrection` assumes a non-null article (direct null call throws a raw TypeError at factcheck.js:1387); its only caller (`runFactChecking`) validates first, and `runAutonomyTask` catches throws as `failed` — never silent. |
| Re-check | `runFactChecking` with `check_kind:'recheck'`, autonomy/factcheck.js:1577 | Same as fact-check; re-check payload always runs a real check even on a kind=`correct` task row | New `fact_checks` row written (verified: row count +1) | Same as fact-check | New row with `check_kind='recheck'` | Task-level | done + verdict | Fresh check | SUCCESS |
| SEO | `runSeo`, autonomy/seo.js:423; `runSeoCheckSuite`, :159 | article_id valid; article must exist | 11-check suite; result stored with `body_hash` + `body_length` (migration 023); repair-then-measure | Missing article → failed; repair uses the article's own content only | `seo_checks` + `article_revisions` rows | Task-level | done + verdict + seoCheckId | Re-run | SUCCESS. NOTE: workstream A is concurrently changing the Related-reading repair to genuine-relevance-only (seo.js:628-677, 784) — the old test expectation in `tests/autonomy-scheduler.test.js` ("#28 got the Related reading link") now fails; see §8. |
| Quality Gate | `evaluatePublishGate`, publishing/gate.js:67 | article id valid; article must exist; already-published refused | Fact-check must be PASS *and* fresh (missing hash = stale, fail-closed); sources need a real URL; SEO freshness with 5 s grace; daily limit on the Dhaka day | Every refusal names its blockers in `blockedBy` | Gate result in run detail / dashboard draft gates | N/A (pure evaluation) | eligible true/false + `blockedBy` + `contentReady` | Fresh fact-check / SEO, then re-evaluate | SUCCESS — verified: no fact-check → refused; body edited after check → stale → refused. |
| Approval | `evaluateAutoPublishEligibilityPure`, publishing/gate.js:380 (+ D1 wrapper :670) | 14 checks incl. new-article-only, legacy-id refusal, protected check, banner strip, idempotency log | Health/Finance ALWAYS fail special-review; advice claims need an authoritative URL; internal links must be genuinely relevant | Temporary vs permanent error kinds distinguished; failure alerts carry owner-action flag | `publication_logs` refusals logged | N/A | eligible + verdict + `blockedBy` + `errorKind` | Owner action / new article | SUCCESS — verified: #28–#31 refused by id; Health refused even with all other checks passing. |
| Publication | `autoPublishArticle`, autonomy/publishing.js:176; `runAutoPublish`, :339; `publishDueArticles`, routes/admin-articles.js | Pre-flights: logs table exists (else BLOCKED, nothing published), article exists, full eligibility, protected, banner strip, idempotency | ONE conditional UPDATE (concurrent double-fire cannot publish twice); rollback restores status/body/`updated_at` EXACTLY (coordinator fix §4.2); sitemap regenerated | Any failure after the flip rolls back and reports failure; log write failure refuses/rolls back instead of silently succeeding | `publication_logs` (append-only) + run detail | `runAutoPublish` tries candidates oldest-first, one publish per run | published / refused / blocked / no-op | Retry after rollback (SEO stays fresh because `updated_at` is restored) | SUCCESS — verified: fail-closed without migration 021; no-op while `approved_only`. NOTE: the `sitemapUpdated` flag means the regenerated XML includes the article; the SERVED sitemap file catches up at the next deploy via `npm run sitemap` (§7). |
| Analytics | `runAnalytics`, autonomy/analytics.js:12 | DB bound check | Latest `website_analytics` row used ONLY when `source != 'none'` | No source → honest no-op with reason; revenue $0.00, traffic "Data unavailable" (no `traffic` field on the handler result — that lives in the daily report summary) | Run detail | Task-level | done / no-op | Connect a real source (GA4 Data API) | SUCCESS |

### Stages that report success without verifying their result

- **GAP WS-B-S1 — Social pack stage** (`runSocialMedia`, autonomy/social.js:43):
  returns `outcome: 'done'` even when EVERY per-platform draft-post store fails
  (e.g. migration 022 tables missing — every `createPost` throws, caught per
  platform, recorded as `draftPosts[].ok:false` with the error). The pack text
  itself is honest ("nothing was posted"), but the top-level outcome overstates
  a fully failed persistence. Pinned by test (current behaviour asserted with
  a GAP comment). Proposed patch in §6. The unpublished-article path is honest
  (no-op).
- No other stage was found to report success without verifying its result.
  The old correction `done`-on-rejection lie is gone (W2 fix, verified by
  `tests/factcheck-correction-validation.test.js` + this audit's truncation
  test). The old SEO "snapshot before repair" staleness cause is fixed (W2).

## 5. Weekly readiness — re-verified EXPLICITLY on the NEW code

The weekly run fires 2026-11-22 06:00 Dhaka (00:00 UTC Sunday) on the NEW
code (authorization override 14:12). Verified in code + tests:

- **Weekly function is read-only** (`runWeeklyWorkflow`, scheduler.js:1434):
  only SELECTs + one `daily_reports` upsert + one `agent_runs` row
  (`writeRun`, step `weekly-report`). NO publish, NO enqueue, NO article
  UPDATE, NO LLM call. Verified by code read AND by test (weekly isolation
  test: articles byte-identical, task count unchanged, fact_checks/seo_checks
  counts unchanged, exactly one weekly row, no AI binding present).
- **The ONE sanctioned exception — stale-lock recovery.** The weekly run
  calls `recoverStaleTasks` first (same as the daily run; pre-dates W1). Under
  the new §4.3 behaviour a stale `running` task is RE-QUEUED with backoff
  (not left `failed`). So the weekly run CAN mutate `agent_tasks` rows — but
  only stale `running` ones, only into `queued` + RETRYING. Live right now
  there are 0 `running` tasks, so the 22 Nov weekly recovery is expected to
  be a no-op. Pinned by the weekly isolation test.
- **Weekly does NOT drain.** Queued tasks stay queued through the weekly run;
  the drain lives only in the daily workflow. Pinned by test.
- **E-Stop behaviour (weekly):** `getEmergencyStop` first — ON → `logSkip` +
  return `{skipped:true}` with NO report row written. Verified in code and by
  existing `tests/weekly-workflow.test.js` (E-Stop test).
- **Duplicate guard (weekly):** `daily_reports` kind=`weekly` + date, unless
  `force:true`; a second run the same day returns `duplicate:true` with the
  same `reportId` and writes no new row. Verified in code + existing tests +
  WS-B weekly test. OPERATIONAL NOTE: do NOT manually run the weekly workflow
  (dashboard or API) before 06:00 on 22 Nov — a manual run writes today's
  weekly row and the scheduled run would then no-op as a duplicate.
- **00:00 UTC invocation order (worker.js:184-207):** `publishDueArticles`
  first, then `runDailyWorkflow` (which drains + may auto-publish), THEN
  `runWeeklyWorkflow` on Sundays. So the weekly REPORT reflects the drain's
  effects (new drafts, task outcomes) — the weekly function itself stays
  read-only. The daily and weekly duplicate guards use different `kind`
  values, so the daily run never blocks the weekly run.
- **Schedule unchanged:** single hourly cron `0 * * * *`
  (config/wrangler.toml:51); no duplicate schedule in the tree (one wrangler
  config; the only other timers are dashboard polling `setInterval` in
  frontend autonomy.js and the 10-min lease `setTimeout` in scheduler.js).
- **Named-export trap STILL PRESENT (unchanged, not a live defect):**
  `backend/worker.js:211` exports a named `scheduled()` that runs ONLY
  `publishDueArticles`; `src/index.js:18` re-exports it; production cron uses
  the default export's `scheduled` (proven live). If anything ever wires the
  named export to the cron, daily/weekly silently stop. Do not rewire it.
- **Expected 22 Nov 00:00 UTC sequence (new code):** publishDue → daily
  (drain 10 tasks incl. #24 content → draft article via F1; enqueue 2
  research + 1 content for 22 Nov; inline fact-checks ×3; inline SEO ×3;
  gate evaluation, no approvals while `approved_only`; autoPublish no-op) →
  weekly (report row; stale recovery expected no-op; queue grows by ~3
  enqueued rows to ~15 total: 2 left from the backlog + new enqueues, minus
  drained dones). Published stays 25; #26/#27/#31 unchanged.

## 6. Tests — evidence

New files (isolated test DBs, mocked/stubbed external APIs — Workers AI
stubbed via `env.AI`, no network, no live D1):

- `tests/queue-recovery-audit.test.js` — 15 tests, all pass:
  backoff math; lease expiry → re-queue → drain → done exactly once;
  stale-recovery message honesty; bare-drain boundary (no recovery inside
  `drainTaskQueue`); daily-workflow crash wiring (§4.3); duplicate prevention
  (+ UNIQUE constraint check); dead-letter terminal state + recovery report;
  permanent-error no-retry; health backlog degradation; drain draft
  conversion (LLM draft → CMS draft, never published, `fact_checked` 0,
  sources recorded); no-op scaffold never converted; duplicate slug never
  duplicated (+ direct `convertContentDraft` already-converted check);
  weekly isolation (stale re-queue, no drain/enqueue/article change/no LLM)
  + weekly duplicate guard.
- `tests/pipeline-stages.test.js` — 24 tests, all pass: per-stage validation
  + honest status + failure propagation for all 11 stages (see §4 table),
  incl. gate staleness fail-closed, legacy-id refusal, Health special-review,
  auto-publish fail-closed without migration 021, runAutoPublish no-op while
  `approved_only`, and the social GAP WS-B-S1 pin.

Regression runs on the current tree (after my edits):
- My 2 new files + `queue-drain`, `task-lifecycle`, `healthcheck`,
  `task-timeout-phase4`, `reliability-acceptance`, `weekly-workflow`:
  **131 pass / 0 fail**, run twice consecutively with the same result
  (final runs 2026-11-21 ~15:05 Dhaka).
- Earlier: `queue-drain` + `task-lifecycle` + `healthcheck` 45/45;
  `task-timeout-phase4` + `reliability-acceptance` + `autonomy-scheduler`
  46/46 at that time (see §9 — the autonomy-scheduler file has since gained
  1 failure from workstream A's concurrent seo.js change, not from WS-B).
- `node --check` clean on both changed JS files. No `package.json` change.
  No new migrations. Full suite NOT run (other workstreams are running
  concurrently; the parent runs the merged full suite).

## 7. Gaps + proposed patches (files outside WS-B ownership — NOT edited)

- **GAP WS-B-D1 — No task dependency handling (Q8).** No `depends_on`,
  no dependency graph. Proposed patch (scheduler.js is WS-B-owned, but this
  is a design change — parent decision): order the drain by kind-priority
  first, then `created_at`, e.g.
  `ORDER BY CASE agent WHEN 'research' THEN 0 WHEN 'content-creation' THEN 1
  WHEN 'fact-checking' THEN 2 WHEN 'seo' THEN 3 ELSE 4 END, created_at ASC,
  id ASC` — research before content before fact-check before SEO — which also
  makes #37 run before older research tasks only if its kind outranks them
  (it does not under this ordering; a pure priority ordering
  `ORDER BY priority DESC, created_at ASC` would run #37 first instead).
  Alternatively add a `depends_on` column (new migration — NOT proposed
  lightly the night before deploy). Left as a reported gap.
- **GAP WS-B-S1 — Social pack reports `done` when all draft stores fail**
  (autonomy/social.js `runSocialMedia`, ~end of function). Proposed patch:
  after the per-platform loop, if every `draftPosts` entry is `ok:false`,
  return `{ outcome: 'failed', error: 'No social draft could be stored: …',
  draftPosts }` (or `no-op` with the reason); if some succeed, return `done`
  with a `warnings` list naming the failed platforms. Do not change the
  "draft only, never a publish" behaviour.
- **O1 — Drain LIMIT before filtering** (scheduler.js, WS-B-owned but a
  behaviour tweak — not applied): fetch `LIMIT maxTasks + skipped` rows or
  loop until `maxTasks` eligible tasks are collected, so no-handler /
  cap-skipped tasks stop consuming drain slots.
- **O2 — Align the two "created today" counts** (scheduler.js
  `countArticlesCreatedToday` vs content.js `articlesCreatedToday`): make the
  drain use the handler's rule (created today AND not already published on an
  earlier date), so a seed/bulk-import day cannot block content tasks in the
  drain while the handler would allow them.
- **O3 — Stale comments outside ownership:** orchestrator.js `handleRecoverStale`
  comment still says recovered tasks are "marked failed … and become
  retryable" (now re-queued automatically); same wording in the `handleCancelTask`
  area is fine (cancel genuinely lands in `failed`). Proposed patch: update
  the `handleRecoverStale` doc comment to the re-queue behaviour.
- **Observation — `runCorrection` null-article TypeError** (factcheck.js:1387):
  add a guard at the top of `runCorrection` returning
  `{ outcome: 'failed', error: 'Correction needs a valid article.' }` when
  `!article`. Unreachable via the task path today (only caller validates
  first); hardening only.
- **NOT a WS-B gap — workstream A in progress:** seo.js genuine-relevance
  Related-reading repair (see §8). No patch proposed by WS-B.

## 8. Deployment procedure inputs (for the parent — WS-B area)

### 8.1 Migrations — verified, ordered, do NOT re-run the full script

- Files 020–023 exist in `database/migrations/` and were verified by WS-B
  to apply cleanly, in order, on a scratch SQLite DB built from
  `database/schema.sql` + 005/006/008/009/010/011/012 (sqlite3 CLI,
  2026-11-21; all four exit 0; afterwards `system_health_checks`,
  `publication_logs`, `social_accounts`, `social_posts`, `social_analytics`
  exist; `agent_tasks` gains `terminal_state`/`terminal_reason`/`last_error`;
  `seo_checks` gains `body_hash`/`body_length`).
- Migrations 001–019 are ALREADY live — apply ONLY 020–023, in order
  (foundation report §12 step 2). Exact commands (parent runs):
  ```
  npx wrangler d1 execute fs-ai-db --file=database/migrations/020_task_lifecycle_health.sql
  npx wrangler d1 execute fs-ai-db --file=database/migrations/021_publication_logs.sql
  npx wrangler d1 execute fs-ai-db --file=database/migrations/022_social_media.sql
  npx wrangler d1 execute fs-ai-db --file=database/migrations/023_seo_body_hash.sql
  ```
  Do NOT run full `npm run db:migrate` against live D1 — it re-runs 001–019
  and the `ADD COLUMN` statements would fail as duplicates on already-applied
  migrations. (The `db:migrate` script itself is unchanged by WS-B.)
- Verify each after applying (SELECT-only): `SELECT COUNT(*) FROM
  publication_logs`, `social_accounts`, `social_posts`,
  `system_health_checks` must succeed (0 rows is fine); `agent_tasks`
  must expose `terminal_state` (pre-deploy this probe 400s — expected).

### 8.2 Secrets — WS-B area needs NONE

- Queue/health need no new Worker secret. The only secret in this build is
  W4's `SOCIAL_TOKEN_SECRET` (token encryption fails closed without it).
  Set before any social use (parent runs; value comes from the owner via the
  secure flow, never in chat):
  ```
  npx wrangler secret put SOCIAL_TOKEN_SECRET --config config/wrangler.toml
  ```
  (Flag form follows the deploy command `npx wrangler deploy --config
  config/wrangler.toml`; confirm the flag when running.) No other env vars
  for WS-B. The Cloudflare API token path for D1 is the parent's existing
  connection (used read-only by WS-B via `d1_query.py`).

### 8.3 Deploy order (per foundation report §12, as it affects WS-B)

1. Push via the established zip workflow (parent; base e5f7aa3; flatten
   `fs-ai/` before any content check). Pages auto-deploys on push to main.
2. Apply migrations 020–023 (§8.1) and verify.
3. Set `SOCIAL_TOKEN_SECRET` (§8.2).
4. Run `npm run sitemap` before every deploy that follows a publish, so the
   served sitemap includes D1-only articles.
5. Verify live (§8.5). Do NOT enable auto-publishing at deploy time (three
   deliberate owner actions, §13.1 of the foundation report, separate decision).

### 8.4 Rollback notes (WS-B area)

- Code rollback: redeploy the previous Pages deployment (e5f7aa3) — the
  Worker is stateless; no WS-B code change needs a data rollback.
- Migrations 020–023 are additive-only (new columns, all NULL by default;
  new tables). NO down-migration is needed: the old code tolerates the new
  schema — verified fallbacks: `setTerminalState` no-ops on missing columns;
  `runHealthCheck` persists best-effort; SEO insert falls back to the
  3-column form; fact-check insert falls back down its column lists.
- State created by the new code persists across a rollback and is safe to
  leave: drained tasks keep their new statuses/terminal states; draft
  articles created by the drain conversion are status `draft`,
  `fact_checked` 0, never published. If unwanted, delete ONLY those new
  draft rows via D1 — never delete #26/#27/#31, any published article, or
  any `agent_runs`/`agent_logs` history.
- Emergency brake: Emergency Stop ON (dashboard → `website_settings`
  emergency_stop='1') halts the daily workflow, the weekly workflow, the
  drain and auto-publish immediately (checked first in both workflows and in
  the drain's health gate).

### 8.5 Post-deploy verification steps (WS-B area — parent runs)

1. Migrations: §8.1 probes succeed; `agent_tasks.terminal_state` readable.
2. Routes: `GET /api/health/latest` responds; `queue` check shows the live
   queued count; expect `degraded` while the backlog is ≥10 or the oldest
   queued task is >24 h old, clearing as the drain works. `/api/social/status`
   shows `connected: false` everywhere until OAuth (W4).
3. Settings unchanged: `publishing_mode` approved_only, `auto_publishing`
   off, `auto_correction` off, `auto_research`/`auto_generation`/
   `auto_factcheck` on, `max_articles_per_day` 1, E-Stop OFF, revenue $0.00.
4. After the first 00:00 UTC run (2026-11-22 06:00 Dhaka): `daily_reports`
   rows for 2026-11-22, kinds `daily` AND `weekly`; published still 25;
   #26/#27/#31 unchanged (values in §3); queue: tasks 3–8, 22–24, 35 `done`,
   36/37 still `queued`; a NEW draft article exists from #24 (research item
   696) with `fact_checked` 0; no task stuck `running`; `agent_runs` holds
   the drain step detail incl. `draftsConverted`.
5. First live drain result and any failure: record per foundation report
   §15.4 (parent fills in).

## 9. Incidents / observations during this workstream

- **Transient cross-workstream breakage (NOT caused by WS-B, self-resolved).**
  At 2026-11-21 08:21:02 UTC, `backend/agents/autonomy/seo.js` was modified
  by a concurrent workstream (Workstream A — its comment is in the file) with
  a wrong import (`../publishing/divisions.js`, resolving to the nonexistent
  `backend/agents/publishing/divisions.js`). For ~53 seconds the whole backend
  could not load (`scheduler.js` → `autonomy-runner.js` → `seo.js`), which
  broke every test that loads the scheduler. At 08:21:55 UTC the same
  workstream corrected the import to `../../publishing/divisions.js` and the
  tree loaded again. WS-B took no action on the file (outside ownership) and
  re-ran its tests green afterwards. Lesson for the parent: parallel
  workstreams share one tree — a mid-edit broken state in one stream fails
  every other stream's tests until it is fixed; judge a failure by which file
  changed, not by which suite went red.
- **One existing-test failure attributable to workstream A's in-progress
  change (NOT WS-B).** `tests/autonomy-scheduler.test.js`: "seoRun skips
  #26/#27 … and repairs #28" — assertion "#28 got the Related reading link"
  now fails because A's seo.js repair appends a Related-reading link ONLY to
  a genuinely relevant sibling (seo.js:628-677, 784: "never an unrelated
  one"), and the fixture's #28 has no topically-relevant published sibling.
  This is the follow-up fix the foundation report §14.4 explicitly left open
  ("SEO repair can still create a misleading Related reading link … A
  follow-up fix in seo.js is the remaining item"). WS-B's files cannot change
  `repairSeoFields` link selection, and the drain is a no-op in that fixture
  (no queued tasks, no AI). The stale test expectation belongs to workstream A
  / the coordinator to update. WS-B did not touch the test or seo.js.
- **Two transient test failures from concurrent editing (NOT a defect).**
  During the final verification run (~08:30 UTC), 2 of WS-B's own tests
  failed with content creation returning `no-op` instead of `done`
  (`tests/pipeline-stages.test.js` draft test,
  `tests/queue-recovery-audit.test.js` drain-convert test) — at the exact
  minute another workstream was overwriting `backend/agents/autonomy/content.js`
  (mtime 08:28:51 UTC; new cross-draft duplicate guard + truncated-generation
  guard landed in that edit). Each failing test passed in isolation, and the
  full files passed 24/24 three times and the combined set 131/131 twice
  afterwards with no WS-B change. Cause assessed as a mid-write inconsistent
  read of a concurrently edited file, not a code defect. No action taken.
  (The duplicate guard itself is real and now documented in the §4 Draft row.)
- **Two D1 read attempts 400'd before succeeding** — the cause was WS-B's own
  queries referencing not-yet-applied columns/tables (`terminal_state`,
  `publication_logs`). Not a live defect; the 400s are themselves evidence
  that migrations 020–023 are not yet live.

## 10. What is blocked, and by exactly what

- **Deploy itself** — blocked on the parent executing it (WS-B must not
  deploy/push/write live D1). Everything WS-B owns is ready: code fixed +
  tested (39 new tests green, 131/131 in the final combined run).
- **First live proof** — the first live drain, the first live weekly run on
  new code, and any live auto-publish decision can only be verified AFTER
  deploy + the 22 Nov 06:00 run. Local tests prove the failure paths exist
  and behave; they do not prove live Worker/D1 behaviour.
- **GAP WS-B-S1 (social outcome overstatement) and GAP WS-B-D1 (no task
  dependencies)** — blocked on the owning workstreams / parent decision;
  exact proposed patches are in §7. Neither blocks deploy (social packs are
  draft-only; dependencies are not load-bearing for the current queue).
- **`tests/autonomy-scheduler.test.js` 1 failure** — blocked on workstream A
  (or the coordinator) updating the stale "#28 got the Related reading link"
  expectation to match A's genuine-relevance repair (§9).
- **#29 regeneration + #30 re-check** — parent dashboard steps per foundation
  report §11 (NOT WS-B work; do not run before deploy + migration 023).
- **Auto-publish enablement, social OAuth, per-article authorization
  (#28–#31)** — owner decisions, unchanged by WS-B.
