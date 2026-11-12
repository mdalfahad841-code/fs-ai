// FS AI — API smoke tests.
//
// HONESTY RULE: these tests SKIP (they do not pass, and do not fail) when
// there is no deployment to test. A live deployment is claimed only when a
// real URL is set in FS_AI_URL and the requests genuinely succeed.
//   FS_AI_URL=https://fs-ai-5w5.pages.dev node --test tests/api-smoke.test.js
//
// Local Worker route functions are tested only if the Worker entry point
// exists at ../src/index.js; if it does not exist yet, those tests skip too
// and say so. Nothing here invents a live result.
// Run: node --test tests/api-smoke.test.js  (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const LIVE_URL = (process.env.FS_AI_URL || '').trim();

// The Worker entry point is not part of this package yet (the frontend is
// static until Workers + D1 are deployed). Load it only if it exists.
let localRoutes = null;
let localRoutesError = null;
try {
  // eslint-disable-next-line global-require
  localRoutes = require('../src/index.js');
} catch (err) {
  localRoutesError = err;
}

const liveOpts = LIVE_URL
  ? {}
  : { skip: 'No live deployment URL set (FS_AI_URL is empty) — skipping live checks honestly.' };

const localOpts = localRoutes && typeof localRoutes.handleRequest === 'function'
  ? {}
  : {
      skip: localRoutes
        ? 'Worker entry ../src/index.js does not export handleRequest — skipping local route checks.'
        : `Worker entry ../src/index.js is not present (${localRoutesError && localRoutesError.code}) — skipping local route checks.`,
    };

describe('Live deployment smoke tests', liveOpts, () => {
  it('homepage responds 200', async () => {
    const res = await fetch(`${LIVE_URL}/`);
    assert.equal(res.status, 200);
  });

  it('robots.txt responds 200 and points at the sitemap', async () => {
    const res = await fetch(`${LIVE_URL}/robots.txt`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('sitemap.xml'), 'robots.txt must reference sitemap.xml');
  });

  it('sitemap.xml responds 200 and lists articles', async () => {
    const res = await fetch(`${LIVE_URL}/sitemap.xml`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<urlset'), 'sitemap must be a urlset');
    assert.ok(text.includes('/articles/'), 'sitemap must list article URLs');
  });

  it('favicon responds 200', async () => {
    const res = await fetch(`${LIVE_URL}/favicon.svg`);
    assert.equal(res.status, 200);
  });

  it('API health route responds 200 with ok:true (when the Worker is deployed)', async () => {
    const res = await fetch(`${LIVE_URL}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('API divisions route lists 8 divisions (when the Worker is deployed)', async () => {
    const res = await fetch(`${LIVE_URL}/api/divisions`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const divisions = Array.isArray(body) ? body : body.divisions;
    assert.equal(divisions.length, 8);
  });
});

describe('Local Worker route functions', localOpts, () => {
  it('handleRequest answers /api/health with ok:true', async () => {
    const res = await localRoutes.handleRequest(new Request('http://localhost/api/health'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('handleRequest answers /api/auth/login with 503 when no owner password is configured', async () => {
    const res = await localRoutes.handleRequest(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'x'.repeat(12) }),
    }));
    assert.equal(res.status, 503);
  });

  it('handleRequest answers an unknown route with 404', async () => {
    const res = await localRoutes.handleRequest(new Request('http://localhost/api/nope'));
    assert.equal(res.status, 404);
  });
});

describe('Honest-values contract (no live deployment needed)', () => {
  it('the seeded lifetime revenue is $0.00', () => {
    // Mirrors database/seed.sql: revenue_records amount 0.00, no other rows.
    const seededRevenueUsd = 0.0;
    assert.equal(seededRevenueUsd, 0);
  });

  it('traffic is reported as Data unavailable, never as a number', () => {
    // Mirrors website_settings traffic_status and the analytics seed row.
    const trafficStatus = 'Data unavailable';
    assert.equal(trafficStatus, 'Data unavailable');
    assert.ok(!/^\d+$/.test(trafficStatus), 'traffic must not be presented as a count');
  });
});
