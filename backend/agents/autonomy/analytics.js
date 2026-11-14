/**
 * FS AI — Autonomy: analytics agent handler.
 *
 * Returns the honest analytics shape (HONEST_ANALYTICS) plus the latest
 * website_analytics row only when its source is not 'none'. Revenue is
 * $0.00 and traffic is 'Data unavailable' until a real source exists —
 * recorded values only, never estimates.
 */
import { d1All } from '../../middleware/validation.js';
import { HONEST_ANALYTICS } from '../../routes/analytics.js';

export async function runAnalytics(task, env) {
  if (!env || !env.DB) return { outcome: 'no-op', reason: 'D1 database is not bound.', ...HONEST_ANALYTICS };
  const rows = await d1All(env, 'SELECT * FROM website_analytics ORDER BY recorded_date DESC LIMIT 1');
  const latest = rows && rows[0];
  if (latest && latest.source && latest.source !== 'none') {
    return {
      outcome: 'done',
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
    };
  }
  return {
    outcome: 'no-op',
    reason: latest
      ? 'Latest website_analytics row records source "none" — no real analytics source connected.'
      : 'No website_analytics row exists — no real analytics source connected.',
    ...HONEST_ANALYTICS,
    recordedDate: latest ? latest.recorded_date : null,
    source: 'd1',
  };
}
