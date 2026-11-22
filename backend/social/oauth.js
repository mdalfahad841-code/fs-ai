/**
 * FS AI — Social: OAuth (state validation, authorization URLs,
 * code-for-token exchange). Pure + fetch-injected helpers; no D1
 * writes here — the route stores the encrypted tokens after a
 * successful exchange.
 *
 * STATE: stateless, HMAC-SHA256-signed (key = SOCIAL_TOKEN_SECRET),
 * 10-minute expiry, bound to one platform. A state token that fails
 * the signature, the platform binding, or the expiry is rejected —
 * no token exchange ever runs on a forged or replayed state.
 * The client id/secret come from Worker env (never hard-coded, never
 * logged): PINTEREST_CLIENT_ID/SECRET, FACEBOOK_APP_ID/SECRET,
 * INSTAGRAM_CLIENT_ID/SECRET (Meta app), LINKEDIN_CLIENT_ID/SECRET,
 * YOUTUBE_CLIENT_ID/SECRET (Google OAuth client).
 *
 * Token endpoints are the official ones from
 * docs/SOCIAL-PLATFORMS-2026-11-21.md. Exchange returns
 * { accessToken, refreshToken|null, expiresIn|null (seconds),
 *   accountId|null, accountName|null } — never the raw response.
 */
import { SocialError, SOCIAL_CODES } from './errors.js';
import { platformDef, isPostablePlatform } from './platforms.js';

const STATE_TTL_MS = 10 * 60 * 1000;

function b64urlEncode(bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function hmacKey(secret) {
  if (!secret) throw new Error('SOCIAL_TOKEN_SECRET is not configured — OAuth state cannot be signed.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Create a signed state token for one platform. `now` is injectable for tests. */
export async function createOAuthState(secret, platform, { now = Date.now() } = {}) {
  if (!platformDef(platform)) throw new Error(`Unknown social platform: ${platform}`);
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload = { p: platform, n: b64urlEncode(nonce.buffer), exp: now + STATE_TTL_MS };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)).buffer);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

/**
 * Validate a state token for the expected platform. Returns the
 * decoded payload or throws. `now` is injectable for tests.
 */
export async function validateOAuthState(secret, state, expectedPlatform, { now = Date.now() } = {}) {
  if (typeof state !== 'string' || !state.includes('.')) {
    throw new SocialError(SOCIAL_CODES.VALIDATION, 'OAuth state is missing or malformed — refusing the callback.', { kind: 'permanent' });
  }
  const [payloadB64, sigB64] = state.split('.');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    throw new SocialError(SOCIAL_CODES.VALIDATION, 'OAuth state could not be decoded — refusing the callback.', { kind: 'permanent' });
  }
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), new TextEncoder().encode(payloadB64));
  if (!ok) {
    throw new SocialError(SOCIAL_CODES.VALIDATION, 'OAuth state signature is invalid — refusing the callback.', { kind: 'permanent' });
  }
  if (payload.p !== expectedPlatform) {
    throw new SocialError(SOCIAL_CODES.VALIDATION, `OAuth state was issued for '${payload.p}', not '${expectedPlatform}' — refusing the callback.`, { kind: 'permanent' });
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new SocialError(SOCIAL_CODES.VALIDATION, 'OAuth state has expired (10 minutes) — start the connection again.', { kind: 'permanent' });
  }
  return payload;
}

export const OAUTH_AUTHORIZE_URLS = {
  pinterest: 'https://www.pinterest.com/oauth/',
  facebook: 'https://www.facebook.com/v26.0/dialog/oauth',
  instagram: 'https://www.instagram.com/oauth/authorize',
  linkedin: 'https://www.linkedin.com/oauth/v2/authorization',
  youtube: 'https://accounts.google.com/o/oauth2/v2/auth',
};

export const OAUTH_CLIENT_ENV = {
  pinterest: { id: 'PINTEREST_CLIENT_ID', secret: 'PINTEREST_CLIENT_SECRET' },
  facebook: { id: 'FACEBOOK_APP_ID', secret: 'FACEBOOK_APP_SECRET' },
  instagram: { id: 'INSTAGRAM_CLIENT_ID', secret: 'INSTAGRAM_CLIENT_SECRET' },
  linkedin: { id: 'LINKEDIN_CLIENT_ID', secret: 'LINKEDIN_CLIENT_SECRET' },
  youtube: { id: 'YOUTUBE_CLIENT_ID', secret: 'YOUTUBE_CLIENT_SECRET' },
};

/** Redirect URI for a platform: SOCIAL_OAUTH_REDIRECT_BASE + /api/social/oauth/:platform/callback. */
export function oauthRedirectUri(env, platform) {
  const base = String(env?.SOCIAL_OAUTH_REDIRECT_BASE || 'https://fs-ai.mdalfahad841.workers.dev').replace(/\/$/, '');
  return `${base}/api/social/oauth/${platform}/callback`;
}

/**
 * Build the authorization URL the owner must open. Scopes default to
 * the platform's required set (platforms.js). Returns the URL string.
 */
export function authorizationUrl(platform, { clientId, redirectUri, state, scopes } = {}) {
  const def = platformDef(platform);
  if (!def) throw new Error(`Unknown social platform: ${platform}`);
  if (!isPostablePlatform(platform)) {
    throw new SocialError(SOCIAL_CODES.PLATFORM_UNAVAILABLE,
      `${platform}: no free official posting path — there is no authorization URL for it.`,
      { kind: 'permanent', platform });
  }
  if (!clientId) throw new Error(`${platform}: OAuth client id is not configured (Worker env).`);
  if (!redirectUri) throw new Error(`${platform}: OAuth redirect URI is required.`);
  const url = new URL(OAUTH_AUTHORIZE_URLS[platform]);
  const scopeList = scopes && scopes.length ? scopes : def.scopes;
  switch (platform) {
    case 'pinterest':
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scopeList.join(' '));
      url.searchParams.set('state', state);
      break;
    case 'facebook':
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scopeList.join(','));
      url.searchParams.set('state', state);
      break;
    case 'instagram':
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scopeList.join(','));
      url.searchParams.set('state', state);
      break;
    case 'linkedin':
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scopeList.join(' '));
      url.searchParams.set('state', state);
      break;
    case 'youtube':
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scopeList.join(' '));
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
      break;
    default:
      throw new Error(`No authorization URL builder for platform: ${platform}`);
  }
  return url.toString();
}

/** Required scopes for a platform minus the granted ones (empty = fully authorized). */
export function missingScopes(platform, grantedScopes) {
  const def = platformDef(platform);
  if (!def) return [];
  const granted = new Set((grantedScopes || []).map((s) => String(s)));
  return def.scopes.filter((s) => !granted.has(s));
}

/** True when the granted scopes cover everything the platform needs. */
export function hasRequiredScopes(platform, grantedScopes) {
  return missingScopes(platform, grantedScopes).length === 0;
}

async function postForm(fetchFn, url, params, { basicAuth = null } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basicAuth) {
    // Standard base64 for HTTP Basic auth (not base64url).
    const bytes = new TextEncoder().encode(basicAuth);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    headers.Authorization = `Basic ${btoa(binary)}`;
  }
  const res = await fetchFn(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = data?.error_description || data?.error?.message || data?.error || text.slice(0, 200);
    throw new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
      `Token exchange failed (HTTP ${res.status}): ${detail}`,
      { kind: 'needs_owner', platform: null, ownerAction: 'Re-run the OAuth connection for this platform (owner action).' });
  }
  return data;
}

async function getJson(fetchFn, url, headers = {}) {
  const res = await fetchFn(url, { method: 'GET', headers });
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error_description || text.slice(0, 200);
    throw new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
      `Platform call failed (HTTP ${res.status}): ${detail}`,
      { kind: 'needs_owner', ownerAction: 'Re-run the OAuth connection for this platform (owner action).' });
  }
  return data;
}

/**
 * Exchange an authorization code for tokens (one platform at a time).
 * `creds` = { clientId, clientSecret, redirectUri }. fetchFn is
 * injectable (tests use a mock; production uses global fetch).
 * Facebook/Instagram do the short-lived -> long-lived exchange inline
 * because only the long-lived token is worth storing.
 */
export async function exchangeCodeForTokens(platform, { code, clientId, clientSecret, redirectUri, fetchFn }) {
  const fetchImpl = fetchFn || globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!code) throw new SocialError(SOCIAL_CODES.VALIDATION, 'OAuth code is missing — the callback has nothing to exchange.', { kind: 'permanent', platform });
  if (!clientId || !clientSecret) throw new SocialError(SOCIAL_CODES.VALIDATION, `${platform}: OAuth client id/secret are not configured (Worker env).`, { kind: 'permanent', platform });

  if (platform === 'pinterest') {
    const data = await postForm(fetchImpl, 'https://api.pinterest.com/v5/oauth/token', {
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    }, { basicAuth: `${clientId}:${clientSecret}` });
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresIn: data.expires_in || null, accountId: null, accountName: null };
  }
  if (platform === 'facebook') {
    const short = await getJson(fetchImpl,
      `https://graph.facebook.com/v26.0/oauth/access_token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`);
    const longLived = await getJson(fetchImpl,
      `https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&fb_exchange_token=${encodeURIComponent(short.access_token)}`);
    const userToken = longLived.access_token || short.access_token;
    const accounts = await getJson(fetchImpl,
      `https://graph.facebook.com/v26.0/me/accounts?access_token=${encodeURIComponent(userToken)}`);
    const page = (accounts?.data || [])[0];
    if (!page?.access_token) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'Facebook: no Page access token returned — the owner must be a Page admin and grant pages_manage_posts.',
        { kind: 'permanent', platform, ownerAction: 'Grant the FS AI Page admin role and re-run the connection.' });
    }
    return { accessToken: page.access_token, refreshToken: null, expiresIn: null, accountId: page.id || null, accountName: page.name || null };
  }
  if (platform === 'instagram') {
    const short = await postForm(fetchImpl, 'https://graph.instagram.com/oauth/access_token', {
      client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code,
    });
    const longLived = await getJson(fetchImpl,
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(short.access_token)}`);
    return { accessToken: longLived.access_token || short.access_token, refreshToken: null, expiresIn: longLived.expires_in || null, accountId: short.user_id ? String(short.user_id) : null, accountName: null };
  }
  if (platform === 'linkedin') {
    const data = await postForm(fetchImpl, 'https://www.linkedin.com/oauth/v2/accessToken', {
      grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
    });
    const me = await getJson(fetchImpl, 'https://api.linkedin.com/v2/userinfo',
      { Authorization: `Bearer ${data.access_token}` });
    const sub = me?.sub || null;
    return { accessToken: data.access_token, refreshToken: null, expiresIn: data.expires_in || null, accountId: sub ? `urn:li:person:${sub}` : null, accountName: me?.name || null };
  }
  if (platform === 'youtube') {
    const data = await postForm(fetchImpl, 'https://oauth2.googleapis.com/token', {
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresIn: data.expires_in || null, accountId: null, accountName: null };
  }
  throw new SocialError(SOCIAL_CODES.PLATFORM_UNAVAILABLE, `${platform}: no OAuth exchange is implemented.`, { kind: 'permanent', platform });
}
