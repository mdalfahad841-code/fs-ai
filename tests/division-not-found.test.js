// FS AI — invalid division slug shows "Division not found" tests.
//
// Covers BOTH paths that can answer a ?division=<slug> request:
//
//   1. API path — GET /api/divisions/<slug> through the real Worker entry
//      point (src/index.js), in fallback mode (no D1) and against the
//      shared fake D1 (tests/fake-d1.js). An unknown slug must be a 404
//      with error "Division not found"; a valid slug must stay a 200.
//   2. Frontend-data path — the shipped division page. The page renders
//      from the frontend data in frontend/scripts/app.js, so the test
//      loads that shipped file in a vm sandbox and executes the shipped
//      inline script from frontend/pages/division.html against a small
//      fake DOM. ?division=nope must render a "Division not found"
//      heading + message + a link back to the all-divisions page, and
//      must NOT show the generic latest-articles view. Valid slugs and
//      the no-param view must behave exactly as before.
//
// No browser and no network are needed.
// Run: node --test tests/division-not-found.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { handleRequest } = require('../src/index.js');
const { makeOwnerEnv } = require('./fake-d1.js');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'division.html'), 'utf8');

/* The page's own inline script: the last bare <script> block in the file. */
const INLINE_SCRIPT = DIVISION_HTML
  .match(/<script>([\s\S]*?)<\/script>/g)
  .map((block) => block.replace(/^<script>/, '').replace(/<\/script>$/, ''))
  .find((src) => src.includes('divisionPageState'));

async function getDivision(env, slug) {
  const res = await handleRequest(
    new Request('http://localhost/api/divisions/' + slug, { method: 'GET' }), env);
  return { res, data: await res.json() };
}

describe('API path: GET /api/divisions/:slug', () => {
  it('unknown slug is 404 "Division not found" in fallback mode (no D1)', async () => {
    const { res, data } = await getDivision({}, 'nope');
    assert.equal(res.status, 404);
    assert.equal(data.ok, false);
    assert.equal(data.error, 'Division not found');
  });

  it('unknown slug is 404 "Division not found" against the D1-backed fake DB', async () => {
    const env = await makeOwnerEnv();
    const { res, data } = await getDivision(env, 'nope');
    assert.equal(res.status, 404);
    assert.equal(data.ok, false);
    assert.equal(data.error, 'Division not found');
  });

  it('valid slugs still return 200 with the division (fallback and D1)', async () => {
    const fallback = await getDivision({}, 'automotive');
    assert.equal(fallback.res.status, 200);
    assert.equal(fallback.data.ok, true);
    assert.equal(fallback.data.division.slug, 'automotive');
    assert.equal(fallback.data.division.name, 'Automotive');
    assert.ok(Array.isArray(fallback.data.articles), 'articles array must be present');
    assert.ok(fallback.data.articles.length > 0, 'automotive must have articles');

    const env = await makeOwnerEnv();
    const d1 = await getDivision(env, 'ai-technology');
    assert.equal(d1.res.status, 200);
    assert.equal(d1.data.division.slug, 'ai-technology');
    assert.equal(d1.data.source, 'd1');
  });

  it('the divisions list is unchanged (200, 8 divisions)', async () => {
    const res = await handleRequest(new Request('http://localhost/api/divisions', { method: 'GET' }), {});
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.total, 8);
    assert.equal(data.divisions.length, 8);
  });
});

describe('frontend-data path: FSAI.divisionPageState (shipped app.js)', () => {
  let FSAI;
  before(() => {
    const sandbox = {
      window: { location: { pathname: '/pages/division.html' } },
      document: { addEventListener: () => {}, getElementById: () => null },
    };
    vm.createContext(sandbox);
    vm.runInContext(APP_JS, sandbox, { filename: 'frontend/scripts/app.js' });
    FSAI = sandbox.window.FSAI;
  });

  it('unknown slug resolves to not-found with the slug preserved', () => {
    const state = FSAI.divisionPageState('nope');
    assert.equal(state.status, 'not-found');
    assert.equal(state.slug, 'nope');
    assert.equal(state.division, null);
    assert.equal(FSAI.divisionById('nope'), null, 'divisionById itself still returns null');
  });

  it('valid slug resolves to the division', () => {
    const state = FSAI.divisionPageState('automotive');
    assert.equal(state.status, 'division');
    assert.equal(state.slug, 'automotive');
    assert.equal(state.division.name, 'Automotive');
    for (const slug of ['ai-technology', 'gadgets-electronics', 'finance-money',
      'travel-lifestyle', 'digital-tools', 'health-wellness', 'education-learning']) {
      assert.equal(FSAI.divisionPageState(slug).status, 'division', slug + ' must stay valid');
    }
  });

  it('no slug (or an empty slug) resolves to the all-divisions view', () => {
    assert.equal(FSAI.divisionPageState(null).status, 'all');
    assert.equal(FSAI.divisionPageState('').status, 'all');
    assert.equal(FSAI.divisionPageState(undefined).status, 'all');
  });
});

/* Execute the shipped division page against a fake DOM. */
function runDivisionPage(search) {
  function makeEl(id) {
    return {
      id, textContent: '', innerHTML: '', style: {},
      setAttribute: () => {}, getAttribute: () => null, querySelectorAll: () => [],
    };
  }
  const els = {
    divisionTitle: makeEl('divisionTitle'),
    divisionIntro: makeEl('divisionIntro'),
    divisionArticles: makeEl('divisionArticles'),
    divisionArticlesHeading: makeEl('divisionArticlesHeading'),
    divisionGrid: makeEl('divisionGrid'),
    divisionBackLinks: makeEl('divisionBackLinks'),
  };
  // Seed the static text the shipped HTML already carries, as a real
  // browser would: the page script only overwrites these, never sets
  // the no-param defaults.
  els.divisionTitle.textContent = 'All divisions';
  els.divisionIntro.textContent = 'Eight divisions, one platform. Choose a division to see its articles.';
  els.divisionArticlesHeading.textContent = 'Articles';
  els.divisionBackLinks.innerHTML = '<a href="../index.html">← Back to home</a>';
  const listeners = [];
  const documentStub = {
    title: 'Divisions — FS AI',
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') listeners.push(fn); },
    getElementById: (id) => els[id] || null,
    querySelector: () => ({ setAttribute: () => {} }),
  };
  const windowStub = { location: { pathname: '/pages/division.html', search } };
  const sandbox = { window: windowStub, document: documentStub, URLSearchParams };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox, { filename: 'frontend/scripts/app.js' });
  vm.runInContext(INLINE_SCRIPT, sandbox, { filename: 'frontend/pages/division.html inline script' });
  assert.equal(listeners.length, 2, 'app.js + the page inline script must each register a DOMContentLoaded listener');
  for (const fn of listeners) fn(); // app.js renders the shared chrome, then the page script runs
  return { els, document: documentStub, window: windowStub };
}

describe('frontend-data path: shipped division.html rendered', () => {
  it('wires the not-found branch to divisionPageState', () => {
    assert.ok(INLINE_SCRIPT, 'the inline page script must be present in division.html');
    assert.ok(INLINE_SCRIPT.includes("state.status === 'not-found'"), 'page must branch on the not-found state');
    assert.ok(INLINE_SCRIPT.includes('Division not found'), 'page must carry the "Division not found" text');
    assert.ok(DIVISION_HTML.includes('id="divisionBackLinks"'), 'page must have the #divisionBackLinks element');
  });

  it('?division=nope shows "Division not found" with a link back to all divisions', () => {
    const { els, document } = runDivisionPage('?division=nope');
    assert.equal(document.title, 'Division not found — FS AI');
    assert.equal(els.divisionTitle.textContent, 'Division not found');
    assert.match(els.divisionIntro.textContent, /nope/, 'message must name the requested slug');
    assert.match(els.divisionIntro.textContent, /no division/i);
    // No generic content: no articles, no articles heading, no division grid.
    assert.equal(els.divisionArticles.innerHTML, '');
    assert.equal(els.divisionArticlesHeading.style.display, 'none');
    assert.equal(els.divisionGrid.style.display, 'none');
    // A way back: link to the all-divisions page (this page, no query).
    assert.match(els.divisionBackLinks.innerHTML, /href="division\.html"/);
    assert.match(els.divisionBackLinks.innerHTML, /Browse all divisions/);
    assert.match(els.divisionBackLinks.innerHTML, /href="\.\.\/index\.html"/, 'Back to home must be kept');
  });

  it('?division=automotive still renders that division and its articles', () => {
    const { els, document } = runDivisionPage('?division=automotive');
    assert.equal(document.title, 'Automotive — FS AI');
    assert.match(els.divisionTitle.textContent, /Automotive/);
    assert.equal(els.divisionArticlesHeading.textContent, 'Articles in Automotive');
    assert.match(els.divisionArticles.innerHTML, /EV Charging at Home/);
    assert.match(els.divisionArticles.innerHTML, /article\.html\?id=1/);
    assert.equal(els.divisionGrid.style.display, 'none', 'full grid stays hidden for a single division');
    assert.equal(els.divisionArticlesHeading.style.display, undefined, 'articles heading must not be hidden');
  });

  it('no ?division= still renders the all-divisions view with latest articles', () => {
    const { els, document } = runDivisionPage('');
    assert.equal(document.title, 'Divisions — FS AI');
    assert.equal(els.divisionTitle.textContent, 'All divisions');
    assert.equal(els.divisionArticlesHeading.textContent, 'Latest articles');
    assert.match(els.divisionArticles.innerHTML, /EV Charging at Home/);
    assert.match(els.divisionGrid.innerHTML, /Automotive/, 'all-divisions grid must still render');
    assert.equal(els.divisionGrid.style.display, undefined, 'all-divisions grid must not be hidden');
    assert.match(els.divisionBackLinks.innerHTML, /Back to home/);
  });
});
