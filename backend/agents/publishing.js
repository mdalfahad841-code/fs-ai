/**
 * FS AI — Publishing agent module.
 * Publishes ONLY content the owner has approved. Anything else is refused
 * and held. Publishing writes to D1 when bound; otherwise it returns the
 * prepared record so the owner can see exactly what would be published.
 */
import { ownerApprovalGate } from './business-manager.js';

export function prepareForPublish(draft, divisionSlug) {
  const slug = (draft.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return {
    slug,
    title: draft.title,
    division: divisionSlug || draft.division || 'general',
    excerpt: (draft.sections?.[0]?.body || '').slice(0, 155),
    status: 'ready-for-review',
    preparedAt: new Date().toISOString(),
  };
}

export async function publishApproved(item, env) {
  const gate = ownerApprovalGate(item);
  if (!gate.ok) return gate;
  const record = {
    ...prepareForPublish(item, item.divisionSlug),
    status: 'published',
    publishedAt: new Date().toISOString(),
    approvedBy: 'owner',
  };
  if (env && env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO articles (slug, title, division, excerpt, status, publishedAt) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(record.slug, record.title, record.division, record.excerpt, 'published', record.publishedAt).run();
      return { ok: true, published: record, source: 'd1' };
    } catch (err) {
      return { ok: false, error: `D1 publish failed: ${err.message}` };
    }
  }
  // No D1 bound: do not pretend it was published live. Return the record
  // as "prepared" so the owner can see it and publish once D1 is bound.
  return { ok: true, published: { ...record, status: 'prepared-not-live' }, source: 'fallback', note: 'D1 is not bound — record prepared, not published live.' };
}

export async function unpublish(slug, env) {
  if (!env || !env.DB) return { ok: false, error: 'Unpublish requires the D1 database.' };
  await env.DB.prepare("UPDATE articles SET status = 'draft' WHERE slug = ?").bind(slug).run();
  return { ok: true, slug, status: 'draft' };
}
