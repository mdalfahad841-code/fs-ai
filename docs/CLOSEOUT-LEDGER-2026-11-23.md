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
- **Status: DONE.** Tests before 1341/0 (342 suites) → built **1384/0 (349 suites)**, +43 new tests in `tests/closeout-a1.test.js`.
- Files changed: `frontend/scripts/animations.js` (refreshReveal + MutationObserver), `frontend/scripts/app.js` (public-safe footer, sortLatestFirst, renderDerivedCounts, refresh calls), `frontend/scripts/search.js` (hint under box, refreshSearchHint), `frontend/scripts/newsletter.js` (NEWSLETTER_ENABLED=false, JS-rendered forms), `frontend/index.html` (generic meta, og tags, derived-count ids, loading + noscript, newsletter slot, Honest-numbers section removed), `frontend/pages/{about,tools,division,article,privacy,terms,contact}.html` (generic counts, og tags, internal wording removed; article.html JS sets per-article og image), `frontend/404.html` (generic meta), `frontend/pages/division.html` (loading + noscript grids), `frontend/styles/main.css` (A1.6b plate-art shift), `frontend/styles/ui-styles.css` (stale comment), `frontend/og-image.png` + `public/og-image.png` + `scripts/make-og-image.py` (new 1200×630 og image + generator), `tests/closeout-a1.test.js` (new), `tests/pages-contact-about.test.js` (one spec-driven update: old assertions required the `25 articles` / `20 free tools` copy A1.5 removes — replaced with generic-copy assertions, not a weakening).
- What it does: reveal race fixed (re-observe after every render + loading states + noscript lists); internal wording ("Revenue", "$0.00", "GA4", "Data unavailable", "Emergency Stop", etc.) removed from all 9 public pages, GA4 tag kept, dashboard untouched; newsletter behind flag default OFF; local og image + tags (home + 7 sub-pages, per-article JS og); hero stats/search hint derived from merged list, static meta generic; search hint under the box; badge/circle 16 px gap; Latest guide = max date + id-desc tie-break.
- **Deployed: HEAD 73891ff (run #43 green, 2026-11-23 08:30) + patch HEAD 2112d56 (run #44 green, 08:36).** Patch (parent-caught A1.6 deviation): the first build had changed hero wording ("Eight divisions" → "All divisions", dropped "Eight divisions, " from the hero lead) + the division lead; the parent restored the exact strings, genericized the division twitter meta ("All 8 FS AI" → "All FS AI"), and narrowed the over-broad test. Tests after patch: **1385/0 (349 suites)** (+1 division-lead test). Parent live-verified by raw curl: home 200, og-image 200 (32,896 B), CSP-Report-Only + XFO DENY, app.js/animations.js/newsletter.js contain refreshReveal/sortLatestFirst/NEWSLETTER_ENABLED=false, "25 free articles" + "Honest numbers" absent from served home, Worker health GET 200 fresh + HEAD 200, /api/articles 200 (source d1, 25), sitemap 200 (60 URLs); browser render check: all 8 division cards visible (loading state first), Latest guide = No. 13 "What Is AI?", no newsletter form, hero stats "8 divisions · 25 articles · 20 free tools", automotive division + article 1 render fully.
- **Visible change on deploy:** hero "Latest guide" showed id 13 ("What Is AI?") instead of id 1 (same rule picks id 25 after A2's date fix); home "Honest numbers" section removed; footer revenue/traffic lines removed.
- NOT TESTED: console errors + failed network requests (DevTools would not open in the browser); A1.6b visual (badge/circle gap) — eyeball only, not measured.
- Rollback: revert deploy commits 73891ff + 2112d56.
- Coordinator verified: og-image.png present in both locations, refreshReveal/sortLatestFirst/NEWSLETTER_ENABLED present in code, no internal-wording hits in the checked public pages, og:image present in index.html.

## A2 — Dates
- **Status: BUILT (awaiting parent deploy).** Tests before 1385/0 (349 suites) → after **1396/0 (353 suites)** (+11 new tests in `tests/closeout-a2.test.js`; 1 spec-driven update in `tests/closeout-a1.test.js`: Latest-guide test id 13 → id 25, because Set B makes id 25 the newest — the A1 handoff itself predicted this).
- Files changed: `frontend/scripts/app.js` ONLY (23 `date:` values; rigorous diff vs deployed HEAD 2112d56: exactly 23 differing lines, line count unchanged, and with the date field masked out old == new on every line — NO body, title or excerpt touched). `tests/closeout-a2.test.js` (new, 11 tests). No change to sitemap files (regenerated with `--from-api --require-live`: 60 entries, 0 live-only merged, byte-identical before/after), backend fallback list, or seed.sql (all already Set B, verified + locked by tests).
- **Static before → after (Set B):** 1: 11-11→11-01, 2: 11-10→11-01, 3: 11-09→11-02, 4: 11-08→11-02, 5: 11-07→11-03, 6: 11-06→11-03, 7: 11-05→11-04, 8: 11-04 (unchanged), 9: 11-03→11-05, 10: 11-02→11-05, 11: 11-01→11-06, 12: 10-31→11-06, 13: 11-11→11-07, 14: 11-10→11-07, 15: 11-09→11-08, 16: 11-08 (unchanged), 17: 11-07→11-09, 18: 11-06→11-09, 19: 11-05→11-10, 20: 11-04→11-10, 21: 11-03→11-11, 22: 11-02→11-11, 23: 11-01→11-11, 24: 10-31→11-11, 25: 10-30→11-11. (All dates 2026.)
- **Live D1 UPDATE (done by coordinator, verified before/after):** `UPDATE articles SET published_at='2026-11-01' WHERE id IN (1,2);` — D1 reported `changes: 2, changed_db: true`. Before: ids 1–2 `published_at` 2026-11-02. After: 2026-11-01; all 25 `published_at` now equal Set B exactly; published count still 25. Bodies untouched: ids 1–2 body_len unchanged (5144, 5011); protected #26 4895, #27 245, #28 2157, #29 601, #30 4088, #31 549, #33 3478 — all draft, all unchanged before vs after. **One-statement rollback:** `UPDATE articles SET published_at='2026-11-02' WHERE id IN (1,2);`
- **Visible change on deploy:** Latest guide becomes id 25 ("How to Plan a Road Trip", 2026-11-11) instead of id 13; every article page's "Published …" line + JSON-LD `datePublished` moves to its Set B date (both read `a.date`); sitemap lastmods already Set B (no visible change).
- NOT TESTED: live D1 `published_at` in the unit suite (no live D1 in tests — verified by direct reads above; parent re-verifies with independent reads).
- Deployed commit: *(parent to fill)*. Rollback: revert the deploy commit + run the D1 rollback statement above (only if the deploy is reverted).

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
