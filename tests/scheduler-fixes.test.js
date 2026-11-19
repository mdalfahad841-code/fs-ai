// FS AI — scheduler fixes tests (master implementation, 2026-11-19).
//
// Pins the seven scheduler gaps fixed in the master implementation:
//   (1) research queue pause handling (division-slug -> agent map),
//   (2) daily manual-run duplicate report rows,
//   (3) a publishDueArticles exception must not prevent daily/weekly workflows,
//   (4) scheduler execution + timezone handling (00:00 UTC guard),
//   (5) duplicate workflow execution prevention,
//   (6) safe retry of failed tasks,
//   (7) E-Stop blocks all relevant autonomous operations (covered in
//       tests/autonomy-scheduler.test.js; here we pin the E-Stop + retry
//       interaction instead).
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011/012).
// Run: node --test tests/scheduler-fixes.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runTask, retryTask, runDailyWorkflow, runWeeklyWorkflow,
} = require('../backend/routes/scheduler.js');
const workerModule = require('../backend/worker.js');

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
    if (ch === ';') { stmts.push(cur + ch); cur = ''; continue; }
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
        first: () => Promise.resolve(stmt.get(...params) || null),
        run: () => Promise.resolve((() => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        })()),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        first: () => bound([]).first(),
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
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function setEmergencyStop(db, on) {
  db.prepare(
    "INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES ('emergency_stop', ?, 'Emergency stop for autonomous agent operations.')",
  ).run(on ? '1' : '0');
}

function setAgentStatus(db, registryId, status) {
  const changed = db.prepare('UPDATE ai_agents SET status = ? WHERE slug = ?').run(status, registryId);
  assert.ok(changed.changes >= 1, `ai_agents row for slug ${registryId} must exist`);
}

function taskRow(db, id) {
  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
}

const RESEARCH_AGENT_IDS = [
  'automotive-research', 'technology-research', 'gadget-research',
  'finance-research', 'travel-research', 'digital-tools-agent',
  'health-research', 'education-research',
];

describe('research pause handling (fix 1)', () => {
  it('a paused division research agent makes that division research task skip with 409', async () => {
    const { db, env } = freshEnv();
    setAgentStatus(db, 'automotive-research', 'paused');
    const enqueued = await enqueueTask(env, {
      agent: 'research', kind: 'daily-research',
      payload: { division: 'automotive' }, idempotency_key: 'pause-auto-1',
    });
    const task = enqueued.task;
    const r = await runTask(env, task.id);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.skipped, true);
    assert.match(r.error, /automotive-research is paused/);
    assert.equal(taskRow(db, task.id).status, 'skipped');
    const run = db.prepare('SELECT * FROM agent_runs WHERE task_id = ?').get(task.id);
    assert.equal(run.outcome, 'skipped');
  });

  it('pausing one division does NOT block another division research task', async () => {
    const { db, env } = freshEnv();
    setAgentStatus(db, 'automotive-research', 'paused');
    // Finance research would fetch real RSS over the network, so stub the
    // global fetch to a non-feed response: the handler then fails honestly
    // (no sources fetched) instead of touching the network.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('not a feed', { status: 200 });
    try {
      const enqueued = await enqueueTask(env, {
        agent: 'research', kind: 'daily-research',
        payload: { division: 'finance-money' }, idempotency_key: 'pause-fin-1',
      });
      const task = enqueued.task;
      const r = await runTask(env, task.id);
      assert.notEqual(r.status, 409, 'must not skip: finance-research is active');
      assert.notEqual(taskRow(db, task.id).status, 'skipped');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a division-less research task skips only when EVERY division research agent is paused', async () => {
    const { db, env } = freshEnv();
    for (const id of RESEARCH_AGENT_IDS) setAgentStatus(db, id, 'paused');
    const enqueued = await enqueueTask(env, {
      agent: 'research', kind: 'daily-research',
      payload: {}, idempotency_key: 'pause-all-1',
    });
    const task = enqueued.task;
    const r = await runTask(env, task.id);
    assert.equal(r.status, 409);
    assert.equal(r.skipped, true);
    assert.match(r.error, /all division research agents/);
    assert.equal(taskRow(db, task.id).status, 'skipped');
  });

  it('pausing a research agent does not block an unrelated agent', async () => {
    const { db, env } = freshEnv();
    setAgentStatus(db, 'automotive-research', 'paused');
    const enqueued = await enqueueTask(env, {
      agent: 'analytics', kind: 'run',
      payload: {}, idempotency_key: 'pause-analytics-1',
    });
    const task = enqueued.task;
    const r = await runTask(env, task.id);
    assert.equal(r.ok, true);
    assert.equal(r.outcome, 'no-op', 'analytics with no GA4 source is a no-op — the point is it RAN, not skipped');
    assert.equal(taskRow(db, task.id).status, 'done');
  });
});

describe('safe retry of failed tasks (fix 6)', () => {
  it('a task that fails 3 times becomes failed, retries to queued, and can run again', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'fact-checking', kind: 'fact-check',
      payload: { article_id: 99999 }, idempotency_key: 'retry-fc-1',
    });
    const task = enqueued.task;
    // Attempt 1 and 2: failed, re-queued with backoff.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await runTask(env, task.id);
      assert.equal(r.ok, true);
      assert.equal(r.outcome, 'failed');
      assert.equal(r.requeued, true);
      assert.equal(taskRow(db, task.id).status, 'queued');
    }
    // Attempt 3: max attempts reached -> status failed.
    const third = await runTask(env, task.id);
    assert.equal(third.outcome, 'failed');
    assert.equal(third.requeued, false);
    assert.equal(taskRow(db, task.id).status, 'failed');
    assert.equal(taskRow(db, task.id).attempts, 3);

    const retried = await retryTask(env, task.id);
    assert.equal(retried.ok, true);
    const row = taskRow(db, task.id);
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 0);
    assert.equal(row.scheduled_for, null, 'backoff cleared');

    // It can run again (and fails again on the same bad article id).
    const again = await runTask(env, task.id);
    assert.equal(again.outcome, 'failed');
    assert.equal(again.requeued, true);
    assert.equal(taskRow(db, task.id).attempts, 1);
  });

  it('retryTask refuses non-failed tasks and missing tasks', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'analytics', kind: 'run', payload: {}, idempotency_key: 'retry-refuse-1',
    });
    const task = enqueued.task;
    const queued = await retryTask(env, task.id);
    assert.equal(queued.ok, false);
    assert.equal(queued.status, 409);
    assert.match(queued.error, /only failed tasks/);

    const missing = await retryTask(env, 99999);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);

    const bad = await retryTask(env, 'nope');
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
  });

  it('a task skipped by Emergency Stop cannot be retried (it is not failed)', async () => {
    const { db, env } = freshEnv();
    setEmergencyStop(db, true);
    const enqueued = await enqueueTask(env, {
      agent: 'analytics', kind: 'run', payload: {}, idempotency_key: 'retry-estop-1',
    });
    const task = enqueued.task;
    const r = await runTask(env, task.id);
    assert.equal(r.status, 423);
    assert.equal(taskRow(db, task.id).status, 'skipped');
    const retry = await retryTask(env, task.id);
    assert.equal(retry.ok, false);
    assert.equal(retry.status, 409);
  });
});

describe('duplicate workflow prevention (fixes 2 + 5)', () => {
  it('a second daily run on the same UTC date returns duplicate:true and writes no second row', async () => {
    const { db, env } = freshEnv();
    const first = await runDailyWorkflow(env);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, undefined);
    const reportId = first.reportId;
    assert.ok(reportId, 'first run writes a report row');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);

    const second = await runDailyWorkflow(env);
    assert.equal(second.duplicate, true);
    assert.equal(second.reportId, reportId, 'same report row, not a new one');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);

    const forced = await runDailyWorkflow(env, { force: true });
    assert.equal(forced.duplicate, undefined, 'forced re-run does re-run');
    assert.equal(forced.reportId, reportId, 'forced re-run updates the same row in place');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);
  });

  it('weekly duplicate prevention works the same way', async () => {
    const { db, env } = freshEnv();
    const first = await runWeeklyWorkflow(env);
    assert.equal(first.ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'weekly'").get().n, 1);
    const second = await runWeeklyWorkflow(env);
    assert.equal(second.duplicate, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'weekly'").get().n, 1);
  });
});

describe('worker scheduled() — failure isolation + UTC guard (fixes 3 + 4)', () => {
  const scheduled = workerModule.default && workerModule.default.scheduled
    ? workerModule.default.scheduled
    : workerModule.scheduled;
  const MIDNIGHT_SUNDAY = new Date('2026-11-22T00:00:00Z'); // a Sunday
  const MIDNIGHT_MONDAY = new Date('2026-11-23T00:00:00Z');
  const MIDDAY = new Date('2026-11-19T04:13:00Z'); // 10:13 Dhaka, not midnight UTC

  it('scheduled() exists on the worker default export', () => {
    assert.equal(typeof scheduled, 'function');
  });

  it('at 00:00 UTC on a Sunday it runs daily AND weekly workflows', async () => {
    const { db, env } = freshEnv();
    await scheduled({ scheduledTime: MIDNIGHT_SUNDAY.getTime() }, env, {});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'weekly'").get().n, 1);
  });

  it('at 00:00 UTC on a Monday it runs daily only, not weekly', async () => {
    const { db, env } = freshEnv();
    await scheduled({ scheduledTime: MIDNIGHT_MONDAY.getTime() }, env, {});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'weekly'").get().n, 0);
  });

  it('at a non-midnight hour it runs neither workflow (UTC guard)', async () => {
    const { db, env } = freshEnv();
    await scheduled({ scheduledTime: MIDDAY.getTime() }, env, {});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports").get().n, 0);
  });

  it('a publishDueArticles exception does not prevent the daily workflow', async () => {
    const { db, env } = freshEnv();
    // Wrap the D1 adapter so the publish query throws while everything
    // else works — simulating a publish-stage failure.
    const base = env.DB;
    const failingDb = {
      prepare(sql) {
        if (typeof sql === 'string' && sql.includes('publish_at IS NOT NULL')) {
          throw new Error('simulated publish failure');
        }
        return base.prepare(sql);
      },
    };
    const failingEnv = { DB: failingDb };
    await scheduled({ scheduledTime: MIDNIGHT_MONDAY.getTime() }, failingEnv, {});
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n,
      1,
      'daily report still written even though publish threw',
    );
  });

  it('publishes an approved+due article on the hourly tick', async () => {
    const { db, env } = freshEnv();
    const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const r = db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, publish_at) VALUES (?, 'Due Article', 'due-article', 'x', 'Body text here.', 'FS AI', 'approved', 1, ?)",
    ).run(divisionId, past);
    const articleId = Number(r.lastInsertRowid);
    await scheduled({ scheduledTime: MIDDAY.getTime() }, env, {});
    assert.equal(db.prepare("SELECT status FROM articles WHERE id = ?").get(articleId).status, 'published');
  });
});
