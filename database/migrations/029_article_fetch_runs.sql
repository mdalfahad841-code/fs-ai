-- 029_article_fetch_runs.sql — Full-article evidence fetching (2026-11-22)
--
-- Purpose: the research engine could only learn from RSS summaries.
-- Articles whose sources left the feed (#29 Austin, #30 NYC) could
-- never be regenerated or properly fact-checked. The fetcher
-- (backend/services/article-fetch.js) retrieves ONE recorded source
-- page for a draft article, extracts its readable text, and stores it
-- as a research_items row for that URL, so the existing evidence flows
-- (resolveEvidence, loadEvidence) use it unchanged.
--
-- This migration adds:
-- * article_fetch_runs — one row per fetch attempt, success or failure,
--   the audit trail (URL, final URL, HTTP status, robots verdict,
--   extraction status + reason, extracted chars, content hash,
--   retrieval time). Never the evidence itself.
-- * research_items.source_kind ('rss' | 'article-fetch'), content_hash,
--   extraction_status — provenance for fetched evidence.
--
-- Copyright boundary: fetched text is evidence for internal verification
-- only, never republished verbatim. The publish gate still requires
-- owner approval.
--
-- Safe to apply with the standard db:migrate flow. It touches no
-- existing row: existing research_items rows get source_kind 'rss'
-- and NULL content_hash / extraction_status.
-- Rollback: DROP TABLE article_fetch_runs, and (SQLite cannot drop
-- columns) leave the three research_items columns in place — they are
-- nullable and ignored by older code.

CREATE TABLE IF NOT EXISTS article_fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id),
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  http_status INTEGER,
  final_url TEXT,
  robots_allowed INTEGER,
  robots_crawl_delay_seconds INTEGER,
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('ok', 'incomplete', 'failed')),
  extraction_reason TEXT,
  extracted_chars INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  research_item_id INTEGER REFERENCES research_items(id),
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fetch_runs_host ON article_fetch_runs(host, fetched_at);
CREATE INDEX IF NOT EXISTS idx_fetch_runs_article ON article_fetch_runs(article_id, fetched_at);
CREATE INDEX IF NOT EXISTS idx_fetch_runs_url ON article_fetch_runs(url, fetched_at);
ALTER TABLE research_items ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'rss' CHECK (source_kind IN ('rss', 'article-fetch'));
ALTER TABLE research_items ADD COLUMN content_hash TEXT;
ALTER TABLE research_items ADD COLUMN extraction_status TEXT CHECK (extraction_status IN ('ok', 'incomplete', 'failed'));
