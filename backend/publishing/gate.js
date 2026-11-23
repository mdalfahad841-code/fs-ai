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
import { bodyHash } from '../utils/bodyHash.js';
import { claimKey } from '../agents/autonomy/factcheck.js';
import { hasDraftBanner, stripDraftBanner } from '../utils/draftBanner.js';
import {
  adviceClaimNeedsAuthority, extractLinkedArticleIds, getDivisionConfig,
  isAuthoritativeSource, isInternalLinkRelevant, isSpecialReviewDivision,
} from './divisions.js';

/**
 * Parse a D1 timestamp for comparison. D1 stores two shapes:
 * nowIso() ('2026-11-21T06:00:00.123Z') and SQLite datetime('now')
 * ('2026-11-21 06:00:00'). Lexicographic comparison across the two
 * shapes is WRONG (a 'T' sorts after a space, so any same-date ISO
 * time compares greater than any same-date SQLite time). Normalise
 * both to epoch ms; NaN when unparseable (callers fail closed).
 */
export function parseDbTime(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const s = value.trim();
  if (s.includes('T')) return Date.parse(s);
  const ms = Date.parse(`${s.replace(' ', 'T')}Z`);
  return ms;
}

/** Dhaka-day start as a SQLite datetime expression (owner timezone). */
export const DHAKA_DAY_START_SQL = "datetime('now', '+6 hours', 'start of day', '-6 hours')";

/** Drafts that predate autonomous publishing — refused by id, always. */
export const LEGACY_AUTO_PUBLISH_REFUSED_IDS = [28, 29, 30, 31];
/** autonomy_settings key holding the enable timestamp (absent = NULL = nothing eligible). */
export const AUTO_PUBLISH_CUTOFF_SETTING = 'auto_publish_eligible_since';
/**
 * SEO checks that may NEVER be waived, even if an owner-configured
 * waiver list names them: an unrelated internal link and a duplicate
 * body are safety properties, not presentation. Default waiver list
 * is empty (no waivers) — see evaluateAutoPublishEligibilityPure.
 */
export const NEVER_WAIVABLE_SEO_CHECKS = ['internal-links', 'duplicate'];

async function setting(env, key, fallback) {
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [key]);
    return row && typeof row.value === 'string' ? row.value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Open-correction count for the publish gate (check 4) and the
 * auto-publish eligibility wrapper — the SINGLE counting rule, so the
 * two verdicts can never disagree about corrections.
 *
 * Phase 3, Priority 5: the gate counts unresolved CLAIMS, not rows —
 * a claim is open when its LATEST correction row is still
 * pending/failed; an earlier failed row followed by an applied row is
 * resolved, and duplicate open rows for one claim count once.
 *
 * B6 (2026-11-23): the latest row per claim is not enough — a row can
 * go STALE. Live #33 kept 4 attempt-1 'failed' rows whose claims the
 * fresh latest fact-check (fc 34, 15/15 PASS) judged VERIFIED on full
 * evidence — those claims never needed a correction, but the gate
 * counted them and stayed Blocked. Live #30 kept rows for claims its
 * correction had removed or reworded, so the fresh latest run (fc 35)
 * no longer contains them at all. A stale row is history, not
 * outstanding work — so when the latest fact-check run is FRESH (its
 * recorded body_hash matches the article's current body), a correction
 * counts as open ONLY if its claim still appears in that run with a
 * verdict other than VERIFIED. A claim absent from the fresh run is
 * gone from the body (removed/reworded); its correction rows are not
 * counted. When the latest run is stale or absent there is no run to
 * judge staleness against, so the count falls back to the latest-row
 * rule (fail-closed — the pre-B6 behaviour). Before migration 017 (no
 * claim_key column) the old row-count query is used instead.
 *
 * Claim identity is claimKey() (factcheck.js) — the same 200-char
 * truncated key the correction flow writes — so a backfilled key and a
 * fresh run's claim text compare equal. The truncation is lossy (two
 * long claims can share a 200-char prefix); a collision can only
 * over-count, never hide a genuinely failing claim the run still lists.
 */
export async function countOpenCorrections(env, articleId, { latestCheck = null, currentBodyHash = null } = {}) {
  let latestRows;
  try {
    latestRows = await d1All(env,
      "SELECT c.id, c.claim_key, c.original_text FROM (SELECT COALESCE(claim_key, original_text) AS k, MAX(id) AS max_id FROM article_corrections WHERE article_id = ? GROUP BY k) latest JOIN article_corrections c ON c.id = latest.max_id WHERE c.status IN ('pending', 'failed')",
      [articleId]) || [];
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    const row = await d1First(env,
      "SELECT COUNT(*) AS n FROM article_corrections WHERE article_id = ? AND status IN ('pending', 'failed')", [articleId]);
    return Number(row ? row.n : 0);
  }
  const fresh = Boolean(latestCheck)
    && typeof latestCheck.body_hash === 'string' && latestCheck.body_hash.length > 0
    && typeof currentBodyHash === 'string' && currentBodyHash.length > 0
    && latestCheck.body_hash === currentBodyHash;
  if (!fresh) return latestRows.length;
  const claimRows = await d1All(env,
    'SELECT claim_text, verdict FROM claim_checks WHERE fact_check_id = ?', [latestCheck.id]) || [];
  const unresolvedKeys = new Set();
  for (const r of claimRows) {
    if (r.verdict !== 'VERIFIED') unresolvedKeys.add(claimKey(r.claim_text || ''));
  }
  let open = 0;
  for (const row of latestRows) {
    if (unresolvedKeys.has(row.claim_key || claimKey(row.original_text || ''))) open += 1;
  }
  return open;
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

  // 1. Fact-check passes (latest run) — and the run must be FRESH:
  // it must correspond to the article body as it stands now. A body
  // edit after the latest check, or a legacy run with no recorded
  // body hash, makes the result STALE (fail-closed): an edited
  // article must never keep an old PASS at the gate (live #31: the
  // body was rewritten after fact_check 19, but the gate still read
  // its PASS). The same staleness also gates checks 2 and 3 below —
  // a stale run must not satisfy them either.
  const latestCheck = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  const currentBodyHash = await bodyHash(article.body);
  const storedBodyHash = latestCheck ? (latestCheck.body_hash || null) : null;
  const factCheckStale = Boolean(latestCheck) && (storedBodyHash === null || storedBodyHash !== currentBodyHash);
  const staleDetail = storedBodyHash === null
    ? 'fact-check is stale: the latest fact-check was recorded before body-hash tracking — run a fresh fact-check.'
    : 'fact-check is stale: article body changed after the latest fact-check — run a fresh fact-check.';
  push('fact-check-pass', Boolean(latestCheck && latestCheck.verdict === 'pass' && !factCheckStale),
    !latestCheck ? 'No fact-check on record for this article.'
      : factCheckStale ? staleDetail
      : `Latest fact-check verdict: ${latestCheck.verdict} (${latestCheck.claims_verified}/${latestCheck.claims_total} claims verified).`);

  // 2. No unresolved important errors (in the latest run — a stale
  // run satisfies nothing).
  const unresolved = latestCheck ? Number(latestCheck.claims_failed || 0) : 0;
  push('no-unresolved-errors', !factCheckStale && unresolved === 0,
    factCheckStale ? staleDetail
      : unresolved ? `${unresolved} claim(s) still failed in the latest fact-check.` : 'No unresolved claim errors.');

  // 3. Required sources verified: at least one recorded source, and every
  // VERIFIED claim in the latest run cites an evidence URL. A stale run
  // satisfies nothing — its VERIFIED claims may describe a body that no
  // longer exists.
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ?', [id]) || [];
  // FIX (W3 inconsistency #3): the old check counted any recorded row,
  // even one with no URL — a sourceless row satisfied "sources verified".
  // A source only counts when it carries a URL (the evidence signature);
  // a row without one is not evidence of anything.
  const sourcesWithUrl = sources.filter((s) => typeof s.source_url === 'string' && s.source_url.trim().length > 0);
  let sourcesOk = sourcesWithUrl.length > 0;
  let sourcesDetail = sources.length === 0
    ? '0 source(s) recorded for this article.'
    : sourcesWithUrl.length === 0
      ? `${sources.length} source(s) recorded, but none carries a URL.`
      : `${sourcesWithUrl.length} source(s) with a URL recorded for this article.`;
  if (factCheckStale) {
    sourcesOk = false;
    sourcesDetail = staleDetail;
  } else if (latestCheck) {
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
  // Counted by countOpenCorrections() (the single rule shared with
  // the auto-publish wrapper): latest row per claim, ignoring rows
  // the fresh latest fact-check has judged stale — VERIFIED there, or
  // gone from the body entirely (live #33 / #30, B6).
  const openCorrections = await countOpenCorrections(env, id, { latestCheck, currentBodyHash });
  push('correction-recheck', openCorrections === 0,
    openCorrections > 0
      ? `${openCorrections} correction claim(s) still pending or failed.`
      : 'No open corrections (re-check passes or nothing to correct).');

  // 5. SEO passes (latest run) — and the run must be FRESH (W3
  // inconsistency #1 fix): before this fix only fact-check checks 1-3
  // rejected stale results, so an edited body kept its old SEO verdict
  // (a changed title kept a passing seo-title, a deleted link kept a
  // passing internal-links). isSeoCheckStale() prefers a recorded
  // body_hash when the seo_checks row carries one (W2's planned
  // column); until then it falls back to timestamps — the article's
  // updated_at must not be newer than the check's created_at by more
  // than SEO_STALE_GRACE_MS (SQLite datetime('now') truncates to whole
  // seconds and the repair-then-record spans two D1 round-trips, so a
  // fresh run can legitimately read up to ~1s newer; 5s covers that
  // without letting a real later edit slip far. Any body edit ALSO
  // stales the fact-check hash above, so the residual window covers
  // metadata-only edits only — and it closes entirely once W2's
  // body_hash column lands, because the hash path then decides).
  const latestSeo = await d1First(env,
    'SELECT * FROM seo_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  const seoStale = isSeoCheckStale(article, latestSeo, currentBodyHash);
  push('seo-pass', Boolean(latestSeo && latestSeo.verdict === 'pass' && !seoStale),
    !latestSeo ? 'No SEO check on record for this article.'
      : seoStale ? 'SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.'
      : `Latest SEO verdict: ${latestSeo.verdict}.`);

  // 6. Duplicate check passes (from the latest SEO run's checks JSON).
  // A stale SEO run satisfies nothing — its duplicate verdict describes
  // a body that no longer exists.
  let duplicateOk = false;
  let duplicateDetail = 'No SEO check on record — duplicate status unknown.';
  if (latestSeo && seoStale) {
    duplicateDetail = 'SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.';
  } else if (latestSeo) {
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

  // 9. Daily limit respected — counted on the owner's Dhaka day (W3
  // inconsistency #2 fix). The old query used datetime('now', 'start
  // of day'), i.e. the UTC day: an article published at 02:00 Dhaka
  // counted toward the PREVIOUS UTC day, so two publishes inside one
  // Dhaka day could both pass the limit. datetime(published_at)
  // normalises the stored ISO timestamps before comparing (a raw
  // string comparison across the 'T' vs ' ' timestamp shapes is wrong).
  const maxPerDayRaw = await setting(env, 'max_articles_per_day', '1');
  const maxPerDay = Number.parseInt(maxPerDayRaw, 10);
  const limit = Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 1;
  const publishedToday = await d1First(env,
    `SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND datetime(published_at) >= ${DHAKA_DAY_START_SQL}`);
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
      `SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND datetime(published_at) >= ${DHAKA_DAY_START_SQL}`);
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

/**
 * FS AI — autonomous-publish eligibility (W3).
 *
 * evaluateAutoPublishEligibilityPure() is the SINGLE evaluator for
 * automatic publishing. It is pure and testable: every input is
 * injected (article + checks + settings), nothing is read from D1
 * inside it. evaluateAutoPublishEligibility() is the thin D1 wrapper
 * that loads those inputs and delegates. autoPublishArticle()
 * (backend/agents/autonomy/publishing.js) is the only caller that
 * publishes on the back of this verdict.
 *
 * STRICTER than evaluatePublishGate() on purpose: the old gate
 * reports `contentReady` (ready for OWNER approval). This evaluator
 * answers the narrower question "may the SYSTEM publish this without
 * a human?" — so it additionally requires: the article is NEW (created
 * after auto_publish_eligible_since, never a legacy draft), SEO is
 * fresh AND complete (11/11, no waivers by default, internal-links
 * never waivable), duplicate overlap is exactly 0%, every internal
 * link is genuinely relevant, Health/Finance are never auto-eligible,
 * and the banner is gone. A single failed check refuses the publish.
 * Nothing here flips a setting: enabling still requires the owner to
 * set publishing_mode + auto_publishing + auto_publish_eligible_since.
 */

/** Grace for the timestamp fallback in isSeoCheckStale (see below). */
export const SEO_STALE_GRACE_MS = 5000;

/**
 * True when an SEO check must not be trusted for the article as it
 * stands now. Prefers a recorded body_hash when the row carries one
 * (W2's planned seo_checks.body_hash column — hash mismatch or a
 * missing hash on a hashed run is stale); until that column exists it
 * falls back to timestamps: the article's updated_at must not be newer
 * than the check's created_at by more than SEO_STALE_GRACE_MS. Either
 * timestamp unparseable is stale (fail-closed). No check at all is
 * stale.
 */
export function isSeoCheckStale(article, seoCheck, currentBodyHash) {
  if (!seoCheck) return true;
  if (typeof seoCheck.body_hash === 'string' && seoCheck.body_hash.length > 0) {
    if (typeof currentBodyHash !== 'string' || !currentBodyHash) return true;
    return seoCheck.body_hash !== currentBodyHash;
  }
  const updatedMs = parseDbTime(article ? article.updated_at : null);
  const checkedMs = parseDbTime(seoCheck.created_at);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(checkedMs)) return true;
  return updatedMs - checkedMs > SEO_STALE_GRACE_MS;
}

/** Published-today count on the owner's Dhaka day (see DHAKA_DAY_START_SQL). */
export async function countPublishedTodayDhaka(env) {
  const row = await d1First(env,
    `SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND datetime(published_at) >= ${DHAKA_DAY_START_SQL}`);
  return Number(row ? row.n : 0);
}

function parseSeoChecks(seoCheck) {
  if (!seoCheck || typeof seoCheck.checks_json !== 'string') return null;
  try {
    const parsed = JSON.parse(seoCheck.checks_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function seoCheckByName(checks, name) {
  return (checks || []).find((c) => c.name === name) || null;
}

/**
 * Structured failure alert (zero-failure rule): every refusal carries
 * article id, component, root cause, timestamp, retry history and
 * whether the owner must act. Temporary errors (E-Stop on, daily
 * limit reached) may be retried later; permanent gate failures
 * (BLOCKED_WITH_REASON) must never be retried in a loop.
 */
export function buildFailureAlert({ articleId, component, rootCause, errorKind, ownerActionRequired, retryHistory = [] }) {
  return {
    articleId: Number(articleId),
    component,
    rootCause: String(rootCause || ''),
    timestamp: nowIso(),
    retryHistory: Array.isArray(retryHistory) ? [...retryHistory] : [],
    ownerActionRequired: Boolean(ownerActionRequired),
    errorKind: errorKind === 'temporary' ? 'temporary' : 'permanent',
  };
}

export function evaluateAutoPublishEligibilityPure(input) {
  const {
    article = {},
    factCheck = null,
    currentBodyHash = null,
    seoCheck = null,
    sources = [],
    verifiedClaimsWithoutEvidence = 0,
    openCorrections = 0,
    linkedArticleIds = [],
    linkedArticles = [],
    adviceClaims = [],
    bannerClean = false,
    isProtected = false,
    emergencyStopOff = false,
    publishedToday = 0,
    maxArticlesPerDay = 1,
    publishingMode = 'approved_only',
    autoPublishing = 'off',
    autoPublishEligibleSince = null,
    seoWaivers = [],
    retryHistory = [],
    nowMs = Date.now(),
  } = input || {};
  const articleId = Number(article.id);
  const divisionSlug = String(article.division || '');
  const divisionCfg = getDivisionConfig(divisionSlug);
  const checks = [];
  const blockedBy = [];
  const temporaryBlockers = [];
  const push = (name, ok, detail, kind = 'permanent') => {
    checks.push({ name, ok, detail, kind });
    if (!ok) {
      blockedBy.push(detail);
      if (kind === 'temporary') temporaryBlockers.push(detail);
    }
  };

  // 1. New-article-only + legacy-draft guard. auto_publish_eligible_since
  //    MUST be set (absent = NULL = nothing eligible) and the article
  //    must be created at/after it. Drafts #28-#31 are refused by id
  //    unconditionally, even if created after the cutoff.
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return {
      articleId, eligible: false, verdict: 'blocked', checks: [], blockedBy: ['Invalid article id.'],
      requiresOwnerApproval: false, errorKind: 'permanent',
      failureAlert: buildFailureAlert({ articleId, component: 'auto-publish-eligibility', rootCause: 'Invalid article id.', errorKind: 'permanent', ownerActionRequired: true, retryHistory }),
    };
  }
  if (LEGACY_AUTO_PUBLISH_REFUSED_IDS.includes(articleId)) {
    push('not-legacy-draft', false,
      `Article #${articleId} predates autonomous publishing and needs separate owner authorization — it is never auto-published.`);
  } else if (isProtected) {
    push('not-legacy-draft', false, `Article #${articleId} is protected — automatic modification disabled.`);
  } else if (typeof autoPublishEligibleSince !== 'string' || !autoPublishEligibleSince.trim()) {
    push('not-legacy-draft', false,
      'auto_publish_eligible_since is not set — nothing is auto-publish-eligible until the owner sets it.');
  } else {
    const sinceMs = parseDbTime(autoPublishEligibleSince);
    const createdMs = parseDbTime(article.created_at);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(createdMs)) {
      push('not-legacy-draft', false, 'auto_publish_eligible_since or the article created_at is not a readable timestamp.');
    } else if (createdMs < sinceMs) {
      push('not-legacy-draft', false,
        `Article #${articleId} was created before auto_publish_eligible_since (${autoPublishEligibleSince}) — it predates autonomous publishing and needs separate owner authorization.`);
    } else {
      push('not-legacy-draft', true, `Article #${articleId} was created after auto_publish_eligible_since.`);
    }
  }

  // 2. Fact-check PASS on the CURRENT body (hash equality, fail-closed
  //    on missing/mismatched hash — same rule as gate checks 1-3).
  const hashOk = Boolean(factCheck)
    && typeof factCheck.body_hash === 'string' && factCheck.body_hash.length > 0
    && typeof currentBodyHash === 'string' && currentBodyHash.length > 0
    && factCheck.body_hash === currentBodyHash;
  push('fact-check-current', Boolean(factCheck && factCheck.verdict === 'pass' && hashOk),
    !factCheck ? 'No fact-check on record for this article.'
      : factCheck.verdict !== 'pass' ? `Latest fact-check verdict: ${factCheck.verdict} — auto-publish needs a PASS.`
      : !hashOk ? 'fact-check is stale: the recorded body hash does not match the current body (or is missing) — run a fresh fact-check.'
      : `Latest fact-check PASS on the current body (${factCheck.claims_verified}/${factCheck.claims_total} claims verified).`);

  // 3. No unresolved errors.
  push('no-unresolved-errors', Number(verifiedClaimsWithoutEvidence) === 0 && Number(factCheck ? factCheck.claims_failed : 0) === 0 && Boolean(factCheck),
    !factCheck ? 'No fact-check on record — unresolved-error status unknown.'
      : Number(factCheck.claims_failed || 0) > 0 ? `${factCheck.claims_failed} claim(s) still failed in the latest fact-check.`
      : Number(verifiedClaimsWithoutEvidence) > 0 ? `${verifiedClaimsWithoutEvidence} VERIFIED claim(s) cite no evidence URL.`
      : 'No unresolved claim errors.');

  // 4. Source verification: >=1 recorded source WITH a URL (evidence
  //    signature), and every VERIFIED claim cites an evidence URL.
  const sourcesWithUrl = (sources || []).filter((s) => s && typeof s.source_url === 'string' && s.source_url.trim().length > 0);
  const minSources = divisionCfg ? divisionCfg.editorial.minSources : 1;
  push('sources-verified', sourcesWithUrl.length >= minSources && Number(verifiedClaimsWithoutEvidence) === 0,
    sourcesWithUrl.length < minSources
      ? `Only ${sourcesWithUrl.length} source(s) with a URL recorded (division minimum: ${minSources}).`
      : Number(verifiedClaimsWithoutEvidence) > 0
        ? `${verifiedClaimsWithoutEvidence} VERIFIED claim(s) cite no evidence URL.`
        : `${sourcesWithUrl.length} source(s) with a URL recorded (division minimum: ${minSources}).`);

  // 5. Correction re-check.
  push('correction-recheck', Number(openCorrections) === 0,
    Number(openCorrections) > 0 ? `${openCorrections} correction claim(s) still pending or failed.` : 'No open corrections.');

  // 6. Fresh SEO pass: verdict 'pass' AND the run is fresh AND every
  //    one of the 11 checks passes (or is explicitly waived — default:
  //    NO waivers; internal-links and duplicate are never waivable).
  const seoChecks = parseSeoChecks(seoCheck);
  const seoStale = isSeoCheckStale(article, seoCheck, currentBodyHash);
  const waivers = new Set(Array.isArray(seoWaivers) ? seoWaivers : []);
  let seoOk = false;
  let seoDetail;
  if (!seoCheck) {
    seoDetail = 'No SEO check on record for this article.';
  } else if (seoStale) {
    seoDetail = 'SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.';
  } else if (seoCheck.verdict !== 'pass') {
    seoDetail = `Latest SEO verdict: ${seoCheck.verdict} — auto-publish needs a PASS.`;
  } else if (!seoChecks || seoChecks.length < 11) {
    seoDetail = 'Latest SEO run did not record the full 11-check suite — run a fresh SEO check.';
  } else {
    const failing = seoChecks.filter((c) => !c.ok && !(waivers.has(c.name) && !NEVER_WAIVABLE_SEO_CHECKS.includes(c.name)));
    const waivedIllegally = seoChecks.filter((c) => !c.ok && waivers.has(c.name) && NEVER_WAIVABLE_SEO_CHECKS.includes(c.name));
    if (waivedIllegally.length) {
      seoDetail = `Waiver refused for never-waivable check(s): ${waivedIllegally.map((c) => c.name).join(', ')} — these must genuinely pass.`;
    } else if (failing.length) {
      seoDetail = `SEO check(s) failing: ${failing.map((c) => c.name).join(', ')}.`;
    } else {
      seoOk = true;
      seoDetail = 'Latest SEO check is fresh and all 11 checks pass.';
    }
  }
  push('seo-fresh-pass', seoOk, seoDetail);

  // 7. Duplicate detection: exactly 0% shingle overlap vs published
  //    articles (stricter than the SEO suite's <25% pass bar — an
  //    auto-published article must not reuse any 5-word run). The
  //    overlap is read from the duplicate check's own detail string;
  //    an unparseable detail fails closed. "No other published
  //    articles to compare against" counts as 0%.
  const dupEntry = seoCheck && !seoStale ? seoCheckByName(seoChecks, 'duplicate') : null;
  let dupOk = false;
  let dupDetail;
  if (!seoCheck) {
    dupDetail = 'No SEO check on record — duplicate status unknown.';
  } else if (seoStale) {
    dupDetail = 'SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.';
  } else if (!dupEntry) {
    dupDetail = 'Duplicate check missing from the latest SEO run.';
  } else if (!dupEntry.ok) {
    dupDetail = dupEntry.detail || 'Duplicate check failed.';
  } else if (typeof dupEntry.detail === 'string' && /no other published articles/i.test(dupEntry.detail)) {
    dupOk = true;
    dupDetail = 'No other published articles to compare against (0% overlap).';
  } else {
    const m = typeof dupEntry.detail === 'string' ? dupEntry.detail.match(/(\d+(?:\.\d+)?)\s*%/) : null;
    if (!m) {
      dupDetail = 'Duplicate check passed but its overlap percentage is unreadable — refusing (fail-closed).';
    } else if (Number(m[1]) === 0) {
      dupOk = true;
      dupDetail = 'Highest 5-word shingle overlap with another published article: 0%.';
    } else {
      dupDetail = `Highest 5-word shingle overlap with another published article: ${m[1]}% — auto-publish needs exactly 0%.`;
    }
  }
  push('duplicate-zero-overlap', dupOk, dupDetail);

  // 8. Readability pass (its own SEO-suite entry, not the verdict).
  const readabilityEntry = seoCheck && !seoStale ? seoCheckByName(seoChecks, 'readability') : null;
  push('readability-pass', Boolean(readabilityEntry && readabilityEntry.ok),
    !seoCheck ? 'No SEO check on record — readability status unknown.'
      : seoStale ? 'SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.'
      : !readabilityEntry ? 'Readability check missing from the latest SEO run.'
      : readabilityEntry.ok ? 'Readability check passes.' : (readabilityEntry.detail || 'Readability check failed.'));

  // 9. Internal-link validation: the body must link >=1 article, every
  //    linked article must resolve, and every resolved link must be
  //    genuinely relevant (same division AND title-keyword overlap).
  //    An unrelated same-division link (live #31 -> #22) fails here
  //    even though the SEO suite's own internal-links check passes.
  const internalEntry = seoCheck && !seoStale ? seoCheckByName(seoChecks, 'internal-links') : null;
  let linksOk = false;
  let linksDetail;
  if (!seoCheck) {
    linksDetail = 'No SEO check on record — internal-link status unknown.';
  } else if (seoStale) {
    linksDetail = 'SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.';
  } else if (!internalEntry || !internalEntry.ok) {
    linksDetail = 'SEO internal-links check does not pass.';
  } else if (!linkedArticleIds.length) {
    linksDetail = 'Body links no article by id — add a genuinely relevant same-division link.';
  } else if (linkedArticles.length !== linkedArticleIds.length) {
    linksDetail = `${linkedArticleIds.length - linkedArticles.length} linked article(s) could not be resolved — refusing (fail-closed).`;
  } else {
    const irrelevant = linkedArticles.filter((l) => !isInternalLinkRelevant(article, l));
    if (irrelevant.length) {
      linksOk = false;
      linksDetail = `Linked article(s) not genuinely relevant (same division + topical overlap required): ${irrelevant.map((l) => `#${l.id}`).join(', ')}.`;
    } else {
      linksOk = true;
      linksDetail = `Body links ${linkedArticles.length} genuinely relevant same-division article(s).`;
    }
  }
  push('internal-links-relevant', linksOk, linksDetail);

  // 10. Special review: Health & Wellness and Finance & Money Education
  //     ALWAYS require owner approval — never auto-publishable, even
  //     when every other check passes. Advice claims in those divisions
  //     must cite a named authoritative source; an unverified advice
  //     claim BLOCKS the article with a reason.
  const isSpecial = isSpecialReviewDivision(divisionSlug);
  const needsDisclaimer = isSpecial;
  const hasDisclaimer = /General information only/i.test(String(article.body || ''));
  if (isSpecial) {
    const adviceFailures = (adviceClaims || [])
      .map((c) => ({ ...c, need: adviceClaimNeedsAuthority(c.text) }))
      .filter((c) => c.need.needsAuthority && !isAuthoritativeSource(c.evidenceUrl, divisionSlug));
    push('special-review', false,
      `${divisionCfg ? divisionCfg.name : divisionSlug} articles always require owner approval — never auto-publishable.`
      + (!hasDisclaimer ? ' General-information disclaimer missing.' : '')
      + (adviceFailures.length
        ? ` Unverified professional-advice claim(s) (BLOCKED_WITH_REASON): ${adviceFailures.map((c) => `${c.need.kind}: "${String(c.text || '').slice(0, 80)}"`).join('; ')}`
        : ''));
  } else {
    push('special-review', !needsDisclaimer || hasDisclaimer,
      needsDisclaimer
        ? (hasDisclaimer ? 'High-risk division disclaimer present.' : 'Special review: general-information disclaimer missing.')
        : 'Not a high-risk division.');
  }

  // 11. Emergency Stop OFF (temporary — may be retried after it clears).
  push('emergency-stop-off', Boolean(emergencyStopOff),
    emergencyStopOff ? 'Emergency Stop is OFF.' : 'Emergency Stop is ON.', 'temporary');

  // 12. Daily publishing limit (Dhaka day; temporary).
  const maxPerDay = Number(maxArticlesPerDay);
  const limit = Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : 1;
  push('daily-limit', Number(publishedToday) < limit,
    `Published today (Dhaka day): ${publishedToday}/${limit}.`, 'temporary');

  // 13. Publishing rules permit auto-publishing: BOTH the mode must
  //     allow it AND the auto_publishing toggle must be on.
  const rulesOk = publishingMode !== 'approved_only' && autoPublishing === 'on';
  push('publishing-rules', rulesOk,
    publishingMode === 'approved_only'
      ? "publishing_mode is 'approved_only' — nothing auto-publishes."
      : autoPublishing !== 'on'
        ? 'Auto-publishing is off.'
        : `publishing_mode is '${publishingMode}' and auto-publishing is on — auto-publishing permitted.`);

  // 14. Publication pre-conditions: a publishable status, no surviving
  //     AI-DRAFT banner, structured metadata present.
  const metaEntry = seoCheck && !seoStale ? seoCheckByName(seoChecks, 'structured-metadata') : null;
  const statusOk = article.status === 'draft' || article.status === 'approved';
  push('publication-preconditions', statusOk && Boolean(bannerClean) && Boolean(metaEntry && metaEntry.ok),
    !statusOk ? `Article status is '${article.status || 'unknown'}' — only 'draft' or 'approved' can auto-publish.`
      : !bannerClean ? 'AI-DRAFT banner survives the strip — remove it before publishing.'
      : !metaEntry ? 'Structured-metadata check missing from the latest SEO run.'
      : !metaEntry.ok ? 'Structured metadata incomplete (title, excerpt, slug or division missing).'
      : 'Status is publishable, no banner survives, structured metadata present.');

  const eligible = blockedBy.length === 0;
  const requiresOwnerApproval = isSpecial || LEGACY_AUTO_PUBLISH_REFUSED_IDS.includes(articleId);
  const errorKind = eligible ? 'permanent' : (blockedBy.length === temporaryBlockers.length ? 'temporary' : 'permanent');
  return {
    articleId,
    eligible,
    verdict: eligible ? 'eligible' : 'blocked',
    checks,
    blockedBy,
    requiresOwnerApproval,
    errorKind,
    publishingMode,
    failureAlert: eligible ? null : buildFailureAlert({
      articleId,
      component: 'auto-publish-eligibility',
      rootCause: blockedBy.join('; '),
      errorKind,
      ownerActionRequired: errorKind === 'permanent',
      retryHistory,
    }),
  };
}

/**
 * D1-backed wrapper: loads the article, its latest fact-check + SEO
 * run, sources, claim evidence, open corrections, resolved internal
 * links, advice claims (special-review divisions only), settings and
 * the Dhaka-day published count, then delegates to the pure evaluator.
 */
export async function evaluateAutoPublishEligibility(env, articleId, { seoWaivers = [] } = {}) {
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) {
    return evaluateAutoPublishEligibilityPure({ article: { id }, retryHistory: [] });
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1', [id]);
  if (!article) {
    return evaluateAutoPublishEligibilityPure({ article: { id }, retryHistory: [] });
  }
  const currentBodyHash = await bodyHash(article.body);
  const latestCheck = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  const latestSeo = await d1First(env,
    'SELECT * FROM seo_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ?', [id]) || [];
  let verifiedClaimsWithoutEvidence = 0;
  if (latestCheck) {
    const row = await d1First(env,
      "SELECT COUNT(*) AS n FROM claim_checks WHERE fact_check_id = ? AND verdict = 'VERIFIED' AND (evidence_url IS NULL OR evidence_url = '')",
      [latestCheck.id]);
    verifiedClaimsWithoutEvidence = Number(row ? row.n : 0);
  }
  // 5. Correction re-check — same single rule as the gate (see
  // countOpenCorrections): latest row per claim, ignoring rows the
  // fresh latest fact-check has judged stale (live #33 / #30, B6).
  const openCorrections = await countOpenCorrections(env, id, { latestCheck, currentBodyHash });
  const linkedArticleIds = extractLinkedArticleIds(article.body);
  let linkedArticles = [];
  if (linkedArticleIds.length) {
    const placeholders = linkedArticleIds.map(() => '?').join(', ');
    linkedArticles = await d1All(env,
      `SELECT id, division_id, title FROM articles WHERE id IN (${placeholders})`, linkedArticleIds) || [];
  }
  let adviceClaims = [];
  if (isSpecialReviewDivision(article.division) && latestCheck) {
    const claimRows = await d1All(env,
      'SELECT claim_text, evidence_url FROM claim_checks WHERE fact_check_id = ?', [latestCheck.id]) || [];
    adviceClaims = claimRows.map((r) => ({ text: r.claim_text, evidenceUrl: r.evidence_url }));
  }
  const stopped = await getEmergencyStop(env);
  const publishedToday = await countPublishedTodayDhaka(env);
  const mode = await setting(env, 'publishing_mode', 'approved_only');
  const autoPublishing = await setting(env, 'auto_publishing', 'off');
  const maxPerDayRaw = await setting(env, 'max_articles_per_day', '1');
  const eligibleSince = await setting(env, AUTO_PUBLISH_CUTOFF_SETTING, null);
  return evaluateAutoPublishEligibilityPure({
    article,
    factCheck: latestCheck,
    currentBodyHash,
    seoCheck: latestSeo,
    sources,
    verifiedClaimsWithoutEvidence,
    openCorrections,
    linkedArticleIds,
    linkedArticles,
    adviceClaims,
    bannerClean: !hasDraftBanner(stripDraftBanner(article.body || '')),
    isProtected: Number(article.is_protected || 0) === 1,
    emergencyStopOff: !stopped,
    publishedToday,
    maxArticlesPerDay: Number.parseInt(maxPerDayRaw, 10),
    publishingMode: mode,
    autoPublishing,
    autoPublishEligibleSince: eligibleSince,
    seoWaivers,
    retryHistory: [],
  });
}
