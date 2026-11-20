// FS AI — Content-task source idempotency tests (Fix 8, 2026-11-20).
//
// Phase 1 report (docs/FS-AI-Autonomous-Operation-Report.md §22 item 10):
// re-creating a content task with the same title on the same day silently
// dropped the newly supplied sources — enqueueTask returned the existing
// task on the idempotency key `manual-content-<slug>-<date>` and the new
// payload was discarded. The fix merges valid new source URLs into the
// existing task's payload (dedupe by normalised URL, original order kept,
// new ones appended) and reports the outcome in `sourceMerge`:
//   existing-reused — no new sources supplied
//   sources-added   — new valid sources merged (listed in `added`)
//   no-new-sources  — sources supplied but every one is a duplicate
//   rejected        — no source could be merged (invalid or mismatched)
// A re-creation for a different title/division must never mix its sources
// into the original task. The original task row is never deleted or
// recreated; a merge only rewrites its payload + updated_at.
//
// Exercised against a REAL SQLite database built from database/schema.sql
// + migrations 005 + 006 + database/seed.sql + migrations 008/009/010/011/
// 012 via node:sqlite (same pattern as tests/autonomy-scheduler.test.js
// and tests/autonomy-content-draft.test.js). Each test asserts real DB
// state. The end-to-end test runs the merged task with a fake Workers AI
// binding (providers are NEVER called for real) and converts its
// scaffold, proving the article receives BOTH sources.
//
// NOTE (pre-existing condition, local test DBs only): migration 004 is
// NOT applied here. database/schema.sql already contains 004's changes
// (articles.publish_at and ai_agents.status), so applying 004 after
// schema.sql fails with a duplicate-column error. The live D1 database
// is unaffected — it was built by the incremental migration chain.
//
// Run: node --test tests/content-task-idempotency.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');
const { runTask } = require('../backend/routes/scheduler.js');

const ROOT = path.join(__dirname, '..');
const WORKER_URL = 'http://localhost';

const TITLE_A = 'How AI Assistants Help Small Teams Every Day';
const SLUG_A = 'how-ai-assistants-help-small-teams-every-day';
const TITLE_B = 'How AI Assistants Help Remote Teams Every Day';
const SLUG_B = 'how-ai-assistants-help-remote-teams-every-day';
const SOURCE_A = 'https://example.com/ai-assistants-small-teams';
const SOURCE_B = 'https://example.com/ai-assistants-remote-teams';
const DAY = '2026-11-20';
const NEXT_DAY = '2026-11-21';
const KEY_A = `manual-content-${SLUG_A}-${DAY}`;
const KEY_A_NEXT_DAY = `manual-content-${SLUG_A}-${NEXT_DAY}`;
const KEY_B = `manual-content-${SLUG_B}-${DAY}`;

// Canned "model" text (copied shape from tests/autonomy-content-draft.test.js):
// multi-section general guidance, no invented statistics, no citations.
const CANNED_DRAFT =
  '## Introduction\n\nAI assistants are now part of everyday routines for small teams, from drafting replies to organising notes.\n\n' +
  '## How it works\n\nMost everyday AI is pattern-finding software: it learns from examples and predicts the most likely next step.\n\n' +
  '## Step-by-step\n\nStart with one small repetitive task, try a drafting or summarising tool on it, and check the result yourself.\n\n' +
  '## Conclusion\n\nAI saves time on routine work when a person stays in charge of the facts and the final decision.\n\n' +
  '## Key takeaways\n\nUse AI for drafting and organising, check everything important, and keep private information out of tools you do not trust.';

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
// tests/real-db.test.js).
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
    'database/migrations/008_research.sql',
    'database/migrations/009_factcheck.sql',
    'database/migrations/010_pipeline.sql',
    'database/migrations/011_backup.sql',
    'database/migrations/012_source_links.sql',
  ]);
  seedEvidence(db);
  return { db, env: { DB: makeRealD1(db), ...extra } };
}

// Evidence for both sources, so the merged task can run end to end:
// generation is evidence-grounded — it only writes a draft when a
// supplied source URL resolves to a stored research item.
function seedEvidence(db) {
  const src = db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (2, 'Test AI News', 'https://example.com/ai-news', 'rss')").run();
  const sourceId = Number(src.lastInsertRowid);
  for (const [url, title] of [
    [SOURCE_A, 'How AI Assistants Help Small Teams'],
    [SOURCE_B, 'How AI Assistants Help Remote Teams'],
  ]) {
    db.prepare('INSERT INTO research_items (source_id, division_id, title, url, summary, evidence_text, published_at, fetched_at, is_outdated) VALUES (?, 2, ?, ?, ?, ?, ?, ?, 0)').run(
      sourceId,
      title,
      url,
      'AI assistants help teams with drafting, organising and routine work.',
      'AI assistants help teams with drafting, organising and routine work. Most everyday AI is pattern-finding software.',
      '2026-11-19T00:00:00.000Z',
      new Date().toISOString(),
    );
  }
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

function createTaskBody({ title, division = 'ai-technology', divisionId = 2, sources, key }) {
  return {
    agent: 'content-creation', kind: 'article-draft',
    payload: { title, division, sources },
    division_id: divisionId, idempotency_key: key,
  };
}

async function createTask(env, opts) {
  return callAutonomy(env, 'POST', '/api/autonomy/tasks', createTaskBody(opts));
}

function taskPayload(db, taskId) {
  const row = db.prepare('SELECT payload FROM agent_tasks WHERE id = ?').get(taskId);
  return JSON.parse(row.payload);
}

describe('content-task source idempotency (Fix 8)', () => {
  it('(a) same title + same day + new source → task reused, source merged, sources-added', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.sourceMerge, undefined, 'a fresh insert carries no sourceMerge');
    const taskId = first.body.task.id;

    const again = await createTask(env, { title: TITLE_A, sources: [SOURCE_B], key: KEY_A });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.duplicate, true, 'same key reuses the task');
    assert.equal(again.body.task.id, taskId, 'the SAME task row is returned, not a new one');
    assert.equal(again.body.sourceMerge.status, 'sources-added');
    assert.deepEqual(again.body.sourceMerge.added, [SOURCE_B]);
    assert.deepEqual(again.body.sourceMerge.duplicates, []);
    assert.deepEqual(again.body.sourceMerge.rejected, []);
    assert.deepEqual(again.body.task.payload.sources, [SOURCE_A, SOURCE_B],
      'original order kept, new source appended');
    assert.deepEqual(taskPayload(db, taskId).sources, [SOURCE_A, SOURCE_B], 'merged payload persisted in D1');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1, 'no duplicate task row');
  });

  it('(b) same title + same day + duplicate source only → no-new-sources, no duplicate row', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    const taskId = first.body.task.id;

    // Exact duplicate plus a trailing-slash variant (same URL after normalisation).
    const again = await createTask(env, { title: TITLE_A, sources: [SOURCE_A, `${SOURCE_A}/`], key: KEY_A });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.task.id, taskId);
    assert.equal(again.body.sourceMerge.status, 'no-new-sources');
    assert.deepEqual(again.body.sourceMerge.added, []);
    assert.deepEqual(again.body.sourceMerge.duplicates, [SOURCE_A, `${SOURCE_A}/`]);
    assert.deepEqual(again.body.sourceMerge.rejected, []);
    assert.deepEqual(taskPayload(db, taskId).sources, [SOURCE_A], 'payload unchanged');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1, 'no duplicate task row');
  });

  it('(c) same title + different day → new task', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await createTask(env, { title: TITLE_A, sources: [SOURCE_B], key: KEY_A_NEXT_DAY });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.duplicate, false, 'a different day is a different key');
    assert.notEqual(second.body.task.id, first.body.task.id);
    assert.deepEqual(second.body.task.payload.sources, [SOURCE_B]);
    assert.deepEqual(taskPayload(db, first.body.task.id).sources, [SOURCE_A], 'first task untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 2);
  });

  it('(d) different title + same source → separate task, no cross-mixing', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    const second = await createTask(env, { title: TITLE_B, sources: [SOURCE_A], key: KEY_B });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.duplicate, false, 'a different title is a different key');
    assert.notEqual(second.body.task.id, first.body.task.id);
    assert.deepEqual(second.body.task.payload.sources, [SOURCE_A]);
    assert.deepEqual(taskPayload(db, first.body.task.id).sources, [SOURCE_A],
      'the first task gained nothing from the second title');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 2);
  });

  it('(e1) invalid source → rejected with reason, original task untouched', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    const taskId = first.body.task.id;

    const again = await createTask(env, {
      title: TITLE_A, sources: ['not-a-url', 'ftp://example.com/ai-file'], key: KEY_A,
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.task.id, taskId);
    assert.equal(again.body.sourceMerge.status, 'rejected');
    assert.deepEqual(again.body.sourceMerge.added, []);
    assert.equal(again.body.sourceMerge.rejected.length, 2);
    for (const r of again.body.sourceMerge.rejected) {
      assert.match(r.reason, /not a valid http\(s\) URL/, `reason names the problem: ${r.reason}`);
    }
    assert.deepEqual(taskPayload(db, taskId).sources, [SOURCE_A], 'original payload untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1);
  });

  it('(e2) mismatched division on re-creation → rejected with reason, original task untouched', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    const taskId = first.body.task.id;

    // Same key, but the payload now claims the automotive division.
    const again = await createTask(env, {
      title: TITLE_A, division: 'automotive', divisionId: 1, sources: [SOURCE_B], key: KEY_A,
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.task.id, taskId);
    assert.equal(again.body.sourceMerge.status, 'rejected');
    assert.deepEqual(again.body.sourceMerge.added, []);
    assert.equal(again.body.sourceMerge.rejected.length, 1);
    assert.equal(again.body.sourceMerge.rejected[0].source, SOURCE_B);
    assert.match(again.body.sourceMerge.rejected[0].reason, /division does not match/, 'reason names the mismatch');
    assert.deepEqual(taskPayload(db, taskId).sources, [SOURCE_A], 'no automotive source mixed into the ai-technology task');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1);
  });

  it('(f) convert after merge → article_sources contains BOTH original and merged sources', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const taskId = first.body.task.id;

    const again = await createTask(env, { title: TITLE_A, sources: [SOURCE_B], key: KEY_A });
    assert.equal(again.body.sourceMerge.status, 'sources-added', JSON.stringify(again.body));

    // The run re-reads the task row, so it must see the MERGED payload.
    const run = await runTask(env, taskId);
    assert.equal(run.ok, true, JSON.stringify(run));
    assert.equal(run.outcome, 'done');
    assert.deepEqual(run.result.draft.sources, [SOURCE_A, SOURCE_B],
      'the scaffold carries both sources from the merged task payload');

    const converted = await callAutonomy(env, 'POST', `/api/autonomy/scaffolds/${run.runId}/convert`);
    assert.equal(converted.status, 201, JSON.stringify(converted.body));
    assert.equal(converted.body.sourcesRecorded, 2, 'both sources recorded');
    const articleId = converted.body.article.id;
    const rows = db.prepare('SELECT source_url, source_type, research_item_id FROM article_sources WHERE article_id = ? ORDER BY id').all(articleId);
    assert.deepEqual(rows.map((r) => r.source_url), [SOURCE_A, SOURCE_B]);
    for (const r of rows) {
      assert.equal(r.source_type, 'research', 'both URLs resolve to stored research items');
      assert.ok(r.research_item_id, 'linked to the stored research item');
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 26, 'exactly one article was added');
    assert.equal(converted.body.article.status, 'draft', 'stored as draft, never published');
  });

  it('(g) re-creation for an already-done task rejects the merge (sources cannot reach the converted article)', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const taskId = first.body.task.id;
    db.prepare("UPDATE agent_tasks SET status = 'done' WHERE id = ?").run(taskId);

    const again = await createTask(env, { title: TITLE_A, sources: [SOURCE_B], key: KEY_A });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.task.id, taskId);
    assert.equal(again.body.sourceMerge.status, 'rejected', JSON.stringify(again.body));
    assert.deepEqual(again.body.sourceMerge.added, []);
    assert.equal(again.body.sourceMerge.rejected.length, 1);
    assert.equal(again.body.sourceMerge.rejected[0].source, SOURCE_B);
    assert.match(again.body.sourceMerge.rejected[0].reason, /already done/);
    assert.deepEqual(taskPayload(db, taskId).sources, [SOURCE_A], 'done task payload is untouched');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, 1);
  });

  it('(h) re-creation for a failed task still merges (a retry re-reads the payload at run time)', async () => {
    const { db, env } = freshEnv();
    const first = await createTask(env, { title: TITLE_A, sources: [SOURCE_A], key: KEY_A });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const taskId = first.body.task.id;
    db.prepare("UPDATE agent_tasks SET status = 'failed' WHERE id = ?").run(taskId);

    const again = await createTask(env, { title: TITLE_A, sources: [SOURCE_B], key: KEY_A });
    assert.equal(again.body.sourceMerge.status, 'sources-added', JSON.stringify(again.body));
    assert.deepEqual(again.body.sourceMerge.added, [SOURCE_B]);
    assert.deepEqual(taskPayload(db, taskId).sources, [SOURCE_A, SOURCE_B]);
  });
});
