/**
 * FS AI — Validation middleware / helpers.
 * Input sanitisation, XSS guards (HTML escaping on output) and
 * SQL-injection guards (D1 prepared statements with bound parameters —
 * user input is never interpolated into SQL). Plus shared JSON helpers.
 */
import { escapeHtml } from '../security/crypto.js';

export function jsonOk(data, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function jsonError(message, status = 400, extra = {}) {
  return new Response(JSON.stringify({ ok: false, error: String(message), ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function parseQuery(url) {
  return url.searchParams;
}

export function sanitiseText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function sanitiseForHtml(value) {
  return escapeHtml(sanitiseText(value, 2000));
}

export function isValidSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function isSafeUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

// SQL-injection guard: this codebase only ever queries D1 through prepared
// statements with bound parameters (see routes/*.js). This helper rejects
// values that look like an injection attempt if a caller ever needs a
// LIKE pattern, so a raw string can never reach SQL.
const SQL_META = /('|"|;|--|\/\*|\*\/|\b(DROP|DELETE|UPDATE|INSERT|UNION|SELECT)\b)/i;
export function assertSafeLikeParam(value) {
  if (typeof value !== 'string') return '';
  if (SQL_META.test(value)) throw new Error('Unsafe input rejected.');
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export async function readJsonBody(request, maxBytes = 100 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Request body too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

export function validateArticleInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body must be a JSON object.'] };
  if (!body.title || typeof body.title !== 'string' || body.title.trim().length < 5) errors.push('title is required (at least 5 characters).');
  if (body.title && body.title.length > 200) errors.push('title must be under 200 characters.');
  if (body.division && !isValidSlug(body.division)) errors.push('division must be a valid slug.');
  if (body.excerpt && body.excerpt.length > 500) errors.push('excerpt must be under 500 characters.');
  return { ok: errors.length === 0, errors, clean: errors.length ? null : { title: sanitiseText(body.title, 200), excerpt: sanitiseText(body.excerpt || '', 500), division: body.division || null } };
}
