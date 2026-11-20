-- FS AI migration 017 - stable claim identity + failure reasons on article_corrections
-- Phase 3, Priorities 2 + 5.
--
-- claim_key: stable identity for a claim across fact-check runs
-- (claimKey() in backend/agents/autonomy/factcheck.js: citation
-- prefix stripped, lower-cased, whitespace collapsed, first 200
-- chars). Two fact-check runs generate different claim_check ids for
-- the same claim text, so identity must be the TEXT, never the id —
-- the old attempts count used claim_check_id, which reset to 0 on
-- every re-check and let a second correction run write duplicate rows
-- for the same claim (live article #30: 11 rows / 6 distinct claims).
--
-- failure_reason: machine-readable reason for a failed correction
-- attempt ('truncated-reply', 'validation-rejected',
-- 'rewrite-rejected', 'rewrite-error', 'rewrite-circuit-open',
-- 'sentence-not-found', 'context-dangling'). The dashboard derives
-- human text from it (deriveFailureReason in orchestrator.js).
--
-- Backfill: claim_key from original_text. Stored original_text was
-- already whitespace-normalised by extractClaims, so
-- lower(trim(substr(...,1,200))) matches claimKey() for every
-- realistic row; a text starting with a bracketed citation label
-- keeps the prefix in the backfilled key (plain SQL cannot strip it)
-- but the key is still stable and unique per claim. New rows written
-- by the code use the exact claimKey().
--
-- Partial unique index: at most one PENDING row per (article, claim).
-- 'failed' rows are deliberately NOT covered — history is preserved
-- (a claim may fail, be retried and fail again; recordCorrection()
-- updates the open row in place instead of inserting a second one).
-- Safe: live D1 has ZERO pending rows (verified 2026-11-20: 7 applied
-- / 12 failed / 12 removed), so the index cannot conflict with
-- existing data. Rollback: DROP INDEX idx_corrections_claim_pending
-- (and the plain index); the columns are inert without the code.
ALTER TABLE article_corrections ADD COLUMN claim_key TEXT;
ALTER TABLE article_corrections ADD COLUMN failure_reason TEXT;
UPDATE article_corrections SET claim_key = lower(trim(substr(original_text, 1, 200))) WHERE claim_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_claim_pending
  ON article_corrections(article_id, claim_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_corrections_claim_key ON article_corrections(article_id, claim_key);
