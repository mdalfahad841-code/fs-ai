/**
 * FS AI — Auth middleware.
 * Owner-only session tokens. Passwords are verified with PBKDF2 (WebCrypto);
 * session tokens are random, hashed before storage, and checked by hash.
 * No password, hash or raw token is ever logged or returned to the client.
 * Login itself is handled by the owner flow that sets env.OWNER_PASSWORD_HASH
 * and env.SESSION_SECRET — never hard-code credentials here.
 */
import { hashSessionToken, verifyPassword, randomToken } from '../security/crypto.js';
import { jsonError } from './validation.js';

export async function requireOwner(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) {
    return { ok: false, response: jsonError('Owner session required', 401) };
  }
  const token = match[1].trim();
  if (!env.SESSION_SECRET) {
    return { ok: false, response: jsonError('Server auth is not configured', 503) };
  }
  const tokenHash = await hashSessionToken(token, env.SESSION_SECRET);
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT owner_email, expires_at FROM sessions WHERE token_hash = ? LIMIT 1'
      ).bind(tokenHash).all();
      const session = results && results[0];
      if (!session) return { ok: false, response: jsonError('Invalid session', 401) };
      if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
        return { ok: false, response: jsonError('Session expired', 401) };
      }
      return { ok: true, owner: session.owner_email || 'owner' };
    } catch {
      return { ok: false, response: jsonError('Session check failed', 500) };
    }
  }
  // No D1 bound: the session cannot be verified against a stored hash,
  // so no token is accepted. The raw SESSION_SECRET is NEVER accepted as
  // a Bearer token (removed 2026-11-13: it would let anyone holding the
  // secret act as owner without a real login, and the live Worker always
  // has D1 bound anyway).
  return { ok: false, response: jsonError('Invalid session', 401) };
}

export async function createSession(env, ownerEmail, password) {
  if (!env.OWNER_PASSWORD_HASH) return { ok: false, error: 'Owner password is not configured on the server.' };
  const valid = await verifyPassword(password, env.OWNER_PASSWORD_HASH);
  if (!valid) return { ok: false, error: 'Invalid email or password.' };
  const token = randomToken(32);
  const tokenHash = await hashSessionToken(token, env.SESSION_SECRET || 'fs-ai-session');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  if (env.DB) {
    await env.DB.prepare(
      'INSERT INTO sessions (token_hash, owner_email, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(tokenHash, ownerEmail, expiresAt, new Date().toISOString()).run();
  }
  return { ok: true, token, expiresAt, owner: ownerEmail };
}

export async function revokeSession(env, token) {
  const tokenHash = await hashSessionToken(token, env.SESSION_SECRET || 'fs-ai-session');
  if (env.DB) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return { ok: true };
}
