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
import { stripDraftBanner, hasDraftBanner } from '../utils/draftBanner.js';
import { assertNotProtected } from '../publishing/protection.js';

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
  // Banner protection: creating an article already marked 'published'
  // IS a publish transition, so the same strip-or-refuse rule applies.
  // A draft create never touches the body.
  let storedBody = body.body;
  if (status === 'published') {
    const prep = preparePublishBody(body.body);
    if (!prep.ok) return jsonError(prep.error, 422);
    storedBody = prep.body;
  }
  const now = nowIso();
  const publishedAt = status === 'published' ? now : null;
  const result = await d1Run(env,
    'INSERT INTO articles (division_id, title, slug, excerpt, body, author, status, fact_checked, seo_title, seo_description, featured_image, published_at, publish_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      division.divisionId,
      sanitiseText(body.title, 200),
      slug,
      sanitiseText(body.excerpt || '', 500),
      storedBody,
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
  // WS-E finding H1 (Workstream A fix, 2026-11-21): protected articles
  // (#26/#27, or any article with is_protected=1) must never be
  // modified through a manual endpoint — the 2026-11-20 SEO repair
  // overwrote #26/#27 through automation, and the manual path was the
  // remaining hole. The guard runs BEFORE the 404 check: protection is
  // an ID-level rule (protection.js covers #26/#27 by constant even
  // when no row exists), so a protected id refuses 403 regardless of
  // whether the row is present. (WS-E's patch placed it after the 404
  // check; the pinned test requires before — see the test comment.)
  const guard = await assertNotProtected(env, id);
  if (!guard.ok) return jsonError(guard.reason, 403);
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
  // Banner protection: a PUT that transitions an article INTO 'published'
  // is a publish action, so the same strip-or-refuse rule applies — and
  // the refusal happens BEFORE the revision is stored, so a failed
  // publish leaves no trace at all. A PUT that does not publish (a draft
  // or approved edit, or an edit to an already-published article) never
  // touches the body; the renderer strip is the net for those.
  if (next.status === 'published' && current.status !== 'published') {
    const prep = preparePublishBody(next.body);
    if (!prep.ok) return jsonError(prep.error, 422);
    next.body = prep.body;
  }

  // Store the pre-edit version first — the revision trail is the audit log.
  await d1Run(env,
    'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by, revised_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [current.id, current.title, current.excerpt, current.body, current.status, auth.owner || 'owner', nowIso()]);

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

async function deleteArticle(env, id, auth) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  // WS-E finding H1 (Workstream A fix, 2026-11-21): the dashboard
  // Delete button was one confirm() click from deleting protected
  // articles #26/#27 — deleteArticle never called assertNotProtected.
  // Guard BEFORE the 404 check: protection is ID-level (see
  // updateArticle above), so #26/#27 refuse 403 even with no row.
  const guard = await assertNotProtected(env, id);
  if (!guard.ok) return jsonError(guard.reason, 403);
  const current = await fetchArticle(env, id);
  if (!current) return jsonError('Article not found', 404);
  // Deletion audit (migration 025, Workstream A): record what is about
  // to be deleted BEFORE deleting it — the audit row keeps the title,
  // slug, status and body length after the article row is gone.
  // Best-effort pre-025 (a missing table skips the write); the table
  // is applied at deploy, after which every deletion is audited.
  try {
    const revs = await d1First(env, 'SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?', [id]);
    await d1Run(env,
      'INSERT INTO article_deletion_audit (article_id, title, slug, status_at_delete, deleted_by, body_length, revisions_kept) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [Number(id), current.title || '', current.slug || '', current.status || '', (auth && auth.owner) || null, String(current.body || '').length, Number(revs ? revs.n : 0)]);
  } catch {
    // Pre-025 database: no audit table yet — the deletion still
    // proceeds (same degrade pattern as the SEO body-hash fallback).
  }
  await d1Run(env, 'DELETE FROM articles WHERE id = ?', [id]);
  // WS-E finding L4 (Workstream A fix, 2026-11-21): the old code
  // deleted only the articles row, leaving orphan article_tags and
  // article_sources rows behind. Clean up the article's own rows.
  // (Both tables declare ON DELETE CASCADE, so in an FK-enforcing
  // DB the cascade already removed them — these DELETEs delete 0
  // rows there and are harmless. On live D1 the Worker's connection
  // does not run schema.sql's PRAGMA foreign_keys = ON, so the
  // cascade may NOT fire and the explicit DELETEs are what actually
  // removes the orphans. Either way no orphan survives.)
  // Revisions / fact_checks / seo_checks are kept by design as
  // history where the cascade does not remove them; the audit row
  // (migration 025, no FK to articles) is the durable record of the
  // deletion either way — it records how many revisions existed at
  // delete time (revisions_kept), since the revision rows themselves
  // cascade away in an FK-enforcing DB.
  await d1Run(env, 'DELETE FROM article_tags WHERE article_id = ?', [id]);
  await d1Run(env, 'DELETE FROM article_sources WHERE article_id = ?', [id]);
  return jsonOk({ ok: true, deleted: Number(id) });
}

/**
 * Banner protection shared by every transition INTO 'published'
 * (2026-11-20): the manual publish endpoint, the scheduled publish run,
 * creating an article already marked published, and a PUT that flips a
 * draft to published. Strip the standard leading banner block; if ANY
 * banner line survives, the transition is refused ({ ok: false }) and the
 * caller must change NOTHING — no status change, no body save, no
 * publish. A failed strip never silently publishes anything.
 */
function preparePublishBody(body) {
  const cleaned = stripDraftBanner(body || '');
  if (hasDraftBanner(cleaned)) {
    return {
      ok: false,
      error: 'This article still contains an internal AI-DRAFT banner line that could not be removed automatically. ' +
        'Remove the banner from the body and try again. Nothing was published.',
    };
  }
  return { ok: true, body: cleaned };
}

async function setPublishState(env, id, publish) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  // WS-E finding H1 (Workstream A fix, 2026-11-21): a protected
  // article must never be published/unpublished through a manual
  // endpoint either — same ID-level guard as edit/delete (before the
  // 404 check, so #26/#27 refuse 403 even with no row).
  const guard = await assertNotProtected(env, id);
  if (!guard.ok) return jsonError(guard.reason, 403);
  const current = await fetchArticle(env, id);
  if (!current) return jsonError('Article not found', 404);
  if (publish) {
    // Banner protection (2026-11-20): an AI draft's internal AI-DRAFT
    // warning block must never reach the public. Strip the standard
    // leading block; if ANY banner line survives the strip, refuse to
    // publish — the article stays exactly as it was (still a draft, body
    // untouched) and the owner must remove the banner by hand. A failed
    // strip never silently publishes anything.
    const prep = preparePublishBody(current.body || '');
    if (!prep.ok) return jsonError(prep.error, 422);
    if (prep.body !== (current.body || '')) {
      await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, body = ?, updated_at = ? WHERE id = ?',
        ['published', nowIso(), prep.body, nowIso(), id]);
    } else {
      await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
        ['published', nowIso(), nowIso(), id]);
    }
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
  if (method === 'DELETE' && parts.length === 4) return deleteArticle(env, parts[3], auth);
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
    'SELECT id, slug, body FROM articles WHERE status = ? AND publish_at IS NOT NULL AND publish_at <= ? ORDER BY publish_at ASC',
    ['approved', now]);
  let published = 0;
  const publishedSlugs = [];
  // Banner protection (2026-11-20): same shared rule as the manual
  // publish handler. A due article whose banner strips cleanly publishes
  // with the cleaned body; one whose banner survives the strip stays
  // 'approved' (a draft in effect) and is never published — a scheduled
  // run must never expose a banner either.
  let skippedBanner = 0;
  const skippedBannerSlugs = [];
  for (const row of due || []) {
    const prep = preparePublishBody(row.body || '');
    if (!prep.ok) {
      skippedBanner += 1;
      skippedBannerSlugs.push(row.slug);
      continue;
    }
    if (prep.body !== (row.body || '')) {
      await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, body = ?, updated_at = ? WHERE id = ?',
        ['published', now, prep.body, now, row.id]);
    } else {
      await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
        ['published', now, now, row.id]);
    }
    published += 1;
    publishedSlugs.push(row.slug);
  }
  // Log the run against the Publishing agent when it exists in D1.
  const agent = await d1First(env, 'SELECT id FROM ai_agents WHERE slug = ? LIMIT 1', ['publishing']);
  await d1Run(env,
    'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [agent ? agent.id : null, 'scheduled_publish', 'article',
     JSON.stringify({ outcome: 'completed', published, slugs: publishedSlugs, skippedBanner, skippedBannerSlugs }), 'success', nowIso()]).catch(() => {});
  return { ok: true, published, slugs: publishedSlugs, skippedBanner, skippedBannerSlugs };
}
