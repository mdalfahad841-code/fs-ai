/**
 * FS AI — LLM usage tracking (D1 table llm_usage, migration 006).
 *
 * Every generation attempt is recorded — success, quota-exhausted,
 * error and not-configured — so daily caps are enforced from real rows,
 * never from memory. All functions degrade gracefully: no D1 binding,
 * or a database without the table yet, means zeros / a failed write,
 * never a throw. generateText() must never throw because usage
 * bookkeeping failed.
 */
import { d1All, d1First, d1Run, isMissingColumnError } from '../middleware/validation.js';

export const DEFAULT_NEURON_CAP = 9000;
export const DEFAULT_GROQ_TOKEN_CAP = 190000;
// Gemini free-tier request caps are REPORTED figures (third-party
// reports, late 2026), not published official limits — labelled as
// such wherever they surface. Conservative on purpose.
export const GEMINI_FLASH_REQUEST_CAP = 18;
export const GEMINI_FLASH_LITE_REQUEST_CAP = 450;

export function todayStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Record one attempt. outcome must be one of the llm_usage CHECK values:
 * 'ok', 'quota-exhausted', 'error', 'not-configured'. Returns true when
 * the row was written, false otherwise (no D1 / no table / any error).
 * Never throws. neuronsEstimated marks a neuron figure computed from
 * pricing rates / estimated tokens rather than provider-reported usage
 * (migration 016); when the column is not yet applied live the write
 * falls back to the old column list and the flag is lost (the usage
 * itself is still recorded).
 */
export async function recordUsage(env, attempt) {
  if (!env || !env.DB || !attempt || typeof attempt !== 'object') return false;
  const outcome = ['ok', 'quota-exhausted', 'error', 'not-configured'].includes(attempt.outcome)
    ? attempt.outcome
    : 'error';
  const values = [
    String(attempt.provider || 'unknown').slice(0, 100),
    String(attempt.model || '').slice(0, 200),
    attempt.purpose ? String(attempt.purpose).slice(0, 100) : null,
    outcome,
    Math.max(0, Math.round(toNum(attempt.tokensIn))),
    Math.max(0, Math.round(toNum(attempt.tokensOut))),
    Math.max(0, Math.round(toNum(attempt.neurons))),
    attempt.error ? String(attempt.error).slice(0, 500) : null,
  ];
  try {
    const res = await d1Run(env,
      'INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, error, neurons_estimated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [...values, attempt.neuronsEstimated ? 1 : 0]);
    return !!(res && res.meta && (res.meta.changes === 1 || res.meta.last_row_id));
  } catch (e) {
    if (!isMissingColumnError(e)) return false;
    try {
      const res = await d1Run(env,
        'INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        values);
      return !!(res && res.meta && (res.meta.changes === 1 || res.meta.last_row_id));
    } catch {
      return false;
    }
  }
}

/**
 * THE authoritative daily-usage rule (Phase 3, Priority 7) — every
 * surface (dashboard header via providerStatus, dashboard KPI via the
 * orchestrator analytics payload, cap checks) reads through this
 * function, so the numbers can no longer disagree.
 *  - requests counts only rows that actually reached a provider:
 *    outcome IN ('ok', 'error'). Cap-refusal rows ('quota-exhausted',
 *    written when the cap is hit BEFORE a call) and 'not-configured'
 *    rows are audit-only and never count as calls.
 *  - neurons / tokens are summed from 'ok' rows only (error and
 *    cap-refusal rows carry no usage).
 *  - neuronsEstimated is the part of today's Neurons that is an
 *    ESTIMATE (pricing-rate / estimated-token calculation, never
 *    provider-reported); null when the neurons_estimated column is
 *    not yet applied live (migration 016), so the dashboard never
 *    labels a figure "estimated" on unknown data.
 * Today's usage for one provider (UTC date). Returns zeros on error.
 */
export async function getDailyUsage(env, provider, date = todayStr()) {
  const empty = { provider, date, requests: 0, tokensIn: 0, tokensOut: 0, neurons: 0, neuronsEstimated: null };
  if (!env || !env.DB || !provider) return empty;
  try {
    let rows = null;
    try {
      rows = await d1All(env,
        'SELECT outcome, tokens_in, tokens_out, neurons, neurons_estimated FROM llm_usage WHERE provider = ? AND substr(created_at, 1, 10) = ?',
        [String(provider), String(date)]);
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      rows = await d1All(env,
        'SELECT outcome, tokens_in, tokens_out, neurons FROM llm_usage WHERE provider = ? AND substr(created_at, 1, 10) = ?',
        [String(provider), String(date)]);
    }
    if (!rows) return empty;
    const usage = { ...empty, neuronsEstimated: 0 };
    let estimatedKnown = false;
    for (const r of rows) {
      if (r.outcome !== 'ok' && r.outcome !== 'error') continue; // audit-only rows never count
      if (r.outcome === 'ok') {
        usage.requests += 1;
        usage.tokensIn += toNum(r.tokens_in);
        usage.tokensOut += toNum(r.tokens_out);
        usage.neurons += toNum(r.neurons);
        if (r.neurons_estimated !== undefined && r.neurons_estimated !== null) {
          estimatedKnown = true;
          if (Number(r.neurons_estimated) === 1) usage.neuronsEstimated += toNum(r.neurons);
        }
      } else {
        usage.requests += 1; // a call that errored still reached the provider
      }
    }
    if (!estimatedKnown) usage.neuronsEstimated = null;
    return usage;
  } catch {
    return empty;
  }
}

/** Today's usage for every known provider, via the one rule above. */
export async function getAllProvidersDailyUsage(env, date = todayStr()) {
  const out = {};
  for (const provider of ['workers-ai', 'groq', 'gemini']) {
    out[provider] = await getDailyUsage(env, provider, date);
  }
  return out;
}

async function readSetting(env, key, fallback) {
  if (!env || !env.DB) return fallback;
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', [key]);
    if (!row || row.value === undefined || row.value === null || String(row.value).trim() === '') return fallback;
    return String(row.value);
  } catch {
    return fallback;
  }
}

export async function getNeuronCap(env) {
  const raw = await readSetting(env, 'llm_daily_cap_neurons', String(DEFAULT_NEURON_CAP));
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_NEURON_CAP;
}

export async function getGroqTokenCap(env) {
  const raw = await readSetting(env, 'llm_daily_cap_tokens_groq', String(DEFAULT_GROQ_TOKEN_CAP));
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_GROQ_TOKEN_CAP;
}

/**
 * True when today's recorded usage already reaches the provider's cap.
 * Workers AI: neurons >= cap (default 9000, leaving a 1000-Neuron
 * margin under the 10000/day free allowance). Groq: tokens >= 190000
 * (margin under the 200000/day free limit). Gemini: requests today >=
 * the reported cap for the model (Flash 18, Flash-Lite 450 — reported,
 * not official). A provider with no usage rows is never capped.
 */
export async function isCapHit(env, provider, model) {
  if (!env || !env.DB) return false;
  try {
    if (provider === 'workers-ai') {
      const usage = await getDailyUsage(env, provider);
      return usage.neurons >= (await getNeuronCap(env));
    }
    if (provider === 'groq') {
      const usage = await getDailyUsage(env, provider);
      return (usage.tokensIn + usage.tokensOut) >= (await getGroqTokenCap(env));
    }
    if (provider === 'gemini') {
      const usage = await getDailyUsage(env, provider);
      const cap = String(model || '').includes('flash-lite')
        ? GEMINI_FLASH_LITE_REQUEST_CAP
        : GEMINI_FLASH_REQUEST_CAP;
      return usage.requests >= cap;
    }
    return false;
  } catch {
    return false;
  }
}
