# FS AI Fix Pass 2 — Final Report

Date: 2026-11-23. Brief: owner brief 2026-11-23 12:44 (English), 8 items
(0–7). One item at a time: change → tests → deploy → raw live
verification → next. Hard rules held throughout: no protected article
(#26–#31, #33) published/edited/deleted/touched; no auto-publish
settings, Emergency Stop, schedule or cron changed; daily Shorts cron
stays PAUSED; social_auto_post OFF; no OAuth, no uploads, no real
publishing to test (fixtures/scratch DB only); $0 only; no secrets in
code/logs/reports; raw curl output for every live check (a browser
agent's description is NOT proof); anything not run marked NOT TESTED.

**Final HEAD: 89f7926fab5910fd5cf9cd592bdee48efac63074** (run #62,
2026-11-23 14:46). **Tests: 1668 pass / 0 fail, 426 suites** (baseline
1524/0 at 12:45 → +144 tests, 0 weakened). **Runs #54–#62: all GREEN**
(9 deploys, 0 red). Ledger: `docs/FIXPASS2-LEDGER-2026-11-23.md`
(deployed, same HEAD).

## Item 0 — Deploy consistency check: DONE (read-only)

The user's outside fetch had shown old homepage content (meta "25 free
articles", twitter:card summary, no og:image, "Honest numbers" section).
Parent's raw curl (12:45): "Honest numbers" **0**, "og:image" **4**,
"25 free articles" 0; plain vs cache-busted identical from two PoPs;
Cache-Control `public, max-age=0, must-revalidate` (edge revalidates
every time — stale edge cache essentially impossible); served
index.html/app.js/newsletter.js/animations.js byte-identical to the
local bb6121f tree; GitHub API latest commit = bb6121f. The one "no
free email sender" hit is current intentional footer text (the form is
hidden by the flag; the explanatory text stays by design). **Verdict:
live WAS HEAD bb6121f; the old content was a stale cache on the user's
side, not live.** The brief's STOP condition did not trigger; the pass
proceeded. Worker health 200.

## Item 1 — Manual publish must respect the gate: DONE

- **Deploy:** run #54 (with item 4), HEAD 67dd6c1, 2026-11-23 13:09.
- **Tests:** 1528 → **1556/0** (403 suites), +28, parent re-ran.
- **What:** `POST /api/admin/articles/:id/publish` now runs
  `evaluateManualPublishGate()` (the same `evaluatePublishGate()`,
  content checks 1–7 + E-Stop off + daily limit). Blocked → **422**
  with the reasons + full gate detail; nothing written. Override body
  `{"override": "PUBLISH DESPITE GATE"}` (exact phrase, case-sensitive,
  shown as the dashboard input placeholder) → publishes, response
  carries `overridden: true`; wrong phrase → 422; unparseable body →
  400; unevaluable gate → 503 fail-closed. **Emergency Stop can NEVER
  be overridden** (422 on both paths, no audit row — owner turns the
  Stop off first). **#26/#27 refuse 403 always** (existing
  assertNotProtected, override or not). **Legacy #28–#31/#33 refuse 422
  on the normal path even with a passing gate**; the audited override is
  their only path. Banner strip still runs first. Unpublish ungated,
  unchanged.
- **Audit:** new table `article_publish_overrides` (migration 032 —
  applied to live D1 13:06, table + 2 indexes verified, 0 rows), written
  BEFORE publishing; INSERT failure refuses with 503 (fail-closed).
  `human_review_applied=1` for Health/Finance (typing the phrase IS the
  human review). Check 10 (publishing-rules) is EXCLUDED from the manual
  gate deliberately — it governs system auto-publish; requiring it would
  make the button permanently dead under the live approved_only default
  (one filter line in evaluateManualPublishGate if the parent disagrees
  — recorded in the ledger).
- **Dashboard:** plain click → POST no body; on 422-with-gate the reason
  list shows + the hidden override block appears; E-Stop refusal does
  NOT reveal it.
- **Live verification (raw curl):** served dashboard.js contains
  "PUBLISH DESPITE GATE" ×2; deployed gate.js contains
  MANUAL_PUBLISH_OVERRIDE_PHRASE ×1 + evaluateManualPublishGate ×2;
  served dashboard.html (via `curl -sL`, the plain fetch 308-redirects)
  contains articlePublishOverride ×4; migration 032 on main; protected
  #26–#33 all draft, lengths unchanged; overrides 0 rows.
- **NOT TESTED live:** the endpoint against the live Worker, the
  dashboard override flow in a real browser, a real owner override
  end-to-end (fixtures only, as required).
- **Known gap (carried, needs its own owner decision):**
  create-with-`status:'published'` and PUT draft→published are NOT
  gated (a create can never pass the gate — no fact-check/SEO rows exist
  before the row exists — and gating PUT changes the edit API contract).
  The coherent follow-up is to forbid `status:'published'` in
  create/PUT and route every publish through POST /publish.

## Item 2 — Server-side article/division/tool heads: DONE

- **Deploy:** run #58, HEAD 1b52f98, 2026-11-23 14:03–14:05 (after runs
  #55/#56 proved the Function was not running, and run #57 shipped a
  diagnostic header).
- **Tests:** 1556 → **1628/0** (418 suites), +72 across the item.
- **What:** Cloudflare Pages Function (`functions/` at repo root +
  `frontend/functions/`, byte-identical, test-pinned) + `frontend/_routes.json`
  (include exactly `/pages/article`, `/pages/division`, `/pages/tools`).
  Pure string transform (not HTMLRewriter — it does not exist in Node,
  so it could not be unit-tested); fail-closed anchor checks. Static
  bundle is source of truth (static-wins, same rule as the live-article
  merge); the Worker `/api/articles?limit=100` is fetched ONLY for ids
  the bundle lacks. Draft rows are never exposed (API filter AND a
  status guard — the draft-28 test caught the missing guard during the
  build). Health-report check 14 `serverSideHeads` added (dashboard
  label "Server-side heads (crawlers)").
- **Root cause (proven):** `new Function` in `evalArrayLiteral` /
  `extractStringConstant` threw `EvalError` on workerd on every request
  (Cloudflare docs: eval/new Function are disallowed) and the handler's
  fail-closed catch served the static page. Node tests passed (Node
  allows it), the deploy succeeded (nothing executes until the first
  request) — the classic "works in Node, fails in workerd" gap. The fix
  is a pure recursive-descent parser (`LiteralParser` /
  `parseJsLiteral`); the regression guard (suite 2.15) is a grep test
  (no code-generation API in the 8 shipped Function files) + a runtime
  proof under Node's `--disallow-code-generation-from-strings` (old code
  returned null/null/null under the flag; the new parser returns
  25/8/20).
- **Live verification (raw curl GET — HEAD cannot show the header):**
  `x-seo-head: rewritten` on article 1 (title, canonical, og:url,
  Article + BreadcrumbList JSON-LD, datePublished 2026-11-01 Set B,
  noscript h1), article 12 (2026-11-06), article 25 (2026-11-11),
  division automotive (CollectionPage JSON-LD, noscript article list),
  tool percentage (WebApplication JSON-LD). Unknown 999 + draft 28:
  generic title + `fallback`, zero draft-title leaks. Home 200, sitemap
  60 URLs.
- **NOT TESTED live:** the dashboard health-report check 14 rendering
  (first real report after the 24 Nov 00:00 UTC daily run).
- **Follow-ups (deliberate, not blocking):** the `x-seo-head`
  diagnostic header and the duplicate Function copy stay for now — the
  header proves the Function runs but cannot say WHICH copy is live
  (identical values from either location), so removing one copy now
  would be a guess. Remove both together with a deploy that changes one
  copy and watches the header. Also recorded: the push workflow NEVER
  deletes files removed from the local tree (the old repo-root
  `functions/` survived the move — AGENTS.md lesson).

## Item 3 — Light theme toggle: DONE

- **Deploy:** run #59, HEAD cc11a86, 2026-11-23 14:14–14:15.
- **Tests:** 1628 → **1645/0** (424 suites), +17, parent re-ran.
  Regression proof: the new suite against the real pre-fix
  navigation.js fails 10/17.
- **Cause:** a binding race, not a CSS bug. The header (with
  `#themeToggle`) is rendered by `renderShared()` only after the
  live-articles fetch resolves (up to the 5 s timeout);
  `navigation.js` bound the toggle by id inside its own
  DOMContentLoaded handler, which runs before `renderShared` in every
  case — so at bind time the button was `null`, the guard skipped the
  binding, and the button created later had no handler. Clicks did
  nothing on all 9 pages. The same race killed `#navToggle` and the
  active-link highlight. The CSS was never at fault
  (`:root[data-theme="light"]` was correct — the attribute was simply
  never set).
- **Fix:** clicks delegated on `document` at parse time (works whenever
  the header appears, survives re-renders); theme resolution extracted
  (saved choice wins, else `prefers-color-scheme: light`, else dark);
  active-link highlight re-runs via a one-shot MutationObserver; an
  identical 2-line pre-paint snippet in `<head>` of all 9 pages
  (before the themes.css link) applies the same resolution before first
  paint. No hero wording, colours, layout or design changed (page diffs
  were +2 lines each, 0 deletions).
- **Live verification (browser task, cloud, Environment 1; colours
  sampled from screenshots, no DevTools):** home loaded LIGHT (the
  profile may have retained a light choice, or its OS preference is
  light — either way the toggle then worked both directions): click 1 →
  DARK (hero 24,23,21, the exact old dark value); reload → persisted
  DARK; click 2 → LIGHT again. Article 1: LIGHT → DARK. Division
  automotive: DARK (persisted) → LIGHT, 12 articles listed. Tools:
  LIGHT → DARK; Percentage tool 20% of 150 = "20.00% of 150.00 =
  30.00" exact. Hero stats + 8 cards intact.
- **NOT TESTED live:** the fresh-visitor default (no saved choice +
  dark OS → dark) — the cloud browser cannot set the OS preference;
  no-flash on a slow connection; `prefers-color-scheme` on a real OS
  setting; the mobile hamburger (same race fix) — viewport resize is
  unavailable in the cloud browser.

## Item 4 — SEO check for #33 (investigation + fix): DONE

- **Investigation (read-only):** `docs/FIXPASS2-ITEM4-FINDINGS-2026-11-23.md`.
  Cause: the daily run's `seoRun` step only SEO-checks the 3
  oldest-`updated_at` drafts per day (`LIMIT 3`); on 23 Nov the
  eligible pool oldest-first was #28, #31, #29, #33, #30 — #33 ranked
  4th, was never selected, `runSeo` was never invoked for it. Evidence:
  `agent_runs` id 188 records checked [28, 31, 29]; seo_checks rows 23
  (#28), 24 (#31), 25 (#29); **#33 has zero seo_checks rows ever**;
  daily_reports id 14 counts.seoRun = 3. Starvation: `updated_at`
  moves only on repair mutations, so unchanged #28 has been re-checked
  20/21/22/23 Nov, permanently occupying slot 1. Classification:
  code-rule/design limitation, not a data bug. The same shape exists in
  sibling step factCheckRun — flagged, out of scope.
- **Fix — Deploy:** run #54 (with item 1), HEAD 67dd6c1.
  **Tests:** 1524 → **1528/0** (395 suites), +4, parent re-ran; parent
  diffed scheduler.js vs the backup — exactly the claimed changes.
  `steps.seoRun` only: candidate fetch widened `LIMIT 3` → `LIMIT 10`
  (ORDER BY updated_at ASC, protected guard byte-identical); new
  helper `isSeoFreshForCurrentBody` — true only when the latest
  seo_checks row's `body_hash` AND `body_length` match the current
  body (NULL hash/length never fresh); any freshness-read failure
  returns "not fresh" (fail-safe: re-check, never skip on unproven
  freshness); a fresh article records `skipped-fresh` and does NOT
  consume a slot; loop stops after 3 real checks.
- **Expected live effect (NOT yet observable):** the 24 Nov daily run
  should skip #28/#31/#29 as fresh and check #33 and #30 — confirm
  from that run's agent_runs seo-run detail (checked + skippedFresh)
  and new seo_checks rows for #33/#30.

## Item 5 — Delete for drafts: DONE

- **Deploy:** run #60, HEAD 7576811, 2026-11-23 14:28–14:29.
- **Tests:** 1645 → **1657/0** (425 suites), +12, parent re-ran.
  Negative control: old code 5/12 pass, exactly the 7 fix-dependent
  tests fail.
- **Cause:** `deleteArticle` deleted only the `articles` row, but nine
  dependent tables declare `REFERENCES articles(id)` with NO ACTION, so
  on live D1 the delete failed with `FOREIGN KEY constraint failed`
  and nothing was deleted. Separately, the audit row was written BEFORE
  the DELETE (close-out B4), so a failed delete left an audit row for
  an article that still exists.
- **Fix:** new `d1Batch(env, statements)` (real Cloudflare D1
  `env.DB.batch()` — a single transaction; any failure rolls the whole
  batch back; no batch mechanism existed in the codebase before).
  `deleteArticle` now deletes the dependent rows first (9 NO ACTION
  tables in FK-safe order: correction_resolutions →
  article_corrections → claim_checks → fact_checks → seo_checks →
  publication_logs → article_fingerprints →
  daily_publication_reservations → article_fetch_runs; explicit
  DELETEs kept for the CASCADE tables article_tags/article_sources as
  the pre-existing safety net; article_revisions deliberately NOT
  deleted — cascade-governed, and the revisions endpoint must keep
  listing a deleted article's revisions where the cascade doesn't fire),
  then the article row, with the deletion audit as the LAST statement
  of the same batch — a failed delete leaves NO audit row. A
  `sqlite_master` probe skips tables that do not exist (partial-
  migration harness DBs). The guard is unchanged (see the correction
  below).
- **Parent-confirmed brief correction:** the brief's "delete a
  protected article (#28/#33) → still refuses" was wrong. `assertNotProtected`
  covers #26/#27 + `is_protected=1` only — #28–#31/#33 are
  PUBLISH-protected (the publish gate's legacy list), NOT
  delete-protected. Live D1 confirms: #26/#27 is_protected=1, #28–#33
  is_protected=0. Test 5.6 pins the intended outcome: #28 with
  fact-check/SEO rows deletes cleanly. This is what lets the owner
  discard #29 per the Owner Pack.
- **Live verification (raw curl + read-only D1):** deployed
  admin-articles.js contains d1Batch ×3 + buildDeleteStatements ×2 +
  DELETE_DEPENDENTS ×3; home 200; Worker health 200; protected #26–#33
  all still draft, lengths unchanged; published 25;
  article_deletion_audit 0 rows (no live article ever deleted).
- **NOT TESTED live:** the delete endpoint against the live Worker and
  a real dashboard Delete click — fixtures only, by design. A real
  delete is never tested live; the owner decides #29 per the Owner Pack.

## Item 6 — UI polish: DONE

- **Deploy:** run #61, HEAD 72d496a, 2026-11-23 14:37–14:38.
- **Tests:** 1657 → **1668/0** (426 suites), +11, parent re-ran.
  Regression proof: the new suite against the real old main.css fails
  exactly the 2 fix-dependent tests.
- **Cause:** (1) `.grid` set no `align-items`, so the default `stretch`
  forced every card in a row to the tallest card's height — shorter
  division cards showed a large empty area below their Explore link.
  (2) The `<p class="muted grid-loading">Loading divisions… /
  Loading articles…</p>` placeholders paint until app.js renders the
  grids (after DOMContentLoaded + live fetch, up to the 5 s timeout).
- **Fix (frontend/styles/main.css ONLY — 1 line changed, 17 added, 0
  deletions):** `.grid` gains `align-items: start` (each card sizes to
  its own content; no card's look changes — banner, title, tagline,
  description, count, link, colours, 24px gap untouched); new
  `.grid-loading { display: none; }` (main.css is render-blocking, so
  the text is hidden before first paint). The `<p>` elements
  deliberately STAY in the HTML: the division page's "Loading
  articles…" paragraph is the anchor `rewriteDivisionHtml` replaces
  with the noscript article list — deleting it would fail the Function's
  fail-closed anchor check and break item 2 live.
- **Live verification (raw curl + browser task, 1919×998):** served
  main.css contains both rules; division automotive still
  `x-seo-head: rewritten` (anchor survived); home 200; hero stats
  "8 divisions · 25 articles · 20 free tools" confirmed in the rendered
  page; **flash GONE** (no "Loading…" text on home or division, initial
  open or hard reloads); **dead space GONE in both themes** (every
  division card ends ~20–30 px below its Explore link; all 12
  Automotive article cards likewise). Honest nuance: the division
  page's first captured paint is still a brief unhydrated/blank state
  (generic "All divisions" heading, empty Articles area, no
  header/footer) before it hydrates — no loading text, but the blank
  paint itself remains. The briefly-blank Latest guide card was NOT
  fixed (pre-rendering it statically would duplicate article data in
  the HTML — stale after the next publish until the next deploy — out
  of scope).
- **NOT TESTED live:** the 390 px layout (the cloud browser cannot
  resize viewports — a real-phone check is needed); no-flash on a slow
  connection.

## Item 7 — Search Console resubmit doc: DONE (docs only)

- **File:** `docs/SEARCH-CONSOLE-RESUBMIT-2026-11-23.md` (6,741 B).
  Shipped in run #62 with the final ledger. No code, no tests, no
  deploy of its own. Owner-only steps, no action taken.
- **Content:** why now (item 2's server-side heads are live — crawlers
  see per-article heads without JS); current state as of the 23 Nov
  11:00 check (sitemap "Couldn't fetch", last read 22 Nov, 0
  discovered; Article 1 quota exceeded 8× consecutively, quota did not
  reset overnight; Article 6 unknown to Google; Overview 0 indexed / 1
  not indexed — homepage "Crawled - currently not indexed", last
  crawled 18 Nov); Step 1 — resubmit the sitemap ONCE (success = status
  "Success", discovered pages > 0 of 60); Step 2 — request indexing ONE
  URL per day (quota is the binding constraint; order: Article 1, then
  newest articles; homepage needs no request); how to read the results;
  what NOT to do; if-something-looks-wrong.

## Final state (verified 2026-11-23 ~14:41, parent, raw curl + read-only D1)

- Tests **1668/0**, 426 suites. HEAD **89f7926** (run #62).
- Home 200; Worker health 200 (ok:true, db connected); sitemap 200,
  60 URLs; item 2 article 1 still `x-seo-head: rewritten`; item 3
  snippet live; item 6 CSS live.
- Articles: published **25**, drafts **8**, total 33. Protected
  #26–#33 all draft, lengths unchanged (4895/245/2157/601/4088/549/
  3478). Settings unchanged: publishing_mode auto, auto_publishing on,
  auto_publish_eligible_since 2026-11-22T04:55:28Z, social_auto_post
  off, max_articles_per_day 1. Emergency Stop **OFF (0)**.
  article_publish_overrides **0 rows**; csp_reports **3 rows** (real
  browser reports arriving since A4); login_attempts **0 rows**.
- Known drift, unchanged: `llm_provider_order` in live D1 is still
  `workers-ai,groq,gemini` (neutralised by the code allowlist; optional
  cleanup = set to `workers-ai` or delete the row).

## Carried forward (not blocking, needs its own decision or the next run)

- Item 1 gap: create/PUT publish paths are not gated — needs an owner
  decision (forbid `status:'published'` in create/PUT, route every
  publish through POST /publish).
- Item 2 cleanup: remove the `x-seo-head` diagnostic header + one
  Function copy, only with a deploy that proves which copy is live.
- factCheckRun starvation: the same LIMIT-3 shape as the fixed seoRun
  (flagged in the item 4 findings doc, out of scope).
- Verify after the **24 Nov 00:00 UTC daily run**: the item 4 fix
  effect (seoRun skippedFresh for #28/#31/#29 + new seo_checks rows for
  #33/#30) and the health report's check 14 (serverSideHeads) plus the
  first real daily health report overall.
- B5 (task-dependency ordering) stays DEFERRED — needs a new brief.
- The push workflow never deletes files removed from the local tree —
  any future file deletion needs an explicit removal step.
- Real-phone checks still open: 390 px layout (item 6), fresh-visitor
  dark default + mobile hamburger (item 3), light theme on a real phone
  (close-out finding).

## Confirmation

No protected article (#26–#31, #33) was published, edited, deleted or
touched in this pass. No auto-publish setting, Emergency Stop,
schedule or cron was changed. The daily Shorts cron stays PAUSED.
social_auto_post is OFF. No OAuth flow was started and no account was
connected. No video was uploaded or published. No secret appears in
code, logs, reports or screenshots. The only live D1 write in the
whole pass was migration 032 (the audit table, 0 rows); no article row
was written and no live row was deleted. Rollback for every item is the same: revert the
deploy commit (no item needed a data rollback; item 5 has no migration
to roll back; item 1's migration 032 table can stay empty or be dropped
by a future migration — it holds 0 rows).
