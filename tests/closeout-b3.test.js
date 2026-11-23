// FS AI — Login lockout tests (close-out B3, 2026-11-23).
//
// D1-backed failed-login counting: 5 failed attempts for one email
// lock that address out for a fixed 15 minutes; the window never
// self-extends; the owner can never be locked out permanently.
// The Worker is exercised through src/index.js handleRequest with an
// in-memory fake D1 (sessions + login_attempts tables only). The
// correct password is hashed in the test itself with the repo's own
// hashPassword() — no real credential is used or invented. A second
// block runs the lockout module against REAL SQLite built from
// database/migrations/031_login_attempts.sql, so the real SQL
// (including the UPSERT) is proven, not just the fake.
// Run: node --test tests/closeout-b3.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DatabaseSync } = require('node:sqlite');
const { handleRequest } = require('../src/index.js');
const { hashPassword } = require('../backend/security/crypto.js');
const {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_WINDOW_MS,
  LOCKOUT_WINDOW_MINUTES,
  checkLoginLockout,
  recordFailedLogin,
  clearLoginAttempts,
  normalizeLoginEmail,
} = require('../backend/middleware/login-lockout.js');

const ROOT = path.join(__dirname, '..');
const OWNER_EMAIL = 'owner@example.com';
const OTHER_EMAIL = 'other@example.com';
const CORRECT_PASSWORD = 'correct horse battery staple';
const WRONG_PASSWORD = 'definitely not the password';
const WORKER_URL = 'http://localhost';

// Fake D1: only the queries auth.js + login-lockout.js issue.
// Anything else (e.g. the rate_limits table the rate limiter probes)
// throws, which the rate limiter treats as "no D1 table" and falls
// back to its in-memory store — same as the real Worker would.
// opts.noLoginAttemptsTable simulates the code deployed BEFORE
// migration 031 is applied: every login_attempts query throws, and
// the lockout must fail OPEN (login still works, never 429).
function makeFakeD1(opts = {}) {
  const sessions = new Map(); // tokenHash -> { owner_email, expires_at, created_at }
  const attempts = new Map(); // email -> { email, failed_count, first_failed_at, last_failed_at, locked_until }
  return {
    _sessions: sessions,
    _attempts: attempts,
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
              if (q.startsWith('SELECT email, failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts')) {
                if (opts.noLoginAttemptsTable) throw new Error('no such table: login_attempts');
                const row = attempts.get(params[0]);
                return { results: row ? [{ ...row }] : [] };
              }
              throw new Error('fake D1: unsupported SELECT: ' + q);
            },
            async run() {
              if (q.startsWith('INSERT INTO sessions')) {
                const [tokenHash, ownerEmail, expiresAt, createdAt] = params;
                sessions.set(tokenHash, { owner_email: ownerEmail, expires_at: expiresAt, created_at: createdAt });
                return { success: true, meta: { changes: 1, last_row_id: 0 } };
              }
              if (q.startsWith('DELETE FROM sessions')) {
                sessions.delete(params[0]);
                return { success: true };
              }
              if (q.startsWith('INSERT INTO login_attempts')) {
                if (opts.noLoginAttemptsTable) throw new Error('no such table: login_attempts');
                const [email, failed_count, first_failed_at, last_failed_at, locked_until] = params;
                attempts.set(email, { email, failed_count, first_failed_at, last_failed_at, locked_until });
                return { success: true, meta: { changes: 1, last_row_id: 0 } };
              }
              if (q.startsWith('DELETE FROM login_attempts WHERE email = ?')) {
                if (opts.noLoginAttemptsTable) throw new Error('no such table: login_attempts');
                const existed = attempts.delete(params[0]);
                return { success: true, meta: { changes: existed ? 1 : 0, last_row_id: 0 } };
              }
              throw new Error('fake D1: unsupported statement: ' + q);
            },
          };
        },
      };
    },
  };
}

async function makeEnv(opts) {
  const env = { DB: makeFakeD1(opts), SESSION_SECRET: 'test-session-secret-for-b3-tests' };
  env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
  return env;
}

// Every test uses its own client IP: the Worker's global rate limiter
// (30/min POST per IP, in-memory fallback here) is shared per process,
// so distinct IPs keep the B3 login bursts out of each other's bucket.
let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return `10.3.0.${ipSeq}`;
}

function loginRequest(email, password, ip) {
  return new Request(`${WORKER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email, password }),
  });
}

async function loginOk(env, ip) {
  const res = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
  assert.equal(res.status, 200, 'login must succeed for the token tests: ' + res.status);
  const body = await res.json();
  assert.ok(body.token, 'login must return a token');
  return body.token;
}

// Fail the same address MAX_FAILED_ATTEMPTS times through the route.
async function failTimes(env, email, n, ip) {
  for (let i = 0; i < n; i++) {
    const res = await handleRequest(loginRequest(email, WRONG_PASSWORD, ip), env);
    assert.equal(res.status, 401, `failure ${i + 1} must be 401`);
  }
}

describe('B3 constants', () => {
  it('pins the lockout policy: 5 failures, 15-minute fixed window', () => {
    assert.equal(MAX_FAILED_ATTEMPTS, 5);
    assert.equal(LOCKOUT_WINDOW_MINUTES, 15);
    assert.equal(LOCKOUT_WINDOW_MS, 15 * 60 * 1000);
  });

  it('normalizes the lockout key (trim + lowercase)', () => {
    assert.equal(normalizeLoginEmail('  Owner@Example.COM '), 'owner@example.com');
  });
});

describe('B3 login lockout through the route', () => {
  it('5 wrong attempts then a correct one: the 5th is still 401, the 6th is 429 with Retry-After', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    await failTimes(env, OWNER_EMAIL, MAX_FAILED_ATTEMPTS, ip);
    const res = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(res.status, 429, 'a correct password during the window must still be rejected');
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /too many failed/i);
    assert.ok(!body.error.includes(OWNER_EMAIL), 'the 429 must not reveal the email');
    assert.ok(typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds > 0, 'retryAfterSeconds must be positive');
    assert.ok(body.retryAfterSeconds <= LOCKOUT_WINDOW_MS / 1000, 'retryAfterSeconds must not exceed the 15-minute window');
    assert.equal(res.headers.get('Retry-After'), String(body.retryAfterSeconds), 'Retry-After header must match the body');
    // The lock is real: the stored window ends ~15 minutes from the 5th failure.
    const row = env.DB._attempts.get(OWNER_EMAIL);
    assert.ok(row, 'a lockout row must exist');
    assert.equal(row.failed_count, MAX_FAILED_ATTEMPTS);
    const remainingMs = Date.parse(row.locked_until) - Date.now();
    assert.ok(remainingMs > 14 * 60 * 1000 && remainingMs <= 15 * 60 * 1000, 'locked_until must be ~15 minutes out, got ' + remainingMs + ' ms');
  });

  it('a correct login clears the failure count (one later failure starts at 1)', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    await failTimes(env, OWNER_EMAIL, 3, ip);
    assert.equal(env.DB._attempts.get(OWNER_EMAIL).failed_count, 3);
    const ok = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(ok.status, 200);
    assert.equal(env.DB._attempts.has(OWNER_EMAIL), false, 'success must delete the lockout row');
    const bad = await handleRequest(loginRequest(OWNER_EMAIL, WRONG_PASSWORD, ip), env);
    assert.equal(bad.status, 401);
    assert.equal(env.DB._attempts.get(OWNER_EMAIL).failed_count, 1, 'the count restarts at 1 after a success');
  });

  it('(a) an expired lock lets the correct password in; a live lock does not', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    // Expired 1 minute ago: login must succeed.
    env.DB._attempts.set(OWNER_EMAIL, {
      email: OWNER_EMAIL, failed_count: 5,
      first_failed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      last_failed_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      locked_until: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    const expired = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(expired.status, 200, 'an expired lock must not block login');
    // Live for 14 more minutes: even the correct password is rejected.
    env.DB._attempts.set(OWNER_EMAIL, {
      email: OWNER_EMAIL, failed_count: 5,
      first_failed_at: new Date(Date.now() - 60 * 1000).toISOString(),
      last_failed_at: new Date(Date.now() - 60 * 1000).toISOString(),
      locked_until: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
    });
    const live = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(live.status, 429, 'a live lock must reject even the correct password');
  });

  it('(b) the documented manual unlock (the doc\'s DELETE) restores login immediately', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    await failTimes(env, OWNER_EMAIL, MAX_FAILED_ATTEMPTS, ip);
    const locked = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(locked.status, 429, 'must be locked before the unlock');
    // This is the exact statement docs/CLOSEOUT-B3-OWNER-UNLOCK-2026-11-23.md
    // tells the operator to run (email bound as the parameter).
    const del = await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(OWNER_EMAIL).run();
    assert.equal(del.meta.changes, 1, 'the unlock DELETE must remove the row');
    assert.equal(env.DB._attempts.has(OWNER_EMAIL), false);
    const after = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(after.status, 200, 'login must succeed immediately after the manual unlock');
    // The exported clear function is the same DELETE, for operators
    // (and the success path) that call it in code.
    await failTimes(env, OWNER_EMAIL, MAX_FAILED_ATTEMPTS, ip);
    const cleared = await clearLoginAttempts(env, OWNER_EMAIL);
    assert.equal(cleared.ok, true);
    assert.equal(cleared.cleared, 1);
    const afterClear = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(afterClear.status, 200);
  });

  it('(c) an existing valid session still works during the lockout', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    const token = await loginOk(env, ip);
    await failTimes(env, OWNER_EMAIL, MAX_FAILED_ATTEMPTS, ip);
    const locked = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(locked.status, 429, 'login must be locked');
    const me = await handleRequest(new Request(`${WORKER_URL}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': ip },
    }), env);
    assert.equal(me.status, 200, 'a pre-lockout session must still work during the lockout');
    assert.equal((await me.json()).owner, OWNER_EMAIL);
  });

  it('(d) attempts inside the window do NOT extend it (route level)', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    env.DB._attempts.set(OWNER_EMAIL, {
      email: OWNER_EMAIL, failed_count: 5,
      first_failed_at: new Date(Date.now() - 60 * 1000).toISOString(),
      last_failed_at: new Date(Date.now() - 60 * 1000).toISOString(),
      locked_until: lockedUntil,
    });
    const res = await handleRequest(loginRequest(OWNER_EMAIL, WRONG_PASSWORD, ip), env);
    assert.equal(res.status, 429, 'an attempt inside the window is rejected');
    const row = env.DB._attempts.get(OWNER_EMAIL);
    assert.equal(row.locked_until, lockedUntil, 'the window must not move');
    assert.equal(row.failed_count, 5, 'no new failure may be recorded inside the window');
  });

  it('the lockout key is the submitted email: mixed case locks the same key, another email is unaffected', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    await failTimes(env, 'Owner@Example.COM', MAX_FAILED_ATTEMPTS, ip);
    assert.equal(env.DB._attempts.has(OWNER_EMAIL), true, 'mixed-case failures must land on the lowercased key');
    const locked = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(locked.status, 429);
    const other = await handleRequest(loginRequest(OTHER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(other.status, 200, 'a different email string is a different key and is not locked');
  });

  it('wrong-password failures keep the exact pre-B3 401 body', async () => {
    const env = await makeEnv();
    const ip = nextIp();
    const res = await handleRequest(loginRequest(OWNER_EMAIL, WRONG_PASSWORD, ip), env);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'Invalid email or password.');
  });
});

describe('B3 fail-open: the owner is never locked out by a missing store', () => {
  it('with no D1 bound, any number of failures stays 401 and the correct password still logs in', async () => {
    const env = { SESSION_SECRET: 'test-session-secret-for-b3-tests' };
    env.OWNER_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    const ip = nextIp();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i++) {
      const res = await handleRequest(loginRequest(OWNER_EMAIL, WRONG_PASSWORD, ip), env);
      assert.equal(res.status, 401, `failure ${i + 1} with no D1 must be 401, never 429`);
    }
    const ok = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(ok.status, 200, 'login with no D1 must succeed');
  });

  it('with the login_attempts table missing (code before migration 031), login works normally', async () => {
    const env = await makeEnv({ noLoginAttemptsTable: true });
    const ip = nextIp();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 1; i++) {
      const res = await handleRequest(loginRequest(OWNER_EMAIL, WRONG_PASSWORD, ip), env);
      assert.equal(res.status, 401, `failure ${i + 1} with no table must be 401, never 429`);
    }
    const ok = await handleRequest(loginRequest(OWNER_EMAIL, CORRECT_PASSWORD, ip), env);
    assert.equal(ok.status, 200, 'login with the table missing must succeed');
  });

  it('module level: a throwing store fails open on check and record', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    };
    const env = { DB: throwingDb };
    const check = await checkLoginLockout(env, OWNER_EMAIL);
    assert.equal(check.locked, false);
    const record = await recordFailedLogin(env, OWNER_EMAIL);
    assert.equal(record.locked, false);
    assert.equal(record.recorded, false);
    const clear = await clearLoginAttempts(env, OWNER_EMAIL);
    assert.equal(clear.ok, false, 'a failed clear reports ok:false (callers ignore it)');
  });
});

describe('B3 (d) module level with an injected clock: the window never self-extends', () => {
  it('failures at window-start + 14 min do not move the unlock time; the key unlocks at +15 min', async () => {
    const env = await makeEnv();
    const key = OWNER_EMAIL;
    const t0 = Date.now();
    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      last = await recordFailedLogin(env, key, t0 + i * 1000);
    }
    assert.equal(last.locked, true, 'the 5th failure locks the key');
    const lockedUntil = last.lockedUntil;
    assert.ok(Math.abs(Date.parse(lockedUntil) - (t0 + 4 * 1000 + LOCKOUT_WINDOW_MS)) < 1000, 'locked_until must be 15 minutes after the locking failure');
    // Failures inside the window: rejected, nothing recorded, window unmoved.
    const inside = await recordFailedLogin(env, key, t0 + 14 * 60 * 1000);
    assert.equal(inside.locked, true);
    assert.equal(inside.recorded, false, 'a failure inside the window must not be recorded');
    assert.equal(inside.lockedUntil, lockedUntil, 'the window must not move');
    const row = env.DB._attempts.get(key);
    assert.equal(row.locked_until, lockedUntil);
    assert.equal(row.failed_count, 5);
    // One second past the window: unlocked. (The locking failure was
    // at t0 + 4 s — the 5th of t0 + i*1000 — so the window ends at
    // t0 + 15 min + 4 s, not t0 + 15 min.)
    const after = await checkLoginLockout(env, key, t0 + 15 * 60 * 1000 + 5000);
    assert.equal(after.locked, false, 'the key must unlock at window-start + 15 minutes');
    // And the next failure after expiry restarts the count at 1 — the
    // old count never re-locks the key on its own.
    const fresh = await recordFailedLogin(env, key, t0 + 15 * 60 * 1000 + 5000);
    assert.equal(fresh.locked, false);
    assert.equal(env.DB._attempts.get(key).failed_count, 1);
    assert.equal(env.DB._attempts.get(key).locked_until, null);
  });
});

// --- Real SQLite: migration 031 applies and the real SQL runs. ---

function splitSql(text) {
  const stmts = [];
  let cur = '', inStr = false, inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inComment) {
      if (ch === '\n') { inComment = false; cur += ch; }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { cur += ch; stmts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts.filter((s) => s.trim());
}

function makeRealD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (params) => ({
        all: () => Promise.resolve({ results: stmt.all(...params) }),
        run: () => Promise.resolve((() => {
          const r = stmt.run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        })()),
      });
      return {
        bind: (...params) => bound(params),
        all: () => bound([]).all(),
        run: () => bound([]).run(),
      };
    },
  };
}

describe('B3 migration 031 against real SQLite', () => {
  let db;
  let env;

  before(() => {
    db = new DatabaseSync(':memory:');
    const text = fs.readFileSync(path.join(ROOT, 'database/migrations/031_login_attempts.sql'), 'utf8');
    for (const stmt of splitSql(text)) db.exec(stmt);
    env = { DB: makeRealD1(db) };
  });

  it('creates the login_attempts table with exactly the B3 columns and no password/IP column', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'login_attempts'").get();
    assert.ok(table, 'login_attempts exists after migration 031');
    const cols = db.prepare('PRAGMA table_info(login_attempts)').all().map((c) => c.name);
    assert.deepEqual(cols, ['email', 'failed_count', 'first_failed_at', 'last_failed_at', 'locked_until']);
    for (const banned of ['password', 'password_hash', 'ip', 'ip_address', 'user_agent']) {
      assert.ok(!cols.includes(banned), `no ${banned} column may exist`);
    }
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_login_attempts_locked'").get();
    assert.ok(idx, 'locked_until index exists');
  });

  it('the real UPSERT locks after 5 failures, and the real DELETE unlocks', async () => {
    const key = OWNER_EMAIL;
    const t0 = Date.now();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      const r = await recordFailedLogin(env, key, t0 + i * 1000);
      if (i < MAX_FAILED_ATTEMPTS - 1) assert.equal(r.locked, false);
    }
    const check = await checkLoginLockout(env, key, t0 + 5000);
    assert.equal(check.locked, true);
    assert.ok(check.retryAfterSeconds > 0 && check.retryAfterSeconds <= 900);
    const stored = db.prepare('SELECT failed_count, locked_until FROM login_attempts WHERE email = ?').get(key);
    assert.equal(stored.failed_count, 5);
    assert.ok(Math.abs(Date.parse(stored.locked_until) - (t0 + 4000 + LOCKOUT_WINDOW_MS)) < 1000);
    const cleared = await clearLoginAttempts(env, key);
    assert.equal(cleared.ok, true);
    assert.equal(cleared.cleared, 1);
    const gone = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?').get(key);
    assert.equal(gone.n, 0, 'the unlock DELETE must remove the row');
    assert.equal((await checkLoginLockout(env, key, t0 + 5000)).locked, false);
  });
});
