# FIX PASS 2 LEDGER — 2026-11-23

**Brief:** FS AI FIX PASS 2 (owner, 2026-11-23 12:44). Items 0–7. This ledger was
started by the Item 1 builder; items 1 + 4 are DONE and deployed together
(run #54, HEAD 67dd6c1, 2026-11-23 13:09); item 2 is DONE (run #58, HEAD
1b52f98, live-verified — see the end of the item 2 section); later items
append their sections here (parent merges).
**Working tree:** `~/workspace/fs-ai-source/fs-ai/` (local only, NOT a git repo).
Parent deploys (zip + one-time workflow) and live-verifies with raw curl
between items. One deployable item at a time. Build only — this item was
NOT deployed by its builder.
**Gates (all done before any change):** source backup
`fs-ai-backup-20261123-fixpass2.tar.gz`; live D1 backup
`d1-backup-2026-11-23-fixpass2-pre-deploy.json` (55 tables); npm baseline
**1528 pass / 0 fail, 395 suites** (measured by the Item 1 builder before
changing anything; the brief quoted 1524/0, 394 suites — the tree held 4
more tests than the brief's figure, so the measured baseline is the one
recorded here and used for the before/after below).
**Status key:** DONE = built + tests green + deployed + live-verified ·
BUILT = built + tests green, awaiting parent deploy · BLOCKED-OWNER /
BLOCKED-TECH / DEFERRED / NOT TESTED as defined in the brief.
**Hard rules (in force for the whole pass):** do NOT publish/edit/delete/
touch articles #26–#31 and #33 (fixtures / in-memory SQLite only, never a
real publish, never live D1 writes of article data); do NOT change
auto-publish settings, Emergency Stop, schedules or crons; daily Shorts
cron stays PAUSED; social_auto_post stays OFF; no OAuth, no uploads, no
real publishing to test; $0 only; no secrets in code, logs or reports.

## 0 — DEPLOY CONSISTENCY CHECK (read only, first)
- **Status: DONE.** Live deployment **IS HEAD bb6121f**; the old content was a
  stale cache, not live. Evidence (as recorded in the brief): plain fetch
  "Honest numbers" count 0, og:image count 4, cache-busted fetch identical
  to the plain fetch, Cache-Control `max-age=0 must-revalidate`, served
  files byte-identical to the local bb6121f tree, GitHub API latest commit
  bb6121f. The one "no free email sender" hit is current intentional
  footer text (line 129). No live change was made by this check.
- Items 1–7 may proceed (this item unblocked the pass).

## 1 — MANUAL PUBLISH MUST RESPECT THE GATE (highest priority)
- **Status: DONE — built + tests green + DEPLOYED (run #54, HEAD 67dd6c1, 2026-11-23 13:09, shared deploy with item 4) + live-verified by the parent (raw curl). Migration 032 applied to live D1 by the parent 2026-11-23 13:06 (table + 2 indexes verified, 0 rows).**
- Tests before **1528/0 (395 suites)** → after **1556/0 (403 suites)**,
  **+28 tests, +8 suites, 0 weakened**. New file
  `tests/fixpass2-item1.test.js` (28 tests). Full-suite runs: baseline
  1528/0 measured before changes; final 1556/0 after all changes (two
  full runs during the build caught and fixed 9 dashboard fake-DOM
  failures — see "Build notes" below — and the final run is green).
- Files changed (exact list):
  - `backend/publishing/gate.js` — new exports: `MANUAL_PUBLISH_OVERRIDE_PHRASE`,
    `MANUAL_PUBLISH_PROTECTED_IDS`, `evaluateManualPublishGate()` (+ long
    comment documenting the verdict). No existing gate function changed;
    `evaluatePublishGate`, `publishGatePassed`,
    `evaluateAutoPublishEligibility` are byte-identical in behaviour.
  - `backend/routes/admin-articles.js` — `setPublishState` rewritten for
    the publish path (unpublish branch unchanged in behaviour); route
    wiring passes `request` + `auth`; header comment for the publish
    route updated. No other handler touched.
  - `frontend/pages/dashboard.html` — new hidden `#articlePublishOverride`
    block after `#articleFormStatus` (explanatory comment + input +
    confirm/cancel buttons).
  - `frontend/scripts/dashboard.js` — new `publishArticle(id)`,
    `hidePublishOverride()`, `pendingOverrideArticleId` /
    `overrideButtonsBound` vars, override confirm/cancel bindings in
    `bindContent()`; the Publish/Unpublish branch now calls
    `publishArticle` for publish and keeps the old call for unpublish.
  - `database/migrations/032_article_publish_overrides.sql` — NEW (audit
    table + 2 indexes; see "Audit row" below).
  - `package.json` — `db:migrate` chain +032 (one entry appended).
  - `tests/fixpass2-item1.test.js` — NEW (28 tests, see below).
  - `tests/fake-d1.js` — gate tables (`fact_checks`, `claim_checks`,
    `article_sources`, `article_corrections`, `seo_checks`,
    `article_publish_overrides`) + `nextId` entries + SELECT handlers
    for the gate's exact queries (latest fact-check / SEO run, sources,
    claim evidence, open-corrections latest-row-per-claim, `is_protected`).
    Production code untouched by this; the fake D1 previously threw
    "unsupported SELECT" on every gate query.
  - `tests/cms.test.js` — fixture-only: `seedGatePass()` helper +
    one call in the publish test (the test's assertions are unchanged).
  - `tests/draft-banner-publish.test.js` — fixture-only: `applyGateMigrations()`
    + `seedGatePass()` for the two publish tests (901/903); the
    malformed-banner test (902) is untouched and still expects the banner
    error. All assertions unchanged.
  - `tests/real-db.test.js` — fixture-only: dummy drafts seeded at ids
    28/29/30/31/33 in `before()` (so the CMS test's fresh article lands
    on id 34, outside the legacy list — same precedent as the existing
    26/27 seeding) + gate migrations applied + gate rows seeded inside
    the CMS publish test. All assertions unchanged.
  - `tests/article-fetch.test.js` — count-only update: migration files
    31 → 32 (same pattern as B3's 30 → 31; the test then builds the
    full chain including 032).
  - `tests/dashboard-sections.test.js` — the control-id list gained the
    4 new override element ids (additive only).

### The exact override phrase
- **`PUBLISH DESPITE GATE`** — exact, case-sensitive, no trailing space.
  Defined once as `MANUAL_PUBLISH_OVERRIDE_PHRASE` in
  `backend/publishing/gate.js`; the dashboard shows the same literal as
  the input placeholder and in its status text; the API (not the page)
  enforces it. It is a confirmation phrase, not a secret — it is printed
  in the dashboard UI and in this ledger on purpose.

### API behaviour (POST /api/admin/articles/:id/publish)
- Plain POST with no body (the dashboard's Publish click and every
  pre-existing client): the normal path. The gate must allow the publish
  or the endpoint answers **422** with
  `error: "Publish gate is Blocked: <reason 1> <reason 2> …"` and
  `gate: { contentReady, blockedBy, failedChecks, checks: [{name, ok,
  detail}], legacyProtected, emergencyStopOn, division }`. Nothing is
  written on a refusal (no status change, no body save, no audit row).
- Override: POST with JSON body `{ "override": "PUBLISH DESPITE GATE" }`.
  A present-but-wrong phrase answers **422**
  ("Override phrase is incorrect — type PUBLISH DESPITE GATE exactly…")
  and publishes nothing. A present-but-unparseable body answers **400**.
  The exact phrase publishes and the success body carries
  `overridden: true` (the normal path carries no `overridden` field).
- The manual verdict (`evaluateManualPublishGate`, the ONLY manual
  verdict — the route never re-derives it): **content checks 1–7 +
  Emergency Stop off + daily limit (Dhaka day) must pass**. Check 10
  (publishing-rules: mode != 'approved_only' AND auto_publishing on) is
  EXCLUDED — it governs whether the SYSTEM may publish without a human;
  with the live default (`approved_only`) it always fails, and requiring
  it would make the Publish button permanently dead, which is the
  opposite of approved_only (articles wait for OWNER approval, then the
  owner publishes). An already-published article is refused ("Article is
  already published.") — re-stamping published_at through the button is
  no longer a silent no-op.
- **Emergency Stop can never be overridden.** When the Stop is ON the
  endpoint answers 422 ("Emergency Stop is ON — turn it off before
  publishing…") on the normal path AND on the override path, and writes
  no audit row. The owner turns the Stop off first, as a separate
  deliberate act.
- **Protected articles:** #26/#27 (and any `is_protected=1` row) refuse
  **403** via the existing `assertNotProtected` guard — before the 404
  check, override or not. Legacy drafts **#28–#31 and #33** refuse 422
  on the normal path even when the gate passes ("protected legacy draft
  — it needs separate owner authorization"); the typed phrase is the
  only path for them, and it is audited.
- **Fail-closed:** if the gate cannot be evaluated at all (missing
  tables on an old database, a store error) the endpoint answers **503**
  and publishes nothing. If the override audit INSERT fails (table
  missing — code deployed before migration 032 is applied) the endpoint
  answers **503** and publishes nothing: an unaudited override must
  never happen. The normal (non-override) path never touches the audit
  table.
- **Banner order:** the banner strip still runs FIRST, before the gate
  (a banner that survives the strip is refused with the banner error,
  not a gate error — the article stays exactly as it was). The strip is
  pure, so a later gate refusal leaves no trace.
- **Unpublish is ungated** (it only hides an article) and its behaviour
  is unchanged.

### Dashboard UX
- Click Publish → plain POST. On success: "Article published." (or
  "Article published (gate overridden — audit recorded)." when the
  response carries `overridden: true`) and the list reloads.
- On a 422 with a gate report (and the Stop off): the status line shows
  "Publish gate is Blocked: <reasons> Type PUBLISH DESPITE GATE below
  to publish anyway (the override is recorded in the audit log)." and
  the `#articlePublishOverride` block is revealed for that article
  only. The owner types the phrase into `#articlePublishOverrideInput`
  and clicks "Publish despite gate" → POST with
  `{ "override": "<typed>" }`. A wrong phrase shows the API error and
  publishes nothing. "Cancel" hides the block and publishes nothing.
- On a 422 with the Emergency Stop on: the status line says the Stop
  must be turned off first; the override block is NOT revealed.
- The override buttons are bound once (`overrideButtonsBound` flag in
  `bindContent`).

### Audit row (`article_publish_overrides`, migration 032)
- Columns: `id`, `article_id`, `title`, `slug`, `division` (slug),
  `published_by` (owner email from `auth.owner`, null when absent),
  `gate_result` (JSON), `human_review_applied` (0/1), `created_at`
  (UTC, `datetime('now')`). Indexes on `(article_id, created_at)` and
  `(created_at)`. One row per override, written BEFORE the article is
  published.
- `gate_result` JSON: `{ contentReady, blockedBy, failedChecks, checks:
  [{name, ok, detail}], legacyProtected, emergencyStopOn, division,
  overriddenAt }` — the full manual-gate verdict at override time.
- `human_review_applied` is **1 when the article's division is a
  special-review division (Health & Wellness, Finance & Money
  Education)** — typing the phrase IS the human review for those
  divisions, and the row records that it applied; 0 otherwise. The
  gate's own Health/Finance behaviour is unchanged: a Health/Finance
  article WITH the general-information disclaimer passes the normal
  path with no override (pinned by test); without it, it is Blocked
  and only the audited override publishes it.
- An override on a gate-PASSING article is audited the same way (the
  phrase was invoked, so the row records it; its `blockedBy` is empty).
  A refused override writes no row.

### Tests (new file tests/fixpass2-item1.test.js — 28 tests, all green)
- Gate enforced: bare draft refused 422 with the reason list (names +
  details, `failedChecks` includes `fact-check-pass`/`seo-pass`);
  gate-passing article publishes on the normal path with no audit row;
  already-published refused; unpublish unaffected; malformed JSON 400;
  unevaluable gate 503 (fail-closed, via a dropped leaf table).
- Override: phrase is exactly `PUBLISH DESPITE GATE`; wrong phrases
  (wrong word, wrong case, trailing space, truncated) refuse; exact
  phrase publishes a Blocked article + writes the audit row (who/when/
  article/division/gate result/human-review 0); override on a
  gate-passing article is audited too; missing audit table refuses 503
  with nothing published.
- Protected legacy: list is exactly [28, 29, 30, 31, 33]; id 28 with a
  PASSING gate still refuses on the normal path; id 28 publishes via
  override with `legacyProtected: true` in the audit; ids 29/30/31/33
  all refuse on the normal path; id 26 refuses 403 even with the exact
  phrase and writes no audit row.
- Health/Finance: no-disclaimer health article Blocked on the normal
  path (`special-review` fails); override publishes it with
  `human_review_applied: 1` and division `health-wellness`; a health
  article WITH the disclaimer passes the normal path (gate unchanged).
- E-Stop / daily limit: Stop ON refuses the normal path and the
  override alike, nothing published, no audit row; daily limit blocks
  the normal path (second publish same Dhaka day, `daily-limit` named)
  but not the audited override.
- Helper: the manual verdict ignores `publishing-rules` (fails under
  `approved_only`) while keeping every other check; a Blocked article's
  verdict names the failed checks and never lists `publishing-rules`.
- Auto-publish path unaffected: `publishDueArticles` still publishes a
  due approved article (no gate on the scheduled path);
  `publishGatePassed` still refuses a gate-blocked article.
- Dashboard wiring (shipped files): `dashboard.js` posts the phrase and
  handles the 422 gate report; `dashboard.html` carries the override
  block with the exact phrase as placeholder; migration 032 applies
  cleanly after 001–031 and creates the table with all 8 columns + 2
  indexes.

### Existing tests touched (fixture-only, no assertion weakened)
- `tests/cms.test.js` — the publish test seeds a gate-passing article
  (`seedGatePass`: fresh PASS fact-check with the recorded body hash,
  evidenced VERIFIED claims, a source with a URL, a fresh PASS SEO run).
  The fake D1 could not evaluate the gate before this item (its
  dispatcher threw "unsupported SELECT" on the gate's queries), so
  `tests/fake-d1.js` gained the five gate tables + the gate's exact
  SELECT handlers (latest fact-check / SEO run, sources, claim evidence,
  open-corrections latest-row-per-claim, `is_protected`) and the audit
  table for the generic INSERT handler.
- `tests/draft-banner-publish.test.js` — tests 901/903 (banner strip +
  publish, plain-body publish) seed gate-passing rows after applying
  migrations 017/019/023/032 onto the test db. Test 902 (malformed
  banner) is untouched: the banner refusal runs before the gate.
- `tests/real-db.test.js` — `before()` seeds dummy drafts at ids
  28/29/30/31/33 (same precedent as the existing 26/27 seeding) so the
  CMS test's fresh article lands on id 34; the CMS test applies
  migrations 009/017/019/023/032 and seeds gate rows before publishing.
- `tests/article-fetch.test.js` — migration count 31 → 32.
- `tests/dashboard-sections.test.js` — the control-id list gained the 4
  new override element ids.
- No existing test's assertions were changed. Two pre-existing tests in
  the new file's first full-suite run failed on a `dataset` guard in
  `bindContent` (fake-DOM doubles have no `dataset`) — fixed by a
  module-level `overrideButtonsBound` flag; see "Build notes".

### Build notes (judgment calls the parent should know)
- **Check 10 excluded** (see "API behaviour"): the manual verdict
  ignores `publishing-rules`. If the parent wants manual publish to
  also require a non-`approved_only` mode, that would make the button
  dead under the live default — say so explicitly; the change is one
  filter line in `evaluateManualPublishGate`.
- **E-Stop non-overridable**: a deliberate safety choice, not in the
  brief's letter. The owner can still publish during a Stop by turning
  it off first (one deliberate step) and then publishing.
- **Create/PUT transitions NOT gated (known remaining gap):** creating
  an article with `status: 'published'` and a PUT that flips a draft to
  `published` still publish without the gate (the dashboard's edit-form
  status dropdown offers Published on save). A create can never pass
  the gate — no fact-check/SEO rows can exist before the row exists —
  and gating PUT would change the edit API contract and break the
  banner suite's PUT/create tests, which pin those transitions. The
  coherent follow-up is to forbid `status: 'published'` in
  create/PUT entirely and route every publish through POST /publish;
  that needs its own decision — it is NOT smuggled into this item.
- **Audit fail-closed, not best-effort:** unlike the deletion audit
  (which proceeds when its table is missing), an override with a
  missing audit table refuses 503. The override's whole legitimacy is
  the audit row; the parent applies migration 032 with the deploy, so
  the window is the deploy itself.
- **Auto-increment ids in tests:** the seed holds articles 1–25, so a
  fresh auto-increment article lands on 26 (flag-protected). The new
  suite's `insertDraft` uses explicit ids from 100 for ordinary
  articles; `real-db.test.js` seeds the protected/legacy ids as dummy
  drafts instead (the file's existing precedent).

### What was NOT done / NOT TESTED
- DEPLOYED by the parent (run #54, HEAD 67dd6c1, 2026-11-23 13:09) together
  with item 4 in one commit (shared deploy; rollback reverts both).
  Migration 032 applied to live D1 by the parent 2026-11-23 13:06 (all 3
  statements success; table + 2 indexes verified present, 0 rows). Parent
  live-verified by raw curl: home 200, Worker health 200, served
  dashboard.html (via the 308 → /pages/dashboard) contains
  articlePublishOverride ×4, served dashboard.js contains PUBLISH
  DESPITE GATE ×2 + publishArticle ×2, deployed gate.js on main contains
  MANUAL_PUBLISH_OVERRIDE_PHRASE ×1 + evaluateManualPublishGate ×2,
  deployed migration 032 on main present. (First curl of dashboard.html
  without -L returned the 308 body — a parent measurement error, not a
  deploy problem; re-fetch with -L confirmed the markers.) Protected
  #26–#33 re-verified after deploy: all draft, lengths unchanged
  (4895/245/2157/601/4088/549/3478); article_publish_overrides 0 rows.
  NOT TESTED live: the endpoint against the live Worker (would need a
  real publish), the dashboard override flow in a real browser, a real
  owner override end-to-end.
- NOT TESTED live: the endpoint against the live Worker, the dashboard
  override flow in a real browser (the shipped-file string tests pin
  the wiring; no live browser run), a real owner override end-to-end
  (fixtures / in-memory SQLite only, as required).
- NOT DONE: the create/PUT publish transitions (see "Build notes");
  no per-article gate-status display on the dashboard list (the refusal
  reasons show only after a Publish click); no owner-facing doc for the
  override phrase beyond the dashboard hint and this ledger.
- Rollback: revert the deploy commit (+ `DROP TABLE
  article_publish_overrides` only if migration 032 was applied; the
  override path then refuses every override with 503 until the table is
  back, while normal gate-passing publishes are unaffected).

### Confirmation (item 1)
- No protected article (#26–#31, #33) was published, edited, or touched
  in this item — all test articles are fixtures with explicit ids in
  throwaway in-memory databases; the only "protected" rows are the
  seeded dummy drafts in test DBs. No auto-publish setting, Emergency
  Stop, schedule, or cron was changed. The daily Shorts cron stays
  PAUSED. social_auto_post stays OFF. No OAuth connection was started
  and no account was connected. No secret was written to code, logs,
  reports, or screenshots. Nothing was uploaded or published (no video,
  no article, no Pin). No live D1 writes of any kind were made.

## 4 — #33 SEO SKIP (investigation + fix)
- **Status: DONE — cause confirmed by read-only investigation + fix built + tests green + DEPLOYED (run #54, HEAD 67dd6c1, 2026-11-23 13:09, shared deploy with item 1) + live-verified (code markers on main).**
- **Cause:** the daily run's `steps.seoRun` (backend/routes/scheduler.js:1388-1398) selected only `ORDER BY updated_at ASC LIMIT 3` over draft/pending_approval articles excluding #26/#27. On 23 Nov the pool ordered oldest-first was #28, #31, #29, **#33, #30** — #33 ranked 4th and was never selected. Evidence: `agent_runs` id 188 (2026-11-23T00:04:04Z, outcome done) records checked `[{28}, {31}, {29}]`; matching `seo_checks` rows 23/24/25 for #28/#31/#29; **#33 has zero `seo_checks` rows ever**. #28's body is unchanged since 19 Nov yet it is re-checked every day, permanently occupying slot 1. The correction that made #33 most need a fresh check is exactly what bumped its `updated_at` and pushed it out of the window. Full findings: `docs/FIXPASS2-ITEM4-FINDINGS-2026-11-23.md` (12,177 B). Classification: code rule / design limitation, not a data bug. The sibling `factCheckRun` has the identical starvation shape — flagged, out of scope, not fixed here.
- **Fix** (`backend/routes/scheduler.js`, `steps.seoRun` only; `factCheckRun` untouched): candidate fetch widened `LIMIT 3` → `LIMIT 10` (bounded; 8 drafts exist today), keeping `ORDER BY updated_at ASC` and the protected guard byte-identical; new helper `isSeoFreshForCurrentBody(env, articleId)` — true only when the latest `seo_checks` row matches BOTH `body_hash` (same `bodyHash` helper `insertSeoCheck` stores) AND `body_length` of the current body; NULL hash/length (pre-migration-023 rows) is never fresh; ANY read failure returns not-fresh (fail-open to re-check, never skip on unproven freshness); fresh articles record `{ articleId, outcome: 'skipped-fresh' }` and continue WITHOUT consuming a slot; the loop stops after 3 real checks; the step returns `{ outcome: 'done', checked, skippedFresh, results }` so the daily report shows the skip explicitly. Daily budget stays 3 real checks.
- **Tests:** before 1524/0 (394 suites, parent baseline) → after item 4 alone 1528/0 (395 suites), +4 tests in `tests/fixpass2-item4.test.js` (live-23-Nov shape: #28 fresh + oldest, #33 no row + newer → checks #33 only, `skippedFresh: 1`; stale-row case; 5-stale-drafts cap case; pre-023 fail-open case). Parent re-ran the full suite after both items: **1556/0 (403 suites)**. Parent diffed `scheduler.js` vs the bb6121f backup: exactly the claimed change (import + helper + seoRun loop), nothing else. No existing test touched or weakened.
- **Live verification (parent, raw curl):** deployed `scheduler.js` on main contains `isSeoFreshForCurrentBody` ×2, `skipped-fresh` ×1, `ORDER BY updated_at ASC LIMIT 10` ×1. Live D1: #33 still 0 `seo_checks` rows — EXPECTED, the fix only affects the NEXT daily run (24 Nov 00:00 UTC; expected then: #28/#31/#29 skipped-fresh, #33 + #30 checked). Protected #26–#33 re-verified after deploy: all draft, lengths unchanged.
- **NOT TESTED live:** the next-run effect (observable only after the 24 Nov daily run's `agent_runs` seo-run detail — `checked` + `skippedFresh` — and the new `seo_checks` rows for #33/#30).
- **Rollback:** revert the deploy commit (shared with item 1 — reverts both; no migration to roll back; no data written by the change itself).
- **Confirmation:** no code change to #33, no `seo_checks` rows hand-inserted, no live D1 writes by this item; no settings, Emergency Stop, schedule, or cron changed.

## 2 — SERVER-SIDE ARTICLE/DIVISION/TOOL HEADS FOR CRAWLERS (biggest SEO item)
- **Status: DONE — built + tests green (1628/0, 418 suites) + deployed (run #58, HEAD 1b52f98) + LIVE-VERIFIED by the parent (raw curl, no JS): `x-seo-head: rewritten` on articles 1/12/25, division automotive, tool percentage; `fallback` on unknown 999 + draft 28 (no draft leak). See the run #58 verification appended after the item 2 confirmation.**
- **Mechanism decision — Cloudflare Pages Function, NOT build-time generation.** Evidence from the repo: there is no `functions/` dir, no `_routes.json`, and Pages returns 404 for `/api/*` today (no Function exists); the Pages project is Git-connected (auto-deploys on push to main) with build output directory `frontend` and no build command (README.md "Build command: (none) / Build output directory: frontend"); `config/wrangler.toml` configures the Worker only (its header states the Pages build output directory is set in the dashboard, NOT in the file). Build-time generation was REJECTED because static hosting cannot vary content by query string — `/pages/article?id=1` and `?id=2` serve the same file — so it would need new per-article URLs plus sitemap changes plus redirects, breaking the brief's "keeps every existing URL" rule (Pages `_redirects` cannot match query strings either). Only a Function can keep the exact `?id=` / `?division=` / `?tool=` URLs with per-id server-side heads. The A3 report's rejection of a Worker route / Pages Function ("same cost, plus the Pages/Functions routing the project has avoided") does not hold for the URL-keeping requirement and was re-examined from evidence. Official Cloudflare Pages routing docs (opened 2026-11-23, developers.cloudflare.com/pages/functions/routing/): "If no Function is matched, it will fall back to a static asset if there is one" — a matched Function runs BEFORE the static asset, so `functions/pages/article.js` runs for `/pages/article` even though `frontend/pages/article.html` exists; `_routes.json` "should be placed in the build directory of your project" (= `frontend/`); "Once you add Functions on a Pages project, all requests by default will invoke your Function. To continue receiving unlimited free static requests, exclude your project's static routes by creating a `_routes.json` file" — and it is auto-generated if absent, so shipping our own (include only the 3 paths) keeps everything else purely static. `functions/` sits at the project root, "created alongside the build output, not inside it".
- **ONE config assumption the parent must verify live:** the Pages dashboard "Root directory" is the repo root (the default, implied by the relative output dir `frontend`). The parent's live curl proof decides: per-article tags present after deploy = Functions live; generic tags = the root is set to `frontend` instead → then move the `functions/` tree under `frontend/functions/` and re-deploy. Recorded in `functions/seo-head.js` (header) as well as here.
- **Caveat:** the `deploy:pages` npm script (`wrangler pages deploy frontend --project-name fs-ai`) is a direct upload of `frontend/` only and would NOT deploy repo-root `functions/` — the Git auto-deploy path (the live path) must be used.
- **Transform — pure string transform, NOT HTMLRewriter.** HTMLRewriter is a Workers-runtime API that does not exist in Node, so a Function built on it could NOT be unit-tested by this repo's `node --test` suite — the rewrite logic would be untested code. `functions/seo-head.js` does the same rewrite as a pure string transform over the site's own pinned static templates, with fail-closed anchor checks (any anchor missing or appearing ≠ exactly once → the original page is returned untouched). The module uses no Workers-only APIs, so the tests exercise the real code path. The brief's HTMLRewriter mention was an example ("for example"), not a mandate.
- **Files changed (exact list):**
  - `functions/seo-head.js` (NEW, 36 KB) — the shared pure module: constants (`SITE_URL`, `OG_IMAGE_URL`, `LIVE_API_URL`, `SEO_CACHE_CONTROL`), `escHtml`/`safeJsonLd`, `extractArrayLiteral` (string-aware scanner: `'...'`/`"..."`/backtick with `${...}`, `//` + `/* */` comments, escapes), `parseStaticData` (all-or-nothing shape validation), `mapLiveArticle`/`findArticle` (static first, live only for ids the bundle lacks), `buildArticleHead` values via `rewriteArticleHtml`/`rewriteDivisionHtml`/`rewriteToolHtml` (each returns `{ html, rewritten }`, fail-closed), `seoHeaders`, `handleSeoRequest` (injectable `deps { fetchAppJsText, fetchLiveArticles }`; non-GET and non-HTML pass through; any failure returns the static page).
  - `functions/package.json` (NEW) — `{"type": "module"}` so the Node suite can `require()` the ESM module (same pattern as `backend/package.json`, which is why `require()` works for backend files). The Pages Functions runtime loads `.js` route files as modules regardless.
  - `functions/pages/article.js`, `functions/pages/division.js`, `functions/pages/tools.js` (NEW, thin) — each only `export async function onRequest(context) { return handleSeoRequest(context, '<kind>'); }`.
  - `frontend/_routes.json` (NEW) — `{"version": 1, "include": ["/pages/article", "/pages/division", "/pages/tools"], "exclude": []}`.
  - `backend/services/daily-health-report.js` — check 14 `serverSideHeads` (see below) + `HEALTH_REPORT_CHECK_KEYS` 13 → 14 + header note. No other check touched.
  - `frontend/scripts/dashboard.js` — label `serverSideHeads: 'Server-side heads (crawlers)'` + `case 'serverSideHeads'` in `healthReportLine` (reports `passed of checked samples` + failures). The list renders by iterating the labels map, so the key MUST be added or the check never renders.
  - `tests/fixpass2-item2.test.js` (NEW, 50 tests in 12 suites, 2.1–2.12).
  - `tests/closeout-a5.test.js` — spec-driven fixture update only (see "Tests" below); no assertion weakened. `tests/closeout-a7.test.js` — same.
- **Data — the same data the page already uses (merged static + live list):**
  - Articles: the static bundle (`frontend/scripts/app.js` ARTICLES, ids 1–25) is the source of truth for shared ids — STATIC WINS, the same merge rule as `mergeLiveArticles` (the D1 excerpts differ from the static excerpts for all 25, so the Worker API must NOT override them). The Worker `GET /api/articles?limit=100` is fetched ONLY when the requested id is not in the static bundle (a newly auto-published article); on any fetch failure the unknown id falls back to the static page. **Drafts are NEVER exposed:** the API SQL filters `status='published'`, AND `mapLiveArticle` rejects any row whose `status` field is present and not `'published'` (defense in depth — this guard was ADDED because the new tests caught the handler serving a draft row that leaked into a fake API response; see "Tests").
  - Divisions / tools: `app.js` DIVISIONS / TOOLS, parsed from the deployed `app.js` text (fetched via `env.ASSETS`, same deploy, no network). The Worker `/api/divisions` and `/api/tools` endpoints are deliberately NOT used: their division descriptions differ from the page's (seed/D1 automotive 'Buying guides, maintenance checklists, EV and fuel-saving advice.' vs app.js 'Practical guides to buying, maintaining and understanding cars and motorcycles — from EV charging to warning lights.'), and their tool slugs differ from the page's `?tool=` ids (Worker `currency-manual-rate`/`storage`/`distance`/`age`/`date`/`unit`/`time` vs frontend `currency-converter`/`storage-converter`/`distance-planner`/`age-calculator`/`date-calculator`/`unit-converter`/`time-calculator`). Using them would serve heads that disagree with the JS-rendered page.
  - Static-bundle parsing: the three arrays are extracted with a string-aware scanner and evaluated with `new Function` — the input is the site's OWN deployed file (same deploy, first-party code, never user input) and the result is shape-validated; any failure returns null (fail-closed). ONE exception found during the build: ARTICLES is not a pure literal — it references the string constant `GENERAL_DISCLAIMER` (app.js line 7, used by the Finance articles' `disclaimer:` field). `parseStaticData` extracts that constant and binds it when evaluating; the disclaimer itself is not head data and is never emitted. Verified: app.js contains ZERO `${` sequences (grep count 0), so template literals evaluate to plain strings; the scanner still handles `${` for future safety. No body in the 25 static articles contains `</noscript` or `<script` (asserted by test). Parsed data is cached at module level per isolate (a deploy creates fresh isolates, so a deploy can never serve the previous bundle's heads).
- **Head values mirror the JS exactly** (so crawler head == browser head): article.html inline JS (title `a.title + ' — FS AI'`; description/excerpt; og:title/description/url; og:image shared 1200×630; twitter card/title/description/image; `article:published_time` = a.date Set B; `article:section` = division; `article:tag` = category if present; canonical self-referencing; Article JSON-LD headline/description/datePublished/inLanguage en/author Fahad Somrat/publisher FS AI/mainEntityOfPage/articleSection + BreadcrumbList Home/division/article); division.html JS (title `div.name + ' — FS AI'`; description; canonical/og:url `…/pages/division?division=<id>`; twitter; CollectionPage JSON-LD, updated in place on the existing `#divisionJsonLd` element); tools.js `showTool` (title `def.name + ' — FS AI'`; description from F.TOOLS; canonical/og:url `…/pages/tools?tool=<id>`; twitter; WebApplication JSON-LD on `#toolsJsonLd`, applicationCategory UtilitiesApplication, operatingSystem Any). No `dateModified` anywhere (no data source — A2 test locks this in). One shared og image, no per-article image.
- **Noscript bodies:** article — the `<p class="muted">Loading article…</p>` inside `#articleBody` is replaced by `<noscript>` with h1 (escaped title) + meta line (`No. XX · Published YYYY-MM-DD · FS AI · division`) + excerpt + the article body HTML as-is (trusted, our own content; the API already strips draft banners via `publicArticle`, static bodies are banner-free; a body containing `</noscript` or `<script` refuses the whole rewrite). JS browsers discard it when the JS replaces `#articleBody` innerHTML; no-JS browsers render it. Division — the `<p class="muted grid-loading">Loading articles…</p>` in `#divisionArticles` is replaced by a `<noscript>` list of that division's articles (title links + excerpts; **static-only — a newly published article appears in it only after the next deploy, same staleness class as the sitemap's hourly refresh**; the HEAD tags need no live fetch). Tool — `<noscript>` with the tool description text inside the empty `<p id="toolDescription"></p>` (input labels NOT included: they live in tools.js DEFS, whose `calc` functions are code, not a pure data literal — will not be eval'd).
- **Unknown ids:** unknown article id / unknown division slug → static page unchanged (existing behaviour preserved); bare `/pages/division` (no slug) and bare `/pages/tools` (no `?tool=`) → no rewrite (the generic page IS the correct content for those URLs); unknown `?tool=` → static unchanged. **Known divergence (documented, not a bug):** the JS `showTool` gives an unknown `?tool=` the default (Fuel Cost) tool's head, but the Function does not rewrite it — inventing a per-tool canonical for a URL that names no real tool is worse than the generic head.
- **JSON-LD safety:** `JSON.stringify` then `<` → `\u003c` (and `>` → `\u003e`) so no string can break out of the `<script>` block (test pins: a fixture title containing `</script><script>alert(1)</script>` adds exactly the two new JSON-LD closers and no literal `</script>` inside either block). Attribute/text escaping: `&` → `&amp;`, `"` → `&quot;`, `<` → `&lt;`, `>` → `&gt;` (apostrophe stays literal — valid in double-quoted attributes and text; article 1's title contains one). The inserted JSON-LD script ids (`articleJsonLd`/`articleCrumbs`) match the ids the JS looks up, so when JS also runs it removes/replaces them — no duplicate JSON-LD after JS runs (division/tools update the existing element in place, as A3 does).
- **Cache headers (exact, and why):** rewritten responses carry **`Cache-Control: public, max-age=0, must-revalidate`** — the site's existing HTML caching (Fix Pass 2 item 0 found the same header on the homepage). max-age=0 + must-revalidate means the edge must revalidate with the Function before serving a stored copy, so a rewritten response for `?id=1` can never be served for `?id=2` without the Function re-running and returning the correct content. **ETag and Last-Modified are STRIPPED** from rewritten responses: they describe the static file, not the rewritten body, and the static file's ETag does not change when app.js data changes (a stale validator could otherwise bless a wrong 304). **Content-Length is also deleted** (a stale value copied from the static response would truncate or error the longer rewritten body; the runtime recomputes it). **No `Vary` header:** the response varies by URL (query string), which is part of the cache key; Vary is for request headers and would add no protection. Unrewritten (fallback) responses keep the original headers untouched. On ANY error the handler returns the static page (200, original headers) — never a 500, never a broken page. The only throw path is if `context.next()` itself fails (the static asset is unavailable — nothing to serve then). Non-GET requests and non-HTML responses pass through untouched.
- **Health check 14 `serverSideHeads`** (`backend/services/daily-health-report.js`): samples articles **1, 12, 25** (expected title + `published_at` date read from D1 published rows), division **automotive** (name from D1 `business_divisions`), tool **percentage** (expected title 'Percentage Calculator' as a constant — tool metadata lives in app.js, not D1). Each sample URL is fetched as a no-JS crawler (plain fetch via the existing `fetchWithTimeout` 10 s helper) and asserted: `<title>` per-page title; self-referencing canonical link; og:url; article `article:published_time` + Article JSON-LD `"@type":"Article"` with `"datePublished":"<D1 date>"`; division CollectionPage JSON-LD; tool WebApplication JSON-LD; `<noscript>` present containing the (escaped) title for articles / an `article?id=` link for the division / non-empty for the tool. **The excerpt is deliberately NOT asserted** — D1 excerpts differ from the static-bundle excerpts by design (static-wins), so an excerpt comparison would FAIL live. Statuses: OK if all 5 samples pass; FAIL if any sample is non-200, fetch throws, or an assertion fails (detail lists per-sample failures); NOT TESTED only when the check cannot run at all (a D1 row missing for a sample id/slug — expected values undeterminable). Follows the existing check pattern (try/caught per check via `runCheck`, never throws into the daily run, NOT TESTED never degrades the overall). Dashboard: `serverSideHeads: 'Server-side heads (crawlers)'` in `HEALTH_REPORT_LABELS` + a `case 'serverSideHeads'` in `healthReportLine`. First real report appears only after the **24 Nov 00:00 UTC daily run** (after this item deploys; before deploy it FAILs honestly — the heads do not exist yet — which is the correct signal, not a false alarm).
- **Tests:** before **1556 pass / 0 fail, 403 suites** (parent baseline after items 1+4) → after **1606 pass / 0 fail, 415 suites** (`npm test`, exit 0, log `/tmp/verify/fixpass2-item2-full.txt`), **+50 tests, all in `tests/fixpass2-item2.test.js`** (12 suites: 2.1 extractArrayLiteral edge cases; 2.2 parseStaticData on the real app.js — 25/8/20, Set B dates, GENERAL_DISCLAIMER bound, no `${`, no breakout bodies; 2.3 per-article heads for 1/12/25 + the visible page otherwise byte-identical — every other line identical and in order, GA/styles/scripts/footer kept; 2.4 automotive CollectionPage + noscript list of all 12 articles; 2.5 percentage WebApplication + noscript description; 2.6 unknown ids / bare URLs → static fallback (200, original headers); 2.7 draft 28 NEVER exposed + live-only 34 served + static-wins + live row without a valid date never used; 2.8 data-source errors → static fallback, still 200; 2.9 exact cache headers vs fallback headers; 2.10 escaping + JSON-LD breakout; 2.11 health check 14 units + `buildDailyHealthReport` through a minimal fake env; 2.12 `_routes.json` + route files + dashboard label). **Bug found by the new tests and fixed in the build (not in the tests):** `mapLiveArticle` initially accepted any row regardless of `status` — the draft-28 test caught the handler rewriting a draft row that leaked into a fake API response; the status guard (`status` present and not `'published'` → null) was added to `functions/seo-head.js` and the test now passes. **Spec-driven updates to existing tests (no weakening — fixtures only, per the pass rules):** `tests/closeout-a5.test.js` and `tests/closeout-a7.test.js` — their `makeMockFetch` helpers gained a `headsHtml` option (default: a canned rewritten-head map built from the seed titles/dates, canonical copy in `tests/fixpass2-item2.test.js` `sampleHeadHtml`; a test that changes a sample article's D1 title/date must pass its own `headsHtml`). Without this, check 14 FAILs in their all-green fixtures (empty article pages, 404 division/tool) and degrades their asserted overalls to FAIL — the fixtures must model a site where the Function is live. A5.1 additionally asserts `serverSideHeads: OK` (checked 5 / passed 5 / failures []); the A5 file header "all 13 check keys" → "all 14". A7's `reportFor` needed no change (the default map applies). **No existing test was weakened** — only the two mock fixtures were extended and one A5.1 assertion added; every previously-passing assertion still passes.
- **What was NOT done / NOT TESTED:**
  - NOT DEPLOYED — the parent deploys (zip + one-time workflow) and live-verifies; see "Live proofs the parent must run" below.
  - NOT TESTED live: the Function actually running on Pages (per-article tags in raw curl); the `_routes.json` being honoured (no other URL routed to a Function); the dashboard health-report block rendering check 14 (the label/case are pinned by string tests only); console errors / failed network requests / a real-browser render of a rewritten page (the rewrite is head/noscript-only by construction, and the line-equality tests pin the visible page unchanged — but no live browser run happened).
  - NOT DONE: build-time static generation (rejected — see the mechanism decision); a Worker-route alternative (rejected with it); the division noscript list for newly published articles (static-only by design, noted above); the noscript meta line uses the ISO date (`Published 2026-11-01`) while the JS renders the formatted date (`Published 01 Nov 2026`) — cosmetic, same information; the `factCheckRun` starvation shape (item 4's sibling, out of scope); no change to the sitemap script (it already fetches the live list).
  - Rollback: revert the deploy commit (deleting `functions/` + `frontend/_routes.json` returns the site to the previous JS-only behaviour — the static pages are untouched, so the rollback is the removal of the Function alone). No migration to roll back; no data was written by this item.
- **Live proofs the parent must run after deploy (raw curl, no JS — the whole point of the item):**
  - `curl -s https://fs-ai-5w5.pages.dev/pages/article?id=1` — expect `<title>EV Charging at Home: A Complete Beginner's Guide — FS AI</title>`, canonical `…/pages/article?id=1`, og:url same, `article:published_time` `2026-11-01`, `"@type":"Article"` + `"datePublished":"2026-11-01"`, BreadcrumbList, `<noscript>` containing the article text. Same for `?id=12` (date `2026-11-06`) and `?id=25` (date `2026-11-11`).
  - `curl -s "https://fs-ai-5w5.pages.dev/pages/division?division=automotive"` — expect `<title>Automotive — FS AI</title>`, canonical `…/pages/division?division=automotive`, `"@type":"CollectionPage"`, `<noscript>` list of 12 article links.
  - `curl -s "https://fs-ai-5w5.pages.dev/pages/tools?tool=percentage"` — expect `<title>Percentage Calculator — FS AI</title>`, canonical `…/pages/tools?tool=percentage`, `"@type":"WebApplication"`, `<noscript>` with the description.
  - `curl -s https://fs-ai-5w5.pages.dev/pages/article?id=999` — expect the generic static page (title `Article — FS AI`, 200). `?id=28` — expect the generic static page with NO draft title/body.
  - `curl -s -D - https://fs-ai-5w5.pages.dev/pages/article?id=1 -o /dev/null` — expect `Cache-Control: public, max-age=0, must-revalidate` and NO `ETag` / `Last-Modified` on the rewritten response.
  - `curl -s https://fs-ai-5w5.pages.dev/_routes.json` — expect the file served (version 1, include exactly the three paths). (If the Functions are not invoked at all — generic heads everywhere — the Pages dashboard "Root directory" is `frontend`, not the repo root; move `functions/` under `frontend/functions/` and re-deploy.)
  - Confirm the home page and a division page still return 200 with the same visible content (no other URL routed to a Function).
  - After the 24 Nov 00:00 UTC daily run, check the stored health report's `serverSideHeads` (dashboard Control Center): OK = the Function is live; FAIL lists the failing sample; NOT TESTED = a D1 sample row is missing.
- **Confirmation (item 2):** no protected article (#26–#31, #33) was published, edited, or touched — all test articles are fixtures (explicit ids 99/34 in throwaway handler calls, seed rows only in in-memory SQLite); no live D1 writes of any kind were made (no migration, no row changes); no auto-publish setting, Emergency Stop, schedule, or cron was changed; the daily Shorts cron stays PAUSED; social_auto_post stays OFF; no OAuth connection was started and no account was connected; no secret was written to code, logs, reports, or screenshots; nothing was uploaded or published (no video, no article, no Pin).

### Item 2 — parent deploy follow-up (runs #55–#57)
- **Run #55 GREEN** (2026-11-23 13:37–13:40, HEAD a46e06315b1bb8ed80aa9dbd1a8ba2463682bce8, parent 67dd6c1, 12 files, +1,998/−11). Parent live-verified by raw curl: the deploy HAD propagated (served dashboard.js contains the new "Server-side heads" label ×1; GitHub API confirms HEAD a46e0631) — but article 1/12/25, division automotive and tool percentage ALL showed generic heads (title "Article — FS AI" / "Divisions — FS AI" / "Free Tools — FS AI", no per-page canonical, no og:url, no Article/CollectionPage/WebApplication JSON-LD, noscript 0). Unknown 999 + draft 28 also generic (correct fallback, indistinguishable from "Function not running"). `_routes.json` fetched from the site returns 404 — config files are not served, expected, not evidence. Conclusion: the Function was NOT running; NOT a propagation delay.
- **Root-directory hypothesis + move (the builder's prescribed fallback):** parent moved `functions/` → `frontend/functions/` (test require/read paths updated; suite stayed 1606/0). **Run #56 GREEN** (2026-11-23 13:47–13:48, HEAD 522a91546997e4a723cf920a152cf60f3fff3b20, parent a46e063, 7 files, +857/−8). Parent live-verified: STILL generic heads everywhere (article 1/12/25, division, tool). The move did NOT fix it — the location is not (or not only) the cause.
- **DEPLOY FLAW FOUND (run #56):** the old repo-root `functions/` is STILL on main. GitHub API tree for 522a9154 (HTTP 200, not truncated, 412 paths) lists BOTH `functions/` (6 entries) AND `frontend/functions/` (6 entries). Cause: the one-time push workflow flattens with `cp -a` (adds/overwrites only, never deletes) and `git add -A` stages deletions only for files missing from the working tree — the old `functions/` was never removed from the working tree, so it survived. **The workflow NEVER deletes a file removed from the local tree.** Recorded in AGENTS.md. Any future file deletion needs an explicit removal step in the workflow (or deletion via the web UI) — never assume the deploy syncs deletions.
- **Diagnostic (parent, run #57):** the Function now sets `x-seo-head: rewritten` (`seoHeaders`) or `x-seo-head: fallback` (`passthrough`) on every response it constructs — a TEMPORARY live diagnostic, to be removed once the live behaviour is proven and the root cause is known. The Function code is shipped in BOTH locations with byte-identical files (local `cp -r frontend/functions functions`; new test suite 2.13 asserts the 5 files are identical in both copies + both carry the diagnostic; 3 header assertions added to 2.9). Tests 1606 → **1612/0** (parent re-ran the full suite). Parent diffed vs the bb6121f backup: exactly the item 1+4+2 sets, nothing else.
- **Live proof for run #57:** `curl -sI "https://fs-ai-5w5.pages.dev/pages/article?id=1"` — `x-seo-head` PRESENT means the Function runs (`rewritten` = heads live, item 2 DONE; `fallback` = the Function runs but falls back on every request — then the transform's live failure is the bug to fix). `x-seo-head` ABSENT means the Function never runs in either location (project config — Functions not deployed at all — needs a different investigation). Once the header proves which location is live, delete the other copy with an EXPLICIT removal (the workflow will not do it on its own).

### Item 2 — follow-up fix: pure parser replaces code generation (built, NOT deployed)
- **Root cause (proven live + docs):** run #57's diagnostic answered the question — live GETs return `x-seo-head: fallback` on all three routes, so the Function RUNS but falls back on every request. The cause: `seo-head.js` evaluated the static bundle's JS literals with `new Function` (`evalArrayLiteral` + `extractStringConstant`). The Workers runtime forbids it — the runtime-apis docs state `eval()` and `new Function` are "not allowed for security reasons"; inside a Worker they throw `EvalError: Code generation from strings disallowed for this context`. The throw happens inside `handleSeoRequest`'s try/catch, which fail-closes to passthrough — every request served the generic static page. Node tests pass because Node allows it; the deploy succeeds because nothing executes until the first request. The backend Worker and frontend scripts contain no such call (parent grepped) — the bug was confined to the Function code. Note for the live proof: `curl -sI` (HEAD) can NOT show the header — the handler only handles GET, and a HEAD request returns the original response before the header is set; the proof needs a GET (`curl -s -D - -o /dev/null <url>`).
- **Fix:** both code-generation calls replaced with a pure recursive-descent parser (`LiteralParser` + exported `parseJsLiteral`, in `frontend/functions/seo-head.js`): strings (single/double/backtick, full JS escape decoding incl. `\x`/`\u`/`\u{...}`, line continuations; an interpolation throws), numbers (incl. negatives/decimals/exponents), true/false/null, arrays, objects with identifier or quoted keys, and identifier references resolved ONLY from the given bindings (GENERAL_DISCLAIMER is the one real case). Anything else throws and the caller turns it into null (fail-closed, same contract as before). `__proto__` keys are set via defineProperty (no prototype pollution). `parseStaticData`'s all-or-nothing shape validation is unchanged; the three call sites now use `parseArrayLiteral`. The `x-seo-head` diagnostic header is KEPT (the parent needs it for the live proof after this deploy). Both Function copies re-synced byte-identical (`rm -rf functions && cp -r frontend/functions functions`; `diff -r` clean; suite 2.13 still asserts it).
- **Tests:** before **1612/0** (parent baseline after run #57) → after **1628/0, 418 suites** (full `npm test`, exit 0, log `/tmp/verify/fixpass2-item2-parser-full.txt`), **+16 tests, all new** in `tests/fixpass2-item2.test.js` (suites 2.14 + 2.15). 2.14: parser units — all quote styles + escapes, numbers/booleans/null, nested arrays/objects + trailing commas, bindings (bound resolves, unbound throws), rejections (interpolation, function call, trailing input, unterminated string, newline in quoted string, array hole, malformed number, octal escape, empty input), `__proto__` safety, and the extracted ARTICLES literal parsing exactly (25 rows, article 1 title, article 17 disclaimer bound, backtick body intact). 2.15 (regression guard, two ways): a grep test asserting NONE of the 8 shipped Function files (both copies × seo-head.js + 3 route files) contains `new Function`, `eval(`, `WebAssembly.compile` or `WebAssembly.instantiate` (comments naming the APIs were removed from the Function code so the test cannot false-fail — the only remaining "eval" substrings are the words "revalidate"/"evaluated" in comments, which the exact call spellings do not match); PLUS a runtime proof — a child Node process run with `--disallow-code-generation-from-strings` (the flag that reproduces the runtime's EvalError) that first proves the flag is enforced (a code-generation call throws EvalError) and then parses the real bundle through the real module: 25/8/20. Pre-fix reproduction, run by the builder before the fix: the OLD code under the same flag returned null/null/null. No existing test was weakened; no fixture changed.
- **Files changed (exact list):** `frontend/functions/seo-head.js` + `functions/seo-head.js` (identical — parser replaces both code-generation calls, header comment rewritten); `tests/fixpass2-item2.test.js` (+16 tests, suites 2.14–2.15, header list updated). Nothing else. Parent diffed the whole tree vs the bb6121f backup: exactly the item 1+4+2 sets, nothing else.
- **What was NOT done / NOT TESTED:** NOT DEPLOYED — the parent deploys (run #58) and live-verifies; the live proof is the header flipping to `x-seo-head: rewritten` on a GET of `?id=1` (plus the per-article head checks from the original live-proofs list). NOT TESTED live: the rewrite itself (only observable after deploy); the dashboard health-report check 14 (first real report after the 24 Nov 00:00 UTC daily run). NOT DONE: removing the `x-seo-head` diagnostic (deliberate — remove it only once the live behaviour is proven, as a follow-up); removing the duplicate Function copy (only once the header proves which location is live, with an EXPLICIT removal — the deploy workflow never deletes files on its own).
- **Rollback:** revert the deploy commit (removes the parser change with the rest of item 2; the static pages are untouched, so the rollback is the removal of the Function alone). No migration to roll back; no data was written by this item.

### Item 2 — run #58 live verification: DONE (2026-11-23 ~14:05)
- **Run #58 GREEN** (2026-11-23 14:03–14:05, HEAD 1b52f987e6862b9819e71d2ff96f1b1f9ae1a76f, parent b2ff36e, 4 files, +659/−44: ledger, both seo-head.js copies, fixpass2-item2.test.js). Parent live-verified by raw curl (no JS), GET requests (HEAD cannot show the header — the handler only handles GET):
  - `?id=1`: **`x-seo-head: rewritten`**, title "EV Charging at Home: A Complete Beginner's Guide — FS AI", canonical + og:url self-referencing, Article + BreadcrumbList JSON-LD, `datePublished` 2026-11-01 (Set B), `article:published_time` 2026-11-01, `<noscript>` with h1. Cache-Control `public, max-age=0, must-revalidate`, no ETag/Last-Modified.
  - `?id=12`: rewritten, title "Best Family Cars Compared: Space, Safety and Running Costs — FS AI", datePublished 2026-11-06.
  - `?id=25`: rewritten, title "How to Plan a Road Trip: Checklist and Costs — FS AI", datePublished 2026-11-11.
  - `?division=automotive`: rewritten, title "Automotive — FS AI", CollectionPage JSON-LD, canonical self-referencing, noscript with article links (13 unique `article?id=` matches in the page — 12 in the division list + 1 elsewhere in the page; observed, not a failure).
  - `?tool=percentage`: rewritten, title "Percentage Calculator — FS AI", WebApplication JSON-LD, canonical self-referencing.
  - `?id=999`: generic title "Article — FS AI" + `x-seo-head: fallback` (correct).
  - `?id=28` (draft): generic title, ZERO draft-title leaks + `x-seo-head: fallback` (correct — drafts never exposed).
  - Home 200, sitemap 60 URLs — the site is intact. GitHub API was rate-limited at verification time; HEAD 1b52f98 was verified by the browser deploy report.
- **Root cause (proven):** `new Function` in `evalArrayLiteral`/`extractStringConstant` threw `EvalError` on workerd on every request (Cloudflare docs: eval/new Function are disallowed), and the handler's fail-closed catch served the static page. The fix (pure recursive-descent parser, `LiteralParser`/`parseJsLiteral`, both copies) is what run #58 shipped. The regression guard (suite 2.15: grep test + `--disallow-code-generation-from-strings` runtime proof) stays in the suite.
- **Follow-ups (deliberate, not blocking):** the `x-seo-head` diagnostic header and the duplicate Function copy (both locations, byte-identical, test 2.13) STAY for now. The header proves the Function runs but cannot say WHICH copy is live (identical values from either location), so removing one copy now would be a guess — it needs a deploy that changes one copy and watches the header, or a deploy that removes one copy with an explicit deletion and confirms the header persists. Same for the header itself: remove it only together with that cleanup, after confirming the remaining copy still rewrites. Do not spend a deploy cycle on either alone.
- **Confirmation (item 2, final):** no protected article was published/edited/touched; no live D1 writes; no settings, E-Stop, schedule, or cron changed; Shorts cron stays PAUSED; social_auto_post OFF; no OAuth; no secrets anywhere.

## 3 — Light theme toggle dead (binding race) — BUILT
- **Status: BUILT — cause found + fixed + tests green (1645/0, 424 suites), NOT deployed (parent deploys + live-verifies).**
- **Cause (proven by code reading, file+line):** a binding race, NOT a CSS bug. The header — and with it `#themeToggle`, `#navToggle` and `.main-nav` — is rendered by `app.js` `renderShared()` (app.js:536-537, `h.innerHTML = renderHeader(...)`; `renderHeader` emits the toggle at app.js:391-392), which runs only after `liveReady` resolves (app.js:332-363, a fetch race with the 5 s `LIVE_TIMEOUT_MS`; app.js:553-556 registers `liveReady.then(renderShared)` inside a DOMContentLoaded handler). `navigation.js` bound the toggle by id inside its OWN DOMContentLoaded handler (old file lines 5 + 21: `getElementById('navToggle')` / `getElementById('themeToggle')`, each guarded by `if (...)`). That handler runs in the same DOMContentLoaded dispatch, before `renderShared` in every case — even a pre-resolved `liveReady` schedules `renderShared` as a microtask that runs after the dispatch. So at bind time the button was `null`, the guard skipped the binding, and the button created later had no handler: clicks did nothing, on all 9 pages (the header div `#siteHeader` is empty in the static HTML). The same race killed `#navToggle` and the active-link highlight (old lines 36-48 read `.main-nav a` before it existed). The CSS was never at fault: `:root[data-theme="light"]` (themes.css) + the icon swap (main.css:55-57, sun/moon keyed on the attribute) are correct — the attribute was simply never set. The parent's symptom (hero RGB 24,23,21 before and after clicks, two tabs) matches exactly.
- **Fix** (`frontend/scripts/navigation.js`, rewritten, same behaviour otherwise):
  - Clicks delegated on `document`, registered at parse time (not on DOMContentLoaded): `closest('#themeToggle')` → toggle theme; `closest('#navToggle')` → toggle `.main-nav.open` + aria attrs (nav looked up at click time); `closest('.main-nav a')` → close the menu. Works whenever the header appears and survives re-renders.
  - Theme resolution extracted (`resolveTheme`/`applyTheme`/`toggleTheme`): saved choice wins; no saved choice → `prefers-color-scheme: light` decides; else dark. The old code only applied a saved `'light'` and ignored the system preference entirely.
  - Active-link highlight extracted to `highlightActiveNav()` and re-run once the header appears via a one-shot MutationObserver on `#siteHeader` (`observeHeaderForNav`; runs at once if the nav is already there).
  - No-flash: an identical pre-paint snippet in `<head>` of all 9 pages (index + about/article/contact/dashboard/division/privacy/terms/tools), immediately before the themes.css `<link>`, applying the same resolution before first paint; navigation.js re-applies it on DOMContentLoaded (idempotent fallback). `owner-setup.html` loads neither themes.css nor navigation.js, so it needs no snippet. No hero wording, colours, layout or design element changed.
- **Files changed (exact list):**
  - `frontend/scripts/navigation.js` (rewritten, 60 → 119 lines).
  - `frontend/index.html` + `frontend/pages/{about,article,contact,dashboard,division,privacy,terms,tools}.html` — the 2-line pre-paint snippet before the themes.css link, identical in all 9.
  - `tests/fixpass2-item3.test.js` (NEW, 17 tests, suites 3.1–3.6).
  - `docs/FIXPASS2-LEDGER-2026-11-23.md` (this section).
- **Tests:** before **1628 pass / 0 fail, 418 suites** (parent baseline after item 2) → after **1645 pass / 0 fail** (`npm test`, exit 0, log `/tmp/verify/fixpass2-item3-full.txt`), **+17 tests, all new; no existing test weakened, no fixture changed**. Harness: the shipped navigation.js runs in a `node:vm` sandbox with a minimal fake DOM (pattern from tests/closeout-a1.test.js), reproducing the real sequence exactly — DOMContentLoaded fires while `#siteHeader` is EMPTY, the header is rendered LATE (as renderShared does), then clicks happen. Suites: 3.1 the race (old-code regression + new-code pass + no direct id lookup); 3.2 toggle dark↔light + persistence + icon-child click + re-render survival; 3.3 saved/system resolution (5 cases); 3.4 nav toggle + link-close; 3.5 highlight after late render + observer disconnect; 3.6 head snippet identical in all 9 pages, before themes.css, behaviour run in vm (4 cases).
- **Regression proof (dev-time, against the REAL old file):** the parent extracted the pre-fix navigation.js from the Fix Pass 2 backup tarball (`fs-ai-backup-20261123-fixpass2.tar.gz`, 60 lines) and ran the new suite against it — **10 of 17 tests fail** (toggle, re-render survival, system preference, nav toggle, highlight, delegation), exactly the fixed behaviour; the 7 that pass on old code are the ones old code already handled (saved-choice apply, head snippet). File restored afterwards, sha256-verified, suite green again (17/17). The committed suite also carries the inline verbatim copy of the old binding (old lines 18-34) as its regression test, so the proof does not depend on the tarball being present.
- **What was NOT done / NOT TESTED:**
  - NOT DEPLOYED — the parent deploys (zip + one-time workflow) and live-verifies; see "Live proofs" below.
  - NOT TESTED live: the toggle on a real browser/phone (no live click, no computed-style read, no viewport resize — the cloud browser could not do those in the close-out check either); the no-flash behaviour on a slow connection (the head snippet is present in the HTML, but a first-paint flash can only be observed live); `prefers-color-scheme` on a real OS setting (vm-tested only).
  - NOT DONE: a `prefers-color-scheme` change listener (system theme changed while the page is open does not re-apply — out of scope; the brief requires it only at load when no choice is saved); removing the old direct-binding code paths elsewhere (none exist — the grep confirms navigation.js is the only binder).
  - Rollback: revert the deploy commit (navigation.js + 9 HTML files return to the previous version; the toggle goes back to dead, dark stays the default — no data, no settings involved).
- **Live proofs the parent must run after deploy (raw browser, not curl — this is interaction, not markup):**
  - Home `https://fs-ai-5w5.pages.dev/`: note the hero background (dark: rgb(24,23,21)-ish). Click the theme toggle (sun/moon button, header right). EXPECT: hero turns light paper (#f7f4ee gradient), cards/text go dark-on-light, the toggle icon flips sun→moon. Click again → back to dark, icon flips back.
  - Reload the page after switching to light. EXPECT: it opens in light (choice persisted in localStorage `fsai-theme`).
  - Same click test on one article (`/pages/article?id=1`), one division (`/pages/division?division=automotive`) and tools (`/pages/tools`): toggle works on each, and the choice carries across pages (set light on home, open an article → article opens light).
  - Mobile menu (same race, same fix): at a narrow viewport, tap the hamburger → menu opens; tap a nav link → menu closes.
  - System preference: clear localStorage `fsai-theme` (or a fresh profile), set the OS/browser to light mode, load the home page → EXPECT light without clicking; set OS to dark → EXPECT dark. (Needs a real device/browser setting — the cloud browser cannot set this; mark NOT TESTED if it cannot be done there.)
  - No-flash: with light saved, hard-reload the home page and watch the first paint — EXPECT light immediately, no dark flash. (Needs a real browser observation; mark NOT TESTED if the cloud browser cannot show it.)
  - Confirm nothing else changed: hero copy/stats unchanged, all 8 division cards render, tools still compute (20% of 150 = 30.00).
- **Confirmation (item 3):** no protected article (#26–#31, #33) was published, edited, or touched; no live D1 writes of any kind; no auto-publish setting, Emergency Stop, schedule, or cron changed; Shorts cron stays PAUSED; social_auto_post OFF; no OAuth; no secrets anywhere; hero wording untouched.
