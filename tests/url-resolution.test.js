// FS AI — resolveEvidence URL-normalisation tests (Phase 3, Priority 1).
//
// The resolver must find stored research even when the supplied URL
// differs by a trailing slash / www / http-vs-https / fragment — the
// exact Phase 2 failure (article #29: Guardian URL supplied WITH a
// slash never matched the stored URL WITHOUT one). The original
// supplied URL is preserved for display/audit; the canonical URL and
// the matching decision are recorded on the resolved item.
// Run: node --test tests/url-resolution.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { resolveEvidence } = require('../backend/agents/autonomy/content.js');

const ROOT = path.join(__dirname, '..');

function splitSql(text) {
  const stmts = [];
  let cur = '';
  let inStr = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inComment) {
      if (ch === '\n') { inComment = false; cur += ch; }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { stmts.push(cur + ch); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts.filter((s) => s.trim());
}

function buildDb(files) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const stmt of splitSql(text)) db.exec(stmt);
  }
  return db;
}

function makeRealD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (params) => ({
        all: () => Promise.resolve({ results: stmt.all(...params) }),
        first: () => Promise.resolve(stmt.get(...params) || null),
        run: () => Promise.resolve((() => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        })()),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        first: () => bound([]).first(),
        run: () => bound([]).run(),
      };
    },
  };
}

const AUSTIN = 'https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide';

function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
  ]);
  db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated) VALUES (1, 5, ?, ?, ?, ?, ?, ?, 0)',
  ).run(
    'A local’s travel guide to Austin',
    AUSTIN,
    '2024-04-26T00:00:00Z',
    '2026-11-19T17:07:00Z',
    'Three days in Austin: barbecue, live music and swimming holes.',
    'Three days in Austin: barbecue, live music and swimming holes. The guide covers Franklin Barbecue and Barton Springs.',
  );
  return { db, env: { DB: makeRealD1(db) } };
}

describe('resolveEvidence URL normalisation', () => {
  it('resolves the exact stored URL with matchMethod exact', async () => {
    const { env } = freshEnv();
    const r = await resolveEvidence(env, [AUSTIN]);
    assert.equal(r.resolved.length, 1);
    assert.equal(r.unresolved.length, 0);
    assert.equal(r.resolved[0].matchMethod, 'exact');
    assert.equal(r.resolved[0].matchedStoredUrl, AUSTIN);
    assert.equal(r.resolved[0].url, AUSTIN, 'original URL preserved');
    assert.ok(r.resolved[0].canonicalUrl);
  });

  it('resolves the Phase 2 trailing-slash variation with matchMethod normalized', async () => {
    const { env } = freshEnv();
    const supplied = `${AUSTIN}/`;
    const r = await resolveEvidence(env, [supplied]);
    assert.equal(r.resolved.length, 1, 'the #29 failure must now resolve');
    assert.equal(r.unresolved.length, 0);
    assert.equal(r.resolved[0].matchMethod, 'normalized');
    assert.equal(r.resolved[0].url, supplied, 'original supplied URL preserved for display/audit');
    assert.equal(r.resolved[0].matchedStoredUrl, AUSTIN);
    assert.equal(r.resolved[0].researchItemId, 1);
  });

  it('resolves www / http / fragment variations to the same stored item', async () => {
    const { env } = freshEnv();
    const r = await resolveEvidence(env, [
      'http://theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide#intro',
      'https://www.theguardian.com:443/travel/2024/apr/26/austin-texas-three-day-travel-guide',
    ]);
    assert.equal(r.resolved.length, 1, 'variations dedupe to one resolved item');
    assert.equal(r.resolved[0].researchItemId, 1);
  });

  it('does not resolve a genuinely different article', async () => {
    const { env } = freshEnv();
    const r = await resolveEvidence(env, [
      'https://www.theguardian.com/travel/2024/mar/22/nyc-three-day-travel-guide',
      'https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide?x=1',
    ]);
    assert.equal(r.resolved.length, 0);
    assert.equal(r.unresolved.length, 2);
  });

  it('does not resolve an unfetched URL', async () => {
    const { env } = freshEnv();
    const r = await resolveEvidence(env, ['https://example.com/never-fetched']);
    assert.equal(r.resolved.length, 0);
    assert.deepEqual(r.unresolved, ['https://example.com/never-fetched']);
  });
});
