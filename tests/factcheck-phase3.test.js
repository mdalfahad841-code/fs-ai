// FS AI — Phase 3 fact-check repairs (Priorities 2, 3, 5, 6).
//
// P3 — claim extraction: the AI-DRAFT banner's 2nd/3rd lines became
// claims 1-2 on live article #30, and "[The Guardian]" prefixes
// leaked into 5 claim texts. Banner/meta lines are now excluded and
// bracketed citation labels are stripped (linkage survives via
// evidence_url).
// P2 — correction truncation: the old 200-token rewrite call burned
// 10 calls / 98 Neurons on #30 with truncated or meta-wrapped
// replies. The budget is now 500, truncation is detected with one
// retry on a shorter quote, meta openers are dropped, and a run-level
// circuit breaker stops rewrites after 2 consecutive truncations.
// P5 — duplicate corrections: attempts were counted per claim_check_id
// (which changes every fact-check), so a second run wrote duplicate
// rows for the same claim (live #30: 11 rows / 6 claims). Identity is
// now (article_id, claimKey) and a failed retry updates the open row
// in place; the gate counts unresolved CLAIMS, not rows.
// P6 — verdict consistency: claim 8 on #30 flipped UNSUPPORTED ->
// VERIFIED with no correction saved (non-deterministic LLM judge
// re-run). Unchanged claims against unchanged evidence are now
// carried forward; every run records check_kind + evidence_signature
// and every claim row records previous_verdict.
// Real SQLite database (schema + seed + migrations
// 005/006/008/009/010/011/012/016/017/018). The LLM is stubbed through
// env.AI (the Workers AI binding shape) — generateText never touches
// the network here. Throwaway articles only; never #26/#27 ids.
// Run: node --test tests/factcheck-phase3.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  extractClaims, stripCitationPrefix, claimKey, isBannerOrMetaLine,
  isTruncatedReply, checkArticle, runCorrection, MAX_CORRECTION_ATTEMPTS,
} = require('../backend/agents/autonomy/factcheck.js');
const { evaluatePublishGate } = require('../backend/publishing/gate.js');

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
    'database/migrations/016_llm_usage_estimated.sql',
    'database/migrations/017_correction_claim_key.sql',
    'database/migrations/018_factcheck_verdict_history.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, body, divisionId = 5) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Phase 3 Test Article', 'phase-3-test-article', 'test', ?, 'FS AI', 'draft', 0)",
  ).run(divisionId, body);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertResearchItem(db, { title, summary, evidence, url = 'https://example.com/source-1', divisionId = 5, fetchedAt = '2026-11-19T12:00:00Z' }) {
  const r = db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, published_at, fetched_at, summary, evidence_text, is_outdated) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(divisionId, title, url, '2026-11-19T10:00:00Z', fetchedAt, summary, evidence);
  return Number(r.lastInsertRowid);
}

function addArticleSource(db, articleId, url, title = 'Test source', researchItemId = null) {
  db.prepare(
    'INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(articleId, title, url, 'research', researchItemId, '2026-11-19T12:00:00Z');
}

/** Stub the Workers AI binding: every model call returns the same text. */
function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

/** Stub the Workers AI binding with a queue of replies + a call counter. */
function stubAiQueue(env, texts) {
  const queue = [...texts];
  const calls = [];
  env.AI = {
    run: async (model, input) => {
      calls.push(String((input && (input.prompt || input.messages)) || '').slice(0, 80));
      return { response: queue.length ? queue.shift() : 'I cannot verify this claim.' };
    },
  };
  env.__aiCalls = calls;
  env.__aiQueue = queue;
  return env;
}

// ---- P3 fixtures: the live #30 extraction problems, reduced. ----
const BANNER_BODY = [
  'AI-DRAFT — needs fact-check + owner approval.',
  'This draft was written by workers-ai (@cf/openai/gpt-oss-20b). It has NOT been fact-checked and must pass fact-checking and owner approval before it can be published.',
  '',
  '[The Guardian] The guide recommends visiting Barton Springs Pool in Austin, Texas, for swimming on a hot afternoon.',
  '[The Guardian] Day 1 begins with a ferry ride across the harbour and a walk through the old town centre.',
  'The guide also recommends Franklin Barbecue for brisket, with a long queue forming before lunch every day.',
  '[Write this section — no content yet.]',
  'SCAFFOLD — full draft needed.',
].join('\n');

describe('P3 — citation prefix + claim identity', () => {
  it('stripCitationPrefix drops a leading [Source] label and nothing else', () => {
    assert.equal(stripCitationPrefix('[The Guardian] The guide recommends swimming.'), 'The guide recommends swimming.');
    assert.equal(stripCitationPrefix('[BBC News] The launch happened in March.'), 'The launch happened in March.');
    assert.equal(stripCitationPrefix('The guide recommends swimming.'), 'The guide recommends swimming.');
    assert.equal(stripCitationPrefix('[not a citation] at the end'), 'at the end', 'any leading bracketed label is treated as a citation label');
  });

  it('claimKey is stable across case, whitespace and citation labels', () => {
    assert.equal(claimKey('[The Guardian] The Guide Recommends Swimming.'), claimKey('the guide  recommends swimming.'));
    assert.equal(claimKey('  Foo bar baz.  '), 'foo bar baz.');
    assert.ok(claimKey('x'.repeat(300)).length <= 200, 'claimKey is capped at 200 chars');
  });

  it('isBannerOrMetaLine recognises every banner/meta line shape', () => {
    assert.ok(isBannerOrMetaLine('AI-DRAFT — needs fact-check + owner approval.'));
    assert.ok(isBannerOrMetaLine('This draft was written by workers-ai (@cf/openai/gpt-oss-20b).'));
    assert.ok(isBannerOrMetaLine('It has NOT been fact-checked and must pass fact-checking.'));
    assert.ok(isBannerOrMetaLine('SCAFFOLD — full draft needed.'));
    assert.ok(isBannerOrMetaLine('[Write this section — no content yet.]'));
    assert.ok(!isBannerOrMetaLine('The guide recommends visiting Barton Springs Pool in Austin.'));
    assert.ok(!isBannerOrMetaLine('[The Guardian] The guide recommends swimming.'));
  });

  it('extractClaims excludes the banner lines and strips [The Guardian] prefixes (live #30)', () => {
    const claims = extractClaims(BANNER_BODY);
    for (const c of claims) {
      assert.ok(!c.startsWith('AI-DRAFT'), `banner line leaked: ${c}`);
      assert.ok(!c.startsWith('This draft was written'), `banner line leaked: ${c}`);
      assert.ok(!c.startsWith('It has NOT been'), `banner line leaked: ${c}`);
      assert.ok(!c.startsWith('SCAFFOLD'), `scaffold marker leaked: ${c}`);
      assert.ok(!c.startsWith('[The Guardian]'), `citation prefix leaked: ${c}`);
      assert.ok(!c.startsWith('[Write this section'), `editorial line leaked: ${c}`);
    }
    assert.ok(claims.some((c) => c.includes('Barton Springs Pool')), 'the Barton Springs claim must survive');
    assert.ok(claims.some((c) => c.includes('Day 1 begins with a ferry ride')), 'the bold day lead-in claim must survive (it is a real statement)');
    assert.ok(claims.some((c) => c.includes('Franklin Barbecue')), 'the unprefixed claim must survive');
    assert.equal(claims.length, 3, `expected exactly 3 real claims, got ${claims.length}: ${claims.join(' | ')}`);
  });

  it('a body of banner + one claim yields exactly that claim', () => {
    const body = 'AI-DRAFT — needs fact-check + owner approval.\nThis draft was written by workers-ai (@cf/openai/gpt-oss-20b). It has NOT been fact-checked.\n\nThe guide recommends visiting Barton Springs Pool in Austin, Texas, for swimming on a hot afternoon.';
    assert.deepEqual(extractClaims(body), ['The guide recommends visiting Barton Springs Pool in Austin, Texas, for swimming on a hot afternoon.']);
  });
});

describe('P2 — truncation detection', () => {
  it('isTruncatedReply flags replies with no terminal punctuation', () => {
    assert.equal(isTruncatedReply('EV sales reached 14 million units worldwide in 2023'), true);
    assert.equal(isTruncatedReply('EV sales reached 14 million units worldwide in 2023.'), false);
    assert.equal(isTruncatedReply('Is this the corrected sentence?'), false);
    assert.equal(isTruncatedReply('What a result!'), false);
    assert.equal(isTruncatedReply('Ends with a "quote".'), false);
    assert.equal(isTruncatedReply(''), false);
    assert.equal(isTruncatedReply(null), false);
  });
});

// EV evidence + a wrong-number claim (CONFLICTING) + the correct sentence.
const EV_EVIDENCE = 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.';
const WRONG_CLAIM = 'EV sales reached 77 million units worldwide in 2023, according to industry reports.';
const WRONG_CLAIM_2 = 'EV sales reached 55 million units worldwide in 2023, according to industry reports.';
const RIGHT_SENTENCE = 'EV sales reached 14 million units worldwide in 2023.';
const FILLER_SENTENCE = 'A home charger typically adds about 40 kilometres of range per hour of charging.';
const FILLER_EVIDENCE = 'A home charger typically adds about 40 kilometres of range per hour of charging.';

// P2 fixture: the wrong claim + a supported filler sentence. The
// correction can be saved cleanly (no duplicate sentence is created).
function seedEvArticle(db) {
  const itemId = insertResearchItem(db, {
    title: 'EV Sales 2023', summary: EV_EVIDENCE, evidence: EV_EVIDENCE,
    url: 'https://example.com/ev-sales-2023',
  });
  insertResearchItem(db, {
    title: 'Home charging range', summary: FILLER_EVIDENCE, evidence: FILLER_EVIDENCE,
    url: 'https://example.com/home-charging',
  });
  const body = `${WRONG_CLAIM} ${FILLER_SENTENCE}`;
  const id = insertArticle(db, body, 1);
  addArticleSource(db, id, 'https://example.com/ev-sales-2023', 'EV Sales 2023', itemId);
  addArticleSource(db, id, 'https://example.com/home-charging', 'Home charging', itemId + 1);
  return id;
}

// P5/P6 fixture: the wrong claim + the correct sentence ALREADY in the
// body — so a successful rewrite creates a duplicate sentence and the
// whole-body validation REJECTS the correction (a deterministic way to
// produce 'failed' correction rows).
function seedDuplicateArticle(db) {
  const itemId = insertResearchItem(db, {
    title: 'EV Sales 2023', summary: EV_EVIDENCE, evidence: EV_EVIDENCE,
    url: 'https://example.com/ev-sales-2023',
  });
  const body = `${WRONG_CLAIM} ${RIGHT_SENTENCE}`;
  const id = insertArticle(db, body, 1);
  addArticleSource(db, id, 'https://example.com/ev-sales-2023', 'EV Sales 2023', itemId);
  return id;
}

describe('P2 — correction retry + meta-reply handling (live runCorrection)', () => {
  it('a truncated first reply is retried once and the good reply is saved', async () => {
    const { db, env } = freshEnv();
    const id = seedEvArticle(db);
    stubAiQueue(env, [
      'EV sales reached 14 million units worldwide in 2023', // truncated: no period
      'EV sales reached 14 million units worldwide in 2023.', // retry: complete
    ]);
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.verdict, 'needs-review');
    const run = await runCorrection(env, loadArticle(db, id));
    assert.equal(run.corrected, 1, JSON.stringify(run.results));
    assert.equal(run.results[0].action, 'corrected');
    assert.equal(run.results[0].failureReason, 'truncated-reply', 'the first attempt failure is recorded in the results');
    const article = loadArticle(db, id);
    assert.ok(article.body.includes(RIGHT_SENTENCE), 'the corrected sentence must be in the saved body');
    assert.ok(!article.body.includes('77 million'), 'the wrong number must be gone');
    assert.equal((article.body.match(/EV sales reached 14 million/g) || []).length, 1, 'the corrected sentence must appear exactly once');
  });

  it('a meta-wrapped reply ("Here is the corrected sentence.") is never spliced in', async () => {
    const { db, env } = freshEnv();
    const id = seedEvArticle(db);
    stubAi(env, `Here is the corrected sentence. ${RIGHT_SENTENCE}`);
    await checkArticle(env, loadArticle(db, id));
    const run = await runCorrection(env, loadArticle(db, id));
    assert.equal(run.corrected, 1, JSON.stringify(run.results));
    const article = loadArticle(db, id);
    assert.ok(!article.body.includes('Here is the corrected sentence'), 'the meta opener must not be saved as a correction');
    assert.ok(article.body.includes(RIGHT_SENTENCE), 'the real corrected sentence must be saved');
  });

  it('two truncated replies in a row open the circuit breaker: the next claim is not rewritten at all', async () => {
    const { db, env } = freshEnv();
    // Two wrong-number claims + the supported filler. Both rewrites
    // truncate; after the second consecutive truncation the breaker
    // opens and the second claim goes straight to removal-or-skip
    // without spending another LLM call.
    const itemId = insertResearchItem(db, {
      title: 'EV Sales 2023', summary: EV_EVIDENCE, evidence: EV_EVIDENCE,
      url: 'https://example.com/ev-sales-2023',
    });
    const fillerId = insertResearchItem(db, {
      title: 'Home charging range', summary: FILLER_EVIDENCE, evidence: FILLER_EVIDENCE,
      url: 'https://example.com/home-charging',
    });
    const id = insertArticle(db, `${WRONG_CLAIM} ${WRONG_CLAIM_2} ${FILLER_SENTENCE}`, 1);
    addArticleSource(db, id, 'https://example.com/ev-sales-2023', 'EV Sales 2023', itemId);
    addArticleSource(db, id, 'https://example.com/home-charging', 'Home charging', fillerId);
    stubAiQueue(env, [
      'EV sales reached 14 million units worldwide in 2023', // truncated
      'EV sales reached 14 million units worldwide in 202', // truncated again
    ]);
    await checkArticle(env, loadArticle(db, id));
    const run = await runCorrection(env, loadArticle(db, id));
    assert.equal(run.results[0].failureReason, 'truncated-reply');
    assert.equal(run.results[1].failureReason, 'rewrite-circuit-open', 'the second claim must not be rewritten once the breaker is open');
    assert.equal(env.__aiCalls.length, 2, 'exactly 2 LLM calls (the first claim\'s two attempts) — the second claim spends none');
    const article = loadArticle(db, id);
    assert.ok(!article.body.includes('in 2023') || article.body.includes(RIGHT_SENTENCE),
      'no truncated fragment may be saved');
  });
});

describe('P5 — duplicate correction rows (live #30 shape)', () => {
  it('a second correction run for the same claim updates the open row instead of duplicating it', async () => {
    const { db, env } = freshEnv();
    const id = seedDuplicateArticle(db);
    // The stub always returns the correct sentence, so the corrected
    // body contains it twice -> whole-body validation rejects ->
    // 'failed' rows with failure_reason 'validation-rejected'.
    stubAi(env, RIGHT_SENTENCE);
    const firstCheck = await checkArticle(env, loadArticle(db, id));
    assert.equal(firstCheck.verdict, 'needs-review');
    const run1 = await runCorrection(env, loadArticle(db, id));
    assert.equal(run1.validationRejected, true, 'the duplicate-sentence body must fail validation');
    assert.equal(run1.results[0].action, 'failed');
    let rows = db.prepare('SELECT * FROM article_corrections WHERE article_id = ?').all(id);
    assert.equal(rows.length, 1, `run 1 must write exactly 1 row, got ${rows.length}`);
    assert.equal(rows[0].failure_reason, 'validation-rejected');
    assert.ok(rows[0].claim_key, 'claim_key must be recorded');
    assert.equal(rows[0].claim_key, claimKey(WRONG_CLAIM));

    // Second run: a fresh fact-check (new claim_check ids — the live
    // #30 trigger) followed by a second correction run.
    stubAi(env, RIGHT_SENTENCE);
    await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    const run2 = await runCorrection(env, loadArticle(db, id));
    assert.equal(run2.results[0].action, 'failed');
    rows = db.prepare('SELECT * FROM article_corrections WHERE article_id = ?').all(id);
    assert.equal(rows.length, 1, `run 2 must NOT insert a second open row for the same claim (live #30 wrote 11/6), got ${rows.length}`);
    assert.equal(rows[0].attempt, 2, 'the attempt counter must advance across runs (it used to reset to 0 per claim_check_id)');
    assert.equal(rows[0].failure_reason, 'validation-rejected');

    // The gate counts the unresolved CLAIM (1), not rows.
    const gate = await evaluatePublishGate(env, id);
    const check4 = gate.checks.find((c) => c.name === 'correction-recheck');
    assert.ok(check4, 'gate must have a correction-recheck check');
    assert.match(check4.detail, /1 correction claim\(s\) still pending or failed/);
  });

  it('migration 017 backfills claim_key for pre-migration rows', () => {
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
    db.prepare(
      "INSERT INTO article_corrections (article_id, claim_check_id, original_text, corrected_text, attempt, status) VALUES (1, NULL, 'EV sales reached 77 million units worldwide in 2023, according to industry reports.', NULL, 1, 'failed')",
    ).run();
    const colsBefore = db.prepare("SELECT name FROM pragma_table_info('article_corrections')").all().map((r) => r.name);
    assert.ok(!colsBefore.includes('claim_key'), 'claim_key must not exist before migration 017');
    for (const stmt of splitSql(fs.readFileSync(path.join(ROOT, 'database/migrations/017_correction_claim_key.sql'), 'utf8'))) {
      db.exec(stmt);
    }
    const after = db.prepare('SELECT claim_key FROM article_corrections WHERE id = 1').get();
    assert.equal(after.claim_key, 'ev sales reached 77 million units worldwide in 2023, according to industry reports.');
  });
});

describe('P6 — verdict consistency (live #30 claim-8 flip)', () => {
  const BORDERLINE_CLAIM = 'The Riverside electric motorcycle launch includes a long range, swappable batteries, and a Dhaka showroom opening in March, with service centres across Bangladesh and a warranty programme for early buyers.';
  const BORDERLINE_EVIDENCE = 'The Riverside electric motorcycle launch includes a Dhaka showroom.';

  function seedBorderlineArticle(db) {
    const itemId = insertResearchItem(db, {
      title: 'Riverside motorcycle launch', summary: BORDERLINE_EVIDENCE, evidence: BORDERLINE_EVIDENCE,
      url: 'https://example.com/riverside-launch',
    });
    const id = insertArticle(db, BORDERLINE_CLAIM, 1);
    addArticleSource(db, id, 'https://example.com/riverside-launch', 'Riverside launch', itemId);
    return id;
  }

  it('an unchanged claim against unchanged evidence keeps its verdict even when the judge would flip it', async () => {
    const { db, env } = freshEnv();
    const id = seedBorderlineArticle(db);
    stubAiQueue(env, [
      'SUPPORTED\nThe evidence mentions the Riverside launch and the Dhaka showroom.',
      'NOT_SUPPORTED\nThe evidence does not mention the range or the batteries.',
    ]);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.claims[0].verdict, 'VERIFIED', 'run 1: the judge SUPPORTED must upgrade the borderline claim to VERIFIED');
    assert.equal(run1.carriedForward, 0);
    assert.ok(run1.factCheckId);

    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.claims[0].verdict, 'VERIFIED', 'run 2: the verdict must NOT flip to UNSUPPORTED — same text, same evidence (live #30 claim 8)');
    assert.equal(run2.carriedForward, 1, 'run 2 must carry the verdict forward');
    assert.equal(env.__aiCalls.length, 1, 'run 2 must not call the LLM judge at all for the carried claim');
    assert.equal(env.__aiQueue.length, 1, 'the NOT_SUPPORTED reply must stay unconsumed');

    const fc2 = db.prepare('SELECT * FROM fact_checks WHERE id = ?').get(run2.factCheckId);
    assert.equal(fc2.check_kind, 'recheck');
    assert.ok(fc2.evidence_signature, 'evidence signature must be recorded');
    const fc1 = db.prepare('SELECT * FROM fact_checks WHERE id = ?').get(run1.factCheckId);
    assert.equal(fc2.evidence_signature, fc1.evidence_signature, 'identical evidence must produce an identical signature');
    const cc2 = db.prepare('SELECT * FROM claim_checks WHERE fact_check_id = ?').get(run2.factCheckId);
    assert.equal(cc2.previous_verdict, 'VERIFIED', 'previous_verdict must record the run-1 verdict');
  });

  it('new evidence re-evaluates the claim fresh and records the flip', async () => {
    const { db, env } = freshEnv();
    const id = seedBorderlineArticle(db);
    stubAiQueue(env, [
      'SUPPORTED\nThe evidence mentions the Riverside launch and the Dhaka showroom.',
      'NOT_SUPPORTED\nThe evidence does not mention the range or the batteries.',
    ]);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.claims[0].verdict, 'VERIFIED');

    // A newer fetch of the same source arrives: the evidence signature
    // changes, so the claim is judged fresh — and the flip is recorded.
    const itemId2 = insertResearchItem(db, {
      title: 'Riverside motorcycle launch (update)', summary: 'The Riverside electric motorcycle launch includes a Dhaka showroom. Updated specifications are expected next quarter.',
      evidence: 'The Riverside electric motorcycle launch includes a Dhaka showroom. Updated specifications are expected next quarter.',
      url: 'https://example.com/riverside-launch',
      fetchedAt: '2026-11-20T12:00:00Z',
    });
    addArticleSource(db, id, 'https://example.com/riverside-launch', 'Riverside launch (update)', itemId2);
    const run3 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run3.carriedForward, 0, 'changed evidence must not carry the verdict forward');
    assert.equal(run3.claims[0].verdict, 'UNSUPPORTED', 'fresh evaluation with a NOT_SUPPORTED judge keeps the deterministic verdict');
    assert.equal(env.__aiCalls.length, 2, 'the judge must be called when the evidence changed');
    const cc3 = db.prepare('SELECT * FROM claim_checks WHERE fact_check_id = ?').get(run3.factCheckId);
    assert.equal(cc3.previous_verdict, 'VERIFIED', 'the flip VERIFIED -> UNSUPPORTED must be traceable via previous_verdict');
  });

  it('a correction attempt alone never flips an unchanged claim (recheck after correction)', async () => {
    const { db, env } = freshEnv();
    const id = seedDuplicateArticle(db);
    stubAi(env, RIGHT_SENTENCE);
    const first = await checkArticle(env, loadArticle(db, id));
    const wrongBefore = first.claims.find((c) => c.claim.includes('77 million'));
    assert.equal(wrongBefore.verdict, 'CONFLICTING');
    const run = await runCorrection(env, loadArticle(db, id));
    // Validation rejected the duplicate body, so nothing was saved;
    // the re-check verdicts must match the pre-correction run exactly.
    assert.equal(run.validationRejected, true);
    const recheckClaims = run.recheck.claims;
    const wrongAfter = recheckClaims.find((c) => c.claim.includes('77 million'));
    assert.equal(wrongAfter.verdict, 'CONFLICTING', 'the unchanged wrong-number claim must keep CONFLICTING after a correction attempt');
    const rightAfter = recheckClaims.find((c) => c.claim === RIGHT_SENTENCE);
    assert.equal(rightAfter.verdict, 'VERIFIED', 'the unchanged correct sentence must keep VERIFIED');
  });
});
