# FS AI — Phase 4 Repair Notes (implementation phase, local only)

**Date:** 2026-11-20
**Starting commit:** de3654f (Phase 3 final report commit; Phase 3 deploy was 303f89c)
**Scope:** implementation only. No deploy, no push, no live browser work, no live D1 writes, no Article #31 creation, no task #32 attempt, no weekly workflow run. The parent deploys and runs the live #31 E2E afterwards. The parent also does the Search Console retry (separate track, owner-authorized 2026-11-20 18:34 "koro sob" — NOT part of this implementation).

**Full-suite result:** `npm test` → **858 tests pass / 0 fail / 200 suites** (baseline 839 + 19 new; exit 0, run 2026-11-20 after all edits). The 1 new test file holds 19 tests; 1 pre-existing test was updated to the intended new behaviour (see "Updated pre-existing test" below — equal-or-stronger, with diff reasoning).

**Live D1 state:** untouched by this implementation (no live writes were made). Task #32 remains `queued`, attempts 2/3 — its last attempt is NOT spent here. Task #31 remains `failed`, attempts 0 (parent reset).

**Flags unchanged:** auto_research ON, auto_generation ON, auto_factcheck ON, auto_correction **OFF**, auto_publishing **OFF**, publishing_mode `approved_only`, social OFF. Emergency Stop ends OFF. Workers AI is the only LLM provider; $0 added cost. Gate verdict logic untouched. #26/#27 untouched (no test uses their ids).

**No migration needed for Phase 4.** The fix uses only the existing `agent_tasks.status` / `updated_at` columns and `agent_runs` rows; cancel lands in the existing `'failed'` status (the CHECK constraint allows only queued/running/done/failed/skipped — there is no `'cancelled'` status, by design, so a cancelled task stays retryable through the existing retry endpoint).

---

## The failure (Phase 3 report §F, verified live 2026-11-20)

A long synchronous manual run dies mid-flight after ~4-5 minutes with no error, no save, no `agent_runs` row, and the task left `'running'` forever. Workers AI itself works (8 judge calls succeeded across two probes on gpt-oss-20b, gpt-oss-120b, mistral-small-3.1). Generation task #32 stuck twice with 0 calls; re-check probes died after 3 and 5 judge calls. The dashboard's 409 was a secondary artifact: a duplicate request hitting the `'already running'` guard while the first request was still in flight.

Root cause in code: `runTask` claimed queued → running, then `await runAutonomyTask(...)` with no timeout, no lease and no try/finally; `generateWithWorkersAI` awaited `env.AI.run(...)` with no timeout; `retryTask` only works on `'failed'` tasks; the dashboard had no cancel for a `'running'` task.

What exactly kills the run (an `env.AI.run` call that never settles vs a platform request timeout on a minutes-long synchronous job) is STILL unverified — the D1-only token cannot tail Worker logs. The Cloudflare-dashboard log check from Phase 3 §G.1 is still an open diagnostic; this fix makes the failure survivable either way (a stalled run now fails cleanly and is recoverable instead of orphaning the task forever).

---

## 1. Timeout on every `env.AI.run` call — DONE

**File:** `backend/llm/providers/cloudflare-workers-ai.js`

- NEW export `WORKERS_AI_CALL_TIMEOUT_MS = 120000` (2 minutes per model call). Observed successful calls take seconds; 2 minutes is generous.
- NEW `withTimeout(promise, ms, label)` helper (Promise.race with a timer; `clearTimeout` on settle on both paths).
- `generateWithWorkersAI(env, { prompt, system, maxTokens }, options = {})` — new optional 3rd arg `{ timeoutMs }` (tests only; production callers pass 2 args and get the default). Each `env.AI.run` call is wrapped: on timeout the error is caught by the existing per-model catch, recorded as `lastError` ("Workers AI model … timed out after …ms"), and the loop falls through to the next model. A timeout never throws out of the provider — the existing `{ ok: false, reason: 'error', detail }` shape is kept, and the final detail names the timeout.
- Honest limitation: the AI binding takes no AbortSignal, so a timed-out call cannot be cancelled — its promise simply never settles. In Workers the abandoned execution is killed when the request ends; in tests the pending promise holds nothing (no timer, no handle). The timeout resolves the CALLER, not the call.

**Tests:** `tests/task-timeout-phase4.test.js` — hung first model falls through to the second (gpt-oss-20b never settles → gemma answers, returns in ms); all models hanging returns `{ ok: false, reason: 'error' }` with a timeout detail instead of hanging forever; constants sanity (lease 600s > call timeout 120s).

## 2. Timeout/lease on runTask + always-resolved status — DONE

**File:** `backend/routes/scheduler.js`

- NEW export `TASK_RUN_LEASE_MS = 600000` (10 minutes). A 20-claim re-check at ~15s/claim fits comfortably (~5 min); a generation (~14s observed) fits easily.
- NEW `runWithLease(promise, leaseMs)` — races the execution against a timer; on timeout resolves `{ outcome: 'failed', error: 'Task exceeded its run lease of …s …' }` so the existing failure path (re-queue with backoff while attempts remain) applies.
- `runTask(env, taskId, options = {})` — new optional 3rd arg `{ leaseMs }` (tests only). The execution is `await runWithLease(runAutonomyTask(task, env), leaseMs)`.
- The whole post-claim section now runs in **try/finally**: the `agent_runs` + `agent_logs` write and the status resolution happen in the `finally`, so the status is resolved even if the run-row insert throws. A run ends done/failed/skipped (or re-queued), never stuck `'running'`.
- The final status writes are conditional on still-`'running'` (`UPDATE … WHERE id = ? AND status = 'running'`): a concurrent owner cancel wins over a late completion, so a cancelled task is never resurrected (reported as `cancelledDuringRun: true` in the result). The status resolution has one retry; if it keeps failing, the run row still records the outcome and the sweeper recovers the row later.
- A second `runTask` call on a fresh `'running'` task returns `{ ok: true, inFlight: true, taskId, status: 'running', attempts, updatedAt }` (the HTTP layer maps it to 202) instead of 409. A second call on a **stale** `'running'` task recovers it first and returns `{ ok: false, status: 409, recoveredStale: true, … }` with an error telling the owner to retry. Other non-queued statuses (done/failed/skipped) still 409 "only queued tasks can run" — unchanged.
- E-Stop, pause-check and protection paths are unchanged (they return before claiming).

**Tests:** a research run whose fetch never settles returns on the 60ms test lease with a lease error, outcome `'failed'`, re-queued (not stuck `'running'`), and a failed run row; second call on a fresh running task returns in-flight (no run row written, row untouched); second call on a stale running task recovers it to `'failed'` with a `stale-lock` run row; a done task still 409s.

## 3. Stale-lock recovery (sweeper) — DONE

**File:** `backend/routes/scheduler.js`

- NEW exports `parseDbTime(value)`, `isTaskStale(task, leaseMs, nowMs)`, `recoverStaleTask(env, taskId, options)`, `recoverStaleTasks(env, options)`.
- `parseDbTime` handles both real timestamp formats: ISO with `T` + `Z` (written by `nowIso()`) and SQLite space-format `'YYYY-MM-DD HH:MM:SS'` (written by `datetime('now')`) — both read as UTC. Returns `null` on garbage (never throws). `isTaskStale` returns false for unparseable timestamps (never guesses stale) and for non-running rows.
- `recoverStaleTask`: a stale `'running'` task gets a failed `agent_runs` row (detail `{ reason: 'stale-lock', staleForMs, updatedAt, leaseMs }` + an error log line) and is marked `'failed'` — so the existing retry endpoint can re-queue it. Returns `{ recovered: false, reason: 'not-stale' }` when the task is not stale.
- `recoverStaleTasks`: sweeps all `'running'` rows, recovers the stale ones, skips the rest (fresh running, unparseable, or a single-row failure — one bad row never aborts the sweep). Returns `{ ok, recovered: [{taskId, agent, staleForMs, updatedAt}], skipped, count }`.
- Wiring: `runDailyWorkflow` and `runWeeklyWorkflow` call `recoverStaleTasks(env)` best-effort (try/catch, never blocks the workflow) right after the E-Stop check and before the duplicate check.
- Endpoint: `POST /api/autonomy/tasks/recover-stale` → `handleRecoverStale` (see orchestrator below).

**Tests:** sweeper recovers only stale rows (ISO + SQLite timestamps), leaves fresh running and queued rows untouched, writes `stale-lock` run rows, and the recovered task retries to queued via the existing retry endpoint; endpoint test (200, count 1, fresh row untouched); daily-workflow test (a stale task is `'failed'` after `runDailyWorkflow`).

## 4. Dashboard cancel + retry controls for a running task — DONE

**Backend:** `backend/routes/scheduler.js` — NEW `cancelTask(env, taskId)`: only `'running'` tasks can be cancelled (else 409; unknown id 404); writes a failed `agent_runs` row (detail `{ reason: 'cancelled-by-owner' }`) and marks the task `'failed'`, so it is retryable via the existing retry endpoint. It flips the row only — it cannot stop an execution already in flight in another request (no handle exists on it); `runTask`'s conditional final write (item 2) is what stops a late completion from resurrecting it.
**Backend:** `backend/routes/orchestrator.js` — NEW `handleCancelTask` (`POST /api/autonomy/tasks/:id/cancel`) and `handleRecoverStale` (`POST /api/autonomy/tasks/recover-stale`), both owner-only through the existing router auth.

**Frontend:** `frontend/scripts/autonomy.js` (syntax-checked with `node --check`)
- Task queue rows: `'running'` rows now render a **Cancel** button (`data-autonomy-cancel`); Run (queued) and Retry (failed) are unchanged.
- NEW `cancelTask(id, statusElId, btn)` dashboard function (posts to the cancel endpoint, reports "cancelled — it is now failed and can be retried", reloads tasks/status/pipeline).
- NEW `recoverStaleTasks(statusElId, btn)` dashboard function + **"Recover stale running tasks"** button (`autonomyRecoverStaleBtn`) under "Run a task manually", with a muted note explaining the 10-minute lease. Reports the recovered task ids or "No stale running tasks found".
- `handleRunTask` maps an in-flight result to 202 (see item 5); a `recoveredStale` 409 tells the owner to click Retry, and reloads the task list.

**Tests:** `cancelTask` cancels a running task into `'failed'` with a `cancelled-by-owner` run row and the cancelled task retries to queued; refuses non-running tasks (409) and unknown ids (404); endpoint test (200 + `cancelled: true`, second cancel 409s); static test that the dashboard file contains the Cancel button, its delegation, the cancel function, the Recover button and the recover-stale endpoint.

## 5. Duplicate-request 409 fix — DONE

**Backend:** `backend/routes/orchestrator.js`
- `handleRecheckArticle`: the guard no longer 409s. A **stale** running lock is recovered (`recoverStaleTask`) and the re-check runs fresh on the reused task row. A **genuinely in-flight** re-check answers `jsonOk({ articleId, taskId, status: 'already-running', inFlight: true, runningSince, leaseEndsAt }, 202)` — never a 409. A race guard after `runTask` returns the same 202 shape if another request claimed the task in between. The doc comment above the handler was updated (it previously documented the 409).
- `handleRunTask`: an in-flight result maps to `jsonOk({ taskId, status: 'running', inFlight: true, attempts, updatedAt, note }, 202)`; a `recoveredStale` result passes `{ recoveredStale: true }` through on the 409.
- Router: `POST /api/autonomy/tasks/:id/cancel` and `POST /api/autonomy/tasks/recover-stale` added to `handleAutonomy` (the recover-stale path is matched before the `:id` routes can shadow it — it is a literal path check).

**Frontend:** `frontend/scripts/autonomy.js`
- Module-level `inFlightTasks` / `inFlightRechecks` sets: `runTask` and `recheckArticle` refuse to re-fire while one is already in flight for the same target (the sets survive list re-renders; the clicked button is also disabled for immediate feedback, following the existing source-fetch precedent, and re-enabled on every settle path including `.catch`).
- 202 responses are shown as "already running (task #N, started …) — wait for it to finish, or cancel it from the task queue", not as errors. `recheckArticle` checks `r.data.inFlight || r.data.status === 'already-running'`; `runTask` checks `r.data.inFlight`.

**Tests:** re-check while one is in flight returns 202 (`ok: true`, `status: 'already-running'`, `inFlight: true`, taskId, runningSince, NO error field), writes no fact-check row, creates no duplicate task, consumes no attempt; re-check over a stale lock recovers it and runs to completion (200, `status: 'completed'`, same task reused, exactly one new fact-check row, task ends `'done'`); second manual run on a fresh running task answers 202 via the endpoint.

## Updated pre-existing test (1 file — equal-or-stronger)

- `tests/factcheck-rerun.test.js` — "an in-flight re-check returns already-running (409) and starts no second run" → renamed "… (202) …". This is the exact behaviour item 5 intentionally changes, so the old 409 pin cannot stand. The new form asserts MORE than the old one: status 202 (was 409), `ok: true`, `inFlight: true`, `taskId` equals the seeded running task, `runningSince` equals its `updated_at`, `error` is absent — while KEEPING both safety assertions (0 fact-check rows written, still exactly one running task) and ADDING one (attempts unchanged at 1 — a refused duplicate consumes no attempt). No assertion was weakened; the test now pins the intended 202 contract.

No other pre-existing test was modified. The full suite went 839 → 858 (19 new tests, same count for the updated file).

## Files changed (Phase 4 implementation)

**Backend:** `backend/llm/providers/cloudflare-workers-ai.js` (per-model timeout), `backend/routes/scheduler.js` (lease, try/finally, stale sweeper, cancel, workflow wiring), `backend/routes/orchestrator.js` (202 in-flight answers, cancel + recover-stale endpoints, recheck guard).
**Frontend:** `frontend/scripts/autonomy.js` (Cancel button, Recover button, in-flight guards, 202 handling). `node --check` clean.
**Tests (new):** `tests/task-timeout-phase4.test.js` (19 tests, 6 suites). **Tests (updated):** `tests/factcheck-rerun.test.js` (1 test, see above).
**Docs:** `docs/PHASE-4-REPAIR-NOTES-2026-11-20.md` (this file).
**No migration.** No change to publishing, the gate, settings, or protected articles.

---

## NOT TESTED

- The live #31 E2E (generation with task #32's last attempt, fact-check, correction, SEO, gate) — parent's job after deploy; NOT run here by design. Do NOT spend task #32's last attempt until the fix is deployed.
- Live browser verification of the new dashboard controls (Cancel / Recover buttons, in-flight guards, 202 messages) — parent's live check after deploy. The dashboard behaviour is proved only by the static assertions in the new test file plus the endpoint tests behind them.
- The Cloudflare-dashboard log check (what exactly kills a long synchronous run) — still open; see "The failure" above.
- A real stuck run against the deployed Worker (the lease/sweeper can only be proven live by a run that actually stalls).

## OWNER AUTHORIZATION REQUIRED

- Deploy of this Phase 4 fix (code change + deploy) — the Phase 3 report §H listed it as proposed, not authorized by that phase; the owner has since said "koro sob" (2026-11-20 18:34), which the parent treats as authorization for the Phase 4 work.
- Any article publish (including #31 after the E2E) — needs his explicit item-named approval.
- Google Search Console retry — separate track, owner-authorized 2026-11-20 18:34; NOT done here (parent's browser task).

## Remaining limitations

- **The timeout cannot cancel an in-flight AI call.** The Workers AI binding takes no AbortSignal. A timed-out model call's promise never settles; in Workers it dies with the request, but the Neurons for a call that eventually completes server-side cannot be reclaimed. The fix bounds the damage (the caller moves on; the task resolves) rather than aborting the call.
- **The lease race does not stop the abandoned execution either.** `runWithLease` resolves the `runTask` caller; the underlying `runAutonomyTask` promise keeps running until the platform kills it (in Workers, when the response returns). A late completion may still write audit rows (a `fact_checks` row, a scaffold) after the task was marked failed — the task row itself cannot be resurrected (conditional final write + cancel-wins rule), but downstream rows from the abandoned run are not rolled back. In practice the platform kills the isolate on response, so this is a corner case, not the common path.
- **Cancel is row-level, not execution-level.** Cancelling a task that is genuinely mid-run in another request only flips its row; the other execution continues until it resolves or its own lease fires. The owner sees the task as failed/retryable immediately, which is the point — but a retry started while the old execution is still alive could run twice against the same article (the existing idempotency + claim checks bound that risk; it is not eliminated).
- **The 10-minute lease is a judgement call, not a measured limit.** It fits the observed legitimate runs (generation ~14s, 20-claim re-check ~5 min) with headroom, and bounds a stuck run to 10 minutes + backoff. If legitimate runs ever grow past it (longer articles, slower models), the lease — not the platform — will fail them; the failure reason names the lease so that is diagnosable.
- **Neurons remain estimates** (unchanged from Phase 3).
