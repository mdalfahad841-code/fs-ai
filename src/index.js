/**
 * FS AI — FAHAD SOMRAT AI
 * Cloudflare Workers entry point (src/index.js).
 *
 * Thin wrapper only: all routing, middleware, services and agents live in
 * backend/ (backend/worker.js exports the real fetch handler). This file
 * exists because config/wrangler.toml sets main to this path. It re-exports
 * the real handler and adds the handleRequest() helper the test suite uses,
 * so local tests can call the Worker without a live deployment.
 *
 * Honest behaviour: with no D1 binding (env.DB absent) the routes use their
 * clearly-labelled in-memory fallbacks for reads, and answer 503
 * "not configured" for writes — they never fabricate data. See
 * backend/worker.js and backend/routes/*.js.
 */
import worker, { BRAND, BRAND_FULL, TAGLINE, scheduled, publishDueArticles } from '../backend/worker.js';

export { BRAND, BRAND_FULL, TAGLINE, scheduled, publishDueArticles };
export default worker;

/**
 * Call the Worker with a Request.
 * env defaults to {} (no D1 binding, no secrets), so local/test calls run
 * in honest fallback mode. ctx defaults to a no-op stub because some
 * handlers accept it; the real Workers runtime supplies the real ctx.
 */
export async function handleRequest(request, env = {}, ctx) {
  const context = ctx || {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
  return worker.fetch(request, env, context);
}

/**
 * Call the Worker's scheduled handler (hourly cron in production).
 * env defaults to {} (no D1 binding), so the due-publish check honestly
 * reports that no database is bound instead of publishing anything.
 */
export async function handleScheduled(event, env = {}, ctx) {
  const context = ctx || {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
  return scheduled(event, env, context);
}
