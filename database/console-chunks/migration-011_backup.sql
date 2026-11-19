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
