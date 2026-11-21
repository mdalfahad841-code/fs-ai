// FS AI — fact-check correction validation defects (W2, 2026-11-21).
//
// Live #30 root causes, fixed in backend/agents/autonomy/factcheck.js:
//  1. paragraphIssues judged a paragraph by its trailing citation link
//     instead of its sentence text: every content paragraph ends with
//     "\u00a0[The Guardian](url)", so "...guide) [The Guardian](url)"
//     failed the terminal-punctuation test even though the sentence
//     itself ends "...guide.)".
//  2. validateCorrectedBody keyed paragraph issues by the paragraph's
//     FIRST 120 CHARS, so any correction rewriting a sentence inside
//     such a paragraph changed the key and the pre-existing defect was
//     counted as NEW — runs 115/116 failed deterministically and a
//     third Correct click would repeat them. Paragraph issues are now
//     keyed by paragraph INDEX (stable across in-place rewrites).
//  3. runCorrection returned outcome 'done' with corrected:0 when
//     validation rejected everything — runTask marked the task done
//     and the status lied. It now returns outcome 'failed' with a
//     recovery report (BLOCKED_WITH_REASON, retryable:false).
//  4. A truncated correction output (live #30: "...travel guide can",
//     "Three days are broke") must never be saved as if complete:
//     detectTruncatedBody catches a mid-sentence / mid-word cut-off
//     before validation, as a failed (retryable) run.
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012 — same harness as tests/factcheck-correction-quality.
// test.js). The LLM is stubbed through env.AI. Throwaway articles
// only; never #26/#27/#31 ids.
// Run: node --test tests/factcheck-correction-validation.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  extractClaims, validateCorrectedBody, stripTrailingCitation,
  detectTruncatedBody, checkArticle, runCorrection, runFactChecking,
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
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Correction Validation Test Article', 'correction-validation-test-article', 'test', ?, 'FS AI', 'draft', 0)",
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

function seedEvEvidence(db) {
  insertResearchItem(db, { title: 'EV Sales 2023', summary: 'EV sales reached 14 million units worldwide in 2023.', evidence: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.' });
  insertResearchItem(db, { title: 'Home charging range', summary: 'A home charger adds about 40 kilometres of range per hour.', evidence: 'A home charger typically adds about 40 kilometres of range per hour of charging.' });
}

const EV_POOL = [{
  url: 'https://example.com/source-1',
  title: 'EV Sales 2023',
  text: 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency. A home charger typically adds about 40 kilometres of range per hour of charging.',
  isOutdated: false,
}];

describe('stripTrailingCitation — the #30 citation tail', () => {
  it('strips a trailing NBSP + markdown citation link', () => {
    assert.equal(
      stripTrailingCitation('The guide covers the main routes for visitors. [The Guardian](https://www.theguardian.com/travel/nyc-guide)'),
      'The guide covers the main routes for visitors.',
    );
  });

  it('strips a bare trailing URL, a parenthesised URL and a dash-URL tail', () => {
    assert.equal(stripTrailingCitation('See the full guide https://example.com/guide'), 'See the full guide');
    assert.equal(stripTrailingCitation('See the full guide (https://example.com/guide)'), 'See the full guide');
    assert.equal(stripTrailingCitation('EV sales reached 14 million units in 2023 - https://example.com/report'), 'EV sales reached 14 million units in 2023');
  });

  it('leaves a mid-sentence URL alone', () => {
    const s = 'The deal was announced at https://example.com/news and involves silicon anode material.';
    assert.equal(stripTrailingCitation(s), s);
  });
});

describe('validateCorrectedBody — citation-tailed paragraphs (live #30)', () => {
  it('a paragraph ending in a citation link passes once its sentence text is judged', () => {
    // The exact #30 shape: a content paragraph whose last sentence
    // ends with terminal punctuation, followed by the inline citation
    // link. The old code failed this paragraph (it ends in ")").
    const original = 'A home charger typically adds about 40 kilometres of range per hour of charging. EV sales reached 20 million units worldwide in 2023, according to industry reports. [The Guardian](https://example.com/ev-guide)';
    const corrected = 'A home charger typically adds about 40 kilometres of range per hour of charging. EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency. [The Guardian](https://example.com/ev-guide)';
    const v = validateCorrectedBody(original, corrected, EV_POOL);
    assert.equal(v.ok, true, `citation-tailed paragraph must pass, got: ${v.reasons.join(' | ')}`);
    assert.deepEqual(v.reasons, []);
  });

  it('a rewrite inside a cited paragraph does not resurrect its pre-existing defect', () => {
    // The paragraph below is GENUINELY unterminated (its second
    // sentence has no closing punctuation) and carries the citation
    // tail. That defect is pre-existing: rewriting the FIRST sentence
    // must not make it "new". The old first-120-chars key failed
    // this (the rewrite changed the key); the index key exempts it.
    const original = 'EV sales reached 20 million units worldwide in 2023, according to industry reports. A home charger typically adds about 40 kilometres of range per hour [The Guardian](https://example.com/ev-guide)';
    const corrected = 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency. A home charger typically adds about 40 kilometres of range per hour [The Guardian](https://example.com/ev-guide)';
    const v = validateCorrectedBody(original, corrected, EV_POOL);
    assert.equal(v.ok, true, `pre-existing defect must stay exempt after an in-place rewrite, got: ${v.reasons.join(' | ')}`);
  });

  it('a genuinely NEW unterminated paragraph is still caught (the index key does not over-exempt)', () => {
    const original = 'EV sales reached 20 million units worldwide in 2023, according to industry reports. A home charger typically adds about 40 kilometres of range per hour [The Guardian](https://example.com/ev-guide)';
    const corrected = 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency. A home charger typically adds about 40 kilometres of range per hour [The Guardian](https://example.com/ev-guide)\n\nA brand new paragraph with no ending punctuation';
    const v = validateCorrectedBody(original, corrected, EV_POOL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /incomplete paragraph/.test(r)), `got: ${v.reasons.join(' | ')}`);
  });

  it('a paragraph genuinely unterminated still fails', () => {
    const original = 'EV sales reached 20 million units worldwide in 2023, according to industry reports.';
    const corrected = `${original}\n\nThe deal aims to supply silicon-carbon anode material for electric vehicles`;
    const v = validateCorrectedBody(original, corrected, EV_POOL);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /incomplete paragraph/.test(r)), `got: ${v.reasons.join(' | ')}`);
  });
});

describe('detectTruncatedBody — the #30 cut-off correction output', () => {
  const ORIGINAL = 'If you only have three days to explore New York City, a local travel guide can help you plan every stop. The guide covers the main neighbourhoods and the best subway routes for visitors.';

  it('detects a body ending mid-sentence on a function word, much shorter than the original', () => {
    const corrected = 'If you only have three days to explore New York City, a local travel guide can';
    const t = detectTruncatedBody(ORIGINAL, corrected);
    assert.ok(t, 'mid-sentence cut-off must be detected');
    assert.ok(t.reasons.some((r) => /truncated/.test(r) && /mid-sentence/.test(r)), `got: ${t.reasons.join(' | ')}`);
  });

  it('detects a mid-word cut-off ("broke" cut off "broken")', () => {
    const original = 'Three days are broken into neighbourhood walks, subway rides and food stops across the city for visitors.';
    const corrected = 'Three days are broke';
    const t = detectTruncatedBody(original, corrected);
    assert.ok(t, 'mid-word cut-off must be detected');
    assert.ok(t.reasons.some((r) => /mid-word/.test(r)), `got: ${t.reasons.join(' | ')}`);
  });

  it('does not flag a properly terminated corrected body', () => {
    const corrected = 'If you only have three days to explore New York City, a local travel guide can help you plan every stop. The guide covers the main neighbourhoods and the best subway routes for visitors.';
    assert.equal(detectTruncatedBody(ORIGINAL, corrected), null);
  });

  it('does not flag a pre-existing unterminated paragraph the correction did not cut', () => {
    const original = 'First sentence here for context and length in this test article body. A trailing thought with no ending';
    const corrected = 'First sentence here rewritten for context and length in this test article body. A trailing thought with no ending';
    assert.equal(detectTruncatedBody(original, corrected), null);
  });

  it('does not flag an unchanged body', () => {
    assert.equal(detectTruncatedBody(ORIGINAL, ORIGINAL), null);
  });
});

describe('runCorrection — validation rejection is a FAILED run, not a done one', () => {
  it('returns outcome failed with a recovery report; nothing is saved', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    // Two failed claims, one stub rewrite for both: each candidate is
    // individually fine, but the corrected body repeats it — the same
    // deterministic validation failure as live #30 runs 115/116.
    const originalBody = 'EV sales reached 20 million units worldwide in 2023, according to industry reports.\n\nGlobal EV sales hit 20 million units in 2023, market analysts reported.';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    await checkArticle(env, loadArticle(db, id));
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'failed', 'a validation rejection must not report done');
    assert.equal(r.validationRejected, true);
    assert.ok(r.validationReasons.some((x) => /repeated sentence/.test(x)));
    assert.equal(r.corrected, 0, 'nothing counts as corrected when nothing was saved');
    assert.equal(r.removed, 0, 'nothing counts as removed when nothing was saved');
    const report = r.recoveryReport;
    assert.ok(report, 'a recovery report is required');
    assert.equal(report.articleId, id);
    assert.equal(report.component, 'fact-checking/correction');
    assert.ok(report.rootCause && report.rootCause.length > 0, 'root cause named');
    assert.ok(report.reasons.length > 0);
    assert.equal(report.retryable, false, 'validation rejection on unchanged input is permanent, not retryable');
    assert.equal(report.status, 'BLOCKED_WITH_REASON');
    assert.match(report.ownerAction || '', /Human review/);
    assert.match(report.nextStep || '', /Do NOT re-run/);
    assert.ok(report.timestamp, 'timestamp recorded');
    assert.equal(db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body, originalBody, 'pre-edit body preserved exactly');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions').get().n, 0, 'no revision row for a rejected body');
    const rows = db.prepare('SELECT * FROM article_corrections WHERE article_id = ?').all(id);
    assert.ok(rows.every((x) => x.status === 'failed'), 'attempted corrections recorded as failed, never applied');
    assert.ok(r.results.every((x) => x.action === 'failed'), 'results report the rejection, not the attempted actions');
  });

  it('threads the task id into the recovery report when run through runFactChecking', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    const originalBody = 'EV sales reached 20 million units worldwide in 2023, according to industry reports.\n\nGlobal EV sales hit 20 million units in 2023, market analysts reported.';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    await checkArticle(env, loadArticle(db, id));
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const r = await runFactChecking(
      { agent: 'fact-checking', kind: 'correct', id: 77, payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'failed');
    assert.equal(r.recoveryReport.taskId, 77, 'recovery report must name the task');
    assert.equal(r.recoveryReport.articleId, id);
  });

  it('a cited-paragraph correction now succeeds end to end (the #30 deterministic failure is gone)', async () => {
    const { db, env } = freshEnv();
    seedEvEvidence(db);
    // The #30 shape in miniature: a paragraph ending in a citation
    // link, with a failed claim inside it. Before the W2 fix this
    // correction failed validation deterministically.
    const originalBody = 'A home charger typically adds about 40 kilometres of range per hour of charging. EV sales reached 20 million units worldwide in 2023, according to industry reports. [The Guardian](https://example.com/ev-guide)';
    const id = insertArticle(db, originalBody);
    addArticleSource(db, id, 'https://example.com/source-1');
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.claimsFailed, 1, 'only the wrong-number claim fails');
    stubAi(env, 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.');
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done', `cited-paragraph correction must succeed now, got: ${JSON.stringify(r.validationReasons || r)}`);
    assert.equal(r.results[0].action, 'corrected');
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.match(body, /14 million/);
    assert.ok(body.includes('[The Guardian](https://example.com/ev-guide)'), 'citation tail preserved');
    assert.ok(!body.includes('20 million'));
  });
});
