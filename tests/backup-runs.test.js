// FS AI — backup + recovery tests (master implementation, 2026-11-19).
//
// runBackupExport() records every run in backup_runs (migration 011),
// so the dashboard shows the last successful backup instead of
// 'unknown'. POST /api/admin/backup/run returns the summary (not the
// full dump). The full dump (GET /api/admin/backup) restores into a
// throwaway local SQLite database via scripts/restore-backup.js —
// production is never touched.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011/012).
// Run: node --test tests/backup-runs.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runBackupExport, handleAdmin } = require('../backend/routes/admin.js');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const { restoreBackup, applySchemaAndSeed, RESTORE_ORDER } = require('../scripts/restore-backup.js');

const ROOT = path.join(__dirname, '..');

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

const FULL_FILES = [
  'database/schema.sql',
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
];

function freshEnv(files = FULL_FILES) {
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

function req(method, path, body) {
  return new Request(`https://fs-ai.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('runBackupExport', () => {
  it('exports all 25 tables and records a successful run', async () => {
    const { db, env } = freshEnv();
    const r = await runBackupExport(env);
    assert.equal(r.ok, true);
    assert.equal(r.status, 'success');
    assert.equal(r.tablesExported, 25);
    assert.ok(r.rowsExported > 100, `expected many rows, got ${r.rowsExported}`);
    assert.ok(r.bytesExported > 10000);
    assert.ok(r.backupRunId, 'run id returned');
    assert.deepEqual(r.warnings, []);
    const row = db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(r.backupRunId);
    assert.equal(row.status, 'success');
    assert.equal(row.tables_exported, 25);
    assert.equal(row.rows_exported, r.rowsExported);
    assert.equal(row.bytes_exported, r.bytesExported);
    assert.ok(row.finished_at);
    assert.equal(row.error, null);
  });

  it('a second run records a second row — history is kept, not overwritten', async () => {
    const { db, env } = freshEnv();
    const first = await runBackupExport(env);
    const second = await runBackupExport(env);
    assert.notEqual(second.backupRunId, first.backupRunId);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'success'").get().n, 2);
  });

  it('without migration 011 the export still succeeds but warns it was not recorded', async () => {
    const { env } = freshEnv(FULL_FILES.filter((f) => !f.includes('011_backup')));
    const r = await runBackupExport(env);
    assert.equal(r.ok, true, 'export itself must not fail on a pre-011 database');
    assert.equal(r.backupRunId, null);
    assert.ok(r.warnings.some((w) => w.includes('migration 011')), JSON.stringify(r.warnings));
  });

  it('RESTORE_ORDER covers exactly the 25 backed-up tables, parents first', () => {
    assert.equal(RESTORE_ORDER.length, 25);
    assert.ok(RESTORE_ORDER.indexOf('business_divisions') < RESTORE_ORDER.indexOf('articles'));
    assert.ok(RESTORE_ORDER.indexOf('articles') < RESTORE_ORDER.indexOf('fact_checks'));
    assert.ok(RESTORE_ORDER.indexOf('fact_checks') < RESTORE_ORDER.indexOf('claim_checks'));
  });
});

describe('backup routes', () => {
  it('POST /api/admin/backup/run returns the summary and records the run', async () => {
    const { db, env } = freshEnv();
    const res = await handleAdmin(req('POST', '/api/admin/backup/run'), env, {}, { owner: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'success');
    assert.equal(body.tablesExported, 25);
    assert.equal(body.source, 'd1');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'success'").get().n, 1);
  });

  it('GET /api/autonomy/status reports lastBackup null before any run, then the real run', async () => {
    const { db, env } = freshEnv();
    const before = await handleAutonomy(req('GET', '/api/autonomy/status'), env, {}, { owner: true });
    const beforeBody = await before.json();
    assert.equal(beforeBody.lastBackup, null, 'no backup yet — honestly null, not "unknown"');
    await runBackupExport(env);
    const after = await handleAutonomy(req('GET', '/api/autonomy/status'), env, {}, { owner: true });
    const afterBody = await after.json();
    assert.ok(afterBody.lastBackup, 'last backup now recorded');
    assert.ok(afterBody.lastBackup.finishedAt);
    assert.equal(afterBody.lastBackup.tablesExported, 25);
    assert.ok(afterBody.lastBackup.rowsExported > 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'success'").get().n, 1);
  });
});

describe('backup restore round-trip (throwaway local DB only)', () => {
  it('the live dump restores into a fresh DB with the same articles, sources and settings', async () => {
    const { env } = freshEnv();
    const res = await handleAdmin(req('GET', '/api/admin/backup'), env, {}, { owner: true });
    assert.equal(res.status, 200);
    const dump = await res.json();
    assert.equal(dump.ok, true);
    assert.equal(Object.keys(dump.tables).length, 25);
    assert.equal(dump.tables.articles.length, 25);
    assert.equal(dump.tables.research_sources.length, 24);

    const fresh = new DatabaseSync(':memory:');
    applySchemaAndSeed(fresh);
    restoreBackup(fresh, { tables: dump.tables });
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25, 'all 25 articles restored');
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM research_sources').get().n, 24, 'all 24 sources restored');
    assert.equal(fresh.prepare("SELECT value FROM autonomy_settings WHERE key = 'auto_publishing'").get().value, 'off');
    assert.equal(fresh.prepare("SELECT value FROM autonomy_settings WHERE key = 'publishing_mode'").get().value, 'approved_only');
    const titles = fresh.prepare('SELECT title FROM articles ORDER BY id LIMIT 3').all().map((r) => r.title);
    assert.ok(titles[0] && titles[0].length > 0, 'article content restored, not just counts');
  });
});
