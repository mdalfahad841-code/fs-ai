// FS AI — first-party analytics tests (master implementation, 2026-11-19).
//
// GET /api/autonomy/analytics returns ONLY first-party D1 data: article
// counts by status/division, drafts with publish-gate results, LLM usage
// today + 7 days, task outcomes, failed tasks, latest report, research
// totals. GA4 has no Data API connection, so traffic stays
// 'Data unavailable' and revenue stays $0.00 — never an estimate
// presented as real traffic.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011).
// Run: node --test tests/autonomy-analytics.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');

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
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

async function analytics(env) {
  const res = await handleAutonomy(
    new Request('https://fs-ai.test/api/autonomy/analytics'),
    env, {}, { owner: true },
  );
  assert.equal(res.status, 200);
  return res.json();
}

describe('GET /api/autonomy/analytics — seeded database', () => {
  it('counts real D1 rows and never invents traffic or revenue', async () => {
    const { env } = freshEnv();
    const a = await analytics(env);
    assert.equal(a.source, 'd1');
    assert.equal(a.articlesByStatus.published, 25);
    assert.equal(a.articlesByStatus.draft || 0, 0);
    assert.equal(a.articlesByDivision.length, 8);
    const auto = a.articlesByDivision.find((d) => d.division === 'automotive');
    assert.equal(auto.total, 12);
    assert.equal(auto.published, 12);
    assert.equal(a.publishedToday, 0, 'seed articles are not published today');
    assert.deepEqual(a.drafts, []);
    assert.deepEqual(a.llmToday, { calls: 0, neurons: 0 });
    assert.deepEqual(a.llm7d, { calls: 0, neurons: 0 });
    assert.deepEqual(a.failedTasks, []);
    assert.equal(a.latestReport, null);
    assert.deepEqual(a.research, { activeSources: 24, itemsDiscovered: 0 });
    assert.equal(a.ga4.status, 'Tracking Connected — Reporting API Not Connected');
    assert.equal(a.traffic, 'Data unavailable');
    assert.equal(a.revenue, '$0.00');
  });
});

describe('GET /api/autonomy/analytics — live activity', () => {
  it('reflects a new draft, LLM usage, a failed task and a daily report', async () => {
    const { db, env } = freshEnv();
    const now = new Date().toISOString();
    const draftId = db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, updated_at) VALUES (1, 'Analytics Draft', 'analytics-draft', 'x', 'Body text here.', 'FS AI', 'draft', 0, ?)",
    ).run(now).lastInsertRowid;
    db.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-20b', 'content-draft', 'ok', 100, 200, 34, ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-20b', 'fact-check-judge', 'ok', 50, 30, 5, ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('fact-checking', 'fact-check', '{}', NULL, 5, 'failed', 3, 3, 'analytics-failed-1', NULL, ?, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (NULL, 'analytics', ?, ?, 'done', '{}')",
    ).run(now, now);
    db.prepare(
      "INSERT INTO daily_reports (date, kind, summary_json) VALUES (date('now'), 'daily', ?)",
    ).run(JSON.stringify({ articles: { published: 25 } }));

    const a = await analytics(env);
    assert.equal(a.articlesByStatus.draft, 1);
    assert.equal(a.drafts.length, 1);
    assert.equal(a.drafts[0].id, Number(draftId));
    assert.equal(a.drafts[0].contentReady, false, 'draft with no checks is not gate-ready');
    assert.ok(a.drafts[0].blockedBy.length > 0);
    assert.deepEqual(a.llmToday, { calls: 2, neurons: 39 });
    assert.deepEqual(a.llm7d, { calls: 2, neurons: 39 });
    assert.equal(a.taskOutcomes7d.done, 1);
    assert.equal(a.failedTasks.length, 1);
    assert.equal(a.failedTasks[0].agent, 'fact-checking');
    assert.equal(a.failedTasks[0].attempts, 3);
    assert.ok(a.latestReport, 'latest daily report surfaced');
    assert.equal(a.latestReport.kind, 'daily');
  });

  it('research totals move when sources are fetched and disabled', async () => {
    const { db, env } = freshEnv();
    db.prepare("UPDATE research_sources SET items_discovered = 5 WHERE id = 1").run();
    db.prepare("UPDATE research_sources SET items_discovered = 3 WHERE id = 2").run();
    db.prepare("UPDATE research_sources SET is_active = 0 WHERE id = 3").run();
    const a = await analytics(env);
    assert.equal(a.research.activeSources, 23);
    assert.equal(a.research.itemsDiscovered, 8);
  });
});
