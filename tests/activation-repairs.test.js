// FS AI — Activation repair regression tests (2026-11-20).
//
// One file, one test per repaired issue from the 2026-11-19 full live
// verification (docs/FULL-LIVE-VERIFICATION-2026-11-19.md):
//  A. Evidence to generator — a draft is only written when a supplied
//     source resolves to stored research (covered in
//     tests/autonomy-content-draft.test.js + tests/autonomy-llm.test.js).
//  B. Article-specific evidence isolation — unrelated evidence (same
//     division, different article — the article #27 motorcycle case)
//     cannot enter another article's fact-check or correction.
//  C. Source persistence — convert records article_sources rows with
//     an allowed source_type + research_item_id, idempotently.
//  D. Fact-check + correction — no-evidence correction marks claims
//     for human review instead of removing them (covered in
//     tests/factcheck-claims.test.js); corrections record evidence_url.
//  E. SEO repair — inadequate nonblank fields are repaired from real
//     content (meta description, H2 headings, internal link).
//  F. Publishing gate — the 10 checks are individually visible with
//     name/ok/detail, and content-ready is distinct from eligible.
//  Plus: digital-tools registry entry, RSS counter reconciliation,
//  Workers AI model list (20 Nov 2026 removal verified).
//
// Real SQLite database (schema + seed + migrations 005/006/008/009/
// 010/011/012). No network except stubbed fetches.
// Run: node --test tests/activation-repairs.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const { setEmergencyStop } = require('../backend/routes/admin.js');
const { checkArticle, runCorrection } = require('../backend/agents/autonomy/factcheck.js');
const { convertScaffoldToDraft } = require('../backend/agents/autonomy/content.js');
const { runSeo } = require('../backend/agents/autonomy/seo.js');
const { evaluatePublishGate } = require('../backend/publishing/gate.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');
const { fetchSource, loadAllSources } = require('../backend/rss/sources.js');
const { DIVISION_RESEARCH_REGISTRY } = require('../backend/agents/autonomy-runner.js');
const { WORKERS_AI_MODELS, NEURON_RATES } = require('../backend/llm/providers/cloudflare-workers-ai.js');

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
    'database/migrations/019_factcheck_body_hash.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function loadArticle(db, id) {
  return db.prepare(
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ?',
  ).get(id);
}

function insertArticle(db, body, { divisionId = 1, status = 'draft', seoTitle = null, seoDescription = null } = {}) {
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).run(divisionId, `Test Article ${Date.now()}${Math.random()}`, `test-article-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'Test excerpt.', body, 'FS AI', status, seoTitle, seoDescription);
  return Number(r.lastInsertRowid);
}

function insertResearchItem(db, { title, url, summary, evidence, divisionId = 1 }) {
  const src = db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (?, ?, ?, 'rss')")
    .run(divisionId, `Test Source ${url}`, `https://example.com/feed-${encodeURIComponent(url)}`);
  const r = db.prepare(
    'INSERT INTO research_items (source_id, division_id, title, url, summary, evidence_text, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(Number(src.lastInsertRowid), divisionId, title, url, summary, evidence, '2026-11-19T00:00:00.000Z', new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function addArticleSource(db, articleId, url, researchItemId = null) {
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, ?, ?, 'research', ?, ?)",
  ).run(articleId, url, url, researchItemId, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// B. Article-specific evidence isolation (the article #27 case).
// ---------------------------------------------------------------------------
describe('repair B — evidence isolation', () => {
  // Same division, different article: the Cybercab article's own source
  // is the Cybercab item; the motorcycle item is automotive too, but it
  // belongs to a DIFFERENT article. The old division-wide pool verified
  // the motorcycle claim and the correction imported its statistic.
  const CYBERCAB_URL = 'https://example.com/cybercab-berlin';
  const MOTO_URL = 'https://example.com/motorcycle-sales';

  it('a claim supported only by an unrelated same-division item is NOT verified', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, {
      title: 'Motorcycle sales rose in 2025',
      url: MOTO_URL,
      summary: 'Motorcycle sales rose 20 percent worldwide in 2025.',
      evidence: 'Motorcycle sales rose 20 percent worldwide in 2025, according to industry data.',
    });
    const cybercabItemId = insertResearchItem(db, {
      title: 'Tesla Cybercab factory at Giga Berlin',
      url: CYBERCAB_URL,
      summary: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
      evidence: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
    });
    const id = insertArticle(db, 'The Cybercab factory will open in Berlin in 2026. Motorcycle sales rose 20 percent in 2025.');
    addArticleSource(db, id, CYBERCAB_URL, cybercabItemId);
    const r = await checkArticle(env, loadArticle(db, id));
    const claims = db.prepare('SELECT claim_text, verdict FROM claim_checks WHERE fact_check_id = ?').all(r.factCheckId);
    const cybercab = claims.find((c) => /Cybercab/.test(c.claim_text));
    const moto = claims.find((c) => /Motorcycle/.test(c.claim_text));
    assert.equal(cybercab.verdict, 'VERIFIED', 'own-source claim verifies');
    assert.notEqual(moto.verdict, 'VERIFIED', 'unrelated-item claim must not verify');
    assert.equal(moto.verdict, 'UNSUPPORTED', 'no own evidence supports it');
    assert.equal(r.verdict, 'needs-review');
  });

  it('correction never rewrites a claim from the unrelated item', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, {
      title: 'Motorcycle sales rose in 2025',
      url: MOTO_URL,
      summary: 'Motorcycle sales rose 20 percent worldwide in 2025.',
      evidence: 'Motorcycle sales rose 20 percent worldwide in 2025, according to industry data.',
    });
    const cybercabItemId = insertResearchItem(db, {
      title: 'Tesla Cybercab factory at Giga Berlin',
      url: CYBERCAB_URL,
      summary: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
      evidence: 'Tesla is building a Cybercab factory at Giga Berlin, opening in 2026.',
    });
    const id = insertArticle(db, 'The Cybercab factory will open in Berlin in 2026. Motorcycle sales rose 20 percent in 2025.');
    addArticleSource(db, id, CYBERCAB_URL, cybercabItemId);
    await checkArticle(env, loadArticle(db, id));
    const r = await runCorrection(env, loadArticle(db, id));
    assert.equal(r.outcome, 'done');
    const body = db.prepare('SELECT body FROM articles WHERE id = ?').get(id).body;
    assert.ok(!body.includes('Motorcycle'), 'unsupported sentence removed, not rewritten from the unrelated item');
    assert.ok(body.includes('Cybercab'), 'own-source sentence kept');
    const corrections = db.prepare('SELECT * FROM article_corrections WHERE article_id = ?').all(id);
    for (const c of corrections) {
      assert.notEqual(c.evidence_url, MOTO_URL, 'no correction may cite the unrelated item');
    }
  });

  it('cross-division evidence cannot enter another article either', async () => {
    const { db, env } = freshEnv();
    insertResearchItem(db, {
      title: 'Motorcycle sales rose in 2025',
      url: MOTO_URL,
      summary: 'Motorcycle sales rose 20 percent worldwide in 2025.',
      evidence: 'Motorcycle sales rose 20 percent worldwide in 2025, according to industry data.',
      divisionId: 1,
    });
    const aiItemId = insertResearchItem(db, {
      title: 'AI assistants draft emails',
      url: 'https://example.com/ai-email',
      summary: 'AI assistants now draft 40 emails a day for busy people.',
      evidence: 'AI assistants now draft 40 emails a day for busy people.',
      divisionId: 2,
    });
    const id = insertArticle(db, 'AI assistants now draft 40 emails a day. Motorcycle sales rose 20 percent in 2025.', { divisionId: 2 });
    addArticleSource(db, id, 'https://example.com/ai-email', aiItemId);
    const r = await checkArticle(env, loadArticle(db, id));
    const claims = db.prepare('SELECT claim_text, verdict FROM claim_checks WHERE fact_check_id = ?').all(r.factCheckId);
    assert.equal(claims.find((c) => /AI assistants/.test(c.claim_text)).verdict, 'VERIFIED');
    assert.equal(claims.find((c) => /Motorcycle/.test(c.claim_text)).verdict, 'UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// C. Source persistence — idempotent, allowed source_type, linked ids.
// ---------------------------------------------------------------------------
describe('repair C — source persistence', () => {
  it('convert records sources once, with allowed types and research links', async () => {
    const { db, env } = freshEnv();
    const itemId = insertResearchItem(db, {
      title: 'Home charging guide',
      url: 'https://example.com/home-charging',
      summary: 'Home charging is the cheapest option.',
      evidence: 'Home charging is the cheapest option for most drivers.',
    });
    const scaffold = {
      title: 'Home Charging Basics for Beginners',
      division: 'automotive',
      divisionId: 1,
      outline: ['Introduction', 'Conclusion'],
      seoTitle: 'Home Charging Basics for Beginners',
      seoDescription: 'A plain-language guide to home charging for beginners.',
      sources: [
        'https://example.com/home-charging',
        'https://example.com/home-charging', // duplicate — must not double-insert
        'https://example.com/never-fetched',
        'Plain text source',
      ],
      evidence: [{ url: 'https://example.com/home-charging', researchItemId: itemId }],
      sourceIds: [itemId],
      note: 'SCAFFOLD',
    };
    const res = await convertScaffoldToDraft(env, scaffold);
    assert.equal(res.ok, true);
    assert.equal(res.sourcesRecorded, 3, 'three distinct sources recorded');
    assert.equal(res.sourcesDeduped, 1, 'the duplicate URL was skipped, not double-inserted');
    assert.deepEqual(res.sourceErrors, []);
    const rows = db.prepare('SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC').all(res.article.id);
    assert.equal(rows.length, 3);
    const rssRow = rows.find((r) => r.source_url === 'https://example.com/home-charging');
    assert.equal(rssRow.source_type, 'research', 'RSS item uses the CHECK-allowed type');
    assert.equal(rssRow.research_item_id, itemId, 'linked to the stored research item');
    const webRow = rows.find((r) => r.source_url === 'https://example.com/never-fetched');
    assert.equal(webRow.source_type, 'other', 'unfetched URL uses the allowed fallback type');
    assert.equal(webRow.research_item_id, null);
    const plainRow = rows.find((r) => r.source_url === null);
    assert.equal(plainRow.source_title, 'Plain text source');
    assert.equal(plainRow.source_type, 'other');
  });

  it('an article with no sources is still convertible and the gate sees it as unsourced', async () => {
    const { db, env } = freshEnv();
    const res = await convertScaffoldToDraft(env, {
      title: 'Sourceless Scaffold Test', division: 'automotive', divisionId: 1,
      outline: ['Introduction'], seoTitle: 'Sourceless Scaffold Test',
      seoDescription: 'A scaffold with no sources at all.', sources: [], note: 'SCAFFOLD',
    });
    assert.equal(res.ok, true);
    assert.equal(res.sourcesRecorded, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ?').get(res.article.id).n, 0);
    const gate = await evaluatePublishGate(env, res.article.id);
    const sourcesCheck = gate.checks.find((c) => c.name === 'sources-verified');
    assert.equal(sourcesCheck.ok, false, 'gate distinguishes sourced from unsourced');
    assert.match(sourcesCheck.detail, /0 source/);
  });
});

// ---------------------------------------------------------------------------
// E. SEO repair of inadequate nonblank fields.
// ---------------------------------------------------------------------------
describe('repair E — SEO repair', () => {
  const LONG_PARA = 'Charging an electric car at home is usually the cheapest option for most drivers. A home charger plugs into the car overnight and fills the battery while you sleep. Most drivers find that home charging covers daily driving with ease and saves money every month.';

  it('repairs a short description, promotes H3s to H2s, and adds a real internal link', async () => {
    const { db, env } = freshEnv();
    env.__fetchImpl = async () => new Response('', { status: 200 });
    // A published sibling in the same division for the internal link.
    db.prepare("INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, published_at) VALUES (1, 'Published Sibling Article', 'published-sibling', 'x', 'Sibling body text here.', 'FS AI', 'published', 0, '2026-11-19T00:00:00.000Z')").run();
    const body = [
      '### First section', '', LONG_PARA, '',
      '### Second section', '', LONG_PARA, '',
      '### Third section', '', LONG_PARA,
    ].join('\n');
    const id = insertArticle(db, body, { seoTitle: 'EV Charging at Home: A Complete Beginner\'s Guide', seoDescription: 'Too short.' });
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    assert.ok(r.repairs.length >= 3, `expected 3 repairs, got: ${r.repairs.join(' | ')}`);
    const row = db.prepare('SELECT seo_description, body FROM articles WHERE id = ?').get(id);
    assert.ok(row.seo_description.length >= 120 && row.seo_description.length <= 160,
      `repaired description is ${row.seo_description.length} chars`);
    assert.ok(!row.seo_description.includes('Too short'), 'old short description replaced');
    const h2Count = (row.body.match(/^##\s.+$/gm) || []).length;
    const h3Count = (row.body.match(/^###\s.+$/gm) || []).length;
    assert.ok(h2Count >= 2, `expected >=2 H2s after promotion, got ${h2Count}`);
    assert.equal(h3Count, 1, 'one H3 remains (only 2 were promoted)');
    assert.match(row.body, /Related reading: \[Published Sibling Article\]\(https:\/\/fs-ai-5w5\.pages\.dev\/pages\/article\?id=\d+\)/,
      'a genuine link to the published sibling was appended (clean form — no .html, per the 2026-11-20 indexing fix)');
    const revisions = db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n;
    assert.equal(revisions, 1, 'pre-edit body stored as a revision first');
    const checks = db.prepare('SELECT checks_json FROM seo_checks WHERE article_id = ?').get(id);
    const parsed = JSON.parse(checks.checks_json);
    assert.equal(parsed.length, 11, 'all 11 SEO checks stored individually');
    assert.ok(parsed.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean' && typeof c.detail === 'string'));
  });

  it('never modifies a published article, even when its SEO fields are inadequate', async () => {
    const { db, env } = freshEnv();
    env.__fetchImpl = async () => new Response('', { status: 200 });
    const id = insertArticle(db, `### Only heading\n\n${LONG_PARA}`, {
      status: 'published', seoTitle: 'Published Article Title Here', seoDescription: 'Too short.',
    });
    const before = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    const r = await runSeo({ kind: 'seo', payload: { article_id: id } }, env);
    assert.equal(r.outcome, 'done');
    assert.deepEqual(r.repairs, [], 'no repairs on a published article');
    const after = db.prepare('SELECT body, seo_description FROM articles WHERE id = ?').get(id);
    assert.equal(after.body, before.body, 'published body untouched');
    assert.equal(after.seo_description, 'Too short.', 'published description untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?').get(id).n, 0);
  });
});

// ---------------------------------------------------------------------------
// F. Publishing gate — 10 individually visible checks.
// ---------------------------------------------------------------------------
describe('repair F — gate visibility data', () => {
  const EXPECTED_CHECKS = [
    'fact-check-pass', 'no-unresolved-errors', 'sources-verified', 'correction-recheck',
    'seo-pass', 'duplicate-pass', 'special-review',
    'emergency-stop-off', 'daily-limit', 'publishing-rules',
  ];

  it('returns all 10 checks with name/ok/detail and distinguishes content-ready from eligible', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Home charging is simple and cheap.');
    // A passing fact-check + SEO run + one recorded source, so every
    // content check passes; only the publishing-rules check (approved_only)
    // keeps the article from being eligible. The seeded fact-check is a
    // genuinely FRESH run: its body_hash matches the article body,
    // exactly as checkArticle would record it (migration 019) — a
    // hash-less legacy row is stale at the gate.
    db.prepare("INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, 'pass', 1, 1, 0, ?)").run(id, await bodyHash('Home charging is simple and cheap.'));
    db.prepare("INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, 'pass', ?)").run(id, JSON.stringify([{ name: 'duplicate', ok: true, status: 'pass', detail: 'No duplicate found.' }]));
    db.prepare("INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test Source', 'https://example.com/source', 'research', ?)").run(id, new Date().toISOString());
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.checks.length, 10, 'exactly 10 checks');
    assert.deepEqual(gate.checks.map((c) => c.name), EXPECTED_CHECKS);
    for (const c of gate.checks) {
      assert.equal(typeof c.ok, 'boolean', `${c.name} has a boolean ok`);
      assert.ok(typeof c.detail === 'string' && c.detail.length > 0, `${c.name} explains itself`);
    }
    assert.equal(gate.contentReady, true, 'content-ready: all content checks pass');
    assert.equal(gate.eligible, false, 'eligible is false while publishing is approved_only');
    assert.equal(gate.publishingMode, 'approved_only');
    const rules = gate.checks.find((c) => c.name === 'publishing-rules');
    assert.equal(rules.ok, false);
    assert.match(rules.detail, /approved_only/);
  });

  it('a draft with no fact-check is content-not-ready and says so per check', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Home charging is simple and cheap.');
    const gate = await evaluatePublishGate(env, id);
    assert.equal(gate.contentReady, false);
    assert.equal(gate.eligible, false);
    assert.equal(gate.checks.find((c) => c.name === 'fact-check-pass').ok, false);
    assert.match(gate.checks.find((c) => c.name === 'fact-check-pass').detail, /No fact-check on record/);
    assert.equal(gate.checks.find((c) => c.name === 'sources-verified').ok, false);
  });
});

function autonomyReq(method, pathName, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (body !== undefined) {
    return new Request(`http://localhost${pathName}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`http://localhost${pathName}`, { method, headers });
}

async function callAutonomy(env, method, pathName, body) {
  const res = await handleAutonomy(autonomyReq(method, pathName, body), env, {}, null);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Daily-run button: real execution status (never success for a no-op).
// ---------------------------------------------------------------------------
describe('daily-run endpoint status', () => {
  it('first run completes, second run without force is already_completed, force re-runs', async () => {
    const { db, env } = freshEnv();
    const first = await callAutonomy(env, 'POST', '/api/autonomy/run-daily');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'completed', 'first run really ran');
    assert.ok(first.body.reportId, 'a report row id is returned');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);

    const second = await callAutonomy(env, 'POST', '/api/autonomy/run-daily');
    assert.equal(second.status, 200);
    assert.equal(second.body.status, 'already_completed', 'a no-op is reported as already_completed, not success');
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.reportId, first.body.reportId, 'same report row, no duplicate');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);

    const forced = await callAutonomy(env, 'POST', '/api/autonomy/run-daily', { force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.status, 'completed', 'an explicit manual re-run really runs');
    assert.equal(forced.body.reportId, first.body.reportId, 'forced re-run upserts the same row');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 1);
  });

  it('Emergency Stop on: run-daily answers 423 with status blocked', async () => {
    const { db, env } = freshEnv();
    await setEmergencyStop(env, true);
    const r = await callAutonomy(env, 'POST', '/api/autonomy/run-daily', { force: true });
    assert.equal(r.status, 423);
    assert.equal(r.body.status, 'blocked');
    assert.equal(r.body.skipped, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'daily'").get().n, 0,
      'no report row while stopped');
  });
});

// ---------------------------------------------------------------------------
// Per-article SEO endpoint + status lastRuns.
// ---------------------------------------------------------------------------
describe('seo endpoint and status lastRuns', () => {
  it('GET /api/autonomy/seo returns the latest check with all 11 checks parsed', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, 'Home charging is simple and cheap.');
    const empty = await callAutonomy(env, 'GET', `/api/autonomy/seo?article_id=${id}`);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.seoCheck, null);
    assert.deepEqual(empty.body.checks, []);

    const checks = Array.from({ length: 11 }, (_, i) => ({ name: `check-${i + 1}`, ok: i !== 3, status: i !== 3 ? 'pass' : 'failed', detail: `detail ${i + 1}` }));
    db.prepare("INSERT INTO seo_checks (article_id, verdict, checks_json) VALUES (?, 'failed', ?)").run(id, JSON.stringify(checks));
    const r = await callAutonomy(env, 'GET', `/api/autonomy/seo?article_id=${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.seoCheck.verdict, 'failed');
    assert.equal(r.body.checks.length, 11, 'all 11 checks are individually visible');
    assert.equal(r.body.checks[3].ok, false);
    assert.equal(r.body.checks[3].detail, 'detail 4');
    const bad = await callAutonomy(env, 'GET', '/api/autonomy/seo');
    assert.equal(bad.status, 400, 'article_id is required');
  });

  it('GET /api/autonomy/status reports last run + last result per agent and all 8 research agents', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (NULL, 'seo', '2026-11-20T00:00:00.000Z', '2026-11-20T00:01:00.000Z', 'failed', ?)").run(JSON.stringify({ reason: 'Test failure reason' }));
    db.prepare("INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (NULL, 'research', '2026-11-20T00:00:00.000Z', '2026-11-20T00:02:00.000Z', 'done', ?)").run(JSON.stringify({ result: { added: 3 } }));
    const r = await callAutonomy(env, 'GET', '/api/autonomy/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.lastRuns.seo.outcome, 'failed');
    assert.equal(r.body.lastRuns.seo.reason, 'Test failure reason', 'the failure reason is surfaced, not hidden');
    assert.equal(r.body.lastRuns.research.outcome, 'done');
    assert.deepEqual(Object.keys(r.body.autoFlags).sort(), [
      'auto_correction', 'auto_factcheck', 'auto_generation', 'auto_publishing', 'auto_research',
    ]);
    const research = r.body.agents.find((a) => a.id === 'research');
    assert.ok(research, 'research collective is listed');
    assert.equal(research.agents.length, 8, 'all 8 division research agents are in the collective');
    assert.ok(research.agents.some((a) => a.id === 'digital-tools-agent'), 'digital-tools is in the collective');
  });
});
describe('RSS counter reconciliation', () => {
  const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>Counter Item Alpha One</title><link>https://example.com/counter-alpha</link><pubDate>Wed, 19 Nov 2026 10:00:00 GMT</pubDate><description>Alpha summary.</description></item>
<item><title>Counter Item Beta Two</title><link>https://example.com/counter-beta</link><pubDate>Wed, 19 Nov 2026 10:00:00 GMT</pubDate><description>Beta summary.</description></item>
</channel></rss>`;
  const stubFetch = (xml) => async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });

  it('items_discovered is cumulative newly-inserted; a re-fetch adds duplicates only and never changes it', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (1, 'Counter Feed', 'https://example.com/counter-feed.xml', 'rss')").run();
    const source = db.prepare("SELECT s.*, d.slug AS division FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.url = 'https://example.com/counter-feed.xml'").get();
    const first = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(first.fetched, 2);
    assert.equal(first.added, 2);
    assert.equal(first.duplicates, 0);
    let row = db.prepare('SELECT items_discovered, duplicates_found FROM research_sources WHERE id = ?').get(source.id);
    assert.equal(row.items_discovered, 2, 'discovered = newly inserted');
    assert.equal(row.duplicates_found, 0);

    const second = await fetchSource(env, source, { fetchImpl: stubFetch(RSS_SAMPLE) });
    assert.equal(second.added, 0, 'nothing new on re-fetch');
    assert.equal(second.duplicates, 2, 'both items are duplicates on re-fetch');
    row = db.prepare('SELECT items_discovered, duplicates_found FROM research_sources WHERE id = ?').get(source.id);
    assert.equal(row.items_discovered, 2, 'discovered UNCHANGED by the re-fetch');
    assert.equal(row.duplicates_found, 2, 'duplicates accumulate');

    // Reconciliation identity: the stored counter equals the real row count.
    const stored = db.prepare('SELECT COUNT(*) AS n FROM research_items WHERE source_id = ?').get(source.id).n;
    assert.equal(row.items_discovered, stored, 'SUM(items_discovered) == COUNT(research_items)');
    const totalDiscovered = db.prepare('SELECT COALESCE(SUM(items_discovered), 0) AS n FROM research_sources').get().n;
    const totalItems = db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n;
    assert.equal(totalDiscovered, totalItems);
  });

  it('reading the sources list twice does not change any stored counter', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO research_sources (division_id, name, url, source_type, items_discovered, duplicates_found) VALUES (1, 'Seeded Feed', 'https://example.com/seeded.xml', 'rss', 7, 3)").run();
    const before = await loadAllSources(env);
    const again = await loadAllSources(env);
    assert.deepEqual(again, before, 'a read is a read — no recompute on load');
    const row = db.prepare('SELECT items_discovered, duplicates_found FROM research_sources WHERE url = ?').get('https://example.com/seeded.xml');
    assert.equal(row.items_discovered, 7);
    assert.equal(row.duplicates_found, 3);
  });
});

// ---------------------------------------------------------------------------
// Digital-tools registry + Workers AI model list.
// ---------------------------------------------------------------------------
describe('registry and model list', () => {
  it('digital-tools has a research registry entry, so pausing its agent blocks its research', () => {
    assert.equal(DIVISION_RESEARCH_REGISTRY['digital-tools'], 'digital-tools-agent');
    assert.equal(Object.keys(DIVISION_RESEARCH_REGISTRY).length, 8, 'all 8 divisions are registered');
    for (const [division, agentId] of Object.entries(DIVISION_RESEARCH_REGISTRY)) {
      assert.equal(typeof agentId, 'string');
      assert.ok(agentId.length > 0, `${division} has a non-empty agent id`);
    }
  });

  it('Workers AI model list contains only models verified available on 20 Nov 2026', () => {
    assert.deepEqual(WORKERS_AI_MODELS, [
      '@cf/openai/gpt-oss-20b',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/zai-org/glm-4.7-flash',
      '@cf/openai/gpt-oss-120b',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/ibm-granite/granite-4.0-h-micro',
    ]);
    assert.ok(!WORKERS_AI_MODELS.includes('@cf/meta/llama-3.1-8b-instruct-fp8-fast'),
      'the unconfirmed Llama 3.1 fp8-fast entry was removed');
    assert.ok(!WORKERS_AI_MODELS.includes('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'),
      'removed models stay out');
    assert.ok(!WORKERS_AI_MODELS.includes('@cf/google/gemma-3-12b-it'),
      'earlier-removed models stay out');
    for (const model of WORKERS_AI_MODELS) {
      assert.ok(NEURON_RATES[model], `${model} has a Neuron rate for usage accounting`);
      assert.ok(NEURON_RATES[model].in > 0 && NEURON_RATES[model].out > 0);
    }
  });
});
