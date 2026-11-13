/**
 * FS AI — Divisions route. The 8 real divisions of FAHAD SOMRAT AI.
 * D1 first when bound, otherwise the clearly-labelled in-memory fallback.
 *
 * D1 table is business_divisions (database/schema.sql) — NOT `divisions`.
 * Public reads return only is_active = 1 divisions. Owner admin CRUD lives
 * in handleAdminDivisions below (worker.js enforces requireOwner).
 */
import {
  jsonOk, jsonError, parseQuery, readJsonBody, sanitiseText,
  isValidSlug, slugify, nowIso, d1All, d1First, d1Run,
} from '../middleware/validation.js';
import { ARTICLES } from './articles.js';

export const DIVISIONS = [
  { id: 1, slug: 'automotive', name: 'Automotive', tagline: 'Cars, bikes and driving, explained simply.', description: 'Buying guides, maintenance checklists, fuel saving and EV guides for everyday drivers.' },
  { id: 2, slug: 'ai-technology', name: 'AI & Technology', tagline: 'AI and technology in plain English.', description: 'Beginner-friendly guides to artificial intelligence and the free tools that save time.' },
  { id: 3, slug: 'gadgets-electronics', name: 'Gadgets & Electronics', tagline: 'Phones, laptops and gadgets — what matters most.', description: 'Practical buying guides for smartphones, laptops and everyday electronics.' },
  { id: 4, slug: 'finance-money', name: 'Finance & Money', tagline: 'Budgeting, saving and money basics.', description: 'Budgeting rules, saving on a small income, loans and interest explained simply.' },
  { id: 5, slug: 'travel-lifestyle', name: 'Travel & Lifestyle', tagline: 'Travel well without overspending.', description: 'Budget travel planning, road-trip checklists and practical trip costs.' },
  { id: 6, slug: 'digital-tools', name: 'Digital Tools', tagline: 'Free converters and calculators.', description: 'Free, no-sign-up digital tools: converters, calculators and everyday utilities.' },
  { id: 7, slug: 'health-wellness', name: 'Health & Wellness', tagline: 'Simple, realistic health habits.', description: 'Walking, home workouts and beginner fitness guides with no equipment needed.' },
  { id: 8, slug: 'education-learning', name: 'Education & Learning', tagline: 'Learn a new skill, step by step.', description: 'Practical learning plans, including learning a new digital skill in 30 days.' },
];

export function divisionsWithCounts() {
  return DIVISIONS.map((d) => ({
    ...d,
    articleCount: ARTICLES.filter((a) => a.division === d.slug).length,
  }));
}

export async function handleDivisions(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (method !== 'GET') return jsonError('Method not allowed', 405);

  if (parts.length === 3) {
    const slug = decodeURIComponent(parts[2]);
    if (env.DB) {
      const rows = await d1All(env,
        'SELECT * FROM business_divisions WHERE slug = ? AND is_active = 1 LIMIT 1', [slug]);
      if (!rows || !rows.length) return jsonError('Division not found', 404);
      const countRows = await d1All(env,
        "SELECT COUNT(*) AS count FROM articles WHERE division_id = ? AND status = 'published'", [rows[0].id]);
      const count = countRows && countRows[0] ? countRows[0].count : 0;
      const articleRows = await d1All(env,
        'SELECT a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt ' +
        'FROM articles a JOIN business_divisions d ON d.id = a.division_id ' +
        "WHERE d.slug = ? AND a.status = 'published' AND (a.publish_at IS NULL OR a.publish_at <= ?) AND d.is_active = 1 " +
        'ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT 100', [slug, nowIso()]).catch(() => d1All(env,
        'SELECT a.*, d.slug AS division, d.name AS division_name, a.published_at AS publishedAt ' +
        'FROM articles a JOIN business_divisions d ON d.id = a.division_id ' +
        "WHERE d.slug = ? AND a.status = 'published' AND d.is_active = 1 " +
        'ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT 100', [slug]));
      return jsonOk({ division: { ...rows[0], articleCount: count }, articles: articleRows || [], source: 'd1' });
    }
    const division = DIVISIONS.find((d) => d.slug === slug);
    if (!division) return jsonError('Division not found', 404);
    return jsonOk({
      division: { ...division, articleCount: ARTICLES.filter((a) => a.division === slug).length },
      articles: ARTICLES.filter((a) => a.division === slug),
      source: 'fallback',
    });
  }

  void parseQuery(url);
  if (env.DB) {
    const results = await d1All(env,
      'SELECT * FROM business_divisions WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
    const divisions = [];
    for (const row of results || []) {
      const countRows = await d1All(env,
        "SELECT COUNT(*) AS count FROM articles WHERE division_id = ? AND status = 'published'", [row.id]);
      divisions.push({ ...row, articleCount: countRows && countRows[0] ? countRows[0].count : 0 });
    }
    return jsonOk({ divisions, total: divisions.length, source: 'd1' });
  }
  const divisions = divisionsWithCounts();
  return jsonOk({ divisions, total: divisions.length, source: 'fallback' });
}

function validateDivisionBody(body, { partial = false } = {}) {
  const errors = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body must be a JSON object.'] };
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2) errors.push('name is required (at least 2 characters).');
    else if (body.name.length > 100) errors.push('name must be under 100 characters.');
  }
  if (body.slug !== undefined && body.slug !== '' && !isValidSlug(body.slug)) errors.push('slug must be lowercase letters, digits and hyphens only.');
  if (body.sort_order !== undefined && !Number.isInteger(Number(body.sort_order))) errors.push('sort_order must be an integer.');
  if (body.is_active !== undefined && body.is_active !== 0 && body.is_active !== 1 && body.is_active !== false && body.is_active !== true) errors.push('is_active must be 0 or 1.');
  for (const field of ['tagline', 'description', 'icon']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') errors.push(`${field} must be a string.`);
    else if (typeof body[field] === 'string' && body[field].length > 500) errors.push(`${field} must be under 500 characters.`);
  }
  return { ok: errors.length === 0, errors };
}

async function createDivision(request, env) {
  if (!env.DB) return jsonError('Division writes require the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const v = validateDivisionBody(body);
  if (!v.ok) return jsonError(v.errors.join(' '), 400);
  const slug = body.slug ? body.slug : slugify(body.name);
  if (!slug) return jsonError('Could not derive a slug from the name.', 400);
  const clash = await d1First(env, 'SELECT id FROM business_divisions WHERE slug = ? LIMIT 1', [slug]);
  if (clash) return jsonError('A division with this slug already exists.', 409);
  const nameClash = await d1First(env, 'SELECT id FROM business_divisions WHERE name = ? LIMIT 1', [body.name.trim()]);
  if (nameClash) return jsonError('A division with this name already exists.', 409);
  const now = nowIso();
  const result = await d1Run(env,
    'INSERT INTO business_divisions (name, slug, tagline, description, icon, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sanitiseText(body.name, 100), slug, sanitiseText(body.tagline || '', 500) || null,
     sanitiseText(body.description || '', 500) || null, sanitiseText(body.icon || '', 100) || null,
     body.sort_order !== undefined ? Number(body.sort_order) : 0,
     body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1, now, now]);
  const id = result && result.meta ? result.meta.last_row_id : null;
  const division = id ? await d1First(env, 'SELECT * FROM business_divisions WHERE id = ? LIMIT 1', [id]) : null;
  if (!division) return jsonError('Division was not stored.', 500);
  return jsonOk({ division }, 201);
}

async function updateDivision(request, env, id) {
  if (!env.DB) return jsonError('Division writes require the D1 database', 503);
  const current = await d1First(env, 'SELECT * FROM business_divisions WHERE id = ? LIMIT 1', [id]);
  if (!current) return jsonError('Division not found', 404);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const v = validateDivisionBody(body, { partial: true });
  if (!v.ok) return jsonError(v.errors.join(' '), 400);
  const slug = body.slug !== undefined ? body.slug : current.slug;
  if (slug !== current.slug) {
    const clash = await d1First(env, 'SELECT id FROM business_divisions WHERE slug = ? LIMIT 1', [slug]);
    if (clash) return jsonError('A division with this slug already exists.', 409);
  }
  const name = body.name !== undefined ? sanitiseText(body.name, 100) : current.name;
  if (name !== current.name) {
    const clash = await d1First(env, 'SELECT id FROM business_divisions WHERE name = ? LIMIT 1', [name]);
    if (clash) return jsonError('A division with this name already exists.', 409);
  }
  await d1Run(env,
    'UPDATE business_divisions SET name = ?, slug = ?, tagline = ?, description = ?, icon = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?',
    [name, slug,
     body.tagline !== undefined ? (sanitiseText(body.tagline, 500) || null) : current.tagline,
     body.description !== undefined ? (sanitiseText(body.description, 500) || null) : current.description,
     body.icon !== undefined ? (sanitiseText(body.icon, 100) || null) : current.icon,
     body.sort_order !== undefined ? Number(body.sort_order) : current.sort_order,
     body.is_active !== undefined ? (body.is_active ? 1 : 0) : current.is_active,
     nowIso(), id]);
  const division = await d1First(env, 'SELECT * FROM business_divisions WHERE id = ? LIMIT 1', [id]);
  return jsonOk({ division });
}

async function deleteDivision(env, id) {
  if (!env.DB) return jsonError('Division writes require the D1 database', 503);
  const current = await d1First(env, 'SELECT * FROM business_divisions WHERE id = ? LIMIT 1', [id]);
  if (!current) return jsonError('Division not found', 404);
  const countRows = await d1All(env, 'SELECT COUNT(*) AS count FROM articles WHERE division_id = ?', [id]);
  const count = countRows && countRows[0] ? countRows[0].count : 0;
  if (count > 0) return jsonError(`Division has ${count} article(s) and cannot be deleted. Move or delete the articles first.`, 409);
  await d1Run(env, 'DELETE FROM business_divisions WHERE id = ?', [id]);
  return jsonOk({ ok: true, deleted: Number(id) });
}

export async function handleAdminDivisions(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // api, admin, divisions, [id]
  if (method === 'POST' && parts.length === 3) return createDivision(request, env);
  if (method === 'GET' && parts.length === 3) {
    if (!env.DB) return jsonError('Division reads require the D1 database', 503);
    const rows = await d1All(env, 'SELECT * FROM business_divisions ORDER BY sort_order ASC, id ASC');
    return jsonOk({ divisions: rows || [], total: (rows || []).length, source: 'd1' });
  }
  if (method === 'PUT' && parts.length === 4) return updateDivision(request, env, parts[3]);
  if (method === 'DELETE' && parts.length === 4) return deleteDivision(env, parts[3]);
  return jsonError('Method not allowed', 405);
}
