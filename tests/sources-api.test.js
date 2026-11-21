// FS AI — sources + pipeline API tests.
//
// The owner-only orchestrator endpoints for research sources, fact-check
// reads, the publish gate and task retry, against a REAL SQLite database
// (schema + seed + migrations 005/006/008/009/010/011/012). Feed validation
// uses a stubbed global fetch — no network in these tests.
//
// Run: node --test tests/sources-api.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleAutonomy } = require('../backend/routes/orchestrator.js');

const ROOT = path.join(__dirname, '..');

const RSS_OK = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>Test Feed Item Alpha One</title><link>https://example.com/alpha</link><pubDate>Wed, 19 Nov 2026 10:00:00 GMT</pubDate><description>Alpha item summary text here.</description></item>
</channel></rss>`;

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

function req(method, path, body) {
  return new Request(`https://fs-ai.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env, method, path, body) {
  const res = await handleAutonomy(req(method, path, body), env, {}, { owner: true });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let realFetch = null;
function stubFetchOk() {
  if (realFetch === null) realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(RSS_OK, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
}
function stubFetchStatus(status, body = 'error') {
  if (realFetch === null) realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status });
}
afterEach(() => {
  if (realFetch !== null) { globalThis.fetch = realFetch; realFetch = null; }
});

describe('GET /api/autonomy/sources', () => {
  it('lists the 24 seeded sources from D1', async () => {
    const { env } = freshEnv();
    const { status, json } = await call(env, 'GET', '/api/autonomy/sources');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.total, 24);
    assert.equal(json.sources.length, 24);
    assert.equal(json.source, 'd1');
    const auto = json.sources.filter((s) => s.division === 'automotive');
    assert.equal(auto.length, 3);
    assert.ok(json.sources.every((s) => s.url.startsWith('https://')));
  });
});

describe('POST /api/autonomy/sources', () => {
  it('validates the feed live, then stores the source (201)', async () => {
    const { db, env } = freshEnv();
    stubFetchOk();
    const { status, json } = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Test Feed', url: 'https://example.com/test-feed.xml',
    });
    assert.equal(status, 201);
    assert.equal(json.ok, true);
    assert.equal(json.itemsFound, 1);
    assert.equal(json.feedType, 'rss');
    assert.ok(json.source && json.source.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_sources WHERE url = 'https://example.com/test-feed.xml'").get().n, 1);
    const list = await call(env, 'GET', '/api/autonomy/sources');
    assert.equal(list.json.total, 25);
  });

  it('rejects a duplicate URL with 409 and stores nothing', async () => {
    const { db, env } = freshEnv();
    stubFetchOk();
    const first = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Test Feed', url: 'https://example.com/dup-feed.xml',
    });
    assert.equal(first.status, 201);
    const second = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Test Feed Again', url: 'https://example.com/dup-feed.xml',
    });
    assert.equal(second.status, 409);
    assert.match(second.json.error, /already exists/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_sources WHERE url = 'https://example.com/dup-feed.xml'").get().n, 1);
  });

  it('rejects unknown divisions, missing fields and dead feeds — nothing stored', async () => {
    const { db, env } = freshEnv();
    stubFetchOk();
    const badDivision = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'not-a-division', name: 'X', url: 'https://example.com/x.xml',
    });
    assert.equal(badDivision.status, 400);
    const missingName = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: '', url: 'https://example.com/x.xml',
    });
    assert.equal(missingName.status, 400);

    stubFetchStatus(404, 'not found');
    const dead = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Dead Feed', url: 'https://example.com/dead.xml',
    });
    assert.equal(dead.status, 400);
    assert.match(dead.json.error, /Feed validation failed/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_sources WHERE url = 'https://example.com/dead.xml'").get().n, 0);

    const http = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Insecure', url: 'http://example.com/feed.xml',
    });
    assert.equal(http.status, 400);
    assert.match(http.json.error, /not-https/);
  });
});

describe('POST /api/autonomy/sources/:id/fetch + /toggle', () => {
  it('fetches a source, stores new items, dedupes on re-fetch', async () => {
    const { db, env } = freshEnv();
    stubFetchOk();
    const created = await call(env, 'POST', '/api/autonomy/sources', {
      division: 'automotive', name: 'Test Feed', url: 'https://example.com/test-feed.xml',
    });
    const id = created.json.source.id;
    const first = await call(env, 'POST', `/api/autonomy/sources/${id}/fetch`);
    assert.equal(first.status, 200);
    assert.equal(first.json.source.ok, true);
    assert.equal(first.json.source.added, 1);
    assert.equal(first.json.source.duplicates, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 1);

    const second = await call(env, 'POST', `/api/autonomy/sources/${id}/fetch`);
    assert.equal(second.json.source.added, 0);
    assert.equal(second.json.source.duplicates, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_items').get().n, 1, 'no duplicate rows stored');
  });

  it('fetch on a missing source is 404; toggle flips is_active and validates input', async () => {
    const { db, env } = freshEnv();
    const missing = await call(env, 'POST', '/api/autonomy/sources/99999/fetch');
    assert.equal(missing.status, 404);

    const source = db.prepare('SELECT id FROM research_sources LIMIT 1').get();
    const off = await call(env, 'POST', `/api/autonomy/sources/${source.id}/toggle`, { is_active: 0 });
    assert.equal(off.status, 200);
    assert.equal(off.json.is_active, 0);
    assert.equal(db.prepare('SELECT is_active FROM research_sources WHERE id = ?').get(source.id).is_active, 0);
    const on = await call(env, 'POST', `/api/autonomy/sources/${source.id}/toggle`, { is_active: 1 });
    assert.equal(on.json.is_active, 1);
    const bad = await call(env, 'POST', `/api/autonomy/sources/${source.id}/toggle`, { is_active: 'maybe' });
    assert.equal(bad.status, 400);
    const missingToggle = await call(env, 'POST', '/api/autonomy/sources/99999/toggle', { is_active: 0 });
    assert.equal(missingToggle.status, 404);
  });
});

describe('GET /api/autonomy/fact-checks + /gate', () => {
  it('fact-checks: 400 without article_id; empty result for an unchecked article', async () => {
    const { env } = freshEnv();
    const bad = await call(env, 'GET', '/api/autonomy/fact-checks');
    assert.equal(bad.status, 400);
    const empty = await call(env, 'GET', '/api/autonomy/fact-checks?article_id=1');
    assert.equal(empty.status, 200);
    assert.equal(empty.json.factCheck, null);
    assert.deepEqual(empty.json.claims, []);
  });

  it('fact-checks: returns the latest run with claims and corrections', async () => {
    const { db, env } = freshEnv();
    const fc = db.prepare(
      "INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed) VALUES (1, 'pass', 1, 1, 0)",
    ).run();
    const fcId = Number(fc.lastInsertRowid);
    db.prepare(
      "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'EV sales reached 14 million units.', 'VERIFIED', 'https://example.com/s1', 'EV sales reached 14 million units.', 'Supported.')",
    ).run(fcId);
    const { status, json } = await call(env, 'GET', '/api/autonomy/fact-checks?article_id=1');
    assert.equal(status, 200);
    assert.equal(json.factCheck.verdict, 'pass');
    assert.equal(json.claims.length, 1);
    assert.equal(json.claims[0].verdict, 'VERIFIED');
  });

  it('gate: returns the publish-gate verdicts for a draft; 400 without article_id', async () => {
    const { db, env } = freshEnv();
    const bad = await call(env, 'GET', '/api/autonomy/gate');
    assert.equal(bad.status, 400);
    const id = db.prepare(
      "INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked) VALUES (1, 'Gate API Article', 'gate-api-article', 'x', 'Body text here.', 'FS AI', 'draft', 0)",
    ).run().lastInsertRowid;
    const { status, json } = await call(env, 'GET', `/api/autonomy/gate?article_id=${id}`);
    assert.equal(status, 200);
    assert.equal(json.articleId, Number(id));
    assert.equal(json.contentReady, false);
    assert.equal(json.eligible, false);
    assert.ok(Array.isArray(json.checks) && json.checks.length >= 10);
    assert.equal(json.source, 'd1');
  });
});

describe('POST /api/autonomy/tasks/:id/retry', () => {
  it('retries a failed task via the API and refuses a queued one', async () => {
    const { db, env } = freshEnv();
    const now = new Date().toISOString();
    const failedId = db.prepare(
      "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('fact-checking', 'fact-check', '{}', NULL, 5, 'failed', 3, 3, 'api-retry-1', NULL, ?, ?)",
    ).run(now, now).lastInsertRowid;
    const ok = await call(env, 'POST', `/api/autonomy/tasks/${failedId}/retry`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, 'queued');
    assert.equal(db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(failedId).status, 'queued');
    assert.equal(db.prepare('SELECT attempts FROM agent_tasks WHERE id = ?').get(failedId).attempts, 0);

    const again = await call(env, 'POST', `/api/autonomy/tasks/${failedId}/retry`);
    assert.equal(again.status, 409, 'now queued — no longer retryable');

    const missing = await call(env, 'POST', '/api/autonomy/tasks/99999/retry');
    assert.equal(missing.status, 404);
  });
});

describe('POST /api/autonomy/settings — auto toggles', () => {
  it('accepts the auto_* toggles and persists them; publishing_mode accepts auto (three-part enablement)', async () => {
    // Coordinator change 2026-11-21 (owner full-automation brief):
    // publishing_mode 'auto' is now accepted via the API. It alone
    // publishes nothing — auto-publish also needs auto_publishing
    // 'on' AND auto_publish_eligible_since set, and never touches
    // existing drafts.
    const { db, env } = freshEnv();
    const on = await call(env, 'POST', '/api/autonomy/settings', { key: 'auto_research', value: 'on' });
    assert.equal(on.status, 200);
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'auto_research'").get().value, 'on');
    const bad = await call(env, 'POST', '/api/autonomy/settings', { key: 'auto_research', value: 'maybe' });
    assert.equal(bad.status, 400);
    const mode = await call(env, 'POST', '/api/autonomy/settings', { key: 'publishing_mode', value: 'auto' });
    assert.equal(mode.status, 200, 'publishing_mode auto is accepted (three-part enablement)');
    assert.equal(db.prepare("SELECT value FROM autonomy_settings WHERE key = 'publishing_mode'").get().value, 'auto');
    const settings = await call(env, 'GET', '/api/autonomy/settings');
    assert.equal(settings.status, 200);
    assert.equal(settings.json.settings.auto_research, 'on');
  });
});
