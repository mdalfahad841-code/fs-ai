// FS AI — database-backed article protection tests (Fix 1, Phase 2).
//
// Migration 013 + backend/publishing/protection.js + the scheduler.js
// guard move, against a REAL SQLite database built from
// database/schema.sql + migrations 005 + 006 + database/seed.sql +
// migrations 008 + 009 + 010 + 011 + 012 via node:sqlite (same pattern
// as tests/autonomy-scheduler.test.js).
//
// NOTE (same precedent as migration 004 in autonomy-scheduler.test.js):
// database/schema.sql already contains migration 013's column
// (articles.is_protected), so migration 013 is NOT applied in the
// default freshEnv() — applying ADD COLUMN after schema.sql would fail
// with a duplicate-column error. The migration file itself is tested
// separately on a pre-013 schema (freshEnvPre013(), built from
// schema.sql with the is_protected line stripped). The live D1 database
// is unaffected — it is upgraded by the incremental migration chain.
//
// Fixtures seed THROWAWAY copies of #26/#27 with only their recorded
// values (Phase 1 report §15): #26 body 4,895 chars, seo_description
// 77 chars; #27 body 245 chars, seo_description 61 chars. No live
// data is read or written; no article content is ever modified here
// except by the code under test on the throwaway DB.
//
// Run: node --test tests/protection.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runDailyWorkflow, enqueueTask, runTask, retryTask } = require('../backend/routes/scheduler.js');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const {
  PROTECTED_TEST_ARTICLES,
  protectedExclusion,
  isProtected,
  assertNotProtected,
  taskModifiesArticle,
  assertTaskNotProtected,
} = require('../backend/publishing/protection.js');

const ROOT = path.join(__dirname, '..');

// Split a SQL file into statements (copied from tests/real-db.test.js).
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

function execFile(db, file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const stmt of splitSql(text)) db.exec(stmt);
}

function execSqlText(db, text) {
  for (const stmt of splitSql(text)) db.exec(stmt);
}

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) execFile(db, file);
  return db;
}

// Minimal D1-compatible adapter over node:sqlite (copied from
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
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        run: () => bound([]).run(),
      };
    },
  };
}

const MIGRATION_FILES = [
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql',
];

// Fresh real DB: schema.sql (already includes articles.is_protected
// from migration 013) + autonomy migrations + seed + 008-012.
// Migration 013 itself is deliberately NOT applied (see header note).
function freshEnv() {
  const db = buildDb(['database/schema.sql', ...MIGRATION_FILES]);
  return { db, env: { DB: makeRealD1(db) } };
}

// Pre-013 DB: schema.sql with the is_protected line stripped, so the
// column does not exist until migration 013 is applied to it.
function freshEnvPre013() {
  const db = new DatabaseSync(':memory:');
  const schema = fs.readFileSync(path.join(ROOT, 'database/schema.sql'), 'utf8');
  const stripped = schema.replace(
    / *is_protected\s+INTEGER NOT NULL DEFAULT 0 CHECK \(is_protected IN \(0, 1\)\),.*\n/,
    '',
  );
  assert.ok(!stripped.includes('is_protected'), 'pre-013 schema has no is_protected line');
  assert.ok(stripped.length < schema.length, 'pre-013 schema actually stripped the line');
  execSqlText(db, stripped);
  for (const file of MIGRATION_FILES) execFile(db, file);
  return { db, env: { DB: makeRealD1(db) } };
}

// Recorded live values (Phase 1 report §15) — throwaway copies only.
const SEO_26 = 'A plain-language guide: How Artificial Intelligence Is Changing Everyday Life';
const SEO_27 = 'A plain-language guide: Tesla Cybercab Factory at Giga Berlin';
const BODY_26 = ('Artificial intelligence is changing everyday life, from the way we work to the way we learn and communicate. ').repeat(100).slice(0, 4895);
const BODY_27 = ('The Tesla Cybercab factory deal brings new battery production to the United States. '.repeat(4)).slice(0, 245);
// Long plain-text body (no internal link, no headings) that the SEO
// repair would rewrite if the article were not protected.
const BODY_28 =
  'Protected test article number 28 has a plain body about the topic, with enough words to derive a meta description from the article text itself. ' +
  'A second sentence adds more real content here for the description. A third sentence keeps the text long enough to repair.';

function insertDraftWithId(db, id, title, slug, body, seoDescription) {
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, published_at, publish_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?)',
  ).run(id, divisionId, title, slug, 'Excerpt.', body, 'FS AI', 'draft', seoDescription, null);
  return id;
}

// Seeds #26/#27 (recorded values) + #28, then applies migration 013's
// data step (flags #26/#27) the way the live upgrade does.
function seedProtectedDrafts(db) {
  insertDraftWithId(db, 26, 'How Artificial Intelligence Is Changing Everyday Life', 'guard-test-26', BODY_26, SEO_26);
  insertDraftWithId(db, 27, 'Tesla Cybercab Factory at Giga Berlin', 'guard-test-27', BODY_27, SEO_27);
  insertDraftWithId(db, 28, 'Guard Test Article 28', 'guard-test-28', BODY_28, null);
  db.prepare('UPDATE articles SET is_protected = 1 WHERE id IN (26, 27)').run();
}

function setFlag(db, key, value) {
  db.prepare(
    "INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function seedFailedFactCheck(db, articleId) {
  const now = new Date().toISOString();
  const fc = db.prepare(
    "INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, created_at) VALUES (?, 'needs-review', 1, 0, 1, ?)",
  ).run(articleId, now);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url) VALUES (?, ?, 'UNSUPPORTED', NULL)",
  ).run(Number(fc.lastInsertRowid), 'The test article claims one unsupported thing about the topic.');
}

function stepResults(db, agent, stepName) {
  const rows = db.prepare('SELECT detail FROM agent_runs WHERE agent = ?').all(agent);
  for (const r of rows) {
    try {
      const detail = JSON.parse(r.detail || '{}');
      if (detail.step === stepName) return detail.results || [];
    } catch { /* not JSON — ignore */ }
  }
  return null;
}

describe('migration 013', () => {
  it('applies cleanly on a pre-013 DB and flags only #26/#27, changing no content', async () => {
    const { db } = freshEnvPre013();
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('articles') WHERE name = 'is_protected'").get().n,
      0, 'column absent before the migration');
    insertDraftWithId(db, 26, 'How Artificial Intelligence Is Changing Everyday Life', 'guard-test-26', BODY_26, SEO_26);
    insertDraftWithId(db, 27, 'Tesla Cybercab Factory at Giga Berlin', 'guard-test-27', BODY_27, SEO_27);
    insertDraftWithId(db, 28, 'Guard Test Article 28', 'guard-test-28', BODY_28, null);
    const before = {};
    for (const id of [26, 27, 28]) {
      before[id] = db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(id);
    }

    const sql = fs.readFileSync(path.join(ROOT, 'database/migrations/013_article_protection.sql'), 'utf8');
    for (const stmt of splitSql(sql)) db.exec(stmt);

    const cols = db.prepare("SELECT name FROM pragma_table_info('articles') WHERE name = 'is_protected'").all();
    assert.equal(cols.length, 1, 'is_protected column exists after the migration');
    const col = db.prepare("SELECT * FROM pragma_table_info('articles') WHERE name = 'is_protected'").get();
    assert.equal(col.dflt_value, '0', 'default is 0');
    assert.equal(col.notnull, 1, 'column is NOT NULL');
    for (const id of [26, 27]) {
      assert.equal(db.prepare('SELECT is_protected FROM articles WHERE id = ?').get(id).is_protected, 1,
        `flag is 1 for protected article #${id}`);
    }
    assert.equal(db.prepare('SELECT is_protected FROM articles WHERE id = 28').get().is_protected, 0,
      'flag is 0 for unprotected article #28');
    assert.equal(db.prepare('SELECT is_protected FROM articles WHERE id = 1').get().is_protected, 0,
      'flag is 0 for a seeded published article');
    for (const id of [26, 27, 28]) {
      assert.deepEqual(
        db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(id),
        before[id], `migration changed no content for article #${id}`);
    }
  });

  it('the console chunk is plain SQL (no comments) and matches the migration statements', () => {
    const chunk = fs.readFileSync(path.join(ROOT, 'database/console-chunks/migration-013_article_protection.sql'), 'utf8');
    assert.ok(!chunk.includes('--'), 'console chunk has no comments');
    assert.ok(chunk.includes('ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;'),
      'console chunk has the ADD COLUMN statement');
    assert.ok(chunk.includes('UPDATE articles SET is_protected = 1 WHERE id IN (26, 27);'),
      'console chunk has the flag UPDATE');
    // The chunk must apply cleanly on a pre-013 DB too.
    const { db } = freshEnvPre013();
    for (const stmt of splitSql(chunk)) db.exec(stmt);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('articles') WHERE name = 'is_protected'").get().n, 1,
      'console chunk creates the column');
  });

  it('re-running ADD COLUMN fails honestly (SQLite has no IF NOT EXISTS for ADD COLUMN)', () => {
    const { db } = freshEnvPre013();
    db.exec('ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;');
    assert.throws(
      () => db.exec('ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;'),
      /duplicate column/i,
      'second ADD COLUMN errors instead of silently passing — apply once only');
  });
});

describe('protection.js contract', () => {
  it('PROTECTED_TEST_ARTICLES is exactly [26, 27] (module and scheduler re-export)', () => {
    assert.deepEqual([...PROTECTED_TEST_ARTICLES].sort((a, b) => a - b), [26, 27]);
    const scheduler = require('../backend/routes/scheduler.js');
    assert.deepEqual([...scheduler.PROTECTED_TEST_ARTICLES].sort((a, b) => a - b), [26, 27],
      'scheduler.js still re-exports the list for existing callers');
  });

  it('protectedExclusion returns the exact clause + params for a column', () => {
    assert.deepEqual(protectedExclusion('id'), { clause: 'id NOT IN (?, ?)', params: [26, 27] });
    assert.deepEqual(protectedExclusion('fc.article_id'),
      { clause: 'fc.article_id NOT IN (?, ?)', params: [26, 27] });
  });

  it('isProtected is true for #26/#27 via the DB flag, and false for unprotected drafts', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    assert.equal(await isProtected(env, 26), true, '#26 protected via flag');
    assert.equal(await isProtected(env, 27), true, '#27 protected via flag');
    assert.equal(await isProtected(env, 28), false, '#28 not protected');
    assert.equal(await isProtected(env, 999), false, 'missing article id is not protected');
  });

  it('isProtected honours the flag for an id outside the constant list', async () => {
    const { db, env } = freshEnv();
    insertDraftWithId(db, 30, 'Flagged Article 30', 'guard-test-30', BODY_28, null);
    insertDraftWithId(db, 31, 'Unflagged Article 31', 'guard-test-31', BODY_28, null);
    db.prepare('UPDATE articles SET is_protected = 1 WHERE id = 30').run();
    assert.equal(await isProtected(env, 30), true, '#30 protected by flag alone (not in constant)');
    assert.equal(await isProtected(env, 31), false, '#31 flag 0, not in constant');
  });

  it('isProtected falls back to the constant when the column does not exist yet', async () => {
    const { db, env } = freshEnvPre013();
    // Insert the drafts WITHOUT the flag UPDATE (the column does not
    // exist, so the UPDATE itself would throw) — the constant alone
    // must protect #26/#27 here.
    insertDraftWithId(db, 26, 'How Artificial Intelligence Is Changing Everyday Life', 'guard-test-26', BODY_26, SEO_26);
    insertDraftWithId(db, 27, 'Tesla Cybercab Factory at Giga Berlin', 'guard-test-27', BODY_27, SEO_27);
    insertDraftWithId(db, 28, 'Guard Test Article 28', 'guard-test-28', BODY_28, null);
    assert.equal(await isProtected(env, 26), true, '#26 protected by constant with no column');
    assert.equal(await isProtected(env, 27), true, '#27 protected by constant with no column');
    assert.equal(await isProtected(env, 28), false, '#28 not protected by constant with no column');
  });

  it('isProtected never throws: no DB bound, bad ids', async () => {
    assert.equal(await isProtected({}, 26), true, 'no DB: constant still protects #26');
    assert.equal(await isProtected({}, 28), false, 'no DB: #28 not protected');
    assert.equal(await isProtected(null, 26), true, 'null env: constant still protects #26');
    assert.equal(await isProtected({ DB: null }, 27), true, 'null DB: constant still protects #27');
    assert.equal(await isProtected({}, 'abc'), false, 'non-numeric id is not protected');
    assert.equal(await isProtected({}, 0), false, 'id 0 is not protected');
  });

  it('assertNotProtected refuses protected articles with the exact reason, allows others', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    assert.deepEqual(await assertNotProtected(env, 26),
      { ok: false, reason: 'Article #26 is protected — automatic modification disabled.' });
    assert.deepEqual(await assertNotProtected(env, 27),
      { ok: false, reason: 'Article #27 is protected — automatic modification disabled.' });
    assert.deepEqual(await assertNotProtected(env, 28), { ok: true });
    // Refusal works even before migration 013 (constant fallback).
    const pre = freshEnvPre013();
    insertDraftWithId(pre.db, 26, 'How Artificial Intelligence Is Changing Everyday Life', 'guard-test-26', BODY_26, SEO_26);
    assert.deepEqual(await assertNotProtected(pre.env, 26),
      { ok: false, reason: 'Article #26 is protected — automatic modification disabled.' });
  });
});

describe('daily workflow with DB-backed protection', () => {
  it('seoRun skips flagged #26/#27 (recorded values byte-identical, no seo_checks, no revisions) and repairs #28', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    // Fixture sanity: the throwaway copies carry the recorded values.
    assert.equal(BODY_26.length, 4895, '#26 body is 4,895 chars');
    assert.equal(SEO_26.length, 77, '#26 seo_description is 77 chars');
    assert.equal(BODY_27.length, 245, '#27 body is 245 chars');
    assert.equal(SEO_27.length, 61, '#27 seo_description is 61 chars');
    const before = {};
    for (const id of [26, 27, 28]) {
      before[id] = db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(id);
    }

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.seoRun, 1, 'seoRun checked exactly one draft (the unprotected one)');

    const seoResults = stepResults(db, 'seo', 'seo-run');
    assert.ok(seoResults, 'the seo-run step recorded its results');
    assert.deepEqual(seoResults.map((r) => r.articleId), [28], 'only #28 was selected for SEO');

    for (const id of [26, 27]) {
      const after = db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(id);
      assert.deepEqual(after, before[id], `protected article #${id} is byte-identical after the daily run`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?').get(id).n, 0,
        `no seo_checks row was written for protected article #${id}`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0,
        `no revision row was written for protected article #${id}`);
    }

    const after28 = db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(28);
    // Relevance fix (2026-11-21): #28 has no topically relevant published
    // sibling, so the repair must NOT append a Related reading link — a
    // link must never be faked to satisfy the SEO check. The meta
    // description repair below is the real repair for #28.
    assert.ok(!after28.body.includes('Related reading:'), '#28 gets NO Related reading link — no published sibling is genuinely relevant');
    assert.ok(after28.seo_description && after28.seo_description.length >= 120 && after28.seo_description.length <= 160,
      '#28 meta description was repaired into 120-160 characters');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = 28').get().n, 1,
      'one seo_checks row was written for #28');
  });

  it('correctionRun skips flagged #26/#27 (no correction rows, bodies unchanged) and processes #28', async () => {
    const { db, env } = freshEnv();
    setFlag(db, 'auto_correction', 'on');
    seedProtectedDrafts(db);
    for (const id of [26, 27, 28]) seedFailedFactCheck(db, id);
    const before = {};
    for (const id of [26, 27]) {
      before[id] = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    }

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.correctionsRun, 1, 'correctionRun processed exactly one article');

    const corrResults = stepResults(db, 'fact-checking', 'correction-run');
    assert.ok(corrResults, 'the correction-run step recorded its results');
    assert.deepEqual(corrResults.map((r) => r.articleId), [28], 'only #28 was selected for correction');

    for (const id of [26, 27]) {
      assert.equal(
        db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, before[id],
        `protected article #${id} body is unchanged after the daily run`);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM article_corrections WHERE article_id = ?').get(id).n, 0,
        `no correction rows were written for protected article #${id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Manual task entry points must not bypass protection (integration wiring).
// Creation refuses, run refuses before any status change, retry refuses
// before re-queueing. Read-only task kinds stay allowed.
// ---------------------------------------------------------------------------
describe('manual task protection (create / run / retry)', () => {
  function autonomyReq(method, pathName, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (body !== undefined) {
      return new Request(`http://localhost${pathName}`, { method, headers, body: JSON.stringify(body) });
    }
    return new Request(`http://localhost${pathName}`, { method, headers });
  }

  async function callAutonomy(env, method, pathName, body) {
    const res = await handleAutonomy(autonomyReq(method, pathName, body), env, {}, null);
    return { status: res.status, body: await res.json() };
  }

  it('taskModifiesArticle: seo (any kind) and fact-checking/correct modify; fact-check, content-creation, publishing do not', () => {
    assert.equal(taskModifiesArticle('seo', 'seo-pass'), true);
    assert.equal(taskModifiesArticle('seo', 'anything-else'), true);
    assert.equal(taskModifiesArticle('fact-checking', 'correct'), true);
    assert.equal(taskModifiesArticle('fact-checking', 'fact-check'), false);
    assert.equal(taskModifiesArticle('content-creation', 'article-draft'), false);
    assert.equal(taskModifiesArticle('publishing', 'publish'), false);
    assert.equal(taskModifiesArticle('research', 'fetch'), false);
  });

  it('creating an seo task for protected #26 is refused (403) and creates no task', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'seo', kind: 'seo-pass', payload: { article_id: 26 },
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.protected, true);
    assert.match(res.body.error, /protected/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 0);
  });

  it('creating a correction task for protected #27 is refused (403); a fact-check task for #26 is allowed', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    const refused = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'fact-checking', kind: 'correct', payload: { article_id: 27 },
    });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.protected, true);
    const allowed = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 26 },
    });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
    assert.equal(allowed.body.duplicate, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1);
  });

  it('creating an seo task for unprotected #28 is allowed', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    const res = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      agent: 'seo', kind: 'seo-pass', payload: { article_id: 28 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it('running a queued seo task for protected #26 is refused (403) and the task stays queued', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    const created = await enqueueTask(env, {
      agent: 'seo', kind: 'seo-pass', payload: { article_id: 26 },
      idempotency_key: 'guard-run-26',
    });
    assert.equal(created.ok, true);
    const result = await runTask(env, created.task.id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.protected, true);
    assert.match(result.error, /protected/);
    assert.equal(
      db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(created.task.id).status, 'queued',
      'a refused run changes no task status');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n, 0, 'a refused run writes no run row');
  });

  it('retrying a failed correction task for protected #27 is refused (403) and the task stays failed', async () => {
    const { db, env } = freshEnv();
    seedProtectedDrafts(db);
    const created = await enqueueTask(env, {
      agent: 'fact-checking', kind: 'correct', payload: { article_id: 27 },
      idempotency_key: 'guard-retry-27',
    });
    assert.equal(created.ok, true);
    db.prepare("UPDATE agent_tasks SET status = 'failed' WHERE id = ?").run(created.task.id);
    const result = await retryTask(env, created.task.id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.protected, true);
    assert.equal(
      db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(created.task.id).status, 'failed',
      'a refused retry leaves the task failed');
  });

  it('assertTaskNotProtected accepts non-modifying tasks and tasks without an article_id', async () => {
    const { env } = freshEnv();
    assert.deepEqual(await assertTaskNotProtected(env, { agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 26 } }), { ok: true });
    assert.deepEqual(await assertTaskNotProtected(env, { agent: 'seo', kind: 'seo-pass', payload: {} }), { ok: true });
    assert.deepEqual(await assertTaskNotProtected(env, { agent: 'seo', kind: 'seo-pass', payload: '{"article_id":26}' }), { ok: false, reason: 'Article #26 is protected — automatic modification disabled.', protected: true });
  });
});
