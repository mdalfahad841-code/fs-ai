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
import { runAutonomyTask, DIVISION_RESEARCH_REGISTRY, registryIdForTask } from '../agents/autonomy-runner.js';
import { runResearch } from '../agents/autonomy/research.js';
import { runFactChecking } from '../agents/autonomy/factcheck.js';
import { runSeo } from '../agents/autonomy/seo.js';
import { evaluatePublishGate, publishGatePassed } from '../publishing/gate.js';

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

  // Pause check: the registry agent that governs this task. For research
  // this resolves through the division-slug -> agent map (a paused
  // division research agent makes that division's research tasks skip).
  // A division-less research task skips only when EVERY division
  // research agent is paused; an unknown registry state never blocks.
  const registryId = registryIdForTask(task);
  let pausedId = null;
  if (registryId) {
    const status = await registryStatus(env, registryId);
    if (status && status !== 'active') pausedId = registryId;
  } else if (task.agent === 'research') {
    const ids = Object.values(DIVISION_RESEARCH_REGISTRY);
    let allPaused = ids.length > 0;
    for (const id of ids) {
      const status = await registryStatus(env, id);
      if (!status || status === 'active') { allPaused = false; break; }
    }
    if (allPaused) pausedId = 'research (all division research agents)';
  }
  if (pausedId) {
    await d1Run(env, "UPDATE agent_tasks SET status = 'skipped', updated_at = ? WHERE id = ?", [nowIso(), id]);
    await writeRun(env, {
      taskId: id, agent: task.agent, outcome: 'skipped',
      detail: { reason: `Agent ${pausedId} is paused.` },
      logs: [{ level: 'warn', message: `Task skipped: agent ${pausedId} is paused.` }],
    });
    return { ok: false, status: 409, error: `Agent ${pausedId} is paused — resume it before running.`, skipped: true };
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

/**
 * Safe retry of a failed task: resets it to queued with attempts 0 and
 * no backoff, so the next manual or scheduled run picks it up. Only
 * failed tasks can be retried; anything else is a 409. The caller
 * (orchestrator) enforces owner-only access.
 */
export async function retryTask(env, taskId) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, error: 'Task id must be a positive integer.' };
  const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [id]);
  if (!row) return { ok: false, status: 404, error: 'Task not found.' };
  const task = normaliseTaskRow(row);
  if (task.status !== 'failed') {
    return { ok: false, status: 409, error: `Task is '${task.status}' — only failed tasks can be retried.` };
  }
  await d1Run(env, "UPDATE agent_tasks SET status = 'queued', attempts = 0, scheduled_for = NULL, updated_at = ? WHERE id = ?",
    [nowIso(), id]);
  await writeRun(env, {
    taskId: id, agent: task.agent, outcome: 'no-op',
    detail: { step: 'retry', reason: 'Owner retried a failed task.' },
    logs: [{ level: 'info', message: `Task ${id} (${task.agent}) retried by owner — back to queued.` }],
  });
  return { ok: true, taskId: id, agent: task.agent };
}

async function autonomySetting(env, key, fallback = 'off') {
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [key]);
    return row && typeof row.value === 'string' ? row.value : fallback;
  } catch {
    return fallback;
  }
}

async function autoFlags(env) {
  const out = {};
  for (const k of ['auto_research', 'auto_generation', 'auto_factcheck', 'auto_correction', 'auto_publishing']) {
    out[k] = await autonomySetting(env, k, 'off');
  }
  return out;
}

async function maxArticlesPerDay(env) {
  const n = Number.parseInt(await autonomySetting(env, 'max_articles_per_day', '1'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * One daily_reports row per (date, kind): update the existing row when a
 * workflow re-runs the same day instead of inserting a duplicate. The
 * live DB may already hold duplicate (date, kind) pairs from before this
 * fix, so no UNIQUE index is added — the first matching row is updated.
 */
async function upsertReport(env, date, kind, summary) {
  const existing = await d1First(env,
    'SELECT id FROM daily_reports WHERE date = ? AND kind = ? ORDER BY id ASC LIMIT 1', [date, kind]);
  if (existing) {
    await d1Run(env, 'UPDATE daily_reports SET summary_json = ?, created_at = ? WHERE id = ?',
      [JSON.stringify(summary), nowIso(), existing.id]);
    return { reportId: existing.id, duplicate: true };
  }
  const inserted = await d1Run(env,
    'INSERT INTO daily_reports (date, kind, summary_json, created_at) VALUES (?, ?, ?, ?)',
    [date, kind, JSON.stringify(summary), nowIso()]);
  return { reportId: inserted && inserted.meta ? inserted.meta.last_row_id : null, duplicate: false };
}

/** d1All that degrades to null when a table does not exist yet (a DB that has not applied migrations 008-011). */
async function safeAll(env, sql, params = []) {
  try {
    return await d1All(env, sql, params);
  } catch {
    return null;
  }
}

async function safeFirstRow(env, sql, params = []) {
  try {
    return await d1First(env, sql, params);
  } catch {
    return null;
  }
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
 * for the two thinnest divisions; (3) fetch RSS inline when
 * auto_research is on; (4) enqueue content tasks from today's fresh
 * research items when auto_generation is on (daily limit respected);
 * (5) enqueue fact-checks for pending_approval articles; (6) run
 * fact-checks inline when auto_factcheck is on; (7) run corrections
 * inline when auto_correction is on; (8) run SEO checks inline for
 * drafts; (9) evaluate the publish gate for every draft (approves only
 * when auto_publishing is on AND the publishing mode permits it —
 * with the live default 'approved_only' nothing auto-publishes);
 * (10) publish due articles; (11) enqueue social packs for articles
 * published in the last 24h (max 5); (12) analytics snapshot;
 * (13) error scan; (14) write the daily_reports row.
 *
 * One run per UTC date unless { force: true }. The report row is
 * upserted, so a forced re-run never creates a duplicate row.
 * All dates are UTC; 00:00 UTC is 06:00 Asia/Dhaka.
 */
export async function runDailyWorkflow(env, { force = false } = {}) {
  if (!env || !env.DB) return { ok: false, error: 'D1 database is not bound.' };
  const date = todayStr();
  if (await getEmergencyStop(env)) {
    await logSkip(env, 'scheduler', 'Emergency Stop is on — daily workflow skipped.');
    return { ok: true, skipped: true, reason: 'Emergency Stop is on.', date };
  }
  if (!force) {
    const existing = await d1First(env, "SELECT id FROM daily_reports WHERE date = ? AND kind = 'daily' LIMIT 1", [date]);
    if (existing) {
      return { ok: true, date, duplicate: true, reportId: existing.id, reason: 'Daily workflow already ran today — pass force to re-run.' };
    }
  }
  const flags = await autoFlags(env);
  const dailyLimit = await maxArticlesPerDay(env);
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
        agent: 'research', kind: 'daily-research', payload: { division: d.division },
        division_id: d.id, priority: 5, idempotency_key: `daily-research-${d.division}-${date}`,
      });
      if (res.ok) (res.duplicate ? duplicates++ : enqueued++);
    }
    return { outcome: 'done', thinnest: thinnest.map((d) => d.division), enqueued, duplicates };
  });

  steps.researchFetch = await step(env, 'research', 'research-fetch', async () => {
    if (flags.auto_research !== 'on') return { outcome: 'no-op', reason: 'auto_research is off.' };
    const counts = await divisionCounts(env);
    const thinnest = counts.slice(0, 2);
    let fetched = 0;
    let added = 0;
    const errors = [];
    for (const d of thinnest) {
      const r = await runResearch({ agent: 'research', kind: 'daily-research', payload: { division: d.division } }, env);
      if (r.outcome === 'done') { fetched += (r.candidates || []).length; added += r.itemsStored || 0; }
      else if (r.outcome === 'failed') errors.push({ division: d.division, error: r.error });
      else if (Array.isArray(r.fetchErrors)) errors.push(...r.fetchErrors);
    }
    return { outcome: errors.length && !fetched ? 'failed' : 'done', divisions: thinnest.map((d) => d.division), fetched, added, errors };
  });

  steps.contentFromResearch = await step(env, 'content-creation', 'content-from-research', async () => {
    if (flags.auto_generation !== 'on') return { outcome: 'no-op', reason: 'auto_generation is off.' };
    const items = await d1All(env,
      'SELECT ri.id, ri.title, ri.url, ri.division_id, d.slug AS division FROM research_items ri ' +
      "JOIN business_divisions d ON d.id = ri.division_id WHERE ri.is_outdated = 0 AND ri.fetched_at >= datetime('now', '-1 day') " +
      'ORDER BY ri.fetched_at DESC LIMIT 20') || [];
    const existing = await d1All(env, 'SELECT title FROM articles') || [];
    const existingTitles = new Set(existing.map((r) => String(r.title || '').toLowerCase().trim()));
    let enqueued = 0;
    let duplicates = 0;
    let skippedExisting = 0;
    for (const item of items) {
      if (enqueued >= dailyLimit) break;
      if (existingTitles.has(String(item.title).toLowerCase().trim())) { skippedExisting += 1; continue; }
      const res = await enqueueTask(env, {
        agent: 'content-creation', kind: 'daily-content',
        payload: { title: item.title, division: item.division, sources: item.url ? [item.url] : [] },
        division_id: item.division_id, priority: 6, idempotency_key: `daily-content-${item.id}-${date}`,
      });
      if (res.ok) (res.duplicate ? duplicates++ : enqueued++);
    }
    return { outcome: 'done', candidates: items.length, enqueued, duplicates, skippedExisting, dailyLimit };
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

  steps.factCheckRun = await step(env, 'fact-checking', 'fact-check-run', async () => {
    if (flags.auto_factcheck !== 'on') return { outcome: 'no-op', reason: 'auto_factcheck is off.' };
    const rows = await d1All(env, "SELECT id FROM articles WHERE status IN ('draft', 'pending_approval') ORDER BY updated_at ASC LIMIT 3") || [];
    const results = [];
    for (const r of rows) {
      const res = await runFactChecking({ agent: 'fact-checking', kind: 'fact-check', payload: { article_id: r.id } }, env);
      results.push({ articleId: r.id, outcome: res.outcome, verdict: res.verdict || null });
    }
    return { outcome: 'done', checked: results.length, results };
  });

  steps.correctionRun = await step(env, 'fact-checking', 'correction-run', async () => {
    if (flags.auto_correction !== 'on') return { outcome: 'no-op', reason: 'auto_correction is off.' };
    const rows = await d1All(env,
      'SELECT DISTINCT fc.article_id AS id FROM fact_checks fc ' +
      "WHERE fc.verdict IN ('needs-review', 'failed') AND fc.created_at >= datetime('now', '-7 days') " +
      "AND EXISTS (SELECT 1 FROM articles a WHERE a.id = fc.article_id AND a.status IN ('draft', 'pending_approval')) " +
      'ORDER BY fc.created_at DESC LIMIT 3') || [];
    const results = [];
    for (const r of rows) {
      const res = await runFactChecking({ agent: 'fact-checking', kind: 'correct', payload: { article_id: r.id } }, env);
      results.push({ articleId: r.id, outcome: res.outcome, corrected: res.corrected ?? 0, removed: res.removed ?? 0 });
    }
    return { outcome: 'done', corrected: results.length, results };
  });

  steps.seoRun = await step(env, 'seo', 'seo-run', async () => {
    const rows = await d1All(env, "SELECT id FROM articles WHERE status IN ('draft', 'pending_approval') ORDER BY updated_at ASC LIMIT 3") || [];
    const results = [];
    for (const r of rows) {
      const res = await runSeo({ agent: 'seo', kind: 'seo-pass', payload: { article_id: r.id } }, env);
      results.push({ articleId: r.id, outcome: res.outcome, verdict: res.verdict || null });
    }
    return { outcome: 'done', checked: results.length, results };
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

  steps.publishGate = await step(env, 'publishing', 'publish-gate', async () => {
    const rows = await d1All(env, "SELECT id FROM articles WHERE status IN ('draft', 'pending_approval') ORDER BY updated_at ASC") || [];
    const results = [];
    let approved = 0;
    for (const r of rows) {
      const gate = await evaluatePublishGate(env, r.id);
      let wasApproved = false;
      if (gate.eligible && flags.auto_publishing === 'on') {
        const pub = await publishGatePassed(env, r.id, { dailyLimit });
        wasApproved = Boolean(pub.ok);
        if (wasApproved) approved += 1;
      }
      results.push({ articleId: r.id, eligible: gate.eligible, approved: wasApproved, blockedBy: gate.blockedBy });
    }
    return { outcome: 'done', evaluated: results.length, approved, results, autoPublishing: flags.auto_publishing };
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
      researchFetched: steps.researchFetch.result?.fetched ?? 0,
      researchItemsStored: steps.researchFetch.result?.added ?? 0,
      contentEnqueued: steps.contentFromResearch.result?.enqueued ?? 0,
      factChecksEnqueued: steps.factCheckQueue.result?.enqueued ?? 0,
      factChecksRun: steps.factCheckRun.result?.checked ?? 0,
      correctionsRun: steps.correctionRun.result?.corrected ?? 0,
      seoRun: steps.seoRun.result?.checked ?? 0,
      seoEnqueued: steps.seoPass.result?.enqueued ?? 0,
      gateEvaluated: steps.publishGate.result?.evaluated ?? 0,
      gateApproved: steps.publishGate.result?.approved ?? 0,
      published: steps.publishDue.result?.published ?? 0,
      socialEnqueued: steps.socialPrep.result?.enqueued ?? 0,
      failedTasks: steps.errorScan.result?.failedTasks ?? 0,
      securityEventsLast7Days: steps.errorScan.result?.securityEventsLast7Days ?? 0,
    },
    autoFlags: flags,
    dailyLimit,
    revenue: 0,
    revenueFormatted: '$0.00',
    traffic: 'Data unavailable',
  };
  let reportId = null;
  let duplicateReport = false;
  try {
    const saved = await upsertReport(env, date, 'daily', summary);
    reportId = saved.reportId;
    duplicateReport = saved.duplicate;
  } catch (err) {
    summary.reportError = String(err && err.message ? err.message : err).slice(0, 200);
  }
  // `duplicate` means "this call did not re-run" — a forced re-run DID
  // run, so it reports no duplicate even though it updated the row.
  return { ok: true, date, reportId, duplicate: (!force && duplicateReport) ? true : undefined, steps: summary.steps, counts: summary.counts };
}

/**
 * Weekly workflow: performance analysis from real D1 data — articles by
 * division, task outcomes in the last 7 days, failed tasks list, top
 * divisions, failed RSS sources, fact-check failures, successful topics,
 * content gaps, SEO problems, and improvement recommendations derived
 * from that data — plus a weekly daily_reports row.
 *
 * One run per UTC week-date unless { force: true }. The report row is
 * upserted, so a forced re-run never creates a duplicate row.
 */
export async function runWeeklyWorkflow(env, { force = false } = {}) {
  if (!env || !env.DB) return { ok: false, error: 'D1 database is not bound.' };
  const date = todayStr();
  if (await getEmergencyStop(env)) {
    await logSkip(env, 'scheduler', 'Emergency Stop is on — weekly workflow skipped.');
    return { ok: true, skipped: true, reason: 'Emergency Stop is on.', date };
  }
  if (!force) {
    const existing = await d1First(env, "SELECT id FROM daily_reports WHERE date = ? AND kind = 'weekly' LIMIT 1", [date]);
    if (existing) {
      return { ok: true, date, duplicate: true, reportId: existing.id, reason: 'Weekly workflow already ran today — pass force to re-run.' };
    }
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

  // Failed RSS sources (real health rows). These queries degrade to
  // empty on a DB that has not applied migrations 008-011 yet, so the
  // weekly report still writes instead of throwing.
  const failedSourcesRaw = await safeAll(env,
    "SELECT s.id, s.name, s.url, d.slug AS division, s.last_error, s.last_fetched_at FROM research_sources s " +
    "JOIN business_divisions d ON d.id = s.division_id WHERE s.is_active = 1 AND s.last_status = 'error' ORDER BY s.updated_at DESC");
  const failedSources = failedSourcesRaw || [];
  const sourceTotals = await safeFirstRow(env, 'SELECT COUNT(*) AS n FROM research_sources WHERE is_active = 1');
  const itemTotals = await safeFirstRow(env, "SELECT COUNT(*) AS n FROM research_items WHERE fetched_at >= datetime('now', '-7 days')");
  const itemsByDivisionRaw = await safeAll(env,
    'SELECT d.slug AS division, COUNT(*) AS n FROM research_items ri JOIN business_divisions d ON d.id = ri.division_id ' +
    "WHERE ri.fetched_at >= datetime('now', '-7 days') GROUP BY d.slug ORDER BY n DESC");
  const itemsByDivision = itemsByDivisionRaw || [];

  // Fact-check failures in the last 7 days.
  const factCheckFailuresRaw = await safeAll(env,
    'SELECT fc.id, fc.article_id, fc.verdict, fc.claims_total, fc.claims_verified, fc.claims_failed, fc.created_at ' +
    "FROM fact_checks fc WHERE fc.verdict IN ('needs-review', 'failed') AND fc.created_at >= datetime('now', '-7 days') ORDER BY fc.created_at DESC LIMIT 20");
  const factCheckFailures = factCheckFailuresRaw || [];
  const factCheckTotalsRaw = await safeAll(env,
    "SELECT verdict, COUNT(*) AS n FROM fact_checks WHERE created_at >= datetime('now', '-7 days') GROUP BY verdict");
  const factCheckTotals = factCheckTotalsRaw || [];

  // SEO problems in the last 7 days.
  const seoProblemsRaw = await safeAll(env,
    'SELECT sc.id, sc.article_id, sc.verdict, sc.created_at FROM seo_checks sc ' +
    "WHERE sc.verdict IN ('needs-review', 'failed') AND sc.created_at >= datetime('now', '-7 days') ORDER BY sc.created_at DESC LIMIT 20");
  const seoProblems = seoProblemsRaw || [];
  const pipelineTablesMissing = failedSourcesRaw === null || factCheckFailuresRaw === null || seoProblemsRaw === null;

  // Content gaps: divisions with the fewest published articles.
  const contentGaps = byDivision.filter((d) => d.published === 0).map((d) => ({ division: d.division, published: 0, total: d.total }));
  const thinnest = byDivision.slice(0, 3).map((d) => ({ division: d.division, published: d.published, total: d.total }));

  // Recommendations derived from the data above — never invented.
  const recommendations = [];
  if (failedSources.length) {
    recommendations.push(`${failedSources.length} RSS source(s) failed their last fetch — check the URLs in Research Sources and disable or replace any that stay down.`);
  }
  if (factCheckFailures.length) {
    recommendations.push(`${factCheckFailures.length} article(s) failed fact-checking in the last 7 days — run corrections and re-check before they can publish.`);
  }
  if (seoProblems.length) {
    recommendations.push(`${seoProblems.length} article(s) have SEO problems — fill missing titles/descriptions and fix the flagged checks.`);
  }
  if (contentGaps.length) {
    recommendations.push(`Divisions with no published articles yet: ${contentGaps.map((g) => g.division).join(', ')} — prioritise research and generation there.`);
  }
  if (failedTasks.length) {
    recommendations.push(`${failedTasks.length} failed task(s) are waiting — retry them from the task queue or investigate the logged errors.`);
  }
  if (!recommendations.length) {
    recommendations.push('No blocking issues this week — keep the daily Short + Pin cadence and the weekly long video going.');
  }
  if (pipelineTablesMissing) {
    recommendations.push('Research / fact-check / SEO tables are missing (migrations 008-011 not applied yet) — those sections of this report are empty until the migrations are applied.');
  }

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
    failedSources: failedSources.map((s) => ({ id: s.id, name: s.name, url: s.url, division: s.division, lastError: s.last_error, lastFetchedAt: s.last_fetched_at })),
    activeSources: Number(sourceTotals ? sourceTotals.n : 0),
    researchItemsLast7Days: Number(itemTotals ? itemTotals.n : 0),
    successfulTopicsByDivision: itemsByDivision.map((r) => ({ division: r.division, items: Number(r.n || 0) })),
    factCheckFailures: factCheckFailures.map((f) => ({ id: f.id, articleId: f.article_id, verdict: f.verdict, claimsTotal: f.claims_total, claimsVerified: f.claims_verified, claimsFailed: f.claims_failed, createdAt: f.created_at })),
    factCheckTotalsLast7Days: Object.fromEntries(factCheckTotals.map((r) => [r.verdict, Number(r.n || 0)])),
    seoProblems: seoProblems.map((s) => ({ id: s.id, articleId: s.article_id, verdict: s.verdict, createdAt: s.created_at })),
    contentGaps,
    thinnestDivisions: thinnest,
    recommendations,
    revenue: 0,
    revenueFormatted: '$0.00',
    traffic: 'Data unavailable',
  };
  let reportId = null;
  let duplicateReport = false;
  try {
    const saved = await upsertReport(env, date, 'weekly', summary);
    reportId = saved.reportId;
    duplicateReport = saved.duplicate;
  } catch (err) {
    summary.reportError = String(err && err.message ? err.message : err).slice(0, 200);
  }
  await writeRun(env, {
    taskId: null, agent: 'scheduler', outcome: 'done',
    detail: { step: 'weekly-report', reportId },
    logs: [{ level: 'info', message: `Weekly report written (id ${reportId}).` }],
  });
  return { ok: true, date, reportId, duplicate: (!force && duplicateReport) ? true : undefined, summary };
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
