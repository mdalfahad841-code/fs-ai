// FS AI — Divisions + Articles regression tests (sections 3 + 4).
//
// Covers, offline with no network:
//   1. API fallback path (no D1) through the real Worker entry point
//      (src/index.js): all 8 divisions with the exact live article counts,
//      every division slug resolves, unknown slug 404s, all 25 articles
//      resolve BY THE LIVE SLUGS, unknown article slug 404s, and the
//      ?division= / ?search= filters behave.
//   2. Frontend data (frontend/scripts/app.js in a vm sandbox): 25
//      articles, every body >= 3733 chars (live D1 measurement
//      2026-11-14: min 3733 id 20, max 5332 id 25), division counts,
//      divisionPageState, articleById, renderArticles renders ALL 25
//      at once (there is no pagination / load-more anywhere), and the
//      single-article divisions (Digital Tools, Education & Learning)
//      genuinely have no related articles.
//   3. Search (frontend/scripts/search.js, index-only feature): finds
//      and misses honestly.
//   4. Static SEO tags in the served HTML shells
//      (frontend/pages/division.html, frontend/pages/article.html):
//      canonical + description + Open Graph present; per-division /
//      per-article values are injected by each page's own inline script.
//   5. Sitemap lists all 25 article URLs and all 8 division URLs.
//
// Regression anchor: audit B11 (2026-11-13) — 13 of 25 fallback slugs in
// backend/routes/articles.js used to differ from the live D1 / seed slugs,
// so a single-article lookup by a fallback slug 404d for 13 articles.
// The slugs below are the LIVE slugs (verified against
// https://fs-ai.mdalfahad841.workers.dev/api/articles on 2026-11-14);
// if a slug ever changes in D1/seed, update backend/routes/articles.js
// AND this list together.
// Run: node --test tests/divisions-articles.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { handleRequest } = require('../src/index.js');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const SEARCH_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'search.js'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'division.html'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const SITEMAP = fs.readFileSync(path.join(FRONTEND, 'sitemap.xml'), 'utf8');

/* Live division slugs in display order, with the live article counts
   (Automotive 12, AI 2, Gadgets 2, Finance 3, Travel 2, Digital Tools 1,
   Health 2, Education 1 = 25). Verified against /api/divisions 2026-11-14. */
const EXPECTED_DIVISIONS = [
  { slug: 'automotive', name: 'Automotive', count: 12 },
  { slug: 'ai-technology', name: 'AI & Technology', count: 2 },
  { slug: 'gadgets-electronics', name: 'Gadgets & Electronics', count: 2 },
  { slug: 'finance-money', name: 'Finance & Money', count: 3 },
  { slug: 'travel-lifestyle', name: 'Travel & Lifestyle', count: 2 },
  { slug: 'digital-tools', name: 'Digital Tools', count: 1 },
  { slug: 'health-wellness', name: 'Health & Wellness', count: 2 },
  { slug: 'education-learning', name: 'Education & Learning', count: 1 },
];

/* Live article slugs by id (verified against /api/articles 2026-11-14). */
const EXPECTED_SLUGS = {
  1: 'ev-charging-at-home-complete-beginners-guide',
  2: 'car-maintenance-checklist-12-things-every-month',
  3: 'hybrid-vs-petrol-which-saves-more-2026',
  4: 'motorcycle-buying-guide-choose-first-bike',
  5: 'how-to-read-car-warning-lights',
  6: 'fuel-economy-15-proven-ways-save-fuel',
  7: 'adas-explained-driver-assistance',
  8: 'electric-vehicle-range-what-numbers-mean',
  9: 'how-to-diagnose-common-engine-noises',
  10: 'new-vs-used-cars-practical-buying-guide',
  11: 'car-safety-ratings-explained',
  12: 'best-family-cars-compared-space-safety-running-costs',
  13: 'what-is-ai-plain-english-guide-beginners',
  14: '7-free-ai-tools-that-actually-save-time',
  15: 'smartphone-buying-guide-2026-what-matters-most',
  16: 'laptop-vs-tablet-which-should-you-buy',
  17: 'monthly-budgeting-50-30-20-rule-explained',
  18: 'how-to-start-saving-with-small-income',
  19: 'travel-on-a-budget-plan-trip-without-overspending',
  20: 'free-digital-tools-converters-calculators',
  21: 'walking-for-health-beginners-fitness-guide',
  22: 'how-to-learn-new-digital-skill-in-30-days',
  23: 'home-workout-basics-no-equipment-needed',
  24: 'understanding-interest-loans-explained-simply',
  25: 'how-to-plan-road-trip-checklist-costs',
};

async function getJson(url) {
  const res = await handleRequest(new Request(url, { method: 'GET' }), {});
  return { res, data: await res.json() };
}

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  vm.runInContext(SEARCH_JS, sandbox);
  return sandbox.window.FSAI;
}

describe('API fallback: GET /api/divisions', () => {
  it('lists all 8 divisions with the exact live article counts', async () => {
    const { res, data } = await getJson('http://localhost/api/divisions');
    assert.equal(res.status, 200);
    assert.equal(data.total, 8);
    assert.equal(data.divisions.length, 8);
    for (const expected of EXPECTED_DIVISIONS) {
      const found = data.divisions.find((d) => d.slug === expected.slug);
      assert.ok(found, `missing division ${expected.slug}`);
      assert.equal(found.name, expected.name);
      assert.equal(found.articleCount, expected.count,
        `${expected.slug} count should be ${expected.count}`);
    }
    const total = data.divisions.reduce((sum, d) => sum + d.articleCount, 0);
    assert.equal(total, 25);
  });

  it('every division slug resolves with its articles; unknown slug 404s', async () => {
    for (const expected of EXPECTED_DIVISIONS) {
      const { res, data } = await getJson(
        `http://localhost/api/divisions/${expected.slug}`);
      assert.equal(res.status, 200, expected.slug);
      assert.equal(data.division.slug, expected.slug);
      assert.equal(data.division.articleCount, expected.count);
      assert.equal(data.articles.length, expected.count);
      for (const article of data.articles) {
        assert.equal(article.division, expected.slug);
      }
    }
    const { res, data } = await getJson('http://localhost/api/divisions/nope');
    assert.equal(res.status, 404);
    assert.equal(data.error, 'Division not found');
  });
});

describe('API fallback: GET /api/articles', () => {
  it('lists all 25 articles, ids 1-25', async () => {
    const { res, data } = await getJson('http://localhost/api/articles');
    assert.equal(res.status, 200);
    assert.equal(data.total, 25);
    assert.deepEqual(
      data.articles.map((a) => a.id).sort((a, b) => a - b),
      Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('every article resolves by its live slug (B11 regression)', async () => {
    for (const [id, slug] of Object.entries(EXPECTED_SLUGS)) {
      const { res, data } = await getJson(`http://localhost/api/articles/${slug}`);
      assert.equal(res.status, 200, `slug ${slug} should resolve`);
      assert.equal(data.article.id, Number(id));
      assert.equal(data.article.slug, slug);
    }
  });

  it('unknown article slug 404s', async () => {
    const { res, data } = await getJson('http://localhost/api/articles/no-such-article');
    assert.equal(res.status, 404);
    assert.equal(data.error, 'Article not found');
  });

  it('?division= filter matches the live counts; ?search= finds and misses', async () => {
    for (const expected of EXPECTED_DIVISIONS) {
      const { res, data } = await getJson(
        `http://localhost/api/articles?division=${expected.slug}&limit=100`);
      assert.equal(res.status, 200);
      assert.equal(data.total, expected.count, expected.slug);
    }
    const hit = await getJson('http://localhost/api/articles?search=budget');
    assert.ok(hit.data.total >= 1, 'search=budget should hit');
    for (const article of hit.data.articles) {
      assert.ok((article.title + ' ' + article.excerpt).toLowerCase().includes('budget'));
    }
    const miss = await getJson('http://localhost/api/articles?search=zzzznotfound');
    assert.equal(miss.data.total, 0);
  });
});

describe('Frontend data: frontend/scripts/app.js', () => {
  it('25 articles, every body >= 3733 chars (live min 3733, max 5332)', () => {
    const FSAI = loadFrontend();
    assert.equal(FSAI.ARTICLES.length, 25);
    // Array.from: the vm sandbox has its own Array prototype, so a vm
    // array fails deepStrictEqual against a test-realm array.
    assert.deepEqual(
      Array.from(FSAI.ARTICLES.map((a) => a.id)).sort((a, b) => a - b),
      Array.from({ length: 25 }, (_, i) => i + 1));
    const lengths = FSAI.ARTICLES.map((a) => (a.body || '').length);
    assert.ok(lengths.every((n) => n >= 3733),
      `shortest body is ${Math.min(...lengths)} chars, expected >= 3733`);
    assert.equal(Math.min(...lengths), 3733);
    assert.equal(Math.max(...lengths), 5332);
    for (const article of FSAI.ARTICLES) {
      assert.ok(article.title && article.excerpt && article.division && article.category,
        `article ${article.id} must have title/excerpt/division/category`);
    }
  });

  it('division counts agree everywhere (DIVISIONS, countsByDivision)', () => {
    const FSAI = loadFrontend();
    const counts = FSAI.countsByDivision();
    for (const expected of EXPECTED_DIVISIONS) {
      const byName = counts.find((c) => c.division === expected.name);
      assert.equal(byName.count, expected.count, expected.name);
      const div = FSAI.DIVISIONS.find((d) => d.id === expected.slug);
      assert.equal(div.articleCount, expected.count, expected.slug);
    }
  });

  it('divisionPageState: every slug resolves, bogus is not-found, empty is all', () => {
    const FSAI = loadFrontend();
    for (const expected of EXPECTED_DIVISIONS) {
      const state = FSAI.divisionPageState(expected.slug);
      assert.equal(state.status, 'division');
      assert.equal(state.division.name, expected.name);
    }
    assert.equal(FSAI.divisionPageState('bogus-slug').status, 'not-found');
    assert.equal(FSAI.divisionPageState(null).status, 'all');
    assert.equal(FSAI.divisionPageState('').status, 'all');
  });

  it('articleById finds 1-25 and misses 99; single-article divisions have no related', () => {
    const FSAI = loadFrontend();
    for (let id = 1; id <= 25; id++) assert.ok(FSAI.articleById(id), `id ${id}`);
    assert.equal(FSAI.articleById(99), null);
    assert.equal(FSAI.articlesByDivision('Automotive').length, 12);
    assert.equal(FSAI.articlesByDivision('Digital Tools').length, 1);
    assert.equal(FSAI.articlesByDivision('Education & Learning').length, 1);
  });

  it('renderArticles renders all 25 at once (no pagination / load-more)', () => {
    const FSAI = loadFrontend();
    const root = { innerHTML: '' };
    FSAI.renderArticles(root);
    const cards = (root.innerHTML.match(/article-card/g) || []).length;
    assert.equal(cards, 25);
    for (let id = 1; id <= 25; id++) {
      assert.ok(root.innerHTML.includes(`article.html?id=${id}`), `card for id ${id}`);
    }
  });

  it('search finds and misses honestly (index-only feature)', () => {
    const FSAI = loadFrontend();
    assert.equal(typeof FSAI.searchArticles, 'function');
    assert.ok(FSAI.searchArticles('budget').length >= 1);
    assert.ok(FSAI.searchArticles('EV').length >= 1);
    assert.equal(FSAI.searchArticles('zzzznotfound').length, 0);
    assert.equal(FSAI.searchArticles('').length, 25);
  });
});

describe('Static SEO tags: division + article page shells', () => {
  it('division.html has canonical, description and Open Graph tags', () => {
    for (const needle of [
      '<link rel="canonical"',
      'name="description"',
      'property="og:title"',
      'property="og:url"',
      'application/ld+json',
    ]) assert.ok(DIVISION_HTML.includes(needle), needle);
    // Per-division values are updated by the page's own inline script.
    assert.ok(DIVISION_HTML.includes('divCanonical'));
    assert.ok(DIVISION_HTML.includes("link[rel=\"canonical\"]"));
  });

  it('article.html has canonical, description and article OG tags', () => {
    for (const needle of [
      '<link rel="canonical"',
      'name="description"',
      'property="og:type" content="article"',
      'property="og:title"',
      'setLink(\'canonical\', canonical)',
      'articleJsonLd',
    ]) assert.ok(ARTICLE_HTML.includes(needle), needle);
  });

  it('sitemap lists all 25 article URLs and all 8 division URLs', () => {
    for (let id = 1; id <= 25; id++) {
      assert.ok(SITEMAP.includes(`article.html?id=${id}`), `sitemap id ${id}`);
    }
    for (const expected of EXPECTED_DIVISIONS) {
      assert.ok(SITEMAP.includes(`division.html?division=${expected.slug}`), expected.slug);
    }
  });
});
