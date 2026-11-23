-- 032_article_publish_overrides.sql — Manual-publish override audit (2026-11-23, Fix Pass 2 item 1)
--
-- Purpose: every manual publish that overrides the publish gate
-- (typed confirmation phrase PUBLISH DESPITE GATE) is recorded here
-- BEFORE the article is published. The row is the accountability for
-- the override: who overrode, when, which article, and the FULL gate
-- result that was overridden (which checks failed, with details).
--
-- Why a new table (not article_deletion_audit): the deletion audit
-- records what was deleted; this table records a publish decision
-- that deliberately bypassed the quality gate. The two audits answer
-- different questions and are read by different reviews. The shape
-- follows article_deletion_audit (migration 025): identifying facts
-- kept on the row, owner email from the session, no body text.
--
-- Columns:
--   article_id / title / slug / division
--                         — what was published (kept on the row so
--                           the audit survives later edits/deletes).
--   published_by          — owner email from the session (auth.owner).
--   gate_result           — JSON of the manual-gate verdict at
--                           override time: contentReady, blockedBy
--                           (failed-check details), failedChecks,
--                           legacyProtected, emergencyStopOn, division.
--   human_review_applied  — 1 when the article's division is a
--                           special-review division (Health & Wellness
--                           or Finance & Money Education): typing the
--                           phrase IS the human review for those
--                           divisions, and the row records that it
--                           applied. 0 otherwise.
--   created_at            — override time (UTC, datetime('now')).
--
-- The override path FAILS CLOSED on a missing table: if this table
-- does not exist (code deployed before the migration is applied) the
-- audit INSERT throws and the publish is refused with 503 — an
-- unaudited override must never happen. The normal (non-override)
-- publish path never touches this table.
--
-- Safe to apply with the standard db:migrate flow. It touches no
-- existing row and no existing table: one new table + two indexes.
-- Rollback: DROP TABLE article_publish_overrides (the override path
-- then refuses every override with 503 until the table is back;
-- normal gate-passing publishes are unaffected).

CREATE TABLE IF NOT EXISTS article_publish_overrides (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id            INTEGER NOT NULL,
  title                 TEXT NOT NULL DEFAULT '',
  slug                  TEXT NOT NULL DEFAULT '',
  division              TEXT NOT NULL DEFAULT '',
  published_by          TEXT,
  gate_result           TEXT NOT NULL DEFAULT '',
  human_review_applied  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_publish_overrides_article ON article_publish_overrides(article_id, created_at);
CREATE INDEX IF NOT EXISTS idx_article_publish_overrides_created ON article_publish_overrides(created_at);
