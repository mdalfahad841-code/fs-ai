// FS AI — Markdown body rendering on the article page (2026-11-28).
//
// D1 bodies are markdown ("## " headings, "[text](url)" links, "- "
// bullets, "**bold**"), but the article page inserts the body as HTML,
// so a markdown body showed literal "##" markers and a raw link on the
// live page (#38, verified live 2026-11-28; #1, an HTML bundle body,
// renders clean). The static bundle is HTML because the bundle build
// converts at build time; live-merged rows (id > 25) arrive raw.
// Converting D1 bodies is not an option: the publish gate compares
// body_hash, so a conversion would stale the stored PASS rows, and a
// fresh HTML re-check fails on the platform's extractClaims HTML bug.
// So the page renders markdown at render time instead
// (window.FSAI.renderBody, frontend/scripts/app.js), used by
// frontend/pages/article.html.
//
// Covers, offline with no network:
//   1. Detection: the six live-merged markdown bodies (35-40) are
//      detected; all 25 static HTML bundle bodies are NOT, and pass
//      through renderBody byte-identical.
//   2. Conversion matches the bundle regen's proven converter
//      byte-for-byte on all six real bodies (fixtures in
//      tests/fixtures/markdown-bodies/, copied from the proven
//      conversion run).
//   3. Rendered markdown has no "##", "**" or raw "[...](...)" left;
//      headings become <h2>/<h3>, links become <a href>, bullets
//      become <ul><li>, and the "Related reading" link survives.
//   4. A synthetic body covers the edge cases: a heading with no
//      blank line after it, a bullet list straight after a label
//      line, bold, and an AI-DRAFT banner above markdown.
//   5. article.html renders the body through renderBody.
//
// Run: node --test tests/markdown-body-render.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const FIXTURES = path.join(__dirname, 'fixtures', 'markdown-bodies');

// The six live-merged D1 bodies, markdown in D1. #38's D1 body is HTML
// now (converted 2026-11-28 to fix its live page), so its fixture is
// the pre-conversion markdown body — the renderer must still render
// that input correctly.
const MD_IDS = [35, 36, 37, 38, 39, 40];

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return sandbox.window.FSAI;
}

function readFixture(id, ext) {
  return fs.readFileSync(path.join(FIXTURES, 'article-' + id + '-before.' + ext), 'utf8');
}

describe('markdown detection', () => {
  it('detects the six live-merged markdown bodies, and no HTML bundle body', () => {
    const F = loadFrontend();
    for (const id of MD_IDS) {
      assert.equal(F.isMarkdownBody(readFixture(id, 'md')), true, 'id ' + id + ' should be markdown');
    }
    // Every static bundle body is HTML: none may ever be detected as
    // markdown, or the renderer would re-parse live HTML.
    for (const a of F.ARTICLES) {
      assert.equal(F.isMarkdownBody(a.body), false, 'bundle id ' + a.id + ' must not be markdown');
    }
    assert.equal(F.isMarkdownBody(''), false);
    assert.equal(F.isMarkdownBody(null), false);
  });
});

describe('HTML pass-through', () => {
  it('renderBody returns every static bundle body byte-identical', () => {
    const F = loadFrontend();
    for (const a of F.ARTICLES) {
      assert.equal(F.renderBody(a.body), a.body, 'bundle id ' + a.id + ' must pass through unchanged');
    }
    assert.equal(F.renderBody(''), '');
    assert.equal(F.renderBody(null), null);
  });
});

describe('markdown conversion', () => {
  it('matches the proven bundle-regen conversion byte-for-byte on all six real bodies', () => {
    const F = loadFrontend();
    for (const id of MD_IDS) {
      const expected = fs.readFileSync(path.join(FIXTURES, 'article-' + id + '.html'), 'utf8');
      assert.equal(F.renderMarkdownBody(readFixture(id, 'md')), expected, 'id ' + id);
    }
  });

  it('renders #35 clean: headings, link, bullets, no markdown markers left', () => {
    const F = loadFrontend();
    const html = F.renderBody(readFixture(35, 'md'));
    assert.ok(!/##\s/.test(html), 'no ## headings left');
    assert.ok(!/\*\*/.test(html), 'no ** bold markers left');
    assert.ok(!/\]\([^)]+\)/.test(html), 'no raw [text](url) left');
    assert.ok(html.includes('<h2>Introduction</h2>'), 'heading rendered');
    assert.ok(html.includes('<h2>Key takeaways</h2>'), 'last heading rendered');
    assert.ok(html.includes('<ul><li>'), 'bullets rendered as a list');
    assert.ok(html.includes('<a href="/pages/article?id=38">Vienna Food on a Budget: What to Eat and What It Costs</a>'), 'Related reading link rendered');
  });

  it('renders #39 clean: product headings, link, no markdown markers left', () => {
    const F = loadFrontend();
    const html = F.renderBody(readFixture(39, 'md'));
    assert.ok(!/##\s/.test(html), 'no ## headings left');
    assert.ok(!/\]\([^)]+\)/.test(html), 'no raw [text](url) left');
    assert.ok(html.includes('<h2>Best overall: Shark PowerDetect UV Reveal</h2>'), 'product heading rendered');
    assert.ok(html.includes('<a href="/pages/article?id=15">Smartphone Buying Guide 2026: What Matters Most</a>'), 'Related reading link rendered');
  });

  it('renders #38 (the live-broken body) clean: no ##, link clickable', () => {
    const F = loadFrontend();
    const html = F.renderBody(readFixture(38, 'md'));
    assert.ok(!/##\s/.test(html), 'no ## headings left');
    assert.ok(html.includes('<h2>The dishes that define Vienna</h2>'), 'heading rendered');
    assert.ok(html.includes('<a href="/pages/article?id=19">Travel on a Budget: Plan a Trip Without Overspending</a>'), 'Related reading link rendered');
  });

  it('handles the edge cases: heading with no blank line after it, bullets after a label, bold, ### headings', () => {
    const F = loadFrontend();
    const md = '## First heading\nA paragraph right under the heading, no blank line.\n\nSources:\n- One source\n- Two sources\n\nA **bold** word and a [link](/pages/article?id=2).\n\n### A subheading\nTail text.';
    const html = F.renderBody(md);
    assert.equal(
      html,
      '<h2>First heading</h2>' +
      '<p>A paragraph right under the heading, no blank line.</p>' +
      '<p>Sources:</p><ul><li>One source</li><li>Two sources</li></ul>' +
      '<p>A <strong>bold</strong> word and a <a href="/pages/article?id=2">link</a>.</p>' +
      '<h3>A subheading</h3><p>Tail text.</p>'
    );
  });

  it('strips the AI-DRAFT banner before rendering markdown (#36 shape)', () => {
    const F = loadFrontend();
    const html = F.renderBody(readFixture(36, 'md'));
    assert.ok(!/AI-DRAFT/i.test(html), 'banner stripped');
    assert.ok(!/##\s/.test(html), 'no ## headings left');
    assert.ok(html.includes('<h2>Introduction</h2>'), 'heading rendered after the banner');
  });
});

describe('article page wiring', () => {
  it('renders the body through renderBody (not stripDraftBanner alone)', () => {
    assert.ok(ARTICLE_HTML.includes('window.FSAI.renderBody(a.body)'), 'article.html must call renderBody');
    assert.ok(!ARTICLE_HTML.includes('window.FSAI.stripDraftBanner(a.body)'), 'article.html must not render through stripDraftBanner alone');
  });
});
