/**
 * FS AI — Daily self-health check service (workstream W1, 2026-11-21).
 *
 * runHealthCheck(env) checks, before major workflows, the pieces a
 * queue drain depends on. It is deliberately dependency-free and
 * unit-testable: pure helpers + injected env/db, no imports from the
 * scheduler (no import cycle), no LLM calls, no paid calls, no writes
 * except persisting its own rows to system_health_checks (migration
 * 020). When that table does not exist yet (pre-020 database) the
 * persistence step is skipped and the check still returns its result
 * (persisted: false) — the check never blocks on its own storage.
 *
 * Checks (each returns { component, status, detail, checkedAt }):
 *   worker         — the Worker is executing (always healthy when reached).
 *   database       — D1 answers SELECT 1. Blocked when unreachable.
 *   emergency-stop — website_settings emergency_stop flag. Blocked when ON.
 *   queue          — queued / running / stale-running counts, plus
 *                    backlog depth and oldest-queued age. Degraded
 *                    when any 'running' task is older than the run
 *                    lease, when queued tasks exceed one drain run
 *                    (QUEUE_BACKLOG_DEGRADED_COUNT), or when the
 *                    oldest queued task has waited longer than
 *                    QUEUE_OLDEST_QUEUED_DEGRADED_MS — the 12-task
 *                    backlog sat 6 days with a 'healthy' queue check
 *                    before this (WS-B, 2026-11-21).
 *   workers-ai     — NO probe call (a probe would cost Neurons). Reads
 *                    llm_usage recency + the autonomy_settings provider
 *                    order instead. Degraded when today's Neurons reach
 *                    80% of the daily cap.
 *   accounts       — read-only monetization_accounts status flags.
 *   publishing     — autonomy_settings publishing_mode / auto_* flags.
 *   social         — social_accounts / social_posts row counts when
 *                    migration 022 is applied; 'not-configured' when
 *                    those tables are absent (no social API auth
 *                    exists yet — packs are prepared only).
 *   free-tier      — llm_usage Neurons today vs the llm_daily_cap_neurons
 *                    setting (default 9000). Degraded at >= 80% of cap,
 *                    and at cap (never blocked — the drain may still run
 *                    non-LLM tasks; the per-task handlers fail honestly).
 *   backup         — latest backup_runs row. Degraded when missing, older
 *                    than 7 days, or failed.
 *
 * Overall: 'blocked' when any check is blocked, else 'degraded' when
 * any check is degraded, else 'healthy'. 'not-configured' checks never
 * change the overall. The queue drain refuses to start when overall
 * is 'blocked' (E-Stop ON, DB unreachable).
 */
import { d1All, d1First, d1Run, nowIso } from '../middleware/validation.js';

/** Daily free-tier Neuron cap when autonomy_settings has no value. */
export const LLM_DAILY_CAP_DEFAULT = 9000;

/** Fraction of the Neuron cap at which usage becomes 'degraded'. */
export const LLM_CAP_DEGRADED_FRACTION = 0.8;

/** A backup older than this is stale. */
export const BACKUP_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** A queue deeper than one drain run (MAX_DRAIN_TASKS_PER_RUN) is a backlog, not a healthy queue. */
export const QUEUE_BACKLOG_DEGRADED_COUNT = 10;

/** A task waiting queued longer than this has not been drained in a full day. */
export const QUEUE_OLDEST_QUEUED_DEGRADED_MS = 24 * 60 * 60 * 1000;

/**
 * Run-lease mirror: a 'running' task older than this is stale. Kept as
 * a local constant (same value as TASK_RUN_LEASE_MS in
 * backend/routes/scheduler.js) so this module stays import-cycle-free.
 */
export const HEALTHCHECK_STALE_LEASE_MS = 10 * 60 * 1000;

export const HEALTH_COMPONENTS = [
  'worker', 'database', 'emergency-stop', 'queue', 'workers-ai',
  'accounts', 'publishing', 'social', 'free-tier', 'backup',
];

export const HEALTH_STATUSES = ['healthy', 'degraded', 'blocked', 'not-configured'];

/** Parse a D1/SQLite timestamp to epoch ms (ISO or space format, UTC). Null when unparseable — never throws. */
export function parseHealthTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim();
  if (text.includes(' ')) text = text.replace(' ', 'T');
  if (!/[zZ]$/.test(text) && !/[+-]\d{2}:?\d{2}$/.test(text)) text += 'Z';
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** Overall status from per-check statuses: blocked wins, then degraded. 'not-configured' never affects the overall. */
export function classifyHealthOverall(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.some((c) => c && c.status === 'blocked')) return 'blocked';
  if (list.some((c) => c && c.status === 'degraded')) return 'degraded';
  return 'healthy';
}

function checkResult(component, status, detail, checkedAt) {
  return { component, status, detail: detail || {}, checkedAt };
}

async function safeFirst(env, sql, params = []) {
  try {
    return await d1First(env, sql, params);
  } catch {
    return null;
  }
}

async function safeAll(env, sql, params = []) {
  try {
    return await d1All(env, sql, params);
  } catch {
    return null;
  }
}

/** True when the error means "table/column does not exist" (pre-migration DB) — any other error is real. */
function isMissingTableError(err) {
  const text = String((err && err.message) || err || '');
  return /no such table/i.test(text) || /no such column/i.test(text) || /has no column named/i.test(text);
}

async function autonomySettingValue(env, key, fallback = null) {
  const row = await safeFirst(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [key]);
  return row && typeof row.value === 'string' ? row.value : fallback;
}

async function workerCheck(checkedAt) {
  return checkResult('worker', 'healthy', { note: 'Worker process executing this check; the check itself makes no paid or LLM calls.' }, checkedAt);
}

async function databaseCheck(env, checkedAt) {
  try {
    const row = await d1First(env, 'SELECT 1 AS ok');
    if (row && Number(row.ok) === 1) return checkResult('database', 'healthy', { probe: 'SELECT 1' }, checkedAt);
    return checkResult('database', 'blocked', { probe: 'SELECT 1', error: 'Unexpected probe result.' }, checkedAt);
  } catch (err) {
    return checkResult('database', 'blocked', { probe: 'SELECT 1', error: String((err && err.message) || err).slice(0, 200) }, checkedAt);
  }
}

async function emergencyStopCheck(env, checkedAt) {
  const row = await safeFirst(env, 'SELECT setting_value FROM website_settings WHERE setting_key = ? LIMIT 1', ['emergency_stop']);
  const stopped = !!row && row.setting_value === '1';
  if (stopped) {
    return checkResult('emergency-stop', 'blocked', { stopped: true, reason: 'Emergency Stop is ON — autonomous work is halted.' }, checkedAt);
  }
  return checkResult('emergency-stop', 'healthy', { stopped: false }, checkedAt);
}

async function queueCheck(env, checkedAt, nowMs) {
  const rows = await safeAll(env, "SELECT status, updated_at, created_at FROM agent_tasks WHERE status IN ('queued', 'running')");
  if (rows === null) {
    return checkResult('queue', 'not-configured', { reason: 'agent_tasks table is not readable (migrations not applied).' }, checkedAt);
  }
  let queued = 0;
  let running = 0;
  let stale = 0;
  let oldestQueuedAt = null;
  let oldestQueuedMs = null;
  for (const row of rows) {
    if (row.status === 'queued') {
      queued += 1;
      const created = parseHealthTime(row.created_at);
      if (created !== null && (oldestQueuedMs === null || created < oldestQueuedMs)) {
        oldestQueuedMs = created;
        oldestQueuedAt = row.created_at;
      }
    }
    if (row.status === 'running') {
      running += 1;
      const started = parseHealthTime(row.updated_at);
      if (started !== null && nowMs - started > HEALTHCHECK_STALE_LEASE_MS) stale += 1;
    }
  }
  const oldestQueuedAgeMs = oldestQueuedMs === null ? null : Math.max(0, nowMs - oldestQueuedMs);
  const detail = { queued, running, stale, oldestQueuedAt, oldestQueuedAgeMs, leaseMs: HEALTHCHECK_STALE_LEASE_MS };
  if (stale > 0) {
    return checkResult('queue', 'degraded', { ...detail, reason: `${stale} running task(s) are stale (older than the ${HEALTHCHECK_STALE_LEASE_MS / 60000}-minute lease).` }, checkedAt);
  }
  // Backlog alert (WS-B, 2026-11-21): a queue deeper than one drain
  // run, or an oldest queued task older than a day, is degraded even
  // with no stale running task — before this the 12-task backlog
  // (oldest 6 days) reported 'healthy'. Degraded never blocks the
  // drain; it surfaces the backlog in the daily report + dashboard.
  if (queued >= QUEUE_BACKLOG_DEGRADED_COUNT) {
    return checkResult('queue', 'degraded', { ...detail, reason: `${queued} task(s) queued — more than one drain run (${QUEUE_BACKLOG_DEGRADED_COUNT}) can clear, so the backlog spans multiple runs.` }, checkedAt);
  }
  if (oldestQueuedAgeMs !== null && oldestQueuedAgeMs > QUEUE_OLDEST_QUEUED_DEGRADED_MS) {
    return checkResult('queue', 'degraded', { ...detail, reason: `Oldest queued task has waited ${Math.round(oldestQueuedAgeMs / 3600000)}h (over ${QUEUE_OLDEST_QUEUED_DEGRADED_MS / 3600000}h) — the queue is not draining.` }, checkedAt);
  }
  return checkResult('queue', 'healthy', detail, checkedAt);
}

/**
 * Workers AI availability WITHOUT a probe call: today's Neuron usage +
 * the configured provider order. A live probe would spend Neurons, so
 * recency of llm_usage is the signal instead.
 */
async function workersAiCheck(env, checkedAt) {
  const providerOrder = await autonomySettingValue(env, 'llm_provider_order', null);
  const usageRow = await safeFirst(env,
    "SELECT COALESCE(SUM(neurons), 0) AS neurons, MAX(created_at) AS last_used FROM llm_usage WHERE provider = 'workers-ai' AND date(created_at) = date('now')");
  if (usageRow === null && providerOrder === null) {
    return checkResult('workers-ai', 'not-configured', { reason: 'llm_usage / autonomy_settings are not readable (migrations not applied).' }, checkedAt);
  }
  const capRaw = await autonomySettingValue(env, 'llm_daily_cap_neurons', String(LLM_DAILY_CAP_DEFAULT));
  const cap = Number.parseInt(capRaw, 10);
  const capValue = Number.isFinite(cap) && cap > 0 ? cap : LLM_DAILY_CAP_DEFAULT;
  const neuronsToday = Number((usageRow && usageRow.neurons) || 0);
  const lastUsed = (usageRow && usageRow.last_used) || null;
  const detail = { providerOrder, neuronsToday, cap: capValue, lastUsedAt: lastUsed };
  if (neuronsToday >= capValue * LLM_CAP_DEGRADED_FRACTION) {
    return checkResult('workers-ai', 'degraded', { ...detail, reason: `Workers AI used ${neuronsToday}/${capValue} Neurons today (>= ${LLM_CAP_DEGRADED_FRACTION * 100}% of the daily cap).` }, checkedAt);
  }
  return checkResult('workers-ai', 'healthy', detail, checkedAt);
}

async function accountsCheck(env, checkedAt) {
  const rows = await safeAll(env, 'SELECT platform, status FROM monetization_accounts ORDER BY platform ASC');
  if (rows === null) {
    return checkResult('accounts', 'not-configured', { reason: 'monetization_accounts table is not readable (migrations not applied).' }, checkedAt);
  }
  return checkResult('accounts', 'healthy', {
    note: 'Read-only status flags; this check changes nothing.',
    accounts: rows.map((r) => ({ platform: r.platform, status: r.status })),
  }, checkedAt);
}

async function publishingCheck(env, checkedAt) {
  const mode = await autonomySettingValue(env, 'publishing_mode', null);
  const autoPublishing = await autonomySettingValue(env, 'auto_publishing', 'off');
  if (mode === null) {
    return checkResult('publishing', 'degraded', { reason: 'publishing_mode setting is missing — publishing eligibility cannot be determined.' }, checkedAt);
  }
  return checkResult('publishing', 'healthy', {
    publishingMode: mode, autoPublishing,
    note: mode === 'approved_only'
      ? 'approved_only — gate-passed articles wait for owner approval; nothing auto-publishes.'
      : `publishing_mode is '${mode}'.`,
  }, checkedAt);
}

async function socialCheck(env, checkedAt) {
  // Migration 022 creates social_accounts / social_posts; before it
  // is applied both queries fail and the check reports not-configured
  // (packs are prepared only — no social API auth exists yet).
  const accounts = await safeAll(env, 'SELECT COUNT(*) AS n FROM social_accounts');
  const posts = await safeAll(env, 'SELECT COUNT(*) AS n FROM social_posts');
  if (accounts === null && posts === null) {
    return checkResult('social', 'not-configured', { reason: 'No social integration tables present — social posting is not configured; packs are prepared only.' }, checkedAt);
  }
  return checkResult('social', 'healthy', {
    accounts: accounts ? Number(accounts[0] && accounts[0].n || 0) : 0,
    posts: posts ? Number(posts[0] && posts[0].n || 0) : 0,
  }, checkedAt);
}

async function freeTierCheck(env, checkedAt) {
  const capRaw = await autonomySettingValue(env, 'llm_daily_cap_neurons', String(LLM_DAILY_CAP_DEFAULT));
  const cap = Number.parseInt(capRaw, 10);
  const capValue = Number.isFinite(cap) && cap > 0 ? cap : LLM_DAILY_CAP_DEFAULT;
  const row = await safeFirst(env,
    "SELECT COALESCE(SUM(neurons), 0) AS neurons FROM llm_usage WHERE date(created_at) = date('now')");
  if (row === null) {
    return checkResult('free-tier', 'not-configured', { reason: 'llm_usage table is not readable (migrations not applied).' }, checkedAt);
  }
  const neuronsToday = Number(row.neurons || 0);
  const remaining = Math.max(0, capValue - neuronsToday);
  const detail = { neuronsToday, cap: capValue, remaining, percentUsed: capValue > 0 ? Math.round((neuronsToday / capValue) * 100) : 0 };
  if (neuronsToday >= capValue) {
    return checkResult('free-tier', 'degraded', { ...detail, reason: `Daily free-tier Neuron cap reached (${neuronsToday}/${capValue}) — LLM-backed tasks will fail until tomorrow.` }, checkedAt);
  }
  if (neuronsToday >= capValue * LLM_CAP_DEGRADED_FRACTION) {
    return checkResult('free-tier', 'degraded', { ...detail, reason: `Daily free-tier Neuron usage is at ${detail.percentUsed}% of the ${capValue} cap.` }, checkedAt);
  }
  return checkResult('free-tier', 'healthy', detail, checkedAt);
}

async function backupCheck(env, checkedAt, nowMs) {
  let row = null;
  try {
    row = await d1First(env, 'SELECT * FROM backup_runs ORDER BY created_at DESC, id DESC LIMIT 1');
  } catch (err) {
    if (isMissingTableError(err)) {
      return checkResult('backup', 'not-configured', { reason: 'backup_runs table is not present (migration 011 not applied).' }, checkedAt);
    }
    return checkResult('backup', 'degraded', { error: String((err && err.message) || err).slice(0, 200) }, checkedAt);
  }
  if (!row) {
    return checkResult('backup', 'degraded', { reason: 'No backup run has ever been recorded.' }, checkedAt);
  }
  const finishedMs = parseHealthTime(row.finished_at || row.created_at);
  const detail = { latestId: row.id, status: row.status, finishedAt: row.finished_at || row.created_at, tablesExported: row.tables_exported, rowsExported: row.rows_exported, bytesExported: row.bytes_exported };
  if (row.status !== 'success') {
    return checkResult('backup', 'degraded', { ...detail, reason: `Latest backup run (#${row.id}) finished with status '${row.status}'.` }, checkedAt);
  }
  if (finishedMs !== null && nowMs - finishedMs > BACKUP_STALE_MS) {
    return checkResult('backup', 'degraded', { ...detail, reason: 'Latest successful backup is more than 7 days old.' }, checkedAt);
  }
  return checkResult('backup', 'healthy', detail, checkedAt);
}

/**
 * Run the full self-health check. Never throws for a missing table or
 * a single bad check — a failing check degrades the result instead.
 * Persists one system_health_checks row per component when the table
 * exists (migration 020); persisted:false on a pre-020 database.
 * Returns { overall, checkedAt, checks, persisted }.
 */
export async function runHealthCheck(env, { nowMs = Date.now() } = {}) {
  const checkedAt = nowIso();
  if (!env || !env.DB) {
    const checks = [checkResult('database', 'blocked', { error: 'D1 database is not bound.' }, checkedAt)];
    return { overall: 'blocked', checkedAt, checks, persisted: false };
  }
  const checks = [
    await workerCheck(checkedAt),
    await databaseCheck(env, checkedAt),
    await emergencyStopCheck(env, checkedAt),
    await queueCheck(env, checkedAt, nowMs),
    await workersAiCheck(env, checkedAt),
    await accountsCheck(env, checkedAt),
    await publishingCheck(env, checkedAt),
    await socialCheck(env, checkedAt),
    await freeTierCheck(env, checkedAt),
    await backupCheck(env, checkedAt, nowMs),
  ];
  const overall = classifyHealthOverall(checks);
  let persisted = false;
  try {
    for (const c of checks) {
      await d1Run(env,
        'INSERT INTO system_health_checks (checked_at, component, status, detail_json) VALUES (?, ?, ?, ?)',
        [checkedAt, c.component, c.status, JSON.stringify(c.detail || {})]);
    }
    persisted = true;
  } catch {
    // Pre-020 database (no system_health_checks table): the check
    // result is still returned; persistence is best-effort only.
    persisted = false;
  }
  return { overall, checkedAt, checks, persisted };
}

/** Latest persisted health rows (newest first) — the dashboard GET endpoint should read these. */
export async function latestHealthChecks(env, limit = 20) {
  const n = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 20;
  try {
    const rows = await d1All(env,
      'SELECT id, checked_at, component, status, detail_json FROM system_health_checks ORDER BY checked_at DESC, id DESC LIMIT ?', [n]);
    return rows || [];
  } catch {
    return [];
  }
}
