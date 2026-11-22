// FS AI — Live articles loader tests (Phase 2, 2026-11-22).
//
// Executes the SHIPPED frontend/scripts/app.js (via vm with browser stubs),
// never a re-implementation of the merge. The loader fetches the live
// published list from the Worker and merges it over the static bundle.
//
// Merge rule under test (verified against the live endpoint 2026-11-23):
// the D1 rows for the existing 25 do NOT match the static bundle
// (different excerpts, different published dates, punctuation variants in
// 10 bodies), so for ids present in both the STATIC object is kept exactly
// as-is — live rows only ADD ids the bundle does not have. Static-only
// ids are kept. That is what makes the merge byte-identical on the
// existing 25; a D1 correction to an already-published article does NOT
// surface through this loader (known limitation, recorded in app.js).
//
// Run: node --test tests/live-articles.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'article.html'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'division.html'), 'utf8');
const SEARCH_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'search.js'), 'utf8');
const CHARTS_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'charts.js'), 'utf8');

const LIVE_API_URL = 'https://fs-ai.mdalfahad841.workers.dev/api/articles?limit=100';

/* Live rows shaped exactly like the Worker returns them (division slug +
   division_name, publishedAt, no category — the D1 table holds only
   category_id). The shared-id rows deliberately differ from the static
   bundle the way the real D1 rows do (different excerpt/date/body). */
const LIVE_ROW_ID_1 = {
  id: 1, slug: 'ev-charging-at-home-complete-beginners-guide',
  title: "EV Charging at Home: A Complete Beginner's Guide (LIVE)",
  excerpt: 'Everything a first-time EV owner needs to know about charging at home.',
  body: '<p>LIVE body, not the static one.</p>',
  division: 'automotive', division_name: 'Automotive',
  publishedAt: '2026-11-02', published_at: '2026-11-02', status: 'published',
};
const FIXTURE_34 = {
  id: 34, slug: 'fixture-new-guide', title: 'Fixture: A Brand New Guide',
  excerpt: 'A fixture article used only to test the live path.',
  body: '<p>Fixture body.</p>',
  division: 'automotive', division_name: 'Automotive',
  publishedAt: '2026-11-23', published_at: '2026-11-23', status: 'published',
};
const FIXTURE_35 = {
  id: 35, slug: 'fixture-finance-guide', title: 'Fixture: A Finance Guide',
  excerpt: 'A second fixture article, in Finance & Money.',
  body: '<p>Finance fixture body.</p>',
  division: 'finance-money', division_name: 'Finance & Money',
  publishedAt: '2026-11-23', published_at: '2026-11-23', status: 'published',
};

/* ------------------------------------------------------------------ */
/* Harness: run the shipped app.js in a vm sandbox with a mock fetch.  */
/* ------------------------------------------------------------------ */
function makeDoc() {
  const els = {};
  function el() {
    return {
      innerHTML: '', textContent: '', _attrs: {},
      getAttribute(k) { return this._attrs[k] || null; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      querySelectorAll() { return []; },
    };
  }
  let domReady = null;
  const doc = {
    addEventListener(t, fn) { if (t === 'DOMContentLoaded') domReady = fn; },
    getElementById(id) { if (!els[id]) els[id] = el(); return els[id]; },
    querySelector() { return null; },
    createElement() { return el(); },
    documentElement: { getAttribute() { return null; } },
    head: { appendChild() {} },
  };
  return {
    doc, els,
    fire() { if (domReady) domReady(); },
  };
}

function loadApp(opts) {
  const { fetchImpl, doc } = opts || {};
  const timers = [];
  const controllers = [];
  const sandbox = {
    window: { location: { pathname: '/' } },
    document: doc || makeDoc().doc,
    console,
    URLSearchParams,
    setTimeout(fn, ms) { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout(t) { if (t) t.cleared = true; },
    AbortController: class {
      constructor() { this.signal = {}; this.aborted = false; controllers.push(this); }
      abort() { this.aborted = true; }
    },
  };
  if (fetchImpl !== undefined) sandbox.fetch = fetchImpl;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return { FSAI: sandbox.window.FSAI, sandbox, timers, controllers };
}

function fetchOk(rows) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ ok: true, articles: rows, total: rows.length, source: 'd1' }) };
  };
  fn.calls = calls;
  return fn;
}

function staticSnapshot(FSAI) {
  return FSAI.ARTICLES.map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt, body: a.body, date: a.date, division: a.division, category: a.category }));
}

describe('live loader: fetch behaviour', () => {
  it('without fetch, liveReady resolves false and the static 25 are untouched', async () => {
    const { FSAI } = loadApp();
    assert.equal(await FSAI.liveReady, false);
    assert.equal(FSAI.ARTICLES.length, 25);
    assert.equal(FSAI.articleById(1).title, "EV Charging at Home: A Complete Beginner's Guide");
  });

  it('fetches the live list once, with the exact API URL and no-store', async () => {
    const fetchImpl = fetchOk([]);
    const { FSAI } = loadApp({ fetchImpl });
    assert.equal(await FSAI.liveReady, false);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, LIVE_API_URL);
    assert.equal(fetchImpl.calls[0].opts.cache, 'no-store');
  });

  it('a 5 s timeout aborts the fetch and falls back to static', async () => {
    let fetchCalls = 0;
    const hanging = async () => { fetchCalls += 1; return new Promise(() => {}); };
    const { FSAI, timers, controllers } = loadApp({ fetchImpl: hanging });
    assert.equal(fetchCalls, 1);
    assert.equal(timers.length, 1, 'one timeout must be scheduled');
    assert.equal(timers[0].ms, 5000, 'the timeout must be 5 s');
    timers[0].fn(); // fire the timeout immediately instead of waiting 5 s
    assert.equal(await FSAI.liveReady, false);
    assert.equal(controllers.length, 1);
    assert.equal(controllers[0].aborted, true, 'the fetch must be aborted on timeout');
    assert.equal(FSAI.ARTICLES.length, 25);
  });
});

describe('live loader: merge rule (static wins for shared ids)', () => {
  it('live rows for existing ids do NOT overwrite the static objects', async () => {
    const { FSAI } = loadApp({ fetchImpl: fetchOk([LIVE_ROW_ID_1]) });
    const before = FSAI.articleById(1);
    const beforeFields = { title: before.title, excerpt: before.excerpt, body: before.body, date: before.date };
    assert.equal(await FSAI.liveReady, false, 'nothing new, so nothing merged');
    assert.equal(FSAI.ARTICLES.length, 25);
    assert.strictEqual(FSAI.articleById(1), before, 'the shared-id object must be the identical static object');
    assert.deepEqual(
      { title: before.title, excerpt: before.excerpt, body: before.body, date: before.date },
      beforeFields,
    );
  });

  it('a live-only article is added and found by id, division and counts', async () => {
    const { FSAI } = loadApp({ fetchImpl: fetchOk([FIXTURE_34, FIXTURE_35, LIVE_ROW_ID_1]) });
    assert.equal(await FSAI.liveReady, true);
    assert.equal(FSAI.ARTICLES.length, 27);
    const a34 = FSAI.articleById(34);
    assert.ok(a34, 'new article 34 must be findable by id');
    assert.equal(a34.title, 'Fixture: A Brand New Guide');
    assert.equal(a34.division, 'Automotive');
    assert.equal(a34.date, '2026-11-23');
    assert.equal(a34.category, '', 'live rows carry no category');
    assert.equal(a34.slug, 'fixture-new-guide');
    assert.equal(FSAI.articlesByDivision('Automotive').length, 13);
    assert.equal(FSAI.articlesByDivision('Finance & Money').length, 4);
    const counts = FSAI.countsByDivision();
    assert.equal(counts.find((c) => c.division === 'Automotive').count, 13);
    assert.equal(FSAI.DIVISIONS.find((d) => d.id === 'automotive').articleCount, 13, 'division card count must follow the merged list');
    assert.equal(FSAI.DIVISIONS.find((d) => d.id === 'finance-money').articleCount, 4);
  });

  it('static-only ids are kept when the live list is partial or empty', async () => {
    const partial = loadApp({ fetchImpl: fetchOk([LIVE_ROW_ID_1]) });
    assert.equal(await partial.FSAI.liveReady, false);
    assert.equal(partial.FSAI.ARTICLES.length, 25);
    assert.ok(partial.FSAI.articleById(25), 'static-only id 25 must survive a partial live list');
    const empty = loadApp({ fetchImpl: fetchOk([]) });
    assert.equal(await empty.FSAI.liveReady, false);
    assert.equal(empty.FSAI.ARTICLES.length, 25);
    // Join-compare: the two snapshots come from two different vm realms,
    // whose Array prototypes make assert.deepEqual fail even for identical
    // contents (same caveat as tests/tools-full.test.js).
    assert.equal(
      staticSnapshot(empty.FSAI).map((a) => a.id).join(','),
      staticSnapshot(partial.FSAI).map((a) => a.id).join(','),
    );
  });

  it('every failure mode falls back to the static bundle exactly', async () => {
    const failures = {
      'fetch rejects': async () => { throw new Error('network down'); },
      'non-200 response': async () => ({ ok: false, status: 500, json: async () => ({}) }),
      'malformed JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
      'no articles array': async () => ({ ok: true, status: 200, json: async () => ({ ok: true, total: 0 }) }),
      'articles null': async () => ({ ok: true, status: 200, json: async () => ({ ok: true, articles: null }) }),
      'articles not an array': async () => ({ ok: true, status: 200, json: async () => ({ ok: true, articles: 'nope' }) }),
    };
    for (const [name, fetchImpl] of Object.entries(failures)) {
      const { FSAI } = loadApp({ fetchImpl });
      const before = staticSnapshot(FSAI);
      assert.equal(await FSAI.liveReady, false, name + ': liveReady must resolve false');
      assert.deepEqual(staticSnapshot(FSAI), before, name + ': the static bundle must be untouched');
      assert.equal(FSAI.ARTICLES.length, 25, name);
    }
  });
});

describe('live loader: field mapping', () => {
  it('maps slug→division name, publishedAt→date, carries slug/disclaimer, skips bad rows', async () => {
    const rows = [
      { id: 36, slug: 'fixture-slug-only', title: 'Slug Only', excerpt: '', body: '<p>x</p>', division: 'finance-money', publishedAt: '2026-11-23T05:00:00.000Z', status: 'published' },
      { id: 37, slug: 'fixture-named', title: 'Named Division', excerpt: '', body: '<p>y</p>', division: 'health-wellness', division_name: 'Health & Wellness', published_at: '2026-11-20', disclaimer: 'Custom disclaimer.', status: 'published' },
      { id: 'xx', slug: 'bad-id', title: 'Bad Id', excerpt: '', body: '', division: 'automotive', division_name: 'Automotive', publishedAt: '2026-11-23', status: 'published' },
      { id: 38, slug: 'no-title', title: '', excerpt: '', body: '', division: 'automotive', division_name: 'Automotive', publishedAt: '2026-11-23', status: 'published' },
      { id: 39, slug: 'no-division', title: 'No Division', excerpt: '', body: '', division: 'unknown-slug', publishedAt: '2026-11-23', status: 'published' },
      { id: 40, slug: 'no-date', title: 'No Date', excerpt: '', body: '<p>z</p>', division: 'automotive', division_name: 'Automotive', status: 'published' },
    ];
    const { FSAI } = loadApp({ fetchImpl: fetchOk(rows) });
    assert.equal(await FSAI.liveReady, true);
    assert.equal(FSAI.ARTICLES.length, 28, 'only the 3 mappable rows are added (36, 37, 40)');
    const a36 = FSAI.articleById(36);
    assert.equal(a36.division, 'Finance & Money', 'slug must map to the division name');
    assert.equal(a36.date, '2026-11-23', 'a datetime publishedAt must normalise to YYYY-MM-DD');
    const a37 = FSAI.articleById(37);
    assert.equal(a37.division, 'Health & Wellness', 'division_name wins when present');
    assert.equal(a37.date, '2026-11-20', 'published_at is the fallback date source');
    assert.equal(a37.disclaimer, 'Custom disclaimer.');
    assert.equal(FSAI.articleById(40).date, '', 'a missing date maps to empty, never a crash');
    assert.equal(FSAI.articleById(39), null, 'a row with no resolvable division must be skipped');
    assert.equal(FSAI.articleById(38), null, 'a row with no title must be skipped');
  });

  it('a live body goes through the same banner strip as a static body', async () => {
    const row = { ...FIXTURE_34, body: 'AI-DRAFT — do not publish\n\n<p>Real fixture body.</p>' };
    const { FSAI } = loadApp({ fetchImpl: fetchOk([row]) });
    assert.equal(await FSAI.liveReady, true);
    const a = FSAI.articleById(34);
    assert.ok(a.body.includes('AI-DRAFT'), 'the stored live body still carries the banner line (the strip happens at render, like static bodies)');
    assert.equal(FSAI.stripDraftBanner(a.body), '<p>Real fixture body.</p>');
    const card = FSAI.articleCard(a);
    assert.ok(card.includes('article?id=34'), 'the live article renders through the same articleCard as static ones');
    assert.ok(card.includes('Fixture: A Brand New Guide'));
  });
});

describe('live loader: render after merge + page wiring', () => {
  it('the shared render (footer + grids + hero) sees the merged list', async () => {
    const made = makeDoc();
    const { FSAI } = loadApp({ fetchImpl: fetchOk([FIXTURE_34]), doc: made.doc });
    assert.equal(await FSAI.liveReady, true);
    made.fire();
    await new Promise((r) => setImmediate(r));
    assert.ok(made.els.siteFooter.innerHTML.includes('Articles: 26'), 'footer count must be 26 after the merge, got: ' + made.els.siteFooter.innerHTML.slice(0, 200));
    assert.ok(made.els.articleGrid.innerHTML.includes('Fixture: A Brand New Guide'), 'article grid must list the new article');
    assert.ok(made.els.heroPreview.innerHTML.includes('Fixture: A Brand New Guide'), 'the newest article (2026-11-23) must become the hero preview');
  });

  it('the render still shows the static 25 when the fetch fails', async () => {
    const made = makeDoc();
    const { FSAI } = loadApp({ fetchImpl: async () => { throw new Error('down'); }, doc: made.doc });
    assert.equal(await FSAI.liveReady, false);
    made.fire();
    await new Promise((r) => setImmediate(r));
    assert.ok(made.els.siteFooter.innerHTML.includes('Articles: 25'));
    assert.ok(made.els.articleGrid.innerHTML.includes("EV Charging at Home"));
  });

  it('article/division/search/charts pages gate their render on liveReady', () => {
    for (const [name, src] of [['article.html', ARTICLE_HTML], ['division.html', DIVISION_HTML], ['search.js', SEARCH_JS], ['charts.js', CHARTS_JS]]) {
      assert.ok(src.includes('liveReady.then'), name + ' must wait for the live merge before rendering');
    }
    assert.ok(ARTICLE_HTML.includes("setLink('canonical'"), 'article.html meta/canonical code must be untouched');
    assert.ok(DIVISION_HTML.includes('divCanonical'), 'division.html canonical code must be untouched');
    assert.ok(APP_JS.includes('liveReady'), 'app.js must expose liveReady');
  });
});
