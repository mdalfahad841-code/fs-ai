// FS AI — Fix Pass 2 item 1: manual publish must respect the gate
// (2026-11-23).
//
// Before this item the dashboard Publish button (POST
// /api/admin/articles/:id/publish) published immediately, even when
// the quality gate was Blocked. Now the endpoint runs the SAME gate
// (evaluatePublishGate, via evaluateManualPublishGate):
//   - content checks 1–7 + Emergency Stop + daily limit must pass on
//     the normal path; publishing-rules (check 10) is excluded — it
//     governs auto-publishing, and requiring it would make the button
//     dead under the live 'approved_only' default.
//   - a Blocked gate refuses 422 with the failed-check reason list
//     (names + details) in the response.
//   - the exact typed phrase PUBLISH DESPITE GATE overrides (audited);
//     a wrong phrase refuses; the Emergency Stop can never be
//     overridden; protected #26/#27 refuse 403 always; legacy drafts
//     #28–#31/#33 publish only via the audited override.
//   - Health/Finance keep their human-review flag: typing the phrase
//     IS the human review, and the audit row records it.
//   - the auto-publish path (publishDueArticles, publishGatePassed)
//     is untouched.
//
// Real SQLite databases (schema + seed + migrations 005/006/008/009/
// 010/011/012/017/019/023/032). Fixture articles only, explicit ids
// 28/26 for the protected cases — never a live article. No network,
// no live D1. Run: node --test tests/fixpass2-item1.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAdminArticles, publishDueArticles } = require('../backend/routes/admin-articles.js');
const {
  evaluateManualPublishGate, publishGatePassed,
  MANUAL_PUBLISH_OVERRIDE_PHRASE, MANUAL_PUBLISH_PROTECTED_IDS,
} = require('../backend/publishing/gate.js');
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

function item1Env() {
  const db = buildDb(FILES);
  return { db, env: { DB: makeRealD1(db) } };
}

const BODY_AUTO = 'EV sales reached 14 million units worldwide in 2023. A home charger adds about 40 kilometres of range per hour of charging.';
const BODY_HEALTH_NODISC = 'Walking 30 minutes a day improves heart health and mood.';
const BODY_HEALTH_DISC = 'Walking 30 minutes a day improves heart health and mood. General information only — not medical advice.';

let draftCounter = 0;

function insertDraft(db, { id = null, divisionId = 1, body = BODY_AUTO, status = 'draft' } = {}) {
  draftCounter += 1;
  // Auto ids start at 100: the seed holds 1–25, and a fresh article
  // must never land on 26/27 (flag-protected) or 28–31/33 (manual-
  // publish legacy list) — explicit-id tests insert those ids
  // themselves. Slugs come from the same counter, so two drafts in
  // one test can never collide on the UNIQUE slug.
  const useId = id === null ? 100 + draftCounter : id;
  const r = db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(useId, divisionId, `Manual Gate Test Article ${useId}`, `manual-gate-test-${useId}`, 'test', body, 'FS AI', status, 0);
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

function publishReq(id, body) {
  const opts = { method: 'POST', headers: { 'content-type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return new Request(`http://localhost/api/admin/articles/${id}/publish`, opts);
}

function unpublishReq(id) {
  return new Request(`http://localhost/api/admin/articles/${id}/unpublish`, { method: 'POST' });
}

function auditRows(db, articleId) {
  return db.prepare('SELECT * FROM article_publish_overrides WHERE article_id = ? ORDER BY id ASC').all(articleId);
}

describe('manual publish — the gate is enforced on the normal path', () => {
  it('a bare draft is refused 422 with the failed-check reason list', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.match(data.error, /Publish gate is Blocked/);
    assert.ok(data.gate, 'the refusal carries the gate report');
    assert.ok(data.gate.blockedBy.some((d) => /No fact-check on record/.test(d)), JSON.stringify(data.gate.blockedBy));
    assert.ok(data.gate.blockedBy.some((d) => /No SEO check on record/.test(d)), JSON.stringify(data.gate.blockedBy));
    assert.ok(data.gate.failedChecks.includes('fact-check-pass'), JSON.stringify(data.gate.failedChecks));
    assert.ok(data.gate.failedChecks.includes('seo-pass'), JSON.stringify(data.gate.failedChecks));
    assert.equal(data.gate.contentReady, false);
    assert.equal(loadArticle(db, id).status, 'draft', 'a refused publish changes nothing');
    assert.equal(loadArticle(db, id).published_at, null);
    assert.equal(auditRows(db, id).length, 0, 'a refusal writes no audit row');
  });

  it('a gate-passing article publishes on the normal path and writes no audit row', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    const data = await res.json();
    assert.equal(data.article.status, 'published');
    assert.ok(data.article.published_at, 'publish stamps published_at');
    assert.equal(data.overridden, undefined, 'the normal path is not an override');
    assert.equal(auditRows(db, id).length, 0, 'the normal path writes no audit row');
  });

  it('an already-published article is refused (re-stamping is not a silent no-op)', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    assert.equal((await handleAdminArticles(publishReq(id), env, {}, AUTH)).status, 200);
    const again = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(again.status, 422);
    assert.match((await again.json()).error, /already published/);
    assert.equal(loadArticle(db, id).status, 'published');
  });

  it('unpublish is unaffected by the gate', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    assert.equal((await handleAdminArticles(publishReq(id), env, {}, AUTH)).status, 200);
    const res = await handleAdminArticles(unpublishReq(id), env, {}, AUTH);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).article.status, 'draft');
    assert.equal(loadArticle(db, id).published_at, null);
  });

  it('a malformed JSON body is a 400, not a publish', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    const res = await handleAdminArticles(
      new Request(`http://localhost/api/admin/articles/${id}/publish`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json',
      }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Invalid JSON body/);
    assert.equal(loadArticle(db, id).status, 'draft');
  });

  it('a gate that cannot be evaluated refuses 503 (fail-closed)', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    // article_sources is a leaf table (nothing references it), so
    // dropping it makes the gate's sources read throw — the publish
    // must refuse 503 instead of publishing past an unverifiable gate.
    db.exec('DROP TABLE article_sources');
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /Could not evaluate the publish gate/);
    assert.equal(loadArticle(db, id).status, 'draft');
  });
});

describe('manual publish — the typed-phrase override', () => {
  it('the override phrase is exactly PUBLISH DESPITE GATE', () => {
    assert.equal(PHRASE, 'PUBLISH DESPITE GATE');
  });

  it('a wrong phrase refuses and publishes nothing', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    for (const wrong of ['publish', 'publish despite gate', 'PUBLISH DESPITE GATE ', 'PUBLISH DESPITE GAT']) {
      const res = await handleAdminArticles(publishReq(id, { override: wrong }), env, {}, AUTH);
      assert.equal(res.status, 422, `phrase ${JSON.stringify(wrong)} must refuse`);
      assert.match((await res.json()).error, /Override phrase is incorrect/);
      assert.equal(loadArticle(db, id).status, 'draft');
    }
    assert.equal(auditRows(db, id).length, 0);
  });

  it('the exact phrase publishes a Blocked article and writes the audit row', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    const data = await res.json();
    assert.equal(data.article.status, 'published');
    assert.equal(data.overridden, true);
    const rows = auditRows(db, id);
    assert.equal(rows.length, 1, 'exactly one audit row');
    const row = rows[0];
    assert.equal(row.article_id, id);
    assert.equal(row.title, `Manual Gate Test Article ${id}`);
    assert.equal(row.division, 'automotive');
    assert.equal(row.published_by, 'test-owner@example.com');
    assert.equal(row.human_review_applied, 0, 'automotive needs no special review');
    const gateResult = JSON.parse(row.gate_result);
    assert.equal(gateResult.contentReady, false);
    assert.ok(gateResult.blockedBy.some((d) => /No fact-check on record/.test(d)), JSON.stringify(gateResult.blockedBy));
    assert.ok(gateResult.failedChecks.includes('fact-check-pass'));
    assert.equal(gateResult.legacyProtected, false);
    assert.ok(gateResult.overriddenAt, 'the audit records when the override happened');
  });

  it('an override on a gate-passing article is audited too (the phrase was invoked)', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).overridden, true);
    const rows = auditRows(db, id);
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].gate_result).blockedBy, [], 'the gate passed — nothing was overridden over');
  });

  it('an override refused by a missing audit table publishes nothing (fail-closed)', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    db.exec('DROP TABLE article_publish_overrides');
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /Could not record the publish-override audit/);
    assert.equal(loadArticle(db, id).status, 'draft', 'no unaudited override can happen');
  });
});

describe('manual publish — protected legacy drafts #28–#31/#33', () => {
  it('the protected list is exactly 28, 29, 30, 31, 33', () => {
    assert.deepEqual([...MANUAL_PUBLISH_PROTECTED_IDS].sort((a, b) => a - b), [28, 29, 30, 31, 33]);
  });

  it('id 28 with a PASSING gate still refuses on the normal path', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { id: 28 });
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.gate.legacyProtected, true);
    assert.ok(data.gate.blockedBy.some((d) => /protected legacy draft/.test(d)), JSON.stringify(data.gate.blockedBy));
    assert.equal(loadArticle(db, id).status, 'draft');
    assert.equal(auditRows(db, id).length, 0);
  });

  it('id 28 publishes with the exact phrase and the audit records the legacy flag', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { id: 28 });
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 200);
    const rows = auditRows(db, id);
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].gate_result).legacyProtected, true);
  });

  it('every other legacy id refuses on the normal path', async () => {
    const { db, env } = item1Env();
    for (const legacyId of [29, 30, 31, 33]) {
      const id = insertDraft(db, { id: legacyId });
      await seedGatePass(db, id);
      const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
      assert.equal(res.status, 422, `id ${legacyId} must refuse on the normal path`);
      assert.match((await res.json()).error, /protected legacy draft/);
      assert.equal(loadArticle(db, id).status, 'draft');
    }
  });

  it('id 26 (flag-protected) refuses 403 even with the exact phrase', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { id: 26 });
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /protected/);
    assert.equal(loadArticle(db, id).status, 'draft');
    assert.equal(auditRows(db, id).length, 0, 'a refused override writes no audit row');
  });
});

describe('manual publish — Health/Finance human review', () => {
  it('a health article without the disclaimer is Blocked on the normal path', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { divisionId: 7, body: BODY_HEALTH_NODISC });
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.ok(data.gate.failedChecks.includes('special-review'), JSON.stringify(data.gate.failedChecks));
    assert.ok(data.gate.blockedBy.some((d) => /disclaimer missing/.test(d)), JSON.stringify(data.gate.blockedBy));
    assert.equal(loadArticle(db, id).status, 'draft');
  });

  it('the same health article publishes with the override and the audit records human review', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { divisionId: 7, body: BODY_HEALTH_NODISC });
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(res.status, 200);
    const rows = auditRows(db, id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].division, 'health-wellness');
    assert.equal(rows[0].human_review_applied, 1, 'typing the phrase IS the human review for Health');
    assert.equal(JSON.parse(rows[0].gate_result).division, 'health-wellness');
  });

  it('a health article WITH the disclaimer passes the normal path (gate behaviour unchanged)', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { divisionId: 7, body: BODY_HEALTH_DISC });
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 200, 'the disclaimer satisfies the special-review check — no override needed');
    assert.equal(auditRows(db, id).length, 0);
  });
});

describe('manual publish — Emergency Stop and daily limit', () => {
  it('E-Stop ON refuses the normal path and the override alike', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    db.prepare(
      "INSERT INTO website_settings (setting_key, setting_value) VALUES ('emergency_stop', '1') ON CONFLICT(setting_key) DO UPDATE SET setting_value = '1'",
    ).run();
    const plain = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(plain.status, 422);
    assert.match((await plain.json()).error, /Emergency Stop is ON/);
    const over = await handleAdminArticles(publishReq(id, { override: PHRASE }), env, {}, AUTH);
    assert.equal(over.status, 422, 'the phrase cannot bypass the Emergency Stop');
    assert.match((await over.json()).error, /Emergency Stop is ON/);
    assert.equal(loadArticle(db, id).status, 'draft');
    assert.equal(auditRows(db, id).length, 0);
  });

  it('daily limit blocks the normal path but not the audited override', async () => {
    const { db, env } = item1Env();
    const first = insertDraft(db);
    await seedGatePass(db, first);
    assert.equal((await handleAdminArticles(publishReq(first), env, {}, AUTH)).status, 200);
    const second = insertDraft(db);
    await seedGatePass(db, second);
    const blocked = await handleAdminArticles(publishReq(second), env, {}, AUTH);
    assert.equal(blocked.status, 422);
    const blockedData = await blocked.json();
    assert.ok(blockedData.gate.failedChecks.includes('daily-limit'), JSON.stringify(blockedData.gate.failedChecks));
    assert.ok(blockedData.gate.blockedBy.some((d) => /Published today: 1\/1/.test(d)), JSON.stringify(blockedData.gate.blockedBy));
    const over = await handleAdminArticles(publishReq(second, { override: PHRASE }), env, {}, AUTH);
    assert.equal(over.status, 200);
    assert.equal(auditRows(db, second).length, 1);
    assert.equal(loadArticle(db, second).status, 'published');
  });
});

describe('manual publish — the gate verdict helper', () => {
  it('the manual verdict ignores publishing-rules but keeps every other check', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    await seedGatePass(db, id);
    const v = await evaluateManualPublishGate(env, id);
    assert.equal(v.allowed, true, JSON.stringify(v));
    assert.equal(v.contentReady, true);
    // publishing-rules fails under the live 'approved_only' default —
    // the manual verdict must not count it.
    const rules = v.checks.find((c) => c.name === 'publishing-rules');
    assert.equal(rules.ok, false, 'publishing-rules fails (approved_only) and must be ignored here');
    assert.deepEqual(v.blockedBy, []);
    assert.equal(v.emergencyStopOn, false);
    assert.equal(v.legacyProtected, false);
  });

  it('the manual verdict refuses a Blocked article and names the failed checks', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    const v = await evaluateManualPublishGate(env, id);
    assert.equal(v.allowed, false);
    assert.ok(v.failedChecks.includes('fact-check-pass'));
    assert.ok(v.failedChecks.includes('seo-pass'));
    assert.ok(!v.failedChecks.includes('publishing-rules'), 'publishing-rules is never a manual blocker');
  });
});

describe('manual publish — auto-publish path unaffected', () => {
  it('publishDueArticles still publishes a due approved article (no gate on the scheduled path)', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db, { status: 'approved' });
    db.prepare('UPDATE articles SET publish_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    const result = await publishDueArticles(env);
    assert.equal(result.ok, true);
    assert.equal(result.published, 1);
    assert.equal(loadArticle(db, id).status, 'published');
  });

  it('publishGatePassed still refuses a gate-blocked article', async () => {
    const { db, env } = item1Env();
    const id = insertDraft(db);
    const r = await publishGatePassed(env, id);
    assert.equal(r.ok, false);
    assert.match(r.error, /Publish gate not passed/);
    assert.equal(loadArticle(db, id).status, 'draft');
  });
});

describe('manual publish — dashboard wiring (shipped files)', () => {
  it('dashboard.js posts the override phrase and handles the 422 gate report', () => {
    const js = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'dashboard.js'), 'utf8');
    assert.ok(js.includes('PUBLISH DESPITE GATE'), 'the dashboard must show the exact phrase');
    assert.ok(js.includes('body: { override: phrase }'), 'the confirm button must send the typed phrase as JSON');
    assert.ok(js.includes('articlePublishOverride'), 'the override block must be wired');
    assert.ok(js.includes('gate overridden — audit recorded'), 'success must say the override was audited');
    assert.ok(js.includes("r.data.gate"), 'the 422 handler must read the gate report from the response');
    assert.ok(js.includes('data-article-action="publish"'), 'the Publish button action must still exist');
  });

  it('dashboard.html carries the override block with the exact phrase as its placeholder', () => {
    const html = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'dashboard.html'), 'utf8');
    for (const id of ['articlePublishOverride', 'articlePublishOverrideInput', 'articlePublishOverrideConfirm', 'articlePublishOverrideCancel']) {
      assert.ok(html.includes(`id="${id}"`), `missing override element: ${id}`);
    }
    assert.ok(html.includes('placeholder="PUBLISH DESPITE GATE"'), 'the input must show the exact phrase');
  });

  it('migration 032 applies cleanly after 001–031 and creates the audit table', () => {
    const files = fs.readdirSync(path.join(ROOT, 'database', 'migrations'))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort()
      .map((f) => 'database/migrations/' + f);
    assert.equal(files.length, 32, 'migrations 001–032 all present');
    const db = buildDb(files);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'article_publish_overrides'").get();
    assert.ok(table, 'article_publish_overrides exists after the full chain');
    const cols = db.prepare('PRAGMA table_info(article_publish_overrides)').all().map((c) => c.name);
    for (const col of ['article_id', 'title', 'slug', 'division', 'published_by', 'gate_result', 'human_review_applied', 'created_at']) {
      assert.ok(cols.includes(col), `missing column: ${col}`);
    }
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_article_publish_overrides_%'").all();
    assert.equal(idx.length, 2, 'two override-audit indexes');
  });
});
