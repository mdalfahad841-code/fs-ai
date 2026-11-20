// FS AI — fact-check correction quality (Fix 2) + citation-aware claim
// extraction (Fix 3) tests.
//
// Fix 2 (2026-11-20): article #28's correction saved garbled spliced
// fragments ("a potential key to smaller The deal—worth more than a
// billion dollars—aims to supply silicon-carbon anode material...").
// A rewrite must now be one whole evidence-backed sentence, removal
// must preserve context, and validateCorrectedBody rejects any corrected
// body with fragments, splices, repeats, incomplete paragraphs or
// evidence-ungrounded new sentences — on rejection nothing is saved.
//
// Fix 3 (2026-11-20): extractClaims excluded nothing, so the citation
// line "(https://…/sila-panasonic-battery-deal/) - **MIT Technology
// Review** – "What a..." became a permanently CONFLICTING claim on #28.
// Citation/source lines and bibliography sections are now excluded,
// while factual claims that carry a trailing citation URL are still
// extracted (citation stripped, claim kept).
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/010/011/012).
// The LLM is stubbed through env.AI (the Workers AI binding shape) —
// generateText never touches the network here. Throwaway articles only;
// never #26/#27 ids (their recorded values appear in comments only).
// Run: node --test tests/factcheck-correction-quality.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  extractClaims, validateCorrectedBody,
  checkArticle, runCorrection, MAX_CORRECTION_ATTEMPTS,
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
    'database/migrations/012_source_links.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, body, divisionId = 1) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Correction Quality Test Article', 'correction-quality-test-article', 'test', ?, 'FS AI', 'draft', 0)",
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

// The #28 evidence pool: one Sila/Panasonic battery-deal source plus the
// EV-sales source used by the correction tests below.
const SILA_POOL = [{
  url: 'https://www.technologyreview.com/2026/11/19/1148922/sila-panasonic-battery-deal/',
  title: 'Sila Panasonic battery deal',
  text: 'Sila Nanotechnologies and Panasonic have signed a billion-dollar agreement to commercialize next-generation silicon anode battery technology in the United States. The deal combines Sila\'s Titan Silicon anode technology with Panasonic\'s battery cell expertise and high-volume manufacturing capabilities. The deal aims to supply silicon-carbon anode material for electric vehicle batteries.',
  isOutdated: false,
}];
const EV_POOL = [{
  url: 'https://example.com/source-1',
  title: 'EV Sales 2023',
  text: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency. A home charger typically adds about 40 kilometres of range per hour of charging.',
  isOutdated: false,
}];

const SILA_SENTENCE_1 = 'Sila Nanotechnologies and Panasonic have signed a billion-dollar agreement to commercialize next-generation silicon anode battery technology in the United States.';
const SILA_SENTENCE_2 = 'The deal combines Sila\'s Titan Silicon anode technology with Panasonic\'s battery cell expertise and high-volume manufacturing capabilities.';
const GOOD_SILA_BODY = `${SILA_SENTENCE_1} ${SILA_SENTENCE_2}`;
// The exact garbled splice from the Phase 1 report (§6/§15, article #28).
const GARBLED_SENTENCE = 'a potential key to smaller The deal—worth more than a billion dollars—aims to supply silicon-carbon anode material for electric vehicles.';

function seedEvEvidence(db) {
  insertResearchItem(db, { title: 'EV Sales 2023', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.' });
  insertResearchItem(db, { title: 'Home charging range', summary: 'A home charger adds about 40 kilometres of range per hour.', evidence: 'A home charger typically adds about 40 kilometres of range per hour of charging.' });
}

describe('validateCorrectedBody — the #28 splice and friends', () => {
  it('rejects the exact #28 garbled splice (lowercase fragment + mid-sentence sentence-start)', () => {
    const corrected = `${GOOD_SILA_BODY} ${GARBLED_SENTENCE}`;
    const v = validateCorrectedBody(GOOD_SILA_BODY, corrected, SILA_POOL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /spliced sentence/.test(r)), `expected a splice reason, got: ${v.reasons.join(' | ')}`);
    assert.ok(v.reasons.some((r) => /fragment/.test(r)), `expected a fragment reason, got: ${v.reasons.join(' | ')}`);
  });

  it('rejects the garble when it REPLACES a sentence, not just when appended', () => {
    const corrected = `${GARBLED_SENTENCE} ${SILA_SENTENCE_2}`;
    const v = validateCorrectedBody(GOOD_SILA_BODY, corrected, SILA_POOL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /spliced sentence|fragment/.test(r)));
  });

  it('rejects repeated sentences and near-duplicate sentences', () => {
    const repeated = `${GOOD_SILA_BODY} ${SILA_SENTENCE_1}`;
    const v1 = validateCorrectedBody(GOOD_SILA_BODY, repeated, SILA_POOL);
    assert.equal(v1.ok, false);
    assert.ok(v1.reasons.some((r) => /repeated sentence/.test(r)), `got: ${v1.reasons.join(' | ')}`);

    const nearDup = `${SILA_SENTENCE_1} ${SILA_SENTENCE_1.replace('United States', 'United Kingdom')} ${SILA_SENTENCE_2}`;
    const v2 = validateCorrectedBody(GOOD_SILA_BODY, nearDup, SILA_POOL);
    assert.equal(v2.ok, false);
    assert.ok(v2.reasons.some((r) => /near-duplicate/.test(r)), `got: ${v2.reasons.join(' | ')}`);
  });

  it('rejects an incomplete paragraph (no closing sentence punctuation)', () => {
    const corrected = `${GOOD_SILA_BODY}\n\nThe deal aims to supply silicon-carbon anode material for electric vehicles`;
    const v = validateCorrectedBody(GOOD_SILA_BODY, corrected, SILA_POOL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /incomplete paragraph/.test(r)), `got: ${v.reasons.join(' | ')}`);
  });

  it('rejects a new sentence with a number not in the evidence', () => {
    const corrected = `${SILA_SENTENCE_2} EV sales reached 77 million units worldwide in 2023, according to the International Energy Agency.`;
    const v = validateCorrectedBody(SILA_SENTENCE_2, corrected, EV_POOL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /unsupported number 77/.test(r)), `got: ${v.reasons.join(' | ')}`);
  });

  it('rejects unrelated content and invented named entities in a new sentence', () => {
    const unrelated = `${SILA_SENTENCE_2} Motorcycle riders prefer lightweight bikes with loud exhausts on mountain highways.`;
    const v1 = validateCorrectedBody(SILA_SENTENCE_2, unrelated, EV_POOL);
    assert.equal(v1.ok, false);
    assert.ok(v1.reasons.some((r) => /unrelated content/.test(r)), `got: ${v1.reasons.join(' | ')}`);

    const inventedEntity = `${SILA_SENTENCE_2} Tesla announced a new factory in Texas to build electric vehicles.`;
    const v2 = validateCorrectedBody(SILA_SENTENCE_2, inventedEntity, EV_POOL);
    assert.equal(v2.ok, false);
    assert.ok(v2.reasons.some((r) => /unsupported named entit/.test(r) && /Texas/.test(r)), `got: ${v2.reasons.join(' | ')}`);
  });

  it('accepts an evidence-backed corrected body and preserves supported sentences', () => {
    const original = 'EV sales reached 20 million units worldwide in 2023, according to industry reports. A home charger typically adds about 40 kilometres of range per hour of charging.';
    const corrected = 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency. A home charger typically adds about 40 kilometres of range per hour of charging.';
    const v = validateCorrectedBody(original, corrected, EV_POOL);
    assert.equal(v.ok, true, `expected acceptance, got: ${v.reasons.join(' | ')}`);
    assert.deepEqual(v.reasons, []);
  });

  it('does not punish a pre-existing repeated sentence the correction did not introduce', () => {
    const original = `${SILA_SENTENCE_1} ${SILA_SENTENCE_1} EV sales reached 20 million units worldwide in 2023, according to industry reports.`;
    const corrected = `${SILA_SENTENCE_1} ${SILA_SENTENCE_1} EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.`;
    const v = validateCorrectedBody(original, corrected, [...SILA_POOL, ...EV_POOL]);
    assert.equal(v.ok, true, `pre-existing repeat must be exempt, got: ${v.reasons.join(' | ')}`);
  });
});

describe('runCorrection — no-splice guarantee', () => {
  it('never applies a garbled LLM rewrite: the splice is rejected and the claim is removed instead', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    const id = insertArticle(db, 'EV sales reached 20 million units worldwide in 2023, according to industry reports.\n\nA home charger typically adds about 40 kilometres of range per hour of charging.');
    addArticleSource(db, id, 'https://example.com/source-1');
    await checkArticle(env, loadArticle(db, id));
    // The "LLM" returns the exact #28 garble shape as its rewrite.
    stubAi(env, GARBLED_SENTENCE);
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done');
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.ok(!body.includes('a potential key to smaller'), 'garbled fragment must never reach the body');
    assert.ok(!body.includes('The deal—worth more than a billion dollars'), 'garbled fragment must never reach the body');
    assert.ok(!body.includes('20 million'), 'unsupported claim is removed, not spliced');
    assert.match(body, /40 kilometres/, 'supported sentence preserved');
    assert.equal(r.results.find((x) => /20 million/.test(x.claim)).action, 'removed');
    const applied = db.prepare("SELECT * FROM article_corrections WHERE article_id = ? AND status = 'applied'").all(id);
    assert.equal(applied.length, 0, 'no applied row may carry the garble');
  });

  it('evidence-backed replacement: corrected body sentences are whole sentences from the original or the rewrite', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    const originalBody = 'EV sales reached 20 million units worldwide in 2023, according to industry reports.\n\nA home charger typically adds about 40 kilometres of range per hour of charging.';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    await checkArticle(env, loadArticle(db, id));
    const rewrite = 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.';
    stubAi(env, rewrite);
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done');
    assert.equal(r.results[0].action, 'corrected');
    assert.equal(r.results[0].correctedText, rewrite);
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.match(body, /14 million/);
    assert.ok(body.includes('A home charger typically adds about 40 kilometres of range per hour of charging.'), 'supported sentence preserved byte-identical');
    // No-splice guarantee: every sentence of the final body is either a
    // sentence of the original body or exactly the evidence-backed rewrite.
    const originalSentences = originalBody.split(/(?<=[.!?])\s+/).map((s) => s.trim());
    const finalSentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const s of finalSentences) {
      assert.ok(originalSentences.includes(s) || s === rewrite, `sentence is a splice or foreign text: "${s}"`);
      assert.ok(!/[a-z]{2,}\s+(The|This|That|These|Those|It|They|We|He|She)\s+[a-z]/.test(s), `splice marker in: "${s}"`);
    }
    const row = db.prepare("SELECT * FROM article_corrections WHERE article_id = ? AND status = 'applied'").get(id);
    assert.ok(row, 'applied correction recorded');
    assert.equal(row.evidence_url, 'https://example.com/source-1', 'evidence provenance kept');
  });

  it('whole-body validation rejects a corrected body with a repeated sentence — nothing is saved', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    const originalBody = 'EV sales reached 20 million units worldwide in 2023, according to industry reports.\n\nGlobal EV sales hit 20 million units in 2023, market analysts reported.';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    await checkArticle(env, loadArticle(db, id));
    // The stub returns the SAME valid rewrite for both claims: each
    // candidate is individually fine, but the corrected body repeats it.
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.validationRejected, true, 'validation must reject the repeated-sentence body');
    assert.ok(r.validationReasons.some((x) => /repeated sentence/.test(x)), `got: ${r.validationReasons.join(' | ')}`);
    assert.equal(r.corrected, 0, 'nothing counts as corrected when nothing was saved');
    assert.equal(r.removed, 0, 'nothing counts as removed when nothing was saved');
    assert.equal(r.recheckVerdict, 'needs-review', 'article left for human review, not verified');
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.equal(body, originalBody, 'pre-edit body preserved exactly');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions').get().n, 0, 'no revision row for a rejected body');
    const rows = db.prepare('SELECT * FROM article_corrections WHERE article_id = ?').all(id);
    assert.equal(rows.length, 2, 'both attempted corrections recorded');
    assert.ok(rows.every((x) => x.status === 'failed'), 'attempted corrections recorded as failed, never applied');
    assert.ok(rows.every((x) => /VALIDATION REJECTED/.test(x.corrected_text || '')), 'failure reason recorded on the correction rows');
    assert.equal(db.prepare('SELECT fact_checked FROM articles WHERE id = ?').get(id).fact_checked, 0, 'fact_checked never set');
    assert.ok(r.results.every((x) => x.action === 'failed'), 'results report the rejection, not the attempted actions');
  });

  it('removal preserves context: a sentence a neighbour refers back to is left for human review', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, { title: 'Auto industry change', summary: 'This change will transform the whole auto industry completely.', evidence: 'This change will transform the whole auto industry completely.' });
    const originalBody = 'Every car on Earth will be electric by next Tuesday, scientists confirmed. This change will transform the whole auto industry completely.';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.claimsFailed, 1, 'only the first claim fails; the "This change …" claim is verified');
    stubAi(env, 'I cannot verify this claim.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.removed, 0, 'nothing removed when removal would dangle a reference');
    assert.equal(r.results[0].action, 'skipped');
    assert.match(r.results[0].reason || '', /dangling reference|human review/);
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.equal(body, originalBody, 'body untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_corrections WHERE article_id = ?').get(id).n, 0, 'a context-skipped claim leaves no correction row');
  });

  it('max correction attempts stays 3 — enforced, not changed', async () => {
    assert.equal(MAX_CORRECTION_ATTEMPTS, 3);
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    const id = insertArticle(db, 'EV sales reached 20 million units worldwide in 2023, according to industry reports.');
    addArticleSource(db, id, 'https://example.com/source-1');
    const first = await checkArticle(env, loadArticle(db, id));
    const claimCheckId = db.prepare('SELECT id FROM claim_checks WHERE fact_check_id = ?').get(first.factCheckId).id;
    for (let attempt = 1; attempt <= 3; attempt++) {
      db.prepare(
        "INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status) VALUES (?, ?, 'EV sales reached 20 million units worldwide in 2023, according to industry reports.', NULL, ?, 'failed')",
      ).run(id, claimCheckId, attempt);
    }
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.results[0].action, 'skipped');
    assert.match(r.results[0].reason || '', /max 3/);
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body.includes('20 million'), true, 'body untouched after max attempts');
  });

  it('a claim with a stripped trailing citation URL is still found and corrected in the body', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    const id = insertArticle(db, 'EV sales reached 20 million units worldwide in 2023 - https://example.com/report.\n\nA home charger typically adds about 40 kilometres of range per hour of charging.');
    addArticleSource(db, id, 'https://example.com/source-1');
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.claimsTotal, 2);
    assert.ok(!first.claims[0].claim.includes('example.com'), 'citation URL stripped from the extracted claim');
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.results[0].action, 'corrected', 'citation-tolerant matching must find the claim in the body');
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.match(body, /14 million/);
    assert.ok(!body.includes('20 million'));
  });
});

describe('extractClaims — citation-aware (Fix 3)', () => {
  it('excludes the exact #28 citation fragment but keeps the real claims', () => {
    // Report §15: the claim was "(https://…/sila-panasonic-battery-deal/)
    // - **MIT Technology Review** – "What a..." — a citation line that
    // could never verify.
    const body = `${SILA_SENTENCE_1}\n\n${SILA_SENTENCE_2}\n\n(https://www.technologyreview.com/2026/11/19/1148922/sila-panasonic-battery-deal/) - **MIT Technology Review** – "What a...`;
    const claims = extractClaims(body);
    assert.equal(claims.length, 2);
    assert.ok(claims.every((c) => !c.includes('technologyreview.com')));
    assert.ok(claims.every((c) => !c.includes('MIT Technology Review')));
    assert.ok(claims[0].includes('billion-dollar'));
  });

  it('excludes a markdown Sources: bibliography section', () => {
    const body = `${SILA_SENTENCE_1}\n\nSources:\n- https://www.technologyreview.com/2026/11/19/1148922/sila-panasonic-battery-deal/\n- MIT Technology Review — https://example.com/review\n- None supplied — add sources before approval.`;
    const claims = extractClaims(body);
    assert.deepEqual(claims, [SILA_SENTENCE_1]);
  });

  it('excludes plain-text source refs and URL-only lines', () => {
    const body = `${SILA_SENTENCE_1}\n\n- **MIT Technology Review** – "What a battery deal means for EVs."\n\nhttps://www.technologyreview.com/2026/11/19/1148922/sila-panasonic-battery-deal/\n\n${SILA_SENTENCE_2}`;
    const claims = extractClaims(body);
    assert.equal(claims.length, 2);
    assert.ok(claims.every((c) => !c.includes('MIT Technology Review')));
    assert.ok(claims.every((c) => !c.includes('technologyreview.com')));
  });

  it('excludes numbered reference lists', () => {
    const body = `${SILA_SENTENCE_1}\n\n1. https://example.com/a\n2. **MIT Technology Review** – https://example.com/b\n3. Sila Nanotechnologies press release, November 2026.`;
    const claims = extractClaims(body);
    assert.deepEqual(claims, [SILA_SENTENCE_1]);
  });

  it('keeps a claim followed by a trailing citation URL (citation stripped, claim kept)', () => {
    const body = 'Sila Nanotechnologies and Panasonic have signed a billion-dollar agreement to commercialize silicon anode battery technology (https://www.technologyreview.com/2026/11/19/1148922/sila-panasonic-battery-deal/).';
    const claims = extractClaims(body);
    assert.equal(claims.length, 1);
    assert.ok(!claims[0].includes('technologyreview.com'), 'citation URL stripped');
    assert.ok(claims[0].includes('billion-dollar'), 'factual claim kept');
    assert.ok(claims[0].endsWith('.'), 'sentence still ends with terminal punctuation');
  });

  it('keeps a claim with a trailing dash citation', () => {
    const body = 'EV sales reached 14 million units worldwide in 2023 - https://example.com/report.';
    const claims = extractClaims(body);
    assert.equal(claims.length, 1);
    assert.ok(!claims[0].includes('example.com'));
    assert.ok(claims[0].includes('14 million'));
  });

  it('excludes Related reading sections (appended by the SEO repair)', () => {
    const body = `${SILA_SENTENCE_1}\n\nRelated reading: [7 Free AI Tools That Actually Save Time](https://fs-ai-5w5.pages.dev/pages/article.html?id=14)`;
    const claims = extractClaims(body);
    assert.deepEqual(claims, [SILA_SENTENCE_1]);
  });

  it('mixed factual + citation paragraph: facts extracted, citation line not', () => {
    const body = `${SILA_SENTENCE_1} (https://www.technologyreview.com/2026/11/19/1148922/sila-panasonic-battery-deal/) - **MIT Technology Review** – "What a battery deal means."\n\n${SILA_SENTENCE_2}`;
    const claims = extractClaims(body);
    assert.equal(claims.length, 2);
    assert.ok(claims[0].includes('billion-dollar'));
    assert.ok(claims[1].includes('Titan Silicon'));
    assert.ok(claims.every((c) => !c.includes('technologyreview.com')));
  });

  it('a claim containing a URL but stating a fact is still extracted', () => {
    const body = 'The deal was announced on the company website at https://example.com/news and involves silicon-carbon anode material for electric vehicle batteries.';
    const claims = extractClaims(body);
    assert.equal(claims.length, 1);
    assert.ok(claims[0].includes('silicon-carbon anode material'));
  });

  it('a heading after a Sources: section re-enables extraction', () => {
    const body = `${SILA_SENTENCE_1}\n\nSources:\n- https://example.com/report\n\n## Afterword\n\nA home charger typically adds about 40 kilometres of range per hour of charging.`;
    const claims = extractClaims(body);
    assert.equal(claims.length, 2);
    assert.ok(claims[1].includes('40 kilometres'));
  });

  it('keeps a real claim in a list (bold lead + assertion verb is not a source ref)', () => {
    const body = '- **Fast charging** is available at most public stations and costs more than charging at home every night.\n\n- **MIT Technology Review** – https://example.com/review';
    const claims = extractClaims(body);
    assert.equal(claims.length, 1);
    assert.ok(claims[0].includes('Fast charging'));
  });
});
