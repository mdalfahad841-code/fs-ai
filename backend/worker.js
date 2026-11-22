/**
 * FS AI — FAHAD SOMRAT AI
 * Tagline: "One Platform. Multiple Possibilities."
 * Cloudflare Worker entrypoint (ES module).
 *
 * Zero-cost only: Cloudflare Workers + D1 free tier. No paid services.
 * No secrets in frontend code — secrets live only in Worker environment
 * variables / bindings (env.DB, env.OWNER_PASSWORD_HASH, env.SESSION_SECRET).
 * Honest data only: revenue is $0.00 and traffic is "Data unavailable"
 * until a real, connected analytics source exists. Never fabricate
 * traffic, clicks, revenue, or account connections.
 */
import { handleArticles } from './routes/articles.js';
import { handleDivisions, handleAdminDivisions } from './routes/divisions.js';
import { handleTools } from './routes/tools.js';
import { handleAgents } from './routes/agents.js';
import { handleAccounts } from './routes/accounts.js';
import { handleAnalytics } from './routes/analytics.js';
import { handleAnalyticsDetail } from './routes/analytics.js';
import { handleHealthLatest } from './routes/health.js';
import { handleSocial } from './routes/social.js';
import { handleAuth } from './routes/auth.js';
import { handleAdminArticles, publishDueArticles } from './routes/admin-articles.js';
import { handleNewsletter, handleAdminSubscribers } from './routes/newsletter.js';
import { handleAdmin } from './routes/admin.js';
import { handleAutonomy } from './routes/orchestrator.js';
import { runDailyWorkflow, runWeeklyWorkflow } from './routes/scheduler.js';
import { requireOwner } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { jsonError, jsonOk } from './middleware/validation.js';

export { publishDueArticles };

export const BRAND = 'FS AI';
export const BRAND_FULL = 'FAHAD SOMRAT AI';
export const TAGLINE = 'One Platform. Multiple Possibilities.';

const ALLOWED_ORIGINS = [
  'https://fs-ai-5w5.pages.dev',
  'http://localhost:8787',
  'http://localhost:5173',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

// Security headers (H2 fix, 2026-11-21): applied to every Worker
// response in fetch() below. CSP keeps 'unsafe-inline' for script and
// style because the dashboard and article pages use inline scripts /
// styles; framing is denied outright (the site is never embedded).
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  // Health endpoint — no auth, no DB required.
  if (path === '/api/health' && method === 'GET') {
    return jsonOk({
      brand: BRAND_FULL,
      tagline: TAGLINE,
      status: 'ok',
      db: env.DB ? 'connected' : 'fallback',
      time: new Date().toISOString(),
      version: '1.0.0',
    });
  }

  // HEAD on the health endpoint — same headers as GET, empty body.
  // (2026-11-22 autonomy fix: HEAD used to fall through to the 404.)
  // Content-Type matches GET exactly (jsonOk sets 'application/json; charset=utf-8').
  if (path === '/api/health' && method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // Public read routes.
  if (path === '/api/articles' || path.startsWith('/api/articles/')) return handleArticles(request, env, ctx);
  if (path === '/api/divisions' || path.startsWith('/api/divisions/')) return handleDivisions(request, env, ctx);
  if (path === '/api/tools' || path.startsWith('/api/tools/')) return handleTools(request, env, ctx);
  if (path.startsWith('/api/accounts') && method === 'GET') return handleAccounts(request, env, ctx);
  if (path === '/api/analytics' && method === 'GET') return handleAnalytics(request, env, ctx);

  // Public newsletter routes (subscribe / unsubscribe). Rate limiting is
  // applied to every request in fetch() below (30/min for POSTs), so no
  // second limiter is needed here.
  if (path.startsWith('/api/newsletter')) return handleNewsletter(request, env, ctx);

  // Owner auth routes (login/logout/me). No session needed to log in.
  if (path.startsWith('/api/auth')) return handleAuth(request, env);

  // Owner-only routes (session token required).
  if (path.startsWith('/api/agents')) {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAgents(request, env, ctx, auth);
  }
  if (path.startsWith('/api/admin/articles')) {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAdminArticles(request, env, ctx, auth);
  }
  if (path.startsWith('/api/admin/divisions')) {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAdminDivisions(request, env, ctx, auth);
  }
  if (path.startsWith('/api/admin/subscribers')) {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAdminSubscribers(request, env, ctx, auth);
  }
  if (path === '/api/admin/emergency-stop' || path === '/api/admin/backup' || path === '/api/admin/backup/run') {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAdmin(request, env, ctx, auth);
  }
  if (path.startsWith('/api/accounts') && method !== 'GET') {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAccounts(request, env, ctx);
  }

  // Autonomous Operations (owner-only). Auth is enforced here, before
  // the orchestrator runs — handleAutonomy assumes a verified owner.
  if (path.startsWith('/api/autonomy')) {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAutonomy(request, env, ctx, auth);
  }

  // Control Center detail + health + social (owner-only, W5/W4/W1).
  // /api/health (liveness, no auth) above is a different endpoint —
  // do not confuse it with /api/health/latest (owner-only, D1-backed).
  if (path === '/api/analytics/detail' && method === 'GET') {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleAnalyticsDetail(request, env, ctx);
  }
  if (path === '/api/health/latest' && method === 'GET') {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleHealthLatest(request, env, ctx);
  }
  if (path.startsWith('/api/social/')) {
    // OAuth callback exemption (WS-C, 2026-11-21): a platform redirect
    // carries no Bearer token. Its auth is the signed, 10-minute,
    // platform-bound state token validated inside handleSocial — only
    // the owner who started the flow holds one. Every other social
    // route still requires the owner session below.
    if (method === 'GET' && /^\/api\/social\/oauth\/[a-z]+\/callback$/.test(path)) {
      return handleSocial(request, env, ctx);
    }
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
    return handleSocial(request, env, ctx);
  }

  if (path === '/' && method === 'GET') {
    return jsonOk({ brand: BRAND_FULL, tagline: TAGLINE, api: '/api/health' });
  }

  return jsonError('Not found', 404, { path });
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      const limited = await rateLimit(request, env, ctx);
      if (limited) return withSecurityHeaders(withCors(limited, request));
      const response = await route(request, env, ctx);
      return withSecurityHeaders(withCors(response, request));
    } catch (err) {
      console.error('FS AI worker error:', err);
      return withSecurityHeaders(withCors(jsonError('Internal server error', 500), request));
    }
  },

  // Hourly cron (see [triggers] in config/wrangler.toml): publish only the
  // owner-approved articles whose publish_at has passed. Nothing else is
  // ever auto-published, and the Emergency Stop skips the run entirely.
  // At 00:00 UTC the daily workflow also runs, and on Sundays at 00:00 UTC
  // the weekly workflow runs too. The 00:00 UTC guard is required:
  // runDailyWorkflow writes one daily_reports row per invocation, so
  // calling it on every hourly tick would write 24 rows/day.
  async scheduled(event, env, ctx) {
    // Failure isolation: a publishDueArticles exception must never
    // silently prevent the daily/weekly workflows, so each stage runs
    // in its own try/catch and logs its own error.
    try {
      const result = await publishDueArticles(env);
      console.log('FS AI scheduled publish:', JSON.stringify(result));
    } catch (err) {
      console.error('FS AI scheduled publish error:', err);
    }
    try {
      const now = new Date(event && event.scheduledTime ? event.scheduledTime : Date.now());
      if (now.getUTCHours() === 0) {
        const daily = await runDailyWorkflow(env);
        console.log('FS AI scheduled daily workflow:', JSON.stringify(daily));
        if (now.getUTCDay() === 0) {
          const weekly = await runWeeklyWorkflow(env);
          console.log('FS AI scheduled weekly workflow:', JSON.stringify(weekly));
        }
      }
    } catch (err) {
      console.error('FS AI scheduled workflow error:', err);
    }
  },
};

// Named export for tests and for src/index.js.
export async function scheduled(event, env, ctx) {
  return publishDueArticles(env);
}
