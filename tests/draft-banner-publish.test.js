// FS AI — AI-DRAFT banner publishing-defect regression tests.
//
// Live finding (2026-11-20, Article #31 editorial audit): the publish path
// only flipped status to 'published' and stamped published_at — it never
// touched the body — and the public article page renders the body verbatim.
// An AI draft's internal AI-DRAFT warning block would therefore have gone
// live with the article (including its then-false "has NOT been
// fact-checked" line). Zero published articles carry the banner today, so
// no reader has ever seen one — this suite pins the fix so none ever can.
//
// The fix, proved here:
//   1. backend/utils/draftBanner.js — one shared definition of a banner
//      line (the same four markers the fact-checker already treats as
//      non-claims): stripDraftBanner removes the complete LEADING block
//      and nothing else; hasDraftBanner is a fail-closed detector for any
//      banner line anywhere; stripAllDraftBannerLines is the renderer
//      strip.
//   2. Publish layer (backend/routes/admin-articles.js): the manual
//      publish handler and publishDueArticles (scheduled path) strip
//      the standard banner, save the cleaned body, and publish — but
//      if any banner line survives the strip, publication is REFUSED
//      (422 for the manual path; skipped-and-left-a-draft for the
//      scheduled run) before anything is written. Nothing is ever
//      silently published with a banner. Fix Pass 3 A1 (2026-11-23,
//      owner decision YES) removed the other two transitions INTO
//      'published' — creating already-published, and a PUT that flips
//      a draft to published, are now refused 422 with a pointer to
//      POST /api/admin/articles/:id/publish, before any banner
//      handling; the banner strip on those paths is gone with the
//      transition. A save that does NOT publish never touches the
//      body.
//   3. Public renderer, twice over: the public API (backend/routes/
//      articles.js) and the live article page (frontend/scripts/app.js
//      stripDraftBanner + frontend/pages/article.html) strip banner lines
//      before display.
//   4. The article SAVE (PUT) path is deliberately NOT touched: saving
//      must never silently rewrite a body.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/
// 011/012) via tests/phase2-harness.js. Throwaway articles only, explicit
// ids 901+ — never #26/#27. No network, no LLM, no live data.
// Run: node --test tests/draft-banner-publish.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  stripDraftBanner, hasDraftBanner, stripAllDraftBannerLines, isDraftBannerLine,
} = require('../backend/utils/draftBanner.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const { handleAdminArticles, publishDueArticles } = require('../backend/routes/admin-articles.js');
const { handleArticles } = require('../backend/routes/articles.js');
const { freshEnv, insertArticle, loadArticle } = require('./phase2-harness.js');

const ROOT = path.join(__dirname, '..');
const AUTH = { ok: true, owner: 'test-owner' };

// The exact banner block content.js generates for an AI draft (Article
// #31's body opens with this form: the "written by" and "NOT been
// fact-checked" clauses on ONE line).
const STANDARD_BANNER_BODY =
  'AI-DRAFT — needs fact-check + owner approval.\n' +
  '\n' +
  'This draft was written by workers-ai (@cf/openai/gpt-oss-120b). It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.\n' +
  '\n' +
  '## Introduction\n' +
  '\n' +
  'Enrollment from abroad is down this fall.';

// The split-line variant: the two clauses on separate lines (seen in
// earlier drafts — the fact-checker's banner regex covers both forms).
const SPLIT_BANNER_BODY =
  'AI-DRAFT — needs fact-check + owner approval.\n' +
  '\n' +
  'This draft was written by workers-ai (@cf/openai/gpt-oss-120b).\n' +
  'It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.\n' +
  '\n' +
  'Real content here.';

// A banner line the stripper must NOT remove: it is not in the leading
// block, so the publish layer must refuse instead of publishing it.
const MALFORMED_BANNER_BODY =
  'Real content.\n' +
  '\n' +
  'AI-DRAFT — custom text that must block publishing.\n' +
  '\n' +
  'More content.';

// Legitimate prose that mentions AI-DRAFT mid-sentence. No line starts
// with a banner marker, so nothing here is a banner line.
const LEGIT_MENTION_BODY =
  '## How drafts work\n' +
  '\n' +
  'Our team reviews every draft. The AI-DRAFT marker is only for internal drafts and never reaches readers.\n' +
  '\n' +
  'See the AI-DRAFT note above for the review steps.';

function publishReq(id) {
  return new Request(`http://localhost/api/admin/articles/${id}/publish`, { method: 'POST' });
}

// Fix Pass 2 item 1 (2026-11-23): POST /publish now runs the publish
// gate, so the banner-strip publish tests below must be gate-passing.
// freshEnv() has no body-hash / claim-key columns and no override
// audit table — apply migrations 017/019/023/032 onto the test db
// first, then seed a fresh PASS fact-check (body hash recorded),
// evidenced VERIFIED claims, a source with a URL and a fresh PASS SEO
// run. Only the fixtures grew; every assertion below is unchanged.
// The malformed-banner test needs none of this: the banner refusal
// runs before the gate, so it still answers with the banner error.
const GATE_MIGRATIONS = [
  'database/migrations/017_correction_claim_key.sql',
  'database/migrations/019_factcheck_body_hash.sql',
  'database/migrations/023_seo_body_hash.sql',
  'database/migrations/032_article_publish_overrides.sql',
];

function applyGateMigrations(db) {
  for (const file of GATE_MIGRATIONS) {
    db.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
}

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

function putReq(id, body) {
  return new Request(`http://localhost/api/admin/articles/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('stripDraftBanner — leading block only', () => {
  it('removes the exact standard banner block and leaves the content', () => {
    assert.equal(
      stripDraftBanner(STANDARD_BANNER_BODY),
      '## Introduction\n\nEnrollment from abroad is down this fall.',
    );
    assert.equal(stripDraftBanner(SPLIT_BANNER_BODY), 'Real content here.');
  });

  it('removes the banner even with blank lines before it', () => {
    assert.equal(
      stripDraftBanner('\n\n' + STANDARD_BANNER_BODY),
      '## Introduction\n\nEnrollment from abroad is down this fall.',
    );
  });

  it('is a no-op for banner-free bodies (byte-identical)', () => {
    const plain = '## Introduction\n\nReal content here.\n\nNo banner at all.';
    assert.strictEqual(stripDraftBanner(plain), plain);
    assert.strictEqual(stripDraftBanner(''), '');
    assert.strictEqual(stripDraftBanner(null), null);
  });

  it('leaves a body that merely mentions AI-DRAFT mid-text byte-identical', () => {
    assert.strictEqual(stripDraftBanner(LEGIT_MENTION_BODY), LEGIT_MENTION_BODY);
  });

  it('does NOT remove a banner-like line outside the leading block', () => {
    // Leading block has no banner line, so nothing is stripped — the
    // publish layer must refuse this body instead (see below).
    assert.strictEqual(stripDraftBanner(MALFORMED_BANNER_BODY), MALFORMED_BANNER_BODY);
  });
});

describe('hasDraftBanner — fail-closed detector', () => {
  it('detects banner lines anywhere: leading, middle, trailing', () => {
    assert.equal(hasDraftBanner(STANDARD_BANNER_BODY), true);
    assert.equal(hasDraftBanner('Content.\n\nAI-DRAFT — custom text.\n\nMore.'), true);
    assert.equal(hasDraftBanner('Content.\nAI-DRAFT — trailing line.'), true);
    assert.equal(hasDraftBanner('  AI-DRAFT — leading spaces still count.'), true);
    assert.equal(hasDraftBanner('ai-draft — lowercase still counts.'), true);
    assert.equal(hasDraftBanner('This draft was written by someone.'), true);
    assert.equal(hasDraftBanner('It has NOT been fact-checked yet.'), true);
    assert.equal(hasDraftBanner('SCAFFOLD — outline only.'), true);
  });

  it('does not fire on banner-free or mid-sentence mentions', () => {
    assert.equal(hasDraftBanner(''), false);
    assert.equal(hasDraftBanner(null), false);
    assert.equal(hasDraftBanner('No banner here.'), false);
    assert.equal(hasDraftBanner(LEGIT_MENTION_BODY), false);
    assert.equal(hasDraftBanner('Draft: AI-DRAFT appears later in this line.'), false);
  });

  it('isDraftBannerLine documents the caught variants', () => {
    assert.equal(isDraftBannerLine('AI-DRAFT — needs fact-check + owner approval.'), true);
    assert.equal(isDraftBannerLine('This draft was written by workers-ai (@cf/openai/gpt-oss-120b).'), true);
    assert.equal(isDraftBannerLine('It has NOT been fact-checked and must pass fact-checking.'), true);
    assert.equal(isDraftBannerLine('SCAFFOLD'), true);
    assert.equal(isDraftBannerLine('The AI-DRAFT marker is internal.'), false);
  });
});

describe('stripAllDraftBannerLines — renderer strip', () => {
  it('removes banner lines wherever they appear and keeps the rest', () => {
    assert.equal(
      stripAllDraftBannerLines(MALFORMED_BANNER_BODY),
      'Real content.\n\n\nMore content.',
    );
    assert.equal(
      stripAllDraftBannerLines(STANDARD_BANNER_BODY),
      '## Introduction\n\nEnrollment from abroad is down this fall.',
    );
  });

  it('is a no-op for banner-free bodies', () => {
    assert.strictEqual(stripAllDraftBannerLines(LEGIT_MENTION_BODY), LEGIT_MENTION_BODY);
  });
});

describe('publish handler — manual publish', () => {
  it('strips a standard banner and publishes the cleaned body', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, STANDARD_BANNER_BODY, { id: 901, status: 'draft' });
    applyGateMigrations(db);
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.article.status, 'published');
    assert.ok(data.article.published_at, 'publish stamps published_at');
    assert.equal(data.article.body, '## Introduction\n\nEnrollment from abroad is down this fall.');
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'published');
    assert.equal(stored.body, '## Introduction\n\nEnrollment from abroad is down this fall.');
    assert.equal(stored.body.includes('AI-DRAFT'), false);
  });

  it('REJECTS a body whose banner survives stripping and leaves it a draft', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, MALFORMED_BANNER_BODY, { id: 902, status: 'draft' });
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.match(data.error, /AI-DRAFT banner/);
    assert.match(data.error, /Nothing was published/);
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.published_at, null);
    assert.equal(stored.body, MALFORMED_BANNER_BODY, 'rejected publish changes nothing');
  });

  it('publishes a banner-free body unchanged', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Plain body, no banner.', { id: 903, status: 'draft' });
    applyGateMigrations(db);
    await seedGatePass(db, id);
    const res = await handleAdminArticles(publishReq(id), env, {}, AUTH);
    assert.equal(res.status, 200);
    assert.equal(loadArticle(db, id).body, 'Plain body, no banner.');
  });

  it('SAVE (PUT) does not silently strip a banner — the body is stored verbatim', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Original body.', { id: 904, status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Test Article 904', body: STANDARD_BANNER_BODY }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 200);
    assert.equal(loadArticle(db, id).body, STANDARD_BANNER_BODY);
  });
});

function createReq(body) {
  return new Request('http://localhost/api/admin/articles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('create / PUT transitions into published are refused (Fix Pass 3 A1)', () => {
  it('PUT draft→published is refused: the publish gate is the single path', async () => {
    // Fix Pass 3 A1 (2026-11-23, owner decision YES): the transition
    // itself is refused 422 before any banner handling — the banner
    // strip that used to run here is gone with the transition.
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Original body.', { id: 905, status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Test Article 905', body: STANDARD_BANNER_BODY, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.body, 'Original body.');
    const revs = db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id);
    assert.equal(revs.n, 0, 'a refused publish stores no revision');
  });

  it('PUT draft→published with an un-strippable banner is refused with no trace', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Original body.', { id: 906, status: 'draft' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Test Article 906', body: MALFORMED_BANNER_BODY, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    // The refusal is the publish-path refusal now, not the banner
    // refusal — the transition is refused before banner handling.
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    const stored = loadArticle(db, id);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.body, 'Original body.');
    const revs = db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id);
    assert.equal(revs.n, 0, 'a refused publish stores no revision');
  });

  it('create with status published is refused (Fix Pass 3 A1)', async () => {
    const { db, env } = freshEnv();
    const res = await handleAdminArticles(
      createReq({ title: 'Standard Banner Create Article', division: 'automotive', excerpt: 'Excerpt.', body: STANDARD_BANNER_BODY, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    assert.equal(
      db.prepare('SELECT id FROM articles WHERE slug = ?').get('standard-banner-create-article'),
      undefined,
    );
  });

  it('create with status published and an un-strippable banner creates nothing', async () => {
    const { db, env } = freshEnv();
    const res = await handleAdminArticles(
      createReq({ title: 'Malformed Banner Create Article', division: 'automotive', excerpt: 'Excerpt.', body: MALFORMED_BANNER_BODY, status: 'published' }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /POST \/api\/admin\/articles\/:id\/publish/);
    assert.equal(
      db.prepare('SELECT id FROM articles WHERE slug = ?').get('malformed-banner-create-article'),
      undefined,
    );
  });

  it('PUT on an already-published article saves the body verbatim (documented boundary)', async () => {
    // A save that does not publish never rewrites the body — that is the
    // rule. The renderer strip (API + live page) is the net that keeps a
    // banner out of public display for an already-published article.
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Published body.', { id: 907, status: 'published' });
    const res = await handleAdminArticles(
      putReq(id, { title: 'Test Article 907', body: STANDARD_BANNER_BODY }),
      env, {}, AUTH,
    );
    assert.equal(res.status, 200);
    assert.equal(loadArticle(db, id).body, STANDARD_BANNER_BODY);
    assert.equal(loadArticle(db, id).status, 'published');
  });
});

describe('publishDueArticles — scheduled publish', () => {
  it('publishes a due banner article cleaned, skips the un-strippable one', async () => {
    const { db, env } = freshEnv();
    const past = '2020-01-01T00:00:00.000Z';
    const cleanId = insertArticle(db, STANDARD_BANNER_BODY, { id: 911, status: 'approved' });
    const stuckId = insertArticle(db, MALFORMED_BANNER_BODY, { id: 912, status: 'approved' });
    const plainId = insertArticle(db, 'Plain due body.', { id: 913, status: 'approved' });
    const futureId = insertArticle(db, 'Not due yet.', { id: 914, status: 'approved' });
    for (const id of [cleanId, stuckId, plainId, futureId]) {
      db.prepare('UPDATE articles SET publish_at = ? WHERE id = ?')
        .run(id === futureId ? '2999-01-01T00:00:00.000Z' : past, id);
    }
    // B1 (2026-11-23): the scheduled path now enforces the 1/day
    // Dhaka-day limit, and this fixture has TWO publishable due
    // articles. This test is about banner stripping/skipping, not the
    // limit (pinned in tests/closeout-b1.test.js), so raise the limit
    // to 2 for this run only. Assertions below are unchanged.
    db.prepare("UPDATE autonomy_settings SET value = '2' WHERE key = 'max_articles_per_day'").run();
    const result = await publishDueArticles(env);
    assert.equal(result.ok, true);
    assert.equal(result.published, 2);
    assert.deepEqual(result.slugs.sort(), ['test-article-911', 'test-article-913']);
    assert.equal(result.skippedBanner, 1);
    assert.deepEqual(result.skippedBannerSlugs, ['test-article-912']);
    assert.equal(loadArticle(db, cleanId).status, 'published');
    assert.equal(loadArticle(db, cleanId).body, '## Introduction\n\nEnrollment from abroad is down this fall.');
    assert.equal(loadArticle(db, plainId).status, 'published');
    const stuck = loadArticle(db, stuckId);
    assert.equal(stuck.status, 'approved', 'banner-carrying article stays a draft');
    assert.equal(stuck.body, MALFORMED_BANNER_BODY);
    assert.equal(loadArticle(db, futureId).status, 'approved');
  });
});

describe('public renderer — API + live page', () => {
  it('the public API strips a banner from a published body (and does not mutate storage)', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, STANDARD_BANNER_BODY, { id: 921, status: 'published' });
    const slug = `test-article-${id}`;
    const res = await handleArticles(
      new Request(`http://localhost/api/articles/${slug}`), env,
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.article.body, '## Introduction\n\nEnrollment from abroad is down this fall.');
    assert.equal(data.article.body.includes('AI-DRAFT'), false);
    assert.equal(loadArticle(db, id).body, STANDARD_BANNER_BODY, 'API strip is display-only');
  });

  it('the public API fallback path returns banner-free bodies unchanged', async () => {
    // The backend fallback catalogue carries excerpts, not bodies — the
    // strip must be a no-op there, and nothing it returns may carry a
    // banner line.
    const res = await handleArticles(
      new Request('http://localhost/api/articles/ev-charging-at-home-complete-beginners-guide'), {},
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.source, 'fallback');
    assert.match(data.article.title, /EV Charging/);
    assert.ok(!data.article.body || !data.article.body.includes('AI-DRAFT'));
  });

  it('the live article page strips via window.FSAI.renderBody', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'app.js'), 'utf8');
    const sandbox = {
      window: {},
      document: { addEventListener() {}, getElementById() { return null; } },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'app.js' });
    const strip = sandbox.window.FSAI.stripDraftBanner;
    assert.equal(typeof strip, 'function');
    assert.equal(
      strip(STANDARD_BANNER_BODY),
      '## Introduction\n\nEnrollment from abroad is down this fall.',
    );
    assert.equal(
      strip(MALFORMED_BANNER_BODY),
      'Real content.\n\n\nMore content.',
    );
    assert.strictEqual(strip(LEGIT_MENTION_BODY), LEGIT_MENTION_BODY);
    /* Markdown rendering (2026-11-28): the page renders the body
       through renderBody, which strips the banner first and then
       converts markdown bodies — so the banner never reaches the
       page even for a markdown body. */
    const renderBody = sandbox.window.FSAI.renderBody;
    assert.equal(typeof renderBody, 'function');
    assert.equal(
      renderBody(STANDARD_BANNER_BODY),
      '<h2>Introduction</h2><p>Enrollment from abroad is down this fall.</p>',
      'banner stripped, then the markdown body rendered to HTML',
    );
    assert.equal(
      renderBody(MALFORMED_BANNER_BODY),
      'Real content.\n\n\nMore content.',
    );
    /* A body that merely MENTIONS AI-DRAFT mid-sentence is not a
       banner: the strip leaves it alone, and the renderer converts
       its markdown while keeping the mentions as prose. */
    assert.strictEqual(
      renderBody(LEGIT_MENTION_BODY),
      '<h2>How drafts work</h2><p>Our team reviews every draft. The AI-DRAFT marker is only for internal drafts and never reaches readers.</p><p>See the AI-DRAFT note above for the review steps.</p>',
    );
    const html = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'article.html'), 'utf8');
    assert.ok(
      html.includes('window.FSAI.renderBody(a.body)'),
      'article.html must render through renderBody (banner strip + markdown), not a.body verbatim',
    );
    assert.ok(!html.includes("'<div class=\"article-full\">' + a.body + '</div>'"));
  });
});
