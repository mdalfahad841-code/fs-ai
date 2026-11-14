/**
 * FS AI — Autonomy orchestrator routes (owner-only; worker.js enforces
 * requireOwner before calling — auth is passed in and assumed valid).
 *
 *   GET  /api/autonomy/status
 *   GET  /api/autonomy/llm
 *   GET  /api/autonomy/tasks?status=&agent=&limit=
 *   POST /api/autonomy/tasks
 *   POST /api/autonomy/tasks/:id/run
 *   POST /api/autonomy/control            { action: start-all|pause-all|resume-all }
 *   GET  /api/autonomy/settings
 *   POST /api/autonomy/settings           { key, value }
 *   GET  /api/autonomy/reports?kind=&limit=
 *   POST /api/autonomy/reports/generate   { kind: daily|weekly } (snapshot only)
 *   GET  /api/autonomy/accounts
 *   POST /api/autonomy/run-daily
 *   POST /api/autonomy/scaffolds/:runId/convert
 *
 * All endpoints: 503 without D1, 400 on bad input, never invent data.
 * Revenue is $0.00 and traffic is 'Data unavailable' until a real source
 * exists. Nothing here publishes, posts, spends money or connects an
 * account on its own.
 */
import {
  jsonOk, jsonError, readJsonBody, nowIso, isValidSlug,
  d1All, d1First, d1Run,
} from '../middleware/validation.js';
import { getEmergencyStop, EMERGENCY_STOP_KEY } from './admin.js';
import { ACCOUNTS } from './accounts.js';
import { AGENT_REGISTRY } from '../agents/registry.js';
import { persistAgentStatus } from '../agents/business-manager.js';
import { QUEUE_AGENTS, QUEUE_TO_REGISTRY } from '../agents/autonomy-runner.js';
import { convertScaffoldToDraft } from '../agents/autonomy/content.js';
import { providerStatus, getProviderOrder } from '../llm/registry.js';
import {
  runTask, runDailyWorkflow, runWeeklyWorkflow, enqueueTask,
  generateReportSnapshot, normaliseTaskRow, todayStr,
} from './scheduler.js';

const RESEARCH_AGENT_IDS = [
  'automotive-research', 'technology-research', 'gadget-research',
  'finance-research', 'travel-research', 'health-research', 'education-research',
];

const ROLE_LABELS = {
  research: 'Research',
  'content-creation': 'Content Creation',
  'fact-checking': 'Fact-Checking',
  seo: 'SEO',
  publishing: 'Publishing',
  'social-media': 'Social Media',
  'traffic-growth': 'Traffic Growth',
  analytics: 'Analytics',
  monetization: 'Monetization',
  'security-monitoring': 'Security Monitoring',
};

// Six-state account truth table. Do not invent: these are the verified
// states from backend/routes/accounts.js (ACCOUNTS) as of 2026-11-14.
const ACCOUNT_STATES = {
  github: {
    states: { prepared: true, created: true, ownershipVerified: true, connected: true, apiAuthorized: false, publishingEnabled: false },
    note: 'Repo linked for deploys. No GitHub API token, no content-publishing API.',
  },
  youtube: {
    states: { prepared: true, created: true, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Profile exists (@FSAI-e5f). Ownership not proven, no API auth.',
  },
  pinterest: {
    states: { prepared: true, created: true, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Profile exists (watchwithf). Ownership not proven, no API auth.',
  },
  facebook: {
    states: { prepared: false, created: false, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Pending Owner Authorization — not created yet.',
  },
  'whatsapp-business': {
    states: { prepared: false, created: false, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Pending Owner Authorization — not created yet.',
  },
  'business-email': {
    states: { prepared: false, created: false, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Pending Owner Authorization — not created yet.',
  },
  'search-console': {
    states: { prepared: true, created: true, ownershipVerified: true, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Verification File Installed + Google Property Verified by owner 2026-11-11. No Search Console API connection.',
  },
  analytics: {
    states: { prepared: true, created: true, ownershipVerified: true, connected: true, apiAuthorized: false, publishingEnabled: false },
    note: 'Tracking Connected — Reporting API Not Connected.',
  },
  adsense: {
    states: { prepared: false, created: false, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Not created — needs real traffic.',
  },
  affiliate: {
    states: { prepared: false, created: false, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
    note: 'Not started — no program joined.',
  },
};

const SETTING_RULES = {
  autonomy_level: (v) => ['1', '2', '3'].includes(String(v)) ? null : "autonomy_level must be '1', '2' or '3'.",
  publishing_mode: (v) => String(v) === 'approved_only' ? null : "publishing_mode must be 'approved_only' — publishing always needs owner approval.",
  max_articles_per_day: (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 3 ? null : 'max_articles_per_day must be an integer from 0 to 3.';
  },
  social_auto_post: (v) => String(v) === 'off' ? null : "social_auto_post must be 'off' — auto-posting is not allowed (no social API auth exists).",
};

async function getSettings(env) {
  const rows = await d1All(env, 'SELECT key, value FROM autonomy_settings ORDER BY key ASC') || [];
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  return settings;
}

async function agentStatuses(env) {
  // Real registry-derived status from D1 ai_agents (status column is the
  // source of truth; falls back to the registry default 'active').
  const dbRows = await d1All(env, 'SELECT slug, name, status, is_active FROM ai_agents') || [];
  const bySlug = new Map(dbRows.map((r) => [r.slug, r]));
  const byName = new Map(dbRows.map((r) => [r.name, r]));
  const statusOf = (registryId) => {
    const reg = AGENT_REGISTRY.find((a) => a.id === registryId);
    const row = bySlug.get(registryId) || (reg ? byName.get(reg.name) : null);
    if (!row) return reg ? reg.status : 'active';
    if (typeof row.status === 'string' && row.status) return row.status;
    return row.is_active ? 'active' : 'disabled';
  };
  const agents = [];
  for (const id of QUEUE_AGENTS) {
    if (id === 'research') {
      // research = the 7 division research agents collectively.
      const parts = RESEARCH_AGENT_IDS.map((rid) => ({ id: rid, status: statusOf(rid) }));
      const statuses = parts.map((p) => p.status);
      const status = statuses.every((s) => s === 'active') ? 'active'
        : statuses.some((s) => s === 'disabled') ? 'disabled' : 'paused';
      agents.push({
        id, role: ROLE_LABELS[id], status, registry: 'collective',
        note: 'The 7 division research agents collectively (automotive, technology, gadget, finance, travel, health, education).',
        agents: parts,
      });
      continue;
    }
    if (id === 'social-media' || id === 'traffic-growth') {
      agents.push({
        id, role: ROLE_LABELS[id], status: 'not-in-registry',
        registry: null,
        note: 'not in registry — preparation only',
      });
      continue;
    }
    const registryId = QUEUE_TO_REGISTRY[id];
    agents.push({
      id, role: ROLE_LABELS[id], status: statusOf(registryId), registry: registryId,
    });
  }
  return agents;
}

async function handleStatus(request, env) {
  if (!env.DB) return jsonError('Autonomy status requires the D1 database', 503);
  const settings = await getSettings(env);
  const counts = await d1All(env, 'SELECT status, COUNT(*) AS n FROM agent_tasks GROUP BY status') || [];
  const tasks = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const r of counts) if (r.status in tasks) tasks[r.status] = Number(r.n || 0);
  const providers = await providerStatus(env);
  const generationPaused = !providers.some((p) => p.status === 'available');
  const activeProvider = providers.find((p) => p.status === 'available');
  return jsonOk({
    autonomyLevel: settings.autonomy_level || '3',
    targetLevel: settings.autonomy_target || '3',
    emergencyStop: await getEmergencyStop(env),
    emergencyStopKey: EMERGENCY_STOP_KEY,
    tasks,
    agents: await agentStatuses(env),
    revenue: '$0.00',
    traffic: 'Data unavailable',
    publishingMode: settings.publishing_mode || 'approved_only',
    maxArticlesPerDay: settings.max_articles_per_day || '1',
    socialAutoPost: settings.social_auto_post || 'off',
    llmProvider: settings.llm_provider || 'none',
    llm: {
      provider: activeProvider ? activeProvider.id : 'none',
      status: generationPaused ? 'paused' : 'available',
      generationPaused,
    },
    source: 'd1',
  });
}

/**
 * GET /api/autonomy/llm — live LLM provider status. Needs no D1 gate:
 * availability is derived from the env bindings/keys, usage reads
 * degrade to zeros without D1. { providers, order, generationPaused,
 * reason } — reason names why generation is paused, or is null.
 */
async function handleLlmStatus(request, env) {
  const providers = await providerStatus(env);
  const order = await getProviderOrder(env);
  const generationPaused = !providers.some((p) => p.status === 'available');
  const reason = generationPaused
    ? providers.map((p) => `${p.name}: ${p.status}${p.detail ? ` — ${p.detail}` : ''}`).join(' | ')
    : null;
  return jsonOk({ providers, order, generationPaused, reason, source: 'live' });
}

async function handleListTasks(request, env) {
  if (!env.DB) return jsonError('Task list requires the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const status = q.get('status');
  const agent = q.get('agent');
  const validStatuses = ['queued', 'running', 'done', 'failed', 'skipped'];
  if (status && !validStatuses.includes(status)) return jsonError(`status must be one of: ${validStatuses.join(', ')}.`, 400);
  if (agent && !QUEUE_AGENTS.includes(agent)) return jsonError(`agent must be one of: ${QUEUE_AGENTS.join(', ')}.`, 400);
  let limit = Number(q.get('limit') || 50);
  if (!Number.isInteger(limit) || limit <= 0) limit = 50;
  if (limit > 100) limit = 100;
  let sql = 'SELECT * FROM agent_tasks WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (agent) { sql += ' AND agent = ?'; params.push(agent); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(limit);
  const rows = await d1All(env, sql, params) || [];
  const totalRow = await d1First(env, 'SELECT COUNT(*) AS n FROM agent_tasks');
  return jsonOk({ tasks: rows.map(normaliseTaskRow), total: Number(totalRow ? totalRow.n : rows.length), source: 'd1' });
}

async function handleCreateTask(request, env) {
  if (!env.DB) return jsonError('Task creation requires the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  if (!body || typeof body !== 'object') return jsonError('Body must be a JSON object.', 400);
  if (!QUEUE_AGENTS.includes(body.agent)) {
    return jsonError(`agent must be one of: ${QUEUE_AGENTS.join(', ')}.`, 400);
  }
  if (!body.kind || typeof body.kind !== 'string' || !body.kind.trim()) {
    return jsonError('kind is required (a non-empty string).', 400);
  }
  let priority = 5;
  if (body.priority !== undefined) {
    priority = Number(body.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
      return jsonError('priority must be an integer from 1 to 10.', 400);
    }
  }
  let divisionId = null;
  if (body.division_id !== undefined && body.division_id !== null && body.division_id !== '') {
    divisionId = Number(body.division_id);
    if (!Number.isInteger(divisionId) || divisionId <= 0) return jsonError('division_id must be a positive integer.', 400);
    const row = await d1First(env, 'SELECT id FROM business_divisions WHERE id = ? LIMIT 1', [divisionId]);
    if (!row) return jsonError('Unknown division_id.', 400);
  }
  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null)) {
    return jsonError('payload must be a JSON object.', 400);
  }
  if (body.scheduled_for !== undefined && body.scheduled_for !== null && body.scheduled_for !== '') {
    if (typeof body.scheduled_for !== 'string' || Number.isNaN(Date.parse(body.scheduled_for))) {
      return jsonError('scheduled_for must be a valid ISO date/time.', 400);
    }
  }
  if (body.idempotency_key !== undefined && body.idempotency_key !== null && typeof body.idempotency_key !== 'string') {
    return jsonError('idempotency_key must be a string.', 400);
  }
  const res = await enqueueTask(env, {
    agent: body.agent,
    kind: body.kind.trim(),
    payload: body.payload || {},
    division_id: divisionId,
    priority,
    idempotency_key: body.idempotency_key || undefined,
    scheduled_for: body.scheduled_for ? new Date(body.scheduled_for).toISOString() : null,
  });
  if (!res.ok) return jsonError(res.error || 'Task could not be created.', res.status || 500);
  return jsonOk({ task: res.task, duplicate: res.duplicate }, res.duplicate ? 200 : 201);
}

async function handleRunTask(request, env, id) {
  if (!env.DB) return jsonError('Task runs require the D1 database', 503);
  const result = await runTask(env, id);
  if (!result.ok) return jsonError(result.error || 'Task could not run.', result.status || 500, result.skipped ? { skipped: true } : {});
  return jsonOk({
    taskId: result.taskId, runId: result.runId, outcome: result.outcome,
    attempts: result.attempts, requeued: result.requeued,
    ...(result.scheduled_for ? { scheduled_for: result.scheduled_for } : {}),
    result: result.result,
  });
}

async function handleControl(request, env) {
  if (!env.DB) return jsonError('Agent control requires the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const action = body && body.action;
  if (!['start-all', 'pause-all', 'resume-all'].includes(action)) {
    return jsonError("action must be one of: 'start-all', 'pause-all', 'resume-all'.", 400);
  }
  // persistAgentStatus is the existing pattern (routes/agents.js):
  // status is the source of truth; is_active mirrors it (1 only when active).
  const status = action === 'pause-all' ? 'paused' : 'active';
  let changed = 0;
  let attempted = 0;
  const perAgent = [];
  for (const agent of AGENT_REGISTRY) {
    attempted++;
    const persisted = await persistAgentStatus(env, agent.id, status);
    if (persisted) changed++;
    perAgent.push({ id: agent.id, status, persisted });
  }
  return jsonOk({ ok: true, action, status, attempted, changed, agents: perAgent, source: 'd1' });
}

async function handleGetSettings(request, env) {
  if (!env.DB) return jsonError('Settings require the D1 database', 503);
  return jsonOk({ settings: await getSettings(env), source: 'd1' });
}

async function handlePostSettings(request, env) {
  if (!env.DB) return jsonError('Settings require the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const key = body && body.key;
  const value = body && body.value;
  if (typeof key !== 'string' || !(key in SETTING_RULES)) {
    return jsonError(
      `key must be one of: ${Object.keys(SETTING_RULES).join(', ')}. Spending/account actions are never allowed.`,
      400,
    );
  }
  if (value === undefined || value === null) return jsonError('value is required.', 400);
  const err = SETTING_RULES[key](value);
  if (err) return jsonError(err, 400);
  await d1Run(env,
    'INSERT INTO autonomy_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, String(value), nowIso()]);
  return jsonOk({ ok: true, key, value: String(value), source: 'd1' });
}

async function handleListReports(request, env) {
  if (!env.DB) return jsonError('Reports require the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const kind = q.get('kind');
  if (kind && kind !== 'daily' && kind !== 'weekly') return jsonError("kind must be 'daily' or 'weekly'.", 400);
  let limit = Number(q.get('limit') || 50);
  if (!Number.isInteger(limit) || limit <= 0) limit = 50;
  if (limit > 100) limit = 100;
  let sql = 'SELECT * FROM daily_reports WHERE 1=1';
  const params = [];
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  sql += ' ORDER BY date DESC, id DESC LIMIT ?';
  params.push(limit);
  const rows = await d1All(env, sql, params) || [];
  const reports = rows.map((r) => {
    let summary = null;
    try { summary = JSON.parse(r.summary_json || '{}'); } catch { summary = null; }
    return { ...r, summary };
  });
  return jsonOk({ reports, total: reports.length, source: 'd1' });
}

async function handleGenerateReport(request, env) {
  if (!env.DB) return jsonError('Report generation requires the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const kind = body && body.kind;
  if (kind !== 'daily' && kind !== 'weekly') return jsonError("kind must be 'daily' or 'weekly'.", 400);
  // Snapshot only — this must NOT re-execute any workflow or agent task.
  const res = await generateReportSnapshot(env, kind);
  if (!res.ok) return jsonError(res.error || 'Report could not be generated.', 500);
  return jsonOk({ report: res.report }, 201);
}

async function handleAccounts() {
  const accounts = ACCOUNTS.map((a) => {
    const truth = ACCOUNT_STATES[a.id] || {
      states: { prepared: false, created: false, ownershipVerified: false, connected: false, apiAuthorized: false, publishingEnabled: false },
      note: a.detail || 'No verified state recorded.',
    };
    return {
      id: a.id, platform: a.platform, handle: a.handle, url: a.url,
      states: truth.states, note: truth.note,
    };
  });
  return jsonOk({ accounts, total: accounts.length, source: 'truth-table' });
}

async function handleRunDaily(request, env) {
  if (!env.DB) return jsonError('Daily workflow requires the D1 database', 503);
  if (await getEmergencyStop(env)) {
    // runDailyWorkflow logs the skip itself; answer 423 as specified.
    await runDailyWorkflow(env);
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { skipped: true });
  }
  const result = await runDailyWorkflow(env);
  if (!result.ok) return jsonError(result.error || 'Daily workflow failed.', 500);
  return jsonOk({ ok: true, ...result });
}

async function handleScaffoldConvert(request, env, runId) {
  if (!env.DB) return jsonError('Scaffold conversion requires the D1 database', 503);
  const id = Number(runId);
  if (!Number.isInteger(id) || id <= 0) return jsonError('runId must be a positive integer.', 400);
  const run = await d1First(env, 'SELECT * FROM agent_runs WHERE id = ? LIMIT 1', [id]);
  if (!run) return jsonError('Run not found', 404);
  let detail = {};
  try { detail = JSON.parse(run.detail || '{}'); } catch { detail = {}; }
  if (!detail.scaffold) return jsonError('This run has no scaffold to convert.', 400);
  const res = await convertScaffoldToDraft(env, detail.scaffold);
  if (!res.ok) return jsonError(res.error || 'Draft could not be created.', res.status || 500);
  return jsonOk({ article: res.article }, 201);
}

export async function handleAutonomy(request, env, ctx, auth) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean); // api, autonomy, ...

  if (method === 'GET' && path === '/api/autonomy/status') return handleStatus(request, env);
  if (method === 'GET' && path === '/api/autonomy/llm') return handleLlmStatus(request, env);
  if (method === 'GET' && path === '/api/autonomy/tasks') return handleListTasks(request, env);
  if (method === 'POST' && path === '/api/autonomy/tasks') return handleCreateTask(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'tasks' && parts[4] === 'run') {
    return handleRunTask(request, env, parts[3]);
  }
  if (method === 'POST' && path === '/api/autonomy/control') return handleControl(request, env);
  if (method === 'GET' && path === '/api/autonomy/settings') return handleGetSettings(request, env);
  if (method === 'POST' && path === '/api/autonomy/settings') return handlePostSettings(request, env);
  if (method === 'GET' && path === '/api/autonomy/reports') return handleListReports(request, env);
  if (method === 'POST' && path === '/api/autonomy/reports/generate') return handleGenerateReport(request, env);
  if (method === 'GET' && path === '/api/autonomy/accounts') return handleAccounts();
  if (method === 'POST' && path === '/api/autonomy/run-daily') return handleRunDaily(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'scaffolds' && parts[4] === 'convert') {
    return handleScaffoldConvert(request, env, parts[3]);
  }
  return jsonError('Not found', 404, { path });
}

// Re-exported for the worker integration snippet / tests.
export { todayStr, isValidSlug };
