// FS AI — Agents admin tests: merged list, logs, run, persistence,
// Emergency Stop, backup export.
//
// Covers the agents contract against the shared fake D1
// (tests/fake-d1.js): GET /api/agents merges the static registry with
// D1 ai_agents state + latest activity; run logs an automation job and
// an activity row with a REAL result (never a fake article/traffic/
// publish); pause persists to D1 ai_agents so a restart keeps it;
// Emergency Stop makes run answer 423; backup needs a token.
// The same routes against a real SQLite database live in
// tests/real-db.test.js.
// Run: node --test tests/agents-admin.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { handleRequest } = require('../src/index.js');
const { makeOwnerEnv, loginOk, authedRequest } = require('./fake-d1.js');

describe('Agents admin (/api/agents, /api/admin/*)', () => {
  let env;
  let token;

  before(async () => {
    env = await makeOwnerEnv();
    token = await loginOk(handleRequest, env);
  });

  it('agents list without a token returns 401', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/agents', null), env);
    assert.equal(res.status, 401);
  });

  it('agents list merges the 16-agent registry with D1 state and the stop flag', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/agents', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.agents.length, 16);
    assert.equal(body.emergencyStop, false);
    assert.equal(body.system.totalAgents, 16);
    assert.equal(body.system.active, 16);
    const seo = body.agents.find((a) => a.id === 'seo');
    assert.equal(seo.status, 'active');
    assert.equal(seo.isActive, true);
    assert.equal(seo.lastRun, null);
  });

  it('agent run logs a job + activity row with a real D1 result', async () => {
    const res = await handleRequest(authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.result.outcome, 'completed');
    assert.equal(body.result.publishedArticles, 0);
    assert.equal(body.job.status, 'completed');
    assert.ok(body.job.id, 'job row id returned');
    const logsRes = await handleRequest(authedRequest('GET', '/api/agents/seo/logs', token), env);
    assert.equal(logsRes.status, 200);
    const logs = await logsRes.json();
    assert.equal(logs.total, 1);
    assert.equal(logs.logs[0].action, 'run');
    assert.equal(logs.logs[0].status, 'success');
    const listRes = await handleRequest(authedRequest('GET', '/api/agents', token), env);
    const seo = (await listRes.json()).agents.find((a) => a.id === 'seo');
    assert.ok(seo.lastRun, 'latest run shows on the merged list');
    assert.equal(seo.lastRun.status, 'success');
  });

  it('analytics run reports honest $0.00 revenue and Data unavailable pageviews', async () => {
    const res = await handleRequest(authedRequest('POST', '/api/agents/analytics/run', token), env);
    assert.equal(res.status, 200);
    const result = (await res.json()).result;
    assert.equal(result.outcome, 'completed');
    assert.equal(result.revenueTotal, 0);
    assert.equal(result.revenueFormatted, '$0.00');
    assert.equal(result.pageViews, 'Data unavailable');
  });

  it('content run is an honest no-op (no fake article, no fake traffic)', async () => {
    const res = await handleRequest(authedRequest('POST', '/api/agents/content-creation/run', token), env);
    assert.equal(res.status, 200);
    const result = (await res.json()).result;
    assert.equal(result.outcome, 'no-op');
    assert.match(result.reason, /No free AI\/content service is connected/);
  });

  it('pause persists to D1: the agent stays paused on a fresh merged read', async () => {
    const pauseRes = await handleRequest(authedRequest('POST', '/api/agents/seo/pause', token), env);
    assert.equal(pauseRes.status, 200);
    assert.equal((await pauseRes.json()).agent.status, 'paused');
    const dbRow = env.DB._tables.ai_agents.find((a) => a.slug === 'seo');
    assert.equal(dbRow.status, 'paused');
    assert.equal(dbRow.is_active, 0);
    const listRes = await handleRequest(authedRequest('GET', '/api/agents', token), env);
    const seo = (await listRes.json()).agents.find((a) => a.id === 'seo');
    assert.equal(seo.status, 'paused');
    // A paused agent refuses to run.
    const runRes = await handleRequest(authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(runRes.status, 409);
    const resumeRes = await handleRequest(authedRequest('POST', '/api/agents/seo/resume', token), env);
    assert.equal(resumeRes.status, 200);
    assert.equal(env.DB._tables.ai_agents.find((a) => a.slug === 'seo').status, 'active');
  });

  it('unknown agent run returns 404', async () => {
    const res = await handleRequest(authedRequest('POST', '/api/agents/no-such-agent/run', token), env);
    assert.equal(res.status, 404);
  });

  it('emergency stop ON makes run answer 423 and logs a skipped row', async () => {
    const onRes = await handleRequest(authedRequest('POST', '/api/admin/emergency-stop', token, { stopped: true }), env);
    assert.equal(onRes.status, 200);
    assert.equal((await onRes.json()).stopped, true);
    const getRes = await handleRequest(authedRequest('GET', '/api/admin/emergency-stop', token), env);
    assert.equal((await getRes.json()).stopped, true);
    const runRes = await handleRequest(authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(runRes.status, 423);
    assert.match((await runRes.json()).error, /Emergency Stop/);
    const logsRes = await handleRequest(authedRequest('GET', '/api/agents/seo/logs', token), env);
    const logs = await logsRes.json();
    assert.ok(logs.logs.some((l) => l.status === 'skipped'), 'skipped run is logged');
    const offRes = await handleRequest(authedRequest('POST', '/api/admin/emergency-stop', token, { stopped: false }), env);
    assert.equal((await offRes.json()).stopped, false);
    const runOk = await handleRequest(authedRequest('POST', '/api/agents/seo/run', token), env);
    assert.equal(runOk.status, 200);
  });

  it('backup without a token returns 401; with a token returns the dump', async () => {
    const noAuth = await handleRequest(authedRequest('GET', '/api/admin/backup', null), env);
    assert.equal(noAuth.status, 401);
    const res = await handleRequest(authedRequest('GET', '/api/admin/backup', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.exported_at, 'export timestamp present');
    assert.ok(body.tables.articles, 'articles table present');
    assert.ok(body.tables.business_divisions, 'divisions table present');
    assert.ok(body.tables.ai_agents, 'agents table present');
    assert.ok(body.tables.agent_activity_logs, 'activity logs present');
    assert.ok(body.tables.newsletter_subscribers, 'subscribers present');
    assert.ok(body.tables.website_settings, 'settings present');
    assert.equal(body.counts.ai_agents, 16);
    assert.ok(Array.isArray(body.warnings));
  });
});
