/**
 * FS AI — Autonomy: traffic-growth agent handler.
 *
 * Computes REAL gaps from D1: article counts per division (thinnest
 * first), articles whose body has no internal link to /pages/article,
 * and divisions with zero published articles. Numbers only — no
 * invented traffic or opportunities.
 */
import { d1All, d1First } from '../../middleware/validation.js';

export async function runTrafficGrowth(task, env) {
  const perDivision = await d1All(env,
    'SELECT d.slug AS division, d.name, COUNT(a.id) AS total, ' +
    "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
    'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id ' +
    'GROUP BY d.id, d.slug, d.name ORDER BY published ASC, total ASC') || [];
  const counts = perDivision.map((r) => ({
    division: r.division, name: r.name, total: Number(r.total || 0), published: Number(r.published || 0),
  }));
  const zeroPublished = counts.filter((c) => c.published === 0).map((c) => c.division);
  const noLinkRow = await d1First(env,
    "SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND body NOT LIKE '%/pages/article%'");
  const noInternalLink = Number(noLinkRow ? noLinkRow.n : 0);
  const publishedTotal = counts.reduce((sum, c) => sum + c.published, 0);

  const opportunities = [];
  for (const c of counts.slice(0, 3)) {
    opportunities.push({
      type: 'thin-division',
      division: c.division,
      detail: `${c.name}: ${c.published} published article(s), ${c.total} total — thinnest division, needs sourced content first.`,
      published: c.published,
      total: c.total,
    });
  }
  if (zeroPublished.length) {
    opportunities.push({
      type: 'empty-division',
      divisions: zeroPublished,
      detail: `${zeroPublished.length} division(s) have zero published articles: ${zeroPublished.join(', ')}.`,
    });
  }
  if (noInternalLink > 0) {
    opportunities.push({
      type: 'missing-internal-links',
      count: noInternalLink,
      detail: `${noInternalLink} published article(s) contain no internal link to /pages/article — SEO pass can suggest links.`,
    });
  }
  return {
    outcome: 'done',
    publishedTotal,
    perDivision: counts,
    thinnestFirst: counts.map((c) => c.division),
    zeroPublishedDivisions: zeroPublished,
    articlesWithoutInternalLink: noInternalLink,
    opportunities,
    note: 'Traffic itself is Data unavailable (no reporting API connected) — these are content gaps from D1, not traffic figures.',
  };
}
