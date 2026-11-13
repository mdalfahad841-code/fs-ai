/**
 * FS AI — Security & Monitoring agent module.
 * Audit logging and error detection with real data only. No fake alerts:
 * an event is logged only when it actually happened, and severity is
 * derived from the event itself, never invented.
 */
export const auditLog = [];

export function auditEvent(action, detail, actor = 'system', meta = {}) {
  const entry = {
    at: new Date().toISOString(),
    actor: String(actor).slice(0, 100),
    action: String(action).slice(0, 100),
    detail: String(detail).slice(0, 500),
    ...meta,
  };
  auditLog.unshift(entry);
  if (auditLog.length > 1000) auditLog.length = 1000;
  return entry;
}

export async function auditEventToD1(env, entry) {
  if (!env || !env.DB) return false;
  try {
    // Real audit table is agent_activity_logs (schema.sql §13) — the old
    // `activity_log` table never existed, so this insert used to fail
    // silently on every call.
    await env.DB.prepare(
      'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(null, entry.action, 'security', JSON.stringify({ actor: entry.actor, detail: entry.detail }), 'success', entry.at).run();
    return true;
  } catch {
    return false;
  }
}

export function detectErrors(entries) {
  // Classify real log entries. Anything that is not an error is not
  // reported as one — no fake alerts.
  const errors = [];
  for (const e of entries || []) {
    const text = `${e.action || ''} ${e.detail || ''} ${e.message || ''}`.toLowerCase();
    if (/uncaught|exception|failed|error|timeout|5\d\d/.test(text)) {
      errors.push({ at: e.at || new Date().toISOString(), severity: 'error', source: e.action || 'unknown', detail: e.detail || e.message || '' });
    }
  }
  return { checkedAt: new Date().toISOString(), total: (entries || []).length, errors: errors.length, items: errors };
}

export function securitySummary() {
  const failedLogins = auditLog.filter((e) => e.action === 'login-failed').length;
  const ownerActions = auditLog.filter((e) => e.actor === 'owner').length;
  return {
    checkedAt: new Date().toISOString(),
    auditEntries: auditLog.length,
    failedLogins,
    ownerActions,
    alerts: failedLogins >= 5
      ? [{ severity: 'warning', message: `${failedLogins} failed login attempts recorded — review the audit log.` }]
      : [],
    note: 'Alerts are raised only from real recorded events.',
  };
}

export function recentAudit(limit = 50) {
  return auditLog.slice(0, Math.min(Math.max(limit, 1), 200));
}
