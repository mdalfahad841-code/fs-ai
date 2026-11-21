// FS AI — Reliability acceptance test (owner addendum 2026-11-21 12:05,
// ZERO-FAILURE OPERATIONAL DESIGN).
//
// Simulates each required failure scenario against the REAL merged code
// and verifies safe recovery or a clear block — never a silent failure,
// never a fake success, never a duplicate publish, never an infinite
// retry loop. Scenarios: (1) AI timeout, (2) database interruption,
// (3) duplicate task, (4) expired social token, (5) API rate limit,
// (6) invalid article, (7) failed fact-check, (8) stale SEO result,
// (9) Worker restart (stale running task), (10) interrupted publishing
// operation, (11) network interruption. Plus repeated scheduled-cycle
// tests (drain twice, weekly report twice, auto-publish twice).
//
// Harness: real SQLite (node:sqlite) built from database/schema.sql +
// migrations, same pattern as tests/queue-drain.test.js and
// tests/autonomous-publishing.test.js. All platform calls are mocked
// fetch; no network, no live D1, no real platform. Delays are stubbed
// to instant. Run: node --test tests/reliability-acceptance.test.js
// (or: npm test). Requires node:sqlite (Node >= 22.5).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runTask, drainTaskQueue, recoverStaleTasks, runWeeklyWorkflow,
} = require('../backend/routes/scheduler.js');
const { generateWithWorkersAI } = require('../backend/llm/providers/cloudflare-workers-ai.js');
const { dispatchPost } = require('../backend/social/dispatcher.js');
const { encryptToken } = require('../backend/social/tokens.js');
const { evaluatePublishGate, evaluateAutoPublishEligibility } = require('../backend/publishing/gate.js');
const { autoPublishArticle } = require('../backend/agents/autonomy/publishing.js');
const { bodyHash } = require('../backend/utils/bodyHash.js');

const ROOT = path.join(__dirname, '..');
const SOCIAL_SECRET = 'reliability-test-secret-2026-11-21';

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
    'database/migrations/020_task_lifecycle_health.sql',
    'database/migrations/021_publication_logs.sql',
    'database/migrations/022_social_media.sql',
    'database/migrations/023_seo_body_hash.sql',
  ]);
  return { db, env: { DB: makeRealD1(db), SOCIAL_TOKEN_SECRET: SOCIAL_SECRET } };
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO autonomy_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function setEmergencyStop(db, on) {
  db.prepare("INSERT OR REPLACE INTO website_settings (setting_key, setting_value) VALUES ('emergency_stop', ?)").run(on ? '1' : '0');
}

function insertDraft(db, { id = 100, divisionId = 1, body = null, createdAt = null } = {}) {
  const now = new Date().toISOString();
  const b = body !== null ? body : 'Electric cars are changing how we drive. A home charger adds about 40 kilometres of range per hour of charging. Related reading: https://fs-ai-5w5.pages.dev/pages/article?id=1';
  // Title must share topical keywords with the linked sibling (#1, "EV
  // Charging at Home") or the evaluator's genuine-relevance check
  // refuses the internal link — "Reliability test draft" shares none.
  const r = db.prepare(
    'INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, divisionId, 'Electric Car Charging Guide', 'electric-car-charging-guide', 'test', b, 'FS AI', 'draft', 0, createdAt || now, createdAt || now);
  return Number(r.lastInsertRowid || id);
}

function seoChecksJson() {
  return JSON.stringify([
    { name: 'seo-title', ok: true },
    { name: 'meta-description', ok: true },
    { name: 'slug-unique', ok: true },
    { name: 'heading-hierarchy', ok: true },
    { name: 'keyword-relevance', ok: true },
    { name: 'internal-links', ok: true, detail: 'Body links to at least one other published article.' },
    { name: 'image-alt', ok: true },
    { name: 'readability', ok: true, detail: 'Estimate: 40 words.' },
    { name: 'duplicate', ok: true, detail: 'Highest 5-word shingle overlap with another published article: 0%.' },
    { name: 'broken-links', ok: true },
    { name: 'structured-metadata', ok: true },
  ]);
}

async function makeEligible(db, articleId) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  const hash = await bodyHash(article.body);
  const fc = db.prepare(
    'INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, body_hash) VALUES (?, ?, 2, 2, 0, ?)',
  ).run(articleId, 'pass', hash);
  const fcId = Number(fc.lastInsertRowid);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'EV sales reached 14 million units worldwide in 2023.', 'VERIFIED', 'https://example.com/source-1', 'EV sales reached 14 million units.', 'Supported.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO claim_checks (fact_check_id, claim_text, verdict, evidence_url, evidence_quote, explanation) VALUES (?, 'A home charger adds about 40 kilometres of range per hour.', 'VERIFIED', 'https://example.com/source-2', 'A home charger adds about 40 kilometres of range per hour.', 'Supported.')",
  ).run(fcId);
  db.prepare(
    "INSERT INTO article_sources (article_id, source_title, source_url, source_type, accessed_at) VALUES (?, 'Test source', 'https://example.com/source-1', 'other', '2026-11-19T12:00:00Z')",
  ).run(articleId);
  db.prepare('INSERT INTO seo_checks (article_id, verdict, checks_json, created_at) VALUES (?, ?, ?, ?)').run(
    articleId, 'pass', seoChecksJson(), article.updated_at);
  return fcId;
}

function enableAutoPublish(db) {
  setSetting(db, 'publishing_mode', 'auto');
  setSetting(db, 'auto_publishing', 'on');
  setSetting(db, 'auto_publish_eligible_since', new Date(Date.now() - 3600 * 1000).toISOString());
}

async function seedPinterestAccount(db, { expired = false } = {}) {
  const enc = await encryptToken('test-pinterest-token', SOCIAL_SECRET);
  const expires = new Date(Date.now() + (expired ? -86400 : 86400) * 1000).toISOString();
  const r = db.prepare(
    "INSERT INTO social_accounts (platform, account_name, account_id, status, scopes, access_token_enc, token_expires_at, last_verified_at) VALUES ('pinterest', 'FS AI', 'pinterest-test', 'connected', 'pins:read,pins:write', ?, ?, ?)",
  ).run(enc, expires, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function seedPinterestPost(db, articleId = 1) {
  const r = db.prepare(
    "INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, media_url) VALUES (?, 'pinterest', ?, 'draft', ?, ?)",
  ).run(articleId, `reliability-pin-${articleId}-${Date.now()}`, 'Test pin caption for the reliability run.', 'https://fs-ai-5w5.pages.dev/pin.jpg');
  return Number(r.lastInsertRowid);
}

// Valid Pinterest publish input: the adapter expects content as an
// object (title/description/link/mediaUrl) plus a board id — a bare
// string fails validation before any platform call is made.
const PIN_INPUT = {
  content: {
    title: 'Test pin title',
    description: 'Test pin description for the reliability run.',
    link: 'https://fs-ai-5w5.pages.dev/pages/article?id=1',
    mediaUrl: 'https://fs-ai-5w5.pages.dev/pin.jpg',
  },
  boardId: 'test-board-1',
};

const instantDelay = () => Promise.resolve();

// ---------------------------------------------------------------------------
// Scenario 1 — AI timeout: a hung Workers AI call must fail fast, never hang.
// ---------------------------------------------------------------------------
describe('scenario 1 — AI timeout', () => {
  it('a never-resolving Workers AI call returns a failure within the timeout (all models tried, none hangs)', async () => {
    const hangingAI = { run: () => new Promise(() => {}) };
    const started = Date.now();
    const res = await generateWithWorkersAI(
      { AI: hangingAI },
      { prompt: 'Write one sentence about electric cars.', maxTokens: 50 },
      { timeoutMs: 25 },
    );
    const elapsed = Date.now() - started;
    assert.equal(res.ok, false, 'a hung call must not report success');
    assert.equal(res.reason, 'error');
    assert.ok(elapsed < 5000, `must return promptly, took ${elapsed}ms`);
    assert.match(String(res.detail || ''), /failed|timeout/i);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — database interruption: no fake success, no lost task.
// ---------------------------------------------------------------------------
describe('scenario 2 — database interruption', () => {
  it('a DB failure mid-run leaves the task queued with attempts unchanged and no success recorded', async () => {
    const { db, env } = freshEnv();
    const res = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'rel-db-1' });
    const taskId = res.task.id;
    const brokenDb = { prepare: () => { throw new Error('D1 simulated outage: database is locked'); } };
    const brokenEnv = { ...env, DB: brokenDb };
    let outcome = 'returned';
    try {
      const r = await runTask(brokenEnv, taskId);
      outcome = r && r.outcome ? String(r.outcome) : 'returned-no-outcome';
    } catch (err) {
      outcome = `threw: ${String((err && err.message) || err)}`;
    }
    // Either a controlled failure or a throw is acceptable — what is NOT
    // acceptable is a success. The task must survive untouched.
    assert.ok(outcome !== 'done', `DB outage must never report done (got ${outcome})`);
    const row = db.prepare('SELECT status, attempts FROM agent_tasks WHERE id = ?').get(taskId);
    assert.equal(row.status, 'queued', 'task stays queued — nothing lost, nothing half-applied');
    assert.equal(row.attempts, 0, 'attempts not consumed by an outage that never ran the handler');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ? AND outcome = 'done'").get(taskId).n,
      0, 'no successful run row may exist for a task that never ran',
    );
  });

  it('the drain refuses to start when the health check reports the database blocked', async () => {
    const { db, env } = freshEnv();
    await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'rel-db-2' });
    const brokenEnv = { ...env, DB: { prepare: () => { throw new Error('D1 simulated outage'); } } };
    const drain = await drainTaskQueue(brokenEnv);
    assert.equal(drain.processed, 0, 'nothing runs while the database is unreachable');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'queued'").get().n,
      1, 'the queued task is still there for the next healthy run',
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — duplicate task: same idempotency key runs exactly once.
// ---------------------------------------------------------------------------
describe('scenario 3 — duplicate task', () => {
  it('enqueuing the same idempotency key twice creates one row and runs the task once', async () => {
    const { db, env } = freshEnv();
    const first = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'rel-dup-1' });
    const second = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'rel-dup-1' });
    assert.equal(first.ok, true);
    assert.equal(second.duplicate, true, 'second enqueue must be recognised as a duplicate');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE idempotency_key = 'rel-dup-1'").get().n, 1);
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?").get(first.task.id).n, 1,
      'exactly one run row for the duplicated task');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — expired social token: no platform call, clear auth block.
// ---------------------------------------------------------------------------
describe('scenario 4 — expired social token', () => {
  it('an expired token stops the post before any platform call, with WAITING_FOR_AUTHORIZATION', async () => {
    const { db, env } = freshEnv();
    await seedPinterestAccount(db, { expired: true });
    const postId = seedPinterestPost(db, 1);
    let fetchCalls = 0;
    const fetchFn = async () => { fetchCalls += 1; return new Response('{}', { status: 200 }); };
    const res = await dispatchPost(env, postId, PIN_INPUT, { fetchFn, delayFn: instantDelay });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'waiting_authorization');
    assert.equal(fetchCalls, 0, 'no platform call may happen with an expired token');
    const row = db.prepare('SELECT status, platform_post_id FROM social_posts WHERE id = ?').get(postId);
    assert.equal(row.status, 'waiting_authorization');
    assert.equal(row.platform_post_id, null, 'no post id without platform confirmation');
    assert.match(String(res.failure.rootCause || ''), /expired/i);
    assert.ok(res.failure.ownerAction, 'the failure must name the owner action (re-authorize)');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — API rate limit: transient 429 retried (max 3), then a clear block.
// ---------------------------------------------------------------------------
describe('scenario 5 — API rate limit', () => {
  it('persistent HTTP 429 is retried at most 3 times, then recorded rate_limited with no publish', async () => {
    const { db, env } = freshEnv();
    await seedPinterestAccount(db, { expired: false });
    const postId = seedPinterestPost(db, 1);
    let fetchCalls = 0;
    const delays = [];
    const fetchFn = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    };
    const res = await dispatchPost(env, postId, PIN_INPUT, { fetchFn, delayFn: async (ms) => { delays.push(ms); } });
    assert.equal(res.ok, false);
    assert.equal(fetchCalls, 3, 'exactly 3 attempts, no infinite retry');
    assert.deepEqual(delays, [1000, 2000], 'exponential backoff 1s -> 2s');
    assert.equal(res.status, 'rate_limited');
    const row = db.prepare('SELECT status, attempts, platform_post_id FROM social_posts WHERE id = ?').get(postId);
    assert.equal(row.status, 'rate_limited');
    assert.equal(row.attempts, 3);
    assert.equal(row.platform_post_id, null);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — invalid article: refused everywhere, nothing published.
// ---------------------------------------------------------------------------
describe('scenario 6 — invalid article', () => {
  it('fact-checking a non-existent article fails cleanly and auto-publish refuses it', async () => {
    const { db, env } = freshEnv();
    const res = await enqueueTask(env, { agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 }, idempotency_key: 'rel-invalid-1' });
    const run = await runTask(env, res.task.id);
    assert.equal(run.outcome, 'failed', 'a missing article must fail, never silently pass');
    const gate = await evaluatePublishGate(env, 99999);
    assert.equal(gate.eligible, false);
    const pub = await autoPublishArticle(env, 99999);
    assert.equal(pub.ok, false, 'auto-publish must refuse a non-existent article');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE id = 99999").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM publication_logs WHERE article_id = 99999 AND action = 'auto-publish'").get().n, 0,
      'no success log row for an article that does not exist');
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — failed fact-check: the gate refuses, the draft stays a draft.
// ---------------------------------------------------------------------------
describe('scenario 7 — failed fact-check', () => {
  it('a scaffold draft fails its fact-check, the gate blocks it, and nothing is published', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db, { id: 100, body: 'SCAFFOLD — full draft needed.\n\n## Section One\n\n[Write this section — no content yet.]' });
    // The LLM must not be needed (and must not be called) to fail a scaffold.
    const noLlmEnv = { ...env, AI: { run: async () => { throw new Error('LLM must not be called for a scaffold fact-check'); } } };
    const res = await enqueueTask(noLlmEnv, { agent: 'fact-checking', kind: 'fact-check', payload: { article_id: id }, idempotency_key: 'rel-fc-fail-1' });
    const run = await runTask(noLlmEnv, res.task.id);
    assert.equal(run.outcome, 'done', 'the check itself completes (it records a failure verdict)');
    const fc = db.prepare('SELECT verdict, claims_total FROM fact_checks WHERE article_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.ok(fc, 'a fact-check row must be written');
    assert.equal(fc.verdict, 'failed', 'a scaffold must fail its fact-check');
    const gate = await evaluatePublishGate(noLlmEnv, id);
    assert.equal(gate.eligible, false, 'a failed fact-check blocks the gate');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(id).status, 'draft');
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — stale SEO result: an edited body invalidates the old SEO pass.
// ---------------------------------------------------------------------------
describe('scenario 8 — stale SEO result', () => {
  it('an SEO pass recorded before a body edit is stale and blocks auto-publish', async () => {
    const { db, env } = freshEnv();
    const id = insertDraft(db, { id: 101 });
    // SEO pass from yesterday, no body hash (legacy row), body edited since.
    db.prepare('INSERT INTO seo_checks (article_id, verdict, checks_json, created_at) VALUES (?, ?, ?, ?)').run(
      id, 'pass', seoChecksJson(), '2026-11-20T00:00:00.000Z');
    db.prepare('UPDATE articles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    const gate = await evaluatePublishGate(env, id);
    const seoCheck = (gate.checks || []).find((c) => c.name === 'seo-pass');
    assert.ok(seoCheck, 'gate must report an seo-pass check');
    assert.equal(seoCheck.ok, false, 'a stale SEO pass must not satisfy the gate');
    assert.match(String(seoCheck.detail || ''), /stale/i);
    assert.equal(gate.eligible, false);
    const verdict = await evaluateAutoPublishEligibility(env, id);
    assert.equal(verdict.eligible, false, 'auto-publish must refuse on a stale SEO result');
  });
});

// ---------------------------------------------------------------------------
// Scenario 9 — Worker restart: a stale running task is recovered, then runs.
// ---------------------------------------------------------------------------
describe('scenario 9 — Worker restart (stale running task)', () => {
  it('a task left running past the 10-minute lease is recovered and then completes exactly once', async () => {
    const { db, env } = freshEnv();
    const res = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'rel-restart-1' });
    const taskId = res.task.id;
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    // Staleness is measured on updated_at (scheduler.js isTaskStale),
    // not started_at — there is no started_at column on agent_tasks.
    db.prepare("UPDATE agent_tasks SET status = 'running', updated_at = ? WHERE id = ?").run(staleAt, taskId);
    const recovered = await recoverStaleTasks(env);
    // recoverStaleTasks returns { recovered: [...] } — an ARRAY, not a count.
    assert.ok(Array.isArray(recovered.recovered) && recovered.recovered.length >= 1, 'the stale running task must be recovered');
    // Self-healing (owner zero-failure brief): the recovered task is
    // RE-QUEUED with backoff and RETRYING — not left 'failed' for a
    // manual retry. The drain skips it until the backoff elapses.
    const after = db.prepare('SELECT status, terminal_state, scheduled_for FROM agent_tasks WHERE id = ?').get(taskId);
    assert.equal(after.status, 'queued', 'recovered task re-queues automatically');
    assert.equal(after.terminal_state, 'RETRYING');
    assert.ok(Date.parse(after.scheduled_for) > Date.now(), 'backoff is in the future');
    // Simulate the backoff elapsing (the drain honours scheduled_for).
    db.prepare('UPDATE agent_tasks SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), taskId);
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 1, 'the recovered task runs on the next drain');
    const done = db.prepare('SELECT status, terminal_state FROM agent_tasks WHERE id = ?').get(taskId);
    assert.equal(done.status, 'done', 'the recovered task completes');
    assert.equal(done.terminal_state, 'COMPLETED');
    const runs = db.prepare('SELECT outcome FROM agent_runs WHERE task_id = ?').all(taskId);
    assert.equal(runs.length, 2, 'one recovery row (stale-lock) + one execution row');
    assert.equal(runs.filter((r) => r.outcome !== 'failed').length, 1,
      'the work itself runs exactly once after the restart — no duplicate execution');
  });
});

// ---------------------------------------------------------------------------
// Scenario 10 — interrupted publishing: log failure rolls back, retry succeeds.
// ---------------------------------------------------------------------------
describe('scenario 10 — interrupted publishing operation', () => {
  it('a publication-log failure after the status flip rolls the article back; a retry then publishes once', async () => {
    const { db, env } = freshEnv();
    enableAutoPublish(db);
    const id = insertDraft(db, { id: 100 });
    await makeEligible(db, id);
    db.exec("CREATE TRIGGER fail_publog BEFORE INSERT ON publication_logs BEGIN SELECT RAISE(ABORT, 'simulated log failure'); END;");
    const interrupted = await autoPublishArticle(env, id);
    assert.equal(interrupted.ok, false, 'an interrupted publish must report failure, never success');
    assert.equal(db.prepare('SELECT status, published_at FROM articles WHERE id = ?').get(id).status, 'draft',
      'the article must roll back to draft');
    assert.equal(db.prepare('SELECT published_at FROM articles WHERE id = ?').get(id).published_at, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM publication_logs WHERE article_id = ? AND action = 'auto-publish'").get(id).n, 0,
      'no success log row for the interrupted publish');
    db.exec('DROP TRIGGER fail_publog');
    const retry = await autoPublishArticle(env, id);
    assert.equal(retry.ok, true, 'the retry after the interruption clears must publish');
    assert.equal(retry.outcome, 'published');
    assert.equal(db.prepare('SELECT status FROM articles WHERE id = ?').get(id).status, 'published');
    const second = await autoPublishArticle(env, id);
    assert.equal(second.ok, false, 'a second publish attempt must refuse (idempotency)');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM publication_logs WHERE article_id = ? AND action = 'auto-publish'").get(id).n, 1,
      'exactly one success log row — no duplicate publish');
  });
});

// ---------------------------------------------------------------------------
// Scenario 11 — network interruption: transient failure, retried, never faked.
// ---------------------------------------------------------------------------
describe('scenario 11 — network interruption', () => {
  it('a throwing fetch is retried at most 3 times and never recorded as published', async () => {
    const { db, env } = freshEnv();
    await seedPinterestAccount(db, { expired: false });
    const postId = seedPinterestPost(db, 1);
    let fetchCalls = 0;
    const fetchFn = async () => { fetchCalls += 1; throw new TypeError('fetch failed'); };
    const res = await dispatchPost(env, postId, PIN_INPUT, { fetchFn, delayFn: instantDelay });
    assert.equal(res.ok, false);
    assert.equal(fetchCalls, 3, 'exactly 3 attempts, no infinite retry');
    const row = db.prepare('SELECT status, attempts, platform_post_id, error FROM social_posts WHERE id = ?').get(postId);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 3);
    assert.equal(row.platform_post_id, null, 'no post id without platform confirmation');
    assert.match(String(row.error || ''), /fetch failed/i, 'the real root cause must be recorded');
  });
});

// ---------------------------------------------------------------------------
// Repeated scheduled cycles: drain twice, weekly twice, auto-publish twice.
// ---------------------------------------------------------------------------
describe('repeated scheduled cycles', () => {
  it('draining the queue twice executes each task exactly once', async () => {
    const { db, env } = freshEnv();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: `rel-cycle-${i}` });
      ids.push(r.task.id);
    }
    const first = await drainTaskQueue(env);
    assert.equal(first.processed, 3);
    const second = await drainTaskQueue(env);
    assert.equal(second.processed, 0, 'the second drain in the same cycle must be a no-op');
    for (const id of ids) {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?").get(id).n, 1,
        `task ${id} ran exactly once across both drains (analytics snapshot completes as no-op)`);
    }
  });

  it('the weekly report run twice on the same day is duplicate-guarded', async () => {
    const { env } = freshEnv();
    const first = await runWeeklyWorkflow(env);
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await runWeeklyWorkflow(env);
    assert.ok(second.duplicate === true || second.already_completed === true || second.ok === false,
      `second weekly run must be refused as a duplicate (got ${JSON.stringify(second)})`);
  });

  it('the Emergency Stop blocks the drain and the health check reports it', async () => {
    const { db, env } = freshEnv();
    await enqueueTask(env, { agent: 'analytics', kind: 'snapshot', payload: {}, idempotency_key: 'rel-estop-1' });
    setEmergencyStop(db, true);
    const drain = await drainTaskQueue(env);
    assert.equal(drain.processed, 0, 'nothing drains while the Emergency Stop is ON');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'queued'").get().n, 1,
      'the task waits, unharmed, for the stop to lift');
    setEmergencyStop(db, false);
    const after = await drainTaskQueue(env);
    assert.equal(after.processed, 1, 'the task runs once the stop lifts');
  });
});
