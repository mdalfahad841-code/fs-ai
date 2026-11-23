/**
 * FS AI — Owner auth routes.
 * POST /api/auth/login  — JSON { email, password } -> server session token.
 * POST /api/auth/logout — Bearer token -> revoke the session.
 * GET  /api/auth/me     — Bearer token -> owner identity for the session.
 *
 * Passwords are verified against env.OWNER_PASSWORD_HASH (PBKDF2,
 * format pbkdf2$iterations$salt$hash) and sessions are stored hashed in
 * the D1 `sessions` table (see database/migrations/003_sessions.sql).
 * No password, hash or raw token is ever logged or returned to the client.
 */
import { createSession, requireOwner, revokeSession } from '../middleware/auth.js';
import { checkLoginLockout, clearLoginAttempts, normalizeLoginEmail, recordFailedLogin } from '../middleware/login-lockout.js';
import { isValidEmail, jsonError, jsonOk, readJsonBody } from '../middleware/validation.js';

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match ? match[1].trim() : '';
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  // POST /api/auth/login — JSON { email, password }.
  if (path === '/api/auth/login' && method === 'POST') {
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError('Invalid JSON body.', 400);
    }
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!isValidEmail(email)) return jsonError('A valid email is required.', 400);
    if (!password) return jsonError('A password is required.', 400);
    if (!env.OWNER_PASSWORD_HASH) {
      return jsonError('Owner password is not configured on the server.', 503);
    }
    // Login lockout (close-out B3): 5 failed attempts for this email
    // lock the address out for a fixed 15 minutes. During the window
    // ALL attempts for the key are rejected with 429 — the password
    // is not checked and nothing is recorded, so the window can never
    // self-extend. A missing/unavailable lockout store fails open
    // (checkLoginLockout reports "not locked"), so login still works.
    // Existing sessions are never locked out: requireOwner does not
    // consult the lockout table.
    const lockKey = normalizeLoginEmail(email);
    const lock = await checkLoginLockout(env, lockKey);
    if (lock.locked) {
      const res = jsonError('Too many failed login attempts. Please try again later.', 429, { retryAfterSeconds: lock.retryAfterSeconds });
      res.headers.set('Retry-After', String(lock.retryAfterSeconds));
      return res;
    }
    const session = await createSession(env, email, password);
    if (!session.ok) {
      // Wrong password: record the failure (a no-op while locked —
      // unreachable here, since a locked key returns 429 above — and
      // fail-open when the store is unavailable). The triggering
      // attempt itself still answers 401; the lock bites from the
      // NEXT attempt.
      await recordFailedLogin(env, lockKey);
      // createSession only fails here on a bad password (the unconfigured
      // case is handled above) — never reveal which part was wrong.
      return jsonError('Invalid email or password.', 401);
    }
    // Correct password: clear any failure count for this key, so a
    // successful login always resets the lockout state. Best-effort —
    // a failed clear never fails the login.
    await clearLoginAttempts(env, lockKey);
    return jsonOk({ token: session.token, expiresAt: session.expiresAt, owner: session.owner });
  }

  // POST /api/auth/logout — Bearer token.
  if (path === '/api/auth/logout' && method === 'POST') {
    const token = bearerToken(request);
    if (!token) return jsonError('Owner session required', 401);
    await revokeSession(env, token);
    return jsonOk({ ok: true, loggedOut: true });
  }

  // GET /api/auth/me — Bearer token.
  if (path === '/api/auth/me' && method === 'GET') {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return jsonOk({ owner: auth.owner });
  }

  return jsonError('Not found', 404, { path });
}
