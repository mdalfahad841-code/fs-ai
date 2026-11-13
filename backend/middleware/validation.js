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

// ---------------------------------------------------------------------------
// CMS / admin helpers (added 2026-11-13 for the CMS, newsletter, divisions
// admin, agent-control and backup work). Pure functions only — no I/O.
// ---------------------------------------------------------------------------

// Lowercase hyphenated slug from a title, e.g. "Hello World!" -> "hello-world".
export function slugify(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

// True when the value parses as a real date/time (ISO 8601 expected).
export function isValidIsoDateTime(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

// Current UTC time as an ISO string (lexicographically comparable with the
// ISO timestamps stored in D1 TEXT columns).
export function nowIso() {
  return new Date().toISOString();
}

// Article statuses allowed by the articles.status CHECK constraint.
export const ARTICLE_STATUSES = ['draft', 'pending_approval', 'approved', 'published', 'archived'];

// Divisions whose single-article responses carry a general-information
// disclaimer. Worded honestly: general information only, not advice.
export const DISCLAIMER_DIVISIONS = new Set(['health-wellness', 'finance-money']);
export const GENERAL_INFO_DISCLAIMER =
  'General information only — not medical/financial advice. Consult a qualified professional.';

export function disclaimerForDivision(slug) {
  return DISCLAIMER_DIVISIONS.has(slug) ? GENERAL_INFO_DISCLAIMER : null;
}

// Newsletter subscriber statuses allowed by the CHECK constraint.
export const SUBSCRIBER_STATUSES = ['pending', 'subscribed', 'unsubscribed'];

// ---------------------------------------------------------------------------
// Minimal D1 helpers. All queries go through prepared statements with bound
// parameters — user input is never interpolated into SQL. Returns [] / null
// when env.DB is not bound, so callers can answer 503 honestly.
// ---------------------------------------------------------------------------

export async function d1All(env, sql, params = []) {
  if (!env || !env.DB) return null;
  const stmt = env.DB.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return result.results || [];
}

export async function d1First(env, sql, params = []) {
  const rows = await d1All(env, sql, params);
  if (rows === null) return null;
  return rows.length ? rows[0] : undefined;
}

export async function d1Run(env, sql, params = []) {
  if (!env || !env.DB) return null;
  const stmt = env.DB.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  return bound.run();
}
