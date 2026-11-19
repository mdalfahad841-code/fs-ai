// FS AI — claim-level fact-checking + correction tests.
//
// The checker extracts claims from article bodies, matches them against
// fetched source material (research_items / article_sources) with a
// deterministic keyword + whole-number rule, and only lets an LLM judge
// borderline matches when the evidence text is supplied and cited.
// Correction rewrites from evidence or removes the unsupported sentence.
// No claim is VERIFIED without real supporting evidence.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011).
// The LLM is stubbed through env.AI (the Workers AI binding shape) —
// generateText never touches the network here.
// Run: node --test tests/factcheck-claims.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  extractClaims, findEvidence, judgeClaimDeterministic,
  checkArticle, runCorrection, runFactChecking,
} = require('../backend/agents/autonomy/factcheck.js');

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
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, body, divisionId = 1) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Fact Check Test Article', 'fact-check-test-article', 'test', ?, 'FS AI', 'draft', 0)",
  ).run(divisionId, body);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertResearchItem(db, { title, summary, evidence, url = 'https://example.com/source-1', divisionId = 1, publishedAt = '2026-11-19T10:00:00Z' }) {
  db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(divisionId, title, url, publishedAt, '2026-11-19T12:00:00Z', summary, evidence);
}

function addArticleSource(db, articleId, url, title = 'Test source') {
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, ?, ?, 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId, title, url);
}

/** Stub the Workers AI binding: every model call returns the same text. */
function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

const PASS_BODY = [
  'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.',
  'A home charger typically adds about 40 kilometres of range per hour of charging.',
  'Charging at home costs less than public fast charging, according to recent industry reports.',
  'Electric vehicles are the fastest growing part of the car market, with battery costs falling steadily.',
  'The battery pack is the most expensive part of an electric vehicle, and battery prices keep falling as production grows.',
  'This guide explains the basics. Read on for details.',
].join('\n\n');

function seedPassEvidence(db) {
  insertResearchItem(db, { title: 'EV Sales 2023', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.' });
  insertResearchItem(db, { title: 'Home charging range', summary: 'A home charger adds about 40 kilometres of range per hour.', evidence: 'A home charger typically adds about 40 kilometres of range per hour of charging.' });
  insertResearchItem(db, { title: 'Home charging cost', summary: 'Charging at home costs less than public fast charging.', evidence: 'Charging at home costs less than public fast charging, according to recent industry reports.' });
  insertResearchItem(db, { title: 'EV market growth', summary: 'Electric vehicles are the fastest growing part of the car market.', evidence: 'Electric vehicles are the fastest growing part of the car market, with battery costs falling steadily.' });
  insertResearchItem(db, { title: 'Battery cost', summary: 'The battery pack is the most expensive part of an electric vehicle.', evidence: 'The battery pack is the most expensive part of an electric vehicle, and battery prices keep falling as production grows.' });
}

describe('extractClaims', () => {
  it('extracts numbered/assertive sentences, strips headings and the AI-DRAFT marker', () => {
    const body = 'AI-DRAFT — needs fact-check + owner approval.\n\n## Introduction\n\nEV sales reached 14 million units worldwide in 2023.\n\nCharging is convenient.\n\nA home charger adds about 40 kilometres of range per hour of charging.\n\nOk.';
    const claims = extractClaims(body);
    assert.equal(claims.length, 2);
    assert.match(claims[0], /14 million/);
    assert.match(claims[1], /40 kilometres/);
    assert.ok(claims.every((c) => !c.includes('AI-DRAFT')));
  });

  it('caps at 20 claims', () => {
    const body = Array.from({ length: 30 }, (_, i) => `Fact number ${i + 1} is recorded in the official report.`).join(' ');
    assert.equal(extractClaims(body).length, 20);
  });

  it('returns [] for bodies with no claims', () => {
    assert.deepEqual(extractClaims('Hello world.'), []);
    assert.deepEqual(extractClaims(''), []);
  });
});

describe('findEvidence + judgeClaimDeterministic', () => {
  const pool = [
    {
      url: 'https://example.com/source-1',
      title: 'EV Sales 2023',
      text: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.',
      isOutdated: false,
    },
  ];

  it('VERIFIES a claim with matching keywords and whole numbers', () => {
    const evidence = findEvidence('EV sales reached 14 million units worldwide in 2023.', pool);
    assert.ok(evidence, 'evidence found');
    assert.equal(evidence.score, 1);
    assert.equal(evidence.numbersMatch, true);
    const r = judgeClaimDeterministic('EV sales reached 14 million units worldwide in 2023.', evidence, false);
    assert.equal(r.verdict, 'VERIFIED');
  });

  it('flags CONFLICTING when the claim states a different number — "20" must not match "2023"', () => {
    const evidence = findEvidence('EV sales reached 20 million units worldwide in 2023.', pool);
    assert.ok(evidence, 'evidence found by keywords');
    assert.equal(evidence.numbersMatch, false, '20 is not 2023 — whole-number matching');
    assert.equal(evidence.conflicting, true);
    const r = judgeClaimDeterministic('EV sales reached 20 million units worldwide in 2023.', evidence, false);
    assert.equal(r.verdict, 'CONFLICTING');
  });

  it('UNVERIFIABLE when the pool is empty — never a free VERIFIED', () => {
    const r = judgeClaimDeterministic('EV sales reached 14 million units worldwide in 2023.', null, true);
    assert.equal(r.verdict, 'UNVERIFIABLE');
  });

  it('UNSUPPORTED when the pool has material but nothing matches', () => {
    const evidence = findEvidence('The moon is made of green cheese, scientists confirmed.', pool);
    assert.equal(evidence, null);
    const r = judgeClaimDeterministic('The moon is made of green cheese, scientists confirmed.', evidence, false);
    assert.equal(r.verdict, 'UNSUPPORTED');
  });

  it('OUTDATED when the only evidence is stale and the claim is time-sensitive', () => {
    const stale = [{ ...pool[0], isOutdated: true }];
    const claim = 'EV sales reached 14 million units worldwide in 2023, and sales are currently rising.';
    const evidence = findEvidence(claim, stale);
    assert.ok(evidence);
    const r = judgeClaimDeterministic(claim, evidence, false);
    assert.equal(r.verdict, 'OUTDATED');
  });
});

describe('checkArticle (real DB)', () => {
  it('passes an article whose claims are all supported by research evidence', async () => {
    const { db, env } = freshEnv();
    seedPassEvidence(db);
    const articleId = insertArticle(db, PASS_BODY);
    addArticleSource(db, articleId, 'https://example.com/source-1');
    const r = await checkArticle(env, loadArticle(db, articleId));
    assert.equal(r.verdict, 'pass');
    assert.equal(r.claimsTotal, 5);
    assert.equal(r.claimsVerified, 5);
    assert.equal(r.claimsFailed, 0);
    assert.deepEqual(r.flags, []);
    const claims = db.prepare('SELECT * FROM claim_checks WHERE fact_check_id = ? ORDER BY id').all(r.factCheckId);
    assert.equal(claims.length, 5);
    assert.ok(claims.every((c) => c.verdict === 'VERIFIED' && c.evidence_url));
    const fc = db.prepare('SELECT * FROM fact_checks WHERE id = ?').get(r.factCheckId);
    assert.equal(fc.article_id, articleId);
    assert.equal(fc.verdict, 'pass');
    // The checker never sets articles.fact_checked — only the publish gate does.
    assert.equal(db.prepare('SELECT fact_checked FROM articles WHERE id = ?').get(articleId).fact_checked, 0);
  });

  it('fails a scaffold article', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'SCAFFOLD — full draft needed.\n\nThis article needs expansion with verified facts and real sources.');
    const r = await checkArticle(env, loadArticle(db, id));
    assert.equal(r.verdict, 'failed');
  });

  it('needs-review for an article with an unsupported statistic — never VERIFIED without evidence', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'EV sales reached 99 million units worldwide in 2023, according to made-up data.');
    const r = await checkArticle(env, loadArticle(db, id));
    assert.equal(r.verdict, 'needs-review');
    assert.ok(r.claimsFailed >= 1);
    const claims = db.prepare('SELECT * FROM claim_checks WHERE fact_check_id = ?').all(r.factCheckId);
    assert.ok(claims.length > 0);
    assert.ok(claims.every((c) => c.verdict !== 'VERIFIED'), 'no claim verified without evidence');
  });

  it('runFactChecking returns a clean failure for a missing article', async () => {
    const { env } = freshEnv();
    const r = await runFactChecking({ kind: 'fact-check', payload: { article_id: 99999 } }, env);
    assert.equal(r.outcome, 'failed');
    assert.match(r.error, /not found/);
  });

  it('borderline match: deterministic verdict stands when no LLM is available', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Home charging', summary: 'Home charging adds range per hour.', evidence: 'A home charger typically adds about 40 kilometres of range per hour of charging.' });
    const id = insertArticle(db, 'Home charging adds range and the charger costs less than public fast charging, saving money every month.');
    const r = await checkArticle(env, loadArticle(db, id));
    assert.equal(r.claimsTotal, 1);
    assert.equal(r.claims[0].verdict, 'UNSUPPORTED', 'score 0.38 < 0.5 and no provider — deterministic verdict stands');
  });

  it('borderline match: an LLM judge with supplied evidence can upgrade to VERIFIED', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Home charging', summary: 'Home charging adds range per hour.', evidence: 'A home charger typically adds about 40 kilometres of range per hour of charging.' });
    const id = insertArticle(db, 'Home charging adds range and the charger costs less than public fast charging, saving money every month.');
    stubAi(env, 'SUPPORTED\nThe evidence states the same charging rate.');
    const r = await checkArticle(env, loadArticle(db, id));
    assert.equal(r.claimsTotal, 1);
    assert.equal(r.claims[0].verdict, 'VERIFIED');
    assert.match(r.claims[0].explanation, /LLM entailment judge/);
    const usage = db.prepare("SELECT COUNT(*) AS n FROM llm_usage WHERE purpose = 'fact-check-judge'").get().n;
    assert.ok(usage >= 1, 'the judge call is recorded in llm_usage');
  });
});

describe('runCorrection (real DB)', () => {
  it('rewrites a wrong number from evidence, stores original vs corrected, re-check verifies the claims', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'EV Sales 2023', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.' });
    const id = insertArticle(db, 'EV sales reached 20 million units worldwide in 2023, according to industry reports.');
    const first = await checkArticle(env, loadArticle(db, id));
    assert.notEqual(first.verdict, 'pass');
    assert.equal(first.claims[0].verdict, 'CONFLICTING');

    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const fixed = await runCorrection(env, loadArticle(db, id));
    assert.equal(fixed.outcome, 'done');
    assert.equal(fixed.results.length, 1);
    assert.equal(fixed.results[0].action, 'corrected');
    assert.match(fixed.results[0].correctedText, /14 million/);
    assert.equal(fixed.results[0].recheckVerdict, 'VERIFIED');
    assert.equal(fixed.corrected, 1);
    const row = db.prepare('SELECT * FROM article_corrections WHERE article_id = ?').get(id);
    assert.equal(row.status, 'applied');
    assert.equal(row.attempt, 1);
    assert.match(row.original_text, /20 million/);
    assert.match(row.corrected_text, /14 million/);
    assert.equal(row.recheck_verdict, 'VERIFIED');
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM article_revisions').get().n >= 1, 'pre-edit body preserved as a revision');
    const after = await checkArticle(env, loadArticle(db, id));
    assert.equal(after.claimsVerified, after.claimsTotal, 're-check verifies every claim');
    assert.match(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, /14 million/);
  });

  it('removes an unsupported sentence when no evidence and no valid rewrite exist', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'EV Sales 2023', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.' });
    const id = insertArticle(db, 'EV sales reached 14 million units worldwide in 2023.\n\nEvery car on Earth will be electric by next Tuesday, scientists confirmed.');
    await checkArticle(env, loadArticle(db, id));
    stubAi(env, 'I cannot verify this claim.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done');
    const removed = r.results.find((x) => x.action === 'removed');
    assert.ok(removed, 'unsupported sentence removed, not replaced with a fabricated fact');
    assert.equal(r.removed, 1);
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.ok(!body.includes('next Tuesday'));
    assert.match(body, /14 million/, 'supported content preserved');
  });

  it('refuses a rewrite that invents a number the evidence does not contain', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'EV Sales 2023', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.' });
    const id = insertArticle(db, 'EV sales reached 20 million units worldwide in 2023, according to industry reports.');
    await checkArticle(env, loadArticle(db, id));
    // The "LLM" offers a rewrite with a NEW invented number (77 million) —
    // it must be rejected even though the year 2023 matches.
    stubAi(env, 'EV sales reached 77 million units worldwide in 2023.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.corrected, 0, 'invented-number rewrite must not be applied');
    assert.ok(!db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body.includes('77 million'));
  });

  it('corrects an UNVERIFIABLE claim (no evidence at all) by removing it', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Every car on Earth will be electric by next Tuesday, scientists confirmed.');
    await checkArticle(env, loadArticle(db, id));
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done');
    assert.equal(r.removed, 1, 'unverifiable claim removed, not left in the article');
    assert.ok(!db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body.includes('next Tuesday'));
  });

  it('is a no-op when the latest fact-check already passes', async () => {
    const { db, env } = freshEnv();
    seedPassEvidence(db);
    const id = insertArticle(db, PASS_BODY);
    addArticleSource(db, id, 'https://example.com/source-1');
    await checkArticle(env, loadArticle(db, id));
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'no-op');
  });
});
