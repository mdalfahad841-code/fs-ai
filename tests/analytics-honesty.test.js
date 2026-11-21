// FS AI — Workstream E: analytics honesty tests.
//
// Every metric the owner asked about (article impressions / clicks /
// CTR, search performance, indexed pages, social engagement, video
// views, watch time, traffic sources, revenue) must be VERIFIED (real
// D1/platform data), ESTIMATED (labelled with its method — nothing in
// this codebase estimates, so that count is always 0), or UNAVAILABLE
// (labelled, with the exact reason + what would make it available).
// Unavailable is never 0, never a fabricated number, never a silent
// estimate. Stale snapshots are flagged; freshness timestamps are
// always present. Analytics is read-only: it never writes a setting
// and never changes publishing policy (proven by the source scan at
// the end of this file).
// Run: node --test tests/analytics-honesty.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  handleAnalyticsDetail, handleAnalytics, coverageTable,
  GA4_UNAVAILABLE, ANALYTICS_SNAPSHOT_STALE_AFTER_MS,
} = require('../backend/routes/analytics.js');

const ROOT = path.join(__dirname, '..');
const TODAY = new Date().toISOString().slice(0, 10);

// --- Real-SQLite harness (same pattern as tests/control-center.test.js) ---
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

function freshEnv(extraFiles = []) {
  const db = buildDb([...BASE_FILES, ...extraFiles]);
  return { db, env: { DB: makeRealD1(db) } };
}

async function detail(env, section) {
  const res = await handleAnalyticsDetail(
    new Request('https://fs-ai.test/api/analytics/detail?section=' + encodeURIComponent(section)),
    env,
  );
  assert.equal(res.status, 200, 'detail/' + section + ' must answer 200');
  return res.json();
}

function setRevenue(db, value) {
  db.prepare(
    "INSERT INTO website_settings (setting_key, setting_value, updated_at) VALUES ('total_revenue_usd', ?, ?) " +
    "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
  ).run(String(value), new Date().toISOString());
}

function insertSnapshot(db, { source, date, views, visitors, clicks }) {
  db.prepare('DELETE FROM website_analytics').run();
  db.prepare(
    'INSERT INTO website_analytics (recorded_date, source, page_views, unique_visitors, clicks, top_page, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(date, source, views, visitors, clicks, null, null);
}

// ---------------------------------------------------------------------------
// Impressions / clicks / CTR — unavailable on the seed, verified on real data
// ---------------------------------------------------------------------------
describe('analytics honesty — impressions / clicks / CTR', () => {
  it('seed snapshot (source none, NULL metrics) is unavailable, never zero', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'impressions');
    assert.equal(r.data.status, 'unavailable');
    assert.equal(r.data.value, null);
    assert.ok(!('pageViews' in r.data) || r.data.pageViews === null || r.data.pageViews === undefined,
      'no fabricated page-view number');
    assert.ok(!('clicks' in r.data) || r.data.clicks === null || r.data.clicks === undefined,
      'no fabricated click number');
    assert.ok(r.data.reason.length > 20, 'a real reason is given');
    assert.ok(r.data.whatWouldMakeAvailable, 'what would make it available is stated');
    assert.ok(r.asOf && r.freshness && r.freshness.asOf, 'freshness timestamps present');
  });

  it('a real snapshot is verified with CTR computed from the same row', async () => {
    const { db, env } = freshEnv();
    insertSnapshot(db, { source: 'google_analytics', date: TODAY, views: 1000, visitors: 800, clicks: 40 });
    const r = await detail(env, 'impressions');
    assert.equal(r.data.status, 'verified');
    assert.equal(r.data.pageViews, 1000);
    assert.equal(r.data.uniqueVisitors, 800);
    assert.equal(r.data.clicks, 40);
    assert.equal(r.data.ctr, 4);
    assert.equal(r.data.stale, false);
    assert.equal(r.freshness.stale, false);
    assert.ok(r.data.source.includes('google_analytics'));
  });

  it('CTR is null when either input is missing — never estimated', async () => {
    const { db, env } = freshEnv();
    insertSnapshot(db, { source: 'google_analytics', date: TODAY, views: null, visitors: 500, clicks: 40 });
    const r = await detail(env, 'impressions');
    assert.equal(r.data.status, 'verified');
    assert.equal(r.data.clicks, 40);
    assert.equal(r.data.ctr, null, 'CTR without page_views is null, not guessed');
    assert.match(r.data.ctrNote, /never|needs real/i);
  });

  it('a snapshot older than 7 days is flagged stale in data and freshness', async () => {
    const { db, env } = freshEnv();
    insertSnapshot(db, { source: 'google_analytics', date: '2026-10-01', views: 500, visitors: 400, clicks: 10 });
    const r = await detail(env, 'impressions');
    assert.equal(r.data.status, 'verified');
    assert.equal(r.data.stale, true);
    assert.equal(r.freshness.stale, true);
    assert.match(r.data.staleNote, /older than 7 days/);
    // Legacy endpoint agrees.
    const legacy = await handleAnalytics(new Request('https://fs-ai.test/api/analytics'), env);
    const legacyBody = await legacy.json();
    assert.equal(legacyBody.snapshotStale, true);
    assert.equal(legacyBody.pageViews, 500);
    assert.equal(legacyBody.analyticsConnected, true);
  });

  it('a fresh real snapshot is not stale on the legacy endpoint', async () => {
    const { db, env } = freshEnv();
    insertSnapshot(db, { source: 'cloudflare', date: TODAY, views: 120, visitors: 90, clicks: 3 });
    const legacy = await handleAnalytics(new Request('https://fs-ai.test/api/analytics'), env);
    const body = await legacy.json();
    assert.equal(body.snapshotStale, false);
    assert.equal(body.clicks, 3);
  });
});

// ---------------------------------------------------------------------------
// Search / indexed / video / traffic sources — unavailable with a reason
// ---------------------------------------------------------------------------
describe('analytics honesty — search, indexed, video, traffic sources', () => {
  const cases = [
    ['search', /Search Console/],
    ['indexed', /Indexed-page|indexed/i],
    ['video', /YouTube|video/i],
    ['traffic-sources', /GA4/],
  ];
  for (const [section, reasonRe] of cases) {
    it(`${section} is unavailable with a reason and a path to availability`, async () => {
      const { env } = freshEnv();
      const r = await detail(env, section);
      assert.equal(r.data.status, 'unavailable', section + ' must not claim data');
      assert.equal(r.data.value, null, section + ' value must be null, not 0');
      assert.match(r.data.reason, reasonRe);
      assert.ok(r.data.whatWouldMakeAvailable, section + ' must say what would make it available');
      assert.ok(r.asOf && r.freshness && r.freshness.asOf, 'freshness timestamps present');
      // No numeric metric anywhere in the payload.
      const text = JSON.stringify(r.data);
      assert.ok(!/"views":\d/.test(text) && !/"watchTimeMinutes":\d/.test(text),
        'no fabricated video/traffic numbers');
    });
  }

  it('traffic keeps the GA4 wording and gains whatWouldMakeAvailable', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'traffic');
    assert.deepEqual(
      { status: r.data.traffic.status, value: r.data.traffic.value },
      { status: GA4_UNAVAILABLE.status, value: GA4_UNAVAILABLE.value },
    );
    assert.ok(r.data.traffic.whatWouldMakeAvailable.includes('GA4 Data API'));
    assert.equal(r.data.search.status, 'unavailable');
  });
});

// ---------------------------------------------------------------------------
// Revenue — reads the real setting, nothing else
// ---------------------------------------------------------------------------
describe('analytics honesty — revenue', () => {
  it('reads $0.00 from the live setting and follows the setting when it changes', async () => {
    const { db, env } = freshEnv();
    let r = await detail(env, 'revenue');
    assert.equal(r.data.status, 'verified');
    assert.equal(r.data.totalRevenueUsd, 0);
    assert.equal(r.data.formatted, '$0.00');
    assert.equal(r.data.adsenseConnected, false);
    assert.equal(r.data.source, 'website_settings.total_revenue_usd');
    setRevenue(db, '12.34');
    r = await detail(env, 'revenue');
    assert.equal(r.data.totalRevenueUsd, 12.34);
    assert.equal(r.data.formatted, '$12.34');
  });
});

// ---------------------------------------------------------------------------
// Social / engagement — unavailable pre-migration, verified once tables exist
// ---------------------------------------------------------------------------
describe('analytics honesty — social engagement', () => {
  it('unavailable while migration 022 tables do not exist', async () => {
    const { env } = freshEnv();
    const social = await detail(env, 'social');
    assert.equal(social.data.status, 'unavailable');
    assert.equal(social.data.value, null);
    assert.ok(social.data.whatWouldMakeAvailable.includes('migration 022'));
    const eng = await detail(env, 'engagement');
    assert.equal(eng.data.status, 'unavailable');
    assert.equal(eng.data.value, null);
  });

  it('verified counts once migration 022 tables hold real rows', async () => {
    const { db, env } = freshEnv(['database/migrations/022_social_media.sql']);
    db.prepare(
      "INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, created_at, updated_at) VALUES (1, 'pinterest', 'article:1:pinterest', 'published', 'x', '2026-11-21T10:00:00.000Z', '2026-11-21T10:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, created_at, updated_at) VALUES (2, 'pinterest', 'article:2:pinterest', 'draft', 'y', '2026-11-21T10:00:00.000Z', '2026-11-21T10:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO social_analytics (social_post_id, platform, metric, value, recorded_at) VALUES (1, 'pinterest', 'saves', 7, '2026-11-21T11:00:00.000Z')",
    ).run();
    const social = await detail(env, 'social');
    assert.equal(social.data.status, 'verified');
    assert.equal(social.data.totalPosts, 2);
    assert.deepEqual(social.data.byPlatform, [{ platform: 'pinterest', posts: 2 }]);
    const eng = await detail(env, 'engagement');
    assert.equal(eng.data.status, 'verified');
    assert.equal(eng.data.rows.length, 1);
    assert.equal(eng.data.rows[0].metric, 'saves');
    assert.equal(eng.data.rows[0].value, 7);
  });
});

// ---------------------------------------------------------------------------
// Coverage table — one row per metric, nothing estimated
// ---------------------------------------------------------------------------
describe('analytics honesty — coverage table', () => {
  it('section=all carries a coverage table: 10 metrics, 1 verified, 0 estimated, 9 unavailable (seed DB)', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'all');
    assert.ok(r.coverage, 'all must include the coverage table');
    assert.equal(r.coverage.rows.length, 10);
    assert.deepEqual(
      r.coverage.rows.map((x) => x.metric),
      ['articleImpressions', 'articleClicks', 'articleCtr', 'searchPerformance', 'indexedPages',
        'socialEngagement', 'videoViews', 'watchTime', 'trafficSources', 'revenue'],
    );
    assert.equal(r.coverage.verified, 1, 'only revenue is verified on the seed DB');
    assert.equal(r.coverage.estimated, 0, 'nothing is ever estimated');
    assert.equal(r.coverage.unavailable, 9);
    const revenue = r.coverage.rows.find((x) => x.metric === 'revenue');
    assert.equal(revenue.status, 'verified');
    for (const row of r.coverage.rows.filter((x) => x.status === 'unavailable')) {
      assert.ok(row.reason, row.metric + ' unavailable row must carry a reason');
      assert.ok(row.whatWouldMakeAvailable, row.metric + ' unavailable row must say what would make it available');
    }
    // New sections are present in `all` with data/asOf/freshness.
    for (const name of ['impressions', 'search', 'indexed', 'video', 'traffic-sources']) {
      assert.ok(r.data[name], 'all must include section ' + name);
      assert.ok('data' in r.data[name] && r.data[name].asOf && r.data[name].freshness);
    }
  });

  it('coverageTable is pure: verified follows the section data given', () => {
    const c = coverageTable({
      impressions: { status: 'verified', ctr: 4 },
      search: { status: 'unavailable', reason: 'x' },
      indexed: { status: 'unavailable', reason: 'x' },
      engagement: { status: 'verified' },
      video: { status: 'unavailable', reason: 'x' },
      'traffic-sources': { status: 'unavailable', reason: 'x' },
      revenue: { status: 'verified' },
    });
    assert.equal(c.verified, 5);
    assert.equal(c.estimated, 0);
    assert.equal(c.unavailable, 5);
    assert.equal(c.rows.find((x) => x.metric === 'articleCtr').status, 'verified');
  });

  it('unknown section stays a 400 — a crafted section name is never SQL', async () => {
    const { env } = freshEnv();
    const res = await handleAnalyticsDetail(
      new Request("https://fs-ai.test/api/analytics/detail?section=fact_checks'; DROP TABLE articles; --"), env);
    assert.equal(res.status, 400);
    // Table survives: count via a fresh detail call.
    const r = await detail(env, 'articles');
    assert.equal(r.data.published, 25);
  });
});

// ---------------------------------------------------------------------------
// Feedback loop + read-only guarantee (source scan — the guardrail)
// ---------------------------------------------------------------------------
describe('analytics honesty — feedback loop is read-only', () => {
  it('analytics.js never writes: no d1Run, no settings/E-Stop write', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'analytics.js'), 'utf8');
    assert.ok(!src.includes('d1Run'), 'analytics must not import or call d1Run');
    assert.ok(!src.includes('INSERT INTO'), 'analytics must not INSERT');
    assert.ok(!src.includes('UPDATE '), 'analytics must not UPDATE');
    assert.ok(!src.includes('DELETE FROM'), 'analytics must not DELETE');
    assert.ok(!src.includes("setting_value = "), 'analytics must not write settings');
  });

  it('the only autonomy_settings writer in backend/ is the owner-only settings handler', () => {
    const backend = path.join(ROOT, 'backend');
    const writers = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith('.js')) {
          const src = fs.readFileSync(p, 'utf8');
          if (/INSERT INTO autonomy_settings|UPDATE autonomy_settings/.test(src)) writers.push(path.relative(ROOT, p));
        }
      }
    };
    walk(backend);
    assert.deepEqual(writers, ['backend/routes/orchestrator.js'],
      'analytics, scheduler and every other module must never write a setting — only the owner settings endpoint may');
  });

  it('no module writes the Emergency Stop except the owner admin handler', () => {
    const backend = path.join(ROOT, 'backend');
    const writers = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith('.js')) {
          const src = fs.readFileSync(p, 'utf8');
          if (/INSERT INTO website_settings[\s\S]{0,200}emergency_stop|setEmergencyStop\(env,\s*(true|stopped)/.test(src)
            && !p.endsWith('routes/admin.js')) writers.push(path.relative(ROOT, p));
        }
      }
    };
    walk(backend);
    assert.deepEqual(writers, [], 'nothing but admin.js may write the Emergency Stop flag');
  });

  it('ANALYTICS_SNAPSHOT_STALE_AFTER_MS is 7 days', () => {
    assert.equal(ANALYTICS_SNAPSHOT_STALE_AFTER_MS, 7 * 24 * 60 * 60 * 1000);
  });
});
