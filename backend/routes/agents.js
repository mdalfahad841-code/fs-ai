/**
 * FS AI — Agents route (owner-only; worker.js enforces requireOwner).
 *
 *   GET  /api/agents                registry merged with D1 ai_agents
 *         (is_active/status) + latest agent_activity_logs row per agent
 *         + the system emergency_stop flag.
 *   GET  /api/agents/status         system summary.
 *   GET  /api/agents/:id             one merged agent.
 *   GET  /api/agents/:id/logs        last 50 activity rows for the agent.
 *   POST /api/agents/:id/run         run the agent once (see
 *         backend/agents/runner.js for the honest per-agent behaviour).
 *         423 while the Emergency Stop is on; 409 when the agent is
 *         paused/disabled; 503 without D1. Every run writes an
 *         automation_jobs row and an agent_activity_logs row.
 *   POST /api/agents/:id/pause|resume|disable
 *         persisted to D1 ai_agents (status + is_active) so a Worker
 *         restart keeps the state; the in-memory operational state in
 *         business-manager.js is updated alongside it.
 *
 * No agent publishes, posts, spends money or connects an account on its
 * own — publishing always needs owner approval, and money is never spent.
 */
import { jsonOk, jsonError, d1All, d1First, d1Run, nowIso } from '../middleware/validation.js';
import { AGENT_REGISTRY, getAgent } from '../agents/registry.js';
import {
  getSystemStatus, pauseAgent, resumeAgent, disableAgent,
  persistAgentStatus, logActivity, persistState,
} from '../agents/business-manager.js';
import { runAgent } from '../agents/runner.js';
import { getEmergencyStop } from './admin.js';

// The seed slug for Digital Tools is 'digital-tools-agent' while the
// registry id is 'digital-tools': match a D1 agent row by slug OR name.
async function findDbAgent(env, registryId) {
  if (!env.DB) return null;
  const agent = getAgent(registryId);
  const slug = registryId;
  const name = agent ? agent.name : registryId;
  return d1First(env, 'SELECT * FROM ai_agents WHERE slug = ? OR name = ? LIMIT 1', [slug, name]);
}

function effectiveStatus(dbRow) {
  if (!dbRow) return 'active';
  if (typeof dbRow.status === 'string' && dbRow.status) return dbRow.status;
  return dbRow.is_active ? 'active' : 'disabled';
}

async function mergedAgents(env) {
  let dbRows = [];
  let latestLogs = [];
  if (env.DB) {
    dbRows = (await d1All(env, 'SELECT * FROM ai_agents ORDER BY id ASC')) || [];
    latestLogs = (await d1All(env,
      'SELECT * FROM agent_activity_logs ORDER BY created_at DESC, id DESC LIMIT 200')) || [];
  }
  const bySlug = new Map();
  const byName = new Map();
  for (const row of dbRows) {
    bySlug.set(row.slug, row);
    byName.set(row.name, row);
  }
  const latestByAgentId = new Map();
  for (const log of latestLogs) {
    if (log.agent_id !== null && log.agent_id !== undefined && !latestByAgentId.has(log.agent_id)) {
      latestByAgentId.set(log.agent_id, log);
    }
  }
  return AGENT_REGISTRY.map((agent) => {
    const dbRow = bySlug.get(agent.id) || byName.get(agent.name) || null;
    const status = effectiveStatus(dbRow);
    const lastLog = dbRow ? latestByAgentId.get(dbRow.id) : null;
    let lastRun = null;
    if (lastLog) {
      let details = lastLog.details;
      try { details = JSON.parse(lastLog.details); } catch { /* keep raw text */ }
      lastRun = { action: lastLog.action, status: lastLog.status, createdAt: lastLog.created_at, details };
    }
    return {
      ...agent,
      status,
      isActive: status === 'active',
      dbId: dbRow ? dbRow.id : null,
      lastRun,
    };
  });
}

async function agentControlAction(id, action, env) {
  const agent = getAgent(id);
  if (!agent) return jsonError('Agent not found', 404);
  const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'disabled';
  // 1. In-memory operational state (only the 8 mapped agents have one).
  const bm = action === 'pause'
    ? await pauseAgent(id, env)
    : action === 'resume' ? await resumeAgent(id, env) : await disableAgent(id, env);
  // 2. Direct D1 persistence for every registry agent — this is what
  //    survives a Worker restart, and it covers research agents, which
  //    have no operational-name entry in business-manager.js.
  let persisted = false;
  if (env.DB) persisted = await persistAgentStatus(env, id, status);
  if (!bm.ok) {
    const entry = logActivity(`agent-${status}`, `${agent.name} → ${status}`, 'owner');
    if (env) void persistState(env, entry);
  }
  return jsonOk({ ok: true, agent: { id, name: agent.name, status }, persisted, source: env.DB ? 'd1' : 'memory' });
}

async function runAgentOnce(request, env, id) {
  const agent = getAgent(id);
  if (!agent) return jsonError('Agent not found', 404);
  if (!env.DB) return jsonError('Agent runs require the D1 database', 503);

  const dbRow = await findDbAgent(env, id);
  const agentDbId = dbRow ? dbRow.id : null;

  async function logRun(action, details, status) {
    await d1Run(env,
      'INSERT INTO agent_activity_logs (agent_id, action, entity_type, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [agentDbId, action, 'job', JSON.stringify(details), status, nowIso()]).catch(() => {});
  }

  if (await getEmergencyStop(env)) {
    await logRun('run', { agent: id, outcome: 'skipped', reason: 'Emergency Stop is on.' }, 'skipped');
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423);
  }

  const status = effectiveStatus(dbRow);
  if (status !== 'active') {
    await logRun('run', { agent: id, outcome: 'skipped', reason: `Agent is ${status}.` }, 'skipped');
    return jsonError(`Agent is ${status} — resume it before running.`, 409);
  }

  const now = nowIso();
  const job = await d1Run(env,
    'INSERT INTO automation_jobs (name, job_type, agent_id, status, scheduled_at, started_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`${id} manual run`, 'manual_run', agentDbId, 'running', now, now, JSON.stringify({ agent: id, triggeredBy: 'owner' }), now]);
  const jobId = job && job.meta ? job.meta.last_row_id : null;

  let result;
  let runStatus = 'completed';
  try {
    result = await runAgent(id, env);
  } catch (err) {
    runStatus = 'failed';
    result = { outcome: 'failed', agent: id, error: String(err && err.message ? err.message : err).slice(0, 300) };
  }
  if (jobId) {
    await d1Run(env, 'UPDATE automation_jobs SET status = ?, result = ?, finished_at = ? WHERE id = ?',
      [runStatus, JSON.stringify(result), nowIso(), jobId]);
  }
  await logRun('run', { agent: id, jobId, ...result }, runStatus === 'completed' ? 'success' : 'failed');
  return jsonOk({ ok: true, agent: id, job: { id: jobId, status: runStatus }, result });
}

export async function handleAgents(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // api, agents, [id], [action]

  if (method === 'GET' && parts.length === 2) {
    const agents = await mergedAgents(env);
    const emergencyStop = await getEmergencyStop(env);
    const system = getSystemStatus();
    system.emergencyStop = emergencyStop;
    system.active = agents.filter((a) => a.status === 'active').length;
    system.paused = agents.filter((a) => a.status === 'paused').length;
    system.disabled = agents.filter((a) => a.status === 'disabled').length;
    system.totalAgents = agents.length;
    return jsonOk({ agents, system, emergencyStop, owner: auth.owner || 'owner', source: env.DB ? 'd1' : 'fallback' });
  }

  if (method === 'GET' && parts.length === 3 && parts[2] === 'status') {
    const agents = await mergedAgents(env);
    const emergencyStop = await getEmergencyStop(env);
    const system = getSystemStatus();
    system.emergencyStop = emergencyStop;
    system.active = agents.filter((a) => a.status === 'active').length;
    system.paused = agents.filter((a) => a.status === 'paused').length;
    system.disabled = agents.filter((a) => a.status === 'disabled').length;
    system.totalAgents = agents.length;
    return jsonOk({ system, emergencyStop });
  }

  if (method === 'GET' && parts.length === 4 && parts[3] === 'logs') {
    const agent = getAgent(decodeURIComponent(parts[2]));
    if (!agent) return jsonError('Agent not found', 404);
    if (!env.DB) return jsonOk({ agent: agent.id, logs: [], total: 0, source: 'fallback', note: 'Activity logs require the D1 database.' });
    const dbRow = await findDbAgent(env, agent.id);
    if (!dbRow) return jsonOk({ agent: agent.id, logs: [], total: 0, source: 'd1' });
    const logs = await d1All(env,
      'SELECT * FROM agent_activity_logs WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [dbRow.id]);
    return jsonOk({ agent: agent.id, logs: logs || [], total: (logs || []).length, source: 'd1' });
  }

  if (method === 'GET' && parts.length === 3) {
    const agent = getAgent(decodeURIComponent(parts[2]));
    if (!agent) return jsonError('Agent not found', 404);
    const agents = await mergedAgents(env);
    return jsonOk({ agent: agents.find((a) => a.id === agent.id) });
  }

  if (method === 'POST' && parts.length === 4) {
    const id = decodeURIComponent(parts[2]);
    const action = decodeURIComponent(parts[3]);
    if (action === 'run') return runAgentOnce(request, env, id);
    if (action === 'pause') return agentControlAction(id, 'pause', env);
    if (action === 'resume') return agentControlAction(id, 'resume', env);
    if (action === 'disable') return agentControlAction(id, 'disable', env);
    return jsonError('Unknown agent action', 400);
  }

  return jsonError('Method not allowed', 405);
}
