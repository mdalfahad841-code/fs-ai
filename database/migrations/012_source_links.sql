-- FS AI migration 012 - article-source links (evidence isolation)
-- Links each article_sources row to the exact research_items row it
-- came from, so fact-checking and correction can use ONLY the
-- article's own recorded sources (never the whole division pool).
-- Additive only: one nullable column + one index. No data is changed
-- or deleted. Existing rows keep research_item_id NULL and are
-- resolved by source_url at read time.
-- Also used by migration 012's companion fix: article_corrections
-- gains evidence_url so every correction records the source that
-- supported the change (NULL for removals, which use no source).

ALTER TABLE article_sources ADD COLUMN research_item_id INTEGER REFERENCES research_items(id);
CREATE INDEX IF NOT EXISTS idx_article_sources_research_item ON article_sources(research_item_id);

ALTER TABLE article_corrections ADD COLUMN evidence_url TEXT;
