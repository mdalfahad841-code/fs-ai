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
import { d1All, d1First, d1Run } from '../middleware/validation.js';

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
 * Never throws.
 */
export async function recordUsage(env, attempt) {
  if (!env || !env.DB || !attempt || typeof attempt !== 'object') return false;
  const outcome = ['ok', 'quota-exhausted', 'error', 'not-configured'].includes(attempt.outcome)
    ? attempt.outcome
    : 'error';
  try {
    const res = await d1Run(env,
      'INSERT INTO llm_usage (provider, model, purpose, outcome, tokens_in, tokens_out, neurons, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        String(attempt.provider || 'unknown').slice(0, 100),
        String(attempt.model || '').slice(0, 200),
        attempt.purpose ? String(attempt.purpose).slice(0, 100) : null,
        outcome,
        Math.max(0, Math.round(toNum(attempt.tokensIn))),
        Math.max(0, Math.round(toNum(attempt.tokensOut))),
        Math.max(0, Math.round(toNum(attempt.neurons))),
        attempt.error ? String(attempt.error).slice(0, 500) : null,
      ]);
    return !!(res && res.meta && (res.meta.changes === 1 || res.meta.last_row_id));
  } catch {
    return false;
  }
}

/**
 * Today's usage for one provider (UTC date). requests counts only rows
 * that actually reached a provider (outcome != 'not-configured'), so a
 * missing key never consumes a request quota. Returns zeros on any error.
 */
export async function getDailyUsage(env, provider, date = todayStr()) {
  const empty = { provider, date, requests: 0, tokensIn: 0, tokensOut: 0, neurons: 0 };
  if (!env || !env.DB || !provider) return empty;
  try {
    const rows = await d1All(env,
      'SELECT outcome, tokens_in, tokens_out, neurons FROM llm_usage WHERE provider = ? AND substr(created_at, 1, 10) = ?',
      [String(provider), String(date)]);
    if (!rows) return empty;
    const usage = { ...empty };
    for (const r of rows) {
      if (r.outcome !== 'not-configured') usage.requests += 1;
      usage.tokensIn += toNum(r.tokens_in);
      usage.tokensOut += toNum(r.tokens_out);
      usage.neurons += toNum(r.neurons);
    }
    return usage;
  } catch {
    return empty;
  }
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
