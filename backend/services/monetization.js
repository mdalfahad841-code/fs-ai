/**
 * FS AI — Monetization service.
 * AdSense / affiliate tracking with REAL figures only: revenue is $0.00
 * because no AdSense or affiliate account is connected yet.
 * Payout note (Bangladesh): bank wire only. No bKash/Nagad claim is made —
 * AdSense in Bangladesh pays by bank transfer / wire, not mobile wallets.
 */
import { HONEST_ANALYTICS } from '../routes/analytics.js';

export const PAYOUT = {
  country: 'Bangladesh',
  method: 'Bank wire transfer only',
  note: 'AdSense payments in Bangladesh are made by bank wire transfer to a bank account. Mobile wallets such as bKash or Nagad are NOT an AdSense payout method — no such claim is made here.',
  thresholdUsd: 100,
  thresholdNote: 'AdSense pays only after the balance reaches the $100 payment threshold.',
};

export function revenueReport() {
  return {
    revenueUsd: 0,
    revenueFormatted: '$0.00',
    clicks: 'Data unavailable',
    impressions: 'Data unavailable',
    adsenseConnected: false,
    affiliateConnected: false,
    affiliateEarningsUsd: 0,
    note: 'No AdSense or affiliate account is connected yet. Revenue is honestly $0.00.',
    payout: PAYOUT,
  };
}

export function recordAdEvent(event) {
  // Records an ad-related event only if it carries real data. Events with
  // invented numbers are rejected — this service never fabricates earnings.
  if (!event || typeof event !== 'object') return { ok: false, error: 'Invalid event' };
  if (typeof event.amountUsd === 'number' && event.amountUsd !== 0 && !event.source) {
    return { ok: false, error: 'Non-zero revenue requires a verified source (AdSense/affiliate account). None is connected.' };
  }
  return {
    ok: true,
    recorded: {
      type: String(event.type || 'impression').slice(0, 50),
      page: String(event.page || '').slice(0, 200),
      amountUsd: 0,
      at: new Date().toISOString(),
    },
  };
}

export function affiliateLink(product, url) {
  if (!/^https:\/\//.test(url || '')) return { ok: false, error: 'Affiliate URL must start with https://' };
  return {
    ok: false,
    error: 'No affiliate account is connected yet. Affiliate links are not generated until an affiliate programme is actually joined.',
    product: String(product || '').slice(0, 100),
    url,
  };
}

export function payoutEligibility(balanceUsd) {
  const balance = Number(balanceUsd) || 0;
  return {
    balanceUsd: balance,
    thresholdUsd: PAYOUT.thresholdUsd,
    eligible: balance >= PAYOUT.thresholdUsd,
    method: PAYOUT.method,
    note: balance >= PAYOUT.thresholdUsd
      ? 'Threshold reached — payout would be by bank wire transfer.'
      : `Balance is below the $${PAYOUT.thresholdUsd} threshold. Current honest balance: $${balance.toFixed(2)}.`,
  };
}

export function monetizationStatus() {
  return { ...revenueReport(), analytics: HONEST_ANALYTICS };
}
