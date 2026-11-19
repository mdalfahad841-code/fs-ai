/**
 * FS AI — Owner admin routes (worker.js enforces requireOwner).
 *
 *   GET  /api/admin/emergency-stop    { stopped: boolean }
 *   POST /api/admin/emergency-stop    { stopped: boolean } — stored in
 *         website_settings as key 'emergency_stop', value '1'/'0'.
 *         website_settings already has the generic key/value shape
 *         (setting_key UNIQUE, setting_value TEXT), so no new table.
 *   GET  /api/admin/backup            JSON dump of the CMS/agent data.
 *
 * The Emergency Stop halts autonomous agent runs (POST /api/agents/:id/run
 * answers 423 while it is on) and the scheduled-publish check. It never
 * blocks the owner reading data or managing content directly.
 */
import {
  jsonOk, jsonError, readJsonBody, nowIso, d1All, d1First, d1Run,
} from '../middleware/validation.js';

export const EMERGENCY_STOP_KEY = 'emergency_stop';

export async function getEmergencyStop(env) {
  if (!env || !env.DB) return false;
  try {
    const row = await d1First(env,
      'SELECT setting_value FROM website_settings WHERE setting_key = ? LIMIT 1', [EMERGENCY_STOP_KEY]);
    return !!row && row.setting_value === '1';
  } catch {
    return false;
  }
}

export async function setEmergencyStop(env, stopped) {
  await d1Run(env,
    "INSERT INTO website_settings (setting_key, setting_value, description, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')",
    [EMERGENCY_STOP_KEY, stopped ? '1' : '0', 'Emergency stop for autonomous agent operations.', nowIso()]);
  return stopped;
}

async function handleEmergencyStop(request, env) {
  const method = request.method.toUpperCase();
  if (method === 'GET') {
    if (!env.DB) return jsonError('Emergency Stop state requires the D1 database', 503);
    return jsonOk({ stopped: await getEmergencyStop(env), source: 'd1' });
  }
  if (method === 'POST') {
    if (!env.DB) return jsonError('Emergency Stop requires the D1 database', 503);
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError('Invalid JSON body.', 400);
    }
    if (typeof body?.stopped !== 'boolean') return jsonError('stopped must be a boolean.', 400);
    const stopped = await setEmergencyStop(env, body.stopped);
    return jsonOk({ stopped, source: 'd1' });
  }
  return jsonError('Method not allowed', 405);
}

// Tables in the backup export, with per-table row caps. Agent logs and
// automation jobs are capped at 500 rows; everything else at 1000.
const BACKUP_TABLES = [
  { name: 'articles', limit: 1000 },
  { name: 'article_revisions', limit: 1000 },
  { name: 'article_sources', limit: 1000 },
  { name: 'business_divisions', limit: 1000 },
  { name: 'categories', limit: 1000 },
  { name: 'article_tags', limit: 1000 },
  { name: 'newsletter_subscribers', limit: 1000 },
  { name: 'ai_agents', limit: 1000 },
  { name: 'agent_activity_logs', limit: 500 },
  { name: 'agent_tasks', limit: 1000 },
  { name: 'agent_runs', limit: 1000 },
  { name: 'agent_logs', limit: 500 },
  { name: 'daily_reports', limit: 1000 },
  { name: 'automation_jobs', limit: 500 },
  { name: 'autonomy_settings', limit: 1000 },
  { name: 'llm_usage', limit: 1000 },
  { name: 'research_sources', limit: 1000 },
  { name: 'research_items', limit: 1000 },
  { name: 'fact_checks', limit: 1000 },
  { name: 'claim_checks', limit: 1000 },
  { name: 'article_corrections', limit: 1000 },
  { name: 'seo_checks', limit: 1000 },
  { name: 'backup_runs', limit: 1000 },
  { name: 'revenue_records', limit: 1000 },
  { name: 'website_settings', limit: 1000 },
];

async function exportTables(env) {
  const tables = {};
  const counts = {};
  const warnings = [];
  for (const { name, limit } of BACKUP_TABLES) {
    try {
      // ORDER BY rowid, not id: autonomy_settings has no id column
      // (its primary key is `key`).
      const rows = await d1All(env, `SELECT * FROM ${name} ORDER BY rowid DESC LIMIT ?`, [limit]);
      tables[name] = rows || [];
      counts[name] = (rows || []).length;
    } catch (err) {
      tables[name] = [];
      counts[name] = 0;
      warnings.push(`Table ${name} could not be read: ${String(err && err.message ? err.message : err).slice(0, 120)}`);
    }
  }
  return { tables, counts, warnings };
}

/**
 * Run a backup export and record it in backup_runs (migration 011), so
 * the dashboard can show the last successful backup instead of
 * 'unknown'. Returns a summary (not the full dump). When the backup_runs
 * table does not exist yet (migration 011 not applied), the export still
 * succeeds and backupRunId is null — the missing table is reported in
 * `warnings`, never hidden.
 */
export async function runBackupExport(env) {
  const startedAt = nowIso();
  let runId = null;
  try {
    const inserted = await d1Run(env, "INSERT INTO backup_runs (started_at, status) VALUES (?, 'running')", [startedAt]);
    runId = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  } catch {
    runId = null;
  }
  const { tables, counts, warnings } = await exportTables(env);
  const rowsExported = Object.values(counts).reduce((a, n) => a + n, 0);
  const payload = { exported_at: startedAt, tables, counts, warnings, note: 'JSON export, not a D1-native backup. Restore is manual — see docs/BACKUP-RECOVERY.md.' };
  const bytesExported = new TextEncoder().encode(JSON.stringify(payload)).length;
  const finishedAt = nowIso();
  const failed = warnings.length > 0 && rowsExported === 0;
  const status = failed ? 'failed' : 'success';
  if (runId) {
    await d1Run(env,
      'UPDATE backup_runs SET finished_at = ?, status = ?, tables_exported = ?, rows_exported = ?, bytes_exported = ?, error = ? WHERE id = ?',
      [finishedAt, status, Object.keys(tables).length, rowsExported, bytesExported, failed ? warnings.join('; ') : null, runId]).catch(() => {});
  } else {
    warnings.push('backup_runs table is missing (migration 011 not applied) — this run was not recorded.');
  }
  return {
    ok: !failed, exportedAt: startedAt, finishedAt, status,
    tablesExported: Object.keys(tables).length, rowsExported, bytesExported,
    warnings, backupRunId: runId, error: failed ? warnings.join('; ') : null,
  };
}

async function handleBackup(request, env) {
  if (request.method.toUpperCase() !== 'GET') return jsonError('Method not allowed', 405);
  if (!env.DB) return jsonError('Backup export requires the D1 database', 503);
  const { tables, counts, warnings } = await exportTables(env);
  return jsonOk({
    exported_at: nowIso(),
    tables,
    counts,
    warnings,
    note: 'JSON export, not a D1-native backup. Restore is manual — see docs/BACKUP-RECOVERY.md.',
  });
}

async function handleBackupRun(request, env) {
  if (request.method.toUpperCase() !== 'POST') return jsonError('Method not allowed', 405);
  if (!env.DB) return jsonError('Backup export requires the D1 database', 503);
  const result = await runBackupExport(env);
  return jsonOk({ ...result, source: 'd1' }, result.ok ? 200 : 500);
}

export async function handleAdmin(request, env, ctx, auth) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/admin/emergency-stop') return handleEmergencyStop(request, env);
  if (path === '/api/admin/backup') return handleBackup(request, env);
  if (path === '/api/admin/backup/run') return handleBackupRun(request, env);
  return jsonError('Not found', 404, { path });
}
