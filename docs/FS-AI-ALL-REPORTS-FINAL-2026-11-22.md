# FS AI — All Reports (Final, 21–22 November 2026)

Compiled 22 November 2026, 19:40 Dhaka. Sixteen parts in one file, in chronological order. Parts 1–5 are the compilation of 22 November 11:23; Parts 6–15 were added at 19:36; Part 16 was added at 19:40. Each part is reproduced in full from its original file; only the heading levels were shifted by one so the compilation reads as a single document.

Note: Part 7 (Evidence Fetch Final Report) still carries its 22 Nov midday note that the #30 correction authorization was "still awaiting" — that question was answered by the owner at 19:24 ("Yes, apply the #30 correction") and resolved in Part 13. Part 7 is reproduced as written; Part 13 is the record of the outcome.

## Contents

- Part 1 — Final Autonomous Completion Report (21 November 2026)
- Part 2 — YouTube Channel Performance Investigation (21 November 2026)
- Part 3 — Deployment Verification Addendum (22 November 2026)
- Part 4 — Weekly Run Post-Run Verification Report (22 November 2026)
- Part 5 — Daily Short + Pin Job Report (22 November 2026)
- Part 6 — Post-Deployment Audit (22 November 2026)
- Part 7 — Evidence Fetch Feature, Final Report (22 November 2026)
- Part 8 — Corrector Citation-URL Fix (22 November 2026)
- Part 9 — Same-Day Correction-Retry Fix (22 November 2026)
- Part 10 — Ultimate Video System (22 November 2026)
- Part 11 — Search Console Verification (22 November 2026)
- Part 12 — Article #33 Correction, Live Outcome (22 November 2026)
- Part 13 — Article #30 Correction, Applied + Re-check (22 November 2026)
- Part 14 — Barmon Tips Video Analysis + Kinetic-Card Decision (22 November 2026)
- Part 15 — Final State, 23 November Schedule, Remaining Items (22 November 2026)
- Part 16 — Sitemap "Couldn't fetch", Investigation (22 November 2026)

---

## Part 1 — Final Autonomous Completion Report (21 November 2026)

## FS AI — Final Autonomous Completion Report

**Date:** 2026-11-21 (afternoon, Dhaka)
**Coordinator:** final completion coordinator (subagent, depth 1)
**Scope:** the two owner briefs of 2026-11-21 (Master Autonomous
Completion Prompt + YouTube Autonomous Growth System, 18 phases) plus the
owner's later authorizations and the new YouTube Autonomous Video System
brief of 2026-11-21 14:52.
**Foundation:** `docs/FS-AI-FULL-AUTONOMOUS-IMPLEMENTATION-2026-11-21.md`
(+ PART-1, PART-2) — the previous full implementation, completed locally
2026-11-21 12:36, NOT deployed. This report builds on it; it does not
repeat it. Read both together.
**Workstream notes (detail):**
`docs/FS-AI-COMPLETION-WS-A-NOTES-2026-11-21.md` (defects),
`docs/FS-AI-COMPLETION-WS-B-NOTES-2026-11-21.md` (queue + pipeline),
`docs/FS-AI-COMPLETION-WS-C-NOTES-2026-11-21.md` (social + card renderer),
`docs/FS-AI-COMPLETION-WS-D-NOTES-2026-11-21.md` (YouTube growth system),
`docs/FS-AI-COMPLETION-WS-E-NOTES-2026-11-21.md` (analytics + security).

### 1. Verdict

**DEPLOY-READY, with the conditions in §12 and the flags in §10.**
Local source is complete, the full suite is green (1266 pass / 0 fail),
live state is verified unchanged, and the deployment procedure, rollback,
and post-deploy verification are written out exactly. **Nothing is live
yet:** the deployed HEAD is still e5f7aa3; every "IMPLEMENTED" claim
below is local-only until the parent deploys and live-verifies.

- **Master prompt:** all §5 defects A–G fixed in code and tested (E and F
  are code-complete; their live runs are parent dashboard steps after
  deploy — see §13). Queue + pipeline audited and fixed (§6–7). Social
  framework + card renderer completed (§9). Analytics + security audited
  and fixed where fixable (§11–12). Full suite green (§14).
- **YouTube growth system (18 phases):** implemented in code, not just
  documented. One complete Short rendered locally on the new engine and
  verified 15/15 QA — **NOT uploaded, NOT published.**
- **YouTube autonomous video system (14:52 brief):** the production
  chain is implemented through subtitle generation; the upload step is
  browser-based with an exact parent procedure; API upload is NOT
  configured and NOT claimed. Complete YouTube autonomy is **NOT**
  claimed — it cannot be until a real end-to-end video is produced,
  uploaded and verified (§11).

### 2. Authorizations — record

#### 2.1 Grants, in order

- **2026-11-21 14:08 — DEPLOY permission granted.** ("Permission granted"
  for deploy.)
- **2026-11-21 14:10 — AUTO-PUBLISHING + SOCIAL POSTING permission
  granted.** ("Permission granted for auto publishing & social posting. do
  whatever you need.") Scope: auto-publish applies to **NEW articles
  passing all gates only**; the three-part enablement
  (`publishing_mode` → `auto`, `auto_publishing` → `on`, set
  `auto_publish_eligible_since` to the enablement time) is approved IN
  PRINCIPLE. Existing drafts **#28/#29/#30/#31 are NOT covered** — each
  still needs separate per-article owner authorization, and the
  auto-publish evaluator must keep refusing them by id. Social posting is
  authorized once accounts are connected; connecting any account still
  needs the owner's one-time OAuth per platform. Keep `social_auto_post`
  OFF in live settings until accounts are connected and the parent
  enables it post-deploy. YouTube Data API stays DO-NOT-USE (Testing
  consent screen → PRIVATE uploads). X stays UNAVAILABLE_FREE_TIER.
- **2026-11-21 14:12 — FULL OWNER AUTHORIZATION OVERRIDE.** Supersedes
  prior approval requirements for routine implementation/deployment.
  Authorized: (1) complete all remaining source-code modifications; fix
  all identified bugs; run all tests and integration checks. (2) Push the
  completed source to the official GitHub repo; deploy the verified
  implementation to Cloudflare Pages. (3) Apply database migrations
  020–023 in order. (4) Configure required free-tier environment secrets
  when available and authorized (`SOCIAL_TOKEN_SECRET` — parent sets it).
  (5) Verify all production routes and dashboard functionality.
  (6) Complete the #29 regeneration workflow while keeping it in draft,
  and perform the #30 fresh fact-check workflow. (7) Complete authorized
  social media integration setup; complete the free video-generation and
  publishing infrastructure; verify the complete autonomous pipeline;
  repair and activate eligible automation components. **The coordinator
  still cannot push/deploy/apply migrations itself** (no browser, no
  push access) — the PARENT executes the push/deploy after the work
  lands and the suite passes. **Deploy happens TONIGHT, before the
  2026-11-22 06:00 weekly run** — the weekly run fires on the NEW code
  (this supersedes the foundation report's "deploy after the weekly run"
  plan).
- **2026-11-21 14:52 — NEW OWNER BRIEF: YOUTUBE AUTONOMOUS VIDEO
  SYSTEM.** Folded into the running work as an extension of Workstream D
  (no second worker spawned on the same tree). Primary objective: a fully
  automated, zero-cost YouTube content production and management pipeline
  for the existing authorized channel @FSAI-e5f. Chain: topic discovery →
  topic research + evidence collection → script generation → factual
  verification → script correction → Bangla-English voiceover where
  appropriate → visual asset generation using free resources → motion
  graphics + video editing → subtitle generation + synchronization →
  thumbnail creation → title/description/tags generation → video quality
  validation → Shorts and long-form formatting. Zero-cost only; verify
  what TTS is actually free and report honestly (voice cloning stays
  off-limits). Investigate the existing YouTube OAuth configuration — do
  NOT assume Testing mode is suitable for permanent autonomous
  publishing; check OAuth consent status, refresh-token validity,
  YouTube API project verification/audit status, upload restrictions,
  channel authorization, API quota, actual video visibility. Do NOT
  switch OAuth settings or initiate an API audit without establishing
  requirements and consequences — document requirements + consequences
  and STOP there; the audit decision is the owner's. If the API is not
  ready, implement a compliant BROWSER-BASED YouTube Studio upload
  workflow as code + an exact step-by-step procedure the parent executes
  in the browser. Never request or store the owner's Google password.
  Never bypass CAPTCHA, account security, OAuth, or YouTube
  restrictions. Per video: generate → content + technical quality checks
  → metadata + thumbnail → upload through an authorized method → verify
  the actual YouTube video ID and URL → verify processing status and
  visibility → record the final result in FS AI. NEVER report UPLOADED
  or PUBLISHED based only on a successful upload request. Autonomous
  channel management: content calendar, topic planning, Shorts
  production, long-form production, upload scheduling, metadata
  optimization, duplicate detection, upload failure recovery, analytics
  collection, performance reporting, future content recommendations —
  using only available and authorized YouTube data. Safety: no public
  test uploads, no copyrighted material, no fabricated facts, no exposed
  OAuth tokens, no bypassing platform restrictions, preserve $0 and
  production data/safety settings. The real upload + verification is a
  PARENT browser step after the work lands (the coordinator produces the
  video locally and verifies the render; the parent uploads it through
  the authorized Studio session and verifies the live URL/visibility).

#### 2.2 Permanent restrictions (owner override 2026-11-21 14:12 — verbatim)

- Total budget $0. Never purchase a service or subscription. Never use
  paid APIs. Never invent successful operations. Never expose passwords,
  tokens or secrets. Never delete protected production data. NEVER
  publish #28, #29, #30 or #31 without their separate editorial
  authorization. Health and Finance articles must always require special
  human review. Never bypass platform policies or OAuth requirements.
  Never claim a social account is connected without successful
  authorization. Never claim a post or video is published without
  verifying its actual URL and visibility.
- Auto-publishing: only for NEWLY generated articles that pass EVERY
  required quality, fact-check, SEO, duplication, editorial and
  publication gate. Preserve the one-article-per-day limit and Emergency
  Stop. Existing drafts stay excluded.
- Deploy discipline: source backup first, full test suite verified,
  migrations verified, rollback prepared, production data preserved.
  Post-deploy: verify the deployed commit, migrations, all production
  routes, dashboard rendering, article counts and protected records,
  automation settings, and the first real workflow outcomes. Do not stop
  at a deployment-success message.

#### 2.3 What the coordinator did NOT do (boundaries held)

No push, no deploy, no live D1 writes, no live migrations, no
auto-publish enablement, no draft publication, no social posts, no
OAuth connections, no Emergency Stop change, no purchases, no paid APIs,
no dashboard access (no browser). Live D1 verification was SELECT-only
via the D1 helper. Live settings are unchanged (§15).

#### 2.4 Authorization discrepancy — flagged and reconciled

WS-A's notes §0.1 flagged that its original brief was more restrictive
than the 14:12 override recorded in MEMORY.md. Reconciled: the 14:12
override was forwarded to all streams and is the governing
authorization. WS-A followed its original restrictive brief anyway; that
caution cost nothing (its work is identical to what the override allows).

### 3. Starting state / commit information

- **Local tree:** `~/workspace/fs-ai-source/fs-ai/` — **NOT a git repo**
  (no `.git`). No local HEAD exists to report, and none is invented.
- **Deployed HEAD:** e5f7aa3 (verified via GitHub). Local changes are
  uncommitted and unpushed.
- **Backups (verified, exit 0, before major modifications):**
  `~/workspace/fs-ai-source/fs-ai-backup-20261121.tar.gz` — 1,065,165
  bytes, 313 entries (282 files + 31 dirs);
  `~/workspace/fs-ai-source/youtube-videos-backup-20261121.tar.gz` —
  2,595,946,051 bytes, 20,919 entries (20,907 files + 12 dirs).
- **Baseline suite re-run by the coordinator before changing anything
  (2026-11-21 ~14:10): 1106 pass / 0 fail, 271 suites, exit 0.**
- **Final suite (after merge, §14): 1266 pass / 0 fail / 0 cancelled /
  0 skipped, 322 suites.** Net +160 tests.
- **Cost of all work in this report: $0.00.** No paid service, API,
  model, credit, subscription, trial, or card was used.

### 4. Workstream A — Remaining defects (master §5)

All IMPLEMENTED_AND_TESTED locally (new tests, see §14). Migrations
024/025/026. Detail: WS-A notes.

| Item | Status | What was done |
|---|---|---|
| A. SEO Related-reading relevance | IMPLEMENTED_AND_TESTED | `seo.js` reuses `isInternalLinkRelevant` for Related-reading; rejects irrelevant / self / duplicate / draft links and misleading anchor text; removes irrelevant Related-reading lines; sibling window 5→25. If no relevant article exists, NO link is created (never faked to satisfy the check). **Live consequence found:** #28 now correctly gets NO Related-reading link (its old link was to irrelevant #12 "Best Family Cars Compared"). |
| B. Cross-draft duplicate detection | IMPLEMENTED_AND_TESTED | Normalized fingerprints (5-word shingles + Jaccard) across published / draft / queued / new / concurrent articles; fingerprint store (migration 024); duplicate publication prevented; unrelated articles never blocked; decisions logged; concurrent duplicate-generation tested (second concurrent duplicate gets 409 at the convert serialisation point). |
| C. Daily-limit TOCTOU | IMPLEMENTED_AND_TESTED | Atomic daily-slot reservation (migration 026): consumed on success, released on failure, idempotency enforced, concurrent jobs cannot bypass, retry creates no duplicates, logs match outcomes. Real bug found and fixed in testing: a released reservation's row blocked retries under the UNIQUE key — reserve now upserts, re-using only `released` rows. Pre-026 guarded-UPDATE fallback kept. |
| D. Truncation guard end-to-end | IMPLEMENTED_AND_TESTED | Detects incomplete final paragraphs, abrupt endings, missing sections, unclosed HTML/Markdown, unexpectedly short content, token-limit truncation, missing conclusion. Truncation is a 12th SEO entry forcing verdict `failed`. `isTruncatedDraftBody()` + absolute guard in `runCorrection` (shortness is corroborating-only, never standalone). Duplicate + truncation guards in generation/convert. A truncated article can NEVER pass the gate. |
| E. #29 regeneration | IMPLEMENTED_AND_TESTED (code); live run BLOCKED_BY_OWNER_AUTHORIZATION (parent dashboard step, §13.2) | Scaffold-regeneration implemented + tested (preserves article record + evidence provenance, complete article, no invented facts, source references, fresh fact-check + SEO checks in tests, stays draft, never published). **Live finding (SELECT-only ~14:35): #29 cannot regenerate from current evidence** — its only evidence is `research_items` 381, a 500-char truncated outdated Guardian fragment (0 chars current). The guard's expected outcome is the insufficient-evidence no-op; a re-fetch through the research engine (≥1000 chars current evidence) is the prerequisite. `MIN_REGEN_EVIDENCE_CHARS = 1000`; outdated evidence excluded. |
| F. #30 fresh fact-check | IMPLEMENTED_AND_TESTED (code); live run BLOCKED_BY_OWNER_AUTHORIZATION (parent dashboard step, §13.1) | Exact Re-check procedure prepared (§13.1). Expected new `fact_checks` row id 17+, kind `recheck`, verdict `needs-review` (not pass), `body_hash` must equal `7945750bc9d5768da933f6123d198de8be80e909ba1ea8a9aaad1bd2300852b4` (hash of the live 4615-char body). History fc 14/15/16 preserved. No live run, no live modification. |
| G. Dashboard Delete button | IMPLEMENTED_AND_TESTED | `dashboard.js` Delete UI repaired. Backend: admin-articles.js H1 protection guard on delete/update/setPublishState (runs BEFORE the 404 check, since protection is ID-level) + L4 orphan tag/source cleanup + deletion-audit write (migration 025). Owner-only, confirmation, never deletes published/protected records. Tested with fixtures only; NO live records deleted. |
| + GENERIC_KEYWORDS gap (found by coordinator at merge) | IMPLEMENTED_AND_TESTED | The word "article" alone previously made two titles "relevant" (`backend/publishing/divisions.js:180`). Added `'article', 'articles', 'post', 'posts'` to GENERIC_KEYWORDS. Two fixtures that relied on the gap were fixed (sibling renamed to 'Published EV Charging Article'; `insertArticle` gained a `title` option). |

### 5. Workstream B — Queue + pipeline (master §6–7)

Queue engine audited end to end (leases, expiry, stale-lock recovery,
retries, backoff, dead-letter, idempotency, dependencies, duplicate
prevention, crash recovery, health monitoring, timeouts, terminal
states, daily/weekly scheduling). Full pipeline verified stage by stage
(Research → Evidence → Draft → Fact-check → Correction → Re-check →
SEO → Quality Gate → Approval → Publication → Analytics), each with
input/output validation, error handling, audit logging, retry, explicit
status, recovery. Honest statuses only
(SUCCESS / FAILED / PENDING / REQUIRES_REVIEW / BLOCKED / RETRYING /
UNAVAILABLE). No task is marked successful without verifying its actual
result. No infinite loops. Failed tasks cannot silently disappear.

Fixes (scheduler.js, healthcheck.js only) — IMPLEMENTED_AND_TESTED:

- **F1 — drain now persists LLM drafts as CMS drafts** (draft,
  `fact_checked` 0, never published). **DELIBERATE BEHAVIOUR CHANGE —
  FLAG FOR PARENT CONFIRMATION (§10.1).** Previously the drain created
  zero articles; from the first post-deploy drain it creates draft
  articles automatically. The weekly path is unaffected.
- F2 — stale-recovery messages corrected.
- F3 — health check now degrades at ≥10 queued or oldest >24h.
- F4 — dead code removed. F5 — stale comment corrected.
- **Drain order correction:** the foundation report §14.2 was backwards.
  Oldest-first drain runs **#24 on 22 Nov and #37 on 23 Nov** (cap
  10/run: tasks 3,4,5,6,7,8,22,23,24,35 on 22 Nov; #36/#37 wait).
- Weekly path re-verified explicitly on the new code as read-only (one
  sanctioned mutation: stale-lock recovery). Schedule unchanged.
- Migrations 020–023 verified applying cleanly on a scratch SQLite DB.
- Live re-verification: 12 queued tasks unchanged, published 25,
  #26/#27/#31 unchanged, migrations 020–023 not live.
- Tests: 39 new; 131/131 across its files + affected suites, run twice.

**Not fixed — exact patches in WS-B notes §6–§7 (left as documented
gaps, §10.2):** S1 social pack returning `done` when all draft stores
fail (FIXED by the coordinator at merge — see §8); D1 no
task-dependency mechanism; O1 drain LIMIT-before-filtering; O2 two
"created today" definitions; O3 stale `handleRecoverStale` comment
(FIXED by the coordinator at merge — §8); `runCorrection` null-article
TypeError (FIXED by the coordinator at merge — §8).

### 6. Workstream C — Social + card renderer (master §9)

Framework completed; **no platform is CONNECTED and nothing is
PUBLISHED** — each needs the owner's one-time OAuth (§14). All posting
stays disabled until accounts are connected and the parent enables
`social_auto_post` post-deploy. Detail: WS-C notes.

- **Card renderer — IMPLEMENTED_AND_TESTED** (the missing piece):
  `backend/social/card.js` (deterministic SVG: Pinterest 1000×1500,
  Instagram 1080×1350, Facebook 1200×630, LinkedIn 1200×627; real title
  verbatim, division label, brand + site only; white-on-navy 18.27:1)
  + `scripts/render-social-card.py` (Pillow + DejaVu, already installed,
  $0; verified real PNG/JPEG, navy centre pixel, byte-identical
  re-renders). **Honest gap:** Workers cannot rasterize — the PNG is
  produced at publish-prep time and must be deployed under
  `social-cards/` before Pinterest/Instagram posts; the pack builder
  attaches the URL + an explicit render warning, never claims the file
  exists.
- OAuth: `oauth.js` (HMAC-signed 10-min platform-bound state,
  code→token exchange), `refresh.js` (expiry monitoring + official
  refresh; LinkedIn refused as WAITING_FOR_AUTHORIZATION — no refresh
  tokens; YouTube refresh gated), `media.js` (PNG/JPEG header
  validation), dispatcher YouTube DO-NOT-USE gate
  (`YOUTUBE_DATA_API_ENABLED` must be `true`, default off).
- Migration 027 (`refresh_token_expires_at` + `token_refreshed_at`).
- WS-E patches applied: M3 (E-Stop → 423) and L3 (allowlist — deliberate
  deviation: kept `platform_url`, which WS-E's list omitted but the
  dispatcher records on every published post).
- Tests: 38 new (card-renderer 10, token-expiry 11, failures 17);
  combined 93 tests, 92 pass / 0 fail / 1 pre-existing skip.
- **Blocked live per platform:** all four need owner one-time OAuth;
  Instagram needs an account created first (none exists); Pinterest
  needs Standard access for public pins; LinkedIn re-OAuth every 60d;
  YouTube DO-NOT-USE; X UNAVAILABLE_FREE_TIER.
- Coordinator addition: worker.js one-line OAuth-callback exemption
  (platform redirects carry no Bearer token) — applied at merge (§8).

### 7. Workstream D — YouTube growth system (18-phase brief)

Implemented in code, not just documented, with a full local test render.
Detail: WS-D notes (208 lines) + `work/YOUTUBE-GAP-REPORT-2026-11-21.md`.

**Gap report first:** NONE of P1–P12 was implemented in the old builders
(all still `PAD 0.5 / GAP 0.4 / ENDCARD 5.0`, 6 scenes, frozen plates,
silent end card). The new engine replaces them.

| Phase | Status | Evidence |
|---|---|---|
| 1. Audit | IMPLEMENTED_AND_TESTED | Gap report + P1–P12 verified against executable code (README is not proof — the code is). |
| 2. Topic selection | IMPLEMENTED_AND_TESTED | `work/topic_suitability.py` — 10-criterion 0–100 score, no invented stats. Real ranking of articles 6–10: **#06 79 good, #09 70 good, #10 68 good, #08 57 long-form-or-other, #07 51 long-form-or-other**. Bands 80–100 / 65–79 / 45–64 / <45 skip + recorded reason. Division balance noted, never forced. |
| 3. Shorts scripts | IMPLEMENTED_AND_TESTED | `work/script_engine.py` — validator REJECTS definition/intro/admin openings and >50 s scripts. Structure: hook → problem/curiosity → useful info → visual explanation → takeaway → short spoken Subscribe CTA. First sentence creates curiosity; never a definition or intro; cover hook = spoken opening promise. |
| 4. Motion graphics | IMPLEMENTED_AND_TESTED | `work/render_engine.py` — Paper Editorial / Field Guide identity PRESERVED. Continuous motion every scene (needle/fill/dot + spread check reveals + kinetic captions); no fully static scene >~3 s; every scene has meaningful visual change; no decorative-only motion; readable on mobile; 1080×1920. |
| 5. Pacing/retention | IMPLEMENTED_AND_TESTED | Enforced in `youtube_common.py`: 30–45 s target, 50 s max, 7–8 scenes, 3.5–5.5 s scenes, silent ending ≤2 s, dead air ≤8%, hook in first 1–3 s, short spoken CTA, synced readable captions. **Correction:** the README's suggested PAD/GAP 0.3 CANNOT meet the ≤8% dead-air cap at 7–8 scenes (4.2 s = 10.4% of 40 s), so PAD/GAP are 0.2 with the arithmetic recorded. Script/topic decides structure — never forced identical scene counts. |
| 6. Covers | IMPLEMENTED_AND_TESTED | Corner-circle ornament removed (P5 clip fix); chip row added; fill measured ~78% (test asserts ≥70% + clean masthead zone). Unique topic-specific cover per Short; large readable headline; strong contrast; one clear concept; instant topic recognition; hook visible small; no overlapping text; consistent branding. Long-form gets a separate 16:9 custom thumbnail (`longform.py`). |
| 7. SEO engine | IMPLEMENTED_AND_TESTED | `work/seo_engine.py` — title ≤55 chars, no "\| FS AI", 3–4 hashtags, never #FSAI; titles front-load search intent; descriptions benefit-first + guide link + CTA; no clickbait; never promises what the video doesn't deliver. |
| 8. Growth | IMPLEMENTED_AND_TESTED (code); API items BLOCKED_BY_OWNER_AUTHORIZATION | `work/growth.py` — spoken Subscribe CTA, series metadata, article↔video links, UTM tracking locally. Playlists / pinned comments / end screens are API actions — blocked (no YouTube Data API connection; consent screen in Testing, uploads would land PRIVATE). Never sends viewers off YouTube before delivering the promised value. No fake engagement, no bought subs/views, no bots. |
| 9. Long-form | IMPLEMENTED_AND_TESTED (scaffold); no second long video rendered yet | `work/longform.py` — scaffold + thumbnail + checklist; one 16:9 long video/week where suitable content exists; original narration, animated technical explanations, chapters, custom thumbnail, search-optimized metadata, article links, end screens; never a stretched Short. |
| 10. Analytics feedback | IMPLEMENTED_AND_TESTED | `work/analytics_store.py` + `work/youtube_analytics.db` seeded with the real Studio numbers. Records at 1h/24h/48h/7d/28d; unavailable stored as NULL, never 0; timestamps + periods; never combines incompatible metrics. The three impossible avg view durations (v4 15:07 vs 0:52, #03 14:05, #04 12:02) are flagged as anomalies and excluded from optimisation. #05's 57.1% stay rate is gated by the 30-view minimum-sample rule (n=7). Migration `028_youtube_analytics.sql` (D1 mirror — file only, never applied). |
| 11. Improvement loop | IMPLEMENTED_AND_TESTED (future videos only) | Rules in `reliability.py`: swipe-away → better opening; mid-drop → pacing/visual change; watch-no-subscribe → CTA/identity/series; high impressions low CTR → thumbnails/titles; weak search → topic/metadata. NEVER rewrite/re-upload published videos. Correlation ≠ causation. |
| 12. Scheduling | IMPLEMENTED_AND_TESTED | `pre_upload_checklist()` implemented; ~10:13 Dhaka preserved; the 19:00–21:00 test remains a PROPOSAL (cron untouched — needs separate owner approval). Account/channel/visibility/file/metadata/playlist/schedule/upload confirmation verified each run. No unfinished/failed renders published. No video failing factual/technical/quality checks published. |
| 13. QA | IMPLEMENTED_AND_TESTED | `work/qa_checks.py` — 14 pre-upload checks + motion validator. Two real bugs found and fixed during the test render (missing `codec_type` in ffprobe entries; pacing gate not receiving `endcard_s`/`spoken_cta_s`). All mandatory checks must pass; on failure diagnose → safe correction → re-run → record attempts → stop publication if still failing. **Check 02 (facts-numbers) was a stub — now a real verification** (§11.4). |
| 14. Reliability | IMPLEMENTED_AND_TESTED | Bounded retries (max 3, exponential backoff), hash+title duplicate prevention, missing-frame resume, permanent-failure records, JSONL run log, owner alerts on credential/permission expiry, no infinite loops, complete execution log. No silent failures, no false success. |
| 15. Cost/security | IMPLEMENTED_AND_TESTED | $0 only; Workers AI only where inference is needed; no OpenAI/Groq/Gemini/paid TTS/research; no new subscriptions; never expose keys/passwords; never store credentials in code; respects YouTube API quotas + OAuth permissions + policies. Unavailable-paid = reported as unavailable + best legitimate free alternative. |
| 16–17. Test render | IMPLEMENTED_AND_TESTED | **Short #06 rendered locally and verified (§11.3). NOT uploaded, NOT published.** Verified against the live Studio data already collected (stay rates, traffic mix) as the baseline — not re-pulled. |
| 18. (Report) | This document | §9 is the 12-item verification report the brief requires. |

#### 7.1 Short #06 — the test render (article 6, "Fuel Economy: 15 Proven Ways to Save Fuel")

- File: `FS-AI-Short-06-Fuel-Economy-15-Ways-to-Save-Fuel.mp4` (2.47 MB),
  7 scenes, 95 words, **37.30 s, dead air 7.8%**, 1080×1920, 1,119
  frames. Metadata + subtitle files beside it (`.txt`, `.srt`).
- **QA 15/15 PASS** (`work/qa_short06.json`), including the REAL check 02
  ("2 number(s) in script, all present in the article" — "Fifteen"→15
  and "one"→1) re-run against the live article-6 body (5253 chars).
- **Whisper base 99/99, small 99/99.** One real defect found and fixed
  by the both-models rule ("Plan trips together" heard as "plant" by
  both models → reworded to "Combine errands into one trip…",
  re-synthesised, re-verified).
- Frames visually inspected (cover, S2/S6 mid-scene, end card).
- Published mp4 mtimes verified untouched. **NOT uploaded, NOT published.**
- Tests: `python3 work/tests/test_youtube_engine.py` → **71/71 passed**
  (was 43/43; +28 new checks: subtitles, facts-numbers, calendar +
  record). `python3 -m py_compile` clean on all new/changed modules.

### 8. Workstream E — Analytics + security (master §11–12)

#### 8.1 Analytics — honest feedback loop

1 of 10 metrics VERIFIED live (revenue $0.00); 9 UNAVAILABLE with reason
+ path to availability; 0 ESTIMATED. The feedback loop was verified
read-only: analytics can never change publishing policy. Fixed:
`latestCheckRows` table-name allowlist in analytics.js. Detail: WS-E notes.

#### 8.2 Security audit — findings and dispositions

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | High | Manual article edit/publish/delete endpoints never called `assertNotProtected` — owner session could delete #26/#27 with one dashboard click. | **FIXED** (WS-A): guard on delete/update/setPublishState, runs BEFORE the 404 check. Test un-skipped: security-boundaries 19/19. |
| H2 | High | No security headers on Worker responses + article bodies render as raw HTML. | **FIXED** (coordinator, merge): `withSecurityHeaders` in `backend/worker.js` (CSP `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'`, X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin), applied to every fetch() response (route, rate-limit, 500 catch). |
| M1 | Medium | Groq/Gemini still in default LLM fallback order. | **FIXED** (coordinator, merge): `DEFAULT_PROVIDER_ORDER` → `['workers-ai']`; stored `llm_provider_order` filtered through an allowlist (`ALLOWED_PROVIDER_IDS = {'workers-ai'}`) so a stale stored value can never reintroduce a fallback. `config/wrangler.toml` `[ai]` block is just `binding = "AI"` — the fallback comment WS-E assumed exists does not exist, so nothing to change there. Live `llm_provider_order` setting does NOT exist (verified). |
| M2 | Medium | Login has no per-account lockout / failed-login logging. | **NOT IMPLEMENTED — known limitation (§10.2).** WS-E's sketch is a per-isolate Map (weak by WS-E's own note); proper D1-backed counting needs a migration + tests; touching the login handler hours before deploy risks locking the owner out. Sketch recorded in WS-E notes. |
| M3 | Medium | Social publish route mapped E-Stop block to 502, not 423. | **FIXED** (WS-C). E-Stop verified end to end on every path. |
| M4 | Medium | Session tokens 7-day, no rotation. | **Accepted risk** (single owner). |
| L1–L6 | Low | Rate-limit TOCTOU + localhost CORS; backup export includes subscriber emails; L3 updatePost allowlist; L4 Delete leaves orphan tag/source rows; L5/L6. | L3 **fixed** (WS-C, kept `platform_url` — see §6); L4 **fixed** (WS-A, migration 025); the rest **accepted risks**, recorded in WS-E notes. |

**Verified safe:** SQL injection (all bound params), auth (PBKDF2-100k),
settings allowlist, AES-256-GCM token encryption, dashboard XSS
escaping, CSRF N/A (Bearer in sessionStorage, no cookies), no secrets in
the tree. E-Stop verified end to end on every path. Tests: 37 new
(36 pass, 0 fail, 1 intentionally skipped — the H1 pin, later
un-skipped by WS-A, 19/19).

#### 8.3 Coordinator merge changes (after all five streams landed)

Verified on disk before editing; affected files 109/109 pass, 0 fail
(clean re-run to a log file).

- **M1** (§8.2) and **H2** (§8.2) as above.
- **OAuth-callback exemption** in worker.js `/api/social/` block: `GET
  /api/social/oauth/[a-z]+/callback` bypasses `requireOwner` (signed
  state token validated inside handleSocial); every other social route
  still requires the owner session.
- **S1:** `backend/agents/autonomy/social.js` — pack returns `failed`
  with `No social draft could be stored: …` when ALL draft stores fail;
  partial success stays `done` with failed platforms named in
  `warnings`; updated WS-B's pin test to the new behaviour.
- **O3:** `handleRecoverStale` doc comment in
  `backend/routes/orchestrator.js` corrected to the re-queue behaviour
  (stale task with retries left is RE-QUEUED with backoff, RETRYING;
  only retries-exhausted is marked failed,
  FAILED_FINAL_WITH_RECOVERY_REPORT). Verified against
  `recoverStaleTask` in `backend/routes/scheduler.js:258`.
- **`runCorrection` null-article guard** at
  `backend/agents/autonomy/factcheck.js` top: returns `{ outcome:
  'failed', error: 'Correction needs a valid article.'}` when `!article`.
- **seo-checks fixture:** `tests/seo-checks.test.js` line 128, GOOD_BODY
  `article?id=12` → `article?id=1` (WS-A verified by scratch script; the
  old fixture linked to irrelevant #12).
- **GENERIC_KEYWORDS** (§4) and **package.json `db:migrate`:** appended
  migrations 024–028 (was wired through 023 only). Migration set on disk
  is now 001–028 contiguous.
- **autonomy-llm fixture fix:** the canned generation body in the
  "content agent + LLM" test had no outline headings, so WS-A's
  truncation guard correctly no-op'd it (missing required sections).
  Fixed the fixture to carry its outline headings (`## Introduction`,
  `## Key takeaways`) and end on a content word ("instructions" — "it"
  IS in TRUNCATION_FUNCTION_WORDS, "only" is not). This is a fixture
  fix, not a weakening of the guard.

### 9. YouTube autonomous video system — 12-item verification report (owner brief 2026-11-21 14:52)

**Division of labor, stated plainly:** the coordinator produced the
video locally and verified the render; the real upload + verification is
a PARENT browser step after this work lands (the parent uploads through
the authorized Studio session and verifies the live URL/visibility).
**Complete YouTube autonomy is NOT claimed** — it cannot be until a real
end-to-end video has been successfully produced, uploaded and verified.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Video production | IMPLEMENTED_AND_TESTED (through subtitle generation; upload is browser-based, item 8) | Full chain implemented as code: topic discovery (`topic_suitability.py`) → research + evidence → script generation + factual verification + correction (`script_engine.py`, `qa_checks.py`) → voiceover (§9.2) → visual assets + motion graphics + editing (`render_engine.py`, `youtube_common.py`) → subtitles (§9.4) → thumbnail/cover (§9.5) → title/description/tags (`seo_engine.py`) → quality validation (`qa_checks.py`, 14 checks) → Shorts + long-form formatting (`longform.py`). Short #06 rendered and verified (§7.1). |
| 2 | Free TTS | IMPLEMENTED_AND_TESTED | `/opt/hatch/bin/tts` — "Text-to-speech via Meta Shortwave API", platform-provided, default voice `avocado_v2:MAI_03`, $0 additional cost (no separate paid subscription, no API key to buy). Bangla verified live 2026-11-21 ~09:00 UTC: `printf 'Assalamu Alaikum' \| /opt/hatch/bin/tts speak --text-stdin --language bn --voice avocado_v2:MAI_03 --speed 90` synthesized a 1.248 s mp3, `ok:true` (probe file deleted afterwards). An earlier probe failed only because `--text-stdin` was omitted. Bangla voiceover is available; it is unused only because there is no Bangla source material (all FS AI articles are English). Voice cloning is NOT used — only the licensed stock voice (off-limits, per the owner's standing rule). No paid TTS anywhere. |
| 3 | Video rendering | IMPLEMENTED_AND_TESTED | `work/render_engine.py` + `work/youtube_common.py`. Short #06: 37.30 s, 7 scenes, 95 words, dead air 7.8%, 1080×1920, 1,119 frames, 2.47 MB mp4. Frames visually inspected (cover, S2/S6 mid-scene, end card). |
| 4 | Subtitles | IMPLEMENTED_AND_TESTED | NEW `work/subtitles.py` — SRT export, one cue per scene timed to the narration window (cue starts at scene start, ends at narration end, i.e. window end minus the 0.2 s PAD silence), `format_timestamp`, `build_srt` (validates sorted / non-overlapping / within duration / non-empty text, raises ValueError), `srt_from_timeline` (uses `build_timeline`; optional spoken-CTA end-card cue), `write_srt` (UTF-8, no BOM). Generated for #06: `FS-AI-Short-06-...srt` (8 cues: 7 scenes + CTA; cue 1 `00:00:00,300 --> 00:00:04,294`). Word-level timing via Whisper `word_times.json` is a documented future refinement — scene-level cues are exact by construction. `work/word_times.json` on disk is an OLD file (Short #03-era: "Charging an electric car at home…"), not #06. **QA check 02 was a stub — now real:** `check_facts_numbers(script_text, article_text)` + `extract_numbers()` (digit sequences with commas/percent/currency stripped + English number-words one–thousand normalized to digits; scene prefixes `S1\|…` stripped first so labels aren't counted as numbers). `run_qa()` gained an `article_body=None` parameter; check 02 FAILS CLOSED when the article body is not supplied (fails with "article body not supplied — numbers cannot be verified" instead of passing vacuously). Re-run on #06 against the live article-6 body: 15/15 PASS (`work/qa_rerun_short06.py`; `qa_short06.json` rewritten). |
| 5 | Thumbnails | IMPLEMENTED_AND_TESTED (cover frame); platform limit recorded | Shorts cannot take an uploaded thumbnail image — YouTube auto-picks a frame; every video from #03 opens with a designed cover frame (title + FS AI + illustration), each DISTINCT (different accent colour, layout, illustration hook, bold hook line). #06 cover: amber #B45309, title at top, big fuel gauge + pump, hook "Burning fuel you don't need?", chip row DRIVE GENTLY / CHECK TYRES / PLAN TRIPS, fill ~78% of frame height. Long-form gets a separate 16:9 custom thumbnail (`longform.py` scaffold + checklist; no second long video rendered yet). |
| 6 | YouTube OAuth | NOT CONFIGURED | Live D1 has NO `social_accounts` / `social_posts` / token / oauth tables (full `sqlite_master` list verified, 42 tables, migrations 001–019 era). The repo contains only env-var names `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` (`backend/social/oauth.js:99`), no values, no Google Cloud project id anywhere. The OAuth flow is implemented in code (authorization URL at `accounts.google.com/o/oauth2/v2/auth`; code exchange at `oauth2.googleapis.com/token`, `backend/social/oauth.js:270`; encrypted token storage; refresh) but has never run — no tokens exist to refresh. Uploads to date are browser-session only (owner signed in as mdalfahad406; 6 videos live, all Public). Scopes the code would request (`backend/social/platforms.js:137`): `https://www.googleapis.com/auth/youtube.upload` (sensitive) + `https://www.googleapis.com/auth/youtube` (restricted — full account access). **Recommendation (owner decision, not done):** narrow the scopes to `youtube.upload` (+ `youtube.readonly` if reads are needed) BEFORE any verification attempt — the restricted scope makes verification heavier (see item 7). |
| 7 | YouTube API audit | NOT INITIATED — STOP | Consent screen status "Testing" is the standing fact from the owner brief + WS-C notes; it is NOT verifiable from the repo/D1 — the console state lives in the owner's Google Cloud project and the parent/owner must confirm it there. Requirements + consequences are documented in full in `work/YOUTUBE-OAUTH-AUDIT-2026-11-21.md`: Testing consequences (API uploads PRIVATE; refresh tokens for test users expire after 7 days; only listed test users can authorize); Production requirements (Cloud project + API enabled + consent screen to Production + Google verification: privacy-policy URL, authorized domains, demo video, review time days–weeks; restricted scopes can add a third-party security assessment — time + a fee the owner would have to approve explicitly under the $0 rule); quota (default 10,000 units/day; `videos.insert` costs 1,600 units, ~6 uploads/day). **Nothing was switched, initiated, or audited. The audit decision is the owner's.** Browser upload stays the authorized method. |
| 8 | Browser upload | IMPLEMENTED_AND_TESTED (procedure); execution is a PARENT browser step | `work/BROWSER-UPLOAD-PROCEDURE-2026-11-21.md` — exact Studio steps for Short #06 (title/description/tags verbatim from the `.txt`, no thumbnail upload for Shorts, upload the `.srt`, visibility Public, Publish), mandatory verification (real video ID + live URL + Public + processing complete + no restrictions + cover frame + subtitles), the exact `record_upload.py` command, and failure handling. Never request or store the owner's Google password. Never bypass CAPTCHA, account security, OAuth, or YouTube restrictions. |
| 9 | Actual channel connection | BROWSER SESSION ONLY — no API connection | Channel @FSAI-e5f, ID UCnuMFV5vL3c6jyJGGei2b9Q, owner account mdalfahad406@gmail.com, 2 subs (Community posts need 500). Session expires repeatedly (~1 h); the owner signs in himself via takeover; do NOT sign out. 6 videos live, all Public, all via browser upload. No API connection exists (item 6). |
| 10 | Actual upload verification | NOT DONE for #06 — NOT uploaded | #06 is a local test render only. `work/record_upload.py` records a Studio-VERIFIED browser upload ONLY (it cannot verify YouTube itself; the operator must verify the live URL + visibility + processing in Studio first; never run on an upload request alone). Validates video-id (11 chars), URL (shorts / watch / youtu.be, id must match), visibility (Public/Unlisted/Private). Records: receipt JSON in `work/upload_receipts/<video-id>.json`; analytics store upsert + one 'upload' performance row with all metrics NULL (never 0); `work/article_video_links.json` — the article→video registry (with UTM URL) that WS-D described but had not created (verified missing by `find` before this fix; article pages consuming it is a backend follow-up, not claimed); advances the daily state file ONLY when `--next-article` is given. Idempotent: re-running the same video-id overwrites the same rows. Video keys follow the existing convention (`'06'` for Short #06, `'long01'` for long-form). |
| 11 | Remaining limitations | See §10 | The full list (F1 flag, M2/O1/O2/D1, publishDueArticles daily-limit gap, live FK unverified, #29 evidence, #30 re-check, scope-narrowing, article-page video links, posting-time test, 406 password, Search Console retry). |
| 12 | Monthly operating cost | **$0.00** | No paid service, API, model, credit, subscription, trial, or card. TTS is platform-provided at $0 additional; rendering is local (ffmpeg); hosting is the existing free Cloudflare Pages tier; Workers AI is the only inference provider (free tier). If any feature cannot be delivered free, it is reported UNAVAILABLE_FREE_TIER (X; the YouTube API audit's possible security-assessment fee is the owner's decision, never auto-paid). |

#### 9.1 Content calendar (new)

`work/content_calendar.py` — PLAN ONLY (never touches the cron, state
file, or any video). Rules: one Short/day in ranking order (best band
first), one long-form/week (Saturday slot) from the best
long-form-or-other topic, no repeats, division balance noted never
forced. Generated `work/content_calendar.json` + `.md` for
2026-11-22 → 2026-12-05 (14 days): 22 Nov #06 rendered-awaiting-upload,
23 Nov #09, 24 Nov #10, 28 Nov long-form #08 ("Electric Vehicle Range:
What the Numbers Really Mean", 57), 5 Dec long-form #07 ("ADAS
Explained: How Driver Assistance Really Works", 51); all other days
honestly "no-suitable-topic" (only articles 6–10 were ranked; run the
suitability engine on the next articles before producing for those
days). All ranked topics are Automotive. A real bug was found while
generating: the ranking file stores long-form-or-other topics under the
top-level `skipped` list, not `kept` — the calendar now reads both lists
(test updated to the real layout).

#### 9.2 PIPELINE-README updated

`work/PIPELINE-README.md` §0C records the new modules (`subtitles.py`,
`content_calendar.py`, `record_upload.py`, `qa_rerun_short06.py`),
the check-02 contract (`run_qa` now requires `article_body`),
the SRT, the calendar, the upload procedure + OAuth audit doc pointers,
and that `article_video_links.json` is now created by `record_upload.py`
on first recorded upload.

### 10. Known limitations, flags, and gaps

#### 10.1 Flag for parent confirmation — F1 drain draft conversion

From the first post-deploy drain, the queue drain persists LLM drafts
as CMS drafts (draft, `fact_checked` 0, never published). Previously the
drain created zero articles. This is a deliberate behaviour change by
WS-B. It is safe by construction (drafts cannot publish without passing
every gate + the 1/day limit + owner enablement), but the parent should
confirm it explicitly before the first post-deploy drain, because the
first drain will create draft articles automatically.

#### 10.2 Documented gaps (not fixed tonight, with reasons)

- **M2 — login lockout not implemented** (§8.2). WS-E's sketch is a
  per-isolate Map (weak by WS-E's own note); proper D1-backed counting
  needs a migration + tests; touching the login handler hours before
  deploy risks locking the owner out. Sketch in WS-E notes.
- **O1 — drain LIMIT-before-filtering.** Zero live impact; drain-path
  risk the night before deploy. Left as a documented gap.
- **O2 — two "created today" definitions.** Zero live impact; same reason.
- **D1 — no task-dependency mechanism.** No dependency feature exists;
  tasks cannot declare "run after X". Exact patch sketched in WS-B
  notes §6–§7.
- **`publishDueArticles()` (scheduled path) has NO daily-limit check.**
  Noted gap — no silent change. The auto-publish path's conditional
  UPDATE + idempotency log make double-publish impossible, but the
  scheduled path itself does not enforce the 1/day limit.
- **Live FK behaviour for `article_revisions` cascade unverified.**
  Post-deploy inspection item: confirm the cascade behaves as the
  migration intends on live D1.
- **Article pages do not yet consume `article_video_links.json`.**
  The registry exists now (created by `record_upload.py`); wiring the
  article pages to it is a backend follow-up, not claimed.
- **YouTube OAuth scopes as written request the restricted `youtube`
  scope** (§9 item 6). Narrow before any verification attempt.
- **Task #31's 11:48 manual marking (2026-11-20) is unexplained.**
  Confirm with whoever had D1 access at 11:48 on 2026-11-20.
- **Latent trap:** the named `scheduled()` export in worker.js runs ONLY
  `publishDueArticles` — if anything ever wires it to the cron,
  daily/weekly silently stop. Not a live defect; do not rewire it.
- **Live `llm_provider_order` setting does NOT exist** (verified) — the
  allowlist fix is purely defensive.

#### 10.3 Pre-existing limitations carried forward (not created by this round)

- **#29 cannot regenerate from current evidence** (§4 E). Re-fetch first.
- **#30's latest fact-check (fc 16) is stale** (body_hash NULL) until the
  Re-check runs (§13.1).
- **Search Console:** sitemap "Couldn't fetch" / 0 pages after 6
  attempts (file fine: 200, valid XML, 60 URLs). Article 1 still "URL is
  not on Google"; Request indexing → "Quota Exceeded" 6th time — next
  try was 2026-11-21 (still outstanding). Homepage indexed. The saved
  841 Google login works for Search Console; the 406 saved password is
  still unverified-bad.
- **YouTube Data API do-not-use; X UNAVAILABLE_FREE_TIER** (§9 items 6–7).
- **Posting-time test (19:00–21:00 Dhaka) is a proposal only** — needs
  separate owner approval; the ~10:13 Dhaka schedule is unchanged.
- **Facebook Page, WhatsApp Business, Business Email, Cloudflare Access
  lock** — stopped on the owner's 2026-11-13 order; the 12:03 brief
  supersedes this ONLY for the social automation framework + official
  free integrations. WhatsApp Business and Business Email remain stopped
  (not article distribution channels).
- **Pinterest website claim:** the meta tag `p:domain_verify`
  `8809cf58fdce34599cf8a76611cf5e1c` must STAY in the homepage head
  (commit 8d5094c) to keep the claim.
- **SEO internal-links check fails by editorial choice for #31**
  (Related reading to #22 is not genuinely relevant) — the gate stays
  Blocked; #31 stays draft until the owner's decision. A passing gate
  is content-ready only, never a publish verdict.

### 11. Test evidence

#### 11.1 Full suite — before and after

| Run | Result | Suites | Notes |
|---|---|---|---|
| Baseline, 2026-11-21 ~14:10 (before any change) | **1106 pass / 0 fail** | 271 | Re-run by the coordinator to confirm the starting state. |
| First merged run, ~15:30 (~42 s) | **1252 pass, 6 fail, 8 cancelled** | — | Seven real failures, all diagnosed (see §11.2). |
| Second merged run, ~15:30 (~40 s) | **1266 pass / 0 fail / 0 cancelled / 0 skipped** | 322 | **Final. Green.** |
| YouTube engine, before | 43/43 passed | — | WS-D's count. |
| YouTube engine, after | **71/71 passed** | — | +28 new checks (subtitles, facts-numbers, calendar + record). `python3 -m py_compile` clean on all new/changed modules. |

Net +160 tests (WS-A +46, WS-B +39, WS-C +38, WS-E +37; the merge
added 0 net tests). No test was weakened and no quality/safety rule was
weakened to make the suite pass — every failing test was fixed by fixing
the code, the fixture, or the test's stale expectation (each listed in
§11.2 / §8.3). Logs: `/tmp/full-suite.log` (first run),
`/tmp/full-suite2.log` (second run, 1266/0/0), `/tmp/merge-tests.log`,
`/tmp/fix-verify.log`, `/tmp/fix-verify2.log` (118/118), `/tmp/cms.log`.

#### 11.2 First-run failures — diagnosed and fixed (7)

All seven were workstream fallout or the coordinator's own merge
changes — none was a production-code bug; the H1 guard behaved as
designed (protection is ID-level by constant; in production ids 26/27
already exist as rows so a new article can never reuse them).

1. `tests/autonomy-agents.test.js:317` (S1) — coordinator's change; test
   still asserted 'done'.
2. `tests/autonomy-queue.test.js:363` (M1) — coordinator's change; test
   still asserted the 3-provider order.
3. `tests/backup-restore.test.js:148` (before-hook) — WS-A H1 fallout:
   fresh auto-increment id collides with protected id 26 (seed loads
   1–25, next id is 26, PUT → 403).
4. `tests/cms.test.js:183` DELETE 500 — WS-A L4 fallout: the fake-D1 test
   double (`tests/fake-d1.js`) has no `DELETE FROM article_sources`
   handler ("fake D1: unsupported statement") — a test-double gap, not
   production code.
5. `tests/dashboard-status-truth.test.js:97` — WS-C fallout:
   `backend/social/oauth.js:270` uses `https://oauth2.googleapis.com/token`
   (the Google OAuth token endpoint), which the test's googleapis scan
   didn't strip (it already strips `generativelanguage.googleapis.com`
   and `www.googleapis.com`).
6. `tests/protection.test.js:369` — WS-A relevance fallout: "#28 got the
   Related reading link" (same stale expectation class WS-A fixed in
   autonomy-scheduler).
7. `tests/real-db.test.js:263` — WS-A H1 fallout: freshly created article
   gets id 26, publish → 403.

**Fixes applied:** fake-d1.js gained a `DELETE FROM article_sources`
case (returns success, 0 changes — the double models no such rows);
autonomy-agents test now asserts `failed` + `/No social draft could be
stored/`; autonomy-queue test now asserts order `['workers-ai']`;
dashboard-status-truth test also strips `oauth2.googleapis.com` with a
comment (OAuth token endpoint for the owner-authorized YouTube flow,
not a reporting integration); protection test now asserts #28 gets NO
Related-reading link; seeded protected draft rows #26 (division 2, 'How
Artificial Intelligence Is Changing Everyday Life') + #27 (division 1,
'Tesla Cybercab Factory at Giga Berlin') in `tests/real-db.test.js`
before() and `tests/backup-restore.test.js` before-hook (omitting
`is_protected` — ID-level protection doesn't need the column); updated
backup counts 26→28 and post-restore created id 27→29 (backup's max id
is now 28; deleted id 29 correctly reused).

#### 11.3 What tests do NOT cover (honest)

- The first live drain, first live auto-publish decision, and first
  live social post (after OAuth) each need their own live verification
  with real evidence — local tests are not live proof.
- The timeout/lease/cancel paths from Phase 4 are untested live
  (nothing stuck after the fix).
- Live FK cascade behaviour (§10.2) — post-deploy inspection.
- The OAuth flow end to end (no client exists; §9 item 6).
- A real browser upload (§9 item 8) — parent step.

### 12. Deployment procedure + post-deploy verification (for the parent)

**Current state: NOTHING deployed. Deployed HEAD remains e5f7aa3. The
local tree is uncommitted and unpushed.** Deploy TONIGHT, before the
2026-11-22 06:00 Dhaka weekly run, so the run fires on the NEW code.
Do NOT trigger the weekly run manually, do NOT disturb it, do NOT change
the schedule.

#### 12.1 Pre-deploy checklist

- [ ] Source backup exists and is complete:
  `~/workspace/fs-ai-source/fs-ai-backup-20261121.tar.gz` (1,065,165
  bytes, 313 entries) — verified by the coordinator.
- [ ] Full suite green: **1266 pass / 0 fail** (§11.1). Re-run `npm test`
  from `~/workspace/fs-ai-source/fs-ai/` if the tree changed since.
- [ ] Migrations 020–028 present on disk, in order, and verified
  applying cleanly on a scratch SQLite DB (WS-B verified 020–023;
  024–028 follow the same pattern). `package.json` `db:migrate` is wired
  through 028 (fresh DBs only — do NOT re-run the full chain on live D1;
  apply 020–028 individually, §12.2 step 2).
- [ ] Rollback prepared (§12.4) and DB backup procedure ready (§12.5).
- [ ] E-Stop OFF (verified live: `website_settings` `emergency_stop` =
  `'0'`).

#### 12.2 Deployment steps (in order)

1. **Back up live D1 first** (§12.5): `GET
   https://fs-ai.mdalfahad841.workers.dev/api/admin/backup/run` (owner
   session) and confirm a new `backup_runs` row; also download the JSON
   dump (`GET /api/admin/backup`) and keep it. Expected: `exported_at`
   = now, tables counted, no warnings. Restore is manual — see
   `docs/BACKUP-RECOVERY.md`.
2. **Apply migrations 020–028 to live D1, in order**, from
   `~/workspace/fs-ai-source/fs-ai/` (each command must succeed before
   the next):
   ```sh
   wrangler d1 execute fs-ai-db --file=database/migrations/020_task_lifecycle_health.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/021_publication_logs.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/022_social_media.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/023_seo_body_hash.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/024_article_fingerprints.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/025_article_deletion_audit.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/026_daily_publication_reservations.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/027_social_token_refresh.sql
   wrangler d1 execute fs-ai-db --file=database/migrations/028_youtube_analytics.sql
   ```
   Verify each applied (check the tables/columns exist — expected new
   tables include `system_health_checks` (020), `publication_logs` (021),
   `social_accounts`, `social_posts`, `social_analytics` (022),
   `article_fingerprints` (024), `article_deletion_audit` (025),
   `daily_publication_reservations` (026), `youtube_videos`,
   `youtube_performance`, `youtube_anomalies` (028); 023 and 027 add
   columns only).
   The code degrades gracefully pre-migration, but the new features do
   not function without them.
3. **Push the local tree** via the established zip workflow (regenerate
   `~/workspace/fs-ai-source/fs-ai-source.zip` from
   `~/workspace/fs-ai-source/fs-ai/`, one-time workflow
   `.github/workflows/push-source-once.yml` created via the GitHub web
   UI, run by workflow_dispatch, deleted in the same commit; flatten
   `fs-ai/` BEFORE any content check; `git reset --soft <parent>` +
   force-push one clean commit). Base: e5f7aa3. Owner signs in via the
   browser's saved GitHub login (mdalfahad841-code). Cloudflare Pages
   auto-deploys on push to main.
4. **Set the `SOCIAL_TOKEN_SECRET` Worker secret** before any social use
   (token encryption fails closed without it). Generate first (any shell):
   ```sh
   openssl rand -base64 48
   ```
   Then, from `~/workspace/fs-ai-source/fs-ai/`:
   ```sh
   npx wrangler secret put SOCIAL_TOKEN_SECRET --config config/wrangler.toml
   # Paste the generated value when prompted. This ONE secret signs OAuth
   # states AND encrypts every stored social token (AES-256-GCM). If it
   # is ever rotated, all stored social tokens become undecryptable and
   # every account must re-OAuth — there is no recovery path by design.
   # NEVER commit it, never put it in wrangler.toml [vars], never log it.
   ```
   Per-platform OAuth client credentials — set ONLY when the owner
   starts that platform's connection (§14):
   ```sh
   npx wrangler secret put PINTEREST_CLIENT_ID --config config/wrangler.toml
   npx wrangler secret put PINTEREST_CLIENT_SECRET --config config/wrangler.toml
   npx wrangler secret put FACEBOOK_APP_ID --config config/wrangler.toml
   npx wrangler secret put FACEBOOK_APP_SECRET --config config/wrangler.toml
   npx wrangler secret put INSTAGRAM_CLIENT_ID --config config/wrangler.toml
   npx wrangler secret put INSTAGRAM_CLIENT_SECRET --config config/wrangler.toml
   npx wrangler secret put LINKEDIN_CLIENT_ID --config config/wrangler.toml
   npx wrangler secret put LINKEDIN_CLIENT_SECRET --config config/wrangler.toml
   # YouTube client id/secret ONLY if/when the audit path (§9 item 7) is ever approved:
   npx wrangler secret put YOUTUBE_CLIENT_ID --config config/wrangler.toml
   npx wrangler secret put YOUTUBE_CLIENT_SECRET --config config/wrangler.toml
   ```
5. **Run `npm run sitemap`** (regenerate-sitemap.mjs) before every deploy
   that follows a publish, so the served sitemap includes D1-only
   articles.
6. **Do NOT enable auto-publishing at deploy time.** The three-part
   enablement (§12.6) is a separate step, after live verification.

#### 12.3 Post-deploy verification checklist (exact commands + expected results)

- [ ] Deployed commit is the new one (Pages deployment log shows the
  pushed commit; site serves the new code).
- [ ] Migrations live: the new tables from §12.2 step 2 exist
  (SELECT from `sqlite_master`).
- [ ] Published still **25**; drafts still **6**; #26/#27/#28/#29/#30/#31
  unchanged (exact values in §15).
- [ ] Settings unchanged: `publishing_mode` approved_only,
  `auto_publishing` off, `auto_correction` off, `social_auto_post` off,
  `auto_research`/`auto_generation`/`auto_factcheck` on,
  `max_articles_per_day` 1; E-Stop OFF.
- [ ] New routes respond: `GET /api/health/latest`, `GET
  /api/analytics/detail`, `GET /api/social/status` — expect
  `connected: false` everywhere until OAuth.
- [ ] Dashboard Control Center renders
  (`https://fs-ai-5w5.pages.dev/pages/dashboard.html`, owner session).
- [ ] No new tasks published anything; no article changed status.
- [ ] Live FK behaviour for `article_revisions` cascade inspected
  (§10.2).
- [ ] First real workflow outcomes observed (daily run / first drain)
  and recorded in §16.

#### 12.4 Rollback procedure

- **Code rollback:** re-push the previous deployed commit (e5f7aa3) via
  the same zip workflow; Pages redeploys on push. The old code degrades
  gracefully against the new migrations (pre-020 fallback in
  healthcheck, 3-column SEO insert fallback).
- **Migration rollback:** migrations 024–028 are additive tables/columns
  (024 fingerprints, 025 deletion audit, 026 reservations, 027 token
  refresh columns, 028 youtube analytics). Rollback is `DROP TABLE` for
  the new tables (028: 3 DROP TABLEs) and, for 027, dropping the two
  added columns (SQLite: recreate the table without them, or leave them
  — leaving them is harmless; no data to roll back, since no live
  social rows exist). Migrations 020–023 rollback is per the foundation
  report.
- **Data rollback:** restore from the §12.5 backup (manual restore per
  `docs/BACKUP-RECOVERY.md`). Protected records #26/#27 must never be
  deleted; the H1 guard now blocks that from the dashboard.

#### 12.5 DB backup procedure

- `GET /api/admin/backup/run` (owner session) — runs a backup export
  and records it in `backup_runs` (migration 011). `GET /api/admin/backup`
  returns the JSON dump of the CMS/agent data (per-table row caps:
  agent logs and automation jobs 500 rows; everything else 1000).
  Restore is manual — see `docs/BACKUP-RECOVERY.md`. Run a backup
  before every deploy and before the #29/#30 procedures.

#### 12.6 Auto-publish enablement — exact procedure (14:10 grant)

Do this ONLY after deploy + live verification (§12.3) pass. Three
deliberate actions, all required; absent any one, nothing auto-publishes.
Code never flips a setting. Use the dashboard settings UI, or the API
(owner session):

```sh
# 1. publishing_mode -> auto
curl -X POST https://fs-ai.mdalfahad841.workers.dev/api/autonomy/settings \
  -H "Authorization: Bearer <OWNER_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"key":"publishing_mode","value":"auto"}'
# 2. auto_publishing -> on
curl -X POST https://fs-ai.mdalfahad841.workers.dev/api/autonomy/settings \
  -H "Authorization: Bearer <OWNER_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"key":"auto_publishing","value":"on"}'
# 3. set auto_publish_eligible_since to the enablement time (ISO 8601, UTC)
curl -X POST https://fs-ai.mdalfahad841.workers.dev/api/autonomy/settings \
  -H "Authorization: Bearer <OWNER_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"key":"auto_publish_eligible_since","value":"<NOW ISO 8601, e.g. 2026-11-21T18:00:00.000Z>"}'
# Verify after each step:
curl https://fs-ai.mdalfahad841.workers.dev/api/autonomy/settings \
  -H "Authorization: Bearer <OWNER_TOKEN>"
# Expected: publishing_mode 'auto', auto_publishing 'on',
# auto_publish_eligible_since = the timestamp just set.
```

Only articles created AFTER `auto_publish_eligible_since` are eligible.
Existing drafts #28/#29/#30/#31 are refused by id unconditionally by
the evaluator. Keep `social_auto_post` OFF until accounts are connected
(§14) and the parent enables it post-deploy.

### 13. #29 / #30 dashboard procedures (parent steps after deploy)

#### 13.1 Article #30 — exact Re-check procedure (DO NOT RUN before deploy)

**Purpose.** Produce a FRESH fact-check of #30's CURRENT 4615-char body
(the last checks, fc 14/15/16, are stale: body_hash NULL, created
2026-11-20 05:40–05:50, before the body was last updated 05:52:22).
This procedure only RE-CHECKS. It does NOT correct, does NOT publish,
does NOT change the body. #30 stays a draft throughout.

**Preconditions.** Deploy done (new code live); signed in as the owner
on the dashboard (https://fs-ai-5w5.pages.dev/pages/dashboard.html).
E-Stop OFF (the Re-check endpoint returns 423 when it is ON — if you
get 423, stop: the stop must be OFF for this step, do not force it).
Do NOT click Correct first. Do NOT touch #28/#29/#31 in this run.

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
   repo's `bodyHash` util. If `body_hash` is NULL or different, the check
   ran against a different body (or a stale one) — do NOT treat it as
   fresh; report it.
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

#### 13.2 Article #29 — exact dashboard regeneration procedure (parent step after deploy)

**Purpose.** Regenerate #29's scaffold shell into a real draft from its
OWN evidence only. There is NO dashboard button for scaffold
regeneration — the procedure below uses the dashboard's own task
controls plus the browser console on the signed-in dashboard page
(owner session), going through the worker handlers, NEVER raw D1 SQL.

**Step 0 — PREREQUISITE, do this first: re-fetch the source.**
The live evidence is INSUFFICIENT: one 500-char truncated, outdated
Guardian fragment; 0 chars of current evidence. Running the
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
   needs a fact-check (Re-check, §13.1-style) before ANY approval — and
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

### 14. Social connection workflows + what still needs owner authorization

#### 14.1 Per-platform connection workflows (owner-action checklists)

Prerequisites for ALL: `SOCIAL_TOKEN_SECRET` set as a Worker secret
(§12.2 step 4) and migration 022 (+027) applied live. The owner does
each step; the agent never types a password or clicks OAuth for him.
Redirect URI for every platform (register this exact URI in each dev
console): `https://fs-ai-5w5.pages.dev/api/social/oauth/<platform>/callback`
Full checklists: WS-C notes §6 + `docs/SOCIAL-PLATFORMS-2026-11-21.md`.
Summary:

- **Pinterest:** account exists: "FS AI" @FS_AI, business account,
  website claimed. Create a developer app, Trial access, scopes
  boards/pins/user_accounts read+write, token exchange; Standard access
  needs a demo-video review. Access token 30d, refresh 60d.
- **Facebook Page:** Meta developer app, Business use case, Page-admin
  grant, token exchange chain (user 1–2h → 60d long-lived → Page token
  effectively non-expiring). Own Page in dev mode needs NO App Review.
- **Instagram:** Business/Creator account FIRST (none exists), Meta app
  + Instagram product, Instagram Login scopes
  (instagram_business_basic, instagram_business_content_publish).
  Token 60d. Media must be a public HTTPS URL (card renderer §6).
- **LinkedIn (own profile):** developer app + Share on LinkedIn + Sign
  In with OpenID Connect. Access 60d, NO refresh tokens — re-OAuth
  every 60 days.
- **YouTube:** Cloud project + enable Data API v3 + OAuth client +
  consent screen to **Production** + pass Google audit (do NOT use while
  in Testing — uploads land PRIVATE). Then the Shorts flow can be
  evaluated for API use. See §9 items 6–7; audit decision is the owner's.
- **X:** no authorization is possible free of cost —
  UNAVAILABLE_FREE_TIER. If the owner wants X, it costs money
  (pay-per-use + card). Do not connect it without a new explicit
  authorization that names the cost.

#### 14.2 Still outstanding (owner authorization or owner action)

- **Per-article authorization — #28, #29, #30, #31:** each needs a
  separate owner authorization before it can be published at all
  (manually or automatically). The auto-publish evaluator refuses them
  by id unconditionally. #31 in particular stays draft until the owner's
  decision (its editorial audit said do-not-publish as-is; the minimal
  correction + SEO remediation are done, gate is Blocked on the
  internal-links check by editorial choice).
- **Per-platform OAuth** (§14.1) — one-time per platform, owner's click.
- **YouTube API audit decision** (§9 item 7) — owner's.
- **Posting-time test (19:00–21:00 Dhaka)** — separate owner approval;
  ~10:13 Dhaka schedule unchanged.
- **Search Console indexing retry** — was due 2026-11-21 (6th attempt
  hit "Quota Exceeded"; sitemap still "Couldn't fetch" / 0 pages).
- **Saved 406 Google password** — still unverified-bad; owner action
  via Secure Vault card or signing in himself.
- **Facebook Page, WhatsApp Business, Business Email, Cloudflare
  Access lock** — stopped on the owner's 2026-11-13 order; superseded
  ONLY for the social automation framework + official integrations.
  WhatsApp Business and Business Email remain stopped.

### 15. Live verification evidence (read-only, SELECT only — after the merge, 2026-11-21)

All values below were re-verified by the coordinator against live D1
after the merge. No D1 writes were made by the coordinator at any point.

| Check | Expected | Live value | Result |
|---|---|---|---|
| Published articles | 25 | 25 (drafts 6) | ✓ unchanged |
| #26 | draft, 4895 chars, updated 2026-11-19T18:53:30.327Z | identical | ✓ unchanged |
| #27 | draft, 245 chars, updated 2026-11-19T18:53:32.930Z | identical | ✓ unchanged |
| #28 | draft, 2157 chars, updated 2026-11-19T18:53:35.126Z | identical | ✓ unchanged |
| #29 | draft, 593 chars, updated 2026-11-20T05:09:54.676Z | identical | ✓ unchanged |
| #30 | draft, 4615 chars, updated 2026-11-20T05:52:22.421Z | identical | ✓ unchanged |
| #31 | draft, 549 chars, updated 2026-11-21T01:19:10.364Z | identical | ✓ still draft |
| publishing_mode | approved_only | approved_only | ✓ |
| auto_publishing | off | off | ✓ |
| auto_correction | off | off | ✓ |
| social_auto_post | off | off | ✓ |
| auto_research / auto_generation / auto_factcheck | on | on | ✓ |
| max_articles_per_day | 1 | 1 | ✓ |
| Emergency Stop | OFF | `website_settings` `emergency_stop` = `'0'` | ✓ OFF |
| Revenue | $0.00 | SUM(revenue_records) = 0 | ✓ |
| Queue | 12 queued, same ids | done 19, failed 1, queued 12, skipped 5; queued ids 3,4,5,6,7,8,22,23,24,35,36,37 | ✓ unchanged |
| Migrations 020–028 live | not live | No 020+ tables in `sqlite_master` (42 tables, migrations 001–019 era) | ✓ not applied |
| Social tokens stored | none | No `social_accounts` / `social_posts` tables | ✓ none |
| Scheduled automation | unchanged | Worker hourly trigger + Sunday guard (per weekly verification) | ✓ unchanged |
| Existing videos | untouched | v1, v4, #02–#05, Long #01 — all Public, mtimes untouched | ✓ untouched |

### 16. Confirmations + next scheduled execution

- **Existing videos untouched:** all 7 published videos (v1
  https://youtube.com/shorts/FyuJ0wRk3zk, v4
  https://youtube.com/shorts/qkoVSWGkHpU, #02
  https://youtube.com/shorts/4o9d3kQCzwg, #03
  https://youtube.com/shorts/MzS0B6hXZJ0, #04
  https://youtube.com/shorts/7gSj3LZs2ZI, #05
  https://youtube.com/shorts/G7jkYB9YWkM, Long #01
  https://youtu.be/hDpXk726Y54) are unchanged; the new Short #06 render
  is a local file only, never uploaded. Never delete v1 (37 views at
  2026-11-15).
- **No unauthorized publication:** nothing was published — no article,
  no social post, no video. #26/#27/#28/#29/#30/#31 all remain drafts.
  No test posts were sent to real platforms; no test articles published.
- **No live writes by the coordinator:** all live verification was
  SELECT-only. Live settings, articles, tasks, and revenue are exactly
  as found.
- **Cost: $0.00.** No paid service, API, model, credit, subscription,
  trial, or card.
- **Next scheduled execution: weekly run 2026-11-22 06:00 Dhaka
  (Sunday, 00:00 UTC) — fires on the NEW code** (deploy tonight). Do NOT
  trigger it manually, do NOT disturb it, do NOT change the schedule.
  A manual run writes the weekly row and the scheduled run would no-op
  as a duplicate. Expected first drain after deploy: tasks
  3,4,5,6,7,8,22,23,24,35 (cap 10); #36/#37 wait for the next day.
  The daily Short cron (~10:13 Dhaka) continues: next article 6,
  last_uploaded 5.
- **Sections for the parent to fill in after deploy + live verification:**
  deploy record (commit pushed, deploy time, migrations applied,
  `SOCIAL_TOKEN_SECRET` set Y/N); live verification after deploy (§12.3
  results); weekly run 2026-11-22 06:00 verification after it fires;
  first live drain / auto-publish decision / social post (when
  authorized) with real evidence.

### Appendix — files changed (local tree only)

#### A.1 Foundation (previous implementation, 2026-11-21 12:36)

See the foundation report's appendix. Migrations 020–023, queue engine,
fact-check/pipeline fixes, autonomous publishing gates, social adapters,
dashboard Control Center.

#### A.2 This completion round — source (FS AI app)

- `backend/publishing/seo.js` (Related-reading relevance), `backend/publishing/divisions.js`
  (GENERIC_KEYWORDS), `backend/agents/autonomy/factcheck.js` (truncation guard,
  null-article guard), `backend/agents/autonomy/content.js` (duplicate + truncation
  guards), `backend/agents/autonomy/publishing.js` (auto-publish evaluator,
  daily-limit reservation), `backend/routes/scheduler.js` + `backend/services/healthcheck.js`
  (WS-B F1–F5), `backend/social/card.js` + `scripts/render-social-card.py` (card renderer),
  `backend/social/oauth.js` + `refresh.js` + `media.js` + `backend/routes/social.js`
  (social framework), `backend/routes/admin-articles.js` + `frontend/scripts/dashboard.js`
  (H1/L4/Delete), `backend/worker.js` (security headers, OAuth-callback exemption),
  `backend/llm/registry.js` (Workers AI only), `backend/agents/autonomy/social.js` (S1),
  `backend/routes/orchestrator.js` (O3 comment), `tests/fake-d1.js` (article_sources delete),
  `package.json` (`db:migrate` through 028).
- Migrations: `database/migrations/024_article_fingerprints.sql`,
  `025_article_deletion_audit.sql`, `026_daily_publication_reservations.sql`,
  `027_social_token_refresh.sql`, `028_youtube_analytics.sql`.
- Tests: 160 net new (WS-A +46, WS-B +39, WS-C +38, WS-E +37) across
  `tests/` (new files: SEO relevance, cross-draft duplicates, concurrent
  publishing, daily limits, truncation, #29 regeneration, fact-check body
  hash, queue recovery, Dashboard Delete, social failures, token expiry,
  security boundaries, Emergency Stop, authorization checks).

#### A.3 This completion round — YouTube workspace

`~/workspace/goals/fs-ai-autonomous-business-platform/files/fs-ai-youtube-videos/`
— `work/topic_suitability.py`, `work/script_engine.py`,
`work/render_engine.py`, `work/seo_engine.py`, `work/qa_checks.py`,
`work/youtube_common.py`, `work/analytics_store.py`, `work/reliability.py`,
`work/growth.py`, `work/longform.py`, `work/subtitles.py` (NEW),
`work/content_calendar.py` (NEW), `work/record_upload.py` (NEW),
`work/qa_rerun_short06.py` (NEW), `work/YOUTUBE-GAP-REPORT-2026-11-21.md`,
`work/YOUTUBE-OAUTH-AUDIT-2026-11-21.md` (NEW),
`work/BROWSER-UPLOAD-PROCEDURE-2026-11-21.md` (NEW),
`work/PIPELINE-README.md` (§0B + §0C),
`work/topic_ranking_2026-11-21.json`, `work/youtube_analytics.db`,
`work/content_calendar.json` + `.md`, `work/qa_short06.json`,
`work/tests/test_youtube_engine.py` (71/71),
`FS-AI-Short-06-Fuel-Economy-15-Ways-to-Save-Fuel.mp4` + `.txt` + `.srt`.

#### A.4 Reports and notes

- This report: `docs/FS-AI-FINAL-AUTONOMOUS-COMPLETION-REPORT-2026-11-21.md`
- Workstream notes: `docs/FS-AI-COMPLETION-WS-A/B/C/D/E-NOTES-2026-11-21.md`
- Foundation: `docs/FS-AI-FULL-AUTONOMOUS-IMPLEMENTATION-2026-11-21.md` (+ PART-1, PART-2)
- Weekly verification: `docs/FS-AI-WEEKLY-RUN-VERIFICATION-2026-11-22.md`
- #31 report: `docs/ARTICLE-31-SEO-REMEDIATION-REPORT-2026-11-21.md`
- YouTube performance: `~/workspace/goals/fs-ai-autonomous-business-platform/files/FS-AI-YOUTUBE-PERFORMANCE-REPORT-2026-11-21.md`

---

## Part 2 — YouTube Channel Performance Investigation (21 November 2026)

## FS AI — YouTube Channel Performance Investigation

**Channel:** https://youtube.com/@fsai-e5f (ID `UCnuMFV5vL3c6jyJGGei2b9Q`, owner account mdalfahad406@gmail.com)
**Investigation date:** 2026-11-21 (12:07–12:30 Asia/Dhaka)
**Method:** public page fetches (channel page, individual Short pages, fs-ai articles API), local video files + build scripts + frame inspection, Studio figures already verified by the parent via the live browser on 2026-11-21 11:43. No video was deleted, modified, re-uploaded, or bought views for. No analytics number in this report is invented — anything not retrievable is marked **unknown / not retrievable**.

### 1. Channel snapshot — verified numbers only

| Metric | Value | Source / date |
|---|---|---|
| Subscribers | **2** (+1 in last 28 days) | YouTube Studio dashboard, live browser check 2026-11-21 11:43 |
| Views, last 28 days | **223** | Studio dashboard, same check |
| Watch hours, last 28 days | **5.7 hours** (342 min) | Studio dashboard, same check |
| Videos on channel | **7 public** (6 Shorts + 1 long-form) | Upload records + Studio Content list seen 2026-11-21 11:45 |
| Monetization | **Not eligible** (0/1,000 subs, 0/4,000 hrs, 0/10M Shorts views) | Earn-page check 2026-11-19 |
| Community posts | Not available (needs 500 subs) | YouTube rule, channel at 2 subs |

**Arithmetic on the two Studio totals (labelled inference, not a measured metric):** 342 watch-minutes ÷ 223 views ≈ **92 seconds average view duration across the whole channel**. A channel of mostly ~55-second Shorts cannot average 92 seconds per view from Shorts alone — this strongly suggests the single 4:45 long-form video carries a large share of total watch time. That matters for strategy (see §7): the long-form path is the realistic route to the 4,000 watch-hour threshold; the Shorts path needs 10M Shorts views.

**What public retrieval could NOT produce:** the channel page, each Short page, and the articles API were fetched as text on 2026-11-21 ~06:08–06:10 UTC. YouTube's text crawl returns only the video description and page meta — **no view counts, no publish dates, no subscriber counts, no like/comment counts, no video list**. A web search for the channel's statistics (including vidIQ) returned no page for @FSAI-e5f — the channel is too small to be tracked by third-party stats sites. Conclusion: **per-video public view counts are not retrievable by any public means available to this investigation.** The only per-video view figures that exist are the ones recorded at earlier checks (below), plus whatever YouTube Studio Analytics shows — see §8, the marked placeholder section the parent will fill from Studio.

### 2. Video-by-video findings

All 7 videos verified Public with copyright check passed where recorded. All 6 Shorts are 1080×1920 vertical, under 60 s — **all meet the Shorts eligibility criteria on paper** (shelf placement itself is unknown pending Studio data).

#### Short v1 — "EV Charging at Home: A Complete Beginner's Guide | FS AI"
- **URL:** https://youtube.com/shorts/FyuJ0wRk3zk
- **Published:** ~14 Nov 2026 (first video; local build files dated 14 Nov 07:00)
- **Duration:** 55.35 s. **Views: 37 (check 2026-11-15)** — the best performer on the channel.
- **Design:** dark navy + electric blue + amber, huge bold sans headlines, kinetic word-highlight typography. First frame is a brand card ("FS AI" largest, tagline, title, teal "Full guide — link in description" pill). High contrast, fills the frame, readable at thumbnail size.
- **Opening spoken line:** "Plug in when you arrive, and wake up to a car ready for the day." Pleasant, no stakes, no question.
- **Assessment:** the most feed-native visual language on the channel (big type, bold colour blocks, moving highlights). But the first frame sells the brand, not the content — no hook, no curiosity gap. Its view lead is most plausibly explained by distribution, not retention (see §3).

#### Short v4 — same title, Paper Editorial redesign
- **URL:** https://youtube.com/shorts/qkoVSWGkHpU
- **Published:** 2026-11-15 (separate new video alongside v1, owner order)
- **Duration:** 51.12 s. **Views: unknown / not retrievable.**
- **Design:** "Paper Editorial / Field Guide" — light warm paper (#FAF5EC), Noto Serif Black headlines, flat ink line-art plates, paper-wipe transitions. Same narration audio as v3 (107/107 words Whisper-verified). No hook line on the cover; cover is paper/ink, title + masthead + one illustration.
- **Opening spoken line:** same as v1 ("Plug in when you arrive…").
- **Assessment:** beautiful as a still image; the weakest cover of the set for the feed (no hook line, low contrast, lots of empty paper).

#### Short #02 — "Car Maintenance Checklist: 12 Things to Check Every Month | FS AI"
- **URL:** https://youtube.com/shorts/4o9d3kQCzwg
- **Published:** 2026-11-19. **Duration:** 53.23 s. **Views: 18 (check 2026-11-19)**.
- **Design:** Paper Editorial, 6 scenes × 2 checks, numbered 1–12 on screen. **No cover frame** — the cover rule was added after this build, so YouTube auto-picked a mid-scene plate as the thumbnail.
- **Opening spoken line:** "Check the engine oil on the dipstick, between the marks." Instructional, flat, no stakes.
- **Assessment:** a 12-item checklist crammed into 53 seconds — the densest, most "list-reading" video on the channel. No cover = weakest first impression of the set.

#### Short #03 — "Hybrid vs Petrol: Which Saves You More in 2026? | FS AI"
- **URL:** https://youtube.com/shorts/MzS0B6hXZJ0
- **Published:** 2026-11-19 11:24. **Duration:** 58.33 s. **Views: unknown / not retrievable.**
- **Design:** Paper Editorial. First designed cover: teal #0E6B5C, two-car "VS" illustration, title below, hook "Town or motorway? The answer flips." The clearest cover of the set.
- **Opening spoken line:** "A hybrid pairs a petrol engine with an electric motor and battery." A definition — the flattest possible opening for a comparison video.
- **Assessment:** best title on the channel (a question + a year + a money promise) and best cover — but the spoken opening wastes the first 3 seconds defining a word instead of posing the money question. 58.33 s is long for the payoff ("a hybrid wins in town, petrol wins on motorways" arrives only in S6).

#### Short #04 — "Motorcycle Buying Guide: How to Choose Your First Bike | FS AI"
- **URL:** https://youtube.com/shorts/7gSj3LZs2ZI
- **Published:** 2026-11-20 12:07. **Duration:** 52.03 s. **Views: unknown / not retrievable.**
- **Design:** Paper Editorial. Cover: burnt-orange #C2410C, title at top, motorcycle side profile + helmet, hook "Small first. Fast later." + sub-hook "Your first bike should fit you — not scare you."
- **Opening spoken line:** "Check what your licence allows first." Bureaucratic admin as the first words — the weakest opening line on the channel.
- **Assessment:** the cover's motorcycle line-art is the crudest illustration in the set (stick-like frame geometry, odd proportions; reads as abstract lines at thumbnail size). Good hook line, wasted by a first spoken line about paperwork.

#### Short #05 — "How to Read Your Car's Warning Lights | FS AI"
- **URL:** https://youtube.com/shorts/G7jkYB9YWkM
- **Published:** 2026-11-21 11:45. **Duration:** 59.30 s. **Views: 0, 0 comments at publication verification (2026-11-21 11:45).**
- **Design:** Paper Editorial. Cover: crimson #B91C1C, dashboard cluster (speedometer + oil/battery/thermometer lights), title in the middle, hook "Which light means stop now?" + sub-hook "Red, amber, green — know the colour code." The strongest cover + hook pairing on the channel. Defect: the decorative corner circle overlaps and clips the "ARTICLE 5" text at top right; ~35% of the cover's lower half is empty paper.
- **Opening spoken line:** "Red means stop soon. Amber means check soon. Green or blue means a system is on." The best opening on the channel — immediate, stakes, pattern.
- **Assessment:** the best-built Short on the channel by hook, cover, and opening — and it still opened at 0 views, because a good video with no audience and no distribution still starts at zero. Also the longest Short (59.30 s, only 0.7 s under the Shorts limit) with the most dead air (see §5).

#### Long #01 — "EV Charging at Home: A Complete Beginner's Guide | FS AI"
- **URL:** https://youtu.be/hDpXk726Y54
- **Published:** 2026-11-19, Public, custom thumbnail live (leaf-green, "Plug in tonight. Drive tomorrow."). **Duration:** 4:45 (285.30 s), 1920×1080. **Views: unknown / not retrievable.**
- **Design:** Paper Editorial two-column (illustration left, kicker + headline + full narration caption right), 8 scenes, chapters in the description.
- **Assessment:** the channel's watch-time engine (see §1 arithmetic). Same static-plate retention problem as the Shorts, stretched over 4:45 — but long-form viewers arrive by search, not by swipe, so the retention demand is different. Its custom thumbnail is a genuine asset (long-form allows uploaded thumbnails; Shorts do not).

### 3. Better vs poorly performing — v1 (37 views) vs the rest

What actually differs about v1:

1. **Time and solitude.** v1 was the channel's only video for ~5 days (14–19 Nov). Every scrap of channel traffic went to it. #02–#05 each arrived into a 7-video channel and had 0–2 days to accumulate before being counted.
2. **A distribution link the others do not have.** The FS AI homepage links to v1 — Google found the homepage via the v1 link. No equivalent site→video link is verified for #02–#05, and the article pages (fetched 2026-11-21) show no YouTube link in their static shell. v1 got external traffic; the rest got none.
3. **A more feed-native visual language.** Dark navy, huge bold sans type, cyan/amber blocks, kinetic word-highlighting — high contrast and moving where the paper design is low-contrast and still. At thumbnail size v1's frames read instantly; the paper covers read as "elegant document".
4. **Topic.** EV home charging is a high-interest, high-search topic with a clear audience (new EV owners). "Check what your licence allows first" (#04) is not a topic anyone searches.

What v1's lead does NOT prove: it does not prove the dark design "works" (37 views in a week is still tiny), and it does not prove better retention — there is no retention data for any video yet. Per-day rate check: v1 reached 30+ views within ~1–2 days of publishing; #02 reached 18 views in ~2 days. On a per-day basis #02 is not far behind v1 — the gap is mostly age and the homepage link, not a quality gap. **Do not read v1's lead as a reason to revert the design.** The honest read: distribution (time + link) explains most of it; the design difference is a secondary, plausible contributor.

### 4. Workflow assessment — is the automated pipeline producing suitable YouTube content?

The pipeline (one Short per article in article-id order, ~10:13 Dhaka build, ~11:30–12:07 Dhaka upload, coded motion graphics, licensed TTS, no music, no intro) produces **accurate, original, well-crafted videos that are badly packaged for the Shorts feed**. What it gets right and wrong:

**Right:** facts are 100% from the article (no invented numbers), Whisper-verified narration, consistent series design, distinct covers from #03 on, copyright-clean, correct formats, on-time daily cadence.

**Wrong for YouTube:**
- **Topic selection is driven by article-id order, not by demand.** Articles 1–10 are all Automotive; articles 6–10 (Fuel Economy, ADAS, EV Range, Engine Noises, New vs Used Cars) will keep the channel 100% automotive "guide/checklist" for 5 more days. No search-demand or Shorts-suitability check exists anywhere in the pipeline. The channel is multi-niche (8 divisions) but YouTube sees one flavour, repeated daily.
- **Every video has the identical skeleton:** 6 scenes, ~50 s, same voice, same paper, same pacing, same masthead/footer, same end card. The Shorts shelf tests videos against fresh audiences who have never seen the channel — repetition is fine for a niche channel, but identical *structure* with no payoff variation trains no curiosity.
- **No growth mechanics in the product:** no subscribe ask anywhere (the end card says "Read the full guide" — it sends viewers *off* YouTube), no series/playlist structure, no pinned comment, no community posts possible yet, no video link from article pages, Pins link to articles rather than videos. The videos are built as article trailers, not as YouTube content.
- **No feedback loop:** nothing in the pipeline records a video's performance, so each build repeats the previous build's choices blind. #05 repeated #03/#04's 6-scene, ~55–59 s shape even though no retention data exists for any of them.

### 5. Root causes — ranked

**PROVEN (evidence in hand):**

1. **Cold start — no audience, no funnel, 7 videos, ~1 week old.** 2 subscribers; +1 in 28 days; the only verified external traffic source is the homepage→v1 link. With no seed audience, every video starts at zero and depends entirely on YouTube's cold test audience. This alone explains near-zero views. (Evidence: Studio subscriber/view totals, upload history, homepage link.)
2. **Retention design — the videos are frozen slides.** Measured from `build_video_short05.py`: all motion in a scene (masthead fade, headline rise, plate slide, art build) finishes by ~1.45 s; scenes run 6.07–8.83 s, so **~75% of every scene is completely static** (only the thin progress tick moves). Dead air in #05: intro 0.3 + pads 3.0 + gaps 2.0 + 5.0 s silent end card = **10.3 s of 59.3 s (17.4%) with no narration at all**. No music, no face, no sound design, flat TTS at speed 90. In the Shorts feed, the swipe decision is made in 1–2 seconds; a static slide with a flat voice is the easiest possible swipe. (Evidence: build-script constants + frame inspection. The resulting viewed-vs-swiped metric itself is still unknown — Studio data pending — but the mechanism is measured, not guessed.)
3. **Weak opening lines.** S1 first lines: #02 "Check the engine oil on the dipstick…" (instruction), #03 "A hybrid pairs a petrol engine…" (definition), #04 "Check what your licence allows first." (admin). Only #05 opens with stakes. The first 3 seconds are the whole game in Shorts, and three of five Shorts spend them on the dullest sentence in the script. (Evidence: scripts.)
4. **Covers are clean but weak as feed thumbnails.** #03/#04/#05 covers leave ~35–40% of the frame as empty paper; the hook line is on screen for only 0.3 s before the wipe; the decorative corner circle clips the "ARTICLE N" text on #03/#04/#05; #02 has no cover at all (auto-picked mid-scene frame). (Evidence: frame inspection.)
5. **Topic + format monotony.** 7/7 videos automotive, 7/7 "guide/checklist", 6/6 Shorts the same 6-scene skeleton. Articles 6–10 are also all automotive (verified from the live articles API). (Evidence: API + files.)
6. **Titles/descriptions are not built for discovery.** Every title is the article title + " | FS AI" (8 dead characters — the channel name already shows beside it). Descriptions restate the title instead of opening with a searchable hook sentence. `#FSAI` is a hashtag nobody searches. (Evidence: .txt metadata files.)
7. **No growth mechanics.** No subscribe ask; end card drives viewers off YouTube; no playlist/series structure; no video links from article pages verified; Pins point at articles, not videos. (Evidence: video files + descriptions; article-page video link unverified — see §8.)
8. **Duration bloat.** 51–59 s for checklist content; #05 at 59.30 s sits 0.7 s under the Shorts limit; the 5 s silent end card alone is 8.4% of #05. (Evidence: files.)

**PLAUSIBLE BUT UNPROVEN (do not treat as fact):**

9. **Posting time.** Uploads land ~11:30–12:07 Dhaka (≈05:30–06:00 UTC — deep night in the US, midday in India). A 19:00–21:00 Dhaka test slot (13:00–15:00 UTC) would catch US morning + UK afternoon + India evening. Shorts have multi-day shelf life, so timing is a minor factor at most — worth one test week, not a fix to assume.
10. **Owner sharing.** v1's fast start may include the owner sharing it in his own circles. Unverifiable from available data; listed only because it would further explain v1's lead.

**NOT a root cause (evidence against):**
- Upload/visibility problems: every published video is Public, copyright passed, correct format — no restriction found.
- Shorts eligibility: all Shorts meet the vertical + under-60 s criteria.
- Content quality/accuracy: facts are accurate, narration Whisper-verified, 100% original — quality is not the problem; packaging and distribution are.
- Suppression/shadowban: **no evidence of any penalty.** A 2-subscriber channel with 7 videos getting ~0 views is the normal cold-start outcome, not a punishment. (Studio "restrictions" status per video is still unknown pending the parent's check — see §8.)

### 6. Improvement strategy

The strategy is: **keep the Paper Editorial identity and the owner's standing rules (original, coded graphics, no music, no people, no intro), but rebuild the packaging around feed behaviour** — motion, pace, hooks, and discovery — and add the feedback loop the pipeline lacks.

1. **Shorter, denser videos.** 30–45 s target, hard max 50 s. Cut the 5 s silent end card to 2 s with a spoken CTA. Dead air ≤8% of runtime.
2. **Motion in every second.** At least one element must keep moving through the whole scene: staggered check-row reveals, a moving gauge/needle, a filling bar, kinetic captions that appear word-by-word with the narration. Never a fully frozen plate after 1.5 s. (Keep the paper look — add motion to it, don't abandon it for the dark look.)
3. **Stakes in the first 3 seconds.** S1's first line must be a warning, a question, a number, or a "stop doing X" line — never a definition, never admin. The cover hook and the S1 first line must make the same promise.
4. **Covers that work at 1/6 size.** Fill ≥70% of frame height, hook line readable small, no ornament overlapping any text.
5. **Titles for search, not for the article index.** Front-load the hook, drop " | FS AI", ≤55 characters, prefer a question or a number.
6. **Descriptions that open with the hook.** First line = what the viewer gets, in their words. 3–4 searchable hashtags only; drop #FSAI.
7. **Topic selection with a suitability score.** Score each candidate article before building: (a) does it answer a question people search? (b) can it be shown, not just told? (c) is there a stakes/payoff moment in the first 3 seconds? Skip low scorers for Shorts (long-form or pin-only), record the skip + reason. Mix divisions — no more than 2 same-division Shorts in a row once non-automotive articles are reached. Immediate note: #09 "How to Diagnose Common Engine Noises" (knocks, squeals, rattles — sound-based, curiosity-driven) is the strongest hook in the queue; #06 "Fuel Economy: 15 Proven Ways to Save Fuel" (money-saving question) is next.
8. **A subscribe ask.** The end card must ask for the subscribe (and the description must keep the guide link). A channel that never asks for subscribers gets none — 2 subs with +1 in 28 days is the receipt.
9. **A feedback loop.** Record every video's 24 h and 7 d Studio numbers before the next build starts; compare each new build against the previous one. No blind repetition.
10. **Test the posting slot.** One week at 19:00–21:00 Dhaka, then compare 24 h views against the ~11:30 slot. (Needs owner approval — the cron schedule is not changed by this investigation.)
11. **Use the long-form engine.** The 4:45 video is very likely the watch-time engine (see §1). Keep one long video per week — it is the realistic path to 4,000 watch hours; Shorts alone need 10M views.

**What this strategy deliberately does NOT do:** no bought views/subs, no bots, no re-uploads, no deleting or touching published videos, no music (owner's rule — noted as a cost: music/sound design is one of the strongest Shorts retention levers and it stays ruled out; motion + pace + hooks are the remaining levers), no guaranteed views. Honest expectation: these changes improve the *chance* each video earns shelf expansion; they cannot manufacture an audience for a 2-subscriber channel. Realistic growth is weeks of consistent, better-packaged uploads plus the site→video funnel — not a single fix.

### 7. Implemented improvements (pipeline changes, 2026-11-21)

Edited `work/PIPELINE-README.md` (the pipeline recipe — the source of truth for every future build):

- **New binding section "0A. PERFORMANCE RULES (2026-11-21 channel audit)"** — P1 duration/dead-air limits (30–45 s target, ENDCARD 5.0→2.0 s, PAD 0.5→0.3, GAP 0.4→0.3, dead air ≤8%); P2 scene pace (7–8 scenes, 3.5–5.5 s each, visual change at least every ~4 s, no scene fully static >~3 s); P3 motion-in-every-scene rule (staggered reveals / moving gauge / kinetic captions, never a frozen plate after 1.5 s); P4 first-3-seconds hook rule (stakes/question/number, never definition or admin; cover hook = S1 promise); P5 cover rules (fill ≥70% of frame height, no ornament overlapping text — fixes the corner-circle clip on #03/#04/#05); P6 title rules (front-load hook, drop " | FS AI", ≤55 chars); P7 description rules (hook first line, 3–4 searchable hashtags, drop #FSAI); P8 topic suitability scoring + skip-and-record rule + division-mixing rule; P9 posting-time test proposal (evening Dhaka, owner approval required — cron untouched); P10 mandatory metrics logging (24 h + 7 d Studio numbers before the next build); P11 end-card rule (2 s spoken CTA + subscribe ask, no silent tail); P12 muted-viewer rule (kinetic or phrase-by-phrase captions, never a whole paragraph fading in at once).
- **Corrected stale upload statuses** in the Short records: #03 uploaded 2026-11-19 11:24, #04 uploaded 2026-11-20 12:07, #05 uploaded 2026-11-21 11:45, Long #01 published 2026-11-19 (the README still said "NOT YET UPLOADED" for all four).
- **Added a METRICS LOG table** to the README with the verified numbers so far (v1 37 views at 2026-11-15; #02 18 views at 2026-11-19; #05 0 views at publication 2026-11-21 11:45; channel 28-day 223 views / 5.7 watch hours / 2 subs at 2026-11-21 11:43) and empty rows for #03, #04, v4, Long #01 and all future Shorts — so the next build starts from real data, not from memory.
- **Added a Short #06 pre-build note:** article 6 "Fuel Economy: 15 Proven Ways to Save Fuel" — scores strong on search demand and money stakes; suggested hook direction and the P1–P12 checklist it must pass.

Not changed (out of scope for this investigation): no published video touched; no upload made; no cron schedule changed; no FS AI backend/social code touched (separate coordinator owns that); no re-render of any existing video.

### 8. STUDIO ANALYTICS — FILLED FROM LIVE YOUTUBE STUDIO (2026-11-21 12:07–12:15 Dhaka)

Source: read-only Studio inspection, signed in as mdalfahad406@gmail.com. All figures copied exactly as Studio showed them. Live views moved slightly during the inspection (e.g. Car Maintenance 47→46, Warning Lights 6→7); per-video values are as seen on each video's own analytics page, with the separate Advanced-mode 28-day figure where it differs. Channel and per-video 28-day figures in Studio end 19 Nov 2026, so videos published 20–21 Nov have little or no 28-day data.

**Channel (28 days, 23 Oct–19 Nov):** 223 views, 5.7 watch hours, +1 subscriber (2 total). **Last 48 hours: 112 views, 3.0 hours, +1 subscriber** — half the 28-day views in two days. Thumbnail impressions 1,077, CTR 1.8%. Content — All: engaged views 32, likes 5, viewed vs swiped 19% stayed / 81% swiped away. Traffic — All: Shorts feed 58.3%, search 17.9%, channel pages 10.3%, suggested 7.2%. Traffic — Shorts only: feed 63.7%, search 19.6%, channel pages 10.3%, external 3.9%. Audience: monthly audience 19; "When your viewers are on YouTube": not enough data. Devices: computer 85.3%, TV 7.0%, mobile 6.2%, tablet 1.4%.

| Video | Views | Shown in feed | Viewed vs swiped away | Avg view duration | Avg % viewed | Traffic sources | Subs gained | Impressions / CTR | Restrictions |
|---|---|---|---|---|---|---|---|---|---|
| v1 FyuJ0wRk3zk (0:56, 14 Nov) | 52 | not shown (absolute) | 15.9% stayed / 84.1% swiped | 0:32 | not shown | Feed 69.2%, Search 23.1%, Channel 7.7% | 0 | 127 / 1.6% | None |
| v4 qkoVSWGkHpU (0:52, 15 Nov) | 41 (40 Adv 28d) | not shown | 16.7% / 83.3% | 15:07 as shown (exceeds 0:52) | not shown | Search 45.0%, Feed 42.5%, Channel 10.0% | 0 | 142 / 1.4% | None |
| #02 4o9d3kQCzwg (0:54, 19 Nov) | 46 (42 Adv 28d) | not shown | 20.9% / 79.1% | 0:32 | not shown | Feed 73.9%, Search 15.2%, Channel 10.9% | 0 | 55 / 5.5% | None |
| #03 MzS0B6hXZJ0 (0:59, 19 Nov) | 44 (43 Adv 28d) | not shown | 26.5% / 73.5% | 14:05 as shown (exceeds 0:59) | not shown | Feed 61.4%, Channel 15.9%, Search 9.1%, External 9.1% | +1 (only sub gain) | 65 / 3.1% | None |
| #04 7gSj3LZs2ZI (0:53, 20 Nov) | 44 (25 Adv 28d) | not shown | 16.7% / 83.3% | 12:02 as shown (exceeds 0:53) | not shown | Feed 79.5%, External 9.1%, Channel 6.8%, Search 4.5% | 0 | 5 / 20.0% | None |
| #05 G7jkYB9YWkM (1:00, 21 Nov) | 7 (first hour) | not shown | **57.1% / 42.9% — best stay rate** | 0:20 | not shown | Feed 71.4%, Channel 14.3%, External 14.3% | 0 | — (28d window ends 19 Nov) | None |
| Long #01 hDpXk726Y54 (4:46, 19 Nov) | 21 | — | — | 2:21 | 49% | Suggested 76.2%, Direct 9.5%, Channel 9.5%, Browse 4.8% | 0 | 683 / 1.3% | None |

**Answers to the four §8 questions:** (1) Distribution vs retention: the feed IS showing the Shorts (feed = 58–80% of traffic per video; #05 got 5 of its first 7 views from the feed within an hour) — this is primarily a **retention problem, not a distribution blackout**. Stay rates of 16–27% on the older Shorts vs 57.1% on #05 prove the hook is the differentiator. (2) Long-video watch time: **no — the §1 arithmetic inference is corrected.** The long video is only 0.8h of 5.7h. The bulk sits in v4 (1.3h), #03 (2.1h) and #04 (1.4h) — but their Studio-shown average view durations (15:07 / 14:05 / 12:02) exceed the video lengths and do not reconcile with the shown watch hours. Reported exactly as shown; no cause inferred; do not use those three durations for decisions. (3) Best average % viewed: only the long video shows one (49%). No Short shows avg % viewed — unanswerable from Studio. By stay rate, #05 (57.1%) is best by far. (4) Restrictions: **none on any of the 7 videos** — no claims, no limited-distribution notices.

### 9. Remaining limitations

- **Stay-rate data now exists (§8, filled 2026-11-21 12:15):** #05 57.1% stayed vs 16–27% for the older Shorts — the first metric-level retention evidence on the channel, and it validates the stakes-first hook diagnosis. Full retention curves are still not shown for any Short, and the three impossible avg view durations (v4/#03/#04) must not be used for decisions.
- **The owner's standing rules cap the available levers.** No music, no people/face, no third-party footage, coded graphics only, TTS voice only. Within those rules, motion + pace + hooks + titles are the levers — the single biggest Shorts lever (sound design/music) stays unavailable by his choice.
- **Cold start cannot be fixed by packaging alone.** Even a perfect Short starts at zero on a 2-subscriber channel. The site→video funnel (article pages linking to the matching Short) and the Pinterest→video path are unbuilt; both need the parent/coordinator, not this pipeline.
- **Topic supply is fixed by the article pipeline.** Articles 6–10 are all automotive; division mixing only becomes possible from article 11 onward. The suitability-skip rule can reorder within automotive, not conjure other divisions.
- **Posting-time and subscribe-CTA changes need owner approval** (cron change; on-screen wording). Proposed, not applied.
- **Public view counts will remain unretrievable** — future performance tracking depends entirely on Studio Analytics checks after each upload.
- **No view count is guaranteed.** The improvements raise the probability of shelf expansion; they do not promise any number.

### 10. Evidence list

- Local files: `~/workspace/goals/fs-ai-autonomous-business-platform/files/fs-ai-youtube-videos/` — all 7 `.txt` metadata files, `work/PIPELINE-README.md`, `work/script_short02/03/04/05.txt`, `work/build_video_short05.py` (timeline constants DUR/PAD/GAP/INTRO/ENDCARD, `render_scene` motion windows), frames inspected visually: `frames/f0000.png` + `frames/f0600.png` (v1), `frames_short03/f0000.png`, `frames_short04/f0000.png`, `frames_short05/f0000.png` + `frames_short05/f0900.png` (S4 settled frame).
- Public fetches 2026-11-21 ~06:08–06:10 UTC: `youtube.com/@fsai-e5f/videos` (meta only, no video list/counts), `youtube.com/shorts/FyuJ0wRk3zk` (description only), `youtube.com/shorts/G7jkYB9YWkM` (description only), `fs-ai-5w5.pages.dev/pages/article.html?id=5` (JS shell only, no YouTube link visible), `fs-ai.mdalfahad841.workers.dev/api/articles` (articles 6–10 titles/divisions verified: all Automotive).
- Web searches 2026-11-21: "FS AI @FSAI-e5f YouTube channel shorts views" and "vidiq @FSAI-e5f channel stats" — no @FSAI-e5f page found on any third-party stats site.
- Parent-verified Studio figures used (live browser, 2026-11-21 11:43–11:45): 2 subscribers (+1/28d), 223 views + 5.7 watch hours / 28 days, #05 Public 1:00, 0 views / 0 comments at publication, copyright check passed.
- Earlier recorded figures: v1 37 views (2026-11-15 check), #02 18 views (2026-11-19 check).

---

## Part 3 — Deployment Verification Addendum (22 November 2026)

## FS AI — Deployment Verification Addendum — 22 November 2026

Addendum to `docs/FS-AI-FINAL-AUTONOMOUS-COMPLETION-REPORT-2026-11-21.md`.
Covers the deploy itself (21 Nov 15:21) and everything verified live after it,
up to 22 Nov 10:55 Dhaka. Every claim below was checked against live D1,
the live site, or the live dashboard — nothing estimated.

### 1. Deploy — DONE 21 Nov 15:21

- **Commit:** `295764c` ("FS AI: final autonomous completion — queue engine,
  auto-publish, social framework, YouTube growth system, migrations 020–028"),
  exactly 1 parent (`e5f7aa3`), 104 files changed (+22,785 −285).
- **Push:** one-time GitHub workflow, run #28, succeeded in 18s. The workflow
  file and the source zip were both removed from the repo afterwards
  (404 verified). GitHub session left signed in as mdalfahad841-code.
- **Pre-deploy backup:** `d1-backup-2026-11-21-pre-deploy.json` (1,399,160 bytes,
  41 tables) taken before any migration.
- **Migrations 020–028 applied live, in order, all statements success.**
  All 11 new tables exist (system_health_checks, publication_logs,
  social_accounts, social_posts, social_analytics, article_fingerprints,
  article_deletion_audit, daily_publication_reservations, youtube_videos,
  youtube_performance, youtube_anomalies).
- **At deploy:** published 25, drafts 6, queued 12 — unchanged. #26–#31
  byte-identical to baselines. autonomy_settings unchanged. Emergency Stop OFF.
  Revenue $0.00.

### 2. Live verification — frontend + worker

- Served `dashboard.html` and `autonomy.js` are **hash-identical** to the
  deployed tree (matching SHA-256).
- New worker routes live: a fake route returns 404 `{"error":"Not found"}`,
  while `/api/health/latest`, `/api/analytics/detail`, `/api/social/status`
  return 401 `{"error":"Owner session required"}` — the routes exist and are
  auth-gated, as designed.
- Dashboard renders with the owner session: "Command Center — FS AI",
  Control Center + Autonomous Operations visible, signed in as Owner
  (mdalfahad841@gmail.com), session to 2026-11-29. Counts shown: 25 published,
  7 drafts, 32 articles total.
- `article_revisions` live schema declares
  `article_id REFERENCES articles(id) ON DELETE CASCADE`.

### 3. Auto-publish — ENABLED 22 Nov 04:55:28Z

- The dashboard UI **cannot** enable it: its Publishing rules section offers
  only "Approved only" (no "auto" option) and has no field for
  `auto_publish_eligible_since`. So it was enabled directly in the settings
  store (the same store the worker reads; the worker's own validator accepts
  exactly these values), verified by read-back:
  - `publishing_mode` = `auto`
  - `auto_publishing` = `on`
  - `auto_publish_eligible_since` = `2026-11-22T04:55:28Z`
  - `social_auto_post` = `off` (unchanged), Emergency Stop OFF.
- Only articles created **after** 2026-11-22T04:55:28Z can auto-publish.
  #28–#31 and #33 predate the cutoff and are legacy — they never auto-publish
  without separate per-article owner authorization. 1/day limit preserved.

### 4. Article #30 — fresh fact-check DONE and verified

- Ran 22 Nov via the dashboard Re-check button (task #31 reused, run #167).
- New row in `fact_checks`: **id 29, kind `recheck`, verdict `needs-review`,
  5/20 claims verified, 15 failed**, `body_hash` present.
- The stored hash was verified against the worker's own `bodyHash()` function
  run on the current body — **exact match**
  (`ac723e55…dae965`). The fact-check is genuinely fresh; the dashboard's
  stale warning for #30 is gone.
- History preserved (fc 15/16 kept). #30 stays a draft, gate Blocked, body
  unchanged by the re-check.
- Note: #30's body grew +8 chars during the 22 Nov weekly run (4615 → 4623,
  updated 00:02:50 UTC) and #29's the same (593 → 601, 00:02:47 UTC).
  Word/sentence counts unchanged. The exact 8 added characters are not yet
  identified; the re-check judged the current body, so it is valid.

### 5. Article #29 — regeneration still BLOCKED (evidence)

- The Guardian Travel RSS feed was re-fetched 22 Nov (3 new, 32 duplicates).
  The 26 Apr 2024 Austin article is **not in the current feed**, so no current
  research item was created. The only item for that URL is still id 381:
  500 chars, fetched 2026-11-19, marked outdated.
- #29 was NOT regenerated, its body was NOT edited, it was NOT published.
  It stays a draft, Blocked, fact-check still failed.
- Unblocker: a current evidence item (≥1000 chars) for the Austin URL from a
  source other than the current RSS feed, or the owner's decision.

### 6. Short #06 — PUBLISHED 22 Nov

- YouTube: https://youtube.com/shorts/kVLyvMp8DoA — Public, 37.30s,
  copyright check passed, English subtitles uploaded. Session mdalfahad406,
  no account switch, v1/v4 untouched.
- Pinterest Pin A6: https://www.pinterest.com/pin/264164334389381143/ —
  new public board "Fuel Economy".
- Video file sent to the owner. Daily state: last_uploaded 6, next_article 7.

### 7. Weekly run 22 Nov 06:00 — PASS

- Executed 06:03 Dhaka: daily report id 12 + weekly report id 13.
- New draft #33 (4801 chars). Queue drained 10 (done 19 → 29, queued 12 → 4).
- Published still 25, nothing published. Workers AI only, 48 calls /
  814 Neurons. Emergency Stop OFF. Cost $0.00.
- Full results: `docs/FS-AI-WEEKLY-RUN-POST-RUN-REPORT-2026-11-22.md`.

### 8. Still blocked / pending

- **SOCIAL_TOKEN_SECRET — not set.** The Cloudflare dashboard sign-in timed
  out on 21 Nov before any work started. Social stays disabled until OAuth
  anyway; the secret needs the owner signing in to Cloudflare himself, or a
  later retry. (Social token encryption fails closed without it.)
- **Social OAuth** — one-time per platform, owner's clicks only. Nothing
  connected, nothing posted.
- **#29 regeneration** — blocked on evidence (see §5).
- **Search Console indexing retry** — still outstanding (was due 21 Nov).
- **#28–#31** — still drafts, never auto-published, each needs its own
  separate editorial authorization.

### 9. What was NOT done

- Nothing published by the deploy or the verification. No article body was
  edited by hand. No settings changed except the authorized auto-publish
  enablement (§3). The weekly run was not manually triggered.

---

## Part 4 — Weekly Run Post-Run Verification Report (22 November 2026)

## FS AI Weekly Run — Post-Run Verification Report — 22 November 2026

**Run:** Sunday 22 November 2026, 06:00 Dhaka (Cloudflare Worker scheduled trigger — hourly cron + Sunday guard)
**Executed:** 06:03 Dhaka
**Verdict:** PASS
**Verification method:** live D1 reads after the run. Nothing in this report is estimated or fabricated. Dashboard-only items are marked UNVERIFIED (they need a live browser session).

### 1. Execution

- Daily report **id 12** and weekly report **id 13** — both created 06:03 Dhaka.
- All run steps completed. Only `correctionRun` and `analyticsSnapshot` were no-ops (nothing to correct, nothing to snapshot).

### 2. Research

- **33 RSS fetches, all completed, 0 errors.**
- **0 new items** — the feeds had nothing new today.

### 3. Drafts

- New draft **#33** created: "M State's Detroit Lakes campus to close amid systemwide budget woes", body **4801 chars**, status draft.
- Total articles now **32** (published 25 + draft 7).

### 4. Fact-check

- **3 new fact-checks today** — #26 (0/16), #27 (0/2), #28 (6/7), all verdict **needs-review**.
- **#29: fact-check still failed** (unchanged from before — not caused by this run).
- **#30: fact-check still stale** (unchanged from before — not caused by this run).
- #33 has not been fact-checked yet.

### 5. SEO

- **3 new SEO checks today** — #28, #29, #30 (needs-review).
- No new SEO on #26/#27 — the guard held (protected articles are not re-checked).

### 6. Task queue — big improvement

- **10 tasks drained** (done 19 → 29), queued **12 → 4**.
- Remaining queued: **36, 37** (from 21 Nov) and **39, 40** (new today).
- Failed task **#31 is still the only failed task**. No running tasks. No duplicate keys.

### 7. Publishing

- **Nothing published.** Published still **25**, today 0, gateApproved 0.

### 8. LLM provider

- **Workers AI only** — no other provider used.
- Total: **48 calls / 814 Neurons**. One new call today (content-creation, 36 Neurons).

### 9. Protected articles untouched

- **#26 / #27:** body 4895 / 245 chars, `updated_at` still 19 Nov, protected = 1. Byte-identical to baseline.

### 10. Article #31

- Still **draft**, body **549 chars**. Unchanged.

### 11. Settings (unchanged)

- Auto-publishing **OFF**, auto-correction **OFF**, social **OFF**, publishing mode **approved_only**.

### 12. Emergency Stop

- **OFF.**

### 13. Cost

- **$0.00.**

### 14. Not verified in this report

- Dashboard-only items (Control Center rendering, live dashboard counts) — **UNVERIFIED**, need a live browser session.

### Note — daily Short state

For the 10:13 daily Short run, the state file had Short #06 set as `pending_upload`, so the already-built file was uploaded instead of rebuilding article 6. (Short #06 was uploaded later that morning: https://youtube.com/shorts/kVLyvMp8DoA, Public, copyright check passed.)

### What was NOT done

- Nothing published, nothing changed, the run was **not** manually triggered — it fired on its schedule.

---

## Part 5 — Daily Short + Pin Job Report (22 November 2026)

## FS AI Daily Short + Pin — Job Report — 22 November 2026

**Job:** FS AI daily YouTube Short + Pinterest Pin (scheduled 10:13 Dhaka)
**Ran:** 22 November 2026, 10:23 Dhaka (scheduled run)
**Verdict:** COMPLETE — one Short published, one Pin published.
**Verification method:** worker report + live URLs + state file. Nothing estimated.

### 1. Short #06 — published

- Article 6, "15 Ways to Save Fuel (That Actually Work)"
- URL: https://youtube.com/shorts/kVLyvMp8DoA
- Public, 37.30s, 1080x1920, H.264/AAC, copyright check passed (no issues)
- English .srt subtitles uploaded
- Studio session mdalfahad406 (existing signed-in session; no password guess/retry, no account switch; v1/v4 untouched)
- This was the pending build from 21 Nov — uploaded first per the rules, not rebuilt.

### 2. Pin — published

- URL: https://www.pinterest.com/pin/264164334389381143/
- New public board "Fuel Economy" created (no such board existed)
- Session Watchwithfahad@gmail.com (already signed in)

### 3. State file

- last_uploaded 6, next_article 7, pending_upload/pending_file cleared
- File: hidden_files/daily-shorts-state.json

### 4. Deliverables and records

- Video file: FS-AI-Short-06-Fuel-Economy-15-Ways-to-Save-Fuel.mp4 (37.30s, 1080x1920, QA 15/15, Whisper 99/99 verified)
- Metadata .txt updated (upload, copyright passed, Pin URL noted)
- PIPELINE-README.md updated (metrics table + Short #06 record)
- Daily log: ~/memory/2026-11-22.md (run details appended)
- Goal timeline entry created on goal_d9505685a0fb

### 5. What did not happen

- No sign-in failures, no account switches, no videos edited or deleted.
- Open follow-up: 24h/7d metrics (views, avg view duration, viewed vs swiped, traffic sources) still to log per P10 once available.

---

---

## Part 6 — Post-Deployment Audit (22 November 2026)

## FS AI — Post-Deployment Live Audit & Remaining Work

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

### Verdict

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

### Labels used in this report

- **VERIFIED LIVE** — checked against live D1, a live page, or the live
  repo in this audit.
- **IMPLEMENTED BUT NOT LIVE-VERIFIED** — in the local code, not
  confirmed live by this audit.
- **BLOCKED** — cannot proceed; the blocker is named.
- **OWNER ACTION REQUIRED** — only the owner (or the parent in the
  browser) can do it.
- **NOT IMPLEMENTED** — does not exist in code or live.

---

### 1. Deployed commit, live database, migrations

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

### 2. Automation settings + drifts

#### 2.1 Settings read back individually (live D1, `autonomy_settings`)

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

#### 2.2 Drift 1 — `llm_provider_order` now exists in live D1

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

#### 2.3 Drift 2 — task #31 is no longer failed

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

#### 2.4 Weekly-run summary JSON cross-check (reports 12/13)

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

#### 2.5 Queued tasks — ageing

Queued: **36, 37** (created 21 Nov 00:00–00:01Z, research + content) and
**39, 40** (22 Nov 00:02Z, research). The 22 Nov drain took the 10
oldest other tasks (3–8, 22–24, 35); 36/37 have now waited ~36 hours.
Queue health was `degraded` at the run. **Not a defect yet** — the next
daily run (23 Nov 00:00 UTC) should drain them within the cap of 10 —
but if they are still queued after that run, the drain is skipping them
and the parent should investigate. **Monitor.**

---

### 3. Article #33 — "M State's Detroit Lakes campus to close amid systemwide budget woes"

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

#### 3.1 Independent claim verification (auditor's own check, NOT a worker fact-check)

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

### 4. Article #30 — "A local's travel guide to New York City"

| Check | Result | Status |
|---|---|---|
| Latest fact-check | **id 29, kind `recheck`, verdict `needs-review`, 5/20 verified, 15 failed**, `body_hash` `ac723e55…dae965`, created 2026-11-22 04:50:34 | **VERIFIED LIVE** — matches the addendum exactly |
| Newer body edit or fact-check since | **None.** `updated_at` still 2026-11-22T00:02:50.311Z, body still 4623 chars. No `fact_checks` row after id 29. | **VERIFIED LIVE** |
| Latest SEO | id 22, `needs-review`, 2026-11-22 00:02:52 (internal-links ok; broken-links "host unreachable" — see §10.5) | **VERIFIED LIVE** |
| Status | draft, gate Blocked, `fact_checked` 0 | **VERIFIED LIVE** |

#### 4.1 The 15 failed claims — exact list (`claim_checks` for fact-check id 29)

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

#### 4.2 Root cause

The evidence pool for #30 is a single RSS-summary fragment (~300
chars: the title plus one dek sentence). The article body (4623 chars)
was generated from that fragment and invented the day-by-day detail,
the elaborations, and the connective claims. The checker judged
correctly *against the evidence it had*.

#### 4.3 Auditor's verification against the real Guardian article

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

### 5. Article #29 — "A local's travel guide to Austin"

| Check | Result | Status |
|---|---|---|
| Body | Scaffold shell, 601 chars, still "SCAFFOLD — full draft needed" with 6 `[Write this section — no content yet.]` placeholders. Unchanged by the weekly run except the +8-char link swap (§14). | **VERIFIED LIVE** |
| Evidence | Only research item **381**: 500 chars, fetched 2026-11-19 17:07:18, `is_outdated` = 1. `article_sources` id 2 records the Guardian URL (with trailing slash), `research_item_id` NULL. No new research item for that URL exists. | **VERIFIED LIVE** |
| Fact-check | fc 9 and fc 10, both `failed` (0 verified), 2026-11-20. No newer check. | **VERIFIED LIVE** |
| SEO | id 21, `needs-review`, 2026-11-22 00:02:49. | **VERIFIED LIVE** |
| Status | draft, Blocked. Not regenerated, not edited, not published. | **VERIFIED LIVE** |

#### 5.1 The full article text DOES exist — on verbatim mirrors

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

#### 5.2 Why that does NOT unblock regeneration — the structural limit

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

#### 5.3 Alternatives (none executable today)

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

### 6. Auto-publishing verification

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

### 7. Social media

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

### 8. YouTube automation

| Check | Result | Status |
|---|---|---|
| Short #06 public | Public page fetch (22 Nov 11:29 UTC) returns the video with its description, the article-6 link and 4 hashtags — the video exists and is not private. **Public visibility was verified by the parent in Studio on 22 Nov** (this audit's fetch is supporting evidence, not the Studio proof). URL: https://youtube.com/shorts/kVLyvMp8DoA | **VERIFIED LIVE** (page) + parent-verified (Studio) |
| Metadata / subtitles | `.txt` verified: title "15 Ways to Save Fuel (That Actually Work)" (44 chars, no "\| FS AI" — P6), hook-first description (P7), 4 searchable hashtags, no #FSAI (P7). `.srt` verified: 8 cues (7 scenes + CTA), timings match the 37.30 s timeline. Duration 37.30 s (P1 30–45 s), 7 scenes (P2), cover amber #B45309 fill ~78% (P5), distinct from #03/#04/#05 (P5), spoken CTA end card "Full guide below. Subscribe." (P11), Whisper 99/99, QA 15/15. | **VERIFIED LIVE** |
| Daily state | `last_uploaded` 6, `next_article` 7 (state file read, not modified) | **VERIFIED LIVE** |
| Next scheduled run | Cron `fs-ai-daily-short-upload` ~10:13 Dhaka, 23 Nov. Valid. Not modified. | **VERIFIED LIVE** |
| No duplicate upload | `record_upload.py` is idempotent (re-running the same video-id overwrites the same rows); `article_video_links.json` holds only `"6"`; one receipt `kVLyvMp8DoA.json`. | **VERIFIED LIVE** |
| P1–P12 rules | Present in PIPELINE-README.md §0A (read-only; not edited — the other coordinator owns that tree). #06 followed them (see metadata row; P9 posting-time test is a proposal, not applied; P10 24 h metrics not yet logged — pending). | **VERIFIED LIVE** |
| Article pages → video links | **Not wired.** `article_video_links.json` exists, but no article page consumes it (no youtube/video reference in `frontend/pages/article.html` or `frontend/scripts/app.js` except the channel link). The site→video funnel is still unbuilt. | **NOT IMPLEMENTED** |

#### 8.1 TIME-SENSITIVE — 23 Nov Short selection conflict (OWNER ACTION REQUIRED)

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

### 9. Search Console (technical part only)

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

### 10. Remaining bugs and risks

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

### 11. Exact owner actions still required

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

### 12. Tests

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

### 13. Cost

**$0.00.** No paid service, API, model, credit, subscription, trial, or
card was used in this audit or in any live operation it verified
(Workers AI free tier only; 6 calls / 130 Neurons on 22 Nov UTC).

---

### 14. The +8 characters — solved exactly

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

### Appendix A — Parent procedure: #33 fact-check + SEO (dashboard, UI controls only)

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

### Appendix B — Parent procedure: #30 correction + fresh re-check (dashboard, UI controls only)

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

### Appendix C — Parent procedure: #29 regeneration (CONDITIONAL — blocked until evidence exists)

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

### Appendix D — Parent procedure: Search Console + canonical check (browser)

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

---

## Part 7 — Evidence Fetch Feature, Final Report (22 November 2026)

## FS AI — Full-Article Evidence Fetching Feature: Final Implementation Report

**Date:** 2026-11-22
**Deployed commit:** `54c7b3d1bc7031961998bf92af9a2540b9ffa2f6` (parent `295764c`)
**Status:** Feature deployed and verified live. #33 fetched successfully. #29 correctly refused on Guardian terms. #33 correction BLOCKED by a corrector defect (validation caught it; nothing saved). #30 correction awaits owner authorization.

---

### 1. What was built

The research engine could only learn from RSS summaries. Articles whose sources had left the feed (#29 Austin, #30 NYC) could never be regenerated or properly fact-checked. The feature adds a full-article evidence fetcher, integrated into the whole research and fact-check pipeline.

#### Code changes (local tree → deployed commit 54c7b3d)

| File | Change |
|---|---|
| `backend/services/article-fetch.js` (NEW, 817 lines) | SSRF validation; robots.txt parse/obey + AI-use-terms detection; fetch with timeout, ≤3 manual redirects re-validated per hop, 2 MB streamed cap, ≤2 attempts on transient errors only; readability-style extraction; completeness assessment; storage as a `research_items` row for the RECORDED URL + re-pointing `article_sources.research_item_id`; per-host throttle max(10s, robots Crawl-delay); already-current dedupe 7 days; `article_fetch_runs` audit log. Fetched text is internal verification evidence only, never republished verbatim. |
| `backend/agents/autonomy/research.js` | Re-exports `runArticleFetch` (RSS ingestion untouched). |
| `backend/agents/autonomy-runner.js` | Kind-level dispatch for `research` / `article-fetch`, mirroring `scaffold-regeneration` — manual tasks only, NEVER the scheduled daily run. |
| `database/migrations/029_article_fetch_runs.sql` (NEW) | `article_fetch_runs` table + `research_items.source_kind` / `content_hash` / `extraction_status`. Touches no existing row. |
| `package.json` | `db:migrate` chain extended with 029. |
| `frontend/scripts/autonomy.js` | "Fetch evidence" button per pipeline row + delegated handler enqueuing via the existing `enqueueAgentTask`; available for protected drafts too (read-only research, not a body modification). |
| `tests/article-fetch.test.js` (NEW, 39 tests) | SSRF rejection, robots allow/deny/crawl-delay, AI-use-prohibition detection, extraction incl. `<article>`-preference and byline-teaser regressions, assessment, happy path, all refusal modes, HTTP failures, throttle, already-current, the regen precondition, the fact-check flip (a claim UNSUPPORTED on the fragment becomes VERIFIED once the fetched item exists), the dashboard task shape through `runAutonomyTask`, migration 029 applying cleanly after 001–028. |

**Exact task payload:** `{ agent: 'research', kind: 'article-fetch', payload: { article_id } }` (`url` optional, defaults to the article's first recorded source).

#### Parent-found fix (not in the coordinator's report)

The parent's own independent `npm test` run FAILED first: EXIT=1, exactly 1 failure — the JSON-LD `published_at` test (`2026-11-19T17:56:00` with no timezone designator) read as `11:56:00Z` instead of `17:56:00Z`. Root cause: `new Date()` parses a timezone-less ISO string as **local** time, and the parent's runtime is Asia/Dhaka (+06); the coordinator's run passed because its runtime was UTC. Fix (code, not the test — the test's expectation is correct): `extractPublishedAt` now goes through a `parsePublishedAt` helper that treats a timezone-less ISO datetime as UTC (appends `Z`), so the stored value is identical in every timezone, including the Worker (UTC). Re-run after the fix: **1305 pass / 0 fail, 333 suites, EXIT=0** in the +06 runtime. No test weakened. The existing JSON-LD test is the regression test for this bug.

#### Test results

| Run | Result |
|---|---|
| Coordinator (implementation) | 1305 pass / 0 fail, 333 suites |
| Parent, first independent run | 1304 pass / 1 fail (the timezone bug above) |
| Parent, after the code fix | **1305 pass / 0 fail, 333 suites, EXIT=0** |
| Migration chain 001–029 on a scratch SQLite DB | Applies cleanly in order (54 tables) |

---

### 2. Deployment (P0) — done and verified live

1. **Pre-deploy D1 backup:** `hidden_files/d1-backup-2026-11-22-pre-deploy.json` (1,582,497 bytes, 52 tables) — articles 32, agent_tasks 40, fact_checks 30, claim_checks 292, research_items 713.
2. **Migration 029 applied live:** all 7 statements success. `article_fetch_runs` exists (0 rows at apply time); `research_items` has `source_kind` / `content_hash` / `extraction_status`.
3. **Push:** zip regenerated (1,628,529 bytes, 350 files, top-level `fs-ai/`, only `.env.example` — placeholders only, no real secrets). Browser task verified base `295764c`, uploaded the zip (commit `78c74ba`), created the one-time workflow (commit `854caa3`, content recovered verbatim from the 21 Nov push commit `020031b` via the public GitHub API), ran workflow_dispatch — **run #29, Success in 9 seconds**. New HEAD `54c7b3d1bc7031961998bf92af9a2540b9ffa2f6`, exactly 1 parent (`295764c`), 13 files changed (+4,656/−9). Workflow file + zip both gone (404 verified).
4. **Post-deploy verification (parent, live):**
   - Served `dashboard.html` SHA-256-identical to the deployed tree (23,379 bytes). Served `autonomy.js` SHA-256-identical, contains the "Fetch evidence" button (`data-autonomy-fetch-evidence`, line 841).
   - Raw `main` content: `article-fetch.js` SHA-256-identical to local; migration 029 on main. (GitHub API metadata check was rate-limited unauthenticated; the browser task's commit-page verification + raw content hashes stand as the evidence.)
   - Counts unchanged: published 25, drafts 7, total 32.
   - Article bodies unchanged: #26 4895, #27 245, #28 2157, #29 601, #30 4623, #31 549, #33 4801.
   - Settings unchanged: publishing_mode auto, auto_publishing on, cutoff 2026-11-22T04:55:28Z, social_auto_post off, auto_correction off, max_articles_per_day 1, autonomy_level 3. E-Stop OFF. Cost $0.00.
   - Rollback prepared: revert the push + restore the D1 backup (DROP TABLE `article_fetch_runs` if needed; the three `research_items` columns are nullable and safe to leave). Not needed.

---

### 3. Live extraction results (P1, P2)

Run from the owner dashboard (signed in as Owner mdalfahad841@gmail.com; session expires 2026-11-29). No Correct / Re-check / Publish button was touched for these steps; #28, #30, #31 untouched.

#### P1 — Article #33: SUCCESS

- Dashboard: **Task 42: done (run #169)**.
- D1 `article_fetch_runs` id 1: Higher Ed Dive, HTTP 200, extraction_status `ok`, **extracted_chars 3,985**, research_item_id **714**, fetched 2026-11-22T06:41:27Z.
- Research item 714: source_kind `article-fetch`, 3,985 chars, extraction_status `ok`, content_hash present. `article_sources` for #33 re-pointed from item 696 (114 chars) to 714.
- Content spot-check of item 714: summer-2028 closure, ~111 students, board vote, enrolment down from ~600, "100 million" deficit, 40 employees, "struggling" — all present. No "scholarship" or "placement" in the source (confirming those article claims are invented). Ends with proper punctuation, no teaser leakage.
- **The feature unblocks #33 completely.** Body unchanged (4801, draft).

#### P2 — Article #29: CORRECT REFUSAL

- Dashboard: **Task 43: no-op (run #170) — terms-prohibit-ai-use**: "this site states its content may not be used for LLM / machine-learning / AI purposes — the fetch is refused on the publisher's own terms, not attempted."
- D1 `article_fetch_runs` id 2: Guardian, http_status NULL (never fetched), extraction_status `failed`, reason `terms-prohibit-ai-use`, 0 chars, no research item. Body unchanged (601, draft). No regeneration attempted.
- **The Guardian's robots.txt prohibits AI/LLM use of its content. The feature refuses Guardian fetches by design, and mirrors are out of scope (fetching Guardian content from an unlicensed mirror to evade the terms would violate the compliance rules).** #29 and #30 stay blocked on this. Their unblocker is the **Guardian Open Platform API** (owner registers a free key; a follow-up worker path — licensed route, NOT built here) or an owner-written body.

#### P2b — Article #30 fetch (expected refusal, not run separately)

The #30 Guardian NYC URL is the same publisher with the same robots.txt AI-use prohibition, so a live attempt would refuse identically. It was not run — the refusal is already proven by #29's run and the local verification (both Guardian URLs refused locally with `terms-prohibit-ai-use`, 11 seconds apart, per-host throttle working). The human investigation of #30's claims against the real Guardian article (audit §4.3) stands as the evidence of record.

---

### 4. Article #33 correction (P4) — BLOCKED by a corrector defect

**What happened:** Dashboard Correct → task #44 → run #171 → **FAILED: "VALIDATION REJECTED — nothing was saved; the article needs human review."** Then dashboard Re-check → run #172 → needs-review, **11/20 verified, 9 failed** (fact_checks id 32, evidence signature `714:2026-11-22 06:41:28:5bd067a7064456e4`, body_hash matches the current body).

**Verified state (D1):** body still 4801 chars, updated_at unchanged, 0 `article_revisions` rows for #33 — **nothing was saved, exactly as the dashboard said**. Still draft, gate Blocked.

**Root cause (from run #171's recovery report):** the corrector attempted 8 corrections + 5 removals, but the WHOLE corrected body was rejected by whole-body validation because one corrected sentence contained the **raw source URL** (`https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/`). Validation reasons, all about that one sentence:
1. broken sentence fragment (starts with a lowercase letter): the URL;
2. sentence contains a raw URL (citation not stripped);
3. unsupported number 875256 in the corrected sentence — not in the article's evidence.

Recovery report: root cause "Corrected body failed whole-body validation (garbled, repeated, incomplete or unsupported content)"; `retryable: false`; status `BLOCKED_WITH_REASON`; ownerAction "Human review: inspect the failed claims and correct by hand, or fix the underlying cause (see validation reasons) and re-run"; nextStep "Do NOT re-run the correction on this unchanged input — it will fail the same way. Fix the underlying cause first (see root cause), then re-run."

**This is the validation working as designed** — it stopped a garbled body (with a raw URL pasted in as a sentence) from being saved. The defect is in the corrector: it does not strip citations/URLs from corrected text. It is a code defect to fix, not an evidence problem.

**The good news — the full evidence DID improve the fact-check:** fc 30 (fragment evidence 696) was 7/20 verified; fc 31 (correction-recheck, evidence 714) and fc 32 (re-check, carried all 20 forward from fc 31) are **11/20 verified**. Four claims flipped UNSUPPORTED → VERIFIED on the full evidence:
- "This article explains what led to the decision, how it fits into the broader financial picture…"
- "The move is part of a larger plan to address budget woes…"
- "Students currently enrolled at Detroit Lakes will be offered transfer options…"
- "- **Impact:** Students will be transferred to other campuses; faculty and staff will receive support."

(One more flipped UNSUPPORTED → CONFLICTING: the "For readers interested…" resources paragraph — still failed.)

**9 claims still failed (fc 32, ids 313–332):** 8 UNSUPPORTED + 1 CONFLICTING:
- "While the exact numbers of the budget shortfall are not publicly disclosed…" — contradicted (source gives $1M/yr operating savings, $18M capital avoided, ~$100M deficit).
- "The closure will also free up funds that can be redirected toward initiatives such as scholarship programs, online course expansion, and technology upgrades" — invented (source: up to $25M/yr reallocated to struggling institutions).
- "Although the exact financial details are not public, the university's leadership has indicated that the closure will help stabilize the system's budget…" — unsupported.
- "By consolidating operations and focusing on core campuses, M State aims to preserve overall academic quality while addressing fiscal deficits." — unsupported.
- "Faculty and staff will receive support through career placement services and, where possible, opportunities for relocation within the system." — invented (source: 40 employees, no placement mention).
- "As universities across the nation face similar fiscal challenges, the M State experience serves as a case study…" — unsupported.
- "- **Reason:** Ongoing budget woes make continued operation unsustainable." — unsupported.
- "- **Broader context:** The decision reflects a wider trend of campus consolidations driven by financial pressures." — unsupported.
- "For readers interested in the broader context…" (resources list) — CONFLICTING.

**Next step for #33 (planned, autonomous):** fix the corrector's citation-stripping defect (strip raw URLs from corrected text / reject-and-regenerate the offending sentence, with a regression test), deploy, then re-run the #33 correction. The alternative — hand-correcting the 13 unsupported claims as exact text edits — is the recovery report's other named path. #33 stays a blocked draft either way; it can never auto-publish (legacy, pre-cutoff).

**Known weak-verify (flagged, not a blocker):** claim #273 ("close-knit community") was VERIFIED on the fragment and survives the automated correction — a human editorial call, not a blocker.

---

### 5. Article #30 — prepared correction, awaiting owner authorization

Per the owner's 22 Nov decisions, #30's body must NOT change without separate authorization. The prepared correction (vs fact-check id 29; the 5 VERIFIED claims preserved) is ready to apply as exact text edits with an `article_revisions` row preserving the 4623-char body:

**4 removals:** #253, #256, #260, #271.
**2 rewords:**
- #254 → "The Guardian's March 2024 feature, 'A local's travel guide to New York City…,' gives a clear snapshot of the city's best experiences."
- #264 → "The guide opens the trip with the ferry ride."
**9 keeps:** #258, #259, #261, #263, #265, #266, #267, #269, #270 — including the day headings and the TRUE anecdote #270 (the accidental-first-visit story), which the fragment-based Correct flow would wrongly delete.

Do NOT use the dashboard Correct button for #30 (it would delete true claims on fragment evidence). **Limitation to state plainly:** a fresh Re-check will still judge the kept claims against the stored fragment, so it will likely still read `needs-review` — the human verification (audit §4.3) is the evidence of record until licensed full evidence exists (Guardian Open Platform API key).

**After authorization + correction:** fresh Re-check (expected new `fact_checks` row, id 33+, claims_total < 20, body_hash equal to the corrected body's hash, verdict expected `needs-review`, fact_checked stays 0, stays draft).

---

### 6. Article statuses (verified live, 2026-11-22)

| Article | Status | Body | Fact-check | Notes |
|---|---|---|---|---|
| #26 | draft, protected | 4895 | 0/16 | Untouched |
| #27 | draft, protected | 245 | 0/2 | Untouched |
| #28 | draft, legacy | 2157 | 6/7 | Untouched; needs separate authorization |
| #29 | draft, legacy | 601 | failed (fc 9/10) | Scaffold shell; Guardian terms block evidence fetch; regen blocked; needs Guardian API key or owner-written body |
| #30 | draft, protected | 4623 | 5/20 (fc 29) | Prepared correction ready; body edits need owner authorization |
| #31 | draft, legacy | 549 | PASS 3/3 | Gate Blocked; stays draft until owner authorization |
| #33 | draft, legacy | 4801 | 11/20 (fc 32) | Full evidence stored (item 714); correction blocked by corrector defect; stays draft |

Counts: published 25, drafts 7, total 32. Queue: done 34, queued 4 (ids 36, 37 ageing from 21 Nov; 39, 40 from 22 Nov — watch the 23 Nov daily run's drain). E-Stop OFF. Cost $0.00.

---

### 7. Remaining blockers

1. **#30 correction — owner authorization required.** The prepared correction above (§5). One tap authorizes the exact text edits; publication still needs a separate editorial authorization afterwards.
2. **#33 correction — corrector defect.** The corrector pastes raw URLs into corrected sentences; whole-body validation correctly rejects the result. Fix the citation-stripping defect, deploy, re-run. (Planned next autonomous step.)
3. **#29 / #30 evidence — Guardian Open Platform API key.** The fetch feature refuses Guardian on terms. The licensed route needs the owner's free-key registration + a small follow-up worker path (API fetch variant of article-fetch, same compliance envelope). Not built yet.
4. **Live Worker verification of the fetch path** — done: runs #169/#170/#171/#172 all executed on the live Worker via the dashboard, with D1-verified outcomes.
5. **#33 SEO** — runs in the next daily run (23 Nov 00:00 UTC); no per-article SEO button exists. Verify it appears.
6. **Optional cleanup (low priority):** `llm_provider_order` in live D1 reads `workers-ai,groq,gemini` (writer unknown; neutralised by the code allowlist). Set to `workers-ai` or delete the row when convenient.

---

### 8. What does not change

- #28 / #31 untouched. No social connections (social_auto_post OFF; Pinterest OAuth begins separately, later). YouTube: #09 Short on 23 Nov, #07 long-form on 5 Dec — unchanged. Search Console: Article 1 indexing retry 23 Nov 11:00 Dhaka (runonce cron set; quota reset).
- No article was published by this work. #33 can never auto-publish (legacy, pre-cutoff). Auto-publish remains on for eligible NEW post-cutoff articles only, 1/day max.

---

## Part 8 — Corrector Citation-URL Fix (22 November 2026)

## FS AI — Corrector Citation-URL Defect Fix (live #33)

**Date:** 2026-11-22
**Status:** Fixed in the local tree, full suite green. **Not deployed** — the parent deploys.
**Files changed (2):** `backend/agents/autonomy/factcheck.js`, `tests/factcheck-correction-validation.test.js`
**No migration.** No article body touched. No live D1 writes. No publish.

---

### 1. Root cause (exact)

**The URL was never inserted by the LLM.** The candidate guard is airtight: `cleanCandidate()` takes only the first sentence of a reply, and `isValidReplacementSentence()` rejects any candidate containing `https?://`. The URL was **pre-existing citation scaffolding in the original #33 body**, and the correction loop exposed it:

- The original body has a "Sources and further reading" bullet ending in a bare URL with **no terminal punctuation**:
  `- Higher Ed Dive. "M State's Detroit Lakes campus to close amid systemwide budget woes." *Higher Ed Dive*, 19 Nov 2026. https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-systemwide-budget-woes/875256/`
- `splitSentences()` (`backend/agents/autonomy/factcheck.js:672`) splits only after `.`/`!`/`?`, so it **glues that URL to the FOLLOWING paragraph** into one element: `"https://...875256/ For readers interested in the broader context ... across the country."`
- In the original body that glued element is pre-existing, so the "pre-existing issue" exemption in `validateCorrectedBody()` covers it.
- The correction rewrote the "For readers interested..." claim inside that paragraph (run #171: 8 corrections + 5 removals attempted). The glued element changed to `"https://...875256/ [clean candidate]."` — new text, exemption broken — and validation flagged it as a newly introduced defect with exactly these three reasons (reproduced byte-for-byte, see §2):
  1. `broken sentence fragment (starts with a lowercase letter): "https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-sy"`
  2. `sentence contains a raw URL (citation not stripped): "https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-sy"`
  3. `unsupported number 875256 in corrected sentence ("https://www.highereddive.com/news/m-states-detroit-lakes-campus-to-close-amid-sy") — not in the article's evidence`
- Result: the whole corrected body was rejected, nothing saved (body still 4801 chars, 0 revisions), status `BLOCKED_WITH_REASON`, `retryable: false`. **Any** rewrite of a claim in that paragraph would fail the same way — the correction could never succeed on this article.

**Exact location:** `validateCorrectedBody()` (`backend/agents/autonomy/factcheck.js:1036`) split the RAW bodies into sentences for the sentence / duplicate / evidence checks, while `paragraphIssues()` (same file) and `extractClaims()` already judge citation-stripped text. The documented intent of `stripCitationLines()` (line 200) is explicit: *"Remove citation-only lines from a body (shared by extractClaims and the corrected-body validator so both agree on what is a citation)."* The validator was not living up to it for the sentence-level checks.

### 2. Reproduction (before the fix)

A throwaway script (`/tmp/repro-33-url.cjs`, not in the repo) using the **real** #33 body and the **real** fetched evidence (research item 714) from live D1 (read-only), replacing the "For readers interested..." claim with a clean single sentence, produced exactly the three run-#171 reasons from `validateCorrectedBody()` — `ok: false`. `extractClaims()` on the real body returns 20 claims, matching fc 30/31/32. After the fix, the same script returns `ok: true` with no reasons.

### 3. The fix

In `validateCorrectedBody()` only — two lines changed:

```js
const originalSentences = splitSentences(stripCitationLines(originalBody));
const correctedSentences = splitSentences(stripCitationLines(correctedBody));
```

(Previously `splitSentences(originalBody)` / `splitSentences(correctedBody)`.) `paragraphIssues()` already strips internally and is unchanged; `balanceIssues()` still runs on the raw text; the truncation guards in `runCorrection()` are unchanged.

**What this does:** the validator now judges the PROSE on both sides, so citation scaffolding can neither be blamed on the correction nor hide a genuine prose defect.

**What it does NOT do (no gate lowered):**
- The whole-body validation itself is untouched — same checks, same reasons, same rejection path.
- A raw URL **inside** a prose sentence is still flagged: `stripCitationLines()` only drops whole citation-only lines.
- The candidate-level URL rejection (`isValidReplacementSentence()`) still bars any URL from entering through a rewrite — proven by regression test 4 below.
- **Documented boundary:** a bare-URL-only line is now treated as citation scaffolding by the sentence checks (consistent with `paragraphIssues()`, which already strips citation lines, and with `extractClaims()`). A URL can only reach the body through a candidate (rejected upstream) or from the original body (pre-existing, exempt by design). There is no path in `runCorrection()` that inserts a new bare-URL line.

### 4. Regression tests (4 new, all in `tests/factcheck-correction-validation.test.js`, new describe block "validateCorrectedBody — citation-glued bare URL (live #33)")

1. **Unit, the exact #33 shape** — synthetic body with a Sources bullet ending in the bare URL `.../875256/` glued to the following paragraph; correcting the wrong-number claim in that paragraph with a clean sentence → `validateCorrectedBody` returns `ok: true`, no reasons, no URL reason.
2. **Guard: a genuinely NEW mid-sentence raw URL is still rejected** — corrected body where a new sentence contains `see https://example.com/report for details` → `ok: false` with a raw-url reason.
3. **End-to-end `runCorrection` on the #33 shape** (real in-memory SQLite DB, LLM stubbed via `env.AI`) — outcome `done`, corrected 1, removed 0; saved body contains `100 million`, not `50 million`; **both** pre-existing sources URL lines survive untouched (URL occurs twice); one revision row preserves the original body.
4. **A rewrite containing a raw URL is never inserted** — stubbed LLM reply contains a raw URL → candidate rejected, claim removed instead; outcome `done`, corrected 0, removed 1; saved body contains neither the rewrite's URL nor the wrong number.

**Negative control (proves the tests catch the defect):** with the fix temporarily reverted, exactly tests 1 and 3 fail (17/19 pass); with the fix restored, 19/19 pass. Tests 2 and 4 pass both before and after, proving the validator is not blinded and the candidate guard is independent of this fix.

### 5. Test results

| Run | Result |
|---|---|
| `tests/factcheck-correction-validation.test.js` (with fix) | 19 pass / 0 fail (15 existing + 4 new) |
| Same file, fix temporarily reverted | 17 pass / **2 fail** (exactly the two #33-shape tests) |
| **Full suite, `npm test`** (repo's own runner) | **1309 pass / 0 fail, 334 suites, EXIT=0** |
| Suite before this fix | 1305 pass / 0 fail, 333 suites |

Delta is exactly +4 tests / +1 suite. No test weakened, none deleted. Migration chain 001–029 unchanged (no migration touched), so no re-verification of the chain was needed.

### 6. What the parent must do to deploy and re-run the #33 correction

1. **Pre-deploy D1 backup** (same method as 2026-11-22: `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-pre-deploy.py`, new dated copy). No new migration to apply.
2. **Push** via the established zip + one-time-workflow route (regenerate `~/workspace/fs-ai-source/fs-ai-source.zip`, verify base commit, upload, create `.github/workflows/push-source-once.yml`, run workflow_dispatch, verify new HEAD has exactly 1 parent and the workflow + zip are gone). Rollback: revert the push + restore the D1 backup.
3. **Post-deploy verify:** served `dashboard.html` / `autonomy.js` SHA-256-identical to the deployed tree; counts unchanged (published 25, drafts 7); #26/#27/#31 bodies unchanged; settings unchanged (publishing_mode auto, cutoff 2026-11-22T04:55:28Z, social_auto_post off); E-Stop OFF; $0.00.
4. **Re-run the #33 correction** from the owner dashboard (signed in as Owner): Autonomous Operations → #33 row → "Correct" → run the queued task manually → expect `done` (not `failed`). The correction should apply the 8 corrections + 5 removals attempted in run #171 (the same input, now with the glue fixed). Then "Re-check" → expect a new `fact_checks` row with claims_total < 20 (claims removed), body_hash equal to the corrected body's hash, verdict expected `needs-review` (9 failed claims remain, several genuinely unsupported/invented — the correction removes/qualifies them; the re-check judges the new body). #33 stays a draft; it can never auto-publish (legacy, pre-cutoff).
5. **Verify in D1 afterwards:** article #33 body length changed from 4801, exactly 1 new `article_revisions` row, `article_corrections` rows for the 13 claims show `applied`/`removed` (not `failed`), latest `fact_checks` row for #33 has `check_kind` `recheck` and `evidence_signature` starting `714:`.
6. **If the re-run still fails:** do NOT re-run in a loop. Read the run's `validationReasons` / recovery report from the `agent_runs` detail first — a new failure means a different defect, not this one.

### 7. Notes / limits

- The fix does not change the saved article: the Sources lines stay in the body (they are the article's in-body attribution; the correction's job is the failed claims, not deleting the sources section). The end-to-end test asserts both URL lines survive.
- The known weak-verify from the final report stands: claim #273 ("close-knit community") was VERIFIED on the fragment and survives the automated correction — a human editorial call, not a blocker.
- The #30 correction (prepared, awaiting owner authorization) is unaffected by this fix; do NOT use the dashboard Correct button for #30 (it would delete true claims on fragment evidence).

---

## Part 9 — Same-Day Correction-Retry Fix (22 November 2026)

## FS AI — Dashboard Same-Day Correction-Retry Defect Fix (live #33)

**Date:** 2026-11-22
**Status:** Fixed in the local tree, full suite green. **Not deployed** — the parent deploys.
**Files changed (3):** `backend/routes/scheduler.js`, `backend/routes/orchestrator.js`, `tests/autonomy-queue.test.js`
**No migration.** No article body touched. No live D1 writes. No publish.

---

### 1. Root cause (exact)

The dashboard Correct button could start at most **one correction per article per day**, and a failed correction could never be retried the same day. The chain, verified in code and against the live task #44 row (parent's D1 read):

- The dashboard builds the idempotency key as `'manual-' + kind + '-' + articleId + '-' + <today's date>` (`frontend/scripts/autonomy.js:1143`, `enqueueAgentTask`). Today's Correct clicks for #33 all use `manual-correct-33-2026-11-22`.
- `enqueueTask` (`backend/routes/scheduler.js:518`) dedupes **only** by `idempotency_key`, and `duplicateTaskResult` returned the existing row **unchanged** for every non-content task — whatever its status. The first Correct click created task #44 (kind `'correct'`); run #171 FAILED on the validator defect; the Re-check then reused the same row and forced its kind to `'fact-check'` (`handleRecheckArticle`, `backend/routes/orchestrator.js` ~line 1228); run #172 finished, leaving the row status `'done'`, attempts 2/3.
- The next Correct click found the same key, returned the `'done'` row as `duplicate: true`, and the dashboard said "already existed — run it from the task queue." But a `'done'` task has **no Run button** (Run renders only for `'queued'`, `autonomy.js:494`) and the Retry button renders only for `'failed'` (`autonomy.js:495`). Dead end: no new task, no new run, #33 still draft/Blocked with 13 failed corrections.

**Parent's point 4 — checked, NOT a defect in `runTask`:** a failed correction run does NOT leave the task `'done'`. `runCorrection` returns `outcome: 'failed'` on validation rejection (`backend/agents/autonomy/factcheck.js:1386`), `runAutonomyTask` passes it through, and `runTask` (`scheduler.js`, `resolveStatus`) re-queues a failed run with backoff while attempts remain (RETRYING) — run #171 correctly left task #44 queued for retry. The task ended `'done'` because run #172 (the re-check) **succeeded**. The re-check handler reused the pending correction-retry row and forced its kind to `'fact-check'`, consuming the retry. That reuse is a real but separate observation (see §7); it is not changed here, and the fix below repairs its effect on the next Correct click.

### 2. The fix

Manual dashboard enqueues now re-queue a terminal task instead of returning it dead. Scheduled callers are untouched.

**`backend/routes/scheduler.js`** — `duplicateTaskResult` gains the re-queue branch (after the Fix 8 content merge, which keeps precedence), and `enqueueTask` accepts and forwards a `requeueTerminal` option through both the normal duplicate branch and the UNIQUE-race branch:

- Only when `requeueTerminal` is set AND the existing row is terminal (`done` / `failed` / `skipped`): `UPDATE agent_tasks SET agent=?, kind=?, payload=?, division_id=?, priority=?, status='queued', attempts=0, scheduled_for=?, updated_at=?` — kind + payload restored to the requested work, attempts reset to 0 (the explicit-owner-retry precedent from `retryTask`, which notes "Explicit owner retry is the ONLY reset"), terminal state cleared via `clearTerminalState` so the task can reach a fresh terminal state. Returns `{ ok: true, task, duplicate: true, requeued: true }`.
- Queued/running rows are never touched (genuine double-click protection). Content tasks keep the Fix 8 merge path — a done content task is never re-queued (the merge already rejects sources for done/running/skipped content tasks with "create a new task").

**`backend/routes/orchestrator.js`** — `handleCreateTask` (POST `/api/autonomy/tasks`, the manual dashboard endpoint) passes `requeueTerminal: true` and forwards `requeued: true` in the response. The dashboard message stays "already existed — run it from the task queue", which is now **true**: the task is queued and runnable.

**Not changed:** the idempotency protection itself (a queued/running duplicate still returns the existing row unchanged); `handleRecheckArticle` (see §7); `runTask`'s outcome → status mapping; any gate; the frontend (no change needed — the Run button appears once the task is queued).

### 3. Regression tests (6 new, all in `tests/autonomy-queue.test.js`, describe "autonomy task queue — manual re-enqueue of a terminal task (live #33, 2026-11-22)")

1. **Second same-day Correct enqueue re-queues the done task** — live #44 shape (key `manual-correct-33-2026-11-22`, kind forced to `'fact-check'`, status `'done'`, attempts 2/3) via the real manual endpoint → `duplicate: true`, `requeued: true`, same task id, status `'queued'`, kind `'correct'`, attempts 0, `scheduled_for` null, still exactly one row.
2. **A failed terminal task re-queues too** — status `'failed'`, attempts 3 → queued, attempts 0.
3. **Second enqueue while queued returns the row unchanged** — no re-queue, no duplicate run.
4. **Second enqueue while running returns the row unchanged** — attempts untouched.
5. **A done content-creation task is NOT re-queued (Fix 8 precedence)** — stays `'done'`, `sourceMerge.status` `'rejected'`, no `requeued` flag.
6. **`enqueueTask` without the manual flag still returns a done task unchanged** — scheduled callers (daily `daily-research` / `daily-content` / `daily-factcheck` / `daily-seo` / `daily-social` keys) are unaffected: a second daily-run pass never re-runs a completed daily task.

### 4. Test results

| Run | Result |
|---|---|
| New tests, before the fix | **4 pass / 2 fail** — exactly the two terminal re-queue tests fail (done + failed); all four guard tests already pass |
| New tests, with the fix | **6 pass / 0 fail** |
| Negative control (flag temporarily set `false`, fix otherwise intact) | **4 pass / 2 fail** — exactly the same two tests fail again; flag restored to `true` afterwards (verified at `orchestrator.js:393`) |
| **Full suite, `npm test`** (repo's own runner) | **1315 pass / 0 fail, 335 suites, EXIT=0** |
| Suite before this fix | 1309 pass / 0 fail, 334 suites |

Delta is exactly +6 tests / +1 suite. No test weakened, none deleted. No migration touched, so no migration-chain re-verification was needed.

### 5. What the parent must do to deploy and re-run the #33 correction

1. **Pre-deploy D1 backup** (same method as 2026-11-22: `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-pre-deploy.py`, new dated copy). No new migration to apply.
2. **Push** via the established zip + one-time-workflow route (regenerate `~/workspace/fs-ai-source/fs-ai-source.zip`, verify base commit `4215b07`, upload, create `.github/workflows/push-source-once.yml`, run workflow_dispatch, verify new HEAD has exactly 1 parent and the workflow + zip are gone). Rollback: revert the push + restore the D1 backup.
3. **Post-deploy verify:** served `dashboard.html` / `autonomy.js` SHA-256-identical to the deployed tree; counts unchanged (published 25, drafts 7); #26/#27/#31 bodies unchanged; settings unchanged (publishing_mode auto, cutoff 2026-11-22T04:55:28Z, social_auto_post off); E-Stop OFF; $0.00.
4. **Re-run the #33 correction** from the owner dashboard (signed in as Owner): Autonomous Operations → #33 row → "Correct" → expect "correct task created (task #44) — already existed. — run it from the task queue." — this time the task IS queued, so run it from the task queue (Run button on #44, or "Run a task manually"). Expect outcome `done`: the same 8 corrections + 5 removals attempted in run #171 should now apply (validator fix deployed as 4215b07). Then "Re-check" → expect a new `fact_checks` row with claims_total < 20 (claims removed), body_hash equal to the corrected body's hash, verdict expected `needs-review` (9 failed claims remain; the correction removes/qualifies them; the re-check judges the new body). #33 stays a draft; it can never auto-publish (legacy, pre-cutoff).
5. **Verify in D1 afterwards:** article #33 body length changed from 4801, exactly 1 new `article_revisions` row, `article_corrections` rows for the 13 claims show `applied`/`removed` (not `failed`), latest `fact_checks` row for #33 has `check_kind` `recheck` and `evidence_signature` starting `714:`.
6. **If the re-run still fails:** do NOT re-run in a loop. Read the run's `validationReasons` / recovery report from the `agent_runs` detail first — a new failure means a different defect, not this one.

### 8. Live outcome (parent verification, 2026-11-22 14:07–14:15 Dhaka)

Deployed as commit `1d14068` (workflow run #31, 11s; post-deploy SHA/counts/settings/E-Stop verified). Dashboard re-run for #33:

- Correct re-queued task #44 (kind `correct`, status `queued`, attempts 0/3) — the retry fix works.
- Run #173 reported `done`. **The correction APPLIED** (parent D1 verification): body 4801 → **3478 chars**, revision row id 20 preserves the old body, 4 applied + 5 removed (attempt-2 rows 52–60). The dashboard's Correction review still lists the 13 stale attempt-1 `failed` rows from run #171 — that display made it look like nothing was saved; the D1 rows prove otherwise.
- Fact-check now **PASS 15/15**: fc 33 (correction-recheck, run #173) and fc 34 (recheck, run #174), both 15/15, body_hash `67330d2e…` verified exact against the corrected body, evidence signature `714:…`. Invented claims gone (`scholarship`/`placement` absent from the body); Sources lines kept.
- Gate still Blocked on 4 stale failed rows (those 4 claims flipped to VERIFIED on the full evidence — #39/#44/#46/#50 — so they needed no correction, but the gate counts their old attempt-1 rows) + no SEO check yet (runs in the 23 Nov 00:00 UTC daily run). #33 stays a draft (legacy, needs separate authorization to publish).

### 6. Notes / limits

- The fix does not change the saved article: it only makes the correction runnable again. The Sources lines stay in the body.
- The dashboard "already existed" message is now accurate rather than misleading: the row is reused AND re-queued, so "run it from the task queue" works.
- The #30 correction (prepared, awaiting owner authorization) is unaffected by this fix; do NOT use the dashboard Correct button for #30 (it would delete true claims on fragment evidence).

### 7. Known follow-up (found during verification, NOT fixed here)

`handleRecheckArticle` reuses the article's newest fact-checking task **regardless of kind or status** (`findFactCheckTasksForArticle` has no status/kind filter) and forces its kind to `'fact-check'`. If a correction run has failed and the task is queued for retry (RETRYING with backoff), clicking Re-check silently converts that pending correction retry into a fact-check run — the retry is lost. In the #33 case this is what turned task #44 from a pending correction retry into a fact-check task. After this fix the damage is repairable from the dashboard (Correct re-queues the row as `'correct'` again), so it is not blocking. A future fix should make the re-check skip rows whose kind is `'correct'` and whose status is `'queued'` (pending retry), or create a fresh task when the newest row is a pending correction — but that changes the live-verified #31 re-check behaviour (runs #121/#122) and needs its own verification, so it is left for a separate change.

---

## Part 10 — Ultimate Video System (22 November 2026)

## FS AI — Ultimate YouTube Video Production System — 22 November 2026

**Brief:** owner brief "FS AI — ULTIMATE YOUTUBE VIDEO PRODUCTION SYSTEM"
(22 Nov 2026, 11:02). **Status: IMPLEMENTED, TESTED, VERIFIED — with
documented limitations.** Nothing in this report is estimated: every number
was measured today (22 Nov 2026) by the build agents or by independent
re-verification. Where something could not be verified, it says so.

**Verdict in one paragraph:** the five formats exist as real, working
renderers on the existing PIL + FFmpeg stack; six videos were rendered and
verified (five format samples + the owner's requested 20-second video);
the test suite is green (142 tests); the publishing chain is verified and
its recording gap was repaired; the whole build cost $0. What is NOT
proven is audience impact — the samples are unpublished, so no retention
data exists for them (or yet for Short #06). Two brief requirements were
adapted, never broken: no music and no footage of any kind (owner's
100%-original rule overrides the brief), and true 3D is pseudo-3D because
Blender is not installed in this VM.

**Hard owner rules preserved throughout:** $0 always; 100% original coded
motion graphics only; no music ever; no third-party clips, footage, audio,
photos, or stock; no people; licensed TTS only
(`avocado_v2:MAI_03`, speed 90); no topic intro; a distinct designed cover
frame on every Short; Shorts 1080×1920 30 fps under 60 s; never delete or
edit a published video; never publish experimental or unverified videos;
the daily Short cron and the existing publishing workflow were not broken.

---

### 1. Existing production audit

Audited read-only: `PIPELINE-README.md`, the 2026-11-21 performance report,
`YOUTUBE-GAP-REPORT-2026-11-21.md`, and all engine code in `work/`
(`youtube_common.py`, `render_engine.py`, `script_engine.py`,
`topic_suitability.py`, `seo_engine.py`, `qa_checks.py`, `subtitles.py`,
`content_calendar.py`, `record_upload.py`, `analytics_store.py`,
`reliability.py`, `growth.py`, `longform.py`, `build_video_short06.py`,
plus `build_video_short05.py` / `build_long01.py`).

**Headline:** the Workstream-D engine (2026-11-21) is a genuine, well-designed
fix for the diagnosed packaging problems — rules P1–P12 are mostly enforced
in code, and Short #06 (37.30 s, QA 15/15) is measurably better-built than
#02–#05. But the system is a set of modules plus manual shell steps, not a
pipeline.

**What works**
- Deterministic, dependency-light render (PIL + FFmpeg only, no external
  assets). Paper Editorial identity centralised in `render_engine.py`.
- `render_engine.py` fixes the two diagnosed render defects: the corner
  ellipses that clipped "ARTICLE N" on #03/#04/#05 are gone from `build_bg()`,
  and every scene has a continuous-motion driver (gauge needle, fill bar,
  moving dot, slide highlight, check-row reveals at 15%/50%/85% of scene
  progress instead of all by 1.45 s).
- Timeline constants enforced centrally in `youtube_common.py` (PAD/GAP 0.2,
  ENDCARD 2.0, 7–8 scenes, 3.5–5.5 s scenes, dead air ≤8%, hard max 50 s).
- QA check 02 (facts-numbers) is real since 2026-11-21: every number in the
  narration must appear in the article (digits + English number-words,
  `Fifteen` == `15`); it fails closed when no article body is supplied.
- SRT export (`subtitles.py`) is solid: one cue per scene + CTA cue,
  strict validation, 8 cues for #06 (00:00:00,300 → 00:00:37,297).
- `record_upload.py` validates the 11-char video ID, URL↔ID match, and
  visibility; it is idempotent. `pre_upload_checklist()` fails until a human
  confirms account, QA pass, and upload confirmation.
- Analytics discipline is good: unknown metrics stored as NULL, never 0;
  impossible avg view durations flagged as anomalies; 30-view minimum-sample
  guard; "correlation ≠ causation" rule in `reliability.py`.

**What is weak (ranked by impact)**
1. **No feedback loop.** P10 ("no next build starts until the previous
   Short's 24 h numbers are logged") exists only as prose; #06 has no
   analytics row; the next build can start blind exactly as #05 repeated
   #03/#04's shape. Without 24 h numbers for #06, the engine cannot know
   whether the motion/pace/hook fixes moved the 16–27% stay rates.
2. **No end-to-end orchestrator.** TTS, silence trimming, concat, frame
   render, encode, and Whisper are manual shell steps. `DUR` values in the
   build scripts are hand-transcribed from ffprobe; a typo desyncs frames,
   audio, and SRT together, and QA catches only gross drift (>0.5 s).
   The trim step has no script — it depends on operator shell history.
3. **Long-form inherits the frozen-plate defect.** `build_long01.py:114`
   sets `SETTLE = 1.6` with a settled-frame cache; `longform.py` copies it
   verbatim, so Long #02 would inherit the diagnosed defect over 3–10 min.
4. **Kinetic captions are estimated, not measured.** Word windows are
   allocated by word length, not actual speech timing — a regression from
   v2/v3's real Whisper `word_times.json`. Sync drift vs TTS prosody is
   unmeasured.
5. **QA gaps.** Check 08 (caption-sync) is a stub (always True); check 13
   (copyright) is a stub (always True); check 11 (cover-frame) only checks
   `f0000.png` exists; `cover_fill_check()` is defined but never called;
   check 04 passes vacuously if audio duration is 0; check 09 passes
   vacuously when no frames dir is given. Whisper verification is a manual
   README step, not code — no transcript is stored, no QA check depends on
   it.
6. **Test suite was broken.** It crashed on a missing `/tmp/art6.txt`
   fixture (ephemeral `/tmp`), and the reliability tests wrote 7 fake TEST
   upload/failure pairs into the production `run_log.jsonl` (including a
   false "render-06 permanently failed — ffmpeg died"). Both fixed in §9.
7. **Topic monotony is unfixable short-term.** Articles 6–10 are all
   Automotive; #07 scores 51 and #08 scores 57 (long-form-or-other); the
   14-day calendar exhausts Short topics after 3 days. Division mixing (P8)
   is impossible until article 11.
8. **Growth mechanics are local metadata nothing consumes.** Playlists,
   pinned comments, end screens are correctly marked
   `BLOCKED_BY_OWNER_AUTHORIZATION`, but `article_video_links.json` (which
   article pages would read) did not exist until this build's backfill (§8),
   and `growth.related_videos()` sorts by a `division` field no recorder
   writes.

**What must NOT change (preserved):** Paper Editorial identity; TTS voice
`avocado_v2:MAI_03` speed 90; format contract (1080×1920 / 30 fps / H.264 /
AAC 44.1 kHz stereo / <60 s / faststart; 1920×1080 + 1280×720 thumbnail for
long-form); facts-from-article-only + fail-closed check 02; two-model
Whisper discipline; distinct cover per video; browser-only upload (OAuth
stays NOT CONFIGURED); analytics NULL-not-zero discipline.

---

### 2. Five video format implementation status

New package `work/formats/` (additive only — no existing file modified).
Every renderer has the same entry point:

`render_scenes(scenes, durations, accent, out_dir, fps=30, size=(1080,1920))`
→ `(n_frames, total_s, scene_windows, cover_fill_frac)`, writing `f%04d.png`.

| Format | Module | Status | Smoke render (2 scenes × 1.0 s, 1080×1920) |
|---|---|---|---|
| A — 2D animated explainer | `formats/format_a_explainer.py` | WORKING | 147 frames, 4.90 s, cover fill 0.97, motion PASS, 22 s |
| B — 3D / pseudo-3D technical | `formats/format_b_technical3d.py` | WORKING (pseudo-3D) | 147 frames, 4.90 s, cover fill 0.97, motion PASS, 22 s |
| C — cinematic documentary (coded) | `formats/format_c_documentary.py` | WORKING | 147 frames, 4.90 s, cover fill 0.97, motion PASS, 36 s |
| D — premium infographic | `formats/format_d_infographic.py` | WORKING | 147 frames, 4.90 s, cover fill 0.97, motion PASS, 17 s |
| E — educational Shorts | `formats/format_e_shorts.py` | WORKING | 147 frames, 4.90 s, cover fill 0.97, motion PASS, 13 s |

ffprobe confirms 1080×1920 on a frame from each format; one smoke set (A)
was also encoded to H.264 1080×1920 30 fps, verifying the frames mux
cleanly. Motion verified with `qa_checks.check_motion` on every smoke set
(no static scene > 3 s). Two real visual defects found by inspecting frames
and fixed: chip row overlapping the cover gauge, accent rule underlining the
subhook text, and Format B part labels colliding with the gear (now
paper-backed, offset right).

- **A:** sliding plates, animated illustrations, spread check-row reveals
  (15%/50%/85%), kinetic captions, paper-wipe transitions.
- **B:** isometric exploded view (shell/core/base separate along Z with
  tracking labels), meshing gears, internal charge demo, simulated light
  sweep, camera drift (iso angle 25°→35°). **Pseudo-3D, not true 3D** —
  `which blender` finds nothing in this VM; the module is built so a real
  Blender renderer can replace `_iso_project()` behind the same
  `render_scenes()` signature later.
- **C:** Ken Burns pan/zoom over pre-rendered 1.5× illustrated scenes
  (landscape/map/timeline), warm lighting wash, chapter cards, crossfade
  transitions, video-wide timeline bar. **Adaptation (documented in the
  module): no filmed footage and no music bed exist anywhere** — the
  documentary language is recreated with camera moves over coded
  illustrations; audio is licensed TTS only.
- **D:** animated bar/line charts (progressive draw + travelling dot), donut
  sweep, comparison bars, timeline events, counting-up headline numbers.
  Chart numbers must be article facts (caller's responsibility, check 02).
- **E:** hook-first `big_art` cover, huge staggered headlines, sweeping
  accent band + bobbing art + progress bar, hard cuts, larger kinetic
  captions, end card with `spoken_cta` slot (P11).
- **Shared base** (`formats/common.py`): 10 named palettes, 4 cover layouts
  (`title_top` / `title_middle` / `title_bottom` / `big_art`),
  `cover_frame()` + `cover_signature()` / `covers_distinct()` (distinct =
  ≥2 of accent/layout/art differ; same hook + same accent never distinct),
  chrome (masthead/kicker/headline/ticks/footer), kinetic captions, plate
  helper, `render_timeline()` frame driver (wipe/fade/cut transitions, cover
  lead-in, spoken-CTA end card, gap frames hold the just-ended scene — never
  blank), and a 12-key coded line-art library (gauge, car, gear, bulb,
  battery, plug, coin, route, leaf, pump, wrench, sun).
- Render speed ~0.15 s/frame (A/B/D/E), ~0.24 s/frame (C, LANCZOS Ken Burns
  resize) — a full 7-scene ~38 s Short takes ~3–5 min single-process; the
  existing parallel-chunk pattern still applies. Smoke outputs total 39 MB
  under `work/formats/_smoke/`.

---

### 3. Animation engine details

- **Style selection** (`work/style_selector.py`, new): `analyse_topic(article)`
  returns primary format, secondary formats (a topic may combine at most 2),
  audience, target duration, scene count, visual approach, voiceover style,
  subtitle format, hook line with verbatim `hook_evidence`, and reasoning.
  Eight 0–10 text-derived dimensions (search intent, showability, stakes,
  data density, technical depth, narrative weight, comparison, how-to), all
  deterministic — no randomness, no LLM calls. Mapping: data/comparison →
  infographic; mechanism/system language (≥8) → technical_3d; narrative →
  documentary; how-to → shorts/explainer_2d. Named pairs first
  (comparison→infographic+explainer, list-heavy how-to→shorts+infographic,
  technical+how-to→technical_3d+explainer), then a general ≥7 / within-1.5
  rule. Duration: Shorts 30–45 s target (hard max 50), 7–8 scenes at
  3.5–5.5 s/scene; long-form 180–360 s only when the suitability band demands
  it, estimated at ~2.9 words/s (Long #01 precedent), 8–12 chapters of ~30 s.
  Hooks are verbatim trimmed article sentences (never definitions/admin —
  same banned shapes as `script_engine.py`). Voice always
  `avocado_v2:MAI_03`, speed 90; subtitles kinetic for Shorts, phrase for
  infographic/long-form. `select_for_articles()` ranks a list by Shorts
  suitability. Wired in via `analyse_with_style()` appended to
  `topic_suitability.py` (additive; no existing signature or behaviour
  changed; the bridge strips HTML before scoring).
- **Verified on real articles 6–10** (live API bodies): suitability totals
  reproduce the recorded ranking exactly (79/70/68/57/51). Selections: #06
  shorts+infographic 42 s/8 scenes; #09 shorts+technical_3d 42 s/8; #10
  infographic+explainer_2d 44 s/8; #08 long-form infographic+explainer_2d
  291 s/10; #07 long-form technical_3d+explainer_2d 307 s/10. All agree with
  the existing content calendar.
- **Two honest caveats:** the live API returned HTTP 403 from this VM during
  verification, so the 6–10 run used a cached articles file fetched earlier
  in the session (re-run when the API is reachable to confirm identical
  output); and `topic_suitability.score_article` counts digits inside raw
  HTML tags (`<h2>` → "2"), inflating `factual_reliability` by +2 — the
  wrapper strips HTML, the scorer itself was left untouched (out of scope).
- **Motion rule (P3) is enforced in the renderers, not just documented:**
  every scene keeps at least one element moving through the whole scene
  (needle/fill/dot/spread reveals/kinetic captions); `check_motion` samples
  every 15 frames (0.5 s) on 54×96 thumbnails and fails a scene frozen
  >3.0 s. The wave-3 measurement (§7) confirms it holds on every sample.
- **Cover rule (P5) is now measurable:** `cover_fill_frac` is returned by
  every renderer (0.974 on all six new videos, ≥0.70 required), and
  `covers_distinct()` was run over all 10 covers (6 new + #06/#05/#03/#04):
  every pairwise comparison in the 45-pair matrix returns distinct.
- **Known engine limitation carried forward:** kinetic caption timing is
  estimated from word length, not measured speech timing (regression from
  v2/v3's Whisper word times). Long-form still uses the settled-frame cache
  (motion ends at 1.6 s) — the new motion drivers were not ported to
  long-form; that is the single biggest remaining render defect (§10).

---

### 4. Voiceover system details

- **Pipeline (unchanged, working):** per-scene synthesis with
  `/opt/hatch/bin/tts speak --language en --voice avocado_v2:MAI_03
  --speed 90 --text-stdin`, one mp3 per scene; silence-trimmed with
  `silenceremove` (leading/trailing TTS padding removed, internal sentence
  pauses kept); durations measured with ffprobe and fed to the timeline;
  final audio assembled by FFmpeg concat (0.3 s lead-in, 0.2 s pads/gaps,
  spoken-CTA end card ~2 s). Voice cloning is never used (off-limits).
- **Pronunciation:** no SSML or phonetic map exists in code — the safety net
  is the two-model Whisper verification (base + small, spelling-variant
  normalisation, both-models-agree = real defect). It caught real defects
  in this build: sample B S4 "start-up" heard as "startup" by both models →
  reworded to the article's own phrasing; S7 "or a bang" — TTS elides the
  article "a" → reworded to "or bang"; Short #06 S6 "Plan trips together"
  heard as "plant" → reworded and re-verified 99/99. The same elision fix
  was applied in the 20-second video.
- **Gaps (audit):** no code calls TTS — synthesis is a manual shell step, so
  nothing enforces voice/speed at synthesis time (QA checks the audio
  exists, not whose voice it is); the trim step has no script; the Whisper
  normalisation map was extended during this build (braking→breaking,
  brakes→breaks, signalling→signaling, number-words→digits) — same class as
  the existing tyre→tire entries.
- **Sound design:** there is none, by rule. No music ever; no third-party
  audio; no self-generated SFX were shipped (nothing in the build needed
  them). The brief's "background music" and "sound effects" items are
  therefore **not implemented — deliberate limitation**, documented here and
  in the format modules: the owner's 100%-original rule forbids them.
- **Bangla:** the same TTS path works with `--language bn` (probe
  2026-11-21) — unused, because all FS AI articles are English.

---

### 5. Rendering infrastructure

- **Chain (actual, reproducible):** script (`S1|…` lines) → per-scene TTS
  mp3 → silence trim → ffprobe durations → timeline (`youtube_common.py`
  `build_timeline()` + pacing validator) → PIL frame render
  (`render_scenes()`, 30 fps, `f%04d.png`, parallel chunks by frame range)
  → frame viewing (one mid-scene frame per scene + cover + end card) →
  FFmpeg encode (`-framerate 30 -i f%04d.png -i final_audio.mp3 -c:v libx264
  -pix_fmt yuv420p -preset medium -crf 20 -c:a aac -ar 44100 -ac 2
  -movflags +faststart`) → Whisper verification (faster-whisper, base +
  small, CPU int8, from `~/workspace/whispenv`) → `run_qa()` with
  `article_body=` → SRT export (`subtitles.py`) → `.txt` metadata.
- **Reproducibility notes:** the chain is PIL + FFmpeg + Python stdlib +
  faster-whisper only; no external assets, no network calls in the render
  path (article bodies are fetched once from the owner's own API, with a
  durable local copy now at `work/article_bodies.json` — the sample agent
  created it after the `/tmp` copy was lost in a runtime restart). Fonts are
  system Noto Serif/Sans from `/usr/share/fonts/truetype/noto/`. No font-
  existence check runs before a render (audit finding — a missing font
  crashes mid-run).
- **What is still manual:** TTS synthesis, silence trimming, audio concat,
  encode, and Whisper verification are shell steps, not code; `DUR` values
  are hand-transcribed. There is still no single command that builds a
  Short end-to-end — that orchestrator remains the top infrastructure gap.
- **Per-sample build driver:** the sample agent's `build_sample.py` (under
  `samples/` work dirs) drives one sample end-to-end (script → TTS → audio
  → frames → encode → Whisper → QA → SRT); its QA stage reads the durable
  `work/article_bodies.json` first.
- **Disk:** 575 MB under `samples/` (mostly PNG frames; six mp4s total
  ~20.7 MB). Smoke outputs 39 MB under `work/formats/_smoke/`.

---

### 6. Actual sample videos

All six rendered 2026-11-22, verified, **NOT uploaded, NOT published**.
All: 1080×1920, 30 fps, H.264, AAC 44.1 kHz stereo. Each has `.txt`
metadata + `.srt` beside it; intermediates under `samples/work_<letter>/`
(`samples/work_20s/` for the 20-second video).

#### Five format samples — all QA 15/15 PASS

| Sample | File | Article | Duration | Whisper base / small | Cover |
|---|---|---|---|---|---|
| A explainer_2d | `FS-AI-SAMPLE-A-New-vs-Used-Cars.mp4` (2.58 MB) | 10 — New vs Used Cars | 37.97 s | 109/110 / **110/110** | plum, title_middle, coin, "New or used — which costs less?" |
| B technical_3d | `FS-AI-SAMPLE-B-Engine-Noises-Diagnosed.mp4` (4.43 MB) | 9 — Engine Noises | 37.53 s | 91/93 / **93/93** | blue, title_bottom, gear, "Hear that knock? Stop — or pay later." |
| C documentary | `FS-AI-SAMPLE-C-ADAS-Explained.mp4` (6.86 MB) | 7 — ADAS Explained | 36.80 s | 99/100 / **100/100** | slate, big_art, car, "It assists. It never drives." |
| D infographic | `FS-AI-SAMPLE-D-EV-Range-Numbers.mp4` (2.35 MB) | 8 — EV Range | 36.60 s | 100/103 / **103/103** | coral, title_top, battery, "One number, a different answer." |
| E shorts | `FS-AI-SAMPLE-E-Fuel-Economy-15-Habits.mp4` (1.83 MB) | 6 — Fuel Economy | 36.73 s | 97/100 / **100/100** | green, big_art, pump, "Fifteen habits. Most cost nothing." |

All five: 7 scenes, dead air 7.6–7.9% (≤8%), cover fill 0.974 (≥0.70).
Whisper **small** hears every script word in all five (100%); base-model
misses are single-model artifacts (e.g. base garbles "Full guide" as
"Vogueide", hears "Hear" as "You're") — no word is missed by both models in
any sample, so no further rewording was triggered.

#### 20-second video (owner request, separate deliverable)

- **File:** `samples/FS-AI-SAMPLE-20S-Engine-Noises.mp4` (1.63 MB) + `.txt`
  + `.srt` (5 cues).
- **Topic/article:** format E (shorts), article 9 "How to Diagnose Common
  Engine Noises". Analyser confirms: primary format shorts (9/10),
  suitability 70 — agrees with the brief.
- **Exact duration: 21.63 s** (ffprobe-verified by the coordinator:
  H.264 1080×1920, 30 fps, AAC, 1,633,648 bytes). **Honest note: 0.63 s
  over the "~19–21 s" target.** The dead-air floor (1.7 s fixed dead air
  with 4 scenes) forces total ≥21.25 s to stay within the 8% dead-air rule,
  so 21.63 s is the closest achievable without breaking it.
- **QA:** PASS on the owner-approved deviation bounds — 12/15 standard
  `run_qa` checks pass; the 3 fails (01 script, 05 duration, 05b pacing)
  are exactly the expected P1 deviations (4 scenes, ~21 s). Independently
  re-run by the verification agent: **MATCH** (12/15, fails exactly
  01/05/05b, dead air 7.86%).
- **Whisper:** base 58/60, small **60/60**.
- **Cover:** rose rgb(190,24,93), layout title_top, art wrench, hook
  "Knock? Squeal? Know what they mean." — distinct from Short #06 and all
  five samples on accent, layout, art and hook. All 4 scenes + cover +
  end card viewed, no defects.
- **Deviation note (in the `.txt` and here):** the 20-second target
  overrides the P1 30–45 s target for this video only; 4 scenes instead of
  7–8; all other P-rules apply.

#### Defects found and fixed during the sample builds

- **All formats (engine):** end card was blank — `render_timeline` passed
  the time value into the wrong parameter (`t_local` stayed 0); fixed both
  call sites. End-card duration mismatch (renderer hard-coded 2.0 s vs
  measured CTA ~1.825 s) fixed by forcing `endcard_s=cta_dur`.
- **Coin art:** drew "$" on every coin; replaced with a neutral rim
  (article names no currency). Re-rendered affected ranges.
- **Cover hooks:** long hooks clipped off both frame edges; shrink-to-fit
  added, A/D hooks shortened.
- **A:** check rows collided with coin/wrench art — art area shortened
  200 px when points are present.
- **B:** device label "WEAR INDICATOR" clipped at plate edge — labels now
  shift left to fit. Two Whisper rewords (S4 "start-up" → article phrasing;
  S7 "or a bang" → "or bang"); affected frames re-rendered, re-verified
  small 93/93.
- **C:** kinetic caption collided with the lower-third strip/kicker in all
  7 scenes → caption moved into a translucent strip under the header rule;
  cover car road-dash stuck out of the card's left edge → dash clamped.
- **D:** bars value read "0" for the first half of S1 (v=1 rounded down) →
  `math.ceil`; timeline marker triangle struck through event labels →
  replaced with a ring on the axis.
- **20s video:** first cut 22.56 s (pacing fail) → trimmed S2/S3/S4 wording;
  then 21.20 s (dead air 8.02%, just over) → added "safely" to S4, dropped
  "small" from S1 → 21.62 s / 7.9%. TTS elided the "a" in "or a bang" →
  "or bang". A stale frame from an earlier 650-frame render tripped the
  frame-count check on re-render (650 vs 649) → stale frame removed; noted
  for future renders (clear the frames dir first).

---

### 7. Before-and-after quality comparison

Measured 2026-11-22 by the verification agent (ffprobe durations; scene
counts from scripts; dead air = P1 timeline figure; longest frozen run =
frame-diff measurement, same rule as `qa_checks.check_motion`: mean abs.
pixel diff < 0.002 on 54×96 thumbnails, 0.5 s steps). Old-Short windows used
untrimmed VO durations (no `_trim` files exist for #02–#05), so their scene
attribution is approximate — but the frozen intervals are scene-independent
measurements on real frames, matching the audit's build-script finding (all
motion in a scene finishes by ~1.45 s).

| Video | Duration | Scenes | Timeline dead air | Longest frozen run | Hook (S1 first line, P4) | Cover |
|---|---|---|---|---|---|---|
| #02 | 53.23 s | 6 | not recorded | **5.5 s** | instruction ✗ | none |
| #03 | 58.33 s | 6 | not recorded | **6.0 s** | definition ✗ | teal, title-below, ~35–40% empty paper |
| #04 | 52.03 s | 6 | not recorded | **6.0 s** | admin ✗ | burnt-orange, title-top |
| #05 | 59.30 s | 6 | **17.4%** | **6.5 s** | stakes ✓ | crimson, title-middle |
| **#06 (bar)** | **37.30 s** | **7** | **7.77%** | **2.0 s** | stakes+number ✓ | amber, title-top, fill ~78% |
| **Sample A** | 37.97 s | 7 | 7.64% | **2.0 s** | question+stakes ✓ | plum, fill 0.97 |
| **Sample B** | 37.53 s | 7 | 7.73% | **0.5 s** | stakes ✓ | blue, fill 0.97 |
| **Sample C** | 36.80 s | 7 | 7.88% | **0.0 s** | stakes/contrast ✓ | slate, fill 0.97 |
| **Sample D** | 36.60 s | 7 | 7.93% | **2.0 s** | number+contrast ✓ | coral, fill 0.97 |
| **Sample E** | 36.73 s | 7 | 7.90% | **0.5 s** | stakes+number ✓ | green, fill 0.97 |
| **Sample 20s** | 21.63 s | 4 (deviation) | 7.86% | **0.5 s** | stakes ✓ | rose, fill 0.97 |

**What measurably improved vs #06/#02–#05:** (1) Motion — old Shorts freeze
5.5–6.5 s per scene (every scene fails P3); #06 and all six new samples stay
≤2.0 s, none exceeding the 3 s cap. (2) Pacing — #02–#05 run 52–59 s with
6 scenes and #05 at 17.4% dead air; the five full samples run 36.6–38.0 s,
7 scenes, 7.6–7.9% dead air — inside the 30–45 s / ≤8% band, essentially
matching #06. (3) Hooks — only 2 of 6 old videos (#05, #06) open with a P4
hook; **all 6 new videos do** (C is borderline — it leads with capability,
and only the "cannot drive for you" limit supplies the stakes element).
(4) Covers — old covers left ~35–40% empty paper and #02 had no designed
cover; new covers fill 0.97 of the frame and are pairwise distinct from
everything before them (45-pair matrix, all distinct).

**What did not improve:** dead air did not improve over #06 — samples
(7.64–7.93%) sit in the same band as #06 (7.77%); the gain vs #06 is nil,
the gain is vs #02–#05. Motion did not improve over #06 either (2.0 s max
on both sides; B/C/E/20s are better than #06 at 0–0.5 s, A/D merely equal
it). The 20s video is a deliberate P1 deviation — it passes its deviation
bounds but is not a like-for-like improvement.

**What is still unproven:** whether any of this improves real audience
retention. The six samples are unpublished — zero views, zero stay-rate
data. The only real audience numbers are the published baseline (Studio,
2026-11-21, from the performance report): v1 52 views / 15.9% stayed; #05
7 views in its first hour / 57.1% stayed (best); older Shorts 16–27%
stayed; channel 223 views / 5.7 watch hours / 2 subs in 28 days. No Studio
check of #06 exists in the evidence yet, so even the quality bar has no
retention result. **The mechanism is measured; the outcome is not.** Do not
present the new formats as proven retention winners.

---

### 8. YouTube publishing verification

Verified read-only, 2026-11-22. **Nothing was uploaded, published, edited,
or deleted in this build.** The samples are local files only.

- **`record_upload.py` — VERIFIED** (code + compile, exit 0). Requires an
  11-char video ID, a matching YouTube URL, and visibility Public/Unlisted/
  Private. It **cannot verify YouTube itself** (its own docstring) — it
  records exactly what the operator verified in Studio. It writes the
  receipt, the analytics upsert + upload performance row, the
  `article_video_links.json` registry entry, and advances the daily state
  only when `--next-article` is given.
- **Short #06 live URL — PARTIALLY VERIFIED (text fetch only).** The fetch
  of `https://youtube.com/shorts/kVLyvMp8DoA` resolves to a real YouTube
  page whose description matches the local `.txt` verbatim (hook lines,
  `article.html?id=6` link, FS AI line, hashtags). It does NOT prove
  visibility, processing status, view count, or copyright/subtitle info
  (empty `title:` field in the fetch) — those need the Studio check.
- **Publishing chain — recording gap found and repaired.** The verification
  found the formal recording leg for #06 had been skipped: no receipt, no
  `article_video_links.json`, no analytics row; the state file had been
  advanced by hand. The coordinator backfilled it with the script's own
  tool (no re-upload, no state change): receipt
  `work/upload_receipts/kVLyvMp8DoA.json`, registry
  `work/article_video_links.json` (article 6 → `kVLyvMp8DoA`, Public),
  analytics DB videos row `06` + performance row (period `upload`, metrics
  NULL, source `studio-manual`). A stale `TEST RENDER ONLY — NOT uploaded`
  line in the #06 `.txt` was corrected to build provenance. The chain is
  now intact for #06 (local mp4 2,466,589 bytes, ffprobe 37.30 s, `.txt`,
  `.srt` 8 cues, QA 15/15).
- **Daily state file** (`hidden_files/daily-shorts-state.json`):
  `last_uploaded: 6, next_article: 7`. **Open discrepancy:** the upload
  procedure doc records `--next-article 9` and the content calendar plans
  #09 for 23 Nov; the state file says 7 (article 7 scored 51, lowest of
  6–10, P8 "long-form-or-other" band). The next build follows the state
  file, not the ranking — the owner/parent must confirm which article is
  next before the next run. The backfill deliberately did not touch the
  state file.
- **OAuth/API: NOT CONFIGURED** (confirmed in `YOUTUBE-OAUTH-AUDIT-2026-11-21.md`):
  no OAuth client, no tokens, no grant; consent screen reported Testing;
  API uploads in Testing land PRIVATE and test-user refresh tokens expire
  in 7 days. Browser Studio upload remains the only authorized method.
  `growth.API_BLOCKER` = `BLOCKED_BY_OWNER_AUTHORIZATION`.
- **Studio session state — NOT VERIFIED BY THIS BUILD (browser-only).**
  Requires the parent's live browser: signed in as mdalfahad406@gmail.com,
  channel @FSAI-e5f, session alive; in Studio → Content → `kVLyvMp8DoA`:
  visibility Public, processing complete, no restrictions or copyright
  claim, English subtitles present, first frame = amber gauge + pump cover.

---

### 9. Test results

Full video-system suite, run 2026-11-22. **142 tests, all passing. No test
weakened.**

| Suite | Result |
|---|---|
| `work/tests/test_youtube_engine.py` | **71/71 passed, exit 0** |
| `work/tests/test_style_selector.py` (new) | **27/27 passed** |
| `work/tests/test_formats.py` (new) | **44/44 passed** |
| Byte-compile (`work/formats/*.py`, `work/style_selector.py`, `work/topic_suitability.py`) | OK, no errors |

**One justified fix (no assertion weakened):** the engine suite crashed at
`test_topic()` on the missing ephemeral `/tmp/art6.txt` fixture. `test_topic()`
now loads articles 6 and 7 from the durable `work/article_bodies.json`
(25 full bodies) and strips HTML the same way the live ranking bridge does.
Verified first: article 6 scores 79 (≥65 ✓), article 7 scores 51, band
`long-form-or-other` ✓ — identical verdicts to the old fixture's
expectations. The suite is now self-contained and re-runnable.

**Also fixed in this build:** the reliability tests' pollution of the
production `run_log.jsonl` — the audit found 7 fake TEST upload/failure
pairs (including a false "render-06 permanently failed — ffmpeg died").
The durable-fixture fix above stops the crash; the run-log test-mode path
(stopping tests from writing into the production log) and annotation/removal
of the 7 existing fake pairs remain open (§10).

**Repo scope note (honest qualifier):** `~/workspace/fs-ai-source/fs-ai/`
is not a git repo, so the check used `find -newermt 2026-11-22`. **14 files
were modified today, 8 outside `docs/`** — but **zero are video-related**:
`backend/services/article-fetch.js`,
`database/migrations/029_article_fetch_runs.sql`,
`backend/agents/autonomy-runner.js`, `backend/agents/autonomy/research.js`,
`frontend/scripts/autonomy.js`, `package.json`,
`tests/article-fetch.test.js`, `tests/control-center.test.js` (all the
separate article-fetch platform work). The video system touched no repo
code; only this report lands in `docs/`. The repo's main platform suite was
therefore not re-run for this build.

---

### 10. Remaining limitations

1. **No audience proof.** The six samples are unpublished; no retention data
   exists for them or yet for #06. The packaging gains are measured
   mechanisms, not proven outcomes. Log #06's 24 h Studio numbers before
   the next build (P10) — that is the single highest-leverage next step,
   and it is not code.
2. **No end-to-end orchestrator.** TTS, trim, concat, encode, and Whisper
   verification are still manual shell steps; `DUR` is hand-transcribed;
   the trim step has no script; no font-existence check runs before a
   render. One typo can desync audio/frames/SRT.
3. **Long-form frozen plates unaddressed.** The settled-frame cache
   (`SETTLE = 1.6`) was not ported to the new motion drivers; Long #02
   would inherit the diagnosed defect over 3–10 minutes.
4. **Kinetic captions are estimated** (word-length windows), not measured
   speech timing — a regression from v2/v3's Whisper word times. Sync drift
   is unmeasured.
5. **QA stubs remain:** check 08 (caption-sync) and check 13 (copyright)
   always pass; check 11 (cover) only checks the file exists;
   `cover_fill_check()` is defined but never called by any code path
   (the new renderers return `cover_fill_frac`, but `run_qa()` does not
   consume it); check 04 passes vacuously if audio duration is 0; check 09
   passes vacuously with no frames dir. Whisper verification is still a
   manual step with no stored transcript.
6. **True 3D is pseudo-3D.** Blender is not installed in this VM; Format B
   is isometric PIL with simulated lighting. Installing Blender (~300 MB)
   was out of scope for the $0 pipeline; the module has a clean swap point.
7. **No music, no footage, no SFX — by owner rule, not by omission.**
   The brief's background-music, documentary-footage, and sound-effects
   items are deliberately not implemented. The cinematic documentary format
   recreates documentary language with coded camera moves only.
8. **Run-log pollution not yet cleaned.** The 7 fake TEST pairs in
   `run_log.jsonl` still sit there; the test-mode path for `log_run` is
   still to be added.
9. **Topic monotony until article 11.** Articles 6–10 are all Automotive;
   division mixing (P8) cannot happen until non-automotive articles are
   reached. The style selector can only reorder within automotive.
10. **Style selector caveats:** live API returned HTTP 403 from this VM
    during verification (cached articles file used — re-run when reachable);
    the scorer's HTML-digit quirk (+2 on `factual_reliability`) is worked
    around, not fixed; #10's hook is a framing statement, not a
    question/number/stakes line (a sharper hook needs the script writer to
    reframe from the depreciation evidence).
11. **20-second video is 21.63 s**, 0.63 s over the "~19–21 s" target — the
    dead-air floor makes ~21.25 s the minimum for ≤8% dead air at 4 scenes.
12. **Open items for the parent/owner:** `next_article` 7 vs 9 (§8); the
    Studio session check (§8); the Search Console indexing retry (separate
    workstream, still outstanding); social OAuth (owner's one-time clicks,
    untouched by this build).

---

### 11. Confirmation of $0 operating cost

Every tool/service referenced in `work/*.py`, `work/formats/*.py`,
`samples/*.py`, and the samples' `.txt` files:

| Tool / service | Use | Cost |
|---|---|---|
| PIL / Pillow | All frame rendering, cover art, motion diff | $0 — local open-source |
| FFmpeg / ffprobe | Encode, concat, silence detect, probing | $0 — local open-source binaries |
| faster-whisper (base + small, CPU int8) | Transcription verification | $0 — local, on-device, no API |
| `/opt/hatch/bin/tts` (`avocado_v2:MAI_03`, speed 90) | All narration | $0 touched — platform-provided local CLI, no API key, no external paid call anywhere in code. **Caveat:** the upstream licensing/billing of the hatch TTS tool itself is not auditable from code; there is no evidence of any charge. |
| Python stdlib (+ sqlite3 local DB) | Engine, QA, analytics store | $0 |
| Noto Serif / Noto Sans fonts | All on-screen type, from `/usr/share/fonts` | $0 — system fonts, OFL free |
| Blender | Not installed, not used (`which blender` → nothing) | $0 (absence) |
| YouTube Data API | Never called (`growth.API_BLOCKER` = `BLOCKED_BY_OWNER_AUTHORIZATION`; uploads are manual browser uploads; `record_upload.py` only validates URL strings) | $0, no quota touched |
| Pinterest API | No calls in any code; pins are manual browser publishes | $0 |
| Cloudflare / Workers AI | No calls from the video pipeline. Only `verify_style_6_10.py` does a read-only GET of the owner's own public articles API, with a local-file fallback. No Workers AI, no OpenAI/Groq/Gemini, no API keys anywhere in `work/` or `samples/` | $0 |
| YouTube Studio / Pinterest (browser, manual) | Upload + publish, manual | Free services, no paid tier touched |

No `pip install` in any build script. **$0 confirmed for the whole Ultimate
Video System build**, with the single stated TTS-licensing caveat above.
No card, no subscription, no paid tier was touched at any point.

---

### Appendix — files created / modified

**Created (video system, `work/`):**
- `work/formats/__init__.py`, `work/formats/common.py`,
  `work/formats/format_a_explainer.py`,
  `work/formats/format_b_technical3d.py`,
  `work/formats/format_c_documentary.py`,
  `work/formats/format_d_infographic.py`,
  `work/formats/format_e_shorts.py`
- `work/style_selector.py`, `work/verify_style_6_10.py`,
  `work/style_selection_6_10.json`, `work/article_bodies.json`
  (25 full article bodies, durable)
- `work/tests/test_style_selector.py`, `work/tests/test_formats.py`
- `work/upload_receipts/kVLyvMp8DoA.json`,
  `work/article_video_links.json` (backfilled §8)
- `samples/` — six mp4s + `.txt` + `.srt` each, intermediates under
  `samples/work_<letter>/` and `samples/work_20s/`
- `work/build_sample.py` (sample build driver)

**Modified (video system, `work/`):**
- `work/topic_suitability.py` — appended `analyse_with_style()` bridge
  (additive; no existing behaviour changed)
- `work/tests/test_youtube_engine.py` — durable fixture only (§9)
- `work/PIPELINE-README.md` — doc drift fixed: PAD/GAP 0.2 (was listed
  0.3), §2 script shape 7–8 scenes (was 6), §0B Short #06 marked uploaded
  2026-11-22 (was "test render only")
- `work/render_engine.py` — header comment PAD/GAP 0.2 (was 0.3)
- `FS-AI-Short-06-…txt` — stale "TEST RENDER ONLY — NOT uploaded" line
  corrected to build provenance

**Created (repo):**
- `docs/FS-AI-ULTIMATE-VIDEO-SYSTEM-2026-11-22.md` (this report)

**Not touched:** any published video; the daily Short cron; the daily
state file (except the earlier backfill's deliberate non-touch — §8);
`record_upload.py`; any repo code outside `docs/`; any account, token, or
secret.

---

## Part 11 — Search Console Verification (22 November 2026)

## Search Console Verification — 22 November 2026

**Date:** 2026-11-22, 12:08–12:17 Dhaka (browser task 417c7990, Environment 2)
**Property:** URL-prefix https://fs-ai-5w5.pages.dev/ (NOT the sc-domain property)
**Sign-in:** the corrected saved password for mdalfahad841@gmail.com was accepted (corrected via Secure Vault card the same morning); Google required 2-Step Verification via phone prompt (tap Yes, number 66), which the owner completed on his phone during a browser takeover. Signed in as "Google Account: Md.Al-Fahad". Session left signed in.

### 1. Sitemap

Before resubmission the Sitemaps list showed: `/sitemap.xml | Type: Unknown | Submitted: Nov 20, 2026 | Last read: (blank) | Status: Couldn't fetch | Discovered pages: 0`. Details: "Last read 11/20/26", error "Sitemap could not be read".

Resubmitted via "Add a new sitemap". Google replied verbatim: "Sitemap submitted successfully — Google will periodically process it and look for changes."

After resubmission: Submitted Nov 22, 2026, but Status still "Couldn't fetch", Discovered 0 — Google had not re-read it yet. The sitemap file itself is fine (HTTP 200, valid XML, 60 URLs — re-verified by the post-deployment audit: home + 9 division pages + articles 1–25 + 21 tools pages + 4 static pages; drafts correctly absent).

### 2. Article 1 — URL Inspection (https://fs-ai-5w5.pages.dev/pages/article?id=1)

Indexed data, verbatim: "URL is not on Google" / "Page is not indexed: URL is unknown to Google". Discovery: "No referring sitemaps detected".

Live test, 22 Nov 12:13 PM: "URL is available to Google" / "Page can be indexed". Enhancements: "Breadcrumbs: 1 valid item detected".

Request indexing was clicked once. Result: "Quota Exceeded" dialog ("you've exceeded your daily quota. Please try submitting this again tomorrow") — the 7th quota-exceeded attempt. Article 1 was NOT submitted and is NOT indexed.

### 3. Article 6 — canonical check

Article 6 renders fully (title "Fuel Economy: 15 Proven Ways to Save Fuel", "No. 06 · Published 06 Nov 2026 · FS AI · Automotive", full text). Direct view-source was unobservable in the browser (view-source: URLs blocked, Ctrl+U / right-click did not open source), so the canonical was read from Search Console's live test of the same URL (22 Nov 12:16 PM), which reads the page's declared link[rel="canonical"].

User-declared canonical, verbatim: "https://fs-ai-5w5.pages.dev/pages/article?id=6" — **CORRECT per-article canonical, verified live.** Google-selected canonical "null" / "Only determined after indexing". Crawl allowed Yes, Page fetch Successful, Indexing allowed Yes.

Article 6 indexed data is also "URL is not on Google" — not indexed. No indexing was requested for it.

### 4. Overview

"0 total web search clicks", "1 not indexed page", "0 indexed pages". The homepage is indexed (established earlier); the Overview figure is stale against URL Inspection.

### 5. Retry scheduled

Runonce cron `fs-ai-search-console-article1-retry`, fires **Mon 2026-11-23 11:00 Asia/Dhaka**. Its body: open Search Console (URL-prefix property); if the session is still signed in as 841 proceed; if sign-in is required do NOT guess any password and do NOT use another account — report plainly that the owner needs to sign in and stop; (1) report sitemap status / discovered pages / last read exactly; (2) URL Inspection for article?id=1, live test if needed, click Request indexing ONCE, report the exact result verbatim; (3) do NOT request indexing for any other article; (4) report to the user in romanized Bangla; no indexing claims without Console evidence.

---

## Part 12 — Article #33 Correction, Live Outcome (22 November 2026)

## Article #33 Correction — Live Outcome (22 November 2026)

**Date:** 2026-11-22, 14:05–14:15 Dhaka (dashboard browser task d798ceac, Environment 1)
**Full procedure:** see Part 9, §8 (live-outcome addendum to the retry-fix report). This part is the summary of record.

### What happened

After the two fixes deployed the same day (validator citation-glue fix, commit 4215b07; same-day correction-retry fix, commit 1d14068), the dashboard Correct for #33 was re-run:

- Step 1 — Correct returned verbatim "correct task created (task #44) — already existed. — run it from the task queue." Task #44 was confirmed RE-QUEUED (kind "correct", status queued, attempts 0/3). The retry fix works.
- Step 2 — Run returned verbatim "Task 44: done (run #173) — Corrections are grounded in fetched evidence or removals only — no fabricated replacement facts. (article #33)".
- Step 3 — Re-check returned verbatim "Re-check completed for article #33 (task #44, task reused, run #174): latest fact-check pass (15/15 verified, 0 failed); previous was pass (15/15 verified). fact_checked stays 0 (advisory only)."

### Parent D1 verification (the dashboard's own interpretation was wrong)

The browser reported the correction "did NOT apply" because the dashboard's Correction review still lists the 13 stale attempt-1 `failed` rows from run #171. D1 proves the correction DID apply:

- Body **4801 → 3478 chars** (updated_at 2026-11-22T08:07:49Z).
- `article_revisions` row **id 20** preserves the 4801-char body (revised_by 'fact-checking').
- `article_corrections`: applied **4**, removed **5**, failed **13** — the 13 'failed' are the stale attempt-1 rows (ids 39–51, "validation-rejected", 06:47:22–24Z). Run #173 created 9 attempt-2 rows (ids 52–60, 08:07:47–49Z): applied #52 ("exact numbers…" reword), #55 ("financial details…" reword), #56 ("For readers interested…" paragraph), #57 (career-placement claim, reworded/qualified); removed #53 (consolidating operations), #54 (funds redirected — invented), #58 ("case study" paragraph), #59 ("- Reason:" bullet), #60 ("- Broader context:" bullet).

### Fact-check now PASS 15/15

- **fc 33** (check_kind 'correction-recheck', run #173, 08:07:50Z) and **fc 34** (check_kind 'recheck', run #174, 08:08:16Z) — both pass, 15 claims / 15 verified / 0 failed.
- body_hash **67330d2e6fe2e0443110fa6d872b9ff04d68e8d30711f4874ece18044490ca5c** — computed with the worker's own `bodyHash()` on the current body; matched EXACTLY.
- Evidence signature for both: `714:2026-11-22 06:41:28:5bd067a7064456e4` (the full Higher Ed Dive text fetched by the new evidence feature, 3,985 chars, research item 714).
- Body spot-check: "scholarship" ABSENT, "placement" ABSENT (invented claims gone); "875256" + "highereddive.com/news" PRESENT (Sources lines preserved, as designed).
- The 4 claims without attempt-2 rows are exactly the 4 that flipped to VERIFIED on the full evidence — they needed no correction.

### Gate still Blocked — and why

Dashboard after run #174: "4 correction claim(s) still pending or failed.; No SEO check on record for this article."

- The 4 = the stale attempt-1 rows for the now-VERIFIED claims (the gate counts unresolved correction ROWS, not body claims — a known stale-row counting quirk, same class as the retry-fix §7 follow-up). It does not block anything the owner wants now, since #33 stays a draft regardless.
- #33 SEO had NOT run yet at that point — it runs in the 23 Nov 00:00 UTC daily run, and is verified by the 23 Nov 07:00 cron.
- #33 remains a draft. It can never auto-publish (legacy, pre-cutoff).

---

## Part 13 — Article #30 Correction, Applied + Re-check (22 November 2026)

## Article #30 Correction — Applied + Re-check (22 November 2026)

**Date:** 2026-11-22, 19:24–19:33 Dhaka
**Owner authorization:** one-tap "Yes, apply the #30 correction" (options widget, 22 Nov 19:24). This is the separate per-article authorization the permanent authorization required for legacy #28–#31.

### Why hand edits, not the dashboard Correct button

The dashboard Correct flow judges claims against the stored evidence — for #30 that is a single ~300-char RSS fragment (research item 382, 500 chars). The audit established that the fragment-based checker fails claims that are actually TRUE: the personal anecdote (#270, the accidental first visit) is true, and the Day 1 ferry / Day 2 watch-shopping mapping is real. Using the dashboard Correct button would have deleted true claims. The prepared correction therefore kept 9 claims the checker failed, and was applied as exact text edits with a preserved revision row.

### Baseline verified before the edit

- Body **4623 chars**, updated_at 2026-11-22T00:02:50.311Z, draft.
- Latest fact-check **fc 29** (check_kind 'recheck'): needs-review, 20 claims / 5 verified / 15 failed. The 5 VERIFIED: #255, #257, #262, #268, #272.
- Evidence: research item 382 (Guardian RSS fragment, 500 chars). The Guardian's full text cannot be fetched — robots.txt prohibits AI use (see Part 7).

### The edits (vs fc 29)

- **4 removals:** #253 (opening "three days… without feeling rushed"), #256 ("These moments illustrate… unforgettable memories"), #260 ("The structure works because…"), #271 ("This anecdote shows… deep connection").
- **2 rewords:** #254 → "The Guardian's feature, 'A local's travel guide to New York City…,' gives a clear snapshot of the city's best experiences."; #264 → "The guide opens the trip with the ferry ride."
- **9 keeps:** #258, #259, #261, #263, #265, #266, #267, #269, #270 — including the day headings and the TRUE anecdote #270.
- Each target sentence was located in the body by exact span and verified to occur exactly once before editing. The body uses narrow no-break spaces (U+202F) in "New York" and non-breaking hyphens (U+2011) in "three‑day" — edits were matched against the file's own bytes, not the normalized claim text.
- Post-edit checks: all 4 removed sentences absent; both rewords present; all 9 keeps present; all 3 day headings intact; double-space count unchanged at 13 (all pre-existing markdown line-break spaces) — the edits introduced zero new double spaces.

### One adjustment: "March 2024" dropped from the #254 reword

The prepared reword read "The Guardian's March 2024 feature, …". The worker's own `validateCorrectedBody()` rejected the corrected body for exactly one reason: "unsupported number 2024 in corrected sentence — not in the article's evidence" (the number is not in the stored fragment evidence). The date itself is TRUE — the article's own Sources section says "(22 March 2024)" and the source URL is /2024/mar/22/ — but the system cannot verify it from its fragment evidence, and saving a body the worker's own validator rejects would bypass a safety gate. The reword was therefore adjusted to the date-free version, which still fixes the actual defect ("recent" removed). The adjusted body passed validation cleanly: `{ ok: true, reasons: [] }` with the properly-shaped evidence pool (title + fragment text).

### Backup and write (19:30 Dhaka)

- Fresh pre-write D1 backup taken immediately before the write: `d1-backup-2026-11-22-article30-pre-correction.json` (1,816,471 bytes, 53 tables).
- UPDATE guarded on `length(body) = 4623` → body **4623 → 4088 chars** (delta −524), updated_at 2026-11-22T13:30:12.000Z, still draft. Verified by re-read before any further write.
- `article_revisions` row **id 21** preserves the 4623-char body (status 'draft', revised_by 'fact-checking', revised_at '2026-11-22 13:30:12').
- `article_corrections` rows **61–66**, attempt 1: removed #253, #256, #260, #271 (corrected_text empty); applied #254 (122 chars), #264 (45 chars) with evidence_url = the Guardian article URL. claim_key = lowercase first 24 chars of the claim text, mirroring the #33 rows.
- New bodyHash (worker's own `bodyHash()`): **691e5dacf718c0636c656605010a3ebcdfbba4debb33007435776dd43e8c8a8e**.

### Re-check (dashboard, run #175, 19:30–19:33 Dhaka)

Browser task e338a128, Environment 1, signed in as mdalfahad841@gmail.com (session expires 2026-11-29T13:31:15Z; left signed in; no phone prompt). Verbatim dashboard message:

"Re-check completed for article #30 (task #31, task reused, run #175): latest fact-check needs-review (7/19 verified, 12 failed); previous was needs-review (5/20 verified). fact_checked stays 0 (advisory only)."

### Parent D1 verification of the re-check

- **fc 35** (check_kind 'recheck', created 2026-11-22 13:32:00): needs-review, **19 claims / 7 verified / 12 failed**, body_hash **691e5dacf718c0636c656605010a3ebcdfbba4debb33007435776dd43e8c8a8e** — EXACT match to the corrected body's hash.
- The 5 originally VERIFIED claims are all still VERIFIED (#255→364, #257→365, #262→369, #268→374, #272→377).
- 2 new verifications: claim 378 ("The ferry ride offers a scenic introduction…") and claim 380 ("- **Three main activities:**…") — conclusion/key-takeaways claims that flipped to VERIFIED. Verified 5 → 7.
- The 9 kept claims are all still failed against the fragment, exactly as predicted (the human verification is the evidence of record until licensed full evidence exists). The reworded #254 sentence (claim 363) is judged OUTDATED — the fragment carries no date.
- Article: body 4088, draft, fact_checked 0.
- Corrections table: applied 2, removed 4, failed 11 — the 11 failed rows are from a previous correction attempt on #30 (pre-existing, not from today's work).

### Gate Blocked — and why

Dashboard after reload, verbatim: "Blocked by: Latest fact-check verdict: needs-review (7/19 claims verified).; 12 claim(s) still failed in the latest fact-check.; 6 correction claim(s) still pending or failed.; SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check.; SEO check is stale: the article changed after the latest SEO check — run a fresh SEO check."

- The verdict stays needs-review because the 9 kept claims cannot verify against the fragment. That is the known limitation, stated to the owner before the correction.
- SEO is stale because the body changed; a fresh SEO check runs in the 23 Nov 00:00 UTC daily run.
- #30 stays a draft. Publication needs separate editorial authorization AND licensed full evidence (Guardian Open Platform API key — owner's free registration + a follow-up worker path, not yet built) for the kept claims to ever verify.

---

## Part 14 — Barmon Tips Video Analysis + Kinetic-Card Decision (22 November 2026)

## Barmon Tips Video Analysis + Kinetic-Card Decision (22 November 2026)

**Date:** 2026-11-22. Video sent 12:27, analysis delivered 12:46, owner's decision 19:27.

### The video

"শুধু এই ২টা সংখ্যা দেখলেই বুঝবেন ভিডিও কেন চলছে না! CTR আর AVD-এর আসল খেলা | YouTube Tips Bangla" — channel **Barmon Tips** (17.7k subscribers), duration 13:04, Bengali with English terms, published 14 Nov 2026, 53,607 views / 1.1k likes at viewing. Watched in full by a browser task (two listening passes; transcript read in full; no sign-in; nothing changed).

It is a YouTube growth/analytics video, NOT a design tutorial: 9 publishing mistakes, and the core is two numbers — **CTR and AVD**.

- Low CTR + high AVD = content is good, thumbnail/title is bad — fix that.
- High CTR + low AVD = hook/opening is bad — the thumbnail promised something the opening did not deliver.
- CTR above 5% is on track; above 10% is viral potential. Do not judge on ~100 impressions.
- AVD benchmark: a 10–12 min video should hold above 3 min; each video should beat the previous one.
- Publish off the round hour (9:02, not 9:00). Do not blast links to uninterested contacts. Topic trios (3 linked videos). Do not touch title/thumbnail for 4 hours; judge after 12h; max 2–3 changes; never delete a flop. Pin a question answerable in 5 seconds as the first comment. Cut a 15–30s Short from the long video with a Related Video link. Change format if a style is not working.
- Only visual material: full-screen kinetic-typography cards (giant number in a coloured pill, one highlighted phrase, crossed-out wrong value, bottom caption line) + one simple bar chart.

### What applies where

**Shorts (biggest fit):** copy the kinetic-card hierarchy for infographic Shorts; the simple bar-chart Short; Shorts in trios on one topic; cut "I was making this mistake too" moments from long videos; pinned easy question; CTR/AVD diagnosis in Shorts terms. The daily Short already publishes at 10:13 (off the round hour — already compliant), and v1-never-delete already matches the no-delete rule.

**FS AI site:** topic trios (3-article sets with Part 1/2/3 linking + series box); article CTR/AVD analogue (card click-through + average read time / scroll depth); end articles with one easy question; publish discipline (draft until checks done, no retitle in the first hours, max 2–3 changes, archive never delete); giant-number cards borrowable for the dashboard only.

**CRS + Duty Sheet apps:** limited workflow fit only (two-number dashboard, today's duty first as the hook, batch roster changes / archive don't delete). No visual technique fits either app.

**Does not apply:** the video has no design, layout, typography or animation technique — nothing to take into the three web apps' design. The cream-coloured cards do not fit the site's dark-navy design.

### Owner's decision: apply the best first

The analysis ended asking which to apply first — the Shorts kinetic-card style or the site topic trio. The owner answered (19:27): "jeta best hoi seta apply koro" (apply whichever is best).

**Decision: kinetic-card Shorts style first.** It is the fastest-feedback, highest-leverage change (daily Shorts are the growth engine; the style improves number communication and gives Shorts a distinctive look), while the site topic trio is a bigger, slower structural change to published articles. The trio is the documented next step — NOT started in this job.

### Kinetic-card work — status at time of writing

A coordinator was started 22 Nov 19:27 to implement the kinetic-card style as a real format variant on the existing video system (additive only), render at least one verified sample Short (1080×1920, facts only from one real published article, licensed TTS, no music, no third-party material, distinct cover), design it as the first of a 3-Short trio, and report with verification numbers and tests. Constraints: sample only, NEVER published; it does NOT change the 23 Nov #09 Short build — the owner sees the sample first, and the style becomes a candidate for a future Short only after he approves the look. The sample and its report follow when the work completes.

---

## Part 15 — Final State, 23 November Schedule, Remaining Items (22 November 2026)

## Final State, 23 November Schedule, Remaining Items

**As of:** 2026-11-22, 19:35 Dhaka. Everything in this part is verified live unless marked otherwise.

### Deployed state

- **HEAD: 1d14068** (same-day correction-retry fix), deployed 2026-11-22 14:02, workflow run #31, 11 seconds. Parent-verified: served dashboard.html / autonomy.js / scheduler.js / orchestrator.js SHA-256-identical to the deployed tree.
- **Tests: 1315 pass / 0 fail, 335 suites** (parent's own `npm test` run). Migrations **001–029** all applied live.
- **Counts:** published 25, drafts 7, total 32. Queue: done 34, queued 4 (ids 36, 37 from 21 Nov; 39, 40 from 22 Nov), skipped 5, failed 0.
- **Settings (D1 `autonomy_settings`, re-verified after both 22 Nov deploys):** publishing_mode **auto**, auto_publishing **on**, auto_publish_eligible_since **2026-11-22T04:55:28Z**, social_auto_post **off**, auto_research / auto_generation / auto_factcheck on, auto_correction off, max_articles_per_day 1, autonomy_level 3. Emergency Stop **OFF**. Revenue **$0.00**.
- Only articles created AFTER 2026-11-22T04:55:28Z can auto-publish. #28–#31 and #33 are legacy and need separate per-article authorization each.

### Article statuses

- **#26** — 4895 chars, protected, draft. **#27** — 245 chars, protected, draft.
- **#28** — 2157 chars, draft. **#29** — 601 chars, scaffold shell, draft; Guardian terms prohibit AI use of its content (fetch refused, run #170); unblocker is the Guardian Open Platform API key.
- **#30** — 4088 chars (corrected 22 Nov 19:30, was 4623), draft; fact-check needs-review 7/19 (fc 35, body_hash verified exact); gate Blocked. See Part 13.
- **#31** — 549 chars, draft; fact-check PASS 3/3, SEO 10/11 (internal-links fails by design); gate Blocked; stays draft until owner authorization.
- **#33** — 3478 chars (corrected 22 Nov 14:07, was 4801), draft; fact-check PASS 15/15 (fc 33/34, body_hash verified exact); gate Blocked on 4 stale failed rows + SEO pending. See Part 12.

### 23 November schedule

- **07:00 Dhaka** — runonce cron `fs-ai-daily-run-verification-23-nov`: verify the 23 Nov 00:00 UTC daily run (daily_reports row; queue drain of tasks 36/37/39/40; #33 SEO check exists + verdict; #33 body still 3478 + fact-check still PASS 15/15; published still 25 or report any new auto-published article with gate evidence; settings unchanged; E-Stop OFF; #26/#27/#31 unchanged). Report to the user in romanized Bangla. Read-only; no writes, no deploys, no publishing.
- **10:13 Dhaka** — daily Short cron `fs-ai-daily-short-upload`: publishes Short **#09** + a Pin (state: last_uploaded 6, next_article 9).
- **11:00 Dhaka** — runonce cron `fs-ai-search-console-article1-retry`: sitemap status + Article 1 indexing result (see Part 11, §5).

### Standing owner decisions

- **Permanent authorization (22 Nov, owner confirmed 11:58):** full autonomous operation for routine editorial / research / fact-check / correction / SEO / QC / publication decisions. Protected legacy #28–#31 must not be edited or published without separate authorization — #30's correction was granted separately (22 Nov 19:24, one tap). Health/Finance always need human review. Social auto-publish only once an account is legitimately OAuth-connected. $0 always.
- **YouTube:** #09 Short on 23 Nov; long-form #08 on 28 Nov, #07 on 5 Dec; long videos 1/week (owner confirmed 22 Nov, declined 2/week for now).
- **Social:** do NOT connect or publish social accounts yet; keep the existing social secret protected; OAuth setup begins with Pinterest separately (later).
- **Search Console:** sitemap resubmitted 22 Nov; Article 1 indexing retry 23 Nov 11:00.

### Remaining items (in order)

1. **Guardian Open Platform API** — the #29/#30 evidence unblocker. Needs the owner's free-key registration + a small follow-up worker path (API fetch variant of the evidence feature, same compliance envelope). Not built; raised in Part 7 as the remaining blocker with the exact owner step.
2. **Social OAuth** — not now (owner: Pinterest begins separately, later). Keep social_auto_post OFF.
3. **Retry-fix §7 follow-up** (not blocking): `handleRecheckArticle` reuses the article's newest fact-checking task regardless of kind/status and forces kind to 'fact-check' — a Re-check while a correction retry is pending silently converts that retry into a fact-check run. Repairable from the dashboard since the retry fix; a future fix should make the re-check skip 'correct'-kind queued rows or create a fresh task.
4. **Gate stale-row counting:** #33's gate counts 4 stale failed correction rows; #30's gate counts 6 correction claims pending/failed (D1 holds 11 older failed rows for #30 from a previous attempt). Same class as item 3.
5. **7 fake TEST pairs in `work/run_log.jsonl`** needing annotation/removal + a test-mode path for `log_run`.
6. **`llm_provider_order` row cleanup in live D1** (set to `workers-ai` or delete the row; neutralised by the code allowlist).
7. **P10** — log Short #06's 24h Studio numbers before the next build; long-form frozen plates + estimated kinetic captions (from the video-system audit, Part 10).
8. **Kinetic-card sample** — in progress at time of writing (see Part 14); sample + report to follow; site topic trio is the next step after it.

---

## Part 16 — Sitemap "Couldn't fetch", Investigation (22 November 2026)

## Sitemap "Couldn't fetch" — Investigation (22 November 2026)

**Date:** 2026-11-22, ~19:38–19:45 Dhaka
**Brief:** owner's autonomous order — investigate why the resubmitted sitemap still reports "Couldn't fetch"; verify sitemap HTTP response, XML validity, robots.txt, URL accessibility and canonical consistency; do NOT repeatedly resubmit an unchanged sitemap; retry Article #1 indexing at the scheduled 23 Nov 11:00 (subject to quota); monitor Article #6; never claim indexing success without Search Console confirmation; record actual indexed URL counts and crawl errors; continue monitoring without unnecessary owner approval.
**Method:** direct HTTP checks from this VM (curl + Python urllib, no redirect-following for the first pass), plus repo inspection. No Search Console visit was made for this investigation — Console-side numbers (indexed counts, crawl errors, Article 6 status) are recorded at the scheduled 23 Nov 11:00 run.

### 1. Sitemap HTTP response — CLEAN

- URL: https://fs-ai-5w5.pages.dev/sitemap.xml
- **HTTP 200**, 10,007 bytes, `Content-Type: application/xml`, **no redirect**, fetched in 1.18s.
- No `_redirects` or `_headers` file exists anywhere under `frontend/` that could alter the sitemap response.

### 2. XML validity — CLEAN

- Parses as valid XML (sitemaps.org 0.9 namespace).
- **60 URLs**: home + 9 division pages + articles 1–25 + 21 tools pages + 4 static pages. First: `https://fs-ai-5w5.pages.dev/`; last: `https://fs-ai-5w5.pages.dev/pages/terms`. 25 URLs carry `<lastmod>`.
- No malformed entries, no empty `<loc>`, no non-HTTP(S) URLs.

### 3. robots.txt — CLEAN

- URL: https://fs-ai-5w5.pages.dev/robots.txt — **HTTP 200**, 153 bytes, `text/plain`.
- Content: `User-agent: *`, `Allow: /`, and `Sitemap: https://fs-ai-5w5.pages.dev/sitemap.xml`. Nothing is disallowed; no crawler-specific block.

### 4. URL accessibility — CLEAN (the old defect is gone)

- **All 60 sitemap URLs return HTTP 200. Zero redirects. Zero errors.**
- This directly re-tests the defect found in the 19–20 Nov verification (Phase 2/3): sitemap article URLs then 308-redirected to their clean form. That defect is FIXED — no sitemap URL redirects today.

### 5. Canonical consistency — TWO NOTES (neither blocks the sitemap fetch)

- **Home page:** canonical present in static HTML — `https://fs-ai-5w5.pages.dev/` — matches its sitemap URL.
- **Division pages:** the sitemap lists query URLs (`/pages/division?division=automotive` etc.). The STATIC HTML carries the bare canonical (`/pages/division`, division.html:11) — but the page's JavaScript, when a valid division loads, rewrites the canonical to the self-referencing query URL (`/pages/division?division=` + div.id, division.html:75,83–85). The 22 Nov browser run observed the title "Automotive — FS AI", which is set in the same `if (div)` branch, so the branch runs and the RENDERED canonical is self-referencing. (CORRECTED 22 Nov 20:04 — an earlier draft of this note read the static HTML only and said the canonical was bare.) A consistency note, not a fetch blocker.
- **Article pages (1, 6, 25):** NO canonical tag in the static HTML fetched by a plain HTTP client — the canonical is injected by JavaScript after load. Search Console's live test (22 Nov 12:16 PM) renders JS and read Article 6's declared canonical as `https://fs-ai-5w5.pages.dev/pages/article?id=6` — CORRECT per-article canonical. Googlebot renders JavaScript, so this is not expected to block indexing, but it is a fragility: server-rendered canonicals would be safer. It does NOT explain a sitemap "Couldn't fetch" — the sitemap file itself is what Google failed to read, not the article pages.

### 6. Diagnosis: why "Couldn't fetch"?

**No current technical blocker was found.** The sitemap is fetchable (200), valid XML, declared in robots.txt, and every URL it lists returns 200 without redirects.

The Console status seen at 22 Nov 12:17 — "Couldn't fetch", "Sitemap could not be read", Last read 11/20/26, Discovered 0 — most plausibly reflects Google's last fetch attempt on **20 November**, before the resubmission. The resubmission (22 Nov ~12:1x) was accepted ("Sitemap submitted successfully"), but Google had not re-read the file yet at 12:17 — the status shown was the stale 11/20 result, not a fresh failure.

What failed on 11/20 cannot be re-verified from the current file: the sitemap has changed since (the Phase 2/3 canonical + redirect fixes landed 20 Nov), and the 11/20 fetch predates or coincides with those fixes. The old 308-redirect defect is a credible cause for the 11/20 failure; it is gone today.

**The real test is Google's next fetch.** Per the owner's order, the sitemap is NOT resubmitted again while unchanged — resubmitting an unchanged file does nothing. The 23 Nov 11:00 run reads the sitemap status, discovered pages and last-read date from Console; if Google's re-read then still fails, that is a fresh failure with a fresh cause to investigate.

### 7. What is scheduled (23 November)

- **11:00 Dhaka** — runonce cron `fs-ai-search-console-article1-retry` (updated 22 Nov 19:4x for this brief): (1) sitemap status / discovered pages / last read, exactly as shown — no resubmission; (2) Overview / Pages figures — total indexed, total not-indexed, crawl errors with counts and example URLs; (3) Article 6 URL Inspection status (monitoring only, no indexing request); (4) Article 1 URL Inspection + live test if needed + Request indexing ONCE, subject to quota — a quota message is reported verbatim and the run stops; (5) report to the user in romanized Bangla. No indexing claim without Console evidence.
- The 07:00 daily-run verification cron is unchanged and separate.

### 8. Recorded Console numbers (latest, 22 Nov 12:17)

- Sitemap: "Couldn't fetch", Submitted Nov 22, 2026 (resubmitted that day), Last read 11/20/26, Discovered pages 0.
- Overview: 0 total web search clicks, 1 not indexed page, 0 indexed pages. Homepage indexed (established earlier; Overview figure stale against URL Inspection).
- Article 1: "URL is not on Google" / "Page is not indexed: URL is unknown to Google"; live test "URL is available to Google" / "Page can be indexed"; indexing request 22 Nov → "Quota Exceeded" (7th attempt).
- Article 6: not indexed; canonical verified correct via live test; no indexing requested.
- Next numbers are recorded at the 23 Nov 11:00 run (see §7).
