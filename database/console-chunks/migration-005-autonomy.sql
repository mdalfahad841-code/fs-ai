CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    division_id INTEGER REFERENCES business_divisions(id),
    priority INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    idempotency_key TEXT NOT NULL UNIQUE,
    scheduled_for TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, priority, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent, status);
CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES agent_tasks(id),
    agent TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('done','no-op','failed','skipped')),
    detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent, started_at);
CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES agent_runs(id),
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_logs_run ON agent_logs(run_id);
CREATE TABLE IF NOT EXISTS autonomy_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily','weekly')),
    summary_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date, kind);
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('autonomy_level', '3');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('autonomy_target', '3');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('publishing_mode', 'approved_only');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('max_articles_per_day', '1');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('social_auto_post', 'off');
INSERT OR IGNORE INTO autonomy_settings (key, value) VALUES ('llm_provider', 'none');
