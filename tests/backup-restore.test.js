// FS AI — Backup -> restore round-trip test (local SQLite only).
//
// The backup export (GET /api/admin/backup) is JSON, not a D1-native
// backup, so the restore is a script: scripts/restore-backup.js replays the
// export into a fresh database built from database/schema.sql +
// database/seed.sql. This test proves the cycle end to end against a real
// SQLite database, with simulated live activity (new article, edit +
// revision, replaced tags, subscriber, agent run, a deleted article whose
// revision survives as an orphan — the D1 behaviour noted in
// backend/routes/admin-articles.js).
//
// It also pins the two ways the previously documented procedure failed:
//   * applying migration 004 after schema.sql fails (duplicate column
//     publish_at — schema.sql already contains it), and
//   * plain INSERTs of exported rows fail (UNIQUE constraint: the seed
//     already holds the same ids).
// And it pins why the restore deletes stale rows first: an upsert-only
// replay resurrects tags a CMS edit had replaced (54 rows vs 52 backed up).
//
// Run: node --test tests/backup-restore.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
// Never touches Cloudflare or the live D1 database.
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleRequest } = require('../src/index.js');
const { hashPassword } = require('../backend/security/crypto.js');
const {
  RESTORE_ORDER, splitSqlStatements, applySchemaAndSeed, restoreBackup, buildRestoreSql,
} = require('../scripts/restore-backup.js');

const ROOT = path.join(__dirname, '..');
const OWNER_EMAIL = 'owner@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';

const BACKUP_TABLES = [...RESTORE_ORDER];

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSqlStatements(text)) db.exec(stmt);
  }
  return db;
}

// Minimal D1-compatible adapter over node:sqlite (same shape as
// tests/real-db.test.js).
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

function req(method, pathName, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    return new Request(`http://localhost${pathName}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`http://localhost${pathName}`, { method, headers });
}

function dumpTable(db, table) {
  return db.prepare(`SELECT * FROM "${table}" ORDER BY id ASC`).all();
}

describe('backup -> restore round-trip (local SQLite)', () => {
  let origDb;
  let origEnv;
  let token;
  let backup;
  let origRows;

  before(async () => {
    origDb = buildDb(['database/schema.sql', 'database/seed.sql']);
    // schema.sql turns FK enforcement ON for this connection; D1 does not
    // enforce ON DELETE CASCADE (see deleteArticle), so switch it OFF to
    // mimic the live database faithfully.
    origDb.exec('PRAGMA foreign_keys = OFF');
    origEnv = { DB: makeRealD1(origDb), SESSION_SECRET: 'test-secret-backup-restore' };
    origEnv.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    const loginRes = await handleRequest(req('POST', '/api/auth/login', null, { email: OWNER_EMAIL, password: CORRECT_PASSWORD }), origEnv);
    assert.equal(loginRes.status, 200, 'owner login must work against the orig DB');
    token = (await loginRes.json()).token;

    // Live activity 1: a new published article (id 26).
    const created = await handleRequest(req('POST', '/api/admin/articles', token, {
      title: 'Backup Restore Test Article',
      body: 'Body with a semicolon; and an apostrophe\'s quote, plus "double quotes".',
      division: 'automotive', status: 'published', tags: ['backup', 'restore-test'],
    }), origEnv);
    assert.equal(created.status, 201, 'creating the live article must succeed');

    // Live activity 2: edit seeded article 1 — stores a revision and
    // REPLACES its seed tags (the stale rows the restore must not revive).
    const edited = await handleRequest(req('PUT', '/api/admin/articles/1', token, {
      title: 'EV Charging at Home: UPDATED Title', body: 'Updated body; with semicolon.',
      division: 'automotive', status: 'published', tags: ['ev', 'home'],
    }), origEnv);
    assert.equal(edited.status, 200, 'editing article 1 must succeed');

    // Live activity 3: subscriber, agent run, emergency-stop setting.
    assert.equal((await handleRequest(req('POST', '/api/newsletter/subscribe', null, { email: 'backup-test@example.com', consent: true }), origEnv)).status, 201);
    assert.equal((await handleRequest(req('POST', '/api/agents/seo/run', token), origEnv)).status, 200);
    await handleRequest(req('POST', '/api/admin/emergency-stop', token, { stopped: true }), origEnv);
    await handleRequest(req('POST', '/api/admin/emergency-stop', token, { stopped: false }), origEnv);

    // Live activity 4: rows with no owner route (category, revenue, job).
    origDb.exec(`INSERT INTO categories (division_id, name, slug, sort_order) VALUES (1, 'Live Category', 'live-category', 99)`);
    origDb.exec(`INSERT INTO revenue_records (account_id, source, amount, currency, recorded_date, notes) VALUES (1, 'ads', 0.00, 'USD', '2026-11-13', 'zero-revenue row')`);
    origDb.exec(`INSERT INTO automation_jobs (name, job_type, agent_id, division_id, status) VALUES ('Backup cycle job', 'research', 2, 1, 'completed')`);

    // Live activity 5: create + edit + delete an article. On live D1 the
    // revision survives the delete as an orphan; the backup carries it.
    const doomed = await handleRequest(req('POST', '/api/admin/articles', token, {
      title: 'Doomed Article', body: 'Will be deleted.', division: 'automotive', status: 'published',
    }), origEnv);
    assert.equal(doomed.status, 201);
    const doomedId = (await doomed.json()).article.id;
    assert.equal((await handleRequest(req('PUT', `/api/admin/articles/${doomedId}`, token, {
      title: 'Doomed Article Edited', body: 'Edited before delete.', division: 'automotive', status: 'published',
    }), origEnv)).status, 200);
    assert.equal((await handleRequest(req('DELETE', `/api/admin/articles/${doomedId}`, token), origEnv)).status, 200);
    assert.equal(
      origDb.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(doomedId).n,
      1, 'D1 behaviour: the revision of a deleted article survives as an orphan');

    const backupRes = await handleRequest(req('GET', '/api/admin/backup', token), origEnv);
    assert.equal(backupRes.status, 200, 'backup export must succeed');
    backup = await backupRes.json();
    origRows = {};
    for (const t of BACKUP_TABLES) origRows[t] = dumpTable(origDb, t);
  });

  it('backup export counts match the live database', () => {
    assert.deepEqual(backup.warnings, []);
    for (const t of BACKUP_TABLES) {
      assert.equal(backup.counts[t], origRows[t].length, `backup count for ${t}`);
    }
    assert.equal(backup.counts.articles, 26, '25 seed + 1 live article; the deleted one stays deleted');
    assert.equal(backup.counts.article_revisions, 2, 'edit revision + orphan revision of the deleted article');
    assert.equal(backup.counts.article_tags, 52, 'seed tags minus replaced ones, plus the new article tags');
    assert.equal(backup.counts.website_settings, 9, '8 seed settings + emergency_stop');
  });

  it('the old documented procedure fails: migration 004 after schema.sql', () => {
    const db = buildDb(['database/schema.sql', 'database/seed.sql']);
    assert.throws(
      () => {
        const text = fs.readFileSync(path.join(ROOT, 'database/console-chunks/migration-004-cms-newsletter.sql'), 'utf8');
        for (const stmt of splitSqlStatements(text)) db.exec(stmt);
      },
      /duplicate column name: publish_at/,
      'schema.sql already contains migration 004; do not re-apply it on recovery');
  });

  it('the old documented procedure fails: plain INSERTs of exported rows', () => {
    const db = buildDb(['database/schema.sql', 'database/seed.sql']);
    const esc = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
    // A seeded row (id 1), not the newest live row: the seed holds it, so
    // the plain INSERT must conflict on its PRIMARY KEY.
    const row = backup.tables.articles.find((r) => r.id === 1);
    const cols = Object.keys(row);
    assert.throws(
      () => db.exec(`INSERT INTO "articles" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => esc(row[c])).join(', ')})`),
      /UNIQUE constraint failed/,
      'the seed already holds the same ids, so plain INSERT conflicts');
  });

  it('restore round-trip: all 11 tables deep-equal to the original', () => {
    const fresh = new DatabaseSync(':memory:');
    applySchemaAndSeed(fresh);
    const { counts, fkViolations } = restoreBackup(fresh, backup);
    for (const t of BACKUP_TABLES) {
      assert.equal(counts[t], origRows[t].length, `restored count for ${t}`);
      assert.deepEqual(dumpTable(fresh, t), origRows[t], `${t} rows must match the original exactly`);
    }
    // The one orphan the live database holds is reproduced, and reported.
    assert.equal(fkViolations.length, 1, 'exactly one orphan: the revision of the deleted article');
    assert.equal(fkViolations[0].table, 'article_revisions');
    // Tables the backup does not cover stay exactly as the seed leaves them.
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM agent_permissions').get().n, 42, 'seed agent_permissions survive the upsert restore');
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM digital_tools').get().n, 20);
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM monetization_accounts').get().n, 10);
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM website_analytics').get().n, 1);
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0, 'sessions are NOT restored — the owner signs in fresh');
  });

  it('restore is idempotent: a second run changes nothing', () => {
    const fresh = new DatabaseSync(':memory:');
    applySchemaAndSeed(fresh);
    restoreBackup(fresh, backup);
    restoreBackup(fresh, backup);
    for (const t of BACKUP_TABLES) {
      assert.deepEqual(dumpTable(fresh, t), origRows[t], `${t} still exact after a second restore`);
    }
  });

  it('an upsert-only replay would resurrect the replaced tags', () => {
    const fresh = new DatabaseSync(':memory:');
    applySchemaAndSeed(fresh);
    const { sql } = buildRestoreSql(backup);
    const upsertsOnly = sql.split('\n').filter((line) => line.startsWith('INSERT INTO')).join('\n');
    fresh.exec('PRAGMA foreign_keys = OFF');
    fresh.exec(upsertsOnly);
    assert.equal(
      fresh.prepare('SELECT COUNT(*) AS n FROM article_tags').get().n, 54,
      'without the stale-row DELETE, the two seed tags the CMS edit replaced come back from the seed');
  });

  it('generated SQL is upserts, never INSERT OR REPLACE', () => {
    const { sql } = buildRestoreSql(backup);
    assert.match(sql, /ON CONFLICT\("id"\) DO UPDATE SET/);
    assert.doesNotMatch(sql, /INSERT OR REPLACE/i);
    assert.match(sql, /DELETE FROM "article_tags" WHERE "id" NOT IN/);
    assert.match(sql, /PRAGMA foreign_keys = OFF;/);
  });

  it('the restored database serves the site', async () => {
    const fresh = new DatabaseSync(':memory:');
    applySchemaAndSeed(fresh);
    restoreBackup(fresh, backup);
    const env = { DB: makeRealD1(fresh), SESSION_SECRET: 'test-secret-backup-restore' };
    env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    const loginRes = await handleRequest(req('POST', '/api/auth/login', null, { email: OWNER_EMAIL, password: CORRECT_PASSWORD }), env);
    assert.equal(loginRes.status, 200, 'owner login works against the restored DB');
    const restoredToken = (await loginRes.json()).token;

    const health = await handleRequest(req('GET', '/api/health'), env);
    assert.equal((await health.json()).db, 'connected');

    // AUTOINCREMENT continues past the backup's max article id (26);
    // the deleted id 27 was never in the backup, so it is correctly reused.
    const created = await handleRequest(req('POST', '/api/admin/articles', restoredToken, {
      title: 'Post Restore Article', body: 'After restore.', division: 'automotive', status: 'published',
    }), env);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).article.id, 27);

    // Public list defaults to limit=25 and total is the page size.
    const list = await handleRequest(req('GET', '/api/articles?limit=100'), env);
    assert.equal((await list.json()).total, 27, '25 seed + 1 live + 1 created after restore');
    const edited1 = await handleRequest(req('GET', '/api/articles/ev-charging-at-home-complete-beginners-guide'), env);
    assert.equal(edited1.status, 200, 'edited article 1 visible under its original slug');
    assert.equal((await edited1.json()).article.title, 'EV Charging at Home: UPDATED Title');
    assert.equal((await (await handleRequest(req('GET', '/api/tools'), env)).json()).total, 20);
    assert.equal((await (await handleRequest(req('GET', '/api/accounts'), env)).json()).total, 10);
  });
});
