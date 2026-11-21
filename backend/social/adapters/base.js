/**
 * FS AI — Social: base adapter.
 *
 * Every platform adapter implements the same contract:
 *
 *   validateCredentials() -> { ok, accountName?, detail? }
 *     Cheap read-only call. Never posts. Throws SocialError on failure.
 *   publish(post) -> { platformPostId, url, status, warnings?, metrics? }
 *     Creates the post. Throws SocialError on failure. `post` is
 *     { content, mediaBytes?, boardId?, boardName? } where content is
 *     the output of backend/social/content.js buildPostContent().
 *   verify(platformPostId) -> { found: true|false|null, url?, metrics? }
 *     Reads the post back. `found: null` means the platform offers no
 *     read-back for this post type (LinkedIn) — creation confirmation
 *     is then the only proof, and the dispatcher records that honestly.
 *
 * Rules every adapter follows:
 *  - Token validity is checked BEFORE any write (expiry + a read call).
 *  - Tokens are sent only as an Authorization header and NEVER appear
 *    in an error message, a log line, or a stored record.
 *  - HTTP 401/403 -> WAITING_FOR_AUTHORIZATION (no retry);
 *    429/5xx/network -> TRANSIENT (dispatcher retries, max 3);
 *    anything else 4xx -> PERMANENT (no retry).
 *  - No adapter ever reports success without a platform response
 *    carrying a post id.
 */
import { SocialError, SOCIAL_CODES, errorForHttpStatus, waitingForAuthorization } from '../errors.js';

export class BaseAdapter {
  constructor({ account, fetchFn, env, delayFn } = {}) {
    this.account = account || null; // social_accounts row (tokens already decrypted by the dispatcher)
    this.fetchFn = fetchFn || globalThis.fetch?.bind(globalThis);
    this.env = env || {};
    // delayFn(ms) — injectable so tests run instantly; default is a real sleep.
    this.delayFn = delayFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (typeof this.fetchFn !== 'function') throw new Error('A fetch implementation is required.');
  }

  get platform() { throw new Error('Adapter must define platform.'); }
  get apiBase() { throw new Error('Adapter must define apiBase.'); }

  /** Decrypted access token for this account. Set by the dispatcher — adapters never decrypt. */
  get accessToken() { return this.account?._accessToken || null; }

  /** Pre-flight: token present, not expired, account status connected. */
  assertTokenUsable() {
    if (!this.account) {
      throw new SocialError(SOCIAL_CODES.NOT_CONNECTED,
        `${this.platform}: no account row — owner OAuth required.`, { kind: 'needs_owner', platform: this.platform });
    }
    if (this.account.status !== 'connected') {
      throw new SocialError(SOCIAL_CODES.NOT_CONNECTED,
        `${this.platform}: account status is '${this.account.status}' — owner OAuth required.`,
        { kind: 'needs_owner', platform: this.platform });
    }
    if (!this.accessToken) {
      throw waitingForAuthorization(this.platform, 'no usable access token is stored for this account.');
    }
    if (this.account.token_expires_at) {
      const expires = Date.parse(this.account.token_expires_at);
      if (Number.isFinite(expires) && expires <= Date.now()) {
        throw waitingForAuthorization(this.platform,
          `access token expired at ${this.account.token_expires_at}.`);
      }
    }
  }

  authHeaders(extra = {}) {
    return { Authorization: `Bearer ${this.accessToken}`, ...extra };
  }

  /**
   * One platform call. Returns parsed JSON on 2xx. Throws SocialError
   * otherwise (classified by status). The token never enters the error.
   */
  async apiCall(path, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    let response;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        response = await this.fetchFn(url, {
          method,
          headers: this.authHeaders(headers),
          body,
          signal: controller?.signal,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof SocialError) throw err;
      throw new SocialError(SOCIAL_CODES.TRANSIENT,
        `${this.platform}: network error calling the platform API (${err.message || 'fetch failed'}).`,
        { kind: 'transient', platform: this.platform });
    }
    const text = await response.text().catch(() => '');
    if (response.ok) {
      if (!text) return {};
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    }
    const retryAfter = response.headers?.get?.('retry-after');
    throw errorForHttpStatus(this.platform, response.status, text,
      retryAfter ? Number(retryAfter) || null : null);
  }

  async validateCredentials() { throw new Error('Adapter must implement validateCredentials().'); }
  async publish() { throw new Error('Adapter must implement publish().'); }
  async verify() { throw new Error('Adapter must implement verify().'); }
}
