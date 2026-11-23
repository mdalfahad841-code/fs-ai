// FS AI — Fix Pass 3 A1: every publish path is gated (2026-11-23).
//
// Owner decision YES: POST /api/admin/articles/:id/publish is the
// ONLY manual publish path (publish gate + audited override phrase,
// Fix Pass 2 item 1). Creating with status 'published', or PUT-ing a
// draft/approved/pending article to 'published', is now refused 422
// with a pointer to POST /publish — nothing is written: no row, no
// status change, no revision, no audit row. A PUT that KEEPS an
// already-published article published, or moves it back to draft, is
// not a transition and still works; creating as a draft still works.
// The dashboard's status dropdown no longer offers Published as a
// selectable option (it stays, disabled, so editing an already-
// published article still shows its status).
//
// The authorised autonomous paths (publishDueArticles, the
// auto-publish agent) are NOT routes and keep their own gates —
// they are untouched here and pinned in their own suites.
//
// Real SQLite databases (schema + seed + migrations 005/006/008/009/
// 010/011/012/017/019/023/032). Fixture articles only, explicit ids
// 26/28 for the protected/legacy cases — never a live article. No
// network, no live D1. Run: node --test tests/fixpass3-a1.test.js
// (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAdminArticles } = require('../backend/routes/admin-articles.js');
const { MANUAL_PUBLISH_OVERRIDE_PHRASE } = require('../backend/publishing/gate.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');

const ROOT = path.join(__dirname, '..');
const AUTH = { ok: true, owner: 'test-owner@example.com' };
const PHRASE = MANUAL_PUBLISH_OVERRIDE_PHRASE;

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

const FILES = [
  'database/schema.sql',
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql',
  'database/migrations/017_correction_claim_key.sql',
  'database/migrations/019_factcheck_body_hash.sql',
  'database/migrations/023_seo_body_hash.sql',
  'database/migrations/032_article_publish_overrides.sql',
];

function a1Env() {
  const db = buildDb(FILES);
  return { db, env: { DB: makeRealD1(db) } };
}

const BODY_AUTO = 'EV sales reached 14 million units worldwide in 2023. A home charger adds about 40 kilometres of range per hour of charging.';
// The exact banner block content.js generates for an AI draft (same
// form as tests/draft-banner-publish.test.js STANDARD_BANNER_BODY).
const BANNER_BODY =
  'AI-DRAFT — needs fact-check + owner approval.\n' +
  '\n' +
  'This draft was written by workers-ai (@cf/openai/gpt-oss-120b). It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.\n' +
  '\n' +
  '## Introduction\n' +
  '\n' +
  'Enrollment from abroad is down this fall.';

let draftCounter = 0;

function insertDraft(db, { id = null, divisionId = 1, body = BODY_AUTO, status = 'draft' } = {}) {
  draftCounter += 1;
  // Auto ids start at 100: the seed holds 1–25, and a fresh article
  // must never land on 26/27 (flag-protected) or 28–31/33 (manual-
  // publish legacy list) — explicit-id tests insert those ids
  // themselves.
  const useId = id === null ? 100 + draftCounter : id;
  const r = db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(useId, divisionId, `Fix Pass 3 A1 Test Article ${useId}`, `fixpass3-a1-test-${useId}`, 'test', body, 'FS AI', status, 0);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

/** Seed a gate-passing article: fresh PASS fact-check (body hash
 * recorded) with evidenced VERIFIED claims, a source with a URL, and
 * a fresh PASS SEO run whose duplicate check passes. */
async function seedGatePass(db, articleId) {
  const article = loadArticle(db, articleId);
  const hash = await bodyHash(article.body);
  const fc = db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(articleId, 'pass', 2, 2, 0, hash);
  const fcId = Number(fc.lastInsertRowid);
  for (const claim of ['Gate claim one.', 'Gate claim two.']) {
    db.prepare(
      "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, ?, ?, 'https://example.com/source-1', 'evidence', 'test')",
    ).run(fcId, claim, 'VERIFIED');
  }
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId);
  const checksJson = JSON.stringify([
    { name: 'seo-title', ok: true },
    { name: 'duplicate', ok: true, detail: 'Highest 5-word shingle overlap: 0%.' },
  ]);
  db.prepare(
    'INSERT INTO seo_checks (article_id, verdict, checks_json, body_hash) VALUES (?, ?, ?, ?)',
  ).run(articleId, 'pass', checksJson, hash);
}

function createReq(body) {
  return new Request('http://localhost/api/admin/articles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putReq(id, body) {
  return new Request(`http://localhost/api/admin/articles/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function publishReq(id, body) {
  const opts = { method: 'POST', headers: { 'content-type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return new Request(`http://localhost/api/admin/articles/${id}/publish`, opts);
}

function auditRows(db, articleId) {
  return db.prepare('SELECT * FROM article_publish_overrides WHERE article_id = ? ORDER BY id ASC').all(articleId);
}

function revisionCount(db, articleId) {
  return db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(articleId).n;
}

describe('create with status published is refused', () => {
  it('create with status published returns 422 and creates no row', async () => {
    const { db, env } = a1Env();
    const res = await handleAdminArticles(
      createReq({ title: 'Created Published Article', division: 'automotive', body: BODY_AUTO, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.match(data.error, /POST \/api\/admin\/articles\/:id\/publish/);
    assert.equal(
      db.prepare('SELECT id FROM articles WHERE slug = ?').get('created-published-article'),
      undefined,
      'no row was created',
    );
  });

  it('create with status published and a banner body is refused before any banner handling', async () => {
    const { db, env } = a1Env();
    const res = await handleAdminArticles(
      createReq({ title: 'Banner Created Published Article', division: 'automotive', body: BANNER_BODY, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    // The refusal names the publish endpoint, not the banner — the
    // transition is refused before banner handling runs.
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    assert.equal(
      db.prepare('SELECT id FROM articles WHERE slug = ?').get('banner-created-published-article'),
      undefined,
    );
  });

  it('create as a draft still works, with or without an explicit status', async () => {
    const { db, env } = a1Env();
    const draftRes = await handleAdminArticles(
      createReq({ title: 'Created Draft Article', division: 'automotive', body: BODY_AUTO, status: 'draft' }),
      env, {}, AUTH,
    );
    assert.equal(draftRes.status, 201);
    assert.equal((await draftRes.json()).article.status, 'draft');
    const defaultRes = await handleAdminArticles(
      createReq({ title: 'Created Default Article', division: 'automotive', body: BODY_AUTO }),
      env, {}, AUTH,
    );
    assert.equal(defaultRes.status, 201);
    assert.equal((await defaultRes.json()).article.status, 'draft');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND slug LIKE 'created-%'").get().n,
      0,
    );
  });
});

describe('PUT into published is refused', () => {
  it('PUT draft→published returns 422, stays a draft, stores no revision', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Fix Pass 3 A1 Test Article', body: BODY_AUTO, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.body, BODY_AUTO);
    assert.equal(stored.published_at, null);
    assert.equal(revisionCount(db, id), 0, 'a refused publish stores no revision');
    assert.equal(auditRows(db, id).length, 0, 'a refusal writes no audit row');
  });

  it('PUT draft→published on protected #26 is refused 403 by the guard, before the publish refusal', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { id: 26, status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Fix Pass 3 A1 Test Article 26', body: BODY_AUTO, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 403);
    assert.equal(loadArticle(db, id).status, 'draft');
    assert.equal(revisionCount(db, id), 0);
  });

  it('PUT draft→published on legacy #28 is refused 422 and stays a draft — the legacy rule is intact because nothing publishes', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { id: 28, status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Fix Pass 3 A1 Test Article 28', body: BODY_AUTO, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    assert.equal(loadArticle(db, id).status, 'draft');
  });

  it('PUT draft→draft still works', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Fix Pass 3 A1 Test Article Edited', body: 'Edited draft body.', status: 'draft' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 200);
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.body, 'Edited draft body.');
    assert.equal(revisionCount(db, id), 1, 'a normal edit still stores a revision');
  });
});

describe('PUT on an already-published article is not a transition', () => {
  it('PUT keeping published still works and stores a revision', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { status: 'published' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Fix Pass 3 A1 Test Article Edited', body: 'Edited published body.', status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 200);
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'published');
    assert.equal(stored.body, 'Edited published body.');
    assert.equal(revisionCount(db, id), 1);
  });

  it('PUT published→draft (unpublish through edit) still works', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { status: 'published' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Fix Pass 3 A1 Test Article', body: BODY_AUTO, status: 'draft' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 200);
    assert.equal(loadArticle(db, id).status, 'draft');
  });
});

describe('the single publish path still works', () => {
  it('publish via POST /publish still works for a gate-passing article and writes no audit row', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { status: 'draft' });
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    const data = await res.json();
    assert.equal(data.article.status, 'published');
    assert.ok(data.article.published_at, 'publish stamps published_at');
    assert.equal(data.overridden, undefined, 'the normal path is not an override');
    assert.equal(auditRows(db, id).length, 0, 'the normal path writes no audit row');
  });

  it('override publish still works and the audit row is still written', async () => {
    const { db, env } = a1Env();
    const id = insertDraft(db, { status: 'draft' });
    // No gate seeding: the article is gate-blocked on the normal
    // path, so only the audited override can publish it.
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    const data = await res.json();
    assert.equal(data.article.status, 'published');
    assert.equal(data.overridden, true);
    const rows = auditRows(db, id);
    assert.equal(rows.length, 1, 'one audit row for the override');
    assert.equal(rows[0].article_id, id);
  });
});

describe('dashboard routes publishing through POST /publish', () => {
  it('the status dropdown offers no selectable Published option', () => {
    const html = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'dashboard.html'), 'utf8');
    // Scope to the article form's status select: the list FILTER
    // (#contentFilter) legitimately offers Published — filtering a
    // list is a read, not a publish path.
    const m = html.match(/<select id="articleStatus">([\s\S]*?)<\/select>/);
    assert.ok(m, 'the article form has a status select');
    const select = m[1];
    assert.ok(select.includes('<option value="published" disabled>'), 'the Published option stays, disabled, so editing a published article still shows its status');
    assert.ok(!/<option value="published">/.test(select), 'no enabled Published option — the form can never send status published as a new choice');
  });

  it('dashboard.js publishes through POST /publish, and the form only saves status', () => {
    const js = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'dashboard.js'), 'utf8');
    assert.ok(js.includes("api('/api/admin/articles/' + id + '/publish'"), 'the Publish button calls POST /publish');
    assert.ok(js.includes('status: el(\'articleStatus\').value'), 'the form sends the dropdown status on save');
  });
});
