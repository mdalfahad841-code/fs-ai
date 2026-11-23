// FS AI — Fix Pass 2 item 5: delete for drafts (2026-11-23).
//
// Dashboard Delete failed for drafts with fact-check/SEO rows: fact_checks,
// seo_checks and the other NO ACTION dependents block DELETE FROM articles
// on an FK-enforcing store (live D1) with FOREIGN KEY constraint failed.
// deleteArticle now removes the dependent rows first, in ONE atomic batch
// (d1Batch — real D1 runs it as a single transaction), with the deletion
// audit as the last statement of the same batch — the audit row lands only
// when the delete lands (close-out B4: the old code wrote the audit row
// BEFORE the DELETE, so a failed delete left an audit row for an article
// that still exists).
//
// Real SQLite databases (schema + seed + the migrations that own the
// dependent tables), FK enforcement ON — the same enforcement live D1
// applies (close-out B4: PRAGMA foreign_keys reads 1 live). No network,
// no live D1. Run: node --test tests/fixpass2-item5.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleRequest } = require('../src/index.js');
const { hashPassword } = require('../backend/security/crypto.js');
const { d1Batch } = require('../backend/middleware/validation.js');

const ROOT = path.join(__dirname, '..');
const WORKER_URL = 'http://localhost';
const OWNER_EMAIL = 'owner@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';

// Split a SQL file into statements: ';' outside single-quoted strings
// ends a statement; '--' starts a line comment (outside strings).
// Same splitter as tests/real-db.test.js (migration comments end in ';').
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

// Migrations that own the tables deleteArticle touches: 009 (fact-check /
// corrections / SEO), 015 (correction resolutions), 021 (publication
// logs), 022 (social posts — plain article_id, no FK), 024 (fingerprints),
// 025 (deletion audit), 026 (daily reservations), 028 (youtube videos —
// plain article_id, no FK), 029 (fetch runs), 032 (publish overrides —
// plain article_id, no FK). 005/006/008/010/011/012 are the same base set
// tests/backup-restore.test.js applies after schema + seed.
const DB_FILES = [
  'database/schema.sql', 'database/seed.sql',
  'database/migrations/005_autonomy.sql', 'database/migrations/006_llm_usage.sql',
  'database/migrations/008_research.sql', 'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql', 'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql', 'database/migrations/015_correction_resolutions.sql',
  'database/migrations/021_publication_logs.sql', 'database/migrations/022_social_media.sql',
  'database/migrations/024_article_fingerprints.sql', 'database/migrations/025_article_deletion_audit.sql',
  'database/migrations/026_daily_publication_reservations.sql', 'database/migrations/028_youtube_analytics.sql',
  'database/migrations/029_article_fetch_runs.sql', 'database/migrations/032_article_publish_overrides.sql',
];

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSql(text)) db.exec(stmt);
  }
  // schema.sql already turns FK enforcement ON (line 18); assert it here
  // — every FK claim in this file depends on it, exactly as live D1
  // enforces FKs by default (close-out B4).
  db.exec('PRAGMA foreign_keys = ON');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'FK enforcement must be ON');
  return db;
}

// D1-compatible adapter over node:sqlite, with a transaction-backed
// batch() — the same atomicity real D1's env.DB.batch() provides: any
// statement failure rolls the whole batch back.
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
        _exec: () => stmt.run(...params),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        run: () => bound([]).run(),
      };
    },
    batch(boundStmts) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const s of boundStmts) {
          const r = s._exec();
          results.push({ success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } });
        }
        db.exec('COMMIT');
        return Promise.resolve(results);
      } catch (err) {
        db.exec('ROLLBACK');
        return Promise.reject(err);
      }
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

async function freshEnv(files = DB_FILES) {
  const db = buildDb(files);
  const env = { DB: makeRealD1(db), SESSION_SECRET: 'test-session-secret-fixpass2-item5' };
  env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
  const loginRes = await handleRequest(req('POST', '/api/auth/login', null, { email: OWNER_EMAIL, password: CORRECT_PASSWORD }), env);
  assert.equal(loginRes.status, 200, 'owner login must work');
  const token = (await loginRes.json()).token;
  return { db, env, token };
}

async function deleteArticle(env, token, id) {
  return handleRequest(req('DELETE', `/api/admin/articles/${id}`, token), env);
}

// Seed one draft (id 101 unless told otherwise) with a row in EVERY
// dependent table, so the delete must clear all of them — plus one row
// in each non-FK history table (social_posts, youtube_videos, overrides),
// which the delete must LEAVE alone.
function seedFullDraft(db, id = 101, status = 'draft') {
  db.prepare(
    "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 1, 'Deletable Draft', 'deletable-draft', 'x', 'Draft body here for deletion.', 'FS AI', ?, 0)",
  ).run(id, status);
  db.prepare("INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, 'Deletable Draft', 'x', 'Earlier body.', 'draft', 'test')").run(id);
  db.prepare("INSERT INTO article_tags (article_id, tag) VALUES (?, 'ev'), (?, 'charging')").run(id, id);
  db.prepare("INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')").run(id);
  db.prepare("INSERT INTO keywords (keyword, division_id, article_id) VALUES ('ev charging', 1, ?)").run(id);
  db.prepare("INSERT INTO affiliate_links (account_id, article_id, title, url) VALUES (1, ?, 'Test link', 'https://example.com/link')").run(id);
  const fc = db.prepare("INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (?, 'failed', 2, 0, 2)").run(id).lastInsertRowid;
  const cc1 = db.prepare("INSERT INTO claim_checks (fact_check_id, claim_text, verdict) VALUES (?, 'Claim one is wrong.', 'INCORRECT')").run(fc).lastInsertRowid;
  db.prepare("INSERT INTO claim_checks (fact_check_id, claim_text, verdict) VALUES (?, 'Claim two is unsupported.', 'UNSUPPORTED')").run(fc);
  const corr = db.prepare("INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status) VALUES (?, ?, 'Claim one is wrong.', 'Claim one, corrected.', 1, 'failed')").run(id, cc1).lastInsertRowid;
  db.prepare("INSERT INTO correction_resolutions (correction_id, article_id, resolution, previous_status, new_status) VALUES (?, ?, 'keep', 'failed', 'failed')").run(corr, id);
  db.prepare("INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, 'failed', '{}')").run(id);
  db.prepare("INSERT INTO publication_logs (article_id, action, actor) VALUES (?, 'auto-publish-refused', 'system-auto')").run(id);
  db.prepare("INSERT INTO article_fingerprints (article_id, fingerprint, body_length) VALUES (?, 'fp-deletable', 29)").run(id);
  db.prepare("INSERT INTO daily_publication_reservations (dhaka_day, article_id) VALUES ('2026-11-23', ?)").run(id);
  db.prepare("INSERT INTO article_fetch_runs (article_id, url, host, extraction_status) VALUES (?, 'https://example.com/evidence', 'example.com', 'ok')").run(id);
  db.prepare("INSERT INTO social_posts (article_id, platform, idempotency_key) VALUES (?, 'pinterest', 'item5-post-101')").run(id);
  db.prepare("INSERT INTO youtube_videos (video_key, kind, article_id, title) VALUES ('item5-video-101', 'short', ?, 'Deletable Draft short')").run(id);
  db.prepare("INSERT INTO article_publish_overrides (article_id, title, slug, division, published_by, gate_result) VALUES (?, 'Deletable Draft', 'deletable-draft', 'automotive', 'owner@example.com', '{}')").run(id);
}

function count(db, sql, params = []) {
  return db.prepare(sql).get(...params).n;
}

describe('Fix Pass 2 item 5 — delete for drafts', () => {
  it('5.1 the OLD delete fails on live-shaped data: article DELETE with fact-check/SEO rows hits FOREIGN KEY constraint failed', async () => {
    const { db } = await freshEnv();
    seedFullDraft(db);
    assert.throws(
      () => db.prepare('DELETE FROM articles WHERE id = ?').run(101),
      /FOREIGN KEY constraint failed/,
      'the pre-fix single-statement delete cannot run while NO ACTION rows exist',
    );
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 101'), 1, 'nothing was deleted');
  });

  it('5.2 deleting a draft WITH every dependent row succeeds; all dependents gone; audit row truthful', async () => {
    const { db, env, token } = await freshEnv();
    seedFullDraft(db);
    const res = await deleteArticle(env, token, 101);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 101'), 0, 'article gone');
    for (const [table, where] of [
      ['fact_checks', 'article_id = 101'],
      ['article_corrections', 'article_id = 101'], ['correction_resolutions', 'article_id = 101'],
      ['seo_checks', 'article_id = 101'], ['publication_logs', 'article_id = 101'],
      ['article_fingerprints', 'article_id = 101'], ['daily_publication_reservations', 'article_id = 101'],
      ['article_fetch_runs', 'article_id = 101'], ['article_tags', 'article_id = 101'],
      ['article_sources', 'article_id = 101'],
    ]) {
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`), 0, `${table}: no rows left for the deleted article`);
    }
    // claim_checks has no article_id column — it hangs off fact_checks,
    // so count the whole table: the seed inserts none, the fixture
    // inserted 2 for this article, both must be gone.
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM claim_checks'), 0, 'claim_checks: no rows left');
    // Revisions: ON DELETE CASCADE removes them on an FK-enforcing
    // store (live D1 behaves this way — close-out B4); the audit row
    // is the durable record of how many existed.
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = 101'), 0, 'revisions cascade away where FKs are enforced');
    const audit = db.prepare('SELECT * FROM article_deletion_audit WHERE article_id = 101').get();
    assert.ok(audit, 'an audit row was written');
    assert.equal(audit.title, 'Deletable Draft');
    assert.equal(audit.slug, 'deletable-draft');
    assert.equal(audit.status_at_delete, 'draft');
    assert.equal(audit.deleted_by, 'owner@example.com');
    assert.equal(audit.body_length, 'Draft body here for deletion.'.length);
    assert.equal(audit.revisions_kept, 1);
    // ON DELETE SET NULL: keywords / affiliate links survive, unlinked.
    assert.equal(db.prepare('SELECT article_id FROM keywords WHERE keyword = ?').get('ev charging').article_id, null);
    assert.equal(db.prepare('SELECT article_id FROM affiliate_links WHERE title = ?').get('Test link').article_id, null);
    // No-FK history rows survive with the article id intact.
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM social_posts WHERE article_id = 101'), 1, 'social distribution history is kept');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM youtube_videos WHERE article_id = 101'), 1, 'youtube history is kept');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_publish_overrides WHERE article_id = 101'), 1, 'override audit history is kept');
  });

  it('5.3 deleting a draft with NO dependent rows succeeds (no regression) and writes the audit row', async () => {
    const { db, env, token } = await freshEnv();
    db.prepare(
      "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (102, 1, 'Plain Draft', 'plain-draft', 'x', 'Plain body.', 'FS AI', 'draft', 0)",
    ).run();
    const res = await deleteArticle(env, token, 102);
    assert.equal(res.status, 200);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 102'), 0);
    const audit = db.prepare('SELECT * FROM article_deletion_audit WHERE article_id = 102').get();
    assert.ok(audit, 'audit row written');
    assert.equal(audit.revisions_kept, 0);
  });

  it('5.4 protected #26 refuses 403 — guard unchanged; nothing deleted, no audit row', async () => {
    const { db, env, token } = await freshEnv();
    seedFullDraft(db, 26);
    const res = await deleteArticle(env, token, 26);
    assert.equal(res.status, 403);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 26'), 1, 'protected article survives');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = 26'), 1, 'its fact-check rows survive');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_deletion_audit WHERE article_id = 26'), 0, 'no audit row for a refused delete');
  });

  it('5.5 an is_protected=1 draft refuses 403 — the flag guard is unchanged', async () => {
    const { db, env, token } = await freshEnv();
    db.prepare(
      "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, is_protected) VALUES (103, 1, 'Flagged Draft', 'flagged-draft', 'x', 'Flagged body.', 'FS AI', 'draft', 0, 1)",
    ).run();
    const res = await deleteArticle(env, token, 103);
    assert.equal(res.status, 403);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 103'), 1);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_deletion_audit WHERE article_id = 103'), 0);
  });

  it('5.6 legacy draft #28 deletes fine — it is NOT delete-protected (only #26/#27 + the flag are); this is the #29-discard path', async () => {
    // NOTE on the brief: it asked for #28/#33 to "still refuse". That is
    // not what the code does and not what the item is for — #28–#31/#33
    // are publish-protected (legacy list, Fix Pass 2 item 1), not
    // delete-protected (assertNotProtected covers #26/#27 + is_protected
    // only; live: all five have is_protected = 0). The owner needs #29
    // deletable (Owner Pack: DISCARD in principle), so #28 deleting
    // cleanly — with its fact-check/SEO rows — is the intended outcome,
    // and the guard is unchanged.
    const { db, env, token } = await freshEnv();
    seedFullDraft(db, 28);
    const res = await deleteArticle(env, token, 28);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 28'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = 28'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = 28'), 0);
    assert.ok(db.prepare('SELECT * FROM article_deletion_audit WHERE article_id = 28').get(), 'audit row written');
  });

  it('5.7 a delete that FAILS mid-batch rolls everything back — article + dependents survive, NO audit row (B4 ordering fix)', async () => {
    const { db, env, token } = await freshEnv();
    seedFullDraft(db);
    // Failure injection: a trigger that aborts the articles DELETE —
    // the batch has already run the dependent DELETEs by then, so only
    // true atomicity (rollback) can bring them back.
    db.exec("CREATE TRIGGER item5_fail_delete BEFORE DELETE ON articles BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END");
    try {
      const res = await deleteArticle(env, token, 101);
      assert.equal(res.status, 500, 'a failed delete answers 500, not 200');
    } finally {
      db.exec('DROP TRIGGER item5_fail_delete');
    }
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 101'), 1, 'article survives the failed delete');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = 101'), 1, 'dependent rows roll back too');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = 101'), 1);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_tags WHERE article_id = 101'), 2);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_deletion_audit WHERE article_id = 101'), 0,
      'B4: no audit row claims a deletion that did not happen');
  });

  it('5.8 d1Batch itself is atomic: a failing statement rolls back the earlier deletes', async () => {
    const { db, env } = await freshEnv();
    seedFullDraft(db);
    await assert.rejects(
      d1Batch(env, [
        { sql: 'DELETE FROM seo_checks WHERE article_id = ?', params: [101] },
        { sql: 'INSERT INTO no_such_table_xyz (id) VALUES (?)', params: [1] },
      ]),
      /no such table/i,
    );
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = 101'), 1, 'the earlier delete was rolled back');
  });

  it('5.9 deleting a nonexistent article answers 404 and writes no audit row', async () => {
    const { db, env, token } = await freshEnv();
    const res = await deleteArticle(env, token, 999);
    assert.equal(res.status, 404);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM article_deletion_audit'), 0);
  });

  it('5.10 deleting a PUBLISHED article still works (existing behaviour, unchanged) with its dependents removed', async () => {
    const { db, env, token } = await freshEnv();
    seedFullDraft(db, 104, 'published');
    const res = await deleteArticle(env, token, 104);
    assert.equal(res.status, 200);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 104'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = 104'), 0);
    assert.ok(db.prepare('SELECT * FROM article_deletion_audit WHERE article_id = 104').get());
  });

  it('5.11 a database WITHOUT the later dependent tables still deletes cleanly (partial-migration shape: backup-restore / security-boundaries)', async () => {
    // Same base set tests/backup-restore.test.js applies — no 015/021/
    // 024/026/029, so correction_resolutions, publication_logs,
    // fingerprints, reservations and fetch_runs do not exist. The probe
    // leaves them out of the batch instead of failing on "no such table".
    const partialFiles = [
      'database/schema.sql', 'database/seed.sql',
      'database/migrations/005_autonomy.sql', 'database/migrations/006_llm_usage.sql',
      'database/migrations/008_research.sql', 'database/migrations/009_factcheck.sql',
      'database/migrations/010_pipeline.sql', 'database/migrations/011_backup.sql',
      'database/migrations/012_source_links.sql', 'database/migrations/025_article_deletion_audit.sql',
    ];
    const { db, env, token } = await freshEnv(partialFiles);
    db.prepare(
      "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (105, 1, 'Partial Draft', 'partial-draft', 'x', 'Partial body.', 'FS AI', 'draft', 0)",
    ).run();
    db.prepare("INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (105, 'failed', 1, 0, 1)").run();
    db.prepare("INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (105, 'failed', '{}')").run();
    const res = await deleteArticle(env, token, 105);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM articles WHERE id = 105'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = 105'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = 105'), 0);
    assert.ok(db.prepare('SELECT * FROM article_deletion_audit WHERE article_id = 105').get(), 'audit row written');
  });

  it('5.12 d1Batch falls back to sequential runs on a binding without batch()', async () => {
    const { db, env } = await freshEnv();
    seedFullDraft(db);
    const noBatchEnv = { ...env, DB: { prepare: env.DB.prepare } };
    const results = await d1Batch(noBatchEnv, [
      { sql: 'DELETE FROM seo_checks WHERE article_id = ?', params: [101] },
      { sql: 'SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?', params: [101] },
    ]);
    assert.equal(results.length, 2);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = 101'), 0, 'fallback ran the delete');
  });
});
