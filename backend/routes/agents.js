/**
 * FS AI — Agents route (owner-only; worker.js enforces requireOwner).
 * Read-only status views plus pause/resume/disable commands, which are
 * delegated to business-manager.js. No agent publishes without owner approval.
 */
import { jsonOk, jsonError } from '../middleware/validation.js';
import { AGENT_REGISTRY, getAgent } from '../agents/registry.js';
import { getSystemStatus, pauseAgent, resumeAgent, disableAgent } from '../agents/business-manager.js';

export async function handleAgents(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // api, agents, [id], [action]

  if (method === 'GET' && parts.length === 2) {
    return jsonOk({ agents: AGENT_REGISTRY, system: getSystemStatus(), owner: auth.owner || 'owner' });
  }

  if (method === 'GET' && parts.length === 3) {
    const agent = getAgent(decodeURIComponent(parts[2]));
    if (!agent) return jsonError('Agent not found', 404);
    return jsonOk({ agent });
  }

  if (method === 'POST' && parts.length === 4) {
    const id = decodeURIComponent(parts[2]);
    const action = decodeURIComponent(parts[3]);
    if (action === 'pause') return jsonOk(await pauseAgent(id, env));
    if (action === 'resume') return jsonOk(await resumeAgent(id, env));
    if (action === 'disable') return jsonOk(await disableAgent(id, env));
    return jsonError('Unknown agent action', 400);
  }

  if (method === 'GET' && parts.length === 3 && parts[2] === 'status') {
    return jsonOk({ system: getSystemStatus() });
  }

  return jsonError('Method not allowed', 405);
}
