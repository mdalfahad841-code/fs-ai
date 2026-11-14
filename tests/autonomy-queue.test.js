// FS AI — Autonomy task-queue tests.
//
// Queue behaviour against a REAL SQLite database built from
// database/schema.sql + migrations 005 + 006 + database/seed.sql
// (fresh-deploy path) via node:sqlite, behind the same minimal
// D1-compatible adapter as tests/real-db.test.js.
//
// NOTE (pre-existing condition, local test DBs only): migration 004 is
// NOT applied here. database/schema.sql already contains 004's changes
// (articles.publish_at and ai_agents.status), so applying 004 after
// schema.sql fails with a duplicate-column error. The live D1 database
// is unaffected — it was built by the incremental migration chain.
// The orchestrator is exercised directly via handleAutonomy() because
// /api/autonomy is NOT wired into backend/worker.js yet (see
// docs/AUTONOMY-INTEGRATION-PATCH.md).
//
// Run: node --test tests/autonomy-queue.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const { enqueueTask, runTask } = require('../backend/routes/scheduler.js');

const ROOT = path.join(__dirname, '..');
const WORKER_URL = 'http://localhost';

// Split a SQL file into statements: ';' outside single-quoted strings
// ends a statement; '--' starts a line comment (outside strings).
// Copied from tests/real-db.test.js.
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

function autonomyReq(method, pathName, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (body !== undefined) {
    return new Request(`${WORKER_URL}${pathName}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`${WORKER_URL}${pathName}`, { method, headers });
}

async function callAutonomy(env, method, pathName, body) {
  const res = await handleAutonomy(autonomyReq(method, pathName, body), env, {}, null);
  return { status: res.status, body: await res.json() };
}

describe('autonomy task queue — idempotency', () => {
  it('second enqueue with the same idempotency_key returns the existing task, no duplicate row', async () => {
    const { db, env } = freshEnv();
    const first = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'research', kind: 'daily-research',
      payload: { division: 'automotive', sources: [] },
      idempotency_key: 'test-dedupe-1',
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.duplicate, false);
    assert.ok(first.body.task.id, 'first enqueue returns a task id');

    const second = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'research', kind: 'daily-research',
      payload: { division: 'automotive', sources: [] },
      idempotency_key: 'test-dedupe-1',
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.task.id, first.body.task.id, 'duplicate returns the SAME task id');

    const count = db.prepare('SELECT COUNT(*) AS n FROM agent_tasks WHERE idempotency_key = ?').get('test-dedupe-1');
    assert.equal(count.n, 1, 'exactly one row exists for the idempotency key');
  });

  it('enqueueTask directly: duplicate returns the existing row', async () => {
    const { db, env } = freshEnv();
    const a = await enqueueTask(env, { agent: 'seo', kind: 'seo-pass', payload: { article_id: 1 }, idempotency_key: 'direct-dedupe' });
    const b = await enqueueTask(env, { agent: 'seo', kind: 'seo-pass', payload: { article_id: 1 }, idempotency_key: 'direct-dedupe' });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(b.duplicate, true);
    assert.equal(b.task.id, a.task.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1);
  });
});

describe('autonomy task queue — retry bounds', () => {
  // A fact-check for a non-existent article always fails, which is a
  // deterministic way to exercise the retry path without touching the
  // network or an LLM.
  async function failingTask(env) {
    const res = await enqueueTask(env, {
      agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 },
      idempotency_key: 'test-retry-1',
    });
    assert.equal(res.ok, true);
    return res.task.id;
  }

  it('failed task with attempts < max_attempts returns to queued with a future scheduled_for', async () => {
    const { db, env } = freshEnv();
    const id = await failingTask(env);
    const before = Date.now();
    const result = await runTask(env, id);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.requeued, true);
    assert.equal(result.attempts, 1);
    assert.ok(result.scheduled_for, 'requeue sets scheduled_for');
    assert.ok(new Date(result.scheduled_for).getTime() > before, 'scheduled_for is in the future');

    const row = db.prepare('SELECT status, attempts, scheduled_for FROM agent_tasks WHERE id = ?').get(id);
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 1);
    assert.ok(new Date(row.scheduled_for).getTime() > before);
    // The failure is logged: one run + one log row for this task.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?').get(id).n, 1);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM agent_logs WHERE run_id IN (SELECT id FROM agent_runs WHERE task_id = ?)').get(id).n >= 1);
  });

  it('failed task with attempts >= max_attempts stays failed', async () => {
    const { db, env } = freshEnv();
    const id = await failingTask(env);
    // Burn the retries: run once (attempts 1, requeued), then force
    // attempts to max_attempts and run again.
    await runTask(env, id);
    db.prepare('UPDATE agent_tasks SET attempts = 3 WHERE id = ?').run(id);
    const result = await runTask(env, id);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.requeued, false);
    assert.equal(result.attempts, 4);

    const row = db.prepare('SELECT status, attempts FROM agent_tasks WHERE id = ?').get(id);
    assert.equal(row.status, 'failed', 'task stays failed once retries are exhausted');
    assert.equal(row.attempts, 4);
  });

  it('a done task cannot run again (409)', async () => {
    const { env } = freshEnv();
    const res = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {},
      idempotency_key: 'test-rerun-1',
    });
    const first = await runTask(env, res.task.id);
    assert.equal(first.ok, true);
    assert.equal(first.outcome, 'no-op', 'analytics with no source returns no-op, which is a terminal outcome');
    const second = await runTask(env, res.task.id);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
  });
});

describe('autonomy task queue — input validation (400s)', () => {
  it('invalid agent is rejected with 400', async () => {
    const { env } = freshEnv();
    const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'not-an-agent', kind: 'something',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /agent must be one of/);
  });

  it('missing/empty kind is rejected with 400', async () => {
    const { env } = freshEnv();
    const missing = await callAutonomy(env, 'POST', '/api/autonomy/tasks', { agent: 'research' });
    assert.equal(missing.status, 400);
    const empty = await callAutonomy(env, 'POST', '/api/autonomy/tasks', { agent: 'research', kind: '   ' });
    assert.equal(empty.status, 400);
  });

  it('priority outside 1–10 is rejected with 400', async () => {
    const { env } = freshEnv();
    for (const bad of [0, 11, 2.5, 'high']) {
      const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
        agent: 'research', kind: 'daily-research', priority: bad,
      });
      assert.equal(res.status, 400, `priority ${JSON.stringify(bad)} must be rejected`);
    }
    const ok = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'research', kind: 'daily-research', priority: 10,
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.task.priority, 10);
  });

  it('unknown division_id is rejected with 400', async () => {
    const { env } = freshEnv();
    const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'research', kind: 'daily-research', division_id: 99999,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unknown division_id/);
  });

  it('non-existent task id returns 404 on run', async () => {
    const { env } = freshEnv();
    const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks/99999/run', {});
    assert.equal(res.status, 404);
  });
});

describe('autonomy settings — allowlist', () => {
  it("autonomy_level '1'/'2'/'3' are accepted and stored; '4' is rejected", async () => {
    const { db, env } = freshEnv();
    for (const level of ['1', '2', '3']) {
      const res = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'autonomy_level', value: level });
      assert.equal(res.status, 200, `level ${level}: ${JSON.stringify(res.body)}`);
      assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'autonomy_level'").get().value, level);
    }
    const bad = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'autonomy_level', value: '4' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /autonomy_level/);
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'autonomy_level'").get().value, '3',
      'rejected value must not overwrite the stored level');
  });

  it("publishing_mode only accepts 'approved_only'", async () => {
    const { db, env } = freshEnv();
    for (const bad of ['auto', 'approved', 'all', '']) {
      const res = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'publishing_mode', value: bad });
      assert.equal(res.status, 400, `publishing_mode ${JSON.stringify(bad)} must be rejected`);
    }
    const ok = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'publishing_mode', value: 'approved_only' });
    assert.equal(ok.status, 200);
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'publishing_mode'").get().value, 'approved_only');
  });

  it("social_auto_post only accepts 'off'", async () => {
    const { db, env } = freshEnv();
    for (const bad of ['on', 'auto', 'approved']) {
      const res = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'social_auto_post', value: bad });
      assert.equal(res.status, 400, `social_auto_post ${JSON.stringify(bad)} must be rejected`);
    }
    const ok = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'social_auto_post', value: 'off' });
    assert.equal(ok.status, 200);
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'social_auto_post'").get().value, 'off');
  });

  it('max_articles_per_day accepts 0–3 only; unknown keys are rejected', async () => {
    const { db, env } = freshEnv();
    const ok = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'max_articles_per_day', value: 2 });
    assert.equal(ok.status, 200);
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'max_articles_per_day'").get().value, '2');
    for (const bad of [-1, 4, 1.5]) {
      const res = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'max_articles_per_day', value: bad });
      assert.equal(res.status, 400, `max_articles_per_day ${bad} must be rejected`);
    }
    const unknown = await callAutonomy(env, 'POST', '/api/autonomy/settings', { key: 'llm_provider', value: 'groq' });
    assert.equal(unknown.status, 400, 'spending/account keys are never settable through this endpoint');
  });
});

describe('autonomy status — real counts + LLM block', () => {
  it('GET /api/autonomy/status reports real task counts and a paused LLM block with no provider', async () => {
    const { env } = freshEnv();
    await enqueueTask(env, { agent: 'research', kind: 'daily-research', payload: {}, idempotency_key: 'status-1' });
    const res = await callAutonomy(env, 'GET', '/api/autonomy/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.autonomyLevel, '3');
    assert.equal(res.body.tasks.queued, 1);
    assert.equal(res.body.tasks.done, 0);
    assert.equal(res.body.revenue, '$0.00');
    assert.equal(res.body.traffic, 'Data unavailable');
    assert.equal(res.body.publishingMode, 'approved_only');
    assert.equal(res.body.llm.provider, 'none');
    assert.equal(res.body.llm.status, 'paused');
    assert.equal(res.body.llm.generationPaused, true);
    assert.ok(Array.isArray(res.body.agents) && res.body.agents.length === 10, '10 queue-agent roles reported');
  });

  it('GET /api/autonomy/llm reports all three providers not-configured with no keys or binding', async () => {
    const { env } = freshEnv();
    const res = await callAutonomy(env, 'GET', '/api/autonomy/llm');
    assert.equal(res.status, 200);
    assert.equal(res.body.generationPaused, true);
    assert.deepEqual(res.body.order, ['workers-ai', 'groq', 'gemini']);
    assert.ok(res.body.providers.every((p) => p.status === 'not-configured'),
      'no provider is available without a binding or a key');
    assert.match(res.body.reason, /not bound|not set/);
  });
});
