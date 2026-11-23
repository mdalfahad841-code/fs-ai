// FS AI — Close-out B1 (publishDueArticles daily-limit check) tests, 2026-11-23.
//
// Covers B1 against the SHIPPED files (real in-memory SQLite via
// node:sqlite, never the network, never live D1):
//   B1.1 two approved-due articles, limit 1, none published today ->
//         exactly 1 publishes (earliest publish_at first), the other
//         stays 'approved' and is reported skipped-due-to-limit; the
//         agent_activity_logs row records the limit, the
//         published-today count and the skipped slug
//   B1.2 one already published today (Dhaka day) + one due, limit 1 ->
//         0 publish, the due article stays approved, skipped reported
//   B1.3 limit 2 with two due -> both publish, nothing skipped
//   B1.4 limit 0 -> none publish, both skipped-due-to-limit, run still
//         logged
//   B1.5 an article published yesterday (Dhaka day) does NOT consume
//         today's limit -> the due article publishes under limit 1
//   B1.6 a banner-blocked due article skips via banner and does NOT
//         consume a slot -> the later clean due article still publishes
//         under limit 1
//   B1.7 fail-safe: the setting lookup throws (autonomy_settings table
//         dropped) -> ok:false, nothing publishes, the failure is logged
//   B1.8 Emergency Stop on -> existing skip behaviour unchanged
//         (skipped, 0 published, due untouched)
//   B1.9 an unreadable limit value falls back to 1 (the gate's parse
//         rule) -> exactly 1 of 2 due articles publishes
//
// Run: node --test tests/closeout-b1.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { publishDueArticles } = require('../backend/routes/admin-articles.js');

const ROOT = path.join(__dirname, '..');

/* Same splitter as tests/article-fetch.test.js: ';' inside strings and
   full-line comments must not split statements. */
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

// Minimal D1-compatible adapter over node:sqlite (copied from
// tests/real-db.test.js). d1First/d1Run in validation.js only use
// .all()/.run(), so no .first() is needed here.
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
// 008/009/010/011/012 (same pattern as tests/autonomy-scheduler.test.js).
// Migration 004 is deliberately NOT applied (see that file's header).
// Migration 005 seeds max_articles_per_day='1'; the seed's 25 published
// articles carry 2026-11-01..11-11 published_at dates, so none counts
// toward today's Dhaka day.
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

function insertArticle(db, opts) {
  const {
    title, slug, status = 'draft', publishAt = null,
    publishedAt = null, body = 'Body text. ', excerpt = 'Excerpt.',
  } = opts;
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, title, slug, excerpt, body, 'FS AI', status, publishedAt, publishAt);
  return Number(r.lastInsertRowid);
}

function setSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO autonomy_settings (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

function setEmergencyStop(db, on) {
  db.prepare(
    "INSERT OR REPLACE INTO website_settings (setting_key, setting_value, description) VALUES ('emergency_stop', ?, 'Emergency stop for autonomous agent operations.')",
  ).run(on ? '1' : '0');
}

function statusOf(db, id) {
  return db.prepare('SELECT status FROM articles WHERE id = ?').get(id).status;
}

function latestScheduledPublishLog(db) {
  const row = db.prepare(
    "SELECT * FROM agent_activity_logs WHERE action = 'scheduled_publish' ORDER BY id DESC LIMIT 1",
  ).get();
  if (!row) return null;
  return { ...row, detailsJson: JSON.parse(row.details) };
}

describe('B1 — publishDueArticles daily-limit check', () => {
  it('B1.1 limit 1, two due, none published today: exactly 1 publishes (earliest first), the other stays approved and is reported skipped', async () => {
    const { db, env } = freshEnv();
    const first = insertArticle(db, {
      title: 'B1 First Due', slug: 'b1-first-due',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const second = insertArticle(db, {
      title: 'B1 Second Due', slug: 'b1-second-due',
      status: 'approved', publishAt: '2020-01-02T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.published, 1);
    assert.deepEqual(result.slugs, ['b1-first-due']);
    assert.equal(result.skippedDailyLimit, 1);
    assert.deepEqual(result.skippedDailyLimitSlugs, ['b1-second-due']);
    assert.equal(result.dailyLimit, 1);
    assert.equal(result.publishedToday, 0);
    assert.equal(statusOf(db, first), 'published');
    assert.equal(statusOf(db, second), 'approved', 'the over-limit article is never touched');
    const log = latestScheduledPublishLog(db);
    assert.ok(log, 'the run is logged');
    assert.equal(log.detailsJson.outcome, 'completed');
    assert.equal(log.detailsJson.dailyLimit, 1);
    assert.equal(log.detailsJson.publishedToday, 0);
    assert.deepEqual(log.detailsJson.skippedDailyLimitSlugs, ['b1-second-due']);
  });

  it('B1.2 one published today (Dhaka day) + one due, limit 1: 0 publish, due stays approved, skipped reported', async () => {
    const { db, env } = freshEnv();
    insertArticle(db, {
      title: 'B1 Published Today', slug: 'b1-published-today',
      status: 'published', publishedAt: new Date().toISOString(),
    });
    const due = insertArticle(db, {
      title: 'B1 Due After Today', slug: 'b1-due-after-today',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.published, 0);
    assert.deepEqual(result.slugs, []);
    assert.equal(result.skippedDailyLimit, 1);
    assert.deepEqual(result.skippedDailyLimitSlugs, ['b1-due-after-today']);
    assert.equal(result.publishedToday, 1);
    assert.equal(statusOf(db, due), 'approved');
    const log = latestScheduledPublishLog(db);
    assert.equal(log.detailsJson.dailyLimit, 1);
    assert.equal(log.detailsJson.publishedToday, 1);
  });

  it('B1.3 limit 2 with two due: both publish, nothing skipped', async () => {
    const { db, env } = freshEnv();
    setSetting(db, 'max_articles_per_day', '2');
    const first = insertArticle(db, {
      title: 'B1 Limit2 First', slug: 'b1-limit2-first',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const second = insertArticle(db, {
      title: 'B1 Limit2 Second', slug: 'b1-limit2-second',
      status: 'approved', publishAt: '2020-01-02T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.published, 2);
    assert.deepEqual(result.slugs, ['b1-limit2-first', 'b1-limit2-second']);
    assert.equal(result.skippedDailyLimit, 0);
    assert.deepEqual(result.skippedDailyLimitSlugs, []);
    assert.equal(statusOf(db, first), 'published');
    assert.equal(statusOf(db, second), 'published');
  });

  it('B1.4 limit 0: none publish, both skipped-due-to-limit, run still logged', async () => {
    const { db, env } = freshEnv();
    setSetting(db, 'max_articles_per_day', '0');
    const first = insertArticle(db, {
      title: 'B1 Limit0 First', slug: 'b1-limit0-first',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const second = insertArticle(db, {
      title: 'B1 Limit0 Second', slug: 'b1-limit0-second',
      status: 'approved', publishAt: '2020-01-02T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.published, 0);
    assert.equal(result.skippedDailyLimit, 2);
    assert.deepEqual(result.skippedDailyLimitSlugs, ['b1-limit0-first', 'b1-limit0-second']);
    assert.equal(result.dailyLimit, 0);
    assert.equal(statusOf(db, first), 'approved');
    assert.equal(statusOf(db, second), 'approved');
    const log = latestScheduledPublishLog(db);
    assert.ok(log, 'a limit-0 run is still logged');
    assert.equal(log.detailsJson.dailyLimit, 0);
    assert.deepEqual(log.detailsJson.skippedDailyLimitSlugs, ['b1-limit0-first', 'b1-limit0-second']);
  });

  it('B1.5 published yesterday (Dhaka day) does NOT consume today\'s limit', async () => {
    const { db, env } = freshEnv();
    // 30 h ago is before today's Dhaka-day start (06:00 UTC) at any
    // hour the suite runs.
    const yesterday = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    insertArticle(db, {
      title: 'B1 Published Yesterday', slug: 'b1-published-yesterday',
      status: 'published', publishedAt: yesterday,
    });
    const due = insertArticle(db, {
      title: 'B1 Due Today', slug: 'b1-due-today',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.publishedToday, 0, 'yesterday\'s publish does not count today');
    assert.equal(result.published, 1);
    assert.deepEqual(result.slugs, ['b1-due-today']);
    assert.equal(result.skippedDailyLimit, 0);
    assert.equal(statusOf(db, due), 'published');
  });

  it('B1.6 banner-blocked due article skips via banner and does NOT consume the slot: the later clean due article still publishes under limit 1', async () => {
    const { db, env } = freshEnv();
    // A banner line in the MIDDLE of the body: stripDraftBanner only
    // removes a LEADING block, so hasDraftBanner still finds it and
    // the publish is refused — the article stays 'approved'.
    const bannered = insertArticle(db, {
      title: 'B1 Bannered Due', slug: 'b1-bannered-due',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
      body: 'Body text.\n\nAI-DRAFT — needs fact-check + owner approval.\n\nMore text.',
    });
    const clean = insertArticle(db, {
      title: 'B1 Clean Due', slug: 'b1-clean-due',
      status: 'approved', publishAt: '2020-01-02T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.published, 1);
    assert.deepEqual(result.slugs, ['b1-clean-due']);
    assert.equal(result.skippedBanner, 1);
    assert.deepEqual(result.skippedBannerSlugs, ['b1-bannered-due']);
    assert.equal(result.skippedDailyLimit, 0, 'the banner skip consumed no daily-limit slot');
    assert.equal(statusOf(db, bannered), 'approved');
    assert.equal(statusOf(db, clean), 'published');
  });

  it('B1.7 fail-safe: the setting lookup throws -> ok:false, nothing publishes, the failure is logged', async () => {
    const { db, env } = freshEnv();
    const due = insertArticle(db, {
      title: 'B1 Fail Safe Due', slug: 'b1-fail-safe-due',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    db.exec('DROP TABLE autonomy_settings');

    const result = await publishDueArticles(env);

    assert.equal(result.ok, false);
    assert.equal(result.published, 0);
    assert.match(result.error, /Daily-limit check failed/);
    assert.equal(statusOf(db, due), 'approved', 'nothing publishes past an unverifiable limit');
    const log = latestScheduledPublishLog(db);
    assert.ok(log, 'the failed run is logged');
    assert.equal(log.status, 'failed');
    assert.equal(log.detailsJson.outcome, 'failed');
    assert.match(log.detailsJson.reason, /Daily-limit check failed/);
  });

  it('B1.8 Emergency Stop on: existing skip behaviour unchanged', async () => {
    const { db, env } = freshEnv();
    const due = insertArticle(db, {
      title: 'B1 Stop Due', slug: 'b1-stop-due',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    setEmergencyStop(db, true);

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.published, 0);
    assert.equal(result.skipped, true);
    assert.match(result.reason, /Emergency Stop/);
    assert.equal(statusOf(db, due), 'approved');
  });

  it('B1.9 an unreadable limit value falls back to 1 (the gate\'s parse rule)', async () => {
    const { db, env } = freshEnv();
    setSetting(db, 'max_articles_per_day', 'banana');
    const first = insertArticle(db, {
      title: 'B1 Bad Limit First', slug: 'b1-bad-limit-first',
      status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const second = insertArticle(db, {
      title: 'B1 Bad Limit Second', slug: 'b1-bad-limit-second',
      status: 'approved', publishAt: '2020-01-02T00:00:00.000Z',
    });

    const result = await publishDueArticles(env);

    assert.equal(result.ok, true);
    assert.equal(result.dailyLimit, 1);
    assert.equal(result.published, 1);
    assert.deepEqual(result.slugs, ['b1-bad-limit-first']);
    assert.equal(result.skippedDailyLimit, 1);
    assert.equal(statusOf(db, first), 'published');
    assert.equal(statusOf(db, second), 'approved');
  });
});
