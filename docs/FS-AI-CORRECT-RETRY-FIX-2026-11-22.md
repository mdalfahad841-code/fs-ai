# FS AI — Dashboard Same-Day Correction-Retry Defect Fix (live #33)

**Date:** 2026-11-22
**Status:** Fixed in the local tree, full suite green. **Not deployed** — the parent deploys.
**Files changed (3):** `backend/routes/scheduler.js`, `backend/routes/orchestrator.js`, `tests/autonomy-queue.test.js`
**No migration.** No article body touched. No live D1 writes. No publish.

---

## 1. Root cause (exact)

The dashboard Correct button could start at most **one correction per article per day**, and a failed correction could never be retried the same day. The chain, verified in code and against the live task #44 row (parent's D1 read):

- The dashboard builds the idempotency key as `'manual-' + kind + '-' + articleId + '-' + <today's date>` (`frontend/scripts/autonomy.js:1143`, `enqueueAgentTask`). Today's Correct clicks for #33 all use `manual-correct-33-2026-11-22`.
- `enqueueTask` (`backend/routes/scheduler.js:518`) dedupes **only** by `idempotency_key`, and `duplicateTaskResult` returned the existing row **unchanged** for every non-content task — whatever its status. The first Correct click created task #44 (kind `'correct'`); run #171 FAILED on the validator defect; the Re-check then reused the same row and forced its kind to `'fact-check'` (`handleRecheckArticle`, `backend/routes/orchestrator.js` ~line 1228); run #172 finished, leaving the row status `'done'`, attempts 2/3.
- The next Correct click found the same key, returned the `'done'` row as `duplicate: true`, and the dashboard said "already existed — run it from the task queue." But a `'done'` task has **no Run button** (Run renders only for `'queued'`, `autonomy.js:494`) and the Retry button renders only for `'failed'` (`autonomy.js:495`). Dead end: no new task, no new run, #33 still draft/Blocked with 13 failed corrections.

**Parent's point 4 — checked, NOT a defect in `runTask`:** a failed correction run does NOT leave the task `'done'`. `runCorrection` returns `outcome: 'failed'` on validation rejection (`backend/agents/autonomy/factcheck.js:1386`), `runAutonomyTask` passes it through, and `runTask` (`scheduler.js`, `resolveStatus`) re-queues a failed run with backoff while attempts remain (RETRYING) — run #171 correctly left task #44 queued for retry. The task ended `'done'` because run #172 (the re-check) **succeeded**. The re-check handler reused the pending correction-retry row and forced its kind to `'fact-check'`, consuming the retry. That reuse is a real but separate observation (see §7); it is not changed here, and the fix below repairs its effect on the next Correct click.

## 2. The fix

Manual dashboard enqueues now re-queue a terminal task instead of returning it dead. Scheduled callers are untouched.

**`backend/routes/scheduler.js`** — `duplicateTaskResult` gains the re-queue branch (after the Fix 8 content merge, which keeps precedence), and `enqueueTask` accepts and forwards a `requeueTerminal` option through both the normal duplicate branch and the UNIQUE-race branch:

- Only when `requeueTerminal` is set AND the existing row is terminal (`done` / `failed` / `skipped`): `UPDATE agent_tasks SET agent=?, kind=?, payload=?, division_id=?, priority=?, status='queued', attempts=0, scheduled_for=?, updated_at=?` — kind + payload restored to the requested work, attempts reset to 0 (the explicit-owner-retry precedent from `retryTask`, which notes "Explicit owner retry is the ONLY reset"), terminal state cleared via `clearTerminalState` so the task can reach a fresh terminal state. Returns `{ ok: true, task, duplicate: true, requeued: true }`.
- Queued/running rows are never touched (genuine double-click protection). Content tasks keep the Fix 8 merge path — a done content task is never re-queued (the merge already rejects sources for done/running/skipped content tasks with "create a new task").

**`backend/routes/orchestrator.js`** — `handleCreateTask` (POST `/api/autonomy/tasks`, the manual dashboard endpoint) passes `requeueTerminal: true` and forwards `requeued: true` in the response. The dashboard message stays "already existed — run it from the task queue", which is now **true**: the task is queued and runnable.

**Not changed:** the idempotency protection itself (a queued/running duplicate still returns the existing row unchanged); `handleRecheckArticle` (see §7); `runTask`'s outcome → status mapping; any gate; the frontend (no change needed — the Run button appears once the task is queued).

## 3. Regression tests (6 new, all in `tests/autonomy-queue.test.js`, describe "autonomy task queue — manual re-enqueue of a terminal task (live #33, 2026-11-22)")

1. **Second same-day Correct enqueue re-queues the done task** — live #44 shape (key `manual-correct-33-2026-11-22`, kind forced to `'fact-check'`, status `'done'`, attempts 2/3) via the real manual endpoint → `duplicate: true`, `requeued: true`, same task id, status `'queued'`, kind `'correct'`, attempts 0, `scheduled_for` null, still exactly one row.
2. **A failed terminal task re-queues too** — status `'failed'`, attempts 3 → queued, attempts 0.
3. **Second enqueue while queued returns the row unchanged** — no re-queue, no duplicate run.
4. **Second enqueue while running returns the row unchanged** — attempts untouched.
5. **A done content-creation task is NOT re-queued (Fix 8 precedence)** — stays `'done'`, `sourceMerge.status` `'rejected'`, no `requeued` flag.
6. **`enqueueTask` without the manual flag still returns a done task unchanged** — scheduled callers (daily `daily-research` / `daily-content` / `daily-factcheck` / `daily-seo` / `daily-social` keys) are unaffected: a second daily-run pass never re-runs a completed daily task.

## 4. Test results

| Run | Result |
|---|---|
| New tests, before the fix | **4 pass / 2 fail** — exactly the two terminal re-queue tests fail (done + failed); all four guard tests already pass |
| New tests, with the fix | **6 pass / 0 fail** |
| Negative control (flag temporarily set `false`, fix otherwise intact) | **4 pass / 2 fail** — exactly the same two tests fail again; flag restored to `true` afterwards (verified at `orchestrator.js:393`) |
| **Full suite, `npm test`** (repo's own runner) | **1315 pass / 0 fail, 335 suites, EXIT=0** |
| Suite before this fix | 1309 pass / 0 fail, 334 suites |

Delta is exactly +6 tests / +1 suite. No test weakened, none deleted. No migration touched, so no migration-chain re-verification was needed.

## 5. What the parent must do to deploy and re-run the #33 correction

1. **Pre-deploy D1 backup** (same method as 2026-11-22: `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-pre-deploy.py`, new dated copy). No new migration to apply.
2. **Push** via the established zip + one-time-workflow route (regenerate `~/workspace/fs-ai-source/fs-ai-source.zip`, verify base commit `4215b07`, upload, create `.github/workflows/push-source-once.yml`, run workflow_dispatch, verify new HEAD has exactly 1 parent and the workflow + zip are gone). Rollback: revert the push + restore the D1 backup.
3. **Post-deploy verify:** served `dashboard.html` / `autonomy.js` SHA-256-identical to the deployed tree; counts unchanged (published 25, drafts 7); #26/#27/#31 bodies unchanged; settings unchanged (publishing_mode auto, cutoff 2026-11-22T04:55:28Z, social_auto_post off); E-Stop OFF; $0.00.
4. **Re-run the #33 correction** from the owner dashboard (signed in as Owner): Autonomous Operations → #33 row → "Correct" → expect "correct task created (task #44) — already existed. — run it from the task queue." — this time the task IS queued, so run it from the task queue (Run button on #44, or "Run a task manually"). Expect outcome `done`: the same 8 corrections + 5 removals attempted in run #171 should now apply (validator fix deployed as 4215b07). Then "Re-check" → expect a new `fact_checks` row with claims_total < 20 (claims removed), body_hash equal to the corrected body's hash, verdict expected `needs-review` (9 failed claims remain; the correction removes/qualifies them; the re-check judges the new body). #33 stays a draft; it can never auto-publish (legacy, pre-cutoff).
5. **Verify in D1 afterwards:** article #33 body length changed from 4801, exactly 1 new `article_revisions` row, `article_corrections` rows for the 13 claims show `applied`/`removed` (not `failed`), latest `fact_checks` row for #33 has `check_kind` `recheck` and `evidence_signature` starting `714:`.
6. **If the re-run still fails:** do NOT re-run in a loop. Read the run's `validationReasons` / recovery report from the `agent_runs` detail first — a new failure means a different defect, not this one.

## 6. Notes / limits

- The fix does not change the saved article: it only makes the correction runnable again. The Sources lines stay in the body.
- The dashboard "already existed" message is now accurate rather than misleading: the row is reused AND re-queued, so "run it from the task queue" works.
- The #30 correction (prepared, awaiting owner authorization) is unaffected by this fix; do NOT use the dashboard Correct button for #30 (it would delete true claims on fragment evidence).

## 7. Known follow-up (found during verification, NOT fixed here)

`handleRecheckArticle` reuses the article's newest fact-checking task **regardless of kind or status** (`findFactCheckTasksForArticle` has no status/kind filter) and forces its kind to `'fact-check'`. If a correction run has failed and the task is queued for retry (RETRYING with backoff), clicking Re-check silently converts that pending correction retry into a fact-check run — the retry is lost. In the #33 case this is what turned task #44 from a pending correction retry into a fact-check task. After this fix the damage is repairable from the dashboard (Correct re-queues the row as `'correct'` again), so it is not blocking. A future fix should make the re-check skip rows whose kind is `'correct'` and whose status is `'queued'` (pending retry), or create a fresh task when the newest row is a pending correction — but that changes the live-verified #31 re-check behaviour (runs #121/#122) and needs its own verification, so it is left for a separate change.
