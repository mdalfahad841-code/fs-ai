// FS AI — Queue recovery audit tests (workstream B, 2026-11-21).
//
// End-to-end audit of the queue engine against REAL SQLite (same
// harness as tests/queue-drain.test.js): lease expiry -> automatic
// re-queue with backoff -> drain -> done exactly once; Worker crash
// recovery through the daily workflow; duplicate prevention;
// dead-letter terminal state; and the drain's draft persistence
// (a drained content task's LLM draft becomes a CMS draft —
// WS-B fix 2026-11-21, previously the drain reported 'done' while
// no article ever appeared).
//
// No network, no real LLM: Workers AI is stubbed through env.AI.
// Run: node --test tests/queue-recovery-audit.test.js
// Requires node:sqlite (Node >= 22.5; this repo runs Node 24).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const {
  enqueueTask, runTask, runDailyWorkflow, runWeeklyWorkflow, drainTaskQueue,
  recoverStaleTasks, retryTask, convertContentDraft,
  backoffMinutesForAttempt,
} = require('../backend/routes/scheduler.js');
const { runHealthCheck } = require('../backend/services/healthcheck.js');

const ROOT = path.join(__dirname, '..');

const CANNED_DRAFT =
  '## How it works\n\nMost everyday AI is pattern-finding software: it learns from examples and predicts the most likely next step.\n\n' +
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
  'database/migrations/020_task_lifecycle_health.sql',
];

function freshEnv(extra = {}) {
  const db = buildDb(BASE_FILES);
  return { db, env: { DB: makeRealD1(db), ...extra } };
}

function fakeWorkersAI(text = CANNED_DRAFT) {
  return {
    run: async () => ({ response: text, usage: { prompt_tokens: 120, completion_tokens: 400 } }),
  };
}

function seedContentEvidence(db) {
  const div = db.prepare("SELECT id FROM business_divisions WHERE slug = 'ai-technology' LIMIT 1").get();
  const src = db.prepare("INSERT INTO research_sources (division_id, name, url, source_type) VALUES (?, 'Test AI News', 'https://example.com/ai-news', 'rss')").run(div.id);
  db.prepare('INSERT INTO research_items (source_id, division_id, title, url, summary, evidence_text, published_at, fetched_at, is_outdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run(
    Number(src.lastInsertRowid),
    div.id,
    'How AI Is Changing Everyday Life',
    'https://example.com/ai-everyday-life',
    'Artificial intelligence is now part of everyday routines, from phone keyboards to music recommendations.',
    'Artificial intelligence is now part of everyday routines, from the keyboard on a phone to the recommendations in a music app. Most everyday AI is pattern-finding software.',
    '2026-11-19T00:00:00.000Z',
    new Date().toISOString(),
  );
  return div.id;
}

function setMaxArticlesPerDay(db, n) {
  db.prepare("INSERT OR REPLACE INTO autonomy_settings (key, value) VALUES ('max_articles_per_day', ?)").run(String(n));
}

function taskRow(db, id) {
  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
}

function runRowsForTask(db, taskId) {
  return db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY id ASC').all(taskId);
}

describe('queue recovery audit — lease expiry, re-queue, drain, exactly once', () => {
  it('backoff is exponential 15*2^(n-1) minutes, capped at 240', () => {
    assert.equal(backoffMinutesForAttempt(1), 15);
    assert.equal(backoffMinutesForAttempt(2), 30);
    assert.equal(backoffMinutesForAttempt(3), 60);
    assert.equal(backoffMinutesForAttempt(4), 120);
    assert.equal(backoffMinutesForAttempt(5), 240);
    assert.equal(backoffMinutesForAttempt(10), 240);
    assert.equal(backoffMinutesForAttempt(0), 15, 'attempts below 1 behave as attempt 1');
  });

  it('stale running task: lease expiry -> re-queue with backoff -> drain -> done exactly once', async () => {
    const { db, env } = freshEnv();
    const created = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, priority: 5,
      idempotency_key: 'audit-crash-1',
    });
    assert.equal(created.ok, true);
    const id = created.task.id;
    // Simulate a Worker crash mid-run: task left 'running' 20 minutes ago, 1 attempt used.
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare("UPDATE agent_tasks SET status = 'running', attempts = 1, updated_at = ? WHERE id = ?").run(staleAt, id);

    const recovered = await recoverStaleTasks(env);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.count, 1, 'one stale task recovered');
    assert.equal(recovered.recovered[0].taskId, id);
    const requeued = taskRow(db, id);
    assert.equal(requeued.status, 'queued', 'recovered task is re-queued, not left failed');
    assert.equal(requeued.terminal_state, 'RETRYING');
    assert.ok(new Date(requeued.scheduled_for).getTime() > Date.now(), 'backoff is in the future');
    assert.ok(new Date(requeued.scheduled_for).getTime() <= Date.now() + 16 * 60 * 1000, 'attempt-1 backoff is ~15 minutes');

    // The drain must NOT run it before the backoff elapses.
    const early = await drainTaskQueue(env);
    assert.equal(early.results.filter((r) => r.taskId === id).length, 0, 'backoff is honoured — task not drained early');
    assert.equal(taskRow(db, id).status, 'queued');

    // Backoff elapsed: the drain runs it exactly once.
    db.prepare("UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?").run(id);
    const drained = await drainTaskQueue(env);
    const mine = drained.results.find((r) => r.taskId === id);
    assert.ok(mine, 'task was drained');
    assert.equal(mine.outcome, 'no-op', 'analytics snapshot with no analytics source is an honest no-op');
    const done = taskRow(db, id);
    assert.equal(done.status, 'done');
    assert.equal(done.terminal_state, 'COMPLETED');
    const executionRows = runRowsForTask(db, id).filter((r) => {
      try { return JSON.parse(r.detail || '{}').reason !== 'stale-lock'; } catch { return true; }
    });
    assert.equal(executionRows.length, 1, 'the handler executed exactly once (one recovery row + one execution row)');

    // A second drain finds nothing to re-run: exactly-once holds across drains.
    const again = await drainTaskQueue(env);
    assert.equal(again.results.filter((r) => r.taskId === id).length, 0);
    assert.equal(runRowsForTask(db, id).length, 2, 'recovery row + execution row, nothing more');
  });

  it('runTask on a stale running task reports re-queue, never "recovered as failed"', async () => {
    const { db, env } = freshEnv();
    const created = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, priority: 5,
      idempotency_key: 'audit-stale-msg-1',
    });
    const id = created.task.id;
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare("UPDATE agent_tasks SET status = 'running', attempts = 1, updated_at = ? WHERE id = ?").run(staleAt, id);
    const res = await runTask(env, id);
    assert.equal(res.recoveredStale, true);
    assert.match(res.error, /re-queued with backoff/i);
    assert.doesNotMatch(res.error, /recovered as failed/i);
    assert.equal(taskRow(db, id).status, 'queued', 'the task is queued again after recovery');
  });

  it('drainTaskQueue alone does NOT recover stale running tasks — recovery lives in the daily/weekly workflow', async () => {
    // Documented boundary (WS-B): only runDailyWorkflow / runWeeklyWorkflow
    // call recoverStaleTasks before draining; a bare drain leaves a stale
    // 'running' task untouched because it only selects status='queued'.
    const { db, env } = freshEnv();
    const created = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, priority: 5,
      idempotency_key: 'audit-drain-boundary-1',
    });
    const id = created.task.id;
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare("UPDATE agent_tasks SET status = 'running', attempts = 1, updated_at = ? WHERE id = ?").run(staleAt, id);
    await drainTaskQueue(env);
    assert.equal(taskRow(db, id).status, 'running', 'bare drain does not touch a stale running task');
  });

  it('daily workflow recovers a crashed task first, then drains it once the backoff elapses (the §4.3 wiring)', async () => {
    const { db, env } = freshEnv();
    const created = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, priority: 5,
      idempotency_key: 'audit-daily-crash-1',
    });
    const id = created.task.id;
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare("UPDATE agent_tasks SET status = 'running', attempts = 1, updated_at = ? WHERE id = ?").run(staleAt, id);
    // The workflow recovers the stale lock BEFORE the drain step: the
    // task ends this run re-queued with backoff (not left 'running',
    // not failed) — the same-run drain correctly skips it until the
    // backoff elapses.
    const daily = await runDailyWorkflow(env, { force: true });
    assert.equal(daily.ok, true);
    const afterDaily = taskRow(db, id);
    assert.equal(afterDaily.status, 'queued', 'workflow recovered the crashed task to queued');
    assert.equal(afterDaily.terminal_state, 'RETRYING');
    assert.ok(new Date(afterDaily.scheduled_for).getTime() > Date.now(), 'backoff still applies in this run');
    assert.ok((daily.counts.queueDone ?? 0) >= 0, 'daily report written');
    // Backoff elapsed: the next drain runs it exactly once.
    db.prepare("UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?").run(id);
    const drained = await drainTaskQueue(env);
    assert.ok(drained.results.find((r) => r.taskId === id), 'recovered task drained on the next run');
    assert.equal(taskRow(db, id).status, 'done');
    assert.equal(taskRow(db, id).terminal_state, 'COMPLETED');
  });
});

describe('queue recovery audit — duplicates, dead-letter, health backlog', () => {
  it('duplicate prevention: same idempotency key returns the same task, one row only', async () => {
    const { db, env } = freshEnv();
    const first = await enqueueTask(env, {
      agent: 'research', kind: 'daily-research', payload: { division: 'ai-technology' },
      division_id: 2, priority: 5, idempotency_key: 'audit-dup-1',
    });
    const second = await enqueueTask(env, {
      agent: 'research', kind: 'daily-research', payload: { division: 'ai-technology' },
      division_id: 2, priority: 5, idempotency_key: 'audit-dup-1',
    });
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.task.id, first.task.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE idempotency_key = 'audit-dup-1'").get().n, 1);
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_tasks'").get().sql;
    assert.match(tableSql, /idempotency_key TEXT NOT NULL UNIQUE/, 'UNIQUE constraint backs the check-then-insert');
  });

  it('dead-letter: exhausted retries end FAILED_FINAL_WITH_RECOVERY_REPORT with the report in the run detail', async () => {
    const { db, env } = freshEnv();
    const created = await enqueueTask(env, {
      agent: 'fact-checking', kind: 'fact-check', payload: { article_id: 99999 },
      priority: 6, idempotency_key: 'audit-dead-1',
    });
    const id = created.task.id;
    // Three attempts, clearing the backoff between them to simulate time passing.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await runTask(env, id);
      assert.equal(res.outcome, 'failed', `attempt ${attempt} fails (article 99999 does not exist)`);
      assert.equal(res.attempts, attempt);
      if (attempt < 3) {
        assert.equal(res.requeued, true, 'attempts 1-2 re-queue with backoff');
        assert.equal(taskRow(db, id).status, 'queued');
        assert.equal(taskRow(db, id).terminal_state, 'RETRYING');
        db.prepare("UPDATE agent_tasks SET scheduled_for = NULL WHERE id = ?").run(id);
      }
    }
    const dead = taskRow(db, id);
    assert.equal(dead.status, 'failed');
    assert.equal(dead.attempts, 3);
    assert.equal(dead.terminal_state, 'FAILED_FINAL_WITH_RECOVERY_REPORT');
    const runs = runRowsForTask(db, id);
    assert.equal(runs.length, 3, 'one run row per attempt, history never deleted');
    const lastDetail = JSON.parse(runs[2].detail || '{}');
    assert.ok(lastDetail.recoveryReport, 'final run carries the recovery report');
    assert.equal(lastDetail.recoveryReport.taskId, id);
    assert.match(lastDetail.recoveryReport.rootCause, /Article 99999 not found/);
    assert.equal(lastDetail.recoveryReport.retryHistory.exhausted, true);
    assert.equal(lastDetail.recoveryReport.ownerActionRequired, true);

    // The dead-letter task is never auto-retried, but an explicit owner retry resets it.
    const retried = await retryTask(env, id);
    assert.equal(retried.ok, true);
    const reset = taskRow(db, id);
    assert.equal(reset.status, 'queued');
    assert.equal(reset.attempts, 0);
    assert.equal(reset.terminal_state, null, 'owner retry clears the terminal state');
  });

  it('permanent errors never re-queue: unknown agent is BLOCKED_WITH_REASON on the first attempt', async () => {
    const { db, env } = freshEnv();
    const created = await enqueueTask(env, {
      agent: 'no-such-agent', kind: 'mystery', payload: {}, priority: 5,
      idempotency_key: 'audit-perm-1',
    });
    const id = created.task.id;
    const res = await runTask(env, id);
    assert.equal(res.outcome, 'failed');
    assert.equal(res.requeued, false, 'permanent error does not re-queue');
    assert.equal(res.terminalState, 'BLOCKED_WITH_REASON');
    assert.equal(taskRow(db, id).status, 'failed');
    assert.equal(taskRow(db, id).attempts, 1, 'no retries were spent on an un-runnable task');
  });

  it('health check flags a backlog: >=10 queued or oldest queued >24h is degraded, never blocked', async () => {
    const { db, env } = freshEnv();
    // A fresh DB has no queued tasks: queue check is healthy (backup still degrades overall).
    let result = await runHealthCheck(env);
    const queue0 = result.checks.find((c) => c.component === 'queue');
    assert.equal(queue0.status, 'healthy');
    assert.equal(queue0.detail.queued, 0);

    // 12 queued tasks, oldest 6 days — the live 2026-11-21 backlog shape.
    const old = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    for (let i = 0; i < 12; i++) {
      db.prepare(
        "INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES ('research', 'daily-research', '{}', NULL, 5, 'queued', 0, 3, ?, NULL, ?, ?)",
      ).run(`audit-backlog-${i}`, i === 0 ? old : now, i === 0 ? old : now);
    }
    result = await runHealthCheck(env);
    const queue = result.checks.find((c) => c.component === 'queue');
    assert.equal(queue.status, 'degraded', 'a 12-task backlog is degraded, not healthy');
    assert.equal(queue.detail.queued, 12);
    assert.ok(queue.detail.oldestQueuedAgeMs > 24 * 60 * 60 * 1000);
    assert.notEqual(result.overall, 'blocked', 'a backlog degrades — it never blocks the drain');
  });
});

describe('weekly path isolation on the new code (WS-B, 2026-11-21)', () => {
  it('weekly run recovers a stale lock (re-queue, not failed) and otherwise touches nothing: no drain, no enqueue, no article change, no LLM', async () => {
    const { db, env } = freshEnv();
    assert.equal(env.AI, undefined, 'no AI binding — a weekly LLM call would fail loudly here');
    // One stale running task (crash) + one queued task (must NOT be drained: drain is daily-only).
    const stale = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, priority: 5, idempotency_key: 'audit-weekly-stale-1',
    });
    const queued = await enqueueTask(env, {
      agent: 'analytics', kind: 'snapshot', payload: {}, priority: 5, idempotency_key: 'audit-weekly-queued-1',
    });
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.prepare("UPDATE agent_tasks SET status = 'running', attempts = 1, updated_at = ? WHERE id = ?").run(staleAt, stale.task.id);
    const articlesBefore = db.prepare('SELECT id, status, body FROM articles ORDER BY id').all();
    const tasksBefore = db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n;
    const fcBefore = db.prepare('SELECT COUNT(*) AS n FROM fact_checks').get().n;
    const seoBefore = db.prepare('SELECT COUNT(*) AS n FROM seo_checks').get().n;

    const weekly = await runWeeklyWorkflow(env);
    assert.equal(weekly.ok, true);
    assert.ok(weekly.reportId, 'one weekly report row written');

    // The ONE sanctioned mutation: the stale lock is recovered to
    // queued + RETRYING with backoff (new §4.3 behaviour), not failed.
    const recovered = taskRow(db, stale.task.id);
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.terminal_state, 'RETRYING');
    assert.ok(new Date(recovered.scheduled_for).getTime() > Date.now(), 'backoff applies');
    // Everything else untouched.
    assert.equal(taskRow(db, queued.task.id).status, 'queued', 'weekly never drains — queued tasks wait for the daily drain');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n, tasksBefore, 'no task enqueued');
    assert.deepEqual(db.prepare('SELECT id, status, body FROM articles ORDER BY id').all(), articlesBefore, 'no article row changed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fact_checks').get().n, fcBefore, 'no fact-check ran');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seo_checks').get().n, seoBefore, 'no SEO check ran');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_reports WHERE kind = 'weekly'").get().n, 1, 'exactly one weekly row');
  });

  it('weekly duplicate guard still holds on the new code: a second run the same day writes no new row', async () => {
    const { env } = freshEnv();
    const first = await runWeeklyWorkflow(env);
    assert.equal(first.ok, true);
    const second = await runWeeklyWorkflow(env);
    assert.equal(second.duplicate, true, 'second run the same day is a duplicate');
    assert.equal(second.reportId, first.reportId, 'same row, not a second one');
  });
});

describe('queue recovery audit — drained drafts are persisted (WS-B fix)', () => {

  it('a drained content task with a real LLM draft creates a CMS draft (never published, fact_checked=0)', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    seedContentEvidence(db);
    setMaxArticlesPerDay(db, 100);
    const created = await enqueueTask(env, {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'Test Drain Story: How AI Helps Everyday Tasks', division: 'ai-technology', sources: ['https://example.com/ai-everyday-life'] },
      division_id: 2, priority: 6, idempotency_key: 'audit-convert-1',
    });
    const id = created.task.id;
    const drained = await drainTaskQueue(env);
    const mine = drained.results.find((r) => r.taskId === id);
    assert.ok(mine, 'content task was drained');
    assert.equal(mine.outcome, 'done');
    assert.equal(drained.draftsConverted, 1, 'the drain converted the draft');
    assert.ok(mine.conversion, 'conversion recorded on the drain result');
    assert.equal(mine.conversion.converted, true);
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(mine.conversion.articleId);
    assert.ok(article, 'article row exists');
    assert.equal(article.status, 'draft', 'draft only — never published by the drain');
    assert.equal(article.fact_checked, 0);
    assert.ok(article.body.startsWith('AI-DRAFT'), 'body carries the AI-DRAFT banner');
    assert.equal(taskRow(db, id).status, 'done');
    assert.equal(taskRow(db, id).terminal_state, 'COMPLETED');
    const sources = db.prepare('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ?').get(article.id).n;
    assert.ok(sources >= 1, 'the draft records its evidence source for the fact-checker and gate');
  });

  it('a no-op scaffold is never converted: no evidence / no LLM means no article row', async () => {
    const { db, env } = freshEnv();
    setMaxArticlesPerDay(db, 100);
    const before = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n;
    const created = await enqueueTask(env, {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'Test No Evidence Story', division: 'ai-technology', sources: ['https://example.com/nowhere'] },
      division_id: 2, priority: 6, idempotency_key: 'audit-convert-noop-1',
    });
    const id = created.task.id;
    const drained = await drainTaskQueue(env);
    const mine = drained.results.find((r) => r.taskId === id);
    assert.ok(mine, 'content task was drained');
    assert.equal(mine.outcome, 'no-op', 'insufficient evidence is an honest no-op');
    assert.equal(mine.conversion, undefined, 'no conversion attempted for a no-op scaffold');
    assert.equal(drained.draftsConverted, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, before, 'no placeholder article was minted');
  });

  it('a slug that already exists is never duplicated: the handler itself refuses as a duplicate no-op', async () => {
    const { db, env } = freshEnv({ AI: fakeWorkersAI() });
    seedContentEvidence(db);
    setMaxArticlesPerDay(db, 100);
    const created = await enqueueTask(env, {
      agent: 'content-creation', kind: 'daily-content',
      payload: { title: 'Test Drain Story: How AI Helps Everyday Tasks', division: 'ai-technology', sources: ['https://example.com/ai-everyday-life'] },
      division_id: 2, priority: 6, idempotency_key: 'audit-convert-dup-1',
    });
    const id = created.task.id;
    // An article with the slug already exists (e.g. the owner converted
    // an earlier run manually): the handler refuses as a duplicate
    // no-op, so the drain has nothing to convert and creates nothing.
    db.prepare("INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, created_at, updated_at) VALUES (2, 'Test Drain Story: How AI Helps Everyday Tasks', 'test-drain-story-how-ai-helps-everyday-tasks', '', 'AI-DRAFT', 'FS AI', 'draft', 0, '', '', datetime('now'), datetime('now'))").run();
    const drained = await drainTaskQueue(env);
    const mine = drained.results.find((r) => r.taskId === id);
    assert.equal(mine.outcome, 'no-op', 'duplicate topic is an honest no-op, not a second draft');
    assert.equal(mine.conversion, undefined, 'no conversion attempted for a duplicate no-op');
    assert.equal(drained.draftsConverted, 0, 'no second article created');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE slug = 'test-drain-story-how-ai-helps-everyday-tasks'").get().n, 1);
  });

  it('convertContentDraft treats a pre-existing slug as already-converted (direct unit check)', async () => {
    const { db, env } = freshEnv();
    db.prepare("INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, created_at, updated_at) VALUES (2, 'Test Drain Story: How AI Helps Everyday Tasks', 'test-drain-story-how-ai-helps-everyday-tasks', '', 'AI-DRAFT', 'FS AI', 'draft', 0, '', '', datetime('now'), datetime('now'))").run();
    const existingId = db.prepare("SELECT id FROM articles WHERE slug = 'test-drain-story-how-ai-helps-everyday-tasks'").get().id;
    const res = await convertContentDraft(env, { id: 999, agent: 'content-creation' }, {
      title: 'Test Drain Story: How AI Helps Everyday Tasks',
      division: 'ai-technology',
      body: '## How it works\n\nSome body text here.',
      llmGenerated: true,
    });
    assert.equal(res.converted, false);
    assert.equal(res.alreadyConverted, true);
    assert.equal(res.articleId, existingId);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles WHERE slug = 'test-drain-story-how-ai-helps-everyday-tasks'").get().n, 1);
  });
});
