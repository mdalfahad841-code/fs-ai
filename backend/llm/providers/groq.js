/**
 * FS AI — Groq provider (fallback, OpenAI-compatible HTTP API).
 *
 * Free plan, no card: openai/gpt-oss-120b and openai/gpt-oss-20b at
 * 30 RPM, 1,000 RPD, 8K TPM, 200K TPD (official Groq rate-limits
 * page, as read Oct-Nov 2026). Llama models left the free tier
 * 16 Aug 2026 (Enterprise-only) and are NOT listed here. Needs a free
 * GroqCloud API key in the GROQ_API_KEY secret — no key exists today,
 * so the provider reports 'not-configured' until the owner creates one.
 * The key is read only from env and is never logged.
 */
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

function errText(err) {
  return String((err && err.message) ? err.message : err || '').slice(0, 300);
}

/**
 * Returns { ok: true, text, provider, model, tokensIn, tokensOut,
 * neurons: 0 } (Groq bills tokens, not Neurons — usage.js caps it by
 * tokens) or { ok: false, reason, detail } — 'not-configured' (no key,
 * or 401: bad/missing key — a configuration error, never retried in a
 * loop), 'quota-exhausted' (429, with Retry-After when the server
 * sends one) or 'error'. Never throws.
 */
export async function generateWithGroq(env, { prompt, system, maxTokens }) {
  const key = env && typeof env.GROQ_API_KEY === 'string' ? env.GROQ_API_KEY.trim() : '';
  if (!key) {
    return {
      ok: false, reason: 'not-configured',
      detail: 'Groq API key is not set — the owner must create a free GroqCloud account and add the GROQ_API_KEY secret (no card required).',
    };
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(prompt || '') });
  let lastError = '';
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: Math.max(1, Math.min(4096, Number(maxTokens) || 1500)),
          temperature: 0.7,
        }),
      });
      if (res.status === 429) {
        const retryAfter = res.headers ? res.headers.get('Retry-After') : null;
        return {
          ok: false, reason: 'quota-exhausted',
          detail: `Groq rate limit reached (429)${retryAfter ? ` — retry after ${retryAfter}s` : ''}. Free tier: 200,000 tokens/day.`,
        };
      }
      if (res.status === 401) {
        return {
          ok: false, reason: 'not-configured',
          detail: 'Groq API key was rejected (401) — check the GROQ_API_KEY secret. This is a configuration error, not a quota problem.',
        };
      }
      if (!res.ok) {
        lastError = `Groq HTTP ${res.status} for model ${model}.`;
        continue;
      }
      const data = await res.json().catch(() => null);
      const text = data && Array.isArray(data.choices) && data.choices[0]
        && data.choices[0].message && typeof data.choices[0].message.content === 'string'
        ? data.choices[0].message.content.trim() : '';
      if (!text) {
        lastError = `Groq model ${model} returned an empty response.`;
        continue;
      }
      const usage = (data && data.usage) || {};
      return {
        ok: true, text, provider: 'groq', model,
        tokensIn: Number(usage.prompt_tokens || 0),
        tokensOut: Number(usage.completion_tokens || 0),
        neurons: 0,
      };
    } catch (err) {
      lastError = errText(err);
      continue;
    }
  }
  return {
    ok: false, reason: 'error',
    detail: lastError ? `All Groq models failed. Last error: ${lastError}` : 'All Groq models failed.',
  };
}
