# FS AI — Activation Repair Notes, 2026-11-20

Working notes for the Autonomous Business Activation & Critical Pipeline
Repair (owner master prompt, 2026-11-20 00:07). This is the implementer's
record, not the final owner report — the parent writes
`docs/FS-AI-Autonomous-Operation-Report.md` after live verification.

- **Baseline:** GitHub commit `06817c1` (29th commit), tests **630 pass / 0 fail,
  140 suites**. Live D1 at dispatch: 27 articles (25 published, 2 drafts #26 +
  #27), 693 research_items, 3 fact_checks, 27 claim_checks, 0 seo_checks,
  1 backup_run, 18 agent_tasks.
- **Final state (local only, NOT pushed, NOT applied to live D1):** tests
  **648 pass / 0 fail, 148 suites**. Nothing was published, deployed, or
  changed on live D1 / Pages / Worker / GitHub / YouTube / Pinterest /
  Search Console. `publishing_mode` stays `approved_only`; all `auto_*`
  stay off in code and in live settings — this task changes code only.
- **Hard rules honored:** $0 always; Workers AI only for inference; no
  fabricated data/sources/claims/analytics/revenue/test results; no
  paywall/copyright bypass (stored RSS summaries only); Articles #26/#27
  untouched (content + correction history); no quality gate or test
  weakened; Emergency Stop respected at every automation entry point.

## 1. What was inspected

Read before changing anything: the owner master prompt (16 sections),
`docs/FULL-LIVE-VERIFICATION-2026-11-19.md`, `docs/AUTONOMY-MASTER-2026-11-19.md`,
and the code below (all line numbers are post-change, unless noted):

- `backend/agents/autonomy/content.js` — generation + `convertScaffoldToDraft`
- `backend/agents/autonomy/factcheck.js` — claim pipeline + correction
- `backend/agents/autonomy/seo.js` — SEO fields + 11-check suite
- `backend/publishing/gate.js` — 10-check publish gate
- `backend/agents/autonomy-runner.js` — `DIVISION_RESEARCH_REGISTRY`, task dispatch
- `backend/routes/scheduler.js` — daily/weekly workflow, `autoFlags`, pause checks
- `backend/routes/orchestrator.js` — all `/api/autonomy/*` endpoints, `agentStatuses`
- `backend/rss/sources.js` — `fetchSource`, `markSourceOk`, counter updates
- `backend/llm/providers/cloudflare-workers-ai.js` — model list + Neuron rates
- `backend/llm/index.js`, `backend/llm/registry.js` — provider order, usage logging
- `frontend/scripts/autonomy.js` — dashboard autonomy section (1,084 lines)
- `database/schema.sql`, `database/migrations/002_agents_accounts.sql`,
  `008_research.sql`, `009_factcheck.sql`, `010_pipeline.sql`, `011_backup.sql`
- Two read-only subagents supported this work: (1) Workers AI model
  availability, verified against official Cloudflare docs; (2) scheduler /
  orchestrator / frontend inspection. Their findings are folded in below
  (the model verdicts in §5 are the researcher's, with sources).

## 2. Root causes found (the headline discoveries)

### 2a. Source persistence was broken by a CHECK constraint — the #27 "0 sources" cause
`article_sources.source_type` allows ONLY `('official','news','research',
'manufacturer','other')` (`database/schema.sql:175`,
`database/migrations/002_agents_accounts.sql`). But
`backend/agents/autonomy/content.js` `convertScaffoldToDraft` inserted
`source_type='rss'` (URL matched a research item) or `'web'` (other URL) —
both violate the CHECK on real SQLite/D1. The insert was wrapped in
`.catch(() => {})`, so the failure was **silently swallowed** → **0
article_sources rows for EVERY generated draft**, manual AND daily-workflow
alike. The fake-D1 used in tests does not enforce CHECK constraints, so
the suite never caught it; `tests/real-db.test.js` does not cover
`convertScaffoldToDraft`. Verified with a real SQLite experiment
(2026-11-20): the `INSERT ... 'rss'` fails, the `'research'` insert
succeeds. This is the exact cause of #27's "0 source(s) recorded", and
therefore of its fact-check having no evidence to work with.

### 2b. Evidence never reached the generator
`runContentCreation` passed only a bare source URL into the LLM prompt.
The LLM cannot open links, so #27's first draft was a refusal. No stored
research text was ever passed.

### 2c. Fact-check / correction used the whole division's pool
`factcheck.js` `loadEvidence` loaded ALL `research_items` of the division
(`LIMIT 200`) plus the article's sources. That is how #27's correction
imported a motorcycle statistic from an unrelated Electrek article.

### 2d. SEO could never pass as built
`runSeo` filled BLANK fields only. #26's meta description was 77 chars
(title-derived) and could never reach 120–160; the content agent's system
prompt did not require `##` (H2) headings (the LLM wrote H3s); no internal
link was ever added. The 11-check suite itself was correct — the fields
it measured could never be fixed.

### 2e. Daily-run button reported success for a no-op
The dashboard button called `POST /api/autonomy/run-daily` with NO body,
so `force` was always false; a second click on the same day returned
`duplicate: true` from the server while the UI still said "Daily workflow
finished." The server already supported `force` — the button never sent it.

### 2f. "[object Object]" in daily reports
`reportSummaryText` (`frontend/scripts/autonomy.js`, old lines ~437–455)
did `k + ': ' + parsed[k]` on the summary object; `steps` and `counts`
are nested objects, so they rendered literally as `[object Object]`.

## 3. Repairs (dependency order)

### A. Evidence to generator — `backend/agents/autonomy/content.js`
- New `resolveEvidence(env, sources)` (lines 71–108): each supplied URL is
  resolved against stored `research_items` (latest fetch per URL). Returns
  `{ resolved: [{ url, title, summary, evidenceText, publishedAt,
  researchItemId, sourceId, sourceName, isOutdated }], unresolved: [url] }`.
  Only stored research counts as evidence — a URL the system never
  fetched has no usable content and is reported unresolved, never passed
  off as research.
- `runContentCreation` (lines 124–260) resolves evidence BEFORE the LLM
  call and passes title + summary/evidence text + URL + publication date
  into the prompt (max 5 items, ~1,200 chars each; `buildLlmPrompt`,
  lines 40–68). System prompt now requires `##` (H2) headings for every
  outline section (line 33).
- If no source resolves: outcome `'no-op'`, reason
  `'insufficient-evidence: ...'` (line 195), LLM never called, no
  sourceless draft written. The unresolved URLs are returned so the
  dashboard can show exactly which source had no stored research.
- On success the draft carries `evidence` + `sourceIds`, and the meta
  description is derived from the real body text via
  `deriveSeoDescription` (`backend/middleware/validation.js:135`, new) —
  120–160 chars, cut at a sentence end or word boundary; returns `''`
  when the text is too short (never invents filler). A heading-strip bug
  found by testing is fixed there too: the heading-line regex would eat a
  whole single-line string, so single-line input strips only the `#`
  markers instead.

### B. Article-specific evidence isolation — `backend/agents/autonomy/factcheck.js`
- `loadEvidence` rewritten (lines 189–231): the pool is ONLY the article's
  own `article_sources` rows, each resolved to its stored `research_items`
  row by `research_item_id` (migration 012), else by `source_url`. A
  recorded source with no stored row contributes its title only. An
  article with no sources gets an EMPTY pool.
- `runCorrection` (line 348): with an empty pool it skips every failed
  claim for human review and leaves the body untouched — it must NOT
  reach for unrelated sources. Conflicts are preserved (a CONFLICTING
  claim is corrected only when relevant evidence supports the rewrite;
  otherwise it is removed or left for review per the existing rules).
- Every applied correction now records its supporting source:
  `article_corrections.evidence_url` (migration 012; insert at lines
  432–435; `null` for removals, which use no source). Claim checks keep
  `evidence_url` + `evidence_quote` provenance as before.
- Regression tests in `tests/activation-repairs.test.js` prove the #27
  scenario cannot recur (same-division unrelated item + cross-division).

### C. Source persistence — `backend/agents/autonomy/content.js` + migration 012
- `convertScaffoldToDraft` (lines 264–380): source types now use only the
  CHECK-allowed values (`'research'` for a resolved RSS item, `'other'`
  otherwise); `research_item_id` is stored from the scaffold's resolved
  evidence or a fresh URL lookup; inserts are idempotent (same
  article+URL, or same article+title for non-URL sources, is skipped and
  counted as `sourcesDeduped`); failures are REPORTED
  (`sourceErrors[]` + a `warning` when 0 of N sources could be recorded)
  instead of swallowed. Returns `{ ok, article, sourcesRecorded,
  sourcesDeduped, sourceErrors, warning? }`.
- The convert endpoint surfaces these fields
  (`backend/routes/orchestrator.js:623`, `handleScaffoldConvert`), so the
  dashboard/owner can see when a draft is unsourced.
- **Migration 012** (`database/migrations/012_source_links.sql` +
  `database/console-chunks/migration-012_source_links.sql`, pure ASCII):
  `ALTER TABLE article_sources ADD COLUMN research_item_id INTEGER
  REFERENCES research_items(id)` + index; `ALTER TABLE article_corrections
  ADD COLUMN evidence_url TEXT`. Additive only, verified on real local
  SQLite (applies cleanly after 001–011; re-apply correctly fails as a
  one-shot). `package.json` `db:migrate` and `scripts/restore-backup.js`
  now include 012. **NOT applied to live D1** — the parent applies it via
  the API token after review.

### D. Fact-check + correction pipeline — kept, not weakened
- The claim-level pipeline is unchanged in structure (extract → match
  article-specific evidence → VERIFIED/UNSUPPORTED/CONFLICTING/UNVERIFIABLE
  → record provenance → correct only with relevant evidence → preserve
  original + history → re-check → max 3 attempts → unresolved to human
  review). `fact_checked` is still never set by the agent (only the gate
  sets it on publish). A successful correction does NOT auto-verify the
  whole article — the re-check verdict is recorded per claim and the gate
  reads the latest `fact_checks` row.
- Behaviour change (documented in the test): an UNVERIFIABLE claim with
  NO evidence at all is now marked for human review instead of being
  deleted (`tests/factcheck-claims.test.js`, test renamed with a note).

### E. SEO repair — `backend/agents/autonomy/seo.js`
- New `repairSeoFields(env, article)` (lines 212–295): repairs inadequate
  fields on DRAFTS from the article's own real content — meta description
  regenerated from the body when missing or outside 120–160 chars;
  over-long SEO title truncated at a word boundary; H3 headings promoted
  to H2 when the body has <2 H2s but ≥2 H3s (formatting only — the HTML
  path promotes the same number of closing tags as openings); a "Related
  reading" line appended linking the newest published sibling in the same
  division when the body links none and one exists (a real link — never
  faked). Published articles are NEVER modified. Every repair stores a
  pre-edit `article_revisions` row first. Returns `{ repaired, repairs,
  repairedFields, article }`.
- `runSeo` (lines 297–351) now repairs first, then measures; the return
  keeps `filled` as field names (backward-compatible) and adds `repairs`
  (human-readable strings). Failed checks now carry actionable detail
  ("Fix: ..." per check, e.g. meta-description, heading-hierarchy,
  internal-links).
- `runSeoCheckSuite` itself is unchanged (11 checks, per-check results
  already stored as `seo_checks.checks_json` — verified).

### F. Publishing gate visibility — no logic change
- `backend/publishing/gate.js` is UNCHANGED in logic (all 10 checks strict).
  Its return already contains the full breakdown (`checks[]` with
  name/ok/detail, `contentReady`, `eligible`, `blockedBy`,
  `contentBlockers`, `publishingMode`) — verified by a data-contract
  regression test (`tests/activation-repairs.test.js`, "repair F").
- New endpoint `GET /api/autonomy/seo?article_id=`
  (`backend/routes/orchestrator.js:599`, registered line 721): latest
  `seo_checks` row with the 11 checks parsed, mirroring
  `handleFactChecks`. (`GET /api/autonomy/gate?article_id=` already
  returned the full 10-check breakdown.)
- Dashboard (`frontend/scripts/autonomy.js:712`, `loadFactCheckDetail`):
  the existing "Details" button now fetches fact-checks + gate + SEO
  together and renders claims, all 10 gate checks, all 11 SEO checks,
  and the five states spelled out separately: content-ready /
  fact-check-passed / SEO-passed / eligible / authorized-to-publish
  (with the publishing mode named). Content-ready is NOT automatically
  eligible.

### Registry fix — `backend/agents/autonomy-runner.js:36`
- `DIVISION_RESEARCH_REGISTRY` now has all 8 divisions, including
  `'digital-tools': 'digital-tools-agent'`. Pausing the Tools agent now
  blocks digital-tools research tasks (the scheduler's division-less
  pause check reads the registry dynamically —
  `backend/routes/scheduler.js:146` — so it automatically covers 8).
- `backend/routes/orchestrator.js:52` has the same 8-entry list for the
  status endpoint, and its research-collective note now says 8 divisions.
- Dashboard note added (`frontend/scripts/autonomy.js`, Task queue
  section): a division-less research task skips only when EVERY
  division's research agent is paused.

### RSS counter reconciliation — no counting bug in the counters
- Definitions (now documented in code + dashboard text):
  `items_discovered` = **cumulative newly-inserted items** for that
  source; `duplicates_found` = **cumulative items skipped as duplicates
  at fetch time**. Per fetch: `fetched = added + duplicates`.
  `SUM(items_discovered)` over all sources must equal
  `COUNT(research_items)` — it does (693 = 693 at baseline).
- Verified: `markSourceOk` (`backend/rss/sources.js:55`) only ever
  increments the stored counters; `loadAllSources` is a plain SELECT —
  there is NO recompute-on-load anywhere, and the dashboard displays the
  stored values directly. A dashboard refresh cannot change historical
  statistics. Proven by regression test ("reading the sources list twice
  does not change any stored counter").
- The 19 Nov anomaly (digital-tools duplicates 0→50/10/40, total 52→152,
  research_items unchanged at 693) is EXACTLY consistent with each of
  the three digital-tools sources having been fetched TWICE (2nd fetch:
  0 added, all items duplicates: 50+10+40 = 100). The counters were
  correct; the extra fetch is the question. No fetch audit log exists
  (`research_sources` keeps only `last_fetched_at`, no history), so the
  exact trigger cannot be proven from data — see §9 open item 1.
  Candidate triggers: a double-clicked "Fetch now" (now hardened) or a
  division-scoped research run for `digital-tools`, which re-fetches
  exactly those 3 sources and nothing else (§9 item 12).
- Hardening (most plausible trigger — an accidental double-click /
  double-tap): the "Fetch now" and source-toggle buttons are now
  disabled while their request is in flight
  (`frontend/scripts/autonomy.js`, source-list click handler), as is the
  daily-run button. The dashboard sources section now states the counter
  definitions in plain text.
- Regression tests: fetch-twice identity (`items_discovered` unchanged by
  a re-fetch, `duplicates_found` accumulates, `SUM == COUNT`) and the
  read-twice identity.

### Daily workflow button — `backend/routes/orchestrator.js:473`, `frontend/scripts/autonomy.js:832`
- Server: `handleRunDaily` now returns an explicit `status`:
  `'completed'` (the workflow ran), `'already_completed'` (it already ran
  today and force was NOT requested — a no-op, not a success),
  `'blocked'` (E-Stop; 423 also carries `status: 'blocked'`).
  `runDailyWorkflow` itself was already correct (force + duplicate
  prevention + E-Stop + upsert); only the reporting was missing.
- Dashboard button now sends `{ force: true }` (a manual click IS the
  explicit re-run the task specifies) and displays the real status plus
  readable counts (`research fetched: N, items stored: N, content
  enqueued: N, …`), never a bare "Daily workflow finished."
- "[object Object]" fixed: new `stringifyReportValue`
  (`frontend/scripts/autonomy.js:476`) renders nested objects as
  `key: value` pairs (steps as `name: outcome`); verified by a sandboxed
  node check against the real 19 Nov summary shape — output is now
  `steps: healthCheck: done; researchFetch: done; …; counts:
  researchFetched: 693; …` with no `[object Object]`.

### Dashboard automation state — `frontend/scripts/autonomy.js:267` (`loadStatus`)
- Auto-flag KPI cards added (data was already in the status payload but
  never shown): each of the 5 `auto_*` flags shows ON/OFF, what it gates,
  and why it is off.
- Agents list now shows, per agent: last run time + outcome + failure
  reason when a run failed ("no run recorded yet" otherwise), and the
  reason for being disabled (paused by owner / disabled / preparation
  only). Backend: `handleStatus` now returns `lastRuns`
  (`backend/routes/orchestrator.js:212`, newest `agent_runs` row per
  agent, reason extracted from the detail JSON).
- Controls note now states the real schedule from `config/wrangler.toml`
  + `backend/worker.js:155`: daily workflow 00:00 UTC (06:00 Dhaka)
  daily; weekly Sundays 00:00 UTC; hourly publish-due check.
- `backend/routes/orchestrator.js:148` `agentStatuses` research note
  updated to 8 divisions.

## 4. Model-availability verdict (20 Nov 2026)

Verified by the research subagent against official Cloudflare docs only
(changelog 5 Nov 2026, model catalog, pricing page, per-model pages —
all crawled 19 Nov 2026 ~18:10 UTC, i.e. the last snapshot BEFORE the
cutoff; "AVAILABLE" means: not on the official 24-model removal list,
present in the catalog, and no "Planned deprecation" badge on its model
page). The removal takes effect today: requests to removed models fail
with HTTP 410 / error 5028. **These verdicts are docs-based, not
live-tested — a live call per model is still needed to confirm
post-cutoff behaviour (parent live verification).**

| Model | Verdict |
|---|---|
| `@cf/openai/gpt-oss-20b` | AVAILABLE (proven live 19 Nov, 5 calls) |
| `@cf/google/gemma-4-26b-a4b-it` | AVAILABLE (Cloudflare-recommended small replacement) |
| `@cf/zai-org/glm-4.7-flash` | AVAILABLE (Cloudflare-recommended replacement) |
| `@cf/openai/gpt-oss-120b` | AVAILABLE (proven live 19 Nov, 2 calls) |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | AVAILABLE |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | AVAILABLE (last resort: 24K context, costly output) |
| `@cf/ibm-granite/granite-4.0-h-micro` | AVAILABLE (emergency cheap fallback only) |
| `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | **UNCONFIRMED — REMOVED from the list** (absent from the official catalog; the near-identical `@cf/meta/llama-3.1-8b-instruct-fp8` IS on the 20 Nov removal list) |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | REMOVED today (explicitly #1 on the removal list) |
| `@cf/google/gemma-3-12b-it` | REMOVED earlier (30 May 2026) |
| `@cf/qwen/qwen3-32b` | NOT a Workers AI model ID (no official page) |

- Free tier unchanged: 10,000 Neurons/day, resets 00:00 UTC
  (pricing page, updated 2026-11-18). The 9,000-Neuron safety cap is
  respected by `generateText` (pre-seeded usage blocks the provider).
- Do NOT add the Cloudflare-recommended replacements
  `@cf/deepseek-ai/deepseek-v4.1-flash-1017` or `@cf/zai-org/glm-5.3` —
  they are NOT free-tier (Paid plan / AI Gateway credits).
- Pricing-page presence alone proves nothing (it still lists removed
  models — stale). The previous report's "these survive" claim was
  correct for 4 of 5 configured models and wrong/unsupported on the
  Llama entry.
- Change made: `WORKERS_AI_MODELS` in
  `backend/llm/providers/cloudflare-workers-ai.js:60` is now the 7-model
  ordered fallback above (20b first, granite last); the stale
  `llama-3.1-8b-instruct-fp8-fast` entry and its Neuron rate are gone;
  `NEURON_RATES` gained granite (1,545 in / 10,182 out per 1M tokens,
  derived from $0.017/$0.112 at $0.011 per 1,000 Neurons). The file
  header now records the verification date and sources. Usage logging
  (`llm_usage`: provider/model/neurons per call) was already in place
  and is unchanged.

## 5. Activation checklist (per feature)

Code verified; live flags are NOT flipped by this task (the parent does
live D1 changes after verification). "Safe to turn ON" means the code
path is verified and gated — the owner still authorizes each switch.

| Feature | Verdict | Reason / evidence |
|---|---|---|
| `auto_research` | **PASS** | Gates the research-fetch step (`scheduler.js:375`); registry now complete (8 divisions); RSS counters reconciled. Turning it on makes the daily workflow fetch all 24 feeds (fetching is free; no LLM cost). |
| `auto_generation` | **PASS** | Gates content-from-research (`scheduler.js:391`); generation is now evidence-grounded with `insufficient-evidence` no-op and recorded sources. |
| `auto_factcheck` | **PASS** | Gates the fact-check step (`scheduler.js:429`); evidence isolation proven by regression tests. |
| `auto_correction` | **PASS** | Gates the correction step (`scheduler.js:440`); corrections are evidence-isolated, max 3 attempts, provenance recorded. |
| `auto_publishing` | **KEEP OFF** | `publishing_mode` is `approved_only` (locked by the settings allowlist, `orchestrator.js:116`); the gate's `publishing-rules` check fails while it is, so `eligible` stays false even with the flag on. Needs a separate readiness report + explicit owner authorization — OUT of scope here. |
| `social_auto_post` | **KEEP OFF** | Must stay `off` (the settings API rejects `on`, `orchestrator.js:121`; no social posting capability exists — the social agent prepares packs only). Note: the flag is NOT read by any automation step — it is display-only; enforcement is at the settings API. |
| `publishing_mode` | **KEEP `approved_only`** | Same reason as `auto_publishing`. Nothing publishes without owner approval. |

### auto_* flag audit (every flag read, and whether it gates)
- `auto_research` — read at `scheduler.js:375`, gates the research-fetch
  step (no-op with reason when off). GENUINE.
- `auto_generation` — read at `scheduler.js:391`, gates content-from-
  research. GENUINE.
- `auto_factcheck` — read at `scheduler.js:429`, gates the inline
  fact-check step. GENUINE.
- `auto_correction` — read at `scheduler.js:440`, gates the inline
  correction step. GENUINE.
- `auto_publishing` — read at `scheduler.js:486` (publish-due step) AND
  at `gate.js:140` (publishing-rules check). GENUINE — but inert while
  `publishing_mode` is `approved_only`.
- `social_auto_post` — read NOWHERE as a gate. Only validated (must be
  `off`) and displayed. No posting capability exists, so the risk is nil
  while `off`; if auto-posting is ever considered, wire the flag into the
  social-prep step first. NOT a blocker for activation.
- `publishing_mode` — read at `gate.js:139` and enforced at
  `orchestrator.js:116`. GENUINE.
- **No-gate steps in the daily workflow (verified, by design of the
  existing code):** `seoRun` (`scheduler.js:455-463`) runs `runSeo` on up
  to 3 drafts/pending articles on EVERY daily invocation with NO `auto_*`
  gate — so, now that `runSeo` repairs, it will repair up to 3 drafts
  per daily run even with all auto flags off. Drafts only, revision
  stored first, published never touched; the repair is the SEO agent's
  ordered job (§3E), so this is documented behaviour, not a bug — but
  the owner should know it. `publishGate` (evaluation) and `publishDue`
  are likewise ungated as measurements, but PUBLISHING itself is gated
  by `auto_publishing` + `publishing_mode` (see above). Manual task runs
  (`runTask`/`runAutonomyTask`) never consult any `auto_*` flag — the
  flags gate only daily-workflow steps.
- Provider order note: `llm_provider_order` in live D1 is
  `workers-ai,groq,gemini`, but Groq/Gemini have no keys configured, so
  they return `not-configured` and are never called — inference in
  practice is Workers AI only, and every attempt is logged in
  `llm_usage`. No silent provider switch is possible without a key being
  added. (Not changed: removing the inert fallbacks would churn tests
  for no live effect; flagging for the parent's awareness.)

## 6. Migrations

- **012** (`database/migrations/012_source_links.sql` + console chunk):
  `research_item_id` on `article_sources` (+ index) and `evidence_url`
  on `article_corrections`. Additive only. Verified on real local
  SQLite. **Not applied to live D1.**
- `package.json` `db:migrate`, `scripts/restore-backup.js`, and all 11
  test DB builders now include 012.

## 7. Tests

- **Before:** 630 pass / 0 fail, 140 suites. **After:** **648 pass / 0
  fail, 148 suites** (`npm test`, ~10 s). No test deleted or weakened.
- **New file** `tests/activation-repairs.test.js` (17 tests, 8 suites):
  evidence isolation (same-division #27 case, correction provenance,
  cross-division), source persistence (idempotency, allowed types,
  research links, unsourced-gate distinction), SEO repair (short
  description, H3→H2, internal link, published untouched), gate
  visibility data (10 checks, content-ready vs eligible), daily-run
  endpoint status (completed / already_completed / force / blocked),
  SEO endpoint + status lastRuns, RSS counter reconciliation (fetch-twice
  + read-twice identities), registry + model list.
- **New test** in `tests/autonomy-content-draft.test.js`:
  `insufficient-evidence` no-op (LLM never called for an unresolvable
  source).
- **Updated tests (old behaviour asserted — each updated with a note
  explaining the fix, never silently):**
  - `tests/factcheck-claims.test.js` (5): four tests now link their
    article source explicitly (isolation); the UNVERIFIABLE-claim test
    now asserts skip-for-human-review instead of removal.
  - `tests/seo-checks.test.js` (1): second run now asserts an inadequate
    owner description (101 chars) IS repaired while a passing title is
    untouched; header comment updated.
  - `tests/autonomy-content-draft.test.js` (mission + E-Stop + LLM-failure
    tests): mission now seeds real research evidence; the LLM-failure
    test now genuinely reaches the LLM; convert test asserts
    `sourcesRecorded` + the stored `article_sources` row.
  - `tests/autonomy-llm.test.js` (2): content-agent tests seed evidence
    and assert `draft.evidence`/`sourceIds`; the no-provider test now
    asserts the LLM-unavailable reason (not the evidence reason).
  - `tests/autonomy-agents.test.js` (2): scaffold no-op test seeds
    evidence; SEO fill test now uses a draft (published articles are
    never modified).
  - `tests/research-rss.test.js` (2): registry tests now expect 8
    divisions incl. digital-tools.
  - `tests/scheduler-fixes.test.js` (1): `RESEARCH_AGENT_IDS` now
    includes `digital-tools-agent`.
- **Verified separately (no frontend test harness exists in this repo):**
  `node --check` passes for `frontend/scripts/autonomy.js` and
  `backend/routes/orchestrator.js`; the `[object Object]` fix was checked
  by evaluating the extracted `reportSummaryText`/`stringifyReportValue`
  against the real 19 Nov summary shape in node (no `[object Object]`,
  steps/counts render readably). Dashboard changes still need a live
  browser check (parent).

## 8. Files changed

Backend:
`backend/agents/autonomy/content.js`, `backend/agents/autonomy/factcheck.js`,
`backend/agents/autonomy/seo.js`, `backend/agents/autonomy-runner.js`,
`backend/llm/providers/cloudflare-workers-ai.js`,
`backend/middleware/validation.js` (`deriveSeoDescription`),
`backend/routes/orchestrator.js` (registry list, run-daily status, SEO
endpoint, status `lastRuns`, convert response fields),
`backend/routes/scheduler.js` (no logic change — verified flag gating;
only the division-less pause check already read the registry).

Frontend: `frontend/scripts/autonomy.js` (report stringifier, daily-run
button force+status+disable, fetch/toggle button disable, gate+SEO
detail, auto-flag cards, per-agent last runs, counter definitions,
division-less note, schedule note).

Database: `database/migrations/012_source_links.sql`,
`database/console-chunks/migration-012_source_links.sql`,
`package.json` (`db:migrate`), `scripts/restore-backup.js`.

Tests: `tests/activation-repairs.test.js` (new),
`tests/autonomy-content-draft.test.js`, `tests/autonomy-llm.test.js`,
`tests/factcheck-claims.test.js`, `tests/seo-checks.test.js`,
`tests/autonomy-agents.test.js`, `tests/research-rss.test.js`,
`tests/scheduler-fixes.test.js`, `tests/autonomy-scheduler.test.js`,
`tests/autonomy-analytics.test.js`, `tests/backup-restore.test.js`,
`tests/backup-runs.test.js`, `tests/publish-gate.test.js`,
`tests/sources-api.test.js` (012 added to DB builders).

## 9. NOT fixed / open items (exact reasons)

1. **The exact trigger of the 19 Nov digital-tools double-fetch is
   unproven.** The counters were verified correct and a refresh cannot
   change them; the most plausible trigger (double-click/double-tap on
   "Fetch now") is hardened by disabling the button in flight. No fetch
   audit log exists (`research_sources` keeps only `last_fetched_at`),
   so the trigger cannot be reconstructed from data. If it recurs,
   correlate `last_fetched_at` with the verification session's actions.
2. **Model verdicts are docs-based, not live-tested.** The researcher's
   sources were crawled 19 Nov (pre-cutoff). A live call per model is
   still needed to confirm post-cutoff behaviour.
3. **Dashboard changes have no automated test.** The repo has no
   frontend test harness. Verified by syntax check + sandboxed functional
   check + review; a live browser check is still needed.
4. **Article #26 can never pass as-is** (sourceless, 0/20 VERIFIED).
   Untouched per instructions. It needs its own research + regeneration
   — an owner decision, out of scope here.
5. **The 14-step daily workflow has never run live with auto flags on**
   (each step no-ops while its flag is off). The first live run with
   flags on will exercise those paths for the first time — watch it.
6. **GA4 Data API still not connected** (traffic "Data unavailable") —
   out of scope; needs owner authorization.
7. **Live backup restore still NOT TESTED** — out of scope; needs an
   owner-authorized live test.
8. **`social_auto_post` is display-only** (not read by any automation
   step; enforcement is at the settings API). No risk while `off`.
9. **The daily report's `[object Object]` is fixed in the dashboard
   renderer**, but the 19 Nov stored report row itself still contains
   the nested summary — historical rows are not rewritten (correctly).
10. **Re-creating a content task with the same title on the same day
    silently drops the new sources.** `enqueueTask` is idempotent on
    `idempotency_key` (`manual-content-<slug>-<date>`), so the second
    create returns the existing task with `duplicate: true` and the new
    payload — including any new/changed sources — is discarded
    (confirmed by the inspection subagent). The dashboard does tell the
    owner "this task already existed (same title today)", so it is not
    fully silent, but the new sources are still lost. Changing
    idempotency semantics was out of scope for this repair; if the owner
    wants re-creation to update sources, that is a separate small change
    (update the existing task's payload on duplicate).
11. **`handleAnalytics` computes the 10 gate checks per draft but drops
    the `checks` array** (returns only `contentReady`/`eligible`/
    `blockedBy`). The per-draft gate breakdown is instead fetched
    on-demand by the Details button (`GET /api/autonomy/gate`) — a
    deliberate choice to avoid bloating the analytics payload with 10
    checks × 20 drafts.
12. **A division-scoped research run is a second candidate trigger for
    the 19 Nov duplicates jump** (in addition to a double-clicked
    "Fetch now"): `runResearch` for `digital-tools` re-fetches exactly
    those 3 sources and nothing else. Still unprovable from data (see
    item 1).

## 10. Handoff for the parent (push + live verification)

1. Apply migration 012 to live D1 via the API token (console chunk is
   pure ASCII), then push this local source (regenerate the zip; the
   parent owns the GitHub push).
2. Live checks to run after deploy: (a) one live call per Workers AI
   model in the new list (confirm post-cutoff availability + Neuron
   accounting); (b) dashboard: run the daily workflow from the button
   (expect `completed` + counts), create a content task with a real
   source URL → run → convert → confirm 1 `article_sources` row with
   `source_type='research'` + `research_item_id`; open a draft's Details
   → confirm 10 gate checks + 11 SEO checks render; (c) confirm the
   sources table counters are unchanged by a plain reload; (d) do NOT
   flip any `auto_*` flag or `publishing_mode` until the readiness
   report + explicit owner authorization.
3. Do NOT write the final owner report from this file alone — the parent
   writes `docs/FS-AI-Autonomous-Operation-Report.md` after the live
   verification above.
