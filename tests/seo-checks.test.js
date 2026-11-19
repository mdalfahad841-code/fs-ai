// FS AI — SEO + quality checks tests.
//
// The SEO agent fills blank seo_title/seo_description only (never
// overwrites owner-set values) and runs an 11-check suite: seo title,
// meta description, unique slug, heading hierarchy, keyword relevance,
// internal linking, image alt text, readability, duplicate detection
// (5-word shingle overlap), broken-link checking (fetch capped at 5),
// structured metadata. SEO never overrides factual accuracy — the
// publish gate requires a fact-check pass first.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011).
// Link checks use a stubbed fetch — no network in these tests.
// Run: node --test tests/seo-checks.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  titleKeywords, shingles, extractExternalLinks, runSeoCheckSuite, runSeo,
} = require('../backend/agents/autonomy/seo.js');

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
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertArticle(db, { title, slug, body, divisionId = 1, status = 'draft', seoTitle = null, seoDescription = null, excerpt = 'Test excerpt for the SEO checks article.' }) {
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, title, slug, excerpt, body, 'FS AI', status, seoTitle, seoDescription);
  return Number(r.lastInsertRowid);
}

const GOOD_TITLE = 'EV Charging at Home: A Complete Beginner\'s Guide';
const GOOD_DESC = 'Charging an electric car at home is usually the cheapest option. This guide covers charger types, costs and installation basics for beginners.';
const GOOD_BODY = [
  '## How home charging works',
  '',
  'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep. Most drivers find that home charging covers daily driving with ease.',
  '',
  '## Charger types and costs',
  '',
  'A complete beginner guide should explain the two main charger types. A slow charger uses a normal wall outlet and adds range slowly. A faster wall charger needs a dedicated circuit and an electrician to install it safely. The guide below links to a related article for more detail: https://fs-ai-5w5.pages.dev/pages/article.html?id=12',
  '',
  '## Installation basics',
  '',
  'Ask a qualified electrician to check the home wiring before installing a wall charger. The electrician confirms the circuit can handle the load and fits a safe breaker. Home charging is simple once the charger is installed.',
].join('\n');

const okFetch = async () => new Response('', { status: 200 });
const deadFetch = async (url) => new Response('', { status: String(url).includes('dead') ? 404 : 200 });

describe('helpers', () => {
  it('titleKeywords drops stopwords and short words', () => {
    assert.deepEqual(titleKeywords('EV Charging at Home: A Complete Beginner\'s Guide'), ['charging', 'home', 'complete', 'beginner', 'guide']);
  });

  it('shingles produce 5-word windows', () => {
    const s = shingles('one two three four five six seven');
    assert.equal(s.size, 3);
    assert.ok(s.has('one two three four five'));
    assert.ok(s.has('three four five six seven'));
  });

  it('extractExternalLinks caps at 5 https links and strips trailing punctuation', () => {
    const body = 'See https://example.com/a, http://insecure.example.com/b and https://example.com/c.';
    assert.deepEqual(extractExternalLinks(body), ['https://example.com/a', 'https://example.com/c']);
  });
});

describe('runSeoCheckSuite', () => {
  it('passes a well-formed article on all 11 checks', async () => {
    const { db, env } = freshEnv();
    assert.ok(GOOD_TITLE.length >= 30 && GOOD_TITLE.length <= 60, 'fixture seo title in range');
    assert.ok(GOOD_DESC.length >= 120 && GOOD_DESC.length <= 160, 'fixture meta description in range');
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-pass-fixture', body: GOOD_BODY, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: okFetch });
    assert.equal(r.verdict, 'pass', JSON.stringify(r.checks.filter((c) => !c.ok), null, 2));
    assert.equal(r.checks.length, 11);
    assert.deepEqual(r.failed, []);
    assert.deepEqual(r.needsReview, []);
  });

  it('fails missing seo title/description; the DB itself rejects a duplicate slug', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-dup-fixture', body: GOOD_BODY });
    // The articles.slug UNIQUE constraint is the real duplicate enforcement:
    // a second article with the same slug cannot even be inserted.
    assert.throws(
      () => insertArticle(db, { title: 'Another Title Here', slug: 'seo-dup-fixture', body: 'Different body text with enough words to be a real article body here.' }),
      /UNIQUE constraint failed: articles\.slug/,
    );
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: okFetch });
    assert.equal(r.verdict, 'failed');
    assert.ok(r.failed.includes('seo-title'), 'missing seo title is a hard fail');
    assert.ok(r.failed.includes('meta-description'), 'missing meta description is a hard fail');
  });

  it('needs-review when the body has no H2 headings and no internal links', async () => {
    const { db, env } = freshEnv();
    const body = 'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep. Most drivers find that home charging covers daily driving with ease.';
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-headings-fixture', body, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: okFetch });
    assert.notEqual(r.verdict, 'pass');
    const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
    assert.equal(byName['heading-hierarchy'].ok, false);
    assert.equal(byName['internal-links'].ok, false);
  });

  it('fails duplicate content copied from a published article', async () => {
    const { db, env } = freshEnv();
    const original = db.prepare("SELECT body FROM articles WHERE id = 1").get().body;
    const id = insertArticle(db, { title: 'Copied Article Title Here', slug: 'seo-copy-fixture', body: original, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: okFetch });
    const dup = r.checks.find((c) => c.name === 'duplicate');
    assert.equal(dup.ok, false, 'near-identical body must fail the duplicate check');
    assert.equal(r.verdict, 'failed');
  });

  it('fails a broken external link and passes a live one', async () => {
    const { db, env } = freshEnv();
    const body = GOOD_BODY + '\n\nSource: https://example.com/dead-link-here';
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-broken-fixture', body, seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const r = await runSeoCheckSuite(env, loadArticle(db, id), { fetchImpl: deadFetch });
    const broken = r.checks.find((c) => c.name === 'broken-links');
    assert.equal(broken.ok, false);
    assert.match(broken.detail, /dead-link-here/);
    assert.equal(r.verdict, 'failed');
  });

  it('fails image-alt when an image has no alt text, passes when alt is present', async () => {
    const { db, env } = freshEnv();
    const noAlt = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-img-noalt', body: GOOD_BODY + '\n\n<img src="https://example.com/pic.jpg">', seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const r1 = await runSeoCheckSuite(env, loadArticle(db, noAlt), { fetchImpl: okFetch });
    assert.equal(r1.checks.find((c) => c.name === 'image-alt').ok, false);
    const withAlt = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-img-alt', body: GOOD_BODY + '\n\n<img src="https://example.com/pic.jpg" alt="Home charger on a wall">', seoTitle: GOOD_TITLE, seoDescription: GOOD_DESC });
    const r2 = await runSeoCheckSuite(env, loadArticle(db, withAlt), { fetchImpl: okFetch });
    assert.equal(r2.checks.find((c) => c.name === 'image-alt').ok, true);
  });
});

describe('runSeo (agent handler)', () => {
  it('fills blank seo fields, stores a seo_checks row, never overwrites owner values', async () => {
    const { db, env } = freshEnv();
    env.__fetchImpl = okFetch;
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-fill-fixture', body: GOOD_BODY });
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    assert.ok(r.filled.includes('seo_title'));
    assert.ok(r.filled.includes('seo_description'));
    const row = db.prepare('SELECT seo_title, seo_description FROM articles WHERE id = ?').get(id);
    assert.ok(row.seo_title && row.seo_title.length > 0);
    assert.ok(row.seo_description && row.seo_description.length > 0);
    const checks = db.prepare('SELECT * FROM seo_checks WHERE article_id = ?').all(id);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].verdict, r.verdict);
    assert.ok(checks[0].checks_json.includes('seo-title'));

    // Second run: owner-set values must survive.
    db.prepare('UPDATE articles SET seo_title = ?, seo_description = ? WHERE id = ?').run('Owner Custom SEO Title Here For Test', 'Owner custom description that is long enough to be a real meta description for this test article.', id);
    const r2 = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r2.outcome, 'done');
    assert.deepEqual(r2.filled, [], 'nothing filled when owner values exist');
    const row2 = db.prepare('SELECT seo_title, seo_description FROM articles WHERE id = ?').get(id);
    assert.equal(row2.seo_title, 'Owner Custom SEO Title Here For Test');
  });

  it('returns a clean failure for a missing article', async () => {
    const { env } = freshEnv();
    const r = await runSeo({ kind: 'seo', payload: { article_id: 99999 } }, env);
    assert.equal(r.outcome, 'failed');
    assert.match(r.error, /not found/);
  });
});
