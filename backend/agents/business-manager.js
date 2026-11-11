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
    await env.DB.prepare(
      'INSERT INTO activity_log (at, actor, action, detail) VALUES (?, ?, ?, ?)'
    ).bind(entry.at, entry.actor, entry.action, entry.detail).run();
    return true;
  } catch {
    return false; // D1 table may not exist yet in a fresh DB; in-memory log remains.
  }
}

function setAgentStatus(name, status, env) {
  const agent = systemState.agents[name];
  if (!agent) return { ok: false, error: `Unknown operational agent: ${name}` };
  agent.status = status;
  const entry = logActivity(`agent-${status}`, `${name} → ${status}`, 'owner');
  if (env) void persistState(env, entry);
  return { ok: true, agent: { ...agent } };
}

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
