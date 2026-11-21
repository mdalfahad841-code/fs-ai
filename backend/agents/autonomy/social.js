/**
 * FS AI — Autonomy: social-media agent handler.
 *
 * Builds a distribution PACK (Pinterest caption + hashtags, YouTube
 * Community short text) from the article's real title/excerpt, with the
 * real article URL. It never posts anything — no social API auth exists.
 *
 * W4 (2026-11-21): when migration 022 is applied, the pack ALSO writes
 * one DRAFT social_posts row per postable platform (draft only — the
 * dispatcher only publishes on an explicit owner action). The write is
 * best-effort: if the social tables do not exist yet (migration not
 * applied) the pack is still returned and the miss is reported in
 * `draftPosts` — the agent never fails a pack over a missing table,
 * and it never publishes.
 */
import { d1First } from '../../middleware/validation.js';
import { buildPostContent } from '../../social/content.js';
import { cardPublicUrl, cardFileName } from '../../social/card.js';
import { createPost } from '../../social/store.js';
import { SUPPORTED_PLATFORMS, platformDef } from '../../social/platforms.js';

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

function hashtagsFor(division, title) {
  const tags = new Set(['FSAI']);
  if (division) {
    for (const word of String(division).split('-')) {
      if (word.length > 2) tags.add(word.charAt(0).toUpperCase() + word.slice(1));
    }
  }
  for (const word of String(title || '').split(/[^A-Za-z0-9]+/)) {
    if (word.length >= 5 && tags.size < 6) tags.add(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }
  return [...tags].map((t) => `#${t}`);
}

export async function runSocialMedia(task, env) {
  const payload = parsePayload(task);
  const articleId = Number(payload.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return { outcome: 'failed', error: 'Social pack needs a valid article_id.' };
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division, d.name AS division_name FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [articleId]);
  if (!article) return { outcome: 'failed', error: `Article ${articleId} not found.` };
  if (article.status !== 'published') {
    return {
      outcome: 'no-op',
      reason: `Article ${articleId} is '${article.status}', not published — no distribution pack prepared for unpublished content.`,
      articleId,
    };
  }
  const url = `https://fs-ai-5w5.pages.dev/pages/article?id=${article.id}`;
  const excerpt = String(article.excerpt || '').trim() || String(article.body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const hashtags = hashtagsFor(article.division, article.title);
  const pack = {
    articleId: article.id,
    title: article.title,
    url,
    pinterest: {
      caption: `${article.title} — ${excerpt} ${url}`,
      hashtags,
      note: 'Draft caption only — nothing was posted. Pinterest API is not connected.',
    },
    youtubeCommunity: {
      text: `New on FS AI: ${article.title}\n${excerpt}\n${url}`,
      note: 'Draft text only — nothing was posted. YouTube API is not connected.',
    },
  };
  // W4: draft rows for the social framework (never a publish). Each
  // platform is independent — one failure never stops the rest, and a
  // missing social_posts table (migration 022 not applied) is reported,
  // not fatal.
  const draftPosts = [];
  for (const platform of SUPPORTED_PLATFORMS) {
    try {
      // Media-required platforms get the deterministic card image URL
      // (backend/social/card.js + scripts/render-social-card.py). The
      // PNG must actually exist at that URL before the post can
      // publish — the draft records that as a warning, and the
      // dispatcher/adapter still refuse without media. Nothing here
      // claims the file exists; the render step produces it.
      const def = platformDef(platform);
      const media = def?.mediaRequired
        ? { url: cardPublicUrl(article.id, platform) }
        : null;
      const content = buildPostContent(article, platform, media);
      const warnings = [...content.warnings];
      if (media) {
        warnings.push(`Card image must be rendered (scripts/render-social-card.py --article-id ${article.id} --platform ${platform}) and deployed to ${media.url} before this post can publish.`);
      }
      const row = await createPost(env, {
        articleId: article.id,
        platform,
        caption: content.caption,
        mediaUrl: content.mediaUrl || null,
        scheduledFor: null,
      });
      draftPosts.push({ platform, ok: true, postId: row?.id ?? null, warnings, cardFile: media ? cardFileName(article.id, platform) : null });
    } catch (err) {
      draftPosts.push({ platform, ok: false, error: String(err?.message || err).slice(0, 300) });
    }
  }
  // S1 fix (2026-11-21): a pack whose draft rows ALL failed to store
  // must not report 'done'. Partial success stays 'done' with the
  // failed platforms named in warnings. Draft-only either way — no
  // post was made here.
  const failedStores = draftPosts.filter((p) => !p.ok);
  if (draftPosts.length > 0 && failedStores.length === draftPosts.length) {
    return {
      outcome: 'failed',
      error: `No social draft could be stored: ${failedStores.map((p) => `${p.platform} (${p.error || 'unknown error'})`).join('; ')}`,
      ...pack,
      draftPosts,
      note: 'Distribution pack prepared only — no post was made (no social API auth exists).',
    };
  }
  if (failedStores.length > 0) {
    pack.warnings = failedStores.map((p) => `Draft store failed for ${p.platform}: ${p.error || 'unknown error'}`);
  }
  return { outcome: 'done', ...pack, draftPosts, note: 'Distribution pack prepared only — no post was made (no social API auth exists).' };
}
