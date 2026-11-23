-- 030_csp_reports.sql — CSP violation reports (2026-11-23, close-out A4)
--
-- Purpose: the Pages CSP ships Report-Only (frontend/_headers) and now
-- names a report-uri (POST /api/csp-report on the Worker). Browsers send
-- one report per blocked resource; this table is the audit trail the
-- owner dashboard shows as 7-day counts per directive, and the evidence
-- base for the enforcement decision (see
-- docs/CLOSEOUT-A4-CSP-ENFORCEMENT-RULE-2026-11-23.md).
--
-- Privacy boundary (hard rule): a report row stores ONLY the violated
-- directive name, the blocked URL, the document URL and the timestamp.
-- No IP address, no user agent, no raw report body, no cookies, no
-- session data — ever. The endpoint enforces this by extracting exactly
-- those four fields before inserting; the raw JSON is never stored.
--
-- Safe to apply with the standard db:migrate flow. It touches no
-- existing row and no existing table: one new table + two indexes.
-- Rollback: DROP TABLE csp_reports (the endpoint then answers 204
-- without storing, and the stats endpoint answers 503 until the
-- table is back — both degrade, neither breaks a page load).

CREATE TABLE IF NOT EXISTS csp_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  directive TEXT NOT NULL,
  blocked_uri TEXT,
  document_uri TEXT,
  reported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_csp_reports_directive ON csp_reports(directive, reported_at);
CREATE INDEX IF NOT EXISTS idx_csp_reports_reported ON csp_reports(reported_at);
