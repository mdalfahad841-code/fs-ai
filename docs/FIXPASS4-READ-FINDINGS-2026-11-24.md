# Fix Pass 4 — Phase 1 READ Findings (2026-11-24)

**Scope:** READ-ONLY. No source file was changed, no live D1 write was made, nothing was
deployed, published, or uploaded. All D1 reads below are live reads from
`fs-ai-db` (`5043ece5-a853-433c-95f1-ee15a12b6b56`) taken during this session on
2026-11-24; all code citations are from local source at
`~/workspace/fs-ai-source/fs-ai/`. Builds on Fix Pass 3 ledger A6
(`docs/FIXPASS3-LEDGER-2026-11-23.md`, lines 469–549).

**Headlines**

- **R1 — Research "stall": NOT a stall.** The fetch engine is healthy (73/73 audit rows
  `completed` since 18 Nov, all 24 sources `ok`). The daily counts only measure the
  inline `researchFetch` step, which re-fetches the same 2 divisions the queue drain
  already fetched minutes earlier — everything is a duplicate by then, so 0 is the
  correct answer. The drain stored 13 new items on 24 Nov; the daily counts never show
  them. Real defect: a double-fetch design + a 500-char evidence cap (see R2).
- **R2 — Gate bottleneck: 0 of 7 drafts are auto-publishable; the closest (#31) is
  11/14 and is blocked only by legacy status + SEO/internal-links.** The binding
  constraint is thin evidence: 6 of 7 drafts were fact-checked against ≤500 chars of
  RSS summary; the one draft with full-text evidence (#33, 3,985 chars) passed 15/15.
- **R3 — Health budget: proven fetches total only 24–26 of the 50, so the budget is
  NOT fully accounted for.** The health report runs last (step 15) and its sitemap +
  serverSideHeads fetches hit the wall — real failures, but the sitemap/heads themselves
  were proven live by curl on 23 Nov. The residual ~24 subrequests are most plausibly
  redirect hops (unaudited — flagged UNVERIFIED). `oldestQueuedAt` is a correct
  pre-drain snapshot, not a bug.
- **R4 — CSP: all 16 rows are the site's own GA4 beacons** (`connect-src`,
  `https://www.google.com/g/collect?v=2&tid=G-JVSCJT2DHJ…`), Report-Only so nothing
  broke. Single root cause: GA4 is not allow-listed in `connect-src`.

**Live baselines (read 2026-11-24, for Phase 2 to prove nothing moved)**

| Table | Count |
|---|---|
| articles total / published / draft | 34 / 25 / 9 |
| fact_checks rows | 41 |
| seo_checks rows | 26 |
| publication_logs rows | 3 |
| research_items rows | 727 |
| csp_reports rows | 16 (ids 2–17; id 1 absent — reason unknown, see R4) |
| daily_reports latest | id 15, 2026-11-24 |

Draft bodies (chars / body_hash prefix, from the 24 Nov health-report snapshot in
daily_reports id 15, cross-checked against live `LENGTH(body)`):

| Draft | Body chars | body_hash (first 12) | Revisions |
|---|---|---|---|
| #28 | 2,157 | `4556f8406f4c` | 2 |
| #29 | 601 | `f1ff4c15e891` | 3 |
| #30 | 4,088 | `691e5dacf718` | 3 |
| #31 | 549 | `fc15fb05d977` | 7 |
| #33 | 3,478 | `67330d2e6fe2` | 1 |
| #34 | 4,090 | `3505297133c7` | 0 |
| #35 | 3,728 | `a9f087efe4c4` | 0 |

---

## R1. RESEARCH STALL — verdict: the engine works; the daily counts measure the wrong step

### R1.1 Daily runs (daily_reports, latest first)

| Date | Report id | researchEnqueued | researchFetched | researchItemsStored |
|---|---|---|---|---|
| 2026-11-24 | 15 | 2 | 0 | 0 |
| 2026-11-23 | 14 | 2 | 0 | 0 |
| 2026-11-22 | 12 | 2 | 0 | 0 |
| 2026-11-21 | 11 | 2 | 14 | 14 |
| 2026-11-20 | 9 | 0 | 0 | 0 |
| 2026-11-19 | 8 | 0 | 0 | 0 |

No `daily_reports` row exists for 2026-11-18 (the 7th day back) — the last 7 days of
daily runs are the 6 rows above. (Ids 13 and 10 are the 22 Nov and 20 Nov *weekly*
reports, not daily runs.) 21 Nov is the only day the inline step stored anything.

### R1.2 Research tasks in the window (agent_tasks, kind `daily-research`)

Two tasks are enqueued per day by the topicSelection step, one per thinnest division
(`backend/routes/scheduler.js:1366–1367`, idempotency key
`` `daily-research-${d.division}-${date}` ``). `last_error` is NULL on every row:

| Task ids | Created | Status |
|---|---|---|
| #9, #10 | 2026-11-18 00:00:53 | skipped, skipped |
| #11, #12 | 2026-11-19 00:00:53 | done, skipped |
| #22, #23 | 2026-11-20 00:00:53 | done, done |
| #35, #36 | 2026-11-21 00:00:55 | done, done |
| #39, #40 | 2026-11-22 00:02:19 | done, done |
| #45, #46 | 2026-11-23 00:03:40 | done, done |
| #48, #49 | 2026-11-24 00:02:27 | **queued** (still queued at read time — next drain) |

Payloads: #45/#48 = `{"division":"digital-tools"}`, #46/#49 =
`{"division":"education-learning"}` — the two thinnest divisions (1 published each)
every day.

### R1.3 What the tasks actually did (agent_runs, agent = research)

- **24 Nov, id 196 (task #45, digital-tools):** `no-op` —
  `"No new candidate topics found (all fetched items already exist as articles or are outdated)."`,
  `sourcesChecked: 3, itemsStored: 0, fetchErrors: []`.
- **24 Nov, id 197 (task #46, education-learning):** `done` — **13 candidates**,
  13 items stored (EdSurge / Inside Higher Ed / Higher Ed Dive, 23 Nov items, e.g.
  `"If Representation Matters, Then Authenticity Does Too"`,
  `"Arizona Universities Push Rush to Spring Semester"`).
- **23 Nov, ids 176/178/179 (tasks #36/#39/#40):** all `no-op`, same reason, 0 stored.
- **22 Nov, ids 140–149:** 9 research runs, **all `no-op`**, plus 1 content-creation
  run (task #24, `done`). The 22 Nov drain processed a 10-task backlog.

### R1.4 The audit trail proves the fetches happened (rss_fetch_audit)

All rows since 18 Nov: **73 rows, all `status = 'completed'`, 0 failed / partial /
skipped-overlap.** 24 Nov 00:00–00:08 UTC, 12 rows:

| Execution | Time (UTC) | Sources | Inserted | Duplicates |
|---|---|---|---|---|
| `c5ebdd99…` (drain, task #45) | 00:01:03–07 | 16, 17, 18 (digital-tools) | 0 | 100 |
| `eeeff214…` (drain, task #46) | 00:01:11–17 | 22, 23, 24 (education) | **13** | 57 |
| `f84cad55…` (inline researchFetch) | 00:02:30–33 | 16, 17, 18 (digital-tools) | 0 | 100 |
| `03046a64…` (inline researchFetch) | 00:02:35–38 | 22, 23, 24 (education) | 0 | 70 |

The inline step re-fetched the **same 6 feeds ~90 seconds after the drain** and stored
0 — pure duplicates. 23 Nov: 15 fetches (5 executions × 3), 0 inserted. 22 Nov:
33 fetches (11 executions × 3), 0 inserted.

### R1.5 The mechanism (code)

1. `topicSelection` enqueues 2 `daily-research` tasks for the 2 thinnest divisions
   (`scheduler.js:1366–1367`).
2. Next day, `drainTaskQueue` runs **first** (`scheduler.js:983`, called at
   `scheduler.js:1329`) and executes those tasks — fetching 2 divisions × 3 feeds and
   storing new items (`backend/agents/autonomy/research.js:96–123`,
   `fetchAllEnabledSources` → `fetchFeed`, 1 fetch per feed,
   `backend/rss/rss.js:120`).
3. The inline `researchFetch` step then calls `runResearch` **directly for the same
   2 thinnest divisions** (`scheduler.js:1374–1391`: `counts.slice(0, 2)`), re-fetching
   the same feeds.
4. Dedupe drops everything the drain just stored (`backend/rss/sources.js:167–172`:
   vs article titles/slugs AND stored item titles/URLs) → `fetched = 0, added = 0`.
5. The daily counts come **only** from the inline step (`scheduler.js:1614–1615`):
   `researchFetched: steps.researchFetch.result?.fetched ?? 0`,
   `researchItemsStored: steps.researchFetch.result?.added ?? 0`. The drain's stored
   items are never counted.

Why 21 Nov worked: the 21 Nov daily report's step list has **no `queueDrain` step**
(drain started with W1 on 22 Nov), so the inline step was the day's only fetch and
stored 14. The "stall" began exactly when the drain started running first (22 Nov).

### R1.6 Source list — healthy, no blocks

All 24 `research_sources` rows: `is_active = 1`, `last_status = 'ok'`,
`last_error = NULL`. Last-fetched: divisions 6 (digital-tools, sources 16–18) and 8
(education, sources 22–24) on **24 Nov 00:02:32–40**; source 14 (Guardian Travel) on
22 Nov 04:51:50; all others on 19 Nov (bulk seed). No source has ever failed in the
window — so **not** a source-list, URL-status, robots, rate-limit, timeout
(`RSS_FETCH_TIMEOUT_MS = 5000`, `backend/rss/rss.js:10`), or 50-subrequest cause.
`research_items` by fetched day: 19 Nov **693** (seed), 20 Nov 3, 21 Nov 14, 22 Nov 4,
23 Nov 0, 24 Nov **13**.

### R1.7 The evidence-depth defect (links R1 → R2)

`parseFeedXml` truncates every item summary to 500 chars
(`backend/rss/rss.js:80` RSS, `:84` Atom:
`stripTags(firstTag(body, ['description', 'content:encoded'])).slice(0, 500)`), and
that summary **is** the stored evidence (`backend/rss/sources.js:176–177`:
`const evidence = item.summary || item.title;` inserted as `evidence_text`).
Measured since 18 Nov: RSS items — 726 rows, **max evidence 500 chars, avg 200.5**;
article-fetch items — **1 row** (research item 714, the #33 source, 3,985 chars,
`extraction_status = 'ok'`). Full-text evidence exists only via the `article-fetch`
research kind (`backend/agents/autonomy/research.js:20–24`,
`backend/services/article-fetch.js`), which the daily flow almost never runs.

The **Guardian API key** does not affect the RSS stall: Guardian Travel RSS works
(source 14, `ok`). The key gates only *full-text* Guardian fetches —
`backend/services/article-fetch.js:21–28`: robots.txt is obeyed; if a site's
robots.txt states AI use is prohibited the fetch is refused
(`terms-prohibit-ai-use`) and recorded; "The Guardian states exactly [that]" and
"The licensed route for Guardian content is the Guardian Open Platform API key".
That is why #29/#30 (Guardian-sourced) can only ever be checked against a 500-char
snippet until the key exists.

### R1.8 Phase 2 can fix vs needs the owner

- **Phase 2 can fix (code):** the double-fetch — either skip the inline re-fetch of
  divisions the drain just fetched, or count the drain's stored items in
  `researchFetched`/`researchItemsStored` (the counts currently lie by omission).
  Also: route the daily flow through `article-fetch` for the chosen topic's source
  URL so the fact-checker gets full text, not a 500-char snippet (the service
  already exists; it is just not wired into the daily path).
- **Needs the owner:** Guardian Open Platform API key (free registration) — the only
  licensed route to full Guardian article text; and a decision on whether
  RSS-snippet evidence is acceptable for fact-checking at all (today it caps every
  claim check at ≤500 chars — see R2).
- **Not a bug:** no source, URL, robots, rate-limit, timeout, or subrequest cause
  was found. Do not "fix" the fetch engine; fix the double-fetch and the counting.

---

## R2. GATE BOTTLENECK — verdict: 0 of 7 drafts auto-publishable; thin evidence is the binding constraint

### R2.1 How the gate is actually evaluated (read this first — it explains the missing rows)

Two evaluators exist in `backend/publishing/gate.js`:

- `evaluatePublishGate()` (contentReady, 10 checks) — used by the daily
  `publishGate` step (`scheduler.js:1516–1532`), which evaluates **every** draft
  (24 Nov: `gateEvaluated: 9`) but writes **no** `publication_logs` rows.
- `evaluateAutoPublishEligibilityPure()` (14 checks, strictly harder: legacy/timestamp
  guard, fresh SEO 11/11, duplicate overlap **exactly 0%**, every internal link
  genuinely relevant, Health/Finance never auto-eligible, banner gone) — used only
  by `runAutoPublish()` (`scheduler.js:1546–1550`), which "tries NEW candidate drafts
  only (created after the owner-set cutoff, never legacy #28/#29/#30/#31, never
  protected)". That is why `publication_logs` has only **3 rows** (#34 ×2, #35 ×1):
  #28–#31 and #33 are never evaluated by the auto-publish path, so their verdicts
  below are **DERIVED** by applying the gate code to live D1 rows (labelled as such);
  #34/#35 verdicts are **LOGGED** (quoted from `publication_logs` rows 2 and 3).

Legacy guard: `LEGACY_AUTO_PUBLISH_REFUSED_IDS = [28, 29, 30, 31]` (`gate.js:47`);
cutoff setting `auto_publish_eligible_since = 2026-11-22T04:55:28Z` (live
`autonomy_settings`). Division minimum sources: 1 everywhere except Finance/Health
(2) — `backend/publishing/divisions.js:39–132`. All 7 drafts are in minSources-1
divisions (ai-technology, travel-lifestyle, education-learning).

"Evidence chars" below = `LENGTH(research_items.evidence_text)` for the
`article_sources.research_item_id` linked to each draft — i.e. the stored evidence
the fact-checker actually verified claims against. All latest fact-checks and SEO
checks are **fresh**: each row's `body_hash` equals the article's current body hash
(verified per draft; e.g. #28 fc 38 `4556f840…` = current body).

### R2.2 Master table

| Draft | Division | Fact-check (latest) | SEO failing checks | Duplicate (SEO suite) | Evidence chars | Gate: contentReady / auto-eligible (of 14) | Blocked by |
|---|---|---|---|---|---|---|---|
| #28 | ai-technology | needs-review **6/7** (fc 38, 23 Nov) | internal-links, readability | 2% vs draft #30 (ok) | **357** (item 154, RSS) | NO / NO — **7/14** | legacy id; fc; 1 failed claim; readability (avg word 6.7); links #14 irrelevant |
| #29 | travel-lifestyle | **failed 0/0** (fc 39, 24 Nov) | readability, duplicate | **32% vs draft #30 (FAIL)** | **0 — no research_item** (source type `other`, `research_item_id` NULL) | NO / NO — **9/14** | legacy id; fc failed; readability (avg sentence 39.5w); duplicate 32% |
| #30 | travel-lifestyle | needs-review **7/19** (fc 35, 22 Nov) | — (PASS 11/11, seo 27) | 6% vs draft #35 (ok) | **500** (item 382, RSS) | NO / NO — **9/14** | legacy id; fc; 12 failed claims; 3 open corrections (B6); duplicate 6% ≠ 0% |
| #31 | education-learning | **PASS 3/3** (fc 25, 21 Nov) | internal-links only | 0% vs draft #29 (ok) | **307** (item 675, RSS) | NO / NO — **11/14** | legacy id; SEO; internal-links (no relevant published sibling) |
| #33 | education-learning | **PASS 15/15** (fc 34, 22 Nov) | internal-links only | 6% vs draft #34 (ok) | **3,985** (item 714, article-fetch, extraction `ok`) | NO / NO — **10/14** | timestamp (created 22 Nov 00:02:10 < cutoff 04:55:28); SEO; duplicate 6%; internal-links (no relevant published sibling) |
| #34 | education-learning | needs-review **4/14** (fc 40, 24 Nov) | internal-links only | 6% vs draft #33 (ok per SEO; FAIL per auto rule) | **372** (item 709, RSS) | NO / NO — **9/14, LOGGED row 2** | fc; 10 failed claims; SEO; duplicate 6% ≠ 0%; internal-links |
| #35 | travel-lifestyle | needs-review **6/18** (fc 41, 24 Nov) | **no SEO row at all** | unknown (no SEO row) | **500** (item 711, RSS) | NO / NO — **7/14, LOGGED row 3** | fc; 12 failed claims; no SEO on record; preconditions (no structured-metadata) |

Common to all 7 (passing, verified): Emergency Stop OFF, daily limit 0/1 (Dhaka day),
publishing rules (`publishing_mode = 'auto'`, `auto_publishing = 'on'`), special-review
(none is a Health/Finance division). Sources: exactly **1 source with a URL each**
(`article_sources`), meeting the division minimum of 1 in every case.

### R2.3 Per-draft gate detail (14-check auto-publish verdict)

- **#28 (7/14, DERIVED).** Fail: not-legacy-draft (id in list); fact-check-current
  (needs-review 6/7); no-unresolved-errors (1 failed — the UNSUPPORTED claim
  *"The Sila–Panasonic agreement represents more than just a commercial contract…"*,
  fc 38); seo-fresh-pass (needs-review); duplicate-zero-overlap (2% ≠ 0%);
  readability-pass (avg word 6.7 chars); internal-links-relevant (body links #14
  *"7 Free AI Tools That Actually Save Time"* — same division ai-technology but no
  topical keyword overlap, per `isInternalLinkRelevant`,
  `divisions.js:204–212`). Pass: sources-verified (1 URL; all 6 VERIFIED claims cite
  URLs); correction-recheck — raw open-correction count is 1, but the B6 rule
  (`gate.js:175–224`, `countOpenCorrections`) counts it as **0**: the single failed
  correction (id 10) is a citation-line claim that does not appear in the fresh fc 38
  at all; publication-preconditions (banner is leading, position 1 — strippable;
  structured-metadata ok in seo 23; inferred, see §R2.6).
- **#29 (9/14, DERIVED).** Fail: not-legacy-draft; fact-check-current (verdict
  `failed`); seo-fresh-pass; duplicate-zero-overlap (32%); readability-pass (avg
  sentence 39.5 words). Pass: no-unresolved-errors (0 failed claims — fc 39 has **0
  claim rows at all**, i.e. the checker found nothing verifiable in a 601-char body);
  sources-verified (1 Guardian URL recorded, though no stored evidence);
  correction-recheck (0); internal-links-relevant (body links #19 *"Travel on a
  Budget…"*, same division, shared topical keyword "travel" → relevant);
  preconditions (no banner in body; structured-metadata ok in seo 25).
- **#30 (9/14, DERIVED).** Fail: not-legacy-draft; fact-check-current (needs-review
  7/19); no-unresolved-errors (12 failed); correction-recheck — raw open count is 6,
  B6-adjusted count is **3** (corrections ids 24, 29, 31 match fc 35 claims judged
  UNSUPPORTED; ids 27 and 30 match no claim in fc 35; id 28's key differs from fc 35's
  OUTDATED claim — `"recent feature"` vs `"feature"` + `"…"` — so it does not count;
  identity is `claimKey()` = lower-cased, whitespace-collapsed, 200-char truncated,
  `factcheck.js:131–136`); duplicate-zero-overlap (6% ≠ 0%). Pass: sources-verified
  (1 URL; all 7 VERIFIED claims cite URLs — the 5 NULL-evidence rows in fc 35 are all
  UNSUPPORTED, not VERIFIED); seo-fresh-pass (PASS 11/11, seo 27); readability;
  internal-links-relevant (links #19, relevant via "travel"); preconditions (banner
  leading, position 1; structured-metadata ok).
- **#31 (11/14, DERIVED — closest to publishable).** Fail: not-legacy-draft;
  seo-fresh-pass (needs-review); internal-links-relevant (SEO internal-links fails).
  Pass: everything else, including fact-check-current (PASS 3/3, fresh) and
  duplicate-zero-overlap (0%). The body (549 chars, read verbatim) links **no**
  article at all — only the external Inside Higher Ed URL. The SEO detail is exact:
  *"No genuinely relevant published article exists in this division to link to — no
  link will be faked to satisfy this check."* The only published education article is
  #22 *"How to Learn a New Digital Skill in 30 Days"* (topically unrelated).
- **#33 (10/14, DERIVED).** Fail: not-legacy-draft — **timestamp only**
  (`created_at 2026-11-22T00:02:10.367Z` < cutoff `2026-11-22T04:55:28Z`);
  seo-fresh-pass; duplicate-zero-overlap (6%); internal-links-relevant (same no-sibling
  failure as #31). Pass: fact-check-current (**PASS 15/15**, all claims VERIFIED with
  evidence URLs, fc 34); no-unresolved-errors (0 failed); sources-verified;
  correction-recheck — raw open count is 4, B6-adjusted count is **0**: all 4 failed
  correction rows (ids 39, 44, 46, 50) match claims fc 34 judged VERIFIED on full
  evidence (this is the exact B6 case documented in `gate.js:175–190`; an earlier
  reading that the gate "still counts 4 stale rows" is **wrong under B6**);
  readability; preconditions (banner leading, position 1; structured-metadata ok).
- **#34 (9/14, LOGGED — publication_logs row 2, 2026-11-24 00:06:55).** See §R2.4.
- **#35 (7/14, LOGGED — publication_logs row 3, 2026-11-24 00:07:00).** Fail:
  fact-check-current (needs-review 6/18); no-unresolved-errors (12 failed);
  seo-fresh-pass / duplicate / readability / internal-links — all "No SEO check on
  record" (no `seo_checks` row exists for #35; the 24 Nov seoRun checked only 3
  articles and #35 was not among them); publication-preconditions ("Structured-metadata
  check missing from the latest SEO run"). Pass: not-legacy-draft (created after
  cutoff); sources-verified; correction-recheck (0); special-review; E-Stop;
  daily-limit; publishing-rules. Note the body has **no** internal link
  (`has_article_link = 0`) and a leading banner (position 1).

### R2.4 Why auto-publish refused #34 (the only eligible draft, twice)

- **Row 1 — 2026-11-23 00:04:24.** #34 was created 00:03:27Z, 57 seconds before the
  publishGate step ran; no fact-check and no SEO check existed yet. 7 failures, all
  "No … on record", e.g. `"No fact-check on record for this article."` and
  `"Structured-metadata check missing from the latest SEO run."` (preconditions).
  Timing, not content.
- **Row 2 — 2026-11-24 00:06:55** (full verdict quoted in substance; 9/14 pass).
  `blockedBy` (verbatim):
  1. `"Latest fact-check verdict: needs-review — auto-publish needs a PASS."`
     (fc 40: 4/14 verified)
  2. `"10 claim(s) still failed in the latest fact-check."`
  3. `"Latest SEO verdict: needs-review — auto-publish needs a PASS."`
     (seo 28: 10/11, only internal-links failing)
  4. `"Highest 5-word shingle overlap with another published article: 6% —
     auto-publish needs exactly 0%."`
  5. `"SEO internal-links check does not pass."`
  Passing in row 2: not-legacy-draft, sources-verified (1 source, division minimum 1),
  correction-recheck ("No open corrections."), readability-pass, special-review,
  emergency-stop-off, daily-limit (0/1), publishing-rules, publication-preconditions
  ("Status is publishable, no banner survives, structured metadata present.").
  Even if the duplicate and internal-links blockers were fixed, the fact-check
  (4/14) still blocks #34. Its duplicate comparator is draft #33 (see §R2.5).

### R2.5 Classification of every blocker

- **Content genuinely weak:** #29 (601-char body; fc failed with 0 claim rows;
  32% overlap with #30 — the two Guardian travel guides share boilerplate);
  #30 (12 failed claims, mostly UNSUPPORTED/CONFLICTING); #34 (10 failed);
  #35 (12 failed). #28's single failed claim is an interpretive
  ("turning point for the U.S. battery market") sentence the snippet cannot support.
- **Missing-or-outdated evidence (the systemic cause):** 6 of 7 drafts were checked
  against ≤500 chars of RSS summary (R1.7). The pattern is exact: the only draft
  with full-text evidence (#33, 3,985 chars) passed 15/15; every draft checked
  against a 300–500-char snippet has failed claims. #29 is the extreme: **no stored
  evidence at all** (no `research_item`; fc 39 has 0 claim rows). The Guardian key
  (owner, free registration) is the only licensed route to full Guardian text.
- **Bug in a check (fail-closed, cosmetic but real):** the duplicate-zero-overlap
  detail says *"overlap with another **published** article"* while the SEO detail it
  parses says *"with another article: 6% (… **draft** article #33)"* — **all five**
  non-zero overlaps are vs other **drafts** (#28 2% vs #30; #29 32% vs #30; #30 6% vs
  #35; #33 6% vs #34; #34 6% vs #33), none vs a published article. The gate still
  refuses (fail-closed — safe), but the reason text misstates the comparator, and the
  evaluator's comment (`gate.js:665–668`, "vs published articles") disagrees with the
  SEO suite, which compares against all articles including drafts. Also stale
  documentation: `divisions.js:199–203` cites *"live #31 -> #22"* as an unrelated
  same-division link, but #31's current body links no article (verified verbatim) —
  the comment predates a rewrite; not a gate bug.
- **Gate correct but cannot be satisfied (yet):** #31/#33/#34 internal-links — no
  genuinely relevant *published* sibling exists in education-learning (only #22,
  unrelated). This cannot be satisfied until a relevant education article is
  published first. #28's internal-links is different and fixable: it links #14
  (same division, no topical overlap) — remove/replace the link.
- **Owner decision, not a bug:** #28–#31 refused by id (`gate.js:47`); #33 refused
  by pre-cutoff timestamp only. These need separate per-article owner authorization
  each (Fix Pass 4 hard rules); no code change can or should bypass them.

### R2.6 What Phase 2 can fix vs needs the owner

- **Phase 2 can fix (code, no draft edits):** the duplicate-overlap wording
  (report the actual comparator; decide whether the auto rule should compare only
  vs published articles); the evidence pipeline for *future* articles (wire
  `article-fetch` into the daily path — R1.8); the stale `#31 -> #22` comment.
- **Phase 2 CANNOT fix by editing drafts:** #28–#31 and #33 are protected from
  editing without separate owner authorization each, and #34/#35 are READ-ONLY under
  the Fix Pass 4 brief. Content repairs (rewriting unsupported claims, fixing
  readability, removing the #28→#14 link) all need the owner's per-article go-ahead.
  **Do not loosen any gate** (no waivers, no threshold changes) to unblock these.
- **Needs the owner:** per-article publish/dispose decisions (#29 DISCARD vs rewrite
  is still open from the owner pack; #31 PUBLISH, #30 HOLD, #33 HOLD-then-publish,
  #28 HOLD per prior owner direction); Guardian Open Platform API key (free
  registration) to unblock Guardian full-text evidence for #29/#30-class articles;
  a decision on the education internal-links deadlock (publish a relevant sibling
  first, or accept the block).
- **Unverified in R2:** #28/#30/#33 `publication-preconditions` = PASS is *inferred*
  (banner is leading at position 1 and strips like #34's, whose live row 2 passed
  preconditions; structured-metadata ok in each SEO row) — not directly observed in
  a gate row, because `runAutoPublish` never evaluates legacy/protected drafts.
  The DERIVED verdicts for #28–#31/#33 are computations from live D1 + `gate.js`,
  not logged rows.

---

## R3. HEALTH REPORT BUDGET — verdict: the report runs last and hits a wall it cannot see; the 50 is NOT fully accounted for

### R3.1 The limit and the invocation

Cloudflare Workers default: **50 subrequests per Worker invocation**.
`config/wrangler.toml` contains **no `[limits]` section** (grep: no match), so the
default 50 applies. The daily run is a **single invocation**: the scheduled handler
calls `runDailyWorkflow` in-process (`backend/worker.js:243`,
`const daily = await runDailyWorkflow(env);`, via `src/index.js:36–45`). Every
`fetch()` in the drain, every step, and the health report shares one 50-budget.

Step order in `runDailyWorkflow` (`backend/routes/scheduler.js:1300+`): (0) queueDrain
`:1329` → topicSelection `:1343` → researchFetch `:1374` → contentFromResearch →
factCheckQueue → factCheckRun → correctionRun → seoRun → seoPass → publishGate
`:1516` → publishDue → autoPublish → socialPrep → analyticsSnapshot → errorScan →
**(15) healthReport `:1592`** — near-last, after all the fetching steps.

### R3.2 24 Nov fetch accounting (audit-proven)

| Step | Fetches (proven) | Evidence |
|---|---|---|
| Queue drain — 2 research tasks | **6 RSS** | `rss_fetch_audit` execs `c5ebdd99…` (sources 16–18, 00:01:03–07) + `eeeff214…` (sources 22–24, 00:01:11–17); 13 items inserted |
| Inline researchFetch | **6 RSS** | execs `f84cad55…` (00:02:30–33) + `03046a64…` (00:02:35–38); 0 inserted |
| seoRun — broken-links HEADs | **4–6** | `backend/agents/autonomy/seo.js:300–327`: one HEAD per external link, retry once with a browser UA on 406/403/429. 24 Nov links: #30 ×2 (Guardian — 406 → retry, so up to 4), #33 ×1, #34 ×1 (Higher Ed Dive). No SEO fetch audit exists, so this is a range, not an exact count |
| Health report | **8** | `backend/services/daily-health-report.js:768–780` check order: pages 1 (`:223`, `${PAGES_BASE}/`), sitemap 1 (`:247`, `/sitemap.xml`), recentArticles 0 (24 Nov detail `published: []`), sitemapRefresh 1 (GitHub API, `:345`), serverSideHeads 5 (`:693`). `PAGES_BASE = 'https://fs-ai-5w5.pages.dev'` (`:71`) |
| Everything else | **0** | Drain content task #47, factCheckRun (Workers AI is an `env.AI` **binding**, not a fetch), D1 calls, topicSelection, publishGate, publishDue, socialPrep — grep finds **no** `fetch(` in `backend/agents/autonomy/*.js`; the only `fetch(` sites in `backend/` are the RSS fetcher, the health-report helper, and the Groq/Gemini LLM providers (`groq.js:41`, `gemini.js:48`), which are not configured (`llm_provider_order = 'workers-ai'`) |
| **Proven total** | **24–26** | |

### R3.3 Why sitemap and serverSideHeads fail

The 24 Nov health report (`daily_reports` id 15, generated 00:07:03.080Z, overall
`FAIL`) shows `pages: OK (200)` and then:

- `sitemap: FAIL` — `"Too many subrequests by single Worker invocation. To configure
  this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits"`
  (`urlCount: 0, publishedCount: 0`).
- `serverSideHeads: FAIL` — checked 5, passed 0; all five failures are the same
  error (`/pages/article?id=1`, `?id=12`, `?id=25`,
  `/pages/division?division=automotive`, `/pages/tools?tool=percentage`).
- `sitemapRefresh: NOT TESTED` — `"GitHub API fetch failed: Too many subrequests…"`.

The pages fetch (the report's *first* fetch) succeeds; the sitemap fetch (its
*second*) hits the wall — so the budget was already exhausted **before** the report's
second fetch. These are **budget-exhaustion failures, not real breakage**: the sitemap
(60 URLs) and the server-side heads were proven live by the parent's own curl checks
on 23 Nov (Fix Pass 3 ledger A6). The health report simply cannot verify them from
inside the same invocation.

### R3.4 The residual ~24 subrequests — UNVERIFIED (stated plainly)

Proven fetches total 24–26; the limit is 50. **~24–26 subrequests are unaccounted
for by any D1 audit.** No subrequest counter is stored anywhere, so the split cannot
be proven from live data. Ranked candidates, in order:

1. **Redirect hops (most likely).** Every `fetch()` with `redirect: 'follow'`
   (the default; `fetchFeed` in `backend/rss/rss.js` sets no redirect option, and
   `seo.js:305` sets it explicitly) counts **each hop** as a subrequest. RSS feeds
   commonly 301 (www/non-www, path moves, feedburner); 12 RSS fetches can easily be
   12–24 subrequests total. The 6 Pages fetches and the GitHub API fetch can hop too.
2. **SEO HEAD retries** (+0–2, inside the 4–6 range above).
3. Nothing else in the invocation fetches (proven by the grep in §R3.2).

Phase 2 must instrument this (a per-invocation subrequest counter, or move the
health report to its own invocation) before claiming the budget is understood. Do
not present 24–26 as "the" total — it is the audit-proven floor.

### R3.5 Corrected 22/23 Nov accounting (an earlier misattribution fixed)

- **22 Nov:** drain processed **10 tasks** (`agent_runs` 140–149: 9 research, all
  `no-op`, + 1 content-creation `done`) = **27 RSS** (9 executions × 3 feeds) +
  inline researchFetch 6 = **33 RSS total** (11 executions, 0 inserted) + SEO HEADs
  ~5. The 22 Nov daily report has **no health-report section** (the health-report
  step shipped in Fix Pass 3 A6; first run 24 Nov), so there was no 22 Nov
  health-report failure to explain. The 22 Nov `queueHealthOverall: degraded` is the
  drain's health-check verdict, not a subrequest failure.
- **23 Nov:** drain processed **4 tasks** (`agent_runs` 176–179: research #36/#39/#40
  `no-op` + content #37 `done`) = **15 RSS total** (5 executions × 3, 0 inserted:
  drain 9 + inline 6) + SEO HEADs ~5. Also no health-report section on 23 Nov.
  An earlier note attributing "drain 10 tasks = 27 RSS" to 23 Nov was wrong — those
  are the 22 Nov numbers.

### R3.6 Why `oldestQueuedAt` is 2026-11-23T00:03:40Z — correct snapshot, not a bug

The computation is in `backend/services/healthcheck.js:151–177` (`queueCheck`):
`SELECT status, updated_at, created_at FROM agent_tasks WHERE status IN
('queued', 'running')`, and `oldestQueuedAt` is the minimum `created_at` among
queued tasks (line 167). The logic is correct; the **value is a pre-drain snapshot**:

- `drainTaskQueue` calls `runHealthCheck(env)` **first**, before executing any task
  (`backend/routes/scheduler.js:992`).
- `agent_runs` id 199 (scheduler, queue-drain record) shows
  `health.checkedAt = 2026-11-24T00:00:55.616Z`, `processed: 3, done: 3,
  healthOverall: healthy`. At 00:00:55 the queue still held tasks #45/#46/#47
  (created 23 Nov 00:03:40–50, all `done` now); oldest = **#45, created
  2026-11-23T00:03:40.792Z**.
- The health-report step **reuses that object** instead of re-checking:
  `scheduler.js:1584–1600` ("The report reuses the runHealthCheck result the queue
  drain already computed… it never calls runHealthCheck again") and
  `daily-health-report.js:200` (`queueCheck(health)` takes the passed-in health),
  `:730–743` ("never re-fetched here"). Build order is `daily-health-report.js:768–780`.
- The live queue read later showed the **post-drain** queue (#48/#49/#50, oldest
  **2026-11-24T00:02:27.912Z**) — tasks created *after* the drain ran. Both values
  are right for their moment; the report's value is stale-by-design.

### R3.7 Phase 2 can fix vs needs the owner

- **Phase 2 can fix (code):** the structural defect — move the health report to its
  own invocation (separate cron/trigger) or cut the redundant fetches first (the
  R1 double-fetch alone wastes 6 RSS fetches + their redirect hops every day);
  add a per-invocation subrequest counter so the next READ can account for all 50;
  label the report's queue snapshot with its `checkedAt` (or re-compute queue state
  at report time). All $0 — raising the limit via a paid plan is **not** needed and
  would violate the $0 rule.
- **Needs the owner:** nothing for R3, unless he prefers a different fix shape
  (e.g. dropping the serverSideHeads check entirely instead of moving the report).
- **Unverified in R3:** the exact subrequest split for the residual ~24 (redirect
  hops are unaudited); the exact SEO HEAD count on 24 Nov (4–6 range).

---

## R4. CSP — verdict: all 16 rows are the site's own GA4 beacons; single root cause

### R4.1 The table

Schema note: `csp_reports` has **no `created_at` column** — the timestamp column is
`reported_at` (`id, directive, blocked_uri, document_uri, reported_at`). All 16 rows
are `directive = 'connect-src'` and `blocked_uri` starts with the identical prefix
`https://www.google.com/g/collect?v=2&tid=G-JVSCJT2DHJ` (GA4 Measurement ID
`G-JVSCJT2DHJ`); the remainder of each URL is per-event GA4 parameters
(`en=page_view` / `en=scroll&epn.percent_scrolled=90`, `dl=` document location,
`dt=` title, `cid/sid`, device `uam=moto g54 5G&uap=Android&uapv=15.0.0`). Full URLs
are ~700 chars each and differ only in those parameters; two are quoted verbatim
below. **Id 1 is absent** (rows are ids 2–17) — reason unknown, not investigated
further; do not invent one.

| id | reported_at (UTC) | document_uri | Event |
|---|---|---|---|
| 2 | 2026-11-23 06:38:48 | `https://fs-ai-5w5.pages.dev/pages/article?id=9` | page_view |
| 3 | 2026-11-23 06:39:01 | `https://fs-ai-5w5.pages.dev/pages/article?id=9` | page_view |
| 4 | 2026-11-23 06:39:06 | `https://fs-ai-5w5.pages.dev/pages/article?id=9` | scroll 90% |
| 5 | 2026-11-23 10:13:50 | `https://fs-ai-5w5.pages.dev/pages/article?id=14` | page_view |
| 6 | 2026-11-23 10:13:55 | `https://fs-ai-5w5.pages.dev/pages/article?id=14` | scroll 90% |
| 7 | 2026-11-23 10:14:31 | `https://fs-ai-5w5.pages.dev/pages/article?id=14` | page_view |
| 8 | 2026-11-23 10:14:36 | `https://fs-ai-5w5.pages.dev/pages/article?id=14` | scroll 90% |
| 9 | 2026-11-23 11:37:22 | `https://fs-ai-5w5.pages.dev/?utm_source=ig&utm_medium=social&utm_content=link_in_bio&fbclid=PAZXh0…` (Instagram link-in-bio, Android WebView) | page_view |
| 10 | 2026-11-23 12:59:31 | `https://fs-ai-5w5.pages.dev/` | page_view |
| 11 | 2026-11-23 18:06:25 | `https://fs-ai-5w5.pages.dev/` | page_view |
| 12 | 2026-11-23 18:06:29 | `https://fs-ai-5w5.pages.dev/pages/division?division=ai-technology` | page_view |
| 13 | 2026-11-23 18:06:34 | `https://fs-ai-5w5.pages.dev/pages/division?division=ai-technology` | scroll 90% |
| 14 | 2026-11-23 18:08:16 | `https://fs-ai-5w5.pages.dev/pages/division?division=ai-technology` | page_view |
| 15 | 2026-11-23 18:08:22 | `https://fs-ai-5w5.pages.dev/pages/division?division=ai-technology` | scroll 90% |
| 16 | 2026-11-23 18:09:25 | `https://fs-ai-5w5.pages.dev/` | page_view |
| 17 | 2026-11-23 18:09:30 | `https://fs-ai-5w5.pages.dev/` | scroll 90% |

Verbatim examples (truncated at 200 chars for legibility; the `tid` and `/g/collect`
prefix are exact):

- id 2: `https://www.google.com/g/collect?v=2&tid=G-JVSCJT2DHJ&gtm=45je6bh1h1v9286430063za208zd9286430063xf1&_p=1795415926513&…&dl=https%3A%2F%2Ffs-ai-5w5.pages.dev%2Fpages%2Farticle%3Fid%3D9&dt=How%20to%20Diagnose%20Common%20Engine%20Noises%20%E2%80%94%20FS%20AI&en=page_view…`
- id 9: `https://www.google.com/g/collect?v=2&tid=G-JVSCJT2DHJ&gtm=45je6bh1v9286430063za208zd9286430063xf1&…&dl=https%3A%2F%2Ffs-ai-5w5.pages.dev%2F%3Futm_source%3Dig%26utm_medium%3Dsocial%26utm_content%3Dlink_in_bio&dr=https%3A%2F%2Fl.instagram.com%2F&dt=FS%20AI%20%E2%80%94%20One%20Platform.%20Multiple%20Possibilities.&en=page_view…`

### R4.2 Reading

- **Count growth 9 → 16, all on 23 Nov:** ids 2–10 (9 rows) by 12:59 UTC; ids 11–17
  (7 rows) 18:06–18:09 UTC. No rows on 24 Nov at read time. The 24 Nov health
  report's `cspViolations` check confirms the same total: `"16 CSP violation
  report(s) in the last 7 days"`, `byDirective: [{directive: 'connect-src', count: 16}]`.
- **Single root cause:** the site's own GA4 (`G-JVSCJT2DHJ`) is not allow-listed in
  the CSP `connect-src` directive, so every GA4 beacon is reported. No other
  directive, host, or blocked URL appears in any row.
- **Impact: none on visitors.** CSP is **Report-Only** (24 Nov health report detail:
  `"CSP is Report-Only, so nothing broke; the reports need review."`). The only
  cost is lost analytics: the blocked beacons never reach Google, so GA4 undercounts
  these page views / scrolls (real sessions: Moto G54 5G, Android 15, Chrome 158;
  id 9 arrived via the Instagram link-in-bio).
- **Confirmed: every one of the 16 is the GA4 beacon to
  `https://www.google.com/g/collect`.** No exceptions.

### R4.3 Phase 2 can fix vs needs the owner

- **Phase 2 can fix (config):** add `https://www.google.com/g/collect` (and
  `https://www.googletagmanager.com` if the tag loader needs it — verify from the
  live CSP header first) to `connect-src`, or move GA4 to a same-origin proxy. $0.
- **Needs the owner:** only if he would rather remove GA4 than allow-list it
  (GA4 is his connected analytics — Measurement ID `G-JVSCJT2DHJ` — so allow-listing
  is the expected call; removing it is his decision, not Phase 2's).
- **Unverified in R4:** why `csp_reports` id 1 is missing; the exact live CSP header
  text (not read in this READ — Phase 2 should read it before editing).

---

## What Phase 2 must not do (carried from the Fix Pass 4 brief)

- Do not publish/edit/delete/touch #26–#31 and #33; #34/#35 READ-ONLY.
- No auto-publish / Emergency Stop / schedule / cron changes; `social_auto_post` stays OFF.
- No OAuth, uploads, or real publishing to test; $0 only; no secrets in code/logs/reports.
- Do not loosen/weaken any quality, fact-check, SEO, duplication, or publish gate.
  In particular: do not "fix" the bottleneck by waiving internal-links or lowering
  the duplicate bar to 6% — the 0% rule and the relevance rule are safety properties
  (`gate.js:52–56`, `NEVER_WAIVABLE_SEO_CHECKS`).
- Health/Finance keep human review. Live D1 is read-only — a fix needing a live
  write is a STOP for that item, with the exact statement listed for the owner.
- Fresh source + D1 backups + test baseline before any code change; one item at a
  time (change → tests with negative control → deploy → raw live verification →
  next); roll back on live-check failure; existing URLs must stay 200 with same content.

## Items this READ could not verify

1. The exact subrequest split for the residual ~24 of the 50-budget (R3.4) —
   redirect hops are unaudited; the proven floor is 24–26.
2. The exact SEO HEAD count on 24 Nov (4–6 range; no SEO fetch audit).
3. `publication-preconditions` = PASS for #28/#30/#33 is inferred from #34's live
   pass + identical banner pattern, not directly observed.
4. Auto-publish verdicts for #28–#31/#33 are derived computations (live D1 +
   `gate.js`), not logged rows — `runAutoPublish` never evaluates legacy/protected
   drafts, by design.
5. Why `csp_reports` id 1 is missing; the exact live CSP header text.
6. The 22 Nov 04:51:50 Guardian Travel fetch (source 14) sits outside the daily-run
   window; its trigger was not traced.
7. No 18 Nov daily report exists to complete a 7-day daily series (6 daily rows cover
   19–24 Nov).

*— End of Fix Pass 4 Phase 1 READ findings. Written 2026-11-24. READ-ONLY; no source
changes, no live D1 writes, no deploy, no publish.*
