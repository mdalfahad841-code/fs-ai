-- FS AI migration 018 - verdict history on fact_checks / claim_checks
-- Phase 3, Priority 6 (verdict consistency).
--
-- fact_checks.check_kind: which kind of run produced the row —
-- 'initial' (first check), 'recheck' (manual per-article re-check),
-- 'correction-recheck' (the re-check at the end of a correction run).
-- fact_checks.evidence_signature: the research-item ids + fetch times
-- the run judged against ("id:fetched_at|id:fetched_at…", sorted).
-- A claim whose text is identical to a claim in the previous check AND
-- whose evidence signature is unchanged is carried forward with its
-- previous verdict instead of being re-judged by the non-deterministic
-- LLM entailment judge (live article #30: claim 8 flipped
-- UNSUPPORTED → VERIFIED with no correction saved).
-- claim_checks.previous_verdict: the verdict the same claim (by
-- claimKey) held in the previous fact-check, or NULL for a new claim —
-- so any flip is traceable in the audit trail.
--
-- Safe: additive columns only. Existing fact_checks rows keep
-- check_kind 'initial' and a NULL signature — NULL means "unknown",
-- and checkArticle never carries a verdict forward from a row with no
-- signature, so old rows can only ever be re-evaluated fresh. No
-- existing data is changed. Rollback: leave the columns (inert — code
-- falls back to the old column lists when they are absent).
ALTER TABLE fact_checks ADD COLUMN check_kind TEXT NOT NULL DEFAULT 'initial' CHECK (check_kind IN ('initial', 'recheck', 'correction-recheck'));
ALTER TABLE fact_checks ADD COLUMN evidence_signature TEXT;
ALTER TABLE claim_checks ADD COLUMN previous_verdict TEXT CHECK (previous_verdict IN ('VERIFIED', 'INCORRECT', 'UNSUPPORTED', 'OUTDATED', 'CONFLICTING', 'UNVERIFIABLE'));
