# FS AI — Phase 2 Critical Repair Notes (2026-11-20)

Local only. Nothing in this document was pushed, deployed, or applied to
live D1 / Pages / Worker / GitHub / YouTube / Pinterest / Search Console.
The parent verifies, applies the migrations, deploys, and live-tests
afterwards. Every claim below cites the file + line or the test that
proves it; nothing is asserted from memory.

## 0. Baseline

- **Starting commit:** `8e8d24b` (constant-based guard for #26/#27, deployed
  2026-11-20 01:16, live-proven at the 06:00 Dhaka daily run: #26/#27
  untouched, #28 got a new seo_check at 06:01).
- **Test baseline (coordinator's own `npm test` before changes):**
  **651 pass / 0 fail / 149 suites**.
- **Full-suite result after Phase 2 (coordinator's own `npm test`):**
  **779 pass / 0 fail / 178 suites** — 128 new tests, 0 failures.
  (651 + 128 = 779; the count reconciles exactly.)
- **#26 / #27 preserved values (Phase 1 report, unchanged by Phase 2):**
  - #26 "How Artificial Intelligence Is Changing Everyday Life" — body
    4,895 chars, seo_description 77 chars
    ("A plain-language guide: How Artificial Intelligence Is Changing
    Everyday Life"), 0 sources, fact-check 0/20.
  - #27 "Tesla Cybercab Factory at Giga Berlin" — body 245 chars,
    seo_description 61 chars
    ("A plain-language guide: Tesla Cybercab Factory at Giga Berlin"),
    0 sources.
  - #28 "What a billion-dollar deal says about the US battery market" —
    body 2,157 chars, 1 source (research_item 154), fact-check 2/15 →
    6/7, SEO 10/11, gate Blocked 5/10.
- **Live settings (unchanged by Phase 2):** auto_research / auto_generation /
  auto_factcheck ON; auto_correction OFF; auto_publishing OFF;
  publishing_mode approved_only; social OFF.

## 1. Fix 1 — Database-backed protection

**Migration 013** — `database/migrations/013_article_protection.sql`:

```sql
ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;
UPDATE articles SET is_protected = 1 WHERE id IN (26, 27);
```

- Additive column + data flag only. No article content, excerpt, SEO field,
  source, or correction row is changed by either statement.
- **Idempotency (honest):** SQLite `ADD COLUMN` fails if re-run on a DB
  that already has the column ("duplicate column name"). Apply once via
  the console chunk (one statement at a time — the parent applies it);
  the `UPDATE` itself is safe to re-run. A fresh deploy from
  `database/schema.sql` already includes the column (`database/schema.sql:137`),
  so 013 is only for the live-D1 upgrade path (same situation as
  migration 004).
- `package.json` `db:migrate` now runs 001–015 in order.

**Enforcement** — `backend/publishing/protection.js`:

- `PROTECTED_TEST_ARTICLES = [26, 27]` (`protection.js:31`) is kept as a
  defence-in-depth fallback only: it cannot contradict the DB flag,
  because `isProtected()` (`protection.js:47`) checks the DB flag first
  and falls back to the constant only when the column/table is absent
  (pre-013 database). `protectedExclusion(column)` (`protection.js:36`)
  builds the SQL-level exclusion; `assertNotProtected(env, id)`
  (`protection.js:66`) refuses a single article.
- `taskModifiesArticle(agent, kind)` (`protection.js:86`) + 
  `assertTaskNotProtected(env, task)` (`protection.js:95`) — the
  modifying combinations, verified from the dispatch code:
  agent `seo` any kind → runSeo repairs; `fact-checking`/`correct` →
  runCorrection; `fact-check` is advisory only; `publishing` takes no
  per-article target (runPublishing ignores article_id and only publishes
  gate-passed due articles); `content-creation` INSERTs new articles only.
- Wired into the scheduler (`backend/routes/scheduler.js`):
  `runTask` (`scheduler.js:266`, guard at `:280` — 403 before any status
  change), `retryTask` (`scheduler.js:370`, guard at `:381` — 403 before
  re-queue), and the orchestrator `handleCreateTask`
  (`backend/routes/orchestrator.js:359` — 403 before enqueue).
- **Deliberate decision, recorded:** the owner's own CMS edit / publish /
  delete paths (`backend/routes/admin-articles.js`) are NOT blocked —
  they are revision-tracked human actions, not automation. All automation
  endpoints are guarded.
- Dashboard display: the pipeline table shows
  "PROTECTED — AUTOMATIC MODIFICATION DISABLED"
  (`frontend/scripts/autonomy.js:701`); the CMS article list shows the
  same badge (`frontend/scripts/dashboard.js:206`). The analytics
  endpoint now returns `isProtected` per draft
  (`backend/routes/orchestrator.js:1270` — drafts query with a try/catch
  fallback to the constant list on a pre-013 database).

**Tests** — `tests/protection.test.js` (19 pass: 12 from the guard commit
+ 7 coordinator-added): the taskModifiesArticle matrix; create/run/retry
403s on protected articles; fact-check allowed on protected articles;
assertTaskNotProtected including JSON-string payloads.

## 2. Fix 2 — Correction quality

`backend/agents/autonomy/factcheck.js` only.

- Sentence/claim-level correction: `runCorrection` (`factcheck.js:797`)
  preserves supported sentences, replaces only the specific unsupported
  claim when valid evidence exists, removes only when removal preserves
  context, never splices unrelated fragments, preserves paragraph
  structure, grammar, punctuation, citations, and provenance.
- `validateCorrectedBody(originalBody, correctedBody, evidencePool)`
  (`factcheck.js:760`) rejects a corrected body containing broken
  fragments, splices, repeats, incomplete paragraphs, unrelated content,
  unsupported facts, or incoherence. On rejection: nothing is saved, the
  previous version is preserved, the failure is recorded, and the claim
  is marked for human review. **Failure-recording mechanism
  (schema-checked):** `article_corrections` has no reason column and
  `recheck_verdict` has a CHECK allowing only verdict words, so free
  text cannot go there — the reason is recorded in the run result object
  (the run/task log) AND in each failed row's `corrected_text` as
  `VALIDATION REJECTED — <reasons>`. No migration was in scope.
- **Splice root cause (two vectors, both fixed):** (1) the old candidate
  check only verified length ≥ 20, difference from the original, and
  numbers ⊆ evidence — nothing checked the reply was one complete
  sentence, so a reply running a fragment and a second sentence together
  (the exact #28 garble) was saved as one "sentence". Fixed by
  `cleanCandidate` (`factcheck.js:515`, reduces any reply to its first
  complete sentence) + `isValidReplacementSentence` (`factcheck.js:529`,
  single capitalised-start, terminal-punctuation-ending sentence, no
  splice marker, no raw URL, no refusal/meta reply, no doubled word).
  (2) `replaceSentence` passed the candidate to `String.replace` as a
  raw replacement string, so any `$&`/`$'`/`` $` `` in it would splice
  matched body text into the sentence. Fixed by replacement via a
  function (`() => replacement`), which is literal. The regex path is
  now `claimPattern` (`factcheck.js:444`), which also tolerates citation
  material where the stripped claim has whitespace — claims whose
  citation was stripped are still findable for correction.
- Max attempts: `MAX_CORRECTION_ATTEMPTS = 3` (`factcheck.js:48`;
  enforced at `:842`).
- The exact #28 failure pattern is pinned in tests:
  "a potential key to smaller The deal—worth more than a billion
  dollars—aims to supply silicon-carbon anode material…"
  (`tests/factcheck-correction-quality.test.js:164`).
- auto_correction is NOT enabled anywhere (code or settings).

**Tests** — `tests/factcheck-correction-quality.test.js` (25 pass):
garble/splice/fragment/repeat rejection, preservation of supported
sentences, max-3-attempts cap, failure recording without saving.

## 3. Fix 3 — Citation-aware claim extraction

`backend/agents/autonomy/factcheck.js` only.

- `extractClaims` (`factcheck.js:163`) excludes citation-only lines,
  standalone URLs, bibliography entries, source labels / citation
  metadata, and standalone related-reading links; it preserves real
  factual claims near citations and never drops a real statement just
  because it contains a URL. Citation-only lines are removed by a shared
  helper (`factcheck.js:145`) used by both extractClaims and correction.
- Reprocesses only new test content; #26/#27 are not altered.

**Tests** — `tests/factcheck-correction-quality.test.js` (25 pass,
shared with Fix 2) plus the pre-existing
`tests/factcheck-claims.test.js` (19 pass, Phase 1 file — unchanged
except by the behaviour it pins): markdown citations, plain-text source
refs, URL-only lines, bibliography sections, claims followed by
citations, related-reading sections, mixed factual+citation paragraphs.

## 4. Fix 4 — Failed-correction review

**Backend** — `backend/routes/orchestrator.js`:

- `GET /api/autonomy/corrections?article_id=` (`orchestrator.js:923`):
  unresolved corrections (status pending/failed) with original claim,
  attempted correction, status, evidence URL, derived failure reason,
  and resolution history. Read-only; allowed for protected articles
  (reviewing changes nothing).
- `POST /api/autonomy/corrections/:id/resolve` (`orchestrator.js:977`):
  four resolutions — `accepted-unresolved-removed`,
  `manually-corrected-rechecked`, `rejected-for-retry`,
  `pending-human-review`. A click alone never marks a claim VERIFIED:
  `manually-corrected-rechecked` re-verifies the owner-supplied
  corrected text deterministically against the article's own evidence
  pool before anything is marked resolved. The original
  `article_corrections` row is never deleted; every resolution is
  recorded in `correction_resolutions` (migration 015) with
  previous_status preserved, so the full audit trail survives.
  Unresolved critical claims keep blocking the gate: gate check 4 maps
  resolution states (removed/applied clear it; pending/failed block it).
- Gate logic itself is UNCHANGED (`backend/publishing/gate.js` — read
  end-to-end, no weakening; the 10 checks stay exactly as strict).

**Dashboard** — `frontend/scripts/autonomy.js`: "Correction review"
section (`:155-158` markup, `loadCorrections` at `:879`, resolve handler
at `:912`, click wiring at `:1237`). Each unresolved correction shows the
original claim, attempted correction, status, attempt, recheck verdict,
evidence link, failure reason, and resolution history, plus a resolution
select, corrected-text input, note input, and Resolve button.

**Tests** — `tests/correction-review.test.js` (14 pass): every resolution
state, no VERIFIED-by-click, no silent deletion, audit-trail
preservation, gate effect of each state.

## 5. Fix 5 — Fact-check re-run

**Backend** — `POST /api/autonomy/articles/:id/recheck`
(`backend/routes/orchestrator.js:1121`): owner-authenticated, E-Stop
respected (423), published articles refused (409), in-flight re-check
refused (409 already-running). Reuses the article's existing
fact-checking task record (no duplicate task); each execution writes a
NEW agent_runs row and a NEW fact_checks row + new claim_checks rows,
so history is preserved; the response returns latest + previous +
articleVersion. `fact_checked` is never set (advisory only — only the
publish gate sets it when it approves).

**Coordinator decision (changed Agent E's design, with reasons):**
Agent E's endpoint refused protected articles with 403. That was
inconsistent with the daily workflow, whose `factCheckRun` step
fact-checks protected articles (verified read-only — it writes only
`fact_checks` / `claim_checks` rows and never touches the article row;
`factcheck.js:22-23`: "never sets fact_checked"). A re-check is the
same operation, so protection does NOT block it — the protection scope
is article content/metadata, which a re-check never modifies. The
endpoint comment (`orchestrator.js:1112`) and the two tests were updated
to pin the corrected behaviour: a re-check on protected #26 / on an
`is_protected=1` article returns 200 completed and the body, excerpt,
and seo_description are byte-identical afterwards.

**Dashboard** — "Re-check" button per draft
(`frontend/scripts/autonomy.js:701` row, `recheckArticle` handler);
the result line shows latest + previous verdicts, task reuse, run id,
and that fact_checked stays 0.

**Tests** — `tests/factcheck-rerun.test.js` (7 pass): first run creates
exactly one task/run; second run reuses the task and preserves history;
already-running guard; E-Stop block; protected articles allowed with
unchanged body; published/missing refused.

## 6. Fix 6 — Per-article SEO

**Backend** — `backend/routes/orchestrator.js`:

- `POST /api/autonomy/articles/:id/seo-check` (`orchestrator.js:1210`):
  check-only. Runs the real SEO workflow via `runSeoCheckOnly`
  (`backend/agents/autonomy/seo.js:383`), stores all 11 individual
  results, writes nothing to the article. Allowed on protected articles.
- `POST /api/autonomy/articles/:id/seo-optimize`
  (`orchestrator.js:1237`): unprotected drafts only — protected
  articles are refused with 403; published articles refused with 409.
  Returns `action: 'optimize'` + repairs + repairedFields.
- Readability failure now carries an actionable Fix line
  (`backend/agents/autonomy/seo.js:151-161` — the detail appends
  "Fix: split long sentences — aim for 15-20 words per sentence…" etc.).

**Dashboard** — separate "SEO Check" and "Optimize SEO" buttons per
draft (`frontend/scripts/autonomy.js:701`); on protected rows Optimize
is disabled with the title "Protected — automatic modification
disabled". Results show the verdict, all 11 checks with their Fix
lines, and (for Optimize) the repaired fields.

**Tests** — `tests/seo-actions.test.js` (11 pass): check-only writes
nothing; optimize repairs unprotected drafts; protected → 403 with no
repair and no seo_checks row; published → 409; unknown → 404; the
readability Fix line is present (also pinned in
`tests/seo-checks.test.js`).

## 7. Fix 7 — Gate logic

Repaired the underlying causes, NOT the gate. `backend/publishing/gate.js`
was read end-to-end and is UNCHANGED: the 10 checks stay exactly as
strict; the fact-check verdict reflects claim-level evidence; correction
status is accurately represented (check 4 maps resolution states, see
Fix 4); the SEO verdict reflects all 11 checks; human review never
converts unsupported evidence into verified evidence; historical results
remain available; every gate decision exposes individual reasons. No
auto-publish; owner approval intact.

**Tests** — covered by `tests/correction-review.test.js` (gate effect
per resolution), `tests/factcheck-rerun.test.js` (fact_checked never
set by a re-check), and `tests/seo-actions.test.js` (SEO verdict per
check). No gate test was weakened; no gate assertion was changed.

## 8. Fix 8 — Content-task idempotency

**Backend** — `backend/routes/scheduler.js`:

- The idempotency key is built in the frontend
  (`frontend/scripts/autonomy.js` create-content handler:
  `manual-content-<slug>-<date>`).
- `mergeContentTaskSources` (`scheduler.js:129`) merges valid new
  sources on a duplicate same-title/same-day creation: dedupe by
  normalized URL, cap 10 sources, title/division mismatch rejects all.
  The response carries `sourceMerge` with status
  `sources-added` / `no-new-sources` / `rejected` / `existing-reused`
  plus `added` / `duplicates` / `rejected` lists
  (`scheduler.js:135,146,168,195,203`).
- Convert uses the merged payload, so the resulting article gets all
  valid article-specific sources; unrelated sources are never mixed.
- **Coordinator addition:** a done/running/skipped task's sources cannot
  change — re-creation returns `rejected`
  ("task already done — sources cannot reach the already-converted
  article"); failed tasks may still merge (a retry re-reads the payload).

**Dashboard** — `sourceMergeText` (`frontend/scripts/autonomy.js`)
surfaces the merge outcome in the create-content status line and in
the task-create status ("1 new source(s) added: …", "no new sources —
the supplied source(s) were already on the task.", "rejected: …").

**Tests** — `tests/content-task-idempotency.test.js` (9 pass: 7 agent +
2 coordinator-added): repeated same-title creation with different
source sets; merge + dedupe + cap; mismatch rejection; done-task
rejection; failed-task merge allowed.

## 9. Fix 9 — Weekly workflow

- Trigger confirmed in `backend/worker.js:174-178`: the scheduled event
  at 00:00 UTC runs the daily workflow, and on Sundays
  (`getUTCDay() === 0`) also runs `runWeeklyWorkflow`
  (`backend/routes/scheduler.js:757`). Timezone is UTC throughout
  (00:00 UTC = 06:00 Asia/Dhaka). Duplicate prevention: one
  daily_reports row per date+kind (upsert — a forced re-run never
  duplicates). E-Stop is consulted at entry. Protected articles are
  excluded from modification steps (Fix 1 guards apply — seoRun and
  correctionRun refuse protected articles; fact-check is advisory-only).
  Reports are built from real D1 data.
- Manual control added: `POST /api/autonomy/run-weekly`
  (`backend/routes/orchestrator.js:528`): owner-only; E-Stop → 423
  blocked; duplicate → `already_completed` (no second row); `force`
  re-runs. It runs ONLY the weekly workflow — it never writes a daily
  row.
- Dashboard: "Run Weekly Workflow Now" button
  (`frontend/scripts/autonomy.js:175`, handler `runWeekly`, wiring at
  `:1076`) reporting the real status (completed / already_completed /
  blocked).

**Tests** — `tests/weekly-workflow.test.js` (13 pass): trigger,
duplicate prevention, E-Stop block, force re-run, weekly-only scope
(no daily row), protected-article exclusions.

**Live weekly run: NOT TESTED.** The scheduled run is Sun 22 Nov 2026
00:00 UTC.

## 10. Fix 10 — RSS fetch audit log

**Migration 014** — `database/migrations/014_rss_fetch_audit.sql`
(full SQL in the file; schema mirrored at `database/schema.sql:497-523`):

```sql
CREATE TABLE IF NOT EXISTS rss_fetch_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES research_sources(id),
  feed_url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  execution_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'daily-workflow')),
  items_discovered INTEGER NOT NULL DEFAULT 0,
  items_inserted INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial', 'skipped-overlap')),
  UNIQUE (execution_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_audit_source_started ON rss_fetch_audit(source_id, started_at);
CREATE INDEX IF NOT EXISTS idx_rss_fetch_audit_execution ON rss_fetch_audit(execution_id);
```

- Additive only; no existing table, row, or counter is changed; no
  history is backfilled — fetches before this migration have no audit
  rows, by design (never synthesize numbers for runs never recorded).
  Idempotent: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
  EXISTS`, safe to re-run.
- Recording in `backend/rss/rss.js:155,234,256,277,304` (opening
  `running` row via `INSERT OR IGNORE`, terminal update, overlap
  `skipped-overlap` row) + helpers in `backend/rss/rss.js`; the fetch
  loop in `backend/rss/sources.js` records counts at the real
  insert/dedupe point, never recomputed. Overlap guard: an in-memory Set
  plus a `running` row, 10-minute staleness. One execution can never
  write two rows for the same feed (`UNIQUE(execution_id, source_id)`).
- Endpoint `GET /api/autonomy/rss-audit`
  (`backend/routes/orchestrator.js:625`): read-only, audit rows
  newest-first plus per-source reconciliation totals
  (audit inserted sum == research_items count == source
  items_discovered; `reconciled` is true only when all three agree).
  A reload never alters historical counts.
- Dashboard: "Fetch history (RSS audit)" section
  (`frontend/scripts/autonomy.js:130` markup, `loadRssAudit` at `:936`)
  showing feed, time, trigger, found, new, duplicates, errors, status,
  plus the reconciliation count.
- The 19 Nov anomaly (digital-tools duplicates 0→50/10/40 with no new
  items) is NOT explained here: no audit rows exist for it, and no
  reason is invented. The log exists so the next anomaly can be proven
  from rows.

**Tests** — `tests/rss-audit.test.js` (12 pass): one row per
execution+feed, manual vs scheduled identification, overlap recorded
not run, reconciliation arithmetic, reload does not change counts.
Known gap: the `partial` path has no forced-failure test.

## 11. Minor fixes (A–F)

- **(A) Fact-Checking agent status said "auto_correction":** the backend
  `step()` helper (`backend/routes/scheduler.js:465`) records
  `detail.step` per step, but the status endpoint dropped it, so the
  last-written step's reason showed under "Fact-Checking". Fixed at the
  source: `lastRuns` now carries `step`
  (`backend/routes/orchestrator.js:222-240`), and the dashboard renders
  it (`frontend/scripts/autonomy.js:347-352`) — the line now reads
  "correction-run — no-op (auto_correction is off.)" instead of
  attributing the correction note to the fact-check step.
- **(B) Failed SEO readability check:** actionable Fix line in the check
  detail (`backend/agents/autonomy/seo.js:151-161`); the dashboard
  renders the full detail including the Fix
  (`frontend/scripts/autonomy.js` `seoChecksText`).
- **(C) Fact-check queue refresh:** `runTask`, `retryTask`,
  `enqueueAgentTask`, scaffold convert, the daily run, the weekly run,
  re-check, SEO actions, and correction resolution all call
  `loadPipeline()` after execution — the drafts/gate table refreshes
  without a full page reload. Per-article action results are written to
  the detail line (`autonomyFactCheckDetail`), not the pipeline status
  line, so the refresh cannot erase them.
- **(D) Actual state on every operation:** daily/weekly/task/convert/
  re-check/SEO/resolve handlers report the server's real status
  (completed / already_completed / blocked / failed / protected /
  not tested) with report/task/run ids where the server returns them.
- **(E) Misleading success messages removed:** the daily-run button no
  longer claims success for a no-op (it reports already_completed);
  the weekly button follows the same rule; the create-content message
  reports the real sourceMerge outcome instead of a bare "already
  existed".
- **(F) Automation status reflects backend settings:** already mostly
  done — the auto-flag KPI cards in `loadStatus` render `d.autoFlags`
  from the live status payload (research/generation/factcheck/
  correction/publishing ON/OFF with what each gates). No decorative
  frontend state remains for these flags.

## 12. Indexing fix (canonical + sitemap)

Additional scope from the parent's live findings (20 Nov 10:15–10:17).

**Live evidence (parent-verified, not re-derived):** every `.html` page
URL 308-redirects to its clean form (`/pages/article.html?id=1` →
`/pages/article?id=1`, 200; `/pages/division.html` → `/pages/division`).
No `_redirects` / `_headers` / `functions/` exists in the repo — the
redirect source is unverified (possibly a Cloudflare dashboard rule);
no source is invented. The fix makes the redirect harmless by never
linking to `.html` forms, not by assuming a source. Google reported the
sitemap "Couldn't fetch" (5 submissions).

**Changes:**

1. **Article canonical** — `frontend/pages/article.html`: the wrong
   static canonical (`https://fs-ai-5w5.pages.dev/pages/article.html`,
   no id — all 25 articles declared the same canonical in raw HTML)
   is REMOVED. The page JS now injects the clean canonical
   `https://fs-ai-5w5.pages.dev/pages/article?id=` + id (and keeps
   og:url + JSON-LD mainEntityOfPage consistent with it). Without a
   static canonical Google uses the page URL itself, which is the
   correct clean URL.
2. **Sitemap** — `backend/services/seo.js:21,48,64-69,79-83`: the
   generator (previously dead code emitting wrong pretty routes
   `/articles/<slug>`) now emits only clean forms: `/`,
   `/pages/division?division=<slug>`, `/pages/article?id=<N>`, etc.
   `public/sitemap.xml` (58 locs) + `frontend/sitemap.xml` (60 locs,
   the served copy) regenerated: **0 `.html` occurrences** in either
   file. The generator emits 35 URLs vs 58/60 committed — entries are
   preserved, not deleted (follow-up: reconcile the generator's entry
   set with the committed files).
3. **Internal links** — every article-link builder the codebase owns
   now uses the clean form: SEO repair Related-reading link
   (`backend/agents/autonomy/seo.js:124,293,349` —
   `…/pages/article?id=${s.id}`), article lists (`frontend/scripts/app.js`,
   `search.js`, `dashboard.js`, `division.html`, `social.js`).
   `tests/seo-checks.test.js:128` fixture updated to the clean form.
4. **Tests** — `tests/indexing-canonical.test.js` (17 pass): canonical
   URL includes the article id and has no `.html`; sitemap contains no
   `.html` article/division URLs; sitemap URLs are the canonical clean
   form.
5. **Stale expectations updated (not weakenings):** three pre-existing
   tests pinned the OLD redirecting URL form and failed once the fix
   landed; their expectations were updated to the clean form with the
   same assertion intent —
   `tests/activation-repairs.test.js:331` (Related-reading link),
   `tests/division-not-found.test.js:196` (division article link),
   `tests/pages-contact-about.test.js:52-53` (sitemap About/Contact
   locs; the 60-URL count assertion is unchanged and still passes).
6. **Known remaining defect (out of scope, follow-up):** the same
   `.html` defect class remains on `division.html` canonical + nav
   links.
7. **Homepage note:** homepage raw HTML contains no article links
   (JS-rendered) — secondary; the homepage rendering was NOT rebuilt
   in this phase.

**No indexing guarantee is claimed.** Google still crawls on its own
schedule and the Request-indexing quota resets daily. This fix removes
OUR side's blockers (wrong canonical + redirecting sitemap URLs).

## 13. Frontend integration (coordinator)

`frontend/scripts/autonomy.js` (+ `frontend/scripts/dashboard.js:206`
badge) wires Fixes 1, 4, 5, 6, 8, 9, 10 and minors A/C/D/E into the
dashboard. `node --check` passes on `autonomy.js`, `dashboard.js`, and
`backend/routes/orchestrator.js`. Functional verification beyond syntax:
a sandboxed DOM harness (no browser, no network, canned fetch) drives
the real `autonomy.js` and asserts the rendered output — kept as
`tests/dashboard-autonomy-dom.test.js` (1 test, 12 assertion groups,
all passing): section markup, minor A step label, Fix 1 badge +
disabled Correct/Optimize on protected rows with advisory actions kept,
Fix 4 review + resolve, Fix 5 re-check, Fix 6 SEO Check/Optimize,
Fix 10 audit table, Fix 9 weekly run, minor C pipeline refresh,
Fix 8 sourceMerge surfacing.

## 14. Tests added (all Phase 2)

| File | Tests | Proves |
|---|---|---|
| `tests/protection.test.js` | 19 | DB-flag + constant fallback; every automatic modification route guarded; manual endpoints refuse protected articles |
| `tests/content-task-idempotency.test.js` | 9 | Source merge/dedupe/cap; mismatch rejection; done-task rejection; failed-task merge |
| `tests/rss-audit.test.js` | 12 | One row per execution+feed; trigger identity; overlap; reconciliation; reload stability |
| `tests/correction-review.test.js` | 14 | All four resolution states; no VERIFIED-by-click; audit trail; gate effects |
| `tests/factcheck-rerun.test.js` | 7 | Task reuse, history, duplicate guard, E-Stop, protected allowed with unchanged body |
| `tests/seo-actions.test.js` | 11 | Check-only vs Optimize; protected 403; readability Fix line |
| `tests/weekly-workflow.test.js` | 13 | Trigger, duplicates, E-Stop, force, weekly-only scope, protection |
| `tests/indexing-canonical.test.js` | 17 | Canonical has id, no `.html`; sitemap clean |
| `tests/factcheck-correction-quality.test.js` | 25 | Garble/splice rejection, sentence preservation, max 3 attempts |
| `tests/dashboard-autonomy-dom.test.js` | 1 (12 groups) | Dashboard rendering of Fixes 1/4/5/6/8/9/10 + minors A/C |
| **Total new** | **128** | **651 + 128 = 779** |

No test was deleted, skipped, or weakened. The three expectation
updates in §12 are URL-form updates to match the specified indexing
change, with identical assertion intent. The pre-existing
`tests/factcheck-claims.test.js` (19 pass, 2026-11-19) is a Phase 1
file and is NOT counted in the 128.

## 15. Migrations

| # | File | SQL | Idempotency |
|---|---|---|---|
| 013 | `database/migrations/013_article_protection.sql` | `ALTER TABLE articles ADD COLUMN is_protected INTEGER NOT NULL DEFAULT 0;` + `UPDATE articles SET is_protected = 1 WHERE id IN (26, 27);` | ALTER is NOT re-runnable (duplicate column name) — apply once via console chunk; UPDATE is safe to re-run; fresh schema.sql already has the column |
| 014 | `database/migrations/014_rss_fetch_audit.sql` | `CREATE TABLE IF NOT EXISTS rss_fetch_audit (…)` + 2 indexes + `UNIQUE(execution_id, source_id)` | Safe to re-run (`IF NOT EXISTS`) |
| 015 | `database/migrations/015_correction_resolutions.sql` | `CREATE TABLE IF NOT EXISTS correction_resolutions (…)` + 1 index (exact schema copied from `orchestrator.js:800-815`, where the endpoint previously created it lazily via `ensureCorrectionResolutionsTable`) | Safe to re-run (`IF NOT EXISTS`) |

`package.json` `db:migrate` runs 001–015 in order. `database/schema.sql`
mirrors all three (§137 is_protected; §26 rss_fetch_audit;
correction_resolutions table).

## 16. What still needs live verification (parent)

1. **Apply migrations 013/014/015 to live D1** (console chunks, one
   statement at a time; 013's ALTER exactly once), then deploy the new
   worker bundle. Nothing in Phase 2 was deployed.
2. **#26/#27 untouched after deploy:** `updated_at` still 19 Nov 18:53
   UTC, no new revision rows, no new `seo_checks` rows for #26/#27.
   Run a manual SEO-optimize / correct on #26 in the live dashboard
   and confirm it is refused with 403 + the PROTECTED badge is visible.
3. **Article #29 end-to-end live evidence** (the parent must collect
   per item, with article #29 as the first real test article):
   research → generation (real stored research) → fact-check →
   correction review (resolve one failed correction from the dashboard)
   → re-check (latest + previous visible) → SEO check (11 results) →
   SEO optimize (repaired fields listed) → gate (Blocked until all 10
   checks pass). Record each step's live result; do NOT publish #29
   without the owner's say-so.
4. **Weekly live run NOT TESTED.** Scheduled Sun 22 Nov 2026 00:00 UTC.
   After deploy, the owner may exercise the manual Run Weekly button
   once and confirm the report row + `already_completed` on a second
   run the same week.
5. **auto_correction NOT activated.** It stays OFF in code and in live
   settings. Correction quality (Fix 2) is code-only until the owner
   enables it after live verification with #29. Never enable it as a
   side effect of deploying Phase 2.
6. **RSS audit live:** after the next scheduled/manual fetch, confirm
   `rss_fetch_audit` rows exist for it and the dashboard Fetch history
   shows them with reconciled counts.
7. **Indexing live:** article page canonical is the clean
   `…/pages/article?id=N` form (view source + JS-rendered); sitemap
   serves 0 `.html` URLs; sitemap URLs return 200 (no 308). Then the
   Search Console retry (due 2026-11-21) is a separate track — this
   fix removes our blockers but does not guarantee indexing or a quota
   reset.
8. **Live browser checks the DOM harness cannot do:** in the live
   dashboard, click Re-check, SEO Check, SEO Optimize, Review, Resolve,
   Show fetch history, and Run Weekly Workflow Now once each and
   confirm the status lines show the real states (the harness proves
   the rendering logic against canned responses, not the live API).
9. **Known follow-ups (not blockers):** division.html canonical + nav
   `.html` links; sitemap generator emits 35 URLs vs 58/60 committed;
   `partial` RSS-audit path has no forced-failure test; `isProtected`
   does a per-call query (no caching); manual re-verification is
   deterministic-only (no LLM-judge parity).
10. **Validator limits (Fix 2, Agent B — honest):** the validator is
    deterministic and pattern-based, not semantic — a grammatically
    clean rewrite that subtly changes meaning while reusing evidence
    words/numbers would pass structural validation; the per-claim
    deterministic recheck (evidence-quote entailment) is the only
    factual guard, and a fluent off-topic sentence sharing keywords
    with the evidence also passes the zero-overlap check.
    Cross-paragraph dangling references are not detected (the removal
    context check is same-paragraph only). Bibliography-section mode
    assumes those sections are terminal (true for generated bodies:
    `content.js` appends `Sources:` last, `seo.js` appends
    `Related reading:` last) — real prose after a `Sources:` header but
    before the next heading would lose its claims. Live #28 still
    carries its old citation-fragment claim until a fresh fact-check
    runs after deployment — the fix prevents recurrence, it does not
    retroactively clean #28.
