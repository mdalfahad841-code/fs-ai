// FS AI — W5 Control Center tests (dashboard-status-truth additions).
//
// Backend: GET /api/analytics/detail sections return real D1 data with
// { data, asOf, freshness }; anything the backend cannot supply is
// { status: 'unavailable', reason, value: null } — never a fabricated
// number. GA4 traffic, search, social and engagement are unavailable
// (no GA4 Data API, no social tables in D1); revenue is honestly $0.00.
// GET /api/health/latest returns 'unknown' when the W1
// system_health_checks table is absent, and real latest-per-component
// rows (with >25h staleness) once it exists.
//
// Frontend: the Control Center (dashboard.js) renders real API values
// (approved_only, E-Stop OFF), "Data unavailable" for traffic, and
// "Authorization required" for unconnected social platforms; the
// YouTube panel never contains a password field and never claims
// "connected"; timestamps render in Asia/Dhaka.
// Run: node --test tests/control-center.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { DatabaseSync } = require('node:sqlite');
const { handleAnalyticsDetail, GA4_UNAVAILABLE, isStaleIso } = require('../backend/routes/analytics.js');
const { handleHealthLatest, deriveOverall, HEALTH_STALE_AFTER_MS } = require('../backend/routes/health.js');
const { HONEST_ANALYTICS } = require('../backend/routes/analytics.js');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Real-SQLite harness (same pattern as tests/autonomy-analytics.test.js)
// ---------------------------------------------------------------------------
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

// Relative to the real clock: the two "today" rows must land on the real
// today, or the ai-usage test decays the day after it is written.
const NOW = new Date().toISOString();
const SIX_DAYS_AGO = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString();

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
  // Two drafts: #101 has a STALE fact-check (checked before the last
  // edit), #102 has a fresh one. Explicit ids avoid the seed's 1–25.
  db.prepare(
    "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, updated_at) VALUES (101, 2, 'Control Center Draft', 'control-center-draft', 'x', 'Body text here.', 'FS AI', 'draft', 0, '2026-11-21T10:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO articles (id, division_id, title, slug, excerpt, body, author, status, fact_checked, updated_at) VALUES (102, 1, 'Fresh Draft', 'fresh-draft', 'x', 'Body text here.', 'FS AI', 'draft', 0, '2026-11-20T10:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, created_at) VALUES (101, 'failed', 5, 2, 3, '2026-11-20T09:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO fact_checks (article_id, verdict, claims_total, claims_verified, claims_failed, created_at) VALUES (102, 'pass', 3, 3, 0, '2026-11-20T11:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO seo_checks (article_id, verdict, checks_json, created_at) VALUES (101, 'needs-review', '{}', '2026-11-20T09:00:00.000Z')",
  ).run();
  // Failed tasks: #1 exhausted (permanent, owner action), #2 retryable.
  db.prepare(
    "INSERT INTO agent_tasks (agent, kind, payload, priority, status, attempts, max_attempts, idempotency_key, created_at, updated_at) VALUES ('fact-checking', 'fact-check', '{}', 5, 'failed', 3, 3, 'cc-failed-permanent', '2026-11-20T08:00:00.000Z', '2026-11-21T09:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO agent_tasks (agent, kind, payload, priority, status, attempts, max_attempts, idempotency_key, created_at, updated_at) VALUES ('content-creation', 'article-draft', '{}', 5, 'failed', 1, 3, 'cc-failed-temporary', '2026-11-21T08:00:00.000Z', '2026-11-21T09:30:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO agent_tasks (agent, kind, payload, priority, status, attempts, max_attempts, idempotency_key, created_at, updated_at) VALUES ('research', 'research-fetch', '{}', 5, 'queued', 0, 3, 'cc-queued-old', '2026-11-15T00:00:54.456Z', '2026-11-15T00:00:54.456Z')",
  ).run();
  const failedTaskId = db.prepare("SELECT id FROM agent_tasks WHERE idempotency_key = 'cc-failed-permanent'").get().id;
  const tempTaskId = db.prepare("SELECT id FROM agent_tasks WHERE idempotency_key = 'cc-failed-temporary'").get().id;
  db.prepare(
    "INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (?, 'fact-checking', '2026-11-21T08:50:00.000Z', '2026-11-21T08:55:00.000Z', 'failed', ?)",
  ).run(failedTaskId, JSON.stringify({ reason: 'first attempt failed' }));
  db.prepare(
    "INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (?, 'fact-checking', '2026-11-21T08:55:00.000Z', '2026-11-21T09:00:00.000Z', 'failed', ?)",
  ).run(failedTaskId, JSON.stringify({ reason: 'LLM timeout after 120s' }));
  db.prepare(
    "INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (?, 'content-creation', '2026-11-21T09:25:00.000Z', '2026-11-21T09:30:00.000Z', 'failed', ?)",
  ).run(tempTaskId, JSON.stringify({ error: 'transient fetch error' }));
  // LLM usage: today (2 calls, 120 Neurons) + one 6-day-old row.
  db.prepare(
    "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-120b', 'content-draft', 'ok', 100, 200, 73, ?)",
  ).run(NOW);
  db.prepare(
    "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-120b', 'fact-check-judge', 'ok', 50, 30, 47, ?)",
  ).run(NOW);
  db.prepare(
    "INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, created_at) VALUES ('workers-ai', '@cf/openai/gpt-oss-120b', 'content-draft', 'ok', 10, 10, 5, ?)",
  ).run(SIX_DAYS_AGO);
  db.prepare("INSERT INTO autonomy_settings (key, value) VALUES ('llm_daily_cap_neurons', '9000') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  db.prepare(
    "INSERT INTO daily_reports (date, kind, summary_json) VALUES ('2026-11-21', 'daily', ?)",
  ).run(JSON.stringify({ errors: 0, articles: { published: 25 } }));
  db.prepare(
    "INSERT INTO daily_reports (date, kind, summary_json) VALUES ('2026-11-20', 'weekly', ?)",
  ).run(JSON.stringify({ errors: 0 }));
  return { db, env: { DB: makeRealD1(db) } };
}

async function detail(env, section) {
  const res = await handleAnalyticsDetail(
    new Request('https://fs-ai.test/api/analytics/detail?section=' + encodeURIComponent(section)),
    env,
  );
  assert.equal(res.status, 200, 'detail/' + section + ' must answer 200');
  return res.json();
}

// ---------------------------------------------------------------------------
// Backend: analytics detail sections
// ---------------------------------------------------------------------------
describe('analytics detail — unavailable metrics stay unavailable', () => {
  it('traffic returns GA4 unavailable with value null, never a number', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'traffic');
    assert.equal(r.section, 'traffic');
    assert.equal(r.data.traffic.status, 'unavailable');
    assert.equal(r.data.traffic.value, null);
    assert.ok(r.data.traffic.reason.includes('GA4 data is not stored in D1'));
    assert.equal(r.data.search.status, 'unavailable');
    assert.equal(r.data.search.value, null);
    assert.ok(r.asOf, 'asOf timestamp is present');
    assert.ok(r.freshness && r.freshness.asOf, 'freshness block is present');
  });

  it('GA4_UNAVAILABLE constant matches the required wording', () => {
    assert.equal(GA4_UNAVAILABLE.status, 'unavailable');
    assert.equal(GA4_UNAVAILABLE.value, null);
    assert.equal(GA4_UNAVAILABLE.reason, 'GA4 data is not stored in D1; connect the GA4 Data API or check the GA4 console');
  });

  it('social and engagement are unavailable while the W4 tables do not exist', async () => {
    const { env } = freshEnv();
    const social = await detail(env, 'social');
    assert.equal(social.data.status, 'unavailable');
    assert.equal(social.data.value, null);
    assert.ok(social.data.reason.includes('social_posts'));
    const eng = await detail(env, 'engagement');
    assert.equal(eng.data.status, 'unavailable');
    assert.equal(eng.data.value, null);
  });

  it('revenue is honestly $0.00 from website_settings', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'revenue');
    assert.equal(r.data.totalRevenueUsd, 0);
    assert.equal(r.data.formatted, '$0.00');
    assert.equal(r.data.adsenseConnected, false);
    assert.equal(HONEST_ANALYTICS.revenue, 0, 'legacy analytics constant still $0.00');
  });
});

describe('analytics detail — real-data sections', () => {
  it('articles counts the seeded 25 published plus the 2 inserted drafts', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'articles');
    assert.equal(r.data.published, 25);
    assert.equal(r.data.drafts, 2);
    assert.equal(r.data.total, 27);
    assert.equal(r.data.byDivision.length, 8);
  });

  it('ai-usage aggregates today + 7 days against the 9000-Neuron cap', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'ai-usage');
    assert.equal(r.data.today.calls, 2);
    assert.equal(r.data.today.neurons, 120);
    assert.equal(r.data.last7d.calls, 3);
    assert.equal(r.data.last7d.neurons, 125);
    assert.equal(r.data.capNeurons, 9000);
    assert.equal(r.data.todayPctOfCap, 1.3);
    assert.equal(r.data.remainingNeuronsToday, 8880);
    assert.equal(r.data.provider, 'workers-ai');
  });

  it('errors lists failed tasks with root cause, retry history and owner-action flag', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'errors');
    assert.equal(r.data.failedTasks.length, 2);
    const permanent = r.data.failedTasks.find((t) => t.attempts === 3);
    assert.equal(permanent.errorType, 'permanent');
    assert.equal(permanent.ownerAction, true);
    assert.equal(permanent.rootCause, 'LLM timeout after 120s');
    assert.equal(permanent.retryHistory.runs, 2);
    assert.equal(permanent.retryHistory.attempts, 3);
    const temporary = r.data.failedTasks.find((t) => t.attempts === 1);
    assert.equal(temporary.errorType, 'temporary');
    assert.equal(temporary.ownerAction, false);
    assert.equal(temporary.rootCause, 'transient fetch error');
  });

  it('queue counts tasks and reports the oldest queued task', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'queue');
    assert.equal(r.data.counts.queued, 1);
    assert.equal(r.data.counts.failed, 2);
    assert.equal(r.data.oldestQueuedAt, '2026-11-15T00:00:54.456Z');
    assert.ok(r.data.oldestQueuedAgeHours > 100, 'oldest queued task is days old');
    assert.equal(r.data.failedTasks.length, 2);
  });

  it('factchecks flags a check older than its article edit as stale', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'factchecks');
    const stale = r.data.find((f) => f.articleId === 101);
    assert.ok(stale, 'draft 101 has a fact-check row');
    assert.equal(stale.verdict, 'failed');
    assert.equal(stale.stale, true);
    const fresh = r.data.find((f) => f.articleId === 102);
    assert.equal(fresh.stale, false);
    assert.equal(fresh.verdict, 'pass');
  });

  it('seo returns the latest check per draft', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'seo');
    const row = r.data.find((s) => s.articleId === 101);
    assert.equal(row.verdict, 'needs-review');
    assert.equal(row.stale, true);
  });

  it('reports returns the latest daily and weekly rows with parsed summaries', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'reports');
    assert.equal(r.data.latestDaily.date, '2026-11-21');
    assert.equal(r.data.latestDaily.summary.errors, 0);
    assert.equal(r.data.latestWeekly.date, '2026-11-20');
    assert.equal(r.data.recent.length, 2);
  });

  it('activity returns the latest agent runs with reasons', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'activity');
    assert.equal(r.data.length, 3);
    assert.equal(r.data[0].agent, 'content-creation');
    assert.equal(r.data[0].reason, 'transient fetch error');
  });

  it('research counts active sources and 7-day items', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'research');
    assert.equal(r.data.activeSources, 24);
    assert.equal(r.data.itemsTotal, 0);
  });

  it('section=all returns every section wrapped with data/asOf/freshness', async () => {
    const { env } = freshEnv();
    const r = await detail(env, 'all');
    for (const name of ['articles', 'drafts', 'research', 'factchecks', 'seo', 'traffic', 'social', 'engagement', 'revenue', 'ai-usage', 'errors', 'queue', 'reports', 'activity']) {
      assert.ok(r.data[name], 'all must include section ' + name);
      assert.ok('data' in r.data[name], name + ' must carry data');
      assert.ok(r.data[name].asOf, name + ' must carry asOf');
      assert.ok(r.data[name].freshness, name + ' must carry freshness');
    }
    assert.equal(r.data.traffic.data.traffic.value, null, 'all/traffic is still unavailable, not fabricated');
  });

  it('unknown section is a 400 and no DB is a 503', async () => {
    const { env } = freshEnv();
    const bad = await handleAnalyticsDetail(
      new Request('https://fs-ai.test/api/analytics/detail?section=nope'), env);
    assert.equal(bad.status, 400);
    const noDb = await handleAnalyticsDetail(
      new Request('https://fs-ai.test/api/analytics/detail?section=articles'), {});
    assert.equal(noDb.status, 503);
  });
});

describe('isStaleIso', () => {
  it('marks timestamps older than the limit as stale', () => {
    const now = Date.parse('2026-11-21T12:00:00.000Z');
    assert.equal(isStaleIso('2026-11-20T10:00:00.000Z', HEALTH_STALE_AFTER_MS, now), true);
    assert.equal(isStaleIso('2026-11-21T11:00:00.000Z', HEALTH_STALE_AFTER_MS, now), false);
    assert.equal(isStaleIso(null, HEALTH_STALE_AFTER_MS, now), true);
  });
});

// ---------------------------------------------------------------------------
// Backend: health endpoint
// ---------------------------------------------------------------------------
describe('GET /api/health/latest', () => {
  it('returns unknown gracefully when the table is absent (W1 not merged)', async () => {
    const { env } = freshEnv();
    const res = await handleHealthLatest(new Request('https://fs-ai.test/api/health/latest'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.overall, 'unknown');
    assert.deepEqual(body.checks, []);
    assert.equal(body.note, 'health service not yet deployed');
    assert.ok(body.asOf);
  });

  it('returns latest-per-component rows, degraded overall, and stale flags once the table exists', async () => {
    const { db, env } = freshEnv();
    db.exec(
      "CREATE TABLE system_health_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, checked_at TEXT NOT NULL, component TEXT NOT NULL, status TEXT NOT NULL, detail_json TEXT)",
    );
    // Two rows for 'worker': the older one must be ignored.
    db.prepare(
      "INSERT INTO system_health_checks (checked_at, component, status, detail_json) VALUES ('2026-11-20T10:00:00.000Z', 'worker', 'fail', '{\"error\":\"old\"}')",
    ).run();
    db.prepare(
      "INSERT INTO system_health_checks (checked_at, component, status, detail_json) VALUES ('2026-11-21T11:00:00.000Z', 'worker', 'ok', '{\"uptime\":\"99%\"}')",
    ).run();
    db.prepare(
      "INSERT INTO system_health_checks (checked_at, component, status, detail_json) VALUES ('2026-11-21T11:00:00.000Z', 'd1', 'warn', '{\"note\":\"slow queries\"}')",
    ).run();
    db.prepare(
      "INSERT INTO system_health_checks (checked_at, component, status, detail_json) VALUES ('2026-11-19T08:00:00.000Z', 'rss', 'ok', null)",
    ).run();
    const res = await handleHealthLatest(new Request('https://fs-ai.test/api/health/latest'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.overall, 'degraded');
    assert.equal(body.checks.length, 3);
    const worker = body.checks.find((c) => c.component === 'worker');
    assert.equal(worker.status, 'ok', 'latest worker row wins');
    assert.equal(worker.detail.uptime, '99%');
    const rss = body.checks.find((c) => c.component === 'rss');
    assert.equal(rss.stale, true, 'a check older than 25h is stale');
    assert.ok(body.freshness.stale, 'freshness reports the stale check');
  });

  it('deriveOverall: ok / degraded / failing / unknown', () => {
    assert.equal(deriveOverall([]), 'unknown');
    assert.equal(deriveOverall([{ status: 'ok' }, { status: 'pass' }]), 'ok');
    assert.equal(deriveOverall([{ status: 'ok' }, { status: 'warn' }]), 'degraded');
    assert.equal(deriveOverall([{ status: 'ok' }, { status: 'failed' }]), 'failing');
    assert.equal(deriveOverall([{ status: 'error' }]), 'failing');
  });
});

// ---------------------------------------------------------------------------
// Frontend: Control Center rendering (DOM shim + canned fetch, vm sandbox)
// ---------------------------------------------------------------------------
function makeDomSandbox(fetchImpl) {
  const byId = new Map();
  const textLog = [];
  const listeners = new Map();
  const dispatched = [];

  function registerIds(html) {
    if (typeof html !== 'string') return;
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (!byId.has(m[1])) byId.set(m[1], makeEl('div', m[1]));
    }
  }

  function makeEl(tag, id) {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      id: id || '',
      className: '',
      style: {},
      hidden: false,
      disabled: false,
      value: '',
      _text: '',
      _html: '',
      children: [],
      nextSibling: null,
      _attrs: {},
      setAttribute(name, value) { this._attrs[name] = String(value); if (name === 'id') { this.id = String(value); byId.set(this.id, this); } },
      getAttribute(name) { return this._attrs[name] ?? null; },
      addEventListener(type, fn) {
        if (!listeners.has(this)) listeners.set(this, {});
        const m = listeners.get(this);
        (m[type] = m[type] || []).push(fn);
      },
      appendChild(child) { this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
      insertBefore(child, ref) { this.children.push(child); if (child.id) byId.set(child.id, child); return child; },
      querySelector() { return null; },
      closest() { return null; },
      scrollIntoView() {},
      reset() {},
      click() {},
    };
    Object.defineProperty(el, 'textContent', {
      get() { return this._text; },
      set(v) { this._text = String(v); if (this.id) textLog.push([this.id, String(v)]); },
    });
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html; },
      set(v) { this._html = String(v); registerIds(this._html); },
    });
    if (id) byId.set(id, el);
    return el;
  }

  const docListeners = {};
  const documentStub = {
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  };

  const sandbox = {
    console,
    document: documentStub,
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    fetch: fetchImpl,
    sessionStorage: {
      getItem() { return JSON.stringify({ mode: 'server', token: 'test-token' }); },
    },
    URL,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    __byId: byId,
    __textLog: textLog,
    __docListeners: docListeners,
    __dispatched: dispatched,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (type, fn) => { (sandbox.__winListeners[type] = sandbox.__winListeners[type] || []).push(fn); };
  sandbox.window.dispatchEvent = (ev) => { dispatched.push(ev && ev.type ? ev.type : String(ev)); return true; };
  sandbox.__winListeners = {};
  sandbox.window.FSAI = {
    esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    formatDate(d) { return String(d); },
    countsByDivision() { return []; },
    ARTICLES: [],
    DIVISIONS: [{}, {}, {}, {}, {}, {}, {}, {}],
    TOOLS: new Array(20).fill({}),
    AGENTS: new Array(16).fill({ name: 'Agent', role: 'role', status: 'active' }),
    ACCOUNTS: [],
    SITE: { revenue: '$0.00', traffic: 'Data unavailable' },
    sessionVerified: true,
    auth: { isSessionVerified() { return true; }, getSession() { return null; } },
  };
  // Pre-register every id in dashboard.html so getElementById works.
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'dashboard.html'), 'utf8');
  registerIds(html);
  const content = byId.get('dashboardContent');
  if (content) { content.hidden = false; content.style.display = ''; }
  return sandbox;
}

const tick = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('Control Center dashboard.js — live values, honest unknowns', () => {
  it('renders real settings, Data unavailable traffic, Authorization required social, Dhaka times', async () => {
    const canned = (url) => {
      const u = String(url);
      if (u.includes('/api/autonomy/status')) return jsonResponse(200, { ok: true,
        autonomyLevel: '3', targetLevel: '3', emergencyStop: false, publishingMode: 'approved_only',
        tasks: { queued: 12, running: 0, done: 19, failed: 1, skipped: 5 },
        autoFlags: { auto_research: 'on', auto_generation: 'on', auto_factcheck: 'on', auto_correction: 'off', auto_publishing: 'off' },
        source: 'd1' });
      if (u.includes('/api/autonomy/analytics')) return jsonResponse(200, { ok: true,
        articlesByStatus: { published: 25, draft: 6 },
        publishedToday: 0,
        drafts: [{ id: 31, title: 'Draft Thirty-One', status: 'draft', division: 'education-learning', isProtected: false, contentReady: false, eligible: false, blockedBy: ['fact-check 4/13 claims verified'] }],
        llmToday: { calls: 5, neurons: 120 }, llm7d: { calls: 47, neurons: 778 },
        failedTasks: [{ id: 42, agent: 'fact-checking', kind: 'fact-check', attempts: 3, maxAttempts: 3, updatedAt: '2026-11-21T09:00:00.000Z' }],
        research: { activeSources: 24, itemsDiscovered: 693 } });
      if (u.includes('/api/social/status')) return jsonResponse(404, { ok: false, error: 'Not found' });
      if (u.includes('/api/analytics/detail?section=queue')) return jsonResponse(200, { ok: true, section: 'queue',
        data: { counts: { queued: 12, running: 0, done: 19, failed: 1, skipped: 5 },
          oldestQueuedAt: '2026-11-15T00:00:54.456Z', oldestQueuedAgeHours: 150.5,
          failedTasks: [{ id: 42, agent: 'fact-checking', kind: 'fact-check', attempts: 3, maxAttempts: 3,
            createdAt: '2026-11-20T08:00:00.000Z', updatedAt: '2026-11-21T09:00:00.000Z',
            rootCause: 'LLM timeout after 120s', lastOutcome: 'failed',
            retryHistory: { runs: 2, attempts: 3, maxAttempts: 3 },
            errorType: 'permanent', ownerAction: true,
            ownerActionNote: 'Attempts exhausted — owner decides: retry manually or leave failed.' }] },
        asOf: '2026-11-21T12:00:00.000Z',
        freshness: { asOf: '2026-11-21T12:00:00.000Z', checkedAt: '2026-11-21T12:00:00.000Z', stale: false, note: '' } });
      if (u.includes('/api/analytics/detail?section=ai-usage')) return jsonResponse(200, { ok: true, section: 'ai-usage',
        data: { today: { calls: 5, neurons: 120 }, last7d: { calls: 47, neurons: 778 },
          capNeurons: 9000, todayPctOfCap: 1.3, remainingNeuronsToday: 8880 },
        asOf: '2026-11-21T12:00:00.000Z',
        freshness: { asOf: '2026-11-21T12:00:00.000Z', checkedAt: '2026-11-21T12:00:00.000Z', stale: false, note: '' } });
      if (u.includes('/api/analytics/detail?section=reports')) return jsonResponse(200, { ok: true, section: 'reports',
        data: { latestDaily: { kind: 'daily', date: '2026-11-21', created_at: '2026-11-21T00:02:08.293Z', summary: { errors: 0 } },
          latestWeekly: { kind: 'weekly', date: '2026-11-20', created_at: '2026-11-20T05:13:23.144Z', summary: { errors: 0 } },
          recent: [] },
        asOf: '2026-11-21T12:00:00.000Z',
        freshness: { asOf: '2026-11-21T12:00:00.000Z', checkedAt: '2026-11-21T12:00:00.000Z', stale: false, note: '' } });
      if (u.includes('/api/health/latest')) return jsonResponse(404, { ok: false, error: 'Not found' });
      if (u.includes('/api/analytics')) return jsonResponse(200, { ok: true,
        visitors: 'Data unavailable', pageViews: 'Data unavailable', clicks: 'Data unavailable',
        revenue: 0, revenueFormatted: '$0.00', analyticsConnected: false,
        analyticsStatus: 'Tracking Connected — Reporting API Not Connected',
        note: 'Tracking Connected — Reporting API Not Connected: GA4 tag live, no Reporting API.' });
      if (u.includes('/api/articles')) return jsonResponse(200, { ok: true, articles: [], total: 25 });
      if (u.includes('/api/divisions')) return jsonResponse(200, { ok: true, divisions: [] });
      if (u.includes('/api/admin/articles')) return jsonResponse(200, { ok: true, articles: [] });
      if (u.includes('/api/admin/divisions')) return jsonResponse(200, { ok: true, divisions: [] });
      if (u.includes('/api/tools')) return jsonResponse(200, { ok: true, tools: [] });
      if (u.includes('/api/admin/emergency-stop')) return jsonResponse(200, { ok: true, stopped: false });
      if (u.includes('/api/agents')) return jsonResponse(200, { ok: true, agents: [], source: 'd1' });
      if (u.includes('/api/accounts')) return jsonResponse(200, { ok: true, accounts: [], source: 'api' });
      if (u.includes('/api/admin/subscribers')) return jsonResponse(200, { ok: true, subscribers: [], total: 0 });
      if (u.startsWith('https://fs-ai-5w5.pages.dev/')) return jsonResponse(200, '<html><head><link rel="canonical" href="https://fs-ai-5w5.pages.dev/"></head></html>');
      return jsonResponse(404, { ok: false, error: 'Not found' });
    };

    const sandbox = makeDomSandbox(async (url) => canned(url));
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'dashboard.js'), 'utf8');
    vm.runInContext(src, sandbox);
    for (const fn of sandbox.__docListeners.DOMContentLoaded || []) fn();
    await tick();

    const byId = sandbox.__byId;
    const htmlOf = (id) => (byId.get(id) ? byId.get(id).innerHTML : '');
    const textOf = (id) => (byId.get(id) ? byId.get(id).textContent : '');

    // Automation: real settings values from the API payload.
    assert.ok(htmlOf('ccAutomationGrid').includes('approved_only'), 'publishing mode approved_only is rendered');
    assert.ok(htmlOf('ccAutomationGrid').includes('OFF'), 'Emergency Stop OFF is rendered');
    assert.ok(htmlOf('ccAutomationGrid').includes('ON'), 'auto_research ON is rendered');
    // Publishing: real counts + gate state.
    assert.ok(htmlOf('ccPublishingGrid').includes('25'), '25 published is rendered');
    assert.ok(htmlOf('ccPublishingGrid').includes('6'), '6 drafts is rendered');
    assert.ok(htmlOf('ccPublishingList').includes('Blocked'), 'newest draft shows gate Blocked');
    // Social: endpoint absent -> every platform Not connected + Authorization required.
    assert.ok(htmlOf('ccSocialList').includes('Not connected'), 'social rows say Not connected');
    assert.ok(htmlOf('ccSocialList').includes('Authorization required'), 'social rows demand authorization');
    assert.ok(!htmlOf('ccSocialList').includes('Connected</span>'), 'no platform claims Connected');
    // Alerts surface the authorization requirement.
    assert.ok(htmlOf('ccAlerts').includes('Authorization required'), 'alerts include the social authorization alert');
    // Traffic: GA4 stays Data unavailable, never a number.
    assert.ok(htmlOf('analyticsGrid').includes('Data unavailable'), 'analytics grid shows Data unavailable for traffic');
    assert.ok(textOf('analyticsStatus').includes('Tracking Connected'), 'analytics status keeps the exact GA4 wording');
    // Queue: failed task with id, root cause, permanent flag, owner action.
    assert.ok(htmlOf('ccFailedTasks').includes('#42'), 'failed task id is shown');
    assert.ok(htmlOf('ccFailedTasks').includes('LLM timeout after 120s'), 'failed task root cause is shown');
    assert.ok(htmlOf('ccFailedTasks').includes('permanent'), 'permanent error type is shown');
    assert.ok(htmlOf('ccFailedTasks').includes('Yes — owner decides'), 'owner-action flag is shown');
    assert.ok(htmlOf('ccQueueGrid').includes('15 Nov 2026'), 'oldest queued date renders in Dhaka time');
    // AI usage: real numbers vs the 9000 cap, bar width set.
    assert.ok(htmlOf('ccAiUsageGrid').includes('120'), 'Neurons today rendered');
    assert.ok(htmlOf('ccAiUsageGrid').includes('9000'), '9000-Neuron cap rendered');
    assert.ok(byId.get('ccAiUsageBar').style.width.includes('%'), 'free-tier bar width is set');
    // Health: route not wired -> unknown, never a fake healthy.
    assert.ok(htmlOf('ccHealthList').includes('unknown'), 'health is unknown while the route is unwired');
    assert.ok(htmlOf('ccHealthList').includes('not yet deployed'), 'health says not yet deployed');
    // Schedule: next runs in Dhaka time (00:00 UTC = 06:00 Dhaka).
    assert.ok(htmlOf('ccScheduleList').includes('06:00 Dhaka'), 'next run shows 06:00 Dhaka');
    assert.ok(htmlOf('ccScheduleList').includes('Daily workflow'), 'daily job is listed');
    assert.ok(htmlOf('ccScheduleList').includes('Weekly workflow'), 'weekly job is listed');
    // Reports: latest daily + weekly.
    assert.ok(htmlOf('ccReportsList').includes('Latest daily report'), 'latest daily report is listed');
    assert.ok(htmlOf('ccReportsList').includes('Latest weekly report'), 'latest weekly report is listed');
    // Freshness line carries a Dhaka timestamp.
    assert.ok(textOf('ccFreshness').includes('Dhaka'), 'freshness line is in Dhaka time');
  });

  it('YouTube panel never contains a password field and never claims connected', () => {
    const html = fs.readFileSync(path.join(ROOT, 'frontend', 'pages', 'dashboard.html'), 'utf8');
    const start = html.indexOf('id="section-control-center"');
    const end = html.indexOf('<!-- 1. Overview -->', start);
    assert.ok(start !== -1 && end !== -1, 'control center section exists in dashboard.html');
    const section = html.slice(start, end);
    assert.ok(!section.includes('type="password"'), 'control center has no password field');
    assert.ok(!/YouTube is connected/i.test(section), 'YouTube panel never says connected');
    assert.ok(section.includes('Browser session'), 'YouTube panel says browser session');
    assert.ok(section.includes('Not API-connected'), 'YouTube panel says not API-connected');
    assert.ok(section.includes('https://youtube.com/shorts/G7jkYB9YWkM'), 'last upload Short #05 is linked');
    assert.ok(section.includes('2026-11-21 11:43'), 'last verified time is recorded');
    const js = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'dashboard.js'), 'utf8');
    assert.ok(!js.includes('ccYoutubePassword'), 'no password handling in the YouTube panel code');
    assert.ok(section.toLowerCase().includes('never type a password into this dashboard'), 'steps warn against typing a password');
  });
});

describe('Control Center autonomy.js — recent activity', () => {
  it('renders latest agent runs into #ccActivityList and notifies the Control Center', async () => {
    const canned = (url) => {
      const u = String(url);
      if (u.includes('/api/analytics/detail?section=activity')) return jsonResponse(200, { ok: true, section: 'activity',
        data: [{ id: 7, taskId: 42, agent: 'fact-checking', outcome: 'failed', startedAt: '2026-11-21T09:00:00.000Z', finishedAt: '2026-11-21T09:01:00.000Z', reason: 'LLM timeout after 120s' }],
        asOf: '2026-11-21T12:00:00.000Z',
        freshness: { asOf: '2026-11-21T12:00:00.000Z', checkedAt: '2026-11-21T12:00:00.000Z', stale: false, note: '' } });
      if (u.includes('/api/autonomy/status')) return jsonResponse(200, { ok: true,
        autonomyLevel: '3', targetLevel: '3', emergencyStop: false,
        tasks: { queued: 1, running: 0, done: 2, failed: 0, skipped: 0 },
        agents: [{ id: 'fact-checking', role: 'Fact-Checking', status: 'active' }],
        lastRuns: {}, revenue: '$0.00', traffic: 'Data unavailable', publishingMode: 'approved_only',
        maxArticlesPerDay: '1', socialAutoPost: 'off',
        autoFlags: { auto_research: 'on', auto_generation: 'on', auto_factcheck: 'on', auto_correction: 'off', auto_publishing: 'off' },
        source: 'd1' });
      if (u.includes('/api/autonomy/llm')) return jsonResponse(200, { ok: true,
        providers: [{ id: 'workers-ai', name: 'Workers AI', status: 'available', todayUsage: { neurons: 120 } }],
        generationPaused: false });
      if (u.includes('/api/autonomy/sources')) return jsonResponse(200, { ok: true, sources: [] });
      if (u.includes('/api/autonomy/analytics')) return jsonResponse(200, { ok: true,
        articlesByStatus: { published: 25, draft: 2 }, drafts: [],
        llmToday: { calls: 2, neurons: 120 }, llm7d: { calls: 3, neurons: 125 },
        failedTasks: [], research: { activeSources: 24, itemsDiscovered: 0 } });
      if (u.includes('/api/autonomy/tasks')) return jsonResponse(200, { ok: true, tasks: [], total: 0 });
      if (u.includes('/api/autonomy/reports')) return jsonResponse(200, { ok: true, reports: [] });
      if (u.includes('/api/autonomy/settings')) return jsonResponse(200, { ok: true, settings: { autonomy_level: '3', max_articles_per_day: '1', publishing_mode: 'approved_only', social_auto_post: 'off', auto_research: 'on', auto_generation: 'on', auto_factcheck: 'on', auto_correction: 'off', auto_publishing: 'off' } });
      if (u.includes('/api/autonomy/accounts')) return jsonResponse(200, { ok: true, accounts: [] });
      return jsonResponse(404, { ok: false, error: 'Not found' });
    };

    const sandbox = makeDomSandbox(async (url) => canned(url));
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'autonomy.js'), 'utf8');
    vm.runInContext(src, sandbox);
    for (const fn of sandbox.__docListeners.DOMContentLoaded || []) fn();
    await tick();

    const byId = sandbox.__byId;
    const activity = byId.get('ccActivityList') ? byId.get('ccActivityList').innerHTML : '';
    assert.ok(activity.includes('fact-checking'), 'recent activity shows the agent');
    assert.ok(activity.includes('failed'), 'recent activity shows the outcome');
    assert.ok(activity.includes('LLM timeout after 120s'), 'recent activity shows the reason');
    const status = byId.get('ccActivityStatus') ? byId.get('ccActivityStatus').textContent : '';
    assert.ok(status.includes('latest run(s)'), 'activity status line counts the runs');
    assert.ok(sandbox.__dispatched.includes('fsai:autonomy-refreshed'),
      'autonomy.js notifies the Control Center after loading status/pipeline');
  });
});
