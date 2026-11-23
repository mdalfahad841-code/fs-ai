// FS AI — Fix Pass 3, item A4: duplicate "Related guides" heading.
//
// Cause (proved by local reproduction + the parent's live curl,
// 2026-11-23 ~19:42: "Related guides" x2 on article ids 1, 12, 25):
// the served source carried the heading TWICE —
//   (1) the Pages Function's noscript body: articleNoscript() appended
//       '<h2>Related guides</h2><ul>...links...</ul>' at the end of the
//       article body (functions/seo-head.js:756, both copies);
//   (2) the static heading in frontend/pages/article.html:46,
//       '<h2>Related guides</h2>' above '<div id="relatedGrid">',
//       which the page JS fills with cards. In served source that grid
//       is empty, so (2) is the second, empty heading.
// Fix: the noscript now carries LINKS ONLY (no <h2>). The static
// heading is the real section heading — it labels the JS-rendered
// card grid in real browsers, so it stays. Crawlers need the links,
// not a second label. No Function anchor is touched (the article
// anchors are title/meta/og/twitter/</head>/Loading paragraph; the
// static <h2> is not an anchor), so the fail-closed checks are
// unaffected, and the client-side block is untouched.
//
// Covers, offline with no network:
//   1. handleSeoRequest end to end on the real bundle, articles
//      1, 12, 25: exactly ONE "Related guides" heading in the served
//      source, and each related link appears exactly once.
//   2. The JS-rendered block is intact in the rewritten source
//      (static heading + empty #relatedGrid + picker call).
//   3. No-merged-list (3-arg) rewrite: still exactly one heading,
//      no noscript related list — old behaviour preserved.
//   4. Division (automotive) and tool (percentage) rewrites are
//      unchanged by the fix.
//   5. Fail-closed anchors still hold: break the Loading, title or
//      </head> anchor and the original page passes through untouched.
// Run: node --test tests/fixpass3-a4.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seo = require('../frontend/functions/seo-head.js');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'division.html'), 'utf8');
const TOOLS_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'tools.html'), 'utf8');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

/** Fake Pages context for handleSeoRequest (same shape as the one in
 * tests/fixpass2-item2.test.js and tests/site-traffic-noscript.test.js). */
function makeContext(url, nextHtml) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    etag: '"static-etag-1"',
    'last-modified': 'Mon, 23 Nov 2026 00:00:00 GMT',
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-length': String(Buffer.byteLength(nextHtml, 'utf8')),
  };
  return {
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async () => new Response(APP_JS, {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        }),
      },
    },
    next: async () => new Response(nextHtml, { status: 200, headers }),
  };
}

async function handle(url, html, deps = {}) {
  const ctx = makeContext(url, html);
  const res = await seo.handleSeoRequest(ctx, deps.kind || 'article', deps);
  return { res, body: await res.text() };
}

function countOccurrences(html, needle) {
  return html.split(needle).length - 1;
}

/** The related ids in a rewritten page, in order, from the noscript
 * related list. The list is the <ul> directly after the
 * .article-full close (no article body contains a <div>, so that
 * </div> is unique in the noscript; 8 bodies contain their own <ul>,
 * so a bare <ul> match would be ambiguous). Returns null when the
 * noscript has no related list. */
function noscriptRelatedIds(html) {
  const m = html.match(/<\/div><ul>([\s\S]*?)<\/ul><\/noscript>/);
  if (!m) return null;
  return [...m[1].matchAll(/href="\/pages\/article\?id=(\d+)"/g)].map((x) => Number(x[1]));
}

describe('A4: one "Related guides" heading in the served source', () => {
  const data = seo.parseStaticData(APP_JS);

  it('article 1: exactly one heading, related links 12/11/10 once each', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(countOccurrences(body, 'Related guides'), 1, 'one heading only');
    assert.deepEqual(noscriptRelatedIds(body), [12, 11, 10]);
    for (const id of [12, 11, 10]) {
      assert.equal(countOccurrences(body, '/pages/article?id=' + id), 1, `id ${id} linked exactly once`);
    }
    // The one heading is the static one above the JS grid.
    assert.ok(body.includes('<h2>Related guides</h2>\n      <div class="grid" id="relatedGrid"></div>'), 'static heading + grid');
    assert.ok(!body.includes('<h2>Related guides</h2><ul>'), 'no heading inside the noscript');
  });

  it('article 12: exactly one heading, related links 11/10/9 once each', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=12', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(countOccurrences(body, 'Related guides'), 1, 'one heading only');
    assert.deepEqual(noscriptRelatedIds(body), [11, 10, 9]);
    for (const id of [11, 10, 9]) {
      assert.equal(countOccurrences(body, '/pages/article?id=' + id), 1, `id ${id} linked exactly once`);
    }
  });

  it('article 25: exactly one heading, related links 19/24/23 once each', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=25', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(countOccurrences(body, 'Related guides'), 1, 'one heading only');
    assert.deepEqual(noscriptRelatedIds(body), [19, 24, 23]);
    for (const id of [19, 24, 23]) {
      assert.equal(countOccurrences(body, '/pages/article?id=' + id), 1, `id ${id} linked exactly once`);
    }
  });

  it('the JS-rendered block is intact in the rewritten source', async () => {
    const { body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.ok(body.includes('<h2>Related guides</h2>'), 'static heading kept');
    assert.ok(body.includes('<div class="grid" id="relatedGrid"></div>'), 'empty grid kept for the page JS');
    assert.ok(body.includes('window.FSAI.relatedArticles(a)'), 'picker call kept');
    // Head rewrite still lands alongside the fix.
    assert.ok(body.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/article?id=1">'), 'canonical');
    assert.ok(body.includes('<noscript><h1>'), 'noscript article body still there');
  });

  it('a 3-argument call (no merged list): still one heading, no related list', () => {
    const article = data.articles.find((a) => a.id === 1);
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
    assert.equal(rewritten, true);
    assert.equal(countOccurrences(html, 'Related guides'), 1, 'static heading only');
    assert.equal(noscriptRelatedIds(html), null, 'no related list without the merged list');
    assert.ok(html.includes('<noscript><h1>' + article.title + '</h1>'), 'noscript article body still there');
  });
});

describe('A4: division and tool rewrites are unchanged', () => {
  const data = seo.parseStaticData(APP_JS);

  it('division automotive still rewrites with its 12-article noscript list', () => {
    const division = data.divisions.find((d) => d.id === 'automotive');
    const inDivision = data.articles.filter((a) => a.division === division.name);
    assert.equal(inDivision.length, 12);
    const { html, rewritten } = seo.rewriteDivisionHtml(DIVISION_HTML, division, inDivision);
    assert.equal(rewritten, true);
    assert.ok(html.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/division?division=automotive">'), 'canonical');
    for (const a of inDivision) {
      assert.ok(html.includes('href="article?id=' + a.id + '">' + a.title + '</a>'), `article ${a.id} still linked`);
    }
    assert.ok(!html.includes('Related guides'), 'no Related guides text on a division page');
  });

  it('tool percentage still rewrites with its JSON-LD and noscript description', () => {
    const tool = data.tools.find((t) => t.id === 'percentage');
    const { html, rewritten } = seo.rewriteToolHtml(TOOLS_HTML, tool);
    assert.equal(rewritten, true);
    assert.ok(html.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/tools?tool=percentage">'), 'canonical');
    assert.ok(html.includes('"@type":"WebApplication"'), 'WebApplication JSON-LD');
    assert.ok(html.includes('<noscript>' + tool.description + '</noscript>'), 'noscript description');
  });
});

describe('A4: fail-closed anchors still hold', () => {
  const data = seo.parseStaticData(APP_JS);
  const article = data.articles.find((a) => a.id === 1);

  it('a missing Loading paragraph passes the original page through untouched', () => {
    const broken = ARTICLE_HTML.replace('<p class="muted">Loading article…</p>', '<p class="muted">Gone.</p>');
    const { html, rewritten } = seo.rewriteArticleHtml(broken, article, data.divisions, data.articles);
    assert.equal(rewritten, false);
    assert.equal(html, broken);
  });

  it('a missing title anchor passes the original page through untouched', () => {
    const broken = ARTICLE_HTML.replace('<title>Article — FS AI</title>', '<title>Changed</title>');
    const { html, rewritten } = seo.rewriteArticleHtml(broken, article, data.divisions, data.articles);
    assert.equal(rewritten, false);
    assert.equal(html, broken);
  });

  it('a missing </head> anchor passes the original page through untouched', () => {
    const broken = ARTICLE_HTML.replace('</head>', '</headX>');
    const { html, rewritten } = seo.rewriteArticleHtml(broken, article, data.divisions, data.articles);
    assert.equal(rewritten, false);
    assert.equal(html, broken);
  });

  it('a duplicated Loading paragraph passes the original page through untouched', () => {
    const broken = ARTICLE_HTML.replace(
      '<p class="muted">Loading article…</p>',
      '<p class="muted">Loading article…</p><p class="muted">Loading article…</p>',
    );
    const { html, rewritten } = seo.rewriteArticleHtml(broken, article, data.divisions, data.articles);
    assert.equal(rewritten, false);
    assert.equal(html, broken);
  });
});
