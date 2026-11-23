// FS AI — Close-out A1 (UI fixes) tests, 2026-11-23.
//
// Covers the six A1 parts against the SHIPPED files (vm with browser
// stubs where behaviour matters, source reads where the file itself is
// the contract):
//   A1.1 reveal re-observation after late renders + loading/no-JS state
//   A1.2 no owner-internal wording on public pages (GA4 tag kept)
//   A1.3 newsletter forms behind NEWSLETTER_ENABLED, default OFF
//   A1.4 local 1200x630 og image + og/twitter tags
//   A1.5 hero stats / search hint derived from the merged list;
//        static meta/og/twitter/JSON-LD generic (no fixed counts)
//   A1.6 search hint under the box; badge/circle gap; Latest-guide
//        tie-break (max date, then highest id)
//
// Run: node --test tests/closeout-a1.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ANIM_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'animations.js'), 'utf8');
const SEARCH_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'search.js'), 'utf8');
const NEWS_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'newsletter.js'), 'utf8');
const MAIN_CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'main.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');

const PUBLIC_PAGES = [
  'index.html', '404.html',
  'pages/about.html', 'pages/article.html', 'pages/contact.html',
  'pages/division.html', 'pages/privacy.html', 'pages/terms.html',
  'pages/tools.html',
];
/* Every public page that carries OG tags (404.html has none, by design). */
const OG_PAGES = [
  'index.html',
  'pages/about.html', 'pages/article.html', 'pages/contact.html',
  'pages/division.html', 'pages/privacy.html', 'pages/terms.html',
  'pages/tools.html',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* ------------------------------------------------------------------ */
/* A1.1 — animations.js: late .reveal elements get observed.           */
/* ------------------------------------------------------------------ */
function makeAnimSandbox(matchReduced) {
  const listeners = {};
  const els = [];
  const observed = [];
  const moInstances = [];
  function makeEl() {
    const classes = new Set();
    return {
      nodeType: 1,
      classList: {
        add(c) { classes.add(c); },
        contains(c) { return c === 'reveal' || classes.has(c); },
        has(c) { return classes.has(c); },
      },
      querySelectorAll() { return []; },
    };
  }
  class FakeIO {
    constructor(cb) { this.cb = cb; }
    observe(el) { observed.push(el); }
    unobserve() {}
  }
  class FakeMO {
    constructor(cb) { this.cb = cb; moInstances.push(this); }
    observe(target) { this.target = target; }
    disconnect() {}
  }
  const sandbox = {
    window: {
      matchMedia() { return { matches: !!matchReduced }; },
      IntersectionObserver: FakeIO,
      MutationObserver: FakeMO,
    },
    /* Bare identifiers in the script (new IntersectionObserver /
       typeof MutationObserver) resolve against the vm global, not
       window — mirror them at the top level too. */
    IntersectionObserver: FakeIO,
    MutationObserver: FakeMO,
    document: {
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      querySelectorAll(sel) { return sel === '.reveal' ? els.slice() : []; },
      body: { nodeType: 1 },
    },
    console,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(ANIM_JS, sandbox);
  return {
    sandbox, listeners, els, observed, moInstances, makeEl,
    fireDomReady() { (listeners.DOMContentLoaded || []).forEach((fn) => fn()); },
  };
}

describe('A1.1 reveal re-observation after a late render', () => {
  it('exposes refreshReveal and watches the body for late .reveal nodes', () => {
    const t = makeAnimSandbox(false);
    t.fireDomReady();
    assert.equal(typeof t.sandbox.window.FSAI.refreshReveal, 'function', 'refreshReveal must be exposed');
    assert.equal(t.moInstances.length, 1, 'a MutationObserver must be created on load');
    assert.equal(t.moInstances[0].target, t.sandbox.document.body, 'it must observe the body');
  });

  it('a card inserted after DOMContentLoaded is observed (no longer stuck at opacity:0)', () => {
    const t = makeAnimSandbox(false);
    t.fireDomReady();
    assert.equal(t.observed.length, 0, 'nothing to observe at load when the grids are still empty');
    const late = t.makeEl();
    t.els.push(late);
    // Late insertion via the MutationObserver path …
    t.moInstances[0].cb([{ addedNodes: [late] }]);
    assert.ok(t.observed.includes(late), 'MutationObserver callback must observe the late card');
    // … and via the explicit refresh path app.js calls after each render.
    const late2 = t.makeEl();
    t.els.push(late2);
    t.sandbox.window.FSAI.refreshReveal();
    assert.ok(t.observed.includes(late2), 'refreshReveal must observe the late card');
    assert.equal(t.observed.filter((e) => e === late2).length, 1, 'an element is never observed twice');
    t.sandbox.window.FSAI.refreshReveal();
    assert.equal(t.observed.filter((e) => e === late2).length, 1, 're-running refreshReveal still observes once');
  });

  it('reduced-motion still reveals late cards immediately (no observer needed)', () => {
    const t = makeAnimSandbox(true);
    t.fireDomReady();
    const late = t.makeEl();
    t.els.push(late);
    t.sandbox.window.FSAI.refreshReveal();
    assert.ok(late.classList.has('visible'), 'reduced-motion late card must gain .visible at once');
    assert.equal(t.observed.length, 0, 'no IntersectionObserver is used under reduced motion');
  });

  it('home grids carry a loading state and a no-JS fallback list', () => {
    assert.ok(INDEX_HTML.includes('Loading divisions…'), 'division grid loading state');
    assert.ok(INDEX_HTML.includes('Loading articles…'), 'article grid loading state');
    assert.ok(INDEX_HTML.includes('<noscript>'), 'no-JS fallback present');
    assert.ok(INDEX_HTML.includes('pages/division?division=automotive'), 'noscript division list');
    const articleLinks = (INDEX_HTML.match(/<li><a href="pages\/article\?id=/g) || []).length;
    assert.equal(articleLinks, 25, 'noscript article list must link all 25 articles');
    assert.ok(INDEX_HTML.includes('.grid-loading{display:none}'), 'loading text hidden when JS is off');
  });
});

/* ------------------------------------------------------------------ */
/* Harness: run the shipped app.js in a vm sandbox (live-articles     */
/* pattern) with a stubbed fetch and a stub document.                 */
/* ------------------------------------------------------------------ */
function makeDoc() {
  const els = {};
  function el() {
    return {
      innerHTML: '', textContent: '', value: '', _attrs: {},
      getAttribute(k) { return this._attrs[k] || null; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      querySelectorAll() { return []; },
      addEventListener() {},
      scrollIntoView() {},
    };
  }
  const listeners = {};
  const doc = {
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    getElementById(id) { if (!els[id]) els[id] = el(); return els[id]; },
    querySelector() { return null; },
    createElement() { return el(); },
    documentElement: { getAttribute() { return null; } },
    head: { appendChild() {} },
  };
  return {
    doc, els,
    fire() { (listeners.DOMContentLoaded || []).forEach((fn) => fn()); },
  };
}

function loadApp(fetchImpl, extraScripts) {
  const made = makeDoc();
  const sandbox = {
    window: { location: { pathname: '/', search: '' } },
    document: made.doc,
    console,
    URLSearchParams,
    setTimeout(fn) { return { fn, cleared: false }; },
    clearTimeout() {},
    AbortController: class {
      constructor() { this.signal = {}; }
      abort() {}
    },
  };
  if (fetchImpl !== undefined) sandbox.fetch = fetchImpl;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  for (const src of extraScripts || []) vm.runInContext(src, sandbox);
  return { FSAI: sandbox.window.FSAI, sandbox, made };
}

function fetchOk(rows) {
  return async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, articles: rows, total: rows.length, source: 'd1' }),
  });
}
function fetchFail() {
  return async () => { throw new Error('network down'); };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('A1.1/A1.5/A1.6 renderShared re-observes and derives counts', () => {
  it('renderShared calls refreshReveal after rendering the grids', async () => {
    const { FSAI, sandbox, made } = loadApp(fetchFail());
    let calls = 0;
    sandbox.window.FSAI.refreshReveal = () => { calls += 1; };
    made.fire();
    await FSAI.liveReady;
    await tick();
    assert.ok(calls >= 1, 'refreshReveal must be called after the shared render');
    assert.ok(made.els.divisionGrid.innerHTML.includes('reveal'), 'division cards carry .reveal');
    assert.ok(made.els.articleGrid.innerHTML.includes('reveal'), 'article cards carry .reveal');
  });

  it('hero stats / Latest subhead / tools link derive from the merged list (26 articles shows 26)', async () => {
    const fixture26 = {
      id: 26, slug: 'fixture-26', title: 'Fixture: Twenty-Sixth Guide',
      excerpt: 'A fixture article.', body: '<p>Fixture.</p>',
      division: 'automotive', division_name: 'Automotive',
      publishedAt: '2026-11-23', published_at: '2026-11-23', status: 'published',
    };
    const { FSAI, made } = loadApp(fetchOk([fixture26]));
    made.fire();
    await FSAI.liveReady;
    await tick();
    assert.equal(FSAI.ARTICLES.length, 26, 'merged list has 26 articles');
    assert.match(made.els.heroStats.innerHTML, />26</, 'hero stats show 26 articles');
    assert.equal(made.els.latestSubhead.textContent, '26 articles across 8 divisions');
    assert.equal(made.els.allToolsLink.textContent, 'All 20 tools →');
    assert.ok(made.els.siteFooter.innerHTML.includes('Articles: 26'), 'footer counts derive too');
  });

  it('static bundle only: hero stats show 25 and the footer keeps its counts', async () => {
    const { FSAI, made } = loadApp(fetchFail());
    made.fire();
    await FSAI.liveReady;
    await tick();
    assert.match(made.els.heroStats.innerHTML, />25</, 'hero stats show 25 with the static bundle');
    assert.ok(made.els.siteFooter.innerHTML.includes('Articles: 25'), 'footer shows 25');
  });
});

/* ------------------------------------------------------------------ */
/* A1.2 — no owner-internal wording on public pages.                   */
/* ------------------------------------------------------------------ */
describe('A1.2 public pages carry no owner-internal wording', () => {
  const INTERNAL = [
    'Revenue', '$0.00', 'GA4', 'Data unavailable', 'Emergency Stop',
    '16-agent', '16 agents', 'Tracking Connected', 'Paused by owner',
  ];
  for (const page of PUBLIC_PAGES) {
    it(page + ' has no internal wording', () => {
      const html = read('frontend/' + page);
      for (const s of INTERNAL) {
        assert.ok(!html.includes(s), page + ' must not contain ' + JSON.stringify(s));
      }
    });
  }

  it('the GA4 tag itself is kept on every tagged public page', () => {
    for (const page of OG_PAGES) {
      const html = read('frontend/' + page);
      assert.ok(html.includes('https://www.googletagmanager.com/gtag/js?id=G-JVSCJT2DHJ'), page + ' keeps the gtag script');
      assert.ok(html.includes('gtag("config","G-JVSCJT2DHJ")'), page + ' keeps the gtag config');
    }
  });

  it('the rendered public footer has no internal wording, only derived counts', async () => {
    const { FSAI, made } = loadApp(fetchFail());
    made.fire();
    await FSAI.liveReady;
    await tick();
    const footer = made.els.siteFooter.innerHTML;
    for (const s of ['Revenue', '$0.00', 'GA4', 'Data unavailable', 'Tracking Connected', 'Paused by owner', 'Pending:']) {
      assert.ok(!footer.includes(s), 'footer must not contain ' + JSON.stringify(s));
    }
    assert.ok(footer.includes('Articles: 25'), 'footer keeps the derived article count');
  });

  it('the owner dashboard still keeps the internal wording (untouched)', () => {
    const html = read('frontend/pages/dashboard.html');
    assert.ok(html.includes('Emergency Stop'), 'dashboard keeps Emergency Stop');
    assert.ok(html.includes('Revenue'), 'dashboard keeps revenue wording');
  });
});

/* ------------------------------------------------------------------ */
/* A1.3 — newsletter flag, default OFF.                                */
/* ------------------------------------------------------------------ */
describe('A1.3 newsletter forms behind a default-OFF flag', () => {
  it('the flag exists, is a single constant, and defaults to OFF', () => {
    assert.ok(NEWS_JS.includes('var NEWSLETTER_ENABLED = false'), 'single flag, default off');
    assert.ok((NEWS_JS.match(/NEWSLETTER_ENABLED/g) || []).length >= 3, 'flag is the one gate');
  });

  it('the static home page contains no newsletter form at all', () => {
    assert.ok(!INDEX_HTML.includes('id="newsletterForm"'), 'no subscribe form in static HTML');
    assert.ok(!INDEX_HTML.includes('id="unsubscribeForm"'), 'no unsubscribe form in static HTML');
    assert.ok(INDEX_HTML.includes('id="newsletterForms"'), 'empty slot for the flag-gated forms');
    // The honesty wording stays (existing sitewide-admin-security test).
    assert.ok(INDEX_HTML.includes('pending confirmation'));
    assert.ok(INDEX_HTML.includes('no free email sender is connected'));
  });

  it('with the flag off, loading the script renders no form', () => {
    const listeners = {};
    const sandbox = {
      window: {},
      document: {
        addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
        getElementById() { return null; },
      },
      console,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(NEWS_JS, sandbox);
    assert.equal(sandbox.window.FSAI.newsletterEnabled, false, 'flag reads off');
    (listeners.DOMContentLoaded || []).forEach((fn) => fn());
    assert.equal(sandbox.document.getElementById('newsletterForm'), null, 'no subscribe form created');
    assert.equal(typeof sandbox.window.FSAI.newsletter.subscribe, 'function', 'subscribe API kept');
    assert.equal(typeof sandbox.window.FSAI.newsletter.unsubscribe, 'function', 'unsubscribe API kept');
  });

  it('the flag-on render path builds both forms with the same ids', () => {
    const listeners = {};
    const slot = { innerHTML: '' };
    const formStub = { addEventListener() {}, reset() {} };
    const inputStub = { value: '', addEventListener() {} };
    const sandbox = {
      window: {},
      document: {
        addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
        getElementById(id) {
          if (id === 'newsletterForms') return slot;
          if (id === 'newsletterForm' || id === 'unsubscribeForm') return formStub;
          return inputStub;
        },
      },
      console,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(NEWS_JS, sandbox);
    assert.equal(sandbox.window.FSAI.renderNewsletterForms(), true, 'render function succeeds');
    assert.ok(slot.innerHTML.includes('id="newsletterForm"'), 'subscribe form built');
    assert.ok(slot.innerHTML.includes('id="unsubscribeForm"'), 'unsubscribe form built');
    assert.ok(slot.innerHTML.includes('newsletterConsent'), 'consent checkbox kept');
  });
});

/* ------------------------------------------------------------------ */
/* A1.4 — local og image + tags.                                       */
/* ------------------------------------------------------------------ */
describe('A1.4 local 1200x630 og image', () => {
  const OG_URL = 'https://fs-ai-5w5.pages.dev/og-image.png';

  it('the image exists at the Pages-served path and is 1200x630', () => {
    const buf = fs.readFileSync(path.join(FRONTEND, 'og-image.png'));
    assert.ok(buf.length > 1000, 'image is a real file, not a stub');
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
    assert.equal(buf.readUInt32BE(16), 1200, 'width 1200');
    assert.equal(buf.readUInt32BE(20), 630, 'height 630');
    const mirror = fs.readFileSync(path.join(ROOT, 'public', 'og-image.png'));
    assert.ok(mirror.equals(buf), 'public/ mirror matches (sitemap convention)');
  });

  it('the image is drawn locally: navy background, no external asset', () => {
    // Pixel-level colour is pinned by the generator (flat #0A1527 fill)
    // and was verified by decoding the PNG after generation; here the
    // contract is the local generator itself.
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'make-og-image.py')), 'generator script kept in the repo');
    const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'make-og-image.py'), 'utf8');
    assert.ok(gen.includes('#0A1527'), 'generator uses the pin navy');
    assert.ok(gen.includes('One Platform. Multiple Possibilities.'), 'generator draws the tagline');
    assert.ok(!/https?:\/\//.test(gen.replace(/fs-ai-5w5\.pages\.dev/g, '')), 'generator downloads nothing');
  });

  it('og + twitter tags point at the local image on every tagged page', () => {
    for (const page of OG_PAGES) {
      const html = read('frontend/' + page);
      assert.ok(html.includes('<meta property="og:image" content="' + OG_URL + '">'), page + ' og:image');
      assert.ok(html.includes('<meta name="twitter:image" content="' + OG_URL + '">'), page + ' twitter:image');
      assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'), page + ' large card');
    }
    assert.ok(INDEX_HTML.includes('<meta property="og:image:width" content="1200">'), 'home og width');
    assert.ok(INDEX_HTML.includes('<meta property="og:image:height" content="630">'), 'home og height');
  });

  it('the article page sets per-article og tags (incl. the image) in JS', () => {
    const html = read('frontend/pages/article.html');
    assert.ok(html.includes("setMeta('og:image'"), 'article JS sets og:image');
    assert.ok(html.includes("setMeta('twitter:image'"), 'article JS sets twitter:image');
    assert.ok(html.includes("setMeta('twitter:card', 'summary_large_image'"), 'article JS upgrades the card');
  });
});

/* ------------------------------------------------------------------ */
/* A1.5 — generic static meta; derived counts.                         */
/* ------------------------------------------------------------------ */
describe('A1.5 static copy is generic, counts come from the list', () => {
  const FIXED = [
    '25 articles', '25 free articles', '20 free tools', '20 tools',
    '8 divisions', 'All 8', 'All 20 tools', '20 converters',
  ];
  for (const page of PUBLIC_PAGES) {
    it(page + ' has no hard-coded count in static copy', () => {
      const html = read('frontend/' + page);
      for (const s of FIXED) {
        assert.ok(!html.includes(s), page + ' must not contain ' + JSON.stringify(s));
      }
    });
  }

  it('the home hero keeps its wording (A1.6: hero wording unchanged)', () => {
    assert.ok(INDEX_HTML.includes('Explore more.<br>Know more.<br>Do more.'), 'hero headline unchanged');
    assert.ok(INDEX_HTML.includes('One Platform. Multiple Possibilities.'), 'hero tagline unchanged');
    assert.ok(INDEX_HTML.includes('Eight divisions, free articles and free tools'), 'hero lead keeps "Eight divisions"');
    assert.ok(INDEX_HTML.includes('<h2>Eight divisions, one platform</h2>'), 'divisions heading keeps "Eight divisions"');
  });

  it('the division page lead keeps its wording', () => {
    const html = read('frontend/pages/division.html');
    assert.ok(html.includes('Eight divisions, one platform. Choose a division to see its articles.'), 'division lead unchanged');
  });
});

/* ------------------------------------------------------------------ */
/* A1.6 — hint under the box; badge gap; Latest-guide tie-break.       */
/* ------------------------------------------------------------------ */
describe('A1.6 search hint, badge gap, Latest-guide tie-break', () => {
  it('the hint sits directly under the search box in the markup', () => {
    const formIdx = INDEX_HTML.indexOf('<form class="search-box"');
    const countIdx = INDEX_HTML.indexOf('id="searchCount"');
    const resultsIdx = INDEX_HTML.indexOf('id="searchResults"');
    assert.ok(formIdx !== -1 && countIdx > formIdx, 'searchCount follows the search box');
    assert.ok(resultsIdx > countIdx, 'searchCount comes before the results section');
    assert.ok(!INDEX_HTML.includes('Type to search all 25 articles.'), 'no hard-coded hint in the results block');
  });

  it('the hint derives from the merged list and survives a new article', async () => {
    const { FSAI, made } = loadApp(fetchFail(), [SEARCH_JS]);
    made.fire();
    await FSAI.liveReady;
    await tick();
    assert.equal(made.els.searchCount.textContent, 'Type to search all 25 articles.', 'hint shows 25 from the static bundle');
    assert.equal(made.els.searchResults.innerHTML, '', 'results block is empty until the user types');
    FSAI.ARTICLES.push({
      id: 26, title: 'Fixture: Twenty-Sixth Guide', division: 'Automotive',
      category: '', date: '2026-11-23', excerpt: 'Fixture.', body: '<p>Fixture.</p>',
    });
    FSAI.refreshSearchHint();
    assert.equal(made.els.searchCount.textContent, 'Type to search all 26 articles.', 'hint follows the merged list');
  });

  it('the hero-preview plate art is pushed right of the No. badge (real gap)', () => {
    assert.ok(MAIN_CSS.includes('.hero-preview .div-plate-art'), 'hero plate-art rule exists');
    assert.ok(MAIN_CSS.includes('transform: translateX(16px)'), '16px right shift on the hero plate art');
  });

  it('sortLatestFirst: same max date → highest id wins', () => {
    const { FSAI } = loadApp(fetchFail());
    const list = [
      { id: 1, date: '2026-11-11' },
      { id: 13, date: '2026-11-11' },
      { id: 25, date: '2026-11-11' },
      { id: 2, date: '2026-11-10' },
    ];
    assert.equal(list.slice().sort(FSAI.sortLatestFirst)[0].id, 25, 'highest id wins the tie');
    assert.equal(list.slice().sort(FSAI.sortLatestFirst)[1].id, 13, 'then the next id');
  });

  it('static bundle: Latest guide is now id 13 (the tie-break winner), not id 1', async () => {
    const { FSAI, made } = loadApp(fetchFail());
    made.fire();
    await FSAI.liveReady;
    await tick();
    assert.ok(made.els.heroPreview.innerHTML.includes('What Is AI?'), 'hero shows id 13');
    assert.ok(made.els.heroPreview.innerHTML.includes('No. 13'), 'hero plate shows No. 13');
    assert.ok(!made.els.heroPreview.innerHTML.includes('EV Charging at Home'), 'hero no longer shows id 1');
  });

  it('live tie: two new articles on the same max date → highest id wins the hero', async () => {
    const mk = (id) => ({
      id, slug: 'fixture-' + id, title: 'Fixture Guide ' + id,
      excerpt: 'Fixture.', body: '<p>Fixture.</p>',
      division: 'automotive', division_name: 'Automotive',
      publishedAt: '2026-11-11', published_at: '2026-11-11', status: 'published',
    });
    const { FSAI, made } = loadApp(fetchOk([mk(26), mk(30)]));
    made.fire();
    await FSAI.liveReady;
    await tick();
    assert.ok(made.els.heroPreview.innerHTML.includes('Fixture Guide 30'), 'hero shows id 30');
    assert.ok(!made.els.heroPreview.innerHTML.includes('Fixture Guide 26'), 'hero does not show id 26');
  });
});
