/**
 * FS AI — Analytics route. Honest by design.
 * Status is exactly "Tracking Connected — Reporting API Not Connected":
 * the GA4 tag (G-JVSCJT2DHJ) is on every public page, but no GA4 report
 * is wired in — there is NO GA4 Data API usage anywhere in this repo
 * (no googleapis, analyticsdata or analyticsreporting import/call), so
 * traffic is always reported as "Data unavailable" and revenue as 0.
 * Never fabricate visitors, clicks or earnings, and never label
 * Analytics fully connected from the tag alone. No AdSense account is
 * connected. When a real analytics source is connected, this route reads
 * it; until then it reports the honest zero/unknown state.
 *
 * D1 table is website_analytics (database/schema.sql) — NOT
 * `analytics_snapshots`. Columns: recorded_date, source, page_views,
 * unique_visitors, clicks, top_page, notes. The seed row has source
 * 'none' with NULL metrics, which correctly yields the honest fallback.
 * A later row with a real source (google_analytics / cloudflare) and
 * non-NULL metrics is reported as recorded — never estimated.
 */
import { jsonOk, jsonError, d1All, d1First } from '../middleware/validation.js';
import { getAllProvidersDailyUsage, DEFAULT_NEURON_CAP } from '../llm/usage.js';

/**
 * W5 Control Center — real-data analytics detail endpoint.
 *
 * GET /api/analytics/detail?section=<name> (owner-only once wired;
 * the coordinator registers the route — see the W5 report for the
 * exact snippet). Every section returns { data, asOf, freshness } with
 * real timestamps; a section the backend cannot supply returns
 * { status: 'unavailable', reason, value: null } — never a fabricated
 * number. A missing table (a workstream not merged yet) degrades that
 * section to unavailable instead of failing the whole endpoint.
 *
 * Sections: articles, drafts, research, factchecks, seo, traffic,
 * social, engagement, revenue, ai-usage, errors, queue, reports,
 * activity, all.
 */
export const GA4_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'GA4 data is not stored in D1; connect the GA4 Data API or check the GA4 console',
  value: null,
};

export const SEARCH_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'Search Console data is not stored in D1; check the Search Console console',
  value: null,
};

export const SOCIAL_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'No social post data is stored in D1 (social_posts / social_analytics tables do not exist yet); check each platform directly',
  value: null,
};

export const ENGAGEMENT_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'No engagement data is stored in D1 (social_analytics table does not exist yet); check each platform directly',
  value: null,
};

/**
 * WS-E (2026-11-21) — per-metric unavailable markers for the coverage
 * table. Every one carries a reason AND what would make the metric
 * available, so "Data unavailable" is never a dead end. Nothing here
 * is ever a fabricated number: value is always null until real data
 * exists in D1.
 */
export const IMPRESSIONS_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'No real analytics snapshot is stored in D1 (website_analytics has only the seed row with source "none" and NULL metrics); connect the GA4 Data API or record a snapshot.',
  value: null,
  whatWouldMakeAvailable: 'Connect the GA4 Data API (or Cloudflare Web Analytics) and store a row in website_analytics with a real source and non-NULL page_views / unique_visitors / clicks.',
};

export const SEARCH_PERF_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'Search Console data is not stored in D1; check the Search Console console',
  value: null,
  whatWouldMakeAvailable: 'Connect the Search Console API and store query / click / impression / position rows in D1 (no such table exists yet). Until then, check the Search Console console.',
};

export const INDEXED_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'Indexed-page counts are not stored in D1; the Search Console API is not connected.',
  value: null,
  whatWouldMakeAvailable: 'Connect the Search Console API and store the indexed-pages count in D1. Until then, check URL Inspection in the Search Console console.',
  manualNote: 'Manual check only, not a stored metric: homepage indexed (verified via URL Inspection 2026-11-19); Article 1 not indexed; sitemap "Couldn\'t fetch" / 0 pages as of 2026-11-20.',
};

export const VIDEO_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'No video metrics are stored in D1; the YouTube Data API is not connected and no view/watch-time figures are recorded.',
  value: null,
  whatWouldMakeAvailable: 'Connect the YouTube Data API (after the consent screen is Production — do NOT use while in Testing) and store per-video views / watch time in D1. Until then, check YouTube Studio manually.',
  manualNote: 'Manual check only, not a stored metric: Shorts performance is known only from manual YouTube Studio checks (latest: Short #05 published 2026-11-21). No view or watch-time figures are stored.',
};

export const TRAFFIC_SOURCES_UNAVAILABLE = {
  status: 'unavailable',
  reason: 'Traffic-source breakdown is not stored in D1; the GA4 Data API is not connected.',
  value: null,
  whatWouldMakeAvailable: 'Connect the GA4 Data API and store per-source sessions in D1. Until then, check the GA4 console.',
};

/** A website_analytics snapshot is stale after 7 days without a new row. */
export const ANALYTICS_SNAPSHOT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the ISO timestamp is older than maxAgeMs (stale-data rule). */
export function isStaleIso(iso, maxAgeMs, nowMs = Date.now()) {
  if (!iso) return true;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms > maxAgeMs;
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeJson(text, fallback = null) {
  if (text == null) return fallback;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return fallback; }
}

/** A read that degrades to null when the table does not exist yet. */
async function safeAll(env, sql, params = []) {
  try { return await d1All(env, sql, params); } catch { return null; }
}
async function safeFirst(env, sql, params = []) {
  try { return await d1First(env, sql, params); } catch { return null; }
}

async function sectionArticles(env) {
  const byStatus = await d1All(env, 'SELECT status, COUNT(*) AS n FROM articles GROUP BY status') || [];
  const byDivision = await d1All(env,
    'SELECT d.slug AS division, d.name, COUNT(a.id) AS total, ' +
    "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
    'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id GROUP BY d.id, d.slug, d.name ORDER BY d.id ASC') || [];
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, toNum(r.n)]));
  return {
    byStatus: counts,
    byDivision: byDivision.map((r) => ({ division: r.division, name: r.name, total: toNum(r.total), published: toNum(r.published) })),
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    published: counts.published || 0,
    drafts: (counts.draft || 0) + (counts.pending_approval || 0),
  };
}

/** Tables latestCheckRows may read. The table name is interpolated
 * into SQL, so it must come from this allowlist only — never from a
 * caller or from user input. (WS-E hardening 2026-11-21: the only two
 * callers pass literals, but the allowlist makes that a guarantee
 * instead of a convention.) */
const CHECK_TABLES = new Set(['fact_checks', 'seo_checks']);

async function latestCheckRows(env, table, articleIds) {
  // Latest row per article from fact_checks / seo_checks (same shape).
  if (!CHECK_TABLES.has(table)) throw new Error(`Refused table in latestCheckRows: ${table}`);
  if (!articleIds.length) return new Map();
  const placeholders = articleIds.map(() => '?').join(',');
  const rows = await safeAll(env,
    `SELECT * FROM ${table} WHERE id IN (SELECT MAX(id) FROM ${table} WHERE article_id IN (${placeholders}) GROUP BY article_id)`,
    articleIds);
  const map = new Map();
  for (const r of rows || []) map.set(r.article_id, r);
  return map;
}

async function sectionDrafts(env, nowMs = Date.now()) {
  const drafts = await d1All(env,
    "SELECT a.id, a.title, a.status, d.slug AS division, a.updated_at FROM articles a JOIN business_divisions d ON d.id = a.division_id " +
    "WHERE a.status IN ('draft', 'pending_approval') ORDER BY a.updated_at DESC LIMIT 20") || [];
  const ids = drafts.map((d) => d.id);
  const fcMap = await latestCheckRows(env, 'fact_checks', ids);
  const seoMap = await latestCheckRows(env, 'seo_checks', ids);
  return drafts.map((d) => {
    const fc = fcMap.get(d.id);
    const seo = seoMap.get(d.id);
    return {
      id: d.id, title: d.title, status: d.status, division: d.division, updatedAt: d.updated_at,
      factCheck: fc ? {
        verdict: fc.verdict, claimsVerified: fc.claims_verified, claimsTotal: fc.claims_total,
        claimsFailed: fc.claims_failed, checkedAt: fc.created_at,
        // Stale when the check predates the article's last edit.
        stale: fc.created_at < d.updated_at,
      } : null,
      seo: seo ? { verdict: seo.verdict, checkedAt: seo.created_at, stale: seo.created_at < d.updated_at } : null,
    };
  });
}

async function sectionResearch(env) {
  const sources = await safeFirst(env, 'SELECT COUNT(*) AS sources, COALESCE(SUM(items_discovered), 0) AS items FROM research_sources WHERE is_active = 1');
  const items7d = await safeFirst(env, "SELECT COUNT(*) AS n FROM research_items WHERE fetched_at >= datetime('now', '-7 days')");
  const lastFetch = await safeFirst(env, 'SELECT MAX(last_fetched_at) AS at FROM research_sources WHERE is_active = 1');
  const total = await safeFirst(env, 'SELECT COUNT(*) AS n FROM research_items');
  if (sources === null && items7d === null && total === null) {
    return { status: 'unavailable', reason: 'Research tables are not available in this database', value: null };
  }
  return {
    activeSources: toNum(sources && sources.sources),
    itemsDiscovered: toNum(sources && sources.items),
    items7d: toNum(items7d && items7d.n),
    itemsTotal: toNum(total && total.n),
    lastFetchedAt: lastFetch ? lastFetch.at : null,
  };
}

async function sectionFactchecks(env) {
  const drafts = await d1All(env, "SELECT id, title, updated_at FROM articles WHERE status IN ('draft', 'pending_approval') ORDER BY updated_at DESC LIMIT 20") || [];
  const ids = drafts.map((d) => d.id);
  const fcMap = await latestCheckRows(env, 'fact_checks', ids);
  const byId = new Map(drafts.map((d) => [d.id, d]));
  return [...fcMap.entries()].map(([articleId, fc]) => {
    const a = byId.get(articleId) || {};
    return {
      articleId, title: a.title || null, verdict: fc.verdict,
      claimsVerified: fc.claims_verified, claimsTotal: fc.claims_total, claimsFailed: fc.claims_failed,
      checkedAt: fc.created_at, stale: fc.created_at < (a.updated_at || ''),
    };
  });
}

async function sectionSeo(env) {
  const drafts = await d1All(env, "SELECT id, title, updated_at FROM articles WHERE status IN ('draft', 'pending_approval') ORDER BY updated_at DESC LIMIT 20") || [];
  const ids = drafts.map((d) => d.id);
  const seoMap = await latestCheckRows(env, 'seo_checks', ids);
  const byId = new Map(drafts.map((d) => [d.id, d]));
  return [...seoMap.entries()].map(([articleId, sc]) => {
    const a = byId.get(articleId) || {};
    return {
      articleId, title: a.title || null, verdict: sc.verdict,
      checkedAt: sc.created_at, stale: sc.created_at < (a.updated_at || ''),
    };
  });
}

async function sectionRevenue(env) {
  const row = await safeFirst(env, "SELECT setting_value FROM website_settings WHERE setting_key = 'total_revenue_usd' LIMIT 1");
  const total = row ? Number(row.setting_value) : 0;
  return {
    status: 'verified',
    source: 'website_settings.total_revenue_usd',
    totalRevenueUsd: Number.isFinite(total) ? total : 0,
    formatted: '$' + (Number.isFinite(total) ? total : 0).toFixed(2),
    adsenseConnected: false,
    note: 'Honest $0.00 — no sales, no AdSense account connected.',
    whatWouldMakeAvailable: 'Connect an AdSense account and record payouts in website_settings / revenue_records; revenue then reads the real stored figure.',
  };
}

/**
 * WS-E (2026-11-21) — article impressions / clicks / CTR.
 * VERIFIED only when website_analytics holds a row with a real source
 * and non-NULL metrics; CTR is computed from those two real numbers
 * and is null whenever either is missing. The seed row (source 'none',
 * NULL metrics) yields UNAVAILABLE with value null — never 0, never
 * an estimate. A snapshot older than 7 days is flagged stale.
 */
async function sectionImpressions(env, nowMs = Date.now()) {
  const latest = await safeFirst(env,
    'SELECT * FROM website_analytics ORDER BY recorded_date DESC LIMIT 1');
  if (!latest || !latest.source || latest.source === 'none'
    || (latest.page_views == null && latest.unique_visitors == null && latest.clicks == null)) {
    return { ...IMPRESSIONS_UNAVAILABLE };
  }
  const pageViews = latest.page_views == null ? null : toNum(latest.page_views);
  const visitors = latest.unique_visitors == null ? null : toNum(latest.unique_visitors);
  const clicks = latest.clicks == null ? null : toNum(latest.clicks);
  const ctr = pageViews != null && clicks != null && pageViews > 0
    ? Math.round((clicks / pageViews) * 1000) / 10 : null;
  const recordedMs = latest.recorded_date ? Date.parse(latest.recorded_date) : NaN;
  const stale = !Number.isFinite(recordedMs) || isStaleIso(latest.recorded_date, ANALYTICS_SNAPSHOT_STALE_AFTER_MS, nowMs);
  return {
    status: 'verified',
    source: `website_analytics (${latest.source})`,
    recordedDate: latest.recorded_date,
    pageViews, uniqueVisitors: visitors, clicks, ctr,
    ctrNote: ctr === null
      ? 'CTR is null — it needs real page_views AND clicks in the same snapshot; neither is estimated.'
      : 'CTR = clicks / page_views from the same stored snapshot.',
    topPage: latest.top_page || null,
    stale,
    staleNote: stale ? 'Snapshot is older than 7 days — treat the figures as out of date until a new snapshot is recorded.' : null,
  };
}

/** WS-E — Search Console performance: queries / clicks / impressions / position. */
async function sectionSearch() {
  return { ...SEARCH_PERF_UNAVAILABLE, manualNote: INDEXED_UNAVAILABLE.manualNote };
}

/** WS-E — indexed pages (Search Console). No stored count exists. */
async function sectionIndexed() {
  return { ...INDEXED_UNAVAILABLE };
}

/**
 * WS-E — video views / watch time. No YouTube Data API connection and
 * no video-metrics table exist, so both are UNAVAILABLE — never the
 * manual Studio figures, which are not stored anywhere.
 */
async function sectionVideo() {
  return {
    ...VIDEO_UNAVAILABLE,
    views: null,
    watchTimeMinutes: null,
  };
}

/** WS-E — traffic sources (search / social / direct / referral). */
async function sectionTrafficSources() {
  return { ...TRAFFIC_SOURCES_UNAVAILABLE };
}

async function sectionAiUsage(env) {
  const byProvider = await getAllProvidersDailyUsage(env);
  const todayCalls = Object.values(byProvider).reduce((a, u) => a + (u.requests || 0), 0);
  const todayNeurons = Object.values(byProvider).reduce((a, u) => a + (u.neurons || 0), 0);
  const todayEstimated = Object.values(byProvider).some((u) => u.neuronsEstimated === null)
    ? null
    : Object.values(byProvider).reduce((a, u) => a + (u.neuronsEstimated || 0), 0);
  const last7d = await safeFirst(env,
    "SELECT COUNT(*) AS calls, COALESCE(SUM(neurons), 0) AS neurons FROM llm_usage WHERE outcome IN ('ok', 'error') AND created_at >= datetime('now', '-7 days')");
  const capRow = await safeFirst(env, "SELECT value FROM autonomy_settings WHERE key = 'llm_daily_cap_neurons' LIMIT 1");
  const cap = capRow ? toNum(capRow.value) : DEFAULT_NEURON_CAP;
  const capNeurons = cap > 0 ? cap : DEFAULT_NEURON_CAP;
  return {
    today: {
      calls: todayCalls, neurons: todayNeurons,
      ...(todayEstimated === null ? {} : { neuronsEstimated: todayEstimated }),
      byProvider: Object.fromEntries(Object.entries(byProvider).map(([p, u]) => [p, {
        requests: u.requests, neurons: u.neurons,
        ...(u.neuronsEstimated === null ? {} : { neuronsEstimated: u.neuronsEstimated }),
      }])),
    },
    last7d: { calls: toNum(last7d && last7d.calls), neurons: toNum(last7d && last7d.neurons) },
    capNeurons,
    todayPctOfCap: capNeurons ? Math.round((todayNeurons / capNeurons) * 1000) / 10 : 0,
    remainingNeuronsToday: Math.max(0, capNeurons - todayNeurons),
    provider: 'workers-ai',
    note: 'Workers AI only — the only active LLM provider. Free tier: 9,000 Neurons/day cap.',
  };
}

/** Root cause for a failed task: the latest run's recorded reason/error. */
function rootCauseFromRun(run) {
  if (!run) return { rootCause: null, lastOutcome: null };
  let detail = {};
  try { detail = JSON.parse(run.detail || '{}'); } catch { detail = {}; }
  const cause = detail.reason || detail.error
    || (detail.result && (detail.result.reason || detail.result.error)) || null;
  return { rootCause: cause ? String(cause).slice(0, 500) : null, lastOutcome: run.outcome || null };
}

async function sectionErrors(env) {
  const failed = await d1All(env,
    "SELECT id, agent, kind, attempts, max_attempts, created_at, updated_at FROM agent_tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20") || [];
  const failedTasks = [];
  for (const t of failed) {
    const run = await safeFirst(env,
      'SELECT * FROM agent_runs WHERE task_id = ? ORDER BY id DESC LIMIT 1', [t.id]);
    const runCount = await safeFirst(env, 'SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?', [t.id]);
    const { rootCause, lastOutcome } = rootCauseFromRun(run);
    const exhausted = toNum(t.attempts) >= toNum(t.max_attempts);
    failedTasks.push({
      id: t.id, agent: t.agent, kind: t.kind,
      attempts: toNum(t.attempts), maxAttempts: toNum(t.max_attempts),
      createdAt: t.created_at, updatedAt: t.updated_at,
      rootCause, lastOutcome,
      retryHistory: { runs: toNum(runCount && runCount.n), attempts: toNum(t.attempts), maxAttempts: toNum(t.max_attempts) },
      // Temporary = still retryable; permanent = attempts exhausted.
      errorType: exhausted ? 'permanent' : 'temporary',
      ownerAction: exhausted,
      ownerActionNote: exhausted
        ? 'Attempts exhausted — owner decides: retry manually or leave failed.'
        : 'Retryable — use Retry in the task queue.',
    });
  }
  const failedRuns7d = await safeAll(env,
    "SELECT id, task_id, agent, outcome, started_at, finished_at FROM agent_runs WHERE outcome = 'failed' AND started_at >= datetime('now', '-7 days') ORDER BY started_at DESC LIMIT 20") || [];
  return { failedTasks, failedRuns7d: (failedRuns7d || []).map((r) => ({ id: r.id, taskId: r.task_id, agent: r.agent, outcome: r.outcome, startedAt: r.started_at, finishedAt: r.finished_at })) };
}

async function sectionQueue(env) {
  const counts = await d1All(env, 'SELECT status, COUNT(*) AS n FROM agent_tasks GROUP BY status') || [];
  const queue = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const r of counts) if (r.status in queue) queue[r.status] = toNum(r.n);
  const oldest = await safeFirst(env, "SELECT MIN(created_at) AS at, COUNT(*) AS n FROM agent_tasks WHERE status = 'queued'");
  const oldestAt = oldest ? oldest.at : null;
  const errors = await sectionErrors(env);
  return {
    counts: queue,
    oldestQueuedAt: oldestAt,
    oldestQueuedAgeHours: oldestAt ? Math.round((Date.now() - Date.parse(oldestAt)) / 3600000 * 10) / 10 : null,
    failedTasks: errors.failedTasks,
  };
}

async function sectionReports(env) {
  const rows = await d1All(env, 'SELECT * FROM daily_reports ORDER BY date DESC, id DESC LIMIT 10') || [];
  const parsed = rows.map((r) => ({ ...r, summary: safeJson(r.summary_json, null) }));
  const latestDaily = parsed.find((r) => r.kind === 'daily') || null;
  const latestWeekly = parsed.find((r) => r.kind === 'weekly') || null;
  return { latestDaily, latestWeekly, recent: parsed };
}

async function sectionActivity(env) {
  const rows = await d1All(env, 'SELECT * FROM agent_runs ORDER BY id DESC LIMIT 10') || [];
  return rows.map((r) => {
    const { rootCause } = rootCauseFromRun(r);
    return { id: r.id, taskId: r.task_id, agent: r.agent, outcome: r.outcome, startedAt: r.started_at, finishedAt: r.finished_at, reason: rootCause };
  });
}

async function sectionSocial(env) {
  // W4 owns the social tables / status endpoint. Until they exist, this
  // section is honestly unavailable — never a fabricated post count.
  const posts = await safeAll(env, 'SELECT COUNT(*) AS n FROM social_posts');
  const analytics = await safeAll(env, 'SELECT COUNT(*) AS n FROM social_analytics');
  if (posts === null && analytics === null) {
    return {
      ...SOCIAL_UNAVAILABLE,
      whatWouldMakeAvailable: 'Apply migration 022 (social_posts / social_analytics) and complete a platform OAuth; post counts then come from real D1 rows.',
    };
  }
  const byPlatform = await safeAll(env, 'SELECT platform, COUNT(*) AS posts FROM social_posts GROUP BY platform') || [];
  return {
    status: 'verified',
    source: 'D1 social_posts / social_analytics (W4 tables)',
    totalPosts: toNum(posts && posts[0] && posts[0].n),
    byPlatform: byPlatform.map((r) => ({ platform: r.platform, posts: toNum(r.posts) })),
    note: 'Counts from D1 social_posts / social_analytics (W4 tables).',
  };
}

async function sectionEngagement(env) {
  const rows = await safeAll(env, 'SELECT * FROM social_analytics ORDER BY recorded_at DESC LIMIT 20');
  if (rows === null) {
    return {
      ...ENGAGEMENT_UNAVAILABLE,
      whatWouldMakeAvailable: 'Apply migration 022 and complete a platform OAuth; engagement rows are recorded exactly as returned by the platforms, never estimated.',
    };
  }
  return {
    status: 'verified',
    source: 'D1 social_analytics (W4 table)',
    rows: rows || [],
    note: 'Rows from D1 social_analytics (W4 table) — values exactly as returned by the platforms.',
  };
}

/**
 * WS-E (2026-11-21) — analytics coverage table.
 * One row per metric the owner asked about. Status is derived from the
 * section data actually returned, never asserted: 'verified' only when
 * the section carries real D1/platform data, 'unavailable' otherwise.
 * NOTHING is 'estimated' anywhere in this codebase — there is no
 * estimation method, so no metric may claim that status until one is
 * built and labelled with its method.
 *
 * Feedback loop (verified by code inspection + tests/security-boundaries):
 * these sections are READ-ONLY. Analytics never writes a setting, never
 * changes publishing policy, and never starts a task — the only writer
 * of autonomy_settings is the owner-only POST /api/autonomy/settings
 * handler (backend/routes/orchestrator.js). The weekly report's
 * recommendations are human-readable strings only; an owner reads them
 * and acts, the system does not act on them.
 */
export function coverageTable(sections) {
  const s = sections || {};
  const statusOf = (name) => {
    const d = s[name];
    if (!d) return 'unavailable';
    if (d.status === 'verified' || d.status === 'available') return 'verified';
    return 'unavailable';
  };
  const reasonOf = (name, fallback) => {
    const d = s[name];
    if (!d) return fallback;
    return d.reason || d.note || fallback;
  };
  const whatOf = (name) => (s[name] && s[name].whatWouldMakeAvailable) || null;
  const rows = [
    { metric: 'articleImpressions', section: 'impressions', status: statusOf('impressions'), reason: reasonOf('impressions', 'No analytics snapshot in D1.'), whatWouldMakeAvailable: whatOf('impressions') },
    { metric: 'articleClicks', section: 'impressions', status: statusOf('impressions'), reason: reasonOf('impressions', 'No analytics snapshot in D1.'), whatWouldMakeAvailable: whatOf('impressions') },
    { metric: 'articleCtr', section: 'impressions', status: statusOf('impressions'), reason: s.impressions && s.impressions.ctr == null ? 'CTR needs real page_views AND clicks in the same snapshot.' : reasonOf('impressions', 'No analytics snapshot in D1.'), whatWouldMakeAvailable: whatOf('impressions') },
    { metric: 'searchPerformance', section: 'search', status: statusOf('search'), reason: reasonOf('search', 'Search Console data is not stored in D1.'), whatWouldMakeAvailable: whatOf('search') },
    { metric: 'indexedPages', section: 'indexed', status: statusOf('indexed'), reason: reasonOf('indexed', 'Indexed-page counts are not stored in D1.'), whatWouldMakeAvailable: whatOf('indexed') },
    { metric: 'socialEngagement', section: 'engagement', status: statusOf('engagement'), reason: reasonOf('engagement', 'No engagement data is stored in D1.'), whatWouldMakeAvailable: whatOf('engagement') },
    { metric: 'videoViews', section: 'video', status: statusOf('video'), reason: reasonOf('video', 'No video metrics are stored in D1.'), whatWouldMakeAvailable: whatOf('video') },
    { metric: 'watchTime', section: 'video', status: statusOf('video'), reason: reasonOf('video', 'No video metrics are stored in D1.'), whatWouldMakeAvailable: whatOf('video') },
    { metric: 'trafficSources', section: 'traffic-sources', status: statusOf('traffic-sources'), reason: reasonOf('traffic-sources', 'Traffic-source breakdown is not stored in D1.'), whatWouldMakeAvailable: whatOf('traffic-sources') },
    { metric: 'revenue', section: 'revenue', status: statusOf('revenue'), reason: reasonOf('revenue', 'Revenue reads website_settings.total_revenue_usd.'), whatWouldMakeAvailable: whatOf('revenue') },
  ];
  return {
    rows,
    verified: rows.filter((r) => r.status === 'verified').length,
    estimated: 0,
    unavailable: rows.filter((r) => r.status === 'unavailable').length,
    note: 'Estimated is always 0: this codebase has no estimation method, so no metric is ever labelled estimated.',
  };
}

const SECTIONS = {
  articles: sectionArticles,
  drafts: sectionDrafts,
  research: sectionResearch,
  factchecks: sectionFactchecks,
  seo: sectionSeo,
  traffic: async () => ({
    traffic: { ...GA4_UNAVAILABLE, whatWouldMakeAvailable: 'Connect the GA4 Data API and store snapshots in website_analytics; traffic then reads the real stored figures.' },
    search: { ...SEARCH_UNAVAILABLE, whatWouldMakeAvailable: SEARCH_PERF_UNAVAILABLE.whatWouldMakeAvailable },
  }),
  impressions: sectionImpressions,
  search: sectionSearch,
  indexed: sectionIndexed,
  video: sectionVideo,
  'traffic-sources': sectionTrafficSources,
  social: sectionSocial,
  engagement: sectionEngagement,
  revenue: sectionRevenue,
  'ai-usage': sectionAiUsage,
  errors: sectionErrors,
  queue: sectionQueue,
  reports: sectionReports,
  activity: sectionActivity,
};

export async function handleAnalyticsDetail(request, env) {
  if (request.method.toUpperCase() !== 'GET') return jsonError('Method not allowed', 405);
  if (!env.DB) return jsonError('Analytics detail requires the D1 database', 503);
  const url = new URL(request.url);
  const section = (url.searchParams.get('section') || 'all').toLowerCase();
  const now = new Date().toISOString();
  // WS-E: freshness.stale now propagates a section's own stale flag
  // (e.g. an impressions snapshot older than 7 days) instead of
  // always reporting false.
  const wrap = (data, asOf = now) => {
    const stale = Boolean(data && data.stale);
    return {
      data, asOf,
      freshness: {
        asOf, checkedAt: now, stale,
        note: stale ? 'Underlying data is stale — see the section data for the stale reason.' : 'Live D1 read at ' + now,
      },
    };
  };
  if (section === 'all') {
    const data = {};
    for (const [name, fn] of Object.entries(SECTIONS)) {
      try {
        const value = await fn(env);
        data[name] = wrap(value);
      } catch (err) {
        data[name] = wrap({ status: 'unavailable', reason: 'Section read failed: ' + String((err && err.message) || err).slice(0, 200), value: null });
        data[name].freshness.stale = true;
        data[name].freshness.note = 'Section read failed — showing unavailable, not fabricated data.';
      }
    }
    // Coverage table: one row per metric, derived from the sections
    // just read — verified only where real data exists.
    const plain = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.data]));
    const coverage = coverageTable(plain);
    return jsonOk({ section: 'all', data, coverage, asOf: now, freshness: { asOf: now, checkedAt: now, stale: Object.values(data).some((v) => v.freshness.stale), note: 'Live D1 read at ' + now }, source: 'd1' });
  }
  const fn = SECTIONS[section];
  if (!fn) return jsonError('Unknown analytics section: ' + section, 400, { sections: Object.keys(SECTIONS).concat(['all']) });
  try {
    const data = await fn(env);
    return jsonOk({ section, ...wrap(data), source: 'd1' });
  } catch (err) {
    return jsonOk({
      section,
      data: { status: 'unavailable', reason: 'Section read failed: ' + String((err && err.message) || err).slice(0, 200), value: null },
      asOf: now,
      freshness: { asOf: now, checkedAt: now, stale: true, note: 'Section read failed — showing unavailable, not fabricated data.' },
      source: 'd1',
    });
  }
}

export const HONEST_ANALYTICS = {
  visitors: 'Data unavailable',
  pageViews: 'Data unavailable',
  clicks: 'Data unavailable',
  revenue: 0,
  revenueCurrency: 'USD',
  revenueFormatted: '$0.00',
  analyticsConnected: false,
  analyticsStatus: 'Tracking Connected — Reporting API Not Connected',
  adsenseConnected: false,
  note: 'Tracking Connected — Reporting API Not Connected: GA4 tag G-JVSCJT2DHJ is on every public page, but no GA4 Reporting API is connected and no AdSense account is connected. Traffic is "Data unavailable" and revenue is $0.00 — honest zeros/unknowns, not estimates.',
};

export async function handleAnalytics(request, env) {
  if (request.method.toUpperCase() !== 'GET') return jsonError('Method not allowed', 405);

  if (env.DB) {
    const rows = await d1All(env,
      'SELECT * FROM website_analytics ORDER BY recorded_date DESC LIMIT 1');
    const latest = rows && rows[0];
    if (latest && latest.source && latest.source !== 'none') {
      const snapshotStale = isStaleIso(latest.recorded_date, ANALYTICS_SNAPSHOT_STALE_AFTER_MS);
      return jsonOk({
        ...HONEST_ANALYTICS,
        visitors: latest.unique_visitors ?? 'Data unavailable',
        pageViews: latest.page_views ?? 'Data unavailable',
        clicks: latest.clicks ?? 'Data unavailable',
        analyticsConnected: true,
        analyticsSource: latest.source,
        recordedDate: latest.recorded_date,
        snapshotStale,
        snapshotNote: snapshotStale ? 'Latest snapshot is older than 7 days — treat the figures as out of date until a new snapshot is recorded.' : null,
        topPage: latest.top_page || null,
        note: `Latest analytics snapshot (${latest.recorded_date}, source: ${latest.source}).`,
        source: 'd1',
      });
    }
    if (latest) {
      // A row exists but records that nothing is connected — honest fallback.
      return jsonOk({ ...HONEST_ANALYTICS, recordedDate: latest.recorded_date, snapshotStale: isStaleIso(latest.recorded_date, ANALYTICS_SNAPSHOT_STALE_AFTER_MS), source: 'd1' });
    }
  }
  return jsonOk({ ...HONEST_ANALYTICS, source: 'fallback' });
}
