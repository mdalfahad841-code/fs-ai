/**
 * FS AI — Accounts route. Real account statuses only.
 * Created/opened: GitHub, YouTube, Pinterest.
 * Pending (never claimed as created/connected): Facebook, WhatsApp Business,
 * Business Email, Search Console, Analytics, AdSense, Affiliate.
 */
import { jsonOk, jsonError } from '../middleware/validation.js';

export const ACCOUNTS = [
  { id: 'github', platform: 'GitHub', handle: 'mdalfahad841-code', url: 'https://github.com/mdalfahad841-code/fs-ai', status: 'created', detail: 'Public repository fs-ai exists; no code uploaded yet at last check.' },
  { id: 'youtube', platform: 'YouTube', handle: '@FSAI-e5f', url: 'https://www.youtube.com/@FSAI-e5f', status: 'created', detail: 'Channel handle @FSAI-e5f.' },
  { id: 'pinterest', platform: 'Pinterest', handle: 'watchwithf', url: 'https://www.pinterest.com/watchwithf/', status: 'created', detail: 'Profile watchwithf.' },
  { id: 'facebook', platform: 'Facebook', handle: null, url: null, status: 'pending', detail: 'Not created yet.' },
  { id: 'whatsapp-business', platform: 'WhatsApp Business', handle: null, url: null, status: 'pending', detail: 'Not created yet.' },
  { id: 'business-email', platform: 'Business Email', handle: null, url: null, status: 'pending', detail: 'Not created yet.' },
  { id: 'search-console', platform: 'Search Console', handle: null, url: null, status: 'pending', detail: 'Not connected yet.' },
  { id: 'analytics', platform: 'Analytics', handle: null, url: null, status: 'pending', detail: 'Not connected yet — traffic is "Data unavailable".' },
  { id: 'adsense', platform: 'AdSense', handle: null, url: null, status: 'pending', detail: 'Not connected yet — revenue is $0.00.' },
  { id: 'affiliate', platform: 'Affiliate', handle: null, url: null, status: 'pending', detail: 'Not started yet.' },
];

export function accountSummary() {
  return {
    created: ACCOUNTS.filter((a) => a.status === 'created').length,
    pending: ACCOUNTS.filter((a) => a.status === 'pending').length,
    total: ACCOUNTS.length,
  };
}

export async function handleAccounts(request, env) {
  const method = request.method.toUpperCase();
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);

  if (method === 'GET') {
    if (parts.length === 3) {
      const account = ACCOUNTS.find((a) => a.id === decodeURIComponent(parts[2]));
      if (!account) return jsonError('Account not found', 404);
      return jsonOk({ account, source: 'fallback' });
    }
    if (env.DB) {
      const { results } = await env.DB.prepare('SELECT * FROM accounts ORDER BY platform ASC').all().catch(() => ({ results: [] }));
      if (results && results.length) return jsonOk({ accounts: results, summary: accountSummary(), source: 'd1' });
    }
    return jsonOk({ accounts: ACCOUNTS, summary: accountSummary(), source: 'fallback' });
  }

  // Owner-only updates (worker.js enforces requireOwner before reaching here
  // for non-GET methods). Only status/detail may change; never invent a URL.
  if (method === 'PUT' || method === 'PATCH') {
    if (!env.DB) return jsonError('Account updates require the D1 database', 503);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.status !== 'string') return jsonError('Invalid body: status is required', 400);
    if (!['created', 'pending', 'connected'].includes(body.status)) return jsonError('Invalid status', 400);
    const id = parts.length === 3 ? decodeURIComponent(parts[2]) : body.id;
    await env.DB.prepare('UPDATE accounts SET status = ?, detail = ? WHERE id = ?').bind(body.status, body.detail || '', id).run();
    return jsonOk({ ok: true, id, status: body.status });
  }

  return jsonError('Method not allowed', 405);
}
