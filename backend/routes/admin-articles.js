/**
 * FS AI — CMS admin routes (owner-only; worker.js enforces requireOwner).
 *
 *   POST   /api/admin/articles                  create (draft by default)
 *   GET    /api/admin/articles                  list ALL incl. drafts (?status= & ?division=)
 *   GET    /api/admin/articles/:id              one article, any status
 *   PUT    /api/admin/articles/:id              edit (stores a revision first)
 *   DELETE /api/admin/articles/:id              delete (revisions remain)
 *   POST   /api/admin/articles/:id/publish      status=published, published_at=now
 *   POST   /api/admin/articles/:id/unpublish    status=draft, published_at cleared
 *   GET    /api/admin/articles/:id/revisions    prior versions of the article
 *
 * Writes require env.DB (D1). Without it they answer 503 honestly — they
 * never fabricate a stored article. Also exports publishDueArticles(), the
 * honest scheduled-publish check used by the Worker cron (worker.js):
 * approved articles whose publish_at has passed become published.
 */
import {
  jsonOk, jsonError, parseQuery, readJsonBody, sanitiseText,
  isValidSlug, isValidIsoDateTime, isSafeUrl, slugify, nowIso,
  d1All, d1First, d1Run, ARTICLE_STATUSES,
} from '../middleware/validation.js';
import { getEmergencyStop } from './admin.js';

const ARTICLE_COLUMNS = 'a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt';

function articleSelectSql(where) {
  return `SELECT ${ARTICLE_COLUMNS} FROM articles a JOIN business_divisions d ON d.id = a.division_id ${where}`;
}

async function fetchArticle(env, id) {
  return d1First(env, articleSelectSql('WHERE a.id = ? LIMIT 1'), [id]);
}

async function fetchTags(env, articleId) {
  const rows = await d1All(env, 'SELECT tag FROM article_tags WHERE article_id = ? ORDER BY tag ASC', [articleId]);
  return (rows || []).map((r) => r.tag);
}

async function withTags(env, article) {
  if (!article) return article;
  return { ...article, tags: await fetchTags(env, article.id) };
}

async function resolveDivisionId(env, body) {
  if (body.division_id !== undefined && body.division_id !== null && body.division_id !== '') {
    const id = Number(body.division_id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'division_id must be a positive integer.' };
    const row = await d1First(env, 'SELECT id FROM business_divisions WHERE id = ? LIMIT 1', [id]);
    if (!row) return { ok: false, error: 'Unknown division_id.' };
    return { ok: true, divisionId: row.id };
  }
  if (typeof body.division === 'string' && body.division.trim()) {
    if (!isValidSlug(body.division)) return { ok: false, error: 'division must be a valid slug.' };
    const row = await d1First(env, 'SELECT id FROM business_divisions WHERE slug = ? LIMIT 1', [body.division]);
    if (!row) return { ok: false, error: 'Unknown division slug.' };
    return { ok: true, divisionId: row.id };
  }
  return { ok: false, error: 'division is required (division slug or division_id).' };
}

function cleanTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const tags = [];
  for (const t of value) {
    if (typeof t !== 'string') return null;
    const tag = t.trim().toLowerCase().slice(0, 50);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 20);
}

function validateArticleBody(body, { partial = false } = {}) {
  const errors = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body must be a JSON object.'] };
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length < 5) errors.push('title is required (at least 5 characters).');
    else if (body.title.length > 200) errors.push('title must be under 200 characters.');
  }
  if (!partial || body.body !== undefined) {
    if (typeof body.body !== 'string' || !body.body.trim()) errors.push('body is required.');
  }
  if (body.slug !== undefined && body.slug !== '' && !isValidSlug(body.slug)) errors.push('slug must be lowercase letters, digits and hyphens only.');
  if (body.status !== undefined && !ARTICLE_STATUSES.includes(body.status)) errors.push(`status must be one of: ${ARTICLE_STATUSES.join(', ')}.`);
  if (body.publish_at !== undefined && body.publish_at !== null && body.publish_at !== '' && !isValidIsoDateTime(body.publish_at)) errors.push('publish_at must be a valid ISO date/time.');
  if (body.excerpt !== undefined && typeof body.excerpt === 'string' && body.excerpt.length > 500) errors.push('excerpt must be under 500 characters.');
  if (body.seo_title !== undefined && typeof body.seo_title === 'string' && body.seo_title.length > 200) errors.push('seo_title must be under 200 characters.');
  if (body.seo_description !== undefined && typeof body.seo_description === 'string' && body.seo_description.length > 300) errors.push('seo_description must be under 300 characters.');
  if (body.featured_image !== undefined && body.featured_image !== null && body.featured_image !== '') {
    if (typeof body.featured_image !== 'string' || body.featured_image.length > 500) errors.push('featured_image must be a string under 500 characters.');
    else if (body.featured_image.includes('://') && !isSafeUrl(body.featured_image)) errors.push('featured_image must be an https URL.');
  }
  if (body.fact_checked !== undefined && body.fact_checked !== 0 && body.fact_checked !== 1 && body.fact_checked !== false && body.fact_checked !== true) errors.push('fact_checked must be 0 or 1.');
  if (body.tags !== undefined && cleanTags(body.tags) === null) errors.push('tags must be an array of strings.');
  if (body.author !== undefined && typeof body.author !== 'string') errors.push('author must be a string.');
  return { ok: errors.length === 0, errors };
}

async function replaceTags(env, articleId, tags) {
  await d1Run(env, 'DELETE FROM article_tags WHERE article_id = ?', [articleId]);
  for (const tag of tags) {
    await d1Run(env, 'INSERT INTO article_tags (article_id, tag) VALUES (?, ?)', [articleId, tag]);
  }
}

async function createArticle(request, env, auth) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const v = validateArticleBody(body);
  if (!v.ok) return jsonError(v.errors.join(' '), 400);
  const division = await resolveDivisionId(env, body);
  if (!division.ok) return jsonError(division.error, 400);

  const slug = body.slug ? body.slug : slugify(body.title);
  if (!slug) return jsonError('Could not derive a slug from the title.', 400);
  const clash = await d1First(env, 'SELECT id FROM articles WHERE slug = ? LIMIT 1', [slug]);
  if (clash) return jsonError('An article with this slug already exists.', 409);

  const tags = cleanTags(body.tags) || [];
  const status = body.status || 'draft';
  const now = nowIso();
  const publishedAt = status === 'published' ? now : null;
  const result = await d1Run(env,
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, featured_image, published_at, publish_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      division.divisionId,
      sanitiseText(body.title, 200),
      slug,
      sanitiseText(body.excerpt || '', 500),
      body.body,
      sanitiseText(body.author || 'FS AI', 100),
      status,
      body.fact_checked ? 1 : 0,
      sanitiseText(body.seo_title || '', 200),
      sanitiseText(body.seo_description || '', 300),
      body.featured_image ? String(body.featured_image).slice(0, 500) : null,
      publishedAt,
      body.publish_at ? new Date(body.publish_at).toISOString() : null,
      null,
      now,
      now,
    ]);
  const id = result && result.meta ? result.meta.last_row_id : null;
  const article = id ? await fetchArticle(env, id) : null;
  if (!article) return jsonError('Article was not stored.', 500);
  await replaceTags(env, id, tags);
  return jsonOk({ article: await withTags(env, article) }, 201);
}

async function listArticles(request, env) {
  if (!env.DB) return jsonError('CMS reads require the D1 database', 503);
  const q = parseQuery(new URL(request.url));
  const status = q.get('status');
  const division = q.get('division');
  if (status && !ARTICLE_STATUSES.includes(status)) return jsonError(`status must be one of: ${ARTICLE_STATUSES.join(', ')}.`, 400);
  let sql = articleSelectSql('WHERE 1=1');
  const params = [];
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (division) { sql += ' AND d.slug = ?'; params.push(division); }
  sql += ' ORDER BY a.updated_at DESC, a.id DESC LIMIT 100';
  const rows = await d1All(env, sql, params);
  const articles = [];
  for (const row of rows || []) articles.push(await withTags(env, row));
  return jsonOk({ articles, total: articles.length, source: 'd1' });
}

async function updateArticle(request, env, auth, id) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  const current = await fetchArticle(env, id);
  if (!current) return jsonError('Article not found', 404);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const v = validateArticleBody(body, { partial: true });
  if (!v.ok) return jsonError(v.errors.join(' '), 400);

  let divisionId = current.division_id;
  if (body.division !== undefined || body.division_id !== undefined) {
    const division = await resolveDivisionId(env, body);
    if (!division.ok) return jsonError(division.error, 400);
    divisionId = division.divisionId;
  }
  const slug = body.slug !== undefined ? body.slug : current.slug;
  if (slug !== current.slug) {
    const clash = await d1First(env, 'SELECT id FROM articles WHERE slug = ? LIMIT 1', [slug]);
    if (clash) return jsonError('An article with this slug already exists.', 409);
  }
  const tags = body.tags !== undefined ? cleanTags(body.tags) : null;

  // Store the pre-edit version first — the revision trail is the audit log.
  await d1Run(env,
    'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by, revised_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [current.id, current.title, current.excerpt, current.body, current.status, auth.owner || 'owner', nowIso()]);

  const next = {
    division_id: divisionId,
    title: body.title !== undefined ? sanitiseText(body.title, 200) : current.title,
    slug,
    excerpt: body.excerpt !== undefined ? sanitiseText(body.excerpt, 500) : current.excerpt,
    body: body.body !== undefined ? body.body : current.body,
    author: body.author !== undefined ? sanitiseText(body.author, 100) : current.author,
    status: body.status !== undefined ? body.status : current.status,
    fact_checked: body.fact_checked !== undefined ? (body.fact_checked ? 1 : 0) : current.fact_checked,
    seo_title: body.seo_title !== undefined ? sanitiseText(body.seo_title, 200) : current.seo_title,
    seo_description: body.seo_description !== undefined ? sanitiseText(body.seo_description, 300) : current.seo_description,
    featured_image: body.featured_image !== undefined ? (body.featured_image ? String(body.featured_image).slice(0, 500) : null) : current.featured_image,
    publish_at: body.publish_at !== undefined
      ? (body.publish_at ? new Date(body.publish_at).toISOString() : null)
      : current.publish_at,
  };
  // Moving to published stamps published_at; moving away from published
  // leaves the last published date on the record.
  const publishedAt = next.status === 'published' && current.status !== 'published'
    ? nowIso()
    : current.published_at;
  await d1Run(env,
    'UPDATE articles SET division_id = ?, title = ?, slug = ?, excerpt = ?, body = ?, author = ?, status = ?, fact_checked = ?, seo_title = ?, seo_description = ?, featured_image = ?, published_at = ?, publish_at = ?, updated_at = ? WHERE id = ?',
    [next.division_id, next.title, next.slug, next.excerpt, next.body, next.author, next.status,
     next.fact_checked, next.seo_title, next.seo_description, next.featured_image,
     publishedAt, next.publish_at, nowIso(), id]);
  if (tags !== null) await replaceTags(env, id, tags);
  const article = await fetchArticle(env, id);
  return jsonOk({ article: await withTags(env, article) });
}

async function deleteArticle(env, id) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  const current = await fetchArticle(env, id);
  if (!current) return jsonError('Article not found', 404);
  await d1Run(env, 'DELETE FROM articles WHERE id = ?', [id]);
  // Revisions are kept: article_revisions rows remain as the edit history
  // of a deleted article (D1 does not enforce the ON DELETE CASCADE).
  return jsonOk({ ok: true, deleted: Number(id) });
}

async function setPublishState(env, id, publish) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  const current = await fetchArticle(env, id);
  if (!current) return jsonError('Article not found', 404);
  if (publish) {
    await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
      ['published', nowIso(), nowIso(), id]);
  } else {
    await d1Run(env, 'UPDATE articles SET status = ?, published_at = NULL, updated_at = ? WHERE id = ?',
      ['draft', nowIso(), id]);
  }
  const article = await fetchArticle(env, id);
  return jsonOk({ article: await withTags(env, article) });
}

async function listRevisions(env, id) {
  if (!env.DB) return jsonError('CMS reads require the D1 database', 503);
  const rows = await d1All(env,
    'SELECT * FROM article_revisions WHERE article_id = ? ORDER BY revised_at DESC, id DESC LIMIT 100', [id]);
  return jsonOk({ articleId: Number(id), revisions: rows || [], total: (rows || []).length, source: 'd1' });
}

export async function handleAdminArticles(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // api, admin, articles, [id], [action]

  if (method === 'POST' && parts.length === 3) return createArticle(request, env, auth);
  if (method === 'GET' && parts.length === 3) return listArticles(request, env);
  if (method === 'GET' && parts.length === 4) {
    const article = await fetchArticle(env, parts[3]);
    if (!article) return jsonError('Article not found', 404);
    return jsonOk({ article: await withTags(env, article), source: 'd1' });
  }
  if (method === 'PUT' && parts.length === 4) return updateArticle(request, env, auth, parts[3]);
  if (method === 'DELETE' && parts.length === 4) return deleteArticle(env, parts[3]);
  if (method === 'POST' && parts.length === 5 && parts[4] === 'publish') return setPublishState(env, parts[3], true);
  if (method === 'POST' && parts.length === 5 && parts[4] === 'unpublish') return setPublishState(env, parts[3], false);
  if (method === 'GET' && parts.length === 5 && parts[4] === 'revisions') return listRevisions(env, parts[3]);
  return jsonError('Method not allowed', 405);
}

/**
 * Scheduled publishing: publish approved articles whose publish_at has
 * passed. Called by the Worker's hourly cron (worker.js `scheduled`) and
 * directly by tests. When the Emergency Stop flag is on, nothing is
 * published and the skip is logged. Nothing else is ever auto-published:
 * only owner-approved (status='approved') articles with a due publish_at.
 */
export async function publishDueArticles(env) {
  if (!env || !env.DB) return { ok: false, published: 0, error: 'D1 database is not bound.' };
  if (await getEmergencyStop(env)) {
    await d1Run(env,
      'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [null, 'scheduled_publish', 'article', JSON.stringify({ outcome: 'skipped', reason: 'Emergency Stop is on.' }), 'skipped', nowIso()]).catch(() => {});
    return { ok: true, published: 0, skipped: true, reason: 'Emergency Stop is on.' };
  }
  const now = nowIso();
  const due = await d1All(env,
    'SELECT id, slug FROM articles WHERE status = ? AND publish_at IS NOT NULL AND publish_at <= ? ORDER BY publish_at ASC',
    ['approved', now]);
  let published = 0;
  const publishedSlugs = [];
  for (const row of due || []) {
    await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
      ['published', now, now, row.id]);
    published += 1;
    publishedSlugs.push(row.slug);
  }
  // Log the run against the Publishing agent when it exists in D1.
  const agent = await d1First(env, 'SELECT id FROM ai_agents WHERE slug = ? LIMIT 1', ['publishing']);
  await d1Run(env,
    'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [agent ? agent.id : null, 'scheduled_publish', 'article',
     JSON.stringify({ outcome: 'completed', published, slugs: publishedSlugs }), 'success', nowIso()]).catch(() => {});
  return { ok: true, published, slugs: publishedSlugs };
}
