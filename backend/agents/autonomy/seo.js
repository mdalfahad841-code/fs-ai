/**
 * FS AI — Autonomy: SEO agent handler.
 *
 * Computes SEO fields from the article's REAL text. Fills seo_title /
 * seo_description only when they are blank — never overwrites owner-set
 * values. Returns internal-link suggestions (real published slugs in the
 * same division) and a heading count.
 */
import { d1All, d1First, d1Run, nowIso } from '../../middleware/validation.js';

function parsePayload(task) {
  if (!task) return {};
  if (typeof task.payload === 'object' && task.payload !== null) return task.payload;
  if (typeof task.payload === 'string') {
    try { return JSON.parse(task.payload); } catch { return {}; }
  }
  return {};
}

export async function runSeo(task, env) {
  const payload = parsePayload(task);
  const articleId = Number(payload.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return { outcome: 'failed', error: 'SEO pass needs a valid article_id.' };
  }
  const article = await d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [articleId]);
  if (!article) return { outcome: 'failed', error: `Article ${articleId} not found.` };

  const body = String(article.body || '');
  const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const seoTitle = String(article.title || '').slice(0, 60);
  const seoDescription = String(article.excerpt || '').trim()
    ? String(article.excerpt).slice(0, 160)
    : plainBody.slice(0, 160);
  const markdownHeadings = (body.match(/^#{1,6}\s.+$/gm) || []).length;
  const htmlHeadings = (body.match(/<h[1-6][^>]*>/gi) || []).length;
  const headingCount = markdownHeadings + htmlHeadings;

  const siblings = await d1All(env,
    'SELECT id, title, slug FROM articles WHERE division_id = ? AND status = ? AND id != ? ORDER BY published_at DESC, id DESC LIMIT 5',
    [article.division_id, 'published', articleId]) || [];
  const internalLinks = siblings.map((s) => ({
    id: s.id, title: s.title, slug: s.slug,
    url: `https://fs-ai-5w5.pages.dev/pages/article.html?id=${s.id}`,
  }));

  // Fill blanks only — never overwrite owner-set values.
  const filled = [];
  if (!article.seo_title && seoTitle) {
    await d1Run(env, 'UPDATE articles SET seo_title = ?, updated_at = ? WHERE id = ?', [seoTitle, nowIso(), articleId]);
    filled.push('seo_title');
  }
  if (!article.seo_description && seoDescription) {
    await d1Run(env, 'UPDATE articles SET seo_description = ?, updated_at = ? WHERE id = ?', [seoDescription, nowIso(), articleId]);
    filled.push('seo_description');
  }

  return {
    outcome: 'done',
    articleId,
    title: article.title,
    division: article.division,
    seoTitle,
    seoDescription,
    headingCount,
    internalLinks,
    filled,
    note: filled.length
      ? `Filled blank field(s): ${filled.join(', ')} — owner-set values were not touched.`
      : 'SEO fields already set — nothing overwritten.',
  };
}
