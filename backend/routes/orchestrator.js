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
 *   POST /api/autonomy/run-weekly         { force?: boolean } (weekly workflow only — never runs the daily workflow)
 *   POST /api/autonomy/scaffolds/:runId/convert
 *   GET  /api/autonomy/sources
 *   POST /api/autonomy/sources            { division, name, url } (feed is validated live first)
 *   POST /api/autonomy/sources/:id/fetch
 *   POST /api/autonomy/sources/:id/toggle { is_active: 0|1 }
 *   GET  /api/autonomy/rss-audit?source_id=&limit=   (fetch audit log, migration 014)
 *   GET  /api/autonomy/fact-checks?article_id=
 *   GET  /api/autonomy/seo?article_id=        (latest SEO check + 11 checks)
 *   GET  /api/autonomy/gate?article_id=
 *   GET  /api/autonomy/corrections?article_id=   (Fix 4: unresolved corrections + failure reasons)
 *   POST /api/autonomy/corrections/:id/resolve   (Fix 4: owner resolution of one failed correction)
 *   POST /api/autonomy/articles/:id/recheck      (Fix 5: explicit fact-check re-run, reuses the task)
 *   POST /api/autonomy/articles/:id/seo-check    (Fix 6: per-article SEO, check-only — never modifies)
 *   POST /api/autonomy/articles/:id/seo-optimize (Fix 6: per-article SEO repair — unprotected drafts only)
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
import { getAllProvidersDailyUsage } from '../llm/usage.js';
import { fetchFeed, newExecutionId } from '../rss/rss.js';
import { loadAllSources, loadSource, fetchSource } from '../rss/sources.js';
import { evaluatePublishGate } from '../publishing/gate.js';
import { isProtected, assertNotProtected, assertTaskNotProtected, PROTECTED_TEST_ARTICLES } from '../publishing/protection.js';
import { runSeo, runSeoCheckOnly } from '../agents/autonomy/seo.js';
import { findEvidence, judgeClaimDeterministic, MAX_CORRECTION_ATTEMPTS, claimKey } from '../agents/autonomy/factcheck.js';
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
    let step = null;
    try {
      const detail = JSON.parse(r.detail || '{}');
      reason = detail.reason || detail.error
        || (detail.result && (detail.result.reason || detail.result.error)) || null;
      step = detail.step || null;
    } catch { reason = null; step = null; }
    lastRuns[r.agent] = {
      outcome: r.outcome, startedAt: r.started_at, finishedAt: r.finished_at,
      // The step label (e.g. 'fact-check-run' vs 'correction-run') is
      // what distinguishes the two steps the 'fact-checking' agent
      // performs — without it the dashboard showed the correction
      // step's "auto_correction is off" note under Fact-Checking
      // (minor fix A, 2026-11-20).
      step,
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
  // Fix 1: a modifying task for a protected article must never be
  // created — fail fast here so it can never exist to run or retry.
  if (body.payload && typeof body.payload === 'object' && body.payload.article_id !== undefined) {
    const protection = await assertTaskNotProtected(env, { agent: body.agent, kind: body.kind.trim(), payload: body.payload });
    if (!protection.ok) return jsonError(protection.reason, 403, { protected: true });
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
  // Fix 8: a duplicate content-task creation carries `sourceMerge`
  // (existing-reused / sources-added / no-new-sources / rejected) so the
  // caller can tell whether its new sources were merged, duplicated, or
  // rejected. The { task, duplicate } shape is unchanged for other tasks.
  return jsonOk({ task: res.task, duplicate: res.duplicate, ...(res.sourceMerge ? { sourceMerge: res.sourceMerge } : {}) }, res.duplicate ? 200 : 201);
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

async function handleRunWeekly(request, env) {
  if (!env.DB) return jsonError('Weekly workflow requires the D1 database', 503);
  let force = false;
  try {
    const body = await readJsonBody(request);
    force = Boolean(body && body.force === true);
  } catch {
    force = false;
  }
  if (await getEmergencyStop(env)) {
    // runWeeklyWorkflow logs the skip itself; answer 423 as specified.
    await runWeeklyWorkflow(env, { force });
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { skipped: true, status: 'blocked' });
  }
  const result = await runWeeklyWorkflow(env, { force });
  if (!result.ok) return jsonError(result.error || 'Weekly workflow failed.', 500, { status: 'failed' });
  // Real execution status, never a bare success: 'completed' (the
  // workflow ran), 'already_completed' (it already ran today and force
  // was NOT requested — a no-op, not a success), 'blocked' (E-Stop).
  // This endpoint runs ONLY the weekly workflow — it never runs the
  // daily workflow (no daily_reports 'daily' row is written here).
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
  // Manual dashboard fetch: its own execution id, trigger 'manual'
  // (migration 014 audit row).
  const result = await fetchSource(env, source, { executionId: newExecutionId(), triggerType: 'manual' });
  return jsonOk({ source: result });
}

/**
 * GET /api/autonomy/rss-audit?source_id=&limit= — the RSS fetch audit
 * log (migration 014). Read-only: it never recomputes or writes
 * counters, so a reload cannot alter historical counts. Returns the
 * audit rows newest-first plus per-source totals that reconcile with
 * the research_sources counters: for each source, the audit sums over
 * its 'completed'/'partial' rows, the source's own items_discovered /
 * duplicates_found counters, and the live COUNT(research_items) for
 * that source. reconciled is true only when audit inserted sum ==
 * research_items count == source items_discovered. Audit rows exist
 * only for fetches that ran after migration 014 — earlier fetches
 * were never recorded and are not backfilled, so a source fetched
 * before 014 reconciles as false until its next audited fetch; the
 * raw numbers are shown so the gap is visible, never hidden.
 * 503 when the audit table does not exist yet (pre-014 DB).
 */
async function handleRssAudit(request, env) {
  if (!env.DB) return jsonError('RSS fetch audit requires the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const sourceIdRaw = q.get('source_id');
  const sourceId = sourceIdRaw === null || sourceIdRaw === '' ? null : Number(sourceIdRaw);
  if (sourceIdRaw !== null && sourceIdRaw !== '' && (!Number.isInteger(sourceId) || sourceId <= 0)) {
    return jsonError('source_id must be a positive integer.', 400);
  }
  let limit = Number(q.get('limit') || 50);
  if (!Number.isInteger(limit) || limit <= 0) limit = 50;
  if (limit > 100) limit = 100;
  let rows;
  let totalRow;
  let perSource;
  try {
    const where = sourceId !== null ? 'WHERE source_id = ?' : '';
    const params = sourceId !== null ? [sourceId] : [];
    totalRow = await d1First(env, `SELECT COUNT(*) AS n FROM rss_fetch_audit ${where}`, params);
    rows = await d1All(env,
      `SELECT * FROM rss_fetch_audit ${where} ORDER BY started_at DESC, id DESC LIMIT ?`,
      [...params, limit]) || [];
    perSource = await d1All(env,
      'SELECT s.id AS source_id, s.name, s.url, d.slug AS division, '
      + 's.items_discovered AS source_items_discovered, s.duplicates_found AS source_duplicates_found, '
      + "COALESCE(SUM(CASE WHEN a.status IN ('completed', 'partial') THEN a.items_discovered ELSE 0 END), 0) AS audit_discovered, "
      + "COALESCE(SUM(CASE WHEN a.status IN ('completed', 'partial') THEN a.items_inserted ELSE 0 END), 0) AS audit_inserted, "
      + "COALESCE(SUM(CASE WHEN a.status IN ('completed', 'partial') THEN a.duplicates_skipped ELSE 0 END), 0) AS audit_duplicates, "
      + "SUM(CASE WHEN a.status IN ('completed', 'partial', 'failed') THEN 1 ELSE 0 END) AS audit_fetches, "
      + "SUM(CASE WHEN a.status = 'skipped-overlap' THEN 1 ELSE 0 END) AS skipped_overlaps, "
      + '(SELECT COUNT(*) FROM research_items ri WHERE ri.source_id = s.id) AS research_items_count '
      + 'FROM research_sources s JOIN business_divisions d ON d.id = s.division_id '
      + 'LEFT JOIN rss_fetch_audit a ON a.source_id = s.id '
      + (sourceId !== null ? 'WHERE s.id = ? ' : '')
      + 'GROUP BY s.id, s.name, s.url, d.slug, s.items_discovered, s.duplicates_found '
      + 'ORDER BY s.division_id ASC, s.id ASC',
      sourceId !== null ? [sourceId] : []) || [];
  } catch {
    return jsonError('RSS fetch audit is not available — migration 014 has not been applied yet.', 503);
  }
  const perSourceOut = perSource.map((p) => {
    const auditInserted = Number(p.audit_inserted || 0);
    const researchItemsCount = Number(p.research_items_count || 0);
    const sourceItemsDiscovered = Number(p.source_items_discovered || 0);
    return {
      sourceId: p.source_id, name: p.name, url: p.url, division: p.division,
      sourceItemsDiscovered, sourceDuplicatesFound: Number(p.source_duplicates_found || 0),
      auditDiscovered: Number(p.audit_discovered || 0), auditInserted,
      auditDuplicates: Number(p.audit_duplicates || 0),
      auditFetches: Number(p.audit_fetches || 0), skippedOverlaps: Number(p.skipped_overlaps || 0),
      researchItemsCount,
      reconciled: auditInserted === researchItemsCount && sourceItemsDiscovered === researchItemsCount,
    };
  });
  const totals = {
    auditDiscovered: perSourceOut.reduce((n, p) => n + p.auditDiscovered, 0),
    auditInserted: perSourceOut.reduce((n, p) => n + p.auditInserted, 0),
    auditDuplicates: perSourceOut.reduce((n, p) => n + p.auditDuplicates, 0),
    researchItemsTotal: perSourceOut.reduce((n, p) => n + p.researchItemsCount, 0),
    sourcesTotal: perSourceOut.length,
    sourcesReconciled: perSourceOut.filter((p) => p.reconciled).length,
  };
  return jsonOk({
    audits: rows, total: Number(totalRow ? totalRow.n : rows.length), limit,
    perSource: perSourceOut, totals,
    note: 'Audit rows exist only for fetches after migration 014; earlier fetches are not backfilled.',
    source: 'd1',
  });
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

// ---------------------------------------------------------------------------
// Fix 4/5/6 handlers (2026-11-20, Critical Repair Phase 2).
// ---------------------------------------------------------------------------

function normaliseText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** Load one article row with its division slug (same shape as factcheck/seo use). */
async function loadArticleById(env, articleId) {
  return d1First(env,
    'SELECT a.*, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id WHERE a.id = ? LIMIT 1',
    [articleId]);
}

/**
 * Which version of the article an action ran against: the row's
 * updated_at + body length + article_revisions count. Recorded in the
 * SEO and re-check responses so the owner can tell whether a stored
 * result still describes the current body.
 */
async function articleVersion(env, article) {
  let revisionCount = 0;
  try {
    const row = await d1First(env, 'SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?', [article.id]);
    revisionCount = Number(row ? row.n : 0);
  } catch { revisionCount = 0; }
  return {
    updatedAt: article.updated_at || null,
    bodyChars: String(article.body || '').length,
    revisionCount,
  };
}

/**
 * Resolution history for failed corrections. correction_resolutions is
 * created lazily (CREATE TABLE IF NOT EXISTS) so the review endpoints
 * work on a DB where the formal migration has not landed yet; the
 * parent should formalise it as a migration (next number after 014)
 * + console chunk at integration. Every resolution appends a row
 * here — the original article_corrections row is never deleted and
 * its pre-resolution status is kept in previous_status.
 */
async function ensureCorrectionResolutionsTable(env) {
  await d1Run(env,
    'CREATE TABLE IF NOT EXISTS correction_resolutions (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
    'correction_id INTEGER NOT NULL REFERENCES article_corrections(id), ' +
    'article_id INTEGER NOT NULL REFERENCES articles(id), ' +
    'resolution TEXT NOT NULL, note TEXT, previous_status TEXT, new_status TEXT, ' +
    'corrected_text TEXT, verification_verdict TEXT, resolved_by TEXT, ' +
    "created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await d1Run(env,
    'CREATE INDEX IF NOT EXISTS idx_correction_resolutions_correction ON correction_resolutions(correction_id)');
}

async function listResolutions(env, correctionId) {
  try {
    return await d1All(env,
      'SELECT * FROM correction_resolutions WHERE correction_id = ? ORDER BY created_at ASC, id ASC',
      [correctionId]) || [];
  } catch {
    return [];
  }
}

/**
 * Failure reason for one unresolved correction, derived from the row
 * itself — never invented. runCorrection() records status 'failed'
 * only when the claim sentence could not be located in the body for
 * replacement or removal, so a failed row with no recheck_verdict
 * means exactly that; a recheck_verdict names the verdict that
 * failed.
 */
/** Human-readable text for a stored failure_reason (migration 017). */
const FAILURE_REASON_TEXT = {
  'truncated-reply': 'The LLM reply was cut off mid-sentence (token budget) — no incomplete correction was saved.',
  'validation-rejected': 'The corrected body failed whole-body validation (garbled, repeated, incomplete or unsupported content) — nothing was saved.',
  'rewrite-rejected': 'The LLM rewrite was not a single complete evidence-backed sentence.',
  'rewrite-error': 'The LLM rewrite call failed.',
  'rewrite-circuit-open': 'Rewrites were paused after repeated truncated replies (circuit breaker) to stop spending Neurons.',
  'sentence-not-found': 'The claim sentence could not be located in the article body for replacement or removal.',
  'context-dangling': 'Removing this sentence would leave a dangling reference — needs human review.',
};

function deriveFailureReason(correction) {
  const attempt = Number(correction.attempt || 1);
  const parts = [];
  // Phase 3, Priority 2: prefer the stored failure_reason (migration
  // 017) when present; the derived text below is the fallback for
  // rows written before it existed.
  if (correction.failure_reason && FAILURE_REASON_TEXT[correction.failure_reason]) {
    parts.push(FAILURE_REASON_TEXT[correction.failure_reason]);
  } else if (correction.status === 'failed') {
    parts.push(`Correction attempt ${attempt} failed.`);
    if (correction.recheck_verdict) {
      parts.push(`Re-check verdict: ${correction.recheck_verdict}.`);
    } else {
      parts.push('The claim sentence could not be located in the article body for replacement or removal.');
    }
    if (!correction.evidence_url) parts.push('No evidence URL supported the change.');
  } else if (correction.status === 'pending') {
    parts.push(`No correction attempt has completed for this claim yet (attempt ${attempt} of max ${MAX_CORRECTION_ATTEMPTS}).`);
  }
  if (attempt >= MAX_CORRECTION_ATTEMPTS) {
    parts.push(`Max ${MAX_CORRECTION_ATTEMPTS} attempts reached — no further automatic attempt is permitted.`);
  }
  return parts.join(' ');
}

/**
 * Evidence pool for ONE article only (article_sources resolved to
 * their stored research_items rows). This mirrors the private
 * loadEvidence() in backend/agents/autonomy/factcheck.js — copied
 * here because that helper is not exported and factcheck.js is out of
 * scope for this fix. The pool is article-specific by construction:
 * nothing from another article can enter a manual re-verification.
 */
async function loadArticleEvidencePool(env, articleId) {
  const sources = await d1All(env, 'SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC', [articleId]) || [];
  const pool = [];
  const seen = new Set();
  for (const s of sources) {
    let items = [];
    if (s.research_item_id) {
      const row = await d1First(env,
        'SELECT id, source_id, title, url, published_at, summary, evidence_text, is_outdated FROM research_items WHERE id = ? LIMIT 1',
        [s.research_item_id]);
      if (row) items = [row];
    }
    if (!items.length && s.source_url) {
      items = await d1All(env,
        'SELECT id, source_id, title, url, published_at, summary, evidence_text, is_outdated FROM research_items WHERE url = ? ORDER BY fetched_at DESC',
        [s.source_url]) || [];
    }
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      pool.push({
        url: it.url, title: it.title, isOutdated: it.is_outdated === 1,
        text: [it.title, it.summary, it.evidence_text].filter(Boolean).join(' '),
        researchItemId: it.id,
      });
    }
    if (!items.length) {
      pool.push({ url: s.source_url || null, title: s.source_title || '', text: s.source_title || '', isOutdated: false, researchItemId: null });
    }
  }
  return pool;
}

/** Sentence replacement (same behaviour as factcheck.js's private helper, not exported there). */
function replaceClaimSentence(body, sentence, replacement) {
  const text = String(body || '');
  const idx = text.indexOf(sentence);
  if (idx >= 0) return text.slice(0, idx) + replacement + text.slice(idx + sentence.length);
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(escaped);
  if (!re.test(text)) return null;
  return text.replace(re, replacement);
}

/** All fact-checking tasks for one article, newest first (payloads parsed in JS). */
async function findFactCheckTasksForArticle(env, articleId) {
  const rows = await d1All(env,
    "SELECT * FROM agent_tasks WHERE agent = 'fact-checking' ORDER BY id DESC") || [];
  const matched = [];
  for (const row of rows) {
    let payload = {};
    try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {}); } catch { payload = {}; }
    if (Number(payload.article_id) === Number(articleId)) matched.push(normaliseTaskRow(row));
  }
  return matched;
}

/**
 * GET /api/autonomy/corrections?article_id= — unresolved corrections
 * (status pending/failed) for one article: original claim, attempted
 * correction, status, evidence URL, derived failure reason, and the
 * resolution history for each. Read-only; allowed for protected
 * articles (reviewing them changes nothing).
 */
async function handleListCorrections(request, env) {
  if (!env.DB) return jsonError('Corrections require the D1 database', 503);
  const q = new URL(request.url).searchParams;
  const articleId = Number(q.get('article_id'));
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article_id is required.', 400);
  const article = await loadArticleById(env, articleId);
  if (!article) return jsonError(`Article ${articleId} not found.`, 404);
  const rows = await d1All(env,
    "SELECT * FROM article_corrections WHERE article_id = ? AND status IN ('pending', 'failed') ORDER BY created_at ASC, id ASC",
    [articleId]) || [];
  // Phase 3, Priority 5: the endpoint reports DISTINCT CLAIMS, not
  // rows — one entry per claim key (the earliest open row), so the
  // dashboard count matches the gate's distinct-claim count. The raw
  // row count is returned alongside for reconciliation.
  const seenKeys = new Set();
  const corrections = [];
  let duplicateRows = 0;
  for (const row of rows) {
    const key = row.claim_key || claimKey(row.original_text || '');
    if (seenKeys.has(key)) { duplicateRows += 1; continue; }
    seenKeys.add(key);
    corrections.push({
      id: row.id, articleId: row.article_id, claimCheckId: row.claim_check_id,
      originalText: row.original_text, attemptedCorrection: row.corrected_text || null,
      attempt: row.attempt, status: row.status, recheckVerdict: row.recheck_verdict || null,
      evidenceUrl: row.evidence_url || null,
      failureReason: deriveFailureReason(row),
      resolutions: await listResolutions(env, row.id),
    });
  }
  return jsonOk({ articleId, corrections, total: corrections.length, rows: rows.length, duplicateRows, source: 'd1' });
}

const CORRECTION_RESOLUTIONS = [
  'accepted-unresolved-removed',
  'manually-corrected-rechecked',
  'rejected-for-retry',
  'pending-human-review',
];

/**
 * POST /api/autonomy/corrections/:id/resolve { resolution, note?,
 * correctedText? } — owner review of one unresolved correction.
 * Exactly four resolutions; anything else is a 400. A correction
 * record is NEVER deleted and its original status is kept in the
 * correction_resolutions history row (previous_status). The status
 * UPDATE uses only values the article_corrections CHECK allows
 * (pending/applied/failed/removed):
 *  - accepted-unresolved-removed: claim verified ABSENT from the
 *    current body first (else 409); status -> 'removed', so gate
 *    check 4 stops counting it. The claim verdict itself is untouched.
 *  - manually-corrected-rechecked: owner supplies correctedText; it
 *    must pass a fresh deterministic fact-check against the article's
 *    OWN evidence (VERIFIED) before anything is marked resolved — a
 *    click alone can never mark a claim VERIFIED (a non-verifying
 *    text is a 422 and changes nothing). Protected articles: 403.
 *    E-Stop on: 423. On success the body edit is revisioned first.
 *  - rejected-for-retry: status -> 'pending' for another permitted
 *    attempt (max 3 attempts per claim; at the max this is a 409).
 *  - pending-human-review: explicit hold; NO status change, so the
 *    gate keeps counting the correction until another resolution
 *    clears it.
 */
async function handleResolveCorrection(request, env, id, auth) {
  if (!env.DB) return jsonError('Correction review requires the D1 database', 503);
  const correctionId = Number(id);
  if (!Number.isInteger(correctionId) || correctionId <= 0) return jsonError('correction id must be a positive integer.', 400);
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const resolution = body && body.resolution;
  if (!CORRECTION_RESOLUTIONS.includes(resolution)) {
    return jsonError(`resolution must be one of: ${CORRECTION_RESOLUTIONS.join(', ')}.`, 400);
  }
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
  const resolvedBy = (auth && (auth.owner || auth.owner_email)) || 'owner';
  const correction = await d1First(env, 'SELECT * FROM article_corrections WHERE id = ? LIMIT 1', [correctionId]);
  if (!correction) return jsonError(`Correction ${correctionId} not found.`, 404);
  if (correction.status === 'applied' || correction.status === 'removed') {
    return jsonError(`Correction ${correctionId} is already resolved (status '${correction.status}').`, 409,
      { status: correction.status, resolutions: await listResolutions(env, correctionId) });
  }
  const article = await loadArticleById(env, correction.article_id);
  if (!article) return jsonError(`Article ${correction.article_id} not found.`, 404);
  try {
    await ensureCorrectionResolutionsTable(env);
  } catch {
    return jsonError('Correction resolution history is unavailable.', 500);
  }
  const recordResolution = async (fields) => {
    const inserted = await d1Run(env,
      'INSERT INTO correction_resolutions (correction_id, article_id, resolution, note, previous_status, new_status, corrected_text, verification_verdict, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [correctionId, correction.article_id, resolution, note, correction.status,
        fields.newStatus !== undefined ? fields.newStatus : correction.status,
        fields.correctedText || null, fields.verificationVerdict || null, resolvedBy]);
    return inserted && inserted.meta ? inserted.meta.last_row_id : null;
  };
  const currentRow = async () => d1First(env, 'SELECT * FROM article_corrections WHERE id = ? LIMIT 1', [correctionId]);

  if (resolution === 'accepted-unresolved-removed') {
    if (normaliseText(article.body).includes(normaliseText(correction.original_text))) {
      return jsonError('The claim text is still present in the current article body — remove it from the article first, then resolve as accepted-unresolved-removed.', 409,
        { claimStillPresent: true });
    }
    await d1Run(env, "UPDATE article_corrections SET status = 'removed' WHERE id = ?", [correctionId]);
    await recordResolution({ newStatus: 'removed' });
    return jsonOk({
      correction: await currentRow(), resolution,
      gateEffect: 'Gate check 4 (correction-recheck) no longer counts this correction. Checks 1-2 still reflect the latest fact-check — run a re-check to refresh them.',
      source: 'd1',
    });
  }

  if (resolution === 'manually-corrected-rechecked') {
    const correctedText = typeof body.correctedText === 'string' ? body.correctedText.trim() : '';
    if (!correctedText) return jsonError('correctedText is required for manually-corrected-rechecked.', 400);
    if (normaliseText(correctedText) === normaliseText(correction.original_text)) {
      return jsonError('correctedText must differ from the original claim text.', 400);
    }
    if (String(article.status || '') === 'published') {
      return jsonError('Published articles are never modified by correction review.', 409);
    }
    if (await getEmergencyStop(env)) {
      return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { status: 'blocked' });
    }
    const guard = await assertNotProtected(env, article.id);
    if (!guard.ok) return jsonError(guard.reason, 403, { protected: true, articleId: article.id });
    // Fresh fact-check of ONLY the owner-supplied text, against the
    // article's OWN evidence pool. The deterministic judge must return
    // VERIFIED; anything else is a 422 and changes nothing.
    const pool = await loadArticleEvidencePool(env, article.id);
    const evidence = findEvidence(correctedText, pool);
    const judged = judgeClaimDeterministic(correctedText, evidence, pool.length === 0);
    if (judged.verdict !== 'VERIFIED') {
      return jsonError(`The corrected text did not verify against the article's own evidence (verdict: ${judged.verdict}). Nothing was changed.`, 422, {
        verification: { verdict: judged.verdict, explanation: judged.explanation, evidenceUrl: evidence ? evidence.url : null },
      });
    }
    const newBody = replaceClaimSentence(article.body, correction.original_text, correctedText);
    if (newBody === null) {
      return jsonError('The original claim text was not found in the current article body — it may already have been removed; use accepted-unresolved-removed instead.', 409,
        { claimNotFound: true });
    }
    await d1Run(env,
      'INSERT INTO article_revisions (article_id, title, excerpt, body, status, revised_by) VALUES (?, ?, ?, ?, ?, ?)',
      [article.id, article.title, article.excerpt || null, article.body, article.status, 'correction-review']);
    await d1Run(env, 'UPDATE articles SET body = ?, updated_at = ? WHERE id = ?',
      [newBody, nowIso(), article.id]);
    await d1Run(env,
      "UPDATE article_corrections SET status = 'applied', corrected_text = ?, recheck_verdict = 'VERIFIED', evidence_url = ? WHERE id = ?",
      [correctedText, evidence ? evidence.url : null, correctionId]);
    await recordResolution({ newStatus: 'applied', correctedText, verificationVerdict: 'VERIFIED' });
    return jsonOk({
      correction: await currentRow(), resolution,
      verification: { verdict: 'VERIFIED', explanation: judged.explanation, evidenceUrl: evidence ? evidence.url : null },
      gateEffect: 'Gate check 4 (correction-recheck) no longer counts this correction. Run a re-check to refresh the latest fact-check (checks 1-2).',
      nextStep: `POST /api/autonomy/articles/${article.id}/recheck`,
      source: 'd1',
    });
  }

  if (resolution === 'rejected-for-retry') {
    const attemptsRow = await d1First(env, 'SELECT COUNT(*) AS n FROM article_corrections WHERE claim_check_id = ?', [correction.claim_check_id]);
    const attempts = Number(attemptsRow ? attemptsRow.n : 0);
    if (attempts >= MAX_CORRECTION_ATTEMPTS) {
      return jsonError(`Max ${MAX_CORRECTION_ATTEMPTS} correction attempts reached for this claim — it cannot be returned for another attempt.`, 409,
        { attempts, maxAttempts: MAX_CORRECTION_ATTEMPTS });
    }
    await d1Run(env, "UPDATE article_corrections SET status = 'pending' WHERE id = ?", [correctionId]);
    await recordResolution({ newStatus: 'pending' });
    return jsonOk({
      correction: await currentRow(), resolution, attempts, maxAttempts: MAX_CORRECTION_ATTEMPTS,
      gateEffect: 'Gate check 4 (correction-recheck) still counts this correction until a retry succeeds.',
      nextStep: 'Run the correction agent again for this article.',
      source: 'd1',
    });
  }

  // pending-human-review: explicit hold. No status change — the gate
  // keeps counting the correction until a different resolution clears it.
  await recordResolution({ newStatus: correction.status });
  return jsonOk({
    correction: await currentRow(), resolution,
    gateEffect: 'No change: gate check 4 (correction-recheck) still counts this correction while it is on hold.',
    source: 'd1',
  });
}

/**
 * POST /api/autonomy/articles/:id/recheck — explicit fact-check
 * re-run for an existing draft (Fix 5). Owner-only (worker enforces
 * requireOwner before this router), E-Stop respected (423). Protected
 * articles are ALLOWED: a re-check is advisory-only (writes
 * fact_checks / claim_checks rows, never the article row — same scope
 * as the daily factCheckRun step), so protection does not block it.
 * Reuses the article's existing fact-checking task record when one exists — no duplicate task is created; when
 * none exists exactly one new task is enqueued. The run itself is
 * recorded as a NEW agent_runs row and checkArticle() writes a NEW
 * fact_checks row + new claim_checks rows, so every run is kept and
 * the previous result is returned alongside the latest. An in-flight
 * re-check for the same article answers 409 already-running instead
 * of starting a second run. fact_checked is never set here (advisory
 * only — only the publish gate sets it when it approves).
 */
async function handleRecheckArticle(request, env, id) {
  if (!env.DB) return jsonError('Fact-check re-run requires the D1 database', 503);
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article id must be a positive integer.', 400);
  const article = await loadArticleById(env, articleId);
  if (!article) return jsonError(`Article ${articleId} not found.`, 404);
  if (String(article.status || '') === 'published') {
    return jsonError('Article is already published — re-check is for drafts.', 409);
  }
  if (await getEmergencyStop(env)) {
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { status: 'blocked' });
  }
  // Re-check is advisory-only, exactly like the daily factCheckRun step
  // and the manual fact-check task: it writes fact_checks /
  // claim_checks audit rows and NEVER touches the article row
  // (factcheck.js: fact_checked is never set by a check; the body,
  // excerpt and seo_description are untouched). Protection therefore
  // does not block a re-check on a protected article — the protection
  // scope is article content/metadata, and a re-check modifies neither.
  // (Coordinator decision 2026-11-20: Agent E's 403 here was
  // inconsistent with the daily workflow, which fact-checks protected
  // articles; see tests/factcheck-rerun.test.js.)
  const existingTasks = await findFactCheckTasksForArticle(env, articleId);
  if (existingTasks.some((t) => t.status === 'running')) {
    const running = existingTasks.find((t) => t.status === 'running');
    return jsonError('A fact-check re-check is already running for this article.', 409,
      { status: 'already-running', taskId: running.id, articleId });
  }
  const before = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [articleId]);
  const previous = before
    ? { id: before.id, verdict: before.verdict, claimsTotal: before.claims_total, claimsVerified: before.claims_verified, claimsFailed: before.claims_failed, createdAt: before.created_at }
    : null;
  let task = existingTasks[0] || null;
  let taskReused = false;
  if (task) {
    taskReused = true;
    // Phase 3, Priority 6: the re-check must be recorded as
    // check_kind 'recheck' even when the task row is reused from an
    // earlier run, so the fact_checks audit trail names the run type.
    try {
      const reusedPayload = {
        ...(typeof task.payload === 'string' ? JSON.parse(task.payload) : (task.payload || {})),
        check_kind: 'recheck',
      };
      await d1Run(env, "UPDATE agent_tasks SET payload = ?, status = 'queued', scheduled_for = NULL, updated_at = ? WHERE id = ?",
        [JSON.stringify(reusedPayload), nowIso(), task.id]);
    } catch {
      if (task.status !== 'queued') {
        await d1Run(env, "UPDATE agent_tasks SET status = 'queued', scheduled_for = NULL, updated_at = ? WHERE id = ?",
          [nowIso(), task.id]);
      }
    }
  } else {
    const enqueued = await enqueueTask(env, {
      agent: 'fact-checking', kind: 'fact-check', payload: { article_id: articleId, check_kind: 'recheck' },
      division_id: article.division_id || null,
      idempotency_key: `manual-recheck-${articleId}-${before ? before.id : 0}`,
    });
    if (!enqueued.ok) return jsonError(enqueued.error || 'Re-check task could not be created.', enqueued.status || 500);
    task = enqueued.task;
  }
  const result = await runTask(env, task.id);
  if (!result.ok) {
    return jsonError(result.error || 'Fact-check re-run failed.', result.status || 500,
      { taskId: task.id, ...(result.skipped ? { skipped: true } : {}) });
  }
  if (result.outcome === 'failed') {
    return jsonError((result.result && result.result.error) || 'Fact-check run failed.', 500,
      { taskId: task.id, runId: result.runId, outcome: 'failed' });
  }
  const latest = await d1First(env,
    'SELECT * FROM fact_checks WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [articleId]);
  const latestClaims = latest
    ? (await d1All(env, 'SELECT * FROM claim_checks WHERE fact_check_id = ? ORDER BY id ASC', [latest.id]) || [])
    : [];
  const afterArticle = await d1First(env, 'SELECT fact_checked FROM articles WHERE id = ? LIMIT 1', [articleId]);
  return jsonOk({
    articleId, taskId: task.id, taskReused, runId: result.runId, outcome: result.outcome,
    status: 'completed',
    latest: latest
      ? { id: latest.id, verdict: latest.verdict, claimsTotal: latest.claims_total, claimsVerified: latest.claims_verified, claimsFailed: latest.claims_failed, createdAt: latest.created_at, claims: latestClaims }
      : null,
    previous,
    factChecked: afterArticle ? Number(afterArticle.fact_checked || 0) : 0,
    articleVersion: await articleVersion(env, article),
    note: 'Advisory only — fact_checked was not set by this re-check; only the publish gate sets it when it approves.',
    source: 'd1',
  });
}

/**
 * POST /api/autonomy/articles/:id/seo-check — per-article SEO in
 * CHECK-ONLY mode (Fix 6). Runs the real 11-check suite and stores
 * the results, but never repairs: body, excerpt and SEO fields are
 * untouched and no revision row is written. Protected articles are
 * ALLOWED (check-only writes nothing to the article). E-Stop
 * respected (423) — the check executes live link fetches. The
 * response carries action 'check' so the owner can distinguish it
 * from 'optimize'.
 */
async function handleSeoCheckArticle(request, env, id) {
  if (!env.DB) return jsonError('SEO check requires the D1 database', 503);
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article id must be a positive integer.', 400);
  const article = await loadArticleById(env, articleId);
  if (!article) return jsonError(`Article ${articleId} not found.`, 404);
  if (await getEmergencyStop(env)) {
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { status: 'blocked' });
  }
  const isArticleProtected = await isProtected(env, articleId);
  const result = await runSeoCheckOnly(env, article);
  return jsonOk({
    action: 'check', articleId, protected: isArticleProtected,
    verdict: result.verdict, checks: result.checks, seoCheckId: result.seoCheckId,
    articleVersion: await articleVersion(env, article),
    note: result.note, source: 'd1',
  });
}

/**
 * POST /api/autonomy/articles/:id/seo-optimize — per-article SEO
 * repair (Fix 6). Runs repairSeoFields then the 11-check suite.
 * UNPROTECTED drafts only: protected articles are refused with a
 * clear protected reason (403), published articles are refused (409),
 * E-Stop respected (423). The response carries action 'optimize'
 * (vs 'check') plus the repairs made.
 */
async function handleSeoOptimizeArticle(request, env, id) {
  if (!env.DB) return jsonError('SEO optimization requires the D1 database', 503);
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) return jsonError('article id must be a positive integer.', 400);
  const article = await loadArticleById(env, articleId);
  if (!article) return jsonError(`Article ${articleId} not found.`, 404);
  if (String(article.status || '') === 'published') {
    return jsonError('Published articles are never modified by SEO optimization.', 409);
  }
  if (await getEmergencyStop(env)) {
    return jsonError('Autonomous operations are stopped by Emergency Stop', 423, { status: 'blocked' });
  }
  const guard = await assertNotProtected(env, articleId);
  if (!guard.ok) return jsonError(guard.reason, 403, { protected: true, articleId });
  const result = await runSeo({ kind: 'seo', payload: { article_id: articleId } }, env);
  if (!result || result.outcome !== 'done') {
    return jsonError((result && result.error) || 'SEO optimization failed.', 500);
  }
  const fresh = await loadArticleById(env, articleId);
  return jsonOk({
    action: 'optimize', articleId, protected: false,
    verdict: result.verdict, checks: result.checks, seoCheckId: result.seoCheckId,
    repairs: result.repairs, repairedFields: result.filled,
    articleVersion: await articleVersion(env, fresh || article),
    note: result.note, source: 'd1',
  });
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
  // The dashboard needs is_protected per draft (PROTECTED badge + which
  // actions are disabled). The column exists only once migration 013 is
  // applied — fall back to the constant list on an older database so
  // the analytics endpoint never fails outright.
  let drafts;
  try {
    drafts = await d1All(env,
      "SELECT a.id, a.title, a.status, d.slug AS division, a.is_protected FROM articles a JOIN business_divisions d ON d.id = a.division_id " +
      "WHERE a.status IN ('draft', 'pending_approval') ORDER BY a.updated_at DESC LIMIT 20") || [];
  } catch {
    drafts = await d1All(env,
      "SELECT a.id, a.title, a.status, d.slug AS division FROM articles a JOIN business_divisions d ON d.id = a.division_id " +
      "WHERE a.status IN ('draft', 'pending_approval') ORDER BY a.updated_at DESC LIMIT 20") || [];
    drafts = drafts.map((d) => ({ ...d, is_protected: PROTECTED_TEST_ARTICLES.includes(d.id) ? 1 : 0 }));
  }
  const draftGates = [];
  for (const d of drafts) {
    const gate = await evaluatePublishGate(env, d.id);
    draftGates.push({ id: d.id, title: d.title, status: d.status, division: d.division, isProtected: Number(d.is_protected || 0) === 1, contentReady: gate.contentReady, eligible: gate.eligible, blockedBy: gate.blockedBy });
  }
  // Phase 3, Priority 7: ONE counting rule for LLM usage, via
  // getAllProvidersDailyUsage() (llm/usage.js) — the same function the
  // dashboard header reads through providerStatus(). The old inline
  // COUNT(*)/SUM(neurons) counted cap-refusal rows as calls, which is
  // how the KPI (259 Neurons, all rows) disagreed with the header.
  // Shape is unchanged (calls, neurons) plus neuronsEstimated and a
  // per-provider breakdown; neuronsEstimated is null until migration
  // 016 is applied live.
  const llmByProvider = await getAllProvidersDailyUsage(env);
  const llmTodayCalls = Object.values(llmByProvider).reduce((a, u) => a + (u.requests || 0), 0);
  const llmTodayNeurons = Object.values(llmByProvider).reduce((a, u) => a + (u.neurons || 0), 0);
  const llmTodayEstimated = Object.values(llmByProvider).some((u) => u.neuronsEstimated === null)
    ? null
    : Object.values(llmByProvider).reduce((a, u) => a + (u.neuronsEstimated || 0), 0);
  const llm7d = await safeFirst(env,
    "SELECT COUNT(*) AS calls, COALESCE(SUM(neurons), 0) AS neurons FROM llm_usage WHERE outcome IN ('ok', 'error') AND created_at >= datetime('now', '-7 days')");
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
    llmToday: {
      calls: llmTodayCalls, neurons: llmTodayNeurons,
      ...(llmTodayEstimated === null ? {} : { neuronsEstimated: llmTodayEstimated }),
      byProvider: Object.fromEntries(Object.entries(llmByProvider).map(([p, u]) => [p, {
        requests: u.requests, neurons: u.neurons,
        ...(u.neuronsEstimated === null ? {} : { neuronsEstimated: u.neuronsEstimated }),
      }])),
    },
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
  if (method === 'POST' && path === '/api/autonomy/run-weekly') return handleRunWeekly(request, env);
  if (method === 'GET' && path === '/api/autonomy/sources') return handleListSources(request, env);
  if (method === 'POST' && path === '/api/autonomy/sources') return handleCreateSource(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'sources' && parts[4] === 'fetch') {
    return handleFetchSource(request, env, parts[3]);
  }
  if (method === 'GET' && path === '/api/autonomy/rss-audit') return handleRssAudit(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'sources' && parts[4] === 'toggle') {
    return handleToggleSource(request, env, parts[3]);
  }
  if (method === 'GET' && path === '/api/autonomy/fact-checks') return handleFactChecks(request, env);
  if (method === 'GET' && path === '/api/autonomy/seo') return handleSeoChecks(request, env);
  if (method === 'GET' && path === '/api/autonomy/gate') return handleGate(request, env);
  if (method === 'GET' && path === '/api/autonomy/corrections') return handleListCorrections(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'corrections' && parts[4] === 'resolve') {
    return handleResolveCorrection(request, env, parts[3], auth);
  }
  if (method === 'POST' && parts.length === 5 && parts[2] === 'articles' && parts[4] === 'recheck') {
    return handleRecheckArticle(request, env, parts[3]);
  }
  if (method === 'POST' && parts.length === 5 && parts[2] === 'articles' && parts[4] === 'seo-check') {
    return handleSeoCheckArticle(request, env, parts[3]);
  }
  if (method === 'POST' && parts.length === 5 && parts[2] === 'articles' && parts[4] === 'seo-optimize') {
    return handleSeoOptimizeArticle(request, env, parts[3]);
  }
  if (method === 'GET' && path === '/api/autonomy/analytics') return handleAnalytics(request, env);
  if (method === 'POST' && parts.length === 5 && parts[2] === 'scaffolds' && parts[4] === 'convert') {
    return handleScaffoldConvert(request, env, parts[3]);
  }
  return jsonError('Not found', 404, { path });
}

// Re-exported for the worker integration snippet / tests.
export { todayStr, isValidSlug };
