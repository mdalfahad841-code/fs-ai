// FS AI — Fix 4 regression tests: failed-correction review (2026-11-20).
//
// GET /api/autonomy/corrections + POST /api/autonomy/corrections/:id/resolve.
// Every resolution state is covered, plus the forbidden paths:
//  - a click alone can never mark a claim VERIFIED (correctedText is
//    required and must pass a fresh fact-check against the article's
//    own evidence; a non-verifying text is a 422 and changes nothing);
//  - a correction record can never be silently deleted (no DELETE
//    exists; the row survives every resolution and its original status
//    is kept in the correction_resolutions history row);
//  - 'accepted-unresolved-removed' is rejected while the claim text
//    is still in the body (409).
// Real SQLite database (tests/phase2-harness.js). No network.
// Run: node --test tests/correction-review.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  freshEnv, loadArticle, insertArticle, insertResearchItem, addArticleSource,
  seedFailedCorrection, callAutonomy,
} = require('./phase2-harness.js');
const { checkArticle } = require('../backend/agents/autonomy/factcheck.js');
const { evaluatePublishGate } = require('../backend/publishing/gate.js');
const { setEmergencyStop } = require('../backend/routes/admin.js');

const CYBERCAB_URL = 'https://example.com/cybercab-berlin';
const CYBERCAB_BODY = 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026. Motorcycle sales rose 20 percent worldwide in 2025.';
const MOTO_CLAIM = 'Motorcycle sales rose 20 percent worldwide in 2025.';
const CYBERCAB_CLAIM = 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.';

function seedCybercabEvidence(db, articleId) {
  const itemId = insertResearchItem(db, {
    title: 'Tesla Cybercab factory at Giga Berlin',
    url: CYBERCAB_URL,
    summary: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
    evidence: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
  });
  addArticleSource(db, articleId, CYBERCAB_URL, itemId);
  return itemId;
}

function gateCheck4(env, articleId) {
  return evaluatePublishGate(env, articleId)
    .then((gate) => gate.checks.find((c) => c.name === 'correction-recheck'));
}

describe('GET /api/autonomy/corrections', () => {
  it('lists unresolved corrections with original claim, attempted correction, status, evidence and a derived failure reason', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM, { evidenceUrl: null });
    // A resolved row must NOT be listed.
    db.prepare("INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url) VALUES (?, ?, ?, ?, 1, 'applied', 'VERIFIED', ?)")
      .run(id, seeded.claimCheckId, 'An old claim that was fixed.', 'A fixed claim.', CYBERCAB_URL);

    const r = await callAutonomy(env, 'GET', `/api/autonomy/corrections?article_id=${id}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.articleId, id);
    assert.equal(r.body.total, 1, 'only the unresolved correction is listed');
    const c = r.body.corrections[0];
    assert.equal(c.id, seeded.correctionId);
    assert.equal(c.originalText, MOTO_CLAIM);
    assert.equal(c.attemptedCorrection, null);
    assert.equal(c.status, 'failed');
    assert.equal(c.recheckVerdict, 'CONFLICTING');
    assert.equal(c.evidenceUrl, null);
    assert.match(c.failureReason, /attempt 1 failed/i);
    assert.match(c.failureReason, /CONFLICTING/);
    assert.match(c.failureReason, /No evidence URL/);
    assert.deepEqual(c.resolutions, []);
  });

  it('a pending correction reports that no attempt has completed yet', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    db.prepare("INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url) VALUES (?, NULL, ?, NULL, 1, 'pending', NULL, NULL)")
      .run(id, MOTO_CLAIM);
    const r = await callAutonomy(env, 'GET', `/api/autonomy/corrections?article_id=${id}`);
    assert.equal(r.status, 200);
    assert.match(r.body.corrections[0].failureReason, /No correction attempt has completed/);
    assert.match(r.body.corrections[0].failureReason, /attempt 1 of max 3/);
  });

  it('400 without article_id, 404 for an unknown article', async () => {
    const { env } = freshEnv();
    assert.equal((await callAutonomy(env, 'GET', '/api/autonomy/corrections')).status, 400);
    assert.equal((await callAutonomy(env, 'GET', '/api/autonomy/corrections?article_id=99999')).status, 404);
  });
});

describe("resolve 'accepted-unresolved-removed'", () => {
  it('is rejected while the claim text is still in the body (409) and changes nothing', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'accepted-unresolved-removed',
    });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.claimStillPresent, true);
    const row = db.prepare('SELECT status FROM article_corrections WHERE id = ?').get(seeded.correctionId);
    assert.equal(row.status, 'failed', 'status unchanged');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM correction_resolutions').get().n, 0,
      'a rejected resolution writes no history row');
    const check4 = await gateCheck4(env, id);
    assert.equal(check4.ok, false, 'gate check 4 still blocks');
  });

  it('succeeds when the claim is verified absent: status becomes removed, history keeps the original status, gate check 4 clears', async () => {
    const { db, env } = freshEnv();
    // Body has no trace of the claim (it was removed by an earlier edit).
    const id = insertArticle(db, 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.', { id: 101 });
    const seeded = seedFailedCorrection(db, id, 'A citation fragment that was already removed from the body here.');
    const before = await gateCheck4(env, id);
    assert.equal(before.ok, false, 'gate check 4 blocks before the resolution');

    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'accepted-unresolved-removed', note: 'Citation fragment — nothing left to correct.',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.correction.status, 'removed');
    assert.equal(r.body.resolution, 'accepted-unresolved-removed');
    // The record survives: no silent delete, original status preserved.
    const row = db.prepare('SELECT * FROM article_corrections WHERE id = ?').get(seeded.correctionId);
    assert.ok(row, 'the correction row still exists');
    assert.equal(row.original_text, 'A citation fragment that was already removed from the body here.');
    const history = db.prepare('SELECT * FROM correction_resolutions WHERE correction_id = ?').all(seeded.correctionId);
    assert.equal(history.length, 1);
    assert.equal(history[0].previous_status, 'failed', 'original status kept in history');
    assert.equal(history[0].new_status, 'removed');
    assert.equal(history[0].resolution, 'accepted-unresolved-removed');
    assert.equal(history[0].resolved_by, 'owner');
    const after = await gateCheck4(env, id);
    assert.equal(after.ok, true, 'gate check 4 clears for this correction');
    assert.match(after.detail, /No open corrections/);
  });
});

describe("resolve 'manually-corrected-rechecked'", () => {
  it('marks the correction applied only after the supplied text VERIFIES against the article own evidence', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    seedCybercabEvidence(db, id);
    const checked = await checkArticle(env, loadArticle(db, id));
    assert.equal(checked.verdict, 'needs-review');
    const motoCheck = db.prepare("SELECT id, claim_text FROM claim_checks WHERE fact_check_id = ? AND claim_text LIKE '%Motorcycle%'").get(checked.factCheckId);
    assert.ok(motoCheck, 'the motorcycle claim was extracted');
    assert.equal(db.prepare('SELECT verdict FROM claim_checks WHERE id = ?').get(motoCheck.id).verdict, 'UNSUPPORTED');
    const corr = db.prepare(
      "INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url) VALUES (?, ?, ?, NULL, 1, 'failed', 'UNSUPPORTED', NULL)",
    ).run(id, motoCheck.id, motoCheck.claim_text);
    const correctionId = Number(corr.lastInsertRowid);

    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${correctionId}/resolve`, {
      resolution: 'manually-corrected-rechecked', correctedText: CYBERCAB_CLAIM,
      note: 'Replaced the unsupported motorcycle sentence with the sourced Cybercab fact.',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.correction.status, 'applied');
    assert.equal(r.body.correction.recheck_verdict, 'VERIFIED');
    assert.equal(r.body.correction.evidence_url, CYBERCAB_URL);
    assert.equal(r.body.verification.verdict, 'VERIFIED');
    assert.match(r.body.nextStep, /\/recheck$/);
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.ok(!body.includes(MOTO_CLAIM), 'the failed claim was replaced in the body');
    assert.ok(body.includes(CYBERCAB_CLAIM), 'the corrected text is in the body');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ? AND revised_by = ?').get(id, 'correction-review').n, 1,
      'the pre-edit body was revisioned first');
    const history = db.prepare('SELECT * FROM correction_resolutions WHERE correction_id = ?').all(correctionId);
    assert.equal(history.length, 1);
    assert.equal(history[0].verification_verdict, 'VERIFIED');
    assert.equal(history[0].corrected_text, CYBERCAB_CLAIM);
    const check4 = await gateCheck4(env, id);
    assert.equal(check4.ok, true, 'gate check 4 clears');
  });

  it('a click alone can never mark a claim VERIFIED: missing correctedText is a 400 and changes nothing', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'manually-corrected-rechecked',
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.error, /correctedText is required/);
    assert.equal(db.prepare('SELECT status FROM article_corrections WHERE id = ?').get(seeded.correctionId).status, 'failed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('a corrected text that does NOT verify is a 422 and changes nothing (no body edit, no status change)', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    seedCybercabEvidence(db, id);
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    const beforeBody = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'manually-corrected-rechecked',
      correctedText: 'Motorcycle sales rose 99 percent worldwide in 2030.',
    });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.verification.verdict, 'UNSUPPORTED');
    assert.equal(db.prepare('SELECT status FROM article_corrections WHERE id = ?').get(seeded.correctionId).status, 'failed');
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, beforeBody, 'body untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM correction_resolutions').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('refuses a protected article with a clear protected reason (403) and changes nothing', async () => {
    const { db, env } = freshEnv();
    // Article #26 is protected by the constant fallback (owner order).
    const id = insertArticle(db, CYBERCAB_BODY, { id: 26 });
    seedCybercabEvidence(db, id);
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'manually-corrected-rechecked', correctedText: CYBERCAB_CLAIM,
    });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.protected, true);
    assert.match(r.body.error, /protected/i);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, CYBERCAB_BODY);
    assert.equal(db.prepare('SELECT status FROM article_corrections WHERE id = ?').get(seeded.correctionId).status, 'failed');
  });

  it('is blocked by the Emergency Stop (423) and changes nothing', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    seedCybercabEvidence(db, id);
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    await setEmergencyStop(env, true);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'manually-corrected-rechecked', correctedText: CYBERCAB_CLAIM,
    });
    assert.equal(r.status, 423, JSON.stringify(r.body));
    assert.equal(db.prepare('SELECT status FROM article_corrections WHERE id = ?').get(seeded.correctionId).status, 'failed');
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, CYBERCAB_BODY);
  });
});

describe("resolve 'rejected-for-retry' and 'pending-human-review'", () => {
  it('rejected-for-retry returns the claim to pending and the gate keeps blocking until a retry succeeds', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'rejected-for-retry', note: 'Owner wants another attempt with better evidence.',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.correction.status, 'pending');
    assert.equal(r.body.attempts, 1);
    assert.equal(r.body.maxAttempts, 3);
    const history = db.prepare('SELECT * FROM correction_resolutions WHERE correction_id = ?').all(seeded.correctionId);
    assert.equal(history.length, 1);
    assert.equal(history[0].previous_status, 'failed');
    assert.equal(history[0].new_status, 'pending');
    const check4 = await gateCheck4(env, id);
    assert.equal(check4.ok, false, 'gate check 4 still counts the pending correction');
  });

  it('rejected-for-retry is refused at max 3 attempts (409)', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    // Two more attempts for the same claim (3 rows total = max).
    for (const attempt of [2, 3]) {
      db.prepare(
        "INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status, recheck_verdict, evidence_url) VALUES (?, ?, ?, NULL, ?, 'failed', 'UNSUPPORTED', NULL)",
      ).run(id, seeded.claimCheckId, MOTO_CLAIM, attempt);
    }
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'rejected-for-retry',
    });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.attempts, 3);
    assert.match(r.body.error, /Max 3/);
    assert.equal(db.prepare('SELECT status FROM article_corrections WHERE id = ?').get(seeded.correctionId).status, 'failed');
  });

  it('pending-human-review is an explicit hold: status unchanged, history recorded, gate still blocks', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, CYBERCAB_BODY, { id: 101 });
    const seeded = seedFailedCorrection(db, id, MOTO_CLAIM);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'pending-human-review', note: 'Owner will check the source himself.',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.correction.status, 'failed', 'hold changes no status');
    const history = db.prepare('SELECT * FROM correction_resolutions WHERE correction_id = ?').all(seeded.correctionId);
    assert.equal(history.length, 1);
    assert.equal(history[0].resolution, 'pending-human-review');
    assert.equal(history[0].previous_status, 'failed');
    assert.equal(history[0].new_status, 'failed');
    const check4 = await gateCheck4(env, id);
    assert.equal(check4.ok, false, 'gate check 4 still counts a held correction');
  });

  it('an unknown resolution is a 400 and an already-resolved correction is a 409', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.', { id: 101 });
    const seeded = seedFailedCorrection(db, id, 'A citation fragment that was already removed from the body here.');
    const bad = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'mark-verified',
    });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.match(bad.body.error, /resolution must be one of/);
    const ok = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'accepted-unresolved-removed',
    });
    assert.equal(ok.status, 200);
    const again = await callAutonomy(env, 'POST', `/api/autonomy/corrections/${seeded.correctionId}/resolve`, {
      resolution: 'pending-human-review',
    });
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.status, 'removed');
    const missing = await callAutonomy(env, 'POST', '/api/autonomy/corrections/99999/resolve', {
      resolution: 'pending-human-review',
    });
    assert.equal(missing.status, 404);
  });
});
