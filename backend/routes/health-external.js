/**
 * FS AI — Internal health-report route (Fix Pass 4 F1, 2026-11-24).
 *
 * POST /api/admin/health-report-external — runs the five external-fetch
 * health checks (pages, sitemap, recentArticles, sitemapRefresh,
 * serverSideHeads) and returns their results as JSON.
 *
 * Why this route exists: the daily run is a single Worker invocation
 * with a 50-subrequest budget, and by the time its health-report step
 * (step 15) runs, the drain + SEO steps have already spent the budget
 * — on 24 Nov the sitemap + serverSideHeads checks failed with "Too
 * many subrequests by single Worker invocation" (the sitemap and the
 * heads themselves were proven live by curl; the failures are budget
 * exhaustion, not breakage). This route runs in its OWN invocation,
 * with a fresh 50-subrequest budget, so the same checks get real
 * OK/FAIL answers. The daily run calls it exactly once and embeds
 * the returned checks in the daily report; if the call fails, the
 * builder falls back to the in-process checks (today's behaviour).
 *
 * Auth — two ways in, both owner-only, both checked before any work:
 *   1. An owner Bearer session (requireOwner, the same pattern as
 *      every other admin route) — for a human owner calling the route
 *      directly (e.g. to prove it responds).
 *   2. The Worker's own HMAC-signed internal call — the daily run is
 *      a cron invocation and holds no owner session (a cron cannot log
 *      in, and minting a session would be a live D1 write plus a
 *      transient full-owner credential), so it signs the request with
 *      an HMAC-SHA256 over method + path + timestamp, keyed by the
 *      existing env.SESSION_SECRET (no new secret, no live write).
 *      The signature is scoped to this one path and expires after
 *      5 minutes; the secret itself is never transmitted. See
 *      backend/security/crypto.js signInternalRequest /
 *      verifyInternalSignature.
 * A request that passes neither is 401. The route is READ-ONLY: it
 * fetches public URLs and reads D1 through the same check functions
 * the builder uses — it writes nothing to D1, publishes nothing, and
 * touches no setting, gate or article. A fetch failure inside a check
 * is reported as FAIL (or NOT TESTED for sitemapRefresh, exactly as
 * the builder has always reported it), never OK.
 */
import { requireOwner } from '../middleware/auth.js';
import { verifyInternalSignature } from '../security/crypto.js';
import { jsonError, jsonOk } from '../middleware/validation.js';
import {
  runExternalHealthChecks,
  EXTERNAL_HEALTH_CHECK_KEYS,
} from '../services/daily-health-report.js';

/** The route path — the daily run signs exactly this path, so a
 * signature captured for it cannot be replayed anywhere else. */
export const HEALTH_REPORT_EXTERNAL_PATH = '/api/admin/health-report-external';

/** HMAC validity window for the Worker's own internal call. */
export const INTERNAL_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** The only fetch methods this route answers. */
const ALLOWED_METHODS = ['POST'];

/**
 * Verify the Worker's own HMAC-signed internal call. The caller sends
 * X-FS-AI-Internal-Timestamp (ms since epoch) and
 * X-FS-AI-Internal-Signature (hex HMAC-SHA256 over
 * "POST\n<path>\n<timestamp>", keyed by env.SESSION_SECRET).
 * False when the secret is not configured, the timestamp is missing /
 * unparseable / older than 5 minutes, or the signature does not match
 * (constant-time compare inside verifyInternalSignature).
 */
export async function verifyInternalHealthCall(request, env) {
  if (!request || !env || typeof env.SESSION_SECRET !== 'string' || !env.SESSION_SECRET) return false;
  const timestamp = request.headers.get('X-FS-AI-Internal-Timestamp') || '';
  const signature = request.headers.get('X-FS-AI-Internal-Signature') || '';
  return verifyInternalSignature(
    env.SESSION_SECRET, 'POST', HEALTH_REPORT_EXTERNAL_PATH, timestamp, signature,
    { maxAgeMs: INTERNAL_SIGNATURE_MAX_AGE_MS },
  );
}

/**
 * POST /api/admin/health-report-external.
 * Optional JSON body: { "checks": ["pages", "sitemap", ...] } to run a
 * subset; absent (or an empty array) runs all five. An unknown check
 * name is 400. `opts.fetchImpl` is test-only (defaults to global fetch).
 * Returns { ok: true, date, generatedAt, checks } — `checks` carries
 * exactly the requested keys, each a { status, detail } check object.
 */
export async function handleHealthReportExternal(request, env, opts = {}) {
  try {
    if (!request || !ALLOWED_METHODS.includes(String(request.method || '').toUpperCase())) {
      return jsonError('Method not allowed', 405);
    }
    const owner = await requireOwner(request, env);
    let authed = !!owner.ok;
    if (!authed) authed = await verifyInternalHealthCall(request, env);
    if (!authed) return jsonError('Owner session required', 401);

    let only = null;
    let bodyText = '';
    try {
      bodyText = typeof request.text === 'function' ? await request.text() : '';
    } catch {
      bodyText = '';
    }
    if (bodyText && bodyText.trim()) {
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return jsonError('Request body is not parseable JSON', 400);
      }
      if (body && body.checks !== undefined) {
        if (!Array.isArray(body.checks)) {
          return jsonError('"checks" must be an array of check names', 400);
        }
        const unknown = body.checks.filter((k) => !EXTERNAL_HEALTH_CHECK_KEYS.includes(k));
        if (unknown.length > 0) {
          return jsonError(`Unknown health check(s): ${unknown.join(', ')} — valid: ${EXTERNAL_HEALTH_CHECK_KEYS.join(', ')}`, 400);
        }
        only = body.checks.length > 0 ? body.checks : null;
      }
    }

    const fetchImpl = opts && typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch;
    const nowMs = Date.now();
    const checks = await runExternalHealthChecks(env, { fetchImpl, nowMs, only });
    return jsonOk({
      ok: true,
      date: new Date(nowMs).toISOString().slice(0, 10),
      generatedAt: new Date(nowMs).toISOString(),
      checks,
    });
  } catch (err) {
    return jsonError('Health-report external checks failed', 500, {
      error: String((err && err.message) || err).slice(0, 200),
    });
  }
}
