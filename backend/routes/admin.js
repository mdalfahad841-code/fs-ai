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
  { name: 'business_divisions', limit: 1000 },
  { name: 'categories', limit: 1000 },
  { name: 'article_tags', limit: 1000 },
  { name: 'newsletter_subscribers', limit: 1000 },
  { name: 'ai_agents', limit: 1000 },
  { name: 'agent_activity_logs', limit: 500 },
  { name: 'automation_jobs', limit: 500 },
  { name: 'revenue_records', limit: 1000 },
  { name: 'website_settings', limit: 1000 },
];

async function handleBackup(request, env) {
  if (request.method.toUpperCase() !== 'GET') return jsonError('Method not allowed', 405);
  if (!env.DB) return jsonError('Backup export requires the D1 database', 503);
  const tables = {};
  const counts = {};
  const warnings = [];
  for (const { name, limit } of BACKUP_TABLES) {
    try {
      const rows = await d1All(env, `SELECT * FROM ${name} ORDER BY id DESC LIMIT ?`, [limit]);
      tables[name] = rows || [];
      counts[name] = (rows || []).length;
    } catch (err) {
      tables[name] = [];
      counts[name] = 0;
      warnings.push(`Table ${name} could not be read: ${String(err && err.message ? err.message : err).slice(0, 120)}`);
    }
  }
  return jsonOk({
    exported_at: nowIso(),
    tables,
    counts,
    warnings,
    note: 'JSON export, not a D1-native backup. Restore is manual — see docs/BACKUP-RECOVERY.md.',
  });
}

export async function handleAdmin(request, env, ctx, auth) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/admin/emergency-stop') return handleEmergencyStop(request, env);
  if (path === '/api/admin/backup') return handleBackup(request, env);
  return jsonError('Not found', 404, { path });
}
