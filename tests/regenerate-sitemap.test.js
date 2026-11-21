// FS AI — deploy-time sitemap merge tests (coordinator wiring 2026-11-21).
//
// scripts/regenerate-sitemap.mjs merges the static generator entries
// (backend/services/seo.js) with live published articles from D1, so a
// newly published article appears in the served sitemap at the next
// deploy even though it is not in the checked-in ARTICLES list.
// Tests run the script with --from-json + --dry-run (no wrangler, no
// network, nothing written). Run: node --test
// tests/regenerate-sitemap.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'regenerate-sitemap.mjs');

function runScript(jsonData) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsai-sitemap-'));
  const input = path.join(tmp, 'live.json');
  fs.writeFileSync(input, JSON.stringify(jsonData), 'utf8');
  const out = execFileSync(process.execPath, [SCRIPT, '--from-json', input, '--dry-run'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

function locsOf(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

describe('regenerate-sitemap.mjs — live merge', () => {
  it('merges a live-only published article into the sitemap without duplicating static entries', () => {
    const xml = runScript({
      articles: [
        { id: 1, published_at: '2026-11-01T00:00:00.000Z' },
        { id: 32, published_at: '2026-11-21T06:00:00.000Z' },
      ],
      divisions: [{ slug: 'automotive' }],
    });
    const locs = locsOf(xml);
    assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/pages/article?id=32'),
      'a live-only article (id 32, not in the static list) must appear');
    assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/pages/article?id=1'),
      'the statically-listed article must still appear');
    assert.equal(new Set(locs).size, locs.length, 'no duplicate locs');
    assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/pages/tools'),
      'static pages (tools) must still be listed');
  });

  it('with no live articles the output is exactly the static generator output', () => {
    const xml = runScript({ articles: [], divisions: [] });
    const locs = locsOf(xml);
    assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/'), 'home must be listed');
    assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/pages/article?id=25'),
      'the last statically-listed published article must be present');
    assert.equal(new Set(locs).size, locs.length, 'no duplicate locs');
  });

  it('a live article already in the static list is not duplicated', () => {
    const xml = runScript({
      articles: [{ id: 5, published_at: '2026-11-03T00:00:00.000Z' }],
      divisions: [],
    });
    const locs = locsOf(xml);
    assert.equal(locs.filter((l) => l === 'https://fs-ai-5w5.pages.dev/pages/article?id=5').length, 1,
      'article id 5 is in the static list and must appear exactly once');
  });
});
