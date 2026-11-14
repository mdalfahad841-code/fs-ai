/**
 * FS AI — Autonomy: security-monitoring agent handler.
 *
 * Real checks only, and only booleans/counts — secret values are never
 * read or returned. No backup timestamp is stored anywhere, so the last
 * backup is honestly reported as unknown.
 */
import { d1All, d1First } from '../../middleware/validation.js';

export async function runSecurityMonitoring(task, env) {
  const checks = [];
  const dbBound = !!(env && env.DB);
  checks.push({ name: 'd1-bound', ok: dbBound, detail: dbBound ? 'D1 database is bound.' : 'D1 database is not bound.' });
  checks.push({
    name: 'owner-password-hash-set', ok: !!(env && env.OWNER_PASSWORD_HASH),
    detail: env && env.OWNER_PASSWORD_HASH ? 'OWNER_PASSWORD_HASH is configured.' : 'OWNER_PASSWORD_HASH is not set.',
  });
  checks.push({
    name: 'session-secret-set', ok: !!(env && env.SESSION_SECRET),
    detail: env && env.SESSION_SECRET ? 'SESSION_SECRET is configured.' : 'SESSION_SECRET is not set.',
  });

  let recentEvents = null;
  try {
    const row = await d1First(env,
      "SELECT COUNT(*) AS n FROM security_events WHERE created_at >= datetime('now', '-7 days')");
    recentEvents = Number(row ? row.n : 0);
    checks.push({ name: 'security-events-7d', ok: true, detail: `${recentEvents} security event(s) in the last 7 days.`, count: recentEvents });
  } catch (err) {
    checks.push({ name: 'security-events-7d', ok: false, detail: `Could not read security_events: ${String(err && err.message ? err.message : err).slice(0, 120)}`, count: null });
  }

  try {
    const rows = await d1All(env, 'SELECT key FROM rate_limits LIMIT 1');
    checks.push({ name: 'rate-limits-table', ok: true, detail: `rate_limits table is present (${(rows || []).length} row(s) sampled).` });
  } catch (err) {
    checks.push({ name: 'rate-limits-table', ok: false, detail: `rate_limits table could not be read: ${String(err && err.message ? err.message : err).slice(0, 120)}` });
  }

  checks.push({
    name: 'last-backup', ok: false,
    detail: 'unknown — download a backup from the Backup section (no backup timestamp is stored anywhere).',
    lastBackup: 'unknown',
  });

  const failed = checks.filter((c) => !c.ok && c.name !== 'last-backup');
  return {
    outcome: failed.length ? 'done' : 'done',
    checks,
    securityEventsLast7Days: recentEvents,
    lastBackup: 'unknown — download a backup from the Backup section',
    note: failed.length
      ? `${failed.length} check(s) failed: ${failed.map((c) => c.name).join(', ')}.`
      : 'All configuration checks passed. Last backup is unknown (no timestamp stored).',
  };
}
