// FS AI — Social token expiry + refresh tests (Workstream C, 2026-11-21).
//
// Covers backend/social/refresh.js, tokens.js expiry handling and the
// dispatcher preflight refresh path: expired token with a stored
// refresh token auto-refreshes (official flow only, then publishes);
// expired token with NO refresh token -> WAITING_FOR_AUTHORIZATION
// with zero platform calls; LinkedIn (no refresh tokens) always
// re-OAuth; YouTube refresh stays DO-NOT-USE-gated. All platform
// calls are MOCKED; the D1 is a real in-memory SQLite database
// (schema + seed + migration 022, plus 027 where noted).
//
// Run: node --test tests/social-token-expiry.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { encryptToken, decryptToken } = require('../backend/social/tokens.js');
const { buildPostContent } = require('../backend/social/content.js');
const { createPost, getPostById, getAccount } = require('../backend/social/store.js');
const { dispatchPost } = require('../backend/social/dispatcher.js');
const {
  tokenExpiryStatus, refreshSupported, refreshAccountToken, listExpiringAccounts,
} = require('../backend/social/refresh.js');

const ROOT = path.join(__dirname, '..');
const SECRET = 'test-social-token-secret';
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

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

function buildDb(with027 = false) {
  const db = new DatabaseSync(':memory:');
  const files = ['database/schema.sql', 'database/seed.sql', 'database/migrations/022_social_media.sql'];
  if (with027) files.push('database/migrations/027_social_token_refresh.sql');
  for (const file of files) {
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

async function seedAccount(db, env, platform, { expiresAt = FUTURE, withRefresh = false } = {}) {
  const accessEnc = await encryptToken(`old-access-${platform}`, SECRET);
  const refreshEnc = withRefresh ? await encryptToken(`old-refresh-${platform}`, SECRET) : null;
  db.prepare(`INSERT INTO social_accounts (platform, account_name, account_id, status, scopes, access_token_enc, refresh_token_enc, token_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, 'connected', ?, ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(platform, 'FS AI', 'user-1', JSON.stringify(['boards:read', 'pins:read', 'pins:write']), accessEnc, refreshEnc, expiresAt);
}

describe('tokenExpiryStatus', () => {
  it('classifies valid / expiring_soon / expired / unknown / not_connected', () => {
    const now = Date.now();
    const iso = (ms) => new Date(now + ms).toISOString();
    assert.equal(tokenExpiryStatus({ status: 'connected', access_token_enc: 'v1:x:y', token_expires_at: iso(30 * 864e5) }), 'valid');
    assert.equal(tokenExpiryStatus({ status: 'connected', access_token_enc: 'v1:x:y', token_expires_at: iso(3 * 864e5) }), 'expiring_soon');
    assert.equal(tokenExpiryStatus({ status: 'connected', access_token_enc: 'v1:x:y', token_expires_at: iso(-1000) }), 'expired');
    assert.equal(tokenExpiryStatus({ status: 'connected', access_token_enc: 'v1:x:y', token_expires_at: null }), 'unknown');
    assert.equal(tokenExpiryStatus({ status: 'not_connected', access_token_enc: null }), 'not_connected');
    assert.equal(tokenExpiryStatus(null), 'not_connected');
    assert.equal(tokenExpiryStatus({ status: 'connected', access_token_enc: 'v1:x:y', token_expires_at: iso(8 * 864e5) }, { warnDays: 7 }), 'valid');
    assert.equal(tokenExpiryStatus({ status: 'connected', access_token_enc: 'v1:x:y', token_expires_at: iso(8 * 864e5) }, { warnDays: 10 }), 'expiring_soon');
  });

  it('refreshSupported is true only where an official refresh flow exists', () => {
    assert.equal(refreshSupported('pinterest'), true);
    assert.equal(refreshSupported('facebook'), true);
    assert.equal(refreshSupported('instagram'), true);
    assert.equal(refreshSupported('linkedin'), false, 'LinkedIn self-serve has NO refresh tokens');
    assert.equal(refreshSupported('youtube'), true, 'YouTube refresh exists but is DO-NOT-USE-gated');
    assert.equal(refreshSupported('x'), false);
  });
});

describe('refreshAccountToken (mocked token endpoints)', () => {
  it('Pinterest: refreshes, rotates the stored tokens, and records the 60-day refresh expiry', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET, PINTEREST_CLIENT_ID: 'cid', PINTEREST_CLIENT_SECRET: 'csecret' };
    await seedAccount(db, env, 'pinterest', { expiresAt: PAST, withRefresh: true });
    const fetchFn = mockFetch([
      ['POST', '/oauth/token', async () => json(200, { access_token: 'new-access-pin', refresh_token: 'new-refresh-pin', expires_in: 2592000 })],
    ]);
    const result = await refreshAccountToken(env, 'pinterest', { fetchFn });
    assert.equal(result.tokenStatus, 'valid');
    assert.ok(result.tokenExpiresAt, 'new access expiry is recorded');
    const stored = await getAccount(env, 'pinterest');
    assert.equal(await decryptToken(stored.access_token_enc, SECRET), 'new-access-pin', 'new access token is stored encrypted');
    assert.equal(await decryptToken(stored.refresh_token_enc, SECRET), 'new-refresh-pin', 'new refresh token is stored encrypted');
    assert.ok(stored.refresh_token_expires_at, 'refresh-token expiry is recorded (027)');
    assert.ok(stored.token_refreshed_at, 'refresh time is recorded (027)');
    assert.ok(!JSON.stringify(result).includes('new-access-pin'), 'no token leaks into the result');
    assert.equal(fetchFn.calls.length, 1, 'exactly one token-endpoint call');
  });

  it('Pinterest: refresh failure -> WAITING_FOR_AUTHORIZATION, old tokens untouched', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET, PINTEREST_CLIENT_ID: 'cid', PINTEREST_CLIENT_SECRET: 'csecret' };
    await seedAccount(db, env, 'pinterest', { expiresAt: PAST, withRefresh: true });
    const fetchFn = mockFetch([
      ['POST', '/oauth/token', async () => json(400, { error: 'invalid_grant', error_description: 'refresh token revoked' })],
    ]);
    await assert.rejects(refreshAccountToken(env, 'pinterest', { fetchFn }),
      (e) => e.code === 'WAITING_FOR_AUTHORIZATION' && e.kind === 'needs_owner');
    const stored = await getAccount(env, 'pinterest');
    assert.equal(await decryptToken(stored.access_token_enc, SECRET), 'old-access-pinterest', 'failed refresh never overwrites the stored token');
  });

  it('LinkedIn: refresh is refused with zero network calls (no refresh tokens for self-serve)', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET };
    await seedAccount(db, env, 'linkedin', { expiresAt: PAST, withRefresh: true });
    const fetchFn = mockFetch([]);
    await assert.rejects(refreshAccountToken(env, 'linkedin', { fetchFn }),
      (e) => e.code === 'WAITING_FOR_AUTHORIZATION' && /re-authorize every 60 days/i.test(e.message));
    assert.equal(fetchFn.calls.length, 0);
  });

  it('YouTube: refresh is refused while DO-NOT-USE (zero network calls)', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET, YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'csecret' };
    await seedAccount(db, env, 'youtube', { expiresAt: PAST, withRefresh: true });
    const fetchFn = mockFetch([]);
    await assert.rejects(refreshAccountToken(env, 'youtube', { fetchFn }),
      (e) => e.code === 'PLATFORM_UNAVAILABLE' && /DO-NOT-USE/i.test(e.message));
    assert.equal(fetchFn.calls.length, 0);
  });

  it('Instagram: refresh returns a new 60-day long-lived token', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET, INSTAGRAM_CLIENT_SECRET: 'csecret' };
    await seedAccount(db, env, 'instagram', { expiresAt: PAST, withRefresh: true });
    const fetchFn = mockFetch([
      ['GET', '/access_token', async () => json(200, { access_token: 'new-access-ig', expires_in: 5184000 })],
    ]);
    const result = await refreshAccountToken(env, 'instagram', { fetchFn });
    assert.equal(result.tokenStatus, 'valid');
    const stored = await getAccount(env, 'instagram');
    assert.equal(await decryptToken(stored.access_token_enc, SECRET), 'new-access-ig');
  });

  it('updateAccountTokens works on a pre-027 database (falls back to the 022 columns)', async () => {
    const db = buildDb(false); // migration 022 only — no 027 columns
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET, PINTEREST_CLIENT_ID: 'cid', PINTEREST_CLIENT_SECRET: 'csecret' };
    await seedAccount(db, env, 'pinterest', { expiresAt: PAST, withRefresh: true });
    const fetchFn = mockFetch([
      ['POST', '/oauth/token', async () => json(200, { access_token: 'new-access-pin', refresh_token: 'new-refresh-pin', expires_in: 2592000 })],
    ]);
    const result = await refreshAccountToken(env, 'pinterest', { fetchFn });
    assert.equal(result.tokenStatus, 'valid');
    const stored = await getAccount(env, 'pinterest');
    assert.equal(await decryptToken(stored.access_token_enc, SECRET), 'new-access-pin');
  });

  it('listExpiringAccounts reports statuses without ever including a token', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET };
    await seedAccount(db, env, 'pinterest', { expiresAt: new Date(Date.now() + 2 * 864e5).toISOString(), withRefresh: true });
    await seedAccount(db, env, 'facebook', { expiresAt: PAST });
    const rows = await listExpiringAccounts(env, 7);
    const pin = rows.find((r) => r.platform === 'pinterest');
    const fb = rows.find((r) => r.platform === 'facebook');
    assert.equal(pin.tokenStatus, 'expiring_soon');
    assert.equal(pin.refreshSupported, true);
    assert.equal(fb.tokenStatus, 'expired');
    assert.ok(!JSON.stringify(rows).includes('old-access'), 'no token value may appear in the report');
  });
});

describe('dispatcher preflight refresh path', () => {
  it('expired Pinterest token WITH a refresh token auto-refreshes and then publishes', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET, PINTEREST_CLIENT_ID: 'cid', PINTEREST_CLIENT_SECRET: 'csecret' };
    await seedAccount(db, env, 'pinterest', { expiresAt: PAST, withRefresh: true });
    const row = await createPost(env, { articleId: 1, platform: 'pinterest', caption: 'x' });
    const content = buildPostContent({ id: 1, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' }, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = mockFetch([
      ['POST', '/oauth/token', async () => json(200, { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 2592000 })],
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => json(201, { id: 'pin-1' })],
      ['GET', '/pins/pin-1', async () => json(200, { id: 'pin-1' })],
    ]);
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'published');
    assert.equal((await getPostById(env, row.id)).status, 'published');
    assert.ok(fetchFn.calls.some((c) => c.url.includes('/oauth/token')), 'refresh ran before the publish');
  });

  it('expired token with NO refresh token -> WAITING_FOR_AUTHORIZATION, zero platform calls', async () => {
    const db = buildDb(true);
    const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET };
    await seedAccount(db, env, 'pinterest', { expiresAt: PAST, withRefresh: false });
    const row = await createPost(env, { articleId: 2, platform: 'pinterest', caption: 'x' });
    const content = buildPostContent({ id: 2, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' }, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => json(201, { id: 'pin-1' })],
    ]);
    const result = await dispatchPost(env, row.id, { content }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'waiting_authorization');
    assert.equal(fetchFn.calls.length, 0, 'no platform call may happen with an expired token and no refresh path');
  });
});
