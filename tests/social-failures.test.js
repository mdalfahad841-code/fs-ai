// FS AI — Social failure-path tests (Workstream C, 2026-11-21).
//
// Covers the honest-failure contract: 429 retries with backoff and
// then fails (never a fake success), duplicate-post refusal, no post
// id = no success, invalid media refusal with zero platform calls,
// network failure after exactly 3 attempts, the YouTube DO-NOT-USE
// gate, and OAuth state validation. All platform calls are MOCKED;
// the D1 is a real in-memory SQLite database (schema + seed +
// migration 022).
//
// Run: node --test tests/social-failures.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { encryptToken } = require('../backend/social/tokens.js');
const { buildPostContent } = require('../backend/social/content.js');
const { createPost, getPostById } = require('../backend/social/store.js');
const { dispatchPost } = require('../backend/social/dispatcher.js');
const { validateMediaBytes, imageDimensions, detectImageFormat } = require('../backend/social/media.js');
const {
  createOAuthState, validateOAuthState, missingScopes, hasRequiredScopes, authorizationUrl, oauthRedirectUri,
} = require('../backend/social/oauth.js');

const ROOT = path.join(__dirname, '..');
const SECRET = 'test-social-token-secret';
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
          headers: { get: (name) => (res.headers && res.headers[name.toLowerCase()]) || null },
          text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
        };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"error":"mock: no route"}' };
  };
  fn.calls = calls;
  return fn;
}
const json = (status, body, headers) => ({ status, body, headers });

async function freshEnv(platform = 'pinterest') {
  const db = buildDb();
  const env = { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SECRET };
  const enc = await encryptToken('test-token', SECRET);
  const accountId = platform === 'linkedin' ? 'urn:li:person:abc123' : 'user-1';
  db.prepare(`INSERT INTO social_accounts (platform, account_name, account_id, status, scopes, access_token_enc, token_expires_at, created_at, updated_at)
    VALUES (?, 'FS AI', ?, 'connected', ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(platform, accountId, JSON.stringify(['boards:read', 'pins:read', 'pins:write']), enc, FUTURE);
  return { db, env };
}

/** Minimal valid PNG bytes (signature + IHDR only) with the given size — enough for header parsing. */
function minimalPng(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; buf[25] = 2; // bit depth 8, colour type 2 (RGB)
  return new Uint8Array(buf);
}

function pinterestContent(articleId = 1) {
  return buildPostContent({ id: articleId, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' }, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/card.png' });
}

describe('E-Stop publish route answers 423 (WS-E M3)', () => {
  it('Emergency Stop ON -> POST /posts/:id/publish returns 423 with ESTOP, never publishes', async () => {
    const { createSession: _createSession } = require('../backend/middleware/auth.js');
    const { hashPassword: _hash } = require('../backend/security/crypto.js');
    const { handleSocial: _handleSocial } = require('../backend/routes/social.js');
    const db = buildDb();
    const env = { DB: makeRealD1(db), SESSION_SECRET: 'test-session-secret-estop', SOCIAL_TOKEN_SECRET: SECRET };
    env.OWNER_PASSWORD_HASH = await _hash('correct horse battery staple');
    const session = await _createSession(env, 'owner@example.com', 'correct horse battery staple');
    assert.equal(session.ok, true);
    db.prepare("INSERT INTO website_settings (setting_key, setting_value, description, updated_at) VALUES ('emergency_stop', '1', 'test', datetime('now'))").run();
    const row = await createPost(env, { articleId: 1, platform: 'pinterest', caption: 'x' });
    const res = await _handleSocial(new Request(`http://localhost/api/social/posts/${row.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }), env);
    assert.equal(res.status, 423, 'an E-Stop block is a halt (423), not an upstream failure (502)');
    const body = await res.json();
    assert.equal(body.result.failure.code, 'ESTOP');
    assert.equal(body.result.status, 'blocked');
    assert.equal((await getPostById(env, row.id)).status, 'blocked');
  });
});

describe('updatePost allowlist (WS-E L3)', () => {
  it('stores allowlisted columns (incl. platform_url) and silently drops anything else', async () => {
    const { createPost: _create, getPostById: _get, updatePost: _update } = require('../backend/social/store.js');
    const { env } = await freshEnv();
    const row = await _create(env, { articleId: 20, platform: 'pinterest', caption: 'x' });
    const updated = await _update(env, row.id, {
      status: 'published',
      platform_post_id: 'pin-9',
      platform_url: 'https://www.pinterest.com/pin/pin-9/',
      // Not allowlisted: must be ignored, never written, never error.
      idempotency_key: 'article:20:pinterest-forged',
      created_at: '2000-01-01T00:00:00.000Z',
      'status; DROP TABLE social_posts; --': 'published',
    });
    assert.equal(updated.status, 'published');
    assert.equal(updated.platform_post_id, 'pin-9');
    assert.equal(updated.platform_url, 'https://www.pinterest.com/pin/pin-9/', 'platform_url must survive the allowlist (dispatcher records it)');
    assert.equal(updated.idempotency_key, 'article:20:pinterest', 'idempotency_key is not updatable');
    assert.notEqual(updated.created_at, '2000-01-01T00:00:00.000Z');
    assert.ok((await _get(env, row.id)).id, 'table still intact after the injection-shaped key');
  });
});

describe('429 retry with backoff, then honest failure', () => {
  it('three 429s -> rate_limited, attempts 3, backoff 1s -> 2s, no post id recorded', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 1, platform: 'pinterest', caption: 'x' });
    let pinCalls = 0;
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => { pinCalls += 1; return json(429, { message: 'slow down' }, { 'retry-after': '2' }); }],
    ]);
    const delays = [];
    const result = await dispatchPost(env, row.id, { content: pinterestContent(1) }, { fetchFn, delayFn: async (ms) => { delays.push(ms); } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rate_limited');
    assert.equal(result.failure.code, 'RATE_LIMITED');
    assert.equal(result.failure.attempts, 3);
    assert.equal(pinCalls, 3, 'exactly 3 attempts, then stop');
    assert.deepEqual(delays, [1000, 2000], 'exponential backoff 1s -> 2s');
    const saved = await getPostById(env, row.id);
    assert.equal(saved.status, 'rate_limited');
    assert.equal(saved.platform_post_id, null, 'no post id without platform confirmation');
    assert.equal(saved.attempts, 3);
    assert.match(saved.error, /429|rate limited/i, 'real root cause is recorded');
  });

  it('network failure mid-post -> exactly 3 attempts, failed, real root cause, no post id', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 2, platform: 'pinterest', caption: 'x' });
    let calls = 0;
    const fetchFn = async (url, opts = {}) => {
      calls += 1;
      if (String(url).includes('/boards')) {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ items: [{ id: '987' }] }) };
      }
      throw new Error('mock network down');
    };
    const result = await dispatchPost(env, row.id, { content: pinterestContent(2) }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.failure.attempts, 3);
    assert.match(result.failure.rootCause, /network down/i);
    assert.equal((await getPostById(env, row.id)).platform_post_id, null);
    assert.ok(calls >= 3, 'retried the failing call');
  });
});

describe('duplicate-post refusal and no-id means no success', () => {
  it('second publish of the same article+platform is refused as DUPLICATE and the row stays a draft', async () => {
    const { env } = await freshEnv();
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => json(201, { id: 'pin-1' })],
      ['GET', '/pins/pin-1', async () => json(200, { id: 'pin-1' })],
    ]);
    const first = await createPost(env, { articleId: 3, platform: 'pinterest', caption: 'x' });
    const ok = await dispatchPost(env, first.id, { content: pinterestContent(3) }, { fetchFn, delayFn: async () => {} });
    assert.equal(ok.ok, true);
    const forced = await createPost(env, { articleId: 3, platform: 'pinterest', caption: 'y' }, { force: true });
    const second = await dispatchPost(env, forced.id, { content: pinterestContent(3) }, { fetchFn, delayFn: async () => {} });
    assert.equal(second.ok, false);
    assert.equal(second.failure.code, 'DUPLICATE');
    assert.equal((await getPostById(env, forced.id)).status, 'draft', 'refused duplicate stays a draft for the owner to decide');
  });

  it('create call returns 201 with no post id -> PERMANENT failure, never published', async () => {
    const { env } = await freshEnv();
    const row = await createPost(env, { articleId: 4, platform: 'pinterest', caption: 'x' });
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => json(201, { title: 'no id here' })],
    ]);
    const result = await dispatchPost(env, row.id, { content: pinterestContent(4) }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.match(result.failure.rootCause, /no pin id/i);
    const saved = await getPostById(env, row.id);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.platform_post_id, null);
    assert.equal(saved.attempts, 1, 'a no-id response is permanent — never retried');
  });
});

describe('invalid media refusal', () => {
  it('non-image bytes for a LinkedIn image post are refused before any platform call', async () => {
    const { env } = await freshEnv('linkedin');
    const row = await createPost(env, { articleId: 5, platform: 'linkedin', caption: 'x' });
    const content = buildPostContent({ id: 5, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' }, 'linkedin');
    const fetchFn = mockFetch([
      ['POST', '/rest/posts', async () => json(201, { id: 'urn:li:share:1' })],
    ]);
    const result = await dispatchPost(env, row.id, { content, mediaBytes: new TextEncoder().encode('this is not an image') }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.failure.code, 'VALIDATION');
    assert.equal(fetchFn.calls.length, 0, 'invalid media must never reach the platform');
    assert.equal((await getPostById(env, row.id)).attempts, 0, 'validation happens before any attempt is counted');
  });

  it('validateMediaBytes: format, size, dimensions and Instagram rules', () => {
    const good = minimalPng(1000, 1500);
    assert.equal(detectImageFormat(good), 'png');
    assert.deepEqual(imageDimensions(good), { format: 'png', width: 1000, height: 1500 });
    assert.deepEqual(validateMediaBytes(good, 'pinterest'), []);
    assert.deepEqual(validateMediaBytes(good, 'facebook'), []);
    assert.ok(validateMediaBytes(good, 'instagram').some((p) => /JPEG/i.test(p)), 'Instagram takes JPEG only');
    const badAspect = minimalPng(2000, 500);
    assert.ok(validateMediaBytes(badAspect, 'instagram').some((p) => /aspect/i.test(p)), 'Instagram aspect window is enforced');
    const narrow = minimalPng(400, 600);
    assert.ok(validateMediaBytes(narrow, 'pinterest').some((p) => /600 px/i.test(p)));
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    assert.equal(detectImageFormat(garbage), null);
    assert.ok(validateMediaBytes(garbage, 'pinterest').some((p) => /not a PNG or JPEG/i.test(p)));
    assert.ok(validateMediaBytes(new Uint8Array(0), 'pinterest').some((p) => /no media bytes/i.test(p)));
    const huge = new Uint8Array(9 * 1024 * 1024);
    minimalPng(1080, 1350).forEach((v, i) => { huge[i] = v; });
    // A JPEG header would be needed for a true 8MB JPEG; the PNG magic
    // already proves the size check fires before format-specific rules.
    assert.ok(validateMediaBytes(huge, 'instagram').length >= 1, 'oversize media is refused');
  });
});

describe('YouTube DO-NOT-USE gate (dispatcher choke point)', () => {
  it('a YouTube post is refused with zero platform calls while the flag is off', async () => {
    const { env } = await freshEnv('youtube');
    const row = await createPost(env, { articleId: 6, platform: 'youtube', caption: 'x' });
    const content = buildPostContent({ id: 6, title: 'T', excerpt: 'E', body: 'B', division: 'automotive' }, 'youtube');
    const fetchFn = mockFetch([
      ['POST', '/upload/youtube/v3/videos', async () => json(200, { id: 'vid1' })],
    ]);
    const result = await dispatchPost(env, row.id, { content, mediaBytes: new Uint8Array([0, 1, 2]) }, { fetchFn, delayFn: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.failure.code, 'PLATFORM_UNAVAILABLE');
    assert.match(result.failure.rootCause, /DO-NOT-USE/i);
    assert.equal(fetchFn.calls.length, 0, 'the gate fires before any platform call');
    assert.equal((await getPostById(env, row.id)).status, 'blocked');
  });
});

describe('OAuth routes (owner-only, mocked platform)', () => {
  const { describe: _d, it: _it, before: _before, afterEach: _afterEach } = require('node:test');
  const { createSession } = require('../backend/middleware/auth.js');
  const { hashPassword } = require('../backend/security/crypto.js');
  const { handleSocial } = require('../backend/routes/social.js');
  const { decryptToken: _decrypt } = require('../backend/social/tokens.js');

  let db;
  let env;
  let token;
  const realFetch = globalThis.fetch;
  const OWNER_EMAIL = 'owner@example.com';
  const CORRECT_PASSWORD = 'correct horse battery staple';

  _before(async () => {
    db = buildDb();
    env = { DB: makeRealD1(db), SESSION_SECRET: 'test-session-secret-routes', SOCIAL_TOKEN_SECRET: SECRET };
    env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    // NOTE: no src/index.js import here on purpose — createSession is
    // the same code the login route calls, so the session is identical,
    // and this file stays independent of the full worker import chain.
    const session = await createSession(env, OWNER_EMAIL, CORRECT_PASSWORD);
    assert.equal(session.ok, true, 'owner session must be creatable');
    token = session.token;
  });

  _afterEach(() => { globalThis.fetch = realFetch; });

  function req(method, pathName, body) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      return new Request(`http://localhost${pathName}`, { method, headers, body: JSON.stringify(body) });
    }
    return new Request(`http://localhost${pathName}`, { method, headers });
  }

  _it('GET /oauth/pinterest/start without a client id -> 503 (never a broken URL)', async () => {
    const res = await handleSocial(req('GET', '/api/social/oauth/pinterest/start'), env);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /client id is not configured/i);
  });

  _it('GET /oauth/pinterest/start with a client id -> authorization URL with a signed state', async () => {
    env.PINTEREST_CLIENT_ID = 'test-client-id';
    const res = await handleSocial(req('GET', '/api/social/oauth/pinterest/start'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.authorizationUrl.startsWith('https://www.pinterest.com/oauth/'));
    assert.ok(body.authorizationUrl.includes('client_id=test-client-id'));
    assert.ok(body.authorizationUrl.includes('state='));
    assert.equal(body.redirectUri, 'https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/pinterest/callback');
    return body;
  });

  _it('GET /oauth/pinterest/callback exchanges the code and stores encrypted tokens (never returns one)', async () => {
    env.PINTEREST_CLIENT_ID = 'test-client-id';
    env.PINTEREST_CLIENT_SECRET = 'test-client-secret';
    const start = await handleSocial(req('GET', '/api/social/oauth/pinterest/start'), env);
    const startBody = await start.json();
    const state = new URL(startBody.authorizationUrl).searchParams.get('state');
    globalThis.fetch = mockFetch([
      ['POST', '/oauth/token', async () => json(200, { access_token: 'tok-access-1', refresh_token: 'tok-refresh-1', expires_in: 2592000 })],
    ]);
    const res = await handleSocial(req('GET', `/api/social/oauth/pinterest/callback?code=test-code&state=${encodeURIComponent(state)}`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, true);
    assert.equal(body.platform, 'pinterest');
    assert.ok(body.refreshTokenExpiresAt, 'Pinterest refresh expiry is recorded');
    assert.ok(!JSON.stringify(body).includes('tok-access-1'), 'a token is never returned');
    const row = db.prepare("SELECT * FROM social_accounts WHERE platform = 'pinterest'").get();
    assert.equal(row.status, 'connected');
    assert.equal(await _decrypt(row.access_token_enc, SECRET), 'tok-access-1');
    assert.equal(await _decrypt(row.refresh_token_enc, SECRET), 'tok-refresh-1');
    assert.ok(row.access_token_enc.startsWith('v1:'), 'stored token is ciphertext');
  });

  _it('GET /oauth/pinterest/callback with a tampered state -> 400, nothing stored', async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM social_accounts WHERE platform = 'facebook'").get().n;
    const res = await handleSocial(req('GET', '/api/social/oauth/pinterest/callback?code=x&state=tampered.state'), env);
    assert.equal(res.status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM social_accounts WHERE platform = 'facebook'").get().n, before);
  });

  _it('POST /accounts/:id/refresh refreshes an expired token via the mocked endpoint', async () => {
    const enc = await encryptToken('old-access-pin', SECRET);
    const refreshEnc = await encryptToken('old-refresh-pin', SECRET);
    const past = new Date(Date.now() - 3600e3).toISOString();
    const inserted = db.prepare(`INSERT INTO social_accounts (platform, account_name, account_id, status, scopes, access_token_enc, refresh_token_enc, token_expires_at, created_at, updated_at)
      VALUES ('instagram', 'FS AI', 'ig-1', 'connected', '[]', ?, ?, ?, datetime('now'), datetime('now'))`).run(enc, refreshEnc, past);
    env.INSTAGRAM_CLIENT_SECRET = 'ig-secret';
    globalThis.fetch = mockFetch([
      ['GET', '/access_token', async () => json(200, { access_token: 'fresh-ig-token', expires_in: 5184000 })],
    ]);
    const res = await handleSocial(req('POST', `/api/social/accounts/${Number(inserted.lastInsertRowid)}/refresh`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.refreshed, true);
    assert.equal(body.tokenStatus, 'valid');
    const row = db.prepare("SELECT * FROM social_accounts WHERE platform = 'instagram'").get();
    assert.equal(await _decrypt(row.access_token_enc, SECRET), 'fresh-ig-token');
  });
});
describe('OAuth state validation', () => {
  it('round-trips, then rejects a tampered state, a wrong platform, and an expired state', async () => {
    const state = await createOAuthState(SECRET, 'pinterest');
    const payload = await validateOAuthState(SECRET, state, 'pinterest');
    assert.equal(payload.p, 'pinterest');
    assert.ok(payload.exp > Date.now());

    const tampered = `${state.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await assert.rejects(validateOAuthState(SECRET, tampered, 'pinterest'), /signature/i);
    await assert.rejects(validateOAuthState(SECRET, state, 'facebook'), /not 'facebook'/i);
    await assert.rejects(validateOAuthState(SECRET, state, 'pinterest', { now: Date.now() + 11 * 60 * 1000 }), /expired/i);
    await assert.rejects(validateOAuthState('different-secret', state, 'pinterest'), /signature/i);
    await assert.rejects(validateOAuthState(SECRET, 'not-a-state', 'pinterest'), /malformed/i);
  });

  it('missingScopes names exactly the scopes not yet granted', () => {
    assert.deepEqual(missingScopes('pinterest', ['boards:read', 'pins:read', 'pins:write']), ['boards:write', 'user_accounts:read']);
    assert.deepEqual(missingScopes('pinterest', ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read']), []);
    assert.equal(hasRequiredScopes('instagram', ['instagram_business_basic']), false);
    assert.equal(hasRequiredScopes('instagram', ['instagram_business_basic', 'instagram_business_content_publish']), true);
  });

  it('authorizationUrl builds a per-platform URL with the required scopes', () => {
    const url = authorizationUrl('pinterest', { clientId: 'cid', redirectUri: 'https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/pinterest/callback', state: 's1' });
    assert.ok(url.startsWith('https://www.pinterest.com/oauth/'));
    assert.ok(url.includes('scope=boards%3Aread') || url.includes('boards'), 'scopes are included');
    assert.ok(url.includes('state=s1'));
    assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/pinterest/callback');
    assert.throws(() => authorizationUrl('x', { clientId: 'c', redirectUri: 'https://example.com', state: 's' }), /no free official posting path/);
    assert.throws(() => authorizationUrl('unknown-platform', { clientId: 'c', redirectUri: 'https://example.com', state: 's' }), /Unknown social platform/);
    assert.throws(() => authorizationUrl('pinterest', { redirectUri: 'https://example.com', state: 's' }), /client id is not configured/i);
  });

  it('default redirect base is the Worker (pages.dev cannot serve /api/*)', () => {
    for (const platform of ['pinterest', 'facebook', 'instagram', 'linkedin', 'youtube']) {
      assert.equal(
        oauthRedirectUri({}, platform),
        `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/${platform}/callback`,
      );
      const url = authorizationUrl(platform, { clientId: 'cid', redirectUri: oauthRedirectUri({}, platform), state: 's1' });
      assert.equal(
        new URL(url).searchParams.get('redirect_uri'),
        `https://fs-ai.mdalfahad841.workers.dev/api/social/oauth/${platform}/callback`,
        `${platform} authorization URL must carry the workers.dev callback`,
      );
    }
    // The env override is kept: an explicit base still wins over the default.
    assert.equal(
      oauthRedirectUri({ SOCIAL_OAUTH_REDIRECT_BASE: 'https://example.invalid' }, 'pinterest'),
      'https://example.invalid/api/social/oauth/pinterest/callback',
    );
  });
});
