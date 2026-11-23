# CLOSEOUT LEDGER — 2026-11-23

**Brief:** FS AI Complete Close-Out Pass (owner, 2026-11-23 08:05). Goal: finish every remaining technical item so ONLY owner-only actions remain.
**Working tree:** `~/workspace/fs-ai-source/fs-ai/` (local only, NOT a git repo). Parent deploys (zip + one-time workflow) and live-verifies with raw curl between items. One deployable item at a time.
**Gates (all done):** source backup `fs-ai-backup-20261123-closeout.tar.gz` (1.5M); live D1 backup `d1-backup-2026-11-23-closeout-pre-deploy.json` (1.9M, 53 tables, exit 0); npm baseline **1341 pass / 0 fail, 342 suites** (`/tmp/verify/npm-closeout-baseline.txt`).
**Status key:** DONE = built + tests green + deployed + live-verified · BUILT = built + tests green, awaiting parent deploy · BLOCKED-OWNER / BLOCKED-TECH / DEFERRED / NOT TESTED as defined in the brief.

## A0 — Investigation (read-only)
- **Status: DONE.** Findings: `docs/CLOSEOUT-A0-FINDINGS-2026-11-23.md` (25,762 bytes).
- Evidence: A0.1 reveal race (animations.js one-shot snapshot vs late renderShared) explains the ~1000 px blank; A0.2 Latest-guide tie id 1 vs id 13 at 2026-11-11; A0.3 full 25-row date table, true dates = Set B (seed/backend/sitemap), A2 correction = static 23 rows + D1 ids 1–2 only; A0.4 hard-coded counts in 8 files + 1 JS string; A0.5 repo public, GitHub auto-disables scheduled workflows after 60 days of no activity (docs-confirmed), last verified run manual #1 (00:54), scheduled runs since NOT VERIFIED.
- Tests: baseline unchanged (1341/0). No deploy (read-only). No rollback needed.

## A1 — UI fixes
- **Status: BUILT (awaiting parent deploy).** Tests before 1341/0 (342 suites) → after **1384/0 (349 suites)**, +43 new tests in `tests/closeout-a1.test.js`.
- Files changed: `frontend/scripts/animations.js` (refreshReveal + MutationObserver), `frontend/scripts/app.js` (public-safe footer, sortLatestFirst, renderDerivedCounts, refresh calls), `frontend/scripts/search.js` (hint under box, refreshSearchHint), `frontend/scripts/newsletter.js` (NEWSLETTER_ENABLED=false, JS-rendered forms), `frontend/index.html` (generic meta, og tags, derived-count ids, loading + noscript, newsletter slot, Honest-numbers section removed), `frontend/pages/{about,tools,division,article,privacy,terms,contact}.html` (generic counts, og tags, internal wording removed; article.html JS sets per-article og image), `frontend/404.html` (generic meta), `frontend/pages/division.html` (loading + noscript grids), `frontend/styles/main.css` (A1.6b plate-art shift), `frontend/styles/ui-styles.css` (stale comment), `frontend/og-image.png` + `public/og-image.png` + `scripts/make-og-image.py` (new 1200×630 og image + generator), `tests/closeout-a1.test.js` (new), `tests/pages-contact-about.test.js` (one spec-driven update: old assertions required the `25 articles` / `20 free tools` copy A1.5 removes — replaced with generic-copy assertions, not a weakening).
- What it does: reveal race fixed (re-observe after every render + loading states + noscript lists); internal wording ("Revenue", "$0.00", "GA4", "Data unavailable", "Emergency Stop", etc.) removed from all 9 public pages, GA4 tag kept, dashboard untouched; newsletter behind flag default OFF; local og image + tags (home + 7 sub-pages, per-article JS og); hero stats/search hint derived from merged list, static meta generic; search hint under the box; badge/circle 16 px gap; Latest guide = max date + id-desc tie-break.
- **Visible change on deploy:** hero "Latest guide" will show id 13 ("What Is AI?") instead of id 1 (same rule picks id 25 after A2's date fix); home "Honest numbers" section removed; footer revenue/traffic lines removed.
- NOT TESTED: A1.6b visual confirmation (no browser); no live-browser check of the reveal fix (vm tests only — A0 console checks still apply after deploy).
- Deployed commit: *(parent to fill)*. Rollback: revert the deploy commit.
- Coordinator verified: og-image.png present in both locations, refreshReveal/sortLatestFirst/NEWSLETTER_ENABLED present in code, no internal-wording hits in the checked public pages, og:image present in index.html.

## A2 — Dates
- **Status: NOT STARTED (blocked on A1 deploy-green).** Plan: adopt Set B (A0.3): static `date` fix for 23 rows in `frontend/scripts/app.js` + live D1 `published_at` fix for ids 1–2 only (11-02 → 11-01); sitemap/backend/seed need no change; never touch article bodies; before/after table + one-statement rollback required. D1 UPDATEs executed by the coordinator via d1_query.py after backup (backup done), parent re-verifies with independent reads.

## A3 — SEO
- **Status: NOT STARTED.** Unique title/meta/canonical/og per article, division and tool page (JS for live-loaded articles too) + Article JSON-LD; keep static no-JS fallback; report non-JS crawler view + propose (do not apply) next step if weak.

## A4 — CSP reporting
- **Status: NOT STARTED.** Keep CSP-Report-Only (do NOT enforce). POST /api/csp-report on the Worker + report-uri on Pages CSP; accept only application/csp-report or application/reports+json, cap body, rate-limit, store only directive/blocked URL/document URL/timestamp (no IP, no personal data), return 204. Additive migration (next number) after backup. Tests. 7-day counts per directive in the owner dashboard + written rule for switching to enforcement.

## A5 — Daily Autonomy Health Report
- **Status: NOT STARTED.** Owner-only, produced by the EXISTING daily run, no new cron. Honest statuses (OK/WARN/FAIL/NOT TESTED): Worker health, Pages 200, sitemap 200 + URL count + every published D1 id present, articles published in last 24 h (reachable, in sitemap, canonical/title/og), queue state, last daily/weekly run, last sitemap-refresh run, protected drafts unchanged, settings unchanged, Shorts cron state, last video result, CSP violation counts. Read-only: never publish/edit/fix. Tests.

## A6 — First-real-auto-publish proof
- **Status: NOT STARTED (write-only doc, alongside A5).** Script/doc that verifies page, division/home appearance, sitemap after next refresh, canonical/title/og and counts for a newly auto-published article; wire its result into A5. Do NOT run it against a real article (no real article published to test).

## A7 — Workflow upkeep
- **Status: NOT STARTED.** Update actions/checkout + actions/setup-node in sitemap-refresh.yml to current non-deprecated versions (pinned), behavior identical; add a staleness alert to A5 if the last successful run is older than 3 hours.

## B1 — publishDueArticles daily-limit check
- **Status: NOT STARTED.** Add the missing daily-limit check on the scheduled path, with tests, without changing the 1/day rule.

## B2 — Drain LIMIT-before-filtering (O1) + two "created today" definitions (O2)
- **Status: NOT STARTED.** Fix with tests.

## B3 — Login lockout (M2)
- **Status: NOT STARTED.** D1-backed failed-login counting with a lockout window + documented owner unlock procedure + a test proving the owner cannot be locked out permanently. STOP condition: if the owner lockout cannot be guaranteed, mark BLOCKED-TECH with the reason.

## B4 — article_revisions FK cascade
- **Status: NOT STARTED (read-only inspection, with B1/B2, no deploy needed).** Verify the FK cascade on live D1 with a READ-ONLY inspection and report.

## B5 — Task-dependency mechanism (D1)
- **Status: NOT STARTED.** Minimal safe version only if the existing patch sketch applies cleanly; otherwise DEFERRED with the exact reason.

## B6 — Gate counting stale failed correction rows + retry-fix §7
- **Status: NOT STARTED.** Fix only if it does not touch protected drafts' data; otherwise report.

## C1 — Short #09 v2
- **Status: NOT STARTED (after code items).** Word-by-word kinetic captions 60–80 px on 1080-wide frame, centred, above bottom 25%; cards show large keywords only, no tiny italic text; fill cards (70%+ of frame, no empty first frame); "Braking squeal means worn pads" → "usually means" + recheck every claim; report BOTH timeline dead-air % and measured silent % (fail above 15%); keep "Hear that knock?" hook, waveforms, subscribe CTA, ~−14 LUFS / peak < −1 dB, Whisper base+small match, .srt. Max 3 render attempts. Inspect real frames at 0 s, 25%, 50%, 75%, end. Apply C3's new checks. Do NOT upload.

## C2 — Long #08 v2 (ACCEPTED, do NOT re-render)
- **Status: NOT STARTED (doc/local work, with C1).** (1) Correct title-length claim 54 → 52 chars in the v2 .txt, build notes, any other file stating 54. Do not change the title. (2) Create docs/UPLOAD-SHEET-Long-08-v2.md (exact title, description, chapters with real scene starts, hashtags, thumbnail path, .srt path, Studio playlist + end-screen steps pointing to Long #01 https://youtu.be/hDpXk726Y54 for the last 20 s, pre-upload checklist). Do NOT upload. (3) v3 WISH LIST only (do not build): caption size 48–54 px, larger secondary plate text, fill empty plate areas, avoid mid-sentence caption cuts. Keep v1/v2 files untouched.

## C3 — QA gates (automated checks + tests)
- **Status: NOT STARTED (with C1).** Static-run check (sample mp4 at 1 fps, downscale, frame-to-frame pixel difference; FAIL if any unchanged run exceeds 4 s Long / 3 s Short; print longest static run + every run ≥ 4 s). Minimum text size: Long 1080p captions ≥ 48 px, plate secondary text ≥ 28 px; Shorts captions 60–80 px; report measured sizes. Also fail on: caption inside bottom 25% (Shorts), narration paragraph on screen, measured silence above 15%. Apply to Short #09 v2 when re-rendered; do NOT re-render Long #08 v2.

## C4 — Shorts readiness checklist
- **Status: NOT STARTED (with C1).** Exact checklist the owner must pass before the paused daily Shorts cron is resumed (what to watch, what numbers to see). Do NOT resume the cron.

## D — Owner pack
- **Status: NOT STARTED (after technical items).** docs/OWNER-ACTIONS-2026-11-23.md with exact click-by-click steps + expected results: (1) Pinterest/Facebook/Instagram/LinkedIn OAuth (workers.dev callback, Worker secrets, Connect, test post, enable social_auto_post; X unavailable free); (2) email sender decision + newsletter flag ON; (3) decision packet per protected draft #28/#29/#30/#31/#33 (status, problems, recommendation, exact publish/discard command or dashboard step — do NOT act); (4) Guardian API key registration + small worker path for #29/#30; (5) YouTube (keep browser uploads; API-audit decision with requirements/consequences; session login steps; Long #08 v2 upload via upload sheet); (6) resuming the Shorts cron after C4; (7) Search Console sitemap resubmission + indexing request steps.

## Remaining (summary)
- Code items awaiting build + deploy: A2, A3, A4, A5 (+ A6 doc), A7, B1, B2, B3, B5, B6 (+ B4 read-only inspection).
- Video items: C1, C2, C3, C4 (local only; Short #09 v2 re-render max 3 attempts; Long #08 v2 NOT re-rendered; nothing uploaded).
- Docs: D (owner pack).
- Owner-only (never agent-done): OAuth connections, email sender decision, protected-draft publish/discard decisions, Guardian API key registration, YouTube API-audit decision, Long #08 v2 upload, Shorts cron resume, Search Console steps.
- NOT TESTED (carried): live-browser console output for A0.1; A1.6b visual; live canonical/meta head values; console/network errors; scratch-DB fixture render.
