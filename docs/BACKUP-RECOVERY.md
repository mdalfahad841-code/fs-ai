# FS AI — Backup & Recovery

## What the backup is

`GET /api/admin/backup` (owner session required) returns a JSON export of
the CMS and agent data:

- `exported_at` — UTC timestamp of the export.
- `tables` — row arrays for: `articles`, `article_revisions`,
  `business_divisions`, `categories`, `article_tags`,
  `newsletter_subscribers`, `ai_agents`, `agent_activity_logs`,
  `automation_jobs`, `revenue_records`, `website_settings`.
- `counts` — the number of rows exported per table.
- `warnings` — per-table read problems, if any (a table that could not be
  read exports as an empty array instead of failing the whole export).

Row caps: 1000 rows per table, except `agent_activity_logs` and
`automation_jobs`, which are capped at the latest 500 rows each.

**This export is JSON, not a D1-native backup.** There is no automatic
restore, no scheduled backup, and no point-in-time recovery on the free
tier. The restore procedure below is manual and untested live — it has
only been exercised against a local SQLite copy of the schema.

## How to download the export (from the Command Center)

1. Sign in to the Command Center as the owner.
2. Open the Backup section (or, until the dashboard button exists, call
   the endpoint directly from the browser console while signed in):
   `fetch('/api/admin/backup', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())`
   where `token` is the owner session token stored by the dashboard.
3. Save the returned JSON to a file, e.g. `fs-ai-backup-YYYY-MM-DD.json`,
   and keep a copy somewhere other than this machine.

Only the owner can download it: the endpoint requires a valid owner
session (`requireOwner`). The export contains no passwords, password
hashes, or session tokens — those live only in Worker secrets and the
`sessions` table, which are deliberately NOT included in the export.

## Manual recovery procedure

If the D1 database `fs-ai-db` is lost or corrupted:

1. Create a fresh D1 database in the Cloudflare dashboard (free tier)
   and note its new `database_id`.
2. Update `database_id` in `config/wrangler.toml` to the new database.
3. Re-apply the schema and seed, in order, via the D1 Console
   (paste each file's contents and run it):
   1. `database/schema.sql`
   2. `database/seed.sql`
   3. `database/console-chunks/migration-003-sessions.sql`
   4. `database/console-chunks/migration-004-cms-newsletter.sql`
   (Migration 001/002 are the same tables as `schema.sql` in a different
   split; do not apply both paths — use schema.sql, then 003, then 004.)
4. Re-import the exported rows. There is no automated importer: for each
   table in the export, run `INSERT` statements for its rows in the D1
   Console, in this dependency order so foreign keys resolve:
   `website_settings` → `business_divisions` → `categories` →
   `ai_agents` → `articles` → `article_revisions` → `article_tags` →
   `newsletter_subscribers` → `agent_activity_logs` →
   `automation_jobs` → `revenue_records`.
   Keep the original `id` values in the INSERTs so the links between
   tables (e.g. `articles.division_id`) stay correct.
5. Re-verify: `GET /api/health` must report `"db": "connected"`, the
   public article list must show the restored articles, and the owner
   must sign in again (sessions are not restored — everyone signs in
   fresh with the owner password).
6. Redeploy the Worker if the `database_id` changed
   (`npm run deploy` from the repo, or redeploy from the dashboard).

## What is NOT backed up

- Owner password hash and session secret (Worker secrets — re-set them
  in the Cloudflare dashboard if they are lost).
- `owner_accounts`, `user_sessions`, `sessions` (login accounts and
  sessions — the owner account is re-created by the secure setup flow).
- `security_events`, `approval_records`, `research_records`,
  `agent_permissions`, `keywords`, `article_sources`,
  `monetization_accounts`, `affiliate_links`, `expense_records`,
  `website_analytics`, `digital_tools` — these tables are not in the
  export yet. If any of them start holding data the owner cares about,
  add them to `BACKUP_TABLES` in `backend/routes/admin.js`.
- The static frontend (Cloudflare Pages) and the GitHub repository —
  those are versioned separately and are not part of this export.

## Honest limits

- Revenue in the export is the real D1 `revenue_records` ledger, which
  is $0.00 until a real, verified revenue source exists.
- Analytics in the export is whatever is in D1. Traffic is
  "Data unavailable" unless a real analytics source is connected —
  the export never invents visitors, clicks, or earnings.
- A backup that has never been restore-tested live is a hope, not a
  guarantee. Test the restore on a throwaway D1 database before
  relying on it.
