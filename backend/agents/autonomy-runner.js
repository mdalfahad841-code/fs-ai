/**
 * FS AI — Autonomy runner.
 *
 * Dispatches a queued agent_tasks row to the handler for its queue agent
 * id and returns a real result ({ outcome: 'done'|'no-op'|'failed', ... }).
 * Handlers do real work against D1/fetch and never fake a success; any
 * thrown error becomes a 'failed' outcome here.
 *
 * Queue agent ids (10 functional roles) mapped honestly to the 16-agent
 * registry (backend/agents/registry.js):
 *   research          = the 7 division research agents collectively
 *                       (automotive/technology/gadget/finance/travel/
 *                        health/education-research) — no single registry id.
 *   content-creation  = content-creation (1:1)
 *   fact-checking     = fact-checking (1:1)
 *   seo               = seo (1:1)
 *   publishing        = publishing (1:1)
 *   social-media      = NO registry agent (preparation only — never posts)
 *   traffic-growth    = NO registry agent (gap analysis only)
 *   analytics         = analytics (1:1)
 *   monetization      = monetization (1:1)
 *   security-monitoring = security (1:1)
 */
import { runResearch } from './autonomy/research.js';
import { runContentCreation } from './autonomy/content.js';
import { runFactChecking } from './autonomy/factcheck.js';
import { runSeo } from './autonomy/seo.js';
import { runPublishing } from './autonomy/publishing.js';
import { runSocialMedia } from './autonomy/social.js';
import { runTrafficGrowth } from './autonomy/traffic.js';
import { runAnalytics } from './autonomy/analytics.js';
import { runMonetization } from './autonomy/monetization.js';
import { runSecurityMonitoring } from './autonomy/security.js';

export const QUEUE_AGENTS = [
  'research',
  'content-creation',
  'fact-checking',
  'seo',
  'publishing',
  'social-media',
  'traffic-growth',
  'analytics',
  'monetization',
  'security-monitoring',
];

// Queue agent id -> registry agent id, or null where no registry agent
// exists (research is collective; social-media / traffic-growth have none).
export const QUEUE_TO_REGISTRY = {
  research: null,
  'content-creation': 'content-creation',
  'fact-checking': 'fact-checking',
  seo: 'seo',
  publishing: 'publishing',
  'social-media': null,
  'traffic-growth': null,
  analytics: 'analytics',
  monetization: 'monetization',
  'security-monitoring': 'security',
};

const HANDLERS = {
  research: runResearch,
  'content-creation': runContentCreation,
  'fact-checking': runFactChecking,
  seo: runSeo,
  publishing: runPublishing,
  'social-media': runSocialMedia,
  'traffic-growth': runTrafficGrowth,
  analytics: runAnalytics,
  monetization: runMonetization,
  'security-monitoring': runSecurityMonitoring,
};

function normaliseTask(task) {
  const copy = { ...(task || {}) };
  if (typeof copy.payload === 'string') {
    try { copy.payload = JSON.parse(copy.payload); } catch { copy.payload = {}; }
  }
  if (!copy.payload || typeof copy.payload !== 'object') copy.payload = {};
  return copy;
}

export async function runAutonomyTask(task, env) {
  const normalised = normaliseTask(task);
  const handler = HANDLERS[normalised.agent];
  if (!handler) {
    return { outcome: 'failed', agent: normalised.agent || null, error: `Unknown autonomy agent: ${String(normalised.agent || '')}.` };
  }
  try {
    const result = await handler(normalised, env);
    if (!result || typeof result !== 'object') return { outcome: 'failed', error: 'Handler returned no result.' };
    const outcome = result.outcome === 'done' || result.outcome === 'no-op' || result.outcome === 'failed'
      ? result.outcome
      : 'failed';
    return { ...result, outcome, agent: normalised.agent };
  } catch (err) {
    return {
      outcome: 'failed',
      agent: normalised.agent,
      error: String(err && err.message ? err.message : err).slice(0, 300),
    };
  }
}
