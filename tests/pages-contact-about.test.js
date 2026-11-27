// FS AI — Contact / About / 404 regression tests.
// 2026-11-14 full functional test: Contact and About pages did not exist and
// every unknown path soft-404'd (HTTP 200 serving the homepage). These pages
// were added and a real 404.html now exists so Cloudflare Pages returns 404.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* Minimal app.js loader (same shape as closeout-a1's loadApp): the file
   only registers a DOMContentLoaded listener at load, and liveReady
   resolves immediately with no fetch in the sandbox. */
function loadFooter() {
  const sandbox = {
    window: { location: { pathname: '/' } },
    document: { addEventListener() {}, getElementById: () => null },
    console,
    URLSearchParams,
    setTimeout(fn) { return { fn, cleared: false }; },
    clearTimeout() {},
    AbortController: class {
      constructor() { this.signal = {}; }
      abort() {}
    },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('frontend/scripts/app.js'), sandbox);
  return sandbox.window.FSAI.renderFooter();
}

describe('Contact / About / 404 pages', () => {
  it('about.html exists with GA4 tag, canonical and brand facts', () => {
    const html = read('frontend/pages/about.html');
    assert.ok(html.includes('G-JVSCJT2DHJ'), 'GA4 tag present');
    assert.ok(html.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/about">'));
    assert.ok(html.includes('FAHAD SOMRAT AI'));
    // A1.5 (2026-11-23): static copy is generic — no fixed article/tool/
    // division counts (those come from the merged list at runtime).
    assert.ok(!html.includes('25 articles'), 'no hard-coded article count');
    assert.ok(!html.includes('20 free tools'), 'no hard-coded tool count');
    assert.ok(!html.includes('8 divisions'), 'no hard-coded division count');
    assert.ok(html.includes('Automotive'), 'division names still listed');
    assert.ok(html.includes('free articles'), 'generic articles wording');
  });

  it('contact.html exists with the owner email and real social links only', () => {
    const html = read('frontend/pages/contact.html');
    assert.ok(html.includes('mailto:mdalfahad841@gmail.com'));
    assert.ok(html.includes('https://github.com/mdalfahad841-code/fs-ai'));
    assert.ok(html.includes('https://www.youtube.com/@FSAI-e5f'));
    assert.ok(html.includes('https://www.pinterest.com/watchwithf/'));
    assert.ok(html.includes('https://www.instagram.com/fsai.406'));
    assert.ok(!html.includes('<form'), 'no contact form (no backend for one — mailto only)');
  });

  it('404.html exists, is noindex, and uses root-relative assets', () => {
    const html = read('frontend/404.html');
    assert.ok(html.includes('Page not found'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
    assert.ok(html.includes('href="/styles/main.css"'), 'root-relative CSS so it works at any path depth');
    assert.ok(html.includes('href="/"'), 'link back home');
  });

  it('footer links About and Contact', () => {
    const appJs = read('frontend/scripts/app.js');
    assert.ok(appJs.includes('pages/about'));
    assert.ok(appJs.includes('pages/contact'));
    assert.ok(!appJs.includes('pages/about.html'), 'clean route — no .html');
    assert.ok(!appJs.includes('pages/contact.html'), 'clean route — no .html');
  });

  it('footer Accounts column links Instagram @fsai.406', () => {
    const appJs = read('frontend/scripts/app.js');
    // renderFooter() renders every ACCOUNTS entry with status 'Exists' as
    // an icon-only link, so this entry is the footer Instagram link.
    assert.ok(appJs.includes("name: 'Instagram', handle: '@fsai.406', url: 'https://www.instagram.com/fsai.406', status: 'Exists'"), 'Instagram Exists entry in ACCOUNTS');
  });

  it('footer Accounts column is icon-only: logo, no visible name/handle/URL text', () => {
    // Owner order 2026-11-27 (phone screenshot): "Social media logo
    // thakbe shudu click korle dhukbe kono name or link show korbe na"
    // — the five account links are brand logos only; the platform name
    // lives in aria-label (screen readers) and the click still opens
    // the same profile URL.
    const html = loadFooter();
    const m = html.match(/<p class="footer-accounts">([\s\S]*?)<\/p>/);
    assert.ok(m, 'footer-accounts paragraph present');
    const accounts = m[1];
    for (const url of [
      'https://github.com/mdalfahad841-code/fs-ai',
      'https://www.youtube.com/@FSAI-e5f',
      'https://www.pinterest.com/watchwithf/',
      'https://www.instagram.com/fsai.406',
      'https://www.threads.com/@fsai.406',
    ]) assert.ok(accounts.includes('href="' + url + '"'), 'link to ' + url);
    for (const name of ['GitHub', 'YouTube', 'Pinterest', 'Instagram', 'Threads']) {
      assert.ok(accounts.includes('aria-label="' + name + '"'), 'aria-label ' + name);
    }
    assert.equal((accounts.match(/<svg/g) || []).length, 5, 'exactly five brand logos');
    const visibleText = accounts.replace(/<[^>]*>/g, '').trim();
    assert.equal(visibleText, '', 'no visible text in the Accounts links, got: ' + JSON.stringify(visibleText));
    assert.ok(!accounts.includes('(@'), 'no visible handle text');
  });

  it('sitemap lists the About and Contact pages (60 URLs total)', () => {
    const xml = read('frontend/sitemap.xml');
    // Clean canonical forms — no .html (2026-11-20 indexing fix: every
    // .html sitemap URL 308-redirected, and Google reported
    // "Couldn't fetch").
    assert.ok(xml.includes('<loc>https://fs-ai-5w5.pages.dev/pages/about</loc>'));
    assert.ok(xml.includes('<loc>https://fs-ai-5w5.pages.dev/pages/contact</loc>'));
    assert.ok(!xml.includes('404.html'), '404 page must not be in the sitemap');
    assert.equal((xml.match(/<url>/g) || []).length, 60);
  });
});
