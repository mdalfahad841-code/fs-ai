// FS AI — Reading sequence: "next guide" nav on article pages
// (owner order 2026-11-27, "Dao to" — build the fixed reading
// sequence for the site).
//
// The 6 series arcs come from work/idea_bank_2026-11-25.md:
//   EV series      [1, 7, 8]
//   Buying guides  [4, 10, 12, 15, 16]
//   Money basics   [17, 18, 24]
//   Health basics  [21, 23]
//   Free tools     [14, 20]
//   Travel         [19, 25]
// Each article in an arc gets a small "Part X of Y" label plus a
// "Next guide: [title]" link to the next article in its arc; the
// last article loops back to the first ("start again"). No article
// body, title or publish status is touched, and no protected article
// (#26-#31/#33) is in any arc.
//
// Covers, offline with no network:
//   1. The pure picker (frontend/scripts/app.js, vm sandbox):
//      next-article resolution per arc on a controlled fixture;
//      last-in-arc loops to the first; no nav for articles outside
//      any arc; no nav when the current or the next article is not
//      in the supplied (published-only) list — a draft can never be
//      linked; input list is never mutated.
//   2. renderSeriesNav HTML: "Part X of Y" label, "Next guide:"
//      link in the article?id=N form, next title, "start again"
//      wording on the last article, '' outside any arc.
//   3. Real data: all 17 arc articles resolve to the exact next id
//      in the table above; the 8 non-arc articles get no nav.
//   4. Wiring (frontend/pages/article.html): seriesNav container,
//      the renderSeriesNav call, the loading-paragraph anchor intact.
//   5. Noscript scope (deliberate): the series nav is JS-rendered
//      only — the rewrite still works and the noscript keeps the
//      related list exactly as before (a series link there would
//      break the pinned A4 "each related id linked exactly once"
//      rule: article 25's series-next, 19, is also a related
//      article). Crawlers see the same internal links as before.
//   6. CSS: the quiet .series-nav rules exist in main.css.
// Run: node --test tests/series-reading-sequence.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const seo = require('../functions/seo-head.js');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const MAIN_CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'main.css'), 'utf8');

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return sandbox.window.FSAI;
}

/* Controlled fixture: ids 1/7/8 form the EV arc; id 2 is outside
   any arc. Titles are short so the nav HTML is easy to assert on. */
const FIXTURE = [
  { id: 1, title: 'First', division: 'Automotive', category: 'Cat', date: '2026-11-01', excerpt: 'e' },
  { id: 7, title: 'Second', division: 'Automotive', category: 'Cat', date: '2026-11-04', excerpt: 'e' },
  { id: 8, title: 'Third', division: 'Automotive', category: 'Cat', date: '2026-11-04', excerpt: 'e' },
  { id: 2, title: 'Outside', division: 'Automotive', category: 'Cat', date: '2026-11-01', excerpt: 'e' },
];

/* The arc table, pinned exactly as ordered (idea bank). next[id]
   is the article the nav must link to from `id`. */
const EXPECTED_NEXT = {
  1: 7, 7: 8, 8: 1,
  4: 10, 10: 12, 12: 15, 15: 16, 16: 4,
  17: 18, 18: 24, 24: 17,
  21: 23, 23: 21,
  14: 20, 20: 14,
  19: 25, 25: 19,
};
const EXPECTED_ARC = {
  1: 'EV series', 7: 'EV series', 8: 'EV series',
  4: 'Buying guides', 10: 'Buying guides', 12: 'Buying guides', 15: 'Buying guides', 16: 'Buying guides',
  17: 'Money basics', 18: 'Money basics', 24: 'Money basics',
  21: 'Health basics', 23: 'Health basics',
  14: 'Free tools', 20: 'Free tools',
  19: 'Travel', 25: 'Travel',
};
const EXPECTED_PART = {
  1: 'Part 1 of 3', 7: 'Part 2 of 3', 8: 'Part 3 of 3',
  4: 'Part 1 of 5', 10: 'Part 2 of 5', 12: 'Part 3 of 5', 15: 'Part 4 of 5', 16: 'Part 5 of 5',
  17: 'Part 1 of 3', 18: 'Part 2 of 3', 24: 'Part 3 of 3',
  21: 'Part 1 of 2', 23: 'Part 2 of 2',
  14: 'Part 1 of 2', 20: 'Part 2 of 2',
  19: 'Part 1 of 2', 25: 'Part 2 of 2',
};
const NON_ARC_IDS = [2, 3, 5, 6, 9, 11, 13, 22];
const PROTECTED_IDS = [26, 27, 28, 29, 30, 31, 33];

describe('seriesForArticle picker (pure)', () => {
  it('is exported on window.FSAI, with renderSeriesNav', () => {
    const FSAI = loadFrontend();
    assert.equal(typeof FSAI.seriesForArticle, 'function');
    assert.equal(typeof FSAI.renderSeriesNav, 'function');
  });

  it('resolves the next article in the arc, with index/total/isLast', () => {
    const FSAI = loadFrontend();
    const first = FSAI.seriesForArticle(FIXTURE[0], FIXTURE);
    assert.equal(first.arc, 'EV series');
    assert.equal(first.index, 0);
    assert.equal(first.total, 3);
    assert.equal(first.isLast, false);
    assert.equal(first.next.id, 7);
    assert.deepEqual(Array.from(first.ids), [1, 7, 8]);
    const mid = FSAI.seriesForArticle(FIXTURE[1], FIXTURE);
    assert.equal(mid.index, 1);
    assert.equal(mid.next.id, 8);
    assert.equal(mid.isLast, false);
  });

  it('the last article in an arc loops back to the first', () => {
    const FSAI = loadFrontend();
    const last = FSAI.seriesForArticle(FIXTURE[2], FIXTURE);
    assert.equal(last.index, 2);
    assert.equal(last.total, 3);
    assert.equal(last.isLast, true);
    assert.equal(last.next.id, 1);
  });

  it('returns null for articles outside any arc', () => {
    const FSAI = loadFrontend();
    assert.equal(FSAI.seriesForArticle(FIXTURE[3], FIXTURE), null);
    assert.equal(FSAI.seriesForArticle(null, FIXTURE), null);
    assert.equal(FSAI.seriesForArticle({ id: 99, title: 'Nope' }, FIXTURE), null);
  });

  it('returns null when the current article is not in the supplied list (draft safety)', () => {
    const FSAI = loadFrontend();
    const withoutCurrent = FIXTURE.filter((a) => a.id !== 1);
    assert.equal(FSAI.seriesForArticle(FIXTURE[0], withoutCurrent), null);
  });

  it('returns null when the next article is not in the supplied list — never links a draft', () => {
    const FSAI = loadFrontend();
    const withoutNext = FIXTURE.filter((a) => a.id !== 7);
    assert.equal(FSAI.seriesForArticle(FIXTURE[0], withoutNext), null);
    const withoutFirst = FIXTURE.filter((a) => a.id !== 1);
    assert.equal(FSAI.seriesForArticle(FIXTURE[2], withoutFirst), null);
  });

  it('never mutates the input list', () => {
    const FSAI = loadFrontend();
    const before = FIXTURE.map((a) => a.id);
    FSAI.seriesForArticle(FIXTURE[0], FIXTURE);
    FSAI.seriesForArticle(FIXTURE[2], FIXTURE);
    assert.deepEqual(FIXTURE.map((a) => a.id), before, 'input list unchanged');
  });
});

describe('renderSeriesNav HTML', () => {
  it('carries the Part label, the Next guide link and the next title', () => {
    const FSAI = loadFrontend();
    const html = FSAI.renderSeriesNav(FIXTURE[0], FIXTURE);
    assert.ok(html.includes('<nav class="series-nav"'), 'nav element');
    assert.ok(html.includes('EV series · Part 1 of 3'), 'Part label');
    assert.ok(html.includes('Next guide:'), 'Next guide label');
    assert.ok(html.includes('href="article?id=7"'), 'next link in article?id=N form');
    assert.ok(html.includes('>Second</a>'), 'next title');
  });

  it('the last article says "start again" and links the first', () => {
    const FSAI = loadFrontend();
    const html = FSAI.renderSeriesNav(FIXTURE[2], FIXTURE);
    assert.ok(html.includes('EV series · Part 3 of 3'), 'Part label');
    assert.ok(html.includes('start again:'), 'loop-back wording');
    assert.ok(!html.includes('Next guide:'), 'no Next guide wording on the last article');
    assert.ok(html.includes('href="article?id=1"'), 'links back to the first article');
    assert.ok(html.includes('>First</a>'), 'first title');
  });

  it('returns empty string outside any arc, and escapes titles', () => {
    const FSAI = loadFrontend();
    assert.equal(FSAI.renderSeriesNav(FIXTURE[3], FIXTURE), '');
    const tricky = [
      { id: 1, title: 'A <b>& "quoted"', division: 'Automotive', category: 'C', date: '2026-11-01', excerpt: 'e' },
      { id: 7, title: 'B <script>alert(1)</script>', division: 'Automotive', category: 'C', date: '2026-11-04', excerpt: 'e' },
      { id: 8, title: 'C', division: 'Automotive', category: 'C', date: '2026-11-04', excerpt: 'e' },
    ];
    const html = FSAI.renderSeriesNav(tricky[0], tricky);
    assert.ok(!html.includes('<script>alert'), 'title cannot break out');
    assert.ok(html.includes('&lt;script&gt;'), 'title escaped');
  });
});

describe('series nav on the real published bundle (25 articles)', () => {
  it('all 17 arc articles resolve to the exact next id, arc and Part label', () => {
    const FSAI = loadFrontend();
    assert.equal(FSAI.ARTICLES.length, 25, 'static bundle is the 25 published articles');
    for (const [id, nextId] of Object.entries(EXPECTED_NEXT)) {
      const a = FSAI.articleById(Number(id));
      const s = FSAI.seriesForArticle(a);
      assert.ok(s, `article ${id} must be in an arc`);
      assert.equal(s.next.id, nextId, `article ${id} must link to ${nextId}`);
      assert.equal(s.arc, EXPECTED_ARC[id], `article ${id} arc name`);
      const html = FSAI.renderSeriesNav(a);
      assert.ok(html.includes(EXPECTED_PART[id]), `article ${id} Part label`);
      assert.ok(html.includes('href="article?id=' + nextId + '"'), `article ${id} next link`);
      assert.ok(html.includes('>' + FSAI.articleById(nextId).title + '</a>') || html.includes(FSAI.esc(FSAI.articleById(nextId).title)), `article ${id} next title`);
    }
  });

  it('the 8 non-arc articles get no nav', () => {
    const FSAI = loadFrontend();
    for (const id of NON_ARC_IDS) {
      const a = FSAI.articleById(id);
      assert.equal(FSAI.seriesForArticle(a), null, `article ${id} must have no series`);
      assert.equal(FSAI.renderSeriesNav(a), '', `article ${id} must render no nav`);
    }
  });

  it('no protected article is in any arc', () => {
    const FSAI = loadFrontend();
    for (const id of PROTECTED_IDS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(EXPECTED_NEXT, id), `protected article ${id} must not be in an arc`);
    }
    assert.equal(Object.keys(EXPECTED_NEXT).length, 17, 'exactly 17 articles in arcs');
  });
});

describe('article.html wiring', () => {
  it('has the seriesNav container and renders the nav between body and Related guides', () => {
    assert.ok(ARTICLE_HTML.includes('<div class="wrap" id="seriesNav"></div>'), 'seriesNav container');
    assert.ok(ARTICLE_HTML.includes("window.FSAI.renderSeriesNav(a)"), 'renderSeriesNav call');
    const bodyPos = ARTICLE_HTML.indexOf('id="articleBody"');
    const navPos = ARTICLE_HTML.indexOf('id="seriesNav"');
    const relatedPos = ARTICLE_HTML.indexOf('<h2>Related guides</h2>');
    assert.ok(bodyPos !== -1 && navPos !== -1 && relatedPos !== -1, 'all three anchors present');
    assert.ok(bodyPos < navPos && navPos < relatedPos, 'nav sits between the body and Related guides');
  });

  it('the loading-paragraph anchor the Pages Function needs is intact', () => {
    assert.ok(ARTICLE_HTML.includes('<p class="muted">Loading article…</p>'), 'loading paragraph anchor');
  });
});

describe('noscript parity (seo-head.js)', () => {
  it('the rewrite still works and the noscript is unchanged (no series line)', () => {
    // Deliberate scope (2026-11-27): the series nav is JS-rendered
    // only. A series link in the noscript would break the pinned
    // A4 invariant "each related id linked exactly once in the
    // served source" — article 25's series-next (19) is also one of
    // its related articles — so the noscript keeps the related list
    // exactly as before, and crawlers see the same internal links.
    const data = seo.parseStaticData(APP_JS);
    assert.ok(data, 'static bundle parses');
    for (const [id, nextId] of Object.entries(EXPECTED_NEXT)) {
      const article = data.articles.find((a) => a.id === Number(id));
      const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
      assert.equal(rewritten, true, `article ${id} still rewrites`);
      assert.ok(!html.includes('Next guide:'), `article ${id} noscript has no series line`);
      assert.ok(!html.includes('start again:'), `article ${id} noscript has no loop-back line`);
      assert.ok(html.includes('<h2>Related guides</h2>'), 'heading survives the rewrite');
    }
    // The related list itself is intact for every arc article.
    const article = data.articles.find((a) => a.id === 1);
    const { html } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
    assert.ok(html.includes('<a href="/pages/article?id=12">'), 'related list intact');
  });

  it('the old 3-argument calls keep their exact behaviour', () => {
    const data = seo.parseStaticData(APP_JS);
    const article = data.articles.find((a) => a.id === 1);
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
    assert.equal(rewritten, true, 'still rewrites');
    assert.ok(!html.includes('Next guide:'), 'no series line without the merged list');
    assert.ok(html.includes('<noscript>'), 'noscript still present');
  });

  it('the noscript stays on one line (byte-identical test invariant)', () => {
    // The series nav is JS-rendered only (see the test above), so the
    // noscript line carries the related list and no series line.
    const data = seo.parseStaticData(APP_JS);
    const article = data.articles.find((a) => a.id === 1);
    const { html } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
    const noscriptLine = html.split('\n').find((l) => l.includes('<noscript>'));
    assert.ok(noscriptLine, 'noscript line found');
    assert.ok(noscriptLine.includes('</div><ul><li><a href="/pages/article?id=12">'), 'related list is on the same noscript line');
    assert.ok(!noscriptLine.includes('Next guide:'), 'no series line in the noscript');
  });
});

describe('series nav CSS', () => {
  it('the quiet .series-nav rules exist in main.css', () => {
    assert.ok(MAIN_CSS.includes('.series-nav {'), 'series-nav rule');
    assert.ok(MAIN_CSS.includes('.series-nav-label'), 'series-nav-label rule');
    assert.ok(MAIN_CSS.includes('.series-nav-next'), 'series-nav-next rule');
    assert.ok(MAIN_CSS.includes('.series-nav-next a {'), 'next link rule');
  });

  it('main.css braces still balance', () => {
    const open = (MAIN_CSS.match(/\{/g) || []).length;
    const close = (MAIN_CSS.match(/\}/g) || []).length;
    assert.equal(open, close, 'braces balance');
  });
});
