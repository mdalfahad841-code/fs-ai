/**
 * FS AI — Social: D1 store for social_accounts / social_posts /
 * social_analytics (migration 022).
 *
 * All queries use prepared statements with bound parameters (same rule
 * as the rest of the codebase — user input never reaches SQL). Every
 * function returns null / throws a plain Error when env.DB is absent
 * so callers answer 503 honestly instead of fabricating state.
 *
 * Idempotency: idempotencyKeyFor(articleId, platform) is
 * `article:{id}:{platform}`. createPost() refuses a second live row
 * (draft/scheduled/publishing/published/waiting_authorization/
 * rate_limited/unverified) with the same key unless `force` is true —
 * and force is only ever passed by the owner route with an explicit
 * owner confirmation (the dispatcher never sets it on its own).
 */
import { d1All, d1First, d1Run, nowIso } from '../middleware/validation.js';

export function idempotencyKeyFor(articleId, platform) {
  return `article:${Number(articleId)}:${platform}`;
}

export async function getAccount(env, platform) {
  if (!env?.DB) return null;
  return d1First(env,
    'SELECT * FROM social_accounts WHERE platform = ? ORDER BY updated_at DESC LIMIT 1', [platform]);
}

export async function listAccounts(env) {
  if (!env?.DB) return null;
  return d1All(env, 'SELECT * FROM social_accounts ORDER BY platform ASC');
}

export async function getAccountById(env, id) {
  if (!env?.DB) return null;
  return d1First(env, 'SELECT * FROM social_accounts WHERE id = ? LIMIT 1', [Number(id)]);
}

export async function upsertAccount(env, { platform, accountName, accountId, status, scopes, accessTokenEnc, refreshTokenEnc, tokenExpiresAt }) {
  const now = nowIso();
  const existing = await getAccount(env, platform);
  if (existing) {
    await d1Run(env,
      `UPDATE social_accounts SET account_name = ?, account_id = ?, status = ?, scopes = ?,
       access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, updated_at = ? WHERE id = ?`,
      [accountName || existing.account_name, accountId || existing.account_id, status || existing.status,
        scopes ? JSON.stringify(scopes) : existing.scopes,
        accessTokenEnc !== undefined ? accessTokenEnc : existing.access_token_enc,
        refreshTokenEnc !== undefined ? refreshTokenEnc : existing.refresh_token_enc,
        tokenExpiresAt !== undefined ? tokenExpiresAt : existing.token_expires_at,
        now, existing.id]);
    return getAccountById(env, existing.id);
  }
  const result = await d1Run(env,
    `INSERT INTO social_accounts (platform, account_name, account_id, status, scopes,
     access_token_enc, refresh_token_enc, token_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [platform, accountName || null, accountId || null, status || 'not_connected',
      scopes ? JSON.stringify(scopes) : null, accessTokenEnc || null, refreshTokenEnc || null,
      tokenExpiresAt || null, now, now]);
  return getAccountById(env, result?.meta?.last_row_id);
}

export async function updateAccountStatus(env, id, status, error = null) {
  await d1Run(env,
    'UPDATE social_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
    [status, error, nowIso(), Number(id)]);
}

/**
 * Persist refreshed tokens (migration 027 columns refresh_token_expires_at
 * / token_refreshed_at included when present). Only the fields passed
 * are updated; a field left undefined keeps its stored value.
 * Returns the updated account row, or null when the table/row is absent.
 */
export async function updateAccountTokens(env, id, { accessTokenEnc, refreshTokenEnc, tokenExpiresAt, refreshTokenExpiresAt } = {}) {
  const sets = [];
  const params = [];
  const push = (col, value) => { if (value !== undefined) { sets.push(`${col} = ?`); params.push(value); } };
  push('access_token_enc', accessTokenEnc);
  push('refresh_token_enc', refreshTokenEnc);
  push('token_expires_at', tokenExpiresAt);
  push('refresh_token_expires_at', refreshTokenExpiresAt);
  if (!sets.length) return getAccountById(env, id);
  sets.push('token_refreshed_at = ?');
  params.push(nowIso());
  sets.push("status = 'connected'");
  sets.push('last_error = NULL');
  sets.push('updated_at = ?');
  params.push(nowIso(), Number(id));
  try {
    await d1Run(env, `UPDATE social_accounts SET ${sets.join(', ')} WHERE id = ?`, params);
  } catch (err) {
    // Pre-027 database (columns not yet applied): fall back to the
    // 022 columns only, so a refresh still persists the new tokens.
    if (!/refresh_token_expires_at|token_refreshed_at/.test(String(err?.message || ''))) throw err;
    const fallbackSets = [];
    const fallbackParams = [];
    if (accessTokenEnc !== undefined) { fallbackSets.push('access_token_enc = ?'); fallbackParams.push(accessTokenEnc); }
    if (refreshTokenEnc !== undefined) { fallbackSets.push('refresh_token_enc = ?'); fallbackParams.push(refreshTokenEnc); }
    if (tokenExpiresAt !== undefined) { fallbackSets.push('token_expires_at = ?'); fallbackParams.push(tokenExpiresAt); }
    fallbackSets.push("status = 'connected'", 'last_error = NULL', 'updated_at = ?');
    fallbackParams.push(nowIso(), Number(id));
    await d1Run(env, `UPDATE social_accounts SET ${fallbackSets.join(', ')} WHERE id = ?`, fallbackParams);
  }
  return getAccountById(env, id);
}

export async function markAccountVerified(env, id) {
  await d1Run(env,
    "UPDATE social_accounts SET last_verified_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
    [nowIso(), nowIso(), Number(id)]);
}

/** Find a live (non-terminal) post for the same article+platform. */
export async function findLivePost(env, articleId, platform) {
  if (!env?.DB) return null;
  return d1First(env,
    `SELECT * FROM social_posts WHERE idempotency_key = ? AND status IN
     ('draft', 'scheduled', 'publishing', 'published', 'waiting_authorization', 'rate_limited', 'unverified')
     ORDER BY created_at DESC LIMIT 1`,
    [idempotencyKeyFor(articleId, platform)]);
}

export async function createPost(env, { articleId, platform, caption, mediaUrl, scheduledFor }, options = {}) {
  // A forced re-post (explicit owner approval) gets a distinct key —
  // idempotency_key is UNIQUE, so the same article+platform can only
  // have one live row per key. The dispatcher's duplicate guard still
  // refuses to PUBLISH it unless the publish call is also forced.
  const key = options.force
    ? `${idempotencyKeyFor(articleId, platform)}:repost:${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    : idempotencyKeyFor(articleId, platform);
  if (!options.force) {
    const live = await findLivePost(env, articleId, platform);
    if (live) {
      const err = new Error(`Duplicate: article ${articleId} already has a ${live.status} post on ${platform} (post #${live.id}). Force re-post requires explicit owner approval.`);
      err.code = 'DUPLICATE';
      err.existingPostId = live.id;
      err.existingStatus = live.status;
      throw err;
    }
  }
  const now = nowIso();
  const result = await d1Run(env,
    `INSERT INTO social_posts (article_id, platform, idempotency_key, status, caption, media_url,
     scheduled_for, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [Number(articleId), platform, key, scheduledFor ? 'scheduled' : 'draft',
      caption || null, mediaUrl || null, scheduledFor || null, now, now]);
  return getPostById(env, result?.meta?.last_row_id);
}

export async function getPostById(env, id) {
  if (!env?.DB || id == null) return null;
  return d1First(env, 'SELECT * FROM social_posts WHERE id = ? LIMIT 1', [Number(id)]);
}

/**
 * WS-E L3: updatePost builds its SET clause from caller keys — now
 * restricted to an explicit column allowlist. NOTE: the WS-E proposal
 * omitted 'platform_url', but the dispatcher records the verified
 * platform URL on every published/unverified post (dispatcher.js),
 * and the dispatcher tests pin that value — so the allowlist keeps
 * 'platform_url'. Any key outside this set is silently ignored.
 */
const POST_UPDATABLE = new Set(['status', 'error', 'attempts', 'platform_post_id', 'platform_url', 'published_at', 'caption', 'media_url', 'scheduled_for']);

export async function updatePost(env, id, fields) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!POST_UPDATABLE.has(key)) continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return getPostById(env, id);
  sets.push('updated_at = ?');
  params.push(nowIso(), Number(id));
  await d1Run(env, `UPDATE social_posts SET ${sets.join(', ')} WHERE id = ?`, params);
  return getPostById(env, id);
}

/** Posts due for publishing: scheduled, due now, oldest first. */
export async function listDuePosts(env, now = nowIso(), limit = 50) {
  if (!env?.DB) return [];
  return d1All(env,
    `SELECT * FROM social_posts WHERE status = 'scheduled' AND scheduled_for IS NOT NULL
     AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT ?`, [now, Number(limit)]);
}

/** Publishing calendar: posts by date/platform/status. */
export async function listCalendar(env, { from, to, platform, status } = {}) {
  if (!env?.DB) return null;
  let sql = 'SELECT * FROM social_posts WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND (scheduled_for >= ? OR (scheduled_for IS NULL AND created_at >= ?))'; params.push(from, from); }
  if (to) { sql += ' AND (scheduled_for <= ? OR (scheduled_for IS NULL AND created_at <= ?))'; params.push(to, to); }
  if (platform) { sql += ' AND platform = ?'; params.push(platform); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT 500';
  return d1All(env, sql, params);
}

/** Count of posts published today (UTC date) on a platform — the daily-cap guardrail. */
export async function countPublishedToday(env, platform, day = nowIso().slice(0, 10)) {
  if (!env?.DB) return 0;
  const row = await d1First(env,
    `SELECT COUNT(*) AS n FROM social_posts WHERE platform = ? AND status = 'published'
     AND substr(published_at, 1, 10) = ?`, [platform, day]);
  return Number(row?.n || 0);
}

/** Record one engagement metric exactly as returned by a platform. Never called with invented values. */
export async function recordAnalytics(env, socialPostId, platform, metric, value) {
  if (!env?.DB) return null;
  const result = await d1Run(env,
    'INSERT INTO social_analytics (social_post_id, platform, metric, value, recorded_at) VALUES (?, ?, ?, ?, ?)',
    [Number(socialPostId), platform, String(metric), Number(value), nowIso()]);
  return result?.meta?.last_row_id;
}

export async function getAnalyticsForPost(env, socialPostId) {
  if (!env?.DB) return [];
  return d1All(env,
    'SELECT * FROM social_analytics WHERE social_post_id = ? ORDER BY recorded_at ASC',
    [Number(socialPostId)]);
}

/** Report window: posts + per-platform counts + any real engagement rows. */
export async function reportWindow(env, from, to) {
  if (!env?.DB) return null;
  const posts = await d1All(env,
    `SELECT * FROM social_posts WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC`,
    [from, to]);
  const analytics = await d1All(env,
    `SELECT * FROM social_analytics WHERE recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at ASC`,
    [from, to]);
  return { posts: posts || [], analytics: analytics || [] };
}
