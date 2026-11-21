# FS AI — Full Autonomous Implementation Report

**Date:** 2026-11-21
**Owner briefs:** Full autonomous implementation (2026-11-21 12:03) + Zero-Failure Operational Design (2026-11-21 12:05)
**Author:** Implementation coordinator (subagent session 7795c931)
**Deployed HEAD: e5f7aa3 — NOTHING IN THIS REPORT HAS BEEN DEPLOYED. All implementation below is LOCAL-ONLY in `~/workspace/fs-ai-source/fs-ai/`, uncommitted, unpushed. The live site still runs the pre-implementation code.**

> **Read this first.** The implementation is complete and the full local test suite is green (**1106 pass / 0 fail**, baseline 894). But no line of it is live. Enabling it requires the parent to deploy (Section 12) and the owner to authorize, per platform and per article (Section 13). Until then the live system behaves exactly as it did before today: approved-only publishing, no queue drain, no social posting, no auto-publish.

---

## 1. Executive summary

### What the owner ordered

1. **12:03 — full autonomous implementation** ("sob kicu fully fix koro jate finally full automation hoi with social media"): fix everything found in the pre-weekly investigation, implement the queue engine, fact-check/pipeline repairs, autonomous publishing with strict gates, social media management (official free integrations only), all eight divisions, Google Studio auth workflow, analytics + admin control center — all at $0.
2. **12:05 — zero-failure operational design** (binding on every component): prevent failures (pre-flight validation), automatic recovery (backoff, leases, timeout recovery, idempotency, dead-letter), zero stale data (body-hash-tied checks, fail-closed), zero unresolved tasks (five terminal states only), per-platform social reliability, daily self-health check, failure alerts with exact task ID + root cause, and a final reliability acceptance test simulating 11 failure scenarios.

### What was done

- The pre-weekly investigation (Tasks 1–4) was completed first; its root causes are the foundation of every fix (Section 2).
- Five workstreams were implemented in parallel in isolated copies, then merged by the coordinator into the local tree, wired together, and tested end to end:
  - **W1 — Queue / task engine:** automatic drain, leases, timeout recovery, idempotency, exponential backoff, dead-letter, health check, terminal states.
  - **W2 — Fact-check / pipeline repairs:** #30 trailing-citation validation defect, truncation guard, correction-failure honesty, SEO snapshot ordering, #29 scaffold regeneration, SEO body hash.
  - **W3 — Autonomous publishing + divisions:** 14-check eligibility evaluator, auto-publish with rollback, publication logs, Dhaka-day daily limit, genuine-relevance internal links, Health/Finance special review, per-division configuration for all 8 divisions.
  - **W4 — Social media:** official-API research for 6 platforms, adapters + dispatcher + token encryption + owner-only routes for 5 supported platforms, X classified unavailable free.
  - **W5 — Dashboard / Control Center + analytics + YouTube auth:** real-data analytics detail, health endpoint, Control Center UI (Bangladesh time), YouTube auth investigation (nothing stored anywhere — browser session only).
- **Coordinator fixes found by the acceptance test** (Section 5): a rollback bug (updated_at stamp made SEO stale), a sitemap gap (newly published articles would never appear in the checked-in sitemap), a stale-lock self-healing gap (recovered tasks sat `failed` waiting for a manual retry), and three test-file bugs (not code bugs).
- **Reliability acceptance test: 15/15 pass** — all 11 failure scenarios plus repeated scheduled-cycle tests (Section 6).
- **Full merged suite: 1106 pass / 0 fail** (Section 9).

### Feature status at a glance

| Feature | Status |
|---|---|
| Queue drain, leases, backoff, dead-letter, health check | IMPLEMENTED BUT NOT LIVE-VERIFIED |
| Fact-check integrity (body hash, fail-closed gate) | LIVE AND VERIFIED (migration 019, live since 2026-11-20) |
| #30 trailing-citation fix, truncation guard, honest correction failure | IMPLEMENTED BUT NOT LIVE-VERIFIED |
| SEO body hash, revision snapshot fix | IMPLEMENTED BUT NOT LIVE-VERIFIED |
| #29 scaffold regeneration (function + task handler) | IMPLEMENTED BUT NOT LIVE-VERIFIED |
| Autonomous publishing gates + auto-publish + rollback + publication logs | IMPLEMENTED BUT NOT LIVE-VERIFIED |
| Auto-publish enablement | WAITING FOR OWNER AUTHORIZATION (three deliberate actions, Section 13) |
| Existing drafts #28/#29/#30/#31 auto-publish | NEVER — needs separate per-article owner authorization each |
| Pinterest API integration | IMPLEMENTED BUT NOT LIVE-VERIFIED — WAITING FOR OWNER AUTHORIZATION (OAuth) |
| Facebook Page API integration | IMPLEMENTED BUT NOT LIVE-VERIFIED — WAITING FOR OWNER AUTHORIZATION (OAuth) |
| Instagram API integration | IMPLEMENTED BUT NOT LIVE-VERIFIED — WAITING FOR OWNER AUTHORIZATION (OAuth) |
| LinkedIn (own profile) integration | IMPLEMENTED BUT NOT LIVE-VERIFIED — WAITING FOR OWNER AUTHORIZATION (OAuth) |
| YouTube Data API integration | IMPLEMENTED BUT NOT LIVE-VERIFIED — DO NOT USE YET (Testing consent screen: uploads land PRIVATE; needs Production + audit first) |
| X (Twitter) | UNAVAILABLE FREE OF COST (no free tier for new developers since Feb 2026) |
| Control Center dashboard + analytics detail + health endpoint | IMPLEMENTED BUT NOT LIVE-VERIFIED |
| YouTube session (browser) | LIVE AND VERIFIED (manual session, Short #05 published 2026-11-21 11:45) — no API connection exists |
| Weekly automation run, 2026-11-22 06:00 Dhaka | LIVE AND VERIFIED as scheduled (runs on CURRENT deployed code, not this build) |
| Search Console indexing retry | Still outstanding (was due 2026-11-21) — NOT part of this build |
| Saved 406 Google password (rejected 2026-11-21 morning) | FAILED (still unverified-bad; owner action needed — Section 8) |
| Dashboard Delete button (8 failed attempts 2026-11-20) | FAILED (appears broken; out of scope, not fixed) |

### Cost

**$0.00.** No paid API, hosting, automation, or subscription was introduced anywhere. Live D1 usage at verification: 47 Workers AI calls / 778 Neurons in 7 days, all Workers AI, all within the free allowance. Revenue $0.00. Traffic "Data unavailable" (honest — no analytics account connected).

### What still needs the owner

1. **Deploy authorization** — the parent deploys this build (Section 12) only on the owner's go-ahead.
2. **Auto-publish enablement** — three deliberate actions (Section 13.1). Absent any one, nothing auto-publishes.
3. **Per-platform OAuth** — Pinterest, Facebook, Instagram, LinkedIn, YouTube (Section 13.2). Nothing connects without it.
4. **Per-article authorization** for #28, #29, #30, #31 — each separately, if they are ever to be published at all.
5. **YouTube sign-in** if the browser session expires — exact steps in Section 8.
6. **Dashboard steps** the parent runs after deploy: Re-check #30 (Section 11.1), regenerate #29 (Section 11.2).

---

## 2. Investigation findings (Tasks 1–4) — the foundation

Full detail: `docs/FS-AI-WEEKLY-RUN-VERIFICATION-2026-11-22.md` (delivered, commit e5f7aa3) and the pre-weekly repair investigation. Root causes, exact:

### 2.1 Task 1 — #29 fact-checks failed (fc 9, fc 10)

**Root cause: the article has no real content.** #29 (593 chars) is a scaffold shell: "SCAFFOLD — full draft needed" plus six empty "[Write this section — no content yet.]" sections. fc 9 (2 claims, 0 verified, 2026-11-20 05:07:03) and fc 10 (0 claims, 05:07:57) both verdict FAILED via the checker's SCAFFOLD rule — the checker worked correctly. Evidence exists (article_sources id 2 → research_items 381, Guardian Austin, fetched 2026-11-19 17:07:18) but is irrelevant with 0 claims. **Real fix: regenerate a real body from its own evidence, then fact-check.** A dashboard Re-check on #29 is safe but will return FAILED again until the body is rewritten.

### 2.2 Task 1 — #30 stale fact-check (fc 16) and correction task #31

**Three defects, all in code:**

1. **Trailing-citation validation defect (real code defect, deterministic).** Every content paragraph of #30's body ends with an inline `\u00a0[The Guardian](url)` citation link. `paragraphIssues` (backend/agents/autonomy/factcheck.js:859–876) requires a paragraph to end with terminal punctuation — a paragraph ending in "…guide)" fails. `validateCorrectedBody` (:970–1003) exempts pre-existing issues, BUT its dedup key is `para:` + the paragraph's **first 120 chars** — any correction rewriting a sentence in such a paragraph changes the key, so the pre-existing trailing-link defect is counted as NEW. The two flagged paragraphs are exactly where rewrites landed; the Day-2 paragraph (sentence only removed, first 120 chars unchanged) was NOT flagged — confirming the mechanism. It will repeat on a third Correct click.
2. **Truncated correction output.** The LLM's corrected body was cut off mid-sentence ("If you only have three days to explore New York City, a local's travel guide can") and mid-word ("Three days are broke" — cut-off "broken") — likely token-budget cut-off.
3. **Dishonest outcome.** `runCorrection` returns outcome `'done'` even when validation rejects everything (factcheck.js:1285–1296, corrected: 0, validationRejected: true) — so runTask marks the task done and the status lies.

**fc 16 staleness confirmed on TWO grounds:** body_hash NULL (created 05:50:42 UTC, ~12.4h before migration 019 applied 18:15 UTC) AND the body DID change after fc 16 (4501 → 4615: the SEO repair appended a 114-char Related-reading line at 05:52:22 AFTER writing the revision snapshot — article_revisions 10 stores 4501 chars, live body 4615). Same 114-char pattern on #29 (479 → 593).

**Judge flip-flop 14→15→16** (same 20 claim texts, previous_verdict NULL everywhere): no carry-forward happened because all three rows have evidence_signature NULL, and P6 carry-forward requires a non-null matching signature (factcheck.js:523–531). Already fixed going forward by migration 019 + content-hash signatures.

**Task #31 `attempts: 0 + status: failed`, updated_at exactly 2026-11-20T11:48:00.000Z, no agent_runs/agent_logs anywhere 11:30–12:00 on 11-20 — cannot be produced by current worker code;** most consistent explanation is a direct D1 UPDATE outside the worker at 11:48 (manual marking). Confirm with whoever had D1 access at 11:48 on 11-20 rather than assuming a code bug.

**#30 dashboard Re-check is SAFE** (handleRecheckArticle, orchestrator.js:1187, reuses task 31, forces kind to 'fact-check', fails loudly HTTP 500 if no new row) and the right next step — expected new row id 17+, check_kind='recheck', body_hash present + matching, verdict needs-review. **Do NOT click Correct on #30 first.**

### 2.3 Task 2 — Queue backlog (12 queued tasks)

**Root cause: the daily workflow NEVER drained the queue.** `runDailyWorkflow` (scheduler.js:719+) enqueues tasks then does the same work inline; `runTask` (scheduler.js:431-573) has exactly TWO call sites in the whole backend, both dashboard HTTP handlers (orchestrator.js:384 handleRunTask, :1268 re-check). The three done daily-research tasks (1, 2, 11) were manual dashboard runs; tasks 9/10/12/13/28 were skipped by runTask under E-Stop on 11-19/11-20. Side effect: the 11-21 run reported `contentEnqueued: 1` but produced NO article.

**Classification (re-verified live 2026-11-21):** 12 queued, all attempts 0, max_attempts 3, scheduled_for NULL: #3, #4 (daily-research, 2026-11-15, digital-tools/education-learning), #5, #6 (11-16), #7, #8 (11-17), #22, #23 (daily-research 11-20), #24 (daily-content 11-20, research item 696, "M State's Detroit Lakes campus…"), #35, #36 (daily-research 11-21), #37 (daily-content 11-21, research item 709, "Education Department faces management challenges…"). Neither content task duplicates an existing article (verified; content.js:202-210 also refuses on duplicate slug/title).

**Gaps found:** (a) claim is read-then-UPDATE without `WHERE status='queued'` (scheduler.js:506-508) — race; (b) `scheduled_for` is write-only, nothing reads it; (c) max_articles_per_day=1 enforced ONLY at enqueue time (scheduler.js:786), content handler has no cap check.

**Safe processing order (proposed, NOT executed):** #37 first, #35/#36 as smoke test, #24 next day (1/day cap), #22/#23/#3–#8 do NOT run (superseded — leave queued pending owner decision; do not delete).

### 2.4 Task 3 — Weekly automation readiness: READY WITH CAVEATS

Schedule armed/live-proven; weekly path is READ-ONLY (scheduler.js:972-1115: E-Stop check, recoverStaleTasks, duplicate guard, only SELECTs, writes one report row + one agent_runs row; no publish/enqueue/article UPDATE/no LLM call; cannot publish or touch #26/#27/#31). No duplicate schedule (only one wrangler config; `setInterval` in autonomy.js:1447 is dashboard polling; `setTimeout` in scheduler.js:107 is the 10-min task-lease timer). No accidental manual execution (no daily_reports row dated ≥ 2026-11-22; 0 running tasks; latest agent_runs id 139, 2026-11-21 01:19:52Z). Manual weekly report id 10 (2026-11-20) is distinct and does not arm/block the 22 Nov run.

**Latent trap (not a live defect):** backend/worker.js:189–191 also exports a *named* `scheduled()` that runs ONLY `publishDueArticles` (no daily/weekly); src/index.js:18 re-exports it; production cron uses the default export's `scheduled` (proven live) — but if anything ever wires the named export to the cron, daily/weekly would silently stop.

### 2.5 Task 4 — Final safety check (re-verified live 2026-11-21, after the build)

See Section 10 for the fresh values. All protections hold: published 25, #26/#27 unchanged, #31 draft, auto-publishing/correction/social OFF, E-Stop OFF, Workers AI only, $0.00.

---

## 3. Implementation — per workstream

All code below is in the local tree only. Per-stream test counts were measured in each stream's isolated copy before merge; the merged total is in Section 9.

### 3.1 W1 — Queue / task engine

**Files:** `backend/routes/scheduler.js` (drain + claim + wiring), `backend/services/healthcheck.js` (NEW), `database/migrations/020_task_lifecycle_health.sql` (NEW), tests `queue-drain`, `task-lifecycle`, `healthcheck` (45 new). **In its copy: 939 pass / 0 fail (was 894, +45).**

- **Drain step `drainTaskQueue`** in `runDailyWorkflow` after the E-Stop check + `recoverStaleTasks`, before enqueue steps. Only `status='queued' AND (scheduled_for IS NULL OR scheduled_for <= now)`, oldest-first, cap 10/run, stop after 3 consecutive failures, no-handler kinds skipped, daily-content cap re-counted before each content task, health-check gate, per-task results in the daily report.
- **Conditional claim** `UPDATE … WHERE id=? AND status='queued'` (fixes the read-then-UPDATE race).
- **Backoff now exponential** 15·2^(attempts-1) min, capped 240 (attempts 1–2 still 15/30 min, so existing timing is preserved).
- **Permanent errors narrowly defined** (unknown agent / malformed payload only); a missing article, failed fetch, LLM quota error, or handler error is TEMPORARY and re-queues.
- **Health check** `runHealthCheck(env)` — 10 checks, no AI probe call, persists to `system_health_checks`, pre-020 fallback.
- **Terminal states** on every task (`agent_tasks.terminal_state/terminal_reason/last_error` + `system_health_checks` table, migration 020).
- **Stale-lock recovery — coordinator change (Section 4.3):** a stale lock with attempts left now RE-QUEUES automatically with backoff (was: left `failed` for a manual retry). Exhausted attempts → `failed` + FAILED_FINAL_WITH_RECOVERY_REPORT.
- Note: `package.json` `db:migrate` still ended at 015 in W1's copy — extended to 023 by the coordinator (Section 4). Seed.sql inserts 25 articles with `created_at = now`, so "articles created today" is 25 on a fresh test DB.

### 3.2 W2 — Fact-check / pipeline repairs

**Files:** `backend/agents/autonomy/factcheck.js`, `seo.js`, `content.js`, `database/migrations/023_seo_body_hash.sql` (NEW), tests `factcheck-correction-validation` (15), `seo-repair-snapshot` (5), `content-scaffold-regen` (11). **In its copy: 925 pass / 0 fail (31 new).**

- **#30 trailing-citation defect — fixed two ways:** `stripTrailingCitation()` (factcheck.js:877) strips a trailing markdown citation link/bare URL before the punctuation test; and the paragraph-issue dedup key changed from first-120-chars to `para-idx:<index>`, so a rewrite can no longer turn a pre-existing defect into a "new" one.
- **Correction failure is now honest:** `buildRecoveryReport()` + `failCorrectionRun()` — a validation rejection returns outcome `'failed'` with a recovery report, retryable:false, BLOCKED_WITH_REASON. The old `'done'`-on-rejection lie is gone.
- **Truncation guard:** `detectTruncatedBody()` runs before validation — a truncated correction output fails as `'truncated-correction'`, retryable, nothing saved. No per-paragraph chunking (correction is already per-sentence with `isTruncatedReply` + one retry + circuit breaker).
- **SEO snapshot ordering fixed:** the revision snapshot is now written AFTER the UPDATE, so it stores the final body including the appended Related-reading line — this is what made fc 16 look stale (4501 vs 4615). Trade-off recorded: the pre-edit rollback snapshot is gone; one revision row per repair, pinned by an existing test. `tests/activation-repairs.test.js:336` comment updated by the coordinator ('post-repair body stored as a revision').
- **SEO body hash:** `insertSeoCheck()` now stores `body_hash` + `body_length`, falling back to the old 3-column insert pre-023 (migration 023).
- **#29 scaffold regeneration:** `isScaffoldBody()` / `regenerateScaffoldDraft()` / `runScaffoldRegeneration(task, env)` — regenerates a scaffold draft from its own article_sources → research_items evidence only, reuses the article row in place, stays draft, snapshots the scaffold first, refuses published rows. NOT wired into the scheduled run — function + task handler only, plus kind-level dispatch in `backend/agents/autonomy-runner.js` (coordinator wiring, Section 4). Daily-cap defense `checkDailyArticleCap()` before any evidence/LLM work, no-op `daily-cap-reached`.
- **Left for the coordinator/parent:** SEO gate enforcement snippet (gate.js not W2's file — W3's gate already implements it, Section 3.3); dashboard/manual trigger wiring for scaffold regeneration; the truncation guard is unit-tested but has no live-style end-to-end trigger (no current code path assembles a truncated body); `seo.js` still appends the newest same-division sibling as Related reading regardless of topical relevance — NOT fixed in seo.js, but the auto evaluator now rejects such a link as irrelevant, so the trap cannot auto-publish (the repair can still create the misleading link).

### 3.3 W3 — Autonomous publishing + divisions

**Files:** `backend/publishing/gate.js`, `backend/agents/autonomy/publishing.js`, `backend/publishing/divisions.js` (NEW), `backend/routes/divisions.js`, `database/migrations/021_publication_logs.sql` (NEW), tests `autonomous-publishing` (46), `divisions-support` (12). **In its copy: 952 pass / 0 fail (58 new).**

- **Gate fixes:** (1) SEO staleness — `isSeoCheckStale()` prefers recorded `body_hash`, falls back to timestamps with 5s grace (`SEO_STALE_GRACE_MS`); (2) daily limit counted on the **Dhaka day** (`datetime('now','+6 hours','start of day','-6 hours')`, was UTC day); (3) sources need a non-empty `source_url`.
- **Eligibility evaluator** `evaluateAutoPublishEligibilityPure()` (gate.js:380) + D1 wrapper `evaluateAutoPublishEligibility()` (gate.js:670 — **in gate.js, not publishing.js**) — 14 checks, pure/testable. `NEVER_WAIVABLE_SEO_CHECKS` = internal-links + duplicate. Duplicate overlap exactly 0%. Internal-links genuinely relevant (same division AND topical title-keyword overlap, generic words excluded — the #31→#22 trap now fails). Health/Finance always fail special-review (never auto-eligible). Advice claims without an authoritative evidence URL are named as BLOCKED_WITH_REASON. Failure alerts distinguish temporary (E-Stop, daily limit only) vs permanent error kinds.
- **Auto-publish** `autoPublishArticle()` (publishing.js:176) — pre-flights incl. publication_logs table must exist, full eligibility, protected check, banner strip, idempotency; publish = one conditional UPDATE; sitemap regeneration then success log; **any failure after the flip rolls back and reports failure** (rollback fixed by the coordinator, Section 4.2). `runAutoPublish()` (publishing.js:333) tries new candidates oldest-first. `regenerateSitemap()` (publishing.js:150) + pure `sitemapXmlForArticles()` (publishing.js:117) rebuilds sitemap XML from live D1 published rows — but the Worker cannot rewrite checked-in `public/sitemap.xml` at runtime, so the returned XML is what the deploy step/route must write/serve (see the sitemap fix, Section 4.4).
- **Divisions:** `DIVISION_CONFIG` for all 8 — 3 named RSS sources each, editorial rules, internal-link scoping, 8-day rotation slots, social hooks, special-review flags; `isInternalLinkRelevant()`, `adviceClaimNeedsAuthority()`, `isAuthoritativeSource()`. Per-division status (live-verified 3 active RSS sources each, 24 total): Automotive 12 published, AI & Technology 2, Gadgets 2, Finance 3 (≥2 sources, special review), Travel 2, Digital Tools 1, Health (special review, ≥2 sources), Education 1 (only #22 published — a draft whose only sibling is topically unrelated stays blocked; the link must never be faked).
- **Gate inconsistencies found (not all changed):** (4) duplicate scope is SEO-suite-only vs published <25% — NOT changed in the old gate; the auto evaluator is stricter (0%); cross-draft duplication still uncaught at auto-publish time (mitigated by 1/day limit + fresh SEO); (5) daily-limit TOCTOU in `publishGatePassed()` — mitigated, not fully fixed (the auto path's conditional UPDATE + idempotency log make double-publish impossible).
- **Owner authorizations still needed:** apply migration 021; enable auto-publishing = THREE deliberate owner actions (publishing_mode → `auto` — needs the orchestrator snippet since the API previously refused it; auto_publishing → `on`; set `auto_publish_eligible_since` ISO timestamp) — absent any one, nothing auto-publishes; existing drafts #28–#31 need separate per-article authorization each (refused by id unconditionally); Health/Finance never auto-publishable.

### 3.4 W4 — Social media

**Files:** NEW `backend/social/` (errors.js, platforms.js, content.js, tokens.js, store.js, dispatcher.js, adapters/base.js, pinterest.js, facebook.js, instagram.js, linkedin.js, youtube.js, index.js — **no X adapter**), `backend/routes/social.js` (NEW, owner-only), `backend/agents/autonomy/social.js` (pack builder unchanged in shape + best-effort DRAFT social_posts rows, never a publish), `database/migrations/022_social_media.sql` (NEW: `social_accounts`, `social_posts`, `social_analytics`), `docs/SOCIAL-PLATFORMS-2026-11-21.md` (NEW — per-platform research matrix with doc URLs), tests `social-adapters`, `social-dispatcher`, `social-routes` (38 total). **In its copy: 931 pass / 1 fail** — the 1 failure was pre-existing test `tests/dashboard-status-truth.test.js` ("no googleapis usage"): it strips comments + the authorized Gemini host, then forbids the literal `googleapis` in any backend JS — the YouTube adapter legitimately uses `https://www.googleapis.com/youtube/v3` (the YouTube Data API lives on that host). W4 did not obfuscate or edit the test; the coordinator fix is one line in that test (add `.replace(/www\.googleapis\.com/g, '')` alongside the Gemini carve-out) — **applied during merge**.

- **Token security:** AES-256-GCM token encryption, key from `SOCIAL_TOKEN_SECRET`, fail-closed, never logs tokens.
- **Dispatcher:** pre-flight → publish → verify-back, transient-only retry, exponential backoff 1s/2s/4s, max 3 attempts. Per-platform reliability: verify token before posting, check permissions, validate media/captions, check rate limits, detect duplicates, record platform response IDs, verify actual publication, retry only safe transient errors, stop and request authorization for expired/revoked access, never report success without platform confirmation.
- **Routes:** `GET /api/social/status` returns `{platforms:[{platform, connected, accountName, tokenExpiresAt, lastPostAt, lastError}]}` + classification per entry; `connected` false for every platform until a real OAuth completes. `POST /api/social/accounts/:id/verify`, `POST /api/social/posts` (draft/schedule only — `publish:true` rejected 400), `POST /api/social/posts/:id/publish` (ONLY route that posts; optional `{force:true}` for owner-approved re-post), `GET /api/social/posts`, `/calendar`, `/reports/daily|weekly` (engagement real platform data only, else "Data unavailable").
- **Per-platform research (official docs, 2026-11-21) — full matrix in `docs/SOCIAL-PLATFORMS-2026-11-21.md`:**
  - **Pinterest — SUPPORTED FREE.** API v5, POST /v5/pins, scopes boards/pins/user_accounts read+write, access 30d / refresh 60d, Trial 300/day → Standard after demo-video review, media required PNG/JPEG ≤20MB 2:3, title ≤100, description ≤800.
  - **Facebook Page — SUPPORTED FREE.** Graph API v26.0, POST /{page-id}/feed|photos|videos, scopes pages_show_list/pages_manage_posts/pages_read_engagement, own Page in dev mode needs NO App Review, user token 1–2h → 60d long-lived → Page token effectively non-expiring, no published daily cap, framework cap 25/day.
  - **Instagram — SUPPORTED FREE.** Graph API v26.0, POST /{ig-user-id}/media → poll → media_publish, Business/Creator required, Instagram Login scopes instagram_business_basic/content_publish, NO Facebook Page needed on the Instagram Login path, token 60d, 25 posts/24h lowest published figure (framework uses 25), media REQUIRED public HTTPS URL only, JPEG ≤8MB, caption ≤2200, ≤30 hashtags.
  - **LinkedIn own profile — SUPPORTED FREE.** POST /rest/posts, Share on LinkedIn self-serve no review, scopes w_member_social + openid/profile, access 60d, NO refresh tokens for self-serve — re-OAuth every 60 days, 150/member/day, text ≤3000. Company Page LIMITED FREE — vetted Community Management API, not implemented, member posts only; read-back impossible for self-serve apps.
  - **YouTube — LIMITED FREE.** Data API v3 videos.insert, 10,000 units/day/project, 1,600/upload ≈6/day, framework cap 2/day, refresh token, **7-day expiry while consent screen is Testing — do NOT switch the Shorts flow to the API yet: unaudited uploads land PRIVATE regardless of requested privacy; publish consent screen to Production + pass Google audit first; no community-post endpoint exists; channel needs 500 subs, currently 2.**
  - **X (Twitter) — UNAVAILABLE FREE OF COST.** No free tier for new developers since Feb 2026: pay-per-use $0.015/post, $0.20 with URL, $0.005/read; $20 starter credits require saving a card + first purchase — card violates the $0 rule. No adapter implemented; dispatcher refuses X with BLOCKED_WITH_REASON/PLATFORM_UNAVAILABLE, zero network calls. Caveat: docs.x.com could not be fetched directly in that environment — the finding rests on multiple independent Sep–Nov 2026 sources citing docs.x.com; re-check docs.x.com before any revisit.
- **Known gaps:** **no rendered card image exists in the repo** — Pins are text-only dark-navy by design but that design is a rendered IMAGE the APIs cannot draw; Pinterest/Instagram adapters accept pre-rendered card via mediaUrl (public HTTPS) or mediaBase64 (Pinterest only) and refuse without media; a card renderer (or reusing the manual pin tool's output) is still needed before the first real Pinterest/Instagram post. Instagram needs the image hosted at a public URL (the FS AI site can host it; nothing uploads it there yet). WhatsApp Business out of scope (Cloud API is messaging, not article distribution).
- **Before first live use:** set the `SOCIAL_TOKEN_SECRET` Worker secret (encryption fails closed without it); apply migration 022. W4 also flagged: orchestrator.js:136 `social_auto_post` validator rejects anything but 'off' — the coordinator allowed 'off'|'draft_only'|'on' (Section 4).

### 3.5 W5 — Dashboard / Control Center + analytics + YouTube auth

**Files:** `backend/routes/analytics.js` (62 → 415 lines), `backend/routes/health.js` (NEW), `frontend/pages/dashboard.html` (226 → 312 lines), `frontend/scripts/dashboard.js` (786 → 1278 lines), `frontend/scripts/autonomy.js` (1452 → 1501 lines), tests `control-center.test.js` (NEW, 22 tests). **In its copy: 916 pass / 0 fail (894 + 22).**

- **Analytics detail** `handleAnalyticsDetail` + section builders returning `{data, asOf, freshness}`; `handleAnalytics`/`HONEST_ANALYTICS` untouched. Traffic returns GA4_UNAVAILABLE `{status:'unavailable', reason:'GA4 data is not stored in D1; connect the GA4 Data API or check the GA4 console', value:null}`. Social/engagement unavailable — no social_posts/social_analytics tables in live D1. Revenue reads `website_settings.total_revenue_usd` ($0.00). Errors join latest agent_runs.detail with retryHistory, errorType (temporary while attempts remain, permanent when exhausted), ownerAction flag. Fact-check/SEO rows carry `stale` when the check predates the article's updated_at. Missing tables degrade that section to unavailable, never fail the endpoint.
- **Health endpoint** `handleHealthLatest` — latest row per component from `system_health_checks`; absent table → `{overall:'unknown', checks:[], note:'health service not yet deployed'}`; checks older than 25h flagged stale.
- **Control Center UI** — new `section-control-center` first: alerts, automation, publishing, social, YouTube session panel, schedules, queue health, failed tasks, AI usage + free-tier bar, health, reports, recent activity; all times labelled Asia/Dhaka; no password field. `fmtDhaka` via Intl/Asia/Dhaka, severity-ordered alerts, loaders with honest fallbacks when W4/W1 routes are absent. `loadControlCenterActivity`, `notifyControlCenter` dispatching `fsai:autonomy-refreshed`.
- **YouTube/Google auth investigation result: NOTHING is stored anywhere.** Repo-wide search for `youtube|oauth|googleapis|refresh_token|access_token|client_secret` found only a static profile row (accounts.js:26: YouTube @FSAI-e5f, "No account connection or publishing API is connected"), the same row in seed.sql, draft-text builders (social.js, marketing.js — "YouTube API is not connected"), and the Gemini LLM endpoint host (text generation, not OAuth). **No YouTube OAuth token, no Google refresh/access token, no session storage exists anywhere in D1 or code.** Uploads are browser-based only. The dashboard therefore shows "Browser session — verified manually before each upload" + "Not API-connected", with last-known state as a stored note (channel @FSAI-e5f, mdalfahad406@gmail.com, last verified 2026-11-21 11:43, Short #05 https://youtube.com/shorts/G7jkYB9YWkM) + the saved-406-password-rejected note. Exact owner steps if a sign-in is needed: Section 8.
- **Gaps:** route wiring left for coordinator (snippets provided, applied Section 4); live social status/health data absent until W4/W1 merge; dashboard Delete button (8 failed attempts 2026-11-20) out of scope, not touched; charts.js unchanged.

---

## 4. Coordinator merge + wiring + fixes found by testing

All five streams copied into `~/workspace/fs-ai-source/fs-ai/`; `diff -rq` confirms the remaining diffs are exactly the other streams' files (disjoint ownership held). One merge hiccup: the first copy chain halted at `cp -a` on `backend/social` (ownership-preservation error → non-zero exit → `&&` chain stopped), so W4 migration 022/docs/tests and all of W5 were initially missing; re-copied with plain `cp` — verified present afterwards (migrations 020, 021, 022, 023 all present).

### 4.1 Wiring applied (files no worker owned)

- `backend/worker.js`: imports + owner-only routes for `/api/analytics/detail` (handleAnalyticsDetail), `/api/health/latest` (handleHealthLatest), `/api/social/*` (handleSocial). Note: `/api/health` (liveness, no auth) is a different endpoint.
- `backend/routes/orchestrator.js` SETTING_RULES: `publishing_mode` now allows `'approved_only' | 'auto'`; new `auto_publish_eligible_since` rule (ISO 8601, empty/null clears = disables); `social_auto_post` now allows `'off' | 'draft_only' | 'on'` (creation is always draft-only; publishing only via explicit owner action; nothing posts without a connected account). Defaults unchanged — code never flips a setting.
- `backend/agents/autonomy-runner.js`: import `runScaffoldRegeneration` + kind-level dispatch in `runAutonomyTask` (agent `content-creation` + kind `scaffold-regeneration` → `runScaffoldRegeneration`; explicit owner/manual tasks only, never the scheduled run).
- `backend/routes/scheduler.js`: import `runAutoPublish` + new `steps.autoPublish` after `steps.publishDue` in the daily workflow (runAutoPublish itself pre-flights flags + E-Stop + cutoff and no-ops with zero log rows when disabled, so with live defaults it does nothing). Weekly workflow untouched (stays read-only).
- `package.json`: `db:migrate` extended from 015 to 023 (016_llm_usage_estimated, 017_correction_claim_key, 018_factcheck_verdict_history, 019_factcheck_body_hash, 020_task_lifecycle_health, 021_publication_logs, 022_social_media, 023_seo_body_hash); new npm script `"sitemap": "node scripts/regenerate-sitemap.mjs"`.
- `tests/dashboard-status-truth.test.js`: added `.replace(/www\.googleapis\.com/g, '')` carve-out alongside the Gemini one, with a comment (YouTube Data API is an authorized documented integration, not a GA4 Reporting integration).
- `tests/activation-repairs.test.js:336`: assertion message updated to 'post-repair body stored as a revision (W2 fix 2026-11-21…)' — count assertion unchanged (still 1).

### 4.2 Rollback bug found by the acceptance test — FIXED

`autoPublishArticle`'s rollback stamped `updated_at = nowIso()`, which made the SEO check stale by the timestamp fallback and caused a retry to refuse. Fixed to restore the previous `updated_at` (rollback now restores the article EXACTLY as it was: status, body, updated_at). Proven by reliability scenario 10 (Section 6).

### 4.3 Stale-lock self-healing gap found by the acceptance test — FIXED (behavior change)

W1's `recoverStaleTask` left a recovered task `failed` + RETRYING, waiting for a manual retry via retryTask. That is not self-healing: a Worker restart would leave tasks failed until someone intervenes, violating the owner's zero-failure brief ("recovery after Worker restart" must be automatic). **Changed:** when attempts remain, `recoverStaleTask` now RE-QUEUES the task automatically (`status='queued'`, `scheduled_for` = now + exponential backoff) with terminal_state RETRYING; only when attempts are exhausted does it go `failed` + FAILED_FINAL_WITH_RECOVERY_REPORT. This matches runTask's own failure path semantics.

**Tests updated for this deliberate change (not weakened — they now pin the stronger behavior):**
- `tests/task-lifecycle.test.js` (W1's own test): status `failed` → `queued` + backoff in the future + RETRYING.
- `tests/task-timeout-phase4.test.js` (4 tests): status `failed` → `queued` (+ backoff); the old "retryable through the retry endpoint" step replaced by auto-re-queue assertions (retryTask 409s on a queued task by design — it stays for genuinely `failed` tasks only). Two of these tests use the pre-020 harness, where `setTerminalState` is a deliberate no-op, so terminal_state is asserted in task-lifecycle + reliability tests instead.
- **Settings tests updated for the deliberate allowlist widening (Section 4.1):** `tests/autonomy-queue.test.js` (publishing_mode now accepts `auto`; social_auto_post now accepts `draft_only`/`on`) and `tests/sources-api.test.js` (publishing_mode `auto` now 200, persisted). The guard intent is preserved: invalid values are still rejected, and `auto` alone publishes nothing (three-part enablement).

### 4.4 Sitemap gap — REAL GAP FOUND AND FIXED

`sitemapEntries()` in `backend/services/seo.js` builds from the STATIC checked-in `ARTICLES` list in `backend/routes/articles.js` (25 published) — a newly auto-published article (id 32+, D1 only) would NEVER appear until someone edits the list. Fix: `scripts/regenerate-sitemap.mjs` REWRITTEN to merge static generator entries with live published articles from D1 (via `wrangler d1 execute fs-ai-db --remote --json`, or `--from-json` for offline/tests; `--dry-run` prints XML; live-fetch failure warns loudly and writes static-only unless `--require-live` is passed, which exits 1); `backend/services/seo.js` refactored `sitemapXml()` to use a new exported `renderSitemapXml(entries)`. The existing `tests/sitemap-canonical.test.js` does NOT assert committed files == generator output (only tool-id parity + clean canonicals), so the merge does not break it. The auto-publish `sitemapUpdated` flag means "the regenerated XML includes the article" — the SERVED file catches up when this script runs at the next deploy; run `npm run sitemap` before every deploy that follows a publish.

### 4.5 New coordinator tests

- `tests/reliability-acceptance.test.js` (11 failure scenarios + repeated scheduled-cycle tests, real-SQLite harness).
- `tests/regenerate-sitemap.test.js` (3 tests: live-only article merged, static-only output exact, no duplication of an already-listed article).

---

## 5. Zero-failure operational design (owner brief 2026-11-21 12:05)

Binding on every component. How each requirement is implemented (not just a report section):

### 5.1 Prevent failures — pre-flight validation

- **Queue drain:** health check gates the drain (`runHealthCheck` — 10 checks; `overall === 'blocked'` stops the drain before any task runs). E-Stop check first. Per-task: handler existence, daily-content cap re-counted before each content task, scheduled_for honored, duplicate-run guard (conditional claim).
- **Auto-publish:** pre-flights include publication_logs table existence, all three enablement flags, E-Stop, cutoff timestamp, protected-article check, banner strip, idempotency log — before any flip.
- **Social:** dispatcher pre-flight — token validity, permissions, media/caption validation, rate-limit check, duplicate detection — before any platform call.
- **Fact-check/correction:** body-hash binding (below); truncation guard before validation; validation rejection is a hard failure, never a silent pass.
- **Never start a task known unable to complete:** unknown-agent and malformed-payload tasks are classified PERMANENT immediately (no retries); a task whose dependencies fail the health check is not started.

### 5.2 Automatic recovery

- Exponential backoff 15·2^(attempts-1) min, capped 240 min; max_attempts 3; leases (10-min task lease, 120s per-model AI timeout); timeout recovery (stale-lock sweeper re-queues automatically — Section 4.3); idempotent execution (conditional claim, idempotency keys, duplicate-run guards); automatic token refresh where officially supported (Facebook long-lived → Page token; YouTube refresh token; Pinterest refresh 60d — LinkedIn self-serve has NO refresh tokens and must re-OAuth every 60 days, which the system surfaces as WAITING_FOR_AUTHORIZATION); dead-letter = FAILED_FINAL_WITH_RECOVERY_REPORT with the full report in the run detail; dependency health checks before major workflows; recovery after Worker restart (stale-lock re-queue) and after network interruption (transient-only social retry, 3 attempts).

### 5.3 Zero stale data — fail-closed

- Every article-body change invalidates its previous fact-check: `fact_checks.body_hash` (migration 019, live) + gate fails LOUDLY on stale (missing hash = stale, fail-closed). Per-claim carry-forward is gated on claim-text hash + evidence signature identity.
- SEO results are tied to the version they checked: `seo_checks.body_hash` + `body_length` (migration 023, new); the gate prefers the recorded hash and falls back to timestamps with a 5s grace.
- Publishing uses current verified results only (14-check evaluator re-reads live rows at publish time; the rollback restores the article exactly, Section 4.2).
- Social posts use the correct published article version (pack builder reads the live published row; posts record the article id + version hash in the D1 row).
- Analytics show actual timestamps and data freshness (`{data, asOf, freshness}` on every detail section; stale checks flagged; unavailable metrics say "Data unavailable").
- Never silently reuse outdated results: the #30 fc 16 case (body changed after the check) is now impossible to pass the gate.

### 5.4 Zero unresolved tasks — five terminal states only

Every task reaches exactly one of: **COMPLETED, RETRYING, WAITING_FOR_AUTHORIZATION, BLOCKED_WITH_REASON, FAILED_FINAL_WITH_RECOVERY_REPORT.** No task may remain indefinitely queued or running (drain cap + lease sweeper + backoff). Automatic alerts for tasks requiring owner action (Control Center alerts, severity-ordered; failure alerts carry exact task ID, component, root cause, timestamp, retry history, recovery action, owner-action-required flag). Task history and audit logs are never deleted to hide failures (the 12 queued tasks were NOT deleted; the superseded ones stay queued pending the owner's decision).

### 5.5 Social media reliability (per connected platform)

Verify token before posting, check permissions, validate media and captions, check rate limits, detect duplicates, record platform response IDs, verify actual publication status, retry only safe transient errors, stop and request authorization for expired/revoked access. **Never report success without platform confirmation** (no platform_post_id = no success; the dispatcher's final failure record carries the real root cause — proven by acceptance scenario 11).

### 5.6 Daily self-health check

`runHealthCheck(env)` runs before the daily workflow and gates the drain: Worker health, database health, queue health, AI provider availability, account connections, publishing eligibility, social integrations, storage limits, free-tier consumption, backup status. An unsafe workflow does not start.

### 5.7 Failure alerts and reporting

Every failure includes exact task ID, component, root cause, timestamp, retry history, recovery action, current state, and whether owner action is required. Temporary vs permanent errors are distinguished (narrow permanent definition, Section 3.1). No hiding, overwriting, or fabricating of successful results.

### 5.8 Final reliability acceptance test

Section 6. **Do NOT claim zero failures merely because the test suite passes** — the acceptance test simulates the real failure modes against a real SQLite database with real code paths, and the weekly run on 2026-11-22 (on current deployed code) plus the first live runs after deploy are the live proof that is still to come.

---

## 6. Reliability acceptance test — evidence per scenario

File: `tests/reliability-acceptance.test.js` (15 tests) + `tests/regenerate-sitemap.test.js` (3 tests).
**Result: 18 pass / 0 fail** (run 2026-11-21, after the coordinator fixes below).

| # | Scenario | What was simulated | Result |
|---|---|---|---|
| 1 | AI timeout | LLM call that never settles, 120s model timeout | PASS — fails over / fails with a clear timeout, task re-queues, never hangs |
| 2 | Database interruption | D1 binding absent / query failure mid-run | PASS — run fails loudly with 503, no partial state, no lost task |
| 3 | Duplicate task | Same idempotency key enqueued twice; queue drained twice | PASS — each task executes exactly once |
| 4 | Expired social token | Pinterest adapter with an expired token | PASS — refuses with WAITING_FOR_AUTHORIZATION, zero platform calls |
| 5 | API rate limit | Platform returns 429 with Retry-After | PASS — transient retry with backoff, then honest failure (no fake success) |
| 6 | Invalid article | Fact-check on a scaffold body / missing article | PASS — scaffold detected, FAILED with reason, nothing published |
| 7 | Failed fact-check | Fact-check verdict failed on a real draft | PASS — gate refuses, article stays draft |
| 8 | Stale SEO result | SEO row older than the article body | PASS — gate marks seo-pass stale, auto-publish refuses |
| 9 | Worker restart | Task left `running` past the 10-min lease | PASS — recovered, RE-QUEUED with backoff, then completes exactly once (recovery row + execution row; work runs once) |
| 10 | Interrupted publishing | Publication-log insert fails after the status flip | PASS — article rolled back EXACTLY (status, body, updated_at); retry then publishes once |
| 11 | Network interruption | fetch throws mid-post, 3 attempts | PASS — fetch called exactly 3 times, status `failed`, attempts 3, no platform_post_id, real root cause recorded |
| — | Repeated scheduled cycles | Daily workflow run twice; weekly report run twice same day; E-Stop drain block | PASS — duplicate-guarded, E-Stop blocks the drain, health check reports it |
| — | Sitemap regeneration | Live-only article, static-only output, no duplication | PASS (3/3) |

**Three failures found during the acceptance run, all diagnosed and fixed (these are the test's value — it caught real issues):**

1. **Scenario 9 — TEST bug, not a code bug.** `recoverStaleTasks()` returns `{ok, recovered: [...array...], ...}`; the test asserted `recovered.recovered >= 1` (treated the array as a count). Fixed to assert on the array length. Also fixed in the same round: staleness is measured on `updated_at` (scheduler.js `isTaskStale`), NOT `started_at` (no such column); run-row assertions must not filter `outcome='done'` (analytics snapshot completes as `no-op`).
2. **Scenario 10 — TEST FIXTURE bug + a real CODE bug.** The test draft title 'Reliability test draft 100' shares no topical keyword with the linked published article 1, so the evaluator's internal-links relevance check refused BEFORE any flip (the interruption path was never reached). Fixed by mirroring W3's fixture (draft title 'Electric Car Charging Guide' + a published sibling with overlapping title, linked from the body). The real code bug found here: the rollback stamped `updated_at = nowIso()`, making the SEO check stale and the retry refuse — **fixed (Section 4.2)**.
3. **Scenario 11 — TEST bug, not a code bug.** The assertion read `row.error` but the SELECT did not include the `error` column. Fixed the SELECT. The retry behavior itself was correct (3 calls, failed, attempts 3, no post id).
4. **Scenario 9 follow-on — real DESIGN gap, fixed (Section 4.3).** After the array fix, the test showed the recovered task sat `failed` and the drain never ran it. The owner brief requires automatic recovery after a Worker restart, so `recoverStaleTask` now re-queues with backoff. The test then verified the full cycle: recovery → re-queue → backoff honored → drain → done exactly once.

**What the acceptance test does NOT prove:** live behavior. It runs real code against a real SQLite database with stubbed fetch/LLM — it proves the failure paths exist and behave, not that the live Worker, live D1, or a real platform will behave the same. Live proof comes from the deploy + live verification (Section 12) and the 2026-11-22 weekly run.

---

## 7. Eight divisions — status

All 8 divisions have independent configuration in `backend/publishing/divisions.js` (DIVISION_CONFIG): 3 named RSS sources each (24 total, live-verified active), editorial rules, internal-link scoping, 8-day rotation slots, social hooks, special-review flags. Live published counts: Automotive 12, AI & Technology 2, Gadgets & Electronics 2, Finance & Money Education 3, Travel & Lifestyle 2, Digital Tools & Utilities 1, Health & Wellness 0 published (special review), Education & Learning 1 (#22).

**Health and Finance get additional review and must not generate unsupported professional advice:** both divisions are flagged special-review in DIVISION_CONFIG; the auto-publish evaluator ALWAYS fails them (never auto-eligible); advice claims without an authoritative evidence URL are named as BLOCKED_WITH_REASON. Health/Finance articles can still be created and fact-checked — they just never auto-publish; they need owner review and a manual publish decision.

**Education caveat:** only #22 is published, so a draft in this division whose only sibling is topically unrelated stays blocked by the genuine-relevance rule — the link must never be faked to pass the check.

---

## 8. Google Studio / YouTube auth — investigation + exact owner steps

**Finding: NOTHING is stored anywhere.** Repo-wide search for `youtube|oauth|googleapis|refresh_token|access_token|client_secret` found only a static profile row, the same row in seed.sql, draft-text builders ("YouTube API is not connected"), and the Gemini LLM endpoint host (text generation, not OAuth). **No YouTube OAuth token, no Google refresh/access token, no session storage exists anywhere in D1 or code.** Uploads are browser-based only, on the owner's live browser session.

**Saved-password status:** the saved password for mdalfahad406@gmail.com was rejected by Google on the morning of 2026-11-21 ('Wrong password', session signed out). At 11:43 the live browser session was found ALREADY signed in as mdalfahad406 (no saved password used, no sign-in needed) and Short #05 published fine. **The saved 406 password itself is still unverified-bad** — it will block again when the session expires (~1h). The saved 841 Google login WORKS for Search Console (verified 2026-11-20 18:36). No password is exposed or requested anywhere in this report or the code; the dashboard has no password field.

**Exact owner steps if a sign-in is needed** (also shown in the dashboard YouTube panel):

1. Open https://studio.youtube.com in the browser.
2. Check the account menu — it must show mdalfahad406@gmail.com and @FSAI-e5f.
3. If a different account shows, switch accounts in the browser menu; do not type any password into the dashboard.
4. If signed out: sign in in the browser as mdalfahad406@gmail.com; if Google rejects the saved password, update it through the Secure Vault card or Google account recovery (accounts.google.com/signin/recovery) — never paste a password into the dashboard, never store one in the DB.
5. Confirm by opening https://www.youtube.com/@FSAI-e5f, then tell the assistant "YouTube session verified" so the next upload can run.

**Do NOT switch the Shorts flow to the YouTube Data API yet** (Section 3.4): while the OAuth consent screen is in Testing, tokens expire after 7 days and unaudited uploads land PRIVATE regardless of requested privacy. The consent screen must go to Production and pass Google's audit first. The current browser-based Shorts flow stays.

---

## 9. Test results

### 9.1 Merged full suite — GREEN

**Command:** `npm test` in `~/workspace/fs-ai-source/fs-ai/` (runs `node --test "tests/*.test.js"`).
**Result: 1106 pass / 0 fail / 0 cancelled / 0 skipped.** Baseline before this build: 894 pass / 0 fail. **+212 tests.**

### 9.2 Per-stream counts (isolated copies, before merge — do NOT sum; each copy had only its own stream)

| Stream | Pass / Fail | New tests |
|---|---|---|
| W1 queue/task engine | 939 / 0 (was 894) | 45 |
| W2 fact-check/pipeline | 925 / 0 | 31 |
| W3 publishing/divisions | 952 / 0 | 58 |
| W4 social | 931 / 1 (the 1 fail was the pre-existing googleapis test, fixed by the coordinator carve-out) | 38 |
| W5 dashboard/analytics | 916 / 0 | 22 |
| Coordinator: reliability acceptance + sitemap | 18 / 0 | 18 |
| **Merged tree (final)** | **1106 / 0** | **212** |

### 9.3 Failures found and fixed during the merged run

The first merged full-suite run was **1099 pass / 7 fail**. All 7 were pinned expectations of pre-implementation behavior, superseded by two deliberate coordinator decisions — **no test was weakened; each now pins the stronger behavior:**

- **4× stale-lock tests** (`tests/task-timeout-phase4.test.js`): expected recovered tasks to sit `failed`; new behavior re-queues them automatically with backoff (Section 4.3). Two of these use the pre-020 harness where `setTerminalState` is a deliberate no-op, so terminal_state is pinned in task-lifecycle + reliability tests instead.
- **3× settings tests** (`tests/autonomy-queue.test.js`, `tests/sources-api.test.js`): expected `publishing_mode: auto` and `social_auto_post: on/draft_only` to be rejected; the allowlist was deliberately widened (Section 4.1). Invalid values are still rejected, and `auto` alone publishes nothing.

No test was deleted, no assertion was loosened to make a failure pass, no quality rule was weakened.

### 9.4 What tests do NOT cover

- Live Worker/D1 behavior (tests use real SQLite + stubbed fetch/LLM).
- Real platform posting (no authorized account exists; all social tests use stubbed fetch — **no social platform is claimed operational**).
- The dashboard Delete button (known broken, out of scope).
- The 2026-11-22 weekly run itself (untestable until it fires; it runs on current deployed code).

---

## 10. Live verification evidence (fresh, read-only, 2026-11-21 after the build)

All values below were read live from D1 (SELECT only) after the implementation was complete. Nothing was written to live D1 by any worker.

| Check | Expected | Live value | Verdict |
|---|---|---|---|
| Published articles | 25 | 25 | PASS |
| #26 body / updated_at / protected | 4895 / 2026-11-19T18:53:30.327Z / 1 | identical | PASS — unchanged |
| #27 body / updated_at / protected | 245 / 2026-11-19T18:53:32.930Z / 1 | identical | PASS — unchanged |
| #28 body | 2157 | 2157 | PASS — unchanged |
| #29 body | 593 | 593 | PASS — unchanged |
| #30 body | 4615 | 4615 | PASS — unchanged |
| #31 body / updated_at / status | 549 / 2026-11-21T01:19:10.364Z / draft | identical / draft | PASS — unchanged, still draft |
| publishing_mode | approved_only | approved_only | PASS |
| auto_publishing / auto_correction / social_auto_post | off / off / off | off / off / off | PASS |
| auto_research / auto_generation / auto_factcheck | on / on / on | on / on / on | PASS |
| Emergency Stop | OFF ('0') | '0', updated 2026-11-20 05:15:15 | PASS |
| Revenue | $0.00 | $0.00 | PASS |
| Traffic | "Data unavailable" | "Data unavailable" | PASS |
| Tasks by status | 12 queued, 1 failed (#31) | done 19, failed 1, queued 12, skipped 5 (total 37) | PASS — queue unchanged |
| LLM usage (7 days) | Workers AI only | 47 calls / 778 Neurons, all Workers AI (models @cf/openai/gpt-oss-20b, @cf/openai/gpt-oss-120b, @cf/mistralai/mistral-small-3.1-24b-instruct); latest call id 47, 2026-11-21 00:01:42 UTC, fact-check-judge, gpt-oss-120b, 16 Neurons | PASS |
| Latest daily report | id 11, 2026-11-21, kind daily | id 11, date 2026-11-21, kind daily (researchEnqueued 2, contentEnqueued 1, factChecksRun 3, published 0, failedTasks 1) | PASS — no row dated ≥ 2026-11-22 (weekly run not yet fired) |

**Unverifiable without browser (marked UNVERIFIED):** Cloudflare dashboard trigger list, Worker-env secret presence, local repo HEAD (local copy has no .git), dashboard-only state (Delete button, Control Center rendering), the live browser YouTube session state (last verified 2026-11-21 11:43).

**Note on the D1 reads:** two read attempts 400'd before succeeding — the cause was a wrong column name in my own queries (`website_settings.key`/`value` — the real columns are `setting_key`/`setting_value`; `llm_usage` has no `calls` column — each row is one call, so totals are `COUNT(*)` / `SUM(neurons)`; `daily_reports` has `date`, not `report_date`). Not a live defect. Values above are from the corrected queries.

---

## 11. Pending dashboard results — TO BE FILLED IN BY THE PARENT

> **[PENDING — parent browser steps. Do not fill in until the steps below are actually run and verified in D1.]**

### 11.1 Re-check #30 (fresh fact-check) — PARENT TO RUN AFTER DEPLOY

- **Step:** owner dashboard → Autonomy / drafts table → article #30 → **Re-check** (NOT Correct, NOT Publish).
- **Expected:** new fact_checks row id 17+, check_kind='recheck', body_hash present + matching the live 4615-char body, verdict needs-review. Verify in D1 afterwards.
- **Do NOT click Correct on #30 first** — Re-check first establishes the fresh baseline; with the fix deployed, a later Correct should succeed, but that is a separate step.
- **Result:** _(to be filled in by the parent: row id, verdict, body_hash match Y/N, date/time)_

### 11.2 Regenerate #29 (scaffold regeneration) — PARENT TO RUN AFTER DEPLOY + MIGRATION 023

- **Step:** invoke `runScaffoldRegeneration` with article_id 29 — manual task / dashboard trigger once wired (the function + task handler exist; the dashboard trigger wiring is the parent's deploy-time check).
- **Expected:** same row, still draft, scaffold snapshotted, new AI-DRAFT body from its Guardian Austin evidence; then fact-check #29; do not publish until the gate passes and the owner approves.
- **Result:** _(to be filled in by the parent: new body length, fact-check verdict, date/time)_

### 11.3 Nothing on #26 / #27 / #31

No dashboard action on these three. #31 stays draft awaiting the owner's decision (do not publish).

---

## 12. Deployment instructions (for the parent — DO NOT deploy without owner authorization)

**Current state: NOTHING deployed. Deployed HEAD remains e5f7aa3. The local tree is uncommitted and unpushed.**

1. **Push the local tree** via the established zip workflow (regenerate `~/workspace/fs-ai-source/fs-ai-source.zip` from `~/workspace/fs-ai-source/fs-ai/`, one-time workflow `.github/workflows/push-source-once.yml` created via the GitHub web UI, run by workflow_dispatch, deleted in the same commit; flatten `fs-ai/` BEFORE any content check; `git reset --soft <parent>` + force-push one clean commit). Base: e5f7aa3. Owner signs in via the browser's saved GitHub login (mdalfahad841-code). Cloudflare Pages auto-deploys on push to main.
2. **Apply migrations 020–023 to live D1, in order** (020_task_lifecycle_health, 021_publication_logs, 022_social_media, 023_seo_body_hash). The code is written to degrade gracefully pre-migration (pre-020 fallback in healthcheck, 3-column SEO insert fallback), but the new features do not function without them. Verify each applied (check the tables/columns exist) before proceeding.
3. **Set the `SOCIAL_TOKEN_SECRET` Worker secret** before any social use (token encryption fails closed without it).
4. **Run `npm run sitemap`** (regenerate-sitemap.mjs) before every deploy that follows a publish, so the served sitemap includes D1-only articles.
5. **Verify live after deploy:** published still 25; #26/#27/#31 unchanged (Section 10 values); settings unchanged (approved_only, all auto_* as before, social off, E-Stop off); new routes respond (`/api/health/latest`, `/api/analytics/detail`, `/api/social/status` — expect `connected: false` everywhere until OAuth); dashboard Control Center renders; no new tasks published anything.
6. **Do NOT enable auto-publishing at deploy time.** The three-part enablement (Section 13.1) is a separate owner decision, after live verification.

---

## 13. Required owner authorizations

### 13.1 Auto-publish enablement — THREE deliberate actions, all required

Absent any one, nothing auto-publishes. Code never flips a setting.

1. `publishing_mode` → `auto` (API now accepts it; previously refused).
2. `auto_publishing` → `on`.
3. Set `auto_publish_eligible_since` to an ISO 8601 timestamp (only articles created after it are eligible).

### 13.2 Social platforms — one-time OAuth each (do not connect anything without it)

Exact requirements are in `docs/SOCIAL-PLATFORMS-2026-11-21.md`. Summary:

- **Pinterest:** create a developer app, Trial access, scopes boards/pins/user_accounts read+write, token exchange; Standard access needs a demo-video review. Access token 30d, refresh 60d.
- **Facebook Page:** Meta developer app, Business use case, Page-admin grant, token exchange chain (user 1–2h → 60d long-lived → Page token effectively non-expiring). Own Page in dev mode needs NO App Review.
- **Instagram:** Business/Creator account first, Meta app + Instagram product, Instagram Login scopes (instagram_business_basic, instagram_business_content_publish). Token 60d. Media must be a public HTTPS URL.
- **LinkedIn (own profile):** developer app + Share on LinkedIn + Sign In with OpenID Connect. Access 60d, NO refresh tokens — re-OAuth every 60 days.
- **YouTube:** Cloud project + enable Data API v3 + OAuth client + consent screen to **Production** + pass Google audit (do NOT use while in Testing — uploads land PRIVATE). Then the Shorts flow can be evaluated for API use.
- **X:** no authorization is possible free of cost — UNAVAILABLE FREE OF COST (Section 3.4).

### 13.3 Per-article authorization — #28, #29, #30, #31

Each needs a separate owner authorization before it can be published at all (manually or automatically). The auto-publish evaluator refuses them by id unconditionally. #31 in particular stays draft until the owner's decision (its editorial audit said do-not-publish as-is; the minimal correction + SEO remediation are done, gate is Blocked on the internal-links check by editorial choice).

### 13.4 Still outstanding from before today (not part of this build)

- **Search Console indexing retry** — was due 2026-11-21 (6th attempt hit "Quota Exceeded"; sitemap still "Couldn't fetch" / 0 pages).
- **Saved 406 Google password** — still unverified-bad; owner action via Secure Vault card or signing in himself (Section 8).
- **Facebook Page, WhatsApp Business, Business Email, Cloudflare Access lock** — stopped on the owner's 2026-11-13 order; the 12:03 brief supersedes this ONLY for social automation framework + official integrations. Connecting any account still needs the one-time OAuth above. WhatsApp Business and Business Email remain stopped (not article distribution channels).

---

## 14. Remaining limitations and risks

1. **Nothing is live yet.** Every "IMPLEMENTED" claim in this report is local-only until the parent deploys and live-verifies. The 2026-11-22 06:00 Dhaka weekly run fires on the CURRENT deployed code, not this build — that is correct and intended; do not rush a deploy before it.
2. **Queue will grow at the weekly run.** The queue is 12 now; the run will likely add ~3 rows (daily-research ×2 + daily-content ×1). After deploy, the drain processes them oldest-first with the 1/day content cap — #24 waits until the next day after #37.
3. **Card renderer missing.** Pinterest/Instagram cannot post until a rendered card image exists (or the manual pin tool's output is reused) and, for Instagram, is hosted at a public URL. The adapters refuse without media — by design, not a bug.
4. **SEO repair can still create a misleading Related-reading link** (newest same-division sibling regardless of topical relevance). The auto evaluator rejects such a link, so it cannot auto-publish — but the link itself can still be created by the repair. A follow-up fix in seo.js is the remaining item.
5. **Duplicate scope gap:** cross-draft duplication is uncaught at auto-publish time (mitigated by 1/day limit + fresh SEO); daily-limit TOCTOU in `publishGatePassed()` is mitigated, not fully fixed (the auto path's conditional UPDATE + idempotency log make double-publish impossible).
6. **Truncation guard has no live-style end-to-end trigger** (no current code path assembles a truncated body).
7. **Task #31's 11:48 manual marking is unexplained** — confirm with whoever had D1 access at 11:48 on 2026-11-20.
8. **Latent trap:** the named `scheduled()` export in worker.js runs ONLY `publishDueArticles` — if anything ever wires it to the cron, daily/weekly silently stop. Not a live defect; do not rewire it.
9. **X is unavailable free** — if the owner wants X, it costs money (pay-per-use + card). Do not connect it without a new explicit authorization that names the cost.
10. **YouTube Data API is not ready for the Shorts flow** (Testing consent screen → PRIVATE uploads, 7-day token expiry). Browser-based uploads continue.
11. **Dashboard Delete button still appears broken** (8 failed attempts 2026-11-20) — out of scope, not fixed. Test drafts must still be deleted via D1.
12. **Acceptance tests are not live proof.** The first live drain, first live auto-publish decision, and first live social post (after OAuth) each need their own live verification with real evidence.

---

## 15. Sections for the parent to fill in after deploy + live verification

> **[TO BE FILLED IN BY THE PARENT — do not fill in until the deploy and live checks are actually done.]**

### 15.1 Deploy record

- Deploy commit: _(parent: new HEAD after the push workflow)_
- Workflow run: _(parent: run number + result)_
- Migrations 020–023 applied live: _(parent: Y/N each, with verification)_
- `SOCIAL_TOKEN_SECRET` set: _(parent: Y/N)_
- Deploy date/time (Dhaka): _(parent)_

### 15.2 Live verification after deploy

- Published count after deploy: _(parent: expect 25)_
- #26 / #27 / #31 unchanged: _(parent: Y/N with values)_
- Settings unchanged: _(parent: Y/N)_
- `/api/health/latest` response: _(parent: paste summary)_
- `/api/analytics/detail` response: _(parent: paste summary)_
- `/api/social/status` response: _(parent: expect connected:false everywhere)_
- Control Center renders: _(parent: Y/N)_
- Any article published by the deploy itself: _(parent: expect none)_

### 15.3 Weekly run 2026-11-22 06:00 Dhaka — verification after it fires

- New daily_reports row (date 2026-11-22, kinds `daily` AND `weekly`): _(parent: Y/N)_
- Published still 25: _(parent: Y/N)_
- #26 / #27 / #31 unchanged: _(parent: Y/N)_
- Queue rows after the run: _(parent: count, expect ~15)_
- E-Stop / settings re-checked: _(parent: Y/N)_

### 15.4 First live drain / auto-publish / social post (when authorized)

- First live drain result: _(parent: tasks processed, any failures)_
- First auto-publish decision (if enabled): _(parent: article id, gate result, publication_logs row)_
- First live social post (if authorized): _(parent: platform, post URL/ID, verification)_

---

## Appendix — files changed (local tree only)

**New files:** `backend/services/healthcheck.js`, `backend/publishing/divisions.js`, `backend/social/` (errors, platforms, content, tokens, store, dispatcher, adapters/base, pinterest, facebook, instagram, linkedin, youtube, index), `backend/routes/social.js`, `backend/routes/health.js`, `database/migrations/020_task_lifecycle_health.sql`, `021_publication_logs.sql`, `022_social_media.sql`, `023_seo_body_hash.sql`, `docs/SOCIAL-PLATFORMS-2026-11-21.md`, tests: `queue-drain`, `task-lifecycle`, `healthcheck`, `factcheck-correction-validation`, `seo-repair-snapshot`, `content-scaffold-regen`, `autonomous-publishing`, `divisions-support`, `social-adapters`, `social-dispatcher`, `social-routes`, `control-center`, `reliability-acceptance`, `regenerate-sitemap`.

**Changed files:** `backend/routes/scheduler.js`, `backend/agents/autonomy/factcheck.js`, `seo.js`, `content.js`, `backend/publishing/gate.js`, `backend/agents/autonomy/publishing.js`, `backend/routes/divisions.js`, `backend/agents/autonomy/social.js`, `backend/routes/analytics.js`, `frontend/pages/dashboard.html`, `frontend/scripts/dashboard.js`, `frontend/scripts/autonomy.js`, `backend/worker.js`, `backend/routes/orchestrator.js`, `backend/agents/autonomy-runner.js`, `backend/services/seo.js`, `scripts/regenerate-sitemap.mjs`, `package.json`, tests: `dashboard-status-truth`, `activation-repairs`, `task-lifecycle`, `task-timeout-phase4`, `autonomy-queue`, `sources-api`, `reliability-acceptance` (new).

**Deliberate deviations recorded openly:** per-claim carry-forward NOT gated on body hash (claim-text hash + evidence signature identity is enough; body hash guards the GATE); SEO revision snapshot is now post-repair (pre-edit rollback snapshot gone); stale-lock recovery re-queues instead of leaving `failed` (Section 4.3); settings allowlist widened for the three-part enablement (Section 4.1).
