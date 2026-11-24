// FS AI — Fix Pass 4 F3 tests (2026-11-24).
//
// F3 fixes the research double-fetch + the lying daily counts, wires
// full-text evidence (article-fetch) into the daily path for drafts the
// drain just created, and corrects the duplicate-overlap wording that
// misstated the comparator as "another published article".
//
// Suits:
//   F3.1 summarizeDrainedResearch — pure unit tests.
//   F3.2 researchFetch skip + honest counts — full runDailyWorkflow
//        with stubbed fetch: the drain fetches the 2 thinnest
//        divisions, the inline step skips them, the daily counts report
//        the drain's stored items, and each feed URL is fetched once.
//   F3.3 evidence-enrich — full runDailyWorkflow: a daily-content task
//        the drain converts gets its full source text fetched before
//        fact-checking; the article_sources row is re-pointed at the
//        full-text research item.
//   F3.4 enrichDraftEvidence — direct helper tests: Guardian-style
//        refusal leaves the snippet evidence in place; a fetch throw
//        never escapes the helper.
//   F3.5 duplicate wording — the gate's duplicate-zero-overlap detail
//        names "another article", never "another published article".
//
// Run: node --test tests/fixpass4-f3.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runDailyWorkflow, summarizeDrainedResearch, enrichDraftEvidence,
} = require('../backend/routes/scheduler.js');
const { evaluateAutoPublishEligibilityPure } = require('../backend/publishing/gate.js');

const ROOT = path.join(__dirname, '..');

// Split a SQL file into statements (copied from tests/real-db.test.js).
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

// Minimal D1-compatible adapter over node:sqlite (copied from
// tests/autonomy-scheduler.test.js).
function makeRealD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (params) => ({
        all: () => Promise.resolve({ results: stmt.all(...params) }),
        run: () => Promise.resolve((() => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        })()),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
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

function freshEnv({ extraFiles = [], extraEnv = {} } = {}) {
  const db = buildDb([...BASE_FILES, ...extraFiles]);
  return { db, env: { DB: makeRealD1(db), ...extraEnv } };
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** The two thinnest divisions, mirroring divisionCounts' ORDER BY. */
function thinnestDivisions(db) {
  return db.prepare(
    'SELECT d.id, d.slug AS division FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id '
    + 'GROUP BY d.id, d.slug, d.name ORDER BY SUM(CASE WHEN a.status = \'published\' THEN 1 ELSE 0 END) ASC, COUNT(a.id) ASC LIMIT 2',
  ).all();
}

function dailySummary(db) {
  const row = db.prepare("SELECT summary_json FROM daily_reports WHERE kind = 'daily' ORDER BY id DESC LIMIT 1").get();
  return row ? JSON.parse(row.summary_json) : null;
}

// The daily report's summary.steps stores only { outcome, error } per
// step — the full step result lives in the agent_runs detail row the
// step() wrapper writes ({ step: label, ...result }).
function stepResult(db, label) {
  const rows = db.prepare('SELECT detail FROM agent_runs').all();
  for (const r of rows) {
    try {
      const d = JSON.parse(r.detail);
      if (d && d.step === label) return d;
    } catch { /* not JSON — ignore */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetch stubbing (F1 pattern: replace global.fetch, restore after).
// ---------------------------------------------------------------------------
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const HEALTH_CHECKS_STUB = {
  pages: { status: 'OK', detail: 'stubbed in test' },
  sitemap: { status: 'OK', detail: 'stubbed in test' },
  recentArticles: { status: 'OK', detail: 'stubbed in test' },
  sitemapRefresh: { status: 'OK', detail: 'stubbed in test' },
  serverSideHeads: { status: 'OK', detail: 'stubbed in test' },
};

function stubHealthRoute(url) {
  return new Response(JSON.stringify({ ok: true, checks: HEALTH_CHECKS_STUB }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function isHealthRouteUrl(url) {
  return String(url).includes('/api/admin/health-report-external');
}

// Two fresh items per feed URL; titles/links are unique per feed so
// cross-feed dedupe cannot collapse them.
function rssXmlFor(feedUrl) {
  const key = String(feedUrl).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test Feed</title>'
    + `<item><title>F3 ${key} Item One</title><link>https://example.com/f3/${key}/1</link>`
    + '<pubDate>Sun, 23 Nov 2026 10:00:00 GMT</pubDate>'
    + `<description>First test item for feed ${key}.</description></item>`
    + `<item><title>F3 ${key} Item Two</title><link>https://example.com/f3/${key}/2</link>`
    + '<pubDate>Sun, 23 Nov 2026 11:00:00 GMT</pubDate>'
    + `<description>Second test item for feed ${key}.</description></item>`
    + '</channel></rss>';
}

// ---------------------------------------------------------------------------
// F3.1 — summarizeDrainedResearch (pure unit tests)
// ---------------------------------------------------------------------------
describe('F3.1 summarizeDrainedResearch', () => {
  it('empty / null / non-array input aggregates to nothing', () => {
    assert.deepEqual(summarizeDrainedResearch([]), {});
    assert.deepEqual(summarizeDrainedResearch(null), {});
    assert.deepEqual(summarizeDrainedResearch(undefined), {});
    assert.deepEqual(summarizeDrainedResearch('nope'), {});
  });

  it('aggregates one clean execution per division', () => {
    const out = summarizeDrainedResearch([
      { taskId: 1, kind: 'daily-research', outcome: 'done', research: { division: 'digital-tools', candidates: 6, itemsStored: 6, sourcesChecked: 3, fetchErrors: 0 } },
      { taskId: 2, kind: 'daily-research', outcome: 'no-op', research: { division: 'education-learning', candidates: 0, itemsStored: 0, sourcesChecked: 3, fetchErrors: 0 } },
    ]);
    assert.equal(out['digital-tools'].candidates, 6);
    assert.equal(out['digital-tools'].itemsStored, 6);
    assert.equal(out['digital-tools'].sourcesChecked, 3);
    assert.equal(out['digital-tools'].cleanExecutions, 1);
    assert.equal(out['education-learning'].cleanExecutions, 1, 'a no-op with all feeds fetched is still a clean fetch');
    assert.equal(out['education-learning'].candidates, 0);
  });

  it('sums a backlog double-execution and counts only clean ones', () => {
    const out = summarizeDrainedResearch([
      { taskId: 1, kind: 'daily-research', outcome: 'done', research: { division: 'digital-tools', candidates: 4, itemsStored: 4, sourcesChecked: 3, fetchErrors: 1 } },
      { taskId: 2, kind: 'daily-research', outcome: 'done', research: { division: 'digital-tools', candidates: 2, itemsStored: 2, sourcesChecked: 3, fetchErrors: 0 } },
    ]);
    const d = out['digital-tools'];
    assert.equal(d.candidates, 6, 'candidates sum across executions');
    assert.equal(d.itemsStored, 6);
    assert.equal(d.fetchErrors, 1);
    assert.equal(d.executions, 2);
    assert.equal(d.cleanExecutions, 1, 'one clean execution is enough to skip the inline re-fetch');
  });

  it('an execution with fetch errors is not clean', () => {
    const out = summarizeDrainedResearch([
      { taskId: 1, kind: 'daily-research', outcome: 'no-op', research: { division: 'digital-tools', candidates: 0, itemsStored: 0, sourcesChecked: 3, fetchErrors: 3 } },
    ]);
    assert.equal(out['digital-tools'].cleanExecutions, 0, 'all feeds failed — the inline fetch must still run as a retry');
  });

  it('an execution with no sources checked is not clean', () => {
    const out = summarizeDrainedResearch([
      { taskId: 1, kind: 'daily-research', outcome: 'no-op', research: { division: 'digital-tools', candidates: 0, itemsStored: 0, sourcesChecked: 0, fetchErrors: 0 } },
    ]);
    assert.equal(out['digital-tools'].cleanExecutions, 0, 'no sources configured — nothing was fetched');
  });

  it('ignores entries without a research summary or division', () => {
    const out = summarizeDrainedResearch([
      { taskId: 1, kind: 'daily-content', outcome: 'done' },
      { taskId: 2, kind: 'daily-research', outcome: 'done', research: { candidates: 5 } },
      { taskId: 3, kind: 'daily-research', outcome: 'done', research: null },
    ]);
    assert.deepEqual(out, {});
  });
});

// ---------------------------------------------------------------------------
// F3.2 — researchFetch skip + honest counts (full daily run)
// ---------------------------------------------------------------------------
describe('F3.2 researchFetch skips divisions the drain already fetched', () => {
  it('counts the drain\u2019s stored items and fetches each feed exactly once', async () => {
    const { db, env } = freshEnv();
    setSetting(db, 'auto_research', 'on');
    const thinnest = thinnestDivisions(db);
    assert.equal(thinnest.length, 2, 'two thinnest divisions exist in the seed');
    const feedUrls = [];
    for (const d of thinnest) {
      const rows = db.prepare('SELECT url FROM research_sources WHERE division_id = ? AND is_active = 1 ORDER BY id ASC').all(d.id);
      assert.equal(rows.length, 3, `${d.division} has 3 enabled feeds`);
      for (const r of rows) feedUrls.push(r.url);
      const created = await enqueueTask(env, {
        agent: 'research', kind: 'daily-research', payload: { division: d.division },
        division_id: d.id, priority: 5, idempotency_key: `daily-research-${d.division}-f3-test`,
      });
      assert.equal(created.ok, true, `research task enqueued for ${d.division}`);
    }
    const itemsBefore = db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n;
    const feedSet = new Set(feedUrls);
    const fetchCalls = [];
    global.fetch = async (url) => {
      const u = String(url);
      fetchCalls.push(u);
      if (isHealthRouteUrl(u)) return stubHealthRoute(u);
      if (feedSet.has(u)) {
        return new Response(rssXmlFor(u), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      }
      return new Response('', { status: 200 });
    };

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true, JSON.stringify(result));

    const summary = dailySummary(db);
    assert.ok(summary, 'a daily report row exists');
    // 2 items x 3 feeds x 2 divisions = 12, all stored by the drain.
    assert.equal(summary.counts.researchFetched, 12, 'the daily count reports what the RUN stored, not 0');
    assert.equal(summary.counts.researchItemsStored, 12);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, itemsBefore + 12,
      'exactly the 12 new items were stored');

    const researchStep = stepResult(db, 'research-fetch');
    assert.ok(researchStep, 'researchFetch step recorded');
    assert.deepEqual(
      [...researchStep.skipped].sort(),
      thinnest.map((d) => d.division).sort(),
      'both divisions were skipped inline — the drain already fetched them',
    );
    assert.equal(researchStep.fetched, 12);
    assert.equal(researchStep.added, 12);

    for (const url of feedUrls) {
      const calls = fetchCalls.filter((u) => u === url).length;
      assert.equal(calls, 1, `feed ${url} fetched exactly once (drain only — no inline re-fetch)`);
    }

    // The drain recorded the research summaries the inline step read.
    const drainRun = db.prepare("SELECT detail FROM agent_runs WHERE agent = 'scheduler' AND detail LIKE '%queue-drain%' ORDER BY id ASC LIMIT 1").get();
    assert.ok(drainRun, 'a queue-drain agent_runs row exists');
    const drainDetail = JSON.parse(drainRun.detail);
    const researchEntries = (drainDetail.results || []).filter((r) => r.research);
    assert.equal(researchEntries.length, 2, 'both drained research tasks carry a research summary');
    for (const e of researchEntries) {
      assert.equal(e.research.candidates, 6, '6 candidates per division (2 items x 3 feeds)');
      assert.equal(e.research.itemsStored, 6);
      assert.equal(e.research.fetchErrors, 0);
    }
  });

  it('still fetches inline when the drain did not cover a division', async () => {
    const { db, env } = freshEnv();
    setSetting(db, 'auto_research', 'on');
    const thinnest = thinnestDivisions(db);
    // Enqueue a research task for ONLY the first thinnest division.
    const first = thinnest[0];
    const feedUrls = db.prepare('SELECT url FROM research_sources WHERE division_id = ? AND is_active = 1 ORDER BY id ASC').all(first.id).map((r) => r.url);
    const otherFeedUrls = db.prepare('SELECT url FROM research_sources WHERE division_id = ? AND is_active = 1 ORDER BY id ASC').all(thinnest[1].id).map((r) => r.url);
    await enqueueTask(env, {
      agent: 'research', kind: 'daily-research', payload: { division: first.division },
      division_id: first.id, priority: 5, idempotency_key: `daily-research-${first.division}-f3-partial`,
    });
    const feedSet = new Set([...feedUrls, ...otherFeedUrls]);
    const fetchCalls = [];
    global.fetch = async (url) => {
      const u = String(url);
      fetchCalls.push(u);
      if (isHealthRouteUrl(u)) return stubHealthRoute(u);
      if (feedSet.has(u)) {
        return new Response(rssXmlFor(u), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      }
      return new Response('', { status: 200 });
    };

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true, JSON.stringify(result));
    const summary = dailySummary(db);
    // First division: 6 from the drain (skipped inline). Second: 6
    // from the inline fetch (the drain never ran it).
    assert.equal(summary.counts.researchFetched, 12);
    assert.equal(summary.counts.researchItemsStored, 12);
    assert.deepEqual(stepResult(db, 'research-fetch').skipped, [first.division]);
    for (const url of [...feedUrls, ...otherFeedUrls]) {
      assert.equal(fetchCalls.filter((u) => u === url).length, 1, `feed ${url} fetched exactly once`);
    }
  });
});

// ---------------------------------------------------------------------------
// F3.3 — evidence-enrich (full daily run, drain-converted draft)
// ---------------------------------------------------------------------------
describe('F3.3 evidenceEnrich fetches full text for drafts the drain created', () => {
  const ARTICLE_URL = 'https://example.com/f3-everyday-ai-tasks';
  const TASK_TITLE = 'How AI Helps With Everyday Tasks';
  const CANNED_DRAFT =
    '## Introduction\n\nArtificial intelligence is now part of everyday routines, from the keyboard on a phone to the recommendations in a music app.\n\n'
    + '## How it works\n\nMost everyday AI is pattern-finding software: it learns from examples and predicts the most likely next step.\n\n'
    + '## Step-by-step\n\nStart with one small repetitive task, try a drafting or summarising tool on it, and check the result yourself.\n\n'
    + '## Conclusion\n\nAI saves time on routine work when a person stays in charge of the facts and the final decision.\n\n'
    + '## Key takeaways\n\nUse AI for drafting and organising, check everything important, and keep private information out of tools you do not trust.';

  const ARTICLE_HTML = '<!doctype html><html><head><title>How AI Helps With Everyday Tasks</title></head><body><article>'
    + '<p>Artificial intelligence is now part of everyday routines, from the keyboard on a phone to the recommendations in a music app. Most everyday AI is pattern-finding software that learns from examples and predicts the most likely next step.</p>'
    + '<p>People use AI drafting tools to start documents, summarising tools to shorten long reports, and translation tools to read pages in other languages. Each of these tools works best when a person checks the result against the original.</p>'
    + '<p>The same pattern applies at work: a small repetitive task is the safest place to try a new tool, because the result is easy to verify and the cost of a mistake is low.</p>'
    + '<p>Used this way, AI saves time on routine work while the person stays in charge of the facts and the final decision.</p>'
    + '</article></body></html>';

  function seedEvidence(db) {
    const src = db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (2, 'F3 Test AI News', 'https://example.com/f3-ai-news', 'rss')").run();
    db.prepare('INSERT INTO research_items (source_id, division_id, title, url, summary, evidence_text, published_at, fetched_at, is_outdated) VALUES (?, 2, ?, ?, ?, ?, ?, ?, 0)').run(
      Number(src.lastInsertRowid),
      TASK_TITLE,
      ARTICLE_URL,
      'Artificial intelligence is now part of everyday routines, from phone keyboards to music recommendations.',
      'Artificial intelligence is now part of everyday routines, from the keyboard on a phone to the recommendations in a music app. Most everyday AI is pattern-finding software.',
      '2026-11-19T00:00:00.000Z',
      new Date().toISOString(),
    );
  }

  it('stores full-text evidence and re-points the draft\u2019s source at it', async () => {
    const { db, env } = freshEnv({
      extraFiles: ['database/migrations/029_article_fetch_runs.sql'],
      extraEnv: { AI: { run: async () => ({ response: CANNED_DRAFT }) } },
    });
    setSetting(db, 'auto_generation', 'on');
    seedEvidence(db);
    const created = await enqueueTask(env, {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: TASK_TITLE, division: 'ai-technology', sources: [ARTICLE_URL] },
      division_id: 2, priority: 6, idempotency_key: 'daily-content-f3-enrich',
    });
    assert.equal(created.ok, true, 'content task enqueued');
    global.fetch = async (url) => {
      const u = String(url);
      if (isHealthRouteUrl(u)) return stubHealthRoute(u);
      if (u === 'https://example.com/robots.txt') {
        return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      if (u === ARTICLE_URL) {
        return new Response(ARTICLE_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('', { status: 200 });
    };

    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true, JSON.stringify(result));
    const summary = dailySummary(db);
    assert.ok(summary, 'a daily report row exists');

    // The drain converted the content task into a draft.
    assert.equal(summary.counts.queueDraftsConverted, 1, 'one draft converted by the drain');
    const draft = db.prepare('SELECT * FROM articles WHERE title = ?').get(TASK_TITLE);
    assert.ok(draft, 'the draft article exists');
    assert.equal(draft.status, 'draft', 'stored as draft, never published');

    // The enrich step ran for exactly that draft and succeeded.
    const enrichStep = stepResult(db, 'evidence-enrich');
    assert.ok(enrichStep, 'evidenceEnrich step recorded');
    assert.equal(enrichStep.attempted, 1, 'one draft enriched');
    assert.equal(enrichStep.enriched, 1, 'the full-text fetch succeeded');
    assert.equal(enrichStep.results[0].articleId, draft.id);
    assert.equal(enrichStep.results[0].outcome, 'done');
    assert.ok(enrichStep.results[0].extractedChars > 500, 'full text, not a 500-char snippet');

    // The full text is stored and the draft's source points at it.
    const fetched = db.prepare("SELECT * FROM research_items WHERE url = ? AND source_kind = 'article-fetch'").get(ARTICLE_URL);
    assert.ok(fetched, 'a full-text research item was stored');
    assert.equal(fetched.extraction_status, 'ok');
    assert.ok(String(fetched.evidence_text || '').length > 500, 'stored evidence is full text');
    assert.ok(String(fetched.evidence_text || '').includes('small repetitive task'), 'stored evidence is the article body');
    const srcRow = db.prepare('SELECT * FROM article_sources WHERE article_id = ?').get(draft.id);
    assert.ok(srcRow, 'the draft has a recorded source');
    assert.equal(srcRow.research_item_id, fetched.id, 'the source now points at the full-text item');
    const runRow = db.prepare("SELECT COUNT(*) AS n FROM article_fetch_runs WHERE extraction_status = 'ok'").get().n;
    assert.equal(runRow, 1, 'the fetch is audited');
  });

  it('is a clean no-op on days with no new draft', async () => {
    const { db, env } = freshEnv({
      extraFiles: ['database/migrations/029_article_fetch_runs.sql'],
      extraEnv: { AI: { run: async () => ({ response: CANNED_DRAFT }) } },
    });
    setSetting(db, 'auto_generation', 'on');
    global.fetch = async (url) => {
      if (isHealthRouteUrl(String(url))) return stubHealthRoute(url);
      return new Response('', { status: 200 });
    };
    const result = await runDailyWorkflow(env);
    assert.equal(result.ok, true, JSON.stringify(result));
    const summary = dailySummary(db);
    const enrichStep = stepResult(db, 'evidence-enrich');
    assert.ok(enrichStep, 'evidenceEnrich step recorded');
    assert.equal(enrichStep.attempted, 0, 'nothing to enrich');
    assert.equal(enrichStep.enriched, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM article_fetch_runs").get().n, 0, 'no fetch attempted');
  });
});

// ---------------------------------------------------------------------------
// F3.4 — enrichDraftEvidence direct helper tests
// ---------------------------------------------------------------------------
describe('F3.4 enrichDraftEvidence fails closed', () => {
  function seedDraftWithSource(db, url) {
    const divisionId = db.prepare("SELECT id FROM business_divisions WHERE slug = 'ai-technology'").get().id;
    const r = db.prepare(
      'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    ).run(divisionId, 'F3 Refusal Test Draft', 'f3-refusal-test-draft', 'test', 'Body text. ', 'FS AI', 'draft');
    const articleId = Number(r.lastInsertRowid);
    db.prepare(
      "INSERT INTO article_sources (article_id, source_title, source_url, source_type, research_item_id, accessed_at) VALUES (?, 'Test source', ?, 'other', NULL, '2026-11-19T12:00:00Z')",
    ).run(articleId, url);
    return articleId;
  }

  it('a Guardian-style AI-use prohibition is a no-op and keeps the snippet evidence', async () => {
    const { db, env } = freshEnv({ extraFiles: ['database/migrations/029_article_fetch_runs.sql'] });
    const guardianUrl = 'https://www.theguardian.com/travel/2026/nov/19/f3-test-guide';
    const articleId = seedDraftWithSource(db, guardianUrl);
    const itemsBefore = db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n;
    const stub = async (url) => {
      if (String(url).endsWith('/robots.txt')) {
        return new Response(
          '# The Guardian robots.txt\n# Any other uses are not permitted, incl. but not limited to: for large language models (LLMs), machine learning and/or artificial intelligence-related purposes.\nUser-agent: *\nAllow: /\n',
          { status: 200, headers: { 'Content-Type': 'text/plain' } },
        );
      }
      return new Response('', { status: 200 });
    };
    const out = await enrichDraftEvidence(env, [articleId], { fetchImpl: stub });
    assert.equal(out.attempted, 1);
    assert.equal(out.enriched, 0);
    assert.equal(out.results[0].outcome, 'no-op');
    assert.match(out.results[0].reason || '', /terms-prohibit-ai-use/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, itemsBefore,
      'no full-text item stored for a refused fetch');
    assert.equal(db.prepare('SELECT research_item_id FROM article_sources WHERE article_id = ?').get(articleId).research_item_id, null,
      'the source still points at nothing — the snippet evidence path is untouched');
  });

  it('a fetch throw never escapes the helper', async () => {
    const { db, env } = freshEnv({ extraFiles: ['database/migrations/029_article_fetch_runs.sql'] });
    const articleId = seedDraftWithSource(db, 'https://example.com/f3-throw-test');
    const throwing = async () => { throw new Error('network down'); };
    const out = await enrichDraftEvidence(env, [articleId], { fetchImpl: throwing });
    assert.equal(out.attempted, 1);
    assert.equal(out.enriched, 0);
    assert.equal(out.results[0].outcome, 'failed');
    assert.ok(out.results[0].reason, 'a reason is recorded');
  });

  it('ignores invalid article ids', async () => {
    const { db, env } = freshEnv({ extraFiles: ['database/migrations/029_article_fetch_runs.sql'] });
    const out = await enrichDraftEvidence(env, [0, -3, 'nope', null], { fetchImpl: async () => new Response('', { status: 200 }) });
    assert.deepEqual(out, { attempted: 0, enriched: 0, results: [] });
  });
});

// ---------------------------------------------------------------------------
// F3.5 — duplicate-overlap wording names the actual comparator
// ---------------------------------------------------------------------------
describe('F3.5 duplicate-zero-overlap detail names another article', () => {
  function seoChecksJson({ duplicateDetail = 'Highest 5-word shingle overlap with another article: 0%.', internalLinksOk = true, readabilityOk = true } = {}) {
    return JSON.stringify([
      { name: 'seo-title', ok: true },
      { name: 'meta-description', ok: true },
      { name: 'slug-unique', ok: true },
      { name: 'heading-hierarchy', ok: true },
      { name: 'keyword-relevance', ok: true },
      { name: 'internal-links', ok: internalLinksOk, detail: internalLinksOk ? 'Body links to at least one other published article.' : 'No internal link.' },
      { name: 'image-alt', ok: true },
      { name: 'readability', ok: readabilityOk, detail: readabilityOk ? 'Estimate: 40 words.' : 'Too long.' },
      { name: 'duplicate', ok: true, detail: duplicateDetail },
      { name: 'broken-links', ok: true },
      { name: 'structured-metadata', ok: true },
    ]);
  }

  function basePureInput(overrides = {}) {
    const body = 'Electric cars are changing how we drive. A home charger adds about 40 kilometres of range per hour of charging. '
      + 'Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=200';
    return {
      article: {
        id: 100, division: 'automotive', division_id: 1,
        title: 'Electric Car Charging Guide', body, status: 'draft',
        created_at: '2026-11-21T05:00:00.000Z', updated_at: '2026-11-21T05:00:00.000Z',
      },
      factCheck: { verdict: 'pass', claims_total: 2, claims_verified: 2, claims_failed: 0, body_hash: 'abc123' },
      currentBodyHash: 'abc123',
      seoCheck: { verdict: 'pass', checks_json: seoChecksJson(), created_at: '2026-11-21T05:00:00.000Z' },
      sources: [{ source_url: 'https://example.com/source-1' }],
      verifiedClaimsWithoutEvidence: 0,
      openCorrections: 0,
      linkedArticleIds: [200],
      linkedArticles: [{ id: 200, division_id: 1, title: 'Electric Car Maintenance Checklist' }],
      adviceClaims: [],
      bannerClean: true,
      isProtected: false,
      emergencyStopOff: true,
      publishedToday: 0,
      maxArticlesPerDay: 1,
      publishingMode: 'auto',
      autoPublishing: 'on',
      autoPublishEligibleSince: '2026-11-21T00:00:00.000Z',
      seoWaivers: [],
      retryHistory: [],
      ...overrides,
    };
  }

  function dupCheck(v) {
    return (v.checks || []).find((c) => c.name === 'duplicate-zero-overlap');
  }

  it('0% overlap vs a draft reads "another article", not "another published article"', () => {
    const v = evaluateAutoPublishEligibilityPure(basePureInput({
      seoCheck: {
        verdict: 'pass',
        checks_json: seoChecksJson({ duplicateDetail: 'Highest 5-word shingle overlap with another article: 0% (word Jaccard 0%, draft article #33).' }),
        created_at: '2026-11-21T05:00:00.000Z',
      },
    }));
    const check = dupCheck(v);
    assert.ok(check, 'duplicate-zero-overlap check exists');
    assert.equal(check.ok, true);
    assert.equal(check.detail, 'Highest 5-word shingle overlap with another article: 0%.');
    assert.ok(!check.detail.includes('published article'), 'the detail must not claim the comparator was a published article');
  });

  it('non-zero overlap vs a draft states the actual comparator and still refuses', () => {
    const v = evaluateAutoPublishEligibilityPure(basePureInput({
      seoCheck: {
        verdict: 'pass',
        checks_json: seoChecksJson({ duplicateDetail: 'Highest 5-word shingle overlap with another article: 6% (word Jaccard 12%, draft article #33).' }),
        created_at: '2026-11-21T05:00:00.000Z',
      },
    }));
    const check = dupCheck(v);
    assert.ok(check, 'duplicate-zero-overlap check exists');
    assert.equal(check.ok, false, 'the gate still refuses — the fix is wording only, the 0% rule is unchanged');
    assert.equal(check.detail, 'Highest 5-word shingle overlap with another article: 6% — auto-publish needs exactly 0%.');
    assert.ok(!check.detail.includes('published article'));
    assert.equal(v.eligible, false);
  });

  it('the pass case still passes when the SEO detail uses the old phrasing', () => {
    // The gate parses only the percentage, so an SEO detail written
    // in the old words must not break eligibility.
    const v = evaluateAutoPublishEligibilityPure(basePureInput({
      seoCheck: {
        verdict: 'pass',
        checks_json: seoChecksJson({ duplicateDetail: 'Highest 5-word shingle overlap with another published article: 0%.' }),
        created_at: '2026-11-21T05:00:00.000Z',
      },
    }));
    assert.equal(v.eligible, true, JSON.stringify(v.blockedBy));
  });
});
