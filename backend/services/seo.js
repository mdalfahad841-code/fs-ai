/**
 * FS AI — SEO service.
 * Meta titles/descriptions, sitemap entries, Open Graph and structured data
 * (JSON-LD) generated from the REAL articles and divisions only.
 */
import { ARTICLES } from '../routes/articles.js';
import { DIVISIONS } from '../routes/divisions.js';
import { escapeHtml } from '../security/crypto.js';

export const SITE_URL = 'https://fs-ai.pages.dev';
export const SITE_NAME = 'FS AI — FAHAD SOMRAT AI';

export function metaForArticle(article) {
  const title = `${article.title} | FS AI`;
  const description = (article.excerpt || article.title).slice(0, 155);
  return {
    title: title.slice(0, 60),
    titleFull: title,
    description,
    keywords: article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w, i, a) => w.length > 3 && a.indexOf(w) === i).slice(0, 8).join(', '),
    canonical: `${SITE_URL}/articles/${article.slug}`,
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
    mainEntityOfPage: `${SITE_URL}/articles/${article.slug}`,
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

export function sitemapEntries() {
  const entries = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: 1.0 },
    ...DIVISIONS.map((d) => ({ loc: `${SITE_URL}/divisions/${d.slug}`, changefreq: 'weekly', priority: 0.8 })),
    ...ARTICLES.filter((a) => a.status === 'published').map((a) => ({
      loc: `${SITE_URL}/articles/${a.slug}`,
      lastmod: a.publishedAt || '',
      changefreq: 'monthly',
      priority: 0.7,
    })),
    { loc: `${SITE_URL}/tools`, changefreq: 'monthly', priority: 0.8 },
  ];
  return entries;
}

export function sitemapXml() {
  const entries = sitemapEntries();
  const urls = entries.map((e) => {
    const lastmod = e.lastmod ? `\n    <lastmod>${escapeHtml(e.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>${lastmod}\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function robotsTxt() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}
