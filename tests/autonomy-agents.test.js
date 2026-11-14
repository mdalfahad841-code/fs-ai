// FS AI — Autonomy agent-handler tests.
//
// Every one of the 10 queue-agent handlers is exercised against a REAL
// SQLite database built from database/schema.sql + migrations 005 + 006
// + database/seed.sql via node:sqlite (same pattern as
// tests/real-db.test.js). Each test asserts real DB state, not just the
// returned shape: nothing publishes, posts, spends or fabricates.
//
// NOTE (pre-existing condition, local test DBs only): migration 004 is
// NOT applied here. database/schema.sql already contains 004's changes
// (articles.publish_at and ai_agents.status), so applying 004 after
// schema.sql fails with a duplicate-column error. The live D1 database
// is unaffected — it was built by the incremental migration chain.
//
// Run: node --test tests/autonomy-agents.test.js (or: npm test)
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { runAutonomyTask } = require('../backend/agents/autonomy-runner.js');
const { enqueueTask, runTask } = require('../backend/routes/scheduler.js');

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
function freshEnv() {
  const db = buildDb([
    'database/schema.sql',
    'database/migrations/005_autonomy.sql',
    'database/migrations/006_llm_usage.sql',
    'database/seed.sql',
  ]);
  return { db, env: { DB: makeRealD1(db) } };
}

function divisionId(db, slug) {
  return db.prepare('SELECT id FROM business_divisions WHERE slug = ?').get(slug).id;
}

function insertArticle(db, opts) {
  const {
    title, slug, divisionSlug = 'automotive', status = 'draft',
    body = 'Body text. ', excerpt = 'Excerpt.', seoTitle = null,
    seoDescription = null, publishAt = null, factChecked = 0,
  } = opts;
  const r = db.prepare(
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, published_at, publish_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
  ).run(divisionId(db, divisionSlug), title, slug, excerpt, body, 'FS AI', status, factChecked, seoTitle, seoDescription, publishAt);
  return Number(r.lastInsertRowid);
}

function articleRow(db, id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

describe('research agent', () => {
  it('no-op without sources, with the gap reason and the real division gap', async () => {
    const { db, env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'research', kind: 'daily-research', payload: { division: 'automotive', sources: [] } }, env);
    assert.equal(result.outcome, 'no-op');
    assert.match(result.reason, /No RSS source configured/);
    assert.equal(result.division, 'automotive');
    assert.ok(Array.isArray(result.divisionGap));
    assert.equal(result.divisionGap.length, 8, 'one gap entry per division');
    const auto = result.divisionGap.find((g) => g.division === 'automotive');
    assert.equal(auto.total, 12, 'automotive gap total matches the seeded articles');
    assert.equal(auto.published, 12);
    // No article row was created by a no-op research run.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25);
  });
});

describe('content-creation agent', () => {
  it('scaffold no-op without an LLM: outline + SEO fields, no fabricated body, no article row', async () => {
    const { db, env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'content-creation', kind: 'draft', payload: { title: 'How to Test a Fake AI Draft', division: 'automotive', sources: [] } }, env);
    assert.equal(result.outcome, 'no-op');
    assert.match(result.reason, /All free LLM providers unavailable/);
    assert.ok(result.scaffold, 'scaffold is returned');
    assert.equal(result.scaffold.title, 'How to Test a Fake AI Draft');
    assert.ok(Array.isArray(result.scaffold.outline) && result.scaffold.outline.length > 0);
    assert.equal(result.scaffold.body, undefined, 'no body was fabricated');
    assert.equal(result.draft, undefined, 'no AI draft without an LLM');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25, 'no article row was inserted');
  });

  it('fails honestly on a short title or an unknown division', async () => {
    const { env } = freshEnv();
    const short = await runAutonomyTask(
      { agent: 'content-creation', kind: 'draft', payload: { title: 'Hi', division: 'automotive' } }, env);
    assert.equal(short.outcome, 'failed');
    const unknown = await runAutonomyTask(
      { agent: 'content-creation', kind: 'draft', payload: { title: 'A Proper Test Title', division: 'no-such-division' } }, env);
    assert.equal(unknown.outcome, 'failed');
    assert.match(unknown.error, /Unknown division slug/);
  });
});

describe('fact-checking agent', () => {
  it('flags an unsourced article, verdict needs-review, and never sets fact_checked', async () => {
    const { db, env } = freshEnv();
    const longBody = 'This guide costs 500 dollars and takes 30 days to complete. '.repeat(12);
    const id = insertArticle(db, {
      title: 'Unsourced Numbers Article', slug: 'unsourced-numbers-article',
      status: 'pending_approval', body: longBody, factChecked: 0,
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ?').get(id).n, 0);

    const result = await runAutonomyTask(
      { agent: 'fact-checking', kind: 'fact-check', payload: { article_id: id } }, env);
    assert.equal(result.outcome, 'done');
    assert.equal(result.verdict, 'needs-review');
    assert.ok(result.flags.some((f) => /No sources recorded/.test(f)), 'flags the missing sources');
    assert.ok(result.flags.some((f) => /number-like claim/.test(f)), 'flags unsourced numbers');
    assert.ok(result.checks.some((c) => c.name === 'sources-present' && c.ok === false));

    const after = articleRow(db, id);
    assert.equal(after.fact_checked, 0, 'fact_checked was NOT set by the agent');
    assert.equal(after.status, 'pending_approval', 'status was NOT changed by the agent');
  });

  it('fails honestly for a missing article', async () => {
    const { env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 } }, env);
    assert.equal(result.outcome, 'failed');
    assert.match(result.error, /not found/);
  });
});

describe('SEO agent', () => {
  it('fills only blank seo fields from the real text and writes them to D1', async () => {
    const { db, env } = freshEnv();
    const seeded = articleRow(db, 1);
    assert.equal(seeded.seo_title, null, 'seeded article 1 starts with a blank seo_title');
    assert.equal(seeded.seo_description, null, 'seeded article 1 starts with a blank seo_description');

    const result = await runAutonomyTask(
      { agent: 'seo', kind: 'seo-pass', payload: { article_id: 1 } }, env);
    assert.equal(result.outcome, 'done');
    assert.ok(result.filled.includes('seo_title'));
    assert.ok(result.filled.includes('seo_description'));
    assert.ok(result.headingCount >= 0);
    assert.ok(Array.isArray(result.internalLinks));

    const after = articleRow(db, 1);
    assert.equal(after.seo_title, seeded.title.slice(0, 60), 'seo_title written from the real title');
    assert.ok(after.seo_description && after.seo_description.length > 0, 'seo_description written from the real text');
  });

  it('never overwrites owner-set seo values', async () => {
    const { db, env } = freshEnv();
    const id = insertArticle(db, {
      title: 'Owner SEO Article', slug: 'owner-seo-article', status: 'published',
      seoTitle: 'Owner Set Title', seoDescription: 'Owner set description.',
    });
    const result = await runAutonomyTask(
      { agent: 'seo', kind: 'seo-pass', payload: { article_id: id } }, env);
    assert.equal(result.outcome, 'done');
    assert.deepEqual(result.filled, [], 'nothing filled when both fields are already set');
    const after = articleRow(db, id);
    assert.equal(after.seo_title, 'Owner Set Title');
    assert.equal(after.seo_description, 'Owner set description.');
  });
});

describe('publishing agent', () => {
  it('publishes only approved+due articles; draft / pending_approval / future are untouched', async () => {
    const { db, env } = freshEnv();
    const dueApproved = insertArticle(db, {
      title: 'Due Approved', slug: 'due-approved', status: 'approved', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const futureApproved = insertArticle(db, {
      title: 'Future Approved', slug: 'future-approved', status: 'approved', publishAt: '2999-01-01T00:00:00.000Z',
    });
    const draftDue = insertArticle(db, {
      title: 'Draft Due', slug: 'draft-due', status: 'draft', publishAt: '2020-01-01T00:00:00.000Z',
    });
    const pendingDue = insertArticle(db, {
      title: 'Pending Due', slug: 'pending-due', status: 'pending_approval', publishAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await runAutonomyTask(
      { agent: 'publishing', kind: 'publish-due', payload: {} }, env);
    assert.equal(result.outcome, 'done');
    assert.equal(result.published, 1);
    assert.deepEqual(result.slugs, ['due-approved']);

    assert.equal(articleRow(db, dueApproved).status, 'published');
    assert.ok(articleRow(db, dueApproved).published_at, 'published_at is stamped on publish');
    assert.equal(articleRow(db, futureApproved).status, 'approved', 'future approved article untouched');
    assert.equal(articleRow(db, draftDue).status, 'draft', 'draft untouched');
    assert.equal(articleRow(db, pendingDue).status, 'pending_approval', 'pending_approval untouched');
  });
});

describe('social-media agent', () => {
  it('returns a distribution pack for a published article and posts nothing', async () => {
    const { db, env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'social-media', kind: 'social-pack', payload: { article_id: 1 } }, env);
    assert.equal(result.outcome, 'done');
    assert.equal(result.articleId, 1);
    assert.ok(result.url.includes('/pages/article.html?id=1'), 'pack links the real article URL');
    assert.ok(result.pinterest.caption.includes(result.title), 'Pinterest caption uses the real title');
    assert.ok(Array.isArray(result.pinterest.hashtags) && result.pinterest.hashtags.length > 0);
    assert.ok(result.youtubeCommunity.text.includes(result.title));
    assert.match(result.note, /no post was made/);
    // Nothing was posted and nothing was written: article count unchanged.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 25);
  });

  it('no-op for an unpublished article', async () => {
    const { db, env } = freshEnv();
    const draftId = insertArticle(db, { title: 'Draft Social', slug: 'draft-social', status: 'draft' });
    const noop = await runAutonomyTask(
      { agent: 'social-media', kind: 'social-pack', payload: { article_id: draftId } }, env);
    assert.equal(noop.outcome, 'no-op');
    assert.match(noop.reason, /not published/);
  });
});

describe('traffic-growth agent', () => {
  it('returns real division counts from D1, thinnest first', async () => {
    const { db, env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'traffic-growth', kind: 'gap-analysis', payload: {} }, env);
    assert.equal(result.outcome, 'done');
    assert.equal(result.perDivision.length, 8, 'one entry per division');
    assert.equal(result.publishedTotal, 25, 'published total matches the seeded articles');

    const expected = db.prepare(
      'SELECT d.slug AS division, COUNT(a.id) AS total, ' +
      "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
      'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id ' +
      'GROUP BY d.id ORDER BY published ASC, total ASC').all();
    // Per-division counts must match D1 exactly (compared by division,
    // not by position: divisions tied on (published, total) have no
    // defined order, so the test asserts the sort property instead of
    // an exact tie order).
    const expectedByDivision = Object.fromEntries(expected.map((r) => [r.division, r]));
    for (const c of result.perDivision) {
      assert.equal(c.published, Number(expectedByDivision[c.division].published), `${c.division}: published`);
      assert.equal(c.total, Number(expectedByDivision[c.division].total), `${c.division}: total`);
    }
    const keys = result.perDivision.map((c) => [c.published, c.total]);
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i][0] > keys[i - 1][0] || (keys[i][0] === keys[i - 1][0] && keys[i][1] >= keys[i - 1][1]),
        'perDivision is sorted thinnest-first by (published, total)');
    }
    assert.deepEqual(result.zeroPublishedDivisions, expected.filter((r) => Number(r.published) === 0).map((r) => r.division));
    assert.ok(result.opportunities.length > 0, 'opportunities are derived from the real gaps');
    assert.match(result.note, /Data unavailable/);
  });
});

describe('analytics agent', () => {
  it('returns Data unavailable + $0.00 when no analytics source is connected', async () => {
    const { db, env } = freshEnv();
    const latest = db.prepare('SELECT * FROM website_analytics ORDER BY recorded_date DESC LIMIT 1').get();
    assert.equal(latest.source, 'none', 'seed records source "none"');

    const result = await runAutonomyTask(
      { agent: 'analytics', kind: 'snapshot', payload: {} }, env);
    assert.equal(result.outcome, 'no-op');
    assert.equal(result.pageViews, 'Data unavailable');
    assert.equal(result.visitors, 'Data unavailable');
    assert.equal(result.clicks, 'Data unavailable');
    assert.equal(result.revenue, 0);
    assert.equal(result.revenueFormatted, '$0.00');
    assert.equal(result.analyticsConnected, false);
  });
});

describe('monetization agent', () => {
  it('returns $0.00 revenue and the two pending opportunities', async () => {
    const { env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'monetization', kind: 'report', payload: {} }, env);
    assert.equal(result.outcome, 'done');
    assert.equal(result.revenue, 0);
    assert.equal(result.revenueFormatted, '$0.00');
    assert.equal(result.revenueCurrency, 'USD');
    const programs = result.opportunities.map((o) => o.program);
    assert.ok(programs.includes('AdSense'));
    assert.ok(programs.includes('Affiliate'));
    assert.ok(result.opportunities.every((o) => o.status === 'pending'));
    assert.ok(Array.isArray(result.accounts) && result.accounts.length > 0);
  });
});

describe('security-monitoring agent', () => {
  it('returns real presence booleans and last backup unknown', async () => {
    const { db, env } = freshEnv();
    const result = await runAutonomyTask(
      { agent: 'security-monitoring', kind: 'health-check', payload: {} }, env);
    assert.equal(result.outcome, 'done');
    assert.equal(result.lastBackup, 'unknown — download a backup from the Backup section');
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    assert.equal(byName['d1-bound'].ok, true, 'D1 is really bound in this test');
    assert.equal(typeof byName['owner-password-hash-set'].ok, 'boolean');
    assert.equal(byName['owner-password-hash-set'].ok, false, 'no hash in this env — honestly false');
    assert.equal(typeof byName['session-secret-set'].ok, 'boolean');
    assert.equal(byName['session-secret-set'].ok, false, 'no secret in this env — honestly false');
    assert.equal(byName['last-backup'].lastBackup, 'unknown');
    assert.equal(result.securityEventsLast7Days, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM security_events').get().n, 0);
  });

  it('presence booleans turn true when the secrets are really set', async () => {
    const { env } = freshEnv();
    env.OWNER_PASSWORD_HASH = 'test-hash-value';
    env.SESSION_SECRET = 'test-session-secret';
    const result = await runAutonomyTask(
      { agent: 'security-monitoring', kind: 'health-check', payload: {} }, env);
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    assert.equal(byName['owner-password-hash-set'].ok, true);
    assert.equal(byName['session-secret-set'].ok, true);
    assert.equal(byName['last-backup'].lastBackup, 'unknown', 'last backup is still unknown — no timestamp is stored anywhere');
  });
});

describe('agent runs log honest outcomes', () => {
  it('runTask records an agent_runs row and agent_logs rows for the executed task', async () => {
    const { db, env } = freshEnv();
    const enqueued = await enqueueTask(env, {
      agent: 'traffic-growth', kind: 'gap-analysis', payload: {},
      idempotency_key: 'test-run-log-1',
    });
    assert.equal(enqueued.ok, true);
    const result = await runTask(env, enqueued.task.id);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'done');
    assert.ok(result.runId, 'runTask returns the run id');

    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(result.runId);
    assert.ok(run, 'agent_runs row exists');
    assert.equal(run.task_id, enqueued.task.id);
    assert.equal(run.agent, 'traffic-growth');
    assert.equal(run.outcome, 'done');
    const detail = JSON.parse(run.detail);
    assert.equal(detail.publishedTotal, 25, 'run detail carries the real result');

    const logs = db.prepare('SELECT * FROM agent_logs WHERE run_id = ?').all(result.runId);
    assert.ok(logs.length >= 1, 'agent_logs rows exist for the run');
    assert.ok(logs.every((l) => l.level === 'info' || l.level === 'warn' || l.level === 'error'));
    assert.equal(db.prepare("SELECT status FROM agent_tasks WHERE id = ?").get(enqueued.task.id).status, 'done');
  });

  it('unknown queue agent fails honestly through the runner', async () => {
    const { env } = freshEnv();
    const result = await runAutonomyTask({ agent: 'not-an-agent', kind: 'x', payload: {} }, env);
    assert.equal(result.outcome, 'failed');
    assert.match(result.error, /Unknown autonomy agent/);
  });
});
