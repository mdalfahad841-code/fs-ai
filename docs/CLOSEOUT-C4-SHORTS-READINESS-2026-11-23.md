# Shorts Readiness Checklist — before the daily Shorts cron resumes

**Date:** 2026-11-23
**Status: NOT READY — the daily Shorts cron stays PAUSED.**
**Cron:** `fs-ai-daily-short-upload`, paused since 2026-11-23 00:53. It fires at 10:13:06 Asia/Dhaka when enabled. Do not resume it until every box below is ticked.

**Channel:** @FSAI-e5f (2 subscribers). Shorts are built, uploaded in Studio, then a Pin is made and a report is sent to the owner.

**How to use this list:** each item has a checkbox, the exact evidence needed to pass it, and who does it (owner or agent). All 8 items must pass. If any one fails, the cron stays paused.

---

## 1. ☐ Tell us what you disliked about the Shorts — OWNER

On 2026-11-23 00:52 you said the Shorts are not good ("Short video gula valo lage nai"). You have not yet said what was wrong.

**Pass evidence:** your reply naming at least one of these — style/look, voice, speed, content — and the agent's fix that answers it. The fix must address what you named, not just rebuild the same video.

**If you never answer:** the cron stays paused and no Shorts are made or uploaded. There is no automatic resume.

---

## 2. ☐ Watch Short #09 v2 and approve the look — OWNER

The video file will be sent to you directly as a file, not just a link.

**File:** `FS-AI-Short-09-How-to-Diagnose-Common-Engine-Noises-v2.mp4`
(34.77 s, 1080×1920, article 9 — "How to Diagnose Common Engine Noises". Title: "Hear That Knock? Stop Before It Costs More", 44 characters.)

**Check these 5 things while you watch:**
- [ ] Captions are big and easy to read — no tiny text, no paragraph of text on screen at once.
- [ ] Cards are full — no big empty space, no text cut off or overlapping.
- [ ] The hook is clear in the first 3 seconds ("Hear that knock?").
- [ ] Voice sounds right and the speed feels right.
- [ ] Nothing looks broken or wrong anywhere in the video.

**Pass evidence:** your reply with this exact wording:

```
Short #09 v2 approved — looks good
```

If anything is wrong, reply with what is wrong instead (see item 1). Do not approve a video you have not watched.

---

## 3. ☐ Short #09 v2 passes the automated QA gate (overall PASS, exit 0) — AGENT

**Status: PASSED — attempt 2, C3 gate 7/7 PASS (exit 0), verified by the coordinator with an independent run.** Attempt-1 numbers are kept below for the record.

**Where the numbers live:** `work/qa_gates_short09_v2.json` and §10 of the v2 QA report (`FS-AI-Short-09-How-to-Diagnose-Common-Engine-Noises-v2-QA-REPORT.md`). Both must show the same final numbers, and the QA report must no longer be marked DRAFT.

**Every check must PASS (a NOT TESTED plate check does not fail the run, but it must never be claimed as a pass):**

| Check | Pass limit | Attempt 1 result (2026-11-23 ~11:40) | Attempt 2 result (2026-11-23 ~12:20, coordinator re-ran) |
|---|---|---|---|
| 01 static-run — no frozen picture | Longest frozen run ≤ 3 s | PASS — longest run 0 s | PASS — longest run 0 s |
| 02a caption size (measured from frames) | 60–80 px | PASS — 63.1–65.0 px | PASS — 64.1–66.0 px |
| 02b plate secondary text | ≥ 28 px (measured from a render manifest or probe only) | NOT TESTED — no manifest/probe was given | PASS — all 16 ≥ 28 px (smallest: S6 bar labels 32 px) |
| 03 caption in bottom 25% | Lowest caption ink at or above y = 1440 px | PASS — lowest ink y = 1431 px, clear by 9 px | PASS — lowest ink y = 1275 px, clear by 165 px |
| 04 narration paragraph on screen | ≤ 2 lines AND ≤ 12 words at once | **FAIL** — full scene body on screen (tool counted max 32 words; real frames show 16 words in 4 lines — the FAIL is real either way) | PASS — max 2 lines / max 12 words (t = 1.3 s, exactly at the limit, zero headroom) |
| 05 measured silence | ≤ 15% | PASS — 0.0% (0.00 s of 34.77 s) | PASS — 0.0% (0.00 s of 34.77 s) |
| **Overall** | **exit 0** | **FAIL (4 PASS, 1 FAIL, 1 NOT TESTED)** | **PASS (7 PASS, 0 FAIL, 0 NOT TESTED), exit 0** |

**Attempt limit:** max 3 render attempts total. Attempt 2 of 3 used; attempt 3 unused. Check 04 was fixed with a rolling ≤ 12-word / ≤ 2-line caption window, and the word counter was fixed (caption-band clipping + gap threshold now scaling with glyph height; both baselines re-run unchanged).

**Supporting numbers (attempt 2, identical to attempt 1 — TTS not re-run):** pipeline QA 15/15 PASS, loudness −14.65 LUFS / −1.51 dBTP, Whisper base 110/112 words, small 111/112 words.

---

## 4. ☐ Your prompt for the next video — OWNER

On 2026-11-22 23:18 you said you will give the prompts for the next videos yourself ("Next video gular jonno prompt ami dibo").

**Pass evidence — one of these:**
- You send your prompt for the next video, OR
- You reply with this exact wording:

```
Auto-pick topics is OK again
```

Until one of those happens, the cron must not auto-pick topics. No video is built from an auto-picked topic while this item is open.

---

## 5. ☐ Division rotation — the next article after #09 must NOT be automotive #10 — AGENT

**Rule:** no division more than twice in a row. Short #06 was automotive, Short #09 is automotive — that is two in a row, which is allowed. Article 10 is also automotive, so it would be the third in a row. It must be skipped for Shorts and swapped.

**Pass evidence:** the agent names a different division's article for the next Short and tells you which article and division it is, before the run. The agent does not silently use #10.

---

## 6. ☐ State file + cron mechanics verified — AGENT (only after items 1–5 pass AND you say resume)

**Before re-enabling, the agent verifies:**
- [ ] State file (`hidden_files/daily-shorts-state.json`): `last_uploaded` is 6, `next_article` is 9.
- [ ] The cron is still paused (paused since 2026-11-23 00:53) and is re-enabled only now, by the agent, on your word.
- [ ] Items 1–5 above are all passed with the evidence written down.

**Pass evidence:** your reply with this exact wording:

```
Resume Shorts
```

No other wording resumes the cron. The agent re-enables it — you do nothing.

**What the first resumed run does (at 10:13:06 Dhaka):** build → upload the approved Short #09 file → make its Pin → send you the report with the video file, the YouTube link, and the Pin link. Long #08 v2 is NOT part of this — it is uploaded separately by you from its upload sheet, never by the cron.

---

## 7. ☐ What you get on the first resumed day — OWNER (know what to expect)

- **Timing:** the cron fires at 10:13:06 Dhaka. The video file, YouTube link, and Pin link arrive in the report after the run finishes (previous uploads landed late morning, around 11:30–12:00 Dhaka). No exact minute is promised.
- **What arrives:** the actual video file sent to you directly (not just a link), the public YouTube Shorts link, and the Pinterest Pin link.
- **No Community post:** the channel has 2 subscribers; Community posts need 500 subscribers, so none is made.
- **Stop rule:** if you dislike the next Short, reply with this exact wording and the cron is paused again — one reply, no discussion needed:

```
Pause Shorts
```

---

## 8. ☐ These must NOT happen on resume — AGENT

- [ ] No re-render of any published video.
- [ ] No touching Short #09 v1 (it stays exactly as it is).
- [ ] No auto-publish of any article by the Shorts run — the Shorts cron only builds and uploads Shorts.
- [ ] `social_auto_post` stays OFF — no article is auto-posted to social. (The run still makes one Pin for the new Short itself, as it did for #06 — that Pin is part of the Shorts run, not article auto-posting.)

---

## Sign-off

When all 8 boxes are ticked, the agent resumes the cron on your `Resume Shorts` word and reports back: cron re-enabled, first run time, and the Short #09 file + link + Pin after the run.

**Still open at the time this checklist was written (2026-11-23):**
- Item 1 — owner has not answered what he disliked (asked 2026-11-23 00:52).
- Item 2 — owner has not watched/approved Short #09 v2.
- Item 3 — PASSED: C1 attempt 2, C3 gate 7/7 PASS exit 0 (coordinator re-ran independently). QA report §10 final, no longer DRAFT.
- Item 4 — owner has not sent his next-video prompt and has not said auto-pick is OK again.
- Items 5–8 — depend on 1–4; nothing verified yet.

**NOT VERIFIED:** the exact replacement article/division for the post-#09 swap (item 5 — the agent names it at resume time; articles 6–10 are all Automotive, so the swap reaches past article 10); playback of Short #09 v2 on a phone or in the YouTube app (frames were inspected as images only); the Studio copyright check (manual, post-upload).
