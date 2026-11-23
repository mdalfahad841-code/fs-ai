// FS AI — Site traffic: Related guides block (Sohanur SEO, 2026-11-23).
//
// The article page used to show only same-division articles ("More from
// this division"), so the single-article divisions (Digital Tools,
// Education & Learning) showed NO related articles at all — the measured
// internal-linking gap (article 31 is 10/11 on the gate's internal-links
// check by design). The block is now "Related guides": 3 articles, same
// division first (newest first), then other divisions to fill to 3.
//
// Covers, offline with no network:
//   1. The pure picker (frontend/scripts/app.js, vm sandbox):
//      same-division-first + newest-first ordering on a controlled
//      fixture; fill from other divisions; never the current article;
//      max 3; fewer than 3 available returns what's there; input list
//      is never mutated; the result is always a subset of the input
//      (the picker invents nothing — drafts can never appear because
//      its only data source is the merged published ARTICLES list).
//   2. Real data: for every published article 1-25 the block returns
//      exactly 3, never itself; single-article divisions get 3
//      cross-division guides, newest first.
//   3. Wiring (frontend/pages/article.html): "Related guides" heading,
//      the picker call, the division label on each card, the related
//      link form — and the old division-only filter is gone.
//   4. The Pages Function still rewrites the edited article.html
//      (Fix Pass 2 item 2 anchors intact) and the "Related guides"
//      heading survives the rewrite.
// Run: node --test tests/site-traffic-related.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const seo = require('../frontend/functions/seo-head.js');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return sandbox.window.FSAI;
}

/* Controlled fixture: dates are YYYY-MM-DD so lexical order is
   chronological order. Division A has 2 others; division B has 3. */
const FIXTURE = [
  { id: 1, title: 'Current', division: 'Division A', category: 'Cat', date: '2026-11-01', excerpt: 'e' },
  { id: 2, title: 'A older', division: 'Division A', category: 'Cat', date: '2026-11-03', excerpt: 'e' },
  { id: 3, title: 'A newest', division: 'Division A', category: 'Cat', date: '2026-11-05', excerpt: 'e' },
  { id: 4, title: 'B oldest', division: 'Division B', category: 'Cat', date: '2026-11-09', excerpt: 'e' },
  { id: 5, title: 'B middle', division: 'Division B', category: 'Cat', date: '2026-11-10', excerpt: 'e' },
  { id: 6, title: 'B newest', division: 'Division B', category: 'Cat', date: '2026-11-11', excerpt: 'e' },
];

describe('relatedArticles picker (pure)', () => {
  it('is exported on window.FSAI', () => {
    const FSAI = loadFrontend();
    assert.equal(typeof FSAI.relatedArticles, 'function');
  });

  it('same division first (newest first), then other divisions to fill to 3', () => {
    const FSAI = loadFrontend();
    const out = FSAI.relatedArticles(FIXTURE[0], FIXTURE);
    assert.deepEqual(Array.from(out, (a) => a.id), [3, 2, 6]);
  });

  it('a division with no same-division others fills entirely from other divisions', () => {
    const FSAI = loadFrontend();
    const lonely = { id: 9, title: 'Lonely', division: 'Division C', category: 'Cat', date: '2026-11-02', excerpt: 'e' };
    const out = FSAI.relatedArticles(lonely, FIXTURE);
    assert.deepEqual(Array.from(out, (a) => a.id), [6, 5, 4]);
  });

  it('never returns the current article', () => {
    const FSAI = loadFrontend();
    for (const current of FIXTURE) {
      const out = FSAI.relatedArticles(current, FIXTURE);
      assert.ok(!out.some((a) => a.id === current.id), `self leaked for id ${current.id}`);
    }
  });

  it('returns fewer than 3 when fewer are available, and never mutates the input', () => {
    const FSAI = loadFrontend();
    const tiny = [FIXTURE[0], FIXTURE[1]];
    const before = tiny.map((a) => a.id);
    const out = FSAI.relatedArticles(FIXTURE[0], tiny);
    assert.deepEqual(Array.from(out, (a) => a.id), [2]);
    assert.deepEqual(tiny.map((a) => a.id), before, 'input list unchanged');
  });

  it('returns only items from the supplied list (invents nothing)', () => {
    const FSAI = loadFrontend();
    const ids = new Set(FIXTURE.map((a) => a.id));
    const out = FSAI.relatedArticles(FIXTURE[0], FIXTURE);
    assert.ok(out.every((a) => ids.has(a.id)), 'every result comes from the input list');
    assert.equal(out.length, 3);
  });

  it('same-date ties break by highest id (same rule as sortLatestFirst)', () => {
    const FSAI = loadFrontend();
    const tied = [
      { id: 10, title: 'Current', division: 'D', category: 'C', date: '2026-11-01', excerpt: 'e' },
      { id: 11, title: 'T1', division: 'D', category: 'C', date: '2026-11-11', excerpt: 'e' },
      { id: 12, title: 'T2', division: 'D', category: 'C', date: '2026-11-11', excerpt: 'e' },
      { id: 13, title: 'T3', division: 'D', category: 'C', date: '2026-11-11', excerpt: 'e' },
    ];
    assert.deepEqual(Array.from(FSAI.relatedArticles(tied[0], tied), (a) => a.id), [13, 12, 11]);
  });
});

describe('relatedArticles on the real published bundle (25 articles)', () => {
  it('every article gets exactly 3, never itself', () => {
    const FSAI = loadFrontend();
    assert.equal(FSAI.ARTICLES.length, 25, 'static bundle is the 25 published articles');
    for (let id = 1; id <= 25; id++) {
      const a = FSAI.articleById(id);
      const out = FSAI.relatedArticles(a);
      assert.equal(out.length, 3, `article ${id} should get 3 related`);
      assert.ok(!out.some((x) => x.id === id), `article ${id} must not relate to itself`);
      assert.ok(out.every((x) => FSAI.articleById(x.id)), 'every related id is a real published article');
    }
  });

  it('a 12-article division fills all 3 from the same division, newest first', () => {
    const FSAI = loadFrontend();
    const a = FSAI.articleById(1); // Automotive, 2026-11-01
    const out = FSAI.relatedArticles(a);
    assert.ok(out.every((x) => x.division === 'Automotive'), 'all 3 same-division when 11 others exist');
    const dates = Array.from(out, (x) => x.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  });

  it('single-article divisions get 3 cross-division guides, newest first', () => {
    const FSAI = loadFrontend();
    for (const name of ['Digital Tools', 'Education & Learning']) {
      const only = FSAI.articlesByDivision(name);
      assert.equal(only.length, 1, `${name} has exactly one published article`);
      const out = FSAI.relatedArticles(only[0]);
      assert.equal(out.length, 3, `${name} must still get 3 related guides`);
      assert.ok(out.every((x) => x.division !== name), 'all 3 come from other divisions');
      const dates = Array.from(out, (x) => x.date);
      assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
      // The newest published articles overall are ids 21-25 (2026-11-11,
      // Set B dates) — the fill must reach them, not stop at the division.
      assert.ok(out.some((x) => x.date === '2026-11-11'), 'fill reaches the newest articles');
    }
  });
});

describe('article.html wiring', () => {
  it('has the "Related guides" heading and calls the picker (old filter gone)', () => {
    assert.ok(ARTICLE_HTML.includes('<h2>Related guides</h2>'), 'Related guides heading');
    assert.ok(!ARTICLE_HTML.includes('More from this division'), 'old heading gone');
    assert.ok(ARTICLE_HTML.includes('window.FSAI.relatedArticles(a)'), 'picker call');
    assert.ok(!ARTICLE_HTML.includes('articlesByDivision(a.division).filter'), 'old division-only filter gone');
    assert.ok(!ARTICLE_HTML.includes('No other articles in this division yet.'), 'old empty-state text gone');
  });

  it('each related card carries a division label, a title link and the Set B date', () => {
    // Card tag is "Division · Category" (same shape as articleCard).
    assert.ok(ARTICLE_HTML.includes("window.FSAI.esc(x.division) + ' · ' + window.FSAI.esc(x.category)"),
      'division label on the card tag');
    // Title link in the exact form the canonical test asserts.
    assert.ok(ARTICLE_HTML.includes("href=\"article?id=' + x.id + '\""), 'article.html related link');
    assert.ok(ARTICLE_HTML.includes("formatDate(x.date)"), 'publication date shown');
  });

  it('Pages Function anchors are intact and the rewrite still works on the edited page', () => {
    for (const anchor of [
      '<title>Article — FS AI</title>',
      '<meta name="description" content="Read a free FS AI article.">',
      '<meta property="og:title" content="Article — FS AI">',
      '<meta property="og:description" content="Read a free FS AI article.">',
      '<meta name="twitter:title" content="Article — FS AI">',
      '<meta name="twitter:description" content="Read a free FS AI article.">',
      '</head>',
      '<p class="muted">Loading article…</p>',
    ]) {
      assert.ok(ARTICLE_HTML.includes(anchor), `anchor still present: ${anchor}`);
    }
    const data = seo.parseStaticData(APP_JS);
    assert.ok(data, 'static bundle parses');
    for (const id of [1, 22]) {
      const article = data.articles.find((a) => a.id === id);
      const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
      assert.equal(rewritten, true, `article ${id} still rewrites`);
      assert.ok(html.includes('<h2>Related guides</h2>'), 'heading survives the rewrite');
      // A4 (Fix Pass 3, 2026-11-23): exactly one heading — the static
      // one. The noscript no longer adds a second.
      assert.equal((html.match(/Related guides/g) || []).length, 1, 'exactly one Related guides heading');
      assert.ok(html.includes('<title>' + article.title + ' — FS AI</title>'), 'per-article title still lands');
    }
  });
});
