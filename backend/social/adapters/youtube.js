/**
 * FS AI — Social: YouTube adapter (Data API v3, LIMITED FREE).
 *
 * videos.insert costs 1,600 of the 10,000 daily quota units per
 * project (≈6 uploads/day max). HARD CAVEATS, both recorded on every
 * publish result as warnings:
 *   - Uploads from an app that has not passed Google's API audit land
 *     PRIVATE whatever privacyStatus is requested.
 *   - A Testing-status OAuth consent screen issues refresh tokens that
 *     expire after 7 days; publish the app to Production for long-lived
 *     tokens.
 * The API takes video BYTES (multipart upload) — never a URL — so the
 * caller must supply post.mediaBytes (a rendered video file). There is
 * NO community-post endpoint: text-only "posts" are refused.
 *
 * FS AI's current Shorts flow is MANUAL browser upload and this
 * adapter NEVER replaces it. It exists for a future audited project
 * only; using it before the audit means private-only uploads.
 * Verify-back: GET /youtube/v3/videos?part=status,snippet&id=.
 */
import { BaseAdapter } from './base.js';
import { SocialError, SOCIAL_CODES } from '../errors.js';
import { validatePostContent } from '../content.js';

export class YoutubeAdapter extends BaseAdapter {
  get platform() { return 'youtube'; }
  get apiBase() { return 'https://www.googleapis.com/youtube/v3'; }

  async validateCredentials() {
    this.assertTokenUsable();
    const channels = await this.apiCall('/channels?part=id,snippet&mine=true');
    const channel = channels?.items?.[0];
    return {
      ok: true,
      accountName: channel?.snippet?.title || null,
      detail: 'YouTube channels.list (mine=true) OK.',
    };
  }

  async publish(post) {
    this.assertTokenUsable();
    const problems = validatePostContent(post.content, 'youtube');
    if (problems.length) {
      throw new SocialError(SOCIAL_CODES.VALIDATION, `YouTube: ${problems.join(' ')}`,
        { kind: 'permanent', platform: 'youtube' });
    }
    if (!post.mediaBytes || post.mediaBytes.byteLength === 0) {
      throw new SocialError(SOCIAL_CODES.VALIDATION,
        'YouTube: no video file supplied — the Data API uploads bytes, not URLs. Supply mediaBytes (a rendered video) or keep using the manual browser-upload flow.',
        { kind: 'permanent', platform: 'youtube' });
    }
    const metadata = {
      snippet: {
        title: post.content.title,
        description: post.content.description,
        tags: (post.content.hashtags || []).map((h) => String(h).replace(/^#/, '')),
        categoryId: '27', // Education — FS AI articles are explainers; owner may change per video.
      },
      status: { privacyStatus: post.privacyStatus || 'public', selfDeclaredMadeForKids: false },
    };
    // Multipart/related upload: metadata JSON part + media part.
    const boundary = `fsai-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaHeader = `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`;
    const end = `\r\n--${boundary}--`;
    const enc = new TextEncoder();
    const head = new Uint8Array([...enc.encode(metaPart), ...enc.encode(mediaHeader)]);
    const tail = enc.encode(end);
    const body = new Uint8Array(head.length + post.mediaBytes.byteLength + tail.length);
    body.set(head, 0);
    body.set(new Uint8Array(post.mediaBytes), head.length);
    body.set(tail, head.length + post.mediaBytes.byteLength);
    const created = await this.apiCall(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
        timeoutMs: 120000,
      });
    if (!created?.id) {
      throw new SocialError(SOCIAL_CODES.PERMANENT,
        'YouTube: videos.insert returned no video id — not treated as published.',
        { kind: 'permanent', platform: 'youtube' });
    }
    return {
      platformPostId: String(created.id),
      url: `https://www.youtube.com/watch?v=${created.id}`,
      status: 'published',
      warnings: [
        'Unaudited API projects upload as PRIVATE regardless of the requested privacy — verify the video is Public in YouTube Studio.',
        'Costs 1,600 of the 10,000 daily quota units.',
      ],
    };
  }

  async verify(platformPostId) {
    this.assertTokenUsable();
    try {
      const res = await this.apiCall(`/videos?part=status,snippet&id=${encodeURIComponent(platformPostId)}`);
      const video = res?.items?.[0];
      if (!video) return { found: false };
      const privacy = video?.status?.privacyStatus || null;
      return {
        found: true,
        url: `https://www.youtube.com/watch?v=${platformPostId}`,
        metrics: null,
        note: privacy ? `Video privacyStatus is '${privacy}'.` : null,
      };
    } catch (err) {
      if (err instanceof SocialError && err.status === 404) return { found: false };
      throw err;
    }
  }
}
