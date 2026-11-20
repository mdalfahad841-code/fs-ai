// FS AI — Weekly workflow live-readiness + manual control tests (Fix 9,
// Critical Repair Phase 2, 2026-11-20).
//
// runWeeklyWorkflow + POST /api/autonomy/run-weekly against a REAL SQLite
// database built from database/schema.sql + migrations 005 + 006 +
// database/seed.sql + migrations 008 + 009 + 010 + 011 + 012 via node:sqlite
// (same pattern as tests/autonomy-scheduler.test.js). Each test asserts
// real DB state. No network, no live D1, nothing published, nothing
// deleted. Articles #26/#27 are seeded as protected test artifacts and
// must come out byte-identical.
//
// What is pinned here:
//  1. One weekly run writes exactly one daily_reports row (kind 'weekly',
//     today's UTC date) whose figures match direct COUNT queries against
//     the seeded data — nothing invented.
//  2. A second run the same day without force returns duplicate:true,
//     the same reportId, and writes no new row.
//  3. A force re-run UPDATES the same row (count stays 1) and picks up
//     data that changed since the first run.
//  4. Emergency Stop ON blocks the run: skipped:true, NO report row,
//     the skip is logged in agent_runs.
//  5. The weekly run is read-only for articles: no agent_tasks enqueued,
//     no article row changes, and protected #26/#27 come out
//     byte-identical (body/excerpt/seo fields/status) with no
//     seo_checks / fact_checks / article_corrections / article_revisions
//     rows written for them.
//  6. The manual endpoint POST /api/autonomy/run-weekly: completes with
//     status 'completed' + reportId + date; a second call without force
//     answers 'already_completed' with the existing reportId; force
//     re-runs; E-Stop ON answers 423 'blocked' with no row; it never
//     runs the daily workflow (no 'daily' report row, and a daily run
//     the same day does not block the weekly run — kinds differ).
//
// NOTE: the LIVE weekly run is NOT tested here — it only fires on the
// scheduled Sunday 00:00 UTC cron (next: Sun 22 Nov 2026). These tests
// prove the code path the cron will call.
//
// Run: node --test tests/weekly-workflow.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  runDailyWorkflow, runWeeklyWorkflow, todayStr,
} = require('../backend/routes/scheduler.js');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');

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
// tests/autonomy-scheduler.test.js). d1First is implemented on top of
// d1All in backend/middleware/validation.js, so no .first() is needed.
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

// Fresh real DB per test: schema + autonomy migrations 005/006 + seed +
// 008/009/010/011/012. Migration 004 is deliberately NOT applied
// (schema.sql already contains its changes — see
// tests/autonomy-scheduler.test.js header).
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

function countReports(db, kind) {
  return db.prepare('SELECT COUNT(*) AS n FROM daily_reports WHERE kind = ?').get(kind).n;
}

function weeklyRow(db) {
  return db.prepare("SELECT * FROM daily_reports WHERE kind = 'weekly' ORDER BY id ASC LIMIT 1").get();
}

function weeklySummary(db) {
  const row = weeklyRow(db);
  assert.ok(row, 'a weekly report row must exist');
  return JSON.parse(row.summary_json);
}

// Insert a draft with an explicit id (26/27, matching the live protected
// test-article IDs), with distinctive content in every mutable field.
function insertProtectedDraft(db, id) {
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  const body = `Protected test article ${id} body — plain text with enough words to derive a meta description if anything ever tried to repair it, which the weekly run must never do. Second sentence here. Third sentence here.`;
  db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, published_at, publish_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)',
  ).run(id, divisionId, `Protected Weekly Test ${id}`, `protected-weekly-test-${id}`,
    `Protected excerpt ${id}.`, body, 'FS AI', 'draft',
    `Protected SEO Title ${id}`, `Protected SEO description ${id} — short and untouched.`, null);
  return id;
}

function snapshotArticles(db) {
  return db.prepare(
    'SELECT id, division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, published_at, publish_at FROM articles ORDER BY id ASC',
  ).all();
}

function autonomyReq(method, pathName, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (body !== undefined) {
    return new Request(`http://localhost${pathName}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`http://localhost${pathName}`, { method, headers });
}

async function callAutonomy(env, method, pathName, body) {
  const res = await handleAutonomy(autonomyReq(method, pathName, body), env, {}, null);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// 1. One run: exactly one report row, figures from real seeded D1 data.
// ---------------------------------------------------------------------------
describe('weekly workflow — report from real data', () => {
  it('writes exactly one weekly row whose figures match direct COUNT queries', async () => {
    const { db, env } = freshEnv();
    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.date, todayStr(), 'report date is today (UTC)');
    assert.ok(result.reportId, 'a report row id is returned');

    assert.equal(countReports(db, 'weekly'), 1, 'exactly one weekly report row');
    const row = weeklyRow(db);
    assert.equal(row.date, todayStr(), 'row date and duplicate-check date are the same UTC day');
    assert.equal(row.kind, 'weekly');
    const summary = JSON.parse(row.summary_json);
    assert.equal(summary.kind, 'weekly');
    assert.equal(summary.date, todayStr());
    assert.equal(summary.revenue, 0);
    assert.equal(summary.revenueFormatted, '$0.00');
    assert.equal(summary.traffic, 'Data unavailable');

    // Every figure below is recomputed from the seeded DB, not hardcoded.
    const totalArticles = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    const publishedArticles = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published'").get().n;
    assert.equal(summary.totalArticles, totalArticles, 'totalArticles matches COUNT(*)');
    assert.equal(summary.publishedArticles, publishedArticles, 'publishedArticles matches COUNT(*) published');

    const autoId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
    const autoTotal = db.prepare('SELECT COUNT(*) AS n FROM articles WHERE division_id = ?').get(autoId).n;
    const autoPublished = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE division_id = ? AND status = 'published'").get(autoId).n;
    const autoEntry = summary.articlesByDivision.find((d) => d.division === 'automotive');
    assert.ok(autoEntry, 'automotive appears in articlesByDivision');
    assert.equal(autoEntry.total, autoTotal, 'automotive total matches COUNT(*)');
    assert.equal(autoEntry.published, autoPublished, 'automotive published matches COUNT(*)');
    assert.equal(
      summary.articlesByDivision.reduce((s, d) => s + d.total, 0), totalArticles,
      'division totals sum to totalArticles');
    assert.equal(summary.articlesByDivision.length, 8, 'one entry per division');

    const activeSources = db.prepare('SELECT COUNT(*) AS n FROM research_sources WHERE is_active = 1').get().n;
    assert.equal(summary.activeSources, activeSources, 'activeSources matches COUNT(*)');
    const items7d = db.prepare("SELECT COUNT(*) AS n FROM research_items WHERE fetched_at >= datetime('now', '-7 days')").get().n;
    assert.equal(summary.researchItemsLast7Days, items7d, 'researchItemsLast7Days matches COUNT(*)');
    assert.equal(summary.failedTaskCount, 0, 'no failed tasks in a fresh DB');
    assert.ok(Array.isArray(summary.recommendations) && summary.recommendations.length >= 1,
      'at least one recommendation is derived');
    assert.ok(summary.topDivisions.length <= 3);

    // The weekly run itself is logged (audit), not a second report row.
    const run = db.prepare("SELECT * FROM agent_runs WHERE agent = 'scheduler' AND outcome = 'done'").get();
    assert.ok(run, 'weekly run logged in agent_runs');
    assert.equal(countReports(db, 'daily'), 0, 'the weekly run writes no daily row');
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Duplicate prevention: second run same day, force re-run.
// ---------------------------------------------------------------------------
describe('weekly workflow — duplicate prevention', () => {
  it('second run same day without force returns duplicate:true and writes no new row', async () => {
    const { db, env } = freshEnv();
    const first = await runWeeklyWorkflow(env);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, undefined, 'first run is not a duplicate');

    const second = await runWeeklyWorkflow(env);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true, 'second run reports itself as a duplicate');
    assert.equal(second.reportId, first.reportId, 'second run returns the same report row id');
    assert.equal(countReports(db, 'weekly'), 1, 'second run writes no second weekly row');
    assert.equal(second.date, todayStr());
  });

  it('force re-run updates the same row (no duplicate) and picks up new data', async () => {
    const { db, env } = freshEnv();
    const first = await runWeeklyWorkflow(env);
    assert.equal(first.ok, true);
    assert.equal(weeklySummary(db).totalArticles, 25, 'seed has 25 articles');

    // New data lands between the runs: one more published article.
    const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
    db.prepare(
      'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) ' +
      "VALUES (?, ?, ?, ?, ?, ?, 'published', 0, ?, ?)",
    ).run(divisionId, 'Force Re-run New Article', 'force-rerun-new-article', 'Excerpt.', 'Body.', 'FS AI',
      '2026-11-20T00:00:00.000Z', null);

    const forced = await runWeeklyWorkflow(env, { force: true });
    assert.equal(forced.ok, true);
    assert.equal(forced.duplicate, undefined, 'forced re-run is not a duplicate');
    assert.equal(forced.reportId, first.reportId, 'forced re-run upserts the same row');
    assert.equal(countReports(db, 'weekly'), 1, 'forced re-run still leaves exactly one row');
    assert.equal(weeklySummary(db).totalArticles, 26, 'the updated row reflects the new article');
    const autoEntry = weeklySummary(db).articlesByDivision.find((d) => d.division === 'automotive');
    assert.equal(autoEntry.published, 13, 'automotive published count picked up the new article (12 seeded + 1)');
  });

  it('a daily run the same day does not block the weekly run (kinds differ)', async () => {
    const { db, env } = freshEnv();
    const daily = await runDailyWorkflow(env);
    assert.equal(daily.ok, true);
    assert.equal(countReports(db, 'daily'), 1);

    const weekly = await runWeeklyWorkflow(env);
    assert.equal(weekly.ok, true);
    assert.equal(weekly.duplicate, undefined, 'the daily row is not a weekly duplicate');
    assert.equal(countReports(db, 'weekly'), 1, 'weekly row written alongside the daily row');
    assert.equal(countReports(db, 'daily'), 1, 'daily row untouched by the weekly run');
  });
});

// ---------------------------------------------------------------------------
// 4. Emergency Stop.
// ---------------------------------------------------------------------------
describe('weekly workflow — Emergency Stop', () => {
  it('E-Stop ON blocks with no report row written (skip logged)', async () => {
    const { db, env } = freshEnv();
    setEmergencyStop(db, true);

    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.reason, /Emergency Stop/);
    assert.equal(result.date, todayStr());
    assert.equal(countReports(db, 'weekly'), 0, 'no report row while stopped');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 0, 'no tasks enqueued while stopped');
    const skipRun = db.prepare("SELECT * FROM agent_runs WHERE agent = 'scheduler' AND outcome = 'skipped'").get();
    assert.ok(skipRun, 'the skip is logged as an agent_runs row');
    assert.match(JSON.parse(skipRun.detail).reason, /Emergency Stop/);
  });

  it('after the E-Stop is turned off, the weekly run proceeds normally', async () => {
    const { db, env } = freshEnv();
    setEmergencyStop(db, true);
    const blocked = await runWeeklyWorkflow(env);
    assert.equal(blocked.skipped, true);
    setEmergencyStop(db, false);

    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, undefined);
    assert.equal(countReports(db, 'weekly'), 1, 'exactly one row once the stop is off');
  });
});

// ---------------------------------------------------------------------------
// 5. Read-only proof: no article modification, protected #26/#27 intact.
// ---------------------------------------------------------------------------
describe('weekly workflow — read-only / protected articles', () => {
  it('enqueues no tasks and changes no article row', async () => {
    const { db, env } = freshEnv();
    const before = snapshotArticles(db);
    const tasksBefore = db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n;

    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);
    assert.deepEqual(snapshotArticles(db), before, 'every article row is byte-identical after the weekly run');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, tasksBefore,
      'the weekly run enqueues no tasks');
  });

  it('protected articles #26/#27 are byte-identical after the weekly run', async () => {
    const { db, env } = freshEnv();
    const before = {};
    for (const id of [26, 27]) {
      insertProtectedDraft(db, id);
      before[id] = db.prepare(
        'SELECT body, excerpt, seo_title, seo_description, title, status FROM articles WHERE id = ?',
      ).get(id);
    }

    const result = await runWeeklyWorkflow(env);
    assert.equal(result.ok, true);

    for (const id of [26, 27]) {
      const after = db.prepare(
        'SELECT body, excerpt, seo_title, seo_description, title, status FROM articles WHERE id = ?',
      ).get(id);
      assert.deepEqual(after, before[id], `protected article #${id} is byte-identical after the weekly run`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?').get(id).n, 0,
        `no seo_checks row was written for protected article #${id}`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(id).n, 0,
        `no fact_checks row was written for protected article #${id}`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM article_corrections WHERE article_id = ?').get(id).n, 0,
        `no article_corrections row was written for protected article #${id}`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0,
        `no article_revisions row was written for protected article #${id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Manual endpoint POST /api/autonomy/run-weekly.
// ---------------------------------------------------------------------------
describe('manual endpoint POST /api/autonomy/run-weekly', () => {
  it('first call completes with status completed + reportId + date', async () => {
    const { db, env } = freshEnv();
    const first = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'completed', 'first run really ran');
    assert.equal(first.body.ok, true);
    assert.equal(first.body.date, todayStr());
    assert.ok(first.body.reportId, 'a report row id is returned');
    assert.ok(first.body.summary, 'the weekly summary is returned');
    assert.equal(first.body.summary.kind, 'weekly');
    assert.equal(countReports(db, 'weekly'), 1);
    assert.equal(countReports(db, 'daily'), 0, 'the weekly endpoint never runs the daily workflow');
  });

  it('second call without force is already_completed with the existing reportId', async () => {
    const { db, env } = freshEnv();
    const first = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly');
    assert.equal(first.body.status, 'completed');

    const second = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly');
    assert.equal(second.status, 200);
    assert.equal(second.body.status, 'already_completed', 'a no-op is reported as already_completed, not success');
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.reportId, first.body.reportId, 'same report row, no duplicate');
    assert.equal(countReports(db, 'weekly'), 1);
  });

  it('force re-run via the endpoint completes and updates the same row', async () => {
    const { db, env } = freshEnv();
    const first = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly');
    assert.equal(first.body.status, 'completed');

    const forced = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly', { force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.status, 'completed', 'an explicit manual re-run really runs');
    assert.equal(forced.body.reportId, first.body.reportId, 'forced re-run upserts the same row');
    assert.equal(countReports(db, 'weekly'), 1);
  });

  it('E-Stop ON: endpoint answers 423 blocked with no row written', async () => {
    const { db, env } = freshEnv();
    setEmergencyStop(db, true);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly', { force: true });
    assert.equal(r.status, 423);
    assert.equal(r.body.status, 'blocked');
    assert.equal(r.body.skipped, true);
    assert.equal(countReports(db, 'weekly'), 0, 'no report row while stopped');
  });

  it('a scheduled-style daily run the same day does not block the manual weekly run', async () => {
    const { db, env } = freshEnv();
    const daily = await callAutonomy(env, 'POST', '/api/autonomy/run-daily');
    assert.equal(daily.body.status, 'completed');
    assert.equal(countReports(db, 'daily'), 1);

    const weekly = await callAutonomy(env, 'POST', '/api/autonomy/run-weekly');
    assert.equal(weekly.status, 200);
    assert.equal(weekly.body.status, 'completed', 'daily row is not a weekly duplicate');
    assert.equal(countReports(db, 'weekly'), 1);
    assert.equal(countReports(db, 'daily'), 1);
  });
});
