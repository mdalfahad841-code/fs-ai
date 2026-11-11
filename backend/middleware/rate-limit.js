/**
 * FS AI — Rate-limit middleware.
 * Free-tier friendly: generous limits, in-memory by default, D1-backed when
 * env.DB is bound so limits survive across Worker isolates. Returns a
 * 429 Response when the limit is hit, otherwise null (allow).
 */
import { jsonError } from './validation.js';

const memoryStore = new Map(); // key -> { count, resetAt }

const DEFAULT_LIMIT = 100; // requests
const DEFAULT_WINDOW_MS = 60 * 1000; // per minute
const WRITE_LIMIT = 30; // stricter for POST/PUT/DELETE

export function clientKey(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

async function d1Check(env, key, limit, windowMs) {
  const now = Date.now();
  const windowStart = new Date(now - windowMs).toISOString();
  try {
    await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(new Date(now).toISOString()).run().catch(() => {});
    const { results } = await env.DB.prepare(
      'SELECT count FROM rate_limits WHERE key = ? AND reset_at > ? LIMIT 1'
    ).bind(key, windowStart).all();
    const row = results && results[0];
    if (!row) {
      await env.DB.prepare(
        'INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)'
      ).bind(key, new Date(now + windowMs).toISOString()).run();
      return { allowed: true, remaining: limit - 1 };
    }
    if (row.count >= limit) return { allowed: false, remaining: 0 };
    await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
    return { allowed: true, remaining: limit - row.count - 1 };
  } catch {
    return null; // D1 table missing — fall through to in-memory.
  }
}

function memoryCheck(key, limit, windowMs) {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) return { allowed: false, remaining: 0 };
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count };
}

export async function rateLimit(request, env) {
  const method = request.method.toUpperCase();
  const limit = method === 'GET' ? DEFAULT_LIMIT : WRITE_LIMIT;
  const key = `${clientKey(request)}:${method === 'GET' ? 'read' : 'write'}`;
  let result = null;
  if (env && env.DB) result = await d1Check(env, key, limit, DEFAULT_WINDOW_MS);
  if (!result) result = memoryCheck(key, limit, DEFAULT_WINDOW_MS);
  if (!result.allowed) {
    return jsonError('Too many requests — please slow down and try again in a minute.', 429, { retryAfterSeconds: 60 });
  }
  return null;
}
