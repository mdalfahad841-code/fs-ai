/**
 * Pages Function for /pages/division — rewrites the static division page
 * with per-division server-side heads (title, meta, canonical, og/twitter,
 * CollectionPage JSON-LD) and a noscript article list for crawlers.
 * The bare all-divisions view and unknown slugs are served unchanged.
 * Falls back to the static page on any error — never a 500.
 * See functions/seo-head.js (Fix Pass 2, item 2, 2026-11-23).
 */
import { handleSeoRequest } from '../seo-head.js';

export async function onRequest(context) {
  return handleSeoRequest(context, 'division');
}
