// FS AI — Indexing fix regression tests (canonical + sitemap + internal links).
//
// Indexing fix 2026-11-20: every `.html` page URL 308-redirects to its clean
// form (e.g. /pages/article.html?id=1 -> /pages/article?id=1), and the
// sitemap + the article page's canonical were pointing at the redirecting
// forms. This file pins the clean forms so the redirecting forms cannot
// come back:
//
//   1. The article page ships NO static canonical and NO static og:url
//      (one shared URL would be wrong for all 25 articles, and a wrong
//      canonical is worse than none). The page script creates both
//      per-article, in the clean form, and keeps og:url + JSON-LD
//      mainEntityOfPage on the same canonical.
//   2. The SEO generator (backend/services/seo.js) emits only clean URLs:
//      meta/OG/JSON-LD canonicals and every sitemap entry.
//   3. Both committed sitemaps (frontend/sitemap.xml — the copy Pages
//      serves — and public/sitemap.xml) contain no `.html` URL at all and
//      list all 25 articles + all 8 divisions in the clean form.
//   4. Every article-link builder the codebase owns uses the clean form.
//
// Run: node --test tests/indexing-canonical.test.js (or: npm test)
// Local files only — no network, no live D1/Pages, nothing published.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ARTICLES } = require('../backend/routes/articles.js');
const { DIVISIONS } = require('../backend/routes/divisions.js');
const seo = require('../backend/services/seo.js');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://fs-ai-5w5.pages.dev';
const CLEAN_ARTICLE = (id) => `${SITE}/pages/article?id=${id}`;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const ARTICLE_HTML = read('frontend/pages/article.html');
const APP_JS = read('frontend/scripts/app.js');
const SEARCH_JS = read('frontend/scripts/search.js');
const DASHBOARD_JS = read('frontend/scripts/dashboard.js');
const DIVISION_HTML = read('frontend/pages/division.html');
const SOCIAL_JS = read('backend/agents/autonomy/social.js');
const FRONTEND_SITEMAP = read('frontend/sitemap.xml');
const PUBLIC_SITEMAP = read('public/sitemap.xml');

const EXPECTED_DIVISION_SLUGS = DIVISIONS.map((d) => d.slug);

function locs(xml) {
  return (xml.match(/<loc>[^<]+<\/loc>/g) || []).map((l) => l.slice(5, -6));
}

describe('article page: no wrong static canonical, clean JS-injected canonical', () => {
  it('ships no static canonical link and no static og:url', () => {
    assert.ok(!ARTICLE_HTML.includes('<link rel="canonical"'),
      'a static canonical shared by all 25 articles would be wrong for every one of them');
    assert.ok(!ARTICLE_HTML.includes('<meta property="og:url"'),
      'a static og:url with no article id would be wrong for every article');
  });

  it('injects the canonical in the clean per-article form (id, no .html)', () => {
    assert.ok(ARTICLE_HTML.includes(
      "canonical = 'https://fs-ai-5w5.pages.dev/pages/article?id=' + a.id"),
      'canonical must be the clean /pages/article?id=<id> form');
    assert.ok(!ARTICLE_HTML.includes('article.html?id='),
      'no redirecting .html article URL anywhere on the article page');
  });

  it('creates the canonical link / og:url elements when no static tag exists', () => {
    // Removing the static tags only works because setLink/setMeta create
    // the element when querySelector finds nothing — otherwise the
    // injected canonical would silently never land.
    assert.ok(ARTICLE_HTML.includes("setLink('canonical', canonical)"));
    assert.ok(ARTICLE_HTML.includes("setMeta('og:url', canonical, 'property')"));
    assert.ok(ARTICLE_HTML.includes("document.createElement('link')"),
      'setLink must create the canonical link when none is shipped');
    assert.ok(ARTICLE_HTML.includes("document.createElement('meta')"),
      'setMeta must create the og:url meta when none is shipped');
  });

  it('keeps og:url and JSON-LD mainEntityOfPage on the same canonical', () => {
    assert.ok(ARTICLE_HTML.includes("setMeta('og:url', canonical, 'property')"),
      'og:url must be set from the canonical variable, not a separate URL');
    assert.ok(ARTICLE_HTML.includes('mainEntityOfPage: canonical'),
      'JSON-LD mainEntityOfPage must be the canonical variable');
    assert.ok(ARTICLE_HTML.includes("{ '@type': 'ListItem', position: 3, name: a.title, item: canonical }"),
      'breadcrumb item for the article itself must be the canonical');
  });
});

describe('SEO generator (backend/services/seo.js): clean URLs only', () => {
  it('meta / OG / JSON-LD canonicals are the clean per-article URL', () => {
    const article = ARTICLES.find((a) => a.id === 1);
    assert.ok(article, 'fallback catalogue must have article 1');
    assert.equal(seo.metaForArticle(article).canonical, CLEAN_ARTICLE(1));
    assert.equal(seo.openGraphForArticle(article)['og:url'], CLEAN_ARTICLE(1));
    assert.equal(seo.structuredDataForArticle(article).mainEntityOfPage, CLEAN_ARTICLE(1));
  });

  it('sitemapXml emits no .html URL and every entry is a clean real route', () => {
    const xml = seo.sitemapXml();
    assert.ok(!xml.includes('.html'), 'generator output must not contain .html');
    const entries = seo.sitemapEntries();
    assert.equal(entries.length, 35, 'home + 8 divisions + 25 articles + tools');
    assert.equal(entries[0].loc, `${SITE}/`);
    for (const d of DIVISIONS) {
      assert.ok(entries.some((e) => e.loc === `${SITE}/pages/division?division=${d.slug}`),
        `division ${d.slug} must be /pages/division?division=${d.slug}`);
    }
    for (const a of ARTICLES.filter((x) => x.status === 'published')) {
      assert.ok(entries.some((e) => e.loc === CLEAN_ARTICLE(a.id)),
        `article ${a.id} must be /pages/article?id=${a.id}`);
    }
    assert.ok(entries.some((e) => e.loc === `${SITE}/pages/tools`), 'tools entry must be /pages/tools');
    assert.ok(entries.every((e) => !e.loc.includes('.html')), 'no entry may use a .html URL');
  });
});

describe('committed sitemaps: clean forms, full coverage, no .html', () => {
  for (const [name, xml, expectedLocs] of [
    ['frontend/sitemap.xml (served copy)', FRONTEND_SITEMAP, 60],
    ['public/sitemap.xml', PUBLIC_SITEMAP, 58],
  ]) {
    it(`${name} contains no .html URL`, () => {
      assert.ok(!xml.includes('.html'), `${name} must not contain .html anywhere`);
    });

    it(`${name} lists all 25 articles as /pages/article?id=N`, () => {
      const found = locs(xml);
      assert.equal(found.length, expectedLocs, `expected ${expectedLocs} <loc> entries`);
      for (let id = 1; id <= 25; id++) {
        assert.ok(found.includes(CLEAN_ARTICLE(id)), `sitemap id ${id}`);
      }
    });

    it(`${name} lists all 8 divisions as /pages/division?division=<slug>`, () => {
      const found = locs(xml);
      for (const slug of EXPECTED_DIVISION_SLUGS) {
        assert.ok(found.includes(`${SITE}/pages/division?division=${slug}`), slug);
      }
    });

    it(`${name} has every loc on the clean site origin`, () => {
      for (const loc of locs(xml)) {
        assert.ok(loc.startsWith(`${SITE}/`), loc);
        assert.ok(!loc.includes('.html'), loc);
      }
    });
  }

  it('generator output is a subset of both committed sitemaps', () => {
    // The generator emits the 35 core URLs; the committed files keep their
    // fuller sets (per-tool URLs, legal pages, bare division index) in the
    // same clean forms. Every generated URL must appear verbatim in both.
    for (const e of seo.sitemapEntries()) {
      assert.ok(FRONTEND_SITEMAP.includes(`<loc>${e.loc}</loc>`), e.loc);
      assert.ok(PUBLIC_SITEMAP.includes(`<loc>${e.loc}</loc>`), e.loc);
    }
  });
});

describe('internal article links: clean form everywhere owned', () => {
  it('no owned source file builds article.html?id= links', () => {
    for (const [name, src] of [
      ['frontend/pages/article.html', ARTICLE_HTML],
      ['frontend/pages/division.html', DIVISION_HTML],
      ['frontend/scripts/app.js', APP_JS],
      ['frontend/scripts/search.js', SEARCH_JS],
      ['frontend/scripts/dashboard.js', DASHBOARD_JS],
      ['backend/agents/autonomy/social.js', SOCIAL_JS],
      ['backend/services/seo.js', read('backend/services/seo.js')],
    ]) {
      assert.ok(!src.includes('article.html?id='), `${name} must not build article.html?id= links`);
    }
  });

  it('article lists link the clean form', () => {
    assert.ok(APP_JS.includes("href=\"pages/article?id=' + a.id + '\""), 'app.js card title link');
    assert.ok(APP_JS.includes("href=\"pages/article?id=' + a.id + '\">Read article"), 'app.js read-more link');
    assert.ok(SEARCH_JS.includes("href=\"pages/article?id=' + a.id + '\""), 'search.js result link');
    assert.ok(DASHBOARD_JS.includes("href=\"article?id=' + a.id + '\""), 'dashboard.js article link');
    assert.ok(DIVISION_HTML.includes("href=\"article?id=' + a.id + '\""), 'division.html article link');
    assert.ok(ARTICLE_HTML.includes("href=\"article?id=' + x.id + '\""), 'article.html related link');
    assert.ok(SOCIAL_JS.includes('pages/article?id=${article.id}'), 'social.js distribution-pack URL');
  });
});
