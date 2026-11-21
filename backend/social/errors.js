/**
 * FS AI — Social: typed errors.
 *
 * Every failure in the social pipeline carries a machine-readable code
 * so the dispatcher, the routes and the owner reports can tell a
 * "needs the owner's click" failure from a "retry later" failure from a
 * "never retry this" failure. No error is ever swallowed silently: the
 * dispatcher records platform, post id, root cause, timestamp and retry
 * history on the social_posts row.
 */
export class SocialError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'SocialError';
    this.code = code;
    // 'transient' | 'permanent' | 'needs_owner' — decides retry vs stop.
    this.kind = options.kind || 'permanent';
    this.status = options.status || null; // HTTP status from the platform, if any.
    this.retryAfterSeconds = options.retryAfterSeconds || null;
    this.ownerAction = options.ownerAction || null; // what the owner must do, if anything.
    this.platform = options.platform || null;
  }
}

export const SOCIAL_CODES = {
  NOT_CONNECTED: 'NOT_CONNECTED', // no OAuth has completed for this platform
  WAITING_FOR_AUTHORIZATION: 'WAITING_FOR_AUTHORIZATION', // token expired/revoked/denied
  RATE_LIMITED: 'RATE_LIMITED', // platform or daily-cap rate limit
  DUPLICATE: 'DUPLICATE', // same article already posted/scheduled to this platform
  VALIDATION: 'VALIDATION', // caption/media/permissions invalid before any call
  TRANSIENT: 'TRANSIENT', // 429/5xx/network — safe to retry, max 3 attempts
  PERMANENT: 'PERMANENT', // 400/404/unsupported — never retry
  ESTOP: 'ESTOP', // Emergency Stop is ON — all posting halted
  PLATFORM_UNAVAILABLE: 'PLATFORM_UNAVAILABLE', // no free official posting path exists
  UNVERIFIED: 'UNVERIFIED', // platform accepted the create but verify-back failed
};

export function notConnected(platform) {
  return new SocialError(SOCIAL_CODES.NOT_CONNECTED,
    `${platform}: not connected — owner OAuth required. No post was made.`,
    { kind: 'needs_owner', platform, ownerAction: `Connect the ${platform} account (owner OAuth). See docs/SOCIAL-PLATFORMS-2026-11-21.md.` });
}

export function waitingForAuthorization(platform, detail) {
  return new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
    `${platform}: authorization needed — ${detail || 'access token expired, revoked or denied.'} No post was made.`,
    { kind: 'needs_owner', platform, ownerAction: `Re-authorize the ${platform} account (owner OAuth).` });
}

export function platformUnavailable(platform, reason) {
  return new SocialError(SOCIAL_CODES.PLATFORM_UNAVAILABLE,
    `${platform}: no free official posting path — ${reason}`,
    { kind: 'permanent', platform });
}

/** Classify an HTTP status from a platform API into a SocialError kind. */
export function errorForHttpStatus(platform, status, bodyText, retryAfterSeconds = null) {
  const detail = bodyText ? ` Platform said: ${String(bodyText).slice(0, 300)}` : '';
  if (status === 401 || status === 403) {
    return new SocialError(SOCIAL_CODES.WAITING_FOR_AUTHORIZATION,
      `${platform}: access denied (HTTP ${status}). Token expired, revoked, or missing the required permission.${detail}`,
      { kind: 'needs_owner', status, platform, ownerAction: `Re-authorize the ${platform} account (owner OAuth).` });
  }
  if (status === 429) {
    return new SocialError(SOCIAL_CODES.RATE_LIMITED,
      `${platform}: rate limited (HTTP 429).${detail}`,
      { kind: 'transient', status, platform, retryAfterSeconds });
  }
  if (status >= 500 && status <= 599) {
    return new SocialError(SOCIAL_CODES.TRANSIENT,
      `${platform}: platform error (HTTP ${status}).${detail}`,
      { kind: 'transient', status, platform });
  }
  return new SocialError(SOCIAL_CODES.PERMANENT,
    `${platform}: request rejected (HTTP ${status}).${detail}`,
    { kind: 'permanent', status, platform });
}
