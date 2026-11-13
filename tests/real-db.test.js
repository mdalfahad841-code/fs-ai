// FS AI — Real-database route tests.
//
// Every Worker route is exercised against a REAL SQLite database built
// from database/schema.sql + database/seed.sql (fresh-deploy path) via
// node:sqlite, behind a minimal D1-compatible adapter (prepare/bind/
// all/run). A second database built from migrations 001+002+003+004 +
// seed.sql proves the incremental deploy path too. This is the test the
// audit asked for (audit B25): the fake-D1 suites cannot catch a wrong
// table or column name — this one can, because the SQL really runs.
//
// Run: node --test tests/real-db.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleRequest, publishDueArticles } = require('../src/index.js');
const { hashPassword } = require('../backend/security/crypto.js');

const ROOT = path.join(__dirname, '..');
const WORKER_URL = 'http://localhost';
const OWNER_EMAIL = 'owner@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';

// Split a SQL file into statements: ';' outside single-quoted strings
// ends a statement; '--' starts a line comment (outside strings).
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

// Minimal D1-compatible adapter over node:sqlite. D1's API is promise
// based, so all()/run() return promises (the rate limiter calls
// .run().catch(...), which needs a real promise).
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

function req(method, pathName, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    return new Request(`${WORKER_URL}${pathName}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`${WORKER_URL}${pathName}`, { method, headers });
}

describe('Worker routes against the real schema + seed (fresh-deploy path)', () => {
  let db;
  let env;
  let token;

  before(async () => {
    db = buildDb(['database/schema.sql', 'database/seed.sql']);
    env = { DB: makeRealD1(db), SESSION_SECRET: 'test-session-secret-real-db' };
    env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    const loginRes = await handleRequest(req('POST', '/api/auth/login', null, { email: OWNER_EMAIL, password: CORRECT_PASSWORD }), env);
    assert.equal(loginRes.status, 200, 'owner login must work against the real sessions table');
    token = (await loginRes.json()).token;
  });

  it('health reports db connected', async () => {
    const res = await handleRequest(req('GET', '/api/health'), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).db, 'connected');
  });

  it('GET /api/articles returns the 25 seeded articles, newest first', async () => {
    const res = await handleRequest(req('GET', '/api/articles'), env);
    assert.equal(res.status, 200, 'articles list must not 500 against the real schema');
    const body = await res.json();
    assert.equal(body.source, 'd1');
    assert.equal(body.total, 25);
    assert.equal(body.articles[0].published_at, '2026-11-11');
    assert.equal(body.articles[0].id, 25, 'newest-first with id tie-break: id 25 is the latest 11-11 row');
    assert.equal(body.articles[0].division, 'travel-lifestyle');
    assert.ok(body.articles.every((a) => a.status === 'published'));
    assert.ok(body.articles.every((a) => a.division && a.division_name));
  });

  it('seeded articles carry the full bodies', async () => {
    const res = await handleRequest(req('GET', '/api/articles'), env);
    const articles = (await res.json()).articles;
    assert.equal(articles.length, 25);
    for (const a of articles) {
      const words = a.body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      assert.ok(words > 400, `article ${a.id} body is ${words} words, expected full text > 400`);
    }
    const first = articles.find((a) => a.id === 1);
    assert.ok(first.body.length > 4000, 'seed body is the full article text, not a summary');
    assert.equal(res.status, 200);
  });

  it('GET /api/articles/:slug returns one article, with a disclaimer for health/finance', async () => {
    const list = await handleRequest(req('GET', '/api/articles'), env);
    const articles = (await list.json()).articles;
    const health = articles.find((a) => a.division === 'health-wellness');
    assert.ok(health, 'seed has a health article');
    const res = await handleRequest(req('GET', `/api/articles/${health.slug}`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.article.disclaimer, /General information only/);
    const finance = articles.find((a) => a.division === 'finance-money');
    const finRes = await handleRequest(req('GET', `/api/articles/${finance.slug}`), env);
    assert.match((await finRes.json()).article.disclaimer, /not medical\/financial advice/);
    const plain = articles.find((a) => a.division === 'automotive');
    const plainRes = await handleRequest(req('GET', `/api/articles/${plain.slug}`), env);
    assert.equal((await plainRes.json()).article.disclaimer, undefined);
  });

  it('GET /api/divisions returns only the 8 active divisions', async () => {
    const res = await handleRequest(req('GET', '/api/divisions'), env);
    assert.equal(res.status, 200, 'divisions list must not 500 against the real schema');
    const body = await res.json();
    assert.equal(body.source, 'd1');
    assert.equal(body.total, 8);
    assert.ok(body.divisions.every((d) => d.articleCount !== undefined));
  });

  it('GET /api/divisions/automotive returns the division with 12 articles', async () => {
    const res = await handleRequest(req('GET', '/api/divisions/automotive'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.division.slug, 'automotive');
    assert.equal(body.division.articleCount, 12);
    assert.equal(body.articles.length, 12);
  });

  it('GET /api/tools returns the 20 seeded digital_tools rows', async () => {
    const res = await handleRequest(req('GET', '/api/tools'), env);
    assert.equal(res.status, 200, 'tools list must not 500 against the real schema');
    const body = await res.json();
    assert.equal(body.source, 'd1');
    assert.equal(body.total, 20);
    const one = await handleRequest(req('GET', '/api/tools/fuel-cost-calculator'), env);
    assert.equal(one.status, 200);
    assert.equal((await one.json()).tool.slug, 'fuel-cost-calculator');
    const missing = await handleRequest(req('GET', '/api/tools/no-such-tool'), env);
    assert.equal(missing.status, 404);
  });

  it('GET /api/accounts returns monetization_accounts mapped to the API shape', async () => {
    const res = await handleRequest(req('GET', '/api/accounts'), env);
    assert.equal(res.status, 200, 'accounts list must not 500 against the real schema');
    const body = await res.json();
    assert.equal(body.source, 'd1');
    assert.equal(body.total, 10);
    const github = body.accounts.find((a) => a.id === 'github');
    assert.equal(github.status, 'active');
    assert.equal(github.handle, 'mdalfahad841-code');
    const single = await handleRequest(req('GET', '/api/accounts/github'), env);
    assert.equal(single.status, 200);
    assert.equal((await single.json()).account.id, 'github');
    const missing = await handleRequest(req('GET', '/api/accounts/no-such-account'), env);
    assert.equal(missing.status, 404);
  });

  it('PUT /api/accounts/:id updates status with the schema vocabulary', async () => {
    const bad = await handleRequest(req('PUT', '/api/accounts/github', token, { status: 'connected' }), env);
    assert.equal(bad.status, 400, 'connected is not in the schema CHECK');
    const ok = await handleRequest(req('PUT', '/api/accounts/github', token, { status: 'suspended', detail: 'Suspended for test.' }), env);
    assert.equal(ok.status, 200);
    const after = await handleRequest(req('GET', '/api/accounts'), env);
    const github = (await after.json()).accounts.find((a) => a.id === 'github');
    assert.equal(github.status, 'suspended');
    assert.equal(github.detail, 'Suspended for test.');
    await handleRequest(req('PUT', '/api/accounts/github', token, { status: 'active' }), env);
  });

  it('GET /api/analytics is honest: Data unavailable, $0.00', async () => {
    const res = await handleRequest(req('GET', '/api/analytics'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pageViews, 'Data unavailable');
    assert.equal(body.revenue, 0);
    assert.equal(body.revenueFormatted, '$0.00');
    assert.equal(body.analyticsConnected, false);
  });

  it('owner login works (sessions table) and /me returns the owner', async () => {
    const me = await handleRequest(req('GET', '/api/auth/me', token), env);
    assert.equal(me.status, 200);
    assert.equal((await me.json()).owner, OWNER_EMAIL);
  });

  it('newsletter subscribe / duplicate / unsubscribe against real D1', async () => {
    const sub = await handleRequest(req('POST', '/api/newsletter/subscribe', null, { email: 'realdb@example.com', consent: true }), env);
    assert.equal(sub.status, 201);
    assert.equal((await sub.json()).status, 'pending');
    const dup = await handleRequest(req('POST', '/api/newsletter/subscribe', null, { email: 'realdb@example.com', consent: true }), env);
    assert.equal(dup.status, 200);
    assert.equal((await dup.json()).subscribed, false);
    const bad = await handleRequest(req('POST', '/api/newsletter/subscribe', null, { email: 'bad', consent: true }), env);
    assert.equal(bad.status, 400);
    const noConsent = await handleRequest(req('POST', '/api/newsletter/subscribe', null, { email: 'x@example.com' }), env);
    assert.equal(noConsent.status, 400);
    const unsub = await handleRequest(req('POST', '/api/newsletter/unsubscribe', null, { email: 'realdb@example.com' }), env);
    assert.equal(unsub.status, 200);
  });

  it('CMS create/publish/unpublish + public visibility against real D1', async () => {
    const created = await handleRequest(req('POST', '/api/admin/articles', token, {
      title: 'Real DB CMS Article', body: 'Real body.', division: 'automotive',
    }), env);
    assert.equal(created.status, 201);
    const article = (await created.json()).article;
    const hidden = await handleRequest(req('GET', `/api/articles/${article.slug}`), env);
    assert.equal(hidden.status, 404, 'draft is hidden from the public');
    const published = await handleRequest(req('POST', `/api/admin/articles/${article.id}/publish`, token), env);
    assert.equal(published.status, 200);
    const visible = await handleRequest(req('GET', `/api/articles/${article.slug}`), env);
    assert.equal(visible.status, 200);
    const unpublished = await handleRequest(req('POST', `/api/admin/articles/${article.id}/unpublish`, token), env);
    assert.equal(unpublished.status, 200);
    const gone = await handleRequest(req('GET', `/api/articles/${article.slug}`), env);
    assert.equal(gone.status, 404);
  });

  it('future-scheduled article stays hidden; due approved article publishes via the scheduler', async () => {
    const future = await handleRequest(req('POST', '/api/admin/articles', token, {
      title: 'Real DB Future Article', body: 'Future.', division: 'automotive',
      status: 'published', publish_at: '2999-01-01T00:00:00.000Z',
    }), env);
    assert.equal(future.status, 201);
    const hidden = await handleRequest(req('GET', '/api/articles/real-db-future-article'), env);
    assert.equal(hidden.status, 404);
    const due = await handleRequest(req('POST', '/api/admin/articles', token, {
      title: 'Real DB Due Article', body: 'Due.', division: 'automotive',
      status: 'approved', publish_at: '2020-01-01T00:00:00.000Z',
    }), env);
    assert.equal(due.status, 201);
    const result = await publishDueArticles(env);
    assert.equal(result.ok, true);
    assert.ok(result.slugs.includes('real-db-due-article'));
    const visible = await handleRequest(req('GET', '/api/articles/real-db-due-article'), env);
    assert.equal(visible.status, 200);
  });

  it('inactive division hides its articles from the public', async () => {
    const div = await handleRequest(req('POST', '/api/admin/divisions', token, { name: 'Real Temp', slug: 'real-temp' }), env);
    assert.equal(div.status, 201);
    const divId = (await div.json()).division.id;
    const art = await handleRequest(req('POST', '/api/admin/articles', token, {
      title: 'Real Temp Article', body: 'Temp.', division: 'real-temp', status: 'published',
    }), env);
    assert.equal(art.status, 201);
    assert.equal((await handleRequest(req('GET', '/api/articles/real-temp-article'), env)).status, 200);
    await handleRequest(req('PUT', `/api/admin/divisions/${divId}`, token, { is_active: 0 }), env);
    assert.equal((await handleRequest(req('GET', '/api/articles/real-temp-article'), env)).status, 404);
    const list = await handleRequest(req('GET', '/api/divisions'), env);
    assert.ok(!(await list.json()).divisions.some((d) => d.slug === 'real-temp'));
  });

  it('agents list, SEO run and pause/resume persist against real D1', async () => {
    const list = await handleRequest(req('GET', '/api/agents', token), env);
    assert.equal(list.status, 200);
    const agents = (await list.json()).agents;
    assert.equal(agents.length, 16);
    const run = await handleRequest(req('POST', '/api/agents/seo/run', token), env);
    assert.equal(run.status, 200);
    const result = (await run.json()).result;
    assert.equal(result.outcome, 'completed');
    assert.ok(result.publishedArticles >= 25, 'SEO run counts the real published articles');
    const pause = await handleRequest(req('POST', '/api/agents/seo/pause', token), env);
    assert.equal(pause.status, 200);
    const row = db.prepare('SELECT status, is_active FROM ai_agents WHERE slug = ?').get('seo');
    assert.equal(row.status, 'paused');
    assert.equal(row.is_active, 0);
    const resume = await handleRequest(req('POST', '/api/agents/seo/resume', token), env);
    assert.equal(resume.status, 200);
    assert.equal(db.prepare('SELECT status FROM ai_agents WHERE slug = ?').get('seo').status, 'active');
  });

  it('emergency stop blocks agent runs with 423 against real D1', async () => {
    await handleRequest(req('POST', '/api/admin/emergency-stop', token, { stopped: true }), env);
    const blocked = await handleRequest(req('POST', '/api/agents/seo/run', token), env);
    assert.equal(blocked.status, 423);
    await handleRequest(req('POST', '/api/admin/emergency-stop', token, { stopped: false }), env);
    const ok = await handleRequest(req('POST', '/api/agents/seo/run', token), env);
    assert.equal(ok.status, 200);
  });

  it('backup export returns the tables with real row counts', async () => {
    const res = await handleRequest(req('GET', '/api/admin/backup', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.counts.business_divisions >= 8, true, '8 seeded divisions plus any created in earlier tests');
    assert.ok(body.counts.articles >= 25);
    assert.equal(body.counts.ai_agents, 16);
    assert.ok(body.counts.agent_activity_logs >= 1, 'agent runs were logged');
  });

  it('the Worker rate limiter used the real rate_limits table', async () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM rate_limits').get();
    assert.ok(row.n > 0, 'rate limiter wrote rows to D1 instead of memory-only fallback');
  });
});

describe('Incremental deploy path (migrations 001-004 + seed)', () => {
  it('builds all tables and seeds 25 dated articles', () => {
    const db2 = buildDb([
      'database/migrations/001_initial.sql',
      'database/migrations/002_agents_accounts.sql',
      'database/migrations/003_sessions.sql',
      'database/migrations/004_cms_newsletter.sql',
      'database/seed.sql',
    ]);
    const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    for (const t of ['sessions', 'rate_limits', 'article_revisions', 'articles', 'business_divisions', 'ai_agents']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
    const cols = db2.prepare('PRAGMA table_info(articles)').all().map((r) => r.name);
    assert.ok(cols.includes('publish_at'), 'articles.publish_at from migration 004');
    const agentCols = db2.prepare('PRAGMA table_info(ai_agents)').all().map((r) => r.name);
    assert.ok(agentCols.includes('status'), 'ai_agents.status from migration 004');
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM articles WHERE published_at IS NOT NULL').get().n, 25);
  });
});
