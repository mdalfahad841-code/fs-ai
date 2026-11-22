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

/* --from-api (Phase 2, 2026-11-22): the script reads the live list from
   the Worker's public endpoint instead of wrangler — no secret. The
   server below is a local stand-in for that endpoint. */
const http = require('node:http');

function serveApi(payload, status = 200) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runScriptFromApi(url, extraArgs) {
  // Async execFile (not execFileSync): the fixture server runs on THIS
  // process's event loop, and a synchronous spawn would block the loop so
  // the server could never answer the child's fetch.
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(process.execPath,
    [SCRIPT, '--from-api', url, '--dry-run', ...extraArgs],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  return stdout;
}

describe('regenerate-sitemap.mjs — --from-api (no-secret live source)', () => {
  it('merges a live-only article from the API without duplicating static entries', async () => {
    const server = await serveApi({
      ok: true,
      articles: [
        { id: 1, published_at: '2026-11-01T00:00:00.000Z' },
        { id: 32, published_at: '2026-11-21T06:00:00.000Z' },
      ],
      total: 2, source: 'd1',
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/articles?limit=100`;
      const xml = await runScriptFromApi(url, []);
      const locs = locsOf(xml);
      assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/pages/article?id=32'),
        'a live-only article (id 32) from the API must appear');
      assert.equal(new Set(locs).size, locs.length, 'no duplicate locs');
    } finally {
      server.close();
    }
  });

  it('refuses a fallback-source response under --require-live (exit 1)', async () => {
    const server = await serveApi({
      ok: true,
      articles: [{ id: 1, published_at: '2026-11-01T00:00:00.000Z' }],
      total: 1, source: 'fallback',
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/articles`;
      let thrown = null;
      try { await runScriptFromApi(url, ['--require-live']); } catch (err) { thrown = err; }
      assert.ok(thrown, 'a fallback-source response must fail under --require-live');
      assert.equal(thrown.code, 1, 'exit code must be 1');
    } finally {
      server.close();
    }
  });

  it('an unreachable API fails loudly under --require-live (exit 1), warns without it (exit 0, static-only)', async () => {
    const dead = await serveApi({ ok: true, articles: [], total: 0, source: 'd1' });
    const deadPort = dead.address().port;
    dead.close();
    await new Promise((r) => dead.on('close', r));
    const url = `http://127.0.0.1:${deadPort}/api/articles`;
    let thrown = null;
    try { await runScriptFromApi(url, ['--require-live']); } catch (err) { thrown = err; }
    assert.ok(thrown, 'an unreachable API must fail under --require-live');
    assert.equal(thrown.code, 1, 'exit code must be 1');
    const xml = await runScriptFromApi(url, []);
    const locs = locsOf(xml);
    assert.ok(locs.includes('https://fs-ai-5w5.pages.dev/pages/article?id=25'),
      'without --require-live the script still writes the static-only sitemap');
    assert.ok(!locs.includes('https://fs-ai-5w5.pages.dev/pages/article?id=32'),
      'and no live-only article can appear when the API is unreachable');
  });
});

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
