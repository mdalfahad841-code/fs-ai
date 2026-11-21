/**
 * FS AI — System health endpoint (W5 Control Center).
 *
 * GET /api/health/latest — reads the LATEST stored rows from the
 * system_health_checks table (written by W1's healthcheck service).
 *
 * Contract (from W1): system_health_checks columns are
 * id, checked_at, component, status, detail_json.
 *
 * If the table does not exist yet (W1 not merged), the endpoint answers
 * { overall: 'unknown', checks: [], note: 'health service not yet
 * deployed' } — it never crashes and never invents a health state.
 * A check older than 25 hours is labelled stale. Overall is 'ok' only
 * when every latest check passes; any 'fail'/'error' makes it
 * 'failing', any 'warn'/'degraded' makes it 'degraded'.
 *
 * This file only EXPORTS the handler. Route registration lives with the
 * coordinator (backend/worker.js) — see the W5 report for the snippet.
 * Do NOT register routes here.
 */
import { jsonOk, jsonError, d1All } from '../middleware/validation.js';

export const HEALTH_STALE_AFTER_MS = 25 * 60 * 60 * 1000; // 25 hours

export const HEALTH_UNKNOWN = {
  overall: 'unknown',
  checks: [],
  note: 'health service not yet deployed',
};

/** Overall state from a list of latest-per-component checks. */
export function deriveOverall(checks) {
  if (!checks || !checks.length) return 'unknown';
  const statuses = checks.map((c) => String(c.status || '').toLowerCase());
  if (statuses.some((s) => ['fail', 'failed', 'error', 'failing'].includes(s))) return 'failing';
  if (statuses.some((s) => ['warn', 'warning', 'degraded'].includes(s))) return 'degraded';
  if (statuses.every((s) => ['ok', 'pass', 'passed', 'healthy'].includes(s))) return 'ok';
  return 'unknown';
}

function safeJson(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return null; }
}

export async function handleHealthLatest(request, env) {
  if (request.method.toUpperCase() !== 'GET') return jsonError('Method not allowed', 405);
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  if (!env.DB) {
    return jsonOk({ ...HEALTH_UNKNOWN, asOf: now, note: 'health service not yet deployed — no database bound' });
  }
  let rows;
  try {
    rows = await d1All(env,
      'SELECT component, status, detail_json, checked_at FROM system_health_checks ORDER BY checked_at DESC LIMIT 100');
  } catch (err) {
    // Missing table (W1 not merged yet) or any other read failure:
    // unknown, never a crash, never an invented state. The note keeps
    // the root cause so the dashboard can show it.
    const msg = String((err && err.message) || err || '');
    const notDeployed = /no such table/i.test(msg);
    return jsonOk({
      overall: 'unknown',
      checks: [],
      asOf: now,
      note: notDeployed
        ? 'health service not yet deployed'
        : 'health check read failed: ' + msg.slice(0, 200),
    });
  }
  // Latest row per component (rows arrive newest-first).
  const latestByComponent = new Map();
  for (const r of rows || []) {
    if (!latestByComponent.has(r.component)) latestByComponent.set(r.component, r);
  }
  const checks = [...latestByComponent.values()].map((r) => {
    const checkedMs = Date.parse(r.checked_at);
    const stale = !Number.isFinite(checkedMs) || (nowMs - checkedMs > HEALTH_STALE_AFTER_MS);
    return {
      component: r.component,
      status: r.status,
      detail: safeJson(r.detail_json),
      checkedAt: r.checked_at,
      stale,
      staleNote: stale ? 'Check is older than 25 hours — treat as stale.' : null,
    };
  });
  const overall = deriveOverall(checks);
  const asOf = checks.length
    ? checks.map((c) => c.checkedAt).sort().reverse()[0]
    : now;
  return jsonOk({
    overall,
    checks,
    asOf,
    freshness: {
      asOf,
      checkedAt: now,
      stale: checks.some((c) => c.stale),
      note: checks.some((c) => c.stale)
        ? 'One or more health checks are older than 25 hours — labelled stale.'
        : 'Health checks are current.',
    },
    note: overall === 'unknown'
      ? 'No health checks recorded yet.'
      : 'Latest stored health checks (W1 health service).',
  });
}
