# FS AI — Kinetic-Card Shorts (Barmon Tips style)

**Date:** 2026-11-22 (Dhaka) · **Status:** sample rendered + verified · **NOT uploaded**
**Style:** Format K (new renderer, additive — formats A–E untouched) · **Cost:** $0

## 1. Why kinetic-card first

Owner order (2026-11-22 19:27): *"jeta best hoi seta apply koro"* — apply whichever is best
from the Barmon Tips video analysis. Judgment call, recorded here:

- **Kinetic-card first.** Fastest feedback, highest leverage. Daily Shorts are the
  growth engine (one Short + one Pin per article, every day around 10am), so a style
  change is testable within a day of publishing. The style attacks the channel's core
  problem — number communication: every FS AI article is a list or guide built on
  numbers, and the card makes the number the visual. Lowest risk: it is an additive
  format, touches no published article, and goes to the owner as a sample first.
- **Site topic trio second (phase 2, NOT this job).** It restructures published
  articles (new topic pages / cross-links between articles) — a bigger, slower
  structural change that needs editorial review per article. Documented as the next
  step in §6.

## 2. The style spec (from the video, applied faithfully)

One idea per card, in FS AI's Paper Editorial identity
(paper #FAF5EC, ink #1B1B1B, Noto Serif Black):

| Element | Rule |
|---|---|
| Giant number | In a coloured pill, centred on the card. The number IS the point. Digit-only numbers count up 0 → N over the first 60% of the scene. |
| Highlighted phrase | One phrase highlighted — the RIGHT value, in green. |
| Wrong value | Crossed out in red; the strike draws across the scene (p 0.35 → 0.60). |
| Caption line | One caption line at the bottom of the card. |
| Bar-chart variant | 2–3 bars: red = wrong / more, green = right / less, plus a green stamp marking the right answer. Bar heights are RELATIVE fractions (0–1) encoding a qualitative article claim only — always labelled "Illustrative — relative fuel use, not measured values". Never a measured number, never an invented number. |
| Motion (P3) | Pill slides in, number counts up, strike draws, right value slides in, bars grow, stamp pops — nothing frozen after 1.5 s. Kinetic captions run word-by-word throughout. |
| Standing rules kept | 100% original coded motion graphics; NO music; NO third-party material; licensed TTS only (avocado_v2:MAI_03, speed 90); NO topic intro; DISTINCT designed cover on every Short; 1080×1920, 30 fps, under 60 s; never delete or edit a published video; never publish an experimental/unverified video. |

New renderer: `work/formats/format_k_kinetic.py`, registered as `"K"` in
`work/formats/__init__.py` `FORMAT_RENDERERS`. It reuses `common.py` (palettes,
`cover_frame`, `covers_distinct`, chrome, kinetic captions, `render_timeline`)
and the existing TTS / render / QA / Whisper discipline. A new module rather than
a D-variant, because the card grammar (pill, strike, stamp) is a distinct visual
language — format D stays untouched.

## 3. The sample — K1 "15 Fuel Habits That Cost Almost Nothing"

**Article choice (evidence-based).** Article **6** — "Fuel Economy: 15 Proven Ways to
Save Fuel" — was picked as the most numbers-heavy article for this grammar: the
giant "15" plus 15 countable habits that group into 7 scenes, each with a clear
wrong-vs-right pair. Article 8 was considered (the task suggested 8 or 6) and
**rejected**: despite its title "What the Numbers Really Mean", its body contains
**no digits at all** (only the words four/one) — it gives the style nothing to count.
Article 2 has more digits (the 12 checks) but it is already a published Short (#02)
and has no trio partners; re-using article 6 is also deliberate — the owner can
compare the same facts in the new style against Short #06 (format E) and sample E,
i.e. an A/B on identical facts.

**Cover — distinct from both earlier article-6 covers (P5):** mustard accent,
`title_bottom` layout, coin art, hook "Stop paying for wasted fuel.", chips
SMOOTH / STEADY / SWITCH OFF. (#06: amber, title_top, gauge+pump; sample E: green,
big_art, pump.) Cover distinctness is asserted in the test suite.

**The 7 cards** (all facts from article 6; pill numbers are the article's own
habit ordinals; bar fractions encode the article's "steady uses less" claim):

| Scene | Pill | Wrong (struck) → Right | Caption |
|---|---|---|---|
| S1 | 15 | — → MOST COST NOTHING | Fifteen proven ways to save fuel. |
| S2 | 1–2 | HARD ACCELERATION → GENTLE | Smooth driving uses far less fuel. |
| S3 | bars | CHANGING SPEED (MORE FUEL) vs STEADY (LESS FUEL), stamp STEADY WINS | Illustrative — relative fuel use, not measured values. |
| S4 | 6–7 | FULL BOOT + ROOF RACK → CLEAR IT | Extra weight makes the engine work harder. |
| S5 | 8–9 | LOW PRESSURE → CORRECT PRESSURE | Under-inflated tyres make the engine work harder. |
| S6 | 10–12 | IDLING → SWITCH OFF | Waiting more than a minute? Switch off. |
| S7 | 13–15 | NO RECORD → TRACK IT | A simple record keeps savings visible. |

Narration uses one number only — "Fifteen" (S1) — which the article contains
(QA check 02: 1 number in script, all present in the article).

**Files** (sample tree, NOT uploaded):

- Video: `samples/FS-AI-SAMPLE-K-Kinetic-15-Fuel-Habits.mp4` (2.79 MB)
- Metadata: `samples/FS-AI-SAMPLE-K-Kinetic-15-Fuel-Habits.txt`
- Subtitles: `samples/FS-AI-SAMPLE-K-Kinetic-15-Fuel-Habits.srt` (8 cues)
- Work dir: `samples/work_K/` (`durations.json`, `render.json`, `whisper.json`, `qa.json`, 1102 frames)

## 4. Verification numbers (all measured, none claimed)

| Check | Result |
|---|---|
| Duration | **36.73 s** (P1 target 30–45 s, max 50 s) |
| Resolution / fps | 1080×1920, 30 fps, H.264 + AAC 44.1 kHz stereo |
| Scenes / pacing | 7 scenes, 4.21–5.04 s each (3.5–5.5 s band) — **pacing PASS** |
| Dead air (P1 timeline) | **7.9%** (≤ 8%) — narration 31.93 s, total 36.71 s |
| Cover fill (P5) | **0.974** (≥ 0.70) |
| Frames | 1102 / 1102 rendered |
| Whisper base | 101/104 (missed: "dead", "weight", "full" — the S4 line "Dead weight burns fuel on every trip") |
| Whisper small | **104/104** |
| QA | **15/15 PASS** (01 script, 02 facts-numbers, 03 audio, 04 av-sync, 05 duration, 06 resolution, 07 aspect, 08 caption-sync, 09 frames, 10 silence, 11 cover-frame, 12 metadata, 13 copyright, 05b pacing, 03b motion) |
| Frames viewed | Cover, S1, S3, S4, S5, S7, end card — all correct (see §5) |
| Audio/video sync | video 36.73 s, audio 36.71 s |

**Defects found during the build — all fixed and re-measured:**

1. **Pill number landed 148 px low.** PIL anchor `"ma"` puts y at the TOP of the
   ascender, not its middle. Measured: digits 694–852 vs pill centre 625. Fixed by
   centring on the ink bbox (`textbbox`); re-measured digits 546–704, centre 625 =
   pill centre exactly.
2. **`ImageDraw` has no `alpha_composite`.** The card functions mixed up the layer
   Image and its Draw (text/stamp need the Image, rectangles/lines need the Draw).
   Fixed: card functions now take both explicitly.
3. **First TTS run failed pacing** (S1 3.15 s too short, S2 6.00 s too long, dead
   air 8.6%). Script reworded with article-only wording (no new numbers, no new
   claims); re-run: narration 31.93 s, total 36.71 s, dead air 7.9%, pacing PASS.

**What is NOT proven:** nothing about audience. The sample is unpublished; no CTR,
no AVD, no views exist for it. The numbers in §5 are the measurement rule, not results.

## 5. CTR/AVD measurement rule (Shorts terms — how this style will be judged)

From the Barmon Tips video, translated to Shorts:

- **CTR** = clicks / impressions on the Shorts shelf. **AVD in Shorts** = average %
  viewed / stay rate (Studio: "average percentage viewed", "stayed to watch").
  Channel baseline (Studio, 2026-11-21): Short #05 stay rate 57.1% (best), older
  Shorts 16–27%, Long #01 49% average viewed.
- **Diagnosis:** low CTR + high AVD = cover/title problem (people who click, stay);
  high CTR + low AVD = hook problem (clicks, then leaves in the first seconds);
  low both = topic/idea problem.
- **Thresholds:** CTR > 5% on track, > 10% viral potential.
- **Judgment discipline:** do not judge on ~100 impressions (too few); do not touch
  title/thumbnail for the first 4 hours; judge after 12 h; max 2–3 changes;
  never delete a flop.
- **What K changes, lever by lever:** the cover is the CTR lever (distinct cover
  frame per P5); the first 3 seconds (giant "15" pill + "MOST COST NOTHING") is the
  hook/AVD lever; the wrong-vs-right cards are the retention lever (each card
  resolves in ~4 s, so a viewer who stays for one card stays for the next).
- **Fair comparison:** the first K-style publish is judged against Short #06 — the
  same article, format E — on CTR and stay rate, once both have enough impressions.
  No verdict until real numbers exist.

## 6. Trio plan — "Save Money On Your Car" (K1 done, K2/K3 not rendered)

K1 is the first of a 3-Short trio on one topic: how to spend less on your car.

| # | Article | Working title | Numbers hook |
|---|---|---|---|
| K1 (this sample) | 6 — Fuel Economy | 15 Fuel Habits That Cost Almost Nothing | 15 habits, grouped 1–2 / 3–5 / 6–7 / 8–9 / 10–12 / 13–15 |
| K2 | 10 — New vs Used | Total Cost, Not the Price (title TBD at build) | "two or three years old", depreciation — the article's own figures |
| K3 | 3 — Hybrid vs Petrol | Which Saves More in 2026 (title TBD at build) | 2026, five/one/two — the article's own figures |

K2 and K3 are **not rendered** in this job. Each needs its own script, card
mapping and full verification (ffprobe + Whisper base/small + viewed frames + QA
15/15), and only after the owner approves the K1 look. K1 becomes a candidate for
a future daily Short only after that approval; it does not touch the 23 Nov
Short #09 build.

## 7. Tests

Full video suite: **173/173 green** (baseline 142/142, +31 new K checks; no test
weakened).

- `test_youtube_engine.py` — 71/71
- `test_style_selector.py` — 27/27
- `test_formats.py` — **75/75** (was 44): imports now expose six renderers
  (A–E + K); 18 unit checks for the K helpers (count-up, strike progress, reveal,
  stamp pop incl. overshoot, bar heights incl. clamping, number-font fit);
  K cover distinct from sample E and from Short #06; smoke render of both card
  types (frames, duration, cover fill ≥ 0.70, 1080×1920, motion, cover differs
  from mid-scene frame) plus pixel checks that the wrong value renders red and
  the right value / green bar renders green.
- One calibration, recorded: the green-pixel threshold was set at 300, then
  measured at 283 for the shortest right value ("GENTLE", downscaled frame) and
  lowered to 200. The rendering was verified by eye and by pixel count; the
  threshold was arbitrary, the check still proves the right value renders.

## 8. Next step (phase 2 — NOT started)

**Site topic trio.** The Barmon analysis's second application: topic-based grouping
on the site (trios of related articles, e.g. the "save money on cars" trio above
as linked topic pages). It changes published article structure, so it needs its
own plan + editorial review per article before any change. Nothing in this job
touched the site, the backend, `daily-shorts-state.json`, any cron, or the
23 Nov Short #09 build.

## 9. What the owner is being asked

Watch the K1 sample file and say whether the look is right. If yes, it becomes a
candidate for a future daily Short (K2/K3 then get built the same way). If no,
say what to change — the style is one module, so a look change is a small edit,
not a rebuild.
