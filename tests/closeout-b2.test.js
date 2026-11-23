// FS AI — Close-out B2 tests (2026-11-23).
//
// O1: drainTaskQueue pages past skipped tasks — a skip no longer
// consumes one of the MAX_DRAIN_TASKS_PER_RUN (10) attempted slots.
// O2: countArticlesCreatedToday follows the content handler's rule
// (created today AND not already published on an earlier date).
//
// Same REAL-SQLite harness as tests/queue-drain.test.js
// (database/schema.sql + migrations 005 + 006 + seed + 008/009/010/011/
// 012 + 020 via node:sqlite). Deterministic handlers only — never
// Workers AI / the network. Content tasks use a title that fails
// handler validation BEFORE any LLM call ('Abc', under 5 chars —
// runContentCreation returns the title error immediately).
//
// Run: node --test tests/closeout-b2.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, drainTaskQueue, countArticlesCreatedToday,
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

async function enqueueAnalytics(env, key) {
  const res = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: key });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.task.id;
}

async function enqueueNoHandler(env, key) {
  const res = await enqueueTask(env, { agent: 'not-a-real-agent', kind: 'mystery', payload: {}, idempotency_key: key });
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

async function enqueueDailyContent(env, key, title) {
  const divisionId = 1; // automotive — seed division id 1
  const res = await enqueueTask(env, {
    agent: 'content-creation', kind: 'daily-content',
    payload: { title, division: 'automotive', sources: [] },
    division_id: divisionId, priority: 6, idempotency_key: key,
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.task.id;
}

function taskStatus(db, id) {
  return db.prepare('SELECT status, attempts, scheduled_for, terminal_state FROM agent_tasks WHERE id = ?').get(id);
}

describe('B2.1 — O1: no-handler skips do not consume drain slots', () => {
  it('10 no-handler tasks first + 10 analytics: one drain runs all 10 analytics', async () => {
    const { db, env } = freshEnv();
    const bogusIds = [];
    for (let i = 0; i < 10; i++) bogusIds.push(await enqueueNoHandler(env, `b2-1-bogus-${i}`));
    const goodIds = [];
    for (let i = 0; i < 10; i++) goodIds.push(await enqueueAnalytics(env, `b2-1-good-${i}`));

    const drain = await drainTaskQueue(env);
    assert.equal(drain.ok, true);
    assert.equal(drain.done, 10, 'all 10 analytics tasks ran');
    assert.equal(drain.skipped, 10, 'all 10 no-handler tasks skipped');
    assert.equal(drain.processed, 20, 'processed may exceed maxTasks when skips occurred');
    assert.equal(drain.stoppedReason, null);
    for (const id of goodIds) assert.equal(taskStatus(db, id).status, 'done');
    for (const id of bogusIds) assert.equal(taskStatus(db, id).status, 'queued', 'no-handler tasks stay queued, never failed');
  });
});

describe('B2.2 — O1: cap skips do not consume drain slots', () => {
  it('cap reached by a genuine same-day draft: content tasks skip, analytics still run', async () => {
    const { db, env } = freshEnv();
    // One draft created today, never published — counts under the new
    // rule, so the default max_articles_per_day of 1 is already reached.
    const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
    db.prepare(
      'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)',
    ).run(divisionId, 'B2 cap article', 'b2-cap-article', 'Excerpt.', 'Body text.', 'FS AI', 'draft');
    assert.equal(await countArticlesCreatedToday(env), 1, 'the same-day draft counts');

    const contentIds = [];
    for (let i = 0; i < 2; i++) contentIds.push(await enqueueDailyContent(env, `b2-2-content-${i}`, `B2 cap task ${i} title`));
    const goodIds = [];
    for (let i = 0; i < 2; i++) goodIds.push(await enqueueAnalytics(env, `b2-2-good-${i}`));

    const before = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 4);
    assert.equal(drain.done, 2, 'both analytics tasks ran');
    assert.equal(drain.skipped, 2, 'both content tasks cap-skipped');
    assert.equal(drain.stoppedReason, null);
    for (const id of contentIds) {
      const skipped = drain.results.find((r) => r.taskId === id);
      assert.match(skipped.reason, /Daily content cap reached \(1\/1 articles created today\)/);
      assert.equal(taskStatus(db, id).status, 'queued', 'content task left queued, never executed');
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, before, 'no article was created — the content handler never ran');
    for (const id of goodIds) assert.equal(taskStatus(db, id).status, 'done');
  });
});

describe('B2.3 — O1: order is preserved across pages', () => {
  it('3 no-handler + 12 analytics: first drain does 10 analytics in order, second drain the rest', async () => {
    const { db, env } = freshEnv();
    const bogusIds = [];
    for (let i = 0; i < 3; i++) bogusIds.push(await enqueueNoHandler(env, `b2-3-bogus-${i}`));
    const goodIds = [];
    for (let i = 0; i < 12; i++) goodIds.push(await enqueueAnalytics(env, `b2-3-good-${i}`));

    const first = await drainTaskQueue(env);
    assert.equal(first.done, 10);
    assert.equal(first.skipped, 3);
    assert.equal(first.processed, 13);
    assert.equal(first.stoppedReason, null);
    assert.deepEqual(
      first.results.map((r) => r.taskId),
      [...bogusIds, ...goodIds.slice(0, 10)],
      'the 3 skips in id order, then 10 analytics in id order',
    );
    const second = await drainTaskQueue(env);
    assert.equal(second.done, 2, 'the remaining 2 analytics run on the next drain');
    assert.equal(second.skipped, 3, 'the 3 no-handler tasks are re-examined and skipped again');
    assert.equal(second.processed, 5, '3 re-examined skips + 2 analytics');
    assert.deepEqual(second.results.map((r) => r.taskId), [...bogusIds, ...goodIds.slice(10)]);
    for (const id of goodIds) assert.equal(taskStatus(db, id).status, 'done');
    for (const id of bogusIds) assert.equal(taskStatus(db, id).status, 'queued');
  });
});

describe('B2.4 — O1: consecutive-failure stop survives paging', () => {
  it('2 no-handler + 3 failing fact-checks + 1 analytics: stops after the 3rd failure, analytics untouched', async () => {
    const { db, env } = freshEnv();
    const bogusIds = [];
    for (let i = 0; i < 2; i++) bogusIds.push(await enqueueNoHandler(env, `b2-4-bogus-${i}`));
    const failIds = [];
    for (let i = 0; i < 3; i++) failIds.push(await enqueueFailingFactCheck(env, `b2-4-fail-${i}`));
    const laterId = await enqueueAnalytics(env, 'b2-4-later-1');

    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 5, '2 skips + 3 failures; the analytics task was never examined');
    assert.equal(drain.failed, 3);
    assert.equal(drain.skipped, 2);
    assert.equal(drain.stoppedReason, 'consecutive-failure-limit');
    assert.equal(taskStatus(db, laterId).status, 'queued', 'the analytics task after the failures was never started');
    for (const id of failIds) assert.equal(taskStatus(db, id).attempts, 1);
    for (const id of bogusIds) assert.equal(taskStatus(db, id).status, 'queued');
  });
});

describe('B2.5 — O2: seeded articles do not count', () => {
  it('fresh seed: countArticlesCreatedToday is 0', async () => {
    const { db, env } = freshEnv();
    const total = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    assert.equal(total, 25, 'seed.sql inserts 25 articles');
    // All 25 were published on earlier dates (2026-11-01..11-11), so
    // under the handler's rule none counts — the old rule counted 25
    // and cap-skipped every content task on a fresh seed DB.
    assert.equal(await countArticlesCreatedToday(env), 0);
  });
});

describe('B2.6 — O2: counting cases', () => {
  it('draft today counts, published today counts, published earlier does not — total 2', async () => {
    const { db, env } = freshEnv();
    assert.equal(await countArticlesCreatedToday(env), 0, 'seed only: 0');
    const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
    // (a) draft, published_at NULL, created today → counts.
    db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, datetime('now'))",
    ).run(divisionId, 'B2 case A draft', 'b2-case-a-draft', 'Excerpt.', 'Body text.', 'FS AI', 'draft');
    // (b) published today → counts.
    db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, date('now'), NULL, datetime('now'))",
    ).run(divisionId, 'B2 case B published today', 'b2-case-b-published-today', 'Excerpt.', 'Body text.', 'FS AI', 'published');
    // (c) created today but published on an earlier date → does NOT count.
    db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '2026-11-01', NULL, datetime('now'))",
    ).run(divisionId, 'B2 case C published earlier', 'b2-case-c-published-earlier', 'Excerpt.', 'Body text.', 'FS AI', 'published');
    assert.equal(await countArticlesCreatedToday(env), 2, 'only (a) and (b) count');
  });
});

describe('B2.7 — O2: drain level — the exact live case', () => {
  it('seed only + one daily-content task: the content task is ATTEMPTED, not cap-skipped', async () => {
    const { db, env } = freshEnv();
    assert.equal(await countArticlesCreatedToday(env), 0, 'seed only: cap not reached');
    // 'Abc' fails runContentCreation validation (title < 5 chars)
    // BEFORE any LLM call — so the task fails fast, deterministically.
    const contentId = await enqueueDailyContent(env, 'b2-7-content-1', 'Abc');
    const goodId = await enqueueAnalytics(env, 'b2-7-good-1');
    const before = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;

    const drain = await drainTaskQueue(env);
    assert.equal(drain.ok, true);
    assert.equal(drain.processed, 2);
    assert.equal(drain.done, 1, 'the analytics task ran');
    assert.equal(drain.failed, 1, 'the content task was attempted and failed on validation');
    assert.equal(drain.skipped, 0, 'nothing was cap-skipped — under the old rule this task would have been skipped (25 >= 1)');
    const contentResult = drain.results.find((r) => r.taskId === contentId);
    assert.equal(contentResult.outcome, 'failed');
    assert.match(contentResult.reason, /at least 5 characters/, 'the title-validation error, not a cap message');
    assert.equal(taskStatus(db, goodId).status, 'done');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, before, 'no article was created');
  });
});
