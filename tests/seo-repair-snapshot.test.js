// FS AI — SEO-repair snapshot quirk + SEO body-hash staleness tie (W2, 2026-11-21).
//
//  1. SNAPSHOT QUIRK (live #30 / fc 16): the SEO repair wrote its
//     article_revisions row BEFORE its body mutations, so after it
//     appended the Related-reading line the revision stored the OLD
//     body (revision 10: 4501 chars, live body: 4615) — the revision
//     understated the live body. The snapshot is now written AFTER
//     all mutations, so the revision body length == live body length.
//  2. SEO STALENESS TIE (migration 023): seo_checks gains body_hash +
//     body_length, in the same style as fact_checks.body_hash
//     (migration 019), so an SEO PASS can no longer silently survive
//     a later body edit. runSeo / runSeoCheckOnly fall back to the
//     pre-023 column list when the migration is not yet applied live.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012 — same harness as tests/seo-checks.test.js). Link
// checks use a stubbed fetch — no network in these tests.
// Run: node --test tests/seo-repair-snapshot.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runSeo, runSeoCheckOnly } = require('../backend/agents/autonomy/seo.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');

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

const BASE_FILES = [
  'database/schema.sql',
  'database/migrations/005_autonomy.sql',
  'database/migrations/006_llm_usage.sql',
  'database/seed.sql',
  'database/migrations/008_research.sql',
  'database/migrations/009_factcheck.sql',
  'database/migrations/010_pipeline.sql',
  'database/migrations/011_backup.sql',
  'database/migrations/012_source_links.sql',
];

function freshEnv({ with023 = true } = {}) {
  const files = with023 ? [...BASE_FILES, 'database/migrations/023_seo_body_hash.sql'] : BASE_FILES;
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db), __fetchImpl: async () => new Response('', { status: 200 }) } };
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertArticle(db, { title, slug, body, divisionId = 1, status = 'draft', seoTitle = null, seoDescription = null, excerpt = 'Test excerpt for the SEO snapshot article.' }) {
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, title, slug, excerpt, body, 'FS AI', status, seoTitle, seoDescription);
  return Number(r.lastInsertRowid);
}

// Two H2 sections, adequate seo title, a SHORT seo description (so
// the repair fires), and NO internal link (so the repair appends the
// Related-reading line — the #30 shape: the append is what the old
// snapshot missed). Seed division 1 has published siblings to link.
const GOOD_TITLE = 'EV Charging at Home: A Complete Beginner\'s Guide';
const REPAIR_BODY = [
  '## How home charging works',
  '',
  'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep. Most drivers find that home charging covers daily driving with ease.',
  '',
  '## Charger types and costs',
  '',
  'A complete beginner guide should explain the two main charger types. A slow charger uses a normal wall outlet and adds range slowly. A faster wall charger needs a dedicated circuit and an electrician to install it safely.',
  '',
  '## Installation basics',
  '',
  'Ask a qualified electrician to check the home wiring before installing a wall charger. The electrician confirms the circuit can handle the load and fits a safe breaker. Home charging is simple once the charger is installed.',
].join('\n');

describe('SEO-repair snapshot quirk (live #30: revision 4501 chars, live body 4615)', () => {
  it('repair appends the link → revision body length == live body length', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-snapshot-fixture', body: REPAIR_BODY, seoTitle: GOOD_TITLE, seoDescription: 'Too short.' });
    const beforeLength = REPAIR_BODY.length;
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    assert.ok(r.repairs.some((x) => /Related reading/.test(x)), `expected the Related-reading append, got: ${r.repairs.join(' | ')}`);
    const live = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.ok(live.includes('Related reading:'), 'live body carries the appended link');
    assert.ok(live.length > beforeLength, 'live body grew by the append');
    const revisions = db.prepare('SELECT * FROM article_revisions WHERE article_id = ? ORDER BY id ASC').all(id);
    assert.equal(revisions.length, 1, 'exactly one revision row per repair');
    assert.equal(revisions[0].body.length, live.length,
      `revision body (${revisions[0].body.length}) must equal live body (${live.length}) — the old pre-mutation snapshot stored ${beforeLength}`);
    assert.equal(revisions[0].body, live, 'revision body is the final live body');
    assert.ok(revisions[0].body.includes('Related reading:'), 'revision includes the appended link');
  });

  it('a repair that changes no body text still snapshots the final body', async () => {
    const { db, env } = freshEnv();
    // Description-only repair: the body is untouched, so the snapshot
    // trivially matches — but the row must still be the final body.
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-snapshot-desc', body: REPAIR_BODY + '\n\nRelated reading: [EV Charging at Home](https://fs-ai-5w5.pages.dev/pages/article?id=1)', seoTitle: GOOD_TITLE, seoDescription: 'Too short.' });
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    const live = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    const rev = db.prepare('SELECT * FROM article_revisions WHERE article_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.equal(rev.body.length, live.length);
    assert.equal(rev.body, live);
  });
});

describe('seo_checks body_hash + body_length (migration 023)', () => {
  it('runSeo stores the hash + length of the exact body it checked', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-hash-fixture', body: REPAIR_BODY, seoTitle: GOOD_TITLE, seoDescription: 'Too short.' });
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    const live = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    const row = db.prepare('SELECT * FROM seo_checks WHERE article_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.equal(row.body_length, live.length, 'stored length matches the checked body');
    assert.equal(row.body_hash, await bodyHash(live), 'stored hash matches the checked body');
    assert.equal(r.bodyHash, row.body_hash, 'returned hash matches the stored hash');
    assert.equal(r.bodyLength, live.length, 'returned length matches the live body');
  });

  it('runSeoCheckOnly stores the hash + length and modifies nothing', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-hash-checkonly', body: REPAIR_BODY, seoTitle: GOOD_TITLE, seoDescription: 'Too short.' });
    const before = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    const r = await runSeoCheckOnly(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done');
    assert.equal(r.action, 'check');
    const row = db.prepare('SELECT * FROM seo_checks WHERE article_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.equal(row.body_length, before.body.length);
    assert.equal(row.body_hash, await bodyHash(before.body));
    assert.equal(r.bodyHash, row.body_hash);
    const after = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    assert.equal(after.body, before.body, 'check-only never modifies the body');
    assert.equal(after.seo_description, before.seo_description, 'check-only never modifies seo fields');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });

  it('without migration 023 the SEO run still works (fallback to the old column list)', async () => {
    const { db, env } = freshEnv({ with023: false });
    const id = insertArticle(db, { title: GOOD_TITLE, slug: 'seo-hash-no023', body: REPAIR_BODY, seoTitle: GOOD_TITLE, seoDescription: 'Too short.' });
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done', 'missing 023 columns must not fail the run');
    assert.equal(r.bodyHash, null, 'no hash can be recorded without the column');
    const rows = db.prepare('SELECT * FROM seo_checks WHERE article_id = ?').all(id);
    assert.equal(rows.length, 1, 'the verdict row is still stored');
    assert.equal(rows[0].verdict, r.verdict);
  });
});
