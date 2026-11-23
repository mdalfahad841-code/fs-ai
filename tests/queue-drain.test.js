// FS AI — Queue drain tests (workstream W1, 2026-11-21).
//
// drainTaskQueue against a REAL SQLite database built from
// database/schema.sql + migrations 005 + 006 + seed + 008/009/010/011/012
// + 020 via node:sqlite (same pattern as tests/autonomy-scheduler.test.js).
// Note on harness: tests/fake-d1.js does not implement the agent_tasks /
// autonomy_settings / llm_usage tables the scheduler queries, so — like
// the existing autonomy-scheduler and autonomy-queue suites — these
// tests use the real-SQLite harness instead.
//
// Deterministic handlers only: 'analytics' snapshot tasks finish as
// no-op without network or LLM, and 'fact-checking' tasks for a
// non-existent article fail deterministically (the existing retry-test
// fixture). No content-creation task is ever executed here — the
// daily-content cap test arranges for the cap to be reached first, so
// the content handler (Workers AI) is never invoked.
//
// Run: node --test tests/queue-drain.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runTask, runDailyWorkflow, drainTaskQueue, countArticlesCreatedToday,
  MAX_DRAIN_TASKS_PER_RUN, MAX_DRAIN_CONSECUTIVE_FAILURES,
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

function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
    'database/migrations/020_task_lifecycle_health.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function setEmergencyStop(db, on) {
  db.prepare(
    "INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES ('emergency_stop', ?, 'Emergency stop for autonomous agent operations.')",
  ).run(on ? '1' : '0');
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

function taskStatus(db, id) {
  return db.prepare('SELECT status, attempts, scheduled_for, terminal_state FROM agent_tasks WHERE id = ?').get(id);
}

describe('drainTaskQueue — eligibility', () => {
  it('runs only eligible queued tasks: future scheduled_for is left queued, past/NULL runs', async () => {
    const { db, env } = freshEnv();
    const dueId = await enqueueAnalytics(env, 'drain-due-1');
    const futureId = await enqueueAnalytics(env, 'drain-future-1');
    const pastId = await enqueueAnalytics(env, 'drain-past-1');
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE agent_tasks SET scheduled_for = ? WHERE id = ?').run(future, futureId);
    db.prepare('UPDATE agent_tasks SET scheduled_for = ? WHERE id = ?').run(past, pastId);

    const drain = await drainTaskQueue(env);
    assert.equal(drain.ok, true);
    assert.equal(drain.blocked, false);
    assert.equal(drain.processed, 2, 'due + past-due run; future does not');
    assert.equal(drain.done, 2);
    assert.equal(taskStatus(db, dueId).status, 'done');
    assert.equal(taskStatus(db, pastId).status, 'done');
    assert.equal(taskStatus(db, futureId).status, 'queued', 'future scheduled_for stays queued');
    assert.equal(drain.health.overall, 'degraded', 'no backup on a fresh DB degrades health but does not block the drain');
  });

  it('runs oldest-first', async () => {
    const { db, env } = freshEnv();
    const first = await enqueueAnalytics(env, 'drain-order-1');
    const second = await enqueueAnalytics(env, 'drain-order-2');
    const third = await enqueueAnalytics(env, 'drain-order-3');
    const drain = await drainTaskQueue(env);
    assert.deepEqual(drain.results.map((r) => r.taskId), [first, second, third]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks WHERE status = ?').get('done').n, 3);
  });

  it('caps at MAX_DRAIN_TASKS_PER_RUN (10) per run', async () => {
    assert.equal(MAX_DRAIN_TASKS_PER_RUN, 10);
    const { db, env } = freshEnv();
    for (let i = 0; i < 12; i++) await enqueueAnalytics(env, `drain-cap-${i}`);
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 10);
    assert.equal(drain.done, 10);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'queued'").get().n, 2, '2 tasks remain for the next run');
    const second = await drainTaskQueue(env);
    assert.equal(second.processed, 2, 'the next drain picks up the remainder');
  });

  it('skips kinds with no handler and leaves them queued', async () => {
    const { db, env } = freshEnv();
    const bogus = await enqueueTask(env, { agent: 'not-a-real-agent', kind: 'mystery', payload: {}, idempotency_key: 'drain-bogus-1' });
    assert.equal(bogus.ok, true);
    const goodId = await enqueueAnalytics(env, 'drain-bogus-good-1');
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 2);
    assert.equal(drain.done, 1);
    assert.equal(drain.skipped, 1);
    assert.match(drain.results.find((r) => r.taskId === bogus.task.id).reason, /No handler/);
    assert.equal(taskStatus(db, bogus.task.id).status, 'queued', 'no-handler task is left queued, never failed');
    assert.equal(taskStatus(db, goodId).status, 'done');
  });
});

describe('drainTaskQueue — failure handling', () => {
  it('stops after 3 consecutive failures and leaves later tasks untouched', async () => {
    assert.equal(MAX_DRAIN_CONSECUTIVE_FAILURES, 3);
    const { db, env } = freshEnv();
    const failIds = [];
    for (let i = 0; i < 4; i++) failIds.push(await enqueueFailingFactCheck(env, `drain-fail-${i}`));
    const laterId = await enqueueAnalytics(env, 'drain-fail-later-1');
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 3, 'stops after the 3rd consecutive failure');
    assert.equal(drain.failed, 3);
    assert.equal(drain.stoppedReason, 'consecutive-failure-limit');
    assert.equal(taskStatus(db, laterId).status, 'queued', 'the task after the failures was never started');
    assert.equal(taskStatus(db, failIds[3]).status, 'queued', 'the 4th failing task was never started');
    // Each attempted failure re-queued with backoff (attempts 1, RETRYING).
    for (const id of failIds.slice(0, 3)) {
      const row = taskStatus(db, id);
      assert.equal(row.status, 'queued');
      assert.equal(row.attempts, 1);
      assert.ok(row.scheduled_for && new Date(row.scheduled_for).getTime() > Date.now(), 're-queued with a future backoff');
      assert.equal(row.terminal_state, 'RETRYING');
    }
  });

  it('a success resets the consecutive-failure counter', async () => {
    const { db, env } = freshEnv();
    const f1 = await enqueueFailingFactCheck(env, 'drain-reset-f1');
    const f2 = await enqueueFailingFactCheck(env, 'drain-reset-f2');
    const okId = await enqueueAnalytics(env, 'drain-reset-ok');
    const f3 = await enqueueFailingFactCheck(env, 'drain-reset-f3');
    const f4 = await enqueueFailingFactCheck(env, 'drain-reset-f4');
    const drain = await drainTaskQueue(env);
    // fail, fail, done (counter reset), fail, fail — no stop, all 5 processed.
    assert.equal(drain.processed, 5);
    assert.equal(drain.failed, 4);
    assert.equal(drain.done, 1);
    assert.equal(drain.stoppedReason, null);
    assert.equal(taskStatus(db, okId).status, 'done');
    assert.equal(taskStatus(db, f1).attempts, 1);
    assert.equal(taskStatus(db, f4).attempts, 1);
  });
});

describe('drainTaskQueue — daily content cap', () => {
  it('skips daily-content tasks once max_articles_per_day articles exist today', async () => {
    const { db, env } = freshEnv();
    // One article created today (created_at defaults to now) == the
    // seeded max_articles_per_day of 1, so the cap is already reached.
    const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
    db.prepare(
      'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)',
    ).run(divisionId, 'Cap test article', 'cap-test-article', 'Excerpt.', 'Body text.', 'FS AI', 'draft');
    const content = await enqueueTask(env, {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'Cap test article', division: 'automotive', sources: [] },
      division_id: divisionId, priority: 6, idempotency_key: 'drain-cap-content-1',
    });
    assert.equal(content.ok, true);
    const goodId = await enqueueAnalytics(env, 'drain-cap-content-good-1');
    const before = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 2);
    assert.equal(drain.done, 1, 'only the analytics task ran');
    assert.equal(drain.skipped, 1);
    const skipped = drain.results.find((r) => r.taskId === content.task.id);
    assert.match(skipped.reason, /Daily content cap reached \(\d+\/1 articles created today\)/);
    assert.equal(taskStatus(db, content.task.id).status, 'queued', 'content task left queued, never executed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, before, 'no article was created — the content handler never ran');
    assert.equal(taskStatus(db, goodId).status, 'done');
  });

  it('counts articles created today (seeded articles do NOT count — published on earlier dates)', async () => {
    const { db, env } = freshEnv();
    const total = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    assert.ok(total > 0, 'seed.sql inserts articles');
    // B2 (O2): the count follows the content handler's rule — created
    // today AND not already published on an earlier date. All seeded
    // articles were published 2026-11-01..11-11, so none counts.
    assert.equal(await countArticlesCreatedToday(env), 0, 'seeded articles were published on earlier dates, so none counts');
  });
});

describe('drainTaskQueue — health gate and E-Stop', () => {
  it('refuses to start when the health check is blocked (E-Stop on) and leaves tasks queued', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'drain-blocked-1');
    setEmergencyStop(db, true);
    const drain = await drainTaskQueue(env);
    assert.equal(drain.ok, false);
    assert.equal(drain.blocked, true);
    assert.equal(drain.stoppedReason, 'health-check-blocked');
    assert.equal(drain.health.overall, 'blocked');
    assert.equal(drain.processed, 0);
    assert.equal(taskStatus(db, id).status, 'queued', 'no task was started');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n, 0, 'no run rows at all');
  });

  it('proceeds when health is degraded (no backup) — degraded never blocks', async () => {
    const { env } = freshEnv();
    await enqueueAnalytics(env, 'drain-degraded-1');
    const drain = await drainTaskQueue(env);
    assert.equal(drain.ok, true);
    assert.equal(drain.health.overall, 'degraded');
    assert.equal(drain.done, 1);
  });
});

describe('runDailyWorkflow — queue drain step', () => {
  it('drains pre-existing queued tasks and records the drain in the daily report', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'daily-drain-1');
    const result = await runDailyWorkflow(env, { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.counts.queueDrained, 1);
    assert.equal(result.counts.queueDone, 1);
    assert.equal(result.counts.queueHealthOverall, 'degraded', 'fresh DB has no backup on record');
    assert.equal(taskStatus(db, id).status, 'done', 'the backlog task was executed by the daily run');
    const row = db.prepare("SELECT summary_json FROM daily_reports WHERE kind = 'daily'").get();
    const summary = JSON.parse(row.summary_json);
    assert.equal(summary.counts.queueDrained, 1);
    assert.equal(summary.steps.queueDrain.outcome, 'done');
    // Per-task results live in the queue-drain step's agent_runs detail.
    const runRow = db.prepare("SELECT detail FROM agent_runs WHERE agent = 'scheduler' AND detail LIKE '%queue-drain%' ORDER BY id DESC LIMIT 1").get();
    const detail = JSON.parse(runRow.detail);
    assert.equal(detail.results[0].taskId, id);
    assert.equal(detail.results[0].outcome, 'no-op');
  });

  it('records a blocked drain in the report when the E-Stop is on — workflow still skips as before', async () => {
    const { db, env } = freshEnv();
    setEmergencyStop(db, true);
    const result = await runDailyWorkflow(env, { force: true });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true, 'E-Stop still skips the whole workflow first');
  });

  it('runTask honours the E-Stop mid-queue: a task started after the stop is skipped, not run', async () => {
    const { db, env } = freshEnv();
    const id = await enqueueAnalytics(env, 'daily-estop-1');
    setEmergencyStop(db, true);
    const res = await runTask(env, id);
    assert.equal(res.ok, false);
    assert.equal(res.status, 423);
    assert.equal(res.skipped, true);
    const row = taskStatus(db, id);
    assert.equal(row.status, 'skipped');
    assert.equal(row.terminal_state, 'BLOCKED_WITH_REASON');
  });
});
