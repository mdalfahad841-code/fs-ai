/**
 * FS AI — CMS admin routes (owner-only; worker.js enforces requireOwner).
 *
 *   POST   /api/admin/articles                  create (draft by default)
 *   GET    /api/admin/articles                  list ALL incl. drafts (?status= & ?division=)
 *   GET    /api/admin/articles/:id              one article, any status
 *   PUT    /api/admin/articles/:id              edit (stores a revision first)
 *   DELETE /api/admin/articles/:id              delete (dependent rows
 *          removed in one atomic batch; audit written with the delete —
 *          Fix Pass 2 item 5, 2026-11-23; revisions stay cascade-governed)
 *   POST   /api/admin/articles/:id/publish      manual publish — runs
 *          the publish gate (Fix Pass 2 item 1, 2026-11-23): a Blocked
 *          gate refuses with the failed-check reason list (422); an
 *          explicit owner override needs the typed phrase
 *          "PUBLISH DESPITE GATE" in the JSON body and is recorded in
 *          article_publish_overrides (migration 032) before anything
 *          publishes. The Emergency Stop can never be overridden.
 *          Protected articles #26/#27 (assertNotProtected) refuse 403
 *          always; legacy drafts #28–#31/#33 publish only via the
 *          audited override. Unpublish is ungated (it only hides).
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
  d1All, d1First, d1Run, d1Batch, ARTICLE_STATUSES,
} from '../middleware/validation.js';
import { getEmergencyStop } from './admin.js';
import { stripDraftBanner, hasDraftBanner } from '../utils/draftBanner.js';
import { assertNotProtected } from '../publishing/protection.js';
import {
  countPublishedTodayDhaka, evaluateManualPublishGate,
  MANUAL_PUBLISH_OVERRIDE_PHRASE,
} from '../publishing/gate.js';
import { isSpecialReviewDivision } from '../publishing/divisions.js';

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
  // Fix Pass 2 item 5 (2026-11-23): delete the article and its
  // dependent rows in ONE atomic batch (d1Batch — real D1 executes it
  // as a single transaction), with the deletion audit as the LAST
  // statement of the same batch — the audit row lands only when the
  // delete lands. Close-out B4: the old code wrote the audit row
  // BEFORE the DELETE, so a delete that failed on the FK left an audit
  // row for an article that still exists; and the old code deleted only
  // the articles row, so a draft with fact-check/SEO rows failed on
  // live D1 with FOREIGN KEY constraint failed and nothing was deleted.
  let statements;
  try {
    statements = await buildDeleteStatements(env, id, current, auth);
  } catch (err) {
    return jsonError('Article delete failed', 500);
  }
  try {
    await d1Batch(env, statements);
  } catch {
    // Atomic batch: a failure anywhere rolls the whole batch back, so
    // the article and every dependent row are still there and no audit
    // row claims a deletion that did not happen.
    return jsonError('Article delete failed', 500);
  }
  return jsonOk({ ok: true, deleted: Number(id) });
}

// Tables whose rows reference articles(id) with NO ACTION (default) —
// each blocks DELETE FROM articles until its rows for the article are
// gone. Verified against database/migrations/ (Fix Pass 2 item 5).
// Order is FK-safe: correction_resolutions references
// article_corrections(id), article_corrections references
// claim_checks(id), claim_checks references fact_checks(id).
// article_tags / article_sources declare ON DELETE CASCADE; their
// explicit DELETEs are the pre-existing WS-A safety net for a store
// where the cascade does not fire (kept, unchanged).
// article_revisions is deliberately NOT deleted here: it declares
// ON DELETE CASCADE, so the cascade governs it — and the revisions
// endpoint must keep listing a deleted article's revisions where the
// cascade does not fire (tests/cms.test.js pins this).
// NOT deleted (no FK, so they never block the delete — history kept):
// article_publish_overrides (override audit, migration 032),
// social_posts + youtube_videos (article_id is a plain value column,
// migrations 022/028 — distribution/analytics history, not owned rows),
// keywords + affiliate_links (ON DELETE SET NULL — the FK nulls them).
const DELETE_DEPENDENTS = [
  { table: 'correction_resolutions', sql: 'DELETE FROM correction_resolutions WHERE article_id = ?' },
  { table: 'article_corrections', sql: 'DELETE FROM article_corrections WHERE article_id = ?' },
  { table: 'claim_checks', sql: 'DELETE FROM claim_checks WHERE fact_check_id IN (SELECT id FROM fact_checks WHERE article_id = ?)', needs: ['claim_checks', 'fact_checks'] },
  { table: 'fact_checks', sql: 'DELETE FROM fact_checks WHERE article_id = ?' },
  { table: 'seo_checks', sql: 'DELETE FROM seo_checks WHERE article_id = ?' },
  { table: 'publication_logs', sql: 'DELETE FROM publication_logs WHERE article_id = ?' },
  { table: 'article_fingerprints', sql: 'DELETE FROM article_fingerprints WHERE article_id = ?' },
  { table: 'daily_publication_reservations', sql: 'DELETE FROM daily_publication_reservations WHERE article_id = ?' },
  { table: 'article_fetch_runs', sql: 'DELETE FROM article_fetch_runs WHERE article_id = ?' },
  { table: 'article_tags', sql: 'DELETE FROM article_tags WHERE article_id = ?' },
  { table: 'article_sources', sql: 'DELETE FROM article_sources WHERE article_id = ?' },
];

// Which of the named tables exist in this database — one read-only
// sqlite_master query (D1 exposes it; close-out B4 used it live).
// A table that does not exist cannot hold rows that block the delete,
// so it is simply left out of the batch: harness databases built from
// a partial migration set (e.g. backup-restore, no 015/021/024/026/029)
// delete cleanly instead of failing on "no such table". When the probe
// itself fails (a test double without the handler), null means "assume
// the full set" — the batch then fails loudly on the first missing
// table instead of silently deleting half the rows.
async function existingTables(env, names) {
  try {
    const placeholders = names.map(() => '?').join(', ');
    const rows = await d1All(env,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`, names);
    if (!rows) return null;
    return new Set(rows.map((r) => r.name));
  } catch {
    return null;
  }
}

async function buildDeleteStatements(env, id, current, auth) {
  const allNames = [...new Set([
    ...DELETE_DEPENDENTS.flatMap((d) => d.needs || [d.table]),
    'article_revisions', 'article_deletion_audit',
  ])];
  const existing = await existingTables(env, allNames);
  const has = (name) => !existing || existing.has(name);
  // Deletion audit (migration 025): record how many revisions existed
  // at delete time — the audit row is the durable record either way.
  let revisionsKept = 0;
  if (has('article_revisions')) {
    try {
      const revs = await d1First(env, 'SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?', [id]);
      revisionsKept = Number(revs ? revs.n : 0);
    } catch {
      revisionsKept = 0;
    }
  }
  const statements = [];
  for (const dep of DELETE_DEPENDENTS) {
    if ((dep.needs || [dep.table]).every(has)) statements.push({ sql: dep.sql, params: [id] });
  }
  statements.push({ sql: 'DELETE FROM articles WHERE id = ?', params: [id] });
  if (has('article_deletion_audit')) {
    statements.push({
      sql: 'INSERT INTO article_deletion_audit (article_id, title, slug, status_at_delete, deleted_by, body_length, revisions_kept) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: [Number(id), current.title || '', current.slug || '', current.status || '', (auth && auth.owner) || null, String(current.body || '').length, revisionsKept],
    });
  }
  // Else: pre-025 database — the deletion proceeds unaudited, as before
  // (the old code's degrade; the backup-restore harness has no audit
  // table). No false audit row can be written when the table is absent.
  return statements;
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

/**
 * Manual publish gate — the single verdict the publish path reports
 * and audits (Fix Pass 2 item 1). `reasons` is the exact list the
 * owner sees on a refusal: the gate's failed-check details, plus the
 * legacy-draft reason when it applies (the gate itself does not know
 * about the legacy list). `checks` is the gate's full check array so
 * the dashboard can name the failed checks, not just their text.
 */
function manualGateReport(manual, current) {
  const reasons = [...manual.blockedBy];
  if (manual.legacyProtected) {
    reasons.push(`Article #${manual.articleId} is a protected legacy draft — it needs separate owner authorization (publish with the override phrase).`);
  }
  return {
    contentReady: manual.contentReady,
    blockedBy: reasons,
    failedChecks: manual.failedChecks,
    checks: manual.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
    legacyProtected: manual.legacyProtected,
    emergencyStopOn: manual.emergencyStopOn,
    division: current.division || null,
  };
}

async function setPublishState(request, env, id, publish, auth) {
  if (!env.DB) return jsonError('CMS writes require the D1 database', 503);
  // WS-E finding H1 (Workstream A fix, 2026-11-21): a protected
  // article must never be published/unpublished through a manual
  // endpoint either — same ID-level guard as edit/delete (before the
  // 404 check, so #26/#27 refuse 403 even with no row). Fix Pass 2
  // item 1: this guard is ABSOLUTE — the override phrase below does
  // not bypass it. Only the legacy drafts #28–#31/#33 (see the manual
  // gate) may publish via an audited override; #26/#27 never publish
  // through this endpoint at all.
  const guard = await assertNotProtected(env, id);
  if (!guard.ok) return jsonError(guard.reason, 403);
  const current = await fetchArticle(env, id);
  if (!current) return jsonError('Article not found', 404);
  if (!publish) {
    await d1Run(env, 'UPDATE articles SET status = ?, published_at = NULL, updated_at = ? WHERE id = ?',
      ['draft', nowIso(), id]);
    const article = await fetchArticle(env, id);
    return jsonOk({ article: await withTags(env, article) });
  }
  // --- Manual publish (publish=true) — Fix Pass 2 item 1 ---
  // Banner protection (2026-11-20) runs FIRST, before the gate: an
  // AI draft's internal AI-DRAFT warning block must never reach the
  // public, and a banner that survives the strip is refused with the
  // banner error (not a gate error) — the article stays exactly as it
  // was (still a draft, body untouched) and the owner must remove the
  // banner by hand. preparePublishBody is pure: a successful strip
  // writes nothing, so a later gate refusal leaves no trace.
  const prep = preparePublishBody(current.body || '');
  if (!prep.ok) return jsonError(prep.error, 422);
  // The optional override phrase arrives ONLY as JSON in the request
  // body ({ "override": "PUBLISH DESPITE GATE" }) — never as a query
  // param, never as a header. A POST with no body (the dashboard's
  // plain Publish click and every pre-existing client) carries no
  // override; a present-but-unparseable body is a 400.
  let override = null;
  const rawBody = await request.text();
  if (rawBody && rawBody.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonError('Invalid JSON body.', 400);
    }
    if (parsed && typeof parsed === 'object') override = parsed.override;
  }
  const overrideGiven = typeof override === 'string' && override.length > 0;
  const overrideExact = override === MANUAL_PUBLISH_OVERRIDE_PHRASE;
  // A phrase was typed but it is not the exact phrase: refuse without
  // guessing the intent — a wrong phrase is never treated as "no
  // override" and never as an override.
  if (overrideGiven && !overrideExact) {
    return jsonError(`Override phrase is incorrect — type ${MANUAL_PUBLISH_OVERRIDE_PHRASE} exactly to publish despite the gate.`, 422);
  }
  // The gate itself. If it cannot be evaluated at all (missing tables
  // on an old database, a store error), refuse 503 — fail closed. A
  // publish must never proceed past an unverifiable gate.
  let manual;
  try {
    manual = await evaluateManualPublishGate(env, id);
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    return jsonError(`Could not evaluate the publish gate (${message}) — the publish was refused.`, 503);
  }
  // The Emergency Stop is a safety control, not a gate check the owner
  // can type past: the override phrase NEVER bypasses it. The owner
  // turns the Stop off first, as a separate deliberate act. No audit
  // row is written for this refusal — nothing was overridden.
  if (manual.emergencyStopOn) {
    return jsonError('Emergency Stop is ON — turn it off before publishing. The override phrase cannot bypass the Emergency Stop.', 422,
      { gate: manualGateReport(manual, current) });
  }
  // Normal path: the gate must allow the publish AND the article must
  // not be a protected legacy draft. A refusal names every failed
  // check (and the legacy reason when it applies) in the response so
  // the dashboard can show the reason list.
  if (!overrideExact && !manual.allowed) {
    const report = manualGateReport(manual, current);
    return jsonError(`Publish gate is Blocked: ${report.blockedBy.join(' ')}`, 422, { gate: report });
  }
  // Override path (exact phrase only): record the audit row BEFORE
  // anything publishes. The row carries who overrode, when, which
  // article, the FULL gate result that was overridden, and whether
  // human review applied (typing the phrase IS the human review for
  // Health/Finance divisions). If the audit table is missing (code
  // deployed before migration 032) the INSERT throws and the publish
  // is refused with 503 — an unaudited override must never happen.
  // An override on a gate-passing article is audited the same way:
  // the phrase was invoked, so the row records that it was.
  if (overrideExact) {
    const gateResult = JSON.stringify({
      ...manualGateReport(manual, current),
      overriddenAt: nowIso(),
    });
    try {
      await d1Run(env,
        'INSERT INTO article_publish_overrides (article_id, title, slug, division, published_by, gate_result, human_review_applied) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [Number(id), current.title || '', current.slug || '', current.division || '',
         (auth && auth.owner) || null, gateResult,
         isSpecialReviewDivision(current.division) ? 1 : 0]);
    } catch (e) {
      return jsonError('Could not record the publish-override audit — the publish was refused so no unaudited override can happen.', 503);
    }
  }
  if (prep.body !== (current.body || '')) {
    await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, body = ?, updated_at = ? WHERE id = ?',
      ['published', nowIso(), prep.body, nowIso(), id]);
  } else {
    await d1Run(env, 'UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
      ['published', nowIso(), nowIso(), id]);
  }
  const article = await fetchArticle(env, id);
  return jsonOk({ article: await withTags(env, article), ...(overrideExact ? { overridden: true } : {}) });
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
  if (method === 'POST' && parts.length === 5 && parts[4] === 'publish') return setPublishState(request, env, parts[3], true, auth);
  if (method === 'POST' && parts.length === 5 && parts[4] === 'unpublish') return setPublishState(request, env, parts[3], false, auth);
  if (method === 'GET' && parts.length === 5 && parts[4] === 'revisions') return listRevisions(env, parts[3]);
  return jsonError('Method not allowed', 405);
}

/**
 * Scheduled publishing: publish approved articles whose publish_at has
 * passed. Called by the Worker's hourly cron (worker.js `scheduled`) and
 * directly by tests. When the Emergency Stop flag is on, nothing is
 * published and the skip is logged. Nothing else is ever auto-published:
 * only owner-approved (status='approved') articles with a due publish_at.
 *
 * Daily limit (B1, 2026-11-23): the run publishes at most
 * `max_articles_per_day` articles per Dhaka day — the same 1/day rule
 * the publish gate enforces on the approval path (gate.js check 9),
 * counted with the gate's own countPublishedTodayDhaka(). A due article
 * beyond the remaining slots stays 'approved' and is reported as
 * skipped-due-to-limit. A banner-blocked article never consumes a slot.
 * If the limit or the published-today count cannot be read, the run
 * FAILS SAFE: nothing publishes and ok:false is returned — never
 * publish past an unverifiable limit.
 */
export async function publishDueArticles(env) {
  if (!env || !env.DB) return { ok: false, published: 0, error: 'D1 database is not bound.' };
  if (await getEmergencyStop(env)) {
    await d1Run(env,
      'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [null, 'scheduled_publish', 'article', JSON.stringify({ outcome: 'skipped', reason: 'Emergency Stop is on.' }), 'skipped', nowIso()]).catch(() => {});
    return { ok: true, published: 0, skipped: true, reason: 'Emergency Stop is on.' };
  }
  // B1 daily-limit check — BEFORE anything publishes. The setting read
  // is deliberately strict (unlike the gate's local setting() helper,
  // which swallows errors and falls back): a lookup failure must fail
  // safe. A missing row still means the default '1'; only a thrown
  // error refuses the run. The limit parse matches gate.js check 9
  // (parseInt, finite and >= 0, else 1).
  let dailyLimit;
  let publishedToday;
  try {
    const limitRow = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', ['max_articles_per_day']);
    const limitRaw = limitRow && typeof limitRow.value === 'string' ? limitRow.value : '1';
    const parsed = Number.parseInt(limitRaw, 10);
    dailyLimit = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    publishedToday = await countPublishedTodayDhaka(env);
    if (!Number.isFinite(publishedToday) || publishedToday < 0) throw new Error('Published-today count is not a number.');
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    await d1Run(env,
      'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [null, 'scheduled_publish', 'article', JSON.stringify({ outcome: 'failed', reason: `Daily-limit check failed: ${message}` }), 'failed', nowIso()]).catch(() => {});
    return { ok: false, published: 0, error: `Daily-limit check failed: ${message}` };
  }
  const remainingSlots = dailyLimit - publishedToday;
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
  // run must never expose a banner either. A banner skip never consumes
  // a daily-limit slot: the slot is only spent by an actual publish.
  let skippedBanner = 0;
  const skippedBannerSlugs = [];
  // B1: due articles beyond the remaining daily slots stay 'approved'
  // and are reported as skipped-due-to-limit (never touched).
  let skippedDailyLimit = 0;
  const skippedDailyLimitSlugs = [];
  for (const row of due || []) {
    const prep = preparePublishBody(row.body || '');
    if (!prep.ok) {
      skippedBanner += 1;
      skippedBannerSlugs.push(row.slug);
      continue;
    }
    if (published >= remainingSlots) {
      skippedDailyLimit += 1;
      skippedDailyLimitSlugs.push(row.slug);
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
     JSON.stringify({ outcome: 'completed', published, slugs: publishedSlugs, skippedBanner, skippedBannerSlugs, skippedDailyLimit, skippedDailyLimitSlugs, dailyLimit, publishedToday }), 'success', nowIso()]).catch(() => {});
  return { ok: true, published, slugs: publishedSlugs, skippedBanner, skippedBannerSlugs, skippedDailyLimit, skippedDailyLimitSlugs, dailyLimit, publishedToday };
}
