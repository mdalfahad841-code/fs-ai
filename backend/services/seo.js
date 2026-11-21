/**
 * FS AI — SEO service.
 * Meta titles/descriptions, sitemap entries, Open Graph and structured data
 * (JSON-LD) generated from the REAL articles and divisions only.
 */
import { ARTICLES } from '../routes/articles.js';
import { DIVISIONS } from '../routes/divisions.js';
import { FRONTEND_TOOL_IDS } from '../routes/tools.js';
import { escapeHtml } from '../security/crypto.js';

export const SITE_URL = 'https://fs-ai-5w5.pages.dev';
export const SITE_NAME = 'FS AI — FAHAD SOMRAT AI';

export function metaForArticle(article) {
  const title = `${article.title} | FS AI`;
  const description = (article.excerpt || article.title).slice(0, 155);
  return {
    title: title.slice(0, 60),
    titleFull: title,
    description,
    keywords: article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w, i, a) => w.length > 3 && a.indexOf(w) === i).slice(0, 8).join(', '),
    canonical: `${SITE_URL}/pages/article?id=${article.id}`,
    robots: 'index, follow',
  };
}

export function openGraphForArticle(article) {
  const meta = metaForArticle(article);
  return {
    'og:title': meta.titleFull,
    'og:description': meta.description,
    'og:type': 'article',
    'og:url': meta.canonical,
    'og:site_name': SITE_NAME,
    'article:section': article.divisionName || article.division,
    'article:published_time': article.publishedAt || '',
  };
}

export function structuredDataForArticle(article) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt || '',
    author: { '@type': 'Organization', name: 'FS AI', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'FS AI', url: SITE_URL },
    datePublished: article.publishedAt || '',
    mainEntityOfPage: `${SITE_URL}/pages/article?id=${article.id}`,
    articleSection: article.divisionName || article.division,
  };
}

export function structuredDataForSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'FS AI',
    alternateName: 'FAHAD SOMRAT AI',
    url: SITE_URL,
    description: 'One Platform. Multiple Possibilities.',
  };
}

/**
 * Every eligible public page, generated from the real data — no
 * hand-maintained list. 60 entries: home, the all-divisions page,
 * 8 divisions, 25 published articles, the tools index, 20 per-tool
 * pages (frontend tool ids), about, contact, privacy, terms.
 * Drafts, the dashboard, owner-setup and any other private route are
 * NEVER listed. (Phase 3, Priority 8: the old generator emitted 35
 * entries while the deployed files had 58/60 — the gap was the
 * all-divisions page, the 20 tool pages, and about/contact/privacy/
 * terms. The committed files are now REGENERATED from this function
 * — see scripts/regenerate-sitemap.mjs — and a test asserts the
 * committed loc sets equal the generator output.)
 */
export function sitemapEntries() {
  const entries = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: 1.0 },
    { loc: `${SITE_URL}/pages/division`, changefreq: 'weekly', priority: 0.8 },
    ...DIVISIONS.map((d) => ({ loc: `${SITE_URL}/pages/division?division=${d.slug}`, changefreq: 'weekly', priority: 0.8 })),
    ...ARTICLES.filter((a) => a.status === 'published').map((a) => ({
      loc: `${SITE_URL}/pages/article?id=${a.id}`,
      lastmod: a.publishedAt || '',
      changefreq: 'monthly',
      priority: 0.7,
    })),
    { loc: `${SITE_URL}/pages/tools`, changefreq: 'weekly', priority: 0.6 },
    ...FRONTEND_TOOL_IDS.map((id) => ({
      loc: `${SITE_URL}/pages/tools?tool=${id}`,
      changefreq: 'monthly',
      priority: 0.6,
    })),
    { loc: `${SITE_URL}/pages/about`, changefreq: 'monthly', priority: 0.3 },
    { loc: `${SITE_URL}/pages/contact`, changefreq: 'monthly', priority: 0.3 },
    { loc: `${SITE_URL}/pages/privacy`, changefreq: 'weekly', priority: 0.3 },
    { loc: `${SITE_URL}/pages/terms`, changefreq: 'weekly', priority: 0.3 },
  ];
  return entries;
}

export function renderSitemapXml(entries) {
  const urls = entries.map((e) => {
    const lastmod = e.lastmod ? `\n    <lastmod>${escapeHtml(e.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>${lastmod}\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function sitemapXml() {
  return renderSitemapXml(sitemapEntries());
}

export function robotsTxt() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}
