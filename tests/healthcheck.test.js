// FS AI — Daily self-health check tests (workstream W1, 2026-11-21).
//
// runHealthCheck against a REAL SQLite database built from
// database/schema.sql + migrations 005 + 006 + seed + 008/009/010/011/012
// + 020 via node:sqlite (same pattern as tests/autonomy-scheduler.test.js).
// Migration 020 is applied here so persistence into system_health_checks
// is exercised; one test builds the DB WITHOUT 020 to prove the check
// still returns a result (persisted: false) on a pre-020 database.
//
// The check makes NO LLM calls and NO paid calls: Workers AI
// availability is judged from llm_usage recency + registry config only.
//
// Run: node --test tests/healthcheck.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runHealthCheck, classifyHealthOverall, latestHealthChecks } = require('../backend/services/healthcheck.js');

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

const BASE_FILES = [
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

function freshEnv(withMigration020 = true) {
  const files = withMigration020 ? [...BASE_FILES, 'database/migrations/020_task_lifecycle_health.sql'] : BASE_FILES;
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

function setEmergencyStop(db, on) {
  db.prepare(
    "INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES ('emergency_stop', ?, 'Emergency stop for autonomous agent operations.')",
  ).run(on ? '1' : '0');
}

function checkByName(result, component) {
  return result.checks.find((c) => c.component === component);
}

describe('runHealthCheck — overall classification', () => {
  it('reports every component and persists one row per component (overall degraded: no backup has ever run)', async () => {
    const { db, env } = freshEnv();
    const result = await runHealthCheck(env);
    assert.equal(result.overall, 'degraded', 'only the never-backed-up check degrades a fresh DB');
    assert.equal(result.persisted, true, 'rows persisted to system_health_checks');
    assert.equal(result.checks.length, 10, 'one check per component');
    for (const c of result.checks) {
      assert.ok(['healthy', 'degraded', 'blocked', 'not-configured'].includes(c.status), `${c.component} has a valid status`);
      assert.ok(c.checkedAt, `${c.component} carries checkedAt`);
      assert.equal(typeof c.detail, 'object');
    }
    // Social has no integration tables in this codebase.
    assert.equal(checkByName(result, 'social').status, 'not-configured');
    // No backup has ever run on a fresh DB.
    assert.equal(checkByName(result, 'backup').status, 'degraded');
    const stored = db.prepare('SELECT COUNT(*) AS n FROM system_health_checks').get().n;
    assert.equal(stored, 10, 'one persisted row per check');
    const latest = await latestHealthChecks(env, 3);
    assert.equal(latest.length, 3);
    assert.ok(latest[0].component && latest[0].status);
  });

  it('classifyHealthOverall: blocked wins, then degraded, not-configured is neutral', () => {
    assert.equal(classifyHealthOverall([{ status: 'healthy' }, { status: 'not-configured' }]), 'healthy');
    assert.equal(classifyHealthOverall([{ status: 'healthy' }, { status: 'degraded' }]), 'degraded');
    assert.equal(classifyHealthOverall([{ status: 'degraded' }, { status: 'blocked' }]), 'blocked');
    assert.equal(classifyHealthOverall([]), 'healthy');
  });

  it('blocked when the Emergency Stop is on', async () => {
    const { db, env } = freshEnv();
    setEmergencyStop(db, true);
    const result = await runHealthCheck(env);
    assert.equal(result.overall, 'blocked');
    assert.equal(checkByName(result, 'emergency-stop').status, 'blocked');
    assert.match(checkByName(result, 'emergency-stop').detail.reason, /Emergency Stop is ON/);
  });

  it('blocked when D1 is not bound, without throwing', async () => {
    const result = await runHealthCheck({});
    assert.equal(result.overall, 'blocked');
    assert.equal(result.checks[0].component, 'database');
    assert.equal(result.checks[0].status, 'blocked');
    assert.equal(result.persisted, false);
  });

  it('healthy overall once a recent successful backup exists', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO backup_runs (started_at, finished_at, status, tables_exported, rows_exported, bytes_exported, error, created_at) VALUES (datetime('now'), datetime('now'), 'success', 25, 1000, 800000, NULL, datetime('now'))",
    ).run();
    const result = await runHealthCheck(env);
    assert.equal(result.overall, 'healthy');
    assert.equal(checkByName(result, 'backup').status, 'healthy');
  });

  it('still returns a result (persisted: false) on a pre-020 database', async () => {
    const { env } = freshEnv(false);
    const result = await runHealthCheck(env);
    assert.equal(result.overall, 'degraded', 'backup check still degrades without a backup on record');
    assert.equal(result.persisted, false, 'no system_health_checks table yet');
    assert.equal(result.checks.length, 10);
  });
});

describe('runHealthCheck — per-component behaviour', () => {
  it('degraded when a running task is stale (older than the 10-minute lease)', async () => {
    const { db, env } = freshEnv();
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('analytics', 'snapshot', '{}', NULL, 5, 'running', 1, 3, 'health-stale-1', NULL, ?, ?)",
    ).run(now, stale);
    const result = await runHealthCheck(env);
    assert.equal(result.overall, 'degraded');
    const queue = checkByName(result, 'queue');
    assert.equal(queue.status, 'degraded');
    assert.equal(queue.detail.stale, 1);
    assert.equal(queue.detail.running, 1);
  });

  it('degraded when today\'s Neuron usage reaches 80% of the cap, never blocked', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, error, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-120b', 'test', 'ok', 0, 0, 7200, NULL, datetime('now'))",
    ).run();
    const result = await runHealthCheck(env);
    assert.equal(checkByName(result, 'workers-ai').status, 'degraded');
    assert.equal(checkByName(result, 'free-tier').status, 'degraded');
    assert.equal(checkByName(result, 'free-tier').detail.neuronsToday, 7200);
    assert.equal(checkByName(result, 'free-tier').detail.percentUsed, 80);
    assert.notEqual(result.overall, 'blocked', 'cap pressure degrades, it never blocks the drain');
  });

  it('free-tier at cap stays degraded (not blocked) and reports 0 remaining', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, error, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-120b', 'test', 'ok', 0, 0, 9000, NULL, datetime('now'))",
    ).run();
    const result = await runHealthCheck(env);
    assert.equal(checkByName(result, 'free-tier').status, 'degraded');
    assert.equal(checkByName(result, 'free-tier').detail.remaining, 0);
    assert.notEqual(result.overall, 'blocked');
  });

  it('makes no LLM call: works with no AI binding on the env', async () => {
    const { env } = freshEnv();
    assert.equal(env.AI, undefined, 'no AI binding present in this test env');
    const result = await runHealthCheck(env);
    assert.equal(checkByName(result, 'workers-ai').status, 'healthy');
    assert.ok(checkByName(result, 'workers-ai').detail.providerOrder, 'provider order read from settings, not probed');
  });

  it('backup healthy when a recent successful backup exists', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO backup_runs (started_at, finished_at, status, tables_exported, rows_exported, bytes_exported, error, created_at) VALUES (datetime('now'), datetime('now'), 'success', 25, 1000, 800000, NULL, datetime('now'))",
    ).run();
    const result = await runHealthCheck(env);
    assert.equal(checkByName(result, 'backup').status, 'healthy');
    assert.equal(checkByName(result, 'backup').detail.status, 'success');
  });

  it('backup degraded when the latest run failed', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO backup_runs (started_at, finished_at, status, tables_exported, rows_exported, bytes_exported, error, created_at) VALUES (datetime('now'), datetime('now'), 'failed', 0, 0, 0, 'disk full', datetime('now'))",
    ).run();
    const result = await runHealthCheck(env);
    assert.equal(checkByName(result, 'backup').status, 'degraded');
  });

  it('publishing check reports the live mode without changing it', async () => {
    const { env } = freshEnv();
    const result = await runHealthCheck(env);
    const pub = checkByName(result, 'publishing');
    assert.equal(pub.status, 'healthy');
    assert.equal(pub.detail.publishingMode, 'approved_only');
  });
});
