// FS AI — Owner auth route tests (/api/auth/login, /logout, /me).
//
// The Worker is exercised through src/index.js handleRequest with an
// in-memory fake D1 (sessions table only). The correct password is hashed
// in the test itself with the repo's own hashPassword() from
// backend/security/crypto.js — no real credential is used or invented.
// Run: node --test tests/auth.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { handleRequest } = require('../src/index.js');
const { hashPassword } = require('../backend/security/crypto.js');

const OWNER_EMAIL = 'owner@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';
const WRONG_PASSWORD = 'definitely not the password';

const WORKER_URL = 'http://localhost';

// Minimal fake D1: only the `sessions` table queries auth.js issues.
// Anything else (e.g. the rate_limits table the rate limiter probes)
// throws, which the rate limiter treats as "no D1 table" and falls back
// to its in-memory store — same as the real Worker would.
function makeFakeD1() {
  const sessions = new Map(); // tokenHash -> { owner_email, expires_at, created_at }
  return {
    _sessions: sessions,
    prepare(sql) {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async all() {
              if (q.startsWith('SELECT owner_email, expires_at FROM sessions')) {
                const row = sessions.get(params[0]);
                return { results: row ? [{ owner_email: row.owner_email, expires_at: row.expires_at }] : [] };
              }
              throw new Error('fake D1: unsupported SELECT: ' + q);
            },
            async run() {
              if (q.startsWith('INSERT INTO sessions')) {
                const [tokenHash, ownerEmail, expiresAt, createdAt] = params;
                sessions.set(tokenHash, { owner_email: ownerEmail, expires_at: expiresAt, created_at: createdAt });
                return { success: true };
              }
              if (q.startsWith('DELETE FROM sessions')) {
                sessions.delete(params[0]);
                return { success: true };
              }
              throw new Error('fake D1: unsupported statement: ' + q);
            },
          };
        },
      };
    },
  };
}

async function makeEnv(withHash = true) {
  const env = { DB: makeFakeD1(), SESSION_SECRET: 'test-session-secret-for-auth-tests' };
  if (withHash) env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
  return env;
}

function loginRequest(email, password) {
  return new Request(`${WORKER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function loginOk(env) {
  const res = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD), env);
  assert.equal(res.status, 200, 'login must succeed for the token tests');
  const body = await res.json();
  assert.ok(body.token, 'login must return a token');
  return body.token;
}

describe('Owner auth routes (/api/auth/*)', () => {
  let env;

  before(async () => {
    env = await makeEnv(true);
  });

  it('login with a wrong password returns 401', async () => {
    const res = await handleRequest(loginRequest(OWNER_EMAIL, WRONG_PASSWORD), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it('login without OWNER_PASSWORD_HASH configured returns 503', async () => {
    const unconfigured = await makeEnv(false);
    const res = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD), unconfigured);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /not configured/);
  });

  it('login with the correct password returns 200 with a token and expiresAt', async () => {
    const res = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.token, 'string');
    assert.ok(body.token.length > 20, 'token must be a real random token');
    assert.ok(body.expiresAt, 'login must return expiresAt');
    assert.ok(new Date(body.expiresAt).getTime() > Date.now(), 'expiresAt must be in the future');
    assert.equal(body.owner, OWNER_EMAIL);
  });

  it('GET /api/auth/me with the issued token returns 200 with the owner email', async () => {
    const token = await loginOk(env);
    const res = await handleRequest(new Request(`${WORKER_URL}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.owner, OWNER_EMAIL);
  });

  it('GET /api/auth/me without a token returns 401', async () => {
    const res = await handleRequest(new Request(`${WORKER_URL}/api/auth/me`), env);
    assert.equal(res.status, 401);
  });

  it('logout returns 200 and /api/auth/me afterwards returns 401', async () => {
    const token = await loginOk(env);
    const logoutRes = await handleRequest(new Request(`${WORKER_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    assert.equal(logoutRes.status, 200);
    const meRes = await handleRequest(new Request(`${WORKER_URL}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    assert.equal(meRes.status, 401);
  });

  it('an unknown /api/auth sub-path returns 404', async () => {
    const res = await handleRequest(new Request(`${WORKER_URL}/api/auth/nope`), env);
    assert.equal(res.status, 404);
  });
});
