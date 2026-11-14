/**
 * FS AI — LLM provider registry (fallback order + live status).
 *
 * Fallback order (configurable via the autonomy_settings key
 * llm_provider_order, default 'workers-ai,groq,gemini'):
 *   1. workers-ai — Cloudflare Workers AI, primary. Free tier,
 *      10,000 Neurons/day, no key, no card. Unblocked by the [ai]
 *      binding in config/wrangler.toml + a Worker redeploy.
 *   2. groq — free plan, no card. Blocked on the owner creating a
 *      free GroqCloud account + API key (GROQ_API_KEY secret).
 *   3. gemini — free tier, no billing account. Blocked on the owner
 *      creating a free API key in Google AI Studio (GEMINI_API_KEY).
 * Hugging Face, OpenAI and Anthropic have no sustained free API tier
 * and are NOT listed (verified 2026-11-14).
 */
import { d1First } from '../middleware/validation.js';
import { getDailyUsage, isCapHit, getNeuronCap } from './usage.js';
import { WORKERS_AI_MODELS } from './providers/cloudflare-workers-ai.js';
import { GROQ_MODELS, GROQ_ENDPOINT } from './providers/groq.js';
import { GEMINI_MODELS } from './providers/gemini.js';

export const DEFAULT_PROVIDER_ORDER = ['workers-ai', 'groq', 'gemini'];

export const PROVIDERS = [
  {
    id: 'workers-ai',
    name: 'Cloudflare Workers AI',
    kind: 'binding',
    models: [...WORKERS_AI_MODELS],
    defaultModel: WORKERS_AI_MODELS[0],
    dailyCapNeurons: 10000,
    needsKey: false,
    keyEnv: null,
    note: 'Free tier: 10,000 Neurons/day, resets 00:00 UTC. No key, no card; requests fail above the cap.',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'http',
    endpoint: GROQ_ENDPOINT,
    models: [...GROQ_MODELS],
    defaultModel: GROQ_MODELS[0],
    dailyCapTokens: 200000,
    needsKey: true,
    keyEnv: 'GROQ_API_KEY',
    note: 'Free plan, no card: 200,000 tokens/day. Needs a free GroqCloud API key.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini API',
    kind: 'http',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    models: [...GEMINI_MODELS],
    defaultModel: GEMINI_MODELS[0],
    needsKey: true,
    keyEnv: 'GEMINI_API_KEY',
    note: 'Free tier, no billing account. Needs a free API key from Google AI Studio. Reported caps: Flash ~20 requests/day, Flash-Lite ~450/day (reported, not official). Free-tier data may be used by Google to improve its products.',
  },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

async function readOrder(env) {
  if (!env || !env.DB) return [...DEFAULT_PROVIDER_ORDER];
  try {
    const row = await d1First(env, 'SELECT value FROM autonomy_settings WHERE key = ? LIMIT 1', ['llm_provider_order']);
    if (!row || typeof row.value !== 'string' || !row.value.trim()) return [...DEFAULT_PROVIDER_ORDER];
    const order = row.value.split(',').map((s) => s.trim()).filter((s) => providerById(s));
    return order.length ? order : [...DEFAULT_PROVIDER_ORDER];
  } catch {
    return [...DEFAULT_PROVIDER_ORDER];
  }
}

export async function getProviderOrder(env) {
  return readOrder(env);
}

function hasKey(env, provider) {
  if (!provider.needsKey) return true;
  const v = env && typeof env[provider.keyEnv] === 'string' ? env[provider.keyEnv].trim() : '';
  return v.length > 0;
}

/**
 * Live status for every provider: 'available', 'not-configured',
 * 'quota-exhausted' or 'error'. A provider with no key is
 * 'not-configured', never 'available'. Workers AI is available iff
 * env.AI exists and the daily Neuron cap is not hit. Each entry:
 * { id, name, status, model, detail, todayUsage }.
 */
export async function providerStatus(env) {
  const order = await readOrder(env);
  const statuses = [];
  for (const id of order) {
    const provider = providerById(id);
    if (!provider) continue;
    const todayUsage = await getDailyUsage(env, id);
    const entry = {
      id, name: provider.name, status: 'error',
      model: provider.defaultModel, detail: '', todayUsage,
    };
    if (provider.id === 'workers-ai' && (!env || !env.AI || typeof env.AI.run !== 'function')) {
      entry.status = 'not-configured';
      entry.detail = 'Workers AI binding (env.AI) is not bound — add [ai] binding = "AI" to config/wrangler.toml and redeploy the Worker.';
    } else if (!hasKey(env, provider)) {
      entry.status = 'not-configured';
      entry.detail = `${provider.name} API key is not set (${provider.keyEnv} secret is missing).`;
    } else if (await isCapHit(env, id, provider.defaultModel)) {
      entry.status = 'quota-exhausted';
      entry.detail = provider.id === 'workers-ai'
        ? `Daily Neuron cap reached (${todayUsage.neurons} of ${await getNeuronCap(env)} Neurons used today; free allowance is 10,000/day, resets 00:00 UTC).`
        : provider.id === 'groq'
          ? `Daily token cap reached (${todayUsage.tokensIn + todayUsage.tokensOut} of 200,000 tokens used today).`
          : `Daily request cap reached for the reported free-tier limit (${todayUsage.requests} requests today; reported, not official).`;
    } else {
      entry.status = 'available';
      entry.detail = provider.id === 'workers-ai'
        ? `Ready — ${todayUsage.neurons} of 10,000 free Neurons used today.`
        : provider.id === 'groq'
          ? `Ready — ${todayUsage.tokensIn + todayUsage.tokensOut} of 200,000 free tokens used today.`
          : `Ready — ${todayUsage.requests} free-tier requests used today (reported caps: Flash ~20/day, Flash-Lite ~450/day).`;
    }
    statuses.push(entry);
  }
  // Providers missing from the configured order still report, after it.
  for (const provider of PROVIDERS) {
    if (order.includes(provider.id)) continue;
    const todayUsage = await getDailyUsage(env, provider.id);
    statuses.push({
      id: provider.id, name: provider.name, status: 'not-configured',
      model: provider.defaultModel,
      detail: 'Not in the configured provider order.',
      todayUsage,
    });
  }
  return statuses;
}

/** True when at least one provider is available right now. */
export async function anyProviderAvailable(env) {
  const statuses = await providerStatus(env);
  return statuses.some((s) => s.status === 'available');
}
