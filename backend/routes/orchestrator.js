/**
 * FS AI — Autonomy orchestrator routes (owner-only; worker.js enforces
 * requireOwner before calling — auth is passed in and assumed valid).
 *
 *   GET  /api/autonomy/status
 *   GET  /api/autonomy/llm
 *   GET  /api/autonomy/tasks?status=&agent=&limit=
 *   POST /api/autonomy/tasks
 *   POST /api/autonomy/tasks/:id/run
 *   POST /api/autonomy/tasks/:id/retry
 *   POST /api/autonomy/control            { action: start-all|pause-all|resume-all }
 *   GET  /api/autonomy/settings
 *   POST /api/autonomy/settings           { key, value }
 *   GET  /api/autonomy/reports?kind=&limit=
 *   POST /api/autonomy/reports/generate   { kind: daily|weekly } (snapshot only)
 *   GET  /api/autonomy/accounts
 *   POST /api/autonomy/run-daily          { force?: boolean }
 *   POST /api/autonomy/scaffolds/:runId/convert
 *   GET  /api/autonomy/sources
 *   POST /api/autonomy/sources            { division, name, url } (feed is validated live first)
 *   POST /api/autonomy/sources/:id/fetch
 *   POST /api/autonomy/sources/:id/toggle { is_active: 0|1 }
 *   GET  /api/autonomy/fact-checks?article_id=
 *   GET  /api/autonomy/seo?article_id=        (latest SEO check + 11 checks)
 *   GET  /api/autonomy/gate?article_id=
 *   GET  /api/autonomy/analytics
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
import { fetchFeed } from '../rss/rss.js';
import { loadAllSources, loadSource, fetchSource } from '../rss/sources.js';
import { evaluatePublishGate } from '../publishing/gate.js';
import {
  runTask, retryTask, runDailyWorkflow, runWeeklyWorkflow, enqueueTask,
  generateReportSnapshot, normaliseTaskRow, todayStr,
} from './scheduler.js';

const RESEARCH_AGENT_IDS = [
  'automotive-research', 'technology-research', 'gadget-research',
  'finance-research', 'travel-research', 'digital-tools-agent',
  'health-research', 'education-research',
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
  // Auto-pipeline switches. All default to 'off' (migration 010). Turning
  // auto_publishing 'on' only arms the gate's eligibility reporting —
  // nothing publishes while publishing_mode is 'approved_only'.
  auto_research: (v) => ['on', 'off'].includes(String(v)) ? null : "auto_research must be 'on' or 'off'.",
  auto_generation: (v) => ['on', 'off'].includes(String(v)) ? null : "auto_generation must be 'on' or 'off'.",
  auto_factcheck: (v) => ['on', 'off'].includes(String(v)) ? null : "auto_factcheck must be 'on' or 'off'.",
  auto_correction: (v) => ['on', 'off'].includes(String(v)) ? null : "auto_correction must be 'on' or 'off'.",
  auto_publishing: (v) => ['on', 'off'].includes(String(v)) ? null : "auto_publishing must be 'on' or 'off'.",
};

/** Read that degrades to null when a table does not exist yet (pre-migration DBs). */
async function safeFirst(env, sql, params = []) {
  try {
    return await d1First(env, sql, params);
  } catch {
    return null;
  }
}

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
      // research = the 8 division research agents collectively.
      const parts = RESEARCH_AGENT_IDS.map((rid) => ({ id: rid, status: statusOf(rid) }));
      const statuses = parts.map((p) => p.status);
      const status = statuses.every((s) => s === 'active') ? 'active'
        : statuses.some((s) => s === 'disabled') ? 'disabled' : 'paused';
      agents.push({
        id, role: ROLE_LABELS[id], status, registry: 'collective',
        note: 'The 8 division research agents collectively (automotive, technology, gadget, finance, travel, digital-tools, health, education).',
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
  const lastBackup = await safeFirst(env,
    "SELECT * FROM backup_runs WHERE status = 'success' ORDER BY finished_at DESC, id DESC LIMIT 1");
  // Last run per queue agent, for the dashboard's per-automation state
  // (ON/OFF is the agent status above; this adds last run + last result
  // + the failure reason when a run failed). One query: the newest run
  // per agent. agent_runs.detail is a JSON blob — the reason/error lives
  // there. (Added 2026-11-20.)
  const lastRunRows = await d1All(env,
    'SELECT * FROM agent_runs WHERE id IN (SELECT MAX(id) FROM agent_runs GROUP BY agent)') || [];
  const lastRuns = {};
  for (const r of lastRunRows) {
    let reason = null;
    try {
      const detail = JSON.parse(r.detail || '{}');
      reason = detail.reason || detail.error
        || (detail.result && (detail.result.reason || detail.result.error)) || null;
    } catch { reason = null; }
    lastRuns[r.agent] = {
      outcome: r.outcome, startedAt: r.started_at, finishedAt: r.finished_at,
      reason: reason ? String(reason).slice(0, 200) : null,
    };
  }
  return jsonOk({
    autonomyLevel: settings.autonomy_level || '3',
    targetLevel: settings.autonomy_target || '3',
    emergencyStop: await getEmergencyStop(env),
    emergencyStopKey: EMERGENCY_STOP_KEY,
    tasks,
    agents: await agentStatuses(env),
    lastRuns,
    revenue: '$0.00',
    traffic: 'Data unavailable',
    publishingMode: settings.publishing_mode || 'approved_only',
    maxArticlesPerDay: settings.max_articles_per_day || '1',
    socialAutoPost: settings.social_auto_post || 'off',
    autoFlags: {
      auto_research: settings.auto_research || 'off',
      auto_generation: settings.auto_generation || 'off',
      auto_factcheck: settings.auto_factcheck || 'off',
      auto_correction: settings.auto_correction || 'off',
      auto_publishing: settings.auto_publishing || 'off',
    },
    lastBackup: lastBackup ? {
      id: lastBackup.id, finishedAt: lastBackup.finished_at,
      tablesExported: lastBackup.tables_exported, rowsExported: lastBackup.rows_exported,
      bytesExported: lastBackup.bytes_exported,
    } : null,
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
  let force = false;
  try {
    const body = await readJsonBody(request);
    force = Boolean(body && body.force === true);
  } catch {
    force = false;
  }
  if (await getEmergencyStop(env)) {
    // runDailyWorkflow logs the skip itself; answer 423 as specified.
    await runDailyWorkflow(env, { force });
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { skipped: true, status: 'blocked' });
  }
  const result = await runDailyWorkflow(env, { force });
  if (!result.ok) return jsonError(result.error || 'Daily workflow failed.', 500, { status: 'failed' });
  // Real execution status, never a bare success: 'completed' (the
  // workflow ran), 'already_completed' (it already ran today and force
  // was NOT requested — a no-op, not a success), 'blocked' (E-Stop).
  // The dashboard button always sends force:true (an explicit manual
  // re-run), so a button click reports 'completed'; the
  // 'already_completed' status is for non-force callers (e.g. the
  // scheduled run firing twice).
  const status = result.skipped ? 'blocked' : result.duplicate ? 'already_completed' : 'completed';
  return jsonOk({ ok: true, status, ...result });
}

async function handleRetryTask(request, env, id) {
  if (!env.DB) return jsonError('Task retry requires the D1 database', 503);
  const result = await retryTask(env, id);
  if (!result.ok) return jsonError(result.error || 'Task could not be retried.', result.status || 500);
  return jsonOk({ taskId: result.taskId, agent: result.agent, status: 'queued' });
}

async function handleListSources(request, env) {
  if (!env.DB) return jsonError('Sources require the D1 database', 503);
  const sources = await loadAllSources(env).catch(() => null);
  if (sources === null) return jsonError('Research sources are not available — migration 008 has not been applied yet.', 503);
  return jsonOk({ sources, total: sources.length, source: 'd1' });
}

async function handleCreateSource(request, env) {
  if (!env.DB) return jsonError('Sources require the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const division = typeof body.division === 'string' ? body.division.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!division || !isValidSlug(division)) return jsonError('division must be a valid division slug.', 400);
  if (!name) return jsonError('name is required.', 400);
  if (!url) return jsonError('url is required.', 400);
  const div = await d1First(env, 'SELECT id, slug FROM business_divisions WHERE slug = ? LIMIT 1', [division]);
  if (!div) return jsonError(`Unknown division slug: ${division}.`, 400);
  const existing = await d1First(env, 'SELECT id FROM research_sources WHERE url = ? LIMIT 1', [url]);
  if (existing) return jsonError('A source with this URL already exists.', 409);
  // Validate the feed live before storing it: only a URL that returns
  // valid RSS/Atom XML becomes a source. Nothing unverified is stored.
  const checked = await fetchFeed(url);
  if (!checked.ok) {
    return jsonError(`Feed validation failed: ${checked.error}. The source was not added.`, 400);
  }
  const inserted = await d1Run(env,
    'INSERT INTO research_sources (division_id, name, url, source_type, is_active, last_status) VALUES (?, ?, ?, ?, 1, ?)',
    [div.id, name, url, checked.feedType || 'rss', 'validated']);
  const id = inserted && inserted.meta ? inserted.meta.last_row_id : null;
  const source = id ? await loadSource(env, id) : null;
  return jsonOk({ source, itemsFound: checked.items.length, feedType: checked.feedType }, 201);
}

async function handleFetchSource(request, env, id) {
  if (!env.DB) return jsonError('Sources require the D1 database', 503);
  const source = await loadSource(env, id);
  if (!source) return jsonError('Source not found.', 404);
  const result = await fetchSource(env, source);
  return jsonOk({ source: result });
}

async function handleToggleSource(request, env, id) {
  if (!env.DB) return jsonError('Sources require the D1 database', 503);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const isActive = body && (body.is_active === 1 || body.is_active === true) ? 1
    : (body && (body.is_active === 0 || body.is_active === false) ? 0 : null);
  if (isActive === null) return jsonError('is_active must be 0/1 or true/false.', 400);
  const source = await loadSource(env, id);
  if (!source) return jsonError('Source not found.', 404);
  await d1Run(env, "UPDATE research_sources SET is_active = ?, updated_at = datetime('now') WHERE id = ?", [isActive, id]);
  return jsonOk({ ok: true, id: Number(id), is_active: isActive });
}

async function handleFactChecks(request, env) {
  if (!env.DB) return jsonError('Fact-checks require the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const articleId = Number(q.get('article_id'));
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article_id is required.', 400);
  const latest = await safeFirst(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [articleId]);
  if (!latest) return jsonOk({ articleId, factCheck: null, claims: [], corrections: [], source: 'd1' });
  const claims = await d1All(env, 'SELECT * FROM claim_checks WHERE fact_check_id = ? ORDER BY id ASC', [latest.id]) || [];
  const corrections = await d1All(env, 'SELECT * FROM article_corrections WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 20', [articleId]) || [];
  return jsonOk({ articleId, factCheck: latest, claims, corrections, source: 'd1' });
}

async function handleGate(request, env) {
  if (!env.DB) return jsonError('Publish gate requires the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const articleId = Number(q.get('article_id'));
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article_id is required.', 400);
  const gate = await evaluatePublishGate(env, articleId);
  return jsonOk({ ...gate, source: 'd1' });
}

/**
 * GET /api/autonomy/seo?article_id= — the latest SEO check for one
 * article, with the individual 11-check results parsed from checks_json
 * so the dashboard can show which check failed and why (mirrors
 * handleFactChecks; added 2026-11-20 for the per-article SEO view).
 */
async function handleSeoChecks(request, env) {
  if (!env.DB) return jsonError('SEO checks require the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const articleId = Number(q.get('article_id'));
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article_id is required.', 400);
  const latest = await safeFirst(env,
    'SELECT * FROM seo_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [articleId]);
  if (!latest) return jsonOk({ articleId, seoCheck: null, checks: [], source: 'd1' });
  let checks = [];
  try {
    const parsed = JSON.parse(latest.checks_json || '[]');
    if (Array.isArray(parsed)) checks = parsed;
  } catch {
    checks = [];
  }
  return jsonOk({ articleId, seoCheck: latest, checks, source: 'd1' });
}

/**
 * GET /api/autonomy/analytics — first-party D1 analytics only. GA4 has
 * no Data API connection, so traffic stays 'Data unavailable' and
 * revenue stays $0.00; everything else is counted from real D1 rows.
 */
async function handleAnalytics(request, env) {
  if (!env.DB) return jsonError('Analytics requires the D1 database', 503);
  const articlesByStatus = await d1All(env, 'SELECT status, COUNT(*) AS n FROM articles GROUP BY status') || [];
  const articlesByDivision = await d1All(env,
    'SELECT d.slug AS division, d.name, COUNT(a.id) AS total, ' +
    "SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published " +
    'FROM business_divisions d LEFT JOIN articles a ON a.division_id = d.id GROUP BY d.id, d.slug, d.name ORDER BY published ASC, total ASC') || [];
  const publishedToday = await d1First(env,
    "SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at >= datetime('now', 'start of day')");
  const drafts = await d1All(env,
    "SELECT a.id, a.title, a.status, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id " +
    "WHERE a.status IN ('draft', 'pending_approval') ORDER BY a.updated_at DESC LIMIT 20") || [];
  const draftGates = [];
  for (const d of drafts) {
    const gate = await evaluatePublishGate(env, d.id);
    draftGates.push({ id: d.id, title: d.title, status: d.status, division: d.division, contentReady: gate.contentReady, eligible: gate.eligible, blockedBy: gate.blockedBy });
  }
  const llmToday = await safeFirst(env,
    "SELECT COUNT(*) AS calls, COALESCE(SUM(neurons), 0) AS neurons FROM llm_usage WHERE date(created_at) = date('now')");
  const llm7d = await safeFirst(env,
    "SELECT COUNT(*) AS calls, COALESCE(SUM(neurons), 0) AS neurons FROM llm_usage WHERE created_at >= datetime('now', '-7 days')");
  const taskOutcomes7d = await d1All(env,
    "SELECT outcome, COUNT(*) AS n FROM agent_runs WHERE started_at >= datetime('now', '-7 days') GROUP BY outcome") || [];
  const failedTasks = await d1All(env,
    "SELECT id, agent, kind, attempts, max_attempts, updated_at FROM agent_tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20") || [];
  const latestReport = await d1First(env, 'SELECT * FROM daily_reports ORDER BY date DESC, id DESC LIMIT 1');
  let latestSummary = null;
  if (latestReport) { try { latestSummary = JSON.parse(latestReport.summary_json || '{}'); } catch { latestSummary = null; } }
  const researchTotals = await safeFirst(env, 'SELECT COUNT(*) AS sources, COALESCE(SUM(items_discovered), 0) AS items FROM research_sources WHERE is_active = 1');
  return jsonOk({
    articlesByStatus: Object.fromEntries(articlesByStatus.map((r) => [r.status, Number(r.n || 0)])),
    articlesByDivision: articlesByDivision.map((r) => ({ division: r.division, name: r.name, total: Number(r.total || 0), published: Number(r.published || 0) })),
    publishedToday: Number(publishedToday ? publishedToday.n : 0),
    drafts: draftGates,
    llmToday: { calls: Number(llmToday ? llmToday.calls : 0), neurons: Number(llmToday ? llmToday.neurons : 0) },
    llm7d: { calls: Number(llm7d ? llm7d.calls : 0), neurons: Number(llm7d ? llm7d.neurons : 0) },
    taskOutcomes7d: Object.fromEntries(taskOutcomes7d.map((r) => [r.outcome, Number(r.n || 0)])),
    failedTasks: failedTasks.map((t) => ({ id: t.id, agent: t.agent, kind: t.kind, attempts: t.attempts, maxAttempts: t.max_attempts, updatedAt: t.updated_at })),
    latestReport: latestReport ? { ...latestReport, summary: latestSummary } : null,
    research: { activeSources: Number(researchTotals ? researchTotals.sources : 0), itemsDiscovered: Number(researchTotals ? researchTotals.items : 0) },
    ga4: { status: 'Tracking Connected — Reporting API Not Connected' },
    traffic: 'Data unavailable',
    revenue: '$0.00',
    source: 'd1',
  });
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
  return jsonOk({
    article: res.article,
    sourcesRecorded: res.sourcesRecorded,
    sourcesDeduped: res.sourcesDeduped,
    sourceErrors: res.sourceErrors,
    ...(res.warning ? { warning: res.warning } : {}),
  }, 201);
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
  if (method === 'POST' && parts.length === 5 && parts[2] === 'tasks' && parts[4] === 'retry') {
    return handleRetryTask(request, env, parts[3]);
  }
  if (method === 'POST' && path === '/api/autonomy/control') return handleControl(request, env);
  if (method === 'GET' && path === '/api/autonomy/settings') return handleGetSettings(request, env);
  if (method === 'POST' && path === '/api/autonomy/settings') return handlePostSettings(request, env);
  if (method === 'GET' && path === '/api/autonomy/reports') return handleListReports(request, env);
  if (method === 'POST' && path === '/api/autonomy/reports/generate') return handleGenerateReport(request, env);
  if (method === 'GET' && path === '/api/autonomy/accounts') return handleAccounts();
  if (method === 'POST' && path === '/api/autonomy/run-daily') return handleRunDaily(request, env);
  if (method === 'GET' && path === '/api/autonomy/sources') return handleListSources(request, env);
  if (method === 'POST' && path === '/api/autonomy/sources') return handleCreateSource(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'sources' && parts[4] === 'fetch') {
    return handleFetchSource(request, env, parts[3]);
  }
  if (method === 'POST' && parts.length === 5 && parts[2] === 'sources' && parts[4] === 'toggle') {
    return handleToggleSource(request, env, parts[3]);
  }
  if (method === 'GET' && path === '/api/autonomy/fact-checks') return handleFactChecks(request, env);
  if (method === 'GET' && path === '/api/autonomy/seo') return handleSeoChecks(request, env);
  if (method === 'GET' && path === '/api/autonomy/gate') return handleGate(request, env);
  if (method === 'GET' && path === '/api/autonomy/analytics') return handleAnalytics(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'scaffolds' && parts[4] === 'convert') {
    return handleScaffoldConvert(request, env, parts[3]);
  }
  return jsonError('Not found', 404, { path });
}

// Re-exported for the worker integration snippet / tests.
export { todayStr, isValidSlug };
