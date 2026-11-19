ALTER TABLE article_sources ADD COLUMN research_item_id INTEGER REFERENCES research_items(id);
CREATE INDEX IF NOT EXISTS idx_article_sources_research_item ON article_sources(research_item_id);
ALTER TABLE article_corrections ADD COLUMN evidence_url TEXT;
