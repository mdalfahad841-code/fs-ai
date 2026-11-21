/**
 * FS AI — Social: token expiry monitoring + refresh.
 *
 * Expiry is a first-class state, not an afterthought:
 *   tokenExpiryStatus(account) -> 'not_connected' | 'unknown' |
 *     'valid' | 'expiring_soon' (<= 7 days by default) | 'expired'.
 *   listExpiringAccounts(env, warnDays) -> every stored account with
 *     its status, for the dashboard / health check / owner alert.
 *
 * Refresh (official flows only, from docs/SOCIAL-PLATFORMS-2026-11-21.md):
 *   Pinterest — POST /v5/oauth/token grant_type=refresh_token
 *     (new access 30d + new refresh 60d). Client id/secret from env.
 *   Facebook — fb_exchange_token on the long-lived user token, then
 *     /me/accounts for a fresh Page token (Page tokens do not expire
 *     while the Page/admin link holds).
 *   Instagram — GET /access_token?grant_type=ig_refresh_token
 *     (new long-lived token, 60d).
 *   LinkedIn — NO refresh tokens for self-serve apps: refresh throws
 *     WAITING_FOR_AUTHORIZATION with the re-OAuth owner action.
 *   YouTube — refresh token grant, but GATED: refused unless
 *     env.YOUTUBE_DATA_API_ENABLED === 'true' (DO-NOT-USE until the
 *     consent screen is Production + Google audit passed).
 *   X — no adapter, no refresh, refused as PLATFORM_UNAVAILABLE.
 *
 * A refresh failure is NEVER retried silently and NEVER reported as
 * a success: the caller (dispatcher preflight / owner refresh route)
 * records WAITING_FOR_AUTHORIZATION and the owner re-authorizes.
 */
import { SocialError, SOCIAL_CODES, waitingForAuthorization } from './errors.js';
import { platformDef, isPostablePlatform } from './platforms.js';
import { decryptToken, encryptToken } from './tokens.js';
import { getAccount, listAccounts, updateAccountTokens } from './store.js';
import { OAUTH_CLIENT_ENV } from './oauth.js';

export const EXPIRY_WARN_DAYS = 7;

export function tokenExpiryStatus(account, { warnDays = EXPIRY_WARN_DAYS, now = Date.now() } = {}) {
  if (!account || account.status === 'not_connected' || !account.access_token_enc) return 'not_connected';
  if (!account.token_expires_at) return 'unknown';
  const expires = Date.parse(account.token_expires_at);
  if (!Number.isFinite(expires)) return 'unknown';
  if (expires <= now) return 'expired';
  if (expires <= now + warnDays * 24 * 60 * 60 * 1000) return 'expiring_soon';
  return 'valid';
}

/** True when this platform has an official refresh flow the framework may use. */
export function refreshSupported(platform) {
  return platform === 'pinterest' || platform === 'facebook' || platform === 'instagram' || platform === 'youtube';
}

export function daysUntilExpiry(account, now = Date.now()) {
  if (!account?.token_expires_at) return null;
  const expires = Date.parse(account.token_expires_at);
  if (!Number.isFinite(expires)) return null;
  return Math.floor((expires - now) / (24 * 60 * 60 * 1000));
}

/** Every stored account with its expiry status (for health checks / owner alerts). Never includes a token. */
export async function listExpiringAccounts(env, warnDays = EXPIRY_WARN_DAYS) {
  const accounts = (await listAccounts(env)) || [];
  return accounts.map((a) => ({
    platform: a.platform,
    accountName: a.account_name || null,
    status: a.status,
    tokenStatus: tokenExpiryStatus(a, { warnDays }),
    tokenExpiresAt: a.token_expires_at || null,
    daysLeft: daysUntilExpiry(a),
    refreshSupported: refreshSupported(a.platform),
    refreshTokenExpiresAt: a.refresh_token_expires_at || null,
  }));
}

function clientCreds(env, platform) {
  const keys = OAUTH_CLIENT_ENV[platform];
  if (!keys) return {};
  return { clientId: env?.[keys.id] || null, clientSecret: env?.[keys.secret] || null };
}

async function fetchJson(fetchFn, url, options = {}) {
  const res = await fetchFn(url, options);
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    const detail = data?.error_description || data?.error?.message || data?.error || text.slice(0, 200);
    throw new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
      `Token refresh failed (HTTP ${res.status}): ${detail}`,
      { kind: 'needs_owner', ownerAction: 'Re-authorize the account (owner OAuth).' });
  }
  return data;
}

/**
 * Refresh one account's access token. Returns
 * { accessToken, refreshToken|null, expiresAt|null, refreshTokenExpiresAt|null }.
 * Throws WAITING_FOR_AUTHORIZATION when no refresh is possible.
 */
export async function refreshAccessToken(env, platform, account, { fetchFn } = {}) {
  const def = platformDef(platform);
  if (!def) throw new SocialError(SOCIAL_CODES.PERMANENT, `Unknown social platform: ${platform}`, { kind: 'permanent', platform });
  if (!isPostablePlatform(platform)) {
    throw new SocialError(SOCIAL_CODES.PLATFORM_UNAVAILABLE, `${platform}: no free official posting path — nothing to refresh.`, { kind: 'permanent', platform });
  }
  if (platform === 'linkedin') {
    throw waitingForAuthorization(platform, 'LinkedIn self-serve apps get NO refresh tokens — re-authorize every 60 days (owner OAuth).');
  }
  if (platform === 'youtube' && env?.YOUTUBE_DATA_API_ENABLED !== 'true') {
    throw new SocialError(SOCIAL_CODES.PLATFORM_UNAVAILABLE,
      'YouTube Data API is DO-NOT-USE (Testing consent screen: uploads land PRIVATE; needs Production + Google audit). Token refresh is disabled with it.',
      { kind: 'permanent', platform });
  }
  if (!account?.refresh_token_enc) {
    throw waitingForAuthorization(platform, 'no refresh token is stored for this account.');
  }
  const fetchImpl = fetchFn || globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const refreshToken = await decryptToken(account.refresh_token_enc, env.SOCIAL_TOKEN_SECRET);
  const { clientId, clientSecret } = clientCreds(env, platform);
  const now = Date.now();

  if (platform === 'pinterest') {
    if (!clientId || !clientSecret) throw waitingForAuthorization(platform, 'Pinterest client id/secret are not configured (Worker env).');
    const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const data = await fetchJson(fetchImpl, 'https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(binary)}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: data.expires_in ? new Date(now + data.expires_in * 1000).toISOString() : null,
      refreshTokenExpiresAt: new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  if (platform === 'facebook') {
    if (!clientId || !clientSecret) throw waitingForAuthorization(platform, 'Facebook app id/secret are not configured (Worker env).');
    const longLived = await fetchJson(fetchImpl,
      `https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&fb_exchange_token=${encodeURIComponent(refreshToken)}`);
    const userToken = longLived.access_token;
    const accounts = await fetchJson(fetchImpl,
      `https://graph.facebook.com/v26.0/me/accounts?access_token=${encodeURIComponent(userToken)}`);
    const page = (accounts?.data || [])[0];
    if (!page?.access_token) throw waitingForAuthorization(platform, 'no Page token returned during refresh.');
    return { accessToken: page.access_token, refreshToken: userToken, expiresAt: null, refreshTokenExpiresAt: null };
  }
  if (platform === 'instagram') {
    if (!clientSecret) throw waitingForAuthorization(platform, 'Instagram client secret is not configured (Worker env).');
    const data = await fetchJson(fetchImpl,
      `https://graph.instagram.com/access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(refreshToken)}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.access_token,
      expiresAt: data.expires_in ? new Date(now + data.expires_in * 1000).toISOString() : null,
      refreshTokenExpiresAt: null,
    };
  }
  if (platform === 'youtube') {
    if (!clientId || !clientSecret) throw waitingForAuthorization(platform, 'YouTube OAuth client id/secret are not configured (Worker env).');
    const data = await fetchJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }).toString(),
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: data.expires_in ? new Date(now + data.expires_in * 1000).toISOString() : null,
      refreshTokenExpiresAt: null,
    };
  }
  throw new SocialError(SOCIAL_CODES.PERMANENT, `No refresh flow implemented for platform: ${platform}`, { kind: 'permanent', platform });
}

/**
 * Refresh + persist: loads the account, refreshes the token, stores
 * the new encrypted tokens + expiries, and returns the updated
 * account summary (never a token). Throws WAITING_FOR_AUTHORIZATION
 * when refresh is impossible — the caller records that, never a
 * success.
 */
export async function refreshAccountToken(env, platform, { fetchFn } = {}) {
  const account = await getAccount(env, platform);
  if (!account) throw waitingForAuthorization(platform, 'no account row exists for this platform.');
  const refreshed = await refreshAccessToken(env, platform, account, { fetchFn });
  if (!refreshed?.accessToken) {
    throw waitingForAuthorization(platform, 'refresh returned no access token.');
  }
  const accessTokenEnc = await encryptToken(refreshed.accessToken, env.SOCIAL_TOKEN_SECRET);
  const refreshTokenEnc = refreshed.refreshToken
    ? await encryptToken(refreshed.refreshToken, env.SOCIAL_TOKEN_SECRET)
    : undefined;
  const updated = await updateAccountTokens(env, account.id, {
    accessTokenEnc,
    refreshTokenEnc,
    tokenExpiresAt: refreshed.expiresAt ?? undefined,
    refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? undefined,
  });
  return {
    platform, accountId: account.id, tokenStatus: tokenExpiryStatus(updated || account),
    tokenExpiresAt: updated?.token_expires_at || refreshed.expiresAt || null,
  };
}
