/**
 * FS AI — Social: Facebook Page adapter (Graph API v26.0, SUPPORTED FREE).
 *
 * Pages only — apps cannot publish to personal timelines (since 2018).
 * POST /{page-id}/feed (text/link) or /{page-id}/photos (image + caption).
 * Own Page + app in Development mode works with NO App Review (the
 * owner holds an admin/developer role on the app); Advanced Access for
 * other people's Pages needs App Review + Business Verification.
 * Verify-back: GET /{post-id}?fields=id,permalink_url,created_time.
 */
import { BaseAdapter } from './base.js';
import { SocialError, SOCIAL_CODES } from '../errors.js';
import { validatePostContent } from '../content.js';

export class FacebookAdapter extends BaseAdapter {
  get platform() { return 'facebook'; }
  get apiBase() { return 'https://graph.facebook.com/v26.0'; }

  get pageId() {
    return this.account?.account_id || this.env.FACEBOOK_PAGE_ID || null;
  }

  async validateCredentials() {
    this.assertTokenUsable();
    if (!this.pageId) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'Facebook: no Page id stored for this account — connect the FS AI Facebook Page first (owner action).',
        { kind: 'permanent', platform: 'facebook' });
    }
    const page = await this.apiCall(`/${encodeURIComponent(this.pageId)}?fields=id,name`);
    return { ok: true, accountName: page?.name || null, detail: 'Facebook Page read OK.' };
  }

  async publish(post) {
    this.assertTokenUsable();
    if (!this.pageId) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'Facebook: no Page id stored for this account — connect the FS AI Facebook Page first (owner action).',
        { kind: 'permanent', platform: 'facebook' });
    }
    const problems = validatePostContent(post.content, 'facebook');
    if (problems.length) {
      throw new SocialError(SOCIAL_CODES.VALIDATION, `Facebook: ${problems.join(' ')}`,
        { kind: 'permanent', platform: 'facebook' });
    }
    const params = new URLSearchParams();
    let endpoint;
    if (post.content.mediaUrl) {
      endpoint = `/${encodeURIComponent(this.pageId)}/photos`;
      params.set('url', post.content.mediaUrl);
      params.set('caption', post.content.caption);
    } else {
      endpoint = `/${encodeURIComponent(this.pageId)}/feed`;
      params.set('message', post.content.caption);
      if (post.content.link) params.set('link', post.content.link);
    }
    const created = await this.apiCall(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!created?.id && !created?.post_id) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'Facebook: create call succeeded but returned no post id — not treated as published.',
        { kind: 'permanent', platform: 'facebook' });
    }
    const id = String(created.post_id || created.id);
    return { platformPostId: id, url: null, status: 'published' };
  }

  async verify(platformPostId) {
    this.assertTokenUsable();
    try {
      const found = await this.apiCall(`/${encodeURIComponent(platformPostId)}?fields=id,permalink_url,created_time`);
      if (found?.id) return { found: true, url: found.permalink_url || null };
      return { found: false };
    } catch (err) {
      if (err instanceof SocialError && err.status === 404) return { found: false };
      throw err;
    }
  }
}
