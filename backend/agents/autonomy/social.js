/**
 * FS AI — Autonomy: social-media agent handler.
 *
 * Builds a distribution PACK (Pinterest caption + hashtags, YouTube
 * Community short text) from the article's real title/excerpt, with the
 * real article URL. It never posts anything — no social API auth exists.
 */
import { d1First } from '../../middleware/validation.js';

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
  const url = `https://fs-ai-5w5.pages.dev/pages/article.html?id=${article.id}`;
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
  return { outcome: 'done', ...pack, note: 'Distribution pack prepared only — no post was made (no social API auth exists).' };
}
