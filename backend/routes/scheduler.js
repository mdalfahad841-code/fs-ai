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
import { PROTECTED_TEST_ARTICLES, protectedExclusion, assertTaskNotProtected } from '../publishing/protection.js';

// Re-exported so existing callers/tests keep reading the list from this
// module; the definition lives in backend/publishing/protection.js.
export { PROTECTED_TEST_ARTICLES };

/**
 * Protected test articles — the owner's standing order (2026-11-19/20):
 * articles #26 and #27 are verification test artifacts whose content must
 * never be overwritten. The automatic daily workflow must never SELECT
 * them for a step that modifies an article (SEO repair, correction).
 * Manual per-article actions (an explicit dashboard/API call on one
 * article, e.g. runSeo / runFactChecking for a named article_id) are NOT
 * blocked — only the automatic draft selection below.
 * Fact-checking is advisory only (it never writes the body) and content
 * generation creates new articles, so neither needs this guard.
 * The list + the SQL exclusion helper live in
 * backend/publishing/protection.js (DB flag is_protected is the source
 * of truth, the constant is the fallback); this module re-exports the
 * list above and uses the imported helper at the correctionRun/seoRun
 * guard sites.
 */

export function todayStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function plusMinutes(baseIso, minutes) {
  return new Date(new Date(baseIso).getTime() + minutes * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------
// Phase 4 (2026-11-20) — run lease + stale-lock recovery + cancel.
// Live Phase 3 finding: a long synchronous manual run dies mid-flight
// after ~4-5 minutes with no error, no save, no agent_runs row, and
// the task left 'running' forever (task #32 stuck twice with 0 LLM
// calls; re-check probes died after 3 and 5 judge calls; task #31
// orphaned since the Phase 2 era). Root cause: runTask claimed
// queued -> running and then awaited runAutonomyTask with no timeout,
// no lease and no try/finally, and generateWithWorkersAI awaited
// env.AI.run with no timeout. The fixes:
//   - TASK_RUN_LEASE_MS: a run that exceeds its lease fails with a
//     clear reason and its status is ALWAYS resolved (try/finally in
//     runTask) — a run ends done/failed/skipped, never stuck running.
//   - recoverStaleTasks(): 'running' tasks older than the lease are
//     marked failed (reason 'stale-lock') so the existing retry
//     endpoint can re-queue them. Called by the dashboard endpoint
//     and by the daily/weekly workflows (best-effort, never blocking).
//   - cancelTask(): the owner can cancel a 'running' task; it lands
//     in 'failed' (reason 'cancelled-by-owner') and is retryable.
//   - A second run on a fresh 'running' task answers in-flight
//     (202-shape) instead of 409; a stale one is recovered first.
// No migration needed: only the existing status/updated_at columns
// and agent_runs rows are used. The lease cannot abort an in-flight
// AI call (the binding takes no signal) — it resolves the TASK state;
// in Workers the abandoned execution is killed when the request ends.
// ---------------------------------------------------------------------

/** A single task run may take at most 10 minutes before it is failed. */
export const TASK_RUN_LEASE_MS = 10 * 60 * 1000;

/**
 * Parse a D1/SQLite timestamp to epoch ms. D1 rows written by nowIso()
 * are ISO with 'T' + 'Z'; SQLite DEFAULT (datetime('now')) rows are
 * space-format 'YYYY-MM-DD HH:MM:SS' (UTC). Both read as UTC. Returns
 * null when the value cannot be parsed (never throws).
 */
export function parseDbTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim();
  if (text.includes(' ')) text = text.replace(' ', 'T');
  if (!/[zZ]$/.test(text) && !/[+-]\d{2}:?\d{2}$/.test(text)) text += 'Z';
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** True when a task has been 'running' longer than the lease. */
export function isTaskStale(task, leaseMs = TASK_RUN_LEASE_MS, nowMs = Date.now()) {
  if (!task || task.status !== 'running') return false;
  const started = parseDbTime(task.updated_at);
  if (started === null) return false; // unprovable — never guess stale
  return nowMs - started > leaseMs;
}

/** Race a promise against the run lease; on timeout resolve a failed result. */
function runWithLease(promise, leaseMs) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __leaseTimeout: true }), leaseMs);
  });
  return Promise.race([promise, timeout]).then(
    (value) => {
      if (timer) clearTimeout(timer);
      if (value && value.__leaseTimeout) {
        return {
          outcome: 'failed',
          error: `Task exceeded its run lease of ${Math.round(leaseMs / 1000)}s — the run was still in progress and was stopped; the task was marked failed so it can be retried.`,
        };
      }
      return value;
    },
    (err) => { if (timer) clearTimeout(timer); throw err; },
  );
}

/**
 * Recover ONE stale 'running' task: write a failed agent_runs row
 * (detail reason 'stale-lock') and mark the task failed so the
 * existing retry endpoint can re-queue it. Returns
 * { ok, recovered, taskId, ... } — recovered:false when the task is
 * not stale (fresh running, or any other status).
 */
export async function recoverStaleTask(env, taskId, { leaseMs = TASK_RUN_LEASE_MS, nowMs = Date.now() } = {}) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, error: 'Task id must be a positive integer.' };
  const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [id]);
  if (!row) return { ok: false, status: 404, error: 'Task not found.' };
  const task = normaliseTaskRow(row);
  if (!isTaskStale(task, leaseMs, nowMs)) {
    return { ok: true, recovered: false, taskId: id, status: task.status, reason: 'not-stale' };
  }
  const staleForMs = nowMs - (parseDbTime(task.updated_at) || nowMs);
  await writeRun(env, {
    taskId: id, agent: task.agent, outcome: 'failed',
    detail: { reason: 'stale-lock', staleForMs, updatedAt: task.updated_at, leaseMs },
    logs: [{ level: 'error', message: `Task ${id} (${task.agent}) recovered from a stale lock: running for ${Math.round(staleForMs / 1000)}s with no update (lease ${Math.round(leaseMs / 1000)}s). Marked failed so it can be retried.` }],
  });
  await d1Run(env, "UPDATE agent_tasks SET status = 'failed', updated_at = ? WHERE id = ?", [nowIso(), id]);
  return { ok: true, recovered: true, taskId: id, agent: task.agent, staleForMs };
}

/**
 * Sweep every 'running' task and recover the stale ones. Never throws
 * for a single bad row — one failure is skipped, the rest still run.
 * Returns { ok, recovered: [{taskId, agent, staleForMs, updatedAt}],
 * skipped: [ids], count }.
 */
export async function recoverStaleTasks(env, { leaseMs = TASK_RUN_LEASE_MS, nowMs = Date.now() } = {}) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  const rows = await d1All(env, "SELECT * FROM agent_tasks WHERE status = 'running' ORDER BY updated_at ASC") || [];
  const recovered = [];
  const skipped = [];
  for (const row of rows) {
    const task = normaliseTaskRow(row);
    if (!isTaskStale(task, leaseMs, nowMs)) { skipped.push(task.id); continue; }
    try {
      const res = await recoverStaleTask(env, task.id, { leaseMs, nowMs });
      if (res.recovered) recovered.push({ taskId: task.id, agent: task.agent, staleForMs: res.staleForMs, updatedAt: task.updated_at });
      else skipped.push(task.id);
    } catch {
      skipped.push(task.id);
    }
  }
  return { ok: true, recovered, skipped, count: recovered.length };
}

/**
 * Cancel a 'running' task. It lands in 'failed' with a 'cancelled-
 * by-owner' run row, so the existing retry endpoint can re-queue it.
 * Only running tasks can be cancelled; anything else is a 409. This
 * flips the row only — it cannot stop an execution already in flight
 * in another request (no handle exists on it); runTask's final status
 * write is conditional on still-'running', so a late completion never
 * resurrects a cancelled task.
 */
export async function cancelTask(env, taskId) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, error: 'Task id must be a positive integer.' };
  const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [id]);
  if (!row) return { ok: false, status: 404, error: 'Task not found.' };
  const task = normaliseTaskRow(row);
  if (task.status !== 'running') {
    return { ok: false, status: 409, error: `Task is '${task.status}' — only running tasks can be cancelled.` };
  }
  await writeRun(env, {
    taskId: id, agent: task.agent, outcome: 'failed',
    detail: { reason: 'cancelled-by-owner', cancelledAt: nowIso() },
    logs: [{ level: 'warn', message: `Task ${id} (${task.agent}) cancelled by the owner while running — marked failed so it can be retried.` }],
  });
  await d1Run(env, "UPDATE agent_tasks SET status = 'failed', updated_at = ? WHERE id = ?", [nowIso(), id]);
  return { ok: true, taskId: id, agent: task.agent, status: 'failed', cancelled: true };
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
 *
 * Content-task exception (Fix 8, 2026-11-20): re-creating a content task
 * with the same key (same title, same day) used to silently drop the
 * newly supplied sources. The duplicate is still reused — one task,
 * history preserved — but valid new source URLs are merged into the
 * existing task's payload (see mergeContentTaskSources), so the content
 * run, which re-reads the task row, sees every source.
 */
const CONTENT_TASK_SOURCE_LIMIT = 10; // matches the dashboard's 10-source cap

function normaliseTitle(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function normaliseDivision(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Dedupe key for a source URL: lowercase scheme+host, no fragment, no
// trailing slash. The STORED value is always the caller's original
// (trimmed) URL — resolveEvidence matches sources against
// research_items.url by exact string, so the stored text must not be
// rewritten.
function normaliseSourceUrl(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  let parsed;
  try { parsed = new URL(text); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}${path}${parsed.search}`;
}

// Merge a duplicate content-task creation's sources into the existing
// task. Returns null when the existing task is not a content task (the
// caller then returns the plain duplicate). Otherwise returns
// { task, sourceMerge } where task is the (possibly updated) task row
// and sourceMerge is one of:
//   existing-reused — no new sources were supplied
//   sources-added   — new valid sources were merged (listed in `added`)
//   no-new-sources  — sources were supplied but every one is a duplicate
//   rejected        — no source could be merged (invalid or mismatched;
//                     each entry in `rejected` carries its reason)
// A source is rejected when it is not a valid http(s) URL, when the
// re-creation names a different title/division than the original task
// (a source from another title/division must never mix in), or when the
// 10-source cap is already reached. The original task row is never
// deleted or recreated; a merge only rewrites its payload + updated_at.
async function mergeContentTaskSources(env, existingRow, newPayload, newDivisionId) {
  const existing = normaliseTaskRow(existingRow);
  if (!existing || existing.agent !== 'content-creation') return null;
  const existingPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
  const newSources = newPayload && Array.isArray(newPayload.sources) ? newPayload.sources : [];
  if (newSources.length === 0) {
    return { task: existing, sourceMerge: { status: 'existing-reused', added: [], duplicates: [], rejected: [] } };
  }
  // A task that already ran (done / running / skipped) can never use
  // merged sources — its article was already converted (or it will
  // never run). Reject the merge instead of claiming 'sources-added'
  // for sources that reach nothing. Failed tasks may still merge: a
  // retry re-reads the payload at run time.
  if (existing.status === 'done' || existing.status === 'running' || existing.status === 'skipped') {
    const reason = `task already ${existing.status} — sources cannot reach the already-converted (or never-run) article; create a new task`;
    return {
      task: existing,
      sourceMerge: { status: 'rejected', added: [], duplicates: [], rejected: newSources.map((s) => ({ source: typeof s === 'string' ? s.trim() : '', reason })) },
    };
  }
  // Request-level guard: a re-creation for a different title/division
  // must never mix its sources into this task.
  const mismatchReasons = [];
  if (newPayload && typeof newPayload.title === 'string' && newPayload.title.trim()
    && normaliseTitle(newPayload.title) !== normaliseTitle(existingPayload.title)) {
    mismatchReasons.push(`title does not match the original task ("${String(existingPayload.title || '').trim()}")`);
  }
  if (newPayload && typeof newPayload.division === 'string' && newPayload.division.trim()
    && normaliseDivision(newPayload.division) !== normaliseDivision(existingPayload.division)) {
    mismatchReasons.push(`division does not match the original task ("${String(existingPayload.division || '').trim()}")`);
  }
  if (newDivisionId != null && existing.division_id != null && Number(newDivisionId) !== Number(existing.division_id)) {
    mismatchReasons.push('division_id does not match the original task');
  }
  const supplied = newSources.map((s) => (typeof s === 'string' ? s.trim() : ''));
  if (mismatchReasons.length > 0) {
    const reason = `mismatched re-creation: ${mismatchReasons.join('; ')}`;
    return {
      task: existing,
      sourceMerge: { status: 'rejected', added: [], duplicates: [], rejected: supplied.map((s) => ({ source: s, reason })) },
    };
  }
  const existingSources = (Array.isArray(existingPayload.sources) ? existingPayload.sources : [])
    .filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
  const seenKeys = new Set(existingSources.map((s) => normaliseSourceUrl(s)).filter(Boolean));
  const seenExact = new Set(existingSources);
  const added = [];
  const duplicates = [];
  const rejected = [];
  const mergedSources = [...existingSources];
  for (const text of supplied) {
    if (!text) { rejected.push({ source: text, reason: 'empty source' }); continue; }
    const key = normaliseSourceUrl(text);
    if (!key) { rejected.push({ source: text, reason: 'not a valid http(s) URL' }); continue; }
    if (seenKeys.has(key) || seenExact.has(text)) { duplicates.push(text); continue; }
    if (mergedSources.length >= CONTENT_TASK_SOURCE_LIMIT) {
      rejected.push({ source: text, reason: `source limit of ${CONTENT_TASK_SOURCE_LIMIT} reached` });
      continue;
    }
    seenKeys.add(key);
    seenExact.add(text);
    mergedSources.push(text);
    added.push(text);
  }
  const status = added.length > 0 ? 'sources-added' : (rejected.length > 0 ? 'rejected' : 'no-new-sources');
  if (added.length === 0) {
    return { task: existing, sourceMerge: { status, added, duplicates, rejected } };
  }
  const now = nowIso();
  const nextPayload = { ...existingPayload, sources: mergedSources };
  await d1Run(env, 'UPDATE agent_tasks SET payload = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(nextPayload), now, existing.id]);
  const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [existing.id]);
  const task = row ? normaliseTaskRow(row) : { ...existing, payload: nextPayload, updated_at: now };
  return { task, sourceMerge: { status, added, duplicates, rejected } };
}

// Shared duplicate return: a content task gets its sources merged
// (Fix 8); every other task returns the existing row unchanged.
async function duplicateTaskResult(env, row, payload, division_id) {
  const merged = await mergeContentTaskSources(env, row, payload || {}, division_id);
  if (merged) return { ok: true, task: merged.task, duplicate: true, sourceMerge: merged.sourceMerge };
  return { ok: true, task: normaliseTaskRow(row), duplicate: true };
}

export async function enqueueTask(env, { agent, kind, payload = {}, division_id = null, priority = 5, idempotency_key, scheduled_for = null }) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  if (!agent || typeof agent !== 'string') return { ok: false, status: 400, error: 'agent is required.' };
  if (!kind || typeof kind !== 'string') return { ok: false, status: 400, error: 'kind is required.' };
  const key = idempotency_key || `manual-${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existing = await d1First(env, 'SELECT * FROM agent_tasks WHERE idempotency_key = ? LIMIT 1', [key]);
  if (existing) return duplicateTaskResult(env, existing, payload, division_id);
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
      if (row) return duplicateTaskResult(env, row, payload, division_id);
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
 *
 * Phase 4 (2026-11-20) — the execution is raced against TASK_RUN_LEASE_MS
 * and the whole post-claim section runs in try/finally, so the task
 * status is ALWAYS resolved: a run ends done/failed/skipped, never
 * stuck 'running'. A second call on a fresh 'running' task returns
 * { ok: true, inFlight: true } (the caller maps it to 202) instead of
 * 409; a stale 'running' task is recovered to 'failed' first
 * (recoveredStale: true). The final status write is conditional on
 * still-'running', so a concurrent owner cancel is never overwritten
 * by a late completion (reported as cancelledDuringRun).
 * options.leaseMs overrides TASK_RUN_LEASE_MS (tests).
 */
export async function runTask(env, taskId, options = {}) {
  if (!env || !env.DB) return { ok: false, status: 503, error: 'D1 database is not bound.' };
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, error: 'Task id must be a positive integer.' };
  const leaseMs = options && Number.isFinite(Number(options.leaseMs)) && Number(options.leaseMs) > 0
    ? Number(options.leaseMs) : TASK_RUN_LEASE_MS;
  const row = await d1First(env, 'SELECT * FROM agent_tasks WHERE id = ? LIMIT 1', [id]);
  if (!row) return { ok: false, status: 404, error: 'Task not found.' };
  const task = normaliseTaskRow(row);
  if (task.status !== 'queued') {
    if (task.status === 'running') {
      // Phase 4: a stale lock heals itself — recover it and tell the
      // caller to retry; a genuinely in-flight run answers in-flight
      // (the HTTP layer maps it to 202), never a 409.
      if (isTaskStale(task, leaseMs)) {
        const recovered = await recoverStaleTask(env, id, { leaseMs });
        if (recovered.recovered) {
          return {
            ok: false, status: 409, recoveredStale: true, taskId: id,
            error: `Task was stuck 'running' with no update for over ${Math.round(leaseMs / 60000)} minute(s) — recovered as failed. Retry it to run it again.`,
          };
        }
      }
      return { ok: true, inFlight: true, taskId: id, status: 'running', attempts: task.attempts, updatedAt: task.updated_at };
    }
    return { ok: false, status: 409, error: `Task is '${task.status}' — only queued tasks can run.` };
  }

  // Manual task runs must not bypass protection: a modifying task
  // (seo repair / correction) for a protected article is refused here,
  // before any status change or execution.
  const protection = await assertTaskNotProtected(env, task);
  if (!protection.ok) {
    return { ok: false, status: 403, error: protection.reason, protected: true };
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
  let result = null;
  let outcome = 'failed';
  let runId = null;
  let finishedAt = null;
  let requeued = false;
  let backoffUntil = null;
  let cancelledDuringRun = false;
  try {
    result = await runWithLease(runAutonomyTask(task, env), leaseMs);
    outcome = result && (result.outcome === 'done' || result.outcome === 'no-op') ? result.outcome : 'failed';
  } catch (err) {
    result = { outcome: 'failed', error: String(err && err.message ? err.message : err).slice(0, 300) };
    outcome = 'failed';
  } finally {
    // The status is resolved here, ALWAYS — even when the run-row
    // insert below throws. A run ends done/failed (or re-queued), never
    // stuck 'running'. The status writes are conditional on
    // still-'running': a concurrent owner cancel wins over a late
    // completion, so a cancelled task is never resurrected.
    finishedAt = nowIso();
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
    const resolveStatus = async () => {
      if (outcome === 'failed' && attempts < (task.max_attempts || 3)) {
        backoffUntil = plusMinutes(finishedAt, attempts * 15);
        const r = await d1Run(env,
          "UPDATE agent_tasks SET status = 'queued', scheduled_for = ?, updated_at = ? WHERE id = ? AND status = 'running'",
          [backoffUntil, nowIso(), id]);
        if (r && r.meta && r.meta.changes === 0) { cancelledDuringRun = true; return; }
        requeued = true;
        return;
      }
      const finalStatus = outcome === 'failed' ? 'failed' : 'done';
      const r = await d1Run(env,
        "UPDATE agent_tasks SET status = ?, updated_at = ? WHERE id = ? AND status = 'running'",
        [finalStatus, nowIso(), id]);
      if (r && r.meta && r.meta.changes === 0) { cancelledDuringRun = true; }
    };
    try {
      await resolveStatus();
    } catch {
      // One retry: the run row still records the outcome even if the
      // status write keeps failing.
      try { await resolveStatus(); } catch { /* status stays as claimed; the sweeper recovers it */ }
    }
  }
  return {
    ok: true, taskId: id, runId, outcome, attempts, requeued,
    ...(requeued && backoffUntil ? { scheduled_for: backoffUntil } : {}),
    ...(cancelledDuringRun ? { cancelledDuringRun: true } : {}),
    result,
  };
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
  // A failed modifying task for a protected article must not re-queue.
  const protection = await assertTaskNotProtected(env, task);
  if (!protection.ok) {
    return { ok: false, status: 403, error: protection.reason, protected: true };
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
  // Phase 4: recover any task orphaned in 'running' by a stalled run
  // before starting new work — best effort, never blocks the workflow.
  try { await recoverStaleTasks(env); } catch { /* recovery is best-effort */ }
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
    // Protected test articles #26/#27 are never auto-corrected (owner order).
    const guard = protectedExclusion('fc.article_id');
    const rows = await d1All(env,
      'SELECT DISTINCT fc.article_id AS id FROM fact_checks fc ' +
      "WHERE fc.verdict IN ('needs-review', 'failed') AND fc.created_at >= datetime('now', '-7 days') AND " + guard.clause + ' ' +
      "AND EXISTS (SELECT 1 FROM articles a WHERE a.id = fc.article_id AND a.status IN ('draft', 'pending_approval')) " +
      'ORDER BY fc.created_at DESC LIMIT 3', guard.params) || [];
    const results = [];
    for (const r of rows) {
      const res = await runFactChecking({ agent: 'fact-checking', kind: 'correct', payload: { article_id: r.id } }, env);
      results.push({ articleId: r.id, outcome: res.outcome, corrected: res.corrected ?? 0, removed: res.removed ?? 0 });
    }
    return { outcome: 'done', corrected: results.length, results };
  });

  steps.seoRun = await step(env, 'seo', 'seo-run', async () => {
    // Protected test articles #26/#27 are never auto-repaired (owner order).
    const guard = protectedExclusion('id');
    const rows = await d1All(env, "SELECT id FROM articles WHERE status IN ('draft', 'pending_approval') AND " + guard.clause + ' ORDER BY updated_at ASC LIMIT 3', guard.params) || [];
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
  // Phase 4: recover any task orphaned in 'running' by a stalled run
  // before starting new work — best effort, never blocks the workflow.
  try { await recoverStaleTasks(env); } catch { /* recovery is best-effort */ }
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
