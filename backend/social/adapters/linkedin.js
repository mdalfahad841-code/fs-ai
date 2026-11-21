/**
 * FS AI — Social: LinkedIn adapter (Posts API /rest/posts, SUPPORTED FREE).
 *
 * Own-profile posting is self-serve: add the "Share on LinkedIn"
 * product, scope w_member_social, no review. POST /rest/posts with
 * `LinkedIn-Version: YYYYMM` + `X-Restli-Protocol-Version: 2.0.0`
 * headers. The legacy /v2/ugcPosts endpoint is NOT used.
 *
 * Text + article-link posts need no media. Image posts use the 2-step
 * asset flow: POST /rest/images?action=initializeUpload -> PUT the
 * bytes to the returned uploadUrl -> create the post with the image URN.
 *
 * Verify-back: NOT AVAILABLE. Reading a member's own posts needs
 * r_member_social, which LinkedIn has closed to new requests — so
 * verify() returns found: null and the dispatcher records the post as
 * published on the strength of the 201 creation response, with an
 * honest "read-back unavailable" note. Company Page posting
 * (w_organization_social, vetted Community Management API) is OUT OF
 * SCOPE for this adapter — member posts only.
 */
import { BaseAdapter } from './base.js';
import { SocialError, SOCIAL_CODES } from '../errors.js';
import { validatePostContent } from '../content.js';

const LINKEDIN_VERSION = '202611';

export class LinkedinAdapter extends BaseAdapter {
  get platform() { return 'linkedin'; }
  get apiBase() { return 'https://api.linkedin.com'; }

  get authorUrn() {
    // Stored as account_id at connect time: `urn:li:person:{id}`.
    return this.account?.account_id || this.env.LINKEDIN_PERSON_URN || null;
  }

  versionHeaders(extra = {}) {
    return { 'LinkedIn-Version': LINKEDIN_VERSION, 'X-Restli-Protocol-Version': '2.0.0', ...extra };
  }

  async validateCredentials() {
    this.assertTokenUsable();
    if (!this.authorUrn || !this.authorUrn.startsWith('urn:li:person:')) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'LinkedIn: no person URN stored for this account — connect the owner LinkedIn profile first (owner action).',
        { kind: 'permanent', platform: 'linkedin' });
    }
    // No cheap read endpoint is available to self-serve apps (userinfo
    // needs the OpenID product). The author URN shape + a live token is
    // the check; a real post attempt is the first true proof.
    return { ok: true, accountName: this.account?.account_name || null, detail: 'LinkedIn author URN present; token not expired. (No read-back endpoint is available to self-serve apps.)' };
  }

  async uploadImage(mediaBytes) {
    const init = await this.apiCall('/rest/images?action=initializeUpload', {
      method: 'POST',
      headers: this.versionHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner: this.authorUrn } }),
    });
    const uploadUrl = init?.value?.uploadUrl;
    const imageUrn = init?.value?.image;
    if (!uploadUrl || !imageUrn) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'LinkedIn: image upload initialization returned no upload URL — not treated as published.',
        { kind: 'permanent', platform: 'linkedin' });
    }
    const put = await this.fetchFn(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/octet-stream' },
      body: mediaBytes,
    });
    if (!put.ok) {
      const text = await put.text().catch(() => '');
      throw new SocialError(SOCIAL_CODES.TRANSIENT,
        `LinkedIn: image byte upload failed (HTTP ${put.status}). ${text.slice(0, 200)}`,
        { kind: 'transient', status: put.status, platform: 'linkedin' });
    }
    return imageUrn;
  }

  async publish(post) {
    this.assertTokenUsable();
    if (!this.authorUrn || !this.authorUrn.startsWith('urn:li:person:')) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'LinkedIn: no person URN stored for this account — connect the owner LinkedIn profile first (owner action).',
        { kind: 'permanent', platform: 'linkedin' });
    }
    const problems = validatePostContent(post.content, 'linkedin');
    if (problems.length) {
      throw new SocialError(SOCIAL_CODES.VALIDATION, `LinkedIn: ${problems.join(' ')}`,
        { kind: 'permanent', platform: 'linkedin' });
    }
    let shareMediaCategory = 'ARTICLE';
    let media = [{ status: 'READY', originalUrl: post.content.link }];
    if (post.mediaBytes) {
      const imageUrn = await this.uploadImage(post.mediaBytes);
      shareMediaCategory = 'IMAGE';
      media = [{ status: 'READY', media: imageUrn }];
    } else if (!post.content.link) {
      shareMediaCategory = 'NONE';
      media = [];
    }
    const created = await this.apiCall('/rest/posts', {
      method: 'POST',
      headers: this.versionHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        author: this.authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: post.content.caption },
            shareMediaCategory,
            media,
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });
    if (!created?.id) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'LinkedIn: create call succeeded but returned no post id — not treated as published.',
        { kind: 'permanent', platform: 'linkedin' });
    }
    return {
      platformPostId: String(created.id),
      url: null,
      status: 'published',
      verifyNote: 'LinkedIn read-back is unavailable to self-serve apps (r_member_social closed) — publication is confirmed by the 201 creation response only.',
    };
  }

  async verify() {
    // No read endpoint for self-serve apps: found === null means
    // "cannot verify by reading back", NOT "not found".
    return { found: null, note: 'LinkedIn read-back unavailable (r_member_social closed to new requests).' };
  }
}
