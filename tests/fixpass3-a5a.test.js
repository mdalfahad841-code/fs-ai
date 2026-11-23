// FS AI — Fix Pass 3, A5 Step A: live-copy marker (2026-11-23).
//
// The Pages Function ships in TWO copies — functions/seo-head.js
// (repo root) and frontend/functions/seo-head.js — and only one of
// them is live on Cloudflare Pages. Step A proves which one it is:
// the frontend copy alone emits `x-seo-src: frontend` on EVERY
// response it builds, rewritten AND fallback (one marker line in
// seoHeaders() + one in passthrough()), alongside the existing
// x-seo-head diagnostic. The repo-root copy emits no x-seo-src.
//
// Expected live read (parent, raw GET on any /pages/article,
// /pages/division or /pages/tools URL):
//   x-seo-src: frontend present  -> the frontend/functions/ copy is live.
//   x-seo-src: absent (but x-seo-head present) -> the repo-root copy is live.
//   neither header -> the Function did not run at all.
//
// Scope note: the marker is set only where the Function builds the
// response (seoHeaders / passthrough). Requests the handler returns
// untouched (non-GET, non-200, non-HTML) carry neither header — the
// live read must therefore use GET, which is what crawlers and the
// parent's curl checks do.
//
// Step B removes this marker (with the x-seo-head diagnostic) and
// deletes the non-live copy, restoring a single copy. The static
// diff pin below (copies differ ONLY by the marker lines) is shared
// with tests/fixpass2-item2.test.js (suite 2.13) and
// tests/site-traffic-noscript.test.js.
//
// Run: node --test tests/fixpass3-a5a.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seoFront = require('../frontend/functions/seo-head.js');
const seoRoot = require('../functions/seo-head.js');

const ROOT = path.join(__dirname, '..');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'article.html'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'division.html'), 'utf8');
const TOOLS_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'tools.html'), 'utf8');

// The exact lines the A5 Step A marker adds to the frontend copy
// (same 4-line block in seoHeaders() and in passthrough()).
const MARKER_LINES = [
  '  // A5 Step A (Fix Pass 3, 2026-11-23): TEMPORARY live-copy marker.',
  '  // A5 Step A: ONLY in this frontend/functions/ copy — the repo-root',
  '  // A5 Step A: copy must NOT emit it. Removed in Step B with x-seo-head.',
  "  h.set('x-seo-src', 'frontend');",
];

/** Fake Pages context for handleSeoRequest (same shape as the one in
 * tests/fixpass2-item2.test.js). `mod` is the copy under test. */
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

async function handle(mod, url, html, deps = {}) {
  const ctx = makeContext(url, html, deps.method || 'GET');
  const res = await mod.handleSeoRequest(ctx, deps.kind || 'article', deps);
  return { res, body: await res.text() };
}

describe('A5 Step A marker: frontend copy emits x-seo-src on every built response', () => {
  it('rewritten article 1: x-seo-head rewritten + x-seo-src frontend', async () => {
    const { res, body } = await handle(seoFront, PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(res.headers.get('x-seo-src'), 'frontend');
    // The rewrite itself is unchanged (A4: exactly one heading).
    assert.equal((body.match(/Related guides/g) || []).length, 1, 'exactly one Related guides heading');
  });

  it('fallback unknown id 999: x-seo-head fallback + x-seo-src frontend', async () => {
    const { res, body } = await handle(seoFront, PAGES_BASE + '/pages/article?id=999', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => [],
    });
    assert.equal(res.headers.get('x-seo-head'), 'fallback');
    assert.equal(res.headers.get('x-seo-src'), 'frontend');
    assert.equal(body, ARTICLE_HTML, 'fallback serves the static page untouched');
  });

  it('fallback draft 28: x-seo-head fallback + x-seo-src frontend, no draft leak', async () => {
    const liveRows = [
      { id: 28, title: 'DRAFT TITLE MUST NEVER APPEAR', division: 'automotive', division_name: 'Automotive', excerpt: 'x', body: '<p>Draft body.</p>', published_at: '2026-11-10', publishedAt: '2026-11-10', status: 'draft' },
    ];
    const { res, body } = await handle(seoFront, PAGES_BASE + '/pages/article?id=28', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => liveRows,
    });
    assert.equal(res.headers.get('x-seo-head'), 'fallback');
    assert.equal(res.headers.get('x-seo-src'), 'frontend');
    assert.ok(!body.includes('DRAFT TITLE MUST NEVER APPEAR'), 'draft title absent');
  });

  it('rewritten division automotive: x-seo-src frontend', async () => {
    const { res, body } = await handle(seoFront, PAGES_BASE + '/pages/division?division=automotive', DIVISION_HTML, { kind: 'division' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(res.headers.get('x-seo-src'), 'frontend');
    assert.ok(body.includes('<title>Automotive — FS AI</title>'), 'per-division title');
  });

  it('rewritten tool percentage: x-seo-src frontend', async () => {
    const { res } = await handle(seoFront, PAGES_BASE + '/pages/tools?tool=percentage', TOOLS_HTML, { kind: 'tool' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(res.headers.get('x-seo-src'), 'frontend');
  });
});

describe('A5 Step A marker: repo-root copy emits no x-seo-src', () => {
  it('rewritten article 1: x-seo-head rewritten, x-seo-src absent', async () => {
    const { res, body } = await handle(seoRoot, PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(res.headers.get('x-seo-src'), null);
    assert.equal((body.match(/Related guides/g) || []).length, 1, 'root copy rewrites identically (A4)');
  });

  it('fallback unknown id 999: x-seo-head fallback, x-seo-src absent', async () => {
    const { res, body } = await handle(seoRoot, PAGES_BASE + '/pages/article?id=999', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => [],
    });
    assert.equal(res.headers.get('x-seo-head'), 'fallback');
    assert.equal(res.headers.get('x-seo-src'), null);
    assert.equal(body, ARTICLE_HTML, 'fallback serves the static page untouched');
  });

  it('rewritten division automotive: x-seo-src absent', async () => {
    const { res } = await handle(seoRoot, PAGES_BASE + '/pages/division?division=automotive', DIVISION_HTML, { kind: 'division' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.equal(res.headers.get('x-seo-src'), null);
  });
});

describe('A5 Step A marker: scope and static diff pin', () => {
  it('a non-GET request returns the static response untouched (no marker, no x-seo-head)', async () => {
    const { res, body } = await handle(seoFront, PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, {
      kind: 'article',
      method: 'POST',
    });
    assert.equal(res.headers.get('x-seo-head'), null, 'untouched responses carry no diagnostic');
    assert.equal(res.headers.get('x-seo-src'), null, 'untouched responses carry no marker');
    assert.equal(body, ARTICLE_HTML);
  });

  it('the two seo-head.js copies differ ONLY by the marker lines', () => {
    const a = fs.readFileSync(path.join(ROOT, 'functions', 'seo-head.js'), 'utf8');
    const b = fs.readFileSync(path.join(ROOT, 'frontend', 'functions', 'seo-head.js'), 'utf8');
    const stripped = b.split('\n').filter((l) => !MARKER_LINES.includes(l));
    assert.deepEqual(stripped, a.split('\n'), 'frontend seo-head.js must equal root seo-head.js + marker lines only');
    assert.equal(b.split('\n').length - a.split('\n').length, MARKER_LINES.length * 2, 'exactly 8 added lines (4 marker lines x 2 sites)');
    assert.equal(b.split("h.set('x-seo-src', 'frontend');").length - 1, 2, 'marker set twice in the frontend copy (rewritten + fallback)');
    assert.equal(a.split("h.set('x-seo-src', 'frontend');").length - 1, 0, 'marker never set in the repo-root copy');
  });
});
