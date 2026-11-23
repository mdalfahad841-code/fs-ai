/**
 * FS AI — Daily Autonomy Health Report (close-out A5, 2026-11-23).
 *
 * buildDailyHealthReport(env, opts) produces the owner-only report the
 * EXISTING daily run stores in its daily_reports row (summary.healthReport).
 * No new cron, no new table, no new endpoint: the scheduler wires it as
 * step (15) of runDailyWorkflow and the dashboard reads it back through
 * the existing owner-only GET /api/autonomy/reports endpoint. The report
 * is READ-ONLY: it never publishes, edits, fixes or deletes anything —
 * it only reads D1 and fetches public URLs.
 *
 * Statuses are exactly 'OK' | 'WARN' | 'FAIL' | 'NOT TESTED'.
 * Overall rule: FAIL if any check is FAIL, else WARN if any check is
 * WARN, else OK. NOT TESTED never degrades the overall — a check that
 * cannot run says so honestly instead of failing the day.
 *
 * Every check is individually try/caught: one bad check never aborts
 * the report, and a check that cannot run reports NOT TESTED with its
 * reason. The builder itself never throws for a missing table or a bad
 * row — on a catastrophic failure it returns a report whose checks are
 * all NOT TESTED with the builder error as the reason.
 *
 * Health input: the caller passes the runHealthCheck result the daily
 * run already computed in its queue-drain step (`health`). The builder
 * NEVER calls runHealthCheck itself — that function writes
 * system_health_checks rows, and a second call would double-write.
 *
 * Baselines (checks 8 + 9): the previous daily report's stored
 * healthReport snapshots are the baseline — NOT article_fingerprints
 * (those are as-of-last-SEO-check and provably stale: live #30 still
 * reads 4623 there, checked 2026-11-22T00:02, before the 22 Nov 19:30
 * correction to 4088). A first run records the baseline and reports
 * NOT TESTED for those two checks.
 *
 * Settings snapshot (check 9) EXCLUDES the key `auto_publish_proof`:
 * that key is the A6 proof artifact (the result of the first-real-
 * auto-publish verification), not a setting — recording it must never
 * show up as a "settings changed" warning. The proof itself is surfaced
 * by check 13 instead.
 *
 * Sitemap-refresh age (check 7) is REPORTED but never fails on age:
 * the >3 h staleness alert is close-out A7, not A5.
 *
 * The Daily Shorts cron (check 10) is ALWAYS NOT TESTED: it lives in
 * Muse (fs-ai-daily-short-upload), not in the Worker or D1, so the
 * Worker cannot read its state. No paused date is hardcoded here — it
 * would go stale on resume; the last-known state lives in the ledger.
 *
 * No secrets are read, stored or logged by any check. Details carry
 * only numbers, ids and short reasons — never article bodies.
 */
import { d1All, d1First } from '../middleware/validation.js';
import { bodyHash } from '../utils/bodyHash.js';

/** Public site base URL (no base-URL constant exists in backend/services/urls.js — that module only normalises URLs for comparison). */
export const PAGES_BASE = 'https://fs-ai-5w5.pages.dev';

/** Public repo the sitemap-refresh workflow runs in. */
export const GITHUB_REPO = 'mdalfahad841-code/fs-ai';

/** Per-fetch timeout, same AbortController pattern as backend/rss/rss.js fetchFeed. */
export const FETCH_TIMEOUT_MS = 10 * 1000;

/** Protected / legacy drafts whose bodies must never change unnoticed (live ids 26–33). */
export const PROTECTED_DRAFT_IDS = [26, 27, 28, 29, 30, 31, 33];

/** The A6 proof key: a verification artifact, excluded from the settings snapshot (see header). */
export const AUTO_PUBLISH_PROOF_KEY = 'auto_publish_proof';

export const HEALTH_REPORT_CHECK_KEYS = [
  'workerHealth', 'pages', 'sitemap', 'recentArticles', 'queue', 'lastRuns',
  'sitemapRefresh', 'protectedDrafts', 'settings', 'shortsCron', 'lastVideo',
  'cspViolations', 'autoPublishProof',
];

const OK = 'OK';
const WARN = 'WARN';
const FAIL = 'FAIL';
const NOT_TESTED = 'NOT TESTED';

function check(status, detail) {
  return { status, detail: detail || {} };
}

function notTested(reason) {
  return check(NOT_TESTED, { reason });
}

/** Overall from the per-check statuses: FAIL wins, then WARN; NOT TESTED never degrades. */
export function healthReportOverall(checks) {
  const list = Object.values(checks || {});
  if (list.some((c) => c && c.status === FAIL)) return FAIL;
  if (list.some((c) => c && c.status === WARN)) return WARN;
  return OK;
}

function isMissingTableError(err) {
  const text = String((err && err.message) || err || '');
  return /no such table/i.test(text) || /no such column/i.test(text);
}

async function safeAll(env, sql, params = []) {
  try {
    return await d1All(env, sql, params);
  } catch {
    return null;
  }
}

async function safeFirst(env, sql, params = []) {
  try {
    return await d1First(env, sql, params);
  } catch {
    return null;
  }
}

/** Parse a D1/SQLite timestamp to epoch ms (ISO or space format, UTC). Null when unparseable — never throws. */
function parseDbTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim();
  if (text.includes(' ')) text = text.replace(' ', 'T');
  if (!/[zZ]$/.test(text) && !/[+-]\d{2}:?\d{2}$/.test(text)) text += 'Z';
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function ageHoursFrom(ms, nowMs) {
  if (ms === null) return null;
  return Math.round(((nowMs - ms) / 3600000) * 10) / 10;
}

/**
 * Fetch with a 10 s timeout (AbortController, same pattern as
 * backend/rss/rss.js fetchFeed). Throws on timeout / network error so
 * callers can record the reason; returns the Response otherwise.
 */
async function fetchWithTimeout(fetchImpl, url, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

function fetchErrorReason(err) {
  if (err && err.name === 'AbortError') return 'fetch timed out after 10 s';
  return String((err && err.message) || err || 'fetch failed').slice(0, 200);
}

/* ------------------------------------------------------------------ */
/* Checks 1 + 5 — from the runHealthCheck result passed in.            */
/* ------------------------------------------------------------------ */

function healthComponent(health, component) {
  if (!health || !Array.isArray(health.checks)) return null;
  return health.checks.find((c) => c && c.component === component) || null;
}

function mapHealthStatus(status) {
  if (status === 'healthy') return OK;
  if (status === 'degraded') return WARN;
  if (status === 'blocked') return FAIL;
  return NOT_TESTED;
}

function workerHealthCheck(health) {
  if (!health || typeof health.overall !== 'string') {
    return notTested('No health-check result was passed in — the queue drain did not run or did not return one.');
  }
  const counts = { healthy: 0, degraded: 0, blocked: 0, 'not-configured': 0 };
  for (const c of Array.isArray(health.checks) ? health.checks : []) {
    if (c && Object.prototype.hasOwnProperty.call(counts, c.status)) counts[c.status] += 1;
  }
  return check(mapHealthStatus(health.overall), { overall: health.overall, counts });
}

function queueCheck(health) {
  const queue = healthComponent(health, 'queue');
  if (!queue) {
    return notTested('No queue component in the passed-in health-check result — the queue drain did not run or did not return one.');
  }
  const detail = queue.detail || {};
  const mapped = mapHealthStatus(queue.status);
  return check(mapped, {
    queued: typeof detail.queued === 'number' ? detail.queued : null,
    running: typeof detail.running === 'number' ? detail.running : null,
    stale: typeof detail.stale === 'number' ? detail.stale : null,
    oldestQueuedAt: detail.oldestQueuedAt || null,
    reason: detail.reason || null,
  });
}

/* ------------------------------------------------------------------ */
/* Checks 2–4 — public site fetches.                                   */
/* ------------------------------------------------------------------ */

async function pagesCheck(env, fetchImpl, pagesBase) {
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${pagesBase}/`);
  } catch (err) {
    return check(FAIL, { status: 0, url: `${pagesBase}/`, error: fetchErrorReason(err) });
  }
  if (res.status !== 200) {
    return check(FAIL, { status: res.status, url: `${pagesBase}/`, error: `Home page answered HTTP ${res.status}, expected 200.` });
  }
  return check(OK, { status: 200, url: `${pagesBase}/` });
}

function extractSitemapArticleIds(xml) {
  const ids = [];
  const locRe = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = locRe.exec(xml)) !== null) {
    const idMatch = /\/pages\/article\?id=(\d+)/.exec(m[1]);
    if (idMatch) ids.push(Number(idMatch[1]));
  }
  return ids;
}

async function sitemapCheck(env, fetchImpl, pagesBase) {
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${pagesBase}/sitemap.xml`);
  } catch (err) {
    return check(FAIL, { urlCount: 0, publishedCount: 0, missingIds: [], extraIds: [], error: fetchErrorReason(err) });
  }
  if (res.status !== 200) {
    return check(FAIL, { urlCount: 0, publishedCount: 0, missingIds: [], extraIds: [], error: `Sitemap answered HTTP ${res.status}, expected 200.` });
  }
  let xml = '';
  try {
    xml = await res.text();
  } catch (err) {
    return check(FAIL, { urlCount: 0, publishedCount: 0, missingIds: [], extraIds: [], error: `Sitemap body could not be read: ${fetchErrorReason(err)}` });
  }
  const urlCount = (xml.match(/<loc>/g) || []).length;
  const sitemapIds = extractSitemapArticleIds(xml);
  const sitemapSet = new Set(sitemapIds);
  const rows = (await safeAll(env, "SELECT id FROM articles WHERE status = 'published'")) || [];
  const publishedIds = rows.map((r) => Number(r.id));
  const publishedSet = new Set(publishedIds);
  const missingIds = publishedIds.filter((id) => !sitemapSet.has(id));
  const extraIds = sitemapIds.filter((id) => !publishedSet.has(id));
  const detail = { urlCount, publishedCount: publishedIds.length, missingIds, extraIds };
  if (missingIds.length > 0) {
    return check(FAIL, { ...detail, error: `Published article(s) missing from the sitemap: ${missingIds.join(', ')}.` });
  }
  if (extraIds.length > 0) {
    return check(WARN, { ...detail, error: `Sitemap lists article(s) not published in D1: ${extraIds.join(', ')}.` });
  }
  return check(OK, detail);
}

async function recentArticlesCheck(env, fetchImpl, pagesBase) {
  const rows = (await safeAll(env,
    "SELECT id FROM articles WHERE status = 'published' AND published_at >= datetime('now', '-1 day') ORDER BY published_at DESC LIMIT 5")) || [];
  const published = rows.map((r) => Number(r.id));
  const reachable = [];
  const unreachable = [];
  for (const id of published) {
    try {
      const res = await fetchWithTimeout(fetchImpl, `${pagesBase}/pages/article?id=${id}`);
      if (res.status === 200) reachable.push(id);
      else unreachable.push(id);
    } catch {
      unreachable.push(id);
    }
  }
  const detail = { published, reachable, unreachable };
  if (unreachable.length > 0) {
    return check(FAIL, { ...detail, error: `Article page(s) unreachable: ${unreachable.join(', ')}.` });
  }
  return check(OK, detail);
}

/* ------------------------------------------------------------------ */
/* Check 6 — last daily / weekly runs.                                 */
/* ------------------------------------------------------------------ */

async function lastRunsCheck(env, today, nowMs) {
  const dailyRow = await safeFirst(env,
    "SELECT date FROM daily_reports WHERE kind = 'daily' AND date < ? ORDER BY date DESC LIMIT 1", [today]);
  const weeklyRow = await safeFirst(env,
    "SELECT date FROM daily_reports WHERE kind = 'weekly' ORDER BY date DESC LIMIT 1");
  const daily = dailyRow && dailyRow.date
    ? { date: dailyRow.date, ageHours: ageHoursFrom(parseDbTime(`${dailyRow.date}T00:00:00Z`), nowMs) }
    : null;
  const weekly = weeklyRow && weeklyRow.date
    ? { date: weeklyRow.date, ageHours: ageHoursFrom(parseDbTime(`${weeklyRow.date}T00:00:00Z`), nowMs) }
    : null;
  const detail = { daily, weekly };
  let status = OK;
  if (daily === null && weekly === null) {
    return check(NOT_TESTED, { ...detail, reason: 'No previous daily or weekly report row exists yet.' });
  }
  if (daily === null || weekly === null) status = NOT_TESTED;
  if (daily !== null && (daily.ageHours === null || daily.ageHours > 36)) status = WARN;
  if (weekly !== null && (weekly.ageHours === null || weekly.ageHours > 8 * 24)) status = WARN;
  if (daily === null || weekly === null) {
    const missingReason = daily === null
      ? 'No previous daily report row exists yet.'
      : 'No weekly report row exists yet.';
    const staleNote = status === WARN ? ' The other report is stale — see its age above.' : '';
    return check(status, { ...detail, reason: missingReason + staleNote });
  }
  return check(status, detail);
}

/* ------------------------------------------------------------------ */
/* Check 7 — last sitemap-refresh workflow run (GitHub API, no auth).  */
/* A5 reports the age honestly; the >3 h staleness alert is A7.        */
/* ------------------------------------------------------------------ */

async function sitemapRefreshCheck(fetchImpl, githubRepo, nowMs) {
  const url = `https://api.github.com/repos/${githubRepo}/actions/workflows/sitemap-refresh.yml/runs?per_page=1`;
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FS-AI-Health-Report' },
    });
  } catch (err) {
    return notTested(`GitHub API fetch failed: ${fetchErrorReason(err)}`);
  }
  if (res.status !== 200) {
    return notTested(`GitHub API answered HTTP ${res.status} (rate-limited or forbidden — no auth is used by design).`);
  }
  let data = null;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return notTested('GitHub API answered 200 but the body was not parseable JSON.');
  }
  const run = data && Array.isArray(data.workflow_runs) ? data.workflow_runs[0] : null;
  if (!run) return notTested('GitHub API returned no workflow runs.');
  const createdAt = typeof run.created_at === 'string' ? run.created_at : null;
  const detail = {
    conclusion: run.conclusion ?? null,
    createdAt,
    ageHours: ageHoursFrom(parseDbTime(createdAt), nowMs),
    runId: typeof run.id === 'number' ? run.id : null,
    htmlUrl: typeof run.html_url === 'string' ? run.html_url : null,
  };
  if (run.conclusion === 'success') return check(OK, detail);
  if (run.conclusion === null || run.conclusion === undefined) {
    return notTested('Latest sitemap-refresh run is still in progress (no conclusion yet).');
  }
  if (['failure', 'cancelled', 'timed_out'].includes(run.conclusion)) {
    return check(WARN, { ...detail, reason: `Latest sitemap-refresh run concluded '${run.conclusion}'.` });
  }
  return check(WARN, { ...detail, reason: `Latest sitemap-refresh run concluded '${run.conclusion}'.` });
}

/* ------------------------------------------------------------------ */
/* Checks 8 + 9 — baselines from the previous daily report.            */
/* ------------------------------------------------------------------ */

/**
 * The previous daily report's stored healthReport snapshots (or null
 * when there is none / it cannot be read). `readError` is set when the
 * read itself failed, so the checks can say "could not read" instead
 * of the misleading "no baseline yet".
 */
async function readPreviousSnapshots(env, today) {
  try {
    const row = await d1First(env,
      "SELECT summary_json FROM daily_reports WHERE kind = 'daily' AND date < ? ORDER BY date DESC LIMIT 1", [today]);
    if (!row || typeof row.summary_json !== 'string') return { snapshots: null, readError: null };
    let summary = null;
    try {
      summary = JSON.parse(row.summary_json);
    } catch {
      return { snapshots: null, readError: 'Previous daily report summary_json is not parseable JSON.' };
    }
    const snapshots = summary && summary.healthReport && summary.healthReport.snapshots
      ? summary.healthReport.snapshots : null;
    return { snapshots, readError: null };
  } catch (err) {
    return { snapshots: null, readError: String((err && err.message) || err).slice(0, 200) };
  }
}

async function protectedDraftsCheck(env, prevSnapshots, prevReadError) {
  const rows = (await safeAll(env,
    `SELECT id, status, body FROM articles WHERE id IN (${PROTECTED_DRAFT_IDS.join(',')})`)) || [];
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const drafts = [];
  const missing = [];
  for (const id of PROTECTED_DRAFT_IDS) {
    const row = byId.get(id);
    if (!row) { missing.push(id); continue; }
    const body = typeof row.body === 'string' ? row.body : '';
    drafts.push({
      id,
      status: row.status,
      bodyLength: body.length,
      bodyHash: await bodyHash(body),
    });
  }
  const detail = { drafts, changed: [], missing };
  if (prevReadError) {
    return check(NOT_TESTED, { ...detail, reason: `Could not read the previous daily report for the baseline: ${prevReadError}` });
  }
  const prev = prevSnapshots && Array.isArray(prevSnapshots.protectedDrafts) ? prevSnapshots.protectedDrafts : null;
  if (!prev) {
    // First run: the check is NOT TESTED, but the CURRENT snapshot is
    // still in the detail — buildReport stores it as the baseline the
    // next run compares against. A NOT TESTED that dropped the
    // snapshot would never establish a baseline at all.
    return check(NOT_TESTED, { ...detail, reason: 'No prior health-report baseline yet — this run records the baseline.' });
  }
  const prevById = new Map(prev.map((d) => [Number(d.id), d]));
  for (const current of drafts) {
    const before = prevById.get(current.id);
    if (!before) {
      detail.changed.push({ id: current.id, before: null, after: current });
      continue;
    }
    if (before.status !== current.status || before.bodyLength !== current.bodyLength || before.bodyHash !== current.bodyHash) {
      detail.changed.push({ id: current.id, before, after: current });
    }
  }
  for (const id of missing) {
    if (prevById.has(id)) detail.changed.push({ id, before: prevById.get(id), after: null });
  }
  if (missing.length > 0 || detail.changed.length > 0) {
    return check(FAIL, {
      ...detail,
      error: missing.length > 0
        ? `Protected draft(s) missing from D1: ${missing.join(', ')}.`
        : `Protected draft(s) changed since the last daily report: ${detail.changed.map((c) => c.id).join(', ')}.`,
    });
  }
  return check(OK, detail);
}

async function settingsCheck(env, prevSnapshots, prevReadError) {
  const autonomyRows = (await safeAll(env, 'SELECT key, value FROM autonomy_settings')) || [];
  const websiteRows = (await safeAll(env, 'SELECT setting_key, setting_value FROM website_settings')) || [];
  // auto_publish_proof is the A6 proof artifact, not a setting (see header).
  const autonomy = {};
  for (const r of autonomyRows) {
    if (r.key === AUTO_PUBLISH_PROOF_KEY) continue;
    autonomy[r.key] = r.value;
  }
  const website = {};
  for (const r of websiteRows) website[r.setting_key] = r.setting_value;
  const detail = { changed: [], autonomyKeys: Object.keys(autonomy).length, websiteKeys: Object.keys(website).length };
  if (prevReadError) {
    return notTested(`Could not read the previous daily report for the baseline: ${prevReadError}`);
  }
  const prev = prevSnapshots && prevSnapshots.settings ? prevSnapshots.settings : null;
  if (!prev || typeof prev.autonomy !== 'object' || typeof prev.website !== 'object') {
    return notTested('No prior health-report baseline yet — this run records the baseline.');
  }
  const diff = (before, after) => {
    const changed = [];
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const key of keys) {
      const b = before ? before[key] : undefined;
      const a = after ? after[key] : undefined;
      if (b !== a) changed.push({ key, before: b === undefined ? null : b, after: a === undefined ? null : a });
    }
    return changed;
  };
  detail.changed = [...diff(prev.autonomy, autonomy), ...diff(prev.website, website)];
  if (detail.changed.length > 0) {
    return check(WARN, {
      ...detail,
      reason: `Setting(s) changed since the last daily report: ${detail.changed.map((c) => c.key).join(', ')} (an owner change is legitimate — the report surfaces it).`,
    });
  }
  return check(OK, detail);
}

/* ------------------------------------------------------------------ */
/* Checks 10–13.                                                       */
/* ------------------------------------------------------------------ */

function shortsCronCheck() {
  return notTested('The daily Shorts cron lives in Muse (fs-ai-daily-short-upload), not in the Worker or D1 — the Worker cannot read its state. Resuming it is owner-gated (close-out C4).');
}

async function lastVideoCheck(env) {
  let row = null;
  try {
    row = await d1First(env,
      'SELECT video_key, kind, article_id, title, published_at FROM youtube_videos ORDER BY published_at DESC LIMIT 1');
  } catch (err) {
    if (isMissingTableError(err)) return notTested('youtube_videos table is absent (migration 028 not applied).');
    return notTested(`youtube_videos could not be read: ${String((err && err.message) || err).slice(0, 200)}`);
  }
  if (!row) {
    return notTested('youtube_videos has 0 rows in D1 — video outcomes live in the local pipeline log, not in D1; the D1 mirror is fed by manual Studio import only (migration 028).');
  }
  const video = {
    videoKey: row.video_key, kind: row.kind, articleId: row.article_id,
    title: row.title, publishedAt: row.published_at,
  };
  let perf = null;
  try {
    const perfRow = await d1First(env,
      'SELECT views, stayed_pct, observed_at FROM youtube_performance WHERE video_key = ? ORDER BY observed_at DESC LIMIT 1',
      [row.video_key]);
    if (perfRow) {
      perf = { views: perfRow.views ?? null, stayedPct: perfRow.stayed_pct ?? null, observedAt: perfRow.observed_at ?? null };
    }
  } catch {
    perf = null;
  }
  return check(OK, { video, latestPerformance: perf });
}

async function cspViolationsCheck(env) {
  let rows = null;
  try {
    rows = await d1All(env,
      "SELECT directive, COUNT(*) AS n FROM csp_reports WHERE reported_at >= datetime('now', '-7 days') GROUP BY directive ORDER BY n DESC");
  } catch (err) {
    if (isMissingTableError(err)) return notTested('csp_reports table is absent (migration 030 not applied).');
    return notTested(`csp_reports could not be read: ${String((err && err.message) || err).slice(0, 200)}`);
  }
  const byDirective = (rows || []).map((r) => ({ directive: r.directive, count: Number(r.n || 0) }));
  const total = byDirective.reduce((sum, r) => sum + r.count, 0);
  const detail = { total, byDirective };
  if (total === 0) return check(OK, detail);
  return check(WARN, {
    ...detail,
    reason: `${total} CSP violation report(s) in the last 7 days — CSP is Report-Only, so nothing broke; the reports need review.`,
  });
}

async function autoPublishProofCheck(env) {
  const row = await safeFirst(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [AUTO_PUBLISH_PROOF_KEY]);
  if (!row || typeof row.value !== 'string' || !row.value) {
    return notTested('No auto-published article has been verified yet — run docs/CLOSEOUT-A6-AUTO-PUBLISH-PROOF-2026-11-23.md after the first real auto-publish; its result is recorded here.');
  }
  let proof = null;
  try {
    proof = JSON.parse(row.value);
  } catch {
    return check(FAIL, { error: 'auto_publish_proof is recorded but unreadable (not parseable JSON).' });
  }
  const detail = {
    articleId: proof && typeof proof.articleId === 'number' ? proof.articleId : null,
    verifiedAt: proof && typeof proof.verifiedAt === 'string' ? proof.verifiedAt : null,
    verdict: proof && typeof proof.verdict === 'string' ? proof.verdict : null,
    checks: proof && typeof proof.checks === 'object' ? proof.checks : null,
  };
  if (proof && proof.verdict === 'pass') return check(OK, detail);
  return check(FAIL, { ...detail, error: `Recorded auto-publish proof has verdict '${detail.verdict}' (expected 'pass').` });
}

/* ------------------------------------------------------------------ */
/* Builder.                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the Daily Autonomy Health Report. Reads D1 + public URLs only;
 * writes nothing. `health` is the runHealthCheck result the daily run
 * already computed (queue-drain step) — never re-fetched here.
 * Returns { date, generatedAt, overall, checks, snapshots }.
 */
export async function buildDailyHealthReport(env, {
  health = null,
  fetchImpl = fetch,
  nowMs = Date.now(),
  pagesBase = PAGES_BASE,
  githubRepo = GITHUB_REPO,
} = {}) {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const generatedAt = new Date(nowMs).toISOString();
  try {
    return await buildReport(env, { health, fetchImpl, nowMs, pagesBase, githubRepo, date, generatedAt });
  } catch (err) {
    // Catastrophic builder failure: never throw into the daily run —
    // return a report whose checks all honestly say NOT TESTED.
    const reason = `Health-report builder failed: ${String((err && err.message) || err).slice(0, 200)}`;
    const checks = {};
    for (const key of HEALTH_REPORT_CHECK_KEYS) checks[key] = notTested(reason);
    return { date, generatedAt, overall: OK, checks, snapshots: { protectedDrafts: [], settings: { autonomy: {}, website: {} } } };
  }
}

async function buildReport(env, { health, fetchImpl, nowMs, pagesBase, githubRepo, date, generatedAt }) {
  const checks = {};
  const runCheck = async (key, fn) => {
    try {
      checks[key] = await fn();
    } catch (err) {
      checks[key] = notTested(`Check could not run: ${String((err && err.message) || err).slice(0, 200)}`);
    }
  };

  // The previous daily report's snapshots feed checks 8 + 9 (one read).
  const { snapshots: prevSnapshots, readError: prevReadError } = await readPreviousSnapshots(env, date);

  await runCheck('workerHealth', () => Promise.resolve(workerHealthCheck(health)));
  await runCheck('pages', () => pagesCheck(env, fetchImpl, pagesBase));
  await runCheck('sitemap', () => sitemapCheck(env, fetchImpl, pagesBase));
  await runCheck('recentArticles', () => recentArticlesCheck(env, fetchImpl, pagesBase));
  await runCheck('queue', () => Promise.resolve(queueCheck(health)));
  await runCheck('lastRuns', () => lastRunsCheck(env, date, nowMs));
  await runCheck('sitemapRefresh', () => sitemapRefreshCheck(fetchImpl, githubRepo, nowMs));
  await runCheck('protectedDrafts', () => protectedDraftsCheck(env, prevSnapshots, prevReadError));
  await runCheck('settings', () => settingsCheck(env, prevSnapshots, prevReadError));
  await runCheck('shortsCron', () => Promise.resolve(shortsCronCheck()));
  await runCheck('lastVideo', () => lastVideoCheck(env));
  await runCheck('cspViolations', () => cspViolationsCheck(env));
  await runCheck('autoPublishProof', () => autoPublishProofCheck(env));

  // Snapshots are the baselines the NEXT daily report compares against.
  // They are taken from the same reads the checks just did, so the
  // stored baseline and the reported check can never disagree.
  const snapshots = {
    protectedDrafts: checks.protectedDrafts && Array.isArray(checks.protectedDrafts.detail.drafts)
      ? checks.protectedDrafts.detail.drafts : [],
    settings: await currentSettingsSnapshot(env),
  };

  return { date, generatedAt, overall: healthReportOverall(checks), checks, snapshots };
}

async function currentSettingsSnapshot(env) {
  const autonomyRows = (await safeAll(env, 'SELECT key, value FROM autonomy_settings')) || [];
  const websiteRows = (await safeAll(env, 'SELECT setting_key, setting_value FROM website_settings')) || [];
  const autonomy = {};
  for (const r of autonomyRows) {
    if (r.key === AUTO_PUBLISH_PROOF_KEY) continue;
    autonomy[r.key] = r.value;
  }
  const website = {};
  for (const r of websiteRows) website[r.setting_key] = r.setting_value;
  return { autonomy, website };
}
