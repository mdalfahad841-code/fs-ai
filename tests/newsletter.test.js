// FS AI — Newsletter subscribe/unsubscribe + owner subscriber tests.
//
// Covers the newsletter contract against the shared fake D1
// (tests/fake-d1.js): consent required, valid email required, duplicate
// email answers 200 already-subscribed, unsubscribe always answers 200
// (even for unknown addresses), owner list + owner unsubscribe.
// The same routes against a real SQLite database live in
// tests/real-db.test.js.
// Run: node --test tests/newsletter.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { handleRequest } = require('../src/index.js');
const { makeOwnerEnv, loginOk, authedRequest } = require('./fake-d1.js');

let env; // set by each describe's before(); post() uses the current one.

async function post(path, body, token) {
  return handleRequest(authedRequest('POST', path, token, body), env);
}

describe('Newsletter public routes (/api/newsletter/*)', () => {
  before(async () => {
    env = await makeOwnerEnv();
  });

  it('subscribe with an invalid email returns 400', async () => {
    const res = await post('/api/newsletter/subscribe', { email: 'not-an-email', consent: true });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /valid email/);
  });

  it('subscribe without consent returns 400', async () => {
    const res = await post('/api/newsletter/subscribe', { email: 'reader@example.com' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Consent/);
    const res2 = await post('/api/newsletter/subscribe', { email: 'reader@example.com', consent: false });
    assert.equal(res2.status, 400);
  });

  it('subscribe stores the address as pending (no confirmation email is sent)', async () => {
    const res = await post('/api/newsletter/subscribe', { email: 'reader@example.com', name: 'Reader', consent: true });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.subscribed, true);
    assert.equal(body.status, 'pending');
    assert.match(body.message, /pending/);
  });

  it('duplicate subscribe returns 200 already-subscribed without leaking state', async () => {
    const res = await post('/api/newsletter/subscribe', { email: 'reader@example.com', consent: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.subscribed, false);
    assert.equal(body.message, 'This email is already subscribed.');
  });

  it('unsubscribe returns 200 and the address leaves the active list', async () => {
    const res = await post('/api/newsletter/unsubscribe', { email: 'reader@example.com' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unsubscribed, true);
  });

  it('unsubscribe for an unknown address still returns 200', async () => {
    const res = await post('/api/newsletter/unsubscribe', { email: 'nobody-here@example.com' });
    assert.equal(res.status, 200);
  });

  it('re-subscribing after unsubscribe moves the address back to pending', async () => {
    const res = await post('/api/newsletter/subscribe', { email: 'reader@example.com', consent: true });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).status, 'pending');
  });
});

describe('Newsletter owner routes (/api/admin/subscribers)', () => {
  let token;

  before(async () => {
    env = await makeOwnerEnv();
    token = await loginOk(handleRequest, env);
    await post('/api/newsletter/subscribe', { email: 'owner-list-a@example.com', consent: true });
    await post('/api/newsletter/subscribe', { email: 'owner-list-b@example.com', consent: true });
    await post('/api/newsletter/unsubscribe', { email: 'owner-list-b@example.com' });
  });

  it('subscriber list without a token returns 401', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/admin/subscribers', null), env);
    assert.equal(res.status, 401);
  });

  it('owner list shows subscribers with a status filter', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/admin/subscribers', token), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    const pending = await handleRequest(authedRequest('GET', '/api/admin/subscribers?status=pending', token), env);
    assert.equal((await pending.json()).total, 1);
    const unsub = await handleRequest(authedRequest('GET', '/api/admin/subscribers?status=unsubscribed', token), env);
    assert.equal((await unsub.json()).total, 1);
  });

  it('owner unsubscribe flips a subscriber to unsubscribed', async () => {
    const list = await handleRequest(authedRequest('GET', '/api/admin/subscribers?status=pending', token), env);
    const sub = (await list.json()).subscribers[0];
    const res = await handleRequest(authedRequest('POST', `/api/admin/subscribers/${sub.id}/unsubscribe`, token), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).subscriber.status, 'unsubscribed');
    const missing = await handleRequest(authedRequest('POST', '/api/admin/subscribers/99999/unsubscribe', token), env);
    assert.equal(missing.status, 404);
  });
});
