/**
 * FS AI — Newsletter routes.
 *
 * Public:
 *   POST /api/newsletter/subscribe    { email, name?, consent } — consent
 *         must be true; new addresses are stored with status 'pending'.
 *         Double opt-in confirmation emails are NOT sent: no free email
 *         sender is connected, so 'pending' is the honest stored state.
 *         A duplicate email answers 200 { subscribed: false } without
 *         leaking anything beyond that. An address that previously
 *         unsubscribed and subscribes again is moved back to 'pending'.
 *   POST /api/newsletter/unsubscribe  { email } — always 200, even for an
 *         unknown address (no state is leaked).
 *
 * Owner-only (worker.js enforces requireOwner):
 *   GET  /api/admin/subscribers               list (?status= filter)
 *   POST /api/admin/subscribers/:id/unsubscribe
 *
 * Rate limiting: the Worker applies its rate limiter to every request
 * (backend/worker.js fetch -> rateLimit), with a stricter 30/min budget
 * for POST/PUT/DELETE than for GET, so these public POSTs are covered
 * without a second limiter here.
 */
import {
  jsonOk, jsonError, parseQuery, readJsonBody, sanitiseText,
  isValidEmail, nowIso, d1All, d1First, d1Run, SUBSCRIBER_STATUSES,
} from '../middleware/validation.js';

function normaliseEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function subscribe(request, env) {
  if (!env.DB) return jsonError('Newsletter signup requires the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const email = normaliseEmail(body?.email);
  if (!isValidEmail(email)) return jsonError('A valid email is required.', 400);
  if (body?.consent !== true) return jsonError('Consent is required to subscribe.', 400);

  const existing = await d1First(env,
    'SELECT id, status FROM newsletter_subscribers WHERE email = ? LIMIT 1', [email]);
  if (existing) {
    if (existing.status === 'unsubscribed') {
      // Re-subscribe: back to pending (no confirmation email is sent —
      // no email sender is connected).
      await d1Run(env,
        'UPDATE newsletter_subscribers SET status = ?, subscribed_at = ?, unsubscribed_at = NULL WHERE email = ?',
        ['pending', nowIso(), email]);
      return jsonOk({
        subscribed: true, status: 'pending',
        message: 'Subscribed. Your subscription is stored as pending — confirmation emails are not sent yet because no email sender is connected.',
      }, 201);
    }
    return jsonOk({ subscribed: false, message: 'This email is already subscribed.' });
  }
  await d1Run(env,
    'INSERT INTO newsletter_subscribers (email, name, status, subscribed_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [email, sanitiseText(body?.name || '', 100) || null, 'pending', nowIso(), 'website', nowIso()]);
  return jsonOk({
    subscribed: true, status: 'pending',
    message: 'Subscribed. Your subscription is stored as pending — confirmation emails are not sent yet because no email sender is connected.',
  }, 201);
}

async function unsubscribe(request, env) {
  if (!env.DB) return jsonError('Newsletter signup requires the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const email = normaliseEmail(body?.email);
  if (!isValidEmail(email)) return jsonError('A valid email is required.', 400);
  // Always 200, even for an unknown address — no state is leaked.
  await d1Run(env,
    'UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = ? WHERE email = ?',
    ['unsubscribed', nowIso(), email]);
  return jsonOk({ ok: true, unsubscribed: true, message: 'You have been unsubscribed.' });
}

async function listSubscribers(request, env) {
  if (!env.DB) return jsonError('Subscriber reads require the D1 database', 503);
  const q = parseQuery(new URL(request.url));
  const status = q.get('status');
  if (status && !SUBSCRIBER_STATUSES.includes(status)) {
    return jsonError(`status must be one of: ${SUBSCRIBER_STATUSES.join(', ')}.`, 400);
  }
  let sql = 'SELECT * FROM newsletter_subscribers';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 100';
  const rows = await d1All(env, sql, params);
  return jsonOk({ subscribers: rows || [], total: (rows || []).length, source: 'd1' });
}

async function adminUnsubscribe(env, id) {
  if (!env.DB) return jsonError('Subscriber updates require the D1 database', 503);
  const row = await d1First(env, 'SELECT * FROM newsletter_subscribers WHERE id = ? LIMIT 1', [id]);
  if (!row) return jsonError('Subscriber not found', 404);
  await d1Run(env,
    'UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = ? WHERE id = ?',
    ['unsubscribed', nowIso(), id]);
  const updated = await d1First(env, 'SELECT * FROM newsletter_subscribers WHERE id = ? LIMIT 1', [id]);
  return jsonOk({ subscriber: updated });
}

export async function handleNewsletter(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/newsletter/subscribe' && method === 'POST') return subscribe(request, env);
  if (path === '/api/newsletter/unsubscribe' && method === 'POST') return unsubscribe(request, env);
  return jsonError('Not found', 404, { path });
}

export async function handleAdminSubscribers(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // api, admin, subscribers, [id], [action]
  if (method === 'GET' && parts.length === 3) return listSubscribers(request, env);
  if (method === 'POST' && parts.length === 5 && parts[4] === 'unsubscribe') return adminUnsubscribe(env, parts[3]);
  return jsonError('Method not allowed', 405);
}
