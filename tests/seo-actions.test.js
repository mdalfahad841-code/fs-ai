// FS AI — Fix 6 regression tests: per-article SEO (2026-11-20).
//
// POST /api/autonomy/articles/:id/seo-check (check-only: the real
// 11-check suite, never modifies the article) vs POST
// /api/autonomy/articles/:id/seo-optimize (repairSeoFields, unprotected
// drafts only). Covered: check writes nothing to the article, stores
// all 11 results, readability failures carry an actionable Fix line;
// optimize repairs an unprotected draft; protected articles are
// refused for optimize with the protected reason but ALLOWED for
// check-only; Check vs Optimize are distinguishable in the response
// (action + repairs); both record which article version they ran
// against. Also: the readability check itself (seo.js) explains what
// to change when it fails.
// Real SQLite database (tests/phase2-harness.js). No network except
// the stubbed fetch for the broken-link check.
// Run: node --test tests/seo-actions.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  freshEnv, loadArticle, insertArticle, callAutonomy,
} = require('./phase2-harness.js');
const { runSeoCheckSuite } = require('../backend/agents/autonomy/seo.js');
const { setEmergencyStop } = require('../backend/routes/admin.js');

const LONG_PARA = 'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep. Most drivers find that home charging covers daily driving with ease and saves money every month.';

// Two very long sentences: average sentence length is far above the
// 25-word target, so the readability check must fail — with a Fix line.
const LONG_SENTENCE_BODY = [
  'Charging an electric car at home is usually the cheapest and most convenient option for most drivers because the vehicle charges overnight while the owner sleeps and the battery is completely full again by the morning without any extra effort whatsoever.',
  'A home charger plugs into the car overnight and fills the battery while you sleep, which means that most drivers find that home charging covers daily driving with ease and saves a considerable amount of money every single month.',
].join(' ');

const H3_BODY = [
  '### First section', '', LONG_PARA, '',
  '### Second section', '', LONG_PARA, '',
  '### Third section', '', LONG_PARA,
].join('\n');

const GOOD_SEO_TITLE = "EV Charging at Home: A Complete Beginner Guide";

function stubFetch(env) {
  env.__fetchImpl = async () => new Response('', { status: 200 });
}

describe('readability check (seo.js)', () => {
  it('a failing readability check carries an actionable Fix line (sentence-length target + what to change)', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, LONG_SENTENCE_BODY, { id: 101, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    assert.equal(suite.checks.length, 11, 'all 11 checks run');
    const readability = suite.checks.find((c) => c.name === 'readability');
    assert.ok(readability, 'readability check present');
    assert.equal(readability.ok, false, 'long sentences fail readability');
    assert.match(readability.detail, /Fix:/, 'the failure explains how to fix it');
    assert.match(readability.detail, /split long sentences/i);
    assert.match(readability.detail, /15-20 words per sentence/);
    assert.match(readability.detail, /avg sentence \d+\.\d words/);
  });

  it('a readable body passes without needing a Fix line', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, LONG_PARA, { id: 101, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const suite = await runSeoCheckSuite(env, loadArticle(db, id));
    const readability = suite.checks.find((c) => c.name === 'readability');
    assert.equal(readability.ok, true);
  });
});

describe('POST /api/autonomy/articles/:id/seo-check (check-only)', () => {
  it('stores all 11 results, writes nothing to the article, and records the article version', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, LONG_SENTENCE_BODY, { id: 101, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const before = db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(id);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/articles/${id}/seo-check`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'check', 'Check is distinguishable from Optimize');
    assert.equal(r.body.protected, false);
    assert.equal(r.body.verdict, 'needs-review');
    assert.equal(r.body.checks.length, 11, 'all 11 individual results stored');
    assert.ok(r.body.seoCheckId, 'the stored seo_checks row id is returned');
    assert.ok(r.body.checks.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean' && typeof c.detail === 'string'));
    const readability = r.body.checks.find((c) => c.name === 'readability');
    assert.equal(readability.ok, false);
    assert.match(readability.detail, /Fix:.*split long sentences/i);
    assert.ok(!('repairs' in r.body), 'a check response carries no repairs');
    const after = db.prepare('SELECT body, seo_title, seo_description FROM articles WHERE id = ?').get(id);
    assert.deepEqual(after, before, 'body, seo title and seo description are untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0,
      'no revision row — nothing was repaired');
    assert.equal(r.body.articleVersion.bodyChars, LONG_SENTENCE_BODY.length);
    assert.equal(r.body.articleVersion.revisionCount, 0);
    const stored = db.prepare('SELECT * FROM seo_checks WHERE id = ?').get(r.body.seoCheckId);
    assert.equal(stored.article_id, id);
    assert.equal(stored.verdict, 'needs-review');
    assert.equal(JSON.parse(stored.checks_json).length, 11);
  });

  it('is ALLOWED for a protected article (check-only writes nothing to it)', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    // Article #26 is protected by the constant fallback (owner order).
    const id = insertArticle(db, LONG_SENTENCE_BODY, { id: 26, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const before = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/26/seo-check');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'check');
    assert.equal(r.body.protected, true, 'the response says the article is protected — and still checked it');
    assert.equal(r.body.checks.length, 11);
    const after = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    assert.deepEqual(after, before, 'protected body untouched by a check-only run');
  });

  it('is blocked by the Emergency Stop (423) with no seo_checks row', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, LONG_SENTENCE_BODY, { id: 101, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    await setEmergencyStop(env, true);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/articles/${id}/seo-check`);
    assert.equal(r.status, 423, JSON.stringify(r.body));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?').get(id).n, 0);
  });

  it('404 for an unknown article', async () => {
    const { env } = freshEnv();
    assert.equal((await callAutonomy(env, 'POST', '/api/autonomy/articles/99999/seo-check')).status, 404);
  });
});

describe('POST /api/autonomy/articles/:id/seo-optimize', () => {
  it('repairs an unprotected draft (description, H2 promotion, internal link) and records the version', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    db.prepare("INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at) VALUES (1, 'Published Sibling Article', 'published-sibling', 'x', 'Sibling body text here.', 'FS AI', 'published', 0, '2026-11-19T00:00:00.000Z')").run();
    const id = insertArticle(db, H3_BODY, { id: 101, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const r = await callAutonomy(env, 'POST', `/api/autonomy/articles/${id}/seo-optimize`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'optimize', 'Optimize is distinguishable from Check');
    assert.equal(r.body.protected, false);
    assert.ok(Array.isArray(r.body.repairs) && r.body.repairs.length >= 3,
      `expected repairs, got: ${JSON.stringify(r.body.repairs)}`);
    assert.ok(r.body.repairedFields.includes('seo_description'));
    assert.equal(r.body.checks.length, 11);
    assert.ok(r.body.seoCheckId);
    const row = db.prepare('SELECT seo_description, body FROM articles WHERE id = ?').get(id);
    assert.ok(row.seo_description.length >= 120 && row.seo_description.length <= 160,
      `repaired description is ${row.seo_description.length} chars`);
    assert.match(row.body, /Related reading: \[Published Sibling Article\]/, 'genuine internal link appended');
    assert.ok((row.body.match(/^##\s.+$/gm) || []).length >= 2, 'H3s promoted to H2s');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 1,
      'pre-edit body stored as a revision first');
    assert.equal(r.body.articleVersion.revisionCount, 1, 'the version reflects the repair revision');
  });

  it('refuses a protected article with the protected reason (403) and changes nothing', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, H3_BODY, { id: 26, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const before = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/articles/26/seo-optimize');
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.protected, true);
    assert.match(r.body.error, /protected/i);
    assert.match(r.body.error, /automatic modification disabled/i);
    const after = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    assert.deepEqual(after, before, 'protected article untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?').get(id).n, 0,
      'no SEO run was stored for the refused optimize');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('refuses a protected flag (is_protected=1) on any article id, and refuses published articles (409)', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const flagged = insertArticle(db, H3_BODY, { id: 102, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.', isProtected: 1 });
    const r1 = await callAutonomy(env, 'POST', `/api/autonomy/articles/${flagged}/seo-optimize`);
    assert.equal(r1.status, 403, JSON.stringify(r1.body));
    assert.equal(r1.body.protected, true);
    const pub = insertArticle(db, H3_BODY, { id: 103, status: 'published', seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    const before = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(pub);
    const r2 = await callAutonomy(env, 'POST', `/api/autonomy/articles/${pub}/seo-optimize`);
    assert.equal(r2.status, 409, JSON.stringify(r2.body));
    const after = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(pub);
    assert.deepEqual(after, before, 'published article untouched');
  });

  it('is blocked by the Emergency Stop (423) with no repair and no seo_checks row', async () => {
    const { db, env } = freshEnv();
    stubFetch(env);
    const id = insertArticle(db, H3_BODY, { id: 101, seoTitle: GOOD_SEO_TITLE, seoDescription: 'Too short.' });
    await setEmergencyStop(env, true);
    const r = await callAutonomy(env, 'POST', `/api/autonomy/articles/${id}/seo-optimize`);
    assert.equal(r.status, 423, JSON.stringify(r.body));
    assert.equal(db.prepare('SELECT seo_description FROM articles WHERE id = ?').get(id).seo_description, 'Too short.');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_checks WHERE article_id = ?').get(id).n, 0);
  });

  it('404 for an unknown article', async () => {
    const { env } = freshEnv();
    assert.equal((await callAutonomy(env, 'POST', '/api/autonomy/articles/99999/seo-optimize')).status, 404);
  });
});
