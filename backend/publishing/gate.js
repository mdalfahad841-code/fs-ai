/**
 * FS AI — publish gate.
 *
 * The gate is the only path an automatically generated article can take
 * to publication. evaluatePublishGate() checks, in order: fact-check
 * passes, no unresolved important errors, required sources verified,
 * correction re-check passes, SEO passes, duplicate check passes,
 * Emergency Stop off, daily limit respected, publishing rules permit,
 * and no high-risk/special-review block. It reports two verdicts:
 * `contentReady` (all content checks pass — the article is ready for
 * owner approval) and `eligible` (contentReady AND auto-publishing is
 * permitted right now). With the live default publishing_mode of
 * 'approved_only', eligible is always false and nothing auto-publishes;
 * publishGatePassed() refuses to approve until the owner changes the
 * mode explicitly. When the gate does publish, it sets fact_checked=1
 * and records a revision first — the fact-checker itself never sets it.
 */
import { d1All, d1First, d1Run, nowIso, DISCLAIMER_DIVISIONS, isMissingColumnError } from '../middleware/validation.js';
import { getEmergencyStop } from '../routes/admin.js';

async function setting(env, key, fallback) {
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [key]);
    return row && typeof row.value === 'string' ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export async function evaluatePublishGate(env, articleId) {
  const id = Number(articleId);
  const checks = [];
  const blockedBy = [];
  const contentBlockers = [];
  const push = (name, ok, detail, content = true) => {
    checks.push({ name, ok, detail });
    if (!ok) {
      blockedBy.push(detail);
      if (content) contentBlockers.push(detail);
    }
  };
  if (!Number.isInteger(id) || id <= 0) {
    return { articleId: id, eligible: false, contentReady: false, checks: [], blockedBy: ['Invalid article id.'], contentBlockers: ['Invalid article id.'] };
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1', [id]);
  if (!article) {
    return { articleId: id, eligible: false, contentReady: false, checks: [], blockedBy: [`Article ${id} not found.`], contentBlockers: [`Article ${id} not found.`] };
  }
  if (article.status === 'published') {
    push('not-already-published', false, 'Article is already published.');
    return { articleId: id, eligible: false, contentReady: false, checks, blockedBy, contentBlockers };
  }

  // 1. Fact-check passes (latest run).
  const latestCheck = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  push('fact-check-pass', Boolean(latestCheck && latestCheck.verdict === 'pass'),
    latestCheck ? `Latest fact-check verdict: ${latestCheck.verdict} (${latestCheck.claims_verified}/${latestCheck.claims_total} claims verified).` : 'No fact-check on record for this article.');

  // 2. No unresolved important errors.
  const unresolved = latestCheck ? Number(latestCheck.claims_failed || 0) : 0;
  push('no-unresolved-errors', unresolved === 0,
    unresolved ? `${unresolved} claim(s) still failed in the latest fact-check.` : 'No unresolved claim errors.');

  // 3. Required sources verified: at least one recorded source, and every
  // VERIFIED claim in the latest run cites an evidence URL.
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ?', [id]) || [];
  let sourcesOk = sources.length > 0;
  let sourcesDetail = `${sources.length} source(s) recorded for this article.`;
  if (latestCheck) {
    const unverifiedCited = await d1First(env,
      "SELECT COUNT(*) AS n FROM claim_checks WHERE fact_check_id = ? AND verdict = 'VERIFIED' AND (evidence_url IS NULL OR evidence_url = '')",
      [latestCheck.id]);
    if (unverifiedCited && Number(unverifiedCited.n) > 0) {
      sourcesOk = false;
      sourcesDetail = `${unverifiedCited.n} VERIFIED claim(s) cite no evidence URL.`;
    }
  }
  push('sources-verified', sourcesOk, sourcesDetail);

  // 4. Correction re-check: no correction left pending/failed.
  // Phase 3, Priority 5: the gate counts unresolved CLAIMS, not rows.
  // A claim is unresolved when its LATEST correction row is still
  // pending/failed — an earlier failed row followed by an applied row
  // is resolved, and duplicate open rows for one claim count once.
  // Before migration 017 (no claim_key column) the old row-count
  // query is used instead.
  let openCorrections = null;
  try {
    openCorrections = await d1First(env,
      "SELECT COUNT(*) AS n FROM (SELECT COALESCE(claim_key, original_text) AS k, MAX(id) AS max_id FROM article_corrections WHERE article_id = ? GROUP BY k) latest JOIN article_corrections c ON c.id = latest.max_id WHERE c.status IN ('pending', 'failed')", [id]);
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    openCorrections = await d1First(env,
      "SELECT COUNT(*) AS n FROM article_corrections WHERE article_id = ? AND status IN ('pending', 'failed')", [id]);
  }
  push('correction-recheck', !(openCorrections && Number(openCorrections.n) > 0),
    openCorrections && Number(openCorrections.n) > 0
      ? `${openCorrections.n} correction claim(s) still pending or failed.`
      : 'No open corrections (re-check passes or nothing to correct).');

  // 5. SEO passes (latest run).
  const latestSeo = await d1First(env,
    'SELECT * FROM seo_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  push('seo-pass', Boolean(latestSeo && latestSeo.verdict === 'pass'),
    latestSeo ? `Latest SEO verdict: ${latestSeo.verdict}.` : 'No SEO check on record for this article.');

  // 6. Duplicate check passes (from the latest SEO run's checks JSON).
  let duplicateOk = false;
  let duplicateDetail = 'No SEO check on record — duplicate status unknown.';
  if (latestSeo) {
    try {
      const parsed = JSON.parse(latestSeo.checks_json || '[]');
      const dup = parsed.find((c) => c.name === 'duplicate');
      duplicateOk = Boolean(dup && dup.ok);
      duplicateDetail = dup ? dup.detail : 'Duplicate check missing from the latest SEO run.';
    } catch {
      duplicateDetail = 'Latest SEO checks JSON is unreadable.';
    }
  }
  push('duplicate-pass', duplicateOk, duplicateDetail);

  // 7. High-risk / special review: health + finance divisions need the disclaimer.
  const needsDisclaimer = DISCLAIMER_DIVISIONS.has(article.division);
  const hasDisclaimer = /General information only/i.test(String(article.body || ''));
  push('special-review', !needsDisclaimer || hasDisclaimer,
    needsDisclaimer
      ? (hasDisclaimer ? 'High-risk division disclaimer present.' : 'Special review: general-information disclaimer missing.')
      : 'Not a high-risk division.');

  const contentReady = contentBlockers.length === 0;

  // 8. Emergency Stop off.
  const stopped = await getEmergencyStop(env);
  push('emergency-stop-off', !stopped, stopped ? 'Emergency Stop is ON.' : 'Emergency Stop is OFF.', false);

  // 9. Daily limit respected.
  const maxPerDayRaw = await setting(env, 'max_articles_per_day', '1');
  const maxPerDay = Number.parseInt(maxPerDayRaw, 10);
  const limit = Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 1;
  const publishedToday = await d1First(env,
    "SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at >= datetime('now', 'start of day')");
  const publishedCount = Number(publishedToday ? publishedToday.n : 0);
  push('daily-limit', publishedCount < limit,
    `Published today: ${publishedCount}/${limit}.`, false);

  // 10. Publishing rules permit auto-publishing: BOTH the mode must
  // allow it AND the auto_publishing toggle must be on. With the live
  // default (mode 'approved_only') this always fails and nothing
  // auto-publishes; auto_publishing='on' alone never publishes either.
  const mode = await setting(env, 'publishing_mode', 'approved_only');
  const autoPublishing = await setting(env, 'auto_publishing', 'off');
  const rulesOk = mode !== 'approved_only' && autoPublishing === 'on';
  push('publishing-rules', rulesOk,
    mode === 'approved_only'
      ? "publishing_mode is 'approved_only' — gate-passed articles wait for owner approval, nothing auto-publishes."
      : autoPublishing !== 'on'
        ? "Auto-publishing is off — gate-passed articles wait for owner approval."
        : `publishing_mode is '${mode}' and auto-publishing is on — auto-publishing permitted.`, false);

  const eligible = contentReady && blockedBy.length === 0;
  return { articleId: id, eligible, contentReady, checks, blockedBy, contentBlockers, publishingMode: mode };
}

/**
 * Approve a gate-passed article (status='approved', publish_at=now) so
 * the normal publishDueArticles() run publishes it. Refuses unless the
 * gate is fully eligible — including the publishing mode. Sets
 * fact_checked=1 and records a pre-approval revision.
 */
export async function publishGatePassed(env, articleId, { dailyLimit } = {}) {
  const gate = await evaluatePublishGate(env, articleId);
  if (!gate.eligible) {
    return { ok: false, error: `Publish gate not passed: ${gate.blockedBy.join('; ')}` };
  }
  if (dailyLimit !== undefined) {
    const publishedToday = await d1First(env,
      "SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at >= datetime('now', 'start of day')");
    if (Number(publishedToday ? publishedToday.n : 0) >= dailyLimit) {
      return { ok: false, error: `Daily limit reached (${dailyLimit} article(s) per day).` };
    }
  }
  const article = await d1First(env, 'SELECT * FROM articles WHERE id = ? LIMIT 1', [articleId]);
  if (!article) return { ok: false, error: `Article ${articleId} not found.` };
  await d1Run(env,
    'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
    [articleId, article.title, article.excerpt || null, article.body, article.status, 'publish-gate']);
  const now = nowIso();
  await d1Run(env,
    "UPDATE articles SET status = 'approved', fact_checked = 1, publish_at = ?, updated_at = ? WHERE id = ?",
    [now, now, articleId]);
  return { ok: true, articleId, approvedAt: now };
}
