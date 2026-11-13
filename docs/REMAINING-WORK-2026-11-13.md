# FS AI — Remaining Work Batch (2026-11-13)

Owner order: "Sob koro" — do everything remaining. All work is local; **nothing was pushed, nothing was deployed**. The parent pushes via the browser route.

Zero-cost kept: $0 spent. No accounts created or connected. Facebook Page, WhatsApp Business, Business Email and the Cloudflare Access lock are still STOPPED on the owner's order — this batch did not touch them. AdSense/Affiliate were not applied (not eligible until real traffic exists).

## 1. What was done

### Article full bodies into the database
- `database/seed.sql` — the `body` field of all 25 article rows now holds the full body (was 49–65-word summaries). Word counts: min 619 (id 20), max 899 (id 4), total 21,293 — exactly the stated total. All other fields byte-identical. Bodies copied verbatim from `frontend/scripts/app.js`; no text invented or rewritten.
- `database/console-chunks/seed-bodies-update.sql` (new) — 25 `UPDATE articles SET body = '...' WHERE id = N;` statements for the D1 Console. Pure ASCII, no comment lines, no semicolons inside string values. One deliberate deviation: 11 semicolons inside body text were replaced with commas (ids 6, 8, 10, 11, 13, 16, 18, 19, 20) because the D1 Console splitter breaks on them.
- `database/build_seed_bodies.py` (new) — the script that did the replacement; re-runnable.
- `backend/routes/articles.js` — stale comment about short seed bodies corrected (no behaviour change).
- Verified locally: fresh DB from schema + new seed gives all 25 bodies > 400 words; applying the console chunk to a summary-seeded DB upgrades all 25 to the identical full bodies.
- NOTE: `database/seed-split.sql` and `database/console-chunks/seed-part*.sql` still contain the old summaries. If anything re-seeds from those, the short bodies come back. Regenerate them from the new seed before any re-seed.

### Invalid division slug → "Division not found"
- `frontend/pages/division.html` + `frontend/scripts/app.js` — new `divisionPageState(id)` helper. An unknown slug now shows "Division not found", a message naming the slug, and a "Browse all divisions" link; the API already returned 404 correctly and was verified, not changed.
- `tests/division-not-found.test.js` (new) — 11 tests, including real Worker calls (unknown slug → 404) and executing the shipped page script against a fake DOM.

### Backup → restore tested locally (never on live D1)
- The documented procedure FAILED three ways when reproduced: migration 004 after schema.sql → duplicate column; plain INSERTs → UNIQUE constraint; INSERT OR REPLACE → FOREIGN KEY failure (and upsert-only replay resurrected 2 replaced tags).
- `scripts/restore-backup.js` (new) — generates/applies a one-transaction replay into a fresh schema+seed DB: foreign keys off, delete stale rows (children first), upsert every row by id (parents first), verify per-table counts. CLI: `node scripts/restore-backup.js <backup.json> <out.sqlite> [--sql <restore.sql>] [--force]`.
- `docs/BACKUP-RECOVERY.md` — rewritten with the exact verified steps. Honest limits: non-backed-up tables are left at seed state on restore (their live rows are lost); 500/1000-row caps; same-lineage only; live restore still untested — test on a throwaway D1 database first.
- `tests/backup-restore.test.js` (new) — 8 tests: export counts, both old-procedure failures pinned, round-trip deep equality, idempotency, SQL shape, restored DB serving the site.
- Verified: 11 tables row-for-row deep-equal after restore (135 rows in the test backup); restore idempotent.

### Traffic — honest groundwork only
- `docs/SHARE-PACK-2026-11-13.md` (new) — ready captions + live links for all 25 articles and 20 tools (Pinterest version with hashtags + shorter YouTube Community version), plus a traffic plan. All captions honest; no fake stats, no fake urgency.
- Indexation (2026-11-13): `site:fs-ai-5w5.pages.dev` → no results; exact article-title searches → no FS AI result. That does not prove zero indexation — only the owner's Search Console can say that; `site:` results lag a new site.
- Live re-verified: sitemap.xml = real XML, 58 URLs; robots.txt = real, all allowed, sitemap declared; homepage loads with real hero and honest footer ($0.00, "Data unavailable").
- FLAG: `database/seed.sql` lists a different set of 20 tool names than the live frontend (seed has BMI, Tip, Discount, Compound Interest, EMI, Calorie, Word Counter, Password Generator, QR, Time Zone, Speed, Area converters; live has Mileage, Maintenance Planner, Tyre Pressure, Monthly Budget, Storage, Internet Speed, Data Unit, File Size, Travel Budget, Distance Planner, Trip Cost, Date, Time calculators). The share pack links to the LIVE tools. Reconcile seed article-20 text with the live tool list before the next traffic push.
- Nothing posted, no account connected, no traffic claimed.

## 2. Tests

`npm test`: **189 pass, 0 fail** (baseline 170; +11 division-not-found, +8 backup-restore). `node --check` clean on all changed JS. One transient failure was seen mid-batch when two parallel tasks edited `database/seed.sql` / `tests/real-db.test.js` concurrently; the final full run is green.

## 3. What the owner still has to run in the Console

1. `database/console-chunks/seed-bodies-update.sql` — upgrades the 25 live article rows from summaries to full bodies. Idempotent (`UPDATE ... WHERE id = N`).
2. After that, re-check live `/api/articles` — bodies should be the full ones.

## 4. What still needs the owner

- Phone checks: dashboard login + 14 sections, article full-body rendering on a real phone.
- Posting the share-pack himself (Pinterest `watchwithf`, YouTube Community `@FSAI-e5f`) — 2–3 posts/day, ~3 weeks to cover all 45 items. Nothing is automated or scheduled.
- Search Console: confirm indexation status (only he can see it).
- Stopped items (until he says otherwise): Facebook Page, WhatsApp Business, Business Email, Cloudflare Access lock.
- Blocked until real traffic exists: AdSense, affiliate.
- Newsletter confirmation email: no free sender exists — subscribers stay "pending" until one is connected; double opt-in is NOT claimed.
