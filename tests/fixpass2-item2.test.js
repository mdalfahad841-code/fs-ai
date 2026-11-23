// FS AI — Fix Pass 2, item 2: server-side article/division/tool heads
// for crawlers (2026-11-23).
//
// Covers the Pages Function rewrite (frontend/functions/seo-head.js, the three
// thin route files in frontend/functions/pages/) against the SHIPPED pages and
// the SHIPPED static bundle (frontend/scripts/app.js), plus the daily
// health-report check 14 (serverSideHeads) in
// backend/services/daily-health-report.js:
//   2.1  extractArrayLiteral edge cases (strings, comments, templates)
//   2.2  parseStaticData on the real app.js: 25 articles / 8 divisions /
//        20 tools, Set B dates (1 -> 2026-11-01, 12 -> 2026-11-06,
//        25 -> 2026-11-11), GENERAL_DISCLAIMER bound, no ${}, no
//        </noscript or <script in any body
//   2.3  per-article head for ids 1, 12, 25 (title, description,
//        self-referencing canonical, og:url, og:image, twitter card,
//        Article JSON-LD with datePublished = Set B date, BreadcrumbList,
//        article:published_time/section/tag, noscript body with the
//        article text) — and the visible page otherwise byte-identical
//        except the replaced anchors + the inserted block
//   2.4  one division (automotive): CollectionPage JSON-LD + per-division
//        tags + noscript article list
//   2.5  one tool (percentage): WebApplication JSON-LD + per-tool tags
//        + noscript description
//   2.6  handler: unknown article id / unknown division / unknown tool /
//        bare division and tools URLs -> the existing static fallback
//        (generic tags, 200, original headers)
//   2.7  handler: draft id 28 is NEVER exposed (generic tags, no draft
//        title/body); a live-only published id 34 IS served; static
//        wins for a shared id; a live row without a valid date is never
//        used
//   2.8  handler: data-source errors -> static fallback, still 200
//        (app.js unreadable / unparseable, live fetch throws)
//   2.9  cache headers on rewritten responses (exact Cache-Control,
//        no ETag / Last-Modified, no stale Content-Length) vs fallback
//        responses (original headers untouched)
//   2.10 escaping: a fixture title with " < & is escaped in attributes
//        and JSON-LD introduces no new </script> closer
//   2.11 health check 14: assertServerSideHead units + buildDailyHealthReport
//        through a minimal fake env (all-OK; missing head FAILs; non-200
//        FAILs; fetch error FAILs; no D1 sample rows -> NOT TESTED)
//   2.12 _routes.json + the three route files exist and export onRequest;
//        dashboard.js has the serverSideHeads label + line
//
// Run: node --test tests/fixpass2-item2.test.js (or: npm test)
// The tests never touch the network or live D1: the handler's data
// sources are injected deps, the health check runs on a fake env.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seo = require('../frontend/functions/seo-head.js');
const {
  buildDailyHealthReport,
  HEALTH_REPORT_CHECK_KEYS,
  SERVER_SIDE_HEAD_SAMPLES,
  assertServerSideHead,
} = require('../backend/services/daily-health-report.js');

const ROOT = path.join(__dirname, '..');
const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const APP_JS = read('frontend/scripts/app.js');
const ARTICLE_HTML = read('frontend/pages/article.html');
const DIVISION_HTML = read('frontend/pages/division.html');
const TOOLS_HTML = read('frontend/pages/tools.html');

/** Fake Pages context for handleSeoRequest. `nextHtml` is the static
 * page the asset would serve (with realistic headers, including a
 * Content-Length that matches it); `deps` overrides the data sources. */
function makeContext(url, nextHtml, deps = {}) {
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
    __deps: deps,
  };
}

async function handle(url, html, deps = {}) {
  const ctx = makeContext(url, html, deps);
  const res = await seo.handleSeoRequest(ctx, deps.kind || 'article', deps);
  return { res, body: await res.text() };
}

/** A rewritten head for one health-check sample, built independently
 * of the rewrite module (it defines the contract the check asserts).
 * This is the same builder tests/closeout-a5.test.js and
 * tests/closeout-a7.test.js use for their headsHtml fixtures. */
function sampleHeadHtml({ kind, title, date, url }) {
  const jsonLd = kind === 'article'
    ? `{"@context":"https://schema.org","@type":"Article","datePublished":"${date}"}`
    : kind === 'division'
      ? '{"@context":"https://schema.org","@type":"CollectionPage"}'
      : '{"@context":"https://schema.org","@type":"WebApplication"}';
  const meta = kind === 'article'
    ? `<meta property="article:published_time" content="${date}">`
    : '';
  const noscript = kind === 'article'
    ? `<noscript><h1>${title}</h1><p>The article body text.</p></noscript>`
    : kind === 'division'
      ? '<noscript><ul><li><a href="article?id=1">An article</a></li></ul></noscript>'
      : '<noscript>Does a calculation.</noscript>';
  return '<!doctype html><html><head><title>' + title + ' — FS AI</title>'
    + '<link rel="canonical" href="' + url + '">'
    + '<meta property="og:url" content="' + url + '">' + meta
    + '<script type="application/ld+json">' + jsonLd + '</script></head><body>'
    + noscript + '</body></html>';
}

/** Minimal fake env for buildDailyHealthReport: answers only the two
 * SELECTs check 14 runs, with the given article/division rows; every
 * other query returns no rows. The other 13 checks may be anything —
 * these tests assert only serverSideHeads. */
function fakeHealthEnv(articleRows, divisionRows) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              all: async () => {
                if (sql.includes('FROM articles') && params[1] === 'published') {
                  const row = (articleRows || []).find((r) => r.id === params[0]);
                  return { results: row ? [row] : [] };
                }
                if (sql.includes('FROM business_divisions')) {
                  const row = (divisionRows || []).find((r) => r.slug === params[0]);
                  return { results: row ? [row] : [] };
                }
                return { results: [] };
              },
              run: async () => ({ success: true }),
            };
          },
        };
      },
    },
  };
}

const SEED_ARTICLES = [
  { id: 1, title: 'EV Charging at Home: A Complete Beginner\'s Guide', published_at: '2026-11-01' },
  { id: 12, title: 'Best Family Cars Compared: Space, Safety and Running Costs', published_at: '2026-11-06' },
  { id: 25, title: 'How to Plan a Road Trip: Checklist and Costs', published_at: '2026-11-11' },
];
const SEED_DIVISIONS = [{ slug: 'automotive', name: 'Automotive' }];

/** Mock fetchImpl serving the canned rewritten heads for the five
 * samples (keyed by full URL) and 404 for everything else. */
function headsMockFetch(overrides = {}) {
  const map = {};
  for (const s of SERVER_SIDE_HEAD_SAMPLES) {
    const url = PAGES_BASE + s.path;
    const sample = s.kind === 'article'
      ? { kind: 'article', title: SEED_ARTICLES.find((a) => a.id === s.id).title, date: SEED_ARTICLES.find((a) => a.id === s.id).published_at, url }
      : s.kind === 'division'
        ? { kind: 'division', title: 'Automotive', url }
        : { kind: 'tool', title: 'Percentage Calculator', url };
    map[url] = sampleHeadHtml(sample);
  }
  Object.assign(map, overrides);
  return async (url) => {
    const u = String(url);
    if (Object.prototype.hasOwnProperty.call(map, u)) {
      return { status: 200, text: async () => map[u] };
    }
    return { status: 404, text: async () => '' };
  };
}

/* ------------------------------------------------------------------ */
/* 2.1 — extractArrayLiteral.                                          */
/* ------------------------------------------------------------------ */
describe('2.1 extractArrayLiteral', () => {
  it('extracts a simple array', () => {
    assert.equal(seo.extractArrayLiteral('var X = [1, 2, 3];', 'X'), '[1, 2, 3]');
  });

  it('does not stop at brackets inside strings', () => {
    const src = "var X = [{ t: 'a]b', u: \"c[d\" }];";
    assert.equal(seo.extractArrayLiteral(src, 'X'), "[{ t: 'a]b', u: \"c[d\" }]");
  });

  it('does not stop at brackets inside comments', () => {
    const src = 'var X = [1, /* ] */ 2]; // ]\nvar Y = [];';
    assert.equal(seo.extractArrayLiteral(src, 'X'), '[1, /* ] */ 2]');
  });

  it('handles template literals and ${} interpolations with brackets', () => {
    const src = 'var X = [{ b: `a${items[0]}b]c` }];';
    assert.equal(seo.extractArrayLiteral(src, 'X'), '[{ b: `a${items[0]}b]c` }]');
  });

  it('handles escaped quotes inside strings', () => {
    const src = "var X = [{ t: 'it\\'s ] fine' }];";
    assert.equal(seo.extractArrayLiteral(src, 'X'), "[{ t: 'it\\'s ] fine' }]");
  });

  it('returns null for a missing variable and for unbalanced input', () => {
    assert.equal(seo.extractArrayLiteral('var Y = [1];', 'X'), null);
    assert.equal(seo.extractArrayLiteral('var X = [1, 2;', 'X'), null);
    assert.equal(seo.extractArrayLiteral('', 'X'), null);
  });
});

/* ------------------------------------------------------------------ */
/* 2.2 — parseStaticData on the real shipped bundle.                   */
/* ------------------------------------------------------------------ */
describe('2.2 parseStaticData on the real frontend/scripts/app.js', () => {
  it('parses 25 articles, 8 divisions, 20 tools', () => {
    const data = seo.parseStaticData(APP_JS);
    assert.ok(data, 'the shipped bundle must parse');
    assert.equal(data.articles.length, 25);
    assert.deepEqual(data.articles.map((a) => a.id), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.equal(data.divisions.length, 8);
    assert.deepEqual(data.divisions.map((d) => d.id), [
      'automotive', 'ai-technology', 'gadgets-electronics', 'finance-money',
      'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning',
    ]);
    assert.equal(data.tools.length, 20);
    assert.ok(data.tools.some((t) => t.id === 'percentage' && t.name === 'Percentage Calculator'));
  });

  it('uses Set B dates (article 1 -> 2026-11-01, 12 -> 2026-11-06, 25 -> 2026-11-11)', () => {
    const data = seo.parseStaticData(APP_JS);
    const byId = Object.fromEntries(data.articles.map((a) => [a.id, a]));
    assert.equal(byId[1].date, '2026-11-01');
    assert.equal(byId[12].date, '2026-11-06');
    assert.equal(byId[25].date, '2026-11-11');
    assert.equal(byId[1].title, 'EV Charging at Home: A Complete Beginner\'s Guide');
  });

  it('binds GENERAL_DISCLAIMER (the one non-literal the bundle references)', () => {
    const data = seo.parseStaticData(APP_JS);
    const a17 = data.articles.find((a) => a.id === 17);
    assert.equal(a17.disclaimer, 'General information only — not medical/financial advice. Consult a qualified professional.');
  });

  it('the bundle has no ${} interpolation and no noscript/script breakout in any body', () => {
    assert.equal((APP_JS.match(/\$\{/g) || []).length, 0, 'template literals must stay plain strings');
    const data = seo.parseStaticData(APP_JS);
    for (const a of data.articles) {
      assert.ok(!/<\/noscript/i.test(a.body), `article ${a.id} body must not contain </noscript`);
      assert.ok(!/<script/i.test(a.body), `article ${a.id} body must not contain <script`);
    }
  });

  it('returns null for missing arrays, garbage, and malformed rows', () => {
    assert.equal(seo.parseStaticData('var ARTICLES = [];'), null);
    assert.equal(seo.parseStaticData('not javascript at all'), null);
    assert.equal(seo.parseStaticData(''), null);
    const bad = APP_JS.replace("date: '2026-11-01'", "date: 'not-a-date'");
    assert.equal(seo.parseStaticData(bad), null, 'a malformed date row fails the whole parse');
  });
});

/* ------------------------------------------------------------------ */
/* 2.3 — per-article heads (ids 1, 12, 25).                            */
/* ------------------------------------------------------------------ */
describe('2.3 rewriteArticleHtml for ids 1, 12, 25', () => {
  const data = seo.parseStaticData(APP_JS);
  const cases = [
    { id: 1, date: '2026-11-01' },
    { id: 12, date: '2026-11-06' },
    { id: 25, date: '2026-11-11' },
  ];

  for (const { id, date } of cases) {
    it(`article ${id}: per-page title, description, canonical, og/twitter, JSON-LD, noscript`, () => {
      const article = data.articles.find((a) => a.id === id);
      const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
      assert.equal(rewritten, true);
      const url = PAGES_BASE + '/pages/article?id=' + id;
      const title = article.title + ' — FS AI';
      assert.ok(html.includes('<title>' + title + '</title>'), 'per-article title');
      assert.ok(html.includes('<meta name="description" content="' + article.excerpt + '">'), 'per-article description');
      assert.ok(html.includes('<link rel="canonical" href="' + url + '">'), 'self-referencing canonical');
      assert.ok(html.includes('<meta property="og:url" content="' + url + '">'), 'og:url');
      assert.ok(html.includes('<meta property="og:title" content="' + title + '">'), 'og:title');
      assert.ok(html.includes('<meta property="og:image" content="https://fs-ai-5w5.pages.dev/og-image.png">'), 'og:image (shared)');
      assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'), 'twitter card');
      assert.ok(html.includes('<meta name="twitter:title" content="' + title + '">'), 'twitter:title');
      assert.ok(html.includes('<meta property="article:published_time" content="' + date + '">'), 'article:published_time = Set B date');
      // The division name is attribute-escaped in the meta (article 25
      // is "Travel & Lifestyle" -> "Travel &amp; Lifestyle"); JSON-LD
      // does not escape &, so the breadcrumb name stays raw.
      const escDivision = article.division.replace(/&/g, '&amp;');
      assert.ok(html.includes('<meta property="article:section" content="' + escDivision + '">'), 'article:section');
      assert.ok(html.includes('<meta property="article:tag" content="' + article.category + '">'), 'article:tag');
      // Article JSON-LD (datePublished = Set B date) + BreadcrumbList.
      assert.ok(html.includes('"@type":"Article"'), 'Article JSON-LD');
      assert.ok(html.includes('"datePublished":"' + date + '"'), 'datePublished = Set B date');
      assert.ok(html.includes('"headline":"' + article.title + '"'), 'headline');
      assert.ok(html.includes('"@type":"BreadcrumbList"'), 'BreadcrumbList');
      assert.ok(html.includes('"name":"Home"'), 'breadcrumb Home');
      assert.ok(html.includes('"name":"' + article.division + '"'), 'breadcrumb division');
      assert.ok(!html.includes('dateModified'), 'no dateModified anywhere (no data source)');
      // Noscript body carries the article text; the loading line is gone.
      assert.ok(html.includes('<noscript>'), 'noscript present');
      assert.ok(html.includes('<h1>' + article.title + '</h1>'), 'noscript h1');
      assert.ok(html.includes('<span class="article-no">No. ' + String(id).padStart(2, '0') + '</span> · Published ' + date), 'noscript meta line');
      assert.ok(html.includes(article.body.slice(0, 80)), 'noscript contains the article body');
      assert.ok(!html.includes('Loading article…'), 'loading paragraph replaced');
      // The generic tags are gone.
      assert.ok(!html.includes('<title>Article — FS AI</title>'), 'generic title gone');
      assert.ok(!html.includes('Read a free FS AI article.'), 'generic description gone');
    });

    it(`article ${id}: the visible page is otherwise byte-identical`, () => {
      const article = data.articles.find((a) => a.id === id);
      const { html } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
      const title = article.title + ' — FS AI';
      // The rewrite may change exactly seven lines (the six generic
      // head anchors + the loading paragraph) and add exactly seven
      // head lines (og:url, canonical, article:published_time,
      // article:section, article:tag, two JSON-LD scripts). A plain
      // positional line diff cannot show that — the insertion shifts
      // every later line — so filter those lines out of both texts
      // and require the rest to be identical, in order.
      const genericAnchors = new Set([
        '<title>Article — FS AI</title>',
        '<meta name="description" content="Read a free FS AI article.">',
        '<meta property="og:title" content="Article — FS AI">',
        '<meta property="og:description" content="Read a free FS AI article.">',
        '<meta name="twitter:title" content="Article — FS AI">',
        '<meta name="twitter:description" content="Read a free FS AI article.">',
      ]);
      const perArticleLines = new Set([
        '<title>' + title + '</title>',
        '<meta name="description" content="' + article.excerpt + '">',
        '<meta property="og:title" content="' + title + '">',
        '<meta property="og:description" content="' + article.excerpt + '">',
        '<meta name="twitter:title" content="' + title + '">',
        '<meta name="twitter:description" content="' + article.excerpt + '">',
      ]);
      const isInserted = (line) =>
        line.startsWith('<meta property="og:url"')
        || line.startsWith('<link rel="canonical"')
        || line.startsWith('<meta property="article:')
        || line.includes('id="articleJsonLd"')
        || line.includes('id="articleCrumbs"');
      const origKept = ARTICLE_HTML.split('\n')
        .filter((l) => !genericAnchors.has(l) && !l.includes('Loading article…'));
      const newKept = html.split('\n')
        .filter((l) => !perArticleLines.has(l) && !isInserted(l) && !l.includes('<noscript>'));
      assert.deepEqual(newKept, origKept, 'every other line must be identical and in order');
      // Everything a real browser renders is untouched: GA, styles,
      // scripts, footer, the "More from this division" heading.
      assert.ok(html.includes('gtag/js?id=G-JVSCJT2DHJ'), 'GA script kept');
      assert.ok(html.includes('More from this division'), 'division heading kept');
      assert.ok(html.includes('<div id="siteFooter"></div>'), 'footer mount point kept (the footer itself is JS-rendered)');
      for (const src of ['../scripts/app.js', '../scripts/navigation.js', '../scripts/animations.js']) {
        assert.ok(html.includes('src="' + src + '"'), src + ' kept');
      }
    });
  }

  it('refuses a body containing a noscript breakout', () => {
    const data2 = seo.parseStaticData(APP_JS);
    const evil = { ...data2.articles[0], body: '<p>ok</p></noscript><script>alert(1)</script>' };
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, evil, data2.divisions);
    assert.equal(rewritten, false);
    assert.equal(html, ARTICLE_HTML);
  });
});

/* ------------------------------------------------------------------ */
/* 2.4 — one division.                                                 */
/* ------------------------------------------------------------------ */
describe('2.4 rewriteDivisionHtml (automotive)', () => {
  it('per-division tags, CollectionPage JSON-LD, noscript article list', () => {
    const data = seo.parseStaticData(APP_JS);
    const division = data.divisions.find((d) => d.id === 'automotive');
    const inDivision = data.articles.filter((a) => a.division === division.name);
    assert.equal(inDivision.length, 12);
    const { html, rewritten } = seo.rewriteDivisionHtml(DIVISION_HTML, division, inDivision);
    assert.equal(rewritten, true);
    const url = PAGES_BASE + '/pages/division?division=automotive';
    const title = 'Automotive — FS AI';
    assert.ok(html.includes('<title>' + title + '</title>'), 'per-division title');
    assert.ok(html.includes('<meta name="description" content="' + division.description + '">'), 'per-division description');
    assert.ok(html.includes('<link rel="canonical" href="' + url + '">'), 'self-referencing canonical');
    assert.ok(html.includes('<meta property="og:url" content="' + url + '">'), 'og:url');
    assert.ok(html.includes('<meta property="og:title" content="' + title + '">'), 'og:title');
    assert.ok(html.includes('<meta name="twitter:title" content="' + title + '">'), 'twitter:title');
    assert.ok(html.includes('<meta name="twitter:description" content="' + division.description + '">'), 'twitter:description');
    assert.ok(html.includes('"@type":"CollectionPage"'), 'CollectionPage JSON-LD');
    assert.ok(html.includes('"name":"Automotive — FS AI"'), 'CollectionPage name');
    assert.ok(html.includes('"url":"' + url + '"'), 'CollectionPage url');
    assert.ok(!html.includes('<title>Divisions — FS AI</title>'), 'generic title gone');
    assert.ok(!html.includes('Loading articles…'), 'loading paragraph replaced');
    // Noscript list: all 12 automotive articles, title + link.
    assert.ok(html.includes('<noscript><ul>'), 'noscript list');
    for (const a of inDivision) {
      assert.ok(html.includes('href="article?id=' + a.id + '">' + a.title + '</a>'), `article ${a.id} linked in the noscript list`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2.5 — one tool.                                                     */
/* ------------------------------------------------------------------ */
describe('2.5 rewriteToolHtml (percentage)', () => {
  it('per-tool tags, WebApplication JSON-LD, noscript description', () => {
    const data = seo.parseStaticData(APP_JS);
    const tool = data.tools.find((t) => t.id === 'percentage');
    const { html, rewritten } = seo.rewriteToolHtml(TOOLS_HTML, tool);
    assert.equal(rewritten, true);
    const url = PAGES_BASE + '/pages/tools?tool=percentage';
    const title = 'Percentage Calculator — FS AI';
    assert.ok(html.includes('<title>' + title + '</title>'), 'per-tool title');
    assert.ok(html.includes('<meta name="description" content="' + tool.description + '">'), 'per-tool description');
    assert.ok(html.includes('<link rel="canonical" href="' + url + '">'), 'self-referencing canonical');
    assert.ok(html.includes('<meta property="og:url" content="' + url + '">'), 'og:url');
    assert.ok(html.includes('<meta property="og:title" content="' + title + '">'), 'og:title');
    assert.ok(html.includes('<meta name="twitter:title" content="' + title + '">'), 'twitter:title');
    assert.ok(html.includes('"@type":"WebApplication"'), 'WebApplication JSON-LD');
    assert.ok(html.includes('"name":"Percentage Calculator — FS AI"'), 'WebApplication name');
    assert.ok(html.includes('"applicationCategory":"UtilitiesApplication"'), 'applicationCategory');
    assert.ok(html.includes('"operatingSystem":"Any"'), 'operatingSystem');
    assert.ok(!html.includes('<title>Free Tools — FS AI</title>'), 'generic title gone');
    assert.ok(html.includes('<noscript>' + tool.description + '</noscript>'), 'noscript description');
  });
});

/* ------------------------------------------------------------------ */
/* 2.6 — handler: unknown ids / bare URLs -> static fallback.          */
/* ------------------------------------------------------------------ */
describe('2.6 handleSeoRequest: unknown ids and bare URLs fall back to the static page', () => {
  it('unknown article id 999: 200, generic tags, original headers', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=999', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => [],
    });
    assert.equal(res.status, 200);
    assert.equal(body, ARTICLE_HTML, 'byte-identical to the static page');
    assert.ok(body.includes('<title>Article — FS AI</title>'), 'generic title kept');
    assert.equal(res.headers.get('etag'), '"static-etag-1"', 'original headers untouched');
    assert.equal(res.headers.get('last-modified'), 'Mon, 23 Nov 2026 00:00:00 GMT');
  });

  it('missing ?id=, non-numeric id, and unknown division/tool slugs fall back', async () => {
    const noId = await handle(PAGES_BASE + '/pages/article', ARTICLE_HTML, { kind: 'article', fetchLiveArticles: async () => [] });
    assert.equal(noId.body, ARTICLE_HTML);
    const badId = await handle(PAGES_BASE + '/pages/article?id=abc', ARTICLE_HTML, { kind: 'article', fetchLiveArticles: async () => [] });
    assert.equal(badId.body, ARTICLE_HTML);
    const badDiv = await handle(PAGES_BASE + '/pages/division?division=nope', DIVISION_HTML, { kind: 'division' });
    assert.equal(badDiv.body, DIVISION_HTML);
    assert.ok(badDiv.body.includes('<title>Divisions — FS AI</title>'), 'generic division title kept');
    const badTool = await handle(PAGES_BASE + '/pages/tools?tool=nope', TOOLS_HTML, { kind: 'tool' });
    assert.equal(badTool.body, TOOLS_HTML);
    assert.ok(badTool.body.includes('<title>Free Tools — FS AI</title>'), 'generic tools title kept');
  });

  it('bare /pages/division and /pages/tools are NOT rewritten (generic is correct there)', async () => {
    const div = await handle(PAGES_BASE + '/pages/division', DIVISION_HTML, { kind: 'division' });
    assert.equal(div.body, DIVISION_HTML);
    const tools = await handle(PAGES_BASE + '/pages/tools', TOOLS_HTML, { kind: 'tool' });
    assert.equal(tools.body, TOOLS_HTML);
  });

  it('non-GET requests and non-HTML responses pass through untouched', async () => {
    const ctx = makeContext(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML);
    ctx.request = new Request(PAGES_BASE + '/pages/article?id=1', { method: 'HEAD' });
    const res = await seo.handleSeoRequest(ctx, 'article', {});
    assert.equal(await res.text(), ARTICLE_HTML);
  });
});

/* ------------------------------------------------------------------ */
/* 2.7 — drafts never exposed; live-only articles; static wins.       */
/* ------------------------------------------------------------------ */
describe('2.7 handleSeoRequest: drafts never exposed, live-only ids, static wins', () => {
  // A live API that returns one published article (34) and one draft
  // (28) — the shape GET /api/articles returns (published rows only
  // in production; the draft row here proves the handler never uses
  // a row whose status is not published, even if one ever leaked in).
  const liveRows = [
    { id: 34, title: 'A Newly Published Guide', slug: 'newly-published-guide', division: 'automotive', division_name: 'Automotive', excerpt: 'Fresh from the daily run.', body: '<p>Fresh content.</p>', published_at: '2026-11-23', publishedAt: '2026-11-23', status: 'published' },
    { id: 28, title: 'DRAFT TITLE MUST NEVER APPEAR', slug: 'draft-28', division: 'automotive', division_name: 'Automotive', excerpt: 'Draft excerpt.', body: '<p>Draft body text.</p>', published_at: '2026-11-10', publishedAt: '2026-11-10', status: 'draft' },
  ];

  it('draft id 28: generic tags, no draft title or body anywhere', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=28', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => liveRows,
    });
    assert.equal(res.status, 200);
    assert.equal(body, ARTICLE_HTML);
    assert.ok(!body.includes('DRAFT TITLE MUST NEVER APPEAR'), 'draft title absent');
    assert.ok(!body.includes('Draft body text.'), 'draft body absent');
  });

  it('live-only published id 34 IS served with per-article heads', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=34', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => liveRows,
    });
    assert.equal(res.status, 200);
    assert.ok(body.includes('<title>A Newly Published Guide — FS AI</title>'), 'live title');
    assert.ok(body.includes('"datePublished":"2026-11-23"'), 'live datePublished');
    assert.ok(body.includes('Fresh content.'), 'live body in the noscript');
  });

  it('a live row without a valid date is never used', async () => {
    const noDate = [{ ...liveRows[0], published_at: '', publishedAt: '' }];
    const { body } = await handle(PAGES_BASE + '/pages/article?id=34', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => noDate,
    });
    assert.equal(body, ARTICLE_HTML);
  });

  it('static wins: a live row for id 1 with a different title does not override the bundle', async () => {
    const changed = [{ ...liveRows[0], id: 1, title: 'CHANGED LIVE TITLE', published_at: '2026-11-01', publishedAt: '2026-11-01' }];
    const { body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, {
      kind: 'article',
      // The live fetch must never even be called for an id the static
      // bundle already has — prove it by throwing if it is.
      fetchLiveArticles: async () => { throw new Error('live fetch must not run for a static id'); },
    });
    assert.ok(body.includes('<title>EV Charging at Home: A Complete Beginner\'s Guide — FS AI</title>'), 'static title kept');
    assert.ok(!body.includes('CHANGED LIVE TITLE'));
  });

  it('mapLiveArticle mirrors the frontend mapping (division_name, slug, disclaimer)', () => {
    const data = seo.parseStaticData(APP_JS);
    const mapped = seo.mapLiveArticle(liveRows[0], data.divisions);
    assert.equal(mapped.id, 34);
    assert.equal(mapped.division, 'Automotive');
    assert.equal(mapped.date, '2026-11-23');
    assert.equal(seo.mapLiveArticle({ id: 35, title: 'No division' }, data.divisions), null);
    assert.equal(seo.mapLiveArticle(null, data.divisions), null);
  });
});

/* ------------------------------------------------------------------ */
/* 2.8 — data-source errors -> static fallback, still 200.             */
/* ------------------------------------------------------------------ */
describe('2.8 handleSeoRequest: data-source errors fall back, still 200', () => {
  it('app.js unreadable (ASSETS fetch fails) -> static page', async () => {
    const ctx = makeContext(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML);
    ctx.env.ASSETS.fetch = async () => { throw new Error('assets down'); };
    const res = await seo.handleSeoRequest(ctx, 'article', {});
    assert.equal(res.status, 200);
    assert.equal(await res.text(), ARTICLE_HTML);
  });

  it('app.js unparseable -> static page', async () => {
    const ctx = makeContext(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML);
    ctx.env.ASSETS.fetch = async () => new Response('garbage {{{', { headers: { 'content-type': 'application/javascript' } });
    const res = await seo.handleSeoRequest(ctx, 'article', {});
    assert.equal(await res.text(), ARTICLE_HTML);
  });

  it('live fetch throws for an unknown id -> static page, still 200', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=999', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => { throw new Error('worker down'); },
    });
    assert.equal(res.status, 200);
    assert.equal(body, ARTICLE_HTML);
  });

  it('a rewrite that loses an anchor (edited page) -> static page', async () => {
    const edited = ARTICLE_HTML.replace('<title>Article — FS AI</title>', '<title>Something else</title>');
    const { body } = await handle(PAGES_BASE + '/pages/article?id=1', edited, { kind: 'article' });
    assert.equal(body, edited, 'fail-closed: the edited page is served as-is');
  });
});

/* ------------------------------------------------------------------ */
/* 2.9 — cache headers.                                               */
/* ------------------------------------------------------------------ */
describe('2.9 cache headers', () => {
  it('a rewritten response carries exactly public, max-age=0, must-revalidate and no stale validators', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(res.headers.get('etag'), null, 'static ETag stripped');
    assert.equal(res.headers.get('last-modified'), null, 'static Last-Modified stripped');
    const cl = res.headers.get('content-length');
    assert.ok(cl === null || Number(cl) === Buffer.byteLength(body, 'utf8'),
      'no stale Content-Length (absent, or the rewritten body length), got ' + cl);
    assert.ok(body.includes('<title>EV Charging at Home'), 'and it really is rewritten');
  });

  it('a fallback response keeps the original headers untouched', async () => {
    const { res, body } = await handle(PAGES_BASE + '/pages/article?id=999', ARTICLE_HTML, {
      kind: 'article',
      fetchLiveArticles: async () => [],
    });
    assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(res.headers.get('etag'), '"static-etag-1"');
    assert.equal(res.headers.get('last-modified'), 'Mon, 23 Nov 2026 00:00:00 GMT');
    assert.equal(res.headers.get('content-length'), String(Buffer.byteLength(body, 'utf8')));
  });

  it('seoHeaders sets the exact Cache-Control and strips ETag/Last-Modified/Content-Length', () => {
    const h = seo.seoHeaders(new Headers({
      'cache-control': 'public, max-age=3600',
      etag: '"x"',
      'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
      'content-length': '42',
      'content-type': 'text/html',
    }));
    assert.equal(h.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(h.get('etag'), null);
    assert.equal(h.get('last-modified'), null);
    assert.equal(h.get('content-length'), null);
    assert.equal(h.get('content-type'), 'text/html', 'other headers kept');
  });

  it('no Vary header is set on rewritten responses (the URL is the cache key)', async () => {
    const { res } = await handle(PAGES_BASE + '/pages/article?id=1', ARTICLE_HTML, { kind: 'article' });
    assert.equal(res.headers.get('vary'), null);
  });
});

/* ------------------------------------------------------------------ */
/* 2.10 — escaping.                                                    */
/* ------------------------------------------------------------------ */
describe('2.10 escaping', () => {
  it('a fixture title with " < & is escaped in attributes and text', () => {
    const data = seo.parseStaticData(APP_JS);
    const fixture = {
      id: 99, title: 'A "quoted" <tag> & amp', division: 'Automotive', category: 'Test',
      date: '2026-11-23', excerpt: 'Excerpt with "quotes" & <angles>.', body: '<p>Body.</p>',
    };
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, fixture, data.divisions);
    assert.equal(rewritten, true);
    assert.ok(html.includes('<title>A &quot;quoted&quot; &lt;tag&gt; &amp; amp — FS AI</title>'), 'title attribute-escaped');
    assert.ok(html.includes('<h1>A &quot;quoted&quot; &lt;tag&gt; &amp; amp</h1>'), 'noscript h1 escaped');
    assert.ok(!html.includes('A "quoted" <tag> & amp — FS AI'), 'raw title never appears in the head');
  });

  it('JSON-LD introduces no new </script> closer', () => {
    const data = seo.parseStaticData(APP_JS);
    const fixture = {
      id: 99, title: 'Breakout </script><script>alert(1)</script>', division: 'Automotive', category: 'Test',
      date: '2026-11-23', excerpt: 'x', body: '<p>Body.</p>',
    };
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, fixture, data.divisions);
    assert.equal(rewritten, true);
    const closers = (html.match(/<\/script>/g) || []).length;
    const originalClosers = (ARTICLE_HTML.match(/<\/script>/g) || []).length;
    // The rewrite legitimately adds exactly two <script> elements
    // (Article + BreadcrumbList JSON-LD) — nothing else may add one.
    assert.equal(closers, originalClosers + 2, 'only the two new JSON-LD scripts add closers');
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    assert.equal(ldBlocks.length, 2, 'exactly the two new JSON-LD blocks');
    for (const [, content] of ldBlocks) {
      assert.ok(!content.includes('</script>'), 'no literal closer inside a JSON-LD block');
      assert.ok(content.includes('\\u003c/script\\u003e'), 'the breakout is \\u-escaped inside JSON-LD');
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2.11 — health check 14 (serverSideHeads).                           */
/* ------------------------------------------------------------------ */
describe('2.11 health check 14: serverSideHeads', () => {
  it('is the 14th check key', () => {
    assert.ok(HEALTH_REPORT_CHECK_KEYS.includes('serverSideHeads'));
    assert.equal(HEALTH_REPORT_CHECK_KEYS.length, 14);
    assert.equal(SERVER_SIDE_HEAD_SAMPLES.length, 5);
  });

  it('assertServerSideHead passes a good sample and names each missing piece', () => {
    const url = PAGES_BASE + '/pages/article?id=1';
    const good = sampleHeadHtml({ kind: 'article', title: SEED_ARTICLES[0].title, date: '2026-11-01', url });
    assert.deepEqual(assertServerSideHead(good, { kind: 'article', title: SEED_ARTICLES[0].title, date: '2026-11-01' }, url), []);
    const noTitle = good.replace('<title>EV Charging at Home: A Complete Beginner\'s Guide — FS AI</title>', '<title>Article — FS AI</title>');
    assert.deepEqual(assertServerSideHead(noTitle, { kind: 'article', title: SEED_ARTICLES[0].title, date: '2026-11-01' }, url), ['title']);
    const noNoscript = good.replace(/<noscript>[\s\S]*?<\/noscript>/, '');
    assert.deepEqual(assertServerSideHead(noNoscript, { kind: 'article', title: SEED_ARTICLES[0].title, date: '2026-11-01' }, url), ['noscript']);
    const wrongDate = good.replace('"datePublished":"2026-11-01"', '"datePublished":"2026-11-02"')
      .replace('content="2026-11-01"', 'content="2026-11-02"');
    assert.deepEqual(assertServerSideHead(wrongDate, { kind: 'article', title: SEED_ARTICLES[0].title, date: '2026-11-01' }, url),
      ['article:published_time', 'datePublished']);
    const divUrl = PAGES_BASE + '/pages/division?division=automotive';
    const divGood = sampleHeadHtml({ kind: 'division', title: 'Automotive', url: divUrl });
    assert.deepEqual(assertServerSideHead(divGood, { kind: 'division', title: 'Automotive' }, divUrl), []);
    const toolUrl = PAGES_BASE + '/pages/tools?tool=percentage';
    const toolGood = sampleHeadHtml({ kind: 'tool', title: 'Percentage Calculator', url: toolUrl });
    assert.deepEqual(assertServerSideHead(toolGood, { kind: 'tool', title: 'Percentage Calculator' }, toolUrl), []);
  });

  it('buildDailyHealthReport: all five samples good -> serverSideHeads OK', async () => {
    const report = await buildDailyHealthReport(fakeHealthEnv(SEED_ARTICLES, SEED_DIVISIONS), {
      health: null, fetchImpl: headsMockFetch(),
    });
    assert.equal(report.checks.serverSideHeads.status, 'OK');
    assert.equal(report.checks.serverSideHeads.detail.checked, 5);
    assert.equal(report.checks.serverSideHeads.detail.passed, 5);
    assert.deepEqual(report.checks.serverSideHeads.detail.failures, []);
  });

  it('buildDailyHealthReport: a sample served with generic heads FAILs listing it', async () => {
    const generic = '<html><head><title>Article — FS AI</title></head><body><p>Loading article…</p></body></html>';
    const fetchImpl = headsMockFetch({ [PAGES_BASE + '/pages/article?id=12']: generic });
    const report = await buildDailyHealthReport(fakeHealthEnv(SEED_ARTICLES, SEED_DIVISIONS), {
      health: null, fetchImpl,
    });
    assert.equal(report.checks.serverSideHeads.status, 'FAIL');
    assert.equal(report.checks.serverSideHeads.detail.passed, 4);
    assert.match(report.checks.serverSideHeads.detail.failures.join(' '), /\/pages\/article\?id=12/);
  });

  it('buildDailyHealthReport: non-200 and fetch errors FAIL listing the sample', async () => {
    const good = headsMockFetch();
    const fetchImpl = async (url) => {
      if (String(url) === PAGES_BASE + '/pages/tools?tool=percentage') return { status: 404, text: async () => '' };
      return good(url);
    };
    const report = await buildDailyHealthReport(fakeHealthEnv(SEED_ARTICLES, SEED_DIVISIONS), {
      health: null, fetchImpl,
    });
    assert.equal(report.checks.serverSideHeads.status, 'FAIL');
    assert.match(report.checks.serverSideHeads.detail.failures.join(' '), /tool=percentage.*HTTP 404/);

    const throwing = async (url) => {
      if (String(url) === PAGES_BASE + '/pages/article?id=1') throw new Error('network down');
      return good(url);
    };
    const report2 = await buildDailyHealthReport(fakeHealthEnv(SEED_ARTICLES, SEED_DIVISIONS), {
      health: null, fetchImpl: throwing,
    });
    assert.equal(report2.checks.serverSideHeads.status, 'FAIL');
    assert.match(report2.checks.serverSideHeads.detail.failures.join(' '), /id=1.*fetch failed/);
  });

  it('buildDailyHealthReport: no D1 row for a sample -> NOT TESTED (never FAIL)', async () => {
    const report = await buildDailyHealthReport(fakeHealthEnv([], []), {
      health: null, fetchImpl: headsMockFetch(),
    });
    assert.equal(report.checks.serverSideHeads.status, 'NOT TESTED');
    assert.match(report.checks.serverSideHeads.detail.reason, /article 1/);
    // (The overall is not asserted here: this fixture's mock fetch
    // 404s every other URL, so the other checks FAIL — the
    // NOT-TESTED-never-degrades rule is covered by the A5 tests.)
  });
});

/* ------------------------------------------------------------------ */
/* 2.12 — wiring: _routes.json, route files, dashboard.                */
/* ------------------------------------------------------------------ */
describe('2.12 wiring: _routes.json, route files, dashboard', () => {
  it('_routes.json exists, parses, version 1, includes exactly the three page paths', () => {
    const routes = JSON.parse(read('frontend/_routes.json'));
    assert.equal(routes.version, 1);
    assert.deepEqual(routes.include, ['/pages/article', '/pages/division', '/pages/tools']);
    assert.deepEqual(routes.exclude, []);
  });

  it('the three route files exist and export onRequest', () => {
    for (const name of ['article', 'division', 'tools']) {
      const mod = require(`../frontend/functions/pages/${name}.js`);
      assert.equal(typeof mod.onRequest, 'function', `frontend/functions/pages/${name}.js exports onRequest`);
    }
  });

  it('the route files are thin: they only delegate to handleSeoRequest', () => {
    const kinds = { article: 'article', division: 'division', tools: 'tool' };
    for (const name of ['article', 'division', 'tools']) {
      const src = read(`frontend/functions/pages/${name}.js`);
      assert.ok(src.includes("handleSeoRequest(context, '" + kinds[name] + "')"), name + ' delegates with its kind');
      assert.ok(!src.includes('seoHeaders') && !src.includes('rewriteArticleHtml'), name + ' carries no rewrite logic');
    }
  });

  it('dashboard.js has the serverSideHeads label and renders its line', () => {
    const js = read('frontend/scripts/dashboard.js');
    assert.ok(js.includes("serverSideHeads: 'Server-side heads (crawlers)'"), 'label added');
    assert.ok(js.includes("case 'serverSideHeads':"), 'healthReportLine case added');
    assert.ok(js.includes('samples passed'), 'line reports passed/checked');
  });

  it('seo-head.js documents the mechanism, the cache decision and the root-directory assumption', () => {
    const src = read('frontend/functions/seo-head.js');
    assert.ok(src.includes('WHY A PAGES FUNCTION, NOT BUILD-TIME GENERATION'), 'mechanism decision documented');
    assert.ok(src.includes('Root directory'), 'root-directory assumption recorded');
    assert.ok(src.includes('SEO_CACHE_CONTROL'), 'cache constant documented');
  });
});
