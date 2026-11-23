// FS AI — close-out B6: gate counting stale failed correction rows +
// the correction-retry §7 fix (2026-11-23).
//
// Gate: a correction row goes STALE when the fresh latest fact-check
// run judges its claim VERIFIED (live #33: 4 attempt-1 'failed' rows
// for claims fc 34 passed 15/15) or no longer contains the claim at
// all (live #30: claims the correction removed/reworded, absent from
// fc 35). countOpenCorrections() ignores those rows — but ONLY when
// the latest run is fresh (body_hash matches the current body); a
// stale run or no run falls back to the pre-B6 latest-row count
// (fail-closed). The auto-publish wrapper shares the same counting
// rule, so the two verdicts cannot disagree about corrections.
//
// §7: handleRecheckArticle used to reuse the newest fact-checking task
// regardless of kind/status and force its kind to 'fact-check' —
// clicking Re-check while a correction retry was pending ('correct',
// 'queued') silently converted it (live #33 task #44, run #172). It
// now reuses the newest row that is NOT a pending correction; a
// terminal row (done/failed/skipped) keeps the live-verified #31
// reuse behaviour (runs #121/#122).
//
// Real SQLite databases (schema + seed + migrations). No network, no
// live D1. Run: node --test tests/closeout-b6.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { evaluatePublishGate, evaluateAutoPublishEligibility } = require('../backend/publishing/gate.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const { claimKey } = require('../backend/agents/autonomy/factcheck.js');
const {
  freshEnv: harnessEnv, insertArticle, insertResearchItem, addArticleSource,
  callAutonomy,
} = require('./phase2-harness.js');

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

const GATE_FILES = [
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
];

function gateEnv({ withClaimKey = true } = {}) {
  const files = withClaimKey ? GATE_FILES : GATE_FILES.filter((f) => !f.includes('017_'));
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

const BODY = 'EV sales reached 14 million units worldwide in 2023. A home charger adds about 40 kilometres of range per hour of charging.';
const CLAIM_A = 'EV sales reached 14 million units worldwide in 2023.';
const CLAIM_B = 'A home charger adds about 40 kilometres of range per hour of charging.';
const CLAIM_GONE = 'The old intro sentence that the correction removed entirely.';

function insertDraft(db, body = BODY) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Gate Test Article', 'gate-test-article', 'test', ?, 'FS AI', 'draft', 0)",
  ).run(1, body);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

/** Fresh fact-check run for the article's CURRENT body (hash recorded,
 * exactly as checkArticle does under migration 019). */
async function insertFreshCheck(db, articleId, { verdict = 'pass', claims }) {
  const article = loadArticle(db, articleId);
  const hash = await bodyHash(article.body);
  const verified = claims.filter((c) => c.verdict === 'VERIFIED').length;
  const failed = claims.filter((c) => c.verdict !== 'VERIFIED').length;
  const fc = db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(articleId, verdict, claims.length, verified, failed, hash);
  const fcId = Number(fc.lastInsertRowid);
  const claimIds = {};
  for (const c of claims) {
    const row = db.prepare(
      "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, ?, ?, 'https://example.com/source-1', 'evidence', 'test')",
    ).run(fcId, c.text, c.verdict);
    claimIds[c.text] = Number(row.lastInsertRowid);
  }
  return { fcId, claimIds };
}

function insertCorrection(db, articleId, { claimText, claimCheckId, status, attempt = 1 }) {
  const r = db.prepare(
    'INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, claim_key) VALUES (?, ?, ?, NULL, ?, ?, ?)',
  ).run(articleId, claimCheckId, claimText, attempt, status, claimKey(claimText));
  return Number(r.lastInsertRowid);
}

function makeContentReadyExtras(db, articleId) {
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId);
  const checksJson = JSON.stringify([
    { name: 'seo-title', ok: true }, { name: 'duplicate', ok: true, detail: 'Highest 5-word shingle overlap: 3%.' },
  ]);
  db.prepare('INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, ?, ?)').run(articleId, 'pass', checksJson);
}

function checkByName(gate, name) {
  return gate.checks.find((c) => c.name === name);
}

describe('B6 gate — stale failed correction rows are not counted', () => {
  it('live #33 shape: a failed row for a claim the fresh PASS run VERIFIED does not block (applied row neither)', async () => {
    const { db, env } = gateEnv();
    const id = insertDraft(db);
    const { claimIds } = await insertFreshCheck(db, id, {
      verdict: 'pass',
      claims: [
        { text: CLAIM_A, verdict: 'VERIFIED' },
        { text: CLAIM_B, verdict: 'VERIFIED' },
      ],
    });
    makeContentReadyExtras(db, id);
    // Attempt-1 'failed' row for CLAIM_A — the claim the fresh run
    // VERIFIED on full evidence, so no correction was ever needed.
    insertCorrection(db, id, { claimText: CLAIM_A, claimCheckId: claimIds[CLAIM_A], status: 'failed' });
    // CLAIM_B was corrected (applied) in a later attempt.
    insertCorrection(db, id, { claimText: CLAIM_B, claimCheckId: claimIds[CLAIM_B], status: 'failed', attempt: 1 });
    insertCorrection(db, id, { claimText: CLAIM_B, claimCheckId: claimIds[CLAIM_B], status: 'applied', attempt: 2 });
    const gate = await evaluatePublishGate(env, id);
    assert.equal(checkByName(gate, 'correction-recheck').ok, true, JSON.stringify(gate.checks));
    assert.equal(checkByName(gate, 'correction-recheck').detail, 'No open corrections (re-check passes or nothing to correct).');
    assert.equal(gate.contentReady, true, JSON.stringify(gate.contentBlockers));
  });

  it('live #30 shape: only the claim still failing in the fresh run counts; VERIFIED and absent claims drop out', async () => {
    const { db, env } = gateEnv();
    const id = insertDraft(db);
    const { claimIds } = await insertFreshCheck(db, id, {
      verdict: 'needs-review',
      claims: [
        { text: CLAIM_A, verdict: 'UNSUPPORTED' },
        { text: CLAIM_B, verdict: 'VERIFIED' },
      ],
    });
    // Still failing in the fresh run — genuinely open.
    insertCorrection(db, id, { claimText: CLAIM_A, claimCheckId: claimIds[CLAIM_A], status: 'failed' });
    // VERIFIED in the fresh run — stale, must not count.
    insertCorrection(db, id, { claimText: CLAIM_B, claimCheckId: claimIds[CLAIM_B], status: 'failed' });
    // Claim gone from the body (removed/reworded) — absent from the
    // fresh run, stale, must not count.
    insertCorrection(db, id, { claimText: CLAIM_GONE, claimCheckId: claimIds[CLAIM_A], status: 'failed' });
    const gate = await evaluatePublishGate(env, id);
    assert.equal(checkByName(gate, 'correction-recheck').ok, false);
    assert.equal(checkByName(gate, 'correction-recheck').detail, '1 correction claim(s) still pending or failed.');
  });

  it('fail-closed: when the latest run is STALE (body edited after the check) the failed row counts again', async () => {
    const { db, env } = gateEnv();
    const id = insertDraft(db);
    const { claimIds } = await insertFreshCheck(db, id, {
      verdict: 'pass',
      claims: [
        { text: CLAIM_A, verdict: 'VERIFIED' },
        { text: CLAIM_B, verdict: 'VERIFIED' },
      ],
    });
    insertCorrection(db, id, { claimText: CLAIM_A, claimCheckId: claimIds[CLAIM_A], status: 'failed' });
    // A failed-then-applied claim: the latest row is applied, so the
    // latest-row rule already clears it even without a fresh run.
    insertCorrection(db, id, { claimText: CLAIM_B, claimCheckId: claimIds[CLAIM_B], status: 'failed', attempt: 1 });
    insertCorrection(db, id, { claimText: CLAIM_B, claimCheckId: claimIds[CLAIM_B], status: 'applied', attempt: 2 });
    // Edit the body after the check: the run is stale, so no
    // staleness filtering may apply — the pre-B6 count returns.
    db.prepare('UPDATE articles SET body = body || ? WHERE id = ?').run(' Extra sentence.', id);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(checkByName(gate, 'correction-recheck').ok, false);
    assert.equal(checkByName(gate, 'correction-recheck').detail, '1 correction claim(s) still pending or failed.');
  });

  it('fail-closed: with no fact-check on record at all, a failed row still blocks', async () => {
    const { db, env } = gateEnv();
    const id = insertDraft(db);
    db.prepare(
      'INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, claim_key) VALUES (?, NULL, ?, NULL, 1, ?, ?)',
    ).run(id, CLAIM_A, 'failed', claimKey(CLAIM_A));
    const gate = await evaluatePublishGate(env, id);
    assert.equal(checkByName(gate, 'correction-recheck').ok, false);
    assert.equal(checkByName(gate, 'correction-recheck').detail, '1 correction claim(s) still pending or failed.');
  });

  it('pre-017 fallback: without the claim_key column the old row count is used', async () => {
    const { db, env } = gateEnv({ withClaimKey: false });
    const id = insertDraft(db);
    const { claimIds } = await insertFreshCheck(db, id, {
      verdict: 'pass',
      claims: [
        { text: CLAIM_A, verdict: 'VERIFIED' },
        { text: CLAIM_B, verdict: 'VERIFIED' },
      ],
    });
    makeContentReadyExtras(db, id);
    db.prepare(
      "INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status) VALUES (?, ?, ?, NULL, 1, 'pending')",
    ).run(id, claimIds[CLAIM_A], CLAIM_A);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(checkByName(gate, 'correction-recheck').ok, false);
    assert.equal(checkByName(gate, 'correction-recheck').detail, '1 correction claim(s) still pending or failed.');
  });
});

describe('B6 gate — auto-publish wrapper shares the counting rule', () => {
  it('stale failed row for a VERIFIED claim does not block the wrapper either', async () => {
    const { db, env } = gateEnv();
    const id = insertDraft(db);
    const { claimIds } = await insertFreshCheck(db, id, {
      verdict: 'pass',
      claims: [{ text: CLAIM_A, verdict: 'VERIFIED' }],
    });
    insertCorrection(db, id, { claimText: CLAIM_A, claimCheckId: claimIds[CLAIM_A], status: 'failed' });
    const v = await evaluateAutoPublishEligibility(env, id);
    assert.equal(checkByName(v, 'correction-recheck').ok, true, JSON.stringify(v.checks));
    assert.equal(checkByName(v, 'correction-recheck').detail, 'No open corrections.');
  });

  it('a genuinely open correction still blocks the wrapper', async () => {
    const { db, env } = gateEnv();
    const id = insertDraft(db);
    const { claimIds } = await insertFreshCheck(db, id, {
      verdict: 'needs-review',
      claims: [{ text: CLAIM_A, verdict: 'UNSUPPORTED' }],
    });
    insertCorrection(db, id, { claimText: CLAIM_A, claimCheckId: claimIds[CLAIM_A], status: 'failed' });
    const v = await evaluateAutoPublishEligibility(env, id);
    assert.equal(checkByName(v, 'correction-recheck').ok, false);
    assert.equal(checkByName(v, 'correction-recheck').detail, '1 correction claim(s) still pending or failed.');
  });
});

describe('B6 §7 — re-check never converts a pending correction retry', () => {
  const CYBERCAB_URL = 'https://example.com/cybercab-berlin';
  const CYBERCAB_BODY = 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026. Motorcycle sales rose 20 percent worldwide in 2025.';

  function seedCybercabArticle(db, id) {
    insertArticle(db, CYBERCAB_BODY, { id });
    const itemId = insertResearchItem(db, {
      title: 'Tesla Cybercab factory at Giga Berlin',
      url: CYBERCAB_URL,
      summary: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
      evidence: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
    });
    addArticleSource(db, id, CYBERCAB_URL, itemId);
  }

  function seedTask(db, { kind, status, attempts = 0, key, articleId = 101 }) {
    const now = new Date().toISOString();
    const r = db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('fact-checking', ?, ?, NULL, 5, ?, ?, 3, ?, NULL, ?, ?)",
    ).run(kind, JSON.stringify({ article_id: articleId }), status, attempts, key, now, now);
    return Number(r.lastInsertRowid);
  }

  function taskRow(db, id) {
    return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
  }

  it('a queued kind=correct task is left untouched and the re-check runs on a fresh task', async () => {
    const { db, env } = harnessEnv();
    seedCybercabArticle(db, 101);
    const correctId = seedTask(db, { kind: 'correct', status: 'queued', attempts: 1, key: 'manual-correct-101-2026-11-23' });
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'completed');
    assert.equal(r.body.taskReused, false, 'no reusable task existed — a fresh one was created');
    assert.notEqual(r.body.taskId, correctId, 'the re-check did not reuse the correction task');
    const kept = taskRow(db, correctId);
    assert.equal(kept.kind, 'correct', 'the pending correction keeps its kind');
    assert.equal(kept.status, 'queued', 'the pending correction stays queued for retry');
    assert.equal(kept.attempts, 1, 'no attempt is consumed on the correction row');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking'").get().n, 2,
      'correction task + fresh fact-check task');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 1,
      'the re-check still wrote its fresh fact-check row');
  });

  it('a DONE kind=correct task keeps the live-verified #31 reuse behaviour', async () => {
    const { db, env } = harnessEnv();
    seedCybercabArticle(db, 101);
    const correctId = seedTask(db, { kind: 'correct', status: 'done', attempts: 2, key: 'manual-correct-101-2026-11-22' });
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.taskReused, true, 'the terminal correction row is still reused');
    assert.equal(r.body.taskId, correctId, 'same task id — no duplicate task');
    assert.equal(taskRow(db, correctId).kind, 'fact-check', 'the reused row is forced to fact-check, as before');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking'").get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 1);
  });

  it('a queued correction plus an older done fact-check task reuses the older task, not the correction', async () => {
    const { db, env } = harnessEnv();
    seedCybercabArticle(db, 101);
    const oldId = seedTask(db, { kind: 'fact-check', status: 'done', attempts: 1, key: 'manual-recheck-101-0' });
    const correctId = seedTask(db, { kind: 'correct', status: 'queued', attempts: 1, key: 'manual-correct-101-2026-11-23' });
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.taskReused, true, 'the older fact-check task was reused');
    assert.equal(r.body.taskId, oldId, 'the re-check ran on the older task, not the correction row');
    const kept = taskRow(db, correctId);
    assert.equal(kept.kind, 'correct');
    assert.equal(kept.status, 'queued');
    assert.equal(kept.attempts, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking'").get().n, 2,
      'no third task was created');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 1);
  });
});
