/**
 * FS AI — Accounts route. Real account statuses only.
 * Created/opened: GitHub, YouTube, Pinterest.
 * Pending (never claimed as created/connected): Facebook, WhatsApp Business,
 * Business Email, Search Console, Analytics, AdSense, Affiliate.
 *
 * D1 table is monetization_accounts (database/schema.sql) — NOT `accounts`
 * — and it has NO `detail` column (the notes live in `notes`). Status
 * vocabulary follows the schema CHECK: pending | active | suspended |
 * rejected. D1 rows are mapped to the fallback shape: id is the
 * lower-case hyphenated platform name (e.g. 'whatsapp-business'),
 * detail is the notes text.
 */
import { jsonOk, jsonError, d1All, d1Run, nowIso } from '../middleware/validation.js';

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

// Schema status vocabulary for monetization_accounts (CHECK constraint).
export const ACCOUNT_STATUSES = ['pending', 'active', 'suspended', 'rejected'];

function platformId(platform) {
  return String(platform || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function mapAccountRow(row) {
  if (!row) return row;
  return {
    id: platformId(row.platform),
    platform: row.platform,
    handle: row.handle || null,
    url: row.account_url || null,
    status: row.status,
    detail: row.notes || '',
    verifiedAt: row.verified_at || null,
  };
}

async function findAccountById(env, id) {
  const rows = await d1All(env, 'SELECT * FROM monetization_accounts ORDER BY platform ASC');
  return (rows || []).map(mapAccountRow).find((a) => a.id === id) || null;
}

export async function handleAccounts(request, env) {
  const method = request.method.toUpperCase();
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);

  if (method === 'GET') {
    if (parts.length === 3) {
      const id = decodeURIComponent(parts[2]);
      if (env.DB) {
        const account = await findAccountById(env, id);
        if (!account) return jsonError('Account not found', 404);
        return jsonOk({ account, source: 'd1' });
      }
      const account = ACCOUNTS.find((a) => a.id === id);
      if (!account) return jsonError('Account not found', 404);
      return jsonOk({ account, source: 'fallback' });
    }
    if (env.DB) {
      const results = await d1All(env, 'SELECT * FROM monetization_accounts ORDER BY platform ASC');
      if (results && results.length) {
        const accounts = results.map(mapAccountRow);
        return jsonOk({ accounts, total: accounts.length, summary: { active: accounts.filter((a) => a.status === 'active').length, pending: accounts.filter((a) => a.status === 'pending').length, total: accounts.length }, source: 'd1' });
      }
    }
    return jsonOk({ accounts: ACCOUNTS, total: ACCOUNTS.length, summary: accountSummary(), source: 'fallback' });
  }

  // Owner-only updates (worker.js enforces requireOwner before reaching here
  // for non-GET methods). Only status/notes may change; never invent a URL.
  // Status must match the monetization_accounts CHECK constraint.
  if (method === 'PUT' || method === 'PATCH') {
    if (!env.DB) return jsonError('Account updates require the D1 database', 503);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.status !== 'string') return jsonError('Invalid body: status is required', 400);
    if (!ACCOUNT_STATUSES.includes(body.status)) {
      return jsonError(`Invalid status — must be one of: ${ACCOUNT_STATUSES.join(', ')}.`, 400);
    }
    const id = parts.length === 3 ? decodeURIComponent(parts[2]) : body.id;
    if (!id) return jsonError('Account id is required', 400);
    const account = await findAccountById(env, id);
    if (!account) return jsonError('Account not found', 404);
    const notes = typeof body.detail === 'string' ? body.detail : (typeof body.notes === 'string' ? body.notes : account.detail);
    await d1Run(env, 'UPDATE monetization_accounts SET status = ?, notes = ?, updated_at = ? WHERE platform = ?',
      [body.status, notes, nowIso(), account.platform]);
    return jsonOk({ ok: true, id, status: body.status });
  }

  return jsonError('Method not allowed', 405);
}
