// FS AI — Site traffic: related links in the crawler noscript (2026-11-23).
//
// Item A: the Pages Function's article-page server-side head now lists
// the same 3 related articles in the <noscript> body that the
// client-side "Related guides" block renders for JS browsers — same
// picker rules (same division first, newest first; then other
// divisions to fill to 3; never the current article; published only;
// static bundle wins; live API rows only for ids the bundle lacks;
// drafts NEVER appear), so a no-JS crawler follows the same internal
// links a real browser sees.
//
// Covers, offline with no network:
//   1. The Function picker (seo.relatedArticles) on a controlled
//      fixture — the same fixture tests/site-traffic-related.test.js
//      uses for the client picker, so the two are pinned together.
//   2. Client/Function picker agreement on the real bundle: for
//      every article 1-25 both pickers return the same ids.
//      Article 1 -> [12, 11, 10]; article 22 -> [25, 24, 23].
//   3. mergeArticles: static wins, draft rows dropped, live rows
//      without a valid date dropped, live-only published rows added.
//   4. rewriteArticleHtml: the noscript carries the related list
//      (heading + links in order) for articles 1 and 22; a 3-arg call
//      (no list) renders no related section — old behaviour preserved;
//      related titles are escaped; the noscript stays one line (the
//      byte-identical test in tests/fixpass2-item2.test.js relies on
//      it); the division noscript list is unchanged.
//   5. handleSeoRequest end to end: static article 1 rewrites with
//      the related list; live-only id 34 rewrites with static
//      related articles and no draft leak; the live fetch still never
//      runs for a static id.
//   6. No code generation: all 10 shipped Function files (both
//      copies x seo-head.js, package.json, pages/article.js,
//      pages/division.js, pages/tools.js) contain no `new Function`,
//      `eval(`, `WebAssembly.compile` or `WebAssembly.instantiate`,
//      and the two seo-head.js copies are byte-identical.
// Run: node --test tests/site-traffic-noscript.test.js (or: npm test)
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
const DIVISION_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'division.html'), 'utf8');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return sandbox.window.FSAI;
}

/** Fake Pages context for handleSeoRequest (same shape as the one in
 * tests/fixpass2-item2.test.js). */
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

/** The related ids in a rewritten page, in order, from the noscript
 * related list only (the `<h2>Related guides</h2><ul>` marker is
 * unambiguous: the visible heading is followed by a <div>, and
 * article bodies may contain their own links). Returns null when the
 * noscript has no related list. */
function noscriptRelatedIds(html) {
  const m = html.match(/<h2>Related guides<\/h2><ul>([\s\S]*?)<\/ul>/);
  if (!m) return null;
  return [...m[1].matchAll(/href="\/pages\/article\?id=(\d+)"/g)].map((x) => Number(x[1]));
}

/** The same controlled fixture tests/site-traffic-related.test.js
 * uses for the client picker. */
const FIXTURE = [
  { id: 1, title: 'Current', division: 'Division A', category: 'Cat', date: '2026-11-01', excerpt: 'e' },
  { id: 2, title: 'A older', division: 'Division A', category: 'Cat', date: '2026-11-03', excerpt: 'e' },
  { id: 3, title: 'A newest', division: 'Division A', category: 'Cat', date: '2026-11-05', excerpt: 'e' },
  { id: 4, title: 'B oldest', division: 'Division B', category: 'Cat', date: '2026-11-09', excerpt: 'e' },
  { id: 5, title: 'B middle', division: 'Division B', category: 'Cat', date: '2026-11-10', excerpt: 'e' },
  { id: 6, title: 'B newest', division: 'Division B', category: 'Cat', date: '2026-11-11', excerpt: 'e' },
];

describe('seo.relatedArticles picker (pure, same fixture as the client picker)', () => {
  it('is exported', () => {
    assert.equal(typeof seo.relatedArticles, 'function');
  });

  it('same division first (newest first), then other divisions to fill to 3', () => {
    assert.deepEqual(Array.from(seo.relatedArticles(FIXTURE[0], FIXTURE), (a) => a.id), [3, 2, 6]);
  });

  it('a division with no same-division others fills entirely from other divisions', () => {
    const lonely = { id: 9, title: 'Lonely', division: 'Division C', category: 'Cat', date: '2026-11-02', excerpt: 'e' };
    assert.deepEqual(Array.from(seo.relatedArticles(lonely, FIXTURE), (a) => a.id), [6, 5, 4]);
  });

  it('never returns the current article', () => {
    for (const current of FIXTURE) {
      const out = seo.relatedArticles(current, FIXTURE);
      assert.ok(!out.some((a) => a.id === current.id), `self leaked for id ${current.id}`);
    }
  });

  it('returns fewer than 3 when fewer are available, and never mutates the input', () => {
    const tiny = [FIXTURE[0], FIXTURE[1]];
    const before = tiny.map((a) => a.id);
    const out = seo.relatedArticles(FIXTURE[0], tiny);
    assert.deepEqual(Array.from(out, (a) => a.id), [2]);
    assert.deepEqual(tiny.map((a) => a.id), before, 'input list unchanged');
  });

  it('same-date ties break by highest id (same rule as app.js sortLatestFirst)', () => {
    const tied = [
      { id: 10, title: 'Current', division: 'D', category: 'C', date: '2026-11-01', excerpt: 'e' },
      { id: 11, title: 'T1', division: 'D', category: 'C', date: '2026-11-11', excerpt: 'e' },
      { id: 12, title: 'T2', division: 'D', category: 'C', date: '2026-11-11', excerpt: 'e' },
      { id: 13, title: 'T3', division: 'D', category: 'C', date: '2026-11-11', excerpt: 'e' },
    ];
    assert.deepEqual(Array.from(seo.relatedArticles(tied[0], tied), (a) => a.id), [13, 12, 11]);
  });

  it('a null current still picks the 3 newest (nothing excluded by id)', () => {
    assert.deepEqual(Array.from(seo.relatedArticles(null, FIXTURE), (a) => a.id), [6, 5, 4]);
  });
});

describe('client picker and Function picker agree on the real bundle', () => {
  it('every article 1-25 gets the same 3 ids from both pickers', () => {
    const FSAI = loadFrontend();
    const data = seo.parseStaticData(APP_JS);
    assert.ok(data, 'static bundle parses');
    assert.equal(data.articles.length, 25);
    for (let id = 1; id <= 25; id++) {
      const a = data.articles.find((x) => x.id === id);
      const fromClient = Array.from(FSAI.relatedArticles(a), (x) => x.id);
      const fromFunction = Array.from(seo.relatedArticles(a, data.articles), (x) => x.id);
      assert.deepEqual(fromFunction, fromClient, `article ${id}: Function picker must match the client picker`);
      assert.equal(fromFunction.length, 3, `article ${id} gets exactly 3`);
      assert.ok(!fromFunction.includes(id), `article ${id} must not relate to itself`);
    }
  });

  it('article 1 -> [12, 11, 10]; article 22 -> [25, 24, 23]', () => {
    const data = seo.parseStaticData(APP_JS);
    const a1 = data.articles.find((a) => a.id === 1);
    assert.deepEqual(Array.from(seo.relatedArticles(a1, data.articles), (a) => a.id), [12, 11, 10]);
    const a22 = data.articles.find((a) => a.id === 22);
    assert.deepEqual(Array.from(seo.relatedArticles(a22, data.articles), (a) => a.id), [25, 24, 23]);
  });
});

describe('mergeArticles (static wins, drafts never leak)', () => {
  const data = seo.parseStaticData(APP_JS);
  const liveRows = [
    { id: 1, title: 'CHANGED LIVE TITLE', division: 'automotive', division_name: 'Automotive', excerpt: 'x', body: '<p>x</p>', published_at: '2026-11-01', publishedAt: '2026-11-01', status: 'published' },
    { id: 28, title: 'DRAFT TITLE MUST NEVER APPEAR', division: 'automotive', division_name: 'Automotive', excerpt: 'x', body: '<p>x</p>', published_at: '2026-11-10', publishedAt: '2026-11-10', status: 'draft' },
    { id: 34, title: 'A Newly Published Guide', division: 'automotive', division_name: 'Automotive', excerpt: 'Fresh.', body: '<p>Fresh content.</p>', published_at: '2026-11-23', publishedAt: '2026-11-23', status: 'published' },
    { id: 35, title: 'No Date Guide', division: 'automotive', division_name: 'Automotive', excerpt: 'x', body: '<p>x</p>', published_at: '', publishedAt: '', status: 'published' },
  ];

  it('static wins for a shared id; live-only published rows are added; drafts and dateless rows are dropped', () => {
    const merged = seo.mergeArticles(data.articles, liveRows, data.divisions);
    assert.equal(merged.length, 26, '25 static + live-only 34');
    assert.equal(merged.find((a) => a.id === 1).title, data.articles.find((a) => a.id === 1).title, 'static title kept for id 1');
    assert.ok(merged.some((a) => a.id === 34 && a.title === 'A Newly Published Guide'), 'live-only 34 added');
    assert.ok(!merged.some((a) => a.id === 28), 'draft 28 dropped');
    assert.ok(!merged.some((a) => a.id === 35), 'dateless 35 dropped');
    assert.ok(!merged.some((a) => a.title === 'DRAFT TITLE MUST NEVER APPEAR'), 'no draft title anywhere');
  });

  it('does not mutate the static list', () => {
    const before = data.articles.map((a) => a.id);
    seo.mergeArticles(data.articles, liveRows, data.divisions);
    assert.deepEqual(data.articles.map((a) => a.id), before);
  });

  it('a null live list merges to the static list alone', () => {
    assert.deepEqual(seo.mergeArticles(data.articles, null, data.divisions), data.articles);
  });
});

describe('rewriteArticleHtml carries the related list in the noscript', () => {
  const data = seo.parseStaticData(APP_JS);

  it('article 1: noscript lists 12, 11, 10 with titles, in order', () => {
    const article = data.articles.find((a) => a.id === 1);
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
    assert.equal(rewritten, true);
    assert.deepEqual(noscriptRelatedIds(html), [12, 11, 10]);
    for (const id of [12, 11, 10]) {
      const t = data.articles.find((a) => a.id === id);
      assert.ok(html.includes('<a href="/pages/article?id=' + id + '">' + t.title + '</a>'), `id ${id} linked with its title`);
    }
    // Head rewrite still lands alongside the related list.
    assert.ok(html.includes('<title>' + article.title + ' — FS AI</title>'), 'per-article title');
    assert.ok(html.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/article?id=1">'), 'canonical');
  });

  it('article 22 (single-article division): noscript lists 25, 24, 23, none from its own division', () => {
    const article = data.articles.find((a) => a.id === 22);
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
    assert.equal(rewritten, true);
    assert.deepEqual(noscriptRelatedIds(html), [25, 24, 23]);
    const related = seo.relatedArticles(article, data.articles);
    assert.ok(related.every((a) => a.division !== 'Education & Learning'), 'all 3 from other divisions');
  });

  it('a 3-argument call renders no related section (old behaviour preserved)', () => {
    const article = data.articles.find((a) => a.id === 1);
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
    assert.equal(rewritten, true);
    assert.equal(noscriptRelatedIds(html), null, 'no related list without the merged list');
    assert.ok(html.includes('<noscript><h1>' + article.title + '</h1>'), 'noscript article body still there');
  });

  it('the noscript stays on one line (the byte-identical test relies on it)', () => {
    const article = data.articles.find((a) => a.id === 1);
    const { html } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
    const lines = html.split('\n').filter((l) => l.includes('<noscript>'));
    assert.equal(lines.length, 1, 'exactly one line carries the noscript');
    assert.ok(lines[0].includes('</noscript>'), 'that line closes the noscript');
    assert.ok(lines[0].includes('<h2>Related guides</h2><ul>'), 'related list is on that line');
  });

  it('related titles with " < & are escaped in the noscript links', () => {
    const list = [
      { id: 1, title: 'Current', division: 'A', category: 'C', date: '2026-11-01', excerpt: 'e', body: '<p>b</p>' },
      { id: 2, title: 'A "quoted" <tag> & amp', division: 'A', category: 'C', date: '2026-11-02', excerpt: 'e', body: '<p>b</p>' },
    ];
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, list[0], data.divisions, list);
    assert.equal(rewritten, true);
    assert.ok(html.includes('<a href="/pages/article?id=2">A &quot;quoted&quot; &lt;tag&gt; &amp; amp</a>'), 'title escaped');
    assert.ok(!html.includes('<tag> & amp</a>'), 'raw title never appears');
  });

  it('the division noscript list is unchanged (automotive: 12 links)', () => {
    const division = data.divisions.find((d) => d.id === 'automotive');
    const inDivision = data.articles.filter((a) => a.division === division.name);
    const { html, rewritten } = seo.rewriteDivisionHtml(DIVISION_HTML, division, inDivision);
    assert.equal(rewritten, true);
    for (const a of inDivision) {
      assert.ok(html.includes('href="article?id=' + a.id + '">' + a.title + '</a>'), `article ${a.id} still linked`);
    }
  });
});

describe('handleSeoRequest end to end (related list)', () => {
  const liveRows = [
    { id: 34, title: 'A Newly Published Guide', slug: 'newly-published-guide', division: 'automotive', division_name: 'Automotive', excerpt: 'Fresh from the daily run.', body: '<p>Fresh content.</p>', published_at: '2026-11-23', publishedAt: '2026-11-23', status: 'published' },
    { id: 28, title: 'DRAFT TITLE MUST NEVER APPEAR', slug: 'draft-28', division: 'automotive', division_name: 'Automotive', excerpt: 'Draft excerpt.', body: '<p>Draft body text.</p>', published_at: '2026-11-10', publishedAt: '2026-11-10', status: 'draft' },
  ];

  it('static article 1 rewrites with the related list and the rewritten diagnostic', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.deepEqual(noscriptRelatedIds(body), [12, 11, 10]);
  });

  it('live-only id 34 rewrites with static related articles and no draft leak', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=34', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => liveRows,
    });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.ok(body.includes('<title>A Newly Published Guide — FS AI</title>'), 'live title');
    // 34 is Automotive (newest, 2026-11-23): same-division first.
    assert.deepEqual(noscriptRelatedIds(body), [12, 11, 10]);
    assert.ok(!body.includes('DRAFT TITLE MUST NEVER APPEAR'), 'draft title absent');
    assert.ok(!body.includes('Draft body text.'), 'draft body absent');
  });

  it('the live fetch still never runs for a static id, and the related list still renders', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => { throw new Error('live fetch must not run for a static id'); },
    });
    assert.equal(res.headers.get('x-seo-head'), 'rewritten');
    assert.deepEqual(noscriptRelatedIds(body), [12, 11, 10]);
  });
});

describe('no code generation in the shipped Function files', () => {
  const FUNCTION_FILES = [
    'seo-head.js',
    'package.json',
    'pages/article.js',
    'pages/division.js',
    'pages/tools.js',
  ];
  const FORBIDDEN = ['new Function', 'eval(', 'WebAssembly.compile', 'WebAssembly.instantiate'];

  for (const base of ['functions', 'frontend/functions']) {
    for (const rel of FUNCTION_FILES) {
      it(base + '/' + rel + ' contains no code-generation call', () => {
        const src = fs.readFileSync(path.join(ROOT, base, rel), 'utf8');
        for (const bad of FORBIDDEN) {
          assert.ok(!src.includes(bad), base + '/' + rel + ' must not contain ' + JSON.stringify(bad));
        }
      });
    }
  }

  it('the two seo-head.js copies are byte-identical', () => {
    const a = fs.readFileSync(path.join(ROOT, 'functions', 'seo-head.js'));
    const b = fs.readFileSync(path.join(ROOT, 'frontend', 'functions', 'seo-head.js'));
    assert.ok(a.equals(b), 'functions/seo-head.js must equal frontend/functions/seo-head.js');
  });
});
