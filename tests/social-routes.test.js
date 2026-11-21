// FS AI — Social routes tests (W4, 2026-11-21).
//
// handleSocial() is called directly (the coordinator wires it into
// backend/worker.js — it is NOT registered here). Owner auth goes
// through the real login route against a REAL SQLite database built
// from database/schema.sql + database/seed.sql + migration 022.
// Platform calls use a MOCKED global fetch — no real platform is
// ever called. Covers: the /api/social/status contract shape,
// owner-only gating, draft-only creation, duplicate 409, publish via
// the dispatcher, calendar, and reports showing "Data unavailable"
// when no engagement data exists.
//
// Run: node --test tests/social-routes.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleRequest } = require('../src/index.js');
const { hashPassword } = require('../backend/security/crypto.js');
const { encryptToken } = require('../backend/social/tokens.js');
const { handleSocial } = require('../backend/routes/social.js');

const ROOT = path.join(__dirname, '..');
const SECRET = 'test-social-token-secret';
const OWNER_EMAIL = 'owner@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
      return { bind: (...params) => bound(params), all: () => bound([]).all(), run: () => bound([]).run() };
    },
  };
}

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase() });
    for (const [method, substr, handler] of routes) {
      if ((opts.method || 'GET').toUpperCase() === method && String(url).includes(substr)) {
        const res = await handler(String(url), opts);
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          headers: { get: () => null },
          text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
        };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"error":"mock: no route"}' };
  };
  fn.calls = calls;
  return fn;
}
const json = (status, body) => ({ status, body });

function pinterestOkFetch() {
  return mockFetch([
    ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
    ['POST', '/pins', async () => json(201, { id: 'pin-1' })],
    ['GET', '/pins/pin-1', async () => json(200, { id: 'pin-1' })],
  ]);
}

describe('social routes', () => {
  let db;
  let env;
  let token;
  const realFetch = globalThis.fetch;

  before(async () => {
    db = new DatabaseSync(':memory:');
    for (const file of ['database/schema.sql', 'database/seed.sql', 'database/migrations/022_social_media.sql']) {
      for (const stmt of splitSql(fs.readFileSync(path.join(ROOT, file), 'utf8'))) db.exec(stmt);
    }
    env = { DB: makeRealD1(db), SESSION_SECRET: 'test-session-secret-social', SOCIAL_TOKEN_SECRET: SECRET };
    env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    const loginRes = await handleRequest(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, password: CORRECT_PASSWORD }),
    }), env);
    assert.equal(loginRes.status, 200, 'owner login must work');
    token = (await loginRes.json()).token;
    const enc = await encryptToken('test-pinterest-token', SECRET);
    db.prepare(`INSERT INTO social_accounts (platform, account_name, account_id, status, scopes, access_token_enc, token_expires_at, created_at, updated_at)
      VALUES ('pinterest', 'FS AI', 'user-1', 'connected', ?, ?, ?, datetime('now'), datetime('now'))`)
      .run(JSON.stringify(['boards:read', 'pins:read', 'pins:write']), enc, FUTURE);
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  function req(method, pathName, body, useToken = true) {
    const headers = {};
    if (useToken) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      return new Request(`http://localhost${pathName}`, { method, headers, body: JSON.stringify(body) });
    }
    return new Request(`http://localhost${pathName}`, { method, headers });
  }

  it('GET /api/social/status requires owner auth', async () => {
    const res = await handleSocial(req('GET', '/api/social/status', undefined, false), env);
    assert.equal(res.status, 401);
  });

  it('GET /api/social/status returns the exact contract shape, all disconnected except Pinterest', async () => {
    const res = await handleSocial(req('GET', '/api/social/status'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.platforms));
    assert.equal(body.platforms.length, 6, 'one entry per platform');
    for (const p of body.platforms) {
      assert.deepEqual(Object.keys(p).sort(),
        ['accountName', 'classification', 'connected', 'lastError', 'lastPostAt', 'platform', 'tokenExpiresAt'].sort(),
        `platform ${p.platform} must carry exactly the contract fields`);
    }
    const pin = body.platforms.find((p) => p.platform === 'pinterest');
    assert.equal(pin.connected, true);
    assert.equal(pin.accountName, 'FS AI');
    assert.equal(pin.tokenExpiresAt, FUTURE);
    const x = body.platforms.find((p) => p.platform === 'x');
    assert.equal(x.connected, false, 'X is never reported connected');
    assert.equal(x.classification, 'UNAVAILABLE_FREE');
  });

  it('POST /api/social/posts creates a draft, refuses publish:true, and 409s on duplicate', async () => {
    const created = await handleSocial(req('POST', '/api/social/posts', { articleId: 1, platform: 'facebook' }), env);
    assert.equal(created.status, 201);
    const post = (await created.json()).post;
    assert.equal(post.status, 'draft');
    assert.equal(post.idempotency_key, 'article:1:facebook');

    const publishTrue = await handleSocial(req('POST', '/api/social/posts', { articleId: 2, platform: 'facebook', publish: true }), env);
    assert.equal(publishTrue.status, 400, 'creation never publishes');

    const dup = await handleSocial(req('POST', '/api/social/posts', { articleId: 1, platform: 'facebook' }), env);
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).existingPostId, post.id);

    const forced = await handleSocial(req('POST', '/api/social/posts', { articleId: 1, platform: 'facebook', force: true }), env);
    assert.equal(forced.status, 201, 'explicit owner force bypasses the duplicate guard');
  });

  it('POST /api/social/posts rejects X (no free posting path)', async () => {
    const res = await handleSocial(req('POST', '/api/social/posts', { articleId: 1, platform: 'x' }), env);
    assert.equal(res.status, 400);
  });

  it('POST /api/social/posts rejects an unpublished article', async () => {
    db.prepare("INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, created_at, updated_at) VALUES (1, 'Draft One', 'draft-one', 'e', 'b', 'FS AI', 'draft', datetime('now'), datetime('now'))").run();
    const draftId = db.prepare('SELECT id FROM articles WHERE slug = ?').get('draft-one').id;
    const res = await handleSocial(req('POST', '/api/social/posts', { articleId: draftId, platform: 'facebook' }), env);
    assert.equal(res.status, 400);
  });

  it('POST /api/social/posts/:id/publish publishes via the dispatcher with mocked fetch', async () => {
    const created = await handleSocial(req('POST', '/api/social/posts', { articleId: 2, platform: 'pinterest', mediaUrl: 'https://fs-ai-5w5.pages.dev/card.png' }), env);
    assert.equal(created.status, 201);
    const post = (await created.json()).post;
    globalThis.fetch = pinterestOkFetch();
    const res = await handleSocial(req('POST', `/api/social/posts/${post.id}/publish`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.status, 'published');
    assert.equal(body.post.status, 'published');
    assert.equal(body.post.platform_post_id, 'pin-1');
  });

  it('GET /api/social/calendar lists posts by date/platform/status', async () => {
    const res = await handleSocial(req('GET', '/api/social/calendar?platform=pinterest'), env);
    assert.equal(res.status, 200);
    const posts = (await res.json()).posts;
    assert.ok(posts.length >= 1);
    assert.ok(posts.every((p) => p.platform === 'pinterest'));
  });

  it('GET /api/social/reports/daily shows "Data unavailable" with no engagement rows', async () => {
    const res = await handleSocial(req('GET', '/api/social/reports/daily'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.period, 'daily');
    assert.equal(body.engagement, 'Data unavailable');
    assert.ok(body.byPlatform.pinterest.published >= 1, 'the published Pinterest post counts in the report');
  });

  it('POST /api/social/accounts/:id/verify confirms the stored token against the mocked platform', async () => {
    const accountId = db.prepare("SELECT id FROM social_accounts WHERE platform = 'pinterest'").get().id;
    globalThis.fetch = mockFetch([
      ['GET', '/user_account', async () => json(200, { username: 'FS_AI' })],
    ]);
    const res = await handleSocial(req('POST', `/api/social/accounts/${accountId}/verify`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verified, true);
    assert.equal(body.accountName, 'FS_AI');
    const row = db.prepare('SELECT last_verified_at FROM social_accounts WHERE id = ?').get(accountId);
    assert.ok(row.last_verified_at, 'last_verified_at is stamped');
    assert.ok(!JSON.stringify(body).includes('test-pinterest-token'), 'a token is never returned');
  });
});
