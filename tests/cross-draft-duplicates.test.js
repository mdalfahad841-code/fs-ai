// FS AI — cross-draft duplicate detection (Workstream A, task B, 2026-11-21).
//
// Normalized content fingerprints (SHA-256 of the normalised body) +
// 5-word shingle overlap and word Jaccard, across published AND draft
// articles — a duplicate draft must be refused before it is stored,
// never blocked only at the publish gate. Unrelated articles must
// never be blocked. Fingerprint decisions are stored in migration
// 024's article_fingerprints table.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012/024). The LLM is stubbed through env.AI.
// Run: node --test tests/cross-draft-duplicates.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  contentFingerprint, checkCrossDraftDuplicates, storeArticleFingerprint, wordJaccard,
} = require('../backend/agents/autonomy/seo.js');
const {
  runContentCreation, convertScaffoldToDraft,
} = require('../backend/agents/autonomy/content.js');

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

function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
    'database/migrations/024_article_fingerprints.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, { id = null, title, slug, body, divisionId = 1, status = 'draft' }) {
  const cols = ['division_id', 'title', 'slug', 'excerpt', 'body', 'author', 'status', 'fact_checked'];
  const vals = [divisionId, title, slug, 'test', body, 'FS AI', status, 0];
  if (id !== null) { cols.unshift('id'); vals.unshift(id); }
  const r = db.prepare(
    `INSERT INTO articles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...vals);
  return Number(id !== null ? id : r.lastInsertRowid);
}

function insertResearchItem(db, { title, summary, evidence, url, divisionId = 1 }) {
  const r = db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(divisionId, title, url, '2026-11-19T10:00:00Z', '2026-11-19T12:00:00Z', summary, evidence);
  return Number(r.lastInsertRowid);
}

function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

// Distinct prose about a topic the seed never covers (parrots), so the
// duplicate check has nothing to match against.
const PARROT_BODY = [
  '## Introduction', '',
  'Teaching a parrot to count is a slow, patient process built on repetition, treats and short daily sessions.',
  '',
  '## Step by step', '',
  'Start with one object and one word, reward every attempt, and add a second object only when the first is solid.',
  '',
  '## Patience', '',
  'Most parrots learn the first three numbers within a few weeks of daily practice, and some go further with months of play.',
  '',
  '## Conclusion', '',
  'Counting is a game for a parrot, not a test — keep sessions short, cheerful and full of rewards.',
].join('\n');

const PARROT_EVIDENCE = 'Parrots can learn to count small numbers through repetition and reward. Training works best in short daily sessions with treats, starting with one object and one word. Most parrots learn the first three numbers within a few weeks, and some continue to higher numbers with months of patient play. Counting should stay a game, never a test.';

describe('content fingerprints (task B)', () => {
  it('contentFingerprint is deterministic and changes with the body', async () => {
    const a = await contentFingerprint(PARROT_BODY);
    const b = await contentFingerprint(PARROT_BODY);
    const c = await contentFingerprint(PARROT_BODY + ' One more sentence here.');
    assert.equal(a, b, 'same body → same fingerprint');
    assert.notEqual(a, c, 'different body → different fingerprint');
    assert.match(a, /^[0-9a-f]{64}$/, 'SHA-256 hex');
  });

  it('wordJaccard is 1 for identical text and near 0 for unrelated text', () => {
    assert.equal(wordJaccard(PARROT_BODY, PARROT_BODY), 1);
    const seedBody = 'Electric cars are changing how we drive. A home charger adds range per hour of charging.';
    assert.ok(wordJaccard(PARROT_BODY, seedBody) < 0.2, `unrelated texts share almost no words: ${wordJaccard(PARROT_BODY, seedBody)}`);
  });
});

describe('checkCrossDraftDuplicates (task B)', () => {
  it('an identical body to a PUBLISHED article is a duplicate', async () => {
    const { db, env } = freshEnv();
    const seed1 = db.prepare('SELECT * FROM articles WHERE id = 1').get();
    const dup = await checkCrossDraftDuplicates(env, { id: 200, title: 'A Different Title', body: seed1.body });
    assert.equal(dup.isDuplicate, true, JSON.stringify(dup));
    assert.equal(dup.closest.id, 1);
    assert.equal(dup.closest.status, 'published');
    assert.ok(dup.closest.overlap >= 0.99, `overlap ${dup.closest.overlap}`);
  });

  it('an identical body to a DRAFT article is a duplicate (cross-draft, not published-only)', async () => {
    const { db, env } = freshEnv();
    insertArticle(db, { id: 100, title: 'Parrot Counting Draft', slug: 'parrot-counting-draft', body: PARROT_BODY, status: 'draft' });
    const dup = await checkCrossDraftDuplicates(env, { id: 101, title: 'Parrot Counting Again', body: PARROT_BODY });
    assert.equal(dup.isDuplicate, true, JSON.stringify(dup));
    assert.equal(dup.closest.id, 100);
    assert.equal(dup.closest.status, 'draft');
  });

  it('an unrelated article is neither duplicate nor near-duplicate', async () => {
    const { db, env } = freshEnv();
    const dup = await checkCrossDraftDuplicates(env, { id: 200, title: 'How to Teach a Parrot to Count', body: PARROT_BODY });
    assert.equal(dup.isDuplicate, false, JSON.stringify(dup));
    assert.equal(dup.isNearDuplicate, false, JSON.stringify(dup));
    assert.ok(dup.wordCount > 50);
  });

  it('a body sharing ~a third of its shingles with a published article is a near-duplicate, not a duplicate', async () => {
    const { db, env } = freshEnv();
    const seed1 = db.prepare('SELECT body FROM articles WHERE id = 1').get().body;
    // The seed body is long (~850 words), so the shared head must be
    // a SMALL slice of MY body to land in the near-duplicate band
    // (0.25–0.5 overlap): ~100 words of seed + ~200 words of new
    // prose gives roughly a third shared shingles.
    const head = seed1.slice(0, Math.floor(seed1.length * 0.12));
    const tail = ' Charging a car at work is becoming common as employers install shared wall boxes in staff car parks. Drivers book a bay in advance and pay by the hour. Workplace charging suits commuters who cannot charge at home, and it spreads the load across the day. Some employers offer it free as a staff benefit, others charge a small fee that still beats public fast charging. The car park team maintains the units and reports faults quickly. A typical office charger adds around twenty kilometres of range per hour, which covers most commutes with a working day of charging. Drivers who need a fuller battery can top up at a public rapid charger on the way home, but most find the office supply is enough for the daily round trip. Employers are adding more bays each year as electric cars become the default choice for company fleets.';
    const dup = await checkCrossDraftDuplicates(env, { id: 200, title: 'Workplace Charging for Commuters', body: head + tail });
    assert.equal(dup.isDuplicate, false, JSON.stringify(dup));
    assert.equal(dup.isNearDuplicate, true, `expected near-duplicate, got: ${JSON.stringify(dup)}`);
    assert.equal(dup.closest.id, 1);
  });

  it('the fingerprint decision is stored in article_fingerprints', async () => {
    const { db, env } = freshEnv();
    // The fingerprints table has a foreign key to articles(id), so
    // the article must exist first (a fingerprint for a phantom id
    // is refused, not stored).
    insertArticle(db, { id: 200, title: 'How to Teach a Parrot to Count', slug: 'parrot-counting-200', body: PARROT_BODY, status: 'draft' });
    const dup = await checkCrossDraftDuplicates(env, { id: 200, title: 'How to Teach a Parrot to Count', body: PARROT_BODY });
    const stored = await storeArticleFingerprint(env, 200, PARROT_BODY, dup);
    assert.equal(stored.stored, true, `the row was stored: ${JSON.stringify(stored)}`);
    assert.equal(stored.decision, 'ok');
    const row = db.prepare('SELECT * FROM article_fingerprints WHERE article_id = 200').get();
    assert.ok(row, 'fingerprint row exists');
    assert.equal(row.fingerprint, dup.fingerprint);
    assert.equal(row.decision, 'ok');
    assert.equal(row.body_length, PARROT_BODY.length);
    assert.ok(row.word_count > 50);
  });
});

describe('duplicate guard in generation + convert (task B)', () => {
  it('runContentCreation refuses a generated body that duplicates an existing draft', async () => {
    const { db, env } = freshEnv();
    insertArticle(db, { id: 100, title: 'Parrot Counting Draft', slug: 'parrot-counting-draft', body: PARROT_BODY, status: 'draft' });
    // The inserted draft counts toward today's generation cap (limit
    // 1) — raise the cap so the test exercises the duplicate guard,
    // not the cap.
    db.prepare("INSERT INTO autonomy_settings (key, value) VALUES ('max_articles_per_day', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    insertResearchItem(db, { title: 'Parrot counting', summary: PARROT_EVIDENCE, evidence: PARROT_EVIDENCE, url: 'https://example.com/parrot-counting' });
    stubAi(env, PARROT_BODY);
    const r = await runContentCreation({
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'How to Teach a Parrot to Count', division: 'education-learning', sources: ['https://example.com/parrot-counting'] },
    }, env);
    assert.equal(r.outcome, 'no-op', JSON.stringify(r));
    assert.match(r.reason, /duplicate-content/);
    assert.equal(r.duplicateArticleId, 100);
  });

  it('runContentCreation allows an unrelated generated body', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Parrot counting', summary: PARROT_EVIDENCE, evidence: PARROT_EVIDENCE, url: 'https://example.com/parrot-counting' });
    stubAi(env, PARROT_BODY);
    const r = await runContentCreation({
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'How to Teach a Parrot to Count', division: 'education-learning', sources: ['https://example.com/parrot-counting'] },
    }, env);
    assert.equal(r.outcome, 'done', JSON.stringify(r));
    assert.equal(r.draft.llmGenerated, true);
  });

  it('concurrent duplicate generation: two generations of the same body, only the first converts', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Parrot counting', summary: PARROT_EVIDENCE, evidence: PARROT_EVIDENCE, url: 'https://example.com/parrot-counting' });
    stubAi(env, PARROT_BODY);
    const taskA = {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'How to Teach a Parrot to Count', division: 'education-learning', sources: ['https://example.com/parrot-counting'] },
    };
    const taskB = {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'How to Teach a Parrot to Count to Ten', division: 'education-learning', sources: ['https://example.com/parrot-counting'] },
    };
    // Both generate before either draft exists, so both pass the
    // generation-time check — the convert step is the serialisation
    // point and must refuse the second.
    const [genA, genB] = await Promise.all([runContentCreation(taskA, env), runContentCreation(taskB, env)]);
    assert.equal(genA.outcome, 'done', JSON.stringify(genA));
    assert.equal(genB.outcome, 'done', JSON.stringify(genB));
    const first = await convertScaffoldToDraft(env, genA.scaffold);
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await convertScaffoldToDraft(env, genB.scaffold);
    assert.equal(second.ok, false, 'the second convert must be refused');
    assert.equal(second.status, 409, JSON.stringify(second));
    assert.match(second.error, /Duplicate content/);
    assert.equal(second.duplicateArticleId, first.article.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE title LIKE 'How to Teach a Parrot%'").get().n, 1, 'exactly one draft row exists');
  });
});
