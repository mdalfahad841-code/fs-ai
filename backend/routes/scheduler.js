/**
 * FS AI — Autonomy scheduler.
 *
 * Daily + weekly workflows and single-task execution against D1.
 * Every workflow step is wrapped so one failure never aborts the rest,
 * and every step writes an agent_runs row + agent_logs rows. The
 * Emergency Stop skips a whole workflow (logged, nothing runs).
 * Idempotency: enqueueTask never creates a duplicate for the same
 * idempotency_key — it returns the existing task instead.
 */
import { d1All, d1First, d1Run, nowIso } from '../middleware/validation.js';
import { getEmergencyStop } from './admin.js';
import { publishDueArticles } from './admin-articles.js';
import { runAutonomyTask, QUEUE_TO_REGISTRY } from '../agents/autonomy-runner.js';

export function todayStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function plusMinutes(baseIso, minutes) {
  return new Date(new Date(baseIso).getTime() + minutes * 60 * 1000).toISOString();
}

async function writeRun(env, { taskId = null, agent, outcome, detail = {}, logs = [] }) {
  let runId = null;
  try {
    const now = nowIso();
    const result = await d1Run(env,
      'INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)',
      [taskId, agent, now, now, outcome, JSON.stringify(detail)]);
    runId = result && result.meta ? result.meta.last_row_id : null;
    for (const log of logs) {
      const level = log.level === 'warn' || log.level === 'error' ? log.level : 'info';
      await d1Run(env,
        'INSERT INTO agent_logs (run_id, level, message, created_at) VALUES (?, ?, ?, ?)',
        [runId, level, String(log.message || '').slice(0, 1000), nowIso()]).catch(() => {});
    }
  } catch {
    runId = null;
  }
  return runId;
}

async function logSkip(env, agent, reason) {
  await writeRun(env, {
    taskId: null, agent, outcome: 'skipped',
    detail: { reason }, logs: [{ level: 'info', message: `Skipped: ${reason}` }],
  });
}

/**
 * Enqueue a task. Never duplicates: an existing row with the same
 * idempotency_key is returned as { task, duplicate: true }.
 */
export async function enqueueTask(env, { agent, kind, payload = {}, division_id = null, priority = 5, idempotency_key, scheduled_for = null }) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  if (!agent || typeof agent !== 'string') return { ok: false, status: 400, error: 'agent is required.' };
  if (!kind || typeof kind !== 'string') return { ok: false, status: 400, error: 'kind is required.' };
  const key = idempotency_key || `manual-${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existing = await d1First(env, 'SELECT * FROM agent_tasks WHERE idempotency_key = ? LIMIT 1', [key]);
  if (existing) return { ok: true, task: normaliseTaskRow(existing), duplicate: true };
  const now = nowIso();
  try {
    const result = await d1Run(env,
      'INSERT INTO agent_tasks (agent, kind, payload, division_id, priority, status, attempts, max_attempts, idempotency_key, scheduled_for, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [agent, kind, JSON.stringify(payload || {}), division_id, priority, 'queued', 0, 3, key, scheduled_for, now, now]);
    const id = result && result.meta ? result.meta.last_row_id : null;
    const row = id ? await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [id]) : null;
    return { ok: true, task: normaliseTaskRow(row || { id, agent, kind, payload: JSON.stringify(payload || {}), division_id, priority, status: 'queued', attempts: 0, max_attempts: 3, idempotency_key: key, scheduled_for, created_at: now, updated_at: now }), duplicate: false };
  } catch (err) {
    // Race on the UNIQUE key: re-read and return the existing row.
    if (/UNIQUE|unique/i.test(String(err && err.message ? err.message : ''))) {
      const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE idempotency_key = ? LIMIT 1', [key]);
      if (row) return { ok: true, task: normaliseTaskRow(row), duplicate: true };
    }
    return { ok: false, status: 500, error: String(err && err.message ? err.message : err).slice(0, 200) };
  }
}

export function normaliseTaskRow(row) {
  if (!row) return null;
  let payload = row.payload;
  try { payload = typeof payload === 'string' ? JSON.parse(payload) : (payload || {}); } catch { payload = {}; }
  return { ...row, payload };
}

async function registryStatus(env, registryId) {
  if (!registryId || !env || !env.DB) return null;
  try {
    const row = await d1First(env,
      'SELECT status, is_active FROM ai_agents WHERE slug = ? OR name = ? LIMIT 1', [registryId, registryId]);
    if (!row) return null;
    if (typeof row.status === 'string' && row.status) return row.status;
    return row.is_active ? 'active' : 'disabled';
  } catch {
    return null;
  }
}

/**
 * Run one queued task now. Claims it (queued -> running, attempts+1),
 * checks Emergency Stop (423-style skip) and the mapped registry agent's
 * paused state, dispatches via runAutonomyTask, writes agent_runs +
 * agent_logs, and sets the task done/failed (failure with attempts left
 * re-queues with attempts*15-minute backoff).
 */
export async function runTask(env, taskId) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, error: 'Task id must be a positive integer.' };
  const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [id]);
  if (!row) return { ok: false, status: 404, error: 'Task not found.' };
  const task = normaliseTaskRow(row);
  if (task.status !== 'queued') {
    return { ok: false, status: 409, error: `Task is '${task.status}' — only queued tasks can run.` };
  }

  if (await getEmergencyStop(env)) {
    await d1Run(env, "UPDATE agent_tasks SET status = 'skipped', updated_at = ? WHERE id = ?", [nowIso(), id]);
    await writeRun(env, {
      taskId: id, agent: task.agent, outcome: 'skipped',
      detail: { reason: 'Emergency Stop is on.' },
      logs: [{ level: 'warn', message: 'Task skipped: Emergency Stop is on.' }],
    });
    return { ok: false, status: 423, error: 'Autonomous operations are stopped by Emergency Stop', skipped: true };
  }

  const registryId = QUEUE_TO_REGISTRY[task.agent] || null;
  if (registryId) {
    const status = await registryStatus(env, registryId);
    if (status && status !== 'active') {
      await d1Run(env, "UPDATE agent_tasks SET status = 'skipped', updated_at = ? WHERE id = ?", [nowIso(), id]);
      await writeRun(env, {
        taskId: id, agent: task.agent, outcome: 'skipped',
        detail: { reason: `Agent ${registryId} is ${status}.` },
        logs: [{ level: 'warn', message: `Task skipped: agent ${registryId} is ${status}.` }],
      });
      return { ok: false, status: 409, error: `Agent ${registryId} is ${status} — resume it before running.`, skipped: true };
    }
  }

  const attempts = (task.attempts || 0) + 1;
  await d1Run(env, "UPDATE agent_tasks SET status = 'running', attempts = ?, updated_at = ? WHERE id = ?",
    [attempts, nowIso(), id]);

  const startedAt = nowIso();
  let result;
  try {
    result = await runAutonomyTask(task, env);
  } catch (err) {
    result = { outcome: 'failed', error: String(err && err.message ? err.message : err).slice(0, 300) };
  }
  const outcome = result && (result.outcome === 'done' || result.outcome === 'no-op') ? result.outcome : 'failed';
  const finishedAt = nowIso();

  let runId = null;
  try {
    const inserted = await d1Run(env,
      'INSERT INTO agent_runs (task_id, agent, started_at, finished_at, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)',
      [id, task.agent, startedAt, finishedAt, outcome, JSON.stringify(result || {})]);
    runId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
    const logMessage = outcome === 'failed'
      ? `Task ${id} (${task.agent}) failed: ${String(result.error || 'unknown error').slice(0, 300)}`
      : `Task ${id} (${task.agent}) finished: ${outcome}.`;
    await d1Run(env, 'INSERT INTO agent_logs (run_id, level, message, created_at) VALUES (?, ?, ?, ?)',
      [runId, outcome === 'failed' ? 'error' : 'info', logMessage.slice(0, 1000), nowIso()]).catch(() => {});
  } catch {
    runId = null;
  }

  if (outcome === 'failed' && attempts < (task.max_attempts || 3)) {
    const backoffUntil = plusMinutes(finishedAt, attempts * 15);
    await d1Run(env, "UPDATE agent_tasks SET status = 'queued', scheduled_for = ?, updated_at = ? WHERE id = ?",
      [backoffUntil, nowIso(), id]);
    return { ok: true, taskId: id, runId, outcome, attempts, requeued: true, scheduled_for: backoffUntil, result };
  }
  const finalStatus = outcome === 'failed' ? 'failed' : 'done';
  await d1Run(env, 'UPDATE agent_tasks SET status = ?, updated_at = ? WHERE id = ?', [finalStatus, nowIso(), id]);
  return { ok: true, taskId: id, runId, outcome, attempts, requeued: false, result };
}

async function divisionCounts(env) {
  const rows = await d1All(env,
    'SELECT d.id, d.slug AS division, d.name, COUNT(a.id) AS total, ' +
    "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
    'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id ' +
    'GROUP BY d.id, d.slug, d.name ORDER BY published ASC, total ASC');
  return (rows || []).map((r) => ({
    id: r.id, division: r.division, name: r.name, total: Number(r.total || 0), published: Number(r.published || 0),
  }));
}

async function step(env, agent, label, fn) {
  try {
    const result = await fn();
    const outcome = result && result.outcome === 'failed' ? 'failed' : (result && result.outcome === 'no-op' ? 'no-op' : 'done');
    await writeRun(env, {
      taskId: null, agent, outcome,
      detail: { step: label, ...(result || {}) },
      logs: [{ level: outcome === 'failed' ? 'error' : 'info', message: `${label}: ${outcome}.` }],
    });
    return { step: label, outcome, result: result || {} };
  } catch (err) {
    const error = String(err && err.message ? err.message : err).slice(0, 300);
    await writeRun(env, {
      taskId: null, agent, outcome: 'failed',
      detail: { step: label, error },
      logs: [{ level: 'error', message: `${label} failed: ${error}` }],
    });
    return { step: label, outcome: 'failed', error };
  }
}

/**
 * Daily workflow. Steps: (1) security health check; (2) enqueue research
 * for the two thinnest divisions; (3) enqueue fact-checks for
 * pending_approval articles; (4) enqueue SEO for published articles with
 * blank seo fields (max 5); (5) publish due articles; (6) enqueue social
 * packs for articles published in the last 24h (max 5); (7) analytics
 * snapshot; (8) error scan; (9) write the daily_reports row.
 */
export async function runDailyWorkflow(env) {
  if (!env || !env.DB) return { ok: false, error: 'D1 database is not bound.' };
  const date = todayStr();
  if (await getEmergencyStop(env)) {
    await logSkip(env, 'scheduler', 'Emergency Stop is on — daily workflow skipped.');
    return { ok: true, skipped: true, reason: 'Emergency Stop is on.', date };
  }
  const steps = {};

  steps.healthCheck = await step(env, 'security-monitoring', 'health-check', async () => {
    const r = await runAutonomyTask({ agent: 'security-monitoring', kind: 'health-check', payload: {} }, env);
    return { ...r, checks: (r.checks || []).length };
  });

  steps.topicSelection = await step(env, 'research', 'topic-selection', async () => {
    const counts = await divisionCounts(env);
    const thinnest = counts.slice(0, 2);
    let enqueued = 0;
    let duplicates = 0;
    for (const d of thinnest) {
      const res = await enqueueTask(env, {
        agent: 'research', kind: 'daily-research', payload: { division: d.division, sources: [] },
        division_id: d.id, priority: 5, idempotency_key: `daily-research-${d.division}-${date}`,
      });
      if (res.ok) (res.duplicate ? duplicates++ : enqueued++);
    }
    return { outcome: 'done', thinnest: thinnest.map((d) => d.division), enqueued, duplicates };
  });

  steps.factCheckQueue = await step(env, 'fact-checking', 'fact-check-queue', async () => {
    const rows = await d1All(env, "SELECT id FROM articles WHERE status = 'pending_approval' ORDER BY updated_at ASC") || [];
    let enqueued = 0;
    let duplicates = 0;
    for (const r of rows) {
      const res = await enqueueTask(env, {
        agent: 'fact-checking', kind: 'fact-check', payload: { article_id: r.id },
        priority: 6, idempotency_key: `daily-factcheck-${r.id}-${date}`,
      });
      if (res.ok) (res.duplicate ? duplicates++ : enqueued++);
    }
    return { outcome: 'done', pendingApproval: rows.length, enqueued, duplicates };
  });

  steps.seoPass = await step(env, 'seo', 'seo-pass', async () => {
    const rows = await d1All(env,
      "SELECT id FROM articles WHERE status = 'published' AND (seo_title IS NULL OR seo_title = '' OR seo_description IS NULL OR seo_description = '') ORDER BY updated_at ASC LIMIT 5") || [];
    let enqueued = 0;
    let duplicates = 0;
    for (const r of rows) {
      const res = await enqueueTask(env, {
        agent: 'seo', kind: 'seo-pass', payload: { article_id: r.id },
        priority: 5, idempotency_key: `daily-seo-${r.id}-${date}`,
      });
      if (res.ok) (res.duplicate ? duplicates++ : enqueued++);
    }
    return { outcome: 'done', needingSeo: rows.length, enqueued, duplicates };
  });

  steps.publishDue = await step(env, 'publishing', 'publish-due', async () => {
    const r = await publishDueArticles(env);
    if (!r.ok) return { outcome: 'failed', error: r.error || 'Publish due failed.' };
    if (r.skipped) return { outcome: 'no-op', reason: r.reason, published: 0 };
    return { outcome: 'done', published: r.published || 0, slugs: r.slugs || [] };
  });

  steps.socialPrep = await step(env, 'social-media', 'social-pack-prep', async () => {
    const rows = await d1All(env,
      "SELECT id FROM articles WHERE status = 'published' AND published_at >= datetime('now', '-1 day') ORDER BY published_at DESC LIMIT 5") || [];
    let enqueued = 0;
    let duplicates = 0;
    for (const r of rows) {
      const res = await enqueueTask(env, {
        agent: 'social-media', kind: 'social-pack', payload: { article_id: r.id },
        priority: 4, idempotency_key: `daily-social-${r.id}-${date}`,
      });
      if (res.ok) (res.duplicate ? duplicates++ : enqueued++);
    }
    return { outcome: 'done', publishedLast24h: rows.length, enqueued, duplicates };
  });

  steps.analyticsSnapshot = await step(env, 'analytics', 'analytics-snapshot', async () => {
    const r = await runAutonomyTask({ agent: 'analytics', kind: 'snapshot', payload: {} }, env);
    return r;
  });

  steps.errorScan = await step(env, 'security-monitoring', 'error-scan', async () => {
    const failedRow = await d1First(env, "SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'failed'");
    const eventsRow = await d1First(env, "SELECT COUNT(*) AS n FROM security_events WHERE created_at >= datetime('now', '-7 days')");
    const failedTasks = Number(failedRow ? failedRow.n : 0);
    const securityEvents = Number(eventsRow ? eventsRow.n : 0);
    return {
      outcome: 'done', failedTasks, securityEventsLast7Days: securityEvents,
      detail: `${failedTasks} failed task(s), ${securityEvents} security event(s) in the last 7 days.`,
    };
  });

  const summary = {
    date,
    kind: 'daily',
    steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, { outcome: v.outcome, ...(v.error ? { error: v.error } : {}) }])),
    counts: {
      researchEnqueued: steps.topicSelection.result?.enqueued ?? 0,
      factChecksEnqueued: steps.factCheckQueue.result?.enqueued ?? 0,
      seoEnqueued: steps.seoPass.result?.enqueued ?? 0,
      published: steps.publishDue.result?.published ?? 0,
      socialEnqueued: steps.socialPrep.result?.enqueued ?? 0,
      failedTasks: steps.errorScan.result?.failedTasks ?? 0,
      securityEventsLast7Days: steps.errorScan.result?.securityEventsLast7Days ?? 0,
    },
    revenue: 0,
    revenueFormatted: '$0.00',
    traffic: 'Data unavailable',
  };
  let reportId = null;
  try {
    const inserted = await d1Run(env,
      'INSERT INTO daily_reports (date, kind, summary_json, created_at) VALUES (?, ?, ?, ?)',
      [date, 'daily', JSON.stringify(summary), nowIso()]);
    reportId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  } catch (err) {
    summary.reportError = String(err && err.message ? err.message : err).slice(0, 200);
  }
  return { ok: true, date, reportId, steps: summary.steps, counts: summary.counts };
}

/**
 * Weekly workflow: performance analysis from real D1 data — articles by
 * division, task outcomes in the last 7 days, failed tasks list, top
 * divisions — plus a weekly daily_reports row.
 */
export async function runWeeklyWorkflow(env) {
  if (!env || !env.DB) return { ok: false, error: 'D1 database is not bound.' };
  const date = todayStr();
  if (await getEmergencyStop(env)) {
    await logSkip(env, 'scheduler', 'Emergency Stop is on — weekly workflow skipped.');
    return { ok: true, skipped: true, reason: 'Emergency Stop is on.', date };
  }
  const byDivision = await divisionCounts(env);
  const outcomes = await d1All(env,
    "SELECT outcome, COUNT(*) AS n FROM agent_runs WHERE started_at >= datetime('now', '-7 days') GROUP BY outcome") || [];
  const taskOutcomes = Object.fromEntries(outcomes.map((r) => [r.outcome, Number(r.n || 0)]));
  const failedTasks = await d1All(env,
    "SELECT id, agent, kind, attempts, max_attempts, updated_at FROM agent_tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20") || [];
  const topDivisions = [...byDivision].sort((a, b) => b.published - a.published).slice(0, 3);
  const totalsRow = await d1First(env, 'SELECT COUNT(*) AS n FROM articles');
  const publishedRow = await d1First(env, "SELECT COUNT(*) AS n FROM articles WHERE status = 'published'");

  const summary = {
    date,
    kind: 'weekly',
    articlesByDivision: byDivision,
    totalArticles: Number(totalsRow ? totalsRow.n : 0),
    publishedArticles: Number(publishedRow ? publishedRow.n : 0),
    taskOutcomesLast7Days: taskOutcomes,
    failedTasks: failedTasks.map((t) => ({ id: t.id, agent: t.agent, kind: t.kind, attempts: t.attempts, maxAttempts: t.max_attempts, updatedAt: t.updated_at })),
    failedTaskCount: failedTasks.length,
    topDivisions: topDivisions.map((d) => ({ division: d.division, published: d.published, total: d.total })),
    revenue: 0,
    revenueFormatted: '$0.00',
    traffic: 'Data unavailable',
  };
  let reportId = null;
  try {
    const inserted = await d1Run(env,
      'INSERT INTO daily_reports (date, kind, summary_json, created_at) VALUES (?, ?, ?, ?)',
      [date, 'weekly', JSON.stringify(summary), nowIso()]);
    reportId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  } catch (err) {
    summary.reportError = String(err && err.message ? err.message : err).slice(0, 200);
  }
  await writeRun(env, {
    taskId: null, agent: 'scheduler', outcome: 'done',
    detail: { step: 'weekly-report', reportId },
    logs: [{ level: 'info', message: `Weekly report written (id ${reportId}).` }],
  });
  return { ok: true, date, reportId, summary };
}

/**
 * Report snapshot from current D1 data — used by POST
 * /api/autonomy/reports/generate. This does NOT re-execute any workflow
 * or agent task; it only reads current state and stores the row.
 */
export async function generateReportSnapshot(env, kind) {
  if (!env || !env.DB) return { ok: false, error: 'D1 database is not bound.' };
  const date = todayStr();
  const taskCounts = await d1All(env, 'SELECT status, COUNT(*) AS n FROM agent_tasks GROUP BY status') || [];
  const agentStatuses = await d1All(env, 'SELECT status, COUNT(*) AS n FROM ai_agents GROUP BY status') || [];
  const articlesByDivision = await divisionCounts(env);
  const articlesByStatus = await d1All(env, 'SELECT status, COUNT(*) AS n FROM articles GROUP BY status') || [];
  const failedTasks = await d1All(env,
    "SELECT id, agent, kind, attempts, max_attempts, updated_at FROM agent_tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20") || [];
  const summary = {
    date,
    kind,
    generatedAt: nowIso(),
    tasksByStatus: Object.fromEntries(taskCounts.map((r) => [r.status, Number(r.n || 0)])),
    agentsByStatus: Object.fromEntries(agentStatuses.map((r) => [r.status, Number(r.n || 0)])),
    articlesByDivision,
    articlesByStatus: Object.fromEntries(articlesByStatus.map((r) => [r.status, Number(r.n || 0)])),
    failedTasks: failedTasks.map((t) => ({ id: t.id, agent: t.agent, kind: t.kind, attempts: t.attempts, maxAttempts: t.max_attempts, updatedAt: t.updated_at })),
    revenue: 0,
    revenueFormatted: '$0.00',
    traffic: 'Data unavailable',
    note: 'Snapshot of current D1 state — no workflow was executed to generate it.',
  };
  const inserted = await d1Run(env,
    'INSERT INTO daily_reports (date, kind, summary_json, created_at) VALUES (?, ?, ?, ?)',
    [date, kind, JSON.stringify(summary), nowIso()]);
  const reportId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  const row = reportId ? await d1First(env, 'SELECT * FROM daily_reports WHERE id = ? LIMIT 1', [reportId]) : null;
  return { ok: true, report: row ? { ...row, summary } : { id: reportId, date, kind, summary_json: JSON.stringify(summary) } };
}
