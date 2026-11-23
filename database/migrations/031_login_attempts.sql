-- 031_login_attempts.sql — Failed-login counting + lockout (2026-11-23, close-out B3)
--
-- Purpose: D1-backed failed-login counting for POST /api/auth/login.
-- After 5 failed attempts for one email address the login for that
-- address is rejected with 429 for a fixed 15 minutes. The window is
-- strictly time-bounded and NEVER self-extending: attempts inside the
-- window are rejected without recording new failures, so an attacker
-- cannot keep the owner locked out by failing once every few minutes.
-- A correct-password login clears the row; an already-signed-in
-- session keeps working throughout (requireOwner never consults this
-- table). See docs/CLOSEOUT-B3-OWNER-UNLOCK-2026-11-23.md for the
-- owner unlock procedure.
--
-- Privacy boundary (hard rule): a row stores ONLY the lowercased
-- email key, the failure count and three timestamps. No password, no
-- password hash, no IP address, no user agent, no session data — ever.
-- The lockout key is the submitted email (lowercased): the login flow
-- checks no stored owner email, so an attacker can only lock out the
-- exact email string they attack.
--
-- Fail-open: if this table is missing (code deployed before the
-- migration is applied) or D1 is unavailable, the login route treats
-- the lockout as absent and login proceeds normally — the owner is
-- never locked out by a missing store. The global rate limiter
-- (30/min POST per IP) still applies on top.
--
-- Safe to apply with the standard db:migrate flow. It touches no
-- existing row and no existing table: one new table + one index.
-- Rollback: DROP TABLE login_attempts (login then proceeds with no
-- lockout, exactly as before B3).

CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at TEXT,
  locked_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts(locked_until);
