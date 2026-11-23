/**
 * FS AI — CSP violation report endpoint (close-out A4, 2026-11-23).
 *
 * The Pages CSP ships Report-Only (frontend/_headers) and names this
 * endpoint as its report-uri, so browsers POST one report per blocked
 * resource. The endpoint is public — a browser has no session — so it
 * is deliberately narrow:
 *   - Content-Type must be application/csp-report or
 *     application/reports+json, else 415. Anything else is not a CSP
 *     report and is refused without reading the body.
 *   - Body capped at 8 KiB (Content-Length checked first, then the
 *     read text measured in bytes), else 413.
 *   - Only four fields are ever stored: the violated directive NAME
 *     (first token of violated-directive, e.g. "script-src"),
 *     blocked-uri, document-uri, timestamp. No IP, no user agent,
 *     no raw body. URIs are truncated to 2048 chars.
 *   - Both report formats are accepted: the CSP Level 2 object
 *     { "csp-report": { "violated-directive", "blocked-uri",
 *     "document-uri", ... } } and the Reporting API array
 *     [{ "type": "csp-violation", "body": { "violatedDirective",
 *     "blockedURL", "documentURL" } }].
 *   - Success is always 204 with an empty body, even when D1 is not
 *     bound or the insert fails — a report endpoint must never make
 *     a page load worse. A missing directive (not a CSP report) is
 *     the only 400.
 *   - Rate limiting comes from the global limiter in fetch()
 *     (backend/worker.js): POSTs are capped at 30/min per IP. No
 *     second limiter is needed here.
 * The 7-day counts (handleCspReportStats) are owner-only — worker.js
 * enforces requireOwner before calling them.
 */
import { jsonOk, jsonError } from '../middleware/validation.js';

export const CSP_REPORT_MAX_BODY_BYTES = 8192;
export const CSP_REPORT_MAX_URI_CHARS = 2048;
const ACCEPTED_TYPES = new Set(['application/csp-report', 'application/reports+json']);
const DIRECTIVE_RE = /^[a-z][a-z0-9-]{0,63}$/;

function contentTypeBase(request) {
  const raw = request.headers.get('content-type') || '';
  return raw.split(';')[0].trim().toLowerCase();
}

/* The directive NAME only ("script-src 'self'" -> "script-src"). The
   full violated-directive value is a policy restatement, not data. */
function directiveName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().split(/\s+/)[0].toLowerCase();
  return DIRECTIVE_RE.test(name) ? name : null;
}

function cleanUri(value) {
  if (typeof value !== 'string') return null;
  const v = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, CSP_REPORT_MAX_URI_CHARS);
  return v || null;
}

/* Accepts both the CSP Level 2 object and the Reporting API array (or
   single object). Returns { directive, blockedUri, documentUri } with
   directive null when no usable violated directive was found. */
export function parseCspReport(body) {
  if (!body || typeof body !== 'object') return { directive: null, blockedUri: null, documentUri: null };
  if (body['csp-report'] && typeof body['csp-report'] === 'object') {
    const r = body['csp-report'];
    return {
      directive: directiveName(r['violated-directive']),
      blockedUri: cleanUri(r['blocked-uri']),
      documentUri: cleanUri(r['document-uri']),
    };
  }
  const entries = Array.isArray(body) ? body : [body];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const b = e.body && typeof e.body === 'object' ? e.body : e;
    const d = directiveName(b.violatedDirective !== undefined ? b.violatedDirective : b['violated-directive']);
    if (d) {
      return {
        directive: d,
        blockedUri: cleanUri(b.blockedURL !== undefined ? b.blockedURL : b['blocked-uri']),
        documentUri: cleanUri(b.documentURL !== undefined ? b.documentURL : b['document-uri']),
      };
    }
  }
  return { directive: null, blockedUri: null, documentUri: null };
}

/* SQLite datetime format ('YYYY-MM-DD HH:MM:SS'), matching the
   migration DEFAULT and the stats window comparison exactly. */
function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function handleCspReport(request, env) {
  if (!ACCEPTED_TYPES.has(contentTypeBase(request))) {
    return jsonError('Unsupported Media Type: CSP reports must use application/csp-report or application/reports+json', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && declared !== '' && Number(declared) > CSP_REPORT_MAX_BODY_BYTES) {
    return jsonError('Report body too large', 413);
  }
  let text;
  try {
    text = await request.text();
  } catch {
    return jsonError('Could not read report body', 400);
  }
  if (new TextEncoder().encode(text).length > CSP_REPORT_MAX_BODY_BYTES) {
    return jsonError('Report body too large', 413);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError('Report body is not valid JSON', 400);
  }
  const report = parseCspReport(parsed);
  if (!report.directive) {
    return jsonError('Report has no usable violated directive', 400);
  }
  if (env && env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO csp_reports (directive, blocked_uri, document_uri, reported_at) VALUES (?, ?, ?, ?)',
      ).bind(report.directive, report.blockedUri, report.documentUri, sqliteNow()).run();
    } catch (err) {
      // Best-effort store: a missing table (migration not applied yet)
      // must not turn a report into an error for the browser.
      console.error('FS AI csp-report store failed:', err);
    }
  }
  return new Response(null, { status: 204 });
}

/* 7-day counts per directive, newest-first by count. Owner-only —
   worker.js enforces requireOwner before this handler runs. */
export async function handleCspReportStats(request, env) {
  if (!env || !env.DB) return jsonError('Database unavailable', 503);
  const { results } = await env.DB.prepare(
    "SELECT directive, COUNT(*) AS count FROM csp_reports WHERE reported_at >= datetime('now', '-7 days') GROUP BY directive ORDER BY count DESC, directive ASC",
  ).all();
  const byDirective = (results || []).map((r) => ({ directive: r.directive, count: Number(r.count) || 0 }));
  const total = byDirective.reduce((n, r) => n + r.count, 0);
  return jsonOk({ days: 7, total, by_directive: byDirective });
}
