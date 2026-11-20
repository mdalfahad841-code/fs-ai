// FS AI — sitemap/canonical parity tests (Phase 3, Priority 8).
//
// 1. The backend FRONTEND_TOOL_IDS list (backend/routes/tools.js) must
//    match the frontend tool definitions (frontend/scripts/tools.js
//    DEFS) exactly — the `?tool=` parameter is read by the frontend,
//    so the sitemap must list frontend ids, not the D1 catalogue
//    slugs (which differ: D1 'currency-manual-rate' vs frontend
//    'currency-converter', D1 'storage' vs 'storage-converter', …).
// 2. No static page canonical / og:url / JSON-LD url and no internal
//    nav href anywhere in the frontend uses a ".html" URL — the clean
//    form is the canonical form (division.html was the live offender:
//    static canonical + JS canonical both used the .html form).
// Run: node --test tests/sitemap-canonical.test.js (or: npm test)
// Local files only — no network, no live D1/Pages.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { FRONTEND_TOOL_IDS } = require('../backend/routes/tools.js');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('backend tool ids vs frontend tool definitions', () => {
  it('FRONTEND_TOOL_IDS equals the frontend DEFS ids, in the same order', () => {
    const toolsJs = read('frontend/scripts/tools.js');
    // DEFS entries sit at 4-space indent; nested input ids are deeper.
    const frontendIds = [...toolsJs.matchAll(/^    \{ id: '([a-z0-9-]+)', name:/gm)].map((m) => m[1]);
    assert.equal(frontendIds.length, 20, 'frontend must define 20 tools');
    assert.deepEqual(FRONTEND_TOOL_IDS, frontendIds);
  });

  it('every frontend tool id has a sitemap entry (via the generator)', () => {
    const seo = require('../backend/services/seo.js');
    const locs = new Set(seo.sitemapEntries().map((e) => e.loc));
    for (const id of FRONTEND_TOOL_IDS) {
      assert.ok(locs.has(`https://fs-ai-5w5.pages.dev/pages/tools?tool=${id}`), id);
    }
  });
});

describe('clean canonicals and internal links (no .html)', () => {
  const pages = [
    'frontend/index.html',
    'frontend/404.html',
    'frontend/pages/about.html',
    'frontend/pages/article.html',
    'frontend/pages/contact.html',
    'frontend/pages/dashboard.html',
    'frontend/pages/division.html',
    'frontend/pages/owner-setup.html',
    'frontend/pages/privacy.html',
    'frontend/pages/terms.html',
    'frontend/pages/tools.html',
  ];

  for (const page of pages) {
    it(`${page}: no .html in any canonical / og:url / JSON-LD url or internal href`, () => {
      const src = read(page);
      // Every absolute site URL in the file must be the clean form.
      for (const m of src.matchAll(/https:\/\/fs-ai-5w5\.pages\.dev\/[^\s"'<>]+/g)) {
        assert.ok(!m[0].includes('.html'), `${page}: ${m[0]}`);
      }
      // Every internal href must be the clean form (asset .css/.js
      // references are not hrefs to pages; the google verification
      // filename is text, not a link, and lives in app.js, not here).
      for (const m of src.matchAll(/href="([^"]+)"/g)) {
        const href = m[1];
        if (href.startsWith('#') || href.startsWith('http') || href.includes('.css') || href.includes('.js')) continue;
        assert.ok(!href.includes('.html'), `${page}: href="${href}"`);
      }
    });
  }

  it('division.html JS canonical uses the clean form', () => {
    const src = read('frontend/pages/division.html');
    assert.ok(src.includes("pages/division?division=' + div.id"), 'JS canonical must be /pages/division?division=<id>');
    assert.ok(!src.includes('division.html'), 'no .html division URL anywhere on the page');
  });

  it('app.js / tools.js / navigation.js build no .html internal links', () => {
    for (const rel of ['frontend/scripts/app.js', 'frontend/scripts/tools.js', 'frontend/scripts/navigation.js']) {
      const src = read(rel);
      for (const bad of [
        'pages/division.html', 'pages/tools.html', 'pages/about.html',
        'pages/contact.html', 'pages/privacy.html', 'pages/terms.html',
        'division.html?division=', 'tools.html?tool=', "pages/index.html",
      ]) {
        assert.ok(!src.includes(bad), `${rel} must not build ${bad}`);
      }
    }
    // navigation.js active-state still handles a visitor landing on a
    // .html URL directly (it strips the suffix before matching).
    const nav = read('frontend/scripts/navigation.js');
    assert.ok(nav.includes("replace(/\\.html$/, '')"), 'navigation must strip .html before matching');
    assert.ok(nav.includes("indexOf('/division')"), 'division active-state must match the clean path');
    assert.ok(nav.includes("indexOf('/tools')"), 'tools active-state must match the clean path');
  });
});
