// FS AI — Close-out A7 (workflow upkeep + sitemap-refresh staleness alert) tests, 2026-11-23.
//
// Covers A7 against the SHIPPED files (real in-memory SQLite via
// node:sqlite, mock fetchImpl — never the network):
//   A7.1 staleness alert — a last SUCCESSFUL sitemap-refresh run older
//         than 3 h WARNs (and flips the overall to WARN); a fresh
//         success stays OK; exactly 3.0 h stays OK (strictly older
//         than 3 h); an unparseable timestamp stays OK (age unknown,
//         cannot prove staleness); failure / in-progress behaviour is
//         unchanged from A5
//   A7.2 workflow file — sitemap-refresh.yml uses actions/checkout@v7
//         + actions/setup-node@v7 (current non-deprecated versions,
//         Node 24 runtime), no @v4 action remains, and everything else
//         is identical: hourly schedule, node-version '20',
//         permissions, concurrency, triggers, regenerate + commit steps
//
// Run: node --test tests/closeout-a7.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  buildDailyHealthReport,
  SERVER_SIDE_HEAD_SAMPLES,
  SITEMAP_REFRESH_STALE_HOURS,
} = require('../backend/services/daily-health-report.js');

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

// Same DB shape as tests/closeout-a5.test.js freshDb.
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
    'database/migrations/028_youtube_analytics.sql',
    'database/migrations/030_csp_reports.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
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

const DIVISION_SLUGS = ['automotive', 'ai-technology', 'gadgets-electronics', 'finance-money',
  'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning'];

function sitemapXml(articleIds) {
  const locs = [`${PAGES_BASE}/`,
    ...articleIds.map((id) => `${PAGES_BASE}/pages/article?id=${id}`),
    ...DIVISION_SLUGS.map((s) => `${PAGES_BASE}/pages/division?division=${s}`)];
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + locs.map((u) => `<url><loc>${u}</loc><lastmod>2026-11-01</lastmod></url>`).join('') + '</urlset>';
}

/* Server-side heads fixture (Fix Pass 2, item 2): the canned rewritten
   HTML the mock serves for the five check-14 sample URLs, built
   independently of the rewrite module. Canonical copy:
   tests/fixpass2-item2.test.js (sampleHeadHtml). The default map uses
   the SEED titles/dates, identical in every fresh DB in this file. */
function sampleHeadHtml({ kind, title, date, url }) {
  const jsonLd = kind === 'article'
    ? `{"@context":"https://schema.org","@type":"Article","datePublished":"${date}"}`
    : kind === 'division'
      ? '{"@context":"https://schema.org","@type":"CollectionPage"}'
      : '{"@context":"https://schema.org","@type":"WebApplication"}';
  const meta = kind === 'article'
    ? `<meta property="article:published_time" content="${date}">`
    : '';
  const noscript = kind === 'article'
    ? `<noscript><h1>${title}</h1><p>The article body text.</p></noscript>`
    : kind === 'division'
      ? '<noscript><ul><li><a href="article?id=1">An article</a></li></ul></noscript>'
      : '<noscript>Does a calculation.</noscript>';
  return '<!doctype html><html><head><title>' + title + ' — FS AI</title>'
    + '<link rel="canonical" href="' + url + '">'
    + '<meta property="og:url" content="' + url + '">' + meta
    + '<script type="application/ld+json">' + jsonLd + '</script></head><body>'
    + noscript + '</body></html>';
}

const SEED_HEAD_SAMPLES = {
  1: { title: 'EV Charging at Home: A Complete Beginner\'s Guide', date: '2026-11-01' },
  12: { title: 'Best Family Cars Compared: Space, Safety and Running Costs', date: '2026-11-06' },
  25: { title: 'How to Plan a Road Trip: Checklist and Costs', date: '2026-11-11' },
  automotive: { title: 'Automotive' },
  percentage: { title: 'Percentage Calculator' },
};

function defaultHeadsHtml() {
  const map = {};
  for (const s of SERVER_SIDE_HEAD_SAMPLES) {
    const url = PAGES_BASE + s.path;
    const sample = s.kind === 'article'
      ? { kind: 'article', title: SEED_HEAD_SAMPLES[s.id].title, date: SEED_HEAD_SAMPLES[s.id].date, url }
      : s.kind === 'division'
        ? { kind: 'division', title: SEED_HEAD_SAMPLES[s.slug].title, url }
        : { kind: 'tool', title: SEED_HEAD_SAMPLES[s.slug].title, url };
    map[url] = sampleHeadHtml(sample);
  }
  return map;
}

/* Mock fetchImpl: never touches the network. The GitHub run answers
   per `github`: 'success' (fresh, 1 h old) | 'stale-success' (5 h old)
   | 'boundary' (exactly 3.0 h old) | 'just-over' (3.1 h old)
   | 'success-bad-date' (unparseable created_at) | 'failure'
   | 'in-progress' (conclusion null). */
function makeMockFetch({ github = 'success', headsHtml = defaultHeadsHtml() } = {}) {
  return async (url) => {
    const u = String(url);
    // A sample URL with a canned rewritten head answers first: the
    // fixture models a site where the Pages Function is live.
    if (headsHtml && Object.prototype.hasOwnProperty.call(headsHtml, u)) {
      return { status: 200, text: async () => headsHtml[u] };
    }
    if (u.includes('api.github.com')) {
      const ageHours = {
        success: 1, 'stale-success': 5, boundary: 3, 'just-over': 3.1,
      }[github] ?? 1;
      const conclusion = github === 'failure' ? 'failure' : (github === 'in-progress' ? null : 'success');
      const createdAt = github === 'success-bad-date'
        ? 'not-a-date'
        : new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
      return {
        status: 200,
        text: async () => JSON.stringify({
          workflow_runs: [{
            conclusion,
            created_at: createdAt,
            id: 123,
            html_url: 'https://github.com/mdalfahad841-code/fs-ai/actions/runs/123',
          }],
        }),
      };
    }
    if (u.endsWith('/sitemap.xml')) {
      return { status: 200, text: async () => sitemapXml(Array.from({ length: 25 }, (_, i) => i + 1)) };
    }
    if (u.includes('/pages/article?id=')) return { status: 200, text: async () => '' };
    if (u === `${PAGES_BASE}/`) return { status: 200, text: async () => '<html></html>' };
    return { status: 404, text: async () => '' };
  };
}

async function reportFor(github) {
  const { env } = freshEnv();
  return buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch({ github }) });
}

/* ------------------------------------------------------------------ */
/* A7.1 — staleness alert on the last successful sitemap-refresh run.  */
/* ------------------------------------------------------------------ */
describe('A7.1 sitemapRefresh: a last success older than 3 h WARNs', () => {
  it('exports the 3-hour staleness limit', () => {
    assert.equal(SITEMAP_REFRESH_STALE_HOURS, 3);
  });

  it('is OK on a fresh (1 h old) successful run', async () => {
    const report = await reportFor('success');
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.detail.conclusion, 'success');
    assert.ok(report.checks.sitemapRefresh.detail.ageHours >= 0
      && report.checks.sitemapRefresh.detail.ageHours <= 3);
    assert.equal(report.overall, 'OK');
  });

  it('WARNs on a 5 h old successful run, reports the age, and flips the overall to WARN', async () => {
    const report = await reportFor('stale-success');
    assert.equal(report.checks.sitemapRefresh.status, 'WARN');
    assert.equal(report.checks.sitemapRefresh.detail.conclusion, 'success');
    assert.ok(report.checks.sitemapRefresh.detail.ageHours > 3,
      'age must be reported above the limit, got ' + report.checks.sitemapRefresh.detail.ageHours);
    assert.match(report.checks.sitemapRefresh.detail.reason, /5/);
    assert.match(report.checks.sitemapRefresh.detail.reason, /3 h/);
    assert.match(report.checks.sitemapRefresh.detail.reason, /hourly/);
    assert.equal(report.overall, 'WARN');
  });

  it('stays OK at exactly 3.0 h old — the rule is strictly older than 3 h', async () => {
    const report = await reportFor('boundary');
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.detail.ageHours, 3);
  });

  it('WARNs just over the limit (3.1 h old)', async () => {
    const report = await reportFor('just-over');
    assert.equal(report.checks.sitemapRefresh.status, 'WARN');
    assert.equal(report.checks.sitemapRefresh.detail.ageHours, 3.1);
  });

  it('stays OK on a success with an unparseable timestamp — age unknown cannot prove staleness', async () => {
    const report = await reportFor('success-bad-date');
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.detail.ageHours, null);
  });

  it('still WARNs on a failed run (A5 behaviour unchanged)', async () => {
    const report = await reportFor('failure');
    assert.equal(report.checks.sitemapRefresh.status, 'WARN');
    assert.equal(report.checks.sitemapRefresh.detail.conclusion, 'failure');
  });

  it('is still NOT TESTED while the latest run is in progress (A5 behaviour unchanged)', async () => {
    const report = await reportFor('in-progress');
    assert.equal(report.checks.sitemapRefresh.status, 'NOT TESTED');
    assert.match(report.checks.sitemapRefresh.detail.reason, /in progress/);
  });
});

/* ------------------------------------------------------------------ */
/* A7.2 — sitemap-refresh.yml uses the current non-deprecated actions. */
/* ------------------------------------------------------------------ */
describe('A7.2 sitemap-refresh.yml: checkout + setup-node on v7, everything else identical', () => {
  const yml = read('.github/workflows/sitemap-refresh.yml');

  it('uses actions/checkout@v7 and actions/setup-node@v7', () => {
    assert.ok(yml.includes('uses: actions/checkout@v7'), 'checkout must be v7');
    assert.ok(yml.includes('uses: actions/setup-node@v7'), 'setup-node must be v7');
  });

  it('has no Node 20 action left (no @v4 action remains)', () => {
    assert.ok(!yml.includes('@v4'), 'no action may still be on v4');
    assert.ok(!yml.includes('actions/checkout@v5'), 'must not stop at the superseded v5');
    assert.ok(!yml.includes('actions/setup-node@v5'), 'must not stop at the superseded v5');
  });

  it('keeps the hourly schedule, node-version, permissions, concurrency and triggers', () => {
    assert.ok(yml.includes("cron: '0 * * * *'"), 'hourly schedule must stay');
    assert.ok(yml.includes("node-version: '20'"), 'installed Node version must stay 20 (behaviour identical)');
    assert.ok(yml.includes('contents: write'), 'permissions must stay');
    assert.ok(yml.includes('group: sitemap-refresh'), 'concurrency group must stay');
    assert.ok(yml.includes('workflow_dispatch'), 'manual trigger must stay');
    assert.ok(yml.includes('fetch-depth: 0'), 'checkout fetch-depth must stay');
  });

  it('keeps the regenerate + commit-only-if-changed steps byte-identical in intent', () => {
    assert.ok(yml.includes('node scripts/regenerate-sitemap.mjs --from-api --require-live'),
      'regenerate command must stay');
    assert.ok(yml.includes('git diff --quiet -- public/sitemap.xml frontend/sitemap.xml'),
      'commit-only-if-changed guard must stay');
    assert.ok(yml.includes('git commit -m "FS AI: refresh sitemap from live published articles"'),
      'commit message must stay');
  });
});
