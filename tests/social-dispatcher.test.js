// FS AI — Social dispatcher tests (W4, 2026-11-21).
//
// The dispatcher runs against a REAL SQLite database built from
// database/schema.sql + database/seed.sql + migration 022 (same pattern
// as tests/real-db.test.js), with a MOCKED fetch — no real platform is
// ever called. Covers: duplicate detection, safe retry (transient
// 429/500 retried to max 3; permanent 401 -> WAITING_FOR_AUTHORIZATION
// with no retry), success requires platform confirmation (verify-back
// 404 -> 'unverified', never 'published'), E-Stop halt, X refusal,
// daily-cap guardrail, and expired-token handling.
//
// Run: node --test tests/social-dispatcher.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { encryptToken } = require('../backend/social/tokens.js');
const { buildPostContent } = require('../backend/social/content.js');
const { createPost, getPostById } = require('../backend/social/store.js');
const { dispatchPost } = require('../backend/social/dispatcher.js');

const ROOT = path.join(__dirname, '..');
const SECRET = 'test-social-token-secret';

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

function buildDb() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['database/schema.sql', 'database/seed.sql', 'database/migrations/022_social_media.sql']) {
    for (const stmt of splitSql(fs.readFileSync(path.join(ROOT, file), 'utf8'))) db.exec(stmt);
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
      return { bind: (...params) => bound(params), all: () => bound([]).all(), run: () => bound([]).run() };
    },
  };
}

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

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

async function freshEnv() {
  const db = buildDb();
  const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET };
  const enc = await encryptToken('test-pinterest-token', SECRET);
  db.prepare(`INSERT INTO social_accounts (platform, account_name, account_id, status, scopes, access_token_enc, token_expires_at, created_at, updated_at)
    VALUES ('pinterest', 'FS AI', 'user-1', 'connected', ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(JSON.stringify(['boards:read', 'pins:read', 'pins:write']), enc, FUTURE);
  return { db, env };
}

function pinterestOkFetch() {
  return mockFetch([
    ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
    ['POST', '/pins', async () => json(201, { id: 'pin-1' })],
    ['GET', '/pins/pin-1', async () => json(200, { id: 'pin-1' })],
  ]);
}

describe('duplicate detection (store)', () => {
  it('same article+platform twice -> second create refused', async () => {
    const { env } = await freshEnv();
    const first = await createPost(env, { articleId: 1, platform: 'pinterest', caption: 'c1' });
    assert.ok(first.id);
    await assert.rejects(
      createPost(env, { articleId: 1, platform: 'pinterest', caption: 'c2' }),
      (e) => e.code === 'DUPLICATE' && e.existingPostId === first.id);
    // A different platform is fine.
    const other = await createPost(env, { articleId: 1, platform: 'facebook', caption: 'c3' });
    assert.ok(other.id);
  });

  it('force re-post (explicit owner approval) bypasses the duplicate guard', async () => {
    const { env } = await freshEnv();
    await createPost(env, { articleId: 2, platform: 'pinterest', caption: 'c1' });
    const forced = await createPost(env, { articleId: 2, platform: 'pinterest', caption: 'c2' }, { force: true });
    assert.ok(forced.id);
  });
});

describe('dispatcher publish flow', () => {
  it('publishes, records the platform id, and marks verified', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 1, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 1, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const result = await dispatchPost(env, row.id, { content }, { fetchFn: pinterestOkFetch(), delayFn: async () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'published');
    assert.equal(result.platformPostId, 'pin-1');
    assert.equal(result.verified, true);
    assert.equal(result.attempts, 1);
    const saved = await getPostById(env, row.id);
    assert.equal(saved.status, 'published');
    assert.equal(saved.platform_post_id, 'pin-1');
    assert.ok(saved.published_at);
    assert.equal(saved.platform_url, 'https://www.pinterest.com/pin/pin-1/');
  });

  it('refuses to re-publish an already-published article to the same platform', async () => {
    const { env } = await freshEnv();
    const dbArticle = { id: 3, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const first = await createPost(env, { articleId: 3, platform: 'pinterest', caption: 'x' });
    const ok = await dispatchPost(env, first.id, { content }, { fetchFn: pinterestOkFetch(), delayFn: async () => {} });
    assert.equal(ok.ok, true);
    const forced = await createPost(env, { articleId: 3, platform: 'pinterest', caption: 'y' }, { force: true });
    const second = await dispatchPost(env, forced.id, { content }, { fetchFn: pinterestOkFetch(), delayFn: async () => {} });
    assert.equal(second.ok, false);
    assert.equal(second.failure.code, 'DUPLICATE');
  });

  it('retries transient 500s with backoff, max 3 attempts, then publishes', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 4, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 4, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    let calls = 0;
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => { calls += 1; return calls < 3 ? json(500, { message: 'boom' }) : json(201, { id: 'pin-9' }); }],
      ['GET', '/pins/pin-9', async () => json(200, { id: 'pin-9' })],
    ]);
    const delays = [];
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async (ms) => { delays.push(ms); } });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3, 'two transient failures then success = 3 attempts');
    assert.deepEqual(delays, [1000, 2000], 'exponential backoff 1s -> 2s');
    assert.equal((await getPostById(env, row.id)).status, 'published');
  });

  it('permanent 401 -> WAITING_FOR_AUTHORIZATION, no retry, status waiting_authorization', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 5, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 5, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(401, { message: 'invalid token' })],
    ]);
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'waiting_authorization');
    assert.equal(result.failure.code, 'WAITING_FOR_AUTHORIZATION');
    assert.equal(result.failure.attempts, 1, 'auth failures are never retried');
    assert.ok(result.failure.ownerAction, 'owner action is recorded');
    const saved = await getPostById(env, row.id);
    assert.equal(saved.status, 'waiting_authorization');
    assert.match(saved.error, /401|invalid token/i);
  });

  it('create accepted but verify-back 404 -> unverified, never published', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 6, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 6, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => json(201, { id: 'pin-ghost' })],
      ['GET', '/pins/pin-ghost', async () => json(404, { message: 'not found' })],
    ]);
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unverified');
    assert.equal((await getPostById(env, row.id)).status, 'unverified');
    assert.equal((await getPostById(env, row.id)).platform_post_id, 'pin-ghost');
  });

  it('Emergency Stop ON halts posting before any platform call', async () => {
    const { db, env } = await freshEnv();
    db.prepare("INSERT INTO website_settings (setting_key, setting_value, description, updated_at) VALUES ('emergency_stop', '1', 'test', datetime('now'))").run();
    const row = await createPost(env, { articleId: 7, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 7, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = pinterestOkFetch();
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.failure.code, 'ESTOP');
    assert.equal(fetchFn.calls.length, 0, 'no platform call while the stop is on');
    assert.equal((await getPostById(env, row.id)).status, 'blocked');
  });

  it('X is refused without any network call (UNAVAILABLE FREE OF COST)', async () => {
    const { db, env } = await freshEnv();
    const now = new Date().toISOString();
    const inserted = db.prepare(`INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, attempts, created_at, updated_at)
      VALUES (8, 'x', 'article:8:x', 'draft', 'x', 0, ?, ?)`).run(now, now);
    const fetchFn = mockFetch([]);
    const result = await dispatchPost(env, Number(inserted.lastInsertRowid), { content: { caption: 'x' } }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.failure.code, 'PLATFORM_UNAVAILABLE');
    assert.equal(fetchFn.calls.length, 0);
  });

  it('expired token -> WAITING_FOR_AUTHORIZATION before any platform call', async () => {
    const { db, env } = await freshEnv();
    db.prepare("UPDATE social_accounts SET token_expires_at = ? WHERE platform = 'pinterest'").run(PAST);
    const row = await createPost(env, { articleId: 9, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 9, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = pinterestOkFetch();
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'waiting_authorization');
    assert.equal(fetchFn.calls.length, 0);
  });

  it('no connected account -> waiting_authorization, nothing posted', async () => {
    const { db, env } = await freshEnv();
    db.prepare("DELETE FROM social_accounts WHERE platform = 'pinterest'").run();
    const row = await createPost(env, { articleId: 10, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 10, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = pinterestOkFetch();
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'NOT_CONNECTED');
    assert.equal(fetchFn.calls.length, 0);
  });

  it('daily framework cap blocks the 11th Pinterest post of the day', async () => {
    const { db, env } = await freshEnv();
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 10; i++) {
      db.prepare(`INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, published_at, attempts, created_at, updated_at)
        VALUES (?, 'pinterest', ?, 'published', 'x', ?, 0, datetime('now'), datetime('now'))`)
        .run(100 + i, `article:${100 + i}:pinterest`, `${today}T08:00:00.000Z`);
    }
    const row = await createPost(env, { articleId: 11, platform: 'pinterest', caption: 'x' });
    const dbArticle = { id: 11, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' };
    const content = buildPostContent(dbArticle, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = pinterestOkFetch();
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rate_limited');
    assert.equal(fetchFn.calls.length, 0, 'cap is enforced before any platform call');
  });
});
