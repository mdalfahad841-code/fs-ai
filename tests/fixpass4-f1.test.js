// FS AI — Fix Pass 4 F1 (health report subrequests) tests, 2026-11-24.
//
// The daily run is a single Worker invocation with a 50-subrequest
// budget; by the time its health-report step (step 15) runs, the drain
// + SEO steps have spent the budget, so on 24 Nov the sitemap +
// serverSideHeads checks failed with "Too many subrequests". F1 moves
// the five external-fetch checks to an authenticated internal route
// (POST /api/admin/health-report-external) that runs in its OWN
// invocation with a fresh budget; the daily run calls it exactly once
// and embeds the returned checks in the daily report, falling back to
// the in-process checks when the route is unavailable.
//
//   F1.1 crypto — sign/verify round-trip, wrong secret / stale /
//         tampered / wrong path all fail
//   F1.2 route — method + auth (owner Bearer AND HMAC internal call),
//         real OK/FAIL (never OK on a fetch failure), subset + 400s,
//         writes nothing, registered in worker.js
//   F1.3 builder — supplied external checks used verbatim (fetchImpl
//         never called), partial supply falls back in-process, an
//         unusable supplied status is ignored, queue detail carries
//         the drain-time checkedAt snapshot label
//   F1.4 scheduler — full runDailyWorkflow: the route is called
//         exactly once and zero Pages/GitHub fetches happen
//         in-process; route failure falls back to in-process checks;
//         no SESSION_SECRET means no self-call at all
//
// Run: node --test tests/fixpass4-f1.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  buildDailyHealthReport,
  runExternalHealthChecks,
  PROTECTED_DRAFT_IDS,
  HEALTH_REPORT_CHECK_KEYS,
  EXTERNAL_HEALTH_CHECK_KEYS,
  SERVER_SIDE_HEAD_SAMPLES,
} = require('../backend/services/daily-health-report.js');
const {
  handleHealthReportExternal,
  HEALTH_REPORT_EXTERNAL_PATH,
  INTERNAL_SIGNATURE_MAX_AGE_MS,
} = require('../backend/routes/health-external.js');
const {
  signInternalRequest,
  verifyInternalSignature,
  hashSessionToken,
  randomToken,
} = require('../backend/security/crypto.js');
const {
  runDailyWorkflow,
  todayStr,
  fetchExternalHealthChecks,
  WORKER_BASE_URL,
} = require('../backend/routes/scheduler.js');

const ROOT = path.join(__dirname, '..');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';
const TEST_SECRET = 'test-session-secret-for-f1-only';

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

// Same fixture DB as tests/closeout-a5.test.js (schema + autonomy
// migrations + seed + pipeline migrations + YouTube mirror (028) +
// CSP reports (030)). Migration 004 is deliberately NOT applied.
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

function freshEnv(extra = {}) {
  const db = freshDb();
  return { db, env: { DB: makeRealD1(db), ...extra } };
}

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

/* Canned rewritten HTML for the five check-14 sample URLs (same
   contract as tests/closeout-a5.test.js sampleHeadHtml). */
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

/* Mock fetchImpl for the builder/route: healthy Pages + GitHub, with
   per-URL throw hooks (throwOn: substring list) that raise the exact
   24 Nov subrequest error. Never touches the network. */
const SUBREQUEST_ERROR = 'Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits';

function makeMockFetch({ throwOn = [], github = 'success', headsHtml = defaultHeadsHtml() } = {}) {
  return async (url) => {
    const u = String(url);
    for (const needle of throwOn) {
      if (u.includes(needle)) throw new Error(SUBREQUEST_ERROR);
    }
    if (headsHtml && Object.prototype.hasOwnProperty.call(headsHtml, u)) {
      return { status: 200, text: async () => headsHtml[u] };
    }
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
      return { status: 200, text: async () => sitemapXml(allPublishedIds()) };
    }
    if (u.includes('/pages/article?id=')) {
      return { status: 200, text: async () => '' };
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

async function hmacHeaders(secret = TEST_SECRET, { path = HEALTH_REPORT_EXTERNAL_PATH, timestamp = Date.now() } = {}) {
  const signature = await signInternalRequest(secret, 'POST', path, String(timestamp));
  return {
    'X-FS-AI-Internal-Timestamp': String(timestamp),
    'X-FS-AI-Internal-Signature': signature,
  };
}

function postRequest(headers = {}, body = undefined) {
  return new Request(WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? JSON.stringify({}) : body,
  });
}

async function readJson(res) {
  return JSON.parse(await res.text());
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

/* ------------------------------------------------------------------ */
/* F1.1 — HMAC sign/verify.                                            */
/* ------------------------------------------------------------------ */
describe('F1.1 internal HMAC sign/verify', () => {
  it('round-trips: a signature made with the secret verifies', async () => {
    const ts = Date.now();
    const sig = await signInternalRequest(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts));
    assert.equal(await verifyInternalSignature(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts), sig), true);
  });

  it('fails with the wrong secret', async () => {
    const ts = Date.now();
    const sig = await signInternalRequest('another-secret', 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts));
    assert.equal(await verifyInternalSignature(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts), sig), false);
  });

  it('fails when the timestamp is older than the 5-minute window', async () => {
    const ts = Date.now() - INTERNAL_SIGNATURE_MAX_AGE_MS - 1000;
    const sig = await signInternalRequest(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts));
    assert.equal(await verifyInternalSignature(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts), sig), false);
  });

  it('fails on a tampered signature', async () => {
    const ts = Date.now();
    const sig = await signInternalRequest(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts));
    const tampered = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    assert.equal(await verifyInternalSignature(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts), tampered), false);
  });

  it('fails for a different path (a signature cannot be replayed elsewhere)', async () => {
    const ts = Date.now();
    const sig = await signInternalRequest(TEST_SECRET, 'POST', '/api/admin/emergency-stop', String(ts));
    assert.equal(await verifyInternalSignature(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, String(ts), sig), false);
  });
});

/* ------------------------------------------------------------------ */
/* F1.2 — the internal route: auth, real OK/FAIL, subset, read-only.   */
/* ------------------------------------------------------------------ */
describe('F1.2 internal route auth + behaviour', () => {
  it('rejects GET with 405', async () => {
    const { env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    const req = new Request(WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH, { method: 'GET' });
    const res = await handleHealthReportExternal(req, env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 405);
  });

  it('rejects an unauthenticated POST with 401', async () => {
    const { env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    const res = await handleHealthReportExternal(postRequest(), env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 401);
  });

  it('rejects a wrong Bearer token with 401', async () => {
    const { env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    const req = postRequest({ Authorization: 'Bearer deadbeef' });
    const res = await handleHealthReportExternal(req, env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 401);
  });

  it('rejects a forged HMAC (wrong secret) with 401', async () => {
    const { env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    const headers = await hmacHeaders('wrong-secret');
    const res = await handleHealthReportExternal(postRequest(headers), env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 401);
  });

  it('rejects a stale HMAC timestamp with 401', async () => {
    const { env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    const headers = await hmacHeaders(TEST_SECRET, { timestamp: Date.now() - INTERNAL_SIGNATURE_MAX_AGE_MS - 1000 });
    const res = await handleHealthReportExternal(postRequest(headers), env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 401);
  });

  it('accepts a valid HMAC and returns all five checks with real statuses', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const headers = await hmacHeaders(TEST_SECRET);
    const res = await handleHealthReportExternal(postRequest(headers), env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 200);
    const data = await readJson(res);
    assert.equal(data.ok, true);
    assert.deepEqual(Object.keys(data.checks).sort(), [...EXTERNAL_HEALTH_CHECK_KEYS].sort());
    assert.equal(data.checks.pages.status, 'OK');
    assert.equal(data.checks.sitemap.status, 'OK');
    assert.equal(data.checks.sitemap.detail.urlCount, 34); // 1 home + 25 articles + 8 divisions
    assert.equal(data.checks.sitemapRefresh.status, 'OK');
    assert.equal(data.checks.serverSideHeads.status, 'OK');
    assert.equal(data.checks.serverSideHeads.detail.passed, 5);
    assert.equal(data.checks.recentArticles.status, 'OK');
  });

  it('accepts a valid owner Bearer session', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const token = randomToken(32);
    const tokenHash = await hashSessionToken(token, TEST_SECRET);
    db.prepare('INSERT INTO sessions (token_hash, owner_email, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, 'owner@example.com', new Date(Date.now() + 3600 * 1000).toISOString(), new Date().toISOString());
    const req = postRequest({ Authorization: `Bearer ${token}` });
    const res = await handleHealthReportExternal(req, env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 200);
    const data = await readJson(res);
    assert.equal(data.checks.pages.status, 'OK');
  });

  it('reports real FAIL (never OK) when a fetch throws the subrequest error', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const headers = await hmacHeaders(TEST_SECRET);
    // The 24 Nov failure shape: the sitemap fetch and every
    // server-side-heads sample fetch hit the subrequest wall.
    const fetchImpl = makeMockFetch({ throwOn: ['/sitemap.xml', '/pages/article?id=', '/pages/division?division=', '/pages/tools?tool='] });
    const res = await handleHealthReportExternal(postRequest(headers), env, { fetchImpl });
    assert.equal(res.status, 200, 'the route itself answers 200 — the CHECKS carry the failure');
    const data = await readJson(res);
    assert.equal(data.checks.sitemap.status, 'FAIL');
    assert.match(data.checks.sitemap.detail.error, /Too many subrequests/);
    assert.equal(data.checks.serverSideHeads.status, 'FAIL');
    assert.equal(data.checks.serverSideHeads.detail.passed, 0);
    assert.equal(data.checks.pages.status, 'OK');
  });

  it('keeps sitemapRefresh NOT TESTED (never OK, never FAIL) when its fetch fails', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const headers = await hmacHeaders(TEST_SECRET);
    const fetchImpl = makeMockFetch({ github: 'error' });
    const res = await handleHealthReportExternal(postRequest(headers), env, { fetchImpl });
    assert.equal(res.status, 200);
    const data = await readJson(res);
    assert.equal(data.checks.sitemapRefresh.status, 'NOT TESTED');
    assert.match(data.checks.sitemapRefresh.detail.reason, /fetch failed/);
  });

  it('runs a requested subset only, and 400s on unknown names / bad JSON', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const headers = await hmacHeaders(TEST_SECRET);
    const sub = await handleHealthReportExternal(
      postRequest(headers, JSON.stringify({ checks: ['pages'] })), env, { fetchImpl: makeMockFetch() });
    assert.equal(sub.status, 200);
    const subData = await readJson(sub);
    assert.deepEqual(Object.keys(subData.checks), ['pages']);

    const bad = await handleHealthReportExternal(
      postRequest(headers, JSON.stringify({ checks: ['pages', 'bogus'] })), env, { fetchImpl: makeMockFetch() });
    assert.equal(bad.status, 400);

    const notJson = await handleHealthReportExternal(
      postRequest(headers, '{not json'), env, { fetchImpl: makeMockFetch() });
    assert.equal(notJson.status, 400);
  });

  it('writes nothing to D1', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const before = {
      articles: countRows(db, 'articles'),
      daily_reports: countRows(db, 'daily_reports'),
      agent_runs: countRows(db, 'agent_runs'),
      sessions: countRows(db, 'sessions'),
      csp_reports: countRows(db, 'csp_reports'),
    };
    const headers = await hmacHeaders(TEST_SECRET);
    const res = await handleHealthReportExternal(postRequest(headers), env, { fetchImpl: makeMockFetch() });
    assert.equal(res.status, 200);
    const after = {
      articles: countRows(db, 'articles'),
      daily_reports: countRows(db, 'daily_reports'),
      agent_runs: countRows(db, 'agent_runs'),
      sessions: countRows(db, 'sessions'),
      csp_reports: countRows(db, 'csp_reports'),
    };
    assert.deepEqual(after, before, 'the route is read-only');
  });

  it('is registered in worker.js as a POST route with its own auth', async () => {
    const src = read('backend/worker.js');
    assert.ok(src.includes('health-report-external'), 'worker.js routes the path');
    assert.ok(src.includes("method === 'POST'"), 'the registration is POST-only');
    assert.ok(src.includes('handleHealthReportExternal'), 'worker.js imports the handler');
    const routeSrc = read('backend/routes/health-external.js');
    assert.ok(!routeSrc.includes('new Function'), 'no code generation in the route');
    assert.ok(!/eval\s*\(/.test(routeSrc), 'no eval in the route');
  });
});

/* ------------------------------------------------------------------ */
/* F1.3 — builder: supplied external checks + queue snapshot label.     */
/* ------------------------------------------------------------------ */
describe('F1.3 builder uses supplied external checks and labels the queue snapshot', () => {
  const suppliedAll = {
    pages: { status: 'OK', detail: { status: 200, url: `${PAGES_BASE}/` } },
    sitemap: { status: 'FAIL', detail: { urlCount: 0, publishedCount: 0, missingIds: [], extraIds: [], error: 'Too many subrequests by single Worker invocation.' } },
    recentArticles: { status: 'OK', detail: { published: [], reachable: [], unreachable: [] } },
    sitemapRefresh: { status: 'NOT TESTED', detail: { reason: 'GitHub API fetch failed: Too many subrequests.' } },
    serverSideHeads: { status: 'OK', detail: { checked: 5, passed: 5, failures: [] } },
  };

  it('uses supplied checks verbatim and never calls fetchImpl for them', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    let fetchCalls = 0;
    const throwingFetch = async () => { fetchCalls += 1; throw new Error('must not be called for a supplied check'); };
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(), fetchImpl: throwingFetch, externalChecks: suppliedAll,
    });
    assert.equal(fetchCalls, 0, 'no in-process fetch ran for a supplied check');
    assert.deepEqual(report.checks.sitemap, suppliedAll.sitemap);
    assert.deepEqual(report.checks.serverSideHeads, suppliedAll.serverSideHeads);
    assert.deepEqual(report.checks.sitemapRefresh, suppliedAll.sitemapRefresh);
    assert.equal(report.overall, 'FAIL', 'the supplied sitemap FAIL still fails the report');
  });

  it('runs only the unsupplied keys in-process', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch(),
      externalChecks: { sitemap: { status: 'OK', detail: { urlCount: 34, publishedCount: 25, missingIds: [], extraIds: [] } } },
    });
    assert.equal(report.checks.sitemap.status, 'OK');
    assert.deepEqual(report.checks.sitemap.detail, { urlCount: 34, publishedCount: 25, missingIds: [], extraIds: [] });
    assert.equal(report.checks.serverSideHeads.status, 'OK', 'unsupplied keys ran in-process');
    assert.equal(report.checks.pages.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
  });

  it('ignores a supplied check with an unusable status and runs it in-process', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const report = await buildDailyHealthReport(env, {
      health: healthyHealth(),
      fetchImpl: makeMockFetch(),
      externalChecks: { sitemap: { status: 'BOGUS', detail: {} } },
    });
    assert.equal(report.checks.sitemap.status, 'OK', 'the bogus supplied check was ignored');
  });

  it('labels the queue snapshot with the drain-time checkedAt', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const health = healthyHealth();
    const fixed = '2026-11-24T00:00:55.616Z';
    health.checkedAt = fixed;
    health.checks.find((c) => c.component === 'queue').checkedAt = fixed;
    health.checks.find((c) => c.component === 'queue').detail.oldestQueuedAt = '2026-11-23T00:03:40.792Z';
    const report = await buildDailyHealthReport(env, { health, fetchImpl: makeMockFetch() });
    assert.equal(report.checks.queue.detail.oldestQueuedAt, '2026-11-23T00:03:40.792Z');
    assert.equal(report.checks.queue.detail.checkedAt, fixed, 'the snapshot time is labelled, so the reader sees it is pre-drain');
  });

  it('reports queue checkedAt null when the health result carries none', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const health = healthyHealth();
    delete health.checks.find((c) => c.component === 'queue').checkedAt;
    const report = await buildDailyHealthReport(env, { health, fetchImpl: makeMockFetch() });
    assert.equal(report.checks.queue.detail.checkedAt, null);
  });

  it('without externalChecks the builder behaves exactly as before (all five run in-process)', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const report = await buildDailyHealthReport(env, { health: healthyHealth(), fetchImpl: makeMockFetch() });
    assert.equal(report.checks.pages.status, 'OK');
    assert.equal(report.checks.sitemap.status, 'OK');
    assert.equal(report.checks.serverSideHeads.status, 'OK');
    assert.equal(report.checks.sitemapRefresh.status, 'OK');
    assert.equal(report.checks.recentArticles.status, 'OK');
  });
});

/* ------------------------------------------------------------------ */
/* F1.4 — scheduler wiring: one self-call, zero in-process fetches.     */
/* ------------------------------------------------------------------ */
describe('F1.4 scheduler calls the internal route exactly once', () => {
  const CANNED = {
    pages: { status: 'OK', detail: { status: 200, url: `${PAGES_BASE}/` } },
    sitemap: { status: 'OK', detail: { urlCount: 60, publishedCount: 25, missingIds: [], extraIds: [] } },
    recentArticles: { status: 'OK', detail: { published: [], reachable: [], unreachable: [] } },
    sitemapRefresh: { status: 'OK', detail: { conclusion: 'success', createdAt: new Date(Date.now() - 3600 * 1000).toISOString(), ageHours: 1, runId: 123, htmlUrl: 'https://github.com/mdalfahad841-code/fs-ai/actions/runs/123' } },
    serverSideHeads: { status: 'OK', detail: { checked: 5, passed: 5, failures: [] } },
  };

  // One stub for every fetch the workflow makes: the internal route
  // answers with CANNED; any Pages/GitHub fetch throws (proving the
  // health step made zero in-process external fetches); anything else
  // (RSS feeds, …) 404s, as in tests/closeout-a5.test.js A5.11.
  function routeStub(calls) {
    const mock = makeMockFetch();
    return async (url, init) => {
      const u = String(url);
      calls.push({ url: u, headers: (init && init.headers) || {} });
      if (u === WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH) {
        return { status: 200, text: async () => JSON.stringify({ ok: true, date: todayStr(), generatedAt: new Date().toISOString(), checks: CANNED }) };
      }
      if (u.startsWith(PAGES_BASE) || u.includes('api.github.com')) {
        throw new Error(`in-process external fetch must not happen: ${u}`);
      }
      return mock(u);
    };
  }

  it('stores the route checks verbatim and makes zero in-process external fetches', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const calls = [];
    const stub = routeStub(calls);
    const realFetch = global.fetch;
    global.fetch = stub;
    try {
      const result = await runDailyWorkflow(env, { fetchImpl: stub });
      assert.equal(result.ok, true);
      assert.ok(result.reportId, 'a report row id is returned');
      const row = db.prepare("SELECT * FROM daily_reports WHERE kind = 'daily'").get();
      assert.ok(row, 'exactly one daily report row');
      const summary = JSON.parse(row.summary_json);
      assert.equal(summary.steps.healthReport.outcome, 'done');
      assert.deepEqual(summary.healthReport.checks.sitemap, CANNED.sitemap);
      assert.deepEqual(summary.healthReport.checks.serverSideHeads, CANNED.serverSideHeads);
      assert.deepEqual(summary.healthReport.checks.sitemapRefresh, CANNED.sitemapRefresh);
      // Overall is WARN in this fixture for an unrelated honest reason
      // (same as A5.11: a fresh DB has no backup run, so the drain
      // health is degraded) — the five external checks are all OK.
      assert.equal(summary.healthReport.overall, 'WARN');
      assert.equal(summary.healthReport.checks.workerHealth.status, 'WARN');
      const routeCalls = calls.filter((c) => c.url === WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH);
      assert.equal(routeCalls.length, 1, 'the internal route is called exactly once');
      assert.ok(routeCalls[0].headers['X-FS-AI-Internal-Timestamp'], 'the call carries the HMAC timestamp header');
      assert.ok(routeCalls[0].headers['X-FS-AI-Internal-Signature'], 'the call carries the HMAC signature header');
      assert.equal(calls.filter((c) => c.url.startsWith(PAGES_BASE)).length, 0, 'no in-process Pages fetch');
      assert.equal(calls.filter((c) => c.url.includes('api.github.com')).length, 0, 'no in-process GitHub fetch');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('falls back to the in-process checks when the route call fails', async () => {
    const { db, env } = freshEnv({ SESSION_SECRET: TEST_SECRET });
    insertProtectedDrafts(db);
    const calls = [];
    const mock = makeMockFetch();
    const stub = async (url, init) => {
      const u = String(url);
      calls.push(u);
      if (u === WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH) throw new Error('route unreachable');
      return mock(u);
    };
    const realFetch = global.fetch;
    global.fetch = stub;
    try {
      const result = await runDailyWorkflow(env, { fetchImpl: stub });
      assert.equal(result.ok, true);
      const row = db.prepare("SELECT * FROM daily_reports WHERE kind = 'daily'").get();
      const summary = JSON.parse(row.summary_json);
      assert.equal(summary.steps.healthReport.outcome, 'done');
      assert.equal(summary.healthReport.checks.sitemap.status, 'OK', 'fallback ran the checks in-process');
      assert.equal(summary.healthReport.checks.serverSideHeads.status, 'OK');
      assert.equal(calls.filter((u) => u === WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH).length, 1, 'the route was attempted once');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('makes no self-call at all when SESSION_SECRET is not configured', async () => {
    const { db, env } = freshEnv();
    insertProtectedDrafts(db);
    const calls = [];
    const mock = makeMockFetch();
    const stub = async (url, init) => {
      calls.push(String(url));
      return mock(url);
    };
    const realFetch = global.fetch;
    global.fetch = stub;
    try {
      const result = await runDailyWorkflow(env, { fetchImpl: stub });
      assert.equal(result.ok, true);
      const row = db.prepare("SELECT * FROM daily_reports WHERE kind = 'daily'").get();
      const summary = JSON.parse(row.summary_json);
      assert.equal(summary.healthReport.checks.sitemap.status, 'OK', 'in-process checks still ran');
      assert.equal(calls.filter((u) => u === WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH).length, 0, 'no self-call without a secret to sign it with');
    } finally {
      global.fetch = realFetch;
    }
  });
});

/* ------------------------------------------------------------------ */
/* F1.5 — fetchExternalHealthChecks helper (direct).                    */
/* ------------------------------------------------------------------ */
describe('F1.5 fetchExternalHealthChecks helper', () => {
  const checksBody = { ok: true, date: todayStr(), generatedAt: new Date().toISOString(), checks: { sitemap: { status: 'OK', detail: {} } } };

  it('returns null with no SESSION_SECRET configured', async () => {
    const calls = [];
    const stub = async () => { calls.push(1); return { status: 200, text: async () => JSON.stringify(checksBody) }; };
    const out = await fetchExternalHealthChecks({ DB: null }, { fetchImpl: stub });
    assert.equal(out, null);
    assert.equal(calls.length, 0, 'no HTTP call is attempted without a secret');
  });

  it('returns null on a non-200 answer', async () => {
    const stub = async () => ({ status: 500, text: async () => 'boom' });
    const out = await fetchExternalHealthChecks({ SESSION_SECRET: TEST_SECRET }, { fetchImpl: stub });
    assert.equal(out, null);
  });

  it('returns the checks map on 200 and signs the call', async () => {
    const seen = [];
    const stub = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return { status: 200, text: async () => JSON.stringify(checksBody) };
    };
    const out = await fetchExternalHealthChecks({ SESSION_SECRET: TEST_SECRET }, { fetchImpl: stub });
    assert.deepEqual(out, checksBody.checks);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, WORKER_BASE_URL + HEALTH_REPORT_EXTERNAL_PATH);
    const ts = seen[0].headers['X-FS-AI-Internal-Timestamp'];
    const sig = seen[0].headers['X-FS-AI-Internal-Signature'];
    assert.equal(await verifyInternalSignature(TEST_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, ts, sig), true);
  });
});
