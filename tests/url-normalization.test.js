// FS AI — URL normalisation tests (Phase 3, Priority 1).
//
// Phase 2 failed a live generation on one trailing slash: the resolver
// matched research_items.url by EXACT string, so the Austin Guardian
// URL supplied WITH a slash never matched the stored URL WITHOUT one
// (article #29). These tests pin the normalisation contract: safe
// variations match, genuinely different articles never do, and the
// original URL is never rewritten by the matcher itself.
// Run: node --test tests/url-normalization.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUrl, canonicalUrl, urlsMatch, matchDecision } = require('../backend/services/urls.js');

const AUSTIN_STORED = 'https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide';
const AUSTIN_SUPPLIED = 'https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide/';

describe('normalizeUrl', () => {
  it('is the exact Phase 2 Guardian mismatch: trailing slash matches the stored URL', () => {
    assert.equal(normalizeUrl(AUSTIN_SUPPLIED), normalizeUrl(AUSTIN_STORED));
    assert.ok(urlsMatch(AUSTIN_SUPPLIED, AUSTIN_STORED));
    assert.equal(matchDecision(AUSTIN_SUPPLIED, AUSTIN_STORED), 'normalized');
    assert.equal(matchDecision(AUSTIN_STORED, AUSTIN_STORED), 'exact');
  });

  it('drops www and lower-cases scheme/host', () => {
    assert.equal(
      normalizeUrl('HTTPS://WWW.Example.COM/Guide'),
      'https://example.com/Guide',
    );
    assert.ok(urlsMatch('https://www.example.com/guide', 'https://example.com/guide'));
  });

  it('treats http and https as the same source where safe', () => {
    assert.ok(urlsMatch('http://example.com/guide', 'https://example.com/guide'));
  });

  it('drops fragments', () => {
    assert.ok(urlsMatch('https://example.com/guide#section-2', 'https://example.com/guide'));
    assert.equal(normalizeUrl('https://example.com/guide#x'), 'https://example.com/guide');
  });

  it('drops default ports but keeps non-default ports', () => {
    assert.ok(urlsMatch('https://example.com:443/guide', 'https://example.com/guide'));
    assert.ok(urlsMatch('http://example.com:80/guide', 'http://example.com/guide'));
    assert.ok(!urlsMatch('https://example.com:8443/guide', 'https://example.com/guide'));
  });

  it('keeps the root slash but drops a trailing slash elsewhere', () => {
    assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
    assert.equal(normalizeUrl('https://example.com/guide/'), 'https://example.com/guide');
  });

  it('collapses duplicate slashes in the path', () => {
    assert.ok(urlsMatch('https://example.com/a//b///c', 'https://example.com/a/b/c'));
  });

  it('preserves meaningful query parameters (order-insensitive)', () => {
    assert.ok(urlsMatch('https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2'));
    assert.ok(!urlsMatch('https://example.com/article?id=1', 'https://example.com/article?id=2'),
      'a different query value is a different article');
    assert.ok(!urlsMatch('https://example.com/article?id=1', 'https://example.com/article'),
      'a missing query parameter is a different resource');
  });

  it('never conflates different paths', () => {
    assert.ok(!urlsMatch('https://example.com/guide-a', 'https://example.com/guide-b'));
    assert.ok(!urlsMatch('https://example.com/travel/2024/apr/26/austin-texas-three-day-travel-guide',
      'https://example.com/travel/2024/mar/22/nyc-three-day-travel-guide'));
  });

  it('returns null for invalid or non-http(s) URLs, and they never match', () => {
    assert.equal(normalizeUrl('not a url'), null);
    assert.equal(normalizeUrl('ftp://example.com/file'), null);
    assert.equal(normalizeUrl(''), null);
    assert.equal(normalizeUrl(null), null);
    assert.ok(!urlsMatch('not a url', 'not a url'));
    assert.equal(canonicalUrl('not a url'), null);
    assert.equal(matchDecision('not a url', 'not a url'), 'no-match');
  });
});

describe('matchDecision', () => {
  it('distinguishes exact, normalized and no-match', () => {
    assert.equal(matchDecision('https://example.com/a', 'https://example.com/a'), 'exact');
    assert.equal(matchDecision('https://example.com/a/', 'https://example.com/a'), 'normalized');
    assert.equal(matchDecision('https://example.com/a', 'https://example.com/b'), 'no-match');
  });
});
