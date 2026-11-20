// FS AI — publish gate tests.
//
// evaluatePublishGate() reports two verdicts: `contentReady` (all
// content checks pass — the article is ready for owner approval) and
// `eligible` (contentReady AND auto-publishing is permitted right now:
// mode not 'approved_only' AND auto_publishing 'on'). With the live
// default (publishing_mode 'approved_only') eligible is always false and
// nothing auto-publishes; publishGatePassed() refuses until the gate is
// fully eligible. When it does approve, it sets fact_checked=1 and
// records a pre-approval revision — the fact-checker itself never sets it.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011/012).
// Run: node --test tests/publish-gate.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { evaluatePublishGate, publishGatePassed } = require('../backend/publishing/gate.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');

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
    'database/migrations/019_factcheck_body_hash.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertDraft(db, { divisionId = 1, body = 'EV sales reached 14 million units worldwide in 2023. A home charger adds about 40 kilometres of range per hour of charging.' } = {}) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Gate Test Article', 'gate-test-article', 'test', ?, 'FS AI', 'draft', 0)",
  ).run(divisionId, body);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

/** Make the article pass every CONTENT check (fact-check + sources + SEO + duplicate).
 * The seeded fact-check is a genuinely FRESH run: its body_hash is the
 * hash of the article's current body, exactly as checkArticle would
 * record it (migration 019) — a hash-less legacy row is stale at the
 * gate and would fail checks 1-3. */
async function makeContentReady(db, articleId, { factVerdict = 'pass', seoVerdict = 'pass' } = {}) {
  const article = loadArticle(db, articleId);
  const hash = await bodyHash(article.body);
  const fc = db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, ?, 2, 2, 0, ?)',
  ).run(articleId, factVerdict, hash);
  const fcId = Number(fc.lastInsertRowid);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'EV sales reached 14 million units worldwide in 2023.', 'VERIFIED', 'https://example.com/source-1', 'EV sales reached 14 million units.', 'Supported by fetched source material.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'A home charger adds about 40 kilometres of range per hour.', 'VERIFIED', 'https://example.com/source-2', 'A home charger adds about 40 kilometres of range per hour.', 'Supported by fetched source material.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId);
  const checksJson = JSON.stringify([
    { name: 'seo-title', ok: true }, { name: 'duplicate', ok: true, detail: 'Highest 5-word shingle overlap: 3%.' },
  ]);
  db.prepare('INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, ?, ?)').run(articleId, seoVerdict, checksJson);
  return fcId;
}

function setSetting(db, key, value) {
  db.prepare('UPDATE autonomy_settings SET value = ? WHERE key = ?').run(value, key);
}

function setEmergencyStop(db, on) {
  db.prepare("INSERT OR REPLACE INTO website_settings (setting_key, setting_value) VALUES ('emergency_stop', ?)").run(on ? '1' : '0');
}

function checkByName(gate, name) {
  return gate.checks.find((c) => c.name === name);
}

describe('evaluatePublishGate', () => {
  it('blocks an article with no fact-check or SEO on record', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, false);
    assert.equal(gate.eligible, false);
    assert.equal(checkByName(gate, 'fact-check-pass').ok, false);
    assert.equal(checkByName(gate, 'seo-pass').ok, false);
    assert.equal(checkByName(gate, 'duplicate-pass').ok, false);
    assert.ok(gate.blockedBy.some((b) => b.includes('No fact-check')));
    assert.ok(gate.blockedBy.some((b) => b.includes('No SEO check')));
  });

  it('contentReady=true but eligible=false under the live default (approved_only)', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, true, JSON.stringify(gate.contentBlockers));
    assert.equal(gate.eligible, false, 'approved_only must never auto-publish');
    assert.equal(gate.publishingMode, 'approved_only');
    assert.equal(checkByName(gate, 'publishing-rules').ok, false);
    assert.match(checkByName(gate, 'publishing-rules').detail, /approved_only/);
    // Every content check passes; only the publishing-rules check blocks.
    assert.deepEqual(gate.contentBlockers, []);
  });

  it('auto_publishing on alone does NOT make the gate eligible while mode is approved_only', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    setSetting(db, 'auto_publishing', 'on');
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, true);
    assert.equal(gate.eligible, false, 'the toggle alone must never publish');
  });

  it('eligible=true only when content is ready AND mode permits AND auto_publishing is on', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    // NOTE: publishing_mode can only be changed by a direct settings write
    // in this test. The owner API (orchestrator SETTING_RULES) still
    // refuses any value other than 'approved_only' — the mode switch has
    // no UI/API path yet, by design, until live verification.
    setSetting(db, 'publishing_mode', 'auto');
    setSetting(db, 'auto_publishing', 'on');
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, true);
    assert.equal(gate.eligible, true, JSON.stringify(gate.blockedBy));
    assert.deepEqual(gate.blockedBy, []);
  });

  it('mode permitting but auto_publishing off is still not eligible', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    setSetting(db, 'publishing_mode', 'auto');
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.eligible, false, 'the toggle must also be on');
    assert.match(checkByName(gate, 'publishing-rules').detail, /Auto-publishing is off/);
  });

  it('Emergency Stop ON blocks eligibility but not content readiness', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    setSetting(db, 'publishing_mode', 'auto');
    setSetting(db, 'auto_publishing', 'on');
    setEmergencyStop(db, true);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, true, 'E-Stop is not a content check');
    assert.equal(gate.eligible, false);
    assert.equal(checkByName(gate, 'emergency-stop-off').ok, false);
  });

  it('daily limit 0 blocks eligibility', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    setSetting(db, 'publishing_mode', 'auto');
    setSetting(db, 'auto_publishing', 'on');
    setSetting(db, 'max_articles_per_day', '0');
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.eligible, false);
    assert.equal(checkByName(gate, 'daily-limit').ok, false);
    assert.match(checkByName(gate, 'daily-limit').detail, /0\/0/);
  });

  it('a failed fact-check blocks content readiness', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id, { factVerdict: 'failed' });
    // Mark the claims failed to match the failed verdict.
    db.prepare("UPDATE claim_checks SET verdict = 'UNSUPPORTED', evidence_url = NULL WHERE fact_check_id = (SELECT id FROM fact_checks WHERE article_id = ? ORDER BY id DESC LIMIT 1)").run(id);
    db.prepare('UPDATE fact_checks SET claims_failed = 2, claims_verified = 0 WHERE article_id = ?').run(id);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, false);
    assert.equal(gate.eligible, false);
    assert.equal(checkByName(gate, 'fact-check-pass').ok, false);
    assert.equal(checkByName(gate, 'no-unresolved-errors').ok, false);
  });

  it('an open correction blocks content readiness', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    const fcId = await makeContentReady(db, id);
    const claimId = db.prepare('SELECT id FROM claim_checks WHERE fact_check_id = ? LIMIT 1').get(fcId).id;
    db.prepare("INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status) VALUES (?, ?, 'old', NULL, 1, 'pending')").run(id, claimId);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, false);
    assert.equal(checkByName(gate, 'correction-recheck').ok, false);
  });

  it('health division without the disclaimer is blocked; with it, it passes', async () => {
    const { db, env } = freshEnv();
    const healthId = db.prepare('SELECT id FROM business_divisions WHERE slug = ?').get('health-wellness').id;
    const id = insertDraft(db, { divisionId: healthId });
    await makeContentReady(db, id);
    const blocked = await evaluatePublishGate(env, id);
    assert.equal(blocked.contentReady, false);
    assert.equal(checkByName(blocked, 'special-review').ok, false);
    assert.match(checkByName(blocked, 'special-review').detail, /disclaimer missing/);

    db.prepare('UPDATE articles SET body = body || ? WHERE id = ?').run('\n\nGeneral information only — this is not medical advice.', id);
    // The disclaimer edit changes the body, so the previous
    // fact-check is stale by design (migration 019) — a fresh
    // fact-check for the new body is required before the gate can pass.
    await makeContentReady(db, id);
    const passed = await evaluatePublishGate(env, id);
    assert.equal(checkByName(passed, 'special-review').ok, true);
    assert.equal(passed.contentReady, true);
  });

  it('invalid id and already-published article are never eligible', async () => {
    const { env } = freshEnv();
    const bad = await evaluatePublishGate(env, 'nope');
    assert.equal(bad.eligible, false);
    assert.ok(bad.blockedBy.some((b) => b.includes('Invalid article id')));

    const { db, env: env2 } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(id);
    const pub = await evaluatePublishGate(env2, id);
    assert.equal(pub.eligible, false);
    assert.equal(checkByName(pub, 'not-already-published').ok, false);
  });
});

describe('publishGatePassed', () => {
  it('refuses a content-ready article while mode is approved_only — nothing changes', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    const r = await publishGatePassed(env, id);
    assert.equal(r.ok, false);
    assert.match(r.error, /approved_only|not passed/);
    const after = loadArticle(db, id);
    assert.equal(after.status, 'draft');
    assert.equal(after.fact_checked, 0);
  });

  it('approves a fully eligible article: status approved, fact_checked=1, revision recorded', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    setSetting(db, 'publishing_mode', 'auto');
    setSetting(db, 'auto_publishing', 'on');
    const r = await publishGatePassed(env, id);
    assert.equal(r.ok, true);
    assert.equal(r.articleId, id);
    const after = loadArticle(db, id);
    assert.equal(after.status, 'approved');
    assert.equal(after.fact_checked, 1);
    assert.ok(after.publish_at, 'publish_at set so the hourly publisher picks it up');
    const rev = db.prepare("SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ? AND revised_by = 'publish-gate'").get(id).n;
    assert.equal(rev, 1, 'pre-approval revision recorded');
  });

  it('refuses when the Emergency Stop is on, and honours an explicit daily limit', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db);
    await makeContentReady(db, id);
    setSetting(db, 'publishing_mode', 'auto');
    setSetting(db, 'auto_publishing', 'on');
    setEmergencyStop(db, true);
    const stopped = await publishGatePassed(env, id);
    assert.equal(stopped.ok, false);
    assert.match(stopped.error, /Emergency Stop/);

    setEmergencyStop(db, false);
    const limited = await publishGatePassed(env, id, { dailyLimit: 0 });
    assert.equal(limited.ok, false);
    assert.match(limited.error, /Daily limit/);
  });
});
