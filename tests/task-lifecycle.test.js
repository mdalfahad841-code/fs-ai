// FS AI — Task lifecycle / terminal-state tests (workstream W1, 2026-11-21).
//
// Terminal states (migration 020: agent_tasks.terminal_state /
// terminal_reason / last_error) against a REAL SQLite database built
// from database/schema.sql + migrations 005 + 006 + seed +
// 008/009/010/011/012 + 020 via node:sqlite (same pattern as
// tests/autonomy-scheduler.test.js).
//
// Every task must reach exactly one terminal state:
//   COMPLETED, RETRYING, WAITING_FOR_AUTHORIZATION,
//   BLOCKED_WITH_REASON, FAILED_FINAL_WITH_RECOVERY_REPORT.
// A FAILED_FINAL task stays visible, is never auto-retried, and only an
// explicit owner retryTask() clears the terminal state.
//
// Run: node --test tests/task-lifecycle.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runTask, retryTask, recoverStaleTasks, recoverStaleTask,
  backoffMinutesForAttempt, isPermanentTaskError, buildRecoveryReport,
  TERMINAL_STATES,
} = require('../backend/routes/scheduler.js');

const ROOT = path.join(__dirname, '..');

function splitSql(text) {
  const stmts = [];
  let cur = '';
  let inStr = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inComment) {
      if (ch === '\n') { inComment = false; cur += ch; }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { cur += ch; stmts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts.filter((s) => s.trim());
}

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSql(text)) db.exec(stmt);
  }
  return db;
}

function makeRealD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (params) => ({
        all: () => Promise.resolve({ results: stmt.all(...params) }),
        run: () => Promise.resolve((() => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        })()),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        run: () => bound([]).run(),
      };
    },
  };
}

function freshEnv(withMigration020 = true) {
  const files = [
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
  ];
  if (withMigration020) files.push('database/migrations/020_task_lifecycle_health.sql');
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

function setEmergencyStop(db, on) {
  db.prepare(
    "INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES ('emergency_stop', ?, 'Emergency stop for autonomous agent operations.')",
  ).run(on ? '1' : '0');
}

function taskRow(db, id) {
  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
}

async function enqueueAnalytics(env, key) {
  const res = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: key });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.task.id;
}

async function enqueueFailingFactCheck(env, key) {
  const res = await enqueueTask(env, {
    agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 }, idempotency_key: key,
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.task.id;
}

describe('terminal states — constants and helpers', () => {
  it('defines exactly the five terminal states', () => {
    assert.deepEqual([...TERMINAL_STATES].sort(), [
      'BLOCKED_WITH_REASON', 'COMPLETED', 'FAILED_FINAL_WITH_RECOVERY_REPORT', 'RETRYING', 'WAITING_FOR_AUTHORIZATION',
    ].sort());
  });

  it('backoff is 15/30/60 minutes for attempts 1/2/3 and caps at 240', () => {
    assert.equal(backoffMinutesForAttempt(1), 15);
    assert.equal(backoffMinutesForAttempt(2), 30);
    assert.equal(backoffMinutesForAttempt(3), 60);
    assert.equal(backoffMinutesForAttempt(10), 240);
    assert.equal(backoffMinutesForAttempt(0), 15);
  });

  it('permanent errors are narrow: unknown agent and malformed payload only', () => {
    assert.equal(isPermanentTaskError('Unknown autonomy agent: bogus-agent.'), true);
    assert.equal(isPermanentTaskError('Fact-check needs a valid article_id.'), true);
    assert.equal(isPermanentTaskError('Invalid payload: missing title.'), true);
    // Everything else is temporary and must still retry.
    assert.equal(isPermanentTaskError('Article 99999 not found.'), false);
    assert.equal(isPermanentTaskError('fetch failed: network timeout'), false);
    assert.equal(isPermanentTaskError('LLM quota exhausted'), false);
    assert.equal(isPermanentTaskError(null), false);
  });

  it('buildRecoveryReport carries task id, component, root cause, timestamp, retry history, recovery action, owner flag', () => {
    const report = buildRecoveryReport(
      { id: 42, agent: 'fact-checking', kind: 'fact-check', max_attempts: 3 },
      { error: 'Article 99999 not found.' }, 3);
    assert.equal(report.taskId, 42);
    assert.equal(report.component, 'fact-checking');
    assert.equal(report.rootCause, 'Article 99999 not found.');
    assert.ok(report.timestamp);
    assert.deepEqual(report.retryHistory, { attempts: 3, maxAttempts: 3, exhausted: true });
    assert.match(report.recoveryAction, /will not auto-retry/);
    assert.equal(report.ownerActionRequired, true);
  });
});

describe('runTask — terminal states on every resolution path', () => {
  it('done task reaches COMPLETED', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'life-done-1');
    const res = await runTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'no-op', 'analytics snapshot with no source is a terminal no-op outcome');
    assert.equal(res.terminalState, 'COMPLETED');
    const row = taskRow(db, id);
    assert.equal(row.status, 'done');
    assert.equal(row.terminal_state, 'COMPLETED');
    assert.match(row.terminal_reason, /finished: no-op/);
  });

  it('failed task with attempts left reaches RETRYING with backoff and last_error', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueFailingFactCheck(env, 'life-retry-1');
    const before = Date.now();
    const res = await runTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'failed');
    assert.equal(res.requeued, true);
    assert.equal(res.terminalState, 'RETRYING');
    const row = taskRow(db, id);
    assert.equal(row.status, 'queued');
    assert.equal(row.terminal_state, 'RETRYING');
    assert.match(row.terminal_reason, /Attempt 1 failed/);
    assert.match(row.last_error, /Article 99999 not found/);
    const backoffMs = new Date(row.scheduled_for).getTime() - before;
    assert.ok(backoffMs > 14 * 60 * 1000 && backoffMs < 16 * 60 * 1000, `backoff is ~15 minutes, got ${Math.round(backoffMs / 1000)}s`);
  });

  it('failed task with retries exhausted reaches FAILED_FINAL_WITH_RECOVERY_REPORT (dead letter, never auto-retried)', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueFailingFactCheck(env, 'life-final-1');
    await runTask(env, id); // attempt 1 -> re-queued
    db.prepare('UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?').run(id);
    await runTask(env, id); // attempt 2 -> re-queued
    db.prepare('UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?').run(id);
    const res = await runTask(env, id); // attempt 3 -> final
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'failed');
    assert.equal(res.attempts, 3);
    assert.equal(res.requeued, false);
    assert.equal(res.terminalState, 'FAILED_FINAL_WITH_RECOVERY_REPORT');
    assert.ok(res.result.recoveryReport, 'recovery report attached to the result');
    assert.equal(res.result.recoveryReport.taskId, id);
    assert.equal(res.result.recoveryReport.ownerActionRequired, true);
    const row = taskRow(db, id);
    assert.equal(row.status, 'failed');
    assert.equal(row.terminal_state, 'FAILED_FINAL_WITH_RECOVERY_REPORT');
    // The recovery report is in the stored run detail (the dead letter).
    const run = db.prepare('SELECT detail FROM agent_runs WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(id);
    const detail = JSON.parse(run.detail);
    assert.ok(detail.recoveryReport, 'run detail carries the recovery report');
    assert.equal(detail.recoveryReport.taskId, id);
    assert.equal(detail.recoveryReport.retryHistory.exhausted, true);
    // It stays failed: a later drain must not pick it up (status is not queued).
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE id = ? AND status = 'queued'").get(id).n, 0);
  });

  it('permanent failure (unknown agent) is BLOCKED_WITH_REASON on the first attempt — no requeue', async () => {
    const { db, env } = freshEnv();
    const res0 = await enqueueTask(env, { agent: 'bogus-agent', kind: 'mystery', payload: {}, idempotency_key: 'life-perm-1' });
    assert.equal(res0.ok, true);
    const id = res0.task.id;
    const res = await runTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'failed');
    assert.equal(res.attempts, 1);
    assert.equal(res.requeued, false, 'a permanent failure never re-queues');
    assert.equal(res.terminalState, 'BLOCKED_WITH_REASON');
    assert.ok(res.result.recoveryReport, 'permanent failure also carries a recovery report');
    const row = taskRow(db, id);
    assert.equal(row.status, 'failed');
    assert.equal(row.terminal_state, 'BLOCKED_WITH_REASON');
    assert.match(row.last_error, /Unknown autonomy agent/);
  });

  it('E-Stop skip reaches BLOCKED_WITH_REASON', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'life-estop-1');
    setEmergencyStop(db, true);
    const res = await runTask(env, id);
    assert.equal(res.status, 423);
    assert.equal(res.skipped, true);
    const row = taskRow(db, id);
    assert.equal(row.status, 'skipped');
    assert.equal(row.terminal_state, 'BLOCKED_WITH_REASON');
    assert.match(row.terminal_reason, /Emergency Stop/);
  });

  it('paused-agent skip reaches WAITING_FOR_AUTHORIZATION', async () => {
    const { db, env } = freshEnv();
    db.prepare("UPDATE ai_agents SET status = 'paused' WHERE slug = 'analytics'").run();
    const id = await enqueueAnalytics(env, 'life-paused-1');
    const res = await runTask(env, id);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.equal(res.skipped, true);
    const row = taskRow(db, id);
    assert.equal(row.status, 'skipped');
    assert.equal(row.terminal_state, 'WAITING_FOR_AUTHORIZATION');
    assert.match(row.terminal_reason, /paused/);
  });

  it('owner retryTask is the only reset: FAILED_FINAL task returns to queued with terminal state cleared', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueFailingFactCheck(env, 'life-retry-reset-1');
    await runTask(env, id);
    db.prepare('UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?').run(id);
    await runTask(env, id);
    db.prepare('UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?').run(id);
    await runTask(env, id);
    assert.equal(taskRow(db, id).terminal_state, 'FAILED_FINAL_WITH_RECOVERY_REPORT');
    const res = await retryTask(env, id);
    assert.equal(res.ok, true);
    const row = taskRow(db, id);
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 0);
    assert.equal(row.terminal_state, null, 'terminal state cleared by the explicit owner retry');
    assert.equal(row.terminal_reason, null);
    assert.equal(row.scheduled_for, null);
  });
});

describe('runTask — conditional claim', () => {
  it('a second runTask on a fresh running task answers in-flight and never claims it twice', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'life-claim-1');
    // Simulate a concurrent claim: another execution already flipped it.
    const now = new Date().toISOString();
    db.prepare("UPDATE agent_tasks SET status = 'running', attempts = 5, updated_at = ? WHERE id = ?").run(now, id);
    const res = await runTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.inFlight, true);
    const row = taskRow(db, id);
    assert.equal(row.attempts, 5, 'attempts not incremented by the second claimer');
    assert.equal(row.status, 'running', 'still running under the first claimer');
  });

  it('two concurrent runTask calls run the task exactly once', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'life-claim-race-1');
    const [a, b] = await Promise.all([runTask(env, id), runTask(env, id)]);
    const outcomes = [a, b].map((r) => (r.ok && (r.outcome === 'done' || r.outcome === 'no-op') ? 'ran' : (r.inFlight ? 'in-flight' : `refused:${r.status || r.error}`)));
    assert.equal(outcomes.filter((o) => o === 'ran').length, 1, `exactly one call ran the task, got ${JSON.stringify(outcomes)}`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?').get(id).n, 1, 'exactly one run row');
    assert.equal(taskRow(db, id).status, 'done');
  });
});

describe('lease / timeout recovery', () => {
  it('recoverStaleTasks re-queues a stale running task with backoff and RETRYING (attempts remain)', async () => {
    // Coordinator change 2026-11-21 (owner zero-failure brief): a stale
    // lock with attempts left self-heals — it RE-QUEUES with backoff
    // instead of sitting 'failed' waiting for a manual retry. The
    // previous assertion (status 'failed') was the pre-addendum W1
    // behaviour; the new behaviour is what the reliability acceptance
    // test (scenario 9) verifies end to end.
    const { db, env } = freshEnv();
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('analytics', 'snapshot', '{}', NULL, 5, 'running', 1, 3, 'life-stale-1', NULL, ?, ?)",
    ).run(now, stale);
    const id = db.prepare("SELECT id FROM agent_tasks WHERE idempotency_key = 'life-stale-1'").get().id;
    const res = await recoverStaleTasks(env);
    assert.equal(res.ok, true);
    assert.equal(res.count, 1);
    assert.equal(res.recovered[0].taskId, id);
    const row = taskRow(db, id);
    assert.equal(row.status, 'queued', 'stale lock with attempts left re-queues automatically');
    assert.ok(row.scheduled_for, 're-queued with a backoff time');
    assert.ok(Date.parse(row.scheduled_for) > Date.now(), 'backoff is in the future');
    assert.equal(row.terminal_state, 'RETRYING', 'stale lock with attempts left is retryable, not final');
  });

  it('a stale running task with attempts exhausted recovers as FAILED_FINAL with a recovery report', async () => {
    const { db, env } = freshEnv();
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('analytics', 'snapshot', '{}', NULL, 5, 'running', 3, 3, 'life-stale-final-1', NULL, ?, ?)",
    ).run(now, stale);
    const id = db.prepare("SELECT id FROM agent_tasks WHERE idempotency_key = 'life-stale-final-1'").get().id;
    const res = await recoverStaleTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.recovered, true);
    const row = taskRow(db, id);
    assert.equal(row.status, 'failed');
    assert.equal(row.terminal_state, 'FAILED_FINAL_WITH_RECOVERY_REPORT');
    const run = db.prepare('SELECT detail FROM agent_runs WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.ok(JSON.parse(run.detail).recoveryReport, 'stale-lock final recovery carries a recovery report');
  });

  it('a fresh running task is never recovered', async () => {
    const { db, env } = freshEnv();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('analytics', 'snapshot', '{}', NULL, 5, 'running', 1, 3, 'life-fresh-1', NULL, ?, ?)",
    ).run(now, now);
    const res = await recoverStaleTasks(env);
    assert.equal(res.count, 0);
    assert.equal(res.skipped.length, 1);
  });
});

describe('lifecycle — pre-020 compatibility and idempotency', () => {
  it('runTask still resolves status on a pre-020 database (terminal columns absent)', async () => {
    const { db, env } = freshEnv(false);
    const id = await enqueueAnalytics(env, 'life-pre020-1');
    const res = await runTask(env, id);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'no-op');
    assert.equal(db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(id).status, 'done');
  });

  it('enqueueTask never duplicates: same idempotency_key returns the same task', async () => {
    const { db, env } = freshEnv();
    const a = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'life-dedupe-1' });
    const b = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'life-dedupe-1' });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(b.duplicate, true);
    assert.equal(b.task.id, a.task.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1);
  });

  it('history is never deleted: every attempt leaves its agent_runs + agent_logs rows', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueFailingFactCheck(env, 'life-history-1');
    await runTask(env, id);
    db.prepare('UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?').run(id);
    await runTask(env, id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?').get(id).n, 2, 'one run row per attempt');
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM agent_logs WHERE run_id IN (SELECT id FROM agent_runs WHERE task_id = ?)').get(id).n >= 2);
    assert.equal(taskRow(db, id).terminal_state, 'RETRYING');
  });
});
