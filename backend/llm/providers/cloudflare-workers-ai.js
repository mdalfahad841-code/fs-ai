/**
 * FS AI — Workers AI provider (Cloudflare Workers AI, primary LLM).
 *
 * No API key: the Worker calls it through the AI binding (env.AI).
 * Free tier: 10,000 Neurons/day, resets 00:00 UTC; on Workers Free an
 * over-cap request fails (no billing, no card). Error 3036 = free
 * allowance used up; 410 / 5028 = model retired (24 models are removed
 * on 20 Nov 2026 — the model list below contains only models that
 * survive that removal, per the official pricing page updated
 * 2026-11-12). Neuron rates are per 1M tokens, from the same page.
 */
export const WORKERS_AI_MODELS = [
  '@cf/openai/gpt-oss-20b',
  '@cf/openai/gpt-oss-120b',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/zai-org/glm-4.7-flash',
];

// Neurons per 1M tokens { in, out } — official Workers AI pricing page.
export const NEURON_RATES = {
  '@cf/openai/gpt-oss-20b': { in: 18182, out: 27273 },
  '@cf/openai/gpt-oss-120b': { in: 31818, out: 68182 },
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': { in: 4119, out: 34868 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 26668, out: 204805 },
  '@cf/qwen/qwen3.8-27b': { in: 40909, out: 290909 },
  '@cf/google/gemma-4-26b-a4b-it': { in: 9091, out: 27273 },
  '@cf/zai-org/glm-4.7-flash': { in: 5500, out: 36400 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 31876, out: 50488 },
};

export function estimateNeurons(model, tokensIn, tokensOut) {
  const rate = NEURON_RATES[model];
  if (!rate) return 0;
  return Math.max(0, Math.round(
    (Number(tokensIn || 0) * rate.in + Number(tokensOut || 0) * rate.out) / 1000000,
  ));
}

// Rough token estimate (~4 chars per token) used only when the response
// carries no usage block; the resulting neuron figure is marked estimated.
function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function errText(err) {
  return String((err && (err.message || err.code)) ? (err.message || err.code) : err || '').slice(0, 300);
}

function isQuotaError(err) {
  const t = errText(err);
  return /3036|allowance|quota|exceeded/i.test(t);
}

function isRetiredError(err) {
  const t = errText(err);
  return /5028|410|gone|retired|removed|not found|unknown model/i.test(t);
}

function extractText(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  if (typeof result.response === 'string') return result.response;
  if (Array.isArray(result.choices) && result.choices[0]) {
    const c = result.choices[0];
    if (c.message && typeof c.message.content === 'string') return c.message.content;
    if (typeof c.text === 'string') return c.text;
  }
  if (typeof result.text === 'string') return result.text;
  return '';
}

function extractUsage(result) {
  const u = (result && typeof result === 'object' && result.usage && typeof result.usage === 'object')
    ? result.usage
    : {};
  const tokensIn = u.prompt_tokens ?? u.input_tokens ?? null;
  const tokensOut = u.completion_tokens ?? u.output_tokens ?? null;
  return {
    tokensIn: tokensIn === null ? null : Number(tokensIn),
    tokensOut: tokensOut === null ? null : Number(tokensOut),
  };
}

/**
 * Tries the surviving free models in order. Returns
 * { ok: true, text, provider, model, tokensIn, tokensOut, neurons,
 *   neuronsEstimated } on success, or { ok: false, reason, detail,
 *   retiredModels } — reason is 'not-configured' (no env.AI binding),
 * 'quota-exhausted' (error 3036 — account-wide daily cap, no point
 * trying further models) or 'error'. Never throws.
 */
export async function generateWithWorkersAI(env, { prompt, system, maxTokens }) {
  if (!env || !env.AI || typeof env.AI.run !== 'function') {
    return {
      ok: false, reason: 'not-configured',
      detail: 'Workers AI binding (env.AI) is not bound — add [ai] binding = "AI" to config/wrangler.toml and redeploy the Worker.',
    };
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(prompt || '') });
  const retiredModels = [];
  let lastError = '';
  for (const model of WORKERS_AI_MODELS) {
    try {
      const result = await env.AI.run(model, {
        messages,
        max_tokens: Math.max(1, Math.min(4096, Number(maxTokens) || 1500)),
      });
      const text = extractText(result).trim();
      if (!text) {
        lastError = `Model ${model} returned an empty response.`;
        continue;
      }
      const usage = extractUsage(result);
      const tokensIn = usage.tokensIn === null || Number.isNaN(usage.tokensIn)
        ? estimateTokens((system || '') + '\n' + String(prompt || '')) : usage.tokensIn;
      const tokensOut = usage.tokensOut === null || Number.isNaN(usage.tokensOut)
        ? estimateTokens(text) : usage.tokensOut;
      const neuronsEstimated = usage.tokensIn === null || usage.tokensOut === null;
      return {
        ok: true, text, provider: 'workers-ai', model,
        tokensIn, tokensOut,
        neurons: estimateNeurons(model, tokensIn, tokensOut),
        neuronsEstimated,
        ...(retiredModels.length ? { retiredModels } : {}),
      };
    } catch (err) {
      lastError = errText(err);
      if (isQuotaError(err)) {
        return {
          ok: false, reason: 'quota-exhausted',
          detail: `Workers AI free allowance used up (error 3036): ${lastError}`,
          ...(retiredModels.length ? { retiredModels } : {}),
        };
      }
      if (isRetiredError(err)) {
        retiredModels.push(model);
        continue;
      }
      // Any other per-model failure: try the next model.
      continue;
    }
  }
  return {
    ok: false, reason: 'error',
    detail: lastError ? `All Workers AI models failed. Last error: ${lastError}` : 'All Workers AI models failed.',
    ...(retiredModels.length ? { retiredModels } : {}),
  };
}
