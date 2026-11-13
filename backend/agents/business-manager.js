/**
 * FS AI — Business Manager.
 * Coordinates the 14-agent operational Business Management System:
 * Central Business Manager, Research, Content Creation, Fact-Checking, SEO,
 * Publishing, Facebook Marketing, YouTube Management, Pinterest Marketing,
 * Newsletter Management, Traffic Growth, Analytics, Monetization,
 * Security & Monitoring.
 * Features: pause/resume/disable per agent, daily task queue, activity log,
 * and an owner-approval gate — nothing publishes without the owner's approval.
 */
import { AGENT_REGISTRY } from './registry.js';

export const OPERATIONAL_AGENTS = [
  'Central Business Manager', 'Research', 'Content Creation', 'Fact-Checking',
  'SEO', 'Publishing', 'Facebook Marketing', 'YouTube Management',
  'Pinterest Marketing', 'Newsletter Management', 'Traffic Growth',
  'Analytics', 'Monetization', 'Security & Monitoring',
];

// In-memory operational state. When env.DB is bound, pause/resume/disable
// and the activity log are also persisted to D1 (see persistState).
export const systemState = {
  agents: Object.fromEntries(OPERATIONAL_AGENTS.map((name) => [name, { name, status: 'active' }])),
  queue: [],
  activityLog: [],
};

export function getSystemStatus() {
  const agents = Object.values(systemState.agents);
  return {
    totalAgents: OPERATIONAL_AGENTS.length,
    active: agents.filter((a) => a.status === 'active').length,
    paused: agents.filter((a) => a.status === 'paused').length,
    disabled: agents.filter((a) => a.status === 'disabled').length,
    queuedTasks: systemState.queue.filter((t) => t.status === 'queued').length,
    agents,
  };
}

export function logActivity(action, detail, actor = 'system') {
  const entry = { at: new Date().toISOString(), actor, action, detail: String(detail).slice(0, 500) };
  systemState.activityLog.unshift(entry);
  if (systemState.activityLog.length > 500) systemState.activityLog.length = 500;
  return entry;
}

export async function persistState(env, entry) {
  if (!env || !env.DB || !entry) return false;
  try {
    // agent_activity_logs is the real audit table (schema.sql §13). The
    // old `activity_log` table never existed, so this insert used to fail
    // silently on every call.
    await env.DB.prepare(
      'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(null, entry.action, 'system', JSON.stringify({ actor: entry.actor, detail: entry.detail }), 'success', entry.at).run();
    return true;
  } catch {
    return false; // D1 table may not exist yet in a fresh DB; in-memory log remains.
  }
}

// Persist an agent's pause/resume/disable state to D1 ai_agents so a
// Worker restart keeps it. status is the source of truth
// ('active' | 'paused' | 'disabled', migration 004); is_active mirrors it
// (1 only when active). The seed slug for Digital Tools is
// 'digital-tools-agent' while the registry id is 'digital-tools', so the
// lookup tries slug first, then the registry name.
export async function persistAgentStatus(env, idOrName, status) {
  if (!env || !env.DB) return false;
  try {
    const registry = AGENT_REGISTRY.find((a) => a.id === idOrName) || null;
    const slug = registry ? registry.id : idOrName;
    const name = registry ? registry.name : idOrName;
    const { results } = await env.DB.prepare(
      'SELECT id FROM ai_agents WHERE slug = ? OR name = ? LIMIT 1'
    ).bind(slug, name).all();
    const row = results && results[0];
    if (!row) return false;
    await env.DB.prepare(
      'UPDATE ai_agents SET is_active = ?, status = ?, updated_at = ? WHERE id = ?'
    ).bind(status === 'active' ? 1 : 0, status, new Date().toISOString(), row.id).run();
    return true;
  } catch {
    return false;
  }
}

async function setAgentStatus(name, status, env) {
  const agent = systemState.agents[name];
  if (!agent) return { ok: false, error: `Unknown operational agent: ${name}` };
  agent.status = status;
  const entry = logActivity(`agent-${status}`, `${name} → ${status}`, 'owner');
  if (env) {
    void persistState(env, entry);
    // Persist to the D1 ai_agents row as well, under the registry id when
    // this operational name maps to one (operational names such as
    // 'Central Business Manager' match neither the D1 slug nor the name).
    const registryId = OPERATIONAL_TO_REGISTRY[name]
      || (AGENT_REGISTRY.some((a) => a.id === name) ? name : null);
    if (registryId) await persistAgentStatus(env, registryId, status);
    else await persistAgentStatus(env, name, status);
  }
  return { ok: true, agent: { ...agent } };
}

// Operational name -> registry id (inverse of the map in
// resolveOperationalName). Used so pause/resume/disable persist to D1
// even when the caller used the operational name.
const OPERATIONAL_TO_REGISTRY = {
  'Central Business Manager': 'business-manager',
  'Content Creation': 'content-creation',
  'Fact-Checking': 'fact-checking',
  'SEO': 'seo',
  'Publishing': 'publishing',
  'Analytics': 'analytics',
  'Monetization': 'monetization',
  'Security & Monitoring': 'security',
};

export async function pauseAgent(idOrName, env) {
  const name = resolveOperationalName(idOrName);
  if (!name) return { ok: false, error: `Unknown agent: ${idOrName}` };
  return setAgentStatus(name, 'paused', env);
}

export async function resumeAgent(idOrName, env) {
  const name = resolveOperationalName(idOrName);
  if (!name) return { ok: false, error: `Unknown agent: ${idOrName}` };
  return setAgentStatus(name, 'active', env);
}

export async function disableAgent(idOrName, env) {
  const name = resolveOperationalName(idOrName);
  if (!name) return { ok: false, error: `Unknown agent: ${idOrName}` };
  return setAgentStatus(name, 'disabled', env);
}

export function resolveOperationalName(idOrName) {
  if (systemState.agents[idOrName]) return idOrName;
  const byRegistry = AGENT_REGISTRY.find((a) => a.id === idOrName);
  if (byRegistry) {
    // Map registry ids to operational names where they match.
    const map = {
      'business-manager': 'Central Business Manager',
      'content-creation': 'Content Creation',
      'fact-checking': 'Fact-Checking',
      'seo': 'SEO',
      'publishing': 'Publishing',
      'analytics': 'Analytics',
      'monetization': 'Monetization',
      'security': 'Security & Monitoring',
    };
    if (map[idOrName]) return map[idOrName];
  }
  return null;
}

export function enqueueTask(agent, task, payload = {}) {
  if (!systemState.agents[agent]) return { ok: false, error: `Unknown operational agent: ${agent}` };
  if (systemState.agents[agent].status !== 'active') {
    return { ok: false, error: `Agent ${agent} is ${systemState.agents[agent].status} — task not queued.` };
  }
  const item = {
    id: `task-${Date.now().toString(36)}-${systemState.queue.length}`,
    agent, task: String(task).slice(0, 300), payload,
    status: 'queued', createdAt: new Date().toISOString(),
  };
  systemState.queue.push(item);
  logActivity('task-queued', `${agent}: ${task}`);
  return { ok: true, task: item };
}

export function nextTask(agent) {
  const item = systemState.queue.find((t) => t.agent === agent && t.status === 'queued');
  if (!item) return null;
  item.status = 'in-progress';
  item.startedAt = new Date().toISOString();
  return item;
}

export function completeTask(taskId, result) {
  const item = systemState.queue.find((t) => t.id === taskId);
  if (!item) return { ok: false, error: 'Task not found' };
  item.status = 'done';
  item.result = result;
  item.completedAt = new Date().toISOString();
  logActivity('task-done', `${item.agent}: ${item.task}`);
  return { ok: true, task: item };
}

export function dailyPlan() {
  // The daily run: research → draft → fact-check → SEO → owner approval →
  // publish (only if approved) → marketing drafts → analytics report.
  return [
    { order: 1, agent: 'Research', task: 'Research one topic per division with sources' },
    { order: 2, agent: 'Content Creation', task: 'Draft article from the sourced brief' },
    { order: 3, agent: 'Fact-Checking', task: 'Verify every factual claim' },
    { order: 4, agent: 'SEO', task: 'Meta, keywords and readability check' },
    { order: 5, agent: 'Central Business Manager', task: 'Submit draft to owner for approval — STOP here until approved' },
    { order: 6, agent: 'Publishing', task: 'Publish only owner-approved content' },
    { order: 7, agent: 'Facebook Marketing', task: 'Prepare (do not post) a Facebook draft' },
    { order: 8, agent: 'YouTube Management', task: 'Prepare a video outline draft' },
    { order: 9, agent: 'Pinterest Marketing', task: 'Prepare a pin draft' },
    { order: 10, agent: 'Newsletter Management', task: 'Prepare a newsletter draft' },
    { order: 11, agent: 'Traffic Growth', task: 'Review honest traffic report (Data unavailable until Analytics connects)' },
    { order: 12, agent: 'Analytics', task: 'Report honest figures only' },
    { order: 13, agent: 'Monetization', task: 'Report honest $0.00 revenue until AdSense connects' },
    { order: 14, agent: 'Security & Monitoring', task: 'Review audit log and errors' },
  ];
}

export function ownerApprovalGate(item) {
  // The hard gate: no item reaches Publishing without owner approval.
  if (!item || item.ownerApproval !== 'approved') {
    return { ok: false, error: 'Owner approval required before publishing. Item is held, not published.' };
  }
  return { ok: true };
}
