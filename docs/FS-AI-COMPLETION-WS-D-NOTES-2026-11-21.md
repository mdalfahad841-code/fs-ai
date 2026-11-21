# FS AI Completion — Workstream D Notes (YouTube Autonomous Growth System)

**Date:** 2026-11-21 · **Owner:** Workstream D (subagent, depth 2) · **Status:** implemented
and locally tested; test render NOT uploaded, NOT published.

## Standing rules honoured

- Paper Editorial / Field Guide identity PRESERVED (no rebrand).
- 100% original coded motion graphics, own article facts, licensed TTS
  `avocado_v2:MAI_03` (bn/en, speed 90 only), NO music, NO face, NO
  third-party clips/footage/audio, NO topic intro, only necessary videos.
- Shorts carry a designed cover frame (no uploaded thumbnail — not possible
  for Shorts). No published video file touched, modified or deleted. No test
  video published without owner authorization (the #06 render is local-only).
- $0 always; Workers AI only where inference is needed; no OpenAI/Groq/
  Gemini/paid TTS/research/hosting. No keys/passwords exposed.
- READ-ONLY on live D1 (SELECT only). No D1 writes, no live migrations
  applied, no deploy/push, no browser access, no uploads, no publishing.
- The daily Short pipeline runs locally and is UNAFFECTED by the worker
  deploy tonight: the deploy changes the Cloudflare Worker, not the local
  video build. The weekly run firing on new worker code does not change the
  video path. The ~10:13 Dhaka daily schedule and the 19:00–21:00 posting
  test remain proposals only (P9 — owner approval required).

## Authorization override (owner, 2026-11-21 14:12) — recorded

Deploy is authorized TONIGHT, before the 22 Nov 06:00 weekly run (which will
fire on the NEW code). Permanent restrictions recorded here:

- $0 always.
- NEVER publish #28/#29/#30/#31 without separate editorial authorization each.
- Health/Finance always need special human review.
- Never claim a social account connected or a post/video published without verification.
- Auto-publishing only for NEW articles passing EVERY gate, one-per-day limit + E-Stop preserved; existing drafts excluded.
- Never bypass platform policies/OAuth; YouTube Data API stays DO-NOT-USE
  while the consent screen is in Testing (uploads would land PRIVATE);
  browser-based upload flow stays.

## Deployment procedure inputs (from Workstream D, for the parent)

- **Migration file:** `database/migrations/028_youtube_analytics.sql` — NEW,
  verified free (migrations on disk run 001–023; 024–027 are also free, but
  this workstream owns 028). It adds three tables ONLY
  (`youtube_videos`, `youtube_performance`, `youtube_anomalies`) plus two
  indexes. It touches no existing table and no article/protected record.
  Apply order: after 027 (`027_social_token_refresh.sql`), as the latest
  migration — migrations on disk run 001–028 contiguously (024–027 were
  added by other workstreams during this run; 028 remains the highest
  number and is owned by this workstream). Standard `db:migrate` flow. **File only — this
  workstream did NOT apply it; the parent applies it at deploy time.**
- **Env secrets:** NONE from Workstream D. No new secret, token, API key or
  credential is needed: the analytics store is fed by manual Studio import,
  and live YouTube API collection is blocked (no OAuth exists). There are
  NO `set` commands to run for this workstream. Do NOT create a YouTube API
  key / OAuth client for this deploy.
- **Code changed in the backend tree:** NONE except the one migration file
  above. All engine code lives in the goal workspace
  (`fs-ai-youtube-videos/work/`), not in `~/workspace/fs-ai-source/fs-ai/`.
- **Rollback notes:** if 028 must be reverted, run:
  `DROP TABLE youtube_performance; DROP TABLE youtube_videos; DROP TABLE youtube_anomalies;`
  No other object depends on them; no data migration is involved (tables
  start empty; the local SQLite store keeps the seeded history). Rolling
  back 028 does not affect the video pipeline, which reads the local
  `work/youtube_analytics.db`, not D1.
- **Post-deploy verification (this area):**
  1. Confirm migration 028 applied: `SELECT name FROM sqlite_master WHERE
     type='table' AND name LIKE 'youtube_%';` must list the three tables.
  2. Confirm NO article/protected record changed: article count still 25
     published, #26/#27/#28/#29/#30/#31 statuses unchanged (drafts stay draft).
  3. Confirm the worker still serves `/api/articles` (the video pipeline's
     topic source) and the dashboard loads.
  4. Confirm NO YouTube API connection appears anywhere (dashboard YouTube
     panel must still read "Browser session — verified manually before each
     upload" / "Not API-connected").
  5. The weekly run (22 Nov 06:00 Dhaka) must NOT touch the video path:
     verify after the run that no video file, script, or analytics row was
     created/modified by the worker.

## Per-phase status

| Phase | Status | Evidence |
|---|---|---|
| 1 Audit / gap report | IMPLEMENTED_AND_TESTED | `work/YOUTUBE-GAP-REPORT-2026-11-21.md` — every P1–P12 rule checked against executable code; none implemented in old builders |
| 2 Intelligent topic selection | IMPLEMENTED_AND_TESTED | `work/topic_suitability.py` + `work/topic_ranking_2026-11-21.json`; tests 43/43. Ranking: #06 79 good, #09 70 good, #10 68 good, #08 57 long-form-or-other, #07 51 long-form-or-other |
| 3 Shorts-first scripts | IMPLEMENTED_AND_TESTED | `work/script_engine.py`; validator rejects #03 definition opening, intros, admin openings, >50 s; #06 script PASS (89 words, 7 scenes) |
| 4 Motion graphics engine | IMPLEMENTED_AND_TESTED | `work/render_engine.py` + `work/build_video_short06.py`; motion validator PASS (no static scene >3 s) on the #06 render |
| 5 Pacing / retention | IMPLEMENTED_AND_TESTED | `youtube_common.check_pacing`; #06: 36.64 s, 7 scenes 3.99–5.25 s, dead air 7.9% ≤8% |
| 6 Covers | IMPLEMENTED_AND_TESTED | `render_engine.render_cover_generic` + fixed `build_bg()` (corner-circle ornament removed — the P5 clip fix); #06 cover amber #B45309, measured content fill ~78% of frame height (test `test_cover_fill` asserts ≥70% + clean masthead zone) |
| 7 SEO engine | IMPLEMENTED_AND_TESTED | `work/seo_engine.py`; #06 title "15 Ways to Save Fuel (That Actually Work)" 41 chars, no "\| FS AI"; 4 hashtags, no #FSAI; description hook-first + guide link |
| 8 Growth | IMPLEMENTED_NOT_LIVE_VERIFIED (local parts) / BLOCKED_BY_OWNER_AUTHORIZATION (API parts) | `work/growth.py`: series metadata, article↔video links, UTM tracking implemented locally. Playlists via API, pinned comments, end screens: BLOCKED — no YouTube Data API connection; consent screen in Testing (uploads would land PRIVATE). Owner one-time OAuth + Production consent screen required. |
| 9 Long-form | IMPLEMENTED_NOT_LIVE_VERIFIED | `work/longform.py` (scaffold + thumbnail + QA) + `growth.longform_checklist/make_chapters/longform_metadata`. No second long video rendered yet. |
| 10 Analytics feedback engine | IMPLEMENTED_AND_TESTED | `work/analytics_store.py` + `work/youtube_analytics.db` seeded with real Studio numbers; 3 impossible avg-view-durations flagged as anomalies (v4 15:07 vs 0:52, #03 14:05 vs 0:59, #04 12:02 vs 0:53) and excluded from optimisation; #05 stay rate 57.1% gated by minimum-sample rule (n=7 < 30). Live API collection BLOCKED_BY_OWNER_AUTHORIZATION (no OAuth, consent screen in Testing); manual/CSV import path implemented. Migration 028 = D1 mirror, file only. |
| 11 Improvement loop | IMPLEMENTED_AND_TESTED | `work/reliability.py` IMPROVEMENT_RULES + `improvement_actions_for()`; future videos only; correlation ≠ causation encoded; never rewrite/re-upload published videos |
| 12 Scheduling | IMPLEMENTED_NOT_LIVE_VERIFIED | `qa_checks.pre_upload_checklist()` implemented; daily ~10:13 Dhaka schedule preserved; 19:00–21:00 test is a proposal only (owner approval required — cron untouched) |
| 13 QA (14 checks) | IMPLEMENTED_AND_TESTED | `work/qa_checks.py`; #06 render QA result in `work/qa_short06.json` (see test-render section) |
| 14 Reliability | IMPLEMENTED_AND_TESTED | `youtube_common.retry_with_backoff` (bounded, exponential, max 3) + `reliability.py` (hash+title duplicate prevention, missing-frame resume, stale-output detection, permanent-failure records, credential alerts, JSONL run log `work/run_log.jsonl`); tests 43/43 |
| 15 Test render (Short #06) | IMPLEMENTED_AND_TESTED | See test-render section below |

## Key findings recorded during the build

1. **README §0A's PAD/GAP 0.3 cannot meet its own ≤8% dead-air cap.**
   7 scenes at PAD/GAP 0.3 cost 0.3 + 7×0.3 + 6×0.3 = 4.2 s = 10.4% of a
   40 s video. The 8% cap is the binding retention rule, so the engine uses
   PAD/GAP 0.2 (dead air 2.9 s = 7.9% of 36.64 s). Recorded in
   `youtube_common.py` and tested (`test_pacing`).
2. **TTS clips carry ~0.4–0.6 s of leading/trailing silence each.**
   The first #06 audio assembly measured 29.3% silence by silencedetect
   (11.2 s of 38.1 s) even though the timeline dead air was 7.6%. Fix:
   clips are now silence-trimmed (leading/trailing only, internal sentence
   pauses kept) before the timeline is built; the QA silence check is
   diagnostic only — P1 dead air is the TIMELINE figure, enforced by the
   pacing gate. Two real bugs found and fixed in `qa_checks.py` during this
   (missing `codec_type` in ffprobe entries made audio/resolution checks
   fail vacuously; `run_qa` did not pass `endcard_s`/`spoken_cta_s` to the
   pacing gate).
3. **A render-engine bug was found and fixed by the test render:**
   `slide_highlight` received an ImageDraw where the new signature expected
   an image (`AttributeError`), crashing the S2 render range. Fixed to draw
   a sliding solid accent bar via the Draw object; missing frames
   (141–571) were re-rendered via `reliability.missing_frames` resume.
   Lesson recorded: the engine's tests now cover the S2 art path
   (frame-level, via the motion validator).
4. **D1 read quirk (for the parent):** the `d1_query.py query-sql` call
   400s when the SELECT names a column that does not exist (e.g. `division`
   — the articles table has `division_id`). `SELECT 1` and correct-column
   queries work. Article data for scoring was fetched read-only from D1
   (ids 6–12 verified: all Automotive, published) and cross-checked against
   the public articles API.
5. **Stay-rate evidence (Studio §8):** #05 57.1% stayed is the best on the
   channel but on n=7 views — direction only, no optimisation decision
   (minimum-sample guard, 30 views). Older Shorts 15.9–26.5%. The #06 hook
   ("Burning fuel you don't need?") follows the #05 stakes-first pattern.

## Test render — Short #06 (article 6, "Fuel Economy: 15 Proven Ways to Save Fuel")

- Files: `FS-AI-Short-06-Fuel-Economy-15-Ways-to-Save-Fuel.mp4` (2.47 MB),
  `.txt` metadata, `work/build_video_short06.py`, `work/script_short06.txt`,
  `work/vo_S*_short06_trim.mp3`, `work/vo_CTA_short06_trim.mp3`,
  `work/final_audio_short06.mp3`, `work/frames_short06/` (1,119 frames),
  `work/qa_short06.json`.
- Spec: 7 scenes, 95 words, narration 32.57 s, total 37.30 s, dead air 7.8%,
  1080×1920 30 fps H.264 AAC 44.1 kHz stereo.
- QA: **15/15 PASS** (`work/qa_short06.json`) — script, facts, audio, A/V
  sync (video 37.30 s / audio 37.29 s), duration, resolution, aspect ratio,
  caption sync, frames complete (1,119), silence diagnostic (longest single
  0.66 s), cover frame, metadata, copyright, pacing, motion (no static scene
  >3 s).
- Whisper verification (final mp4 audio, faster-whisper, normalised incl.
  `tyre`→`tire` and `15`→`fifteen` numeral spellings): **base 99/99,
  small 99/99** — every script + CTA word matched. One real defect was found
  and fixed by the both-models rule: "Plan trips together" was heard as
  "plant" by BOTH models, so S6 was reworded to "Combine errands into one
  trip…" (article language), re-synthesised (S6 4.803 → 5.464 s), re-rendered
  and re-verified.
- Frame inspection: cover (f0000) — E/F clear of the gauge arc, pump reads
  as a pump, chip row present, fill ~78%, "ARTICLE 6" unclipped; S2/S6
  mid-scene frames — kinetic captions show spoken ink / current word accent /
  upcoming pale grey, check rows spread across the scene, route dot and road
  dashes visibly mid-motion; end card (f1100) — "Full guide below." +
  "Subscribe for the next guide." + URL + tagline.
- Cover fix history: the first render's cover filled only ~67% (the same
  P5 defect as #03–#05) and its E/F labels sat on the gauge arc. Fixed in
  `render_engine.render_cover_generic` (chip row + footer pushed content to
  ~78%; new `test_cover_fill` test asserts ≥70% + a clean masthead zone)
  and in the #06 cover art (E/F inset inside the arc, proper pump with hose
  + nozzle). Frames re-rendered, QA + Whisper re-run after the fix.
- **NOT uploaded, NOT published.** Local test only, per the brief.

## Proposed backend changes (proposals, NOT edits)

1. **Apply migration 028 at deploy** (see deployment inputs above). No
   other backend change from this workstream.
2. **Article-page video links (for the coordinator/backend workstream):**
   `work/article_video_links.json` is the link registry the article pages
   should consume (article → Short URL + UTM tracking URL). The video
   pipeline cannot add the link to the article page itself — that is a
   backend/frontend change, proposed here, not made.
3. **Future (needs owner authorization, NOT proposed for this deploy):**
   YouTube Data API connection (OAuth + consent screen to Production) to
   enable live analytics pull, API playlists, pinned comments and end
   screens. Until then those items stay BLOCKED_BY_OWNER_AUTHORIZATION.
   Posting-time test (19:00–21:00 Dhaka, one week) needs separate owner
   approval before any cron change.

## File references (goal workspace)

- `fs-ai-youtube-videos/work/YOUTUBE-GAP-REPORT-2026-11-21.md`
- `fs-ai-youtube-videos/work/youtube_common.py`, `topic_suitability.py`,
  `script_engine.py`, `seo_engine.py`, `render_engine.py`, `qa_checks.py`,
  `analytics_store.py`, `reliability.py`, `growth.py`, `longform.py`
- `fs-ai-youtube-videos/work/topic_ranking_2026-11-21.json`
- `fs-ai-youtube-videos/work/youtube_analytics.db`, `run_log.jsonl`,
  `qa_short06.json`
- `fs-ai-youtube-videos/work/tests/test_youtube_engine.py` — run:
  `python3 work/tests/test_youtube_engine.py` (43/43 pass; no pytest installed)
- `fs-ai-youtube-videos/work/build_video_short06.py`, `script_short06.txt`,
  `frames_short06/`, `FS-AI-Short-06-Fuel-Economy-15-Ways-to-Save-Fuel.mp4` (+ `.txt`)
- `fs-ai-youtube-videos/work/PIPELINE-README.md` §0B (new-engine summary)
- Migration: `~/workspace/fs-ai-source/fs-ai/database/migrations/028_youtube_analytics.sql`

## Tests

- `python3 work/tests/test_youtube_engine.py` → **43/43 passed** (pacing,
  retry bounds, script validator incl. old-opening rejections, SEO, topic
  scoring, analytics anomaly + sample guard + NULL rule, duplicate
  prevention, missing-frame detection, permanent-failure records, growth
  blockers, long-form checklist/chapters, improvement-loop rule, cover fill
  ≥70% + clean masthead zone).
- `python3 -m py_compile` clean on all new/changed modules.
- Full FS AI test suite NOT run (another workstream owns it, per the brief).
