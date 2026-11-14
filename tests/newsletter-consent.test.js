// FS AI — newsletter consent persistence regression tests.
// 2026-11-14 full functional test: subscribe required consent === true but
// never stored it (no column existed), so "consent saved" could not be
// confirmed. Migration 007 adds consent_given_at; the route now records
// the consent time on subscribe and on re-subscribe.
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { handleRequest } = require('../src/index.js');
const { makeOwnerEnv, loginOk, authedRequest } = require('./fake-d1.js');

let env;

async function post(path, body, token) {
  return handleRequest(authedRequest('POST', path, token, body), env);
}

async function listSubscribers() {
  const token = await loginOk(handleRequest, env);
  const res = await handleRequest(authedRequest('GET', '/api/admin/subscribers', token), env);
  assert.equal(res.status, 200);
  return (await res.json()).subscribers;
}

describe('newsletter consent is persisted (migration 007)', () => {
  before(async () => {
    env = await makeOwnerEnv();
  });

  it('subscribe stores consent_given_at', async () => {
    const res = await post('/api/newsletter/subscribe', { email: 'consent@example.com', name: 'Consent', consent: true });
    assert.equal(res.status, 201);
    const rows = await listSubscribers();
    const row = rows.find((r) => r.email === 'consent@example.com');
    assert.ok(row, 'subscriber row exists');
    assert.equal(row.status, 'pending');
    assert.ok(row.consent_given_at, 'consent_given_at must be stored');
    assert.match(row.consent_given_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'consent_given_at is an ISO timestamp');
  });

  it('re-subscribe after unsubscribe re-records consent_given_at', async () => {
    await post('/api/newsletter/unsubscribe', { email: 'consent@example.com' });
    let rows = await listSubscribers();
    assert.equal(rows.find((r) => r.email === 'consent@example.com').status, 'unsubscribed');
    const res = await post('/api/newsletter/subscribe', { email: 'consent@example.com', consent: true });
    assert.equal(res.status, 201);
    rows = await listSubscribers();
    const row = rows.find((r) => r.email === 'consent@example.com');
    assert.equal(row.status, 'pending');
    assert.ok(row.consent_given_at, 'consent_given_at must be re-recorded on re-subscribe');
    assert.equal(row.unsubscribed_at, null);
  });
});
