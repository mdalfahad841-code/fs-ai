-- FS AI migration 011 - backup runs
-- One row per backup export run (GET /api/admin/backup or the manual
-- "Run backup now" control). Records whether the export really
-- succeeded, how much it exported, and any error — so the dashboard
-- can show the last successful backup instead of 'unknown'.

CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running')),
    tables_exported INTEGER NOT NULL DEFAULT 0,
    rows_exported INTEGER NOT NULL DEFAULT 0,
    bytes_exported INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_backup_runs_created ON backup_runs(created_at);
