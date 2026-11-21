/**
 * FS AI — Social: Instagram adapter (Graph API v26.0, SUPPORTED FREE).
 *
 * Instagram Login path (graph.instagram.com, NO Facebook Page needed):
 * scopes instagram_business_basic + instagram_business_content_publish.
 * Business/Creator account required — personal accounts cannot publish.
 *
 * Two-step flow, media must be a PUBLIC HTTPS URL (no upload in the
 * request body):
 *   1. POST /{ig-user-id}/media {image_url, caption} -> container id
 *   2. Poll GET /{container-id}?fields=status_code until FINISHED
 *      (ERROR / EXPIRED are terminal; containers expire after 24h, so
 *      the container is created at publish time only — never days ahead)
 *   3. POST /{ig-user-id}/media_publish {creation_id} -> media id
 * Verify-back: GET /{media-id}?fields=id,permalink,timestamp.
 *
 * Framework guardrail: 25 API-published posts / 24h (the lowest
 * published figure; sources disagree 25 vs 50 vs 100).
 */
import { BaseAdapter } from './base.js';
import { SocialError, SOCIAL_CODES } from '../errors.js';
import { validatePostContent } from '../content.js';

const MAX_POLLS = 10;
const POLL_INTERVAL_MS = 3000;

export class InstagramAdapter extends BaseAdapter {
  get platform() { return 'instagram'; }
  get apiBase() { return 'https://graph.instagram.com/v26.0'; }

  get igUserId() {
    return this.account?.account_id || this.env.INSTAGRAM_USER_ID || null;
  }

  async validateCredentials() {
    this.assertTokenUsable();
    if (!this.igUserId) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'Instagram: no Instagram user id stored for this account — connect the Instagram Business/Creator account first (owner action).',
        { kind: 'permanent', platform: 'instagram' });
    }
    const me = await this.apiCall(`/${encodeURIComponent(this.igUserId)}?fields=id,username,account_type`);
    if (me?.account_type && !['BUSINESS', 'CREATOR'].includes(String(me.account_type).toUpperCase())) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        `Instagram: account type '${me.account_type}' cannot publish via the API — switch the account to Business or Creator (owner action).`,
        { kind: 'permanent', platform: 'instagram', ownerAction: 'Switch the Instagram account to Business or Creator in the Instagram app.' });
    }
    return { ok: true, accountName: me?.username || null, detail: 'Instagram user read OK.' };
  }

  async publish(post) {
    this.assertTokenUsable();
    if (!this.igUserId) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'Instagram: no Instagram user id stored for this account — connect the Instagram Business/Creator account first (owner action).',
        { kind: 'permanent', platform: 'instagram' });
    }
    const problems = validatePostContent(post.content, 'instagram');
    if (problems.length) {
      throw new SocialError(SOCIAL_CODES.VALIDATION, `Instagram: ${problems.join(' ')}`,
        { kind: 'permanent', platform: 'instagram' });
    }
    const params = new URLSearchParams();
    params.set('image_url', post.content.mediaUrl);
    params.set('caption', post.content.caption);
    const container = await this.apiCall(`/${encodeURIComponent(this.igUserId)}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!container?.id) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'Instagram: media container creation returned no id — not treated as published.',
        { kind: 'permanent', platform: 'instagram' });
    }
    // Poll until FINISHED. ERROR/EXPIRED are terminal — never retry those.
    let status = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      const state = await this.apiCall(`/${encodeURIComponent(container.id)}?fields=status_code`);
      status = state?.status_code;
      if (status === 'FINISHED') break;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new SocialError(SOCIAL_CODES.PERMANENT,
          `Instagram: media container ${status} — the media could not be processed. Check the image URL (public HTTPS, JPEG ≤8 MB, 4:5–1.91:1).`,
          { kind: 'permanent', platform: 'instagram' });
      }
      await this.delayFn(POLL_INTERVAL_MS);
    }
    if (status !== 'FINISHED') {
      throw new SocialError(SOCIAL_CODES.TRANSIENT,
        'Instagram: media container did not reach FINISHED in time — safe to retry once.',
        { kind: 'transient', platform: 'instagram' });
    }
    const publishParams = new URLSearchParams();
    publishParams.set('creation_id', String(container.id));
    const published = await this.apiCall(`/${encodeURIComponent(this.igUserId)}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
    });
    if (!published?.id) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'Instagram: media_publish returned no id — not treated as published.',
        { kind: 'permanent', platform: 'instagram' });
    }
    return { platformPostId: String(published.id), url: null, status: 'published' };
  }

  async verify(platformPostId) {
    this.assertTokenUsable();
    try {
      const media = await this.apiCall(`/${encodeURIComponent(platformPostId)}?fields=id,permalink,timestamp`);
      if (media?.id) return { found: true, url: media.permalink || null };
      return { found: false };
    } catch (err) {
      if (err instanceof SocialError && err.status === 404) return { found: false };
      throw err;
    }
  }
}
