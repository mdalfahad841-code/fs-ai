CREATE TABLE IF NOT EXISTS rss_fetch_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES research_sources(id),
    feed_url TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    execution_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'daily-workflow')),
    items_discovered INTEGER NOT NULL DEFAULT 0,
    items_inserted INTEGER NOT NULL DEFAULT 0,
    duplicates_skipped INTEGER NOT NULL DEFAULT 0,
    errors TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial', 'skipped-overlap')),
    UNIQUE (execution_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_audit_source_started ON rss_fetch_audit(source_id, started_at);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_audit_execution ON rss_fetch_audit(execution_id);
