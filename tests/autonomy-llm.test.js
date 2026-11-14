// FS AI — Autonomy LLM-layer tests.
//
// generateText() and the content agent against a REAL SQLite database
// built from database/schema.sql + migrations 005 + 006 +
// database/seed.sql via node:sqlite (same pattern as
// tests/real-db.test.js). Providers are NEVER called for real: env.AI
// is a fake object injected per test, and Groq/Gemini have no keys, so
// no test ever hits the network.
//
// NOTE (pre-existing condition, local test DBs only): migration 004 is
// NOT applied here. database/schema.sql already contains 004's changes
// (articles.publish_at and ai_agents.status), so applying 004 after
// schema.sql fails with a duplicate-column error. The live D1 database
// is unaffected — it was built by the incremental migration chain.
//
// Run: node --test tests/autonomy-llm.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { generateText } = require('../backend/llm/index.js');
const { providerStatus } = require('../backend/llm/registry.js');
const { runContentCreation } = require('../backend/agents/autonomy/content.js');

const ROOT = path.join(__dirname, '..');
const WORKERS_AI_MODEL = '@cf/openai/gpt-oss-20b';

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

// Fresh real DB per test: schema + autonomy migrations 005/006 + seed.
// Migration 004 is deliberately NOT applied (see the header note).
function freshEnv(extra = {}) {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
  ]);
  return { db, env: { DB: makeRealD1(db), ...extra } };
}

function usageRows(db, where = '') {
  return db.prepare(`SELECT * FROM llm_usage ${where} ORDER BY id ASC`).all();
}

describe('generateText — no provider configured', () => {
  it('ok:false, all providers not-configured, no llm_usage success row, generation paused', async () => {
    const { db, env } = freshEnv();
    const result = await generateText({ prompt: 'Write a short test paragraph.', purpose: 'test' }, env);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'all-providers-unavailable');
    assert.equal(result.providerStatuses.length, 3, 'all three providers attempted in order');
    assert.deepEqual(
      result.providerStatuses.map((p) => p.id),
      ['workers-ai', 'groq', 'gemini'],
      'fallback order is workers-ai -> groq -> gemini',
    );
    assert.ok(result.providerStatuses.every((p) => p.status === 'not-configured'),
      'every provider reports not-configured with no binding and no keys');
    assert.match(result.detail, /No LLM provider is configured/);

    // The attempts ARE logged (as not-configured), but no success row exists.
    const rows = usageRows(db);
    assert.equal(rows.length, 3, 'one llm_usage row per attempted provider');
    assert.ok(rows.every((r) => r.outcome === 'not-configured'));
    assert.equal(usageRows(db, "WHERE outcome = 'ok'").length, 0, 'no success row was recorded');

    // Generation is paused: no provider is available.
    const statuses = await providerStatus(env);
    assert.ok(statuses.every((p) => p.status === 'not-configured'));
    assert.equal(statuses.some((p) => p.status === 'available'), false);
  });

  it('empty prompt is rejected without touching any provider or the usage table', async () => {
    const { db, env } = freshEnv();
    const result = await generateText({ prompt: '   ' }, env);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-prompt');
    assert.equal(usageRows(db).length, 0, 'no usage row for an invalid prompt');
  });
});

describe('generateText — fake Workers AI', () => {
  it('fake env.AI returning canned text: ok:true, workers-ai, gpt-oss-20b, llm_usage row recorded', async () => {
    const { db, env } = freshEnv();
    const calls = [];
    env.AI = {
      run: async (model, opts) => {
        calls.push({ model, opts });
        return {
          response: 'Canned draft text for testing.',
          usage: { prompt_tokens: 12, completion_tokens: 25 },
        };
      },
    };
    const result = await generateText({ prompt: 'Write a short test paragraph.', purpose: 'test' }, env);
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Canned draft text for testing.');
    assert.equal(result.provider, 'workers-ai');
    assert.equal(result.model, WORKERS_AI_MODEL, 'first model tried is gpt-oss-20b');
    assert.deepEqual(result.tokens, { in: 12, out: 25 });
    assert.equal(calls.length, 1, 'exactly one Workers AI call');
    assert.equal(calls[0].model, WORKERS_AI_MODEL);
    assert.ok(Array.isArray(calls[0].opts.messages), 'messages passed to the binding');

    const rows = usageRows(db, "WHERE outcome = 'ok'");
    assert.equal(rows.length, 1, 'one success row recorded');
    assert.equal(rows[0].provider, 'workers-ai');
    assert.equal(rows[0].model, WORKERS_AI_MODEL);
    assert.equal(rows[0].tokens_in, 12);
    assert.equal(rows[0].tokens_out, 25);
    assert.equal(rows[0].purpose, 'test');
  });

  it('fake env.AI throwing a 3036-style quota error: quota-exhausted and the next provider is tried', async () => {
    const { db, env } = freshEnv();
    env.AI = {
      run: async () => {
        throw new Error('Workers AI error 3036: free allowance used up');
      },
    };
    const result = await generateText({ prompt: 'Write a short test paragraph.', purpose: 'test' }, env);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'quota-exhausted');
    assert.equal(result.providerStatuses[0].id, 'workers-ai');
    assert.equal(result.providerStatuses[0].status, 'quota-exhausted');
    assert.match(result.providerStatuses[0].detail, /3036/);

    // The fallback was really attempted: Groq and Gemini were tried and
    // logged as not-configured (no keys), instead of stopping at Workers AI.
    assert.equal(result.providerStatuses[1].id, 'groq');
    assert.equal(result.providerStatuses[1].status, 'not-configured');
    assert.equal(result.providerStatuses[2].id, 'gemini');
    assert.equal(result.providerStatuses[2].status, 'not-configured');
    const groqRows = usageRows(db, "WHERE provider = 'groq'");
    assert.equal(groqRows.length, 1, 'Groq was tried and its attempt logged');
    assert.equal(groqRows[0].outcome, 'not-configured');
    const workersRows = usageRows(db, "WHERE provider = 'workers-ai'");
    assert.equal(workersRows.length, 1);
    assert.equal(workersRows[0].outcome, 'quota-exhausted');
    assert.equal(usageRows(db, "WHERE outcome = 'ok'").length, 0);
  });

  it('daily usage pre-seeded at the cap: the provider is never called', async () => {
    const { db, env } = freshEnv();
    // Seed today's Workers AI usage at the 9,000-Neuron code cap.
    // created_at defaults to datetime('now') (UTC today), which is the
    // same day getDailyUsage() reads.
    db.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons) VALUES ('workers-ai', ?, 'test', 'ok', 100, 200, 9000)",
    ).run(WORKERS_AI_MODEL);
    const calls = [];
    env.AI = {
      run: async (model) => {
        calls.push(model);
        return { response: 'Must never be called.', usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    };
    const result = await generateText({ prompt: 'Write a short test paragraph.', purpose: 'test' }, env);
    assert.equal(calls.length, 0, 'Workers AI was never called once the cap was hit');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'quota-exhausted');
    assert.equal(result.providerStatuses[0].status, 'quota-exhausted');
    assert.match(result.providerStatuses[0].detail, /Daily cap already reached/);
  });
});

describe('content agent + LLM', () => {
  const task = {
    agent: 'content-creation', kind: 'draft',
    payload: {
      title: 'How to Test a Fake AI Draft',
      division: 'automotive',
      outline: ['Introduction', 'Key takeaways'],
      sources: [],
    },
  };

  it('with fake AI: done with llmGenerated:true and needsFactCheck:true, real body, no article row yet', async () => {
    const { db, env } = freshEnv();
    env.AI = {
      run: async () => ({
        response: 'Canned article body about testing. It is general guidance only.',
        usage: { prompt_tokens: 40, completion_tokens: 60 },
      }),
    };
    const result = await runContentCreation(task, env);
    assert.equal(result.outcome, 'done');
    assert.ok(result.draft, 'an AI draft is returned');
    assert.equal(result.draft.llmGenerated, true);
    assert.equal(result.draft.needsFactCheck, true);
    assert.equal(result.draft.provider, 'workers-ai');
    assert.equal(result.draft.model, WORKERS_AI_MODEL);
    assert.ok(result.draft.body.includes('Canned article body about testing.'), 'draft body is the real LLM text');
    assert.ok(result.draft.factCheckFlags.some((f) => /needs fact-checking/.test(f)));
    assert.equal(result.scaffold.body, result.draft.body, 'scaffold carries the same real body for conversion');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25,
      'the agent inserts no article row — conversion is a separate owner step');
    assert.equal(usageRows(db, "WHERE outcome = 'ok'").length, 1, 'the generation was logged');
  });

  it('with no providers: no-op scaffold, no fabricated body', async () => {
    const { db, env } = freshEnv();
    const result = await runContentCreation(task, env);
    assert.equal(result.outcome, 'no-op');
    assert.ok(result.scaffold, 'scaffold is returned');
    assert.equal(result.scaffold.body, undefined, 'no body was fabricated');
    assert.equal(result.draft, undefined, 'no draft without an LLM');
    assert.ok(result.scaffold.note.includes('no body was fabricated'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25, 'no article row was inserted');
    assert.equal(usageRows(db, "WHERE outcome = 'ok'").length, 0, 'no successful generation was recorded');
  });
});
