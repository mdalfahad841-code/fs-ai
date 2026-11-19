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

// Division slug -> registry research agent id. The research queue agent
// is collective, so pausing a division's research agent must still make
// that division's queued research tasks skip — runTask resolves the
// division from the task payload through this map (see scheduler.js).
// Digital Tools has no division research agent: its research is covered
// by the Tools agent (digital-tools-agent), so it has no entry here and
// a paused Tools agent does not block digital-tools research.
export const DIVISION_RESEARCH_REGISTRY = {
  automotive: 'automotive-research',
  'ai-technology': 'technology-research',
  'gadgets-electronics': 'gadget-research',
  'finance-money': 'finance-research',
  'travel-lifestyle': 'travel-research',
  'health-wellness': 'health-research',
  'education-learning': 'education-research',
};

/** Resolve the registry agent id that governs a task (for pause checks). */
export function registryIdForTask(task) {
  if (!task || typeof task !== 'object') return null;
  if (task.agent === 'research') {
    let division = null;
    try {
      const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
      division = payload && typeof payload.division === 'string' ? payload.division : null;
    } catch { division = null; }
    // A division-specific research task is governed by its division agent;
    // a division-less research task (all divisions) is governed by all of
    // them only when every one is paused — the scheduler checks that case
    // separately via DIVISION_RESEARCH_REGISTRY.
    return division ? (DIVISION_RESEARCH_REGISTRY[division] || null) : null;
  }
  return QUEUE_TO_REGISTRY[task.agent] || null;
}

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
