// FS AI — concurrent publishing + daily-limit reservation (Workstream A, task C, 2026-11-21).
//
// The TOCTOU race: evaluateAutoPublishEligibility() checks the daily
// limit and autoPublishArticle() then flips the status — between the
// two, a concurrent job can pass the same check and publish a
// DIFFERENT article, so two articles publish on a 1-per-day limit.
// The fix is the atomic reservation in migration 026
// (daily_publication_reservations): one slot per Dhaka day, reserved
// before the flip, consumed on success, released on any failure.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012/019/021/026). Eligible drafts are built with the same
// makeEligible helper as tests/autonomous-publishing.test.js.
// Run: node --test tests/concurrent-publishing.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const {
  autoPublishArticle, reserveDailyPublicationSlot, dhakaDayString,
} = require('../backend/agents/autonomy/publishing.js');

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

const MIGRATIONS = [
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
  'database/migrations/026_daily_publication_reservations.sql',
];

function freshEnv() {
  const db = buildDb(MIGRATIONS);
  return { db, env: { DB: makeRealD1(db) } };
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function enableAutoPublish(db, { sinceHoursAgo = 1 } = {}) {
  setSetting(db, 'publishing_mode', 'auto');
  setSetting(db, 'auto_publishing', 'on');
  setSetting(db, 'auto_publish_eligible_since', new Date(Date.now() - sinceHoursAgo * 3600 * 1000).toISOString());
  setSetting(db, 'max_articles_per_day', '1');
}

const DRAFT_BODY = (siblingId) =>
  'Electric cars are changing how we drive. A home charger adds about 40 kilometres of range per hour of charging. '
  + `Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=${siblingId}`;

function insertDraft(db, { id = 100, divisionId = 1, title = 'Electric Car Charging Guide', slug = 'w3-test-draft', body = null } = {}) {
  const now = new Date().toISOString();
  const b = body !== null ? body : DRAFT_BODY(0);
  db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(id, divisionId, title, slug, 'test', b, 'FS AI', 'draft', now, now);
  return id;
}

function insertPublishedSibling(db, { divisionId = 1, title = 'Electric Car Maintenance Checklist', slug = 'w3-sibling-electric' } = {}) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at, created_at, updated_at) VALUES (?, ?, ?, 'test', 'Electric car maintenance keeps your car reliable.', 'FS AI', 'published', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
  ).run(divisionId, title, slug);
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

function publishedCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND id >= 100").get().n;
}

function logRows(db, articleId, action = null) {
  return action
    ? db.prepare('SELECT * FROM publication_logs WHERE article_id = ? AND action = ? ORDER BY id ASC').all(articleId, action)
    : db.prepare('SELECT * FROM publication_logs WHERE article_id = ? ORDER BY id ASC').all(articleId);
}

describe('daily publication reservation — atomic slot (task C)', () => {
  it('reserveDailyPublicationSlot: first reserves, second is refused, release frees it again', async () => {
    const { db, env } = freshEnv();
    // The reservation table has a foreign key to articles(id), so the
    // articles must exist first (a reservation for a phantom article
    // is refused, not created).
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'w3-test-draft-100' });
    insertDraft(db, { id: 101, title: 'Electric Car Home Charging Costs', slug: 'w3-test-draft-101' });
    const day = dhakaDayString();
    const first = await reserveDailyPublicationSlot(env, 100, 1);
    assert.equal(first.reserved, true, JSON.stringify(first));
    assert.equal(first.dhakaDay, day);
    const second = await reserveDailyPublicationSlot(env, 101, 1);
    assert.equal(second.reserved, false, 'the second article cannot reserve the same Dhaka day');
    assert.match(second.reason, /Daily publication limit reached/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_publication_reservations').get().n, 1, 'only one reservation row exists');
    const { releaseDailyPublicationSlot } = require('../backend/agents/autonomy/publishing.js');
    await releaseDailyPublicationSlot(env, 100, day);
    const retry = await reserveDailyPublicationSlot(env, 101, 1);
    assert.equal(retry.reserved, true, 'a released slot can be reserved again');
  });

  it('two concurrent auto-publishes, limit 1 → exactly one publishes, one is refused daily-limit, one reservation consumed', async () => {
    const { db, env } = freshEnv();
    enableAutoPublish(db);
    const sibling = insertPublishedSibling(db);
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'w3-test-draft-100', body: DRAFT_BODY(sibling) });
    insertDraft(db, { id: 101, title: 'Electric Car Home Charging Costs', slug: 'w3-test-draft-101', body: DRAFT_BODY(sibling).replace('40 kilometres', '35 kilometres') });
    await makeEligible(db, 100);
    await makeEligible(db, 101);
    const [a, b] = await Promise.all([autoPublishArticle(env, 100), autoPublishArticle(env, 101)]);
    const published = [a, b].filter((r) => r.ok && r.outcome === 'published');
    const refused = [a, b].filter((r) => !r.ok && r.outcome === 'refused');
    assert.equal(published.length, 1, `exactly one publishes: ${JSON.stringify([a, b])}`);
    assert.equal(refused.length, 1, `exactly one is refused: ${JSON.stringify([a, b])}`);
    assert.match(refused[0].reason, /Daily publication limit|already published|status changed|Published today/i, `refusal names the limit: ${refused[0].reason}`);
    assert.equal(publishedCount(db), 1, 'exactly one article row is published');
    const reservations = db.prepare('SELECT * FROM daily_publication_reservations').all();
    assert.equal(reservations.length, 1, 'one reservation row');
    assert.equal(reservations[0].status, 'consumed', 'the reservation is consumed by the successful publish');
    assert.equal(reservations[0].article_id, published[0].articleId, 'the reservation belongs to the published article');
    // Logs match actual outcomes: one success log, one refusal log.
    const winner = published[0].articleId;
    const loser = winner === 100 ? 101 : 100;
    assert.equal(logRows(db, winner, 'auto-publish').length, 1, 'one success log for the published article');
    assert.equal(logRows(db, loser, 'auto-publish-refused').length, 1, 'one refusal log for the refused article');
    assert.equal(logRows(db, loser, 'auto-publish').length, 0, 'no success log for the refused article');
  });

  it('a failed publication does not consume the limit: log-write failure → rolled back + reservation released → retry publishes once', async () => {
    const { db, env } = freshEnv();
    enableAutoPublish(db);
    const sibling = insertPublishedSibling(db);
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'w3-test-draft-100', body: DRAFT_BODY(sibling) });
    await makeEligible(db, 100);
    // Fault injection: the FIRST publication_logs INSERT throws (that
    // is the success log, written after the status flip). The
    // rollback must then restore the draft and release the slot.
    const realD1 = env.DB;
    let logWrites = 0;
    env.DB = {
      prepare(sql) {
        if (String(sql).includes('INSERT INTO publication_logs')) {
          logWrites += 1;
          if (logWrites === 1) {
            const failing = realD1.prepare(sql);
            return {
              bind: () => ({
                run: () => Promise.reject(new Error('simulated D1 log-write failure')),
                all: () => Promise.reject(new Error('simulated D1 log-write failure')),
                first: () => Promise.reject(new Error('simulated D1 log-write failure')),
              }),
              all: () => Promise.reject(new Error('simulated D1 log-write failure')),
              first: () => Promise.reject(new Error('simulated D1 log-write failure')),
              run: () => Promise.reject(new Error('simulated D1 log-write failure')),
            };
          }
        }
        return realD1.prepare(sql);
      },
    };
    const failed = await autoPublishArticle(env, 100);
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.rolledBack, true, 'the publish was rolled back');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = 100').get().status, 'draft', 'the article is a draft again');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_publication_reservations WHERE status = 'consumed'").get().n, 0, 'no consumed reservation');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_publication_reservations WHERE status = 'released'").get().n, 1, 'the reservation was released');
    // Retry with the fault removed: publishes exactly once.
    env.DB = realD1;
    const retried = await autoPublishArticle(env, 100);
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.outcome, 'published');
    assert.equal(publishedCount(db), 1);
    assert.equal(logRows(db, 100, 'auto-publish').length, 1, 'exactly one success log after the retry');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_publication_reservations WHERE status = 'consumed'").get().n, 1, 'the reservation is consumed after the retry');
  });

  it('idempotency: a second call on the same article is refused and still leaves one published row', async () => {
    const { db, env } = freshEnv();
    enableAutoPublish(db);
    const sibling = insertPublishedSibling(db);
    insertDraft(db, { id: 100, title: 'Electric Car Charging Guide', slug: 'w3-test-draft-100', body: DRAFT_BODY(sibling) });
    await makeEligible(db, 100);
    const first = await autoPublishArticle(env, 100);
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await autoPublishArticle(env, 100);
    assert.equal(second.ok, false);
    assert.equal(second.outcome, 'refused');
    assert.match(second.reason, /already published/i);
    assert.equal(publishedCount(db), 1, 'still exactly one published row');
    assert.equal(logRows(db, 100, 'auto-publish').length, 1, 'still exactly one success log');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_publication_reservations WHERE status = 'consumed'").get().n, 1, 'still one consumed reservation');
  });
});
