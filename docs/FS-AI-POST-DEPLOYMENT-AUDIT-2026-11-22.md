# FS AI — Post-Deployment Live Audit & Remaining Work

**Date:** 2026-11-22 (audit run ~11:30–12:15 Dhaka)
**Auditor:** post-deployment audit coordinator (subagent, depth 1)
**Scope:** the owner's brief of 2026-11-22 11:29 (Phases 1–9) + the four
critical updates the parent supplied with the brief.
**References:** `docs/FS-AI-FINAL-AUTONOMOUS-COMPLETION-REPORT-2026-11-21.md`,
`docs/FS-AI-DEPLOYMENT-VERIFICATION-ADDENDUM-2026-11-22.md`,
`docs/FS-AI-WEEKLY-RUN-POST-RUN-REPORT-2026-11-22.md`,
`docs/FS-AI-ALL-REPORTS-2026-11-21-22.md` (combined file).
**Method:** live D1 reads only (SELECT via the D1 helper — no live writes
of any kind), live public-page fetches (GitHub repo, sitemap, robots.txt,
article page, Short #06 page), local code reads, local test suite.
No push, no deploy, no dashboard/browser work, no live setting change.
**Cost of this audit: $0.00.**

## Verdict

**The deployment is healthy and the live state matches the 22 Nov reports
almost exactly — with three drifts (all explained), one time-sensitive
finding, and one structural blocker.**

- **VERIFIED LIVE:** deployed commit 295764c; migrations 020–028 (all 11
  new tables); articles 25 published / 7 drafts; auto-publish three-part
  config (auto / on / 2026-11-22T04:55:28Z); Emergency Stop OFF; no
  social accounts; Short #06 published; daily state last_uploaded 6 /
  next_article 7; daily report 12 + weekly report 13.
- **Drifts (explained, none a defect):** (1) task #31 went failed → done
  at 04:50:39Z — the #30 Re-check reused it, exactly as the final report
  predicted; (2) `llm_provider_order` now EXISTS in live D1 with value
  `workers-ai,groq,gemini` — neutralised by the code allowlist
  (Workers AI only); writer unknown; (3) the #29/#30 bodies each grew
  +8 chars in the weekly run — **identified exactly** (§14): the SEO pass
  swapped the Related-reading link from #25 to #19.
- **TIME-SENSITIVE FINDING (§8):** the 23 Nov Short run faces a
  selection conflict — the state file says next article 7, but the
  suitability engine scores article 7 at 51 ("long-form-or-other", skip
  for Shorts) and the content calendar plans article #09 (70, good) for
  23 Nov. P8 forbids blind article-id order. The owner/parent must
  decide before the 23 Nov 10:13 run.
- **STRUCTURAL BLOCKER (§5):** #29 cannot be regenerated — not just
  because the Guardian article left the RSS feed, but because the worker
  has NO path to ingest full article text at all (RSS summaries only).
  The full Austin text exists on verbatim mirrors, but the research
  engine cannot fetch or store it. Regeneration needs either an
  owner-written body or a new full-article fetch feature (owner
  decision, not implemented).
- **Tests:** 1265 pass / 1 fail. The single failure is a time-decaying
  fixture (fixed 21 Nov seed dates vs the real clock), not a production
  defect. No test was modified.
- **Nothing was published by this audit.** #28–#31 and #33 stay drafts.

## Labels used in this report

- **VERIFIED LIVE** — checked against live D1, a live page, or the live
  repo in this audit.
- **IMPLEMENTED BUT NOT LIVE-VERIFIED** — in the local code, not
  confirmed live by this audit.
- **BLOCKED** — cannot proceed; the blocker is named.
- **OWNER ACTION REQUIRED** — only the owner (or the parent in the
  browser) can do it.
- **NOT IMPLEMENTED** — does not exist in code or live.

---

## 1. Deployed commit, live database, migrations

| Item | Expected (22 Nov reports) | Live value | Status |
|---|---|---|---|
| Deployed HEAD (GitHub main) | 295764c | **295764c777a2472c0b9fb1c6f98b568297651508** (50 commits, repo page fetched 22 Nov 11:29 UTC) | **VERIFIED LIVE** |
| Migrations 020–028 | applied live | All 11 new tables exist in live `sqlite_master`: `system_health_checks`, `publication_logs`, `social_accounts`, `social_posts`, `social_analytics`, `article_fingerprints`, `article_deletion_audit`, `daily_publication_reservations`, `youtube_videos`, `youtube_performance`, `youtube_anomalies` | **VERIFIED LIVE** |
| Articles | 25 published / 7 drafts / 32 total | **25 published / 7 drafts / 32 total** | **VERIFIED LIVE** |
| Drafts | #26, #27, #28, #29, #30, #31, #33 | #26 (div 2), #27 (div 1), #28 (div 2), #29 (div 5), #30 (div 5), #31 (div 8), #33 (div 8) | **VERIFIED LIVE** |
| Task queue | done 29, queued 4, failed 1, skipped 5 | **done 30, queued 4 (36, 37, 39, 40), skipped 5, failed 0** | **VERIFIED LIVE** — drift explained in §2.1 |
| Daily / weekly reports | daily 12, weekly 13 | **daily 12 (2026-11-22 00:03:16Z), weekly 13 (00:03:19Z)**; summary JSON cross-checked (§2.3) | **VERIFIED LIVE** |
| Revenue | $0.00 | `website_settings.total_revenue_usd` = `0.00` | **VERIFIED LIVE** |
| Traffic | Data unavailable | `traffic_status` = `Data unavailable` | **VERIFIED LIVE** |
| `daily_publication_reservations` rows | 0 | **0** (no auto-publish reservation ever made) | **VERIFIED LIVE** |
| `publication_logs` rows | 0 | **0** | **VERIFIED LIVE** |
| LLM usage, 22 Nov (UTC) | run + re-check activity | **6 calls / 130 Neurons** (far under the 9000 cap) | **VERIFIED LIVE** |

No article changed status, no article was published, and no protected
record was touched since the deploy.

---

## 2. Automation settings + drifts

### 2.1 Settings read back individually (live D1, `autonomy_settings`)

| Setting | Live value | Expected | Status |
|---|---|---|---|
| `publishing_mode` | `auto` | auto | **VERIFIED LIVE** |
| `auto_publishing` | `on` | on | **VERIFIED LIVE** |
| `auto_publish_eligible_since` | `2026-11-22T04:55:28Z` | 2026-11-22T04:55:28Z | **VERIFIED LIVE** |
| `auto_correction` | `off` | off | **VERIFIED LIVE** |
| `social_auto_post` | `off` | off | **VERIFIED LIVE** |
| `auto_research` | `on` | on | **VERIFIED LIVE** |
| `auto_generation` | `on` | on | **VERIFIED LIVE** |
| `auto_factcheck` | `on` | on | **VERIFIED LIVE** |
| `max_articles_per_day` | `1` | 1 | **VERIFIED LIVE** |
| `emergency_stop` (`website_settings`) | `0` (OFF) | OFF | **VERIFIED LIVE** |
| `autonomy_level` / `autonomy_target` | `3` / `3` | 3 | **VERIFIED LIVE** |
| `llm_daily_cap_neurons` | `9000` | 9000 | **VERIFIED LIVE** |
| `llm_provider` | `none` | — | **VERIFIED LIVE** |
| `llm_provider_order` | **`workers-ai,groq,gemini`** | did not exist (21 Nov) | **DRIFT — see §2.2** |

Nothing was changed during this audit.

### 2.2 Drift 1 — `llm_provider_order` now exists in live D1

The final report (§10.2) recorded that the live `llm_provider_order`
setting "does NOT exist (verified)". It now exists with value
`workers-ai,groq,gemini`. Something wrote it between 21 Nov and this
audit; there is no settings audit trail, so the writer is unknown
(candidates: the dashboard settings UI, or a worker run).

**Impact: none in practice.** The code neutralises it — verified in
`backend/llm/registry.js:68-76`: `getProviderOrder()` filters any stored
value through `ALLOWED_PROVIDER_IDS = new Set(['workers-ai'])`, so the
stored `groq,gemini` entries are dropped and the effective order is
always `['workers-ai']`. Workers AI remains the only active provider.

**Recommended cleanup (OWNER ACTION REQUIRED, optional, low priority):**
set the row to `workers-ai` or delete it, so the stored value stops
disagreeing with the enforced behaviour. No code change is needed.

### 2.3 Drift 2 — task #31 is no longer failed

The 22 Nov post-run report said "Failed task #31 is still the only
failed task." Live now: task #31 (`fact-checking`, kind `fact-check`,
attempts 1) is status **`done`**, `updated_at` **2026-11-22T04:50:39.645Z**
— exactly when the #30 Re-check ran (run #167, 04:50:34Z). The Re-check
handler reused task #31's row, as the final report §13.1 note 6
predicted ("if it reuses task #31's row, its status may change — that is
the handler's designed reuse, not an error"). Queue totals now: done 30,
queued 4, skipped 5, failed 0 (39 tasks total, unchanged). **Explained,
not a defect.** Note the weekly report id 13 (written 00:03:19Z, before
the re-check) still lists task #31 as failed — that is a stale snapshot,
not a live value.

### 2.4 Weekly-run summary JSON cross-check (reports 12/13)

Daily report 12 `summary_json` matches the post-run report on every
count: queueDrained 10, queueDone 10, queueFailed 0, **queueDraftsConverted
0** (the F1 drain-draft-conversion behaviour did NOT trigger in the first
post-deploy drain — no drafts were created), researchFetched 0,
researchItemsStored 0, factChecksRun 3, correctionsRun 0, seoRun 3,
gateEvaluated 7, gateApproved 0, published 0, failedTasks 1 (task #31,
as of the report time), `auto_publishing: 'off'` at run time (it was
enabled later, 04:55:28Z — the run correctly saw it off). Queue health
was `degraded`. Weekly report 13: totalArticles 32, published 25,
taskOutcomesLast7Days done 117 / no-op 33 / skipped 5, failedSources [],
activeSources 24, researchItemsLast7Days 710. **VERIFIED LIVE** — the
stored reports agree with the published post-run report.

### 2.5 Queued tasks — ageing

Queued: **36, 37** (created 21 Nov 00:00–00:01Z, research + content) and
**39, 40** (22 Nov 00:02Z, research). The 22 Nov drain took the 10
oldest other tasks (3–8, 22–24, 35); 36/37 have now waited ~36 hours.
Queue health was `degraded` at the run. **Not a defect yet** — the next
daily run (23 Nov 00:00 UTC) should drain them within the cap of 10 —
but if they are still queued after that run, the drain is skipping them
and the parent should investigate. **Monitor.**

---

## 3. Article #33 — "M State's Detroit Lakes campus to close amid systemwide budget woes"

| Check | Result | Status |
|---|---|---|
| Body | Full 4801 chars, complete article (Introduction, Costs and budgeting, Sources and further reading, Conclusion, Key takeaways). AI-DRAFT banner present. Not a scaffold; no placeholders; ends on a content sentence. | **VERIFIED LIVE** |
| Division | 8 (Education & Learning) | **VERIFIED LIVE** |
| Created | **2026-11-22T00:02:10.367Z** — before the auto-publish cutoff 04:55:28Z | **VERIFIED LIVE** |
| Status | draft, `fact_checked` 0 | **VERIFIED LIVE** |
| Source evidence | `article_sources` id 5 → Higher Ed Dive URL, `research_item_id` 696. Research item 696: **114 chars** — one sentence: "System leaders voted to shutter the location, which enrolls just over 100 students, as soon as summer 2028." A second item exists (704, Inside Higher Ed, 104 chars) but is NOT linked to #33. Recorded evidence total: **114 chars for a 4801-char article.** | **VERIFIED LIVE** |
| Fact-check | **No `fact_checks` rows for #33 — never run.** | **NOT RUN** |
| SEO check | **No `seo_checks` rows for #33 — never run.** | **NOT RUN** |
| Truncation | No truncation markers (complete sections, closed structure, content ending). Read-only inspection; the repo's truncation guard was not executed against it (no live run available to this audit). | **VERIFIED LIVE** (by inspection) |
| Duplicate | **No `article_fingerprints` row for #33** — the duplicate check has not run for it yet. No duplicate is known; the check must run with the SEO pass. | **NOT RUN** |
| Publication eligibility | **NOT ELIGIBLE.** Legacy (created before `auto_publish_eligible_since`) — the gate refuses it by timestamp (`backend/publishing/gate.js:418-446`); no fact-check; no SEO; gate Blocked. It can never auto-publish and needs separate per-article owner authorization even if every check later passes. | **VERIFIED LIVE** |

### 3.1 Independent claim verification (auditor's own check, NOT a worker fact-check)

I fetched the full Higher Ed Dive source the article cites
(https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/,
published 2026-11-19) and checked #33's claims against it. The worker
fact-check, when run, will only see the 114-char fragment — so it will
flag far more than this table does. This table is what a fuller-evidence
check would find.

| #33 claim | Verdict vs the full source |
|---|---|
| Campus will shut down by summer 2028 | **SUPPORTED** — "set to shutter as soon as summer 2028" |
| Serves "just over 100 students" | **SUPPORTED** — "just 111 students" |
| System/board voted to close, amid budget woes | **SUPPORTED** — trustee board "unanimously approved the closure Wednesday"; system deficit "nearing $100 million" |
| "The exact numbers of the budget shortfall are not publicly disclosed" | **CONTRADICTED** — the source gives $1M/yr operating savings, $18M capital spending avoided, and a system deficit nearing $100M |
| "Free up funds redirected toward scholarship programs, online course expansion, and technology upgrades" | **UNSUPPORTED (invented)** — the source says savings are $1M + $18M and the system reallocates up to $25M/yr to *struggling institutions*, not scholarships/online/tech |
| "Students will be offered transfer options to other M State campuses" | **WEAK** — the source says only "detailed transition planning to allow current students to finish their studies"; "transfer options" is not stated |
| "Faculty and staff will receive support through career placement services and relocation opportunities" | **UNSUPPORTED (invented)** — the source mentions 40 employees and nothing about placement or relocation |
| "Close-knit community and personalized learning" | **UNSUPPORTED** — not in the source |
| "Reallocate resources to higher-priority programs" | **WEAK** — the source's reallocation goes to struggling institutions, not "higher-priority programs" |
| General editorialising ("preserve overall academic quality", "strengthen core programs", "transparent budgeting") | **UNSUPPORTED** — generic claims with no source sentence behind them |

**Consequence:** when the dashboard fact-check runs on the 114-char
fragment, expect verdict **needs-review or failed** with most claims
UNSUPPORTED. The Correct flow will then strip the unsupported claims
and the article will shrink to a short, honest stub (roughly: closure by
summer 2028, ~111 students, board vote, budget woes). That is the safe
executable path with the evidence the system actually holds. Getting a
*better* article (one that can honestly carry the $1M/$18M/111-student/
40-employee/enrolment-decline facts) needs fuller evidence first — and
the worker cannot fetch full article text (see §5.2). The owner decides:
correct to a stub now, or wait for a full-article fetch feature.

**Also note for the SEO pass:** #33 is division 8. The only other
published division-8 article is #22, and the Related-reading link to
#22 may not be genuinely relevant (same pattern as #31) — expect the
internal-links check to fail by editorial choice, leaving the gate
Blocked even after a clean fact-check. Do not add an irrelevant link to
satisfy the check.

**Parent procedure:** Appendix A (dashboard Re-check for #33, then SEO
via the next daily run; expected results listed).

---

## 4. Article #30 — "A local's travel guide to New York City"

| Check | Result | Status |
|---|---|---|
| Latest fact-check | **id 29, kind `recheck`, verdict `needs-review`, 5/20 verified, 15 failed**, `body_hash` `ac723e55…dae965`, created 2026-11-22 04:50:34 | **VERIFIED LIVE** — matches the addendum exactly |
| Newer body edit or fact-check since | **None.** `updated_at` still 2026-11-22T00:02:50.311Z, body still 4623 chars. No `fact_checks` row after id 29. | **VERIFIED LIVE** |
| Latest SEO | id 22, `needs-review`, 2026-11-22 00:02:52 (internal-links ok; broken-links "host unreachable" — see §10.5) | **VERIFIED LIVE** |
| Status | draft, gate Blocked, `fact_checked` 0 | **VERIFIED LIVE** |

### 4.1 The 15 failed claims — exact list (`claim_checks` for fact-check id 29)

20 rows exist (ids 253–272): 5 VERIFIED, 15 failed. The `fact_checks`
row stores only counts; the claim texts live in `claim_checks` — quoted
verbatim below.

**VERIFIED (5):** #255 ("top destinations include a ferry ride, shopping
for watches in Chinatown, and a Brighton Beach bender"); #257 ("guide is
organized around a simple three-day itinerary"); #262 ("ferry ride …
highlighted as one of the city's top destinations"); #268 ("Brighton
Beach … another top destination"); #272 ("a three-day trip … can still
feel full and authentic if you focus on a few key experiences").

| Claim id | Verdict | Claim (verbatim, truncated at 120 chars) | Checker's explanation |
|---|---|---|---|
| 253 | OUTDATED | "If you only have three days to explore New York City, a local's travel guide can help you hit the highlights without feeling rushed." | "The only supporting evidence is over a year old and the claim is time-sensitive." |
| 254 | OUTDATED | "The Guardian's recent feature, 'A local's travel guide to New York City…,' gives a clear snapshot of the city's best experiences." | Same — evidence over a year old. |
| 256 | UNSUPPORTED | "These moments illustrate how even unplanned journeys can turn into unforgettable memories." | "No recorded source for this article supports this claim." |
| 258 | UNSUPPORTED | "Each day is broken into a few key activities that showcase different sides of the city." | "Evidence mentions the topic but does not support the claim as written." |
| 259 | UNSUPPORTED | "By focusing on one major destination per day—ferry, Chinatown, and Brighton Beach—the planner keeps travel time manageable…" | "Evidence mentions the topic but does not support the claim as written." |
| 260 | UNSUPPORTED | "The structure works because it gives you a clear sense of where to go, what to look for, and how to spend your time efficiently." | "No recorded source supports this claim." |
| 261 | CONFLICTING | "**Day 1 – Ferry Ride** Start your trip with a ferry ride." | "Evidence mentions the topic but states a different number than the claim." |
| 263 | UNSUPPORTED | "A ferry gives you a scenic view of the skyline and a relaxed way to travel across the harbor." | "No recorded source supports this claim." |
| 264 | UNSUPPORTED | "The guide suggests that this is a great way to kick off your adventure with a memorable experience." | "No recorded source supports this claim." |
| 265 | CONFLICTING | "**Day 2 – Watch Shopping in Chinatown** On the second day, head to Chinatown to shop for watches." | "Evidence mentions the topic but states a different number than the claim." |
| 266 | UNSUPPORTED | "Chinatown's unique blend of culture and commerce offers a different flavor of New York, and the watch shops provide a fun, hands-on way to explore local business." | "No recorded source supports this claim." |
| 267 | CONFLICTING | "**Day 3 – Brighton Beach Bender** Finish your three-day trip with a Brighton Beach bender." | "Evidence mentions the topic but states a different number than the claim." |
| 269 | UNSUPPORTED | "Brighton Beach is known for its vibrant atmosphere, and the 'bender' suggests a lively evening where you can experience the local nightlife, food, and music." | "No recorded source supports this claim." |
| 270 | UNSUPPORTED | "The guide's narrative also includes a personal note: the author's first visit to New York was accidental, caused by a miscommunication with his father and his late mother's wish to see the city." | "The provided excerpt only lists destinations and a link, with no mention of a personal anecdote." |
| 271 | UNSUPPORTED | "This anecdote shows how a single event can lead to a deep connection with a place." | "No recorded source supports this claim." |

### 4.2 Root cause

The evidence pool for #30 is a single RSS-summary fragment (~300
chars: the title plus one dek sentence). The article body (4623 chars)
was generated from that fragment and invented the day-by-day detail,
the elaborations, and the connective claims. The checker judged
correctly *against the evidence it had*.

### 4.3 Auditor's verification against the real Guardian article

I found the full Guardian NYC article reproduced verbatim on a mirror
(http://www.tripulous.com/2024/03/a-locals-travel-guide-to-new-york-city-what-to-eat-see-and-do-in-three-days/
— the Guardian's own domain is policy-blocked for my browser, so the
mirror is what I could read). Against the real text:

- **Claim #270 (the anecdote) is TRUE:** "I first came to New York City
  by accident, after a miscommunication with my father led me to believe
  my (long-deceased) mother had been desperate to visit the city before
  she died." The checker marked it UNSUPPORTED only because the fragment
  did not contain it.
- **The day mapping is REAL:** Day 1 is "Boating and brownstones"
  (Staten Island ferry, NYC ferry, Dumbo, Jane's Carousel, Goose
  Barnacle, Fort Greene); Day 2 is "Rude T-shirts and not-quite Rolexes"
  (Soho/Chinatown knockoff watches). The CONFLICTING verdicts on #261 /
  #265 / #267 are artefacts of the thin evidence, not of the article
  being wrong about the structure.
- **The elaborations (#263, #266, #269, #258–#260, #264) are plausible
  paraphrase/colour**, not facts the fragment supports — e.g. the ferry
  *does* pass the Statue of Liberty with skyline views in the real
  article, so #263 is substantively true, but it cannot be verified from
  the stored evidence.

**Consequence for correction:** the dashboard Correct flow can only use
the stored fragment, so it will remove several claims that are in fact
true (notably the anecdote and the day mapping) — a quality loss, not a
safety issue. The honest correction still leaves a short stub ("The
Guardian guide lists three top destinations in a three-day guide: a
ferry ride, watch shopping in Chinatown, a Brighton Beach bender").
Getting the fuller correction needs the full-article fetch feature (§5.2).
The owner should know the stub will be *more* conservative than the
truth before approving the correction — or wait for fuller evidence.

**Parent procedure:** Appendix B (dashboard Correct → run the task →
fresh Re-check → verify the body hash; expected results listed). #30
stays a draft. Do not publish.

---

## 5. Article #29 — "A local's travel guide to Austin"

| Check | Result | Status |
|---|---|---|
| Body | Scaffold shell, 601 chars, still "SCAFFOLD — full draft needed" with 6 `[Write this section — no content yet.]` placeholders. Unchanged by the weekly run except the +8-char link swap (§14). | **VERIFIED LIVE** |
| Evidence | Only research item **381**: 500 chars, fetched 2026-11-19 17:07:18, `is_outdated` = 1. `article_sources` id 2 records the Guardian URL (with trailing slash), `research_item_id` NULL. No new research item for that URL exists. | **VERIFIED LIVE** |
| Fact-check | fc 9 and fc 10, both `failed` (0 verified), 2026-11-20. No newer check. | **VERIFIED LIVE** |
| SEO | id 21, `needs-review`, 2026-11-22 00:02:49. | **VERIFIED LIVE** |
| Status | draft, Blocked. Not regenerated, not edited, not published. | **VERIFIED LIVE** |

### 5.1 The full article text DOES exist — on verbatim mirrors

Web search found the complete Guardian Austin article (26 Apr 2024)
reproduced in full on two mirror sites:

- https://newspub.live/south/austin-tx/a-locals-travel-guide-to-austin-what-to-eat-see-and-do-in-three-days/
- https://vcptravel.com/2024/04/26/a-locals-travel-guide-to-austin-what-to-eat-see-and-do-in-three-days-austin/

Both carry the full Day 1/2/3 text (Town Lake / Lady Bird Lake trail,
Zilker Park, Picnic food truck park, Chuy's, Barton Springs Pool, Terry
Black's, Rollin Smoke, Continental Club, Rō Fitness, Veracruz / Tacodeli
/ Tamale House East, BookPeople, Waterloo Records, Loro / Suerte / Este,
Bouldin Creek Cafe, Congress Street Bridge bats, Bullock Museum, LBJ
Presidential Library, "more than 2,000 food trucks", the 10-mile trail)
— several thousand characters, far above the 1000-char floor. The
Guardian's own page (https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide)
is policy-blocked for my browser, so I could not verify the original
page myself; the mirrors identify themselves as republications of it
("Click Here to Read the Full Original Article at Travel | The
Guardian").

### 5.2 Why that does NOT unblock regeneration — the structural limit

The scaffold-regeneration handler (`backend/agents/autonomy/content.js`,
`regenerateScaffoldDraft`) takes evidence **only** from the article's own
recorded sources via `resolveEvidence()`, which matches
`research_items` rows by URL (exact, then normalised). And the research
engine (`backend/agents/autonomy/research.js`) **only ingests RSS feeds**:
it calls `fetchFeed()` (RSS/Atom parsing) on registered sources, and
ad-hoc `payload.sources` URLs are "fetched the same way but are not
stored" — i.e. treated as feeds. There is **no full-article text
extraction anywhere in the backend** (no readability/HTML-to-text path),
no dashboard control to add a research source, and no way to store an
arbitrary fetched page as a `research_items` row. So:

- A research task for the Guardian Austin URL cannot store article text
  (the URL is an HTML page, not a feed).
- A research task for a mirror URL cannot help either: even if it were
  stored, its URL would not match the Guardian URL in `article_sources`,
  so `resolveEvidence()` would not find it.
- The Guardian Travel RSS feed no longer contains the Apr 2024 article
  (verified 22 Nov: 3 new / 32 duplicates, 35 items, Austin absent), and
  it will not come back.

**Verdict: BLOCKED — structural.** The blocker is not "the article left
the feed"; it is "this system can only learn from RSS summaries". The
mirrors are useful to a *human* verifying facts, but the worker cannot
ingest them.

### 5.3 Alternatives (none executable today)

1. **Owner-written body** — the regeneration recovery report itself
   names this ("or an owner-written body"). The owner writes the draft;
   the system then fact-checks it. **OWNER ACTION REQUIRED** if chosen.
2. **Full-article fetch feature (NOT IMPLEMENTED, owner decision
   required):** a worker function that fetches an article URL, extracts
   readable text (readability-style), and stores it as a `research_items`
   row for that URL (current, ≥1000 chars), with SSRF/host allowlisting,
   a size cap, and the same outdated-exclusion as RSS items. Only then
   could the existing regeneration handler run unchanged. This is a real
   feature with a trust-model change (arbitrary URL fetching from the
   Worker) — it needs the owner's explicit go-ahead and a design review,
   not a unilateral build. Estimated shape: new `backend/services/
   article-fetch.js` + a research-task kind + tests. Not started.
3. **Guardian Open Platform API** — needs a free API key (owner
   registers) *and* the same new worker code path as (2). Not a shortcut.
4. **Wait for the feed** — will not happen; the article is from Apr 2024.

**Do NOT regenerate #29. Do NOT invent facts. Keep it unchanged.**
The conditional regeneration procedure (for use only if option 2 ever
lands) is in Appendix C.

---

## 6. Auto-publishing verification

| Check | Evidence | Status |
|---|---|---|
| Three-part config | `publishing_mode` = `auto`, `auto_publishing` = `on`, `auto_publish_eligible_since` = `2026-11-22T04:55:28Z` (live D1, §2.1) | **VERIFIED LIVE** |
| Cutoff semantics | `backend/publishing/gate.js:418-446` — articles created before the cutoff are refused ("predates autonomous publishing and needs separate owner authorization"); `LEGACY_AUTO_PUBLISH_REFUSED_IDS = [28, 29, 30, 31]` (gate.js:47) | **VERIFIED LIVE** (code + live values) |
| #33 protection | Created 00:02:10Z < cutoff → refused by timestamp. Note: #33 is **not** in the ID list — if the cutoff were ever cleared, #33 would lose protection while #28–#31 keep theirs. Design note, not a live issue. | **VERIFIED LIVE** |
| One-article-per-day limit | `max_articles_per_day` = `1` (live) + gate daily-limit check counted on the owner's Dhaka day (gate.js) + atomic reservation (migration 026) | **VERIFIED LIVE** |
| Atomic reservation | Migration 026 SQL verified: single atomic `INSERT … SELECT … WHERE (count reserved/consumed) < limit`; `daily_publication_reservations` table live, 0 rows (no reservation ever made) | **VERIFIED LIVE** |
| Duplicate prevention | `article_fingerprints` table live; evaluator requires duplicate overlap exactly 0% and SEO duplicate entry present | **VERIFIED LIVE** |
| Emergency Stop | OFF (`website_settings.emergency_stop` = `0`); gate check `emergency-stop-off`; social route maps it to 423 | **VERIFIED LIVE** |
| Fact-check / SEO gates | Evaluator requires: NEW article, SEO fresh AND complete (11/11, internal-links never waivable), duplicate 0%, every internal link genuinely relevant, banner gone. One failed check refuses the publish. (`backend/publishing/gate.js:295-312` doc + checks) | **VERIFIED LIVE** (code) |
| Protected exclusions | #28–#31 by id; #33 by cutoff; #26/#27 by id-level protection (H1 guard) | **VERIFIED LIVE** |
| Health / Finance human review | **Enforced in code.** Evaluator `backend/publishing/gate.js:585-606`: for special-review divisions (`health-wellness`, `finance-money` — `isSpecialReviewDivision`, `backend/publishing/divisions.js:153`) it pushes `special-review` = **false** with "<Division> articles always require owner approval — never auto-publishable." — a hard-coded refusal even when every other check passes. (The general publish gate only requires the disclaimer; the *auto*-publish evaluator refuses outright.) No health/finance draft exists today. | **VERIFIED LIVE** (code) |
| `publishDueArticles` daily-limit gap | Known gap, still present: the scheduled path's `publishDueArticles()` has no daily-limit check of its own (the evaluator does). No silent change made. | **IMPLEMENTED BUT NOT LIVE-VERIFIED** (known gap, carried) |
| Latent trap: named `scheduled()` export | `backend/worker.js` also exports a named `scheduled()` that runs **only** `publishDueArticles`; the default export's `scheduled()` runs publish + daily + weekly. `src/index.js` re-exports the named one for tests; the live cron uses the default export — proven by the 22 Nov weekly run firing. If anything ever wires the named export to the cron, daily/weekly silently stop. | **VERIFIED LIVE** (live wiring correct; trap latent) |

**No misconfiguration found. No repair needed. No gate was weakened.**
The only settings-related action is the optional `llm_provider_order`
cleanup in §2.2.

---

## 7. Social media

| Check | Result | Status |
|---|---|---|
| `SOCIAL_TOKEN_SECRET` | **SET** — parent-verified 22 Nov ~11:17 via the Workers API (secret list showed OWNER_PASSWORD_HASH, SESSION_SECRET, SOCIAL_TOKEN_SECRET all present); the owner then deleted the API token used (verified dead: "Invalid API Token"). **This audit could NOT re-verify it** — no Workers-scoped token exists any more and the D1-only token cannot list Worker secrets. Reported as parent-verified, not re-verified here. | **SET (parent-verified)** |
| Accounts connected | `social_accounts` 0 rows, `social_posts` 0 rows | **VERIFIED LIVE** |
| `social_auto_post` | `off` | **VERIFIED LIVE** |
| Card renderer | Implemented (SVG per platform; PNG produced at publish-prep time and must be deployed under `social-cards/` — Workers cannot rasterize). No PNGs deployed yet (nothing to publish). | **IMPLEMENTED BUT NOT LIVE-VERIFIED** |
| OAuth procedures | Final report §14.1 + WS-C notes + `docs/SOCIAL-PLATFORMS-2026-11-21.md` exist and are current. Redirect URI for every platform: `https://fs-ai-5w5.pages.dev/api/social/oauth/<platform>/callback`. | **VERIFIED LIVE** (docs present) |

**Precisely what is missing, per platform:**

- **Pinterest — closest to ready.** Account exists: "FS AI" @FS_AI, business account, website claimed (meta tag must stay). Missing: a developer app, Trial access, scopes (boards/pins/user_accounts read+write), token exchange; Standard access needs a demo-video review. Token 30d, refresh 60d. **Owner action:** create the dev app + authorise once (his clicks only).
- **Facebook Page — app missing.** Page exists (work on it stopped 13 Nov on his order; the 12:03 brief supersedes that only for the social automation framework). Missing: Meta developer app, Business use case, Page-admin grant, token chain (user 1–2h → 60d long-lived → Page token effectively non-expiring). Own Page in dev mode needs NO App Review. **Owner action:** create the Meta app + grant once.
- **Instagram — no account exists.** Missing first: a Business/Creator Instagram account (none exists); then Meta app + Instagram product, Instagram Login scopes (`instagram_business_basic`, `instagram_business_content_publish`). Token 60d. Media must be a public HTTPS URL. **Owner action:** create the account, then authorise once.
- **LinkedIn — app missing.** Missing: developer app + Share on LinkedIn + Sign In with OpenID Connect. Access 60d, **no refresh tokens — re-OAuth every 60 days**. **Owner action:** create the app + authorise once.
- **YouTube — DO NOT USE.** Data API stays do-not-use (Testing consent screen → PRIVATE uploads; Production + Google audit first; audit decision is the owner's). Browser upload stays the authorised method.
- **X — UNAVAILABLE_FREE_TIER.** No authorisation is possible free of cost. Do not attempt.

No account is claimed connected. No test post was published. Social
posting stays disabled until an account is connected and the parent
enables `social_auto_post` post-connection.

---

## 8. YouTube automation

| Check | Result | Status |
|---|---|---|
| Short #06 public | Public page fetch (22 Nov 11:29 UTC) returns the video with its description, the article-6 link and 4 hashtags — the video exists and is not private. **Public visibility was verified by the parent in Studio on 22 Nov** (this audit's fetch is supporting evidence, not the Studio proof). URL: https://youtube.com/shorts/kVLyvMp8DoA | **VERIFIED LIVE** (page) + parent-verified (Studio) |
| Metadata / subtitles | `.txt` verified: title "15 Ways to Save Fuel (That Actually Work)" (44 chars, no "\| FS AI" — P6), hook-first description (P7), 4 searchable hashtags, no #FSAI (P7). `.srt` verified: 8 cues (7 scenes + CTA), timings match the 37.30 s timeline. Duration 37.30 s (P1 30–45 s), 7 scenes (P2), cover amber #B45309 fill ~78% (P5), distinct from #03/#04/#05 (P5), spoken CTA end card "Full guide below. Subscribe." (P11), Whisper 99/99, QA 15/15. | **VERIFIED LIVE** |
| Daily state | `last_uploaded` 6, `next_article` 7 (state file read, not modified) | **VERIFIED LIVE** |
| Next scheduled run | Cron `fs-ai-daily-short-upload` ~10:13 Dhaka, 23 Nov. Valid. Not modified. | **VERIFIED LIVE** |
| No duplicate upload | `record_upload.py` is idempotent (re-running the same video-id overwrites the same rows); `article_video_links.json` holds only `"6"`; one receipt `kVLyvMp8DoA.json`. | **VERIFIED LIVE** |
| P1–P12 rules | Present in PIPELINE-README.md §0A (read-only; not edited — the other coordinator owns that tree). #06 followed them (see metadata row; P9 posting-time test is a proposal, not applied; P10 24 h metrics not yet logged — pending). | **VERIFIED LIVE** |
| Article pages → video links | **Not wired.** `article_video_links.json` exists, but no article page consumes it (no youtube/video reference in `frontend/pages/article.html` or `frontend/scripts/app.js` except the channel link). The site→video funnel is still unbuilt. | **NOT IMPLEMENTED** |

### 8.1 TIME-SENSITIVE — 23 Nov Short selection conflict (OWNER ACTION REQUIRED)

Three sources disagree about what the 23 Nov run should build:

| Source | Says next is |
|---|---|
| Daily state file (`next_article`) | **7** — "ADAS Explained: How Driver Assistance Really Works" |
| Suitability ranking (`topic_ranking_2026-11-21.json`) | **7 scores 51** — band "long-form-or-other", skip reason: "Score 45-64: better as long-form or pin-only, not a Short" |
| Content calendar (`content_calendar.md`) | **23 Nov → #09** ("How to Diagnose Common Engine Noises", 70, good); 24 Nov → #10 (68, good); 28 Nov long-form #08 (57); 5 Dec long-form #07 (51) |

P8 in PIPELINE-README is explicit: "Do NOT follow article-id order
blindly" — skip low scorers for Shorts, record the skip + reason. The
state file's `next_article: 7` is a plain +1 from the 22 Nov run; it does
not consult the ranking. **If the 23 Nov run follows the state file, it
will build a Short for article 7 against the suitability engine, the
calendar, and P8.**

**Recommendation: build #09 on 23 Nov** (per the ranking, the calendar
and P8); article 7 is already scheduled as a long-form on 5 Dec. The
decision is the owner's/parent's — this audit did not touch the state
file or the cron. Decide before **23 Nov 10:13 Dhaka**.

---

## 9. Search Console (technical part only)

| Check | Result | Status |
|---|---|---|
| Sitemap URL | https://fs-ai-5w5.pages.dev/sitemap.xml — fetched live, HTTP 200 (page served) | **VERIFIED LIVE** |
| XML validity / URL count | Parses as a sitemap; **60 URLs**: home (1) + division index + 8 divisions (9) + articles 1–25 (25) + tools index + 20 tools (21) + about/contact/privacy/terms (4). Articles 1–25 only — drafts correctly absent. lastmod dates are the original publish dates. | **VERIFIED LIVE** |
| Published article URLs | All 25 published article URLs present (`/pages/article?id=1` … `?id=25`). | **VERIFIED LIVE** |
| Canonical URLs | `frontend/pages/article.html:64-95` injects a per-article canonical via JS (`https://fs-ai-5w5.pages.dev/pages/article?id=<id>`, plus `og:url`). Code-correct. **Not verifiable from a text crawl** — the crawler sees only the JS shell ("More from this division"), so the canonical must be confirmed in a real browser (Appendix D). | **IMPLEMENTED BUT NOT LIVE-VERIFIED** (via text fetch) |
| Robots directives | https://fs-ai-5w5.pages.dev/robots.txt — `User-agent: * / Allow: /`, sitemap declared. | **VERIFIED LIVE** |
| Sitemap generation | `scripts/regenerate-sitemap.mjs` writes both `public/sitemap.xml` and `frontend/sitemap.xml`; the served sitemap matches the committed files (both dated 20 Nov 10:17). Run `npm run sitemap` before every deploy that follows a publish. | **VERIFIED LIVE** |
| Search Console UI status | **Not checked** — needs a browser session (parent step, Appendix D). The outstanding items stand: sitemap "Couldn't fetch" / 0 pages after 6 attempts; Article 1 "URL is not on Google"; Request indexing hit "Quota Exceeded" a 6th time; next retry was due 21 Nov and is still outstanding. | **NOT VERIFIED** |

**No technical sitemap/canonical defect was found, so no local fix was
made and none is needed.** The indexing problem is on Google's side
(fetch/quota), not in the served files — do not claim indexing success
without Search Console evidence.

---

## 10. Remaining bugs and risks

| # | Item | Severity | Status |
|---|---|---|---|
| 1 | **23 Nov Short selection conflict** (state file 7 vs ranking/calendar/P8 → #09). Decide before 23 Nov 10:13 Dhaka. | High (time-sensitive) | **OWNER ACTION REQUIRED** |
| 2 | **#29 blocked on evidence — structural.** The worker can only learn from RSS summaries; no full-article fetch exists. Needs an owner decision (owner-written body, or a new fetch feature). | High (blocks #29 permanently as-is) | **BLOCKED** |
| 3 | **Test fixture time-decay** — 1 failing test (§12). Fixed 21 Nov seed dates vs the real clock. Production code unaffected. Fix: seed relative to the real today. | Low | **NOT IMPLEMENTED** (fix pending) |
| 4 | **`llm_provider_order` row appeared in live D1** (`workers-ai,groq,gemini`). Neutralised by the code allowlist; writer unknown. Optional cleanup (§2.2). | Low | **OWNER ACTION REQUIRED** (optional) |
| 5 | **Queued tasks ageing** — 36/37 queued since 21 Nov, 39/40 since 22 Nov; queue health `degraded` at the run. Watch the next daily run's drain. | Low–Medium | **Monitor** |
| 6 | **`publishDueArticles()` has no daily-limit check of its own** (known gap); the evaluator enforces the limit, but the scheduled path does not. Plus the latent named-`scheduled()` trap (§6). | Low (latent) | **NOT IMPLEMENTED** |
| 7 | **M2 login lockout not implemented** (known gap from the final report). Sketch exists in WS-E notes; proper D1-backed counting needs a migration + tests. | Medium | **NOT IMPLEMENTED** |
| 8 | **Search Console indexing outstanding** — sitemap "Couldn't fetch" / 0 pages; Article 1 quota-exceeded (6th). Retry still due. | Medium | **OWNER ACTION REQUIRED** (Appendix D) |
| 9 | **Article pages do not link to their videos** — the site→video funnel is unbuilt (`article_video_links.json` exists, pages don't consume it). | Low–Medium | **NOT IMPLEMENTED** |
| 10 | **#33 internal-links risk** — division 8 has only one other published article (#22); if it is not genuinely relevant, SEO internal-links fails by editorial choice (same as #31) and the gate stays Blocked. Do not add an irrelevant link. | Low | **Monitor** (at SEO time) |
| 11 | **Broken-links SEO check is flaky** — seo 21/22 report "host unreachable" for theguardian.com and the site itself (Worker fetch), while seo 17/18 said "All 2 external link(s) responded". The check depends on Worker fetch reachability; it fails soft (`ok:false` at needs-review level), but a future run could misread a live link as broken. | Low | **Monitor** |
| 12 | **#30/#33 corrections will shrink the articles to stubs** if run on fragment evidence alone (§3.1, §4.3) — several true claims will be removed because the stored evidence does not contain them. Editorial decision, not a bug. | Medium (quality) | **OWNER ACTION REQUIRED** (decide: stub now vs wait for fuller evidence) |
| 13 | **Live FK cascade behaviour for `article_revisions` unverified** — the schema declares `ON DELETE CASCADE` (confirmed in the addendum); the actual cascade on delete was never exercised live (no live writes in this audit). | Low | **NOT IMPLEMENTED** (verification pending) |
| 14 | **Task #31's 11:48 manual marking (20 Nov) remains unexplained** — who had D1 access at 11:48 on 2026-11-20 is still unestablished. (Its status has since changed legitimately via the Re-check reuse.) | Low | **NOT IMPLEMENTED** (confirm with whoever had access) |

Carried forward, unchanged: O1 drain LIMIT-before-filtering; O2 two
"created today" definitions; D1 no task-dependency mechanism; YouTube
Data API do-not-use; X UNAVAILABLE_FREE_TIER; Facebook Page / WhatsApp
Business / Business Email / Cloudflare Access lock stopped (superseded
only for the social automation framework); the 406 saved Google password
still unverified-bad.

---

## 11. Exact owner actions still required

1. **Decide the 23 Nov Short — before 23 Nov 10:13 Dhaka.** Recommended:
   build **#09** ("How to Diagnose Common Engine Noises", suitability
   70) per the ranking, calendar and P8; article 7 goes long-form on
   5 Dec. (If the owner prefers article 7 as a Short, say so explicitly
   and the P8 skip is recorded as an owner override.)
2. **Per-article authorisation** for #33 (and #28–#31) before any of
   them can ever publish. None granted. #33 also needs its fact-check +
   SEO first (Appendix A).
3. **#30 correction decision** (Appendix B): correct to a stub now on
   fragment evidence, or wait for a full-article fetch feature. The
   correction itself is a dashboard procedure; the decision is the
   owner's.
4. **#29 decision** (§5.3): owner-written body, or approve the
   full-article fetch feature, or leave #29 as a scaffold draft.
   Regeneration is impossible until one of these happens.
5. **Social OAuth, one-time per platform** (his clicks only): Pinterest
   first (account exists), then Facebook, LinkedIn; Instagram needs an
   account created first. Details in §7.
6. **Search Console retry** (Appendix D): sitemap status + Article 1
   indexing request (quota history noted).
7. **Optional cleanup:** set `llm_provider_order` to `workers-ai` (or
   delete the row) in live D1 (§2.2).
8. **406 Google password** — still unverified-bad; only needed if a
   Search Console/YouTube sign-in asks for it (Secure Vault card or
   signing in himself — never in chat).

---

## 12. Tests

Full local suite run from `~/workspace/fs-ai-source/fs-ai/` (read-only;
nothing modified to make it pass):

- **Result: 1265 pass / 1 fail, 322 suites, exit 1.** (Was 1266/0 on
  21 Nov.)
- **The 1 failure:** `tests/control-center.test.js` — "ai-usage
  aggregates today + 7 days against the 9000-Neuron cap". Assertion:
  `today.calls` actual **0**, expected **2** (and `today.neurons` 0 vs
  120). Root cause: the fixture seeds `llm_usage` rows with fixed dates
  (`NOW = '2026-11-21T12:00:00.000Z'`; two rows at NOW, one at
  2026-11-15), while "today" is computed from the real clock
  (`backend/routes/analytics.js` uses `new Date()`). On 21 Nov the NOW
  rows were "today" and the test passed; on 22 Nov they are yesterday,
  so today aggregates 0. **This is a time-decaying test fixture, not a
  production defect** — the live analytics code is correct, and live
  usage (6 calls / 130 Neurons on 22 Nov) is far under the cap. Fix (not
  applied by this audit — tests are read-only here): seed the rows
  relative to the real today.
- **YouTube engine tests were not re-run separately** — they are part of
  the full suite count above (the other coordinator owns that tree).
- No test was weakened. No quality/safety rule was weakened.

---

## 13. Cost

**$0.00.** No paid service, API, model, credit, subscription, trial, or
card was used in this audit or in any live operation it verified
(Workers AI free tier only; 6 calls / 130 Neurons on 22 Nov UTC).

---

## 14. The +8 characters — solved exactly

The 22 Nov post-run report left open: "#29 body 593→601 and #30 body
4615→4623 (both +8), updated 00:02:47/00:02:50 UTC; the exact 8 added
characters are not yet identified." **Identified in this audit.**

The pre-deploy backup **does** hold full article bodies (31 rows in
`tables.articles` — the earlier note that it "cannot be used to diff
old bodies" was wrong). Character-level diff of the backup bodies
(593 / 4615) against the current bodies (601 / 4623):

- **Old Related-reading line (both articles):**
  `[How to Plan a Road Trip: Checklist and Costs](https://fs-ai-5w5.pages.dev/pages/article?id=25)`
- **New Related-reading line (both articles):**
  `[Travel on a Budget: Plan a Trip Without Overspending](https://fs-ai-5w5.pages.dev/pages/article?id=19)`

The 22 Nov weekly run's SEO pass swapped the Related-reading link from
article **#25** to article **#19**. The new title is exactly 8 characters
longer (52 vs 44); the URLs are the same length (both ids are 2 digits).
Net: **+8 chars in each body, same change, same reason** — the WS-A
Related-reading relevance fix: #19 ("Travel on a Budget") is genuinely
relevant to the travel guides, and the SEO check now records it as "1
genuinely relevant same-division article(s) (#19)". Nothing else in
either body changed (the diff is confined to that one line). The
`article_revisions` rows 18/19 (seo-repair, 00:02:47/00:02:50) hold the
post-change bodies and match the current bodies exactly.

---

## Appendix A — Parent procedure: #33 fact-check + SEO (dashboard, UI controls only)

Preconditions: signed in as owner on
https://fs-ai-5w5.pages.dev/pages/dashboard.html. E-Stop OFF (a 423
means it is ON — stop). Do NOT click Correct first. Do NOT touch
#28/#29/#30/#31 in this run. #33 stays a draft throughout.

**A1. Fact-check #33.**
1. Dashboard → **Autonomous Operations** → pipeline table → find the
   article **#33** row.
2. Click the **Re-check** button on the #33 row
   (`data-autonomy-recheck` → POST `/api/autonomy/articles/33/recheck`).
3. Wait for the response (the check runs the LLM over the current body;
   allow up to a few minutes — do not click again while it runs; an
   in-flight re-check returns HTTP 202, not a second run).

Expected results (check each):
1. Response HTTP 200 (not 423/409/500).
2. A NEW `fact_checks` row exists: id **30 or higher**, `article_id` 33,
   `check_kind` `recheck` (or `initial` if the handler creates the first
   check as initial), `claims_total` ≥ 5. Verdict expected
   **needs-review or failed** (NOT pass — the recorded evidence is a
   single 114-char sentence; a pass would be suspicious).
3. `body_hash` is PRESENT on the new row.
4. `fact_checked` on the articles row stays **0**; status stays
   **draft**; body byte-identical (4801 chars).
5. History: no prior `fact_checks` rows for #33 exist to preserve.

**A2. SEO check for #33.**
There is no per-article SEO button on the dashboard. The SEO check runs
in the scheduled daily run's `seoRun` step (it covered #28/#29/#30 on
22 Nov). So: after A1, **wait for the next daily run (23 Nov 00:00 UTC)**
and then verify a new `seo_checks` row exists for article 33 (verdict
most likely `needs-review`; internal-links may fail by editorial choice
— see §3). If the parent needs it sooner, a dashboard SEO task can be
run via **Autonomous Operations → "Run a task manually"** only if an SEO
task for #33 is already queued — do not invent one.

If anything above differs: stop, keep #33 as a draft, and report the
exact differing value. Do not click Correct until the fact-check result
is known (the correction needs the failed-claims list first).

---

## Appendix B — Parent procedure: #30 correction + fresh re-check (dashboard, UI controls only)

Preconditions: as Appendix A. **Owner decision first (§11.3):** the
correction will shrink #30 to a stub on fragment evidence (§4.3). If
the owner wants the fuller correction instead, do NOT run this — wait
for the full-article fetch feature (§5.2).

**B1. Correct #30.**
1. Dashboard → Autonomous Operations → article **#30** row.
2. Click the **Correct** button (`data-autonomy-correct` → enqueues a
   `fact-checking` / `correct` task; it does NOT run inline).
3. Go to **Autonomous Operations → "Run a task manually"**, select the
   new correction task, and run it. Wait for it to finish (a few
   minutes; do not run it twice).
4. Verify: a new `article_revisions` row exists for article 30
   (`revised_by` the correction flow) holding the pre-correction body;
   the article body is SHORTER (unsupported claims removed); status
   stays **draft**; `fact_checked` stays **0**. The AI-DRAFT banner
   stays on the body.

Expected: the Day 1/2/3 headings and the anecdote paragraphs are
removed or reduced to what the fragment supports (the three destinations
and the three-day structure). If the correction reports 0 changes or
fails, stop and report the exact outcome — do not re-run it in a loop.

**B2. Fresh re-check #30.**
1. Click **Re-check** on the #30 row (same control as the 22 Nov run).
2. Wait for the response.

Expected results:
1. Response HTTP 200.
2. A NEW `fact_checks` row: id **30 or higher**, `article_id` 30,
   `check_kind` `recheck`, `claims_total` smaller than 20 (the corrected
   body has fewer claims). Verdict expected **needs-review** (or `pass`
   only if every remaining claim verifies — treat a pass as a result to
   verify, not to assume).
3. `body_hash` PRESENT and equal to the hash of the corrected body.
   Verify it the same way the parent verified fc 29: run the repo's
   `bodyHash()` (`backend/utils/bodyHash.js`) on the current body and
   compare — they must match exactly. If `body_hash` is NULL or
   different, the check ran against a different body — do NOT treat it
   as fresh; report it.
4. `fact_checked` stays **0**; status stays **draft**; history (fc 14,
   15, 16, 29) preserved.
5. Then let the next daily run produce a fresh SEO check (as Appendix
   A2); do not hand-edit the body to make any check pass.

**B3. What NOT to do:** do not publish #30 (it needs separate editorial
authorisation even after a clean re-check); do not hand-edit the body;
do not paste code in the browser console (all dashboard work uses UI
controls only — the console-snippet procedure from the final report's
§13.2 is NOT to be used; a runtime safety notice flagged that read).

---

## Appendix C — Parent procedure: #29 regeneration (CONDITIONAL — blocked until evidence exists)

**Do NOT run this procedure now.** Its precondition is unmet and the
current system cannot meet it (§5.2). It is recorded here so the work
is ready the moment the full-article fetch feature (or an owner-written
body) lands.

Precondition (all must be true): a CURRENT `research_items` row exists
for the Guardian Austin URL
(`https://www.theguardian.com/travel/2024/apr/26/austin-texas-three-day-travel-guide`)
with **≥1000 chars** of usable `evidence_text` and `is_outdated` = 0.
Verify it in D1 (or on the dashboard research view) before proceeding.
If it is not true, STOP — running the regeneration returns the
insufficient-evidence no-op and changes nothing (that is the correct
behaviour, not a failure).

**C1. Re-fetch the source (only once the fetch feature exists).**
Dashboard → Autonomous Operations → research sources → **Fetch now** on
the Guardian Travel source (id 14), or run the research task the new
feature provides for the Austin URL. Confirm the new research item
(≥1000 chars, current) exists.

**C2. Run the scaffold regeneration.**
Dashboard → Autonomous Operations → **"Run a task manually"** → run a
`content-creation` / `scaffold-regeneration` task with payload
`{ article_id: 29 }` (create the task through the dashboard's task
controls if one is not already queued — UI controls only, never the
browser console, never raw D1 SQL).

Expected results after a successful run:
1. Outcome `done`, `regenerated: true`; same article row (id 29, same
   slug, same title); status still **draft**; `fact_checked` 0; body
   starts with the AI-DRAFT banner; no `[Write this section — no content
   yet.]` placeholders left.
2. One new `article_revisions` row with `revised_by` `scaffold-regen`
   holding the old scaffold shell.
3. `sourcesUsed` ≥ 1.
4. Then run a fresh fact-check (Re-check, Appendix A style) and let the
   next daily run produce SEO — and #29 still needs its own separate
   editorial authorisation before any publication. It is never
   auto-published.

If the outcome is `no-op` / `insufficient-evidence`, the precondition
was not actually met — stop and report the exact evidence state. If it
fails as truncated/still-a-scaffold, that is a retryable LLM failure —
re-run once; if it fails the same way twice, stop and report.

---

## Appendix D — Parent procedure: Search Console + canonical check (browser)

**D1. Sitemap status (Search Console).**
1. Sign in to Google Search Console as mdalfahad841@gmail.com (the
   account the URL-prefix property is verified under).
2. Open the property for `https://fs-ai-5w5.pages.dev/` (URL-prefix —
   NOT the `sc-domain:` property, which is a separate, unverified
   property).
3. Left menu → **Sitemaps**. Read the status of
   `https://fs-ai-5w5.pages.dev/sitemap.xml` (previously "Couldn't
   fetch" / 0 pages after 6 attempts). Record exactly what it says now
   (status + discovered URLs + last read date). If it still says
   "Couldn't fetch", use **"See index coverage"** / the sitemap details
   for the error text — the served file itself is valid (60 URLs,
   verified in §9), so the fault is on Google's fetch side.
4. If the sitemap now reads successfully, do NOT resubmit it again
   (duplicate submissions do not help).

**D2. Article 1 indexing retry.**
1. Top bar → **URL Inspection** → enter
   `https://fs-ai-5w5.pages.dev/pages/article?id=1` → **Test live URL**
   (or inspect the indexed state).
2. If it says "URL is not on Google", click **Request indexing**.
   History: this hit "Quota Exceeded" 6 times; if it hits quota again,
   record the exact message and stop — retry the next day, do not loop.
3. Record the inspection result verbatim (indexed / not indexed /
   crawled-but-not-indexed, and any coverage reason).

**D3. Canonical check (real browser).**
1. Open `https://fs-ai-5w5.pages.dev/pages/article?id=6` in the browser.
2. View page source (Ctrl+U) and find `rel="canonical"`. Expected:
   `<link rel="canonical" href="https://fs-ai-5w5.pages.dev/pages/article?id=6">`
   (the canonical is injected by JS, so it is invisible to a text
   crawl — this browser check is the verification).
3. Confirm the article content renders (the page is JS-driven; an empty
   shell means the API call failed, which is a different problem —
   report it).

**D4. What to report back:** the sitemap status line, the Article 1
inspection result (and any quota message), and the canonical href found
in D3. Do not claim indexing success without the Console evidence.
