-- FS AI migration 004 - CMS newsletter divisions admin agent control
-- Apply after schema.sql and migrations 001 to 003
-- Notes
-- website_settings already has a generic key value shape
-- setting_key is unique and setting_value is text
-- so the emergency stop flag uses key emergency_stop with value 1 or 0
-- and no new settings table is needed
-- article_revisions keeps a copy of an article before each owner edit
-- ai_agents gains a status column so pause resume and disable survive
-- a Worker restart
-- rate_limits lets the Worker rate limiter persist across isolates
-- instead of falling back to a per isolate in memory map
-- publish_at on articles drives scheduled publishing
-- approved articles with publish_at at or before now become published

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
