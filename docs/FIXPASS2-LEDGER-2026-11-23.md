# FIX PASS 2 LEDGER — 2026-11-23

**Brief:** FS AI FIX PASS 2 (owner, 2026-11-23 12:44). Items 0–7. This ledger is
written by the Item 1 builder; items 2–7 are NOT in this file yet — the
owner of each later item appends its section here.
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
- **Status: BUILT — built + full suite green, NOT deployed (parent deploys),
  migration 032 NOT applied to live D1 (parent applies).**
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
- NOT DEPLOYED — the parent deploys; migration 032 NOT applied to live
  D1 (the parent applies it). No live D1 read or write was made by this
  item at all (no article data touched, no settings changed).
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
