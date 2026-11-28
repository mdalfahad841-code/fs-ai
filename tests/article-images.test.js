// FS AI — Article pictures (owner order 2026-11-27): one original
// illustration per article, no text in any image.
//
// Covers, offline with no network:
//   1. The articleImage helper derives /images/articles/article-<id>.jpg
//      from the id — no bundle field, no D1 column — so it works for
//      static articles and live-merged ones alike.
//   2. articleCard (homepage + division listings) carries the picture;
//      the article page carries it as a hero figure under the meta line
//      and on every related card.
//   3. main.css styles card + hero images at 16:9 cover.
//   4. The picture files themselves: one JPEG per imaged article,
//      exactly 32, and NONE for the protected drafts (#28/#29/#30/#34).
//
// Run: node --test tests/article-images.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const APP_JS = fs.readFileSync(path.join(FRONTEND, 'scripts', 'app.js'), 'utf8');
const ARTICLE_HTML = fs.readFileSync(path.join(FRONTEND, 'pages', 'article.html'), 'utf8');
const MAIN_CSS = fs.readFileSync(path.join(FRONTEND, 'styles', 'main.css'), 'utf8');
const IMG_DIR = path.join(FRONTEND, 'images', 'articles');

// Every article that gets a picture: 29 published (1-25, 31, 33, 38, 40)
// + drafts #35/#36/#37/#39 (their pictures are in place before they publish).
const IMAGED_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 31, 33, 35, 36, 37, 38, 39, 40];
// Protected drafts — edit protection stands, no picture file for these.
const PROTECTED_IDS = [28, 29, 30, 34];

function loadFrontend() {
  const window = { location: { pathname: '/' } };
  const document = { addEventListener() {}, getElementById: () => null };
  const sandbox = { window, document, console };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS, sandbox);
  return sandbox.window.FSAI;
}

function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
}

describe('articleImage helper', () => {
  it('derives /images/articles/article-<id>.jpg from the id', () => {
    const F = loadFrontend();
    for (const id of IMAGED_IDS) {
      assert.equal(F.articleImage({ id }), '/images/articles/article-' + id + '.jpg', 'id ' + id);
    }
    // A future id derives the same way — a draft's picture is already
    // in place the moment it publishes, with no code change.
    assert.equal(F.articleImage({ id: 40 }), '/images/articles/article-40.jpg');
  });

  it('returns empty for a missing article', () => {
    const F = loadFrontend();
    assert.equal(F.articleImage(null), '');
    assert.equal(F.articleImage({}), '');
  });
});

describe('article cards carry the picture', () => {
  it('articleCard puts the image first, lazy-loaded, empty alt (the title link is adjacent)', () => {
    const F = loadFrontend();
    for (const a of F.ARTICLES) {
      const card = F.articleCard(a);
      assert.ok(
        card.includes('<img class="card-img" src="/images/articles/article-' + a.id + '.jpg" alt="" loading="lazy" width="1600">'),
        'card ' + a.id,
      );
      assert.ok(card.indexOf('card-img') < card.indexOf('card-tag'), 'card ' + a.id + ': image comes before the tag');
    }
  });

  it('renderArticles renders 25 cards and 25 card images (the class name keeps the article-card count at 25)', () => {
    const F = loadFrontend();
    const root = { innerHTML: '' };
    F.renderArticles(root);
    assert.equal((root.innerHTML.match(/article-card/g) || []).length, 25);
    assert.equal((root.innerHTML.match(/card-img/g) || []).length, 25);
  });
});

describe('article page wiring', () => {
  it('article.html renders the hero figure from articleImage(a) under the meta line', () => {
    assert.ok(ARTICLE_HTML.includes('<figure class="article-hero">'), 'hero figure present');
    assert.ok(ARTICLE_HTML.includes('window.FSAI.articleImage(a)'), 'hero uses articleImage(a)');
    assert.ok(ARTICLE_HTML.includes('article-hero-img'), 'hero img class present');
    assert.ok(
      ARTICLE_HTML.indexOf('article-hero') > ARTICLE_HTML.indexOf('article-meta'),
      'hero figure is placed after the meta line',
    );
  });

  it('article.html related cards carry the same image from articleImage(x)', () => {
    assert.ok(ARTICLE_HTML.includes('window.FSAI.articleImage(x)'), 'related cards use articleImage(x)');
    assert.ok(ARTICLE_HTML.includes('<img class="card-img"'), 'related cards carry a card-img');
  });
});

describe('article picture CSS', () => {
  it('main.css styles card and hero images at 16:9 cover', () => {
    assert.ok(MAIN_CSS.includes('.card-img'), '.card-img rule present');
    assert.ok(MAIN_CSS.includes('.article-hero-img'), '.article-hero-img rule present');
    assert.ok(MAIN_CSS.includes('aspect-ratio: 16 / 9'), '16:9 aspect ratio present');
    assert.ok(MAIN_CSS.includes('object-fit: cover'), 'cover crop present');
  });

  it('no height attribute on article images — the 900px height must never be forced (2026-11-28: hero + card images rendered as tall portrait strips)', () => {
    assert.ok(!APP_JS.includes('height="900"'), 'app.js card images carry no height attribute');
    assert.ok(!ARTICLE_HTML.includes('height="900"'), 'article.html hero/related images carry no height attribute');
    assert.ok(MAIN_CSS.includes('.card-img { display: block; width: 100%; height: auto;'), '.card-img sets height: auto');
    assert.ok(MAIN_CSS.includes('.article-hero-img { display: block; width: 100%; height: auto;'), '.article-hero-img sets height: auto');
  });
});

describe('article picture files', () => {
  it('one JPEG exists per imaged article, named article-<id>.jpg', () => {
    for (const id of IMAGED_IDS) {
      const p = path.join(IMG_DIR, 'article-' + id + '.jpg');
      assert.ok(fs.existsSync(p), 'missing ' + p);
      const buf = fs.readFileSync(p);
      assert.ok(isJpeg(buf), 'not a JPEG: ' + p);
      assert.ok(buf.length > 10000, 'suspiciously small: ' + p + ' (' + buf.length + ' B)');
    }
  });

  it('exactly the 33 expected files, no extras', () => {
    const files = fs.readdirSync(IMG_DIR).filter((f) => f.endsWith('.jpg')).sort();
    const expected = IMAGED_IDS.map((id) => 'article-' + id + '.jpg').sort();
    assert.deepEqual(files, expected);
  });

  it('no picture files for the protected drafts', () => {
    for (const id of PROTECTED_IDS) {
      assert.ok(
        !fs.existsSync(path.join(IMG_DIR, 'article-' + id + '.jpg')),
        'protected draft ' + id + ' must have no picture file',
      );
    }
  });
});
