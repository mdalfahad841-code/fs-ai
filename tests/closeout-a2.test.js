// FS AI — Close-out A2 (consistent published dates) tests, 2026-11-23.
//
// A0.3 proved the TRUE first-publication date is Set B (seed / backend
// fallback / sitemap: 2 articles per day ascending 2026-11-01 → 2026-11-11).
// A2 adopts Set B everywhere:
//   * static bundle `frontend/scripts/app.js` ARTICLES dates — 23 rows
//     changed (ids 8 and 16 were already correct);
//   * live D1 `published_at` for ids 1–2 only (2026-11-02 → 2026-11-01)
//     — verified by direct D1 reads before/after, NOT by these tests
//     (no live D1 in the suite);
//   * sitemap lastmod, backend fallback list and seed.sql already Set B
//     (A0.3) — these tests lock them so a later edit cannot drift them.
// NEVER change an article body: these tests also assert the static bundle
// keeps every article's id/title pairing from the A0 table, so a date fix
// cannot silently swap two articles.
//
// Run: node --test tests/closeout-a2.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'app.js'), 'utf8');
const BACKEND_ARTICLES_JS = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'articles.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'article.html'), 'utf8');

/* Set B — the true first-publication dates (A0.3). */
const SET_B = {
  1: '2026-11-01', 2: '2026-11-01', 3: '2026-11-02', 4: '2026-11-02',
  5: '2026-11-03', 6: '2026-11-03', 7: '2026-11-04', 8: '2026-11-04',
  9: '2026-11-05', 10: '2026-11-05', 11: '2026-11-06', 12: '2026-11-06',
  13: '2026-11-07', 14: '2026-11-07', 15: '2026-11-08', 16: '2026-11-08',
  17: '2026-11-09', 18: '2026-11-09', 19: '2026-11-10', 20: '2026-11-10',
  21: '2026-11-11', 22: '2026-11-11', 23: '2026-11-11', 24: '2026-11-11',
  25: '2026-11-11',
};

/* Titles from the A0.3 table (D1 titles, verified against the bundle). */
const TITLES = {
  1: 'EV Charging at Home: A Complete Beginner\'s Guide',
  2: 'Car Maintenance Checklist: 12 Things to Check Every Month',
  3: 'Hybrid vs Petrol: Which Saves You More in 2026?',
  4: 'Motorcycle Buying Guide: How to Choose Your First Bike',
  5: 'How to Read Your Car\'s Warning Lights',
  6: 'Fuel Economy: 15 Proven Ways to Save Fuel',
  7: 'ADAS Explained: How Driver Assistance Really Works',
  8: 'Electric Vehicle Range: What the Numbers Really Mean',
  9: 'How to Diagnose Common Engine Noises',
  10: 'New vs Used Cars: A Practical Buying Guide',
  11: 'Car Safety Ratings Explained',
  12: 'Best Family Cars Compared: Space, Safety and Running Costs',
  13: 'What Is AI? A Plain-English Guide for Beginners',
  14: '7 Free AI Tools That Actually Save Time',
  15: 'Smartphone Buying Guide 2026: What Matters Most',
  16: 'Laptop vs Tablet: Which One Should You Buy?',
  17: 'Monthly Budgeting: The 50/30/20 Rule Explained',
  18: 'How to Start Saving With a Small Income',
  19: 'Travel on a Budget: Plan a Trip Without Overspending',
  20: 'Free Digital Tools: Converters and Calculators You Can Use Today',
  21: 'Walking for Health: A Beginner\'s Fitness Guide',
  22: 'How to Learn a New Digital Skill in 30 Days',
  23: 'Home Workout Basics: No Equipment Needed',
  24: 'Understanding Interest: Loans Explained Simply',
  25: 'How to Plan a Road Trip: Checklist and Costs',
};

function staticDates() {
  const out = {};
  for (const m of APP_JS.matchAll(/id: (\d+),.*?date: '(\d{4}-\d{2}-\d{2})'/g)) {
    out[Number(m[1])] = m[2];
  }
  return out;
}

function backendDates() {
  const out = {};
  for (const m of BACKEND_ARTICLES_JS.matchAll(/\{ id: (\d+),.*?publishedAt: '(\d{4}-\d{2}-\d{2})'/g)) {
    out[Number(m[1])] = m[2];
  }
  return out;
}

function sitemapLastmods(rel) {
  const xml = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = {};
  for (const m of xml.matchAll(/pages\/article\?id=(\d+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)) {
    out[Number(m[1])] = m[2];
  }
  return { xml, out };
}

describe('A2 static bundle dates are Set B', () => {
  it('all 25 static dates equal Set B exactly', () => {
    const dates = staticDates();
    assert.equal(Object.keys(dates).length, 25, '25 static articles');
    for (const [id, want] of Object.entries(SET_B)) {
      assert.equal(dates[Number(id)], want, 'id ' + id + ' date must be ' + want);
    }
  });

  it('no static date is outside 2026-11-01..2026-11-11 and none is in October', () => {
    for (const [id, d] of Object.entries(staticDates())) {
      assert.ok(d >= '2026-11-01' && d <= '2026-11-11', 'id ' + id + ' in range: ' + d);
    }
  });

  it('the date fix did not swap articles: every id still carries its A0 title', () => {
    const found = {};
    for (const m of APP_JS.matchAll(/id: (\d+), title: (['"])(.*?)\2,/g)) {
      found[Number(m[1])] = m[3];
    }
    assert.equal(Object.keys(found).length, 25, '25 static titles parsed');
    for (const [id, title] of Object.entries(TITLES)) {
      assert.equal(found[Number(id)], title, 'id ' + id + ' must still be "' + title + '"');
    }
  });

  it('exactly two articles per day 11-01..11-10 and five on 11-11 (Set B shape)', () => {
    const counts = {};
    for (const d of Object.values(staticDates())) counts[d] = (counts[d] || 0) + 1;
    for (let day = 1; day <= 10; day++) {
      const key = '2026-11-' + String(day).padStart(2, '0');
      assert.equal(counts[key], 2, key + ' must have 2 articles');
    }
    assert.equal(counts['2026-11-11'], 5, '2026-11-11 must have 5 articles');
  });
});

describe('A2 the other date sources already agree with Set B', () => {
  it('backend fallback list publishedAt equals Set B for all 25', () => {
    const dates = backendDates();
    assert.equal(Object.keys(dates).length, 25, '25 backend fallback articles');
    for (const [id, want] of Object.entries(SET_B)) {
      assert.equal(dates[Number(id)], want, 'backend id ' + id + ' must be ' + want);
    }
  });

  for (const rel of ['frontend/sitemap.xml', 'public/sitemap.xml']) {
    it(rel + ' lastmod equals Set B for all 25 article URLs', () => {
      const { out } = sitemapLastmods(rel);
      assert.equal(Object.keys(out).length, 25, rel + ' must list 25 article lastmods');
      for (const [id, want] of Object.entries(SET_B)) {
        assert.equal(out[Number(id)], want, rel + ' id ' + id + ' lastmod must be ' + want);
      }
    });
  }

  it('the two committed sitemap files are byte-identical', () => {
    const a = fs.readFileSync(path.join(ROOT, 'frontend', 'sitemap.xml'), 'utf8');
    const b = fs.readFileSync(path.join(ROOT, 'public', 'sitemap.xml'), 'utf8');
    assert.equal(a, b, 'frontend/sitemap.xml and public/sitemap.xml must stay identical');
  });
});

describe('A2 JSON-LD and on-page date follow the bundle date', () => {
  it('article.html JSON-LD datePublished reads a.date (no separate date to drift)', () => {
    assert.ok(ARTICLE_HTML.includes('datePublished: a.date'), 'JSON-LD must use a.date');
    assert.ok(!ARTICLE_HTML.includes('dateModified'), 'no dateModified to go stale');
  });

  it('article.html on-page "Published" line reads a.date', () => {
    assert.ok(ARTICLE_HTML.includes('Published \' + window.FSAI.formatDate(a.date)'),
      'on-page date must use a.date');
  });
});

describe('A2 Latest guide follows the fixed dates', () => {
  function makeDoc() {
    const els = {};
    function el() {
      return {
        innerHTML: '', textContent: '', value: '', _attrs: {},
        getAttribute(k) { return this._attrs[k] || null; },
        setAttribute(k, v) { this._attrs[k] = String(v); },
        querySelectorAll() { return []; },
        addEventListener() {}, scrollIntoView() {},
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
    return { doc, els, fire() { (listeners.DOMContentLoaded || []).forEach((fn) => fn()); } };
  }

  it('static bundle Latest guide is id 25 with date 2026-11-11', async () => {
    const made = makeDoc();
    const sandbox = {
      window: { location: { pathname: '/', search: '' } },
      document: made.doc,
      console,
      URLSearchParams,
      setTimeout(fn) { return { fn, cleared: false }; },
      clearTimeout() {},
      AbortController: class { constructor() { this.signal = {}; } abort() {} },
      fetch: async () => { throw new Error('network down'); },
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(APP_JS, sandbox);
    const { FSAI } = sandbox.window;
    made.fire();
    await FSAI.liveReady;
    await new Promise((r) => setImmediate(r));
    const sorted = FSAI.ARTICLES.slice().sort(FSAI.sortLatestFirst);
    assert.equal(sorted[0].id, 25, 'newest article must be id 25');
    assert.equal(sorted[0].date, '2026-11-11', 'newest date must be 2026-11-11');
    assert.ok(made.els.heroPreview.innerHTML.includes('How to Plan a Road Trip'), 'hero shows id 25');
  });
});
