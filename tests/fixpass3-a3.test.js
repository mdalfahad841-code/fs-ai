// FS AI — Fix Pass 3 A3 tests.
//
// The daily run's factCheckRun step used to check only the 3 oldest-
// updated_at drafts per day (LIMIT 3) with no freshness awareness:
// the same unchanged drafts were re-checked every day while newer
// drafts starved behind them — the identical shape Fix Pass 2 item 4
// fixed in seoRun (docs/FIXPASS2-ITEM4-FINDINGS-2026-11-23.md). The
// fix widens the candidate fetch to LIMIT 10 and skips a draft whose
// latest fact_checks row already covers its current body (same
// body_hash) WITHOUT consuming one of the 3 daily real-check slots.
//
// ONE HONEST DIFFERENCE from the SEO fix: fact_checks has NO
// body_length column (migration 009 creates the table without one;
// migration 019 adds body_hash ONLY). Freshness is the body_hash
// match alone — the same staleness rule evaluatePublishGate() already
// applies to fact_checks. No column was invented, no migration added.
//
// Run: node --test tests/fixpass3-a3.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
// Fixtures / in-memory SQLite only — no live D1, no live protected
// article. Fixture ids 28/33 are fresh rows in a throwaway in-memory
// DB, not the live articles.
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

// Same base as tests/factcheck-integrity.test.js freshEnv: the
// fact-check column chain (017 claim key, 018 check_kind +
// evidence_signature, 019 body_hash) so checkArticle stores its
// body hash on the full column list.
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
  'database/migrations/016_llm_usage_estimated.sql',
  'database/migrations/017_correction_claim_key.sql',
  'database/migrations/018_factcheck_verdict_history.sql',
  'database/migrations/019_factcheck_body_hash.sql',
];

function freshEnv(withFactCheckHashColumns = true) {
  const files = withFactCheckHashColumns
    ? BASE_FILES
    : BASE_FILES.filter((f) => f !== 'database/migrations/018_factcheck_verdict_history.sql' && f !== 'database/migrations/019_factcheck_body_hash.sql');
  const db = buildDb(files);
  // factCheckRun is gated on auto_factcheck (default 'off' when the
  // row is missing); the daily run on live D1 has it 'on'.
  db.prepare(
    "INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run('auto_factcheck', 'on');
  return { db, env: { DB: makeRealD1(db) } };
}

// Long enough (plain text >= 120 chars) for deriveSeoDescription, with
// no internal link and no headings. Same shape as the guard fixtures
// in tests/autonomy-scheduler.test.js: repairSeoFields appends a
// Related reading link ONLY to a genuinely relevant sibling, and these
// "Fixpass3 Test Article N" fixtures share no topical title keyword
// with any published sibling, so the body is unchanged by the SEO step
// that runs after factCheckRun in the same daily workflow.
const bodyFor = (n) =>
  `Fixpass3 test article number ${n} has a plain body about the topic, with enough words to derive a meta description from the article text itself. ` +
  `A second sentence adds more real content here for the description. A third sentence keeps the text long enough to repair.`;

function insertDraftWithId(db, id, updatedAt) {
  const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'automotive'").get().id;
  db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, publish_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)',
  ).run(id, divisionId, `Fixpass3 Test Article ${id}`, `fixpass3-test-${id}`, 'Excerpt.', bodyFor(id), 'FS AI', 'draft', null, updatedAt);
  return id;
}

// Seed a fact_checks row that covers the article's CURRENT body exactly
// (same hash the fix compares against), as a previous daily run would
// have written for an unchanged draft.
async function insertFreshFactCheckRow(db, articleId, createdAt) {
  const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(articleId).body;
  const hash = await bodyHash(body);
  db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, check_kind, evidence_signature, body_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(articleId, 'needs-review', 1, 0, 1, 'initial', null, hash, createdAt);
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

function factCheckCount(db, articleId) {
  return db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(articleId).n;
}

describe('Fix Pass 3 A3 — factCheckRun fresh-skip', () => {
  it('(a) fresh #28 (oldest updated_at) is skipped-fresh and stale #33 (newer) is checked', async () => {
    const { db, env } = freshEnv();
    // Live shape: #28 oldest, untouched, with a fresh fact-check row
    // for its current body; #33 newer with NO fact_checks row at all.
    insertDraftWithId(db, 28, '2026-11-19T18:53:35');
    insertDraftWithId(db, 33, '2026-11-22T08:07:49');
    await insertFreshFactCheckRow(db, 28, '2026-11-23 00:04:00');
    assert.equal(factCheckCount(db, 33), 0, 'precondition: #33 has no fact_checks row');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.factChecksRun, 1, 'factCheckRun performed exactly 1 real check (the skip does not count)');

    const detail = stepDetail(db, 'fact-checking', 'fact-check-run');
    assert.ok(detail, 'the fact-check-run step recorded its detail');
    assert.equal(detail.checked, 1, 'step result counts 1 real check');
    assert.equal(detail.skippedFresh, 1, 'step result counts 1 fresh skip');
    assert.deepEqual(
      detail.results.map((r) => [r.articleId, r.outcome]),
      [[28, 'skipped-fresh'], [33, 'done']],
      'oldest-first order kept: #28 skipped-fresh, #33 checked',
    );

    assert.equal(factCheckCount(db, 28), 1, 'no new fact_checks row was written for fresh #28');
    assert.equal(factCheckCount(db, 33), 1, 'exactly one fact_checks row was written for #33');
  });

  it('(a2) a stale latest row (hash from an older body) does NOT skip — the article is re-checked', async () => {
    const { db, env } = freshEnv();
    insertDraftWithId(db, 28, '2026-11-19T18:53:35');
    insertDraftWithId(db, 33, '2026-11-22T08:07:49');
    // #28's row records the hash of a DIFFERENT (older) body, as if
    // the body was edited after the last fact-check.
    const staleHash = await bodyHash('An older body that has since been rewritten completely.');
    db.prepare(
      'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, check_kind, evidence_signature, body_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(28, 'needs-review', 1, 0, 1, 'initial', null, staleHash, '2026-11-23 00:04:00');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.factChecksRun, 2, 'both stale drafts were really checked');

    const detail = stepDetail(db, 'fact-checking', 'fact-check-run');
    assert.equal(detail.skippedFresh, 0, 'nothing was skipped');
    assert.deepEqual(
      detail.results.map((r) => r.articleId),
      [28, 33],
      'both drafts checked, oldest first',
    );
    assert.equal(factCheckCount(db, 28), 2, 'a fresh row was written for #28 on top of the stale one');
    assert.equal(factCheckCount(db, 33), 1, 'one fact_checks row was written for #33');
  });

  it('(b) the cap still stops at 3 real checks when 5 stale drafts exist', async () => {
    const { db, env } = freshEnv();
    for (let i = 0; i < 5; i++) {
      insertDraftWithId(db, 40 + i, `2026-11-${19 + i}T10:00:00`);
    }

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.factChecksRun, 3, 'factCheckRun performed exactly 3 real checks');

    const detail = stepDetail(db, 'fact-checking', 'fact-check-run');
    assert.equal(detail.checked, 3, 'step result counts 3 real checks');
    assert.equal(detail.skippedFresh, 0, 'nothing was skipped');
    assert.deepEqual(
      detail.results.map((r) => r.articleId),
      [40, 41, 42],
      'the 3 oldest drafts were checked, in updated_at order',
    );
    for (const id of [40, 41, 42]) {
      assert.equal(factCheckCount(db, id), 1, `one fact_checks row was written for #${id}`);
    }
    for (const id of [43, 44]) {
      assert.equal(factCheckCount(db, id), 0, `no fact_checks row was written for unreached #${id}`);
    }
  });

  it('(c) without migration 019 columns the lookup fails open — the draft is still checked, not skipped', async () => {
    // A missing-column read must never count as fresh: the helper
    // returns false on any read failure, so the draft is re-checked.
    const { db, env } = freshEnv(false);
    insertDraftWithId(db, 28, '2026-11-19T18:53:35');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.factChecksRun, 1, 'factCheckRun still checked the draft');

    const detail = stepDetail(db, 'fact-checking', 'fact-check-run');
    assert.equal(detail.checked, 1, 'step result counts 1 real check');
    assert.equal(detail.skippedFresh, 0, 'nothing was skipped without a readable hash column');
    assert.equal(factCheckCount(db, 28), 1, 'one fact_checks row was written (checkArticle bare-column fallback)');
  });

  it('(d) STARVATION: four fresh drafts ahead in updated_at order do not block a stale draft behind them', async () => {
    const { db, env } = freshEnv();
    // The old LIMIT 3 shape: drafts 40-42 occupy the whole window
    // every day and #44 (newest updated_at) is never reached, no
    // matter how many days pass. With the fix, the four fresh drafts
    // are skipped without consuming a slot and #44 is checked.
    for (let i = 0; i < 4; i++) {
      insertDraftWithId(db, 40 + i, `2026-11-${19 + i}T10:00:00`);
      await insertFreshFactCheckRow(db, 40 + i, `2026-11-2${i} 00:04:00`);
    }
    insertDraftWithId(db, 44, '2026-11-23T10:00:00');
    assert.equal(factCheckCount(db, 44), 0, 'precondition: #44 has no fact_checks row');

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true);
    assert.equal(result.counts.factChecksRun, 1, 'factCheckRun performed exactly 1 real check — the starved draft');

    const detail = stepDetail(db, 'fact-checking', 'fact-check-run');
    assert.equal(detail.checked, 1, 'step result counts 1 real check');
    assert.equal(detail.skippedFresh, 4, 'step result counts 4 fresh skips');
    assert.deepEqual(
      detail.results.map((r) => [r.articleId, r.outcome]),
      [[40, 'skipped-fresh'], [41, 'skipped-fresh'], [42, 'skipped-fresh'], [43, 'skipped-fresh'], [44, 'done']],
      'fresh drafts skipped in order, starved draft checked',
    );
    for (const id of [40, 41, 42, 43]) {
      assert.equal(factCheckCount(db, id), 1, `no new fact_checks row was written for fresh #${id}`);
    }
    assert.equal(factCheckCount(db, 44), 1, 'exactly one fact_checks row was written for #44');
  });
});
