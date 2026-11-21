-- FS AI migration 020 - task lifecycle terminal states + daily self-health checks.
--
-- Part A — task lifecycle (workstream W1, 2026-11-21).
-- The daily workflow never drained the queue, so tasks sat 'queued'
-- forever with no terminal outcome. Every task must now reach exactly
-- one terminal state:
--   COMPLETED, RETRYING, WAITING_FOR_AUTHORIZATION,
--   BLOCKED_WITH_REASON, FAILED_FINAL_WITH_RECOVERY_REPORT.
-- Design choice: three additive columns on agent_tasks (no new task
-- table, no status CHECK change — the existing status CHECK
-- ('queued','running','done','failed','skipped') is untouched, so
-- every pre-020 row and query keeps working). The full history stays
-- in agent_runs / agent_logs, which are never deleted; a task that
-- exhausts retries goes FAILED_FINAL, stays visible, and is never
-- retried automatically — only an explicit owner retryTask() clears
-- the terminal state (attempts reset to 0) and re-queues it.
--   terminal_state  — one of the five states above, NULL until resolved.
--   terminal_reason — human-readable reason for the terminal state.
--   last_error      — last failure message (truncated by the writer).
-- Safe: additive columns only, all NULL by default. Existing rows keep
-- NULL terminal_state, which code treats as "unresolved (legacy row)".
-- Rollback: leave the columns (inert — code falls back to the old
-- status-only behaviour when they are absent).
ALTER TABLE agent_tasks ADD COLUMN terminal_state TEXT
  CHECK (terminal_state IS NULL OR terminal_state IN (
    'COMPLETED', 'RETRYING', 'WAITING_FOR_AUTHORIZATION',
    'BLOCKED_WITH_REASON', 'FAILED_FINAL_WITH_RECOVERY_REPORT'));
ALTER TABLE agent_tasks ADD COLUMN terminal_reason TEXT;
ALTER TABLE agent_tasks ADD COLUMN last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_terminal ON agent_tasks(terminal_state);

-- Part B — daily self-health check results (workstream W1, 2026-11-21).
-- One row per component per check run, written by
-- backend/services/healthcheck.js runHealthCheck(). The dashboard reads
-- the latest rows (see the interface contract in the W1 report).
--   checked_at  — ISO timestamp of the check run (UTC).
--   component   — worker | database | emergency-stop | queue |
--                 workers-ai | accounts | publishing | social |
--                 free-tier | backup.
--   status      — healthy | degraded | blocked | not-configured.
--   detail_json — JSON object with the evidence for the status
--                 (counts, timestamps, caps, error text).
CREATE TABLE IF NOT EXISTS system_health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    component TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'blocked', 'not-configured')),
    detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_health_checks_checked ON system_health_checks(checked_at, component);
