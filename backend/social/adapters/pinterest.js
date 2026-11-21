/**
 * FS AI — Social: Pinterest adapter (API v5, SUPPORTED FREE).
 *
 * POST /v5/pins — title ≤100, description ≤800, link ≤2048.
 * Media: image_url (public URL), image_base64, or a carousel of 2–5
 * images. Trial access: pins are visible to the owner only; Standard
 * access (demo-video review) makes them public. No publish-time field
 * — scheduling is done by our own social_posts table.
 * Verify-back: GET /v5/pins/{pin_id}. URL built from the id:
 * https://www.pinterest.com/pin/{id}/ (the API returns no permalink).
 *
 * Board resolution: post.boardId wins; else env.PINTEREST_BOARD_ID;
 * else the first board from GET /v5/boards (or the board matching
 * post.boardName). A Pin cannot exist without a board_id.
 */
import { BaseAdapter } from './base.js';
import { SocialError, SOCIAL_CODES } from '../errors.js';
import { validatePostContent } from '../content.js';

export class PinterestAdapter extends BaseAdapter {
  get platform() { return 'pinterest'; }
  get apiBase() { return 'https://api.pinterest.com/v5'; }

  async validateCredentials() {
    this.assertTokenUsable();
    const me = await this.apiCall('/user_account');
    return { ok: true, accountName: me?.username || me?.business_name || null, detail: 'Pinterest user_account read OK.' };
  }

  async resolveBoardId(post) {
    if (post.boardId) return String(post.boardId);
    if (this.env.PINTEREST_BOARD_ID) return String(this.env.PINTEREST_BOARD_ID);
    const boards = await this.apiCall('/boards?page_size=25');
    const items = boards?.items || [];
    if (post.boardName) {
      const match = items.find((b) => String(b.name || '').toLowerCase() === String(post.boardName).toLowerCase());
      if (match) return String(match.id);
    }
    if (items.length) return String(items[0].id);
    throw new SocialError(SOCIAL_CODES.VALIDATION,
      'Pinterest: no board found for this account — create a board on Pinterest first (owner action).',
      { kind: 'permanent', platform: 'pinterest', ownerAction: 'Create at least one board on the FS AI Pinterest account.' });
  }

  async publish(post) {
    this.assertTokenUsable();
    const problems = validatePostContent(post.content, 'pinterest');
    if (problems.length) {
      throw new SocialError(SOCIAL_CODES.VALIDATION, `Pinterest: ${problems.join(' ')}`,
        { kind: 'permanent', platform: 'pinterest' });
    }
    const boardId = await this.resolveBoardId(post);
    const mediaSource = post.content.mediaBase64
      ? { source_type: 'image_base64', data: post.content.mediaBase64 }
      : { source_type: 'image_url', url: post.content.mediaUrl };
    const body = {
      board_id: boardId,
      title: post.content.title,
      description: post.content.description,
      link: post.content.link,
      alt_text: post.content.description.slice(0, 500),
      media_source: mediaSource,
    };
    const created = await this.apiCall('/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!created?.id) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'Pinterest: create call succeeded but returned no pin id — not treated as published.',
        { kind: 'permanent', platform: 'pinterest' });
    }
    return {
      platformPostId: String(created.id),
      url: `https://www.pinterest.com/pin/${created.id}/`,
      status: 'published',
    };
  }

  async verify(platformPostId) {
    this.assertTokenUsable();
    try {
      const pin = await this.apiCall(`/pins/${encodeURIComponent(platformPostId)}`);
      if (pin?.id && String(pin.id) === String(platformPostId)) {
        return { found: true, url: `https://www.pinterest.com/pin/${pin.id}/` };
      }
      return { found: false };
    } catch (err) {
      if (err instanceof SocialError && err.status === 404) return { found: false };
      throw err;
    }
  }
}
