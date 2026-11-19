# FS AI — Backup & Recovery

## What the backup is

`GET /api/admin/backup` (owner session required) returns a JSON export of
the CMS and agent data:

- `exported_at` — UTC timestamp of the export.
- `tables` — full rows (every column) for 25 tables: `articles`,
  `article_revisions`, `article_sources`, `business_divisions`,
  `categories`, `article_tags`, `newsletter_subscribers`, `ai_agents`,
  `agent_activity_logs`, `agent_tasks`, `agent_runs`, `agent_logs`,
  `daily_reports`, `automation_jobs`, `autonomy_settings`, `llm_usage`,
  `research_sources`, `research_items`, `fact_checks`, `claim_checks`,
  `article_corrections`, `seo_checks`, `backup_runs`, `revenue_records`,
  `website_settings`.
  (Added 2026-11-19, master implementation: the 14 autonomy tables —
  sources, research items, fact-checks, claims, corrections, SEO checks,
  agent tasks/runs/logs, daily reports, autonomy settings, LLM usage,
  and the backup-runs history itself. `article_sources` was previously
  listed as not backed up; it is backed up now.)
- `counts` — the number of rows exported per table.
- `warnings` — per-table read problems, if any (a table that could not be
  read exports as an empty array instead of failing the whole export).

Row caps: 1000 rows per table, except `agent_activity_logs`,
`automation_jobs` and `agent_logs`, which are capped at the latest 500
rows each. Rows beyond the cap are NOT in the backup and are NOT
restored.

**This export is JSON, not a D1-native backup.** There is no automatic
restore, no scheduled backup, and no point-in-time recovery on the free
tier. The restore below is manual, driven by
`scripts/restore-backup.js`, and was verified end to end against a local
SQLite copy of the schema (see "Verification" below). It has NOT been
tested live against D1 — test it on a throwaway D1 database before
relying on it.

## Recording a backup run ("Run backup now")

`POST /api/admin/backup/run` (owner session required) runs the same
export and records it in `backup_runs` (migration 011): started/finished
timestamps, status (`success` / `failed`), tables/rows/bytes exported,
and the error if it failed. The dashboard's Backup section has a **Run
backup now** button for it, and `GET /api/autonomy/status` reports the
last successful run as `lastBackup` — before any run it is honestly
`null`, not "unknown".

If `backup_runs` does not exist yet (migration 011 not applied), the
export still succeeds; the run is simply not recorded and the response
carries a warning saying so. A run is marked `failed` only when
warnings exist AND zero rows were exported.

The export itself is still downloaded separately via
`GET /api/admin/backup` (see "How to download the export" below) —
"Run backup now" records the run; "Download backup (JSON)" saves the
file. Both are owner-only.

## How the restore works

A fresh database is built from `database/schema.sql` +
`database/seed.sql`, then the exported rows are replayed into it by
`scripts/restore-backup.js`, in one transaction, as:

1. `PRAGMA foreign_keys = OFF` — the Worker itself notes
   (`backend/routes/admin-articles.js`, `deleteArticle`) that D1 does
   not enforce `ON DELETE CASCADE`, so a live database can hold orphans
   (e.g. a revision whose article was deleted). Loading with FK off
   reproduces the live database faithfully instead of failing on its
   orphans; `foreign_key_check` is run afterwards and reported, not
   treated as a failure.
2. **Delete stale rows first** (children first): for each backed-up
   table, rows whose `id` is NOT in the backup are deleted. Without
   this, seed rows the owner deleted live — e.g. the two tags a CMS
   edit replaced — reappear from the seed. Verified: an upsert-only
   replay left 54 tag rows where the backup had 52.
3. **Upsert every exported row by `id`** (parents first):
   `INSERT ... ON CONFLICT(id) DO UPDATE`. NOT plain `INSERT` — the
   seed already holds the same ids, so every row conflicts
   (`UNIQUE constraint failed: articles.id`, verified). NOT
   `INSERT OR REPLACE` — REPLACE deletes the old row first, which
   fails outright on `ON DELETE RESTRICT` parents
   (`business_divisions`) and cascade-deletes rows in tables the
   backup does NOT cover (`agent_permissions`). An upsert updates in
   place, so those seed rows survive untouched.

The restore is idempotent: running it twice changes nothing. It never
touches the live database unless you point it at one — do not.

## How to download the export (from the Command Center)

1. Sign in to the Command Center as the owner.
2. Open the Backup section and tap **Download backup (JSON)** — the button
   downloads the export as `fs-ai-backup-YYYY-MM-DD.json`. (If the button is
   ever unavailable, call the endpoint directly from the browser console
   while signed in:
   `fetch('/api/admin/backup', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())`
   where `token` is the owner session token stored by the dashboard.)
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
3. Apply the schema and seed, in order, via the D1 Console (paste each
   file's contents and run it):
   1. `database/schema.sql`
   2. `database/seed.sql`
   3. `database/migrations/005_autonomy.sql`
   4. `database/migrations/006_llm_usage.sql`
   5. `database/migrations/008_research.sql` (console chunk:
      `database/console-chunks/migration-008_research.sql`)
   6. `database/migrations/009_factcheck.sql` (console chunk:
      `database/console-chunks/migration-009_factcheck.sql`)
   7. `database/migrations/010_pipeline.sql` (console chunk:
      `database/console-chunks/migration-010_pipeline.sql`)
   8. `database/migrations/011_backup.sql` (console chunk:
      `database/console-chunks/migration-011_backup.sql`)

   Apply 008–011 AFTER the seed: migration 008's research-source seeds
   look divisions up by slug, so they insert 0 rows if the divisions
   are not seeded yet. The local restore script
   (`scripts/restore-backup.js`, `applySchemaAndSeed`) uses exactly
   this order.

   Do NOT also apply `database/console-chunks/migration-003-sessions.sql`,
   `migration-004-cms-newsletter.sql`, or `migration-007-newsletter-consent.sql`:
   `schema.sql` already contains the `sessions` table,
   `article_revisions`, `articles.publish_at`, `ai_agents.status`,
   `rate_limits`, and the newsletter `consent_given_at` column, and
   re-applying 004 fails with `duplicate column name: publish_at`
   (verified). Migrations 001–004 and 007 are for upgrading an existing
   database, not for a fresh recovery. (The incremental path —
   001+002+003+004+seed — is tested in `tests/real-db.test.js` and stays
   valid for that purpose.)
4. Generate the restore SQL locally (no network, no wrangler needed):
   `node scripts/restore-backup.js fs-ai-backup-YYYY-MM-DD.json --sql restore.sql`
   This writes `restore.sql`: the stale-row DELETEs plus one upsert per
   exported row, in dependency order
   (`website_settings` → `business_divisions` → `categories` →
   `ai_agents` → `articles` → `article_revisions` →
   `article_sources` → `article_tags` → `newsletter_subscribers` →
   `agent_activity_logs` → `automation_jobs` → `revenue_records` →
   `autonomy_settings` → `llm_usage` → `research_sources` →
   `research_items` → `agent_tasks` → `agent_runs` → `agent_logs` →
   `daily_reports` → `fact_checks` → `claim_checks` →
   `article_corrections` → `seo_checks` → `backup_runs`).
5. Apply `restore.sql` to the fresh D1 database — preferred:
   `wrangler d1 execute fs-ai-db --file=restore.sql`
   (run from the repo; uses the `database_id` in `config/wrangler.toml`).
   Without wrangler, paste it into the D1 Console in chunks — the file
   can be large (25 full-body articles ≈ 90 KB in the test backup).
   If the Console rejects the `PRAGMA` lines, delete those two lines
   and re-run: the dependency order keeps the load valid for data
   without orphans. Re-running `restore.sql` is safe (idempotent).
   If it stops on a foreign-key error for an `article_revisions` row,
   that row is the revision of an article deleted before the backup —
   D1 keeps such orphans, a strict FK check does not. Delete just that
   row's `INSERT` line from `restore.sql` and run the file again; the
   revision is the only thing lost.
6. Verify before anything else:
   - Per-table counts match the backup's `counts` exactly. Check with
     `SELECT COUNT(*) FROM <table>;` for each of the 25 tables above,
     or locally: `node scripts/restore-backup.js <backup.json> <check.sqlite>`
     builds a fresh local database, restores, and prints the verified
     counts (refuses to overwrite an existing file unless `--force`).
   - `GET /api/health` must report `"db": "connected"`.
   - The public article list must show the restored articles. Note the
     list defaults to 25 per page (`total` is the page size) — use
     `GET /api/articles?limit=100` to count all of them.
   - The owner must sign in again (sessions are not restored — everyone
     signs in fresh with the owner password; the owner account itself is
     re-created by the secure setup flow if it was lost).
7. Redeploy the Worker if the `database_id` changed
   (`npm run deploy` from the repo, or redeploy from the dashboard).

## What is NOT backed up

- Owner password hash and session secret (Worker secrets — re-set them
  in the Cloudflare dashboard if they are lost).
- `owner_accounts`, `user_sessions`, `sessions` (login accounts and
  sessions — the owner account is re-created by the secure setup flow).
- `security_events`, `approval_records`, `research_records`,
  `agent_permissions`, `keywords`,
  `monetization_accounts`, `affiliate_links`, `expense_records`,
  `website_analytics`, `digital_tools` — these tables are not in the
  export yet. If any of them start holding data the owner cares about,
  add them to `BACKUP_TABLES` in `backend/routes/admin.js` (and to
  `RESTORE_ORDER` in `scripts/restore-backup.js`).
- The static frontend (Cloudflare Pages) and the GitHub repository —
  those are versioned separately and are not part of this export.

What the restore does to those tables: it leaves them exactly as the
seed leaves them — `digital_tools` 20 rows, `monetization_accounts` 10
rows, `website_analytics` 1 row ("Data unavailable"),
`agent_permissions` 42 rows, `owner_accounts` the placeholder row. Any
live rows added to them after seeding are LOST by a restore. The
restore never deletes or alters a row in a table it does not back up.

## Verification (local, 2026-11-19)

`tests/backup-runs.test.js` (7 tests) covers the master-implementation
changes against a real SQLite database:

- `runBackupExport()` exports all **25 tables** and records a
  `backup_runs` row (status `success`, tables/rows/bytes, finished_at);
  a second run records a second row — history is kept, not overwritten.
- Without migration 011 the export still succeeds but warns it was not
  recorded (`backupRunId` null).
- `POST /api/admin/backup/run` returns the summary (200) and records
  the run; `GET /api/autonomy/status` reports `lastBackup: null` before
  any run and the real run afterwards.
- Round-trip: the live `GET /api/admin/backup` dump restores into a
  fresh local database via `scripts/restore-backup.js` — 25 articles,
  24 research sources, `auto_publishing` still `off`,
  `publishing_mode` still `approved_only`.

## Verification (local, 2026-11-13)

`tests/backup-restore.test.js` (8 tests) builds a database from
`database/schema.sql` + `database/seed.sql`, simulates live activity
through the real Worker routes — a new published article, an edit that
stores a revision and replaces tags, a newsletter subscriber, an agent
run, an emergency-stop toggle, plus direct-SQL category/revenue/job
rows, and a create-edit-delete cycle whose revision survives as an
orphan — exports via `GET /api/admin/backup`, restores into a fresh
schema+seed database with `scripts/restore-backup.js`, and checks:

- All 11 backed-up tables row-for-row identical to the original
  (articles 26, article_revisions 2, business_divisions 8, categories
  16, article_tags 52, newsletter_subscribers 1, ai_agents 16,
  agent_activity_logs 1, automation_jobs 2, revenue_records 2,
  website_settings 9 — 135 rows).
- Non-backed-up tables at seed state (see above); `sessions` 0.
- Exactly 1 `foreign_key_check` violation, the orphan revision —
  reported, not a failure.
- Restore is idempotent; a second run changes nothing.
- The restored database serves the site: owner login works,
  `/api/health` reports connected, `/api/articles?limit=100` returns
  27 after one post-restore article, the edited article shows its new
  title, `/api/tools` returns 20, `/api/accounts` returns 10, and the
  next article gets the next free id (27), so AUTOINCREMENT continues
  past the backup's max id.
- The old procedure's failures are pinned as regressions: migration
  004 after `schema.sql` fails with `duplicate column name:
  publish_at`; plain `INSERT`s fail with `UNIQUE constraint failed`;
  an upsert-only replay (no stale-row DELETE) leaves 54 tag rows
  instead of 52.

## Honest limits

- Revenue in the export is the real D1 `revenue_records` ledger, which
  is $0.00 until a real, verified revenue source exists.
- Analytics in the export is whatever is in D1. Traffic is
  "Data unavailable" unless a real analytics source is connected —
  the export never invents visitors, clicks, or earnings.
- Row caps: `agent_activity_logs`, `automation_jobs` and `agent_logs`
  keep only the latest 500 rows each; every other backed-up table keeps
  1000. Older rows are gone from the backup and cannot be restored from it.
- The backup is from ONE database lineage: rows are matched by `id`,
  so never apply a backup from a different database.
- A backup that has never been restore-tested live is a hope, not a
  guarantee. The cycle above is verified locally only. Test the
  restore on a throwaway D1 database before relying on it.
