// FS AI — Pipeline stage audit tests (workstream B, 2026-11-21).
//
// Stage-by-stage verification of Research -> Evidence -> Draft ->
// Fact-check -> Correction -> Re-check -> SEO -> Quality Gate ->
// Approval -> Publication -> Analytics against REAL SQLite (same
// harness as tests/queue-drain.test.js). Each stage must validate its
// input, validate its output, handle errors honestly, write an audit
// record, and report an honest status — a stage that reports success
// without verifying its actual result is flagged, not trusted.
//
// No network, no real LLM: Workers AI is stubbed through env.AI.
// Run: node --test tests/pipeline-stages.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runResearch } = require('../backend/agents/autonomy/research.js');
const {
  runContentCreation, resolveEvidence, convertScaffoldToDraft,
} = require('../backend/agents/autonomy/content.js');
const {
  runFactChecking, detectTruncatedBody,
} = require('../backend/agents/autonomy/factcheck.js');
const { runSeo } = require('../backend/agents/autonomy/seo.js');
const {
  evaluatePublishGate,
  evaluateAutoPublishEligibilityPure,
} = require('../backend/publishing/gate.js');
const {
  autoPublishArticle, runAutoPublish,
} = require('../backend/agents/autonomy/publishing.js');
const { runSocialMedia } = require('../backend/agents/autonomy/social.js');
const { runAnalytics } = require('../backend/agents/autonomy/analytics.js');

const ROOT = path.join(__dirname, '..');

const CANNED_DRAFT =
  '## How it works\n\nMost everyday AI is pattern-finding software: it learns from examples and predicts the most likely next step.\n\n' +
  '## Conclusion\n\nAI saves time on routine work when a person stays in charge of the facts and the final decision.\n\n' +
  '## Key takeaways\n\nUse AI for drafting and organising, check everything important, and keep private information out of tools you do not trust.';

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
    if (ch === ';') { cur += ch; stmts.push(cur); cur = ''; continue; }
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
  'database/migrations/016_llm_usage_estimated.sql',
  'database/migrations/017_correction_claim_key.sql',
  'database/migrations/018_factcheck_verdict_history.sql',
  'database/migrations/019_factcheck_body_hash.sql',
  'database/migrations/020_task_lifecycle_health.sql',
  'database/migrations/023_seo_body_hash.sql',
];

function freshEnv(extra = {}) {
  const db = buildDb(BASE_FILES);
  return { db, env: { DB: makeRealD1(db), ...extra } };
}

function fakeWorkersAI(text = CANNED_DRAFT) {
  return {
    run: async () => ({ response: text, usage: { prompt_tokens: 120, completion_tokens: 400 } }),
  };
}

function seedEvidence(db, url = 'https://example.com/ai-everyday-life') {
  const div = db.prepare("SELECT id FROM business_divisions WHERE slug = 'ai-technology' LIMIT 1").get();
  const src = db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (?, 'Test AI News', 'https://example.com/ai-news', 'rss')").run(div.id);
  db.prepare('INSERT INTO research_items (source_id, division_id, title, url, summary, evidence_text, published_at, fetched_at, is_outdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run(
    Number(src.lastInsertRowid),
    div.id,
    'How AI Is Changing Everyday Life',
    url,
    'Artificial intelligence is now part of everyday routines, from phone keyboards to music recommendations.',
    'Artificial intelligence is now part of everyday routines, from the keyboard on a phone to the recommendations in a music app. Most everyday AI is pattern-finding software.',
    '2026-11-19T00:00:00.000Z',
    new Date().toISOString(),
  );
  return div.id;
}

async function makeScaffoldArticle(env, db) {
  const res = await convertScaffoldToDraft(env, {
    title: 'Pipeline Audit Scaffold Article',
    division: 'ai-technology',
    outline: ['Introduction', 'How it works', 'Conclusion'],
    seoTitle: 'Pipeline Audit Scaffold Article',
    seoDescription: 'A scaffold article used only by the pipeline audit tests.',
    sources: [],
  });
  assert.equal(res.ok, true, 'scaffold converts to a draft article');
  return res.article.id;
}

describe('pipeline stages — Research and Evidence', () => {
  it('research: unknown division is an honest no-op, never done without candidates', async () => {
    const { env } = freshEnv();
    const res = await runResearch({ agent: 'research', kind: 'daily-research', payload: { division: 'no-such-division' } }, env);
    assert.equal(res.outcome, 'no-op');
    assert.match(res.reason, /No RSS source configured/);
    assert.deepEqual(res.candidates, undefined, 'no candidates are claimed');
  });

  it('research: with no D1 bound the handler reports no-op "no RSS source" — it cannot tell unbound DB from unconfigured sources', async () => {
    // OBSERVATION (not a live defect): d1All returns null without a
    // bound DB instead of throwing, so divisionGap yields [] and the
    // handler concludes "no source configured". Unreachable in
    // production — runTask 503s before dispatch when env.DB is absent
    // and the daily workflow returns early — but the reason misleads
    // if this handler is ever called directly without a DB.
    const res = await runResearch({ agent: 'research', kind: 'daily-research', payload: { division: 'ai-technology' } }, {});
    assert.equal(res.outcome, 'no-op');
    assert.match(res.reason, /No RSS source configured/);
  });

  it('evidence: an unresolvable URL is reported unresolved, never silently treated as evidence', async () => {
    const { env } = freshEnv();
    const { resolved, unresolved } = await resolveEvidence(env, ['https://example.com/nowhere']);
    assert.deepEqual(resolved, []);
    assert.deepEqual(unresolved, ['https://example.com/nowhere']);
  });

  it('evidence: a stored research item resolves with its id for the fact-checker and gate', async () => {
    const { db, env } = freshEnv();
    seedEvidence(db);
    const { resolved, unresolved } = await resolveEvidence(env, ['https://example.com/ai-everyday-life']);
    assert.equal(unresolved.length, 0);
    assert.equal(resolved.length, 1);
    assert.ok(resolved[0].researchItemId, 'research item id travels with the evidence');
    assert.match(resolved[0].evidenceText, /pattern-finding software/);
  });
});

describe('pipeline stages — Draft', () => {
  it('draft: a title under 5 characters fails input validation', async () => {
    const { env } = freshEnv();
    const res = await runContentCreation({ agent: 'content-creation', kind: 'daily-content', payload: { title: 'AI', division: 'ai-technology', sources: [] } }, env);
    assert.equal(res.outcome, 'failed');
    assert.match(res.error, /at least 5 characters/);
  });

  it('draft: an unknown division slug fails input validation', async () => {
    const { env } = freshEnv();
    const res = await runContentCreation({ agent: 'content-creation', kind: 'daily-content', payload: { title: 'A Real Title Here', division: 'no-such-division', sources: [] } }, env);
    assert.equal(res.outcome, 'failed');
    assert.match(res.error, /Unknown division slug/);
  });

  it('draft: no resolvable evidence is an honest no-op and writes no article row', async () => {
    const { db, env } = freshEnv();
    const before = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    const res = await runContentCreation({ agent: 'content-creation', kind: 'daily-content', payload: { title: 'A Real Title With No Evidence', division: 'ai-technology', sources: ['https://example.com/nowhere'] } }, env);
    assert.equal(res.outcome, 'no-op');
    assert.match(res.reason, /insufficient-evidence/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, before, 'no sourceless draft was written');
  });

  it('draft: evidence plus no LLM is an honest no-op, never a fabricated body', async () => {
    const { db, env } = freshEnv();
    seedEvidence(db);
    const res = await runContentCreation({ agent: 'content-creation', kind: 'daily-content', payload: { title: 'How AI Is Changing Everyday Life', division: 'ai-technology', sources: ['https://example.com/ai-everyday-life'] } }, env);
    assert.equal(res.outcome, 'no-op');
    assert.match(res.reason, /All free LLM providers unavailable/);
    assert.ok(!res.draft, 'no draft object is returned without an LLM body');
  });

  it('draft: evidence plus stubbed Workers AI returns a real LLM draft marked as needing fact-check', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    seedEvidence(db);
    const res = await runContentCreation({ agent: 'content-creation', kind: 'daily-content', payload: { title: 'How AI Is Changing Everyday Life', division: 'ai-technology', sources: ['https://example.com/ai-everyday-life'] } }, env);
    assert.equal(res.outcome, 'done');
    assert.equal(res.draft.provider, 'workers-ai', 'Workers AI only — no other provider');
    assert.equal(res.scaffold.llmGenerated, true);
    assert.match(res.scaffold.body, /pattern-finding software/);
    assert.equal(res.draft.needsFactCheck, true);
  });
});

describe('pipeline stages — Fact-check, Correction, Re-check', () => {
  it('fact-check: a missing article fails with a clear error', async () => {
    const { env } = freshEnv();
    const res = await runFactChecking({ agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 } }, env);
    assert.equal(res.outcome, 'failed');
    assert.match(res.error, /Article 99999 not found/);
  });

  it('fact-check: a scaffold body fails the verdict (advisory outcome done, verdict failed) and the row is body-hash bound', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    const res = await runFactChecking({ agent: 'fact-checking', kind: 'fact-check', payload: { article_id: articleId } }, env);
    assert.equal(res.outcome, 'done', 'the check itself completed');
    assert.equal(res.verdict, 'failed', 'a scaffold has no content to verify — the verdict says so');
    const row = db.prepare('SELECT * FROM fact_checks WHERE article_id = ? ORDER BY id DESC LIMIT 1').get(articleId);
    assert.ok(row, 'the check wrote an audit row');
    assert.ok(row.body_hash, 'the row is bound to the body it checked (migration 019)');
  });

  it('re-check: a recheck writes a NEW fact_checks row instead of returning the old verdict', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    await runFactChecking({ agent: 'fact-checking', kind: 'fact-check', payload: { article_id: articleId } }, env);
    const first = db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(articleId).n;
    const res = await runFactChecking({ agent: 'fact-checking', kind: 'fact-check', payload: { article_id: articleId, check_kind: 'recheck' } }, env);
    assert.equal(res.outcome, 'done');
    const second = db.prepare('SELECT COUNT(*) AS n FROM fact_checks WHERE article_id = ?').get(articleId).n;
    assert.equal(second, first + 1, 'a re-check is a fresh check, not a re-read of the old row');
  });

  it('correction: a missing article fails through the task path, and a truncated correction output is detected, never saved as complete', async () => {
    const { env } = freshEnv();
    // The task path validates the article first, so a correction for a
    // missing article fails with a clear error (runCorrection itself
    // assumes a validated article — its only caller is runFactChecking,
    // which checks first; a direct null call throws a raw TypeError,
    // caught as 'failed' by runAutonomyTask, never silent).
    const missing = await runFactChecking({ agent: 'fact-checking', kind: 'correct', payload: { article_id: 99999 } }, env);
    assert.equal(missing.outcome, 'failed');
    assert.match(missing.error, /Article 99999 not found/);
    // #30-style truncation: the correction ends mid-word ("broke" for "broken").
    const original = 'If you only have three days to explore New York City, a local travel guide can help. Three days are broken into neighbourhood walks.';
    const truncated = 'If you only have three days to explore New York City, a local travel guide can help. Three days are broke';
    const flagged = detectTruncatedBody(original, truncated);
    assert.ok(flagged, 'mid-word truncation is flagged');
    assert.match(flagged.reasons.join(' '), /truncated/);
    assert.equal(detectTruncatedBody(original, original), null, 'an unchanged body is not a truncation');
  });
});

describe('pipeline stages — SEO, Quality Gate, Approval', () => {
  it('seo: a missing article fails input validation', async () => {
    const { env } = freshEnv();
    const res = await runSeo({ agent: 'seo', kind: 'seo-pass', payload: { article_id: 99999 } }, env);
    assert.equal(res.outcome, 'failed');
    assert.match(res.error, /Article 99999 not found/);
  });

  it('seo: a draft check stores its verdict bound to the body hash (migration 023)', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    const res = await runSeo({ agent: 'seo', kind: 'seo-pass', payload: { article_id: articleId } }, env);
    assert.equal(res.outcome, 'done');
    assert.ok(res.seoCheckId, 'the check wrote a seo_checks row');
    assert.ok(res.bodyHash, 'the result carries the body hash it checked');
    const row = db.prepare('SELECT * FROM seo_checks WHERE id = ?').get(res.seoCheckId);
    assert.equal(row.body_hash, res.bodyHash, 'stored hash matches the checked body');
    assert.equal(row.body_length, res.bodyLength);
  });

  it('gate: a draft with no fact-check is refused, with the blocker named', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    const gate = await evaluatePublishGate(env, articleId);
    assert.equal(gate.eligible, false);
    assert.ok(gate.blockedBy.some((b) => /No fact-check/.test(b)), 'the blocker names the missing fact-check');
  });

  it('gate: a fact-check that predates a body edit is stale and fail-closed', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    const checked = await runFactChecking({ agent: 'fact-checking', kind: 'fact-check', payload: { article_id: articleId } }, env);
    assert.ok(checked.verdict, 'a check ran first');
    // Simulate a body edit after the check: the stored hash no longer matches.
    db.prepare("UPDATE articles SET body = body || '\n\nAn edited paragraph added after the fact-check.' WHERE id = ?").run(articleId);
    const gate = await evaluatePublishGate(env, articleId);
    assert.equal(gate.eligible, false, 'an edited article never keeps an old verdict at the gate');
    assert.ok(gate.blockedBy.some((b) => /stale/.test(b)), 'the blocker names staleness');
  });

  it('approval: legacy drafts #28-#31 are refused by id, unconditionally', () => {
    for (const id of [28, 29, 30, 31]) {
      const v = evaluateAutoPublishEligibilityPure({
        article: { id, division: 'automotive', created_at: new Date().toISOString() },
      });
      assert.equal(v.eligible, false, `#${id} is never auto-eligible`);
      assert.ok(v.blockedBy.join(' ').includes(String(id)), 'the refusal names the legacy id');
    }
  });

  it('approval: Health division is never auto-eligible (special human review, always)', () => {
    const v = evaluateAutoPublishEligibilityPure({
      article: { id: 99, division: 'health-wellness', created_at: new Date().toISOString(), body: 'General information only. Take care.' },
      factCheck: { verdict: 'pass' },
      currentBodyHash: 'abc',
      seoCheck: { verdict: 'pass' },
      sources: [{ source_url: 'https://example.com/health-source' }],
      bannerClean: true,
      emergencyStopOff: true,
      publishingMode: 'auto',
      autoPublishing: 'on',
      autoPublishEligibleSince: new Date(Date.now() - 86400000).toISOString(),
    });
    assert.equal(v.eligible, false, 'Health never auto-publishes even when every other check passes');
    const special = v.checks.find((c) => c.name === 'special-review');
    assert.ok(special, 'the special-review check ran');
    assert.equal(special.ok, false);
  });
});

describe('pipeline stages — Publication and Analytics', () => {
  it('publication: auto-publish refuses (blocked, nothing published) when the audit table is missing', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    const res = await autoPublishArticle(env, articleId);
    assert.equal(res.ok, false);
    assert.equal(res.outcome, 'blocked');
    assert.match(res.reason, /publication_logs table is missing/);
    assert.equal(db.prepare("SELECT status FROM articles WHERE id = ?").get(articleId).status, 'draft', 'nothing was published');
  });

  it('publication: runAutoPublish no-ops while publishing_mode is approved_only (live default)', async () => {
    const { env } = freshEnv();
    const res = await runAutoPublish(env);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'no-op');
    assert.equal(res.published, 0);
    assert.equal(res.attempted, 0);
    assert.match(res.reason, /approved_only/);
  });

  it('analytics: no analytics source is an honest no-op — Data unavailable, revenue $0.00', async () => {
    const { env } = freshEnv();
    const res = await runAnalytics({ agent: 'analytics', kind: 'snapshot', payload: {} }, env);
    assert.equal(res.outcome, 'no-op');
    assert.match(res.reason, /no real analytics source connected/);
    assert.equal(res.visitors, 'Data unavailable');
    assert.equal(res.pageViews, 'Data unavailable');
    assert.equal(res.clicks, 'Data unavailable');
    assert.equal(res.revenue, 0);
    assert.equal(res.revenueFormatted, '$0.00');
    assert.match(res.note, /Data unavailable/);
  });

  it('social: an unpublished article gets no pack (honest no-op)', async () => {
    const { db, env } = freshEnv();
    const articleId = await makeScaffoldArticle(env, db);
    const res = await runSocialMedia({ agent: 'social-media', kind: 'social-pack', payload: { article_id: articleId } }, env);
    assert.equal(res.outcome, 'no-op');
    assert.match(res.reason, /not published/);
  });

  it('social: a published article prepares draft packs only — and a fully failed pack store reports failed (GAP WS-B-S1 fixed 2026-11-21)', async () => {
    // The test DB has no migration 022 tables, so every createPost
    // throws and is recorded per platform. The pack text is honest
    // ("nothing was posted"), and since the S1 fix the top-level
    // outcome is 'failed' too — a pack that stored no draft anywhere
    // must not report 'done'.
    const { env } = freshEnv();
    const published = await runSocialMedia({ agent: 'social-media', kind: 'social-pack', payload: { article_id: 1 } }, env);
    assert.equal(published.outcome, 'failed', 'a fully failed store reports failed, never done');
    assert.match(published.error, /No social draft could be stored/);
    assert.ok(Array.isArray(published.draftPosts) && published.draftPosts.length > 0);
    for (const p of published.draftPosts) {
      assert.equal(p.ok, false, `platform ${p.platform} records its store failure`);
      assert.ok(p.error, `platform ${p.platform} names the error`);
    }
    assert.match(published.note, /no post was made/);
  });
});
