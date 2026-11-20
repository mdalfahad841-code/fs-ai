// FS AI — Phase 3 usage reconciliation tests (Priority 7).
//
// Live Phase 2 finding: D1 analytics showed 23 calls / 259 Neurons
// for 2026-11-20 while the dashboard header showed 55 — two read
// paths over the same llm_usage table with different counting rules,
// and the header was only ever loaded once (a stale snapshot). The
// fix is ONE rule in backend/llm/usage.js getDailyUsage(), read by
// every surface:
//   - requests counts only rows that actually reached a provider:
//     outcome IN ('ok', 'error'). Cap-refusal rows
//     ('quota-exhausted', written when the cap is hit BEFORE a call)
//     and 'not-configured' rows are audit-only and never count.
//   - neurons / tokens are summed from 'ok' rows only.
//   - neuronsEstimated is the part of today's Neurons that is an
//     ESTIMATE (pricing-rate / estimated-token calculation, never
//     provider-reported); null when migration 016 is not yet applied.
// Real SQLite database. Run: node --test tests/llm-usage-phase3.test.js
// (or: npm test). Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  recordUsage, getDailyUsage, getAllProvidersDailyUsage, todayStr,
} = require('../backend/llm/usage.js');
const { generateText } = require('../backend/llm/index.js');

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

function freshEnv(withEstimatedColumn = true) {
  const files = [
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
  ];
  if (withEstimatedColumn) files.push('database/migrations/016_llm_usage_estimated.sql');
  const db = buildDb(files);
  return { db, env: { DB: makeRealD1(db) } };
}

describe('getDailyUsage — the one authoritative counting rule', () => {
  it('counts only ok+error rows as requests; quota-exhausted and not-configured are audit-only', async () => {
    const { env } = freshEnv();
    // Seed through the env's DB (created_at defaults to UTC today).
    const d1 = env.DB;
    const insert = (outcome, neurons, estimated) => d1.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, neurons_estimated) VALUES ('workers-ai', '@cf/openai/gpt-oss-20b', 'test', ?, 10, 20, ?, ?)",
    ).bind(outcome, neurons, estimated ? 1 : 0).run();
    await insert('ok', 100, 1);
    await insert('ok', 50, 0);
    await insert('error', 0, 0);
    await insert('quota-exhausted', 0, 0);
    await insert('not-configured', 0, 0);
    const u = await getDailyUsage(env, 'workers-ai');
    assert.equal(u.requests, 3, '2 ok + 1 error; cap-refusal and not-configured rows must not count as calls');
    assert.equal(u.neurons, 150, 'neurons summed from ok rows only');
    assert.equal(u.tokensIn, 20, 'tokens summed from ok rows only (2 x 10)');
    assert.equal(u.tokensOut, 40);
    assert.equal(u.neuronsEstimated, 100, 'only the flagged row is estimated');
    assert.equal(u.date, todayStr());
  });

  it('reports neuronsEstimated null when migration 016 is not applied (unknown, never 0-as-known)', async () => {
    const { env } = freshEnv(false);
    await env.DB.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons) VALUES ('workers-ai', '@cf/openai/gpt-oss-20b', 'test', 'ok', 10, 20, 100)",
    ).bind().run();
    const u = await getDailyUsage(env, 'workers-ai');
    assert.equal(u.requests, 1);
    assert.equal(u.neurons, 100);
    assert.equal(u.neuronsEstimated, null);
  });

  it('getAllProvidersDailyUsage aggregates every provider through the same rule', async () => {
    const { env } = freshEnv();
    await env.DB.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, neurons_estimated) VALUES ('workers-ai', 'm', 'test', 'ok', 0, 0, 40, 0)",
    ).bind().run();
    await env.DB.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, neurons_estimated) VALUES ('groq', 'm', 'test', 'ok', 100, 50, 0, 0)",
    ).bind().run();
    await env.DB.prepare(
      "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, neurons_estimated) VALUES ('groq', 'm', 'test', 'quota-exhausted', 0, 0, 0, 0)",
    ).bind().run();
    const all = await getAllProvidersDailyUsage(env);
    assert.equal(all['workers-ai'].neurons, 40);
    assert.equal(all['workers-ai'].requests, 1);
    assert.equal(all.groq.requests, 1, 'the groq cap-refusal row must not count');
    assert.equal(all.groq.tokensIn, 100);
    assert.equal(all.gemini.requests, 0);
  });
});

describe('recordUsage — estimated flag storage', () => {
  it('stores neurons_estimated 1/0 and falls back cleanly without the column', async () => {
    const { db, env } = freshEnv();
    assert.equal(await recordUsage(env, { provider: 'workers-ai', model: 'm', purpose: 'test', outcome: 'ok', tokensIn: 1, tokensOut: 2, neurons: 5, neuronsEstimated: true }), true);
    assert.equal(await recordUsage(env, { provider: 'workers-ai', model: 'm', purpose: 'test', outcome: 'ok', tokensIn: 1, tokensOut: 2, neurons: 7, neuronsEstimated: false }), true);
    const rows = db.prepare('SELECT neurons, neurons_estimated FROM llm_usage ORDER BY id ASC').all();
    assert.deepEqual(rows.map((r) => [r.neurons, r.neurons_estimated]), [[5, 1], [7, 0]]);

    const legacy = freshEnv(false);
    assert.equal(await recordUsage(legacy.env, { provider: 'workers-ai', model: 'm', purpose: 'test', outcome: 'ok', neurons: 3, neuronsEstimated: true }), true,
      'the row must still be written when migration 016 is not applied live');
    assert.equal(legacy.db.prepare('SELECT COUNT(*) AS n FROM llm_usage').get().n, 1);
  });
});

describe('generateText — estimated flag flows from the provider result', () => {
  it('provider-reported usage stores neurons_estimated 0; no usage block stores 1', async () => {
    const { db, env } = freshEnv();
    env.AI = {
      run: async () => ({ response: 'Canned text.', usage: { prompt_tokens: 12, completion_tokens: 25 } }),
    };
    const r1 = await generateText({ prompt: 'Write a short test paragraph.', purpose: 'test' }, env);
    assert.equal(r1.ok, true);
    assert.equal(r1.neuronsEstimated, false, 'a usage block means provider-reported');
    let row = db.prepare('SELECT neurons_estimated FROM llm_usage ORDER BY id DESC LIMIT 1').get();
    assert.equal(row.neurons_estimated, 0);

    env.AI = { run: async () => ({ response: 'Canned text without a usage block.' }) };
    const r2 = await generateText({ prompt: 'Write a short test paragraph.', purpose: 'test' }, env);
    assert.equal(r2.ok, true);
    assert.equal(r2.neuronsEstimated, true, 'no usage block means the neuron figure is estimated');
    row = db.prepare('SELECT neurons_estimated FROM llm_usage ORDER BY id DESC LIMIT 1').get();
    assert.equal(row.neurons_estimated, 1);
  });
});
