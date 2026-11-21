/**
 * FS AI — Social: adapter factory.
 *
 * getAdapter(platform, { account, fetchFn, env, delayFn }) returns the
 * adapter for a SUPPORTED FREE / LIMITED FREE platform. X (UNAVAILABLE
 * FREE OF COST) has no adapter and throws a PLATFORM_UNAVAILABLE
 * SocialError — the dispatcher refuses it before any network call.
 *
 * loadAccountWithToken(env, platform) reads the social_accounts row
 * and decrypts the stored access token (AES-GCM, SOCIAL_TOKEN_SECRET)
 * into a non-persisted `_accessToken` property on the returned object.
 * The decrypted token lives only in memory for the duration of the
 * call and is never written back to D1, never logged, and never
 * returned to any client.
 */
import { SocialError, SOCIAL_CODES, platformUnavailable } from '../errors.js';
import { platformDef, isPostablePlatform } from '../platforms.js';
import { decryptToken } from '../tokens.js';
import { getAccount } from '../store.js';
import { PinterestAdapter } from './pinterest.js';
import { FacebookAdapter } from './facebook.js';
import { InstagramAdapter } from './instagram.js';
import { LinkedinAdapter } from './linkedin.js';
import { YoutubeAdapter } from './youtube.js';

const ADAPTERS = {
  pinterest: PinterestAdapter,
  facebook: FacebookAdapter,
  instagram: InstagramAdapter,
  linkedin: LinkedinAdapter,
  youtube: YoutubeAdapter,
};

export function getAdapter(platform, options = {}) {
  const def = platformDef(platform);
  if (!def) throw new SocialError(SOCIAL_CODES.PERMANENT, `Unknown social platform: ${platform}`, { kind: 'permanent', platform });
  if (!isPostablePlatform(platform)) {
    throw platformUnavailable(platform, def.notes || 'no free official posting path exists.');
  }
  const Adapter = ADAPTERS[platform];
  if (!Adapter) throw new SocialError(SOCIAL_CODES.PERMANENT, `No adapter implemented for platform: ${platform}`, { kind: 'permanent', platform });
  return new Adapter({ ...options });
}

export async function loadAccountWithToken(env, platform) {
  const account = await getAccount(env, platform);
  if (!account) return null;
  if (!account.access_token_enc) return { ...account, _accessToken: null };
  try {
    const token = await decryptToken(account.access_token_enc, env.SOCIAL_TOKEN_SECRET);
    return { ...account, _accessToken: token };
  } catch (err) {
    // A token that cannot be decrypted is treated as "no usable token"
    // — the adapter will fail with WAITING_FOR_AUTHORIZATION, and the
    // owner re-authorizes. Never fall back to plain text.
    const failed = { ...account, _accessToken: null, _tokenError: err.message };
    return failed;
  }
}
