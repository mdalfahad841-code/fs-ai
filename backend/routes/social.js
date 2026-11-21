/**
 * FS AI — Social routes (owner-only; requireOwner enforced here, the
 * same pattern as backend/routes/auth.js — worker.js also enforces
 * requireOwner for /api/* owner routes, so a missed check here is
 * still blocked upstream).
 *
 *   GET  /api/social/status
 *        CONTRACT (the dashboard worker depends on this exact shape):
 *        { platforms: [{ platform, connected, accountName,
 *                        tokenExpiresAt, lastPostAt, lastError }] }
 *        `connected` is false for every platform until a real OAuth
 *        completes — nothing here ever claims a connection that does
 *        not exist. `lastError` is the account's last recorded error
 *        (or the latest failed post's), null when there is none.
 *   POST /api/social/accounts/:id/verify
 *        { verified, accountName?, reason? } — calls the platform's
 *        read endpoint with the stored token; updates last_verified_at
 *        / status. Never returns a token. Also reports `missingScopes`
 *        (required scopes not in the stored grant) as an advisory
 *        warning — a working token still verifies true, but a missing
 *        scope will fail the first post that needs it.
 *   GET  /api/social/oauth/:platform/start
 *        Owner-only. Returns the authorization URL the owner must
 *        open to connect an account (one-time OAuth per platform).
 *        The signed state token (10 min, platform-bound) is included.
 *   GET  /api/social/oauth/:platform/callback?code&state
 *        Owner-only. Validates the state, exchanges the code for
 *        tokens, encrypts + stores them, marks the account connected.
 *        Never returns a token. A bad/expired state is refused.
 *   POST /api/social/accounts/:id/refresh
 *        Owner-triggered token refresh via the platform's official
 *        refresh flow (Pinterest/Facebook/Instagram; LinkedIn has no
 *        refresh tokens and returns 423 re-OAuth; YouTube is gated
 *        DO-NOT-USE). Returns the new expiry, never a token.
 *   POST /api/social/posts
 *        Create/schedule a post — DRAFT ONLY. Body: { articleId,
 *        platform, scheduledFor?, caption?, mediaUrl?, boardId?,
 *        force? }. Never publishes. `publish: true` in the body is
 *        rejected — publishing is the explicit POST .../posts/:id/publish
 *        owner action below. Duplicate article+platform -> 409 unless
 *        force: true (explicit owner approval, recorded in the row).
 *   POST /api/social/posts/:id/publish
 *        Owner-triggered publish of one draft/scheduled post. Runs the
 *        full dispatcher pre-flight (E-Stop, token, rate cap, duplicate,
 *        content) and verify-back. This is the ONLY route that posts.
 *        Optional body { force: true } re-posts an article that is
 *        already published on the same platform (explicit owner approval).
 *   GET  /api/social/posts?platform&status&limit
 *        Recent social_posts rows (newest first).
 *   GET  /api/social/calendar?from&to&platform&status
 *        Publishing calendar (posts by date/platform/status).
 *   GET  /api/social/reports/daily | /api/social/reports/weekly
 *        { period, from, to, total, byPlatform, engagement }.
 *        Engagement is real platform data only — "Data unavailable"
 *        when no social_analytics rows exist in the window.
 *
 * Registration is NOT done here (coordinator wires worker.js) — see
 * the exact snippet in docs/SOCIAL-PLATFORMS-2026-11-21.md and the W4
 * report. Tokens are never returned, never logged.
 */
import { jsonOk, jsonError, readJsonBody, d1All, d1First } from '../middleware/validation.js';
import { requireOwner } from '../middleware/auth.js';
import { ALL_PLATFORMS, platformDef, isPostablePlatform } from '../social/platforms.js';
import { buildPostContent } from '../social/content.js';
import { getAdapter, loadAccountWithToken } from '../social/adapters/index.js';
import { dispatchPost } from '../social/dispatcher.js';
import { encryptToken } from '../social/tokens.js';
import {
  createOAuthState, validateOAuthState, authorizationUrl, oauthRedirectUri,
  exchangeCodeForTokens, missingScopes, OAUTH_CLIENT_ENV,
} from '../social/oauth.js';
import { refreshAccountToken, tokenExpiryStatus } from '../social/refresh.js';
import {
  getAccount, getAccountById, createPost, getPostById,
  listCalendar, reportWindow, updateAccountStatus, markAccountVerified, upsertAccount, updateAccountTokens,
} from '../social/store.js';

function needDb(env) {
  if (!env?.DB) return jsonError('Social routes require the D1 database', 503);
  return null;
}

async function loadArticle(env, articleId) {
  return d1First(env,
    'SELECT a.*, d.slug AS division, d.name AS division_name FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [Number(articleId)]);
}

async function statusForPlatform(env, platform) {
  const account = await getAccount(env, platform);
  const def = platformDef(platform);
  let lastPostAt = null;
  let lastError = account?.last_error || null;
  try {
    const last = await d1First(env,
      `SELECT published_at, error FROM social_posts WHERE platform = ? AND status = 'published'
       ORDER BY published_at DESC LIMIT 1`, [platform]);
    lastPostAt = last?.published_at || null;
    if (!lastError) {
      const failed = await d1First(env,
        `SELECT error FROM social_posts WHERE platform = ? AND status IN ('failed', 'blocked', 'unverified')
         ORDER BY updated_at DESC LIMIT 1`, [platform]);
      lastError = failed?.error || null;
    }
  } catch { /* tables missing (migration 022 not applied) — report not-connected, not a 500 */ }
  let connected = false;
  if (account && account.status === 'connected' && account.access_token_enc) {
    connected = true;
    if (account.token_expires_at) {
      const expires = Date.parse(account.token_expires_at);
      if (Number.isFinite(expires) && expires <= Date.now()) connected = false;
    }
  }
  return {
    platform,
    connected,
    accountName: account?.account_name || null,
    tokenExpiresAt: account?.token_expires_at || null,
    lastPostAt,
    lastError,
    classification: def?.classification || null,
  };
}

export async function handleSocial(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  // The OAuth callback is the ONE social route the owner's browser
  // reaches by a platform redirect (no Bearer header travels with it).
  // Its auth is the signed, 10-minute, platform-bound state token
  // (validated inside the callback branch) plus the single-use code —
  // only the owner who started the flow via the owner-only /start
  // route holds a valid state. NOTE: the live Worker ALSO gates
  // /api/social/* with requireOwner in backend/worker.js (coordinator's
  // file) — that gate needs the matching one-line callback exemption
  // before a browser redirect can reach this handler (exact proposal
  // in docs/FS-AI-COMPLETION-WS-C-NOTES-2026-11-21.md). Until then the
  // owner can complete a callback by calling its URL with an owner
  // Bearer token (dashboard fetch / curl).
  const isOAuthCallback = method === 'GET' && /^\/api\/social\/oauth\/[a-z]+\/callback$/.test(path);
  if (!isOAuthCallback) {
    const auth = await requireOwner(request, env);
    if (!auth.ok) return auth.response;
  }

  // GET /api/social/status
  if (path === '/api/social/status' && method === 'GET') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const platforms = [];
    for (const platform of ALL_PLATFORMS) platforms.push(await statusForPlatform(env, platform));
    return jsonOk({ platforms });
  }

  // POST /api/social/accounts/:id/verify
  const verifyMatch = /^\/api\/social\/accounts\/(\d+)\/verify$/.exec(path);
  if (verifyMatch && method === 'POST') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const account = await getAccountById(env, Number(verifyMatch[1]));
    if (!account) return jsonError('Social account not found', 404);
    if (!isPostablePlatform(account.platform)) {
      return jsonOk({ verified: false, platform: account.platform, reason: `No free official posting path for ${account.platform} — see docs/SOCIAL-PLATFORMS-2026-11-21.md.` });
    }
    const loaded = await loadAccountWithToken(env, account.platform);
    if (!loaded || loaded.status !== 'connected' || !loaded._accessToken) {
      await updateAccountStatus(env, account.id, 'not_connected', 'Verify attempted with no usable token — owner OAuth required.');
      return jsonOk({ verified: false, platform: account.platform, reason: 'No usable token stored — owner OAuth required.' });
    }
    try {
      const adapter = getAdapter(account.platform, { account: loaded, env });
      const check = await adapter.validateCredentials();
      await markAccountVerified(env, account.id);
      let storedScopes = [];
      try { storedScopes = JSON.parse(account.scopes || '[]'); } catch { storedScopes = []; }
      const missing = missingScopes(account.platform, storedScopes);
      return jsonOk({
        verified: true, platform: account.platform, accountName: check.accountName || account.account_name,
        detail: check.detail || null, missingScopes: missing,
        scopeWarning: missing.length
          ? `Token works, but these required scopes are missing from the stored grant and will fail posts that need them: ${missing.join(', ')}. Re-authorize to add them.`
          : null,
      });
    } catch (err) {
      const reason = String(err?.message || err);
      const expired = /expired|revoked|denied|401|403/i.test(reason);
      await updateAccountStatus(env, account.id, expired ? 'expired' : 'error', reason.slice(0, 500));
      return jsonOk({ verified: false, platform: account.platform, reason });
    }
  }

  // POST /api/social/posts — create/schedule, DRAFT ONLY.
  if (path === '/api/social/posts' && method === 'POST') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    let body;
    try { body = await readJsonBody(request); } catch { return jsonError('Invalid JSON body.', 400); }
    if (body?.publish === true) {
      return jsonError('This endpoint creates drafts/schedules only and never publishes. Publish explicitly via POST /api/social/posts/:id/publish.', 400);
    }
    const articleId = Number(body?.articleId);
    const platform = String(body?.platform || '');
    if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('articleId is required (a valid article id).', 400);
    if (!platformDef(platform)) return jsonError(`Unknown platform: ${platform}`, 400);
    if (!isPostablePlatform(platform)) {
      return jsonError(`${platform} has no free official posting path — see docs/SOCIAL-PLATFORMS-2026-11-21.md.`, 400);
    }
    const article = await loadArticle(env, articleId);
    if (!article) return jsonError(`Article ${articleId} not found.`, 404);
    if (article.status !== 'published') {
      return jsonError(`Article ${articleId} is '${article.status}', not published — social posts are prepared for published articles only.`, 400);
    }
    const scheduledFor = body?.scheduledFor || null;
    if (scheduledFor && Number.isNaN(Date.parse(scheduledFor))) return jsonError('scheduledFor must be an ISO date/time.', 400);
    const content = buildPostContent(article, platform, { url: body?.mediaUrl || null });
    const caption = body?.caption ? String(body.caption) : content.caption;
    try {
      const post = await createPost(env, {
        articleId, platform, caption,
        mediaUrl: body?.mediaUrl || content.mediaUrl || null,
        scheduledFor,
      }, { force: body?.force === true });
      return jsonOk({ post, contentWarnings: content.warnings }, 201);
    } catch (err) {
      if (err.code === 'DUPLICATE') {
        return jsonError(err.message, 409, { existingPostId: err.existingPostId, existingStatus: err.existingStatus });
      }
      throw err;
    }
  }

  // POST /api/social/posts/:id/publish — the ONLY route that posts.
  const publishMatch = /^\/api\/social\/posts\/(\d+)\/publish$/.exec(path);
  if (publishMatch && method === 'POST') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const post = await getPostById(env, Number(publishMatch[1]));
    if (!post) return jsonError('Social post not found', 404);
    if (post.status === 'published') return jsonError(`Post #${post.id} is already published on ${post.platform}.`, 409);
    const article = await loadArticle(env, post.article_id);
    if (!article) return jsonError(`Article ${post.article_id} not found.`, 404);
    const content = buildPostContent(article, post.platform, { url: post.media_url || null });
    let force = false;
    try {
      const body = await readJsonBody(request);
      force = body?.force === true;
    } catch { /* empty body — publish without force */ }
    const result = await dispatchPost(env, post.id, {
      content,
      mediaBytes: null, // video bytes (YouTube) come from the video pipeline, not this JSON route
      boardId: null,
    }, { ownerForced: force });
    const updated = await getPostById(env, post.id);
    if (result.ok) return jsonOk({ result, post: updated });
    // WS-E M3: an E-Stop block is 423 (halted, owner action), not 502
    // (upstream failure) — consistent with agent runs / daily / weekly.
    return jsonError(result.failure?.rootCause || 'Publishing failed.',
      result.status === 'waiting_authorization' || result.failure?.code === 'ESTOP' ? 423 : 502,
      { result, post: updated });
  }

  // GET /api/social/posts — recent rows.
  if (path === '/api/social/posts' && method === 'GET') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const platform = url.searchParams.get('platform');
    const status = url.searchParams.get('status');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
    let sql = 'SELECT * FROM social_posts WHERE 1=1';
    const params = [];
    if (platform) { sql += ' AND platform = ?'; params.push(platform); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return jsonOk({ posts: (await d1All(env, sql, params)) || [] });
  }

  // GET /api/social/calendar
  if (path === '/api/social/calendar' && method === 'GET') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const posts = await listCalendar(env, {
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
      platform: url.searchParams.get('platform') || undefined,
      status: url.searchParams.get('status') || undefined,
    });
    return jsonOk({ posts: posts || [] });
  }

  // GET /api/social/reports/daily | weekly
  const reportMatch = /^\/api\/social\/reports\/(daily|weekly)$/.exec(path);
  if (reportMatch && method === 'GET') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const now = new Date();
    const to = now.toISOString();
    const from = new Date(now.getTime() - (reportMatch[1] === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)).toISOString();
    const { posts, analytics } = (await reportWindow(env, from, to)) || { posts: [], analytics: [] };
    const byPlatform = {};
    for (const p of ALL_PLATFORMS) byPlatform[p] = { draft: 0, scheduled: 0, published: 0, failed: 0, blocked: 0, waiting_authorization: 0, rate_limited: 0, unverified: 0 };
    for (const post of posts) {
      if (byPlatform[post.platform] && byPlatform[post.platform][post.status] !== undefined) byPlatform[post.platform][post.status] += 1;
    }
    const engagement = analytics.length
      ? analytics.map((a) => ({ socialPostId: a.social_post_id, platform: a.platform, metric: a.metric, value: a.value, recordedAt: a.recorded_at }))
      : 'Data unavailable';
    return jsonOk({
      period: reportMatch[1], from, to, total: posts.length, byPlatform, engagement,
      note: analytics.length ? 'Engagement values are exactly as returned by the platforms.' : 'No engagement data has been returned by any platform in this window — "Data unavailable", never estimated.',
    });
  }

  // GET /api/social/oauth/:platform/start — owner opens the returned URL to connect an account.
  const oauthStartMatch = /^\/api\/social\/oauth\/([a-z]+)\/start$/.exec(path);
  if (oauthStartMatch && method === 'GET') {
    const platform = oauthStartMatch[1];
    const def = platformDef(platform);
    if (!def) return jsonError(`Unknown platform: ${platform}`, 400);
    if (!isPostablePlatform(platform)) {
      return jsonError(`${platform} has no free official posting path — see docs/SOCIAL-PLATFORMS-2026-11-21.md.`, 400);
    }
    const keys = OAUTH_CLIENT_ENV[platform];
    const clientId = env?.[keys.id] || null;
    if (!clientId) return jsonError(`${platform}: OAuth client id is not configured (Worker env ${keys.id}). Set it before connecting.`, 503);
    if (!env?.SOCIAL_TOKEN_SECRET) return jsonError('SOCIAL_TOKEN_SECRET is not configured — OAuth state cannot be signed.', 503);
    const redirectUri = oauthRedirectUri(env, platform);
    const state = await createOAuthState(env.SOCIAL_TOKEN_SECRET, platform);
    return jsonOk({
      platform,
      authorizationUrl: authorizationUrl(platform, { clientId, redirectUri, state }),
      redirectUri,
      note: 'Open authorizationUrl as the owner, grant the requested scopes, and the platform redirects back to the callback URL. The state token expires in 10 minutes.',
    });
  }

  // GET /api/social/oauth/:platform/callback?code&state — exchange the code, store encrypted tokens.
  const oauthCallbackMatch = /^\/api\/social\/oauth\/([a-z]+)\/callback$/.exec(path);
  if (oauthCallbackMatch && method === 'GET') {
    const platform = oauthCallbackMatch[1];
    const def = platformDef(platform);
    if (!def) return jsonError(`Unknown platform: ${platform}`, 400);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return jsonError(`Owner declined or the platform refused the authorization: ${oauthError}. No account was connected.`, 400);
    if (!code) return jsonError('OAuth code is missing from the callback.', 400);
    try {
      await validateOAuthState(env?.SOCIAL_TOKEN_SECRET, state, platform);
    } catch (err) {
      return jsonError(String(err?.message || err), 400);
    }
    const keys = OAUTH_CLIENT_ENV[platform];
    const clientId = env?.[keys.id] || null;
    const clientSecret = env?.[keys.secret] || null;
    if (!clientId || !clientSecret) return jsonError(`${platform}: OAuth client id/secret are not configured (Worker env).`, 503);
    try {
      const tokens = await exchangeCodeForTokens(platform, {
        code, clientId, clientSecret, redirectUri: oauthRedirectUri(env, platform),
        fetchFn: globalThis.fetch?.bind(globalThis),
      });
      if (!tokens?.accessToken) return jsonError(`${platform}: token exchange returned no access token — nothing was stored.`, 502);
      const accessTokenEnc = await encryptToken(tokens.accessToken, env.SOCIAL_TOKEN_SECRET);
      const refreshTokenEnc = tokens.refreshToken ? await encryptToken(tokens.refreshToken, env.SOCIAL_TOKEN_SECRET) : null;
      const now = Date.now();
      const tokenExpiresAt = tokens.expiresIn ? new Date(now + tokens.expiresIn * 1000).toISOString() : null;
      // Pinterest refresh tokens live 60 days; record that expiry so
      // expiry monitoring can warn before re-OAuth becomes necessary.
      const refreshTokenExpiresAt = platform === 'pinterest' && tokens.refreshToken
        ? new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString() : null;
      const saved = await upsertAccount(env, {
        platform, accountName: tokens.accountName || null, accountId: tokens.accountId || null,
        status: 'connected', scopes: def.scopes, accessTokenEnc, refreshTokenEnc, tokenExpiresAt,
      });
      // upsertAccount has no refresh-expiry parameter; persist it via
      // the token-update path when one was issued.
      if (refreshTokenExpiresAt && saved) {
        await updateAccountTokens(env, saved.id, { refreshTokenExpiresAt });
      }
      return jsonOk({
        connected: true, platform, accountName: tokens.accountName || null,
        tokenExpiresAt, refreshTokenExpiresAt,
        note: `${def.label} is connected. It is NOT reported as publishing until a post is verified; social_auto_post stays OFF until the owner enables it.`,
      });
    } catch (err) {
      return jsonError(String(err?.message || err), 502);
    }
  }

  // POST /api/social/accounts/:id/refresh — owner-triggered token refresh.
  const refreshMatch = /^\/api\/social\/accounts\/(\d+)\/refresh$/.exec(path);
  if (refreshMatch && method === 'POST') {
    const dbErr = needDb(env);
    if (dbErr) return dbErr;
    const account = await getAccountById(env, Number(refreshMatch[1]));
    if (!account) return jsonError('Social account not found', 404);
    try {
      const result = await refreshAccountToken(env, account.platform, { fetchFn: globalThis.fetch?.bind(globalThis) });
      return jsonOk({ refreshed: true, ...result });
    } catch (err) {
      const waiting = err?.code === 'WAITING_FOR_AUTHORIZATION' || err?.kind === 'needs_owner';
      return jsonError(String(err?.message || err), waiting ? 423 : 502, { platform: account.platform, tokenStatus: tokenExpiryStatus(account) });
    }
  }

  return jsonError('Social route not found', 404);
}
