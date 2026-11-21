/**
 * FS AI — Social: dispatcher.
 *
 * The single choke point for every social post. Order of checks
 * (pre-flight, before ANY platform call):
 *   1. Emergency Stop — ON means no post, ever (423-style halt).
 *   2. Platform postable? X (UNAVAILABLE FREE OF COST) is refused here.
 *   3. Account connected? Token present, not expired?
 *   4. Daily-cap guardrail for the platform (framework limit first).
 *   5. Duplicate — same article+platform already live (unless the
 *      owner forced it with an explicit approval flag).
 *   6. Content valid for the platform (caption/media limits).
 *   7. Publish via the adapter, then VERIFY the post back from the
 *      platform where the API supports it. 'published' is written ONLY
 *      on a confirmed id (+ verify-back found, where supported).
 *
 * Retry: transient errors only (429/5xx/network), exponential backoff
 * 1s -> 2s -> 4s, MAX 3 attempts total. Permanent errors and
 * WAITING_FOR_AUTHORIZATION are never retried. No silent failures:
 * every attempt is recorded on the social_posts row (attempts, error,
 * status, timestamp) and the returned result always carries platform,
 * post id, root cause and retry history.
 */
import { SocialError, SOCIAL_CODES, notConnected, platformUnavailable } from './errors.js';
import { platformDef, isPostablePlatform } from './platforms.js';
import { getEmergencyStop } from '../routes/admin.js';
import { getAdapter, loadAccountWithToken } from './adapters/index.js';
import { refreshAccountToken, refreshSupported } from './refresh.js';
import { validateMediaBytes } from './media.js';
import {
  getPostById, updatePost, findLivePost, countPublishedToday, recordAnalytics, listDuePosts,
} from './store.js';

export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [1000, 2000, 4000];

export function isTransientForRetry(err) {
  return err instanceof SocialError && err.kind === 'transient';
}

function failureRecord(err, attempts) {
  return {
    platform: err?.platform || null,
    code: err instanceof SocialError ? err.code : 'PERMANENT',
    kind: err instanceof SocialError ? err.kind : 'permanent',
    rootCause: String(err?.message || err || 'Unknown error'),
    attempts,
    ownerAction: err instanceof SocialError ? (err.ownerAction || null) : null,
    recordedAt: new Date().toISOString(),
  };
}

/**
 * Pre-flight checks that need no platform call. Returns the loaded
 * account (with decrypted token) or throws a SocialError.
 */
export async function preflight(env, post, { fetchFn, delayFn } = {}) {
  const def = platformDef(post.platform);
  if (!def) throw new SocialError(SOCIAL_CODES.PERMANENT, `Unknown social platform: ${post.platform}`, { kind: 'permanent', platform: post.platform });
  if (await getEmergencyStop(env)) {
    throw new SocialError(SOCIAL_CODES.ESTOP,
      'Emergency Stop is ON — social posting is halted. No post was made.',
      { kind: 'permanent', platform: post.platform, ownerAction: 'Turn the Emergency Stop OFF (owner) to resume posting.' });
  }
  if (!isPostablePlatform(post.platform)) {
    throw platformUnavailable(post.platform, def.notes || 'no free official posting path exists.');
  }
  // YouTube Data API is DO-NOT-USE until the OAuth consent screen is
  // Production AND Google's API audit has passed (unaudited uploads
  // land PRIVATE; Testing tokens die after 7 days). The gate lives
  // here — the single choke point for every post — so no route,
  // scheduler step, or pack builder can reach the adapter while the
  // flag is off. The manual browser-upload Shorts flow is untouched.
  if (post.platform === 'youtube' && env?.YOUTUBE_DATA_API_ENABLED !== 'true') {
    throw new SocialError(SOCIAL_CODES.PLATFORM_UNAVAILABLE,
      'YouTube Data API is DO-NOT-USE: uploads land PRIVATE until the Google API audit passes. Keep using the manual browser-upload flow.',
      { kind: 'permanent', platform: 'youtube' });
  }
  let account = await loadAccountWithToken(env, post.platform);
  if (!account || account.status !== 'connected') {
    throw notConnected(post.platform);
  }
  if (!account._accessToken) {
    throw new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
      `${post.platform}: no usable access token is stored for this account — re-authorize (owner OAuth).`,
      { kind: 'needs_owner', platform: post.platform, ownerAction: `Re-authorize the ${post.platform} account (owner OAuth).` });
  }
  if (account.token_expires_at) {
    const expires = Date.parse(account.token_expires_at);
    if (Number.isFinite(expires) && expires <= Date.now()) {
      // Expired — but try the platform's official refresh flow first
      // when a refresh token is stored (Pinterest / Facebook /
      // Instagram). No refresh token, or a platform with no refresh
      // flow (LinkedIn), or a failed refresh -> WAITING_FOR_AUTHORIZATION
      // with ZERO platform publish calls. The refresh call itself is
      // the only network call this path makes, and only to the
      // platform's token endpoint.
      if (account.refresh_token_enc && refreshSupported(post.platform)) {
        try {
          await refreshAccountToken(env, post.platform, { fetchFn });
          const reloaded = await loadAccountWithToken(env, post.platform);
          if (reloaded?._accessToken) account = reloaded;
        } catch (refreshErr) {
          throw new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
            `${post.platform}: access token expired and refresh failed — re-authorize (owner OAuth). (${String(refreshErr?.message || refreshErr).slice(0, 200)})`,
            { kind: 'needs_owner', platform: post.platform, ownerAction: `Re-authorize the ${post.platform} account (owner OAuth).` });
        }
      } else {
        throw new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
          `${post.platform}: access token expired at ${account.token_expires_at} — re-authorize (owner OAuth).`,
          { kind: 'needs_owner', platform: post.platform, ownerAction: `Re-authorize the ${post.platform} account (owner OAuth).` });
      }
    }
  }
  const publishedToday = await countPublishedToday(env, post.platform);
  if (publishedToday >= def.limits.postsPerDay) {
    throw new SocialError(SOCIAL_CODES.RATE_LIMITED,
      `${post.platform}: daily framework cap reached (${publishedToday}/${def.limits.postsPerDay} published today) — try again tomorrow.`,
      { kind: 'permanent', platform: post.platform });
  }
  return account;
}

/**
 * Publish one social_posts row (by id). `publishInput` carries the
 * platform-ready content: { content, mediaBytes?, boardId?, boardName?, privacyStatus? }.
 * Options: { fetchFn, delayFn, ownerForced } — ownerForced only from
 * the owner route with an explicit force flag.
 */
export async function dispatchPost(env, postId, publishInput, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch?.bind(globalThis);
  const delayFn = options.delayFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let post = await getPostById(env, postId);
  if (!post) throw new Error(`Social post #${postId} not found.`);
  if (post.status === 'published') {
    throw new SocialError(SOCIAL_CODES.DUPLICATE,
      `Social post #${postId} is already published on ${post.platform} — refusing to re-post.`,
      { kind: 'permanent', platform: post.platform });
  }
  if (!options.ownerForced) {
    const live = await findLivePost(env, post.article_id, post.platform);
    if (live && live.id !== post.id && live.status === 'published') {
      const err = new SocialError(SOCIAL_CODES.DUPLICATE,
        `Article ${post.article_id} is already published on ${post.platform} (post #${live.id}) — refusing a duplicate. Force re-post requires explicit owner approval.`,
        { kind: 'permanent', platform: post.platform });
      // Returned as a failure result (like every other pre-flight
      // failure), not thrown. The row stays a draft so the owner can
      // still force-publish it later; only the reason is recorded.
      await updatePost(env, post.id, { error: err.message });
      return { ok: false, postId: post.id, platform: post.platform, status: 'blocked', failure: failureRecord(err, Number(post.attempts || 0)) };
    }
  }

  let account;
  try {
    account = await preflight(env, post, { fetchFn, delayFn });
  } catch (err) {
    const status = err.code === SOCIAL_CODES.ESTOP ? 'blocked'
      : err.code === SOCIAL_CODES.WAITING_FOR_AUTHORIZATION || err.code === SOCIAL_CODES.NOT_CONNECTED ? 'waiting_authorization'
      : err.code === SOCIAL_CODES.RATE_LIMITED ? 'rate_limited'
      : err.code === SOCIAL_CODES.PLATFORM_UNAVAILABLE ? 'blocked' : 'blocked';
    await updatePost(env, post.id, { status, error: failureRecord(err, 0).rootCause });
    return { ok: false, postId: post.id, platform: post.platform, status, failure: failureRecord(err, 0) };
  }

  const adapter = getAdapter(post.platform, { account, fetchFn, env, delayFn });
  // Image bytes (LinkedIn image posts) are validated BEFORE any
  // platform call: bad media fails as VALIDATION with zero attempts
  // recorded against the platform. YouTube video bytes are checked by
  // the adapter itself (presence only — the API takes video, not images).
  if (publishInput?.mediaBytes && post.platform !== 'youtube') {
    const mediaProblems = validateMediaBytes(publishInput.mediaBytes, post.platform);
    if (mediaProblems.length) {
      const err = new SocialError(SOCIAL_CODES.VALIDATION, mediaProblems.join(' '),
        { kind: 'permanent', platform: post.platform });
      await updatePost(env, post.id, { status: 'blocked', error: err.message });
      return { ok: false, postId: post.id, platform: post.platform, status: 'blocked', failure: failureRecord(err, Number(post.attempts || 0)) };
    }
  }
  let attempts = Number(post.attempts || 0);
  let lastError = null;
  await updatePost(env, post.id, { status: 'publishing' });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts += 1;
    await updatePost(env, post.id, { attempts });
    try {
      const result = await adapter.publish(publishInput);
      if (!result?.platformPostId) {
        throw new SocialError(SOCIAL_CODES.PERMANENT,
          `${post.platform}: adapter returned no platform post id — not treated as published.`,
          { kind: 'permanent', platform: post.platform });
      }
      // Verify-back where the API supports it. found === null means the
      // platform offers no read-back (LinkedIn) — creation confirmation
      // stands, recorded honestly with the adapter's verifyNote.
      let verified = null;
      try {
        const check = await adapter.verify(result.platformPostId);
        verified = check;
        if (check && check.found === false) {
          await updatePost(env, post.id, {
            status: 'unverified',
            platform_post_id: result.platformPostId,
            platform_url: result.url || null,
            error: `Platform accepted the create call but the post could not be read back (id ${result.platformPostId}). Not claimed as published.`,
          });
          return {
            ok: false, postId: post.id, platform: post.platform, status: 'unverified',
            platformPostId: result.platformPostId,
            failure: { code: SOCIAL_CODES.UNVERIFIED, kind: 'permanent', rootCause: 'Verify-back did not find the post.', attempts, recordedAt: new Date().toISOString() },
          };
        }
      } catch (verifyErr) {
        // A verify failure never upgrades an unconfirmed post to
        // 'published' silently — but a transient verify error after a
        // confirmed create is recorded, not fatal: the create response
        // already carried the id. Record the note and continue.
        verified = { found: null, note: `Verify-back error (non-fatal): ${String(verifyErr?.message || verifyErr)}` };
      }
      await updatePost(env, post.id, {
        status: 'published',
        platform_post_id: result.platformPostId,
        platform_url: result.url || null,
        published_at: new Date().toISOString(),
        error: result.verifyNote || verified?.note || null,
      });
      if (verified?.metrics) {
        for (const [metric, value] of Object.entries(verified.metrics)) {
          if (typeof value === 'number') await recordAnalytics(env, post.id, post.platform, metric, value);
        }
      }
      return {
        ok: true, postId: post.id, platform: post.platform, status: 'published',
        platformPostId: result.platformPostId, platformUrl: result.url || null,
        verified: verified?.found === true,
        verifyNote: result.verifyNote || verified?.note || null,
        warnings: result.warnings || [],
        attempts,
      };
    } catch (err) {
      lastError = err;
      if (!isTransientForRetry(err) || attempt === MAX_ATTEMPTS) break;
      const backoff = BACKOFF_MS[attempt - 1] || 4000;
      await delayFn(backoff);
    }
  }

  const failure = failureRecord(lastError, attempts);
  const status = lastError instanceof SocialError && lastError.code === SOCIAL_CODES.WAITING_FOR_AUTHORIZATION
    ? 'waiting_authorization'
    : lastError instanceof SocialError && lastError.code === SOCIAL_CODES.RATE_LIMITED
      ? 'rate_limited' : 'failed';
  await updatePost(env, post.id, { status, error: failure.rootCause });
  return { ok: false, postId: post.id, platform: post.platform, status, failure };
}

/** Publish every due scheduled post. Each row is independent — one failure never stops the rest. */
export async function dispatchDuePosts(env, publishInputFor, options = {}) {
  const due = await listDuePosts(env);
  const results = [];
  for (const post of due) {
    try {
      const input = await publishInputFor(post);
      results.push(await dispatchPost(env, post.id, input, options));
    } catch (err) {
      results.push({ ok: false, postId: post.id, platform: post.platform, status: 'failed', failure: failureRecord(err, 0) });
    }
  }
  return results;
}
