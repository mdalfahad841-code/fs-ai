// FS AI — Close-out A3 (SEO) tests, 2026-11-23.
//
// Covers A3 against the SHIPPED files (vm with a small fake DOM where
// behaviour matters, source reads where the file itself is the contract):
//   A3.1 article page — per-article title/meta/canonical/og/twitter +
//         og article properties + Article JSON-LD, in JS; static
//         no-JS fallback stays generic (no shared canonical, no og:url,
//         no JSON-LD — one shared value would be wrong for every article)
//   A3.2 article page — the same SEO set for a LIVE-LOADED article
//         (id 26, absent from the static bundle): the injection reads
//         the merged list after liveReady, not the static bundle alone
//   A3.3 division page — per-division title/meta/canonical/og/twitter +
//         per-division CollectionPage JSON-LD in JS; the all-divisions
//         view keeps the static generic tags; not-found sets a title
//         and does not crash
//   A3.4 tools page — per-tool title/meta/canonical/og/twitter +
//         per-tool WebApplication JSON-LD in JS (showTool); a bare load
//         (no ?tool=) keeps the static bare tags + WebPage JSON-LD
//
// Run: node --test tests/closeout-a3.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'division.html'), 'utf8');
const TOOLS_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'tools.html'), 'utf8');
const TOOLS_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'tools.js'), 'utf8');

const SITE = 'https://fs-ai-5w5.pages.dev';
const OG_IMAGE = SITE + '/og-image.png';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* The page script is the LAST inline <script> block (the gtag inline
   script is first). */
function extractInlineScript(html) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1, 'inline script block expected');
  return blocks[blocks.length - 1];
}

/* ------------------------------------------------------------------ */
/* Fake DOM: just enough for the page scripts (querySelector on head   */
/* metas/links, createElement + appendChild, getElementById, title).   */
/* ------------------------------------------------------------------ */
function makeEl(tag, attrs) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    attributes: Object.assign({}, attrs || {}),
    children: [],
    textContent: '',
    innerHTML: '',
    style: {},
    parent: null,
    id: (attrs && attrs.id) || '',
    type: '',
    getAttribute(name) { return this.attributes[name] == null ? null : this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    remove() {
      if (this.parent) {
        const i = this.parent.children.indexOf(this);
        if (i !== -1) this.parent.children.splice(i, 1);
        this.parent = null;
      }
    },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  return el;
}

function makeHead(seed) {
  const head = makeEl('head');
  head.querySelector = function (sel) {
    const m = /^(meta|link|script)\[([a-z-]+)="([^"]+)"\]$/.exec(sel);
    if (!m) return null;
    const tag = m[1].toUpperCase();
    const attr = m[2];
    const val = m[3];
    return head.children.find((c) => c.tagName === tag && c.getAttribute(attr) === val) || null;
  };
  (seed || []).forEach((s) => {
    const el = makeEl(s.tag, s.attrs);
    if (s.text) el.textContent = s.text;
    head.appendChild(el);
  });
  return head;
}

function makeDocument(head, bodyEls, title) {
  const listeners = {};
  const doc = {
    title: title || '',
    head,
    _bodyEls: bodyEls || {},
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    getElementById(id) {
      if (this._bodyEls[id]) return this._bodyEls[id];
      return head.children.find((c) => c.id === id) || null;
    },
    querySelector(sel) { return head.querySelector(sel); },
    createElement(tag) { return makeEl(tag); },
  };
  return {
    doc,
    fireDomReady() { (listeners.DOMContentLoaded || []).forEach((fn) => fn()); },
  };
}

function metaContent(doc, sel) {
  const el = doc.querySelector(sel);
  return el ? el.getAttribute('content') : null;
}

function linkHref(doc, rel) {
  const el = doc.querySelector('link[rel="' + rel + '"]');
  return el ? el.getAttribute('href') : null;
}

function jsonLd(doc, id) {
  const el = doc.getElementById(id);
  assert.ok(el, 'JSON-LD script #' + id + ' must exist');
  return JSON.parse(el.textContent);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/* ------------------------------------------------------------------ */
/* Article page harness.                                               */
/* ------------------------------------------------------------------ */
const ARTICLE_FIXTURES = {
  1: {
    id: 1, title: 'EV Charging at Home: A Complete Beginner\u2019s Guide',
    division: 'Automotive', category: 'Electric Vehicles', date: '2026-11-01',
    excerpt: 'Fixture excerpt for article one.',
    body: '<p>Fixture body one.</p>',
  },
  /* Live-loaded fixture: id 26 is NOT in the static bundle, so it can
     only be found after the live merge — the A3.2 case. */
  26: {
    id: 26, title: 'Fixture: Twenty-Sixth Guide',
    division: 'Automotive', category: 'Maintenance', date: '2026-11-23',
    excerpt: 'Live-loaded fixture article.',
    body: '<p>Live fixture body.</p>',
  },
};

/* Faithful stub of window.FSAI.divisionTopicNo (app.js) over the
   fixtures: position within the same division, date ascending, ties by
   id ascending. Fixture 1 → 1, fixture 26 → 2 (both Automotive). */
const fixtureDivisionTopicNo = (article) => {
  if (!article) return null;
  const same = Object.values(ARTICLE_FIXTURES).filter((a) => a.division === article.division);
  same.sort((x, y) => (x.date !== y.date ? (x.date < y.date ? -1 : 1) : x.id - y.id));
  for (let i = 0; i < same.length; i++) {
    if (same[i].id === article.id) return i + 1;
  }
  return null;
};

function articleHeadSeed() {
  return makeHead([
    { tag: 'meta', attrs: { name: 'description', content: 'Read a free FS AI article.' } },
    { tag: 'meta', attrs: { property: 'og:type', content: 'article' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: 'FS AI' } },
    { tag: 'meta', attrs: { property: 'og:title', content: 'Article \u2014 FS AI' } },
    { tag: 'meta', attrs: { property: 'og:description', content: 'Read a free FS AI article.' } },
    { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: 'FS AI \u2014 One Platform. Multiple Possibilities.' } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: 'Article \u2014 FS AI' } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: 'Read a free FS AI article.' } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
  ]);
}

async function runArticlePage(search) {
  const head = articleHeadSeed();
  const bodyEls = { articleBody: makeEl('div'), seriesNav: makeEl('div'), relatedGrid: makeEl('div') };
  const made = makeDocument(head, bodyEls, 'Article \u2014 FS AI');
  const FSAI = {
    liveReady: Promise.resolve(),
    articleById: (id) => ARTICLE_FIXTURES[String(id)] || null,
    /* Reading sequence (owner order 2026-11-27): the page renders
       the series nav into #seriesNav. The fixtures hold only ids 1
       and 26 — article 1's next (7) is absent and 26 is in no arc —
       so the real picker would return '' here too; the series nav
       itself is covered by tests/series-reading-sequence.test.js. */
    renderSeriesNav: () => '',
    DIVISIONS: [{ id: 'automotive', name: 'Automotive', description: 'Cars, EVs and driving guides.' }],
    esc,
    formatDate: (d) => d,
    articleNo: (id) => 'No. ' + String(id).padStart(2, '0'),
    divisionTopicNo: fixtureDivisionTopicNo,
    articlesByDivision: (name) => Object.values(ARTICLE_FIXTURES).filter((a) => a.division === name),
    /* Same contract as window.FSAI.relatedArticles (app.js): same
       division first (newest first), then other divisions to fill
       to 3, never the current article — over the fixture articles. */
    relatedArticles: (current) => {
      const same = [];
      const other = [];
      for (const a of Object.values(ARTICLE_FIXTURES)) {
        if (!a || a.id === current.id) continue;
        if (a.division === current.division) same.push(a); else other.push(a);
      }
      const byNewest = (x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.id - x.id);
      same.sort(byNewest);
      other.sort(byNewest);
      return same.concat(other).slice(0, 3);
    },
    DISCLAIMER: 'Fixture disclaimer.',
    stripDraftBanner: (b) => b,
  };
  const sandbox = {
    window: { FSAI, location: { search } },
    document: made.doc,
    console,
    URLSearchParams,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(extractInlineScript(ARTICLE_HTML), sandbox);
  made.fireDomReady();
  await tick();
  await tick();
  return { doc: made.doc, bodyEls, FSAI };
}

/* ------------------------------------------------------------------ */
/* Division page harness.                                              */
/* ------------------------------------------------------------------ */
const DIVISION_FIXTURES = [
  { id: 'automotive', name: 'Automotive', description: 'Cars, EVs and driving guides.' },
  { id: 'ai-technology', name: 'AI & Technology', description: 'Plain-English AI guides and free tools.' },
];

function divisionHeadSeed() {
  const head = makeHead([
    { tag: 'meta', attrs: { name: 'description', content: 'FS AI divisions: Automotive, AI & Technology, Gadgets & Electronics, Finance & Money, Travel & Lifestyle, Digital Tools, Health & Wellness, Education & Learning.' } },
    { tag: 'link', attrs: { rel: 'canonical', href: SITE + '/pages/division' } },
    { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: 'FS AI' } },
    { tag: 'meta', attrs: { property: 'og:title', content: 'Divisions \u2014 FS AI' } },
    { tag: 'meta', attrs: { property: 'og:description', content: 'FS AI divisions: Automotive, AI & Technology, Gadgets & Electronics, Finance & Money, Travel & Lifestyle, Digital Tools, Health & Wellness, Education & Learning.' } },
    { tag: 'meta', attrs: { property: 'og:url', content: SITE + '/pages/division' } },
    { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: 'Divisions \u2014 FS AI' } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: 'All FS AI divisions, one platform.' } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
    {
      tag: 'script', attrs: { id: 'divisionJsonLd' },
      text: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: 'Divisions \u2014 FS AI', url: SITE + '/pages/division',
        isPartOf: { '@type': 'WebSite', name: 'FS AI', url: SITE + '/' },
      }),
    },
  ]);
  return head;
}

async function runDivisionPage(search) {
  const head = divisionHeadSeed();
  const bodyEls = {
    divisionBanner: makeEl('div'),
    divisionTitle: makeEl('h1'),
    divisionIntro: makeEl('p'),
    divisionGrid: makeEl('div'),
    divisionArticlesHeading: makeEl('h2'),
    divisionArticles: makeEl('div'),
    divisionBackLinks: makeEl('p'),
  };
  const made = makeDocument(head, bodyEls, 'Divisions \u2014 FS AI');
  const FSAI = {
    liveReady: Promise.resolve(),
    divisionPageState: (id) => {
      if (!id) return { status: 'all', division: null, slug: null };
      const div = DIVISION_FIXTURES.find((d) => d.id === id);
      if (!div) return { status: 'not-found', division: null, slug: id };
      return { status: 'division', division: div, slug: id };
    },
    divisionIcon: () => '',
    divisionPlate: () => '',
    articlesByDivision: (name) => Object.values(ARTICLE_FIXTURES).filter((a) => a.division === name),
    renderArticles: (grid) => { grid.innerHTML = ''; },
    esc,
    formatDate: (d) => d,
    articleNo: (id) => 'No. ' + String(id).padStart(2, '0'),
    divisionTopicNo: fixtureDivisionTopicNo,
  };
  const sandbox = {
    window: { FSAI, location: { search } },
    document: made.doc,
    console,
    URLSearchParams,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(extractInlineScript(DIVISION_HTML), sandbox);
  made.fireDomReady();
  await tick();
  await tick();
  return { doc: made.doc, bodyEls };
}

/* ------------------------------------------------------------------ */
/* Tools page harness (tools.js + showTool).                           */
/* ------------------------------------------------------------------ */
const TOOL_FIXTURES = [
  { id: 'percentage', name: 'Percentage Calculator', category: 'Everyday', description: 'Find a percentage of a number, or what percentage one number is of another.' },
  { id: 'loan-payment', name: 'Loan Payment Estimator', category: 'Finance', description: 'Monthly loan payment from amount, annual rate and term.' },
  { id: 'unit-converter', name: 'Unit Converter', category: 'Everyday', description: 'Convert length, weight and temperature between common units.' },
];

function toolsHeadSeed() {
  return makeHead([
    { tag: 'meta', attrs: { name: 'description', content: 'Free FS AI tools: fuel cost, mileage, budget, savings, loan, currency (manual rate), converters, calculators and trip planners. No sign-up, no cost.' } },
    { tag: 'link', attrs: { rel: 'canonical', href: SITE + '/pages/tools' } },
    { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: 'FS AI' } },
    { tag: 'meta', attrs: { property: 'og:title', content: 'Free Tools \u2014 FS AI' } },
    { tag: 'meta', attrs: { property: 'og:description', content: 'Free FS AI tools: fuel cost, mileage, budget, savings, loan, currency (manual rate), converters, calculators and trip planners. No sign-up, no cost.' } },
    { tag: 'meta', attrs: { property: 'og:url', content: SITE + '/pages/tools' } },
    { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: 'Free Tools \u2014 FS AI' } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: 'Free tools. No sign-up, no cost.' } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
    {
      tag: 'script', attrs: { id: 'toolsJsonLd' },
      text: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'WebPage',
        name: 'Free Tools \u2014 FS AI', url: SITE + '/pages/tools',
        isPartOf: { '@type': 'WebSite', name: 'FS AI', url: SITE + '/' },
        description: 'Free converters and calculators. No sign-up, no cost.',
      }),
    },
  ]);
}

function runToolsPage(search, toolId) {
  const head = toolsHeadSeed();
  const bodyEls = {
    toolTitle: makeEl('h1'),
    toolDescription: makeEl('p'),
    /* toolForm / toolResult / toolList absent: buildForm and the chip
       list are not under test here; showTool's SEO block needs only
       the head tags + title/description elements. */
  };
  const made = makeDocument(head, bodyEls, 'Free Tools \u2014 FS AI');
  const FSAI = { TOOLS: TOOL_FIXTURES, esc };
  const sandbox = {
    window: { FSAI, location: { search }, history: { replaceState() {} } },
    document: made.doc,
    console,
    URLSearchParams,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(TOOLS_JS, sandbox);
  made.fireDomReady();
  sandbox.window.FSAI.showTool(toolId);
  return { doc: made.doc, bodyEls };
}

/* ------------------------------------------------------------------ */
/* A3.1 — article page, static fallback.                               */
/* ------------------------------------------------------------------ */
describe('A3.1 article page static no-JS fallback stays generic', () => {
  it('ships a generic title/description and no shared canonical or og:url', () => {
    assert.equal(ARTICLE_HTML.includes('<title>Article \u2014 FS AI</title>'), true, 'generic static title');
    assert.ok(ARTICLE_HTML.includes('<meta name="description" content="Read a free FS AI article.">'), 'generic static description');
    /* One shared canonical would be wrong for every article; a wrong
       canonical is worse than none (see the comment in the file). */
    assert.equal(ARTICLE_HTML.includes('rel="canonical"'), false, 'no static canonical link');
    assert.equal(ARTICLE_HTML.includes('<meta property="og:url"'), false, 'no static og:url meta tag');
    /* No static JSON-LD <script> tag: the Article block is injected per
       article. (The string 'application/ld+json' appears in the page
       script that creates it — that is not a static block.) */
    assert.equal(ARTICLE_HTML.includes('<script type="application/ld+json"'), false, 'no static JSON-LD script tag');
    /* But the og image (shared, correct for every article) is static. */
    assert.ok(ARTICLE_HTML.includes('<meta property="og:image" content="' + OG_IMAGE + '">'), 'static og:image');
    assert.equal(ARTICLE_HTML.includes('og:type" content="article"'), true, 'og:type article');
  });
});

/* ------------------------------------------------------------------ */
/* A3.1 — article page, JS injection (static article id 1).            */
/* ------------------------------------------------------------------ */
describe('A3.1 article page JS sets per-article SEO', () => {
  it('title, meta, canonical, og, twitter, article properties and JSON-LD for id 1', async () => {
    const { doc, bodyEls } = await runArticlePage('?id=1');
    const a = ARTICLE_FIXTURES[1];
    const canonical = SITE + '/pages/article?id=1';
    assert.equal(doc.title, a.title + ' \u2014 FS AI', 'title');
    assert.equal(metaContent(doc, 'meta[name="description"]'), a.excerpt, 'meta description');
    assert.equal(linkHref(doc, 'canonical'), canonical, 'self-referencing canonical');
    assert.equal(metaContent(doc, 'meta[property="og:title"]'), a.title + ' \u2014 FS AI', 'og:title');
    assert.equal(metaContent(doc, 'meta[property="og:description"]'), a.excerpt, 'og:description');
    assert.equal(metaContent(doc, 'meta[property="og:url"]'), canonical, 'og:url');
    assert.equal(metaContent(doc, 'meta[property="og:image"]'), OG_IMAGE, 'og:image');
    assert.equal(metaContent(doc, 'meta[name="twitter:title"]'), a.title + ' \u2014 FS AI', 'twitter:title');
    assert.equal(metaContent(doc, 'meta[name="twitter:description"]'), a.excerpt, 'twitter:description');
    assert.equal(metaContent(doc, 'meta[name="twitter:image"]'), OG_IMAGE, 'twitter:image');
    assert.equal(metaContent(doc, 'meta[name="twitter:card"]'), 'summary_large_image', 'twitter:card');
    assert.equal(metaContent(doc, 'meta[property="article:published_time"]'), a.date, 'article:published_time');
    assert.equal(metaContent(doc, 'meta[property="article:section"]'), a.division, 'article:section');
    assert.equal(metaContent(doc, 'meta[property="article:tag"]'), a.category, 'article:tag');
    const ld = jsonLd(doc, 'articleJsonLd');
    assert.equal(ld['@type'], 'Article', 'JSON-LD @type');
    assert.equal(ld.headline, a.title, 'JSON-LD headline');
    assert.equal(ld.description, a.excerpt, 'JSON-LD description');
    assert.equal(ld.datePublished, a.date, 'JSON-LD datePublished');
    assert.equal(ld.mainEntityOfPage, canonical, 'JSON-LD mainEntityOfPage');
    assert.equal(ld.articleSection, a.division, 'JSON-LD articleSection');
    assert.equal(ld.author.name, 'Fahad Somrat', 'JSON-LD author');
    assert.equal(ld.publisher.name, 'FS AI', 'JSON-LD publisher');
    const crumbs = jsonLd(doc, 'articleCrumbs');
    assert.equal(crumbs['@type'], 'BreadcrumbList', 'breadcrumb JSON-LD');
    assert.equal(crumbs.itemListElement[2].item, canonical, 'breadcrumb points at the article');
    assert.ok(bodyEls.articleBody.innerHTML.includes(a.title), 'article body rendered');
  });

  it('not-found sets a plain title and injects no JSON-LD', async () => {
    const { doc } = await runArticlePage('?id=999');
    assert.equal(doc.title, 'Article not found \u2014 FS AI', 'not-found title');
    assert.equal(doc.getElementById('articleJsonLd'), null, 'no Article JSON-LD for a missing article');
    assert.equal(linkHref(doc, 'canonical'), null, 'no canonical for a missing article');
  });
});

/* ------------------------------------------------------------------ */
/* A3.2 — article page, live-loaded article (id 26).                   */
/* ------------------------------------------------------------------ */
describe('A3.2 live-loaded articles get the same SEO set', () => {
  it('id 26 (absent from the static bundle) gets per-article SEO from the merged list', async () => {
    const { doc } = await runArticlePage('?id=26');
    const a = ARTICLE_FIXTURES[26];
    const canonical = SITE + '/pages/article?id=26';
    assert.equal(doc.title, a.title + ' \u2014 FS AI', 'title from the live row');
    assert.equal(metaContent(doc, 'meta[name="description"]'), a.excerpt, 'meta description from the live row');
    assert.equal(linkHref(doc, 'canonical'), canonical, 'canonical for the live id');
    assert.equal(metaContent(doc, 'meta[property="og:url"]'), canonical, 'og:url for the live id');
    assert.equal(metaContent(doc, 'meta[property="article:published_time"]'), a.date, 'published_time from the live row');
    const ld = jsonLd(doc, 'articleJsonLd');
    assert.equal(ld.headline, a.title, 'JSON-LD headline from the live row');
    assert.equal(ld.datePublished, a.date, 'JSON-LD datePublished from the live row');
  });
});

/* ------------------------------------------------------------------ */
/* A3.3 — division page.                                               */
/* ------------------------------------------------------------------ */
describe('A3.3 division page SEO', () => {
  it('static fallback: generic tags + bare canonical + CollectionPage JSON-LD', () => {
    assert.ok(DIVISION_HTML.includes('<title>Divisions \u2014 FS AI</title>'), 'generic static title');
    assert.ok(DIVISION_HTML.includes('<link rel="canonical" href="' + SITE + '/pages/division">'), 'static bare canonical');
    assert.ok(DIVISION_HTML.includes('id="divisionJsonLd"'), 'static JSON-LD carries an id so JS can replace it');
    assert.ok(DIVISION_HTML.includes('"@type":"CollectionPage"'), 'static CollectionPage JSON-LD');
  });

  it('single division (?division=automotive) gets per-division SEO + JSON-LD', async () => {
    const { doc } = await runDivisionPage('?division=automotive');
    const div = DIVISION_FIXTURES[0];
    const canonical = SITE + '/pages/division?division=automotive';
    assert.equal(doc.title, div.name + ' \u2014 FS AI', 'title');
    assert.equal(metaContent(doc, 'meta[name="description"]'), div.description, 'meta description');
    assert.equal(linkHref(doc, 'canonical'), canonical, 'self-referencing canonical');
    assert.equal(metaContent(doc, 'meta[property="og:title"]'), div.name + ' \u2014 FS AI', 'og:title');
    assert.equal(metaContent(doc, 'meta[property="og:description"]'), div.description, 'og:description');
    assert.equal(metaContent(doc, 'meta[property="og:url"]'), canonical, 'og:url');
    assert.equal(metaContent(doc, 'meta[name="twitter:title"]'), div.name + ' \u2014 FS AI', 'twitter:title');
    assert.equal(metaContent(doc, 'meta[name="twitter:description"]'), div.description, 'twitter:description');
    const ld = jsonLd(doc, 'divisionJsonLd');
    assert.equal(ld['@type'], 'CollectionPage', 'JSON-LD @type');
    assert.equal(ld.name, div.name + ' \u2014 FS AI', 'JSON-LD name');
    assert.equal(ld.url, canonical, 'JSON-LD url');
    assert.equal(ld.description, div.description, 'JSON-LD description');
  });

  it('all-divisions view keeps the static generic tags', async () => {
    const { doc } = await runDivisionPage('');
    assert.equal(doc.title, 'Divisions \u2014 FS AI', 'title stays generic');
    assert.equal(linkHref(doc, 'canonical'), SITE + '/pages/division', 'canonical stays bare');
    assert.equal(metaContent(doc, 'meta[property="og:url"]'), SITE + '/pages/division', 'og:url stays bare');
    const ld = jsonLd(doc, 'divisionJsonLd');
    assert.equal(ld.name, 'Divisions \u2014 FS AI', 'JSON-LD stays generic');
  });

  it('unknown division sets a plain title and does not crash', async () => {
    const { doc } = await runDivisionPage('?division=nope');
    assert.equal(doc.title, 'Division not found \u2014 FS AI', 'not-found title');
    assert.equal(linkHref(doc, 'canonical'), SITE + '/pages/division', 'canonical stays bare for a missing division');
  });
});

/* ------------------------------------------------------------------ */
/* A3.4 — tools page.                                                  */
/* ------------------------------------------------------------------ */
describe('A3.4 tools page SEO', () => {
  it('static fallback: generic tags + bare canonical + WebPage JSON-LD', () => {
    assert.ok(TOOLS_HTML.includes('<title>Free Tools \u2014 FS AI</title>'), 'generic static title');
    assert.ok(TOOLS_HTML.includes('<link rel="canonical" href="' + SITE + '/pages/tools">'), 'static bare canonical');
    assert.ok(TOOLS_HTML.includes('id="toolsJsonLd"'), 'static JSON-LD carries an id so JS can replace it');
    assert.ok(TOOLS_HTML.includes('"@type":"WebPage"'), 'static WebPage JSON-LD');
  });

  it('?tool=percentage gets per-tool SEO + WebApplication JSON-LD', () => {
    const { doc } = runToolsPage('?tool=percentage', 'percentage');
    const tool = TOOL_FIXTURES[0];
    const canonical = SITE + '/pages/tools?tool=percentage';
    assert.equal(doc.title, tool.name + ' \u2014 FS AI', 'title');
    assert.equal(metaContent(doc, 'meta[name="description"]'), tool.description, 'meta description');
    assert.equal(linkHref(doc, 'canonical'), canonical, 'self-referencing canonical');
    assert.equal(metaContent(doc, 'meta[property="og:title"]'), tool.name + ' \u2014 FS AI', 'og:title');
    assert.equal(metaContent(doc, 'meta[property="og:description"]'), tool.description, 'og:description');
    assert.equal(metaContent(doc, 'meta[property="og:url"]'), canonical, 'og:url');
    assert.equal(metaContent(doc, 'meta[name="twitter:title"]'), tool.name + ' \u2014 FS AI', 'twitter:title');
    assert.equal(metaContent(doc, 'meta[name="twitter:description"]'), tool.description, 'twitter:description');
    const ld = jsonLd(doc, 'toolsJsonLd');
    assert.equal(ld['@type'], 'WebApplication', 'JSON-LD @type');
    assert.equal(ld.name, tool.name + ' \u2014 FS AI', 'JSON-LD name');
    assert.equal(ld.url, canonical, 'JSON-LD url');
    assert.equal(ld.description, tool.description, 'JSON-LD description');
  });

  it('?tool=loan-payment gets its own SEO set (uniqueness across tools)', () => {
    const { doc } = runToolsPage('?tool=loan-payment', 'loan-payment');
    const tool = TOOL_FIXTURES[1];
    const canonical = SITE + '/pages/tools?tool=loan-payment';
    assert.equal(doc.title, tool.name + ' \u2014 FS AI', 'title differs per tool');
    assert.equal(metaContent(doc, 'meta[name="description"]'), tool.description, 'description differs per tool');
    assert.equal(linkHref(doc, 'canonical'), canonical, 'canonical differs per tool');
    const ld = jsonLd(doc, 'toolsJsonLd');
    assert.equal(ld.name, tool.name + ' \u2014 FS AI', 'JSON-LD name differs per tool');
    assert.equal(ld.url, canonical, 'JSON-LD url differs per tool');
  });

  it('bare load (no ?tool=) keeps the static bare tags + WebPage JSON-LD', () => {
    const { doc } = runToolsPage('', 'percentage');
    assert.equal(doc.title, 'Free Tools \u2014 FS AI', 'title stays generic');
    assert.equal(linkHref(doc, 'canonical'), SITE + '/pages/tools', 'canonical stays bare');
    assert.equal(metaContent(doc, 'meta[property="og:url"]'), SITE + '/pages/tools', 'og:url stays bare');
    const ld = jsonLd(doc, 'toolsJsonLd');
    assert.equal(ld['@type'], 'WebPage', 'JSON-LD stays the static WebPage block');
    assert.equal(ld.name, 'Free Tools \u2014 FS AI', 'JSON-LD name stays generic');
  });
});
