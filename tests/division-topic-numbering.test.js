// FS AI — Per-division topic numbering
// (owner order 2026-11-27, "eta thik na": the global #1-#37 numbering
// is wrong; each division restarts at 1).
//
// Number = the article's position within its own division's PUBLISHED
// articles, creation order (oldest = 1), computed at render time — no
// stored number, no D1 schema change, so a new publish shifts later
// numbers automatically. The global id stays in the URL (?id=25);
// links never change. The series arc "Part X of Y" label is a separate
// thing and is untouched.
//
// Covers, offline with no network:
//   1. The pure helper (frontend/scripts/app.js, vm sandbox):
//      positions per division, creation order (date ascending, ties
//      by id ascending), null when the article is not in the list
//      (a draft), input list never mutated, a draft outside the list
//      never shifts anything.
//   2. Real bundle: the exact expected number for all 25 published
//      articles, no gaps per division (1..count, contiguous, unique).
//   3. New-publish shift: appending a newer article takes the next
//      number; inserting an earlier-dated article takes the middle
//      number and later ones shift by one.
//   4. Displays: article cards, hero plate, article page meta line,
//      related cards, division listing, series-nav next line all show
//      "Topic N" (never the global "No. NN"); the series nav shows
//      the next guide in full "Division · Topic N" form.
//   5. Noscript (functions/seo-head.js): the 4-argument rewrite shows
//      the same "Topic N" as the page JS (mirror agreement over all
//      25 articles); the 3-argument call keeps the legacy "No. NN"
//      fallback so older callers keep their pinned output.
// Run: node --test tests/division-topic-numbering.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const seo = require('../functions/seo-head.js');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const DIVISION_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'division.html'), 'utf8');
const MAIN_CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'main.css'), 'utf8');

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return sandbox.window.FSAI;
}

/* Controlled fixture: two divisions, dates out of id order, and a
   same-date tie — so the (date, id) sort rule is actually exercised. */
const FIXTURE = [
  { id: 5, title: 'E', division: 'Automotive', category: 'C', date: '2026-11-01', excerpt: 'e' },
  { id: 4, title: 'D', division: 'Automotive', category: 'C', date: '2026-11-02', excerpt: 'e' },
  { id: 9, title: 'I', division: 'Automotive', category: 'C', date: '2026-11-02', excerpt: 'e' },
  { id: 2, title: 'B', division: 'Finance & Money', category: 'C', date: '2026-11-01', excerpt: 'e' },
  { id: 3, title: 'C', division: 'Finance & Money', category: 'C', date: '2026-11-01', excerpt: 'e' },
];
const byId = (list, id) => list.find((a) => a.id === id);

/* Expected per-division numbers for the static bundle (25 published
   articles), from the live creation dates — dates never decrease with
   id here, so (date, id) order matches id order within each division. */
const EXPECTED = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12,
  13: 1, 14: 2,
  15: 1, 16: 2,
  17: 1, 18: 2, 24: 3,
  19: 1, 25: 2,
  20: 1,
  21: 1, 23: 2,
  22: 1,
};

describe('divisionTopicNo (pure helper)', () => {
  it('positions articles within their own division, creation order', () => {
    const F = loadFrontend();
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 5), FIXTURE), 1, 'earliest date wins, even with the higher id');
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 4), FIXTURE), 2, 'same date, lower id first');
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 9), FIXTURE), 3, 'same date, higher id last');
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 2), FIXTURE), 1, 'other division restarts at 1');
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 3), FIXTURE), 2, 'same-date tie in the other division');
  });

  it('returns null for an article not in the list, a null article, or an empty list', () => {
    const F = loadFrontend();
    const draft = { id: 99, title: 'Draft', division: 'Automotive', category: 'C', date: '2026-11-01', excerpt: 'e' };
    assert.equal(F.divisionTopicNo(draft, FIXTURE), null, 'a draft is not numbered');
    assert.equal(F.divisionTopicNo(null, FIXTURE), null);
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 5), []), null);
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 5)), 5, 'default list is the published ARTICLES (id 5 is Automotive #5)');
  });

  it('never mutates the input list', () => {
    const F = loadFrontend();
    const before = FIXTURE.map((a) => a.id).join(',');
    F.divisionTopicNo(byId(FIXTURE, 9), FIXTURE);
    assert.equal(FIXTURE.map((a) => a.id).join(','), before);
  });

  it('a draft outside the list never shifts the published numbers', () => {
    const F = loadFrontend();
    const draft = { id: 50, title: 'Draft', division: 'Automotive', category: 'C', date: '2026-10-01', excerpt: 'e' };
    assert.equal(F.divisionTopicNo(draft, FIXTURE), null);
    assert.equal(F.divisionTopicNo(byId(FIXTURE, 5), FIXTURE), 1, 'earlier-dated draft changes nothing');
  });
});

describe('divisionTopicNo on the real bundle', () => {
  it('every published article gets its expected per-division number', () => {
    const F = loadFrontend();
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const article = byId(F.ARTICLES, Number(id));
      assert.equal(F.divisionTopicNo(article), expected, 'article ' + id + ' (' + article.division + ')');
    }
    assert.equal(F.ARTICLES.length, 25, 'fixture guard: the static bundle still has 25 articles');
  });

  it('numbers are gapless and unique inside each division', () => {
    const F = loadFrontend();
    const perDivision = {};
    for (const a of F.ARTICLES) {
      (perDivision[a.division] = perDivision[a.division] || []).push(F.divisionTopicNo(a));
    }
    for (const [division, numbers] of Object.entries(perDivision)) {
      const sorted = numbers.slice().sort((x, y) => x - y);
      assert.deepEqual(sorted, numbers.map((_, i) => i + 1), division + ' is exactly 1..' + numbers.length);
    }
  });

  it('a new publish takes the next number; an earlier-dated publish shifts later ones', () => {
    const F = loadFrontend();
    const appended = F.ARTICLES.concat([
      { id: 40, title: 'New', division: 'Automotive', category: 'C', date: '2026-11-28', excerpt: 'e' },
    ]);
    assert.equal(F.divisionTopicNo(byId(appended, 40), appended), 13, 'newest Automotive article is Topic 13');
    assert.equal(F.divisionTopicNo(byId(appended, 12), appended), 12, 'existing numbers unchanged');
    const inserted = F.ARTICLES.concat([
      { id: 41, title: 'Backdated', division: 'Automotive', category: 'C', date: '2026-11-02', excerpt: 'e' },
    ]);
    /* 2026-11-02 already holds ids 3 and 4, which sort before 41 on the
       id tie-break — so 41 takes slot 5 and only later articles shift. */
    assert.equal(F.divisionTopicNo(byId(inserted, 41), inserted), 5, 'backdated article takes slot 5');
    assert.equal(F.divisionTopicNo(byId(inserted, 3), inserted), 3, 'same-date, lower-id article keeps its number');
    assert.equal(F.divisionTopicNo(byId(inserted, 4), inserted), 4, 'same-date, lower-id article keeps its number');
    assert.equal(F.divisionTopicNo(byId(inserted, 5), inserted), 6, 'later article shifts by one');
    assert.equal(F.divisionTopicNo(byId(inserted, 12), inserted), 13, 'old Topic 12 shifts to 13');
    assert.equal(F.divisionTopicNo(byId(inserted, 17), inserted), 1, 'other divisions untouched');
  });
});

describe('reader-facing displays show Topic N, never the global No. NN', () => {
  it('article cards carry the per-division number', () => {
    const F = loadFrontend();
    const card24 = F.articleCard(byId(F.ARTICLES, 24));
    assert.ok(card24.includes('<span class="article-no">Topic 3</span>'), 'Finance article 24 is Topic 3, not No. 24');
    assert.doesNotMatch(card24, /No\. \d\d/);
    for (const a of F.ARTICLES) {
      const card = F.articleCard(a);
      assert.ok(card.includes('Topic ' + EXPECTED[a.id]), 'article ' + a.id + ' card shows Topic ' + EXPECTED[a.id]);
      assert.doesNotMatch(card, /No\. \d\d/, 'article ' + a.id + ' card shows no global number');
    }
  });

  it('an article outside the published list keeps the old display (fallback, never "Topic null")', () => {
    const F = loadFrontend();
    const card = F.articleCard({ id: 999, title: 'X', division: 'Automotive', category: 'C', date: '2026-11-01', excerpt: 'e' });
    assert.ok(card.includes('<span class="article-no">No. 999</span>'));
    assert.doesNotMatch(card, /Topic null/);
  });

  it('the hero plate carries the latest guide per-division number', () => {
    const F = loadFrontend();
    const root = { innerHTML: '' };
    F.renderHeroPreview(root);
    /* Latest is id 25 (2026-11-11, highest id that day) — Travel's
       second article, so the plate shows Topic 2. */
    assert.ok(root.innerHTML.includes('Topic 2'), 'hero plate shows Topic 2');
    assert.doesNotMatch(root.innerHTML, /No\. 25/);
  });

  it('the series nav shows the next guide as "Division · Topic N"', () => {
    const F = loadFrontend();
    const nav12 = F.renderSeriesNav(byId(F.ARTICLES, 12));
    assert.ok(nav12.includes('Buying guides · Part 3 of 5'), 'Part label unchanged');
    assert.ok(nav12.includes('Gadgets &amp; Electronics · Topic 1'), 'next guide 15 is Gadgets Topic 1');
    assert.ok(nav12.includes('class="series-nav-topic"'), 'topic suffix has its own class');
    const nav16 = F.renderSeriesNav(byId(F.ARTICLES, 16));
    assert.ok(nav16.includes('You finished the Buying guides'), 'last-in-arc wording unchanged');
    assert.ok(nav16.includes('Automotive · Topic 4'), 'loop-back target 4 is Automotive Topic 4');
    const nav1 = F.renderSeriesNav(byId(F.ARTICLES, 1));
    assert.ok(nav1.includes('EV series · Part 1 of 3'), 'Part label unchanged');
    assert.ok(nav1.includes('Automotive · Topic 7'), 'next guide 7 is Automotive Topic 7');
    const nav14 = F.renderSeriesNav(byId(F.ARTICLES, 14));
    assert.ok(nav14.includes('Digital Tools · Topic 1'), 'next guide 20 is Digital Tools Topic 1');
  });

  it('article.html uses divisionTopicNo for the meta line and the related cards', () => {
    assert.match(ARTICLE_HTML, /divisionTopicNo\(a\)/, 'meta line');
    assert.match(ARTICLE_HTML, /divisionTopicNo\(x\)/, 'related card');
    assert.doesNotMatch(ARTICLE_HTML, /articleNo\(a\.id\)/);
    assert.doesNotMatch(ARTICLE_HTML, /articleNo\(x\.id\)/);
  });

  it('division.html uses divisionTopicNo for the listing cards', () => {
    assert.match(DIVISION_HTML, /divisionTopicNo\(a\)/);
    assert.doesNotMatch(DIVISION_HTML, /articleNo\(a\.id\)/);
  });

  it('the series-nav topic suffix is styled quietly in main.css', () => {
    assert.match(MAIN_CSS, /\.series-nav-topic\s*\{/);
  });
});

describe('noscript (seo-head.js mirror)', () => {
  it('the 4-argument rewrite shows the same Topic N as the page JS', () => {
    const F = loadFrontend();
    const data = seo.parseStaticData(APP_JS);
    for (const article of data.articles) {
      const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions, data.articles);
      assert.ok(rewritten, 'article ' + article.id + ' rewrites');
      const m = html.match(/<span class="article-no">Topic (\d+)<\/span>/);
      assert.ok(m, 'article ' + article.id + ' noscript carries a Topic number');
      assert.equal(Number(m[1]), F.divisionTopicNo(article), 'article ' + article.id + ' noscript agrees with app.js');
      assert.equal(Number(m[1]), EXPECTED[article.id]);
    }
  });

  it('the 3-argument rewrite keeps the legacy No. NN (fallback for older callers)', () => {
    const data = seo.parseStaticData(APP_JS);
    const article = data.articles.find((a) => a.id === 24);
    const { html, rewritten } = seo.rewriteArticleHtml(ARTICLE_HTML, article, data.divisions);
    assert.ok(rewritten);
    assert.ok(html.includes('<span class="article-no">No. 24</span>'), 'fallback keeps the pinned 3-arg output');
    assert.doesNotMatch(html, /Topic \d+/);
  });

  it('articleNoscript takes the topic number directly, or falls back', () => {
    const article = { id: 7, title: 'T', division: 'Automotive', category: 'C', date: '2026-11-04', excerpt: 'e', body: '<p>b</p>' };
    assert.ok(seo.articleNoscript(article, [], 7).includes('<span class="article-no">Topic 7</span>'));
    assert.ok(seo.articleNoscript(article, []).includes('<span class="article-no">No. 07</span>'));
  });
});
