// FS AI — daily-limit TOCTOU (Workstream A, task C, 2026-11-21).
//
// Complements tests/concurrent-publishing.test.js: this file pins the
// race itself (two Promise.all calls with limit 1), the Dhaka-day
// boundary (a publication dated yesterday-Dhaka must not consume
// today's limit), the pre-026 fallback (guarded conditional UPDATE
// when the reservation table does not exist), and the dhakaDayString
// helper (Dhaka is UTC+6, no daylight saving).
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012/019/021, plus 026 except in the fallback test).
// Run: node --test tests/daily-limit-toctou.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const {
  autoPublishArticle, dhakaDayString, reservationTableExists,
} = require('../backend/agents/autonomy/publishing.js');
const { countPublishedTodayDhaka } = require('../backend/publishing/gate.js');

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

const BASE = [
  'database/schema.sql',
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql',
  'database/migrations/019_factcheck_body_hash.sql',
  'database/migrations/021_publication_logs.sql',
];

function freshEnv({ withReservations = true } = {}) {
  const files = withReservations ? [...BASE, 'database/migrations/026_daily_publication_reservations.sql'] : BASE;
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function enableAutoPublish(db, { limit = '1' } = {}) {
  setSetting(db, 'publishing_mode', 'auto');
  setSetting(db, 'auto_publishing', 'on');
  setSetting(db, 'auto_publish_eligible_since', new Date(Date.now() - 3600 * 1000).toISOString());
  setSetting(db, 'max_articles_per_day', limit);
}

const DRAFT_BODY = (siblingId) =>
  'Electric cars are changing how we drive. A home charger adds about 40 kilometres of range per hour of charging. '
  + `Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=${siblingId}`;

function insertDraft(db, { id, title, slug, body }) {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(id, title, slug, 'test', body, 'FS AI', 'draft', now, now);
  return id;
}

function insertPublishedSibling(db) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, created_at, updated_at) VALUES (1, 'Electric Car Maintenance Checklist', 'w3-sibling-electric', 'test', 'Electric car maintenance keeps your car reliable.', 'FS AI', 'published', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
  ).run();
  return Number(r.lastInsertRowid);
}

function seoChecksJson() {
  return JSON.stringify([
    { name: 'seo-title', ok: true },
    { name: 'meta-description', ok: true },
    { name: 'slug-unique', ok: true },
    { name: 'heading-hierarchy', ok: true },
    { name: 'keyword-relevance', ok: true },
    { name: 'internal-links', ok: true, detail: 'Body links to at least one other published article.' },
    { name: 'image-alt', ok: true },
    { name: 'readability', ok: true, detail: 'Estimate: 40 words.' },
    { name: 'duplicate', ok: true, detail: 'Highest 5-word shingle overlap with another published article: 0%.' },
    { name: 'broken-links', ok: true },
    { name: 'structured-metadata', ok: true },
  ]);
}

async function makeEligible(db, articleId) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  const hash = await bodyHash(article.body);
  const fc = db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, ?, 2, 2, 0, ?)',
  ).run(articleId, 'pass', hash);
  const fcId = Number(fc.lastInsertRowid);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'EV sales reached 14 million units worldwide in 2023.', 'VERIFIED', 'https://example.com/source-1', 'EV sales reached 14 million units.', 'Supported.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'A home charger adds about 40 kilometres of range per hour.', 'VERIFIED', 'https://example.com/source-2', 'A home charger adds about 40 kilometres of range per hour.', 'Supported.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId);
  db.prepare('INSERT INTO seo_checks (article_id, verdict, checks_json, created_at) VALUES (?, ?, ?, ?)').run(
    articleId, 'pass', seoChecksJson(), article.updated_at);
}

describe('dhakaDayString — Dhaka calendar day (UTC+6, no DST)', () => {
  it('maps instants to the Dhaka date, including the midnight rollover', () => {
    assert.equal(dhakaDayString(new Date('2026-11-21T00:30:00.000Z')), '2026-11-21', '06:30 Dhaka on the 21st');
    assert.equal(dhakaDayString(new Date('2026-11-21T17:30:00.000Z')), '2026-11-21', '23:30 Dhaka on the 21st');
    assert.equal(dhakaDayString(new Date('2026-11-21T18:30:00.000Z')), '2026-11-22', '00:30 Dhaka rolls to the 22nd');
    assert.equal(dhakaDayString(new Date('2026-11-21T17:59:59.000Z')), '2026-11-21');
    assert.equal(dhakaDayString(new Date('2026-11-21T18:00:00.000Z')), '2026-11-22');
  });
});

describe('daily-limit TOCTOU (task C)', () => {
  it('Promise.all of two auto-publishes with limit 1 → exactly one published', async () => {
    const { db, env } = freshEnv();
    enableAutoPublish(db);
    const sibling = insertPublishedSibling(db);
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'toctou-100', body: DRAFT_BODY(sibling) });
    insertDraft(db, { id: 101, title: 'Electric Car Home Charging Costs', slug: 'toctou-101', body: DRAFT_BODY(sibling).replace('40 kilometres', '35 kilometres') });
    await makeEligible(db, 100);
    await makeEligible(db, 101);
    const results = await Promise.all([autoPublishArticle(env, 100), autoPublishArticle(env, 101)]);
    assert.equal(results.filter((r) => r.ok && r.outcome === 'published').length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => !r.ok).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND id >= 100").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM publication_logs WHERE action = 'auto-publish' AND article_id >= 100").get().n, 1, 'one success log');
    assert.equal(await countPublishedTodayDhaka(env), 1, 'the Dhaka-day count agrees with the published row');
  });

  it('a publication dated yesterday-Dhaka does not consume today’s limit', async () => {
    const { db, env } = freshEnv();
    enableAutoPublish(db);
    const sibling = insertPublishedSibling(db);
    // A published article dated 30 hours ago: yesterday on the Dhaka
    // calendar whatever the time of day the test runs.
    const yesterday = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, created_at, updated_at) VALUES (1, 'Yesterday Published Article', 'yesterday-published', 'test', 'Body from yesterday.', 'FS AI', 'published', 1, ?, ?, ?)",
    ).run(yesterday, yesterday, yesterday);
    assert.equal(await countPublishedTodayDhaka(env), 0, 'yesterday-Dhaka does not count toward today');
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'toctou-100', body: DRAFT_BODY(sibling) });
    await makeEligible(db, 100);
    const r = await autoPublishArticle(env, 100);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.outcome, 'published');
    assert.equal(await countPublishedTodayDhaka(env), 1);
  });

  it('pre-026 fallback (no reservation table): the guarded UPDATE still allows exactly one publish', async () => {
    const { db, env } = freshEnv({ withReservations: false });
    assert.equal(await reservationTableExists(env), false, 'the reservation table is absent in this fixture');
    enableAutoPublish(db);
    const sibling = insertPublishedSibling(db);
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'toctou-100', body: DRAFT_BODY(sibling) });
    insertDraft(db, { id: 101, title: 'Electric Car Home Charging Costs', slug: 'toctou-101', body: DRAFT_BODY(sibling).replace('40 kilometres', '35 kilometres') });
    await makeEligible(db, 100);
    await makeEligible(db, 101);
    const results = await Promise.all([autoPublishArticle(env, 100), autoPublishArticle(env, 101)]);
    assert.equal(results.filter((r) => r.ok && r.outcome === 'published').length, 1, JSON.stringify(results));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND id >= 100").get().n, 1);
  });
});
