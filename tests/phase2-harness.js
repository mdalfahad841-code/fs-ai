// FS AI — Shared real-SQLite harness for the Critical Repair Phase 2
// tests (correction-review, factcheck-rerun, seo-actions).
//
// Same pattern as tests/activation-repairs.test.js: a throwaway
// in-memory SQLite database built from database/schema.sql + seed +
// migrations 005/006/008/009/010/011/012, wrapped as a D1 binding.
// Migration 013 is NOT applied here on purpose: database/schema.sql
// already contains articles.is_protected, and 013's ADD COLUMN would
// fail as a duplicate on a schema-built DB (see the migration's own
// note). Protection still works in tests via the constant fallback
// (ids 26/27) in backend/publishing/protection.js and via the
// is_protected flag set explicitly by the helpers below.
// No network except stubbed fetches. Not a test file itself.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');

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

function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

// Explicit ids keep test articles clear of the protected fallback ids
// (26/27) unless a test opts into them. Slug/title are unique per call.
function insertArticle(db, body, { id = null, divisionId = 1, status = 'draft', seoTitle = null, seoDescription = null, isProtected = 0, title = null } = {}) {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const articleTitle = title || `Test Article ${id !== null ? id : uniq}`;
  const slug = `test-article-${id !== null ? id : uniq}`;
  if (id !== null) {
    db.prepare(
      'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, is_protected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    ).run(id, divisionId, articleTitle, slug, 'Test excerpt.', body, 'FS AI', status, seoTitle, seoDescription, isProtected ? 1 : 0);
    return id;
  }
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, articleTitle, slug, 'Test excerpt.', body, 'FS AI', status, seoTitle, seoDescription);
  return Number(r.lastInsertRowid);
}

function insertResearchItem(db, { title, url, summary, evidence, divisionId = 1 }) {
  const src = db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (?, ?, ?, 'rss')")
    .run(divisionId, `Test Source ${url}`, `https://example.com/feed-${encodeURIComponent(url)}`);
  const r = db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, summary, evidence_text, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(Number(src.lastInsertRowid), divisionId, title, url, summary, evidence, '2026-11-19T00:00:00.000Z', new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function addArticleSource(db, articleId, url, researchItemId = null) {
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, ?, ?, 'research', ?, ?)",
  ).run(articleId, url, url, researchItemId, new Date().toISOString());
}

// One failed claim + its correction row, mirroring the live #28 state
// (a CONFLICTING claim with a failed correction attempt). Returns the
// fact_check / claim_check / correction ids.
function seedFailedCorrection(db, articleId, claimText, { attempt = 1, recheckVerdict = 'CONFLICTING', evidenceUrl = null, correctedText = null } = {}) {
  const fc = db.prepare(
    "INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (?, 'needs-review', 1, 0, 1)",
  ).run(articleId);
  const factCheckId = Number(fc.lastInsertRowid);
  const cc = db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, ?, 'CONFLICTING', NULL, NULL, 'seeded failed claim')",
  ).run(factCheckId, claimText);
  const claimCheckId = Number(cc.lastInsertRowid);
  const corr = db.prepare(
    'INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(articleId, claimCheckId, claimText, correctedText, attempt, 'failed', recheckVerdict, evidenceUrl);
  return { factCheckId, claimCheckId, correctionId: Number(corr.lastInsertRowid) };
}

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

module.exports = {
  freshEnv, loadArticle, insertArticle, insertResearchItem, addArticleSource,
  seedFailedCorrection, callAutonomy,
};
