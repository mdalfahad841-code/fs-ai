// FS AI — fact-check integrity regressions (2026-11-20).
//
// Live article #31 was edited, but its dashboard Re-checks (runs
// #121/#122) wrote NO new fact_checks row: the Re-check endpoint
// reused the article's newest fact-checking task, which was a
// kind='correct' row created by the dashboard Correct button, and
// routed it through runCorrection — which no-ops on a passing
// article. The old PASS was returned as the "re-check" result, and
// the publish gate reads only the latest row's verdict, so an edited
// article could keep VERIFIED verdicts for claims its body no longer
// contains. Three layers close the hole:
//   (1) a re-check always runs a real fact-check (handler forces the
//       reused row's kind to 'fact-check'; runFactChecking refuses to
//       route a recheck payload to runCorrection; the endpoint fails
//       loudly when no new row was written);
//   (2) every fact_checks row records the SHA-256 body hash of the
//       body it judged (migration 019) — a body edit, or a legacy row
//       with no hash, forces fresh evaluation and makes the gate treat
//       the result as stale (fail-closed);
//   (3) verdict carry-forward needs the FULL claim hash (not the
//       truncated 200-char claimKey) AND an evidence signature that
//       includes evidence CONTENT, not just ids + fetch times.
// Real SQLite database (schema + seed + migrations
// 005/006/008/009/010/011/012/016/017/018/019). The LLM is stubbed
// through env.AI (the Workers AI binding shape) — generateText never
// touches the network here. Throwaway articles only; never #26/#27.
// Run: node --test tests/factcheck-integrity.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  extractClaims, claimKey, claimHash, checkArticle, runCorrection, runFactChecking,
} = require('../backend/agents/autonomy/factcheck.js');
const { normaliseBodyForHash, bodyHash } = require('../backend/utils/bodyHash.js');
const { evaluatePublishGate } = require('../backend/publishing/gate.js');
const { callAutonomy } = require('./phase2-harness.js');

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
    'database/migrations/019_factcheck_body_hash.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function insertArticle(db, body, divisionId = 1) {
  const r = db.prepare(
    "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, 'Integrity Test Article', 'integrity-test-article', 'test', ?, 'FS AI', 'draft', 0)",
  ).run(divisionId, body);
  return Number(r.lastInsertRowid);
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertResearchItem(db, { title, summary, evidence, url = 'https://example.com/source-1', divisionId = 1, fetchedAt = '2026-11-19T12:00:00Z' }) {
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

function stubAi(env, text) {
  env.AI = { run: async () => ({ response: text }) };
  return env;
}

// ---- Fixtures: two deterministically VERIFIED claims + padding. ----
// The padding is short sentences (< 40 chars) so it never becomes a
// claim, but keeps the body over the 500-char structural minimum even
// after one claim sentence is removed.
const PAD = [
  'Short guide. Read it slowly. Take notes below. More to come. Keep it simple. Stay curious. Learn by doing. Ask questions. Try it yourself. Share your notes. Come back soon. Practice daily. Read the summary. Check the numbers. Trust the source. Stay up to date.',
  'Keep learning every day. Small steps add up. Review what you read. Write down key facts.',
  'Check every number twice. Cite your sources well. Keep sentences short. Avoid vague claims. Write in plain words. End with a summary.',
].join(' ');
const EV_CLAIM = 'EV sales reached 14 million units worldwide in 2023, according to industry reports.';
const EV_EVIDENCE = 'EV sales reached 14 million units worldwide in 2023, according to the International Energy Agency.';
const CHARGER_CLAIM = 'A home charger typically adds about 40 kilometres of range per hour of charging.';
const CHARGER_EVIDENCE = 'A home charger typically adds about 40 kilometres of range per hour of charging.';
const SOLAR_CLAIM = 'Solar panels typically generate about 400 watts of power per panel in full sun.';
const SOLAR_EVIDENCE = 'Solar panels typically generate about 400 watts of power per panel in full sun.';
const NEW_CLAIM = 'The new metro line will open next spring with twelve stations across the city.';
const WRONG_CLAIM = 'EV sales reached 77 million units worldwide in 2023, according to industry reports.';
const RIGHT_SENTENCE = 'EV sales reached 14 million units worldwide in 2023.';

function seedEvArticle(db, { claims = [EV_CLAIM, CHARGER_CLAIM] } = {}) {
  const evId = insertResearchItem(db, {
    title: 'EV Sales 2023', summary: EV_EVIDENCE, evidence: EV_EVIDENCE,
    url: 'https://example.com/ev-sales-2023',
  });
  const chId = insertResearchItem(db, {
    title: 'Home charging range', summary: CHARGER_EVIDENCE, evidence: CHARGER_EVIDENCE,
    url: 'https://example.com/home-charging',
  });
  const solarId = insertResearchItem(db, {
    title: 'Solar panels', summary: SOLAR_EVIDENCE, evidence: SOLAR_EVIDENCE,
    url: 'https://example.com/solar-panels',
  });
  const body = [...claims, PAD].join(' ');
  const id = insertArticle(db, body, 1);
  addArticleSource(db, id, 'https://example.com/ev-sales-2023', 'EV Sales 2023', evId);
  addArticleSource(db, id, 'https://example.com/home-charging', 'Home charging', chId);
  addArticleSource(db, id, 'https://example.com/solar-panels', 'Solar panels', solarId);
  return { id, evId, chId, solarId };
}

function claimsOf(db, factCheckId) {
  return db.prepare('SELECT * FROM claim_checks WHERE fact_check_id = ? ORDER BY id ASC').all(factCheckId);
}

function factCheckRow(db, factCheckId) {
  return db.prepare('SELECT * FROM fact_checks WHERE id = ?').get(factCheckId);
}

function gateCheck(gate, name) {
  const c = gate.checks.find((x) => x.name === name);
  assert.ok(c, `gate must have a ${name} check`);
  return c;
}

// ---- Body-hash helpers: formatting vs wording. ----
describe('body hash — normalisation', () => {
  it('formatting-only changes hash identically; any wording change hashes differently', async () => {
    const base = `${EV_CLAIM} ${CHARGER_CLAIM} ${PAD}`;
    const formatted = `${EV_CLAIM}  ${CHARGER_CLAIM}\n\n${PAD.replace('Short guide.', '**Short** guide.')}   `;
    const heading = `## Overview\n\n${base}`;
    assert.equal(normaliseBodyForHash(base), normaliseBodyForHash(formatted),
      'blank lines, double spaces, trailing spaces and **bold** on a non-claim word must normalise away');
    assert.equal(await bodyHash(base), await bodyHash(formatted));
    assert.notEqual(normaliseBodyForHash(base), normaliseBodyForHash(heading),
      'adding a heading line adds words — it hashes as different (fail-safe: fresh evaluation)');
    assert.notEqual(await bodyHash(base), await bodyHash(base.replace('14 million', '77 million')),
      'a number change must hash differently');
    assert.notEqual(await bodyHash(base), await bodyHash(base.replace('worldwide', 'globally')),
      'a word change must hash differently');
    assert.notEqual(await bodyHash(base), await bodyHash(`${base} ${SOLAR_CLAIM}`),
      'an added sentence must hash differently');
    assert.notEqual(await bodyHash(base), await bodyHash(`${CHARGER_CLAIM} ${PAD}`),
      'a removed sentence must hash differently');
    const h1 = await bodyHash(base);
    const h2 = await bodyHash(base);
    assert.equal(h1, h2, 'the hash must be deterministic');
    assert.match(h1, /^[0-9a-f]{64}$/, 'SHA-256 hex');
  });

  it('claimHash is a full hash: claims sharing a 200-char prefix differ, while claimKey collides', async () => {
    const prefix = 'word '.repeat(40); // 200 chars
    const a = `${prefix}alpha version.`;
    const b = `${prefix}beta version.`;
    assert.equal(claimKey(a), claimKey(b), 'the truncated claimKey collides on a shared 200-char prefix');
    assert.notEqual(await claimHash(a), await claimHash(b), 'the full claim hash must NOT collide');
    assert.equal(await claimHash('  The Guide Recommends Swimming. '), await claimHash('the guide recommends swimming.'),
      'case and whitespace variants of one claim share a hash');
  });
});

// ---- Carry-forward under body edits. ----
describe('carry-forward — body edits', () => {
  it('(1) a material body edit forces fresh extraction: the changed claim is re-judged, the unchanged claim carries forward, the old text is gone', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.verdict, 'pass', JSON.stringify(run1.claims));
    assert.equal(run1.claimsTotal, 2);
    assert.equal(run1.carriedForward, 0);
    assert.ok(run1.bodyHash, 'the run must record its body hash');
    assert.equal(factCheckRow(db, run1.factCheckId).body_hash, run1.bodyHash, 'the body hash must be stored on the fact_checks row');

    // Material edit: one claim's number changes (14 -> 77 million).
    const edited = loadArticle(db, id).body.replace('14 million', '77 million');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.notEqual(run2.factCheckId, run1.factCheckId, 'a new fact_checks row must be written');
    assert.notEqual(run2.bodyHash, run1.bodyHash, 'the edited body must hash differently');
    assert.equal(factCheckRow(db, run2.factCheckId).body_hash, run2.bodyHash);
    assert.equal(run2.claimsTotal, 2);
    const changed = run2.claims.find((c) => c.claim.includes('77 million'));
    assert.ok(changed, 'the edited claim must be in the new run');
    assert.equal(changed.verdict, 'CONFLICTING', 'the changed claim must be freshly judged, not carried VERIFIED');
    assert.equal(changed.carriedForward, false);
    assert.equal(changed.previousVerdict, null, 'the changed text is a new claim — it has no previous verdict');
    const unchanged = run2.claims.find((c) => c.claim === CHARGER_CLAIM);
    assert.ok(unchanged, 'the unchanged claim must still be in the new run');
    assert.equal(unchanged.verdict, 'VERIFIED');
    assert.equal(unchanged.carriedForward, true, 'the unchanged claim may carry forward');
    assert.equal(unchanged.previousVerdict, 'VERIFIED');
    assert.equal(run2.carriedForward, 1, 'exactly one claim carries forward');
    assert.equal(run2.verdict, 'needs-review', 'a CONFLICTING claim must fail the run');
    assert.ok(!run2.claims.some((c) => c.claim.includes('14 million')), 'the old claim text must not survive the edit');
    assert.deepEqual(claimsOf(db, run2.factCheckId).map((r) => r.claim_text).sort(),
      run2.claims.map((c) => c.claim).sort(), 'the stored rows must be exactly the new run\u2019s claims');
  });

  it('(2) a formatting-only change still carries forward unchanged claims', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.verdict, 'pass');
    const formatted = loadArticle(db, id).body
      .replace('Short guide.', '**Short** guide.')
      .replace(/\. /g, '.  ')
      .concat('\n\n   ');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(formatted, id);
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.bodyHash, run1.bodyHash, 'formatting-only edits must hash identically');
    assert.equal(run2.carriedForward, 2, 'both unchanged claims must carry forward');
    assert.equal(run2.verdict, 'pass');
    assert.deepEqual(run2.claims.map((c) => c.verdict), ['VERIFIED', 'VERIFIED']);
  });

  it('(3) a newly added claim gets fresh evaluation and is never carried VERIFIED', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.verdict, 'pass');
    const edited = `${loadArticle(db, id).body} ${NEW_CLAIM}`;
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.claimsTotal, 3);
    const added = run2.claims.find((c) => c.claim === NEW_CLAIM);
    assert.ok(added, 'the new claim must be extracted');
    assert.equal(added.verdict, 'UNSUPPORTED', 'no recorded source supports the new claim');
    assert.equal(added.carriedForward, false);
    assert.equal(added.previousVerdict, null);
    assert.equal(run2.carriedForward, 2, 'the two pre-existing claims may still carry forward');
    assert.equal(run2.verdict, 'needs-review');
  });

  it('(4) a removed claim does not remain active', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.claimsTotal, 2);
    const edited = loadArticle(db, id).body.replace(`${EV_CLAIM} `, '');
    assert.ok(edited.length >= 500, 'the shortened body must stay over the structural minimum');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.claimsTotal, 1, 'only the remaining claim may be active');
    assert.equal(run2.claims[0].claim, CHARGER_CLAIM);
    const stored = claimsOf(db, run2.factCheckId);
    assert.equal(stored.length, 1, 'the new run must store exactly one claim row');
    assert.equal(stored[0].claim_text, CHARGER_CLAIM);
    assert.ok(!stored.some((r) => r.claim_text.includes('EV sales')), 'the removed claim must leave no active row');
    assert.equal(run2.carriedForward, 1, 'the remaining claim carries forward');
  });
});

// ---- Carry-forward under evidence edits. ----
describe('carry-forward — evidence edits', () => {
  const BORDERLINE_CLAIM = 'The Riverside electric motorcycle launch includes a long range, swappable batteries, and a Dhaka showroom opening in March, with service centres across Bangladesh and a warranty programme for early buyers.';
  const BORDERLINE_EVIDENCE = 'The Riverside electric motorcycle launch includes a Dhaka showroom.';

  function seedBorderlineArticle(db) {
    const itemId = insertResearchItem(db, {
      title: 'Riverside motorcycle launch', summary: BORDERLINE_EVIDENCE, evidence: BORDERLINE_EVIDENCE,
      url: 'https://example.com/riverside-launch',
    });
    const id = insertArticle(db, BORDERLINE_CLAIM, 1);
    addArticleSource(db, id, 'https://example.com/riverside-launch', 'Riverside launch', itemId);
    return { id, itemId };
  }

  it('(5) changed evidence CONTENT forces fresh evaluation even with the same ids and fetch times', async () => {
    const { db, env } = freshEnv();
    const { id, itemId } = seedBorderlineArticle(db);
    stubAiQueue(env, [
      'SUPPORTED\nThe evidence mentions the Riverside launch and the Dhaka showroom.',
      'NOT_SUPPORTED\nThe evidence does not mention the range or the batteries.',
    ]);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.claims[0].verdict, 'VERIFIED', 'run 1: the judge SUPPORTED must upgrade the borderline claim to VERIFIED');
    assert.equal(run1.carriedForward, 0);
    assert.equal(env.__aiCalls.length, 1);

    // The evidence text is rewritten IN PLACE: same research-item id,
    // same fetched_at — only the words change.
    db.prepare('UPDATE research_items SET summary = ?, evidence_text = ? WHERE id = ?')
      .run('Riverside has opened a new parts warehouse in Chittagong.', 'Riverside has opened a new parts warehouse in Chittagong.', itemId);
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.carriedForward, 0, 'edited evidence must not carry the verdict forward');
    assert.equal(run2.claims[0].verdict, 'UNSUPPORTED', 'the claim must be freshly judged against the new evidence text');
    assert.equal(env.__aiCalls.length, 1, 'no LLM call is needed: the new evidence matches nothing');
    assert.notEqual(factCheckRow(db, run2.factCheckId).evidence_signature,
      factCheckRow(db, run1.factCheckId).evidence_signature,
      'the evidence signature must change when evidence content changes');
    assert.equal(factCheckRow(db, run2.factCheckId).body_hash,
      factCheckRow(db, run1.factCheckId).body_hash, 'the body did not change, so the body hash must stay identical');
    const cc2 = claimsOf(db, run2.factCheckId)[0];
    assert.equal(cc2.previous_verdict, 'VERIFIED', 'the flip VERIFIED -> UNSUPPORTED must be traceable');
  });

  it('(6) an unchanged claim against identical evidence carries forward (body hash + signature both match)', async () => {
    const { db, env } = freshEnv();
    const { id } = seedBorderlineArticle(db);
    stubAiQueue(env, [
      'SUPPORTED\nThe evidence mentions the Riverside launch and the Dhaka showroom.',
      'NOT_SUPPORTED\nThe evidence does not mention the range or the batteries.',
    ]);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.claims[0].verdict, 'VERIFIED');
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.claims[0].verdict, 'VERIFIED', 'the verdict must not flip on unchanged text and evidence');
    assert.equal(run2.carriedForward, 1);
    assert.equal(env.__aiCalls.length, 1, 'run 2 must not call the LLM judge for the carried claim');
    assert.equal(env.__aiQueue.length, 1, 'the NOT_SUPPORTED reply must stay unconsumed');
    assert.equal(factCheckRow(db, run2.factCheckId).body_hash, factCheckRow(db, run1.factCheckId).body_hash);
    assert.equal(factCheckRow(db, run2.factCheckId).evidence_signature, factCheckRow(db, run1.factCheckId).evidence_signature);
    assert.equal(claimsOf(db, run2.factCheckId)[0].previous_verdict, 'VERIFIED');
  });
});

// ---- Publishing gate: stale vs fresh. ----
describe('gate — stale fact-check rejection', () => {
  it('(7) the gate rejects a stale fact-check (body edited after the check) and accepts a fresh one', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    const run1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(run1.verdict, 'pass');
    const fresh = await evaluatePublishGate(env, id);
    assert.equal(gateCheck(fresh, 'fact-check-pass').ok, true, 'a fresh pass must satisfy check 1');
    assert.equal(gateCheck(fresh, 'no-unresolved-errors').ok, true);
    assert.equal(gateCheck(fresh, 'sources-verified').ok, true);

    // Material edit: a third VERIFIED sentence is appended (its
    // evidence was already linked as a source).
    const edited = `${loadArticle(db, id).body} ${SOLAR_CLAIM}`;
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);
    const stale = await evaluatePublishGate(env, id);
    assert.equal(gateCheck(stale, 'fact-check-pass').ok, false, 'an edited body must fail check 1');
    assert.match(gateCheck(stale, 'fact-check-pass').detail, /fact-check is stale: article body changed after the latest fact-check — run a fresh fact-check/);
    assert.equal(gateCheck(stale, 'no-unresolved-errors').ok, false, 'a stale run must not satisfy check 2');
    assert.match(gateCheck(stale, 'no-unresolved-errors').detail, /fact-check is stale/);
    assert.equal(gateCheck(stale, 'sources-verified').ok, false, 'a stale run must not satisfy check 3');
    assert.match(gateCheck(stale, 'sources-verified').detail, /fact-check is stale/);
    assert.equal(stale.contentReady, false);

    // A fresh re-check of the edited body passes, and the gate accepts it.
    const run2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(run2.verdict, 'pass', 'all three claims verify against the linked evidence');
    assert.equal(run2.claimsTotal, 3);
    const accepted = await evaluatePublishGate(env, id);
    assert.equal(gateCheck(accepted, 'fact-check-pass').ok, true, 'a fresh pass on the current body must satisfy check 1');
    assert.equal(gateCheck(accepted, 'no-unresolved-errors').ok, true);
    assert.equal(gateCheck(accepted, 'sources-verified').ok, true);
  });

  it('(7b) a legacy fact-check with no recorded body hash is stale (fail-closed)', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    // A pre-migration-019 row: verdict pass, but body_hash NULL.
    db.prepare("INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (?, 'pass', 2, 2, 0)").run(id);
    db.prepare("INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES ((SELECT id FROM fact_checks WHERE article_id = ?), ?, 'VERIFIED', 'https://example.com/ev-sales-2023', 'EV sales reached 14 million units.', 'Supported.')").run(id, EV_CLAIM);
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gateCheck(gate, 'fact-check-pass').ok, false, 'a hash-less legacy row must never pass check 1');
    assert.match(gateCheck(gate, 'fact-check-pass').detail, /fact-check is stale: the latest fact-check was recorded before body-hash tracking/);
    assert.equal(gateCheck(gate, 'no-unresolved-errors').ok, false);
    assert.equal(gateCheck(gate, 'sources-verified').ok, false);
    assert.equal(gate.contentReady, false);
  });
});

// ---- Correction + re-check workflow (live #31 regression). ----
describe('correction + re-check', () => {
  it('(8) a re-check payload always runs a real fact-check, even on a kind=correct task row — and a genuine correction still no-ops when nothing is left to correct', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db, { claims: [WRONG_CLAIM, CHARGER_CLAIM] });
    stubAi(env, RIGHT_SENTENCE);
    const first = await checkArticle(env, loadArticle(db, id));
    assert.equal(first.verdict, 'needs-review');
    const correction = await runCorrection(env, loadArticle(db, id));
    assert.equal(correction.outcome, 'done');
    assert.equal(correction.corrected, 1);
    assert.equal(correction.recheckVerdict, 'pass', 'the correction re-check must pass on the corrected body');
    const correctedBody = loadArticle(db, id).body;
    assert.ok(correctedBody.includes(RIGHT_SENTENCE), 'the corrected sentence must be saved');
    assert.ok(!correctedBody.includes('77 million'), 'the wrong number must be gone');

    // Control: a genuine correction call on a passing article no-ops
    // (legitimate — there is nothing to correct).
    const before = db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(id).n;
    const noop = await runFactChecking({ agent: 'fact-checking', kind: 'correct', payload: { article_id: id } }, env);
    assert.equal(noop.outcome, 'no-op');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(id).n, before,
      'a correction no-op must write no new fact-check row');

    // The live #31 shape: the body is edited again, and the re-check
    // arrives on a kind='correct' task row (created by the dashboard
    // Correct button). It must run a REAL fact-check, never no-op.
    const edited = correctedBody.replace('14 million', '55 million');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);
    const recheck = await runFactChecking(
      { agent: 'fact-checking', kind: 'correct', payload: { article_id: id, check_kind: 'recheck' } }, env);
    assert.equal(recheck.outcome, 'done', 'a recheck payload must never route to runCorrection');
    assert.equal(recheck.checkKind, 'recheck');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(id).n, before + 1,
      'the re-check must write a new fact_checks row');
    const bad = recheck.claims.find((c) => c.claim.includes('55 million'));
    assert.ok(bad, 'the edited claim must be in the new run');
    assert.equal(bad.verdict, 'CONFLICTING', 'the edited claim must be freshly judged');
    assert.equal(bad.carriedForward, false);
    assert.equal(recheck.verdict, 'needs-review');
  });

  it('(8b) the Re-check endpoint reuses a kind=correct task row, forces it to fact-check, and fails loudly if no new row was written (live #31)', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db, { claims: [WRONG_CLAIM, CHARGER_CLAIM] });
    stubAi(env, RIGHT_SENTENCE);
    await checkArticle(env, loadArticle(db, id));
    const correction = await runCorrection(env, loadArticle(db, id));
    assert.equal(correction.recheckVerdict, 'pass');
    const before = db.prepare('SELECT * FROM fact_checks WHERE article_id = ? ORDER BY id DESC LIMIT 1').get(id);

    // The dashboard Correct button's task row, as it existed live for
    // #31 (task #34): kind='correct', status done, several attempts.
    const now = new Date().toISOString();
    const seeded = db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('fact-checking', 'correct', ?, NULL, 5, 'done', 3, 3, ?, NULL, ?, ?)",
    ).run(JSON.stringify({ article_id: id }), `manual-correct-${id}-2026-11-20`, now, now);
    const taskId = Number(seeded.lastInsertRowid);

    // Edit the body after the passing correction re-check.
    const edited = loadArticle(db, id).body.replace('14 million', '55 million');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);

    const r = await callAutonomy(env, 'POST', `/api/autonomy/articles/${id}/recheck`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'completed');
    assert.equal(r.body.outcome, 'done', 'the re-check must complete a fresh check, never a correction no-op');
    assert.equal(r.body.taskReused, true, 'the existing task record is reused');
    assert.equal(r.body.taskId, taskId, 'the same task id — no duplicate task');
    assert.equal(r.body.previous.id, before.id, 'previous is the correction re-check run');
    assert.notEqual(r.body.latest.id, before.id, 'a NEW fact_checks row must be written');
    assert.equal(r.body.latest.verdict, 'needs-review', 'the edited body fails fresh evaluation');
    assert.ok(r.body.latest.bodyHash, 'the response names the body hash the run judged');
    assert.equal(r.body.latest.bodyHash, await bodyHash(edited), 'the recorded hash must match the edited body');
    assert.ok(r.body.latest.claims.some((c) => c.claim_text.includes('55 million')),
      'the new run\u2019s claims must reflect the edited body');
    assert.equal(db.prepare('SELECT kind FROM agent_tasks WHERE id = ?').get(taskId).kind, 'fact-check',
      'the reused row\u2019s kind must be forced to fact-check');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(id).n, 3,
      'initial check + correction re-check + endpoint re-check, all kept');
  });
});

// ---- Multiple editing rounds. ----
describe('carry-forward across multiple editing rounds', () => {
  it('(9) edit → re-check → edit → re-check stays correct: formatting carries forward, material edits re-judge, a revert re-verifies with its flip recorded', async () => {
    const { db, env } = freshEnv();
    const { id } = seedEvArticle(db);
    const r1 = await checkArticle(env, loadArticle(db, id));
    assert.equal(r1.verdict, 'pass');
    assert.equal(r1.carriedForward, 0);

    // Round 2: formatting only.
    const fmt = loadArticle(db, id).body.replace('Short guide.', '**Short** guide.').replace(/\. /g, '.  ');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(fmt, id);
    const r2 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(r2.bodyHash, r1.bodyHash);
    assert.equal(r2.carriedForward, 2);
    assert.equal(r2.verdict, 'pass');

    // Round 3: material edit — one claim's number changes.
    const edited = loadArticle(db, id).body.replace('14 million', '77 million');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(edited, id);
    const r3 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(r3.carriedForward, 1, 'only the unchanged claim carries forward');
    assert.equal(r3.claims.find((c) => c.claim.includes('77 million')).verdict, 'CONFLICTING');
    assert.equal(r3.verdict, 'needs-review');
    const gate3 = await evaluatePublishGate(env, id);
    assert.equal(gateCheck(gate3, 'fact-check-pass').ok, false);
    assert.match(gateCheck(gate3, 'fact-check-pass').detail, /Latest fact-check verdict: needs-review/,
      'round 3 fails the gate on its verdict — not on staleness, because the check IS fresh');

    // Round 4: revert the number — the claim re-verifies, with the
    // flip from CONFLICTING recorded as previous_verdict.
    const reverted = loadArticle(db, id).body.replace('77 million', '14 million');
    db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(reverted, id);
    const r4 = await checkArticle(env, loadArticle(db, id), { checkKind: 'recheck' });
    assert.equal(r4.bodyHash, r1.bodyHash, 'the reverted body hashes exactly like round 1');
    assert.equal(r4.carriedForward, 1, 'only the charger claim carries forward — the reverted claim is judged fresh');
    const revertedClaim = r4.claims.find((c) => c.claim.includes('14 million'));
    assert.equal(revertedClaim.verdict, 'VERIFIED');
    assert.equal(revertedClaim.carriedForward, false);
    assert.equal(revertedClaim.previousVerdict, null,
      'the reverted claim was absent from round 3, so it has no previous verdict — its flip is traceable across the run history (round 1 VERIFIED, round 3 CONFLICTING on the changed text, round 4 VERIFIED)');
    assert.equal(r4.verdict, 'pass');
    const gate4 = await evaluatePublishGate(env, id);
    assert.equal(gateCheck(gate4, 'fact-check-pass').ok, true, 'the fresh round-4 pass satisfies the gate');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(id).n, 4,
      'four runs, all kept');
  });
});
