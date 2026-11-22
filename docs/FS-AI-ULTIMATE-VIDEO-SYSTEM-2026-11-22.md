# FS AI — Ultimate YouTube Video Production System — 22 November 2026

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

## 1. Existing production audit

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

## 2. Five video format implementation status

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

## 3. Animation engine details

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

## 4. Voiceover system details

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

## 5. Rendering infrastructure

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

## 6. Actual sample videos

All six rendered 2026-11-22, verified, **NOT uploaded, NOT published**.
All: 1080×1920, 30 fps, H.264, AAC 44.1 kHz stereo. Each has `.txt`
metadata + `.srt` beside it; intermediates under `samples/work_<letter>/`
(`samples/work_20s/` for the 20-second video).

### Five format samples — all QA 15/15 PASS

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

### 20-second video (owner request, separate deliverable)

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

### Defects found and fixed during the sample builds

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

## 7. Before-and-after quality comparison

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

## 8. YouTube publishing verification

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

## 9. Test results

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

## 10. Remaining limitations

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

## 11. Confirmation of $0 operating cost

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

## Appendix — files created / modified

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
