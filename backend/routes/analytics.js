/**
 * FS AI — Analytics route. Honest by design.
 * No analytics account is connected yet, so traffic is always reported as
 * "Data unavailable" and revenue as 0. Never fabricate visitors, clicks
 * or earnings. When a real analytics source is connected, this route reads
 * it; until then it reports the honest zero/unknown state.
 */
import { jsonOk, jsonError } from '../middleware/validation.js';

export const HONEST_ANALYTICS = {
  visitors: 'Data unavailable',
  pageViews: 'Data unavailable',
  clicks: 'Data unavailable',
  revenue: 0,
  revenueCurrency: 'USD',
  revenueFormatted: '$0.00',
  analyticsConnected: false,
  adsenseConnected: false,
  note: 'No analytics or AdSense account is connected yet. These figures are honest zeros/unknowns, not estimates.',
};

export async function handleAnalytics(request, env) {
  if (request.method.toUpperCase() !== 'GET') return jsonError('Method not allowed', 405);

  // If a real analytics binding/table exists in future, read it here.
  // Today there is none, so the honest fallback is the only truthful answer.
  if (env.DB) {
    const rows = await env.DB.prepare(
      "SELECT metric, value FROM analytics_snapshots ORDER BY recorded_at DESC LIMIT 20"
    ).all().catch(() => ({ results: [] }));
    if (rows.results && rows.results.length) {
      const snapshot = Object.fromEntries(rows.results.map((r) => [r.metric, r.value]));
      return jsonOk({ ...HONEST_ANALYTICS, snapshot, source: 'd1' });
    }
  }
  return jsonOk({ ...HONEST_ANALYTICS, source: 'fallback' });
}
