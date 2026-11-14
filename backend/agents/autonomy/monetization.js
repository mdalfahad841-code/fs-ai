/**
 * FS AI — Autonomy: monetization agent handler.
 *
 * Reads monetization_accounts from D1 plus the ACCOUNTS truth table.
 * Revenue is always $0.00 — never invented. Opportunities are the two
 * pending programmes with honest reasons.
 */
import { d1All } from '../../middleware/validation.js';
import { ACCOUNTS } from '../../routes/accounts.js';

export async function runMonetization(task, env) {
  let d1Accounts = [];
  try {
    d1Accounts = await d1All(env, 'SELECT platform, status, notes FROM monetization_accounts ORDER BY platform ASC') || [];
  } catch {
    d1Accounts = [];
  }
  const truth = ACCOUNTS.map((a) => ({ id: a.id, platform: a.platform, status: a.status, detail: a.detail }));
  return {
    outcome: 'done',
    revenue: 0,
    revenueFormatted: '$0.00',
    revenueCurrency: 'USD',
    accounts: truth,
    d1Accounts: d1Accounts.map((r) => ({ platform: r.platform, status: r.status, notes: r.notes || '' })),
    opportunities: [
      { program: 'AdSense', status: 'pending', reason: 'Needs real traffic' },
      { program: 'Affiliate', status: 'pending', reason: 'No program joined' },
    ],
    note: 'Revenue is $0.00 — no AdSense account and no affiliate programme is connected.',
  };
}
