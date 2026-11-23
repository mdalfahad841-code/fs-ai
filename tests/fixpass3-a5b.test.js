// FS AI — Fix Pass 3, A5 Step B: single Function copy, no diagnostic headers (2026-11-23).
//
// A5 Step A proved live, with the temporary `x-seo-src: frontend`
// marker, that the repo-root `functions/` copy is the live one (the
// marker was absent on every live URL at three reads, ~11 min after
// the deploy). Step B therefore:
//   (1) deleted the non-live `frontend/functions/` copy outright, and
//   (2) removed the `x-seo-head` diagnostic from the surviving
//       repo-root copy (the `x-seo-src` marker went with the deleted
//       copy — the surviving copy never had it).
//
// What this file pins:
//   - Behaviour: the surviving copy still rewrites article 1/12/25,
//     division automotive and tool percentage exactly as before
//     (same canonical / JSON-LD / noscript), with NO diagnostic
//     header on any response, rewritten or fallback; fallback 999
//     and draft 28 still serve the static page untouched, with no
//     draft leak; a non-GET request returns the static response
//     untouched (neither header — the handler never builds one).
//   - Static state: frontend/functions/ does not exist in the tree,
//     and functions/seo-head.js contains zero occurrences of
//     `x-seo-head` or `x-seo-src` (grep-level).
//   - The rewrite itself is unchanged: the byte-identity proof
//     (rewritten bodies old vs new code, 7/7 identical) was run
//     once as a scratch script (/tmp/a5b-byte-identity.mjs); the
//     content assertions below pin the same bodies permanently.
//
// Kept from the deleted tests/fixpass3-a5a.test.js (Step A): the
// A4 one-heading assertion, the fallback body-identity assertions,
// the draft-28 no-leak assertion and the non-GET scope assertion —
// all re-anchored on the surviving copy with the diagnostic headers
// asserted ABSENT instead of present. The marker assertions
// themselves are gone by design (there is no marker any more).
//
// Run: node --test tests/fixpass3-a5b.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seo = require('../functions/seo-head.js');

const ROOT = path.join(__dirname, '..');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'article.html'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'division.html'), 'utf8');
const TOOLS_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'tools.html'), 'utf8');

/** Fake Pages context for handleSeoRequest (same shape as the one in
 * tests/fixpass2-item2.test.js). */
function makeContext(url, nextHtml, method = 'GET') {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    etag: '"static-etag-1"',
    'last-modified': 'Mon, 23 Nov 2026 00:00:00 GMT',
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-length': String(Buffer.byteLength(nextHtml, 'utf8')),
  };
  return {
    request: new Request(url, { method }),
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
  const ctx = makeContext(url, html, deps.method || 'GET');
  const res = await seo.handleSeoRequest(ctx, deps.kind || 'article', deps);
  return { res, body: await res.text() };
}

/** No diagnostic header may appear on any response the Function builds. */
function assertNoDiagnosticHeaders(res, label) {
  assert.equal(res.headers.get('x-seo-head'), null, label + ': no x-seo-head');
  assert.equal(res.headers.get('x-seo-src'), null, label + ': no x-seo-src');
}

describe('A5 Step B: surviving copy rewrites with no diagnostic headers', () => {
  it('rewritten article 1: canonical + JSON-LD + noscript related links, no diagnostic headers', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assertNoDiagnosticHeaders(res, 'article 1');
    assert.ok(body.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/article?id=1">'), 'canonical');
    assert.ok(body.includes('"@type": "Article"') || body.includes('"@type":"Article"'), 'Article JSON-LD');
    assert.ok(body.includes('<a href="/pages/article?id=12">'), 'related link 12');
    assert.ok(body.includes('<a href="/pages/article?id=11">'), 'related link 11');
    assert.ok(body.includes('<a href="/pages/article?id=10">'), 'related link 10');
    // The rewrite itself is unchanged (A4: exactly one heading).
    assert.equal((body.match(/Related guides/g) || []).length, 1, 'exactly one Related guides heading');
  });

  it('rewritten articles 12 and 25: one heading each, no diagnostic headers', async () => {
    for (const id of [12, 25]) {
      const { res, body } = await handle(PAGES_BASE + '/pages/article?id=' + id, ARTICLE_HTML, { kind: 'article' });
      assertNoDiagnosticHeaders(res, 'article ' + id);
      assert.equal((body.match(/Related guides/g) || []).length, 1, 'article ' + id + ': exactly one heading');
    }
  });

  it('rewritten division automotive: per-division title + canonical + 12 links, no diagnostic headers', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/division?division=automotive', DIVISION_HTML, { kind: 'division' });
    assertNoDiagnosticHeaders(res, 'division automotive');
    assert.ok(body.includes('<title>Automotive — FS AI</title>'), 'per-division title');
    assert.ok(body.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/division?division=automotive">'), 'canonical');
    assert.equal((body.match(/href="article\?id=\d+"/g) || []).length, 12, '12 noscript article links');
  });

  it('rewritten tool percentage: WebApplication JSON-LD, no diagnostic headers', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/tools?tool=percentage', TOOLS_HTML, { kind: 'tool' });
    assertNoDiagnosticHeaders(res, 'tool percentage');
    assert.ok(body.includes('WebApplication'), 'WebApplication JSON-LD');
    assert.ok(body.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/tools?tool=percentage">'), 'canonical');
  });

  it('fallback unknown id 999: static page untouched, no diagnostic headers', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=999', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => [],
    });
    assertNoDiagnosticHeaders(res, 'fallback 999');
    assert.equal(body, ARTICLE_HTML, 'fallback serves the static page untouched');
  });

  it('fallback draft 28: no draft leak, no diagnostic headers', async () => {
    const liveRows = [
      { id: 28, title: 'DRAFT TITLE MUST NEVER APPEAR', division: 'automotive', division_name: 'Automotive', excerpt: 'x', body: '<p>Draft body.</p>', published_at: '2026-11-10', publishedAt: '2026-11-10', status: 'draft' },
    ];
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=28', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => liveRows,
    });
    assertNoDiagnosticHeaders(res, 'fallback draft 28');
    assert.ok(!body.includes('DRAFT TITLE MUST NEVER APPEAR'), 'draft title absent');
  });

  it('a non-GET request returns the static response untouched (neither header)', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, {
      kind: 'article',
      method: 'POST',
    });
    assertNoDiagnosticHeaders(res, 'POST');
    assert.equal(body, ARTICLE_HTML);
  });
});

describe('A5 Step B: single-copy static state', () => {
  it('frontend/functions/ does not exist in the tree', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'frontend', 'functions')), false, 'the deleted copy must stay deleted');
  });

  it('functions/seo-head.js contains zero occurrences of either diagnostic string', () => {
    const src = fs.readFileSync(path.join(ROOT, 'functions', 'seo-head.js'), 'utf8');
    assert.equal(src.split('x-seo-head').length - 1, 0, 'no x-seo-head in the surviving copy');
    assert.equal(src.split('x-seo-src').length - 1, 0, 'no x-seo-src in the surviving copy');
  });

  it('the three surviving route files exist and delegate to handleSeoRequest', () => {
    for (const name of ['article', 'division', 'tools']) {
      const src = fs.readFileSync(path.join(ROOT, 'functions', 'pages', name + '.js'), 'utf8');
      assert.ok(src.includes('handleSeoRequest'), 'functions/pages/' + name + '.js delegates');
    }
  });
});
