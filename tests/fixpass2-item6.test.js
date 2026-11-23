// FS AI — Fix Pass 2, item 6: UI polish — division-card dead space +
// "Loading divisions…" flash (2026-11-23).
//
//   6.1  .grid aligns items to start: cards size to their own content,
//        no forced equal-height stretch, no dead space below the link.
//   6.2  .grid-loading is display:none in main.css (render-blocking, so
//        hidden before first paint) — the loading flash is gone.
//   6.3  The loading <p> anchors STAY in the served HTML (they are
//        load-bearing for the SEO Function — see 6.4) and the no-JS
//        fallback lists are intact.
//   6.4  The SEO Function still rewrites the division page: the
//        "Loading articles…" anchor is replaced by the noscript list.
//        If anyone deletes that paragraph, this fails — that is the point.
//   6.5  Nothing else changed: hero wording, card structure, gap,
//        bento first-card span.
//
// Run: node --test tests/fixpass2-item6.test.js (or: npm test)
// The tests only read shipped files and run the shipped Function module
// against fixtures; they never touch the network or live D1.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seo = require('../functions/seo-head.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const MAIN_CSS = read('frontend/styles/main.css');
const UI_CSS = read('frontend/styles/ui-styles.css');
const INDEX_HTML = read('frontend/index.html');
const DIVISION_HTML = read('frontend/pages/division.html');
const APP_JS = read('frontend/scripts/app.js');

/** Extract the declaration block of an exact selector (line-anchored, so
 * `.grid {` never matches `.grid-loading {`). */
function ruleBlock(css, selector) {
  const m = css.match(new RegExp('^' + selector.replace('.', '\\.') + ' \\{([^}]*)\\}', 'm'));
  assert.ok(m, selector + ' rule must exist in main.css');
  return m[1];
}

/* ------------------------------------------------------------------ */
/* 6.1 — .grid: cards size to their own content.                      */
/* ------------------------------------------------------------------ */
describe('6.1 division-card dead space: .grid align-items', () => {
  it('grid items align to start, not stretch', () => {
    const block = ruleBlock(MAIN_CSS, '.grid');
    assert.ok(block.includes('display: grid'), 'still a grid');
    assert.ok(block.includes('align-items: start'), 'cards size to their own content');
    assert.ok(!block.includes('align-items: stretch'), 'no forced equal-height stretch');
  });

  it('grid geometry otherwise untouched', () => {
    const block = ruleBlock(MAIN_CSS, '.grid');
    assert.ok(block.includes('grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))'), 'columns unchanged');
    assert.ok(block.includes('gap: 24px'), '24px gap unchanged');
  });

  it('bento first-card span untouched', () => {
    assert.ok(UI_CSS.includes('#divisionGrid > :first-child'), 'bento first-child rule present');
    assert.ok(UI_CSS.includes('grid-column: span 2'), 'first card still spans 2');
  });
});

/* ------------------------------------------------------------------ */
/* 6.2 — loading text hidden before first paint.                      */
/* ------------------------------------------------------------------ */
describe('6.2 loading flash: .grid-loading hidden', () => {
  it('main.css hides .grid-loading', () => {
    const block = ruleBlock(MAIN_CSS, '.grid-loading');
    assert.ok(block.includes('display: none'), 'loading text never paints');
  });

  it('main.css is render-blocking (loaded in <head> before any grid)', () => {
    const head = INDEX_HTML.split('</head>')[0];
    assert.ok(head.includes('<link rel="stylesheet" href="styles/main.css">'), 'main.css linked in head');
    assert.ok(head.indexOf('styles/main.css') < INDEX_HTML.indexOf('id="divisionGrid"'), 'stylesheet loads before the grid markup');
  });
});

/* ------------------------------------------------------------------ */
/* 6.3 — anchors + no-JS fallback still in the served HTML.          */
/* ------------------------------------------------------------------ */
describe('6.3 loading anchors and no-JS fallback intact', () => {
  it('loading paragraphs stay in the HTML (SEO Function anchors)', () => {
    assert.ok(INDEX_HTML.includes('<p class="muted grid-loading">Loading divisions…</p>'), 'home division anchor');
    assert.ok(INDEX_HTML.includes('<p class="muted grid-loading">Loading articles…</p>'), 'home article anchor');
    assert.ok(DIVISION_HTML.includes('<p class="muted grid-loading">Loading divisions…</p>'), 'division-page division anchor');
    assert.ok(DIVISION_HTML.includes('<p class="muted grid-loading">Loading articles…</p>'), 'division-page article anchor');
  });

  it('noscript fallback lists intact', () => {
    assert.ok(INDEX_HTML.includes('<noscript>'), 'home noscript present');
    assert.ok(INDEX_HTML.includes('pages/division?division=automotive'), 'noscript division list');
    const articleLinks = (INDEX_HTML.match(/<li><a href="pages\/article\?id=/g) || []).length;
    assert.equal(articleLinks, 25, 'noscript article list must link all 25 articles');
    assert.ok(DIVISION_HTML.includes('division?division=automotive'), 'division-page noscript list');
    assert.ok(INDEX_HTML.includes('.grid-loading{display:none}'), 'noscript hide rule still present');
  });
});

/* ------------------------------------------------------------------ */
/* 6.4 — SEO Function division rewrite still works on the anchor.    */
/* ------------------------------------------------------------------ */
describe('6.4 SEO Function division rewrite (anchor interaction)', () => {
  it('rewriteDivisionHtml replaces the Loading articles… anchor', () => {
    const data = seo.parseStaticData(APP_JS);
    const division = data.divisions.find((d) => d.id === 'automotive');
    assert.ok(division, 'automotive division in the bundle');
    const inDivision = data.articles.filter((a) => a.division === division.name);
    assert.equal(inDivision.length, 12);
    const { html, rewritten } = seo.rewriteDivisionHtml(DIVISION_HTML, division, inDivision);
    assert.equal(rewritten, true, 'rewrite must succeed — the anchor paragraph must exist exactly once');
    assert.ok(!html.includes('Loading articles…'), 'loading paragraph replaced by the noscript list');
    assert.ok(html.includes('<noscript><ul>'), 'noscript list injected');
    for (const a of inDivision) {
      assert.ok(html.includes('href="article?id=' + a.id + '">' + a.title + '</a>'), `article ${a.id} linked`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6.5 — nothing else changed.                                        */
/* ------------------------------------------------------------------ */
describe('6.5 hero wording and card structure untouched', () => {
  it('hero copy byte-identical to the frozen wording', () => {
    assert.ok(INDEX_HTML.includes('<h1>Explore more.<br>Know more.<br>Do more.</h1>'), 'hero heading');
    assert.ok(INDEX_HTML.includes('One Platform. Multiple Possibilities. Eight divisions, free articles and free tools — cars, AI, gadgets, money, travel, health and learning, all in one place.'), 'hero lead');
    assert.ok(INDEX_HTML.includes('<h2>Eight divisions, one platform</h2>'), 'divisions section heading');
  });

  it('division card markup unchanged in app.js', () => {
    assert.ok(APP_JS.includes('class="card division-card reveal"'), 'division card class');
    assert.ok(APP_JS.includes('<div class="div-body">'), 'div-body wrapper');
    assert.ok(APP_JS.includes('>Explore '), 'Explore link');
    assert.ok(APP_JS.includes('class="div-count"'), 'article count');
  });

  it('division card CSS untouched except the grid alignment', () => {
    assert.ok(MAIN_CSS.includes('.division-card { padding: 0; overflow: hidden; }'), 'division-card rule');
    assert.ok(MAIN_CSS.includes('.division-card .div-body { padding: 24px; }'), 'div-body padding');
  });
});
