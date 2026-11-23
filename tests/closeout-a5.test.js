// FS AI — Close-out A5 (Daily Autonomy Health Report) + A6 (first-real-auto-publish proof) tests, 2026-11-23.
//
// Covers A5 against the SHIPPED files (real in-memory SQLite via
// node:sqlite, mock fetchImpl — never the network) and A6 by source
// assertions only (the A6 script must NOT run against a real article:
// none exists yet):
//   A5.1 all-green report — every check OK except the honest NOT
//         TESTED ones (shortsCron, lastVideo with 0 rows,
//         autoPublishProof absent, protectedDrafts/settings first-run
//         baselines); overall OK; all 13 check keys present
//   A5.2 sitemap — missing a published id FAILs listing it; non-200 FAILs
//   A5.3 recent article unreachable FAILs listing it
//   A5.4 protected drafts — body changed vs previous snapshot FAILs
//         with the id; missing id FAILs; no previous snapshot is
//         NOT TESTED and the baseline is stored
//   A5.5 settings — key changed vs previous snapshot WARNs listing it;
//         auto_publish_proof is excluded from the snapshot
//   A5.6 CSP — rows in the last 7 days WARN with counts, 8-day-old row
//         excluded, 0 rows OK
//   A5.7 lastRuns — stale daily (>36 h) WARNs, missing NOT TESTED,
//         fresh daily + weekly OK
//   A5.8 sitemap-refresh — GitHub API failure NOT TESTED, success OK
//         with age reported, failed run WARN
//   A5.9 autoPublishProof — stored pass OK, stored fail FAIL,
//         malformed FAIL
//   A5.10 workerHealth/queue mapping from a degraded health result WARN
//   A5.11 scheduler wiring — runDailyWorkflow stores summary.healthReport
//         in the daily_reports row (mock fetch; the workflow's other
//         steps run through the existing harness)
//   A5.12 dashboard — new block ids exist, dashboard.js fetches
//         /api/autonomy/reports and renders the checks (source
//         assertions + vm fake-DOM render test)
//   A6.1 the proof script takes the article id as an argument, never
//         writes to D1, never publishes, prints the SQL for the parent;
//         the doc exists and states it must not run until the first
//         real auto-publish
//
// Run: node --test tests/closeout-a5.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { DatabaseSync } = require('node:sqlite');
const {
  buildDailyHealthReport,
  PROTECTED_DRAFT_IDS,
  HEALTH_REPORT_CHECK_KEYS,
  FETCH_TIMEOUT_MS,
} = require('../backend/services/daily-health-report.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const { runDailyWorkflow, todayStr } = require('../backend/routes/scheduler.js');

const ROOT = path.join(__dirname, '..');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

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

// Fresh real DB per test: schema + autonomy migrations + seed + the
// pipeline migrations + the YouTube mirror (028) + CSP reports (030).
// Migration 004 is deliberately NOT applied (see
// tests/autonomy-scheduler.test.js: schema.sql already contains it).
function freshDb() {
  return buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
    'database/migrations/028_youtube_analytics.sql',
    'database/migrations/030_csp_reports.sql',
  ]);
}

function freshEnv() {
  const db = freshDb();
  return { db, env: { DB: makeRealD1(db) } };
}

// Distinct bodies per protected draft (lengths are asserted, never
// invented from the live ledger — the live lengths are eyeballed by
// the parent against the ledger, not pinned here).
function draftBody(id) {
  return `Protected draft number ${id} body. ` + 'Lorem ipsum dolor sit amet. '.repeat(id);
}

function insertProtectedDrafts(db) {
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  for (const id of PROTECTED_DRAFT_IDS) {
    db.prepare(
      'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)',
    ).run(id, divisionId, `Protected Draft ${id}`, `protected-draft-${id}`, 'Excerpt.', draftBody(id), 'FS AI', 'draft', null);
  }
}

function insertArticle(db, { id, status = 'draft', publishedAt = null, body = 'Body text. ' }) {
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, `Test Article ${id}`, `test-article-${id}`, 'Excerpt.', body, 'FS AI', status, publishedAt, null);
  return Number(r.lastInsertRowid);
}

function dateDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function insertDailyReport(db, date, kind, summary) {
  db.prepare(
    'INSERT INTO daily_reports (date, kind, summary_json, created_at) VALUES (?, ?, ?, ?)',
  ).run(date, kind, JSON.stringify(summary), `${date}T00:05:00.000Z`);
}

function sqliteDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/* Mock fetchImpl: never touches the network. Sitemap lists the given
   article ids (plus home + the 8 division pages); the GitHub API
   answers per `github` ('success' | 'failure' | 'forbidden' |
   'error'); article pages answer per `articleStatus` (id -> status). */
const DIVISION_SLUGS = ['automotive', 'ai-technology', 'gadgets-electronics', 'finance-money',
  'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning'];

function sitemapXml(articleIds) {
  const locs = [`${PAGES_BASE}/`,
    ...articleIds.map((id) => `${PAGES_BASE}/pages/article?id=${id}`),
    ...DIVISION_SLUGS.map((s) => `${PAGES_BASE}/pages/division?division=${s}`)];
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + locs.map((u) => `<url><loc>${u}</loc><lastmod>2026-11-01</lastmod></url>`).join('') + '</urlset>';
}

function allPublishedIds() {
  return Array.from({ length: 25 }, (_, i) => i + 1);
}

function makeMockFetch({
  sitemapIds = allPublishedIds(),
  sitemapStatus = 200,
  github = 'success',
  articleStatus = {},
} = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('api.github.com')) {
      if (github === 'error') throw new Error('network down');
      if (github === 'forbidden') return { status: 403, text: async () => 'rate limited' };
      const conclusion = github === 'failure' ? 'failure' : 'success';
      return {
        status: 200,
        text: async () => JSON.stringify({
          workflow_runs: [{
            conclusion,
            created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
            id: 123,
            html_url: 'https://github.com/mdalfahad841-code/fs-ai/actions/runs/123',
          }],
        }),
      };
    }
    if (u.endsWith('/sitemap.xml')) {
      if (sitemapStatus !== 200) return { status: sitemapStatus, text: async () => '' };
      return { status: 200, text: async () => sitemapXml(sitemapIds) };
    }
    if (u.includes('/pages/article?id=')) {
      const id = Number(/id=(\d+)/.exec(u)[1]);
      return { status: articleStatus[id] || 200, text: async () => '' };
    }
    if (u === `${PAGES_BASE}/`) return { status: 200, text: async () => '<html></html>' };
    return { status: 404, text: async () => '' };
  };
}

function healthyHealth() {
  const component = (name, status, detail = {}) => ({ component: name, status, detail, checkedAt: new Date().toISOString() });
  return {
    overall: 'healthy',
    checkedAt: new Date().toISOString(),
    persisted: true,
    checks: [
      component('worker', 'healthy'),
      component('database', 'healthy', { probe: 'SELECT 1' }),
      component('emergency-stop', 'healthy', { stopped: false }),
      component('queue', 'healthy', { queued: 0, running: 0, stale: 0, oldestQueuedAt: null, oldestQueuedAgeMs: null, leaseMs: 600000 }),
      component('workers-ai', 'healthy', { providerOrder: 'workers-ai,groq,gemini', neuronsToday: 0, cap: 9000, lastUsedAt: null }),
      component('accounts', 'healthy', { accounts: [] }),
      component('publishing', 'healthy', { publishingMode: 'approved_only', autoPublishing: 'on' }),
      component('social', 'not-configured', { reason: 'No social integration tables present.' }),
      component('free-tier', 'healthy', { neuronsToday: 0, cap: 9000, remaining: 9000, percentUsed: 0 }),
      component('backup', 'healthy', { latestId: 1, status: 'success' }),
    ],
  };
}

function degradedHealth() {
  const health = healthyHealth();
  health.overall = 'degraded';
  const queue = health.checks.find((c) => c.component === 'queue');
  queue.status = 'degraded';
  queue.detail = {
    queued: 12, running: 0, stale: 0, oldestQueuedAt: '2026-11-20T00:00:00.000Z',
    oldestQueuedAgeMs: 3 * 24 * 3600 * 1000, leaseMs: 600000,
    reason: '12 task(s) queued — more than one drain run (10) can clear, so the backlog spans multiple runs.',
  };
  return health;
}

async function currentDraftSnapshot(db) {
  const drafts = [];
  for (const id of PROTECTED_DRAFT_IDS) {
    const row = db.prepare('SELECT id, status, body FROM articles WHERE id = ?').get(id);
    drafts.push({ id, status: row.status, bodyLength: row.body.length, bodyHash: await bodyHash(row.body) });
  }
  return drafts;
}

function currentSettingsSnapshot(db) {
  const autonomy = {};
  for (const r of db.prepare('SELECT key, value FROM autonomy_settings').all()) {
    if (r.key === 'auto_publish_proof') continue;
    autonomy[r.key] = r.value;
  }
  const website = {};
  for (const r of db.prepare('SELECT setting_key, setting_value FROM website_settings').all()) {
    website[r.setting_key] = r.setting_value;
  }
  return { autonomy, website };
}

function assertValidStatus(report) {
  for (const key of HEALTH_REPORT_CHECK_KEYS) {
    assert.ok(report.checks[key], 'check present: ' + key);
    assert.ok(['OK', 'WARN', 'FAIL', 'NOT TESTED'].includes(report.checks[key].status),
      key + ' status must be one of the four honest statuses, got ' + report.checks[key].status);
  }
}

/* ------------------------------------------------------------------ */
/* A5.1 — all-green report (honest NOT TESTED where nothing exists).   */
/* ------------------------------------------------------------------ */
describe('A5.1 all-green report: OK everywhere except the honest NOT TESTED checks', () => {
  it('reports overall OK with the first-run baselines as NOT TESTED', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const fetchImpl = makeMockFetch();
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl });

    assertValidStatus(report);
    assert.equal(report.overall, 'OK');
    assert.match(report.date, /^\d{4}-\d{2}-\d{2}$/, 'date is UTC YYYY-MM-DD');
    assert.ok(report.generatedAt.endsWith('Z'), 'generatedAt is ISO');

    assert.equal(report.checks.workerHealth.status, 'OK');
    assert.equal(report.checks.workerHealth.detail.overall, 'healthy');
    assert.equal(report.checks.pages.status, 'OK');
    assert.equal(report.checks.pages.detail.status, 200);
    assert.equal(report.checks.sitemap.status, 'OK');
    assert.equal(report.checks.sitemap.detail.urlCount, 1 + 25 + 8);
    assert.equal(report.checks.sitemap.detail.publishedCount, 25);
    assert.deepEqual(report.checks.sitemap.detail.missingIds, []);
    assert.deepEqual(report.checks.sitemap.detail.extraIds, []);
    assert.equal(report.checks.recentArticles.status, 'OK');
    assert.deepEqual(report.checks.recentArticles.detail.published, [], 'seed articles are all older than 24 h');
    assert.equal(report.checks.queue.status, 'OK');
    assert.equal(report.checks.queue.detail.queued, 0);
    assert.equal(report.checks.lastRuns.status, 'NOT TESTED', 'no previous daily/weekly row exists yet');
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.detail.conclusion, 'success');
    assert.ok(typeof report.checks.sitemapRefresh.detail.ageHours === 'number', 'sitemap-refresh age is reported');
    // First run: no previous health-report baseline exists.
    assert.equal(report.checks.protectedDrafts.status, 'NOT TESTED');
    assert.match(report.checks.protectedDrafts.detail.reason || '', /no prior health-report baseline/i);
    assert.equal(report.checks.settings.status, 'NOT TESTED');
    assert.match(report.checks.settings.detail.reason || '', /no prior health-report baseline/i);
    assert.equal(report.checks.shortsCron.status, 'NOT TESTED');
    assert.match(report.checks.shortsCron.detail.reason, /lives in Muse/);
    assert.equal(report.checks.lastVideo.status, 'NOT TESTED');
    assert.match(report.checks.lastVideo.detail.reason, /0 rows in D1/);
    assert.equal(report.checks.cspViolations.status, 'OK');
    assert.equal(report.checks.cspViolations.detail.total, 0);
    assert.equal(report.checks.autoPublishProof.status, 'NOT TESTED');
    assert.match(report.checks.autoPublishProof.detail.reason, /No auto-published article has been verified yet/);

    // The baselines this run records are stored in the snapshots.
    assert.equal(report.snapshots.protectedDrafts.length, 7);
    assert.deepEqual(report.snapshots.protectedDrafts.map((d) => d.id), [...PROTECTED_DRAFT_IDS]);
    for (const d of report.snapshots.protectedDrafts) {
      assert.equal(d.status, 'draft');
      assert.equal(d.bodyLength, draftBody(d.id).length);
      assert.equal(d.bodyHash, await bodyHash(draftBody(d.id)));
    }
    assert.ok(Object.keys(report.snapshots.settings.autonomy).length > 0, 'autonomy settings snapshotted');
    assert.ok(Object.keys(report.snapshots.settings.website).length > 0, 'website settings snapshotted');
    assert.ok(!('auto_publish_proof' in report.snapshots.settings.autonomy), 'proof key is never part of the settings snapshot');
  });

  it('NOT TESTED never degrades the overall, and WARN beats NOT TESTED inside lastRuns', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    // Weekly 10 days old (stale -> WARN) with no daily row at all:
    // lastRuns is WARN (the stale weekly wins over the missing daily),
    // and the overall is WARN even though other checks are NOT TESTED.
    insertDailyReport(db, dateDaysAgo(10), 'weekly', {});
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.lastRuns.status, 'WARN', 'stale weekly (10 d) is WARN even with no daily row');
    assert.equal(report.checks.lastRuns.detail.weekly.date, dateDaysAgo(10));
    assert.equal(report.checks.lastRuns.detail.daily, null);
    assert.equal(report.overall, 'WARN');
    // And a FAIL anywhere beats WARN: a missing published id in the sitemap.
    const failReport = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ sitemapIds: allPublishedIds().filter((id) => id !== 25) }),
    });
    assert.equal(failReport.checks.sitemap.status, 'FAIL');
    assert.equal(failReport.overall, 'FAIL');
  });
});

/* ------------------------------------------------------------------ */
/* A5.2 — sitemap: missing published id, non-200, extra id.            */
/* ------------------------------------------------------------------ */
describe('A5.2 sitemap check fails honestly on a missing published id', () => {
  it('FAILs listing the missing published id', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ sitemapIds: allPublishedIds().filter((id) => id !== 7) }),
    });
    assert.equal(report.checks.sitemap.status, 'FAIL');
    assert.deepEqual(report.checks.sitemap.detail.missingIds, [7]);
    assert.equal(report.overall, 'FAIL');
  });

  it('FAILs on a non-200 sitemap', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ sitemapStatus: 500 }),
    });
    assert.equal(report.checks.sitemap.status, 'FAIL');
    assert.match(report.checks.sitemap.detail.error || '', /HTTP 500/);
  });

  it('WARNs (not FAILs) on a sitemap article id that is not published in D1', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ sitemapIds: [...allPublishedIds(), 99] }),
    });
    assert.equal(report.checks.sitemap.status, 'WARN');
    assert.deepEqual(report.checks.sitemap.detail.extraIds, [99]);
    assert.equal(report.overall, 'WARN');
  });

  it('FAILs when the home page itself is down', async () => {
    const { env } = freshEnv();
    const failingFetch = async (url) => {
      if (String(url).includes('api.github.com')) return makeMockFetch()(url);
      return { status: 503, text: async () => '' };
    };
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: failingFetch });
    assert.equal(report.checks.pages.status, 'FAIL');
    assert.equal(report.checks.pages.detail.status, 503);
  });
});

/* ------------------------------------------------------------------ */
/* A5.3 — recent article unreachable.                                  */
/* ------------------------------------------------------------------ */
describe('A5.3 recent-articles check fails on an unreachable fresh article', () => {
  it('FAILs listing the unreachable id; 0 published in 24 h is OK', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const freshId = insertArticle(db, { id: 40, status: 'published', publishedAt: new Date().toISOString() });
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({
        sitemapIds: [...allPublishedIds(), freshId],
        articleStatus: { [freshId]: 404 },
      }),
    });
    assert.equal(report.checks.recentArticles.status, 'FAIL');
    assert.deepEqual(report.checks.recentArticles.detail.published, [freshId]);
    assert.deepEqual(report.checks.recentArticles.detail.unreachable, [freshId]);
    assert.deepEqual(report.checks.recentArticles.detail.reachable, []);

    const okReport = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ sitemapIds: [...allPublishedIds(), freshId] }),
    });
    assert.equal(okReport.checks.recentArticles.status, 'OK');
    assert.deepEqual(okReport.checks.recentArticles.detail.reachable, [freshId]);
  });
});

/* ------------------------------------------------------------------ */
/* A5.4 — protected drafts vs the previous snapshot.                   */
/* ------------------------------------------------------------------ */
describe('A5.4 protected drafts are compared with the previous daily report baseline', () => {
  async function baselineEnv() {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const drafts = await currentDraftSnapshot(db);
    const settings = currentSettingsSnapshot(db);
    insertDailyReport(db, dateDaysAgo(1), 'daily', {
      healthReport: { snapshots: { protectedDrafts: drafts, settings } },
    });
    return { db, env };
  }

  it('OK when every draft matches the baseline', async () => {
    const { env } = await baselineEnv();
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.protectedDrafts.status, 'OK');
    assert.deepEqual(report.checks.protectedDrafts.detail.changed, []);
    assert.deepEqual(report.checks.protectedDrafts.detail.missing, []);
  });

  it('FAILs with the id when a draft body changed (before/after recorded)', async () => {
    const { db, env } = await baselineEnv();
    const before = db.prepare('SELECT body FROM articles WHERE id = 30').get().body;
    db.prepare('UPDATE articles SET body = ? WHERE id = 30').run(before + ' One more sentence added by hand.');
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.protectedDrafts.status, 'FAIL');
    assert.equal(report.checks.protectedDrafts.detail.changed.length, 1);
    assert.equal(report.checks.protectedDrafts.detail.changed[0].id, 30);
    assert.equal(report.checks.protectedDrafts.detail.changed[0].before.bodyLength, before.length);
    assert.equal(report.checks.protectedDrafts.detail.changed[0].after.bodyLength, before.length + ' One more sentence added by hand.'.length);
    assert.notEqual(
      report.checks.protectedDrafts.detail.changed[0].before.bodyHash,
      report.checks.protectedDrafts.detail.changed[0].after.bodyHash);
    assert.equal(report.overall, 'FAIL');
  });

  it('FAILs listing a draft that vanished from D1', async () => {
    const { db, env } = await baselineEnv();
    db.prepare('DELETE FROM articles WHERE id = 31').run();
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.protectedDrafts.status, 'FAIL');
    assert.deepEqual(report.checks.protectedDrafts.detail.missing, [31]);
  });

  it('FAILs when a draft status changed (draft -> published)', async () => {
    const { db, env } = await baselineEnv();
    db.prepare("UPDATE articles SET status = 'published', published_at = ? WHERE id = 28").run(new Date().toISOString());
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ sitemapIds: [...allPublishedIds(), 28] }),
    });
    assert.equal(report.checks.protectedDrafts.status, 'FAIL');
    assert.equal(report.checks.protectedDrafts.detail.changed[0].id, 28);
    assert.equal(report.checks.protectedDrafts.detail.changed[0].before.status, 'draft');
    assert.equal(report.checks.protectedDrafts.detail.changed[0].after.status, 'published');
  });
});

/* ------------------------------------------------------------------ */
/* A5.5 — settings: changed key WARNs; proof key excluded.             */
/* ------------------------------------------------------------------ */
describe('A5.5 settings changes warn; auto_publish_proof is excluded', () => {
  it('WARNs listing the changed key with before/after', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const drafts = await currentDraftSnapshot(db);
    const settings = currentSettingsSnapshot(db);
    insertDailyReport(db, dateDaysAgo(1), 'daily', {
      healthReport: { snapshots: { protectedDrafts: drafts, settings } },
    });
    const before = db.prepare("SELECT value FROM autonomy_settings WHERE key = 'publishing_mode'").get().value;
    db.prepare("UPDATE autonomy_settings SET value = 'auto' WHERE key = 'publishing_mode'").run();
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.settings.status, 'WARN');
    assert.equal(report.checks.settings.detail.changed.length, 1);
    assert.deepEqual(report.checks.settings.detail.changed[0], { key: 'publishing_mode', before, after: 'auto' });
    assert.equal(report.overall, 'WARN', 'a settings WARN degrades the overall to WARN, never FAIL');
  });

  it('OK when nothing changed, and a changed proof value is invisible to the check', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const proofA = JSON.stringify({ articleId: 34, verifiedAt: '2026-11-24T00:00:00.000Z', verdict: 'pass', checks: {} });
    db.prepare("INSERT INTO autonomy_settings (key, value) VALUES ('auto_publish_proof', ?)").run(proofA);
    const drafts = await currentDraftSnapshot(db);
    const settings = currentSettingsSnapshot(db);
    insertDailyReport(db, dateDaysAgo(1), 'daily', {
      healthReport: { snapshots: { protectedDrafts: drafts, settings } },
    });
    // The proof value changes (a new verification) — the settings
    // check must NOT report it: the key is excluded from both
    // snapshots by design (it is an A6 artifact, not a setting).
    const proofB = JSON.stringify({ articleId: 35, verifiedAt: '2026-11-25T00:00:00.000Z', verdict: 'pass', checks: {} });
    db.prepare("UPDATE autonomy_settings SET value = ? WHERE key = 'auto_publish_proof'").run(proofB);
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.settings.status, 'OK');
    assert.deepEqual(report.checks.settings.detail.changed, []);
    assert.ok(!('auto_publish_proof' in report.snapshots.settings.autonomy));
  });
});

/* ------------------------------------------------------------------ */
/* A5.6 — CSP violations in the last 7 days.                           */
/* ------------------------------------------------------------------ */
describe('A5.6 CSP violations warn with per-directive counts', () => {
  it('WARNs with counts, excludes the 8-day-old row, and is OK at 0 rows', async () => {
    const { db, env } = freshEnv();
    const ins = db.prepare(
      'INSERT INTO csp_reports (directive, blocked_uri, document_uri, reported_at) VALUES (?, ?, ?, ?)',
    );
    ins.run('script-src', 'https://a.example.com/1.js', `${PAGES_BASE}/`, sqliteDaysAgo(0));
    ins.run('script-src', 'https://a.example.com/2.js', `${PAGES_BASE}/`, sqliteDaysAgo(6));
    ins.run('img-src', 'https://b.example.com/p.png', `${PAGES_BASE}/`, sqliteDaysAgo(1));
    ins.run('script-src', 'https://old.example.com/o.js', `${PAGES_BASE}/`, sqliteDaysAgo(8));
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.cspViolations.status, 'WARN');
    assert.equal(report.checks.cspViolations.detail.total, 3);
    assert.deepEqual(report.checks.cspViolations.detail.byDirective, [
      { directive: 'script-src', count: 2 },
      { directive: 'img-src', count: 1 },
    ]);

    db.prepare('DELETE FROM csp_reports').run();
    const clean = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(clean.checks.cspViolations.status, 'OK');
    assert.equal(clean.checks.cspViolations.detail.total, 0);
  });
});

/* ------------------------------------------------------------------ */
/* A5.7 — lastRuns staleness.                                          */
/* ------------------------------------------------------------------ */
describe('A5.7 lastRuns: stale daily warns, missing is NOT TESTED, fresh is OK', () => {
  it('WARNs when the last daily report is more than 36 h old', async () => {
    const { db, env } = freshEnv();
    insertDailyReport(db, dateDaysAgo(2), 'daily', {});
    insertDailyReport(db, dateDaysAgo(3), 'weekly', {});
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.lastRuns.status, 'WARN');
    assert.ok(report.checks.lastRuns.detail.daily.ageHours > 36);
    assert.ok(report.checks.lastRuns.detail.weekly.ageHours <= 8 * 24, 'weekly 3 d old is still fresh');
  });

  it('is NOT TESTED when no daily or weekly row exists', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.lastRuns.status, 'NOT TESTED');
    assert.equal(report.checks.lastRuns.detail.daily, null);
    assert.equal(report.checks.lastRuns.detail.weekly, null);
  });

  it('is OK when yesterday’s daily and a 2-day-old weekly exist', async () => {
    const { db, env } = freshEnv();
    insertDailyReport(db, dateDaysAgo(1), 'daily', {});
    insertDailyReport(db, dateDaysAgo(2), 'weekly', {});
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.lastRuns.status, 'OK');
    assert.ok(report.checks.lastRuns.detail.daily.ageHours <= 36);
    assert.ok(report.checks.lastRuns.detail.weekly.ageHours <= 8 * 24);
  });
});

/* ------------------------------------------------------------------ */
/* A5.8 — sitemap-refresh workflow run (GitHub API, no auth).          */
/* ------------------------------------------------------------------ */
describe('A5.8 sitemap-refresh: API failure is NOT TESTED, success OK, failed run WARN', () => {
  it('is NOT TESTED when the GitHub API answers 403 (rate-limited, no auth by design)', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ github: 'forbidden' }),
    });
    assert.equal(report.checks.sitemapRefresh.status, 'NOT TESTED');
    assert.match(report.checks.sitemapRefresh.detail.reason, /HTTP 403/);
  });

  it('is NOT TESTED when the GitHub fetch itself fails', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ github: 'error' }),
    });
    assert.equal(report.checks.sitemapRefresh.status, 'NOT TESTED');
    assert.match(report.checks.sitemapRefresh.detail.reason, /fetch failed/);
  });

  it('is OK on a fresh successful run and reports the age (A7 warns when the last success is over 3 h old)', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ github: 'success' }),
    });
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.detail.conclusion, 'success');
    assert.equal(report.checks.sitemapRefresh.detail.runId, 123);
    assert.ok(report.checks.sitemapRefresh.detail.ageHours >= 0 && report.checks.sitemapRefresh.detail.ageHours < 2);
  });

  it('WARNs on a failed run', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch({ github: 'failure' }),
    });
    assert.equal(report.checks.sitemapRefresh.status, 'WARN');
    assert.equal(report.checks.sitemapRefresh.detail.conclusion, 'failure');
  });
});

/* ------------------------------------------------------------------ */
/* A5.9 — autoPublishProof (A6 wire-in).                               */
/* ------------------------------------------------------------------ */
describe('A5.9 autoPublishProof reads the recorded A6 proof', () => {
  function setProof(db, value) {
    db.prepare("INSERT OR REPLACE INTO autonomy_settings (key, value) VALUES ('auto_publish_proof', ?)").run(value);
  }

  it('is OK on a stored pass proof, with the article id in the detail', async () => {
    const { db, env } = freshEnv();
    setProof(db, JSON.stringify({
      articleId: 34, verifiedAt: '2026-11-24T01:00:00.000Z', verdict: 'pass',
      checks: { page: 'pass', divisionHome: 'pass', sitemap: 'pass', meta: 'pass', counts: 'pass' },
    }));
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.autoPublishProof.status, 'OK');
    assert.equal(report.checks.autoPublishProof.detail.articleId, 34);
    assert.equal(report.checks.autoPublishProof.detail.verdict, 'pass');
  });

  it('FAILs on a stored fail verdict', async () => {
    const { db, env } = freshEnv();
    setProof(db, JSON.stringify({ articleId: 34, verifiedAt: '2026-11-24T01:00:00.000Z', verdict: 'fail', checks: { page: 'fail' } }));
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.autoPublishProof.status, 'FAIL');
    assert.equal(report.checks.autoPublishProof.detail.verdict, 'fail');
  });

  it('FAILs on malformed (unparseable) proof JSON', async () => {
    const { db, env } = freshEnv();
    setProof(db, '{not json');
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.autoPublishProof.status, 'FAIL');
    assert.match(report.checks.autoPublishProof.detail.error, /unreadable/);
  });
});

/* ------------------------------------------------------------------ */
/* A5.10 — workerHealth / queue mapping from the drain health.         */
/* ------------------------------------------------------------------ */
describe('A5.10 workerHealth and queue map from the passed-in health result', () => {
  it('maps a degraded drain health to WARN on both checks', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, { health: degradedHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.workerHealth.status, 'WARN');
    assert.equal(report.checks.workerHealth.detail.overall, 'degraded');
    assert.equal(report.checks.workerHealth.detail.counts.degraded, 1);
    assert.equal(report.checks.queue.status, 'WARN');
    assert.equal(report.checks.queue.detail.queued, 12);
    assert.equal(report.checks.queue.detail.stale, 0);
    assert.equal(report.checks.queue.detail.oldestQueuedAt, '2026-11-20T00:00:00.000Z');
    assert.match(report.checks.queue.detail.reason, /12 task\(s\) queued/);
  });

  it('is NOT TESTED when no health result is passed in (never re-runs the health check)', async () => {
    const { env } = freshEnv();
    const report = await buildDailyHealthReport(env, { health: null, fetchImpl: makeMockFetch() });
    assert.equal(report.checks.workerHealth.status, 'NOT TESTED');
    assert.equal(report.checks.queue.status, 'NOT TESTED');
    // The builder must never call runHealthCheck itself (that writes
    // system_health_checks rows): no import of the healthcheck service
    // and no call expression (the name appears only in comments).
    const src = read('backend/services/daily-health-report.js');
    assert.ok(!src.includes('healthcheck.js'), 'builder never imports runHealthCheck');
    assert.ok(!/\brunHealthCheck\s*\(/.test(src), 'builder never calls runHealthCheck');
  });
});

/* ------------------------------------------------------------------ */
/* A5.11 — scheduler wiring: the daily run stores the report.          */
/* ------------------------------------------------------------------ */
describe('A5.11 scheduler wiring stores summary.healthReport in the daily row', () => {
  it('runDailyWorkflow writes healthReport into the daily_reports row', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const realFetch = global.fetch;
    global.fetch = makeMockFetch();
    try {
      const result = await runDailyWorkflow(env);
      assert.equal(result.ok, true);
      assert.ok(result.reportId, 'a report row id is returned');
      const row = db.prepare("SELECT * FROM daily_reports WHERE kind = 'daily'").get();
      assert.ok(row, 'exactly one daily report row');
      assert.equal(row.date, todayStr());
      const summary = JSON.parse(row.summary_json);
      assert.equal(summary.kind, 'daily');
      assert.equal(summary.steps.healthReport.outcome, 'done', 'the health-report step ran and finished');
      assert.ok(summary.healthReport, 'summary carries healthReport');
      assert.equal(summary.healthReport.date, todayStr());
      assert.ok(summary.healthReport.overall, 'overall is recorded');
      assertValidStatus(summary.healthReport);
      assert.equal(summary.healthReport.snapshots.protectedDrafts.length, 7, 'the baseline snapshot is stored with the report');
      // The queue drain's health result reaches the report (not null):
      // a fresh DB has no backup run, so the drain health is degraded
      // and the report says so honestly instead of NOT TESTED.
      assert.equal(summary.healthReport.checks.workerHealth.detail.overall, 'degraded');
      assert.equal(summary.healthReport.checks.workerHealth.status, 'WARN');
      assert.equal(summary.healthReport.checks.queue.status, 'OK', 'empty queue is healthy even while backup is degraded');
      // The weekly workflow is untouched: no healthReport there.
      assert.equal(summary.healthReport.checks.shortsCron.status, 'NOT TESTED');
    } finally {
      global.fetch = realFetch;
    }
  });
});

/* ------------------------------------------------------------------ */
/* A5.12 — dashboard: block ids, fetch, render.                        */
/* ------------------------------------------------------------------ */
describe('A5.12 dashboard renders the Daily Autonomy Health Report block', () => {
  it('dashboard.html has the block inside the Control Center section', () => {
    const html = read('frontend/pages/dashboard.html');
    const cc = html.slice(html.indexOf('id="section-control-center"'), html.indexOf('<!-- 1. Overview -->'));
    assert.ok(cc.includes('<h3>Daily Autonomy Health Report</h3>'), 'block heading');
    assert.ok(cc.includes('id="ccHealthReportList"'), 'check list element');
    assert.ok(cc.includes('id="ccHealthReportStatus"'), 'status element');
    assert.ok(cc.includes('00:00 UTC'), 'produced by the daily run at 00:00 UTC');
    assert.ok(cc.includes('OK / WARN / FAIL / NOT TESTED'), 'statuses explained');
    assert.ok(cc.includes('never publishes, edits or fixes anything'), 'read-only wording');
    // The block sits after the Daily / weekly reports block.
    assert.ok(cc.indexOf('id="ccHealthReportList"') > cc.indexOf('id="ccReportsList"'), 'health block follows the reports block');
  });

  it('dashboard.js fetches /api/autonomy/reports and renders one line per check', () => {
    const js = read('frontend/scripts/dashboard.js');
    assert.ok(js.includes('loadCcHealthReport'), 'loader exists');
    assert.ok(js.includes("'/api/autonomy/reports?kind=daily&limit=1'"), 'fetches the latest daily report');
    assert.ok(js.includes('summary.healthReport'), 'reads summary.healthReport');
    assert.ok(js.includes('loadCcHealthReport();'), 'called from loadControlCenter');
    assert.ok(js.includes('No health report recorded yet — the next daily run produces one.'), 'honest empty state');
    assert.ok(js.includes('Could not reach the FS AI server.'), 'honest unreachable state');
    assert.ok(js.includes('HEALTH_REPORT_LABELS'), 'per-check labels');
    assert.ok(js.includes('Worker health'), 'worker health label');
    assert.ok(js.includes('Daily Shorts cron'), 'shorts cron label');
  });

  it('dashboard-sections lists the new endpoint + element ids (A4 pattern)', () => {
    const test = read('tests/dashboard-sections.test.js');
    assert.ok(test.includes("'/api/autonomy/reports'"), 'endpoint added to the fetched-endpoints list');
    assert.ok(test.includes("'ccHealthReportList'"), 'list id added to the controls list');
    assert.ok(test.includes("'ccHealthReportStatus'"), 'status id added to the controls list');
  });
});

/* ------------------------------------------------------------------ */
/* A5.12b — vm fake-DOM render test (same harness shape as
   tests/control-center.test.js: minimal DOM shim + canned fetch drive
   the real dashboard.js and assert what it renders).                  */
/* ------------------------------------------------------------------ */
function makeDomSandbox(fetchImpl) {
  const byId = new Map();
  const textLog = [];
  const listeners = new Map();
  const dispatched = [];

  function registerIds(html) {
    if (typeof html !== 'string') return;
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (!byId.has(m[1])) byId.set(m[1], makeEl('div', m[1]));
    }
  }

  function makeEl(tag, id) {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      id: id || '',
      className: '',
      style: {},
      hidden: false,
      disabled: false,
      value: '',
      _text: '',
      _html: '',
      children: [],
      nextSibling: null,
      _attrs: {},
      setAttribute(name, value) { this._attrs[name] = String(value); if (name === 'id') { this.id = String(value); byId.set(this.id, this); } },
      getAttribute(name) { return this._attrs[name] ?? null; },
      addEventListener(type, fn) {
        if (!listeners.has(this)) listeners.set(this, {});
        const m = listeners.get(this);
        (m[type] = m[type] || []).push(fn);
      },
      appendChild(child) { this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
      insertBefore(child, ref) { this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
      querySelector() { return null; },
      closest() { return null; },
      scrollIntoView() {},
      reset() {},
      click() {},
    };
    Object.defineProperty(el, 'textContent', {
      get() { return this._text; },
      set(v) { this._text = String(v); if (this.id) textLog.push([this.id, String(v)]); },
    });
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html; },
      set(v) { this._html = String(v); registerIds(this._html); },
    });
    if (id) byId.set(id, el);
    return el;
  }

  const docListeners = {};
  const documentStub = {
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  };

  const sandbox = {
    console,
    document: documentStub,
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    fetch: fetchImpl,
    sessionStorage: {
      getItem() { return JSON.stringify({ mode: 'server', token: 'test-token' }); },
    },
    URL,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    __byId: byId,
    __textLog: textLog,
    __docListeners: docListeners,
    __dispatched: dispatched,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (type, fn) => { (sandbox.__winListeners[type] = sandbox.__winListeners[type] || []).push(fn); };
  sandbox.window.dispatchEvent = (ev) => { dispatched.push(ev && ev.type ? ev.type : String(ev)); return true; };
  sandbox.__winListeners = {};
  sandbox.window.FSAI = {
    esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    formatDate(d) { return String(d); },
    countsByDivision() { return []; },
    ARTICLES: [],
    DIVISIONS: [{}, {}, {}, {}, {}, {}, {}, {}],
    TOOLS: new Array(20).fill({}),
    AGENTS: new Array(16).fill({ name: 'Agent', role: 'role', status: 'active' }),
    ACCOUNTS: [],
    SITE: { revenue: '$0.00', traffic: 'Data unavailable' },
    sessionVerified: true,
    auth: { isSessionVerified() { return true; }, getSession() { return null; } },
  };
  const html = read('frontend/pages/dashboard.html');
  registerIds(html);
  const content = byId.get('dashboardContent');
  if (content) { content.hidden = false; content.style.display = ''; }
  return sandbox;
}

const tick = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function healthReportFixture() {
  const draft = (id) => ({ id, status: 'draft', bodyLength: 100 + id, bodyHash: 'a'.repeat(64) });
  return {
    date: '2026-11-23',
    generatedAt: '2026-11-23T00:05:00.000Z',
    overall: 'WARN',
    checks: {
      workerHealth: { status: 'OK', detail: { overall: 'healthy', counts: { healthy: 8, degraded: 0, blocked: 0, 'not-configured': 2 } } },
      pages: { status: 'OK', detail: { status: 200, url: `${PAGES_BASE}/` } },
      sitemap: { status: 'WARN', detail: { urlCount: 61, publishedCount: 25, missingIds: [], extraIds: [99] } },
      recentArticles: { status: 'OK', detail: { published: [], reachable: [], unreachable: [] } },
      queue: { status: 'OK', detail: { queued: 0, running: 0, stale: 0, oldestQueuedAt: null, reason: null } },
      lastRuns: { status: 'OK', detail: { daily: { date: '2026-11-22', ageHours: 24.1 }, weekly: { date: '2026-11-22', ageHours: 24.1 } } },
      sitemapRefresh: { status: 'OK', detail: { conclusion: 'success', createdAt: '2026-11-23T00:00:00.000Z', ageHours: 0.1, runId: 1, htmlUrl: 'https://github.com/mdalfahad841-code/fs-ai/actions/runs/1' } },
      protectedDrafts: { status: 'OK', detail: { drafts: PROTECTED_DRAFT_IDS.map(draft), changed: [], missing: [] } },
      settings: { status: 'OK', detail: { changed: [], autonomyKeys: 14, websiteKeys: 9 } },
      shortsCron: { status: 'NOT TESTED', detail: { reason: 'The daily Shorts cron lives in Muse (fs-ai-daily-short-upload), not in the Worker or D1 — the Worker cannot read its state. Resuming it is owner-gated (close-out C4).' } },
      lastVideo: { status: 'NOT TESTED', detail: { reason: 'youtube_videos has 0 rows in D1 — video outcomes live in the local pipeline log, not in D1; the D1 mirror is fed by manual Studio import only (migration 028).' } },
      cspViolations: { status: 'OK', detail: { total: 0, byDirective: [] } },
      autoPublishProof: { status: 'NOT TESTED', detail: { reason: 'No auto-published article has been verified yet — run docs/CLOSEOUT-A6-AUTO-PUBLISH-PROOF-2026-11-23.md after the first real auto-publish; its result is recorded here.' } },
    },
    snapshots: { protectedDrafts: [], settings: { autonomy: {}, website: {} } },
  };
}

// Canned fetch for the full dashboard load: the proven shape from
// tests/control-center.test.js, plus the /api/autonomy/reports route
// the new health-report block reads.
function cannedDashboardFetch(reports) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/api/autonomy/reports')) {
      return jsonResponse(200, { ok: true, reports, total: reports.length, source: 'd1' });
    }
    if (u.includes('/api/autonomy/status')) return jsonResponse(200, { ok: true,
      autonomyLevel: '3', targetLevel: '3', emergencyStop: false, publishingMode: 'approved_only',
      tasks: { queued: 0, running: 0, done: 2, failed: 0, skipped: 0 },
      autoFlags: { auto_research: 'on', auto_generation: 'on', auto_factcheck: 'on', auto_correction: 'off', auto_publishing: 'off' },
      source: 'd1' });
    if (u.includes('/api/autonomy/analytics')) return jsonResponse(200, { ok: true,
      articlesByStatus: { published: 25, draft: 6 },
      publishedToday: 0, drafts: [],
      llmToday: { calls: 5, neurons: 120 }, llm7d: { calls: 47, neurons: 778 },
      failedTasks: [], research: { activeSources: 24, itemsDiscovered: 693 } });
    if (u.includes('/api/social/status')) return jsonResponse(404, { ok: false, error: 'Not found' });
    if (u.includes('/api/analytics/detail?section=queue')) return jsonResponse(200, { ok: true, section: 'queue',
      data: { counts: { queued: 0, running: 0, done: 2, failed: 0, skipped: 0 }, oldestQueuedAt: null, oldestQueuedAgeHours: 0, failedTasks: [] },
      asOf: '2026-11-23T00:05:00.000Z',
      freshness: { asOf: '2026-11-23T00:05:00.000Z', checkedAt: '2026-11-23T00:05:00.000Z', stale: false, note: '' } });
    if (u.includes('/api/analytics/detail?section=ai-usage')) return jsonResponse(200, { ok: true, section: 'ai-usage',
      data: { today: { calls: 5, neurons: 120 }, last7d: { calls: 47, neurons: 778 }, capNeurons: 9000, todayPctOfCap: 1.3, remainingNeuronsToday: 8880 },
      asOf: '2026-11-23T00:05:00.000Z',
      freshness: { asOf: '2026-11-23T00:05:00.000Z', checkedAt: '2026-11-23T00:05:00.000Z', stale: false, note: '' } });
    if (u.includes('/api/analytics/detail?section=reports')) return jsonResponse(200, { ok: true, section: 'reports',
      data: { latestDaily: { kind: 'daily', date: '2026-11-23', created_at: '2026-11-23T00:05:00.000Z', summary: { errors: 0 } },
        latestWeekly: { kind: 'weekly', date: '2026-11-22', created_at: '2026-11-22T00:05:00.000Z', summary: { errors: 0 } },
        recent: [] },
      asOf: '2026-11-23T00:05:00.000Z',
      freshness: { asOf: '2026-11-23T00:05:00.000Z', checkedAt: '2026-11-23T00:05:00.000Z', stale: false, note: '' } });
    if (u.includes('/api/health/latest')) return jsonResponse(404, { ok: false, error: 'Not found' });
    if (u.includes('/api/analytics')) return jsonResponse(200, { ok: true,
      visitors: 'Data unavailable', pageViews: 'Data unavailable', clicks: 'Data unavailable',
      revenue: 0, revenueFormatted: '$0.00', analyticsConnected: false,
      analyticsStatus: 'Tracking Connected — Reporting API Not Connected',
      note: 'Tracking Connected — Reporting API Not Connected: GA4 tag live, no Reporting API.' });
    if (u.includes('/api/articles')) return jsonResponse(200, { ok: true, articles: [], total: 25 });
    if (u.includes('/api/divisions')) return jsonResponse(200, { ok: true, divisions: [] });
    if (u.includes('/api/admin/articles')) return jsonResponse(200, { ok: true, articles: [] });
    if (u.includes('/api/admin/divisions')) return jsonResponse(200, { ok: true, divisions: [] });
    if (u.includes('/api/tools')) return jsonResponse(200, { ok: true, tools: [] });
    if (u.includes('/api/admin/emergency-stop')) return jsonResponse(200, { ok: true, stopped: false });
    if (u.includes('/api/agents')) return jsonResponse(200, { ok: true, agents: [], source: 'd1' });
    if (u.includes('/api/accounts')) return jsonResponse(200, { ok: true, accounts: [], source: 'api' });
    if (u.includes('/api/admin/subscribers')) return jsonResponse(200, { ok: true, subscribers: [], total: 0 });
    if (u.startsWith('https://fs-ai-5w5.pages.dev/')) return jsonResponse(200, '<html><head><link rel="canonical" href="https://fs-ai-5w5.pages.dev/"></head></html>');
    return jsonResponse(404, { ok: false, error: 'Not found' });
  };
}

async function runDashboardJs(reports) {
  const sandbox = makeDomSandbox(cannedDashboardFetch(reports));
  vm.createContext(sandbox);
  const src = read('frontend/scripts/dashboard.js');
  vm.runInContext(src, sandbox);
  for (const fn of sandbox.__docListeners.DOMContentLoaded || []) fn();
  await tick();
  const byId = sandbox.__byId;
  return {
    htmlOf: (id) => (byId.get(id) ? byId.get(id).innerHTML : ''),
    textOf: (id) => (byId.get(id) ? byId.get(id).textContent : ''),
  };
}

describe('A5.12b dashboard.js renders the health report in a fake DOM', () => {
  it('renders one line per check plus the overall line', async () => {
    const report = healthReportFixture();
    const { htmlOf, textOf } = await runDashboardJs([{
      kind: 'daily', date: '2026-11-23', created_at: '2026-11-23T00:05:00.000Z',
      summary: { healthReport: report },
    }]);
    const html = htmlOf('ccHealthReportList');
    assert.ok(html.includes('Worker health'), 'worker health line rendered');
    assert.ok(html.includes('OK'), 'OK status rendered');
    assert.ok(html.includes('Sitemap'), 'sitemap line rendered');
    assert.ok(html.includes('WARN'), 'WARN status rendered');
    assert.ok(html.includes('extra'), 'sitemap detail names the extra id');
    assert.ok(html.includes('Protected drafts'), 'protected drafts line rendered');
    assert.ok(html.includes('7 drafts unchanged'), 'protected drafts detail rendered');
    assert.ok(html.includes('Daily Shorts cron'), 'shorts cron line rendered');
    assert.ok(html.includes('NOT TESTED'), 'NOT TESTED status rendered');
    assert.ok(html.includes('Last video'), 'last video line rendered');
    assert.ok(html.includes('Auto-publish proof'), 'auto-publish proof line rendered');
    const status = textOf('ccHealthReportStatus');
    assert.ok(status.includes('Overall: WARN'), 'overall line shows WARN');
    assert.ok(status.includes('2026-11-23'), 'overall line names the report date');
  });

  it('renders the honest empty state when no report has a healthReport yet', async () => {
    const { htmlOf, textOf } = await runDashboardJs([]);
    assert.ok(htmlOf('ccHealthReportList').includes('No health report recorded yet'), 'empty state listed');
    assert.ok(textOf('ccHealthReportStatus').includes('No health report recorded yet'), 'empty state status');
  });

  it('renders the honest empty state when the latest report predates A5', async () => {
    const { htmlOf } = await runDashboardJs([{
      kind: 'daily', date: '2026-11-22', created_at: '2026-11-22T00:05:00.000Z',
      summary: { errors: 0 },
    }]);
    assert.ok(htmlOf('ccHealthReportList').includes('No health report recorded yet'), 'pre-A5 report has no healthReport');
  });
});

/* ------------------------------------------------------------------ */
/* A6.1 — the proof script is write-only and safe (source assertions). */
/* ------------------------------------------------------------------ */
describe('A6.1 verify-auto-publish script is write-only and safe', () => {
  it('takes the article id as its single argument and prints the SQL for the parent', () => {
    const script = read('scripts/verify-auto-publish.mjs');
    assert.ok(script.includes('process.argv[2]'), 'article id comes from the single CLI argument');
    assert.ok(script.includes('Usage: node scripts/verify-auto-publish.mjs <article-id>'), 'usage names the single argument');
    assert.ok(script.includes("INSERT OR REPLACE INTO autonomy_settings (key, value, updated_at) VALUES ('auto_publish_proof'"), 'prints the exact D1 SQL');
    assert.ok(script.includes('for the PARENT to run'), 'the SQL is for the parent to run, not the script');
    assert.ok(script.includes('This script has no credentials and cannot write to D1 itself'), 'states it cannot write to D1');
  });

  it('never writes to D1, never publishes, never touches an article', () => {
    const script = read('scripts/verify-auto-publish.mjs');
    for (const banned of ['d1Run', 'd1.run', 'wrangler', 'publishDueArticles', 'runAutoPublish', "method: 'POST'", 'method: "POST"']) {
      assert.ok(!script.includes(banned), 'must not contain ' + banned);
    }
    assert.ok(script.includes('PROTECTED_IDS'), 'refuses protected / legacy ids');
    assert.ok(script.includes('Refusing article #'), 'refusal message for protected ids');
  });

  it('tells the operator to wait for the next hourly sitemap refresh instead of claiming instant updates', () => {
    const script = read('scripts/verify-auto-publish.mjs');
    assert.ok(script.includes("'WAIT'"), 'sitemap check can be WAIT, not just PASS/FAIL');
    assert.ok(script.includes('HOURLY'), 'sitemap refreshes hourly');
    assert.ok(script.includes('wait for the next refresh and re-run'), 'operator is told to wait and re-run');
    assert.ok(script.includes('Do not record the proof until this check passes'), 'no proof before the sitemap check passes');
  });

  it('states the no-JS crawler caveat for the meta check', () => {
    const script = read('scripts/verify-auto-publish.mjs');
    assert.ok(script.includes('no-JS crawler'), 'names the no-JS crawler limit');
    assert.ok(script.includes('A3 crawler report'), 'points at the A3 crawler report');
    assert.ok(script.includes("setMeta('og:title'"), 'checks the served JS applies og:title');
    assert.ok(script.includes("setMeta('og:url'"), 'checks the served JS applies og:url');
  });

  it('exits non-zero unless every check passes', () => {
    const script = read('scripts/verify-auto-publish.mjs');
    assert.ok(script.includes('process.exitCode = 1'), 'FAIL/WAIT exits non-zero');
    assert.ok(script.includes('process.exitCode = 0'), 'all-PASS exits zero');
  });

  it('the doc exists and states it must not run until the first real auto-publish', () => {
    const doc = read('docs/CLOSEOUT-A6-AUTO-PUBLISH-PROOF-2026-11-23.md');
    assert.ok(doc.includes('DO NOT RUN'), 'doc leads with DO NOT RUN');
    assert.ok(doc.includes('No real auto-published article exists'), 'states no real auto-published article exists yet');
    assert.ok(doc.includes('#34 is still a draft'), 'names #34 as still a draft');
    assert.ok(doc.includes('node scripts/verify-auto-publish.mjs'), 'gives the exact run command');
    assert.ok(doc.includes('INSERT OR REPLACE INTO autonomy_settings'), 'gives the exact SQL step');
    assert.ok(doc.includes('autoPublishProof: OK'), 'states what the next daily health report will show');
    assert.ok(doc.includes('drafts went 7 -> 6'), 'manual draft-count confirmation is in the procedure');
    assert.ok(doc.includes('BUILT, write-only, NOT RUN'), 'status is built, write-only, not run');
  });
});
