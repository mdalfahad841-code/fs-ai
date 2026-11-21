/**
 * FS AI — Social: platform-specific content.
 *
 * Pure functions (no I/O, no fetch, no D1) that turn one article into
 * the caption/title/description each platform accepts. Everything is
 * built from the article's REAL title/excerpt/body and the REAL article
 * URL — nothing is invented, and no external stock or copyrighted
 * material is used. Media is never fabricated: if the article has no
 * usable media, platforms that allow text/link-only posts get text/link
 * only, and platforms that require media refuse (the adapter reports
 * VALIDATION, not a fake post).
 *
 * The FS AI pin design (text-only, dark-navy background) is a RENDERED
 * IMAGE, not text the API can draw: the Pinterest/Instagram adapters
 * accept a pre-rendered card image via `mediaUrl` (public HTTPS URL) or
 * `mediaBase64`. No card renderer exists in this repo yet — that is a
 * documented gap (see docs/SOCIAL-PLATFORMS-2026-11-21.md), not
 * something to fake with a stock photo.
 */
import { platformDef } from './platforms.js';

export function articleUrl(articleId) {
  return `https://fs-ai-5w5.pages.dev/pages/article?id=${articleId}`;
}

export function hashtagsFor(divisionSlug, title, max = 6) {
  const tags = new Set(['FSAI']);
  if (divisionSlug) {
    for (const word of String(divisionSlug).split('-')) {
      if (word.length > 2) tags.add(word.charAt(0).toUpperCase() + word.slice(1));
    }
  }
  for (const word of String(title || '').split(/[^A-Za-z0-9]+/)) {
    if (word.length >= 5 && tags.size < max) tags.add(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }
  return [...tags].map((t) => `#${t}`);
}

function excerptOf(article, maxChars) {
  const raw = String(article.excerpt || '').trim()
    || String(article.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (raw.length <= maxChars) return raw;
  const cut = raw.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function truncate(value, maxChars) {
  const s = String(value || '');
  return s.length <= maxChars ? s : s.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

/**
 * Build the per-platform content for one article.
 * Returns { platform, title, description, caption, hashtags, link,
 *   mediaUrl, mediaRequired, warnings[] }.
 * `media` is { url, base64 } when the caller supplies a rendered card
 * image; null when the article has no usable media.
 */
export function buildPostContent(article, platform, media = null) {
  const def = platformDef(platform);
  if (!def) throw new Error(`Unknown social platform: ${platform}`);
  const url = articleUrl(article.id);
  const division = article.division || article.division_slug || '';
  const hashtags = hashtagsFor(division, article.title, platform === 'instagram' ? 10 : 6);
  const warnings = [];
  const mediaUrl = media?.url || article.featured_image || null;
  if (def.mediaRequired && !mediaUrl && !media?.base64) {
    warnings.push(`${def.label} requires media and this article has no image — post will be refused until a rendered card image is supplied.`);
  }

  switch (platform) {
    case 'pinterest': {
      // Title ≤100, description ≤800, link ≤2048. Description carries
      // the excerpt + hashtags; the article link is the Pin link.
      return {
        platform, title: truncate(article.title, def.limits.titleChars),
        description: truncate(`${excerptOf(article, 600)} ${hashtags.join(' ')}`, def.limits.descriptionChars),
        caption: truncate(article.title, def.limits.titleChars),
        hashtags, link: url, mediaUrl, mediaBase64: media?.base64 || null,
        mediaRequired: true, warnings,
      };
    }
    case 'facebook': {
      // Link post: message + link. No media needed.
      return {
        platform, title: article.title,
        description: excerptOf(article, 400),
        caption: `${article.title}\n\n${excerptOf(article, 400)}\n\nRead more: ${url}`,
        hashtags, link: url, mediaUrl, mediaBase64: media?.base64 || null,
        mediaRequired: false, warnings,
      };
    }
    case 'instagram': {
      // Caption ≤2200, ≤30 hashtags. Links are NOT clickable in
      // captions — the article URL goes in the caption as text only.
      const caption = truncate(
        `${article.title}\n\n${excerptOf(article, 300)}\n\n${hashtags.join(' ')}\nRead more: ${url}`,
        def.limits.captionChars);
      return {
        platform, title: truncate(article.title, 100),
        description: excerptOf(article, 300),
        caption, hashtags, link: url, mediaUrl,
        mediaBase64: null, // Instagram takes a public URL only — never base64
        mediaRequired: true, warnings,
      };
    }
    case 'linkedin': {
      // Professional tone, text ≤3000. Article link attached as an
      // article share (not pasted raw into the text where possible).
      const text = truncate(
        `${article.title}\n\n${excerptOf(article, 500)}\n\n${hashtags.slice(0, 3).join(' ')}`,
        def.limits.textChars);
      return {
        platform, title: article.title,
        description: excerptOf(article, 500),
        caption: text, hashtags, link: url, mediaUrl,
        mediaBase64: media?.base64 || null,
        mediaRequired: false, warnings,
      };
    }
    case 'youtube': {
      // Title ≤100, description ≤5000. Video upload only — the adapter
      // needs rendered video bytes; a text post is NOT a YouTube upload.
      // Community posts have no API endpoint, so there is no text path.
      return {
        platform, title: truncate(article.title, def.limits.titleChars),
        description: truncate(`${excerptOf(article, 1000)}\n\nRead the full article: ${url}`, def.limits.descriptionChars),
        caption: truncate(article.title, def.limits.titleChars),
        hashtags: hashtags.slice(0, 3), link: url, mediaUrl: null,
        mediaBase64: null, mediaRequired: true,
        warnings: ['YouTube needs a rendered video file — supply mediaBytes to the adapter; without it the upload is refused. Unaudited API projects upload as PRIVATE.'],
      };
    }
    default:
      throw new Error(`No content builder for platform: ${platform}`);
  }
}

/** Validate a built post's caption/media against the platform limits. Returns string[] of problems (empty = valid). */
export function validatePostContent(content, platform) {
  const def = platformDef(platform);
  const problems = [];
  if (!def) return [`Unknown platform: ${platform}`];
  const limits = def.limits;
  if (platform === 'pinterest') {
    if (!content.title) problems.push('Pinterest title is required.');
    if (content.title && content.title.length > limits.titleChars) problems.push(`Pinterest title exceeds ${limits.titleChars} characters.`);
    if (content.description && content.description.length > limits.descriptionChars) problems.push(`Pinterest description exceeds ${limits.descriptionChars} characters.`);
    if (content.link && content.link.length > limits.linkChars) problems.push('Pinterest link exceeds 2048 characters.');
    if (!content.mediaUrl && !content.mediaBase64) problems.push('Pinterest requires an image or video.');
  }
  if (platform === 'facebook') {
    if (!content.caption || !content.caption.trim()) problems.push('Facebook message is required.');
    if (content.caption && content.caption.length > limits.messageChars) problems.push('Facebook message exceeds the platform limit.');
  }
  if (platform === 'instagram') {
    if (!content.caption || !content.caption.trim()) problems.push('Instagram caption is required.');
    if (content.caption && content.caption.length > limits.captionChars) problems.push(`Instagram caption exceeds ${limits.captionChars} characters.`);
    if (content.hashtags && content.hashtags.length > limits.hashtagsMax) problems.push(`Instagram allows at most ${limits.hashtagsMax} hashtags.`);
    if (!content.mediaUrl) problems.push('Instagram requires a public image/video URL.');
    else if (!/^https:\/\//.test(content.mediaUrl)) problems.push('Instagram media must be a public HTTPS URL.');
  }
  if (platform === 'linkedin') {
    if (!content.caption || !content.caption.trim()) problems.push('LinkedIn text is required.');
    if (content.caption && content.caption.length > limits.textChars) problems.push(`LinkedIn text exceeds ${limits.textChars} characters.`);
  }
  if (platform === 'youtube') {
    if (!content.title) problems.push('YouTube title is required.');
    if (content.title && content.title.length > limits.titleChars) problems.push(`YouTube title exceeds ${limits.titleChars} characters.`);
    if (content.description && content.description.length > limits.descriptionChars) problems.push(`YouTube description exceeds ${limits.descriptionChars} characters.`);
  }
  return problems;
}
