// FS AI — First real AI article: end-to-end draft path tests.
//
// The mission path, exercised against a REAL SQLite database built from
// database/schema.sql + migrations 005 + 006 + database/seed.sql via
// node:sqlite (same pattern as tests/autonomy-llm.test.js and
// tests/autonomy-queue.test.js): create a content-creation task with the
// mission title + ai-technology division -> run it (fake Workers AI
// binding returning canned text — providers are NEVER called for real)
// -> convert its scaffold to a CMS draft -> verify the stored article.
// Plus the failure guards: a plain scaffold converts to a clearly-marked
// SCAFFOLD (never presented as AI-written), a slug clash is 409, and the
// Emergency Stop blocks a content run with 423 and records nothing.
//
// NOTE (pre-existing condition, local test DBs only): migration 004 is
// NOT applied here. database/schema.sql already contains 004's changes
// (articles.publish_at and ai_agents.status), so applying 004 after
// schema.sql fails with a duplicate-column error. The live D1 database
// is unaffected — it was built by the incremental migration chain.
//
// Run: node --test tests/autonomy-content-draft.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const { runTask } = require('../backend/routes/scheduler.js');
const { runContentCreation, convertScaffoldToDraft } = require('../backend/agents/autonomy/content.js');
const { setEmergencyStop } = require('../backend/routes/admin.js');

const ROOT = path.join(__dirname, '..');
const WORKER_URL = 'http://localhost';
const MISSION_TITLE = 'How Artificial Intelligence Is Changing Everyday Life';
const MISSION_SLUG = 'how-artificial-intelligence-is-changing-everyday-life';
const MISSION_IDEMPOTENCY = `manual-content-${MISSION_SLUG}-2026-11-19`;

// Canned "model" text: multi-section general guidance, no invented
// statistics, no citations — the shape the real Workers AI call must
// produce (the live run verifies the real model instead).
const CANNED_DRAFT =
  '## Introduction\n\nArtificial intelligence is now part of everyday routines, from the keyboard on a phone to the recommendations in a music app.\n\n' +
  '## How it works\n\nMost everyday AI is pattern-finding software: it learns from examples and predicts the most likely next step.\n\n' +
  '## Step-by-step\n\nStart with one small repetitive task, try a drafting or summarising tool on it, and check the result yourself.\n\n' +
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

function freshEnv(extra = {}) {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
  ]);
  return { db, env: { DB: makeRealD1(db), ...extra } };
}

function autonomyReq(method, pathName, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (body !== undefined) {
    return new Request(`${WORKER_URL}${pathName}`, { method, headers, body: JSON.stringify(body) });
  }
  return new Request(`${WORKER_URL}${pathName}`, { method, headers });
}

async function callAutonomy(env, method, pathName, body) {
  const res = await handleAutonomy(autonomyReq(method, pathName, body), env, {}, null);
  return { status: res.status, body: await res.json() };
}

function fakeWorkersAI(text = CANNED_DRAFT) {
  return {
    run: async (model, opts) => {
      assert.ok(Array.isArray(opts.messages), 'messages passed to the binding');
      return { response: text, usage: { prompt_tokens: 120, completion_tokens: 400 } };
    },
  };
}

function missionPayload() {
  return {
    agent: 'content-creation', kind: 'article-draft',
    payload: { title: MISSION_TITLE, division: 'ai-technology', sources: [] },
    division_id: 2, idempotency_key: MISSION_IDEMPOTENCY,
  };
}

describe('first real AI article — end-to-end mission path (fake Workers AI)', () => {
  it('create -> run -> convert stores a draft, fact_checked=0, AI-DRAFT marked, never published', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25, 'seed has 25 articles');

    const created = await callAutonomy(env, 'POST', '/api/autonomy/tasks', missionPayload());
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.duplicate, false);
    const taskId = created.body.task.id;

    const run = await runTask(env, taskId);
    assert.equal(run.ok, true);
    assert.equal(run.outcome, 'done');
    assert.ok(run.runId, 'a run id is recorded');
    assert.equal(run.result.draft.llmGenerated, true, 'the draft is LLM-generated');
    assert.equal(run.result.draft.provider, 'workers-ai', 'the draft came from Workers AI only');
    assert.equal(run.result.draft.model, '@cf/openai/gpt-oss-20b', 'first model in the list');
    assert.ok(run.result.draft.body.includes('## Introduction'), 'draft body is the model text');
    assert.ok(run.result.draft.outline.includes('Conclusion'), 'default outline has a Conclusion section');
    assert.equal(run.result.draft.outline[0], 'Introduction');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25,
      'running the task inserts no article row — conversion is a separate owner step');

    const converted = await callAutonomy(env, 'POST', `/api/autonomy/scaffolds/${run.runId}/convert`);
    assert.equal(converted.status, 201, JSON.stringify(converted.body));
    const article = converted.body.article;
    assert.equal(article.slug, MISSION_SLUG);
    assert.equal(article.title, MISSION_TITLE);
    assert.equal(article.status, 'draft', 'stored as draft, never published');
    assert.equal(article.fact_checked, 0, 'not fact-checked');
    assert.equal(article.division, 'ai-technology');
    assert.ok(article.body.startsWith('AI-DRAFT'), 'body is marked AI-DRAFT');
    assert.match(article.body, /needs fact-check \+ owner approval/);
    assert.match(article.body, /written by workers-ai \(@cf\/openai\/gpt-oss-20b\)/);
    assert.ok(article.body.includes('## Introduction'), 'the model text is stored verbatim');
    assert.equal(article.seo_title, MISSION_TITLE, 'SEO title is the title (51 chars, under 60)');
    assert.ok(article.seo_description && article.seo_description.length > 0, 'SEO description is set');
    assert.equal(article.published_at, null, 'no publish timestamp');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 26, 'exactly one article was added');

    // The generation was logged exactly once, as a Workers AI success.
    const usage = db.prepare("SELECT * FROM llm_usage WHERE outcome = 'ok'").all();
    assert.equal(usage.length, 1);
    assert.equal(usage[0].provider, 'workers-ai');
    assert.equal(usage[0].model, '@cf/openai/gpt-oss-20b');
    assert.equal(usage[0].purpose, 'content-creation');
    assert.ok(usage[0].neurons > 0, 'Neurons were recorded for the call');
  });

  it('converting the same scaffold twice is a 409 — no duplicate article', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    const created = await callAutonomy(env, 'POST', '/api/autonomy/tasks', missionPayload());
    const run = await runTask(env, created.body.task.id);
    const first = await callAutonomy(env, 'POST', `/api/autonomy/scaffolds/${run.runId}/convert`);
    assert.equal(first.status, 201);
    const second = await callAutonomy(env, 'POST', `/api/autonomy/scaffolds/${run.runId}/convert`);
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 26, 'still exactly one new article');
  });
});

describe('convertScaffoldToDraft — no fake AI drafts', () => {
  const plainScaffold = {
    title: MISSION_TITLE,
    division: 'ai-technology',
    divisionId: 2,
    outline: ['Introduction', 'How it works', 'Conclusion', 'Key takeaways'],
    seoTitle: MISSION_TITLE,
    seoDescription: 'A plain-language guide: How Artificial Intelligence Is Changing Everyday Life',
    sources: [],
    note: 'SCAFFOLD — full article body needs an LLM or the owner; no body was fabricated',
  };

  it('a plain scaffold converts to a clearly-marked SCAFFOLD article, never presented as AI-written', async () => {
    const { db, env } = freshEnv();
    const res = await convertScaffoldToDraft(env, plainScaffold);
    assert.equal(res.ok, true);
    assert.equal(res.article.status, 'draft');
    assert.equal(res.article.fact_checked, 0);
    assert.equal(res.article.slug, MISSION_SLUG);
    assert.ok(res.article.body.startsWith('SCAFFOLD'), 'body is marked SCAFFOLD');
    assert.ok(!res.article.body.includes('AI-DRAFT'), 'a scaffold is never labelled AI-DRAFT');
    assert.ok(!res.article.body.includes('written by'), 'no fake authorship claim');
    assert.ok(res.article.body.includes('## Introduction'), 'the outline is stored as empty sections');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 26);
  });

  it('when every LLM provider fails, the content agent returns no-op and its scaffold converts to SCAFFOLD only', async () => {
    const { db, env } = freshEnv({
      AI: { run: async () => { throw new Error('Workers AI is down'); } },
    });
    const result = await runContentCreation({
      agent: 'content-creation', kind: 'draft',
      payload: { title: MISSION_TITLE, division: 'ai-technology', sources: [] },
    }, env);
    assert.equal(result.outcome, 'no-op', 'LLM failure is an honest no-op, not a fake draft');
    assert.equal(result.draft, undefined, 'no draft without a real model response');
    assert.equal(result.scaffold.body, undefined, 'no body was fabricated');
    const res = await convertScaffoldToDraft(env, result.scaffold);
    assert.equal(res.ok, true);
    assert.ok(res.article.body.startsWith('SCAFFOLD'), 'the fallback article is a labelled scaffold');
    assert.ok(!res.article.body.includes('AI-DRAFT'));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM llm_usage WHERE outcome = 'ok'").get().n, 0,
      'no successful generation was recorded');
  });
});

describe('Emergency Stop blocks content generation (423) and restores cleanly', () => {
  it('E-Stop ON: content task run answers 423, task skipped, no article, no LLM call', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    const calls = [];
    env.AI = { run: async (...args) => { calls.push(args); return { response: CANNED_DRAFT, usage: {} }; } };
    await setEmergencyStop(env, true);
    const created = await callAutonomy(env, 'POST', '/api/autonomy/tasks', missionPayload());
    assert.equal(created.status, 201);
    const run = await runTask(env, created.body.task.id);
    assert.equal(run.ok, false);
    assert.equal(run.status, 423);
    assert.equal(run.skipped, true);
    assert.equal(calls.length, 0, 'Workers AI was never called while the stop was on');
    const row = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(created.body.task.id);
    assert.equal(row.status, 'skipped');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25, 'no article was created');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM llm_usage WHERE outcome = 'ok'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE outcome = 'skipped'").get().n, 1,
      'the skip was logged');
    // Restore OFF: a fresh task for the same topic now runs and produces a real draft.
    await setEmergencyStop(env, false);
    const retry = await callAutonomy(env, 'POST', '/api/autonomy/tasks', {
      ...missionPayload(), idempotency_key: `${MISSION_IDEMPOTENCY}-retry`,
    });
    const run2 = await runTask(env, retry.body.task.id);
    assert.equal(run2.ok, true);
    assert.equal(run2.outcome, 'done');
    assert.equal(run2.result.draft.provider, 'workers-ai');
  });
});
