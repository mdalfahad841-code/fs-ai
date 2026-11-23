/**
 * FS AI — Login lockout (close-out B3, 2026-11-23).
 *
 * D1-backed failed-login counting for POST /api/auth/login. After
 * MAX_FAILED_ATTEMPTS failed attempts for one email address, login
 * for that address is rejected with 429 for a fixed LOCKOUT_WINDOW_MS.
 *
 * The guarantee that matters: the lockout is strictly time-bounded
 * and NEVER self-extending. Once a key is locked, further attempts
 * inside the window are rejected WITHOUT recording new failures —
 * recordFailedLogin() returns early when the key is already locked,
 * so an attacker cannot keep the owner locked out forever by failing
 * once every few minutes. The window always expires at a fixed time.
 *
 * The owner can never be locked out permanently, three ways:
 *   (a) the window expires on its own — after it, a correct-password
 *       login succeeds (an expired lock also resets the count to 1
 *       on the next failure, it never re-locks from the old count);
 *   (b) the documented manual unlock (DELETE the row — see
 *       docs/CLOSEOUT-B3-OWNER-UNLOCK-2026-11-23.md) restores login
 *       immediately; clearLoginAttempts() is the same DELETE;
 *   (c) an existing valid session keeps working throughout —
 *       requireOwner() never consults this table.
 *
 * Fail-open (mirrors the rate limiter's philosophy): with no D1
 * bound, or when any store call throws (e.g. the table is missing
 * because the code deployed before migration 031 was applied),
 * every function reports "not locked" and records nothing — the
 * owner is never locked out by a missing/unavailable store.
 *
 * Privacy: the table stores ONLY the lowercased email key, the
 * failure count and three timestamps. No passwords, hashes, IPs or
 * user agents — ever. The key is the submitted email (lowercased):
 * the login flow checks no stored owner email, so an attacker can
 * only lock out the exact email string they attack.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOCKOUT_WINDOW_MINUTES = 15;

/** The lockout key: the submitted email, trimmed and lowercased. */
export function normalizeLoginEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const SELECT_SQL =
  'SELECT email, failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts WHERE email = ? LIMIT 1';
const UPSERT_SQL =
  'INSERT INTO login_attempts (email, failed_count, first_failed_at, last_failed_at, locked_until) VALUES (?, ?, ?, ?, ?) ' +
  'ON CONFLICT(email) DO UPDATE SET failed_count = excluded.failed_count, first_failed_at = excluded.first_failed_at, ' +
  'last_failed_at = excluded.last_failed_at, locked_until = excluded.locked_until';
const DELETE_SQL = 'DELETE FROM login_attempts WHERE email = ?';

function lockedResult(lockedUntil, nowMs) {
  const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(lockedUntil) - nowMs) / 1000));
  return { locked: true, lockedUntil, retryAfterSeconds };
}

/**
 * Is this email key currently locked out? Fail-open: no D1, no row,
 * an expired locked_until, or any store error all mean "not locked".
 * Read-only — it never writes, so it can never extend a window.
 */
export async function checkLoginLockout(env, emailKey, nowMs = Date.now()) {
  if (!env || !env.DB) return { locked: false };
  try {
    const { results } = await env.DB.prepare(SELECT_SQL).bind(emailKey).all();
    const row = results && results[0];
    if (!row || !row.locked_until) return { locked: false };
    if (Date.parse(row.locked_until) > nowMs) return lockedResult(row.locked_until, nowMs);
    return { locked: false };
  } catch {
    return { locked: false };
  }
}

/**
 * Record one failed login for this key. Returns { locked, ... }.
 * If the key is already locked, NOTHING is written — the window is
 * not extended and the locked_until timestamp is returned unchanged.
 * If a previous lock has expired, the count restarts at 1 (a fresh
 * window); the old count never re-locks the key on its own.
 * Fail-open: no D1 or any store error records nothing and reports
 * "not locked".
 */
export async function recordFailedLogin(env, emailKey, nowMs = Date.now()) {
  if (!env || !env.DB) return { locked: false, recorded: false };
  try {
    const { results } = await env.DB.prepare(SELECT_SQL).bind(emailKey).all();
    const row = results && results[0];
    const nowIso = new Date(nowMs).toISOString();
    if (row && row.locked_until && Date.parse(row.locked_until) > nowMs) {
      // Already locked: reject without recording — the window must
      // never self-extend, or an attacker could lock the owner out
      // forever by failing once every few minutes.
      return { ...lockedResult(row.locked_until, nowMs), recorded: false };
    }
    let failedCount;
    let firstFailedAt;
    let lockedUntil = null;
    if (!row) {
      failedCount = 1;
      firstFailedAt = nowIso;
    } else if (row.locked_until && Date.parse(row.locked_until) <= nowMs) {
      // Previous lock expired: fresh window, count restarts at 1.
      failedCount = 1;
      firstFailedAt = nowIso;
    } else {
      failedCount = (row.failed_count || 0) + 1;
      firstFailedAt = row.first_failed_at || nowIso;
    }
    if (failedCount >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(nowMs + LOCKOUT_WINDOW_MS).toISOString();
    }
    await env.DB.prepare(UPSERT_SQL)
      .bind(emailKey, failedCount, firstFailedAt, nowIso, lockedUntil).run();
    if (lockedUntil) return { ...lockedResult(lockedUntil, nowMs), recorded: true };
    return { locked: false, recorded: true };
  } catch {
    return { locked: false, recorded: false };
  }
}

/**
 * Clear the failure/lockout row for this key — the programmatic form
 * of the documented manual unlock (the doc's SQL is the same DELETE).
 * Called on every successful login, so a correct password always
 * resets the count. Best-effort: a failed clear never fails a login;
 * the caller ignores the result. Returns { ok, cleared }.
 */
export async function clearLoginAttempts(env, emailKey) {
  if (!env || !env.DB) return { ok: true, cleared: 0 };
  try {
    const result = await env.DB.prepare(DELETE_SQL).bind(emailKey).run();
    const cleared = result && result.meta && typeof result.meta.changes === 'number'
      ? result.meta.changes : 0;
    return { ok: true, cleared };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
