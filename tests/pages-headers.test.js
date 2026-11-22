// FS AI — Pages _headers tests (autonomy fix item 3, 2026-11-22).
// The _headers file ships CSP-Report-Only first (nothing enforced) plus an
// enforced X-Frame-Options: DENY. These tests pin the audit result: the only
// external script host is googletagmanager.com (GA4), fetches go only to the
// Worker and Google Analytics, and no enforced CSP may ever appear here
// without a deliberate change to this file AND this test.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HEADERS_PATH = path.join(ROOT, 'frontend', '_headers');

function readHeaders() {
  return fs.readFileSync(HEADERS_PATH, 'utf8');
}

describe('Pages _headers (frontend/_headers)', () => {
  it('exists and applies to every path', () => {
    const text = readHeaders();
    assert.ok(text.includes('/*'), '_headers must have a /* rule so every page gets the headers');
  });

  it('ships CSP as Report-Only, never enforced', () => {
    const text = readHeaders();
    assert.ok(
      text.includes('Content-Security-Policy-Report-Only:'),
      'the CSP must be Report-Only first — an enforced CSP must not block anything',
    );
    const enforced = text.split('\n').some((line) => /^[\s]*Content-Security-Policy:/.test(line));
    assert.equal(enforced, false, 'no enforced Content-Security-Policy: line may exist');
  });

  it('sets X-Frame-Options: DENY (the site is never embedded)', () => {
    const text = readHeaders();
    assert.ok(text.includes('X-Frame-Options: DENY'), 'X-Frame-Options: DENY must be present');
  });

  it('allows exactly the audited external hosts and nothing else', () => {
    const text = readHeaders();
    const policy = text.split('Content-Security-Policy-Report-Only:')[1].split('\n')[0];
    // The one external script: GA4.
    assert.ok(policy.includes('https://www.googletagmanager.com'), 'script-src must allow the GA4 host');
    // Fetches: the Worker (dashboard/auth/newsletter + the future live-article
    // fetch) and GA4 beacons.
    assert.ok(policy.includes('https://fs-ai.mdalfahad841.workers.dev'), 'connect-src must allow the Worker');
    assert.ok(policy.includes('https://www.google-analytics.com'), 'connect-src must allow GA4 beacons');
    // Inline scripts/styles are used across the pages.
    assert.ok(policy.includes("'unsafe-inline'"), 'script-src/style-src keep unsafe-inline (inline code is used)');
    // Framing denied in the policy too, matching X-Frame-Options.
    assert.ok(policy.includes("frame-ancestors 'none'"), "frame-ancestors must be 'none'");
  });
});
