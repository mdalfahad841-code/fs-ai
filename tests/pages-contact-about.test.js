// FS AI — Contact / About / 404 regression tests.
// 2026-11-14 full functional test: Contact and About pages did not exist and
// every unknown path soft-404'd (HTTP 200 serving the homepage). These pages
// were added and a real 404.html now exists so Cloudflare Pages returns 404.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Contact / About / 404 pages', () => {
  it('about.html exists with GA4 tag, canonical and brand facts', () => {
    const html = read('frontend/pages/about.html');
    assert.ok(html.includes('G-JVSCJT2DHJ'), 'GA4 tag present');
    assert.ok(html.includes('<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/about.html">'));
    assert.ok(html.includes('FAHAD SOMRAT AI'));
    assert.ok(html.includes('25 articles'));
    assert.ok(html.includes('20 free tools'));
  });

  it('contact.html exists with the owner email and real social links only', () => {
    const html = read('frontend/pages/contact.html');
    assert.ok(html.includes('mailto:mdalfahad841@gmail.com'));
    assert.ok(html.includes('https://github.com/mdalfahad841-code/fs-ai'));
    assert.ok(html.includes('https://www.youtube.com/@FSAI-e5f'));
    assert.ok(html.includes('https://www.pinterest.com/watchwithf/'));
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
    assert.ok(appJs.includes('pages/about.html'));
    assert.ok(appJs.includes('pages/contact.html'));
  });

  it('sitemap lists the About and Contact pages (60 URLs total)', () => {
    const xml = read('frontend/sitemap.xml');
    assert.ok(xml.includes('<loc>https://fs-ai-5w5.pages.dev/pages/about.html</loc>'));
    assert.ok(xml.includes('<loc>https://fs-ai-5w5.pages.dev/pages/contact.html</loc>'));
    assert.ok(!xml.includes('404.html'), '404 page must not be in the sitemap');
    assert.equal((xml.match(/<url>/g) || []).length, 60);
  });
});
