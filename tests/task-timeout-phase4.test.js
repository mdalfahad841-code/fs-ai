// FS AI — Phase 4 orphaned-task / stalled-run fix tests.
//
// Live Phase 3 finding (2026-11-20): a long synchronous manual run dies
// mid-flight after ~4-5 minutes with no error, no save, no agent_runs
// row, and the task left 'running' forever. Workers AI itself works
// (judge calls succeeded on gpt-oss-20b, gpt-oss-120b, mistral-small-3.1).
// Generation task #32 stuck twice with 0 calls; re-check probes died
// after 3 and 5 judge calls. The dashboard's 409 was a secondary
// artifact (a duplicate request hitting the 'already running' guard
// while the first request was still in flight).
//
// Root cause in code: runTask claimed queued -> running, then awaited
// runAutonomyTask with no timeout, no lease and no try/finally, and
// generateWithWorkersAI awaited env.AI.run with no timeout; retryTask
// only works on 'failed' tasks; the dashboard has no cancel for a
// 'running' task.
//
// The fix, proved here:
//   1. Every env.AI.run call has a timeout (Promise.race) — a hung
//      model fails over to the next model instead of hanging forever.
//   2. runTask has a lease: a run that exceeds it fails with a clear
//      reason and the task status is ALWAYS resolved (try/finally) —
//      a run ends done/failed/skipped, never stuck 'running'.
//   3. A stale-lock sweeper recovers 'running' tasks older than the
//      lease to 'failed' (reason 'stale-lock'), so they become
//      retryable via the existing retry endpoint.
//   4. The dashboard gains cancel + retry controls for 'running'
//      tasks (cancel marks the task failed/cancelled).
//   5. A duplicate request for an in-flight operation returns the
//      in-flight status (202, taskId + status 'running') instead of
//      a 409 — server-side and dashboard-side (no re-fire while one
//      is in flight).
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012). The LLM is stubbed through env.AI (the Workers AI
// binding shape). Throwaway articles only; never #26/#27 ids.
// Run: node --test tests/task-timeout-phase4.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  generateWithWorkersAI, WORKERS_AI_CALL_TIMEOUT_MS,
} = require('../backend/llm/providers/cloudflare-workers-ai.js');
const {
  enqueueTask, runTask, retryTask, cancelTask,
  recoverStaleTasks, recoverStaleTask, runDailyWorkflow,
  TASK_RUN_LEASE_MS, parseDbTime, isTaskStale,
} = require('../backend/routes/scheduler.js');
const { freshEnv, insertArticle, callAutonomy } = require('./phase2-harness.js');

const ROOT = path.join(__dirname, '..');

let keyCounter = 0;
function uniqueKey(prefix) {
  keyCounter += 1;
  return `phase4-${prefix}-${Date.now()}-${keyCounter}`;
}

/** Directly seed an agent_tasks row (any status, any updated_at). */
function seedTaskRow(db, { agent = 'analytics', kind = 'snapshot', status = 'running', attempts = 0, updatedAt = null, payload = {} } = {}) {
  const now = updatedAt || new Date().toISOString();
  const r = db.prepare(
    'INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES (?, ?, ?, NULL, 5, ?, ?, 3, ?, NULL, ?, ?)',
  ).run(agent, kind, JSON.stringify(payload), status, attempts, uniqueKey('task'), now, now);
  return Number(r.lastInsertRowid);
}

function taskRow(db, id) {
  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
}

function runRowsFor(db, taskId) {
  return db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY id ASC').all(taskId);
}

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/** SQLite space-format timestamp, minutes ago: 'YYYY-MM-DD HH:MM:SS'. */
function sqliteMinutesAgo(minutes) {
  return isoMinutesAgo(minutes).replace('T', ' ').slice(0, 19);
}

// ---- 1. Per-model AI timeout -----------------------------------------

describe('Phase 4 — per-model Workers AI timeout', () => {
  it('a hung first model falls through to the next model instead of hanging', async () => {
    const attempted = [];
    const env = {
      AI: {
        run: async (model) => {
          attempted.push(model);
          if (model === '@cf/openai/gpt-oss-20b') return new Promise(() => {}); // never settles
          return { response: 'hello world', usage: { prompt_tokens: 10, completion_tokens: 5 } };
        },
      },
    };
    const before = Date.now();
    const res = await generateWithWorkersAI(env, { prompt: 'hi', maxTokens: 50 }, { timeoutMs: 25 });
    const elapsed = Date.now() - before;
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.model, '@cf/google/gemma-4-26b-a4b-it', 'falls through to the second model');
    assert.equal(res.text, 'hello world');
    assert.equal(attempted[0], '@cf/openai/gpt-oss-20b', 'the hung model was attempted first');
    assert.ok(elapsed < 5000, `must return quickly (took ${elapsed}ms)`);
  });

  it('all models hanging returns a timeout error instead of hanging forever', async () => {
    const env = { AI: { run: async () => new Promise(() => {}) } };
    const before = Date.now();
    const res = await generateWithWorkersAI(env, { prompt: 'hi', maxTokens: 50 }, { timeoutMs: 15 });
    const elapsed = Date.now() - before;
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'error');
    assert.match(res.detail || '', /timed out/i, 'the failure names the timeout');
    assert.ok(elapsed < 5000, `must return quickly (took ${elapsed}ms)`);
  });

  it('timeout constants are sane: a run lease outlives a single model call', () => {
    assert.equal(WORKERS_AI_CALL_TIMEOUT_MS, 120000, 'per-model call timeout is 2 minutes');
    assert.equal(TASK_RUN_LEASE_MS, 600000, 'run lease is 10 minutes');
    assert.ok(TASK_RUN_LEASE_MS > WORKERS_AI_CALL_TIMEOUT_MS, 'the lease must outlive one model call');
  });

  it('parseDbTime handles ISO and SQLite space formats, rejects garbage', () => {
    const iso = '2026-11-20T11:39:35.857Z';
    assert.equal(parseDbTime(iso), Date.parse(iso));
    const space = '2026-11-20 11:39:35';
    assert.equal(parseDbTime(space), Date.parse('2026-11-20T11:39:35Z'), 'space format reads as UTC');
    assert.equal(parseDbTime('garbage'), null);
    assert.equal(parseDbTime(null), null);
    assert.equal(parseDbTime(undefined), null);
  });

  it('isTaskStale uses the lease: old running rows are stale, fresh ones are not', () => {
    const stale = { status: 'running', updated_at: isoMinutesAgo(20) };
    const fresh = { status: 'running', updated_at: new Date().toISOString() };
    const queued = { status: 'queued', updated_at: isoMinutesAgo(20) };
    assert.equal(isTaskStale(stale), true);
    assert.equal(isTaskStale(fresh), false);
    assert.equal(isTaskStale(queued), false, 'only running rows can be stale');
    assert.equal(isTaskStale(stale, 30 * 60 * 1000), false, 'a longer lease keeps it fresh');
  });
});

// ---- 2. runTask lease -------------------------------------------------

describe('Phase 4 — runTask lease (a run always resolves its status)', () => {
  it('a run whose execution never settles fails with a lease error and is re-queued, never stuck running', async () => {
    const { db, env } = freshEnv();
    // One enabled RSS source so the research run actually fetches (and hangs).
    db.prepare(
      "INSERT INTO research_sources (division_id, name, url, source_type, is_active, last_status) VALUES (1, 'Phase 4 hang source', 'https://example.com/phase4-feed', 'rss', 1, 'ok')",
    ).run();
    const enqueued = await enqueueTask(env, {
      agent: 'research', kind: 'daily-research', payload: { division: 'automotive' },
      idempotency_key: uniqueKey('hang-research'),
    });
    assert.equal(enqueued.ok, true);
    const id = enqueued.task.id;
    // A fetch that never settles (and ignores the abort signal, exactly
    // like a stalled env.AI.run): the research run can never finish.
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => new Promise(() => {});
    try {
      const before = Date.now();
      const result = await runTask(env, id, { leaseMs: 60 });
      const elapsed = Date.now() - before;
      assert.ok(elapsed < 5000, `runTask must return on the lease (took ${elapsed}ms)`);
      assert.equal(result.ok, true);
      assert.equal(result.outcome, 'failed');
      assert.match(String(result.result && result.result.error || ''), /lease/i, 'the failure names the lease');
      assert.equal(result.requeued, true, 'attempts left, so the failure re-queues with backoff');
      const row = taskRow(db, id);
      assert.notEqual(row.status, 'running', 'the task must never be left running');
      assert.equal(row.status, 'queued', 're-queued with a future scheduled_for');
      const runs = runRowsFor(db, id);
      assert.equal(runs.length, 1, 'the failed run is recorded');
      assert.equal(runs[0].outcome, 'failed');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a second runTask call on a fresh running task returns in-flight, not 409', async () => {
    const { db, env } = freshEnv();
    const id = seedTaskRow(db, { agent: 'analytics', kind: 'snapshot', status: 'running', attempts: 1 });
    const result = await runTask(env, id);
    assert.equal(result.ok, true);
    assert.equal(result.inFlight, true);
    assert.equal(result.status, 'running');
    assert.equal(result.taskId, id);
    assert.equal(taskRow(db, id).status, 'running', 'the in-flight run is untouched');
    assert.equal(runRowsFor(db, id).length, 0, 'no run row is written for a refused duplicate');
  });

  it('a second runTask call on a STALE running task recovers it and reports recoveredStale', async () => {
    const { db, env } = freshEnv();
    const id = seedTaskRow(db, {
      agent: 'analytics', kind: 'snapshot', status: 'running', attempts: 2, updatedAt: isoMinutesAgo(20),
    });
    const result = await runTask(env, id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.recoveredStale, true);
    assert.match(result.error || '', /stale|stuck/i);
    const row = taskRow(db, id);
    assert.equal(row.status, 'failed', 'the stale lock is recovered to failed');
    const runs = runRowsFor(db, id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].outcome, 'failed');
    assert.match(String(runs[0].detail || ''), /stale-lock/);
  });

  it('a done task still 409s (only queued tasks can run)', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: uniqueKey('done-409'),
    });
    const first = await runTask(env, enqueued.task.id);
    assert.equal(first.ok, true);
    assert.equal(first.outcome, 'no-op');
    const second = await runTask(env, enqueued.task.id);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.equal(second.inFlight, undefined, 'a done task is a conflict, not an in-flight run');
  });
});

// ---- 3. Stale-lock sweeper --------------------------------------------

describe('Phase 4 — stale-lock sweeper', () => {
  it('recoverStaleTasks recovers only stale running rows (ISO + SQLite timestamps)', async () => {
    const { db, env } = freshEnv();
    const staleIso = seedTaskRow(db, { agent: 'research', kind: 'daily-research', status: 'running', updatedAt: isoMinutesAgo(20) });
    const fresh = seedTaskRow(db, { agent: 'research', kind: 'daily-research', status: 'running', updatedAt: new Date().toISOString() });
    const staleSqlite = seedTaskRow(db, { agent: 'seo', kind: 'seo-pass', status: 'running', updatedAt: sqliteMinutesAgo(25) });
    const queued = seedTaskRow(db, { agent: 'seo', kind: 'seo-pass', status: 'queued', updatedAt: isoMinutesAgo(20) });
    const res = await recoverStaleTasks(env);
    assert.equal(res.ok, true);
    const recoveredIds = (res.recovered || []).map((r) => r.taskId).sort((a, b) => a - b);
    assert.deepEqual(recoveredIds, [staleIso, staleSqlite].sort((a, b) => a - b));
    assert.equal(taskRow(db, staleIso).status, 'failed');
    assert.equal(taskRow(db, staleSqlite).status, 'failed');
    assert.equal(taskRow(db, fresh).status, 'running', 'a fresh running task is untouched');
    assert.equal(taskRow(db, queued).status, 'queued', 'a queued task is untouched');
    for (const id of [staleIso, staleSqlite]) {
      const runs = runRowsFor(db, id);
      assert.equal(runs.length, 1, `run row recorded for recovered task ${id}`);
      assert.equal(runs[0].outcome, 'failed');
      assert.match(String(runs[0].detail || ''), /stale-lock/);
    }
    // A recovered task is retryable through the existing retry endpoint.
    const retried = await retryTask(env, staleIso);
    assert.equal(retried.ok, true);
    assert.equal(taskRow(db, staleIso).status, 'queued');
    assert.equal(taskRow(db, staleIso).attempts, 0);
  });

  it('recoverStaleTasks via the dashboard endpoint recovers stale locks', async () => {
    const { db, env } = freshEnv();
    const stale = seedTaskRow(db, { agent: 'research', kind: 'daily-research', status: 'running', updatedAt: isoMinutesAgo(20) });
    const fresh = seedTaskRow(db, { agent: 'research', kind: 'daily-research', status: 'running' });
    const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks/recover-stale', {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 1);
    assert.deepEqual((res.body.recovered || []).map((r) => r.taskId), [stale]);
    assert.equal(taskRow(db, stale).status, 'failed');
    assert.equal(taskRow(db, fresh).status, 'running');
  });

  it('the daily workflow recovers stale locks before running', async () => {
    const { db, env } = freshEnv();
    const stale = seedTaskRow(db, { agent: 'research', kind: 'daily-research', status: 'running', updatedAt: isoMinutesAgo(20) });
    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(taskRow(db, stale).status, 'failed', 'the scheduler recovers the stale lock');
    assert.equal(runRowsFor(db, stale).length, 1);
  });
});

// ---- 4. Cancel ----------------------------------------------------------

describe('Phase 4 — cancel a running task', () => {
  it('cancelTask cancels a running task into failed (retryable) and records the reason', async () => {
    const { db, env } = freshEnv();
    const id = seedTaskRow(db, { agent: 'content-creation', kind: 'article-draft', status: 'running', attempts: 1 });
    const res = await cancelTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.taskId, id);
    assert.equal(taskRow(db, id).status, 'failed');
    const runs = runRowsFor(db, id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].outcome, 'failed');
    assert.match(String(runs[0].detail || ''), /cancelled-by-owner/);
    // Cancelled means retryable through the existing retry endpoint.
    const retried = await retryTask(env, id);
    assert.equal(retried.ok, true);
    assert.equal(taskRow(db, id).status, 'queued');
  });

  it('cancelTask refuses non-running tasks and unknown ids', async () => {
    const { db, env } = freshEnv();
    const queued = seedTaskRow(db, { status: 'queued' });
    const done = seedTaskRow(db, { status: 'done' });
    const q = await cancelTask(env, queued);
    assert.equal(q.ok, false);
    assert.equal(q.status, 409);
    const d = await cancelTask(env, done);
    assert.equal(d.ok, false);
    assert.equal(d.status, 409);
    const missing = await cancelTask(env, 99999);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
  });

  it('cancel via the dashboard endpoint', async () => {
    const { db, env } = freshEnv();
    const id = seedTaskRow(db, { agent: 'content-creation', kind: 'article-draft', status: 'running', attempts: 1 });
    const res = await callAutonomy(env, 'POST', `/api/autonomy/tasks/${id}/cancel`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.cancelled, true);
    assert.equal(res.body.status, 'failed');
    assert.equal(taskRow(db, id).status, 'failed');
    // A second cancel on the now-failed task is a 409, not a second cancel.
    const again = await callAutonomy(env, 'POST', `/api/autonomy/tasks/${id}/cancel`, {});
    assert.equal(again.status, 409);
  });
});

// ---- 5. Duplicate re-check returns in-flight status, not 409 ---------

describe('Phase 4 — duplicate re-check returns in-flight status, not 409', () => {
  function seedRecheckSetup(db, { stale = false } = {}) {
    const articleId = insertArticle(db, 'The sky is blue. Water is wet.', { divisionId: 1, status: 'draft' });
    const taskId = seedTaskRow(db, {
      agent: 'fact-checking', kind: 'fact-check', status: 'running',
      payload: { article_id: articleId, check_kind: 'recheck' },
      updatedAt: stale ? isoMinutesAgo(20) : new Date().toISOString(),
    });
    return { articleId, taskId };
  }

  it('a re-check while one is in flight returns 202 already-running and creates nothing', async () => {
    const { db, env } = freshEnv();
    const { articleId, taskId } = seedRecheckSetup(db);
    const res = await callAutonomy(env, 'POST', `/api/autonomy/articles/${articleId}/recheck`, {});
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'already-running');
    assert.equal(res.body.inFlight, true);
    assert.equal(res.body.taskId, taskId);
    assert.ok(res.body.runningSince, 'the in-flight response names when the run started');
    assert.equal(taskRow(db, taskId).status, 'running', 'the in-flight run is untouched');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(articleId).n,
      0, 'no fact-check row is written for a refused duplicate',
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking'").get().n,
      1, 'no duplicate task is created',
    );
  });

  it('a re-check over a STALE running lock recovers it and runs to completion', async () => {
    const { db, env } = freshEnv();
    // No evidence: the deterministic UNSUPPORTED path completes without
    // an LLM call, so this proves the lock recovery + run, not the judge.
    const { articleId, taskId } = seedRecheckSetup(db, { stale: true });
    const res = await callAutonomy(env, 'POST', `/api/autonomy/articles/${articleId}/recheck`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.taskId, taskId, 'the recovered task row is reused, not duplicated');
    assert.equal(taskRow(db, taskId).status, 'done', 'the recovered lock runs to a terminal status');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(articleId).n,
      1, 'exactly one new fact-check row is written',
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking'").get().n,
      1, 'no duplicate task is created',
    );
  });

  it('a second manual run on a fresh running task answers 202 via the endpoint', async () => {
    const { db, env } = freshEnv();
    const id = seedTaskRow(db, { agent: 'analytics', kind: 'snapshot', status: 'running', attempts: 1 });
    const res = await callAutonomy(env, 'POST', `/api/autonomy/tasks/${id}/run`, {});
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.inFlight, true);
    assert.equal(res.body.status, 'running');
    assert.equal(taskRow(db, id).status, 'running');
  });
});

// ---- Dashboard controls (static — same pattern as sitemap-canonical) --

describe('Phase 4 — dashboard controls exist (static)', () => {
  it('autonomy.js has cancel + retry controls for running tasks, a stale-recovery button, and in-flight guards', () => {
    const text = fs.readFileSync(path.join(ROOT, 'frontend/scripts/autonomy.js'), 'utf8');
    // Cancel button for running rows + its click delegation.
    assert.ok(text.includes('data-autonomy-cancel'), 'task rows render a Cancel button');
    assert.ok(text.includes('[data-autonomy-cancel]'), 'the task list delegates Cancel clicks');
    assert.ok(text.includes('function cancelTask('), 'a cancelTask dashboard function exists');
    assert.ok(text.includes('/cancel'), 'cancel posts to the cancel endpoint');
    // Stale-lock recovery button.
    assert.ok(text.includes('autonomyRecoverStaleBtn'), 'a Recover stale tasks button exists');
    assert.ok(text.includes('recover-stale'), 'recovery posts to the recover-stale endpoint');
    // In-flight guards: no re-fire while one is already running.
    assert.ok(text.includes('inFlightRechecks'), 're-checks are guarded by an in-flight set');
    assert.ok(text.includes('inFlightTasks'), 'manual runs are guarded by an in-flight set');
    assert.ok(text.includes('already running'), 'the dashboard tells the owner a run is already in flight');
    // 202 in-flight responses are shown as "already running", not errors.
    assert.ok(text.includes('already-running'), 'the dashboard handles the 202 already-running response');
    // Existing controls are kept: Run for queued, Retry for failed.
    assert.ok(text.includes('data-autonomy-run'), 'Run button for queued tasks is kept');
    assert.ok(text.includes('data-autonomy-retry'), 'Retry button for failed tasks is kept');
  });
});
