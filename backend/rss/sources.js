/**
 * FS AI — research source management (D1-backed).
 *
 * Loads the configured RSS/Atom sources from research_sources, fetches
 * them through backend/rss/rss.js, stores genuinely new items in
 * research_items, and records per-source health (last fetch, last
 * error, discovered/duplicates) so the dashboard can show real status.
 * A failed fetch never throws: it is recorded on the source row and
 * returned as a per-source error.
 */
import { d1All, d1First, slugify } from '../middleware/validation.js';
import { fetchFeed, normalizeTitle, isOutdated } from './rss.js';

/** All enabled sources, optionally limited to one division slug. */
export async function loadEnabledSources(env, divisionSlug) {
  const rows = divisionSlug
    ? await d1All(env,
      'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
      's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
      'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id ' +
      'WHERE s.is_active = 1 AND d.slug = ? ORDER BY s.id ASC', [divisionSlug])
    : await d1All(env,
      'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
      's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
      'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id ' +
      'WHERE s.is_active = 1 ORDER BY s.division_id ASC, s.id ASC');
  return rows || [];
}

/** All sources (active and disabled) with division slugs, for the dashboard. */
export async function loadAllSources(env) {
  const rows = await d1All(env,
    'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
    's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
    'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id ' +
    'ORDER BY s.division_id ASC, s.id ASC');
  return rows || [];
}

export async function loadSource(env, id) {
  return d1First(env,
    'SELECT s.id, s.division_id, s.name, s.url, s.source_type, s.is_active, ' +
    's.last_fetched_at, s.last_status, s.last_error, s.items_discovered, s.duplicates_found, d.slug AS division ' +
    'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id WHERE s.id = ?',
    [id]);
}

async function markSourceError(env, source, error) {
  await env.DB.prepare(
    "UPDATE research_sources SET last_fetched_at = datetime('now'), last_status = 'error', last_error = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(String(error).slice(0, 200), source.id).run();
}

async function markSourceOk(env, source, added, duplicates) {
  await env.DB.prepare(
    "UPDATE research_sources SET last_fetched_at = datetime('now'), last_status = 'ok', last_error = NULL, " +
    'items_discovered = items_discovered + ?, duplicates_found = duplicates_found + ?, updated_at = datetime(\'now\') WHERE id = ?',
  ).bind(added, duplicates, source.id).run();
}

/**
 * Fetch one configured source, store new items, update its health row.
 * Returns { sourceId, division, ok, fetched, added, duplicates, outdated, error, items }.
 * `items` are the newly stored items only. fetchImpl is injectable for tests.
 */
export async function fetchSource(env, source, { fetchImpl = fetch } = {}) {
  const result = await fetchFeed(source.url, { fetchImpl });
  if (!result.ok) {
    await markSourceError(env, source, result.error);
    return {
      sourceId: source.id, division: source.division || null, ok: false,
      fetched: 0, added: 0, duplicates: 0, outdated: 0, error: result.error, items: [],
    };
  }

  // Existing article titles/slugs (never propose a topic we already cover)
  // and existing research-item titles for this division (dedupe).
  const articles = await d1All(env, 'SELECT title, slug FROM articles') || [];
  const existingTitles = new Set(articles.map((r) => normalizeTitle(r.title)));
  const existingSlugs = new Set(articles.map((r) => String(r.slug || '').toLowerCase().trim()));
  const stored = await d1All(env, 'SELECT title, url FROM research_items WHERE division_id = ?', [source.division_id]) || [];
  const storedTitles = new Set(stored.map((r) => normalizeTitle(r.title)));
  const storedUrls = new Set(stored.map((r) => String(r.url || '')).filter(Boolean));

  let added = 0;
  let duplicates = 0;
  let outdated = 0;
  const newItems = [];
  const seen = new Set();
  for (const item of result.items) {
    const key = normalizeTitle(item.title);
    const isDup = seen.has(key) || existingTitles.has(key) || existingSlugs.has(slugify(item.title))
      || storedTitles.has(key) || (item.url && storedUrls.has(item.url));
    if (isDup) { duplicates += 1; continue; }
    seen.add(key);
    const outdatedFlag = isOutdated(item.publishedAt) ? 1 : 0;
    if (outdatedFlag) outdated += 1;
    const evidence = item.summary || item.title;
    await env.DB.prepare(
      'INSERT INTO research_items (source_id, division_id, title, url, published_at, summary, evidence_text, is_outdated) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(source.id, source.division_id, item.title, item.url, item.publishedAt, item.summary, evidence, outdatedFlag).run();
    added += 1;
    newItems.push({ title: item.title, url: item.url, publishedAt: item.publishedAt, isOutdated: Boolean(outdatedFlag) });
  }
  await markSourceOk(env, source, added, duplicates);
  return {
    sourceId: source.id, division: source.division || null, ok: true,
    fetched: result.items.length, added, duplicates, outdated, error: null, items: newItems,
  };
}

/**
 * Fetch every enabled source (optionally one division). Never throws:
 * per-source failures are collected in `errors` and recorded on the row.
 * Returns { results, errors }.
 */
export async function fetchAllEnabledSources(env, { divisionSlug, fetchImpl = fetch } = {}) {
  const sources = await loadEnabledSources(env, divisionSlug);
  const results = [];
  const errors = [];
  for (const source of sources) {
    try {
      const r = await fetchSource(env, source, { fetchImpl });
      results.push(r);
      if (!r.ok) errors.push({ source: source.url, error: r.error });
    } catch (err) {
      const message = String(err && err.message ? err.message : err).slice(0, 200);
      await markSourceError(env, source, message);
      results.push({
        sourceId: source.id, division: source.division || null, ok: false,
        fetched: 0, added: 0, duplicates: 0, outdated: 0, error: message, items: [],
      });
      errors.push({ source: source.url, error: message });
    }
  }
  return { results, errors, sourcesChecked: sources.length };
}
