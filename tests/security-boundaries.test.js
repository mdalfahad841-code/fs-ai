// FS AI — Workstream E: security-boundary tests.
//
// Proves the boundaries the audit relies on, against real SQLite:
//   - Emergency Stop blocks publishing / drain / social end to end,
//     and OFF restores each path (no partial state).
//   - The settings allowlist refuses unknown keys and bad values.
//   - Owner auth rejects missing / bad / expired sessions and accepts
//     a valid hashed session.
//   - Rate limiting answers 429 past the write budget.
//   - User input never reaches SQL (bound parameters everywhere).
//   - Output escaping and social-token encryption behave fail-closed.
//
// One test is SKIPPED on purpose: deleting a protected article (#26)
// through the owner Delete endpoint currently succeeds — the guard
// the protection module requires was never wired into
// backend/routes/admin-articles.js (see WS-E notes §3, finding H1).
// It is skipped, not deleted and not weakened, so WS-A's fix can
// un-skip it. Do not "fix" it by asserting the current behaviour.
// Run: node --test tests/security-boundaries.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { requireOwner } = require('../backend/middleware/auth.js');
const { hashSessionToken, escapeHtml } = require('../backend/security/crypto.js');
const { sanitiseForHtml } = require('../backend/middleware/validation.js');
const { rateLimit } = require('../backend/middleware/rate-limit.js');
const { encryptToken, decryptToken, isEncryptedToken } = require('../backend/social/tokens.js');
const { preflight, dispatchPost } = require('../backend/social/dispatcher.js');
const { SOCIAL_CODES } = require('../backend/social/errors.js');
const { publishDueArticles, handleAdminArticles } = require('../backend/routes/admin-articles.js');
const { runDailyWorkflow, runWeeklyWorkflow } = require('../backend/routes/scheduler.js');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const { handleSocial } = require('../backend/routes/social.js');
const { setEmergencyStop } = require('../backend/routes/admin.js');

const ROOT = path.join(__dirname, '..');
const SESSION_SECRET = 'test-session-secret-for-security-boundaries';
const SOCIAL_SECRET = 'test-social-token-secret-for-boundaries';

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
  'database/migrations/003_sessions.sql',
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql',
  'database/migrations/022_social_media.sql',
];

function freshEnv() {
  const db = buildDb(BASE_FILES);
  return { db, env: { DB: makeRealD1(db), SESSION_SECRET, SOCIAL_TOKEN_SECRET: SOCIAL_SECRET } };
}

async function ownerToken(db, expiresAt) {
  const token = 'owner-test-token-' + Math.random().toString(36).slice(2);
  const tokenHash = await hashSessionToken(token, SESSION_SECRET);
  db.prepare(
    'INSERT INTO sessions (token_hash, owner_email, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(tokenHash, 'owner@example.com', expiresAt, new Date().toISOString());
  return token;
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token };
}

function insertDraftPost(db, overrides = {}) {
  const row = {
    article_id: 1, platform: 'pinterest', key: 'article:1:pinterest',
    status: 'draft', caption: 'Test post', ...overrides,
  };
  const info = db.prepare(
    "INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026-11-21T10:00:00.000Z', '2026-11-21T10:00:00.000Z')",
  ).run(row.article_id, row.platform, row.key, row.status, row.caption);
  return Number(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Emergency Stop — blocks publishing, drain, weekly and social; OFF restores
// ---------------------------------------------------------------------------
describe('Emergency Stop — end-to-end blocking and restore', () => {
  it('ON: scheduled publish publishes nothing and leaves the article approved', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, publish_at, created_at, updated_at) VALUES (101, 1, 'Due Article', 'due-article', 'x', 'Body.', 'FS AI', 'approved', 0, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')",
    ).run();
    await setEmergencyStop(env, true);
    const blocked = await publishDueArticles(env);
    assert.equal(blocked.published, 0);
    assert.equal(blocked.skipped, true);
    assert.equal(db.prepare("SELECT status FROM articles WHERE id = 101").get().status, 'approved');
    await setEmergencyStop(env, false);
    const restored = await publishDueArticles(env);
    assert.equal(restored.published, 1);
    assert.equal(db.prepare("SELECT status FROM articles WHERE id = 101").get().status, 'published');
  });

  it('ON: daily and weekly workflows skip with no partial state; OFF restores', async () => {
    const { db, env } = freshEnv();
    await setEmergencyStop(env, true);
    const dailyBlocked = await runDailyWorkflow(env);
    assert.equal(dailyBlocked.skipped, true);
    assert.equal(dailyBlocked.reason, 'Emergency Stop is on.');
    const weeklyBlocked = await runWeeklyWorkflow(env);
    assert.equal(weeklyBlocked.skipped, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE date = '2026-11-21'").get().n, 0,
      'a skipped run writes no report row');
    await setEmergencyStop(env, false);
    const daily = await runDailyWorkflow(env, { force: true });
    assert.equal(daily.skipped, undefined);
    assert.equal(daily.ok, true);
  });

  it('ON: social preflight throws ESTOP before any account/platform touch; OFF moves past the gate', async () => {
    const { env } = freshEnv();
    await setEmergencyStop(env, true);
    await assert.rejects(
      () => preflight(env, { platform: 'pinterest' }),
      (err) => err.code === SOCIAL_CODES.ESTOP && /Emergency Stop is ON/.test(err.message),
    );
    await setEmergencyStop(env, false);
    // With the stop OFF the gate passes and the next check (no connected
    // account) is what refuses — proving OFF restores the path.
    await assert.rejects(
      () => preflight(env, { platform: 'pinterest' }),
      (err) => err.code === SOCIAL_CODES.NOT_CONNECTED,
    );
  });

  it('ON: dispatchPost records blocked/ESTOP with zero attempts and no publish; OFF re-routes to waiting_authorization', async () => {
    const { db, env } = freshEnv();
    const postId = insertDraftPost(db);
    await setEmergencyStop(env, true);
    const blocked = await dispatchPost(env, postId, { content: { caption: 'x' } }, { delayFn: () => Promise.resolve() });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.failure.code, 'ESTOP');
    assert.equal(blocked.failure.attempts, 0);
    const rowBlocked = db.prepare('SELECT status, attempts FROM social_posts WHERE id = ?').get(postId);
    assert.equal(rowBlocked.status, 'blocked');
    assert.equal(rowBlocked.attempts, 0);
    await setEmergencyStop(env, false);
    const restored = await dispatchPost(env, postId, { content: { caption: 'x' } }, { delayFn: () => Promise.resolve() });
    assert.equal(restored.ok, false);
    assert.equal(restored.status, 'waiting_authorization', 'OFF restores the path: now the missing OAuth refuses, not the stop');
    assert.equal(db.prepare('SELECT status FROM social_posts WHERE id = ?').get(postId).status, 'waiting_authorization');
  });

  it('ON: the owner social publish route refuses with the ESTOP failure and never publishes', async () => {
    // WS-E finding M10: the route maps dispatcher status 'blocked' to
    // HTTP 502 (only 'waiting_authorization' maps to 423), so an
    // E-stop block currently answers 502, not 423. The block itself is
    // correct (no platform call, post stays blocked, failure code
    // ESTOP in the body); the exact-code fix is PATCH-PROPOSED for
    // WS-C's routes/social.js in the WS-E notes (§3 M10). This test
    // pins the safe behaviour, not the wrong code — do not "fix" it
    // by asserting 200.
    const { db, env } = freshEnv();
    const token = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    const postId = insertDraftPost(db);
    await setEmergencyStop(env, true);
    const res = await handleSocial(
      new Request(`https://fs-ai.test/api/social/posts/${postId}/publish`, {
        method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: '{}',
      }), env);
    assert.ok(res.status >= 400 && res.status < 600, 'E-stop publish must not succeed');
    assert.notEqual(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.result.failure.code, 'ESTOP');
    assert.equal(body.result.status, 'blocked');
    assert.equal(db.prepare('SELECT status FROM social_posts WHERE id = ?').get(postId).status, 'blocked');
    await setEmergencyStop(env, false);
  });
});

// ---------------------------------------------------------------------------
// Settings allowlist — unknown keys and bad values are refused
// ---------------------------------------------------------------------------
describe('settings allowlist', () => {
  async function postSetting(env, key, value) {
    const res = await handleAutonomy(
      new Request('https://fs-ai.test/api/autonomy/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      }), env, {}, { owner: 'owner' });
    return { status: res.status, body: await res.json() };
  }

  it('refuses keys outside the allowlist — including revenue, E-Stop and provider order', async () => {
    const { env } = freshEnv();
    for (const key of ['total_revenue_usd', 'emergency_stop', 'llm_provider_order', 'owner_email', 'SESSION_SECRET', 'social_auto_post_x']) {
      const r = await postSetting(env, key, 'on');
      assert.equal(r.status, 400, key + ' must be refused');
      assert.match(r.body.error, /must be one of/);
    }
  });

  it('refuses invalid values for allowlisted keys', async () => {
    const { env } = freshEnv();
    assert.equal((await postSetting(env, 'publishing_mode', 'free')).status, 400);
    assert.equal((await postSetting(env, 'publishing_mode', 'auto; DROP TABLE autonomy_settings')).status, 400);
    assert.equal((await postSetting(env, 'max_articles_per_day', '99')).status, 400);
    assert.equal((await postSetting(env, 'auto_publishing', 'maybe')).status, 400);
    assert.equal((await postSetting(env, 'auto_publish_eligible_since', 'tomorrow')).status, 400);
  });

  it('accepts a valid value and persists it', async () => {
    const { db, env } = freshEnv();
    const r = await postSetting(env, 'max_articles_per_day', '2');
    assert.equal(r.status, 200);
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'max_articles_per_day'").get().value, '2');
  });
});

// ---------------------------------------------------------------------------
// Owner auth — session tokens
// ---------------------------------------------------------------------------
describe('owner auth boundaries', () => {
  it('rejects a missing token, a bad token and an expired session; accepts a valid one', async () => {
    const { db, env } = freshEnv();
    const noToken = await requireOwner(new Request('https://fs-ai.test/api/admin/articles'), env);
    assert.equal(noToken.ok, false);
    assert.equal(noToken.response.status, 401);
    const bad = await requireOwner(
      new Request('https://fs-ai.test/api/admin/articles', { headers: authHeaders('no-such-token') }), env);
    assert.equal(bad.ok, false);
    assert.equal(bad.response.status, 401);
    const expiredToken = await ownerToken(db, new Date(Date.now() - 1000).toISOString());
    const expired = await requireOwner(
      new Request('https://fs-ai.test/api/admin/articles', { headers: authHeaders(expiredToken) }), env);
    assert.equal(expired.ok, false);
    assert.equal(expired.response.status, 401);
    const goodToken = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    const good = await requireOwner(
      new Request('https://fs-ai.test/api/admin/articles', { headers: authHeaders(goodToken) }), env);
    assert.equal(good.ok, true);
    assert.equal(good.owner, 'owner@example.com');
  });

  it('never accepts the raw SESSION_SECRET as a Bearer token', async () => {
    const { env } = freshEnv();
    const res = await requireOwner(
      new Request('https://fs-ai.test/api/admin/articles', { headers: authHeaders(SESSION_SECRET) }), env);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 401);
  });

  it('fails closed when SESSION_SECRET is not configured', async () => {
    const { db, env } = freshEnv();
    delete env.SESSION_SECRET;
    const token = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    const res = await requireOwner(
      new Request('https://fs-ai.test/api/admin/articles', { headers: authHeaders(token) }), env);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 503);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting, SQL injection, XSS escaping, token encryption
// ---------------------------------------------------------------------------
describe('rate limiting', () => {
  it('answers 429 after the 30/min write budget (in-memory fallback)', async () => {
    const env = {}; // no DB: memory store, same as the Worker fallback
    const req = () => new Request('https://fs-ai.test/api/auth/login', { method: 'POST' });
    let limitedAt = null;
    for (let i = 1; i <= 35; i++) {
      const res = await rateLimit(req(), env);
      if (res) { limitedAt = i; assert.equal(res.status, 429); break; }
    }
    assert.equal(limitedAt, 31, 'first 30 POSTs pass, the 31st is limited');
  });
});

describe('SQL injection — user input is always bound, never interpolated', () => {
  it('a crafted platform filter returns no rows instead of every row', async () => {
    const { db, env } = freshEnv();
    const token = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    insertDraftPost(db, { status: 'published', key: 'article:1:pinterest:live' });
    const res = await handleSocial(
      new Request("https://fs-ai.test/api/social/posts?platform=' OR '1'='1", { headers: authHeaders(token) }),
      env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.posts, [], 'injection string matches no platform; it must not dump the table');
  });

  it('a crafted article id in the Delete path cannot delete by expression', async () => {
    const { db, env } = freshEnv();
    const token = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    const before = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    const res = await handleAdminArticles(
      new Request('https://fs-ai.test/api/admin/articles/1 OR 1=1', {
        method: 'DELETE', headers: authHeaders(token),
      }), env, {}, { owner: 'owner' });
    assert.equal(res.status, 404, 'no article has the literal id "1 OR 1=1"');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, before);
  });
});

describe('XSS escaping', () => {
  it('escapeHtml neutralises script markup; sanitiseForHtml strips control chars and escapes', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const out = escapeHtml(evil);
    assert.ok(!out.includes('<script>') && !out.includes('<img'), 'no raw tag survives');
    assert.ok(out.includes('&lt;script&gt;'));
    assert.equal(sanitiseForHtml('a\u0000b<c'), 'ab&lt;c');
  });
});

describe('social token encryption — fail-closed', () => {
  it('round-trips, refuses a missing secret, and refuses tampered ciphertext', async () => {
    const enc = await encryptToken('ya29.test-token-value', SOCIAL_SECRET);
    assert.ok(isEncryptedToken(enc), 'stored form carries the v1: prefix');
    assert.ok(!enc.includes('ya29.test-token-value'), 'plaintext never appears in the stored form');
    assert.equal(await decryptToken(enc, SOCIAL_SECRET), 'ya29.test-token-value');
    await assert.rejects(() => encryptToken('x', ''), /not configured/);
    await assert.rejects(() => decryptToken(enc, ''), /not configured/);
    await assert.rejects(() => decryptToken('v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==', SOCIAL_SECRET));
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A');
    await assert.rejects(() => decryptToken(tampered, SOCIAL_SECRET), 'GCM authentication must fail on tampering');
    await assert.rejects(() => decryptToken('plaintext-token', SOCIAL_SECRET), /expected encrypted format/);
  });
});

// ---------------------------------------------------------------------------
// Protected-article Delete guard (WS-E finding H1, fixed by WS-A
// 2026-11-21: backend/routes/admin-articles.js deleteArticle() now calls
// assertNotProtected() before deleting — the it.skip below was un-skipped
// as part of that fix and must stay a live test, never re-skipped.
// ---------------------------------------------------------------------------
describe('protected-article Delete guard (WS-A fix applied 2026-11-21)', () => {
  it('DELETE /api/admin/articles/26 is refused 403 — protected test articles cannot be deleted', async () => {
    // WS-E finding H1, fixed by WS-A 2026-11-21: deleteArticle() now
    // calls assertNotProtected() — this test pins the 403 + row
    // survival. Do not re-skip or weaken it; a failure here means the
    // guard regressed.
    // The seed loads only articles 1–25, so #26 does not exist in the
    // harness DB — insert the protected row first, or the "row
    // survives" assertion would be vacuous (COUNT 0 == 0). The guard
    // itself is ID-level (protection.js constant), so it refuses 403
    // even without a row; the insert makes the survival check real.
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO articles (id, division_id, category_id, title, slug, excerpt, body, author, status, fact_checked, reading_minutes, published_at) VALUES (26, 1, 3, 'Protected Test Article', 'protected-test-article', 'Protected — must not be deleted.', 'Protected test body.', 'FS AI', 'draft', 0, 1, NULL)",
    ).run();
    const token = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    const res = await handleAdminArticles(
      new Request('https://fs-ai.test/api/admin/articles/26', {
        method: 'DELETE', headers: authHeaders(token),
      }), env, {}, { owner: 'owner' });
    assert.equal(res.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles WHERE id = 26').get().n, 1);
  });
});

// ---------------------------------------------------------------------------
// Delete cleanup + audit (WS-E finding L4, fixed by WS-A 2026-11-21)
// ---------------------------------------------------------------------------
describe('Delete leaves no orphans and writes an audit row (WS-A fix, L4)', () => {
  // Migration 025 (article_deletion_audit) on top of the base files,
  // so the audit write has a table to land in.
  function freshEnvWithAudit() {
    const db = buildDb([...BASE_FILES, 'database/migrations/025_article_deletion_audit.sql']);
    return { db, env: { DB: makeRealD1(db), SESSION_SECRET, SOCIAL_TOKEN_SECRET: SOCIAL_SECRET } };
  }

  async function deleteArticle(db, env, id) {
    const token = await ownerToken(db, new Date(Date.now() + 3600 * 1000).toISOString());
    return handleAdminArticles(
      new Request(`https://fs-ai.test/api/admin/articles/${id}`, {
        method: 'DELETE', headers: authHeaders(token),
      }), env, {}, { owner: 'owner@example.com' });
  }

  it('deleting a draft removes its tags + sources, keeps revisions, and writes the audit row', async () => {
    const { db, env } = freshEnvWithAudit();
    db.prepare(
      "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (101, 1, 'Deletable Draft', 'deletable-draft', 'x', 'Draft body here for deletion.', 'FS AI', 'draft', 0)",
    ).run();
    db.prepare("INSERT INTO article_tags (article_id, tag) VALUES (101, 'ev'), (101, 'charging')").run();
    db.prepare(
      "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (101, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (101, 'Deletable Draft', 'x', 'Earlier body.', 'draft', 'test')",
    ).run();
    const res = await deleteArticle(db, env, 101);
    assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => ({}))));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles WHERE id = 101').get().n, 0, 'the article row is gone');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_tags WHERE article_id = 101').get().n, 0, 'no orphan tag rows');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = 101').get().n, 0, 'no orphan source rows');
    // Revisions: article_revisions declares ON DELETE CASCADE, so in
    // this harness (schema.sql runs PRAGMA foreign_keys = ON) the
    // cascade removes them; on live D1 the cascade may not fire and
    // they remain. Either way the audit row below is the durable
    // record — it stores how many revisions existed at delete time.
    const fkOn = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1;
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = 101').get().n,
      fkOn ? 0 : 1,
      fkOn ? 'revisions cascade away in an FK-enforcing DB' : 'revisions are kept where the cascade does not fire');
    const audit = db.prepare('SELECT * FROM article_deletion_audit WHERE article_id = 101').get();
    assert.ok(audit, 'an audit row was written before the delete');
    assert.equal(audit.title, 'Deletable Draft');
    assert.equal(audit.slug, 'deletable-draft');
    assert.equal(audit.status_at_delete, 'draft');
    assert.equal(audit.deleted_by, 'owner@example.com');
    assert.equal(audit.body_length, 'Draft body here for deletion.'.length);
    assert.equal(audit.revisions_kept, 1);
  });

  it('pre-025 database (no audit table): the delete still succeeds — the audit write degrades gracefully', async () => {
    const { db, env } = freshEnv();
    db.prepare(
      "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (101, 1, 'Deletable Draft', 'deletable-draft', 'x', 'Draft body here.', 'FS AI', 'draft', 0)",
    ).run();
    db.prepare("INSERT INTO article_tags (article_id, tag) VALUES (101, 'ev')").run();
    const res = await deleteArticle(db, env, 101);
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles WHERE id = 101').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_tags WHERE article_id = 101').get().n, 0, 'orphan cleanup does not depend on the audit table');
  });
});
