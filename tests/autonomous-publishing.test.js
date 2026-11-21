// FS AI — autonomous publishing tests (W3).
//
// Covers the single auto-publish evaluator (pure + D1-backed), the
// auto-publish path (new articles only, idempotent, interrupted
// publish rolls back), publication logs, sitemap regeneration and the
// per-division special-review rules.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012/019/021) — the same harness as tests/publish-gate.test.js.
// NOTE on the task's "use the existing fake-d1 harness": fake-d1
// cannot run any gate query — it has no autonomy_settings, fact_checks,
// seo_checks, article_sources or publication_logs tables and throws
// 'unsupported SELECT' for them — so the gate tests use this real
// SQLite harness instead. Pure-evaluator tests need no DB at all.
// Run: node --test tests/autonomous-publishing.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const {
  evaluateAutoPublishEligibility, evaluateAutoPublishEligibilityPure,
  LEGACY_AUTO_PUBLISH_REFUSED_IDS,
} = require('../backend/publishing/gate.js');
const {
  autoPublishArticle, runAutoPublish, regenerateSitemap,
  sitemapIncludesArticle, sitemapXmlForArticles, publicationLogTableExists,
} = require('../backend/agents/autonomy/publishing.js');

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

const MIGRATIONS = [
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
  'database/migrations/021_publication_logs.sql',
];

function freshEnv({ withPublicationLogs = true } = {}) {
  const files = withPublicationLogs ? MIGRATIONS : MIGRATIONS.filter((f) => !f.includes('021_'));
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function setEmergencyStop(db, on) {
  db.prepare("INSERT OR REPLACE INTO website_settings (setting_key, setting_value) VALUES ('emergency_stop', ?)").run(on ? '1' : '0');
}

/** Enable auto-publishing the way the owner must: BOTH flags + cutoff. */
function enableAutoPublish(db, { sinceHoursAgo = 1 } = {}) {
  setSetting(db, 'publishing_mode', 'auto');
  setSetting(db, 'auto_publishing', 'on');
  setSetting(db, 'auto_publish_eligible_since', new Date(Date.now() - sinceHoursAgo * 3600 * 1000).toISOString());
}

const DRAFT_BODY = (siblingId) =>
  'Electric cars are changing how we drive. A home charger adds about 40 kilometres of range per hour of charging. '
  + `Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=${siblingId}`;

function insertDraft(db, { id = 100, divisionId = 1, title = 'Electric Car Charging Guide', slug = 'w3-test-draft', body = null, createdAt = null, updatedAt = null } = {}) {
  // Default id 100 (explicit): the seed occupies 1-25 and the sibling
  // takes 26, so an auto-incremented draft would land on 27 — which
  // protection.js treats as a protected test article. Real new articles
  // get ids above 31; 100 mirrors that.
  const now = new Date().toISOString();
  const b = body !== null ? body : DRAFT_BODY(0);
  const cols = ['division_id', 'title', 'slug', 'excerpt', 'body', 'author', 'status', 'fact_checked', 'created_at', 'updated_at'];
  const vals = [divisionId, title, slug, 'test', b, 'FS AI', 'draft', 0, createdAt || now, updatedAt || createdAt || now];
  if (id !== null) { cols.unshift('id'); vals.unshift(id); }
  const r = db.prepare(
    `INSERT INTO articles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...vals);
  return Number(id !== null ? id : r.lastInsertRowid);
}

function insertPublishedSibling(db, { divisionId = 1, title = 'Electric Car Maintenance Checklist', slug = 'w3-sibling-electric' } = {}) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, created_at, updated_at) VALUES (?, ?, ?, 'test', 'Electric car maintenance keeps your car reliable.', 'FS AI', 'published', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
  ).run(divisionId, title, slug);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

function seoChecksJson({ duplicateDetail = 'Highest 5-word shingle overlap with another published article: 0%.', internalLinksOk = true, readabilityOk = true } = {}) {
  return JSON.stringify([
    { name: 'seo-title', ok: true },
    { name: 'meta-description', ok: true },
    { name: 'slug-unique', ok: true },
    { name: 'heading-hierarchy', ok: true },
    { name: 'keyword-relevance', ok: true },
    { name: 'internal-links', ok: internalLinksOk, detail: internalLinksOk ? 'Body links to at least one other published article.' : 'No internal link.' },
    { name: 'image-alt', ok: true },
    { name: 'readability', ok: readabilityOk, detail: readabilityOk ? 'Estimate: 40 words.' : 'Too long.' },
    { name: 'duplicate', ok: true, detail: duplicateDetail },
    { name: 'broken-links', ok: true },
    { name: 'structured-metadata', ok: true },
  ]);
}

/** Make a draft pass every content input the evaluator reads (fresh hash, sources, full SEO). */
async function makeEligible(db, articleId, { seoVerdict = 'pass', checksJson = null } = {}) {
  const article = loadArticle(db, articleId);
  const hash = await bodyHash(article.body);
  const fc = db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, ?, 2, 2, 0, ?)',
  ).run(articleId, seoVerdict === 'pass' ? 'pass' : seoVerdict, hash);
  const fcId = Number(fc.lastInsertRowid);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'EV sales reached 14 million units worldwide in 2023.', 'VERIFIED', 'https://example.com/source-1', 'EV sales reached 14 million units.', 'Supported.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'A home charger adds about 40 kilometres of range per hour.', 'VERIFIED', 'https://example.com/source-2', 'A home charger adds about 40 kilometres of range per hour.', 'Supported.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId);
  // SEO row created_at = the article's updated_at, so the check is fresh
  // by construction (timestamp fallback, diff 0 <= 5s grace).
  db.prepare('INSERT INTO seo_checks (article_id, verdict, checks_json, created_at) VALUES (?, ?, ?, ?)').run(
    articleId, seoVerdict, checksJson || seoChecksJson(), article.updated_at);
  return fcId;
}

function checkByName(verdict, name) {
  return (verdict.checks || []).find((c) => c.name === name);
}

function logRows(db, articleId, action = null) {
  const rows = action
    ? db.prepare('SELECT * FROM publication_logs WHERE article_id = ? AND action = ? ORDER BY id ASC').all(articleId, action)
    : db.prepare('SELECT * FROM publication_logs WHERE article_id = ? ORDER BY id ASC').all(articleId);
  return rows;
}

// ---------------------------------------------------------------------------
// Pure evaluator: pass case + every single-failure case.
// ---------------------------------------------------------------------------

function basePureInput(overrides = {}) {
  const body = DRAFT_BODY(200);
  return {
    article: {
      id: 100, division: 'automotive', division_id: 1,
      title: 'Electric Car Charging Guide', body, status: 'draft',
      created_at: '2026-11-21T05:00:00.000Z', updated_at: '2026-11-21T05:00:00.000Z',
    },
    factCheck: { verdict: 'pass', claims_total: 2, claims_verified: 2, claims_failed: 0, body_hash: 'abc123' },
    currentBodyHash: 'abc123',
    seoCheck: { verdict: 'pass', checks_json: seoChecksJson(), created_at: '2026-11-21T05:00:00.000Z' },
    sources: [{ source_url: 'https://example.com/source-1' }],
    verifiedClaimsWithoutEvidence: 0,
    openCorrections: 0,
    linkedArticleIds: [200],
    linkedArticles: [{ id: 200, division_id: 1, title: 'Electric Car Maintenance Checklist' }],
    adviceClaims: [],
    bannerClean: true,
    isProtected: false,
    emergencyStopOff: true,
    publishedToday: 0,
    maxArticlesPerDay: 1,
    publishingMode: 'auto',
    autoPublishing: 'on',
    autoPublishEligibleSince: '2026-11-21T00:00:00.000Z',
    seoWaivers: [],
    retryHistory: [],
    ...overrides,
  };
}

describe('evaluateAutoPublishEligibilityPure — pass case', () => {
  it('eligible when every check passes on a new article', () => {
    const v = evaluateAutoPublishEligibilityPure(basePureInput());
    assert.equal(v.eligible, true, JSON.stringify(v.blockedBy));
    assert.equal(v.verdict, 'eligible');
    assert.deepEqual(v.blockedBy, []);
    assert.equal(v.failureAlert, null);
    assert.equal(v.requiresOwnerApproval, false);
  });
});

describe('evaluateAutoPublishEligibilityPure — single-failure cases', () => {
  const cases = [
    ['stale fact-check hash', { factCheck: { verdict: 'pass', claims_total: 2, claims_verified: 2, claims_failed: 0, body_hash: 'deadbeef' } }, 'fact-check-current'],
    ['missing fact-check hash', { factCheck: { verdict: 'pass', claims_total: 2, claims_verified: 2, claims_failed: 0, body_hash: null } }, 'fact-check-current'],
    ['no fact-check at all', { factCheck: null }, 'fact-check-current'],
    ['failed fact-check verdict', { factCheck: { verdict: 'failed', claims_total: 2, claims_verified: 0, claims_failed: 2, body_hash: 'abc123' } }, 'fact-check-current'],
    ['SEO verdict failed', { seoCheck: { verdict: 'failed', checks_json: seoChecksJson(), created_at: '2026-11-21T05:00:00.000Z' } }, 'seo-fresh-pass'],
    ['SEO stale (article edited after the check)', { seoCheck: { verdict: 'pass', checks_json: seoChecksJson(), created_at: '2026-11-21T04:58:00.000Z' } }, 'seo-fresh-pass'],
    ['no SEO check at all', { seoCheck: null }, 'seo-fresh-pass'],
    ['no sources', { sources: [] }, 'sources-verified'],
    ['source without a URL', { sources: [{ source_url: '' }] }, 'sources-verified'],
    ['VERIFIED claim without evidence URL', { verifiedClaimsWithoutEvidence: 1 }, 'sources-verified'],
    ['open correction', { openCorrections: 1 }, 'correction-recheck'],
    ['duplicate overlap 3%', { seoCheck: { verdict: 'pass', checks_json: seoChecksJson({ duplicateDetail: 'Highest 5-word shingle overlap with another published article: 3% (article 5).' }), created_at: '2026-11-21T05:00:00.000Z' } }, 'duplicate-zero-overlap'],
    ['duplicate overlap unreadable', { seoCheck: { verdict: 'pass', checks_json: seoChecksJson({ duplicateDetail: 'overlap unknown' }), created_at: '2026-11-21T05:00:00.000Z' } }, 'duplicate-zero-overlap'],
    ['readability failing', { seoCheck: { verdict: 'pass', checks_json: seoChecksJson({ readabilityOk: false }), created_at: '2026-11-21T05:00:00.000Z' } }, 'seo-fresh-pass'],
    ['internal link to an unrelated same-division article', { linkedArticles: [{ id: 200, division_id: 1, title: 'Motorcycle Buying Guide' }] }, 'internal-links-relevant'],
    ['internal link to another division', { linkedArticles: [{ id: 200, division_id: 5, title: 'Electric Car Road Trips' }] }, 'internal-links-relevant'],
    ['linked article unresolvable', { linkedArticleIds: [200, 999], linkedArticles: [{ id: 200, division_id: 1, title: 'Electric Car Maintenance Checklist' }] }, 'internal-links-relevant'],
    ['no internal link in body', { linkedArticleIds: [], linkedArticles: [] }, 'internal-links-relevant'],
    ['E-Stop on', { emergencyStopOff: false }, 'emergency-stop-off'],
    ['daily limit reached', { publishedToday: 1 }, 'daily-limit'],
    ['publishing mode approved_only', { publishingMode: 'approved_only' }, 'publishing-rules'],
    ['auto_publishing off', { autoPublishing: 'off' }, 'publishing-rules'],
    ['banner survives the strip', { bannerClean: false }, 'publication-preconditions'],
    ['status published', { article: { ...basePureInput().article, status: 'published' } }, 'publication-preconditions'],
    ['cutoff not set', { autoPublishEligibleSince: null }, 'not-legacy-draft'],
    ['article created before the cutoff', { article: { ...basePureInput().article, created_at: '2026-11-20T05:00:00.000Z' } }, 'not-legacy-draft'],
    ['waiver cannot rescue internal-links', { seoWaivers: ['internal-links'], seoCheck: { verdict: 'pass', checks_json: seoChecksJson({ internalLinksOk: false }), created_at: '2026-11-21T05:00:00.000Z' } }, 'seo-fresh-pass'],
  ];
  for (const [label, overrides, checkName] of cases) {
    it(`blocks on ${label}`, () => {
      const v = evaluateAutoPublishEligibilityPure(basePureInput(overrides));
      assert.equal(v.eligible, false, label);
      assert.equal(v.verdict, 'blocked', label);
      const check = checkByName(v, checkName);
      assert.ok(check, `${label}: check ${checkName} must exist`);
      assert.equal(check.ok, false, `${label}: ${checkName} must fail (${check.detail})`);
      assert.ok(v.failureAlert, `${label}: a failure alert is required`);
      assert.equal(v.failureAlert.articleId, 100, label);
      assert.ok(v.failureAlert.rootCause.length > 0, label);
      assert.ok(v.failureAlert.timestamp, label);
    });
  }

  it('E-Stop / daily-limit failures are temporary; content failures are permanent', () => {
    const temp = evaluateAutoPublishEligibilityPure(basePureInput({ emergencyStopOff: false }));
    assert.equal(temp.errorKind, 'temporary');
    assert.equal(temp.failureAlert.errorKind, 'temporary');
    assert.equal(temp.failureAlert.ownerActionRequired, false);
    const perm = evaluateAutoPublishEligibilityPure(basePureInput({ sources: [] }));
    assert.equal(perm.errorKind, 'permanent');
    assert.equal(perm.failureAlert.ownerActionRequired, true);
  });

  it('legacy draft ids 28-31 are refused even when created after the cutoff', () => {
    for (const id of LEGACY_AUTO_PUBLISH_REFUSED_IDS) {
      const v = evaluateAutoPublishEligibilityPure(basePureInput({
        article: { ...basePureInput().article, id },
      }));
      assert.equal(v.eligible, false, `id ${id}`);
      assert.equal(checkByName(v, 'not-legacy-draft').ok, false, `id ${id}`);
      assert.equal(v.requiresOwnerApproval, true, `id ${id}`);
    }
  });

  it('Health article is never auto-eligible even when fully green + disclaimer present', () => {
    const body = 'Walking every day improves health. General information only — this is not medical advice. '
      + 'Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=200';
    const v = evaluateAutoPublishEligibilityPure(basePureInput({
      article: {
        id: 101, division: 'health-wellness', division_id: 7,
        title: 'Walking for Beginners', body, status: 'draft',
        created_at: '2026-11-21T05:00:00.000Z', updated_at: '2026-11-21T05:00:00.000Z',
      },
      linkedArticles: [{ id: 200, division_id: 7, title: 'Walking for Health' }],
    }));
    assert.equal(v.eligible, false);
    assert.equal(checkByName(v, 'special-review').ok, false);
    assert.match(checkByName(v, 'special-review').detail, /always require owner approval/);
    assert.equal(v.requiresOwnerApproval, true);
  });

  it('Finance advice claim without an authoritative source is BLOCKED_WITH_REASON', () => {
    const v = evaluateAutoPublishEligibilityPure(basePureInput({
      article: {
        id: 102, division: 'finance-money', division_id: 4,
        title: 'Investing Basics', body: 'General information only — not financial advice.', status: 'draft',
        created_at: '2026-11-21T05:00:00.000Z', updated_at: '2026-11-21T05:00:00.000Z',
      },
      adviceClaims: [{ text: 'You should invest in shares for guaranteed returns.', evidenceUrl: 'https://example.com/blog-post' }],
      linkedArticles: [{ id: 200, division_id: 4, title: 'Investing Basics Guide' }],
    }));
    assert.equal(v.eligible, false);
    assert.match(checkByName(v, 'special-review').detail, /Unverified professional-advice/);
    assert.match(checkByName(v, 'special-review').detail, /BLOCKED_WITH_REASON/);
  });

  it('Finance advice claim WITH an authoritative source still never auto-publishes (owner approval required)', () => {
    const v = evaluateAutoPublishEligibilityPure(basePureInput({
      article: {
        id: 102, division: 'finance-money', division_id: 4,
        title: 'Investing Basics', body: 'General information only — not financial advice.', status: 'draft',
        created_at: '2026-11-21T05:00:00.000Z', updated_at: '2026-11-21T05:00:00.000Z',
      },
      adviceClaims: [{ text: 'You should invest in shares for guaranteed returns.', evidenceUrl: 'https://www.investor.gov/introduction-investing' }],
      linkedArticles: [{ id: 200, division_id: 4, title: 'Investing Basics Guide' }],
    }));
    assert.equal(v.eligible, false, 'special-review is never auto-eligible');
    assert.doesNotMatch(checkByName(v, 'special-review').detail, /Unverified professional-advice/);
  });
});

// ---------------------------------------------------------------------------
// D1-backed evaluator + auto-publish path.
// ---------------------------------------------------------------------------

describe('evaluateAutoPublishEligibility (D1)', () => {
  it('eligible for a new green article once the owner enables all three settings', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const v = await evaluateAutoPublishEligibility(env, id);
    assert.equal(v.eligible, true, JSON.stringify(v.blockedBy));
  });

  it('refuses when auto_publish_eligible_since is not set (default NULL)', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    setSetting(db, 'publishing_mode', 'auto');
    setSetting(db, 'auto_publishing', 'on');
    const v = await evaluateAutoPublishEligibility(env, id);
    assert.equal(v.eligible, false);
    assert.match(checkByName(v, 'not-legacy-draft').detail, /not set/);
  });

  it('refuses a legacy draft #28 by id even when fully green and enabled', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { id: 28, body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const v = await evaluateAutoPublishEligibility(env, id);
    assert.equal(v.eligible, false);
    assert.match(checkByName(v, 'not-legacy-draft').detail, /predates autonomous publishing/);
  });
});

describe('autoPublishArticle', () => {
  it('publishes a new eligible article, logs it, and the sitemap includes it', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const before = await regenerateSitemap(env);
    assert.equal(sitemapIncludesArticle(before.xml, id), false, 'draft must not be in the sitemap');
    const beforeCount = before.articleCount;

    const res = await autoPublishArticle(env, id);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.outcome, 'published');
    assert.equal(res.sitemapUpdated, true);
    const row = loadArticle(db, id);
    assert.equal(row.status, 'published');
    assert.ok(row.published_at, 'published_at must be stamped');
    assert.equal(row.fact_checked, 1);
    const logs = logRows(db, id, 'auto-publish');
    assert.equal(logs.length, 1, 'exactly one success log row');
    assert.equal(logs[0].actor, 'system-auto');
    assert.equal(logs[0].sitemap_updated, 1);
    assert.ok(JSON.parse(logs[0].gate_verdict_json).eligible, 'logged verdict must be the eligible one');
    const after = await regenerateSitemap(env);
    assert.equal(sitemapIncludesArticle(after.xml, id), true, 'newly published article must appear in the sitemap');
    assert.equal(after.articleCount, beforeCount + 1);
  });

  it('refuses when the flags are at their OFF defaults — and logs the refusal', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    // Defaults untouched: approved_only / off / no cutoff.
    const res = await autoPublishArticle(env, id);
    assert.equal(res.ok, false);
    assert.equal(res.outcome, 'refused');
    assert.equal(loadArticle(db, id).status, 'draft', 'nothing was published');
    assert.equal(logRows(db, id, 'auto-publish-refused').length, 1, 'the refusal is logged');
  });

  it('refuses legacy draft #28 and never publishes it', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { id: 28, body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const res = await autoPublishArticle(env, id);
    assert.equal(res.ok, false);
    assert.equal(loadArticle(db, id).status, 'draft');
    assert.equal(logRows(db, id, 'auto-publish').length, 0, 'no success log for a legacy draft');
    assert.equal(logRows(db, id, 'auto-publish-refused').length, 1);
  });

  it('second attempt no-ops: one success log + one refusal log, published_at unchanged', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const first = await autoPublishArticle(env, id);
    assert.equal(first.ok, true);
    const publishedAt = loadArticle(db, id).published_at;
    const second = await autoPublishArticle(env, id);
    assert.equal(second.ok, false);
    assert.equal(second.outcome, 'refused');
    assert.match(second.reason, /already published|already auto-published/i);
    assert.equal(loadArticle(db, id).published_at, publishedAt, 'published_at must not move on a double-fire');
    assert.equal(logRows(db, id, 'auto-publish').length, 1, 'still exactly one success log');
    assert.equal(logRows(db, id).length, 2, 'one success log + one refusal log');
  });

  it('interrupted publish (log write fails) rolls back and does NOT report success', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    // Simulate a failing log write: every publication_logs INSERT aborts.
    db.exec("CREATE TRIGGER fail_publog BEFORE INSERT ON publication_logs BEGIN SELECT RAISE(ABORT, 'simulated log failure'); END;");
    const res = await autoPublishArticle(env, id);
    assert.equal(res.ok, false, 'must not report success');
    assert.equal(res.outcome, 'failed');
    assert.match(res.reason, /log write failed/i);
    assert.equal(res.rolledBack, true);
    assert.equal(res.publishedButUnlogged, false);
    const row = loadArticle(db, id);
    assert.equal(row.status, 'draft', 'article must be rolled back to draft');
    assert.equal(row.published_at, null, 'published_at must be cleared by the rollback');
    assert.ok(res.alert && res.alert.ownerActionRequired, 'failure alert must flag owner action');
    db.exec('DROP TRIGGER fail_publog');
  });

  it('refuses before publishing anything when migration 021 was never applied', async () => {
    const { db, env } = freshEnv({ withPublicationLogs: false });
    assert.equal(await publicationLogTableExists(env), false);
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const res = await autoPublishArticle(env, id);
    assert.equal(res.ok, false);
    assert.equal(res.outcome, 'blocked');
    assert.match(res.reason, /migration 021/);
    assert.equal(loadArticle(db, id).status, 'draft');
  });

  it('Health article is never auto-published via the D1 path', async () => {
    const { db, env } = freshEnv();
    const healthId = db.prepare('SELECT id FROM business_divisions WHERE slug = ?').get('health-wellness').id;
    const sibling = insertPublishedSibling(db, { divisionId: healthId, title: 'Walking for Health', slug: 'w3-sibling-health' });
    const body = 'Walking every day improves health. General information only — this is not medical advice. '
      + `Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=${sibling}`;
    const id = insertDraft(db, { divisionId: healthId, title: 'Walking for Beginners', slug: 'w3-health-draft', body });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const res = await autoPublishArticle(env, id);
    assert.equal(res.ok, false);
    assert.match(res.reason, /always require owner approval/);
    assert.equal(loadArticle(db, id).status, 'draft');
  });
});

describe('runAutoPublish', () => {
  it('no-ops without logging anything while the flags are off', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    const res = await runAutoPublish(env);
    assert.equal(res.outcome, 'no-op');
    assert.equal(res.attempted, 0);
    assert.equal(logRows(db, id).length, 0, 'a disabled system must not write refusal logs');
  });

  it('publishes one eligible new article when enabled', async () => {
    const { db, env } = freshEnv();
    const sibling = insertPublishedSibling(db, {});
    const id = insertDraft(db, { body: DRAFT_BODY(sibling) });
    await makeEligible(db, id);
    enableAutoPublish(db);
    const res = await runAutoPublish(env);
    assert.equal(res.outcome, 'done');
    assert.equal(res.published, 1);
    assert.equal(loadArticle(db, id).status, 'published');
  });
});

describe('sitemapXmlForArticles (pure)', () => {
  it('lists published articles and divisions, never drafts', () => {
    const { xml } = sitemapXmlForArticles(
      [{ id: 5, published_at: '2026-11-01T00:00:00.000Z' }],
      [{ slug: 'automotive' }, { slug: 'health-wellness' }],
    );
    assert.ok(xml.includes('/pages/article?id=5'));
    assert.ok(xml.includes('/pages/division?division=automotive'));
    assert.ok(!xml.includes('/pages/article?id=99'), 'an unlisted id must not appear');
    assert.equal(sitemapIncludesArticle(xml, 5), true);
    assert.equal(sitemapIncludesArticle(xml, 99), false);
  });
});
