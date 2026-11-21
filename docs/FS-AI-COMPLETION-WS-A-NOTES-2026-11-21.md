# FS AI — Workstream A Notes: Remaining Defects (§5 A–G) + WS-E H1/L4 + WS-B Test Update

**Date:** 2026-11-21 (work done 14:12–15:00 Dhaka)
**Author:** Workstream A subagent (depth 2)
**Scope:** `backend/agents/autonomy/seo.js`, `factcheck.js`, `content.js`;
`backend/agents/autonomy/publishing.js`; `backend/routes/admin-articles.js`
(Delete repair + WS-E H1/L4, per the 2026-11-21 14:23 forward);
`frontend/scripts/dashboard.js` (Delete UI only);
`backend/agents/autonomy-runner.js` (read-only check — dispatch already exists);
new migrations 024/025/026; new tests + extensions listed in §8.
No deploy, no push, no live D1 writes, no publishing, no test posts, no
OAuth. All live values below are SELECT-only reads from D1 (database
`5043ece5-a853-433c-95f1-ee15a12b6b56`) taken 2026-11-21 ~14:35 Dhaka.
`backend/publishing/gate.js` was NOT edited (no change needed — see §6);
`tests/seo-checks.test.js` was NOT edited (one stale fixture — proposal in §7);
`tests/autonomy-scheduler.test.js` WAS edited per the WS-B forward (§9).

## 0. Permanent restrictions (owner authorization override, 2026-11-21 14:12)

Recorded here because they bind this workstream's deliverables:

- **$0 always.** No paid service, API, model, credit, subscription, trial,
  card requirement, or auto-upgrade. Workers AI only.
- **Never publish #28 / #29 / #30 / #31** without separate editorial
  authorization **each**. (This workstream touched none of them live;
  live verification below confirms all four still draft, unchanged.)
- **Health / Finance always need special human review** — never
  auto-publishable (already enforced by the auto-publish evaluator; not
  re-tested here, not changed).
- **Never claim a social account connected or a post/video published
  without verification.** (Nothing claimed here.)
- **Auto-publishing only for NEW articles passing EVERY gate**,
  one-per-day limit + E-Stop preserved; existing drafts excluded.
- **Deploy is authorized for TONIGHT, before the 2026-11-22 06:00 Dhaka
  weekly run** — the weekly run will fire on the NEW code. Deployment
  inputs from this workstream are in §10; post-deploy checks in §11.

### 0.1 Authorization discrepancy — flagged for the parent to reconcile

`~/MEMORY.md` was changed by an outside process during this session: it
now records a "FULL OWNER AUTHORIZATION OVERRIDE" dated 2026-11-21 14:12
with BROADER authorization (complete source changes, push, deploy, apply
migrations 020–023, #29 regen + #30 fact-check, social setup, free
video-generation infra, etc.). My assigned subagent task is more
specific/restrictive (no deploy/live writes myself; #30 procedure only,
#29 dashboard procedure only). I followed my assigned task and did NOT
act on the MEMORY.md change. The parent should reconcile which
authorization governs the deploy step. Nothing in this workstream
depends on the broader override.

## 1. Live D1 ground truth (SELECT-only, 2026-11-21 ~14:35 Dhaka)

| Check | Live value |
|---|---|
| #28 | draft, 2157 chars, updated 2026-11-19T18:53:35Z — unchanged |
| #29 | draft, 593 chars, updated 2026-11-20T05:09:54Z — unchanged |
| #30 | draft, 4615 chars, updated 2026-11-20T05:52:22Z — unchanged |
| #31 | draft, 549 chars, updated 2026-11-21T01:19:10Z — unchanged, still draft |
| #30 fact_checks | latest id 16, verdict needs-review, 20 claims, 5 verified / 15 failed, check_kind 'initial', **body_hash NULL**, created 2026-11-20 05:50:42; id 15 same counts 05:45:27; id 14: 4/16, 05:40:02 |
| #29 article_sources | one row (id 2): Guardian URL `https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide/` (trailing slash), source_type 'other', research_item_id NULL |
| #29 research_items 381 | same Guardian URL, evidence_text == summary == the SAME 500-char fragment, truncated mid-sentence ("...South by Southwest tech, film and music "), is_outdated=1, fetched 2026-11-19 17:07:18 |
| #30 live body hash | `7945750bc9d5768da933f6123d198de8be80e909ba1ea8a9aaad1bd2300852b4` (repo `bodyHash` util on the live 4615-char body; normalised 3864 chars) — the expected value for the §12 Re-check procedure |

## 2. Per-item status

| Item | Status | Evidence |
|---|---|---|
| A. SEO Related-reading relevance | **IMPLEMENTED_AND_TESTED** | §3; `tests/seo-relevance.test.js` 8/8 |
| B. Cross-draft duplicate detection | **IMPLEMENTED_AND_TESTED** | §4; `tests/cross-draft-duplicates.test.js` 10/10 |
| C. Daily-limit TOCTOU | **IMPLEMENTED_AND_TESTED** | §5; `tests/concurrent-publishing.test.js` 4/4; `tests/daily-limit-toctou.test.js` 4/4 |
| D. Truncation guard end-to-end | **IMPLEMENTED_AND_TESTED** | §6; `tests/truncation-e2e.test.js` 10/10 |
| E. Article #29 regeneration | **IMPLEMENTED_AND_TESTED** (code + fixtures); live run **BLOCKED_BY_OWNER_AUTHORIZATION** (dashboard procedure in §13 — needs deployed code + owner run; expected outcome is the insufficient-evidence no-op, see §13) | §7; `tests/content-scaffold-regen.test.js` 12/12 (incl. new #29-mirror test) |
| F. Article #30 fresh fact-check | **BLOCKED_BY_OWNER_AUTHORIZATION** (procedure only — parent's step after deploy) | §12 exact dashboard procedure |
| G. Dashboard Delete button | **IMPLEMENTED_AND_TESTED** (handler + server guard + audit + orphan cleanup); CSRF-token wiring is a documented follow-up proposal, not a blocker — see §8 | `tests/delete-button.test.js` 7/7; `tests/security-boundaries.test.js` 19/19 (0 skipped) |
| WS-E H1 (protected Delete/edit/publish guard) | **IMPLEMENTED_AND_TESTED** | §8; pinned test un-skipped, 19/19 |
| WS-E L4 (Delete orphan cleanup) | **IMPLEMENTED_AND_TESTED** | §8; L4 tests in security-boundaries 19/19 |
| WS-B stale assertion (autonomy-scheduler) | **IMPLEMENTED_AND_TESTED** | §9; `tests/autonomy-scheduler.test.js` 12/12 |

## 3. A. SEO Related-reading relevance — IMPLEMENTED_AND_TESTED

**Root cause.** `repairSeoFields` linked the NEWEST same-division sibling
regardless of topic, and check 6 (internal-links) accepted any same-division
link. Live #31 → #22 is the instance: same division, no topical overlap,
a misleading link the gate then had to reject.

**Fix (`backend/agents/autonomy/seo.js`).**
- Reuses the auto evaluator's own rule — `isInternalLinkRelevant` from
  `backend/publishing/divisions.js` (same division AND topical
  title-keyword overlap, generic words excluded). No second, different
  relevance rule was written.
- Check 6 passes only with ≥1 genuinely relevant published sibling AND
  no irrelevant linked siblings AND no misleading anchors AND no
  self-link; its detail names irrelevant/misleading links and relevant
  unlinked alternatives.
- `repairSeoFields` targets the newest GENUINELY RELEVANT sibling; when
  none exists it appends NO link (`noRelevantLink: true`) — never faked.
  It also REMOVES Related-reading lines (exact appended shape) pointing
  at irrelevant siblings or with misleading anchors, and preserves all
  other links.
- Sibling window raised LIMIT 5 → 25 (suite check + repair): relevance
  must see the whole division, not just the newest 5 (the EV-charging
  fixture's identical-title sibling #1 fell outside the old window;
  divisions publish at most ~12 articles, so 25 bounds the query).
- The suite stays 11 checks; the truncation gate is a 12th entry only in
  the `runSeo`/`runSeoCheckOnly` wrappers (see §6).

**Test evidence.** `tests/seo-relevance.test.js` — 8/8 pass: relevant
link passes; irrelevant-only link fails naming the article; no relevant
sibling → fails + repair appends no link; repair picks relevant over a
newer irrelevant sibling; repair removes an irrelevant Related-reading
line and links the relevant sibling instead; misleading anchor fails;
self-link excluded; draft sibling never counts.

**Known gap found (proposal, not my file).** The shared relevance rule
lets two titles match on the word "article" alone — "article" is not in
`GENERIC_KEYWORDS` (`backend/publishing/divisions.js`). Proof:
`tests/seo-actions.test.js` passes its optimize test because "Test
Article 101" and "Published Sibling Article" share the word "article".
Proposed change (coordinator / owner of divisions.js): add `'article',
'articles', 'post', 'posts'` to `GENERIC_KEYWORDS`. Until then, a link
whose ONLY shared keyword is "article" counts as relevant under the
shared rule — recorded honestly, not silently fixed by a second rule in
seo.js (my brief forbids duplicating the logic differently).

**Stale fixture (proposal, not my file).** `tests/seo-checks.test.js`:
"passes a well-formed article on all 11 checks" now FAILS (verdict
'needs-review', 1 fail) because its GOOD_BODY fixture links to article
#12 ("Best Family Cars Compared"), which is genuinely irrelevant to
"EV Charging at Home" — the fixture encodes the old lenient behaviour.
Verified by scratch script (not by editing the file): changing the
fixture link from `article?id=12` to `article?id=1` (identical title
"EV Charging at Home", genuinely relevant; different body, so the
duplicate check still passes) makes the suite return verdict 'pass'
with 0 failing checks. **Exact proposed change (one line):**
`tests/seo-checks.test.js`, GOOD_BODY's
`https://fs-ai-5w5.pages.dev/pages/article?id=12` →
`https://fs-ai-5w5.pages.dev/pages/article?id=1`. Coordinator to apply
at merge — I did not edit the file (not owned).

## 4. B. Cross-draft duplicate detection — IMPLEMENTED_AND_TESTED

**Fix (`backend/agents/autonomy/seo.js` + `backend/agents/autonomy/content.js`,
migration 024).**
- `contentFingerprint(body)` — SHA-256 of the normalised body (same
  normalisation as `bodyHash`); `checkCrossDraftDuplicates(env, article)`
  compares against EVERY other non-archived article (draft + published)
  by 5-word shingle overlap and word Jaccard. Duplicate at overlap
  ≥0.5 or Jaccard ≥0.9; near-duplicate at ≥0.25 or ≥0.7.
- `storeArticleFingerprint(env, articleId, body, dup)` — best-effort
  INSERT … ON CONFLICT DO UPDATE into migration 024's
  `article_fingerprints` table; silently skips when the table is absent
  (pre-024 databases).
- Check 9 (duplicate) now uses the cross-draft check (not published-only);
  detail names closest id + status + overlap% + Jaccard; the "no others"
  detail keeps the evaluator's exact phrase ("No other published articles
  to compare against."). `runSeo`/`runSeoCheckOnly` store the fingerprint
  decision.
- `runContentCreation`: after the LLM body is generated, a duplicate body
  returns no-op 'duplicate-content' (no draft); a near-duplicate is
  allowed but flagged in `factCheckFlags` for the fact-checker/owner.
- `convertScaffoldToDraft`: checks the LLM body before INSERT and returns
  409 'duplicate-content' on a duplicate. This is the serialisation
  point — two parallel generations of the same topic both pass the
  generation-time check (neither draft exists yet), but only the first
  converts. Plain scaffolds (placeholder bodies) are NOT checked — their
  placeholder text is identical by design and the slug clash already
  guards topic duplication.
- Migration 024 (`database/migrations/024_article_fingerprints.sql`):
  `article_fingerprints` (article_id PK with FK to articles(id),
  fingerprint, body_length, word_count, shingle_count,
  closest_article_id/status/overlap_pct/jaccard_pct, decision CHECK
  ok/near-duplicate/duplicate, checked_at) + indexes. Additive only.

**Test evidence.** `tests/cross-draft-duplicates.test.js` — 10/10 pass:
fingerprint determinism; duplicate vs published; duplicate vs draft;
unrelated passes; ~1/3-shared body is near-duplicate (not duplicate);
fingerprint row + decision stored; generation refuses a duplicate body;
generation allows an unrelated body; concurrent duplicate generation
(two generations, both 'done') → first convert ok, second 409 with the
duplicate article id, exactly one draft row.

## 5. C. Daily-limit TOCTOU — IMPLEMENTED_AND_TESTED

**Root cause.** `evaluateAutoPublishEligibility()` checks the daily limit
(published-today < limit) and `autoPublishArticle()` then flips the
status — but between the check and the flip a concurrent job can pass
the same check and flip a DIFFERENT article, so two articles publish on
a 1-per-day limit. The old conditional UPDATE only stopped the SAME
article publishing twice.

**Fix (`backend/agents/autonomy/publishing.js`, migration 026).**
- `reserveDailyPublicationSlot(env, articleId, limit)` — a SINGLE atomic
  statement: `INSERT … SELECT … WHERE (SELECT COUNT(*) … status IN
  ('reserved','consumed')) < ?` on migration 026's
  `daily_publication_reservations` table (dhaka_day, article_id,
  status CHECK reserved/consumed/released, UNIQUE(dhaka_day,
  article_id)). One statement = one atomic step in SQLite/D1, so two
  concurrent calls cannot both see "one slot free".
- Wired into `autoPublishArticle` after eligibility + idempotency and
  before the status flip. On success the reservation is CONSUMED; on
  any failure (flip error, 0-row flip, post-flip rollback) it is
  RELEASED — a failed publish never consumes the limit and a retry can
  reserve again. A reservation older than 10 minutes is stale (a publish
  takes seconds; a crashed job must not block the rest of the day) and
  no longer counts.
- **Upsert fix found in testing:** a released reservation's row still
  exists under UNIQUE(dhaka_day, article_id), so a retry's plain INSERT
  failed with a UNIQUE constraint and the retry was refused forever.
  The reserve statement now uses `ON CONFLICT(dhaka_day, article_id)
  DO UPDATE … WHERE status = 'released'` — it re-uses only a RELEASED
  row, never a 'reserved' or 'consumed' one. (Verified in the fault
  test below.)
- **Pre-026 fallback:** when the reservation table is missing, the
  status flip uses a guarded conditional UPDATE — the published-today
  count (same `DHAKA_DAY_START_SQL` predicate as
  `countPublishedTodayDhaka` in gate.js) is a predicate INSIDE the
  UPDATE, so the limit check and the flip are one atomic step.
- `dhakaDayString(date)` exported for tests: Dhaka is UTC+6, no DST
  (`new Date(now + 6h).toISOString().slice(0,10)`).
- Migration 026 (`database/migrations/026_daily_publication_reservations.sql`):
  `daily_publication_reservations` + index. Additive only.

**Test evidence.**
- `tests/concurrent-publishing.test.js` — 4/4 pass: reserve/refuse/
  release/re-reserve unit test; two concurrent auto-publishes, limit 1
  → exactly one publishes, one refused, one consumed reservation, logs
  match outcomes (one success log + one refusal log); fault-injected
  log-write failure → failed + rolled back + reservation released →
  retry publishes exactly once (one success log, one consumed
  reservation); idempotency (second call refused, still one published
  row, one success log).
- `tests/daily-limit-toctou.test.js` — 4/4 pass: `dhakaDayString`
  midnight rollover (18:00Z → next Dhaka day); Promise.all of two
  auto-publishes with limit 1 → exactly one published; a publication
  dated 30h ago (yesterday-Dhaka) does not consume today's limit;
  pre-026 fallback (no reservation table) still allows exactly one
  publish.
- Neighbouring file `tests/autonomous-publishing.test.js` still 46/46
  (its harness has no 026 table, so it exercises the guarded-UPDATE
  fallback path).

**Proposals (files not owned — coordinator).**
- `backend/publishing/gate.js` `publishGatePassed()`: the same
  guarded-UPDATE pattern should be applied to its daily-limit check
  (it has the same check-then-act shape; it is a manual-approval gate,
  not the auto path, so this is a hardening proposal, not a live race
  in the same sense). Exact change: add the published-today count as a
  predicate inside the approval UPDATE that flips the article to
  approved, using `DHAKA_DAY_START_SQL`.
- `publishDueArticles()` (in `backend/routes/admin-articles.js`, the
  scheduled path): it publishes due articles without a daily-limit
  check at all — the scheduled path relies on the queue drain. No
  change proposed beyond noting it; do not add a limit there without
  the coordinator's decision, because it would change scheduled
  publishing behaviour.

## 6. D. Truncation guard end-to-end — IMPLEMENTED_AND_TESTED

**Fix (`backend/agents/autonomy/factcheck.js`, `seo.js`, `content.js`).**
- `isTruncatedDraftBody(body, { minWords = 150, requiredHeadings = [] })`
  (factcheck.js, pure/sync): judges a body on its own — final content
  paragraph lacks terminal punctuation (after trailing-citation strip);
  ends on a function word; unclosed HTML tags (p/div/section/article/
  ul/ol/li/strong/em/a/span/h1–h6/blockquote/table); odd ``` fence count;
  missing required headings (only when an outline is supplied). Empty
  body returns null (not truncation).
- **Shortness is a corroborating signal only, never standalone** (fixed
  2026-11-21 after it broke 3 seo-actions tests — see below): the
  "unexpectedly short" reason is recorded only together with an
  incompleteness signal. A short body that ends cleanly is a short
  article, not a truncated one. A body cut exactly at a sentence
  boundary with no other signal is undetectable in absolute terms; that
  case is what the diff-based `detectTruncatedBody()` (against the
  original body, in correction) is for.
- `runCorrection`: after the existing `detectTruncatedBody` guard, the
  absolute-signal check runs before validation (minWords 0 — the
  correction diffs against the original, so a short but complete body
  must not be flagged). On firing: `failCorrectionRun` with
  failureReason 'truncated-correction', retryable true,
  `truncatedCorrection: true`.
- `runContentCreation`: a truncated generated body returns no-op
  'truncated-generation' (never a draft). Required headings are
  enforced ONLY when the outline was explicitly supplied
  (payload.outline); the title-derived fallback outline is a suggestion,
  not a promise the LLM must fulfil.
- `regenerateScaffoldDraft`: the shared guard augments the existing
  ad-hoc checks (length <500, still scaffold, ends mid-sentence) with
  unclosed-HTML/Markdown, ends-on-function-word and missing outline
  sections (only when the scaffold carried its own ## headings); reasons
  are merged into one list.
- `seo.js`: `applyTruncationGateToSeoResult(suite, body)` appends a 12th
  'truncation' entry (level 'failed') and forces verdict 'failed' when
  the guard fires; the suite itself stays 11 checks. Wired into
  `runSeo` and `runSeoCheckOnly` (and the fingerprint is stored before
  `insertSeoCheck`). A truncated article therefore stores SEO verdict
  'failed', and the auto-publish evaluator refuses it on
  seo-fresh-pass — a truncated article can NEVER pass the gate.
- `backend/publishing/gate.js` was NOT edited: no change is needed —
  the evaluator already refuses on a failed/fresh SEO check, and the
  truncation entry flows through the stored seo_checks row (verified in
  the e2e test).

**The seo-actions incident (diagnosed, not a weakening).** My first
version flagged any body under 150 words as truncated. That broke 3
tests in `tests/seo-actions.test.js` (LONG_SENTENCE_BODY ~70 words and
H3_BODY ~140 words are complete short fixtures): verdict 'failed'
instead of 'needs-review' and 12 checks instead of 11. The fix was the
corroborating-only shortness rule above — a REAL false-positive fix
(a complete 70-word body must not be called truncated), not a test
weakening. After the fix: `tests/seo-actions.test.js` 11/11 pass,
`tests/factcheck-correction-validation.test.js` 15/15,
`tests/factcheck-correction-quality.test.js` 25/25.

**Test evidence.** `tests/truncation-e2e.test.js` — 10/10 pass:
generation truncated → no-op, no draft; complete generation → done;
truncated AI-DRAFT → SEO verdict 'failed' with truncation entry,
stored row verdict 'failed', evaluator refuses on seo-fresh-pass;
complete body → no truncation entry, suite stays 11 checks; correction
with unclosed-markup assembled body → outcome 'failed',
truncatedCorrection true, retryable, body unchanged, no revision;
scaffold regen with unclosed HTML + missing Conclusion → failed with
both reasons, scaffold untouched; unit: missing required heading
flagged, all headings present not flagged, unclosed fence flagged,
short-but-clean body NOT flagged.

## 7. E. Article #29 regeneration — IMPLEMENTED_AND_TESTED (code); live run BLOCKED_BY_OWNER_AUTHORIZATION

**Live evidence (SELECT-only, re-verified 2026-11-21 ~14:35).** #29 is a
593-char scaffold ("A local's travel guide to Austin: what to eat, see
and do in three days", division 5, draft). One article_sources row (id
2): Guardian URL with trailing slash, source_type 'other',
research_item_id NULL. research_items 381 exists for that URL (fetched
2026-11-19 17:07:18) but evidence_text == summary == the SAME 500-char
fragment, truncated mid-sentence, is_outdated=1. `resolveEvidence()`
matches by URL (exact then normalised), so regeneration CAN resolve item
381 despite the NULL research_item_id — but the evidence is very thin.

**Fix (`backend/agents/autonomy/content.js`).**
- `regenerateScaffoldDraft` now has an evidence-SUFFICIENCY guard:
  usable evidence = sum of `evidenceText` chars from resolved items
  EXCLUDING `is_outdated` items; floor `MIN_REGEN_EVIDENCE_CHARS =
  1000` (exported). Below the floor it returns no-op
  'insufficient-evidence' with the exact reason + a recovery report
  (retryable false, ownerAction = re-fetch through the research engine),
  touching nothing and making NO LLM call (no Neurons spent). Live #29
  fails this exactly: 0 chars of current evidence (its only 500 chars
  are outdated) — a 600–900-word regeneration would have to invent most
  of its facts.
- Truncation: the shared guard is merged into the existing completeness
  checks (see §6).
- Stale comment fixed: the docstring claimed the handler was "NOT added
  to the autonomy-runner dispatch" — the dispatch EXISTS
  (`backend/agents/autonomy-runner.js:124–130`, agent 'content-creation'
  + kind 'scaffold-regeneration', explicit owner/manual tasks only,
  never the scheduled run). Comment corrected to say so. No dispatch
  code changed.
- Everything else about regeneration is unchanged: same row, same slug,
  same title, stays draft, fact_checked 0, scaffold snapshotted first
  as a revision, evidence from the article's own sources only, daily
  cap does NOT apply (no new article).

**Test evidence.** `tests/content-scaffold-regen.test.js` — 12/12 pass.
Changes to that file (allowed — extend): the old ~340-char
AUSTIN_EVIDENCE fixture was below the new 1000-char floor, so it was
lengthened to realistic Austin guide material (>1000 chars); a new test
mirrors live #29 (500-char truncated outdated fragment →
insufficient-evidence no-op, scaffold untouched, no revision,
recovery report names re-fetch, `currentEvidenceChars` 0); the daily-cap
test's existing draft body was changed from the identical CANNED_BODY
to unrelated prose (otherwise the new duplicate guard correctly refuses
it — the test is about the cap, not duplicates).

**Live run.** NOT run live (needs deployed code + the dashboard
procedure in §13, parent's step). Expected outcome on the CURRENT live
evidence is the insufficient-evidence no-op — regeneration must NOT be
attempted until the Guardian source is re-fetched through the research
engine (see §13 step 0).

## 8. G. Dashboard Delete button + WS-E H1/L4 — IMPLEMENTED_AND_TESTED

**Root cause (investigated from the dashboard handler + backend route
together).** The DELETE endpoint lives in
`backend/routes/admin-articles.js` (`deleteArticle`), NOT in
orchestrator.js. It had NO protection check (no `assertNotProtected`,
no published check), NO audit log row, and deleted only the articles
row (orphan `article_tags` / `article_sources` rows). The frontend
(`frontend/scripts/dashboard.js:239–243`, `bindContent`) was a single
`window.confirm`, then DELETE: no in-flight guard (double-click → second
DELETE 404s), no client-side published/protected refusal, no
verification the row is gone. CSRF: `backend/security/crypto.js`
defines `generateCsrfToken`/`createCsrfToken`/`verifyCsrfToken`, but
they are NEVER called anywhere; worker.js only lists `X-CSRF-Token` in
CORS allowed headers. De facto CSRF defence is the owner Bearer token
+ CORS preflight (a cross-site form cannot set the Authorization
header; the token lives in sessionStorage, not a cookie).

**Fix — server (`backend/routes/admin-articles.js`, WS-E patches H1+L4
applied verbatim in intent, one placement correction).**
- H1: `assertNotProtected` (from `../publishing/protection.js`) is now
  called in `deleteArticle()`, `updateArticle()` and `setPublishState()`.
  **Placement correction vs the WS-E patch:** the patch said "immediately
  after the 404 check", but protection is an ID-level rule
  (`isProtected` covers #26/#27 by constant even when no row exists),
  and the pinned test requires a 403 for #26 in a DB where the row does
  not exist — so the guard runs BEFORE the 404 check in all three
  endpoints. A protected id refuses 403 regardless of row existence.
- L4: after the articles DELETE, `DELETE FROM article_tags` and
  `DELETE FROM article_sources` for the article. (Both tables declare
  ON DELETE CASCADE, so in an FK-enforcing DB the cascade already
  removed them and these delete 0 rows — harmless. On live D1 the
  Worker's connection does not run schema.sql's `PRAGMA foreign_keys =
  ON`, so the cascade may NOT fire and the explicit DELETEs are what
  actually removes the orphans.)
- Deletion audit (migration 025): before deleting, an
  `article_deletion_audit` row is written (article_id, title, slug,
  status_at_delete, deleted_by = owner from auth, body_length,
  revisions_kept = pre-delete revision count). Best-effort pre-025 (a
  missing table skips the write, the delete still proceeds); the table
  is applied at deploy, after which every deletion is audited. The
  audit table deliberately has NO FK to articles, so the row survives
  the delete in both FK modes. `deleteArticle` now takes `auth` so
  `deleted_by` is recorded.
- Revisions: the old comment claimed "D1 does not enforce the ON DELETE
  CASCADE" for `article_revisions`. That is UNVERIFIED and contradicted
  in the harness (schema.sql runs `PRAGMA foreign_keys = ON` and the
  cascade DOES delete revisions there). The comment was corrected: the
  audit row's `revisions_kept` is the durable record of how many
  revisions existed at delete time, since the revision rows themselves
  cascade away in an FK-enforcing DB and remain where the cascade does
  not fire. The post-deploy check (§11) should confirm the live
  behaviour by inspection, not by assumption.

**Fix — client (`frontend/scripts/dashboard.js`, Delete UI only).**
- The Delete button now carries `data-title`, `data-status` and
  `data-protected` (rendered in `loadArticles()`).
- Handler: ignores clicks while a delete for that id is in flight
  (`deleteInFlight` map + button disabled); refuses protected articles
  client-side with a clear message and NO request (the server also
  refuses 403); warns loudly for published articles ("This article is
  PUBLISHED — deleting removes it from the live site."); confirms with
  title + id + "Its revisions are kept."; on DELETE success VERIFIES via
  GET `/api/admin/articles/:id` — 404 = truly gone → "Article deleted."
  + reload; still present = honest failure message; verify failure =
  honest "please check the list" message; on DELETE failure shows
  `apiError(r)` with the HTTP status.
- A published article CAN still be deleted after the warning (the owner
  may deliberately delete a published article; the audit row records
  it). The server does NOT refuse published deletes — refusing them
  client-side while the API allows them would be an inconsistent guard.
  Protected articles are refused on BOTH layers.

**CSRF — follow-up proposal (not a blocker).** No CSRF token is wired
into the Delete flow: `crypto.js` helpers exist but are unwired anywhere
and there is no token-issuing endpoint; wiring them requires `worker.js`
(not owned) + a token endpoint + the dashboard `api()` helper. The
current defence (Bearer token in the Authorization header, sent only by
same-origin JS; CORS preflight blocks cross-origin calls with custom
headers; no auth cookie) means a cross-site request cannot authenticate
as the owner. Proposal for the coordinator: wire `createCsrfToken` /
`verifyCsrfToken` (crypto.js) into worker.js for state-changing admin
routes and have `api()` send the token — defense-in-depth, not a fix
for a live hole. The Delete button's actual failure modes (unprotected
delete, double-click, unverified success) are fixed and tested now.

**Test evidence.**
- `tests/security-boundaries.test.js` — 19/19 pass, 0 skipped. The
  WS-E pinned test ("protected-article Delete guard") was UN-SKIPPED
  (it is now a live test, never to be re-skipped) with one honest
  test-setup addition: the seed loads only articles 1–25, so the test
  inserts the #26 row first — otherwise the "row survives" assertion
  would be vacuous (COUNT 0 == 0). New L4 describe block: deleting a
  draft removes its tags + sources, writes the audit row (title, slug,
  status, deleted_by, body_length, revisions_kept), and the revision
  assertion is FK-mode-aware (0 where the cascade fires, 1 where it
  does not); a pre-025 database (no audit table) still deletes
  successfully with orphan cleanup.
- `tests/delete-button.test.js` — 7/7 pass (DOM shim, modeled on
  dashboard-autonomy-dom.test.js): draft delete → confirm → one DELETE
  → verify 404 → "Article deleted."; published delete → confirm warns
  PUBLISHED/live site; protected delete → no confirm, no fetch, refusal
  message; double-click → single DELETE; server 500 → "API error (HTTP
  500)…", no verify GET; DELETE succeeds but row still present → honest
  "still there" failure, never "deleted"; declining the confirm sends
  no request.

## 9. WS-B forward — stale autonomy-scheduler assertion — FIXED

`tests/autonomy-scheduler.test.js` had 1 failure: "#28 got the Related
reading link". The fixture's #28 ("Guard Test Article 28") shares no
topical title keyword with any published sibling, so the new repair
correctly appends NO link — the expectation was stale, not the code
(WS-B notes §9; foundation report §14.4 follow-up fix). Updated (parent
instruction, 2026-11-21 14:32):
- The seoRun test now asserts NO Related-reading link is appended AND
  the body is byte-identical, keeping the meta-description repair and
  seo_checks-row assertions. The stale comment above `bodyFor` was
  corrected the same way.
- The correctionRun test's comment (which said seoRun "legitimately
  appends" the link) was corrected and its assertion tightened to strict
  body equality — neither the correction nor the SEO step changes #28's
  body now.
- The relevance rule itself was NOT weakened.
- Result: `tests/autonomy-scheduler.test.js` 12/12 pass (incl. the two
  `runWeeklyWorkflow` tests — the weekly path is unaffected by my
  changes; see §11).

## 10. Deployment procedure inputs (from Workstream A)

For the parent/coordinator executing tonight's deploy. Do NOT edit
`package.json` (coordinator wires the migrate list at merge).

**Migrations to apply, in order (all verified free — 024/025/026 did not
exist live; live list ended at 023):**
1. `database/migrations/024_article_fingerprints.sql` — new table
   `article_fingerprints` (additive only).
2. `database/migrations/025_article_deletion_audit.sql` — new table
   `article_deletion_audit` (additive only).
3. `database/migrations/026_daily_publication_reservations.sql` — new
   table `daily_publication_reservations` (additive only; UNIQUE
   (dhaka_day, article_id), FK to articles(id)).

**Env secrets:** NONE new from this workstream. (SOCIAL_TOKEN_SECRET is
W4's area, not mine.) No new env vars, no new bindings, no new
scheduled triggers.

**Rollback notes.**
- All three migrations are additive-only tables; nothing existing is
  altered, no data is changed, no row is deleted. If the deploy must be
  rolled back, the tables can simply be LEFT in place (inert — every
  writer degrades gracefully when a table is absent, and the tables
  being present never changes old-code behaviour; the old code never
  reads them).
- Code degrades pre-migration by design: fingerprint store skips when
  024 is absent; the reservation falls back to the guarded conditional
  UPDATE when 026 is absent; the deletion audit write is best-effort
  when 025 is absent. A deploy that ships the code before the
  migrations (or vice versa) does not break publishing, SEO or delete.
- The one behaviour that CHANGES at deploy with no migration needed:
  protected articles (#26/#27) can no longer be edited/published/
  deleted through the manual admin endpoints (403) — that is the H1
  fix, and it is intended. Verify the owner can still edit an
  UNPROTECTED draft after deploy (see §11).

## 11. Post-deploy verification steps (Workstream A area)

Run after tonight's deploy, before the 2026-11-22 06:00 weekly run
(the weekly run fires on the NEW code — see §11.1 first).

1. **Migrations live:** SELECT from D1: `article_fingerprints`,
   `article_deletion_audit`, `daily_publication_reservations` all exist
   and are empty (0 rows). If any is missing, the code still works (see
   §10 degrade paths) — but file it as a deploy gap, do not assume.
2. **Protected guard live:** as owner, attempt DELETE
   `/api/admin/articles/26` (do NOT delete a real article — the call
   must be refused BEFORE any deletion): expect HTTP 403 with the
   protected reason, and #26 still present. Same for a PUT edit to #26.
   Then edit an UNPROTECTED draft and confirm it still saves (the
   guard must not over-block).
3. **Delete audit live:** delete a throwaway draft from the dashboard;
   confirm the article is gone, its tags/sources are gone, and an
   `article_deletion_audit` row exists with the right title/status/
   deleted_by. Confirm the dashboard shows "Article deleted." (not a
   stale success).
4. **SEO relevance live:** run an SEO check on a draft whose only
   same-division siblings are topically unrelated; confirm the
   internal-links check fails honestly and NO Related-reading link is
   appended. Run it on a draft with a genuinely relevant sibling;
   confirm the link IS appended.
5. **Daily-limit reservation live:** with limit 1, publish one NEW
   eligible article (only if one is eligible and the owner has
   authorised that specific publication — do NOT publish #28–#31);
   confirm one `daily_publication_reservations` row with status
   'consumed' for that Dhaka day, and a second eligible article is
   refused for the day.
6. **Truncation live:** run an SEO check on a draft whose body ends
   mid-sentence; confirm the stored seo_checks verdict is 'failed' with
   a 'truncation' entry.
7. **Weekly path (§11.1):** confirm the 06:00 run completes and writes
   its daily_reports row; spot-check that no article changed status and
   no draft was published by the weekly run.

### 11.1 Weekly read-only path — non-interference verification

My changes touch NO scheduler code (`backend/routes/scheduler.js`
untouched) and none of the weekly path's callees: `runWeeklyWorkflow`
is read-only + writes one daily_reports row + one agent_runs row; it
does NOT call `drainTaskQueue`, `autoPublish`, `runSeo`,
`runContentCreation` or `runCorrection` (autoPublish is only in the
daily workflow steps; drain is daily). The only shared code the weekly
path could reach is the SEO suite — but the weekly run does not run
SEO. Evidence: `tests/autonomy-scheduler.test.js` 12/12 pass, including
both `runWeeklyWorkflow` tests, after all my changes. The weekly run
firing on the new code is safe from Workstream A's side.

## 12. F. Article #30 — exact Re-check procedure (DO NOT RUN — parent's step after deploy)

**Purpose.** Produce a FRESH fact-check of #30's CURRENT 4615-char body
(the last checks, fc 14/15/16, are stale: body_hash NULL, created
2026-11-20 05:40–05:50, before the body was last updated 05:52:22).
This procedure only RE-CHECKS. It does NOT correct, does NOT publish,
does NOT change the body. #30 stays a draft throughout.

**Preconditions.**
- Deploy done (new code live); you are signed in as the owner on the
  dashboard (https://fs-ai-5w5.pages.dev/pages/dashboard.html).
- E-Stop OFF (the Re-check endpoint returns 423 when it is ON — if you
  get 423, stop: the stop must be OFF for this step, do not force it).
- Do NOT click Correct first. Do NOT touch #28/#29/#31 in this run.

**Steps (dashboard).**
1. Open the dashboard as owner → **Autonomous Operations** section →
   pipeline table → find the article **#30** row.
2. Click the **Re-check** button on the #30 row
   (`frontend/scripts/autonomy.js`, `data-autonomy-recheck` → POST
   `/api/autonomy/articles/30/recheck` → `handleRecheckArticle` in
   `backend/routes/orchestrator.js`). It reuses the existing fact-checking
   task where possible and forces check_kind 'recheck'.
3. Wait for the response (the check runs the LLM over the current body;
   allow up to a few minutes — do not click Re-check again while it is
   running; an in-flight re-check returns HTTP 202, not a second run).

**Expected outcomes — check each one, in order.**
1. Response is HTTP 200 (not 423/409/500). A 423 means the E-Stop is
   ON — stop. A 409 means the article is published (it is not — #30 is
   a draft; if you see 409, stop and report it). A 500 with "no new
   fact_checks row" means the re-check failed to write — stop, do not
   retry blindly; the failure needs the parent.
2. A NEW `fact_checks` row exists: id **17 or higher** (the next id after
   live fc 16), `article_id` 30, `check_kind` = **'recheck'**,
   `verdict` expected **'needs-review'** (NOT 'pass' — the current body
   has 15/20 failed claims and the re-check re-verifies the same body;
   a 'pass' would be suspicious, not a success), `claims_total` 20.
3. **Body-hash verification (the point of the re-check):** the new row's
   `body_hash` must be PRESENT and equal to
   `7945750bc9d5768da933f6123d198de8be80e909ba1ea8a9aaad1bd2300852b4`
   — the hash of the live 4615-char body computed 2026-11-21 with the
   repo's `bodyHash` util (§1). If `body_hash` is NULL or different,
   the check ran against a different body (or a stale one) — do NOT
   treat it as fresh; report it.
4. `fact_checked` on the articles row stays **0**. The article status
   stays **'draft'**. The body is byte-identical (4615 chars, updated_at
   still 2026-11-20T05:52:22Z).
5. **History preserved:** fc 14, 15 and 16 still exist unchanged. The
   re-check ADDS a row; it never deletes or rewrites history.
6. **Task #31 note:** agent_tasks id 31 (fact-checking, kind 'correct',
   status failed, 2026-11-20 11:48) is a SEPARATE failed correction task.
   The Re-check reuses the existing fact-checking task where the handler
   allows it; if it reuses task #31's row, its status may change — that
   is the handler's designed reuse, not an error. Do NOT create a new
   correction task for #30 as part of this procedure.

**If anything above differs:** stop, keep #30 as a draft, and report the
exact differing value to the parent. Do not click Correct, do not
re-run Re-check in a loop, do not hand-edit the body to make the hash
match.

## 13. E. Article #29 — exact dashboard regeneration procedure (parent's step after deploy)

**Purpose.** Regenerate #29's scaffold shell into a real draft from its
OWN evidence only. There is NO dashboard button for scaffold
regeneration — the procedure below uses the dashboard's own task
controls plus the browser console on the signed-in dashboard page
(owner session), going through the worker handlers, NEVER raw D1 SQL.

**Step 0 — PREREQUISITE, do this first: re-fetch the source.**
The live evidence is INSUFFICIENT (see §1/§7): one 500-char truncated,
outdated Guardian fragment; 0 chars of current evidence. Running the
regeneration now returns the insufficient-evidence no-op (step 4's
expected outcome) and changes nothing — that is the CORRECT behaviour,
not a failure. To actually regenerate, FIRST re-fetch the Guardian
source through the research engine (dashboard → Autonomous Operations →
research sources → re-fetch the Guardian Austin source, or run a
research task for that URL) until `research_items` 381 is replaced by
(or joined by) a CURRENT item with ≥1000 chars of usable evidence text
for that URL. Do NOT proceed to step 1 until that is true. If the
re-fetch cannot produce ≥1000 chars of current evidence, STOP and
report the exact limitation — do NOT invent content and do NOT ask the
LLM to write from the 500-char fragment.

**Steps (dashboard + console).**
1. Sign in as owner on the dashboard
   (https://fs-ai-5w5.pages.dev/pages/dashboard.html).
2. Open the browser console on the dashboard page (the page holds the
   owner session, so the request below is authenticated the same way
   the dashboard's own calls are).
3. Create the regeneration task — paste exactly:
   `fetch('https://fs-ai.mdalfahad841.workers.dev/api/autonomy/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + JSON.parse(sessionStorage.getItem('fsai-session')).token }, body: JSON.stringify({ agent: 'content-creation', kind: 'scaffold-regeneration', payload: { article_id: 29 }, idempotency_key: 'scaffold-regen-29-2026-11-21' }) }).then(r => r.json()).then(console.log)`
   Expected response: HTTP 200 with a task object containing an `id`
   (the new task id) and status 'queued'. A 400 means the payload was
   wrong (agent must be 'content-creation', kind must be
   'scaffold-regeneration', payload must be `{ article_id: 29 }`). A
   403 means a protection refusal (29 is not protected — if you see
   403, stop and report it).
4. Run the task — in the dashboard's **Autonomous Operations → Task
   queue** section, use **"Run a task manually"** and select the new
   task (or, in the console, POST
   `/api/autonomy/tasks/<id>/run` the same way as step 3).
   **Expected outcome on the CURRENT live evidence (before step 0's
   re-fetch):** outcome **'no-op'**, reason
   **'insufficient-evidence'** naming 0 characters of current evidence
   and the 1000-char floor; the scaffold is UNTOUCHED (body still 593
   chars, still "SCAFFOLD — full draft needed"); NO revision row; NO
   LLM call; a recovery report naming the re-fetch as the fix. That is
   the correct outcome — it proves the guard works. Do NOT retry it
   until step 0's re-fetch is done.
   **Expected outcome AFTER step 0's re-fetch (≥1000 chars current
   evidence):** outcome **'done'**, `regenerated: true`, same article
   row (id 29, same slug, same title), status still **'draft'**,
   `fact_checked` 0, body starts with the **AI-DRAFT** banner, no
   "[Write this section — no content yet.]" placeholders left, one new
   `article_revisions` row with `revised_by` 'scaffold-regen' holding
   the old scaffold shell, `sourcesUsed` ≥ 1. The new body then still
   needs a fact-check (Re-check, §12-style) before ANY approval — and
   #29 still needs its own separate editorial authorization before any
   publication (it is never auto-published).
5. If the outcome is 'failed' with reasons about truncation (too short,
   still a scaffold, cut off mid-sentence, unclosed markup, missing
   sections): that is a RETRYABLE LLM failure — re-run the task once.
   If it fails the same way twice, stop and report the reasons.

**Never in this procedure:** raw D1 SQL writes; editing #29's body by
hand to "help" the regeneration; publishing #29; running the
regeneration from the scheduled daily run (it is deliberately NOT wired
there).

## 14. Files changed / added

**Owned code changed:**
- `backend/agents/autonomy/seo.js` (514 → 827 lines) — relevance (A),
  cross-draft duplicates (B), truncation gate (D), fingerprint store.
- `backend/agents/autonomy/factcheck.js` (1611 → 1719 lines) —
  `isTruncatedDraftBody` + absolute guard in `runCorrection` (D).
- `backend/agents/autonomy/content.js` (721 → 844 lines) — duplicate +
  truncation guards in generation/convert (B, D), evidence-sufficiency
  guard + truncation merge in regeneration (E), stale dispatch comment
  fixed.
- `backend/agents/autonomy/publishing.js` (371 → 521 lines) — atomic
  daily-slot reservation + consume/release + pre-026 guarded UPDATE
  fallback + `dhakaDayString` (C).
- `backend/routes/admin-articles.js` (→ 449 lines) — H1 protection guard
  on delete/update/setPublishState, L4 orphan cleanup, deletion audit
  write (migration 025), `deleteArticle` takes `auth`.
- `frontend/scripts/dashboard.js` (1278 → 1343 lines) — Delete UI repair
  (G): data attributes, in-flight guard, protected refusal, published
  warning, verify-before-success.
- `backend/agents/autonomy-runner.js` — read-only: dispatch already
  exists (no change). `backend/publishing/gate.js` — NOT edited (no
  change needed; proposals in §5).

**Migrations added (024/025/026 — coordinator wires the migrate list):**
- `database/migrations/024_article_fingerprints.sql`
- `database/migrations/025_article_deletion_audit.sql`
- `database/migrations/026_daily_publication_reservations.sql`

**Tests added (new files only, except where noted):**
- `tests/seo-relevance.test.js` (8 tests)
- `tests/cross-draft-duplicates.test.js` (10 tests)
- `tests/concurrent-publishing.test.js` (4 tests)
- `tests/daily-limit-toctou.test.js` (4 tests)
- `tests/truncation-e2e.test.js` (10 tests)
- `tests/delete-button.test.js` (7 tests)
- `tests/content-scaffold-regen.test.js` — extended (12 tests: fixture
  lengthened past the 1000-char floor + new #29-mirror test + cap-test
  body de-duplicated; see §7).

**Tests edited outside my ownership, on explicit parent instruction:**
- `tests/security-boundaries.test.js` — un-skipped the WS-E pinned H1
  test (with the #26-row setup the test needs) + added the L4 describe
  block (19 tests, 0 skipped).
- `tests/autonomy-scheduler.test.js` — WS-B forward: updated the stale
  #28 Related-reading expectation to the honest new behaviour + tightened
  the correction test (12 tests).

## 15. Full test evidence (my files + neighbours, run individually)

| File | Result |
|---|---|
| tests/seo-relevance.test.js | 8 pass / 0 fail |
| tests/cross-draft-duplicates.test.js | 10 pass / 0 fail |
| tests/concurrent-publishing.test.js | 4 pass / 0 fail |
| tests/daily-limit-toctou.test.js | 4 pass / 0 fail |
| tests/truncation-e2e.test.js | 10 pass / 0 fail |
| tests/delete-button.test.js | 7 pass / 0 fail |
| tests/content-scaffold-regen.test.js | 12 pass / 0 fail |
| tests/security-boundaries.test.js | 19 pass / 0 fail / 0 skipped |
| tests/autonomy-scheduler.test.js | 12 pass / 0 fail |
| tests/seo-actions.test.js | 11 pass / 0 fail |
| tests/seo-repair-snapshot.test.js | 5 pass / 0 fail |
| tests/seo-links-phase3.test.js | 5 pass / 0 fail |
| tests/seo-checks.test.js | 10 pass / **1 fail** — the known stale fixture (GOOD_BODY links to irrelevant #12; one-line proposal in §3, coordinator to apply) |
| tests/autonomous-publishing.test.js | 46 pass / 0 fail |
| tests/divisions-support.test.js | 12 pass / 0 fail |
| tests/publish-gate.test.js | 14 pass / 0 fail |
| tests/factcheck-correction-validation.test.js | 15 pass / 0 fail |
| tests/factcheck-correction-quality.test.js | 25 pass / 0 fail |
| tests/queue-recovery-audit.test.js | 15 pass / 0 fail |
| `node --check` on seo.js, factcheck.js, content.js, publishing.js, admin-articles.js, dashboard.js | all pass |

The full suite was NOT run (per the brief — other workstreams run
concurrently; I ran only my files plus the neighbours my changes touch).
Baseline was 1106 pass / 0 fail. My work adds 46 tests net: the six new
files total 43 (8+10+4+4+10+7), content-scaffold-regen grew 11→12 (+1),
and security-boundaries grew 17→19 (+2 L4 tests, and the 1 previously
skipped test now passes). The single failing test in the run above is
the pre-existing stale fixture in §3, not a regression — it fails
because the fixture encodes the old buggy behaviour the fix correctly
removes.

## 16. Open items / blockers (exact)

1. **#30 Re-check** — BLOCKED_BY_OWNER_AUTHORIZATION: needs deployed
   code + the dashboard procedure in §12 (parent's step). No code
   blocks it.
2. **#29 live regeneration** — BLOCKED_BY_OWNER_AUTHORIZATION + evidence:
   needs deployed code + the §13 procedure + the step-0 re-fetch
   (≥1000 chars current evidence). On current evidence the correct
   outcome is the insufficient-evidence no-op.
3. **seo-checks fixture** — needs the coordinator's one-line change
   (§3: `article?id=12` → `article?id=1` in GOOD_BODY).
4. **GENERIC_KEYWORDS 'article' gap** — proposal for divisions.js (§3).
5. **CSRF token wiring** — proposal for worker.js + dashboard api()
   (§8). Not a live hole (Bearer + CORS), defense-in-depth only.
6. **gate.js publishGatePassed hardening** — proposal (§5). Not a live
   race in the auto path (that race is fixed in publishing.js).
7. **Live FK behaviour for revisions** — unverified: whether live D1
   enforces the article_revisions ON DELETE CASCADE (§8). The audit row
   is the durable record either way; confirm by inspection post-deploy
   (§11 step 3), not by assumption.
8. **MEMORY.md authorization discrepancy** (§0.1) — parent to reconcile.
