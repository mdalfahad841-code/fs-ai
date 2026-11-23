// FS AI — Fix Pass 2 item 4 tests.
//
// The daily run's seoRun step used to check only the 3 oldest-
// updated_at drafts per day (LIMIT 3) with no freshness awareness:
// #28/#31/#29 were re-checked every day while #33/#30 starved
// behind them (docs/FIXPASS2-ITEM4-FINDINGS-2026-11-23.md). The fix
// widens the candidate fetch to LIMIT 10 and skips a draft whose
// latest seo_checks row already covers its current body (same
// body_hash AND body_length) WITHOUT consuming one of the 3 daily
// real-check slots.
//
// Run: node --test tests/fixpass2-item4.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
// Fixtures / in-memory SQLite only — no live D1, no article #33.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runDailyWorkflow } = require('../backend/routes/scheduler.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');

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

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSql(text)) db.exec(stmt);
  }
  return db;
}

// Minimal D1-compatible adapter over node:sqlite (copied from
// tests/autonomy-scheduler.test.js).
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

// Same base as tests/autonomy-scheduler.test.js freshEnv, PLUS
// migration 023 (body_hash/body_length on seo_checks) so the
// freshness comparison has columns to read.
const BASE_FILES = [
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

function freshEnv(withSeoHashColumns = true) {
  const files = withSeoHashColumns ? [...BASE_FILES, 'database/migrations/023_seo_body_hash.sql'] : BASE_FILES;
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

// Long enough (plain text >= 120 chars) for deriveSeoDescription, with
// no internal link and no headings. Same shape as the guard fixtures
// in tests/autonomy-scheduler.test.js: repairSeoFields appends a
// Related reading link ONLY to a genuinely relevant sibling, and these
// "Fixpass2 Test Article N" fixtures share no topical title keyword
// with any published sibling, so the body is unchanged by the SEO step.
const bodyFor = (n) =>
  `Fixpass2 test article number ${n} has a plain body about the topic, with enough words to derive a meta description from the article text itself. ` +
  `A second sentence adds more real content here for the description. A third sentence keeps the text long enough to repair.`;

function insertDraftWithId(db, id, updatedAt) {
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)',
  ).run(id, divisionId, `Fixpass2 Test Article ${id}`, `fixpass2-test-${id}`, 'Excerpt.', bodyFor(id), 'FS AI', 'draft', null, updatedAt);
  return id;
}

// Seed a seo_checks row that covers the article's CURRENT body exactly
// (same hash + length the fix compares against), as the 23 Nov daily
// run did for #28/#31/#29.
async function insertFreshSeoRow(db, articleId, createdAt) {
  const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(articleId).body;
  const hash = await bodyHash(body);
  db.prepare(
    'INSERT INTO seo_checks (article_id, verdict, checks_json, body_hash, body_length, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(articleId, 'needs-review', '{}', hash, body.length, createdAt);
}

function stepDetail(db, agent, stepName) {
  const rows = db.prepare('SELECT detail FROM agent_runs WHERE agent = ?').all(agent);
  for (const r of rows) {
    try {
      const detail = JSON.parse(r.detail || '{}');
      if (detail.step === stepName) return detail;
    } catch { /* not JSON — ignore */ }
  }
  return null;
}

function seoCheckCount(db, articleId) {
  return db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?').get(articleId).n;
}

describe('Fix Pass 2 item 4 — seoRun fresh-skip', () => {
  it('(a) fresh #28 (oldest updated_at) is skipped-fresh and stale #33 (newer) is checked', async () => {
    const { db, env } = freshEnv();
    // Live 23 Nov shape: #28 oldest, untouched since 19 Nov, with a
    // fresh SEO row; #33 newer (its 22 Nov correction bumped
    // updated_at) with NO seo_checks row at all.
    insertDraftWithId(db, 28, '2026-11-19T18:53:35');
    insertDraftWithId(db, 33, '2026-11-22T08:07:49');
    await insertFreshSeoRow(db, 28, '2026-11-23 00:04:00');
    assert.equal(seoCheckCount(db, 33), 0, 'precondition: #33 has no seo_checks row');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.seoRun, 1, 'seoRun performed exactly 1 real check (the skip does not count)');

    const detail = stepDetail(db, 'seo', 'seo-run');
    assert.ok(detail, 'the seo-run step recorded its detail');
    assert.equal(detail.checked, 1, 'step result counts 1 real check');
    assert.equal(detail.skippedFresh, 1, 'step result counts 1 fresh skip');
    assert.deepEqual(
      detail.results.map((r) => [r.articleId, r.outcome]),
      [[28, 'skipped-fresh'], [33, 'done']],
      'oldest-first order kept: #28 skipped-fresh, #33 checked',
    );

    assert.equal(seoCheckCount(db, 28), 1, 'no new seo_checks row was written for fresh #28');
    assert.equal(seoCheckCount(db, 33), 1, 'exactly one seo_checks row was written for #33');
  });

  it('(a2) a stale latest row (hash from an older body) does NOT skip — the article is re-checked', async () => {
    const { db, env } = freshEnv();
    insertDraftWithId(db, 28, '2026-11-19T18:53:35');
    insertDraftWithId(db, 33, '2026-11-22T08:07:49');
    // #28's row records the hash/length of a DIFFERENT (older) body,
    // as if the body was edited after the last SEO check.
    const staleHash = await bodyHash('An older body that has since been rewritten completely.');
    db.prepare(
      'INSERT INTO seo_checks (article_id, verdict, checks_json, body_hash, body_length, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(28, 'needs-review', '{}', staleHash, 57, '2026-11-23 00:04:00');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.seoRun, 2, 'both stale drafts were really checked');

    const detail = stepDetail(db, 'seo', 'seo-run');
    assert.equal(detail.skippedFresh, 0, 'nothing was skipped');
    assert.deepEqual(
      detail.results.map((r) => r.articleId),
      [28, 33],
      'both drafts checked, oldest first',
    );
    assert.equal(seoCheckCount(db, 28), 2, 'a fresh row was written for #28 on top of the stale one');
    assert.equal(seoCheckCount(db, 33), 1, 'one seo_checks row was written for #33');
  });

  it('(b) the cap still stops at 3 real checks when 5 stale drafts exist', async () => {
    const { db, env } = freshEnv();
    for (let i = 0; i < 5; i++) {
      insertDraftWithId(db, 40 + i, `2026-11-${19 + i}T10:00:00`);
    }

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.seoRun, 3, 'seoRun performed exactly 3 real checks');

    const detail = stepDetail(db, 'seo', 'seo-run');
    assert.equal(detail.checked, 3, 'step result counts 3 real checks');
    assert.equal(detail.skippedFresh, 0, 'nothing was skipped');
    assert.deepEqual(
      detail.results.map((r) => r.articleId),
      [40, 41, 42],
      'the 3 oldest drafts were checked, in updated_at order',
    );
    for (const id of [40, 41, 42]) {
      assert.equal(seoCheckCount(db, id), 1, `one seo_checks row was written for #${id}`);
    }
    for (const id of [43, 44]) {
      assert.equal(seoCheckCount(db, id), 0, `no seo_checks row was written for unreached #${id}`);
    }
  });

  it('(c) without migration 023 columns the lookup fails open — the draft is still checked, not skipped', async () => {
    // The existing seoRun guard tests run on DBs without the 023
    // columns; this pins the same fail-open behaviour explicitly:
    // a missing-column read must never count as fresh.
    const { db, env } = freshEnv(false);
    insertDraftWithId(db, 28, '2026-11-19T18:53:35');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.seoRun, 1, 'seoRun still checked the draft');

    const detail = stepDetail(db, 'seo', 'seo-run');
    assert.equal(detail.checked, 1, 'step result counts 1 real check');
    assert.equal(detail.skippedFresh, 0, 'nothing was skipped without readable hash columns');
    assert.equal(seoCheckCount(db, 28), 1, 'one seo_checks row was written (insertSeoCheck old-column fallback)');
  });
});
