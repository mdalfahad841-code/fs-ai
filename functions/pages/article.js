/**
 * Pages Function for /pages/article — rewrites the static article page
 * with per-article server-side heads (title, meta, canonical, og/twitter,
 * Article + BreadcrumbList JSON-LD) and a noscript body for crawlers.
 * Falls back to the static page on any error or unknown id — never a
 * 500. See functions/seo-head.js for the mechanism, data and cache
 * decisions (Fix Pass 2, item 2, 2026-11-23).
 */
import { handleSeoRequest } from '../seo-head.js';

export async function onRequest(context) {
  return handleSeoRequest(context, 'article');
}
