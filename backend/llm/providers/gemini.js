/**
 * FS AI — Google Gemini API provider (fallback, HTTP API).
 *
 * Free tier exists — Gemini 3.8/3.6 Flash, 3.5/3.1 Flash-Lite, 2.5
 * Pro/Flash listed 'Free of charge' for input+output, no billing
 * account needed (official Gemini API pricing, Oct 2026). Rate limits
 * are per-project and shown in AI Studio, not published as fixed
 * numbers; the caps enforced here (Flash ~20 RPD, Flash-Lite ~500 RPD)
 * are third-party REPORTED figures, not promised limits. Needs a free
 * API key from Google AI Studio in the GEMINI_API_KEY secret — no key
 * exists today, so the provider reports 'not-configured' until the
 * owner creates one. Note from Google's docs: free-tier data may be
 * used to improve Google's products. The key travels only in the
 * request query string (how Google's API takes it) and is never logged.
 */
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

function endpointFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function errText(err) {
  return String((err && err.message) ? err.message : err || '').slice(0, 300);
}

/**
 * Returns { ok: true, text, provider, model, tokensIn, tokensOut,
 * neurons: 0 } or { ok: false, reason, detail } — 'not-configured'
 * (no key, or 400/401: configuration error), 'quota-exhausted' (429)
 * or 'error'. Never throws.
 */
export async function generateWithGemini(env, { prompt, system, maxTokens }) {
  const key = env && typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!key) {
    return {
      ok: false, reason: 'not-configured',
      detail: 'Gemini API key is not set — the owner must create a free API key in Google AI Studio and add the GEMINI_API_KEY secret (no billing account needed).',
    };
  }
  let lastError = '';
  for (const model of GEMINI_MODELS) {
    try {
      const body = {
        contents: [{ parts: [{ text: String(prompt || '') }] }],
        generationConfig: { maxOutputTokens: Math.max(1, Math.min(8192, Number(maxTokens) || 1500)) },
      };
      if (system) body.systemInstruction = { parts: [{ text: String(system) }] };
      const res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        return {
          ok: false, reason: 'quota-exhausted',
          detail: 'Gemini free-tier quota reached (429). Limits are per-project and shown in AI Studio.',
        };
      }
      if (res.status === 400 || res.status === 401) {
        return {
          ok: false, reason: 'not-configured',
          detail: `Gemini request rejected (HTTP ${res.status}) — check the GEMINI_API_KEY secret and the model name. This is a configuration error.`,
        };
      }
      if (!res.ok) {
        lastError = `Gemini HTTP ${res.status} for model ${model}.`;
        continue;
      }
      const data = await res.json().catch(() => null);
      const parts = data && Array.isArray(data.candidates) && data.candidates[0]
        && data.candidates[0].content && Array.isArray(data.candidates[0].content.parts)
        ? data.candidates[0].content.parts : [];
      const text = parts
        .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
        .join('').trim();
      if (!text) {
        lastError = `Gemini model ${model} returned an empty response.`;
        continue;
      }
      const usage = (data && data.usageMetadata) || {};
      return {
        ok: true, text, provider: 'gemini', model,
        tokensIn: Number(usage.promptTokenCount || 0),
        tokensOut: Number(usage.candidatesTokenCount || 0),
        neurons: 0,
      };
    } catch (err) {
      lastError = errText(err);
      continue;
    }
  }
  return {
    ok: false, reason: 'error',
    detail: lastError ? `All Gemini models failed. Last error: ${lastError}` : 'All Gemini models failed.',
  };
}
