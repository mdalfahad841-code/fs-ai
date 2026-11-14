// FS AI — Autonomy scheduler tests.
//
// runDailyWorkflow / runWeeklyWorkflow / runTask against a REAL SQLite
// database built from database/schema.sql + migrations 005 + 006 +
// database/seed.sql via node:sqlite (same pattern as
// tests/real-db.test.js). Each test asserts real DB state.
//
// NOTE (pre-existing condition, local test DBs only): migration 004 is
// NOT applied here. database/schema.sql already contains 004's changes
// (articles.publish_at and ai_agents.status), so applying 004 after
// schema.sql fails with a duplicate-column error. The live D1 database
// is unaffected — it was built by the incremental migration chain.
//
// KNOWN ISSUE (documented, not fixed here — scheduler.js is owned by
// another worker): runDailyWorkflow writes one daily_reports row per
// invocation and re-runs its steps each time, so an hourly cron would
// write 24 rows/day. The integration patch
// (docs/AUTONOMY-INTEGRATION-PATCH.md) guards the daily call to
// 00:00 UTC. The test below pins the current behaviour: task enqueues
// are idempotent across runs, but the report row is NOT deduplicated.
//
// Run: node --test tests/autonomy-scheduler.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runTask, runDailyWorkflow, runWeeklyWorkflow, todayStr,
} = require('../backend/routes/scheduler.js');
const { publishDueArticles } = require('../backend/routes/admin-articles.js');

const ROOT = path.join(__dirname, '..');

// Split a SQL file into statements (copied from tests/real-db.test.js).
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

// Minimal D1-compatible adapter over node:sqlite (copied from
// tests/real-db.test.js).
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

// Fresh real DB per test: schema + autonomy migrations 005/006 + seed.
// Migration 004 is deliberately NOT applied (see the header note).
function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, opts) {
  const {
    title, slug, status = 'draft', publishAt = null,
    body = 'Body text. ', excerpt = 'Excerpt.',
  } = opts;
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)',
  ).run(divisionId, title, slug, excerpt, body, 'FS AI', status, publishAt);
  return Number(r.lastInsertRowid);
}

function setEmergencyStop(db, on) {
  db.prepare(
    "INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES ('emergency_stop', ?, 'Emergency stop for autonomous agent operations.')",
  ).run(on ? '1' : '0');
}

function countDailyReports(db, kind) {
  return db.prepare('SELECT COUNT(*) AS n FROM daily_reports WHERE kind = ?').get(kind).n;
}

describe('daily workflow', () => {
  it('one run writes exactly one daily_reports row with real counts', async () => {
    const { db, env } = freshEnv();
    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, undefined, 'not skipped when Emergency Stop is off');
    assert.equal(result.date, todayStr());
    assert.ok(result.reportId, 'a report row id is returned');

    assert.equal(countDailyReports(db, 'daily'), 1, 'exactly one daily report row');
    const row = db.prepare("SELECT * FROM daily_reports WHERE kind = 'daily'").get();
    assert.equal(row.date, todayStr());
    const summary = JSON.parse(row.summary_json);
    assert.equal(summary.kind, 'daily');
    assert.equal(summary.revenueFormatted, '$0.00');
    assert.equal(summary.traffic, 'Data unavailable');
    assert.ok(summary.steps.healthCheck && summary.steps.topicSelection, 'workflow steps are recorded');
    assert.equal(summary.counts.researchEnqueued, 2, 'research enqueued for the two thinnest divisions');
    assert.equal(summary.counts.published, 0, 'nothing due to publish in the seeded data');

    const researchTasks = db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE kind = 'daily-research'").get().n;
    assert.equal(researchTasks, 2);
    const keys = db.prepare("SELECT idempotency_key FROM agent_tasks WHERE kind = 'daily-research'").all()
      .map((r) => r.idempotency_key);
    assert.ok(keys.every((k) => k.startsWith('daily-research-') && k.endsWith(`-${todayStr()}`)),
      'research tasks carry per-day idempotency keys');
  });

  it('running it twice does not duplicate tasks for the same day (but writes a second report row — known issue)', async () => {
    const { db, env } = freshEnv();
    const first = await runDailyWorkflow(env);
    assert.equal(first.ok, true);
    const tasksAfterFirst = db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n;
    const second = await runDailyWorkflow(env);
    assert.equal(second.ok, true);
    const tasksAfterSecond = db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n;

    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE kind = 'daily-research'").get().n,
      2, 'research tasks are idempotent: still 2 after the second run');
    assert.equal(tasksAfterSecond, tasksAfterFirst,
      'total task count is stable across the two runs');
    // KNOWN ISSUE: the report row is NOT deduplicated — the second run
    // writes a second daily_reports row. The integration patch guards
    // the daily call to 00:00 UTC so this happens once a day, not 24
    // times. If scheduler.js ever deduplicates the row, this assertion
    // must be updated to expect 1 — do not weaken it silently.
    assert.equal(countDailyReports(db, 'daily'), 2,
      'KNOWN ISSUE: second run writes a second daily report row (see header note)');
  });

  it('publishes only approved+due articles inside the daily run; draft/pending_approval untouched', async () => {
    const { db, env } = freshEnv();
    const dueApproved = insertArticle(db, {
      title: 'Daily Due Approved', slug: 'daily-due-approved',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const draftDue = insertArticle(db, {
      title: 'Daily Draft Due', slug: 'daily-draft-due',
      status: 'draft', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const pendingDue = insertArticle(db, {
      title: 'Daily Pending Due', slug: 'daily-pending-due',
      status: 'pending_approval', publishAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.published, 1, 'exactly one article published by the daily run');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(dueApproved).status, 'published');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(draftDue).status, 'draft');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(pendingDue).status, 'pending_approval');
  });

  it('publish-due directly: only approved articles with a passed publish_at publish', async () => {
    const { db, env } = freshEnv();
    const due = insertArticle(db, {
      title: 'Direct Due', slug: 'direct-due', status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const future = insertArticle(db, {
      title: 'Direct Future', slug: 'direct-future', status: 'approved', publishAt: '2999-01-01T00:00:00.000Z',
    });
    const noDate = insertArticle(db, {
      title: 'Direct No Date', slug: 'direct-no-date', status: 'approved', publishAt: null,
    });
    const result = await publishDueArticles(env);
    assert.equal(result.ok, true);
    assert.equal(result.published, 1);
    assert.deepEqual(result.slugs, ['direct-due']);
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(due).status, 'published');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(future).status, 'approved');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(noDate).status, 'approved');
  });
});

describe('daily workflow — Emergency Stop', () => {
  it('Emergency Stop on: workflow returns skipped, writes no report row, publishes nothing', async () => {
    const { db, env } = freshEnv();
    const dueApproved = insertArticle(db, {
      title: 'Stop Due Approved', slug: 'stop-due-approved',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    setEmergencyStop(db, true);

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.reason, /Emergency Stop/);
    assert.equal(countDailyReports(db, 'daily'), 0, 'no report row while stopped');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 0, 'no tasks enqueued while stopped');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(dueApproved).status, 'approved',
      'the due article was NOT published while stopped');
    const skipRun = db.prepare("SELECT * FROM agent_runs WHERE agent = 'scheduler' AND outcome = 'skipped'").get();
    assert.ok(skipRun, 'the skip is logged as an agent_runs row');
  });

  it('Emergency Stop on: runTask skips the task with 423 and records the skip', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {},
      idempotency_key: 'test-stop-runtask-1',
    });
    setEmergencyStop(db, true);
    const result = await runTask(env, enqueued.task.id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 423);
    assert.equal(result.skipped, true);
    assert.equal(db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(enqueued.task.id).status, 'skipped');
    const run = db.prepare('SELECT * FROM agent_runs WHERE task_id = ?').get(enqueued.task.id);
    assert.ok(run && run.outcome === 'skipped', 'skip recorded in agent_runs');
  });
});

describe('runTask — claim, execute, record', () => {
  it('claims a queued task, executes it, and records run + log rows', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {},
      idempotency_key: 'test-runtask-1',
    });
    assert.equal(enqueued.task.status, 'queued');
    assert.equal(enqueued.task.attempts, 0);

    const result = await runTask(env, enqueued.task.id);
    assert.equal(result.ok, true);
    assert.equal(result.taskId, enqueued.task.id);
    assert.equal(result.outcome, 'no-op', 'analytics with no source is a no-op, not a failure');
    assert.equal(result.attempts, 1);
    assert.equal(result.requeued, false);
    assert.ok(result.runId);

    const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(enqueued.task.id);
    assert.equal(task.status, 'done', 'a no-op outcome still completes the task');
    assert.equal(task.attempts, 1);
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(result.runId);
    assert.ok(run);
    assert.equal(run.agent, 'analytics');
    assert.equal(run.outcome, 'no-op');
    const logs = db.prepare('SELECT * FROM agent_logs WHERE run_id = ?').all(result.runId);
    assert.ok(logs.length >= 1, 'at least one log row for the run');
    assert.match(logs[0].message, /finished: no-op/);
  });
});

describe('weekly workflow', () => {
  it('writes a weekly report row with real counts from D1', async () => {
    const { db, env } = freshEnv();
    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.date, todayStr());
    assert.ok(result.reportId);

    assert.equal(countDailyReports(db, 'weekly'), 1, 'exactly one weekly report row');
    const row = db.prepare("SELECT * FROM daily_reports WHERE kind = 'weekly'").get();
    assert.equal(row.date, todayStr());
    const summary = JSON.parse(row.summary_json);
    assert.equal(summary.kind, 'weekly');
    assert.equal(summary.totalArticles, 25, 'total articles from the real DB');
    assert.equal(summary.publishedArticles, 25, 'published articles from the real DB');
    assert.equal(summary.articlesByDivision.length, 8, 'one entry per division');
    assert.ok(Array.isArray(summary.failedTasks));
    assert.equal(summary.failedTaskCount, 0, 'no failed tasks in a fresh DB');
    assert.equal(summary.revenueFormatted, '$0.00');
    assert.equal(summary.traffic, 'Data unavailable');
    assert.ok(summary.topDivisions.length <= 3);
    // The weekly run itself is logged.
    const run = db.prepare("SELECT * FROM agent_runs WHERE agent = 'scheduler' AND outcome = 'done'").get();
    assert.ok(run, 'weekly run logged in agent_runs');
  });

  it('weekly report reflects real failed tasks when they exist', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 },
      idempotency_key: 'test-weekly-failed-1',
    });
    db.prepare('UPDATE agent_tasks SET attempts = 3 WHERE id = ?').run(enqueued.task.id);
    const ran = await runTask(env, enqueued.task.id);
    assert.equal(ran.outcome, 'failed');
    assert.equal(db.prepare("SELECT status FROM agent_tasks WHERE id = ?").get(enqueued.task.id).status, 'failed');

    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);
    const summary = JSON.parse(db.prepare("SELECT summary_json FROM daily_reports WHERE kind = 'weekly'").get().summary_json);
    assert.equal(summary.failedTaskCount, 1);
    assert.equal(summary.failedTasks[0].id, enqueued.task.id);
    assert.equal(summary.failedTasks[0].agent, 'fact-checking');
  });
});
