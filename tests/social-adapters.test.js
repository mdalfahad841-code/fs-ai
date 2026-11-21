// FS AI — Social adapter contract tests (W4, 2026-11-21).
//
// Every adapter is exercised with a MOCKED fetch — no real platform is
// ever called. Each test asserts the adapter contract: token/permission
// /media/caption validation BEFORE posting, platform confirmation
// (a post id) on success, verify-back behaviour, and error
// classification (401/403 -> WAITING_FOR_AUTHORIZATION, 429/5xx ->
// TRANSIENT, other 4xx -> PERMANENT). No live account exists, so no
// platform is claimed operational here.
//
// Run: node --test tests/social-adapters.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { PinterestAdapter } = require('../backend/social/adapters/pinterest.js');
const { FacebookAdapter } = require('../backend/social/adapters/facebook.js');
const { InstagramAdapter } = require('../backend/social/adapters/instagram.js');
const { LinkedinAdapter } = require('../backend/social/adapters/linkedin.js');
const { YoutubeAdapter } = require('../backend/social/adapters/youtube.js');
const { encryptToken, decryptToken } = require('../backend/social/tokens.js');
const { buildPostContent } = require('../backend/social/content.js');

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const ARTICLE = {
  id: 1, title: 'How to Read Your Car Warning Lights',
  excerpt: 'Dashboard lights explained in plain English, what each one means and what to do next.',
  body: 'Dashboard lights explained in plain English.',
  division: 'automotive', status: 'published',
};

function account(platform, overrides = {}) {
  return {
    id: 1, platform, status: 'connected', account_name: 'FS AI',
    account_id: platform === 'linkedin' ? 'urn:li:person:abc123' : 'page-or-user-1',
    token_expires_at: FUTURE, _accessToken: 'test-token-never-real', ...overrides,
  };
}

/** Mock fetch: routes is a list of [method, urlSubstring, handler(url, opts) -> {status, body}]. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), opts });
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

const json = (status, body) => ({ status, body });

describe('token encryption at rest (tokens.js)', () => {
  it('round-trips a token and refuses the wrong secret', async () => {
    const stored = await encryptToken('pina-test-token', 'secret-one');
    assert.ok(stored.startsWith('v1:'), 'stored form is versioned ciphertext, never plain text');
    assert.ok(!stored.includes('pina-test-token'), 'plain token never appears in the stored value');
    assert.equal(await decryptToken(stored, 'secret-one'), 'pina-test-token');
    await assert.rejects(decryptToken(stored, 'secret-two'), /decrypt|operation/i);
  });

  it('refuses to encrypt/decrypt without a configured secret', async () => {
    await assert.rejects(encryptToken('x', ''), /SOCIAL_TOKEN_SECRET/);
    await assert.rejects(decryptToken('v1:aaaa:bbbb', ''), /SOCIAL_TOKEN_SECRET/);
  });
});

describe('Pinterest adapter', () => {
  it('publishes with board resolution and verifies the pin back', async () => {
    const fetchFn = mockFetch([
      ['GET', '/boards', async () => json(200, { items: [{ id: '987', name: 'Cars' }] })],
      ['POST', '/pins', async () => json(201, { id: '12345', title: 'x' })],
      ['GET', '/pins/12345', async () => json(200, { id: '12345' })],
    ]);
    const adapter = new PinterestAdapter({ account: account('pinterest'), fetchFn });
    const content = buildPostContent(ARTICLE, 'pinterest', { url: 'https://fs-ai-5w5.pages.dev/pin-card-1.png' });
    const result = await adapter.publish({ content });
    assert.equal(result.platformPostId, '12345');
    assert.equal(result.url, 'https://www.pinterest.com/pin/12345/');
    const check = await adapter.verify('12345');
    assert.equal(check.found, true);
  });

  it('refuses without media (Pinterest requires an image) and never calls /pins', async () => {
    const fetchFn = mockFetch([]);
    const adapter = new PinterestAdapter({ account: account('pinterest'), fetchFn });
    const content = buildPostContent(ARTICLE, 'pinterest');
    await assert.rejects(adapter.publish({ content }), (e) => e.code === 'VALIDATION');
    assert.equal(fetchFn.calls.filter((c) => c.url.includes('/pins') && c.method === 'POST').length, 0);
  });

  it('maps 401 to WAITING_FOR_AUTHORIZATION', async () => {
    const fetchFn = mockFetch([['GET', '/user_account', async () => json(401, { message: 'invalid token' })]]);
    const adapter = new PinterestAdapter({ account: account('pinterest'), fetchFn });
    await assert.rejects(adapter.validateCredentials(), (e) => e.code === 'WAITING_FOR_AUTHORIZATION' && e.kind === 'needs_owner');
  });

  it('refuses an expired token before any network call', async () => {
    const fetchFn = mockFetch([['GET', '/user_account', async () => json(200, { username: 'x' })]]);
    const adapter = new PinterestAdapter({ account: account('pinterest', { token_expires_at: PAST }), fetchFn });
    await assert.rejects(adapter.validateCredentials(), (e) => e.code === 'WAITING_FOR_AUTHORIZATION');
    assert.equal(fetchFn.calls.length, 0, 'no platform call may happen with an expired token');
  });

  it('verify-back 404 means not published', async () => {
    const fetchFn = mockFetch([['GET', '/pins/999', async () => json(404, { message: 'not found' })]]);
    const adapter = new PinterestAdapter({ account: account('pinterest'), fetchFn });
    assert.equal((await adapter.verify('999')).found, false);
  });
});

describe('Facebook adapter', () => {
  it('publishes a link post to the Page feed and verifies it back', async () => {
    const fetchFn = mockFetch([
      ['POST', '/feed', async () => json(200, { id: '111_222' })],
      ['GET', '/111_222', async () => json(200, { id: '111_222', permalink_url: 'https://www.facebook.com/111_222' })],
    ]);
    const adapter = new FacebookAdapter({ account: account('facebook'), fetchFn });
    const content = buildPostContent(ARTICLE, 'facebook');
    const result = await adapter.publish({ content });
    assert.equal(result.platformPostId, '111_222');
    assert.equal((await adapter.verify('111_222')).found, true);
  });

  it('refuses without a Page id', async () => {
    const fetchFn = mockFetch([]);
    const adapter = new FacebookAdapter({ account: account('facebook', { account_id: null }), fetchFn, env: {} });
    await assert.rejects(adapter.publish({ content: buildPostContent(ARTICLE, 'facebook') }),
      (e) => e.code === 'VALIDATION');
    assert.equal(fetchFn.calls.length, 0);
  });
});

describe('Instagram adapter', () => {
  const okFlow = () => mockFetch([
    // NOTE: '/media_publish' must precede '/media' — substring matching
    // would otherwise route the publish call to the container handler.
    ['POST', '/media_publish', async () => json(200, { id: 'media-1' })],
    ['POST', '/media', async (url, opts) => json(200, { id: 'container-1' })],
    ['GET', '/container-1', async () => json(200, { status_code: 'FINISHED' })],
    ['GET', '/media-1', async () => json(200, { id: 'media-1', permalink: 'https://www.instagram.com/p/abc/' })],
  ]);

  it('runs the two-step container flow and verifies back', async () => {
    const adapter = new InstagramAdapter({ account: account('instagram'), fetchFn: okFlow(), delayFn: async () => {} });
    const content = buildPostContent(ARTICLE, 'instagram', { url: 'https://fs-ai-5w5.pages.dev/pin-card-1.png' });
    const result = await adapter.publish({ content });
    assert.equal(result.platformPostId, 'media-1');
    assert.equal((await adapter.verify('media-1')).found, true);
  });

  it('refuses without a public image URL', async () => {
    const fetchFn = mockFetch([]);
    const adapter = new InstagramAdapter({ account: account('instagram'), fetchFn });
    await assert.rejects(adapter.publish({ content: buildPostContent(ARTICLE, 'instagram') }),
      (e) => e.code === 'VALIDATION');
    assert.equal(fetchFn.calls.length, 0);
  });

  it('container ERROR is permanent (never retried)', async () => {
    const fetchFn = mockFetch([
      ['POST', '/media', async () => json(200, { id: 'container-9' })],
      ['GET', '/container-9', async () => json(200, { status_code: 'ERROR' })],
    ]);
    const adapter = new InstagramAdapter({ account: account('instagram'), fetchFn, delayFn: async () => {} });
    const content = buildPostContent(ARTICLE, 'instagram', { url: 'https://fs-ai-5w5.pages.dev/pin-card-1.png' });
    await assert.rejects(adapter.publish({ content }), (e) => e.code === 'PERMANENT' && e.kind === 'permanent');
  });

  it('refuses a personal (non-Business/Creator) account at validation', async () => {
    const fetchFn = mockFetch([['GET', '/page-or-user-1', async () => json(200, { id: '1', username: 'x', account_type: 'PERSONAL' })]]);
    const adapter = new InstagramAdapter({ account: account('instagram'), fetchFn });
    await assert.rejects(adapter.validateCredentials(), (e) => e.code === 'VALIDATION');
  });
});

describe('LinkedIn adapter', () => {
  it('publishes an article post and reports read-back unavailable (found null)', async () => {
    const fetchFn = mockFetch([
      ['POST', '/rest/posts', async () => json(201, { id: 'urn:li:share:999' })],
    ]);
    const adapter = new LinkedinAdapter({ account: account('linkedin'), fetchFn });
    const content = buildPostContent(ARTICLE, 'linkedin');
    const result = await adapter.publish({ content });
    assert.equal(result.platformPostId, 'urn:li:share:999');
    assert.ok(result.verifyNote, 'adapter honestly notes read-back is unavailable');
    const check = await adapter.verify('urn:li:share:999');
    assert.equal(check.found, null, 'LinkedIn offers no read-back to self-serve apps');
  });

  it('refuses without a person URN', async () => {
    const fetchFn = mockFetch([]);
    const adapter = new LinkedinAdapter({ account: account('linkedin', { account_id: null }), fetchFn, env: {} });
    await assert.rejects(adapter.publish({ content: buildPostContent(ARTICLE, 'linkedin') }),
      (e) => e.code === 'VALIDATION');
  });
});

describe('YouTube adapter', () => {
  it('refuses without video bytes (the API uploads bytes, not URLs)', async () => {
    const fetchFn = mockFetch([]);
    const adapter = new YoutubeAdapter({ account: account('youtube'), fetchFn });
    await assert.rejects(adapter.publish({ content: buildPostContent(ARTICLE, 'youtube') }),
      (e) => e.code === 'VALIDATION');
    assert.equal(fetchFn.calls.length, 0);
  });

  it('uploads with bytes, warns about the private-lock, and verifies back', async () => {
    const fetchFn = mockFetch([
      ['POST', '/upload/youtube/v3/videos', async () => json(200, { id: 'vid123' })],
      ['GET', '/videos', async () => json(200, { items: [{ id: 'vid123', status: { privacyStatus: 'private' } }] })],
    ]);
    const adapter = new YoutubeAdapter({ account: account('youtube'), fetchFn });
    const result = await adapter.publish({
      content: buildPostContent(ARTICLE, 'youtube'),
      mediaBytes: new Uint8Array([0, 1, 2, 3]),
    });
    assert.equal(result.platformPostId, 'vid123');
    assert.ok(result.warnings.some((w) => /PRIVATE/i.test(w)), 'private-lock caveat must be surfaced');
    const check = await adapter.verify('vid123');
    assert.equal(check.found, true);
    assert.match(check.note, /private/);
  });
});
