// FS AI — Fix 5 regression tests: fact-check re-run (2026-11-20).
//
// POST /api/autonomy/articles/:id/recheck re-runs fact-checking for an
// existing draft WITHOUT creating a duplicate task: the article's
// existing fact-checking task record is reused (same task id, new
// agent_runs row) and each run writes a NEW fact_checks row + new
// claim_checks rows, so history is preserved. Covered: separate runs,
// history preservation, task reuse vs creation, duplicate-execution
// guard (already-running), Emergency Stop block,
// and fact_checked staying 0 on a needs-review verdict.
// A re-check is advisory-only, so protection does NOT block it on a
// protected article (same scope as the daily factCheckRun step) — the
// tests pin that the body/excerpt/seo_description stay byte-identical.
// Real SQLite database (tests/phase2-harness.js). No network.
// Run: node --test tests/factcheck-rerun.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  freshEnv, loadArticle, insertArticle, insertResearchItem, addArticleSource,
  callAutonomy,
} = require('./phase2-harness.js');
const { checkArticle } = require('../backend/agents/autonomy/factcheck.js');
const { setEmergencyStop } = require('../backend/routes/admin.js');

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

describe('POST /api/autonomy/articles/:id/recheck', () => {
  it('first re-check creates exactly one task and one new fact-check run; previous is null; fact_checked stays 0', async () => {
    const { db, env } = freshEnv();
    seedCybercabArticle(db, 101);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'completed');
    assert.equal(r.body.outcome, 'done');
    assert.equal(r.body.taskReused, false, 'no task existed, so one was created');
    assert.ok(r.body.taskId, 'a task id is returned');
    assert.ok(r.body.runId, 'a run id is returned');
    assert.equal(r.body.previous, null, 'no previous run existed');
    assert.equal(r.body.latest.verdict, 'needs-review', '1 of 2 claims verifies');
    assert.equal(r.body.latest.claimsTotal, 2);
    assert.equal(r.body.latest.claimsVerified, 1);
    assert.equal(r.body.latest.claimsFailed, 1);
    assert.equal(r.body.latest.claims.length, 2);
    assert.equal(r.body.factChecked, 0, 'advisory only — fact_checked is never set by a re-check');
    assert.equal(db.prepare('SELECT fact_checked FROM articles WHERE id = ?').get(101).fact_checked, 0);
    assert.ok(r.body.articleVersion, 'the article version the run used is recorded');
    assert.equal(r.body.articleVersion.bodyChars, CYBERCAB_BODY.length);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = ?').get('fact-checking').n, 1,
      'exactly one task exists — no duplicate');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking' AND status = 'done'").get().n, 1);
  });

  it('second re-check reuses the same task record, writes a separate run, and preserves history (previous = first latest)', async () => {
    const { db, env } = freshEnv();
    seedCybercabArticle(db, 101);
    // A direct check first, so a previous result exists before any task.
    const direct = await checkArticle(env, loadArticle(db, 101));
    assert.equal(direct.verdict, 'needs-review');

    const first = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.taskReused, false, 'no task existed yet');
    assert.equal(first.body.previous.id, direct.factCheckId, 'previous is the direct run');
    assert.notEqual(first.body.latest.id, direct.factCheckId, 'a new fact_checks row was written');

    const second = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.taskReused, true, 'the existing task record was reused');
    assert.equal(second.body.taskId, first.body.taskId, 'same task id — no duplicate task');
    assert.notEqual(second.body.runId, first.body.runId, 'a new agent_runs row per execution');
    assert.equal(second.body.previous.id, first.body.latest.id, 'previous is the first re-check run');
    assert.notEqual(second.body.latest.id, first.body.latest.id, 'a third fact_checks row was written');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 3,
      'direct run + two re-checks, all kept');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claim_checks').get().n, 6,
      'claim history kept per run (2 claims x 3 runs)');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = ?').get('fact-checking').n, 1,
      'still exactly one task — re-checks never duplicate it');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?').get(first.body.taskId).n, 2,
      'two runs recorded against the one reused task');
    assert.equal(db.prepare('SELECT fact_checked FROM articles WHERE id = ?').get(101).fact_checked, 0);
  });

  it('an in-flight re-check returns already-running (409) and starts no second run', async () => {
    const { db, env } = freshEnv();
    seedCybercabArticle(db, 101);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('fact-checking', 'fact-check', ?, NULL, 5, 'running', 1, 3, ?, NULL, ?, ?)",
    ).run(JSON.stringify({ article_id: 101 }), 'guard-test-101', now, now);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.status, 'already-running');
    assert.match(r.body.error, /already running/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 0,
      'no second run started');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking' AND status = 'running'").get().n, 1);
  });

  it('Emergency Stop blocks the re-check (423) with no task and no new fact-check row', async () => {
    const { db, env } = freshEnv();
    seedCybercabArticle(db, 101);
    await setEmergencyStop(env, true);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(r.status, 423, JSON.stringify(r.body));
    assert.equal(r.body.status, 'blocked');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(101).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE agent = 'fact-checking'").get().n, 0,
      'no task created while stopped');
  });

  it('a protected article is ALLOWED a re-check (advisory-only) and its body is byte-identical afterwards', async () => {
    const { db, env } = freshEnv();
    // Article #26 is protected by the constant fallback (owner order).
    // A re-check writes fact_checks / claim_checks audit rows only and
    // never touches the article row — the same scope as the daily
    // factCheckRun step — so protection does not block it.
    seedCybercabArticle(db, 26);
    const before = db.prepare('SELECT body, excerpt, seo_description FROM articles WHERE id = ?').get(26);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/26/recheck');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'completed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(26).n, 1,
      'the advisory check ran and wrote its audit row');
    const after = db.prepare('SELECT body, excerpt, seo_description FROM articles WHERE id = ?').get(26);
    assert.equal(after.body, before.body, 'body untouched');
    assert.equal(after.excerpt, before.excerpt, 'excerpt untouched');
    assert.equal(after.seo_description, before.seo_description, 'seo_description untouched');
    assert.equal(db.prepare('SELECT fact_checked FROM articles WHERE id = ?').get(26).fact_checked, 0);
  });

  it('a protected flag (is_protected=1) does not block a re-check on any article id', async () => {
    const { db, env } = freshEnv();
    insertArticle(db, CYBERCAB_BODY, { id: 102, isProtected: 1 });
    const itemId = insertResearchItem(db, {
      title: 'Tesla Cybercab factory at Giga Berlin',
      url: CYBERCAB_URL,
      summary: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
      evidence: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
    });
    addArticleSource(db, 102, CYBERCAB_URL, itemId);
    const before = db.prepare('SELECT body FROM articles WHERE id = ?').get(102);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/102/recheck');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'completed');
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(102).body, before.body, 'body untouched');
  });

  it('a published article (409) and an unknown article (404) are refused', async () => {
    const { db, env } = freshEnv();
    seedCybercabArticle(db, 101);
    db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(101);
    const published = await callAutonomy(env, 'POST', '/api/autonomy/articles/101/recheck');
    assert.equal(published.status, 409, JSON.stringify(published.body));
    const missing = await callAutonomy(env, 'POST', '/api/autonomy/articles/99999/recheck');
    assert.equal(missing.status, 404);
  });
});
