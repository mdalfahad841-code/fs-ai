/**
 * FS AI — Autonomy: publishing agent handler.
 *
 * Two paths, deliberately separate:
 *
 * 1. runPublishing() (unchanged): the scheduled path. It only calls
 *    the existing publishDueArticles() (owner-approved articles whose
 *    publish_at has passed) and returns its result. The Emergency Stop
 *    skip inside publishDueArticles is honoured and reported as a no-op.
 *
 * 2. autoPublishArticle() (W3, NEW): the autonomous path. It publishes
 *    ONLY articles created AFTER autonomous publishing ships that pass
 *    EVERY check in evaluateAutoPublishEligibility() — fresh
 *    hash-matching fact-check, fresh full SEO (11/11, 0% duplicate
 *    overlap, genuinely relevant internal links), sources with URLs,
 *    no open corrections, banner gone, E-Stop off, under the daily
 *    limit, BOTH publishing flags on, and the owner-set
 *    auto_publish_eligible_since cutoff. Existing drafts #28/#29/#30/
 *    #31 are refused unconditionally (by id AND by the created_at
 *    cutoff); protected articles (#26/#27) are refused too. Auto-publish
 *    stays OFF by default — this code never flips a setting.
 *
 * Zero-failure rules in the auto path:
 *  - Pre-flight: the publication_logs table must exist (migration 021)
 *    BEFORE any publish is attempted; every attempt (success AND
 *    refusal) writes a log row.
 *  - Idempotency: a second attempt for an already auto-published
 *    article no-ops (one success log + one refusal log, never two
 *    publishes); the status flip itself is a single conditional
 *    UPDATE ... WHERE status IN ('draft','approved'), so a concurrent
 *    double-fire cannot publish twice.
 *  - Interrupted publish: if the success-log write (or the sitemap
 *    regeneration) fails AFTER the status flip, the article is rolled
 *    back to its previous status and the call reports FAILURE — never
 *    a silent success. If the rollback itself fails, the result says
 *    so explicitly (publishedButUnlogged: true) with a critical alert.
 *  - Failure alerts carry article id, component, root cause, timestamp,
 *    retry history and an owner-action flag; temporary errors (E-Stop,
 *    daily limit) are distinguished from permanent gate failures
 *    (BLOCKED_WITH_REASON — no retry loop).
 *  - Sitemap: regenerateSitemap() rebuilds the sitemap XML from the
 *    LIVE published rows in D1 and returns it. The Worker cannot
 *    rewrite the checked-in public/sitemap.xml at runtime, so the
 *    caller (deploy step / a future dynamic /sitemap.xml route — see
 *    the coordinator snippet in the W3 report) must write/serve the
 *    returned XML; the publish result reports sitemapUpdated so a
 *    missing sitemap update is visible, never assumed.
 */
import { publishDueArticles } from '../../routes/admin-articles.js';
import { d1All, d1First, d1Run, nowIso } from '../../middleware/validation.js';
import { getEmergencyStop } from '../../routes/admin.js';
import { hasDraftBanner, stripDraftBanner } from '../../utils/draftBanner.js';
import {
  AUTO_PUBLISH_CUTOFF_SETTING, DHAKA_DAY_START_SQL, LEGACY_AUTO_PUBLISH_REFUSED_IDS,
  buildFailureAlert, countPublishedTodayDhaka, evaluateAutoPublishEligibility,
} from '../../publishing/gate.js';
import { isProtected } from '../../publishing/protection.js';

/**
 * Dhaka calendar day for a Date (default now), as YYYY-MM-DD.
 * Dhaka is UTC+6 with no daylight saving, so shifting the instant by
 * +6h and taking the UTC date is the Dhaka date. Used as the
 * reservation key — the daily limit is per Dhaka day, matching
 * countPublishedTodayDhaka (gate.js).
 */
export function dhakaDayString(date = new Date()) {
  return new Date(date.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

/** True when migration 026's reservation table exists (a probe SELECT, never a write). */
export async function reservationTableExists(env) {
  try {
    await d1First(env, 'SELECT 1 AS one FROM daily_publication_reservations LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic daily-publication reservation (Workstream A, task C —
 * the TOCTOU fix, 2026-11-21).
 *
 * THE RACE: evaluateAutoPublishEligibility() checks the daily limit
 * (published-today < limit) and autoPublishArticle() then flips the
 * status — but between the check and the flip a concurrent job can
 * pass the same check and flip a DIFFERENT article, so two articles
 * publish on a 1-per-day limit. The old conditional UPDATE only
 * stopped the SAME article publishing twice.
 *
 * THE FIX: a single atomic statement reserves one slot for this
 * article on this Dhaka day — the INSERT only happens when the count
 * of live reservations (consumed, plus reserved-within-10-minutes)
 * is below the limit. One statement = one atomic step in SQLite/D1,
 * so two concurrent calls cannot both see "one slot free". The
 * reservation is CONSUMED on a successful publish and RELEASED on
 * any failure, so a failed publish never consumes the limit and a
 * retry can reserve again. A reservation older than 10 minutes is
 * stale (a publish takes seconds; a crashed job must not block the
 * rest of the day) and no longer counts.
 *
 * Returns { reserved: true, dhakaDay } or { reserved: false,
 * dhakaDay, reason }. Never throws — callers treat a failure to
 * reserve as a refusal, never as a go-ahead.
 */
export async function reserveDailyPublicationSlot(env, articleId, limit) {
  const dhakaDay = dhakaDayString();
  try {
    // One statement = one atomic step in SQLite/D1, so two concurrent
    // calls cannot both see "one slot free". ON CONFLICT re-uses a
    // RELEASED row for the same article+day (a retry after a failed
    // publish — the UNIQUE(dhaka_day, article_id) key would otherwise
    // refuse the retry forever); the upsert's WHERE only re-reserves
    // 'released' rows, never a 'reserved' or 'consumed' one.
    const res = await d1Run(env,
      `INSERT INTO daily_publication_reservations (dhaka_day, article_id, status, reserved_at)
       SELECT ?, ?, 'reserved', ?
       WHERE (SELECT COUNT(*) FROM daily_publication_reservations
              WHERE dhaka_day = ?
                AND (status = 'consumed'
                     OR (status = 'reserved' AND datetime(reserved_at) >= datetime('now', '-10 minutes')))) < ?
       ON CONFLICT(dhaka_day, article_id) DO UPDATE
         SET status = 'reserved', reserved_at = excluded.reserved_at, released_at = NULL
         WHERE daily_publication_reservations.status = 'released'`,
      [dhakaDay, Number(articleId), nowIso(), dhakaDay, Number(limit)]);
    if (res && res.meta && res.meta.changes === 1) return { reserved: true, dhakaDay };
    return { reserved: false, dhakaDay, reason: `Daily publication limit reached for ${dhakaDay} (${limit} per day) — another publication already holds the slot.` };
  } catch (err) {
    return { reserved: false, dhakaDay, reason: `Reservation write failed: ${String((err && err.message) || err)}`, error: String((err && err.message) || err) };
  }
}

/** Mark a reservation consumed after a successful publish. Best-effort; never throws. */
export async function consumeDailyPublicationSlot(env, articleId, dhakaDay) {
  try {
    await d1Run(env,
      "UPDATE daily_publication_reservations SET status = 'consumed' WHERE dhaka_day = ? AND article_id = ? AND status = 'reserved'",
      [dhakaDay, Number(articleId)]);
    return true;
  } catch {
    return false;
  }
}

/** Release a reservation after a failed publish, so the slot is free for a retry. Best-effort; never throws. */
export async function releaseDailyPublicationSlot(env, articleId, dhakaDay) {
  try {
    await d1Run(env,
      "UPDATE daily_publication_reservations SET status = 'released', released_at = ? WHERE dhaka_day = ? AND article_id = ? AND status = 'reserved'",
      [nowIso(), dhakaDay, Number(articleId)]);
    return true;
  } catch {
    return false;
  }
}

export const SITE_URL = 'https://fs-ai-5w5.pages.dev';

export async function runPublishing(task, env) {
  const result = await publishDueArticles(env);
  if (!result.ok) return { outcome: 'failed', error: result.error || 'Scheduled publish failed.' };
  if (result.skipped) {
    return { outcome: 'no-op', reason: result.reason || 'Emergency Stop is on.', published: 0 };
  }
  return { outcome: 'done', published: result.published || 0, slugs: result.slugs || [] };
}

async function setting(env, key, fallback) {
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [key]);
    return row && typeof row.value === 'string' ? row.value : fallback;
  } catch {
    return fallback;
  }
}

/** True when migration 021's table exists (a probe SELECT, never a write). */
export async function publicationLogTableExists(env) {
  try {
    await d1First(env, 'SELECT 1 AS one FROM publication_logs LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Append-only log write. Never throws: a failed log is reported in the
 * return value so the caller can refuse/roll back instead of silently
 * succeeding. Never deletes rows.
 */
export async function logPublicationAttempt(env, { articleId, action, actor, gateVerdict, publishedAt = null, sitemapUpdated = false }) {
  try {
    const res = await d1Run(env,
      'INSERT INTO publication_logs (article_id, action, actor, gate_verdict_json, published_at, sitemap_updated) VALUES (?, ?, ?, ?, ?, ?)',
      [articleId, action, actor, JSON.stringify(gateVerdict || {}), publishedAt, sitemapUpdated ? 1 : 0]);
    return { logged: true, logId: res && res.meta ? res.meta.last_row_id : null };
  } catch (err) {
    return { logged: false, error: String((err && err.message) || err) };
  }
}

// ---------------------------------------------------------------------------
// Sitemap (live-D1 generation — see the module header for the deploy note).
// ---------------------------------------------------------------------------

/**
 * Pure sitemap builder from live rows: home, the divisions index, one
 * entry per active division, one entry per published article (lastmod =
 * published_at), tools index, about/contact/privacy/terms. Drafts are
 * NEVER listed. The 20 per-tool pages stay in backend/services/seo.js
 * (the deploy-time generator) — this builder covers the article and
 * division entries the publish path must keep fresh.
 */
export function sitemapXmlForArticles(publishedArticles, divisions) {
  const escapeXml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const entries = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: 1.0 },
    { loc: `${SITE_URL}/pages/division`, changefreq: 'weekly', priority: 0.8 },
    ...(divisions || []).map((d) => ({ loc: `${SITE_URL}/pages/division?division=${d.slug}`, changefreq: 'weekly', priority: 0.8 })),
    ...(publishedArticles || []).map((a) => ({
      loc: `${SITE_URL}/pages/article?id=${a.id}`,
      lastmod: a.published_at || '',
      changefreq: 'monthly',
      priority: 0.7,
    })),
    { loc: `${SITE_URL}/pages/tools`, changefreq: 'weekly', priority: 0.6 },
    { loc: `${SITE_URL}/pages/about`, changefreq: 'monthly', priority: 0.3 },
    { loc: `${SITE_URL}/pages/contact`, changefreq: 'monthly', priority: 0.3 },
    { loc: `${SITE_URL}/pages/privacy`, changefreq: 'weekly', priority: 0.3 },
    { loc: `${SITE_URL}/pages/terms`, changefreq: 'weekly', priority: 0.3 },
  ];
  const urls = entries.map((e) => {
    const lastmod = e.lastmod ? `\n    <lastmod>${escapeXml(e.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(e.loc)}</loc>${lastmod}\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`;
  }).join('\n');
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
    entries,
  };
}

export function sitemapIncludesArticle(xml, articleId) {
  return typeof xml === 'string' && xml.includes(`/pages/article?id=${Number(articleId)}`);
}

/** Rebuild the sitemap XML from the live published rows in D1. Read-only. */
export async function regenerateSitemap(env) {
  const articles = await d1All(env,
    "SELECT id, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC, id DESC") || [];
  const divisions = await d1All(env,
    'SELECT slug FROM business_divisions WHERE is_active = 1 ORDER BY sort_order ASC, id ASC') || [];
  const { xml, entries } = sitemapXmlForArticles(articles, divisions);
  return { ok: true, xml, entries: entries.length, articleCount: articles.length };
}

// ---------------------------------------------------------------------------
// Autonomous publish.
// ---------------------------------------------------------------------------

function refusal(env, articleId, verdict, reason, { errorKind = 'permanent', ownerActionRequired = true } = {}) {
  const alert = buildFailureAlert({
    articleId, component: 'auto-publish', rootCause: reason, errorKind, ownerActionRequired, retryHistory: [],
  });
  return { ok: false, outcome: 'refused', articleId, reason, errorKind, ownerActionRequired, alert, gateVerdict: verdict || null };
}

/**
 * Publish one article autonomously. Returns { ok: true, outcome:
 * 'published', ... } ONLY when the status flip, the success log row
 * AND the sitemap regeneration all succeeded. Any failure after the
 * flip rolls the article back and reports { ok: false }.
 */
export async function autoPublishArticle(env, articleId, { retryHistory = [] } = {}) {
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, outcome: 'failed', errorKind: 'permanent', error: 'Invalid article id.', articleId: id };
  }

  // Pre-flight 1: the audit table must exist — without it no publish
  // can be logged, so no publish may happen (fail-closed).
  if (!(await publicationLogTableExists(env))) {
    const reason = 'publication_logs table is missing — apply migration 021 before enabling auto-publish. Nothing was published.';
    return {
      ok: false, outcome: 'blocked', articleId: id, reason, errorKind: 'permanent', ownerActionRequired: true,
      alert: buildFailureAlert({ articleId: id, component: 'auto-publish', rootCause: reason, errorKind: 'permanent', ownerActionRequired: true, retryHistory }),
    };
  }

  // Pre-flight 2: the article must exist and be a candidate at all.
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1', [id]);
  if (!article) {
    const verdict = { articleId: id, eligible: false, verdict: 'blocked', blockedBy: [`Article ${id} not found.`] };
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: verdict });
    return refusal(env, id, verdict, `Article ${id} not found.`);
  }
  if (article.status === 'published') {
    const verdict = { articleId: id, eligible: false, verdict: 'blocked', blockedBy: ['Article is already published.'] };
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: verdict });
    return refusal(env, id, verdict, 'Article is already published.');
  }

  // Pre-flight 3: full eligibility evaluation (never bypass a check).
  const verdict = await evaluateAutoPublishEligibility(env, id);
  if (!verdict.eligible) {
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: verdict });
    return {
      ok: false, outcome: 'refused', articleId: id,
      reason: verdict.blockedBy.join('; '), reasons: verdict.blockedBy,
      errorKind: verdict.errorKind, ownerActionRequired: verdict.errorKind === 'permanent',
      alert: verdict.failureAlert, gateVerdict: verdict,
    };
  }

  // Pre-flight 4: protected articles (#26/#27) — defence in depth;
  // the evaluator already refuses legacy ids 28-31 and protected rows.
  if (await isProtected(env, id)) {
    const v = { ...verdict, eligible: false, verdict: 'blocked', blockedBy: [...verdict.blockedBy, `Article #${id} is protected — automatic modification disabled.`] };
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: v });
    return refusal(env, id, v, `Article #${id} is protected — automatic modification disabled.`);
  }

  // Pre-flight 5: banner strip — a banner that survives the strip
  // refuses the publish (same shared rule as the manual path).
  const cleanedBody = stripDraftBanner(article.body || '');
  if (hasDraftBanner(cleanedBody)) {
    const v = { ...verdict, eligible: false, verdict: 'blocked', blockedBy: [...verdict.blockedBy, 'AI-DRAFT banner survives the strip — remove it before publishing.'] };
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: v });
    return refusal(env, id, v, 'AI-DRAFT banner survives the strip — remove it before publishing. Nothing was published.');
  }

  // Pre-flight 6: idempotency — an earlier successful auto-publish of
  // this article makes this attempt a no-op (never a second publish).
  const prior = await d1First(env,
    "SELECT id FROM publication_logs WHERE article_id = ? AND action = 'auto-publish' AND published_at IS NOT NULL LIMIT 1", [id]);
  if (prior) {
    const v = { ...verdict, eligible: false, verdict: 'blocked', blockedBy: [...verdict.blockedBy, 'Article was already auto-published (idempotency guard).'] };
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: v });
    return refusal(env, id, v, 'Article was already auto-published — second attempt no-ops (idempotency guard).');
  }

  // Pre-flight 7: atomic daily-slot reservation (Workstream A, task C
  // — the TOCTOU fix). The evaluator (pre-flight 3) already checked
  // the daily limit, but that check and the flip below are not
  // atomic: two concurrent jobs could both pass it and publish two
  // different articles on a 1-per-day limit. The reservation closes
  // the gap — one slot per Dhaka day, reserved here, consumed on
  // success, released on any failure. Pre-026 databases (no
  // reservation table) fall back to the guarded conditional UPDATE
  // below, which re-checks the published-today count INSIDE the
  // UPDATE so it too is atomic.
  const limitRaw = await setting(env, 'max_articles_per_day', '1');
  const dailyLimit = Number.parseInt(limitRaw, 10);
  const limit = Number.isFinite(dailyLimit) && dailyLimit >= 0 ? dailyLimit : 1;
  const hasReservationTable = await reservationTableExists(env);
  let dhakaDay = null;
  let useGuardedUpdate = false;
  if (hasReservationTable) {
    const slot = await reserveDailyPublicationSlot(env, id, limit);
    dhakaDay = slot.dhakaDay;
    if (!slot.reserved) {
      const v = { ...verdict, eligible: false, verdict: 'blocked', blockedBy: [...verdict.blockedBy, slot.reason] };
      await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: v });
      return {
        ok: false, outcome: 'refused', articleId: id, reason: slot.reason,
        errorKind: 'temporary', ownerActionRequired: false,
        alert: buildFailureAlert({ articleId: id, component: 'auto-publish', rootCause: slot.reason, errorKind: 'temporary', ownerActionRequired: false, retryHistory }),
        gateVerdict: v,
      };
    }
  } else {
    useGuardedUpdate = true;
  }

  // Publish: ONE conditional UPDATE so a concurrent double-fire cannot
  // publish twice (the second UPDATE matches 0 rows).
  const now = nowIso();
  const prevStatus = article.status;
  const prevBody = article.body;
  // Rollback restores the article EXACTLY as it was — including the
  // previous updated_at — so a rolled-back publish does not itself
  // invalidate the fresh SEO/fact-check timestamps (2026-11-21 fix:
  // stamping nowIso() here made the SEO check stale by the timestamp
  // fallback and the retry then refused).
  const prevUpdatedAt = article.updated_at;
  const bodyChanged = cleanedBody !== (article.body || '');
  // Pre-026 fallback (no reservation table): the published-today
  // count is a predicate INSIDE the UPDATE, so the limit check and
  // the flip are one atomic step — a concurrent job flipping first
  // makes this UPDATE match 0 rows instead of exceeding the limit.
  const limitPredicate = useGuardedUpdate
    ? ` AND (SELECT COUNT(*) FROM articles WHERE status = 'published' AND datetime(published_at) >= ${DHAKA_DAY_START_SQL}) < ?`
    : '';
  const updateSql = bodyChanged
    ? `UPDATE articles SET status = 'published', fact_checked = 1, published_at = ?, body = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'approved')${limitPredicate}`
    : `UPDATE articles SET status = 'published', fact_checked = 1, published_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'approved')${limitPredicate}`;
  const updateParams = bodyChanged ? [now, cleanedBody, now, id, ...(useGuardedUpdate ? [limit] : [])] : [now, now, id, ...(useGuardedUpdate ? [limit] : [])];
  let updated;
  try {
    updated = await d1Run(env, updateSql, updateParams);
  } catch (err) {
    if (dhakaDay) await releaseDailyPublicationSlot(env, id, dhakaDay);
    const reason = `Publish UPDATE failed: ${String((err && err.message) || err)}`;
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: verdict });
    return { ok: false, outcome: 'failed', articleId: id, reason, errorKind: 'temporary', ownerActionRequired: false, alert: buildFailureAlert({ articleId: id, component: 'auto-publish', rootCause: reason, errorKind: 'temporary', ownerActionRequired: false, retryHistory }), gateVerdict: verdict };
  }
  if (!updated || !updated.meta || updated.meta.changes !== 1) {
    if (dhakaDay) await releaseDailyPublicationSlot(env, id, dhakaDay);
    const reason = useGuardedUpdate
      ? 'Publish UPDATE matched 0 rows — the daily limit was already reached, or the article status changed concurrently. Nothing was published twice.'
      : 'Publish UPDATE matched 0 rows — the article status changed concurrently (or it was published by another run). Nothing was published twice.';
    await logPublicationAttempt(env, { articleId: id, action: 'auto-publish-refused', actor: 'system-auto', gateVerdict: verdict });
    return { ok: false, outcome: 'refused', articleId: id, reason, errorKind: 'temporary', ownerActionRequired: false, alert: buildFailureAlert({ articleId: id, component: 'auto-publish', rootCause: reason, errorKind: 'temporary', ownerActionRequired: false, retryHistory }), gateVerdict: verdict };
  }

  // The article is now published. Everything after this point must
  // succeed or the flip is rolled back — a publish without its log
  // row must never report success.
  const rollback = async () => {
    try {
      const rolled = await d1Run(env,
        "UPDATE articles SET status = ?, fact_checked = 0, published_at = NULL, body = ?, updated_at = ? WHERE id = ? AND status = 'published' AND published_at = ?",
        [prevStatus, prevBody, prevUpdatedAt, id, now]);
      if (rolled && rolled.meta && rolled.meta.changes === 1) {
        // The publish did not stick, so the slot is free again — a
        // retry must be able to reserve it (a failed publish never
        // consumes the daily limit).
        if (dhakaDay) await releaseDailyPublicationSlot(env, id, dhakaDay);
        await logPublicationAttempt(env, { articleId: id, action: 'publish-rollback', actor: 'system-auto', gateVerdict: verdict });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  let sitemap;
  try {
    sitemap = await regenerateSitemap(env);
  } catch (err) {
    const rolledBack = await rollback();
    const reason = `Sitemap regeneration failed after publish (${String((err && err.message) || err)}) — publish rolled back: ${rolledBack ? 'yes' : 'NO — ROLLBACK FAILED, article is published without a log row'}.`;
    return {
      ok: false, outcome: 'failed', articleId: id, reason, errorKind: 'temporary', ownerActionRequired: true,
      publishedButUnlogged: !rolledBack, rolledBack,
      alert: buildFailureAlert({ articleId: id, component: 'auto-publish', rootCause: reason, errorKind: 'temporary', ownerActionRequired: true, retryHistory }),
      gateVerdict: verdict,
    };
  }

  const sitemapUpdated = sitemapIncludesArticle(sitemap.xml, id);
  const logged = await logPublicationAttempt(env, {
    articleId: id, action: 'auto-publish', actor: 'system-auto',
    gateVerdict: verdict, publishedAt: now, sitemapUpdated,
  });
  if (!logged.logged) {
    const rolledBack = await rollback();
    const reason = `Publication log write failed (${logged.error || 'unknown error'}) — publish rolled back: ${rolledBack ? 'yes' : 'NO — ROLLBACK FAILED, article is published without a log row'}.`;
    return {
      ok: false, outcome: 'failed', articleId: id, reason, errorKind: 'temporary', ownerActionRequired: true,
      publishedButUnlogged: !rolledBack, rolledBack,
      alert: buildFailureAlert({ articleId: id, component: 'auto-publish', rootCause: reason, errorKind: 'temporary', ownerActionRequired: true, retryHistory }),
      gateVerdict: verdict,
    };
  }

  // Success: the reservation is consumed — the slot is spent, and a
  // second article today cannot reserve it.
  if (dhakaDay) await consumeDailyPublicationSlot(env, id, dhakaDay);

  return {
    ok: true, outcome: 'published', articleId: id, publishedAt: now,
    sitemapUpdated, sitemapEntries: sitemap.entries, sitemapArticleCount: sitemap.articleCount,
    logId: logged.logId, gateVerdict: verdict,
  };
}

/**
 * Autonomous publish run: tries NEW candidate drafts (created after
 * auto_publish_eligible_since, not legacy, not protected) oldest first
 * until one publishes or the daily limit is reached. Pre-flights once
 * for the two master flags and the E-Stop so a disabled system logs
 * NOTHING per article — a no-op, not a wall of refusals. The daily
 * workflow would call this (scheduler.js is NOT edited here — the
 * coordinator wires the call behind the existing flags check).
 */
export async function runAutoPublish(env, { maxAttempts = 5 } = {}) {
  const mode = await setting(env, 'publishing_mode', 'approved_only');
  const autoPublishing = await setting(env, 'auto_publishing', 'off');
  if (mode === 'approved_only' || autoPublishing !== 'on') {
    return { ok: true, outcome: 'no-op', published: 0, attempted: 0, reason: mode === 'approved_only' ? "publishing_mode is 'approved_only' — auto-publish is disabled." : 'Auto-publishing is off.' };
  }
  if (await getEmergencyStop(env)) {
    return { ok: true, outcome: 'no-op', published: 0, attempted: 0, reason: 'Emergency Stop is on.' };
  }
  const eligibleSince = await setting(env, AUTO_PUBLISH_CUTOFF_SETTING, null);
  if (typeof eligibleSince !== 'string' || !eligibleSince.trim()) {
    return { ok: true, outcome: 'no-op', published: 0, attempted: 0, reason: 'auto_publish_eligible_since is not set — nothing is auto-publish-eligible until the owner sets it.' };
  }
  const maxPerDayRaw = await setting(env, 'max_articles_per_day', '1');
  const maxPerDay = Number.parseInt(maxPerDayRaw, 10);
  const limit = Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 1;
  const legacyPlaceholders = LEGACY_AUTO_PUBLISH_REFUSED_IDS.map(() => '?').join(', ');
  const candidates = await d1All(env,
    `SELECT id FROM articles WHERE status IN ('draft', 'approved') AND datetime(created_at) >= datetime(?) AND id NOT IN (${legacyPlaceholders}) AND COALESCE(is_protected, 0) = 0 ORDER BY created_at ASC, id ASC LIMIT ?`,
    [eligibleSince, ...LEGACY_AUTO_PUBLISH_REFUSED_IDS, maxAttempts]) || [];
  const results = [];
  let published = 0;
  for (const candidate of candidates) {
    if (published + (await countPublishedTodayDhaka(env)) >= limit) break;
    const attempt = await autoPublishArticle(env, candidate.id);
    results.push(attempt);
    if (attempt.ok && attempt.outcome === 'published') {
      published += 1;
      break; // one publish per run is enough — the daily limit is 1 by default.
    }
  }
  return { ok: true, outcome: published ? 'done' : 'no-op', published, attempted: results.length, results };
}
