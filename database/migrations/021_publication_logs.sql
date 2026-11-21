-- FS AI migration 021 - publication logs (autonomous publishing audit trail).
--
-- publication_logs records EVERY publish attempt — success and refusal —
-- so an automatic publish can never happen silently and a refusal can
-- never vanish. Rows are append-only: nothing in the codebase deletes
-- them (no DELETE exists for this table; keep it that way).
--
-- Columns:
--   action: 'auto-publish' (system published the article),
--           'auto-publish-refused' (eligibility failed — gate_verdict_json
--           carries the per-check verdict + reasons),
--           'manual-publish' (reserved for a future owner-publish log
--           entry from the manual path; not written by this migration's
--           code yet), 'publish-rollback' (a publish whose log write
--           failed and was rolled back — see autoPublishArticle).
--   actor: 'system-auto' | 'owner'.
--   gate_verdict_json: the full evaluateAutoPublishEligibility verdict
--           (checks + blockedBy) at attempt time.
--   published_at: set only on a successful publish.
--   sitemap_updated: 1 when the publish regenerated the sitemap XML
--           (the regenerated XML itself is returned to the caller — the
--           Worker cannot rewrite the checked-in public/sitemap.xml at
--           runtime; the deploy step writes it — see
--           backend/agents/autonomy/publishing.js regenerateSitemap).
--
-- auto_publish_eligible_since: NOT seeded here on purpose. The
-- autonomy_settings.value column is NOT NULL, so "unset" is represented
-- by the ABSENCE of the row, which the eligibility evaluator reads as
-- NULL — nothing is auto-publish-eligible until the owner deliberately
-- sets the timestamp (see backend/publishing/gate.js
-- AUTO_PUBLISH_CUTOFF_SETTING). Only articles created after that
-- timestamp can ever auto-publish; drafts #28/#29/#30/#31 are refused
-- unconditionally by id as well.
--
-- Safe: additive table + index only. No existing data is changed.
-- Rollback: leave the table (inert — autoPublishArticle refuses to
-- publish when the table is missing, so a dropped table fails closed).
CREATE TABLE IF NOT EXISTS publication_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id        INTEGER NOT NULL REFERENCES articles(id),
    action            TEXT NOT NULL CHECK (action IN ('auto-publish', 'auto-publish-refused', 'manual-publish', 'publish-rollback')),
    actor             TEXT NOT NULL CHECK (actor IN ('system-auto', 'owner')),
    gate_verdict_json TEXT NOT NULL DEFAULT '{}',
    published_at      TEXT,
    sitemap_updated   INTEGER NOT NULL DEFAULT 0 CHECK (sitemap_updated IN (0, 1)),
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_publication_logs_article ON publication_logs(article_id, created_at);
