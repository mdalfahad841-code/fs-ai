-- FS AI migration 015 - correction review resolutions
-- Formalises the correction_resolutions table that the review endpoint
-- (POST /api/autonomy/corrections/:id/resolve) previously created lazily
-- with CREATE TABLE IF NOT EXISTS. One row per owner resolution action;
-- the original article_corrections row is never deleted and its original
-- status is preserved in previous_status, so the full audit trail
-- survives. Additive only: one new table + one index. No existing data
-- is changed. Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF
-- NOT EXISTS, safe to re-run.
CREATE TABLE IF NOT EXISTS correction_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correction_id INTEGER NOT NULL REFERENCES article_corrections(id),
  article_id INTEGER NOT NULL REFERENCES articles(id),
  resolution TEXT NOT NULL,
  note TEXT,
  previous_status TEXT,
  new_status TEXT,
  corrected_text TEXT,
  verification_verdict TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_correction_resolutions_correction ON correction_resolutions(correction_id);
