/**
 * FS AI — Analytics route. Honest by design.
 * No analytics account is connected yet, so traffic is always reported as
 * "Data unavailable" and revenue as 0. Never fabricate visitors, clicks
 * or earnings. When a real analytics source is connected, this route reads
 * it; until then it reports the honest zero/unknown state.
 *
 * D1 table is website_analytics (database/schema.sql) — NOT
 * `analytics_snapshots`. Columns: recorded_date, source, page_views,
 * unique_visitors, clicks, top_page, notes. The seed row has source
 * 'none' with NULL metrics, which correctly yields the honest fallback.
 * A later row with a real source (google_analytics / cloudflare) and
 * non-NULL metrics is reported as recorded — never estimated.
 */
import { jsonOk, jsonError, d1All } from '../middleware/validation.js';

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

  if (env.DB) {
    const rows = await d1All(env,
      'SELECT * FROM website_analytics ORDER BY recorded_date DESC LIMIT 1');
    const latest = rows && rows[0];
    if (latest && latest.source && latest.source !== 'none') {
      return jsonOk({
        ...HONEST_ANALYTICS,
        visitors: latest.unique_visitors ?? 'Data unavailable',
        pageViews: latest.page_views ?? 'Data unavailable',
        clicks: latest.clicks ?? 'Data unavailable',
        analyticsConnected: true,
        analyticsSource: latest.source,
        recordedDate: latest.recorded_date,
        topPage: latest.top_page || null,
        note: `Latest analytics snapshot (${latest.recorded_date}, source: ${latest.source}).`,
        source: 'd1',
      });
    }
    if (latest) {
      // A row exists but records that nothing is connected — honest fallback.
      return jsonOk({ ...HONEST_ANALYTICS, recordedDate: latest.recorded_date, source: 'd1' });
    }
  }
  return jsonOk({ ...HONEST_ANALYTICS, source: 'fallback' });
}
