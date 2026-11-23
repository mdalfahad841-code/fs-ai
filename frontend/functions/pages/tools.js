/**
 * Pages Function for /pages/tools — rewrites the static tools page with
 * per-tool server-side heads (title, meta, canonical, og/twitter,
 * WebApplication JSON-LD) and a noscript description for crawlers.
 * The bare tools view and unknown ?tool= values are served unchanged.
 * Falls back to the static page on any error — never a 500.
 * See frontend/functions/seo-head.js (Fix Pass 2, item 2, 2026-11-23).
 */
import { handleSeoRequest } from '../seo-head.js';

export async function onRequest(context) {
  return handleSeoRequest(context, 'tool');
}
