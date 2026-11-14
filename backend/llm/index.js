/**
 * FS AI — Provider-independent LLM interface.
 *
 * generateText({ prompt, system, maxTokens, purpose }, env) tries the
 * configured providers in order (Workers AI -> Groq -> Gemini),
 * enforces the daily caps in code BEFORE calling any provider, records
 * every attempt in llm_usage, and never throws on provider failure —
 * it returns the failure honestly so callers can pause generation
 * instead of fabricating content.
 */
import { PROVIDERS, providerById, getProviderOrder, providerStatus } from './registry.js';
import { recordUsage, isCapHit } from './usage.js';
import { generateWithWorkersAI } from './providers/cloudflare-workers-ai.js';
import { generateWithGroq } from './providers/groq.js';
import { generateWithGemini } from './providers/gemini.js';

const GENERATORS = {
  'workers-ai': generateWithWorkersAI,
  groq: generateWithGroq,
  gemini: generateWithGemini,
};

export { PROVIDERS, providerById, providerStatus };

/**
 * Generate text via the first available provider.
 * Success: { ok: true, text, provider, model, tokens: { in, out },
 *   neurons, neuronsEstimated, cached: false }.
 * Failure: { ok: false, reason, providerStatuses } where reason is
 * 'invalid-prompt', 'quota-exhausted' (every configured provider is
 * capped) or 'all-providers-unavailable'. Never throws.
 */
export async function generateText(input, env) {
  const providerStatuses = [];
  try {
    const prompt = input && typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) {
      return { ok: false, reason: 'invalid-prompt', providerStatuses, detail: 'A non-empty prompt is required.' };
    }
    const system = input && typeof input.system === 'string' ? input.system : '';
    const maxTokens = input && Number.isInteger(input.maxTokens) && input.maxTokens > 0
      ? Math.min(4096, input.maxTokens) : 1500;
    const purpose = input && typeof input.purpose === 'string' ? input.purpose.slice(0, 100) : 'general';

    const order = await getProviderOrder(env);
    let sawQuota = false;
    for (const id of order) {
      const provider = providerById(id);
      const generate = GENERATORS[id];
      if (!provider || !generate) continue;
      const model = provider.defaultModel;

      // Cap check BEFORE calling — a capped provider is never called.
      if (await isCapHit(env, id, model)) {
        sawQuota = true;
        providerStatuses.push({ id, name: provider.name, status: 'quota-exhausted', model, detail: 'Daily cap already reached — not called.' });
        await recordUsage(env, { provider: id, model, purpose, outcome: 'quota-exhausted', error: 'Daily cap reached before call.' });
        continue;
      }

      let result;
      try {
        result = await generate(env, { prompt, system, maxTokens });
      } catch (err) {
        result = { ok: false, reason: 'error', detail: String((err && err.message) ? err.message : err).slice(0, 300) };
      }
      if (!result || typeof result !== 'object') {
        result = { ok: false, reason: 'error', detail: 'Provider returned no result.' };
      }

      if (result.ok) {
        await recordUsage(env, {
          provider: id, model: result.model || model, purpose, outcome: 'ok',
          tokensIn: result.tokensIn || 0, tokensOut: result.tokensOut || 0,
          neurons: result.neurons || 0,
        });
        return {
          ok: true,
          text: String(result.text || '').trim(),
          provider: id,
          model: result.model || model,
          tokens: { in: Number(result.tokensIn || 0), out: Number(result.tokensOut || 0) },
          neurons: Number(result.neurons || 0),
          neuronsEstimated: !!result.neuronsEstimated,
          cached: false,
        };
      }

      const reason = result.reason === 'quota-exhausted' ? 'quota-exhausted'
        : result.reason === 'not-configured' ? 'not-configured' : 'error';
      if (reason === 'quota-exhausted') sawQuota = true;
      providerStatuses.push({
        id, name: provider.name,
        status: reason === 'quota-exhausted' ? 'quota-exhausted' : reason === 'not-configured' ? 'not-configured' : 'error',
        model, detail: result.detail || reason,
        ...(Array.isArray(result.retiredModels) && result.retiredModels.length
          ? { retiredModels: result.retiredModels } : {}),
      });
      await recordUsage(env, {
        provider: id, model, purpose,
        outcome: reason === 'quota-exhausted' ? 'quota-exhausted' : reason === 'not-configured' ? 'not-configured' : 'error',
        error: result.detail || reason,
      });
      // Fall through to the next provider in the order.
    }

    const anyConfigured = providerStatuses.some((s) => s.status !== 'not-configured');
    return {
      ok: false,
      reason: !anyConfigured ? 'all-providers-unavailable'
        : (sawQuota && providerStatuses.every((s) => s.status === 'quota-exhausted' || s.status === 'not-configured'))
          ? 'quota-exhausted' : 'all-providers-unavailable',
      providerStatuses,
      detail: !anyConfigured
        ? 'No LLM provider is configured: Workers AI binding is missing and no Groq/Gemini key is set.'
        : 'All configured LLM providers failed or are capped — generation paused.',
    };
  } catch (err) {
    return {
      ok: false, reason: 'error', providerStatuses,
      detail: String((err && err.message) ? err.message : err).slice(0, 300),
    };
  }
}
