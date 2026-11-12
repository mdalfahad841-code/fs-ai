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
    const session = await createSession(env, email, password);
    if (!session.ok) {
      // createSession only fails here on a bad password (the unconfigured
      // case is handled above) — never reveal which part was wrong.
      return jsonError('Invalid email or password.', 401);
    }
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
