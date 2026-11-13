ALTER TABLE articles ADD COLUMN publish_at TEXT;
CREATE TABLE IF NOT EXISTS article_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT,
    excerpt TEXT,
    body TEXT,
    status TEXT,
    revised_by TEXT,
    revised_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_revisions_article ON article_revisions(article_id);
ALTER TABLE ai_agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled'));
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
