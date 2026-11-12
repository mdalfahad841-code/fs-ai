CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
