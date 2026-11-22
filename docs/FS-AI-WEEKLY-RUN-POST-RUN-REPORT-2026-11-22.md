# FS AI Weekly Run — Post-Run Verification Report — 22 November 2026

**Run:** Sunday 22 November 2026, 06:00 Dhaka (Cloudflare Worker scheduled trigger — hourly cron + Sunday guard)
**Executed:** 06:03 Dhaka
**Verdict:** PASS
**Verification method:** live D1 reads after the run. Nothing in this report is estimated or fabricated. Dashboard-only items are marked UNVERIFIED (they need a live browser session).

## 1. Execution

- Daily report **id 12** and weekly report **id 13** — both created 06:03 Dhaka.
- All run steps completed. Only `correctionRun` and `analyticsSnapshot` were no-ops (nothing to correct, nothing to snapshot).

## 2. Research

- **33 RSS fetches, all completed, 0 errors.**
- **0 new items** — the feeds had nothing new today.

## 3. Drafts

- New draft **#33** created: "M State's Detroit Lakes campus to close amid systemwide budget woes", body **4801 chars**, status draft.
- Total articles now **32** (published 25 + draft 7).

## 4. Fact-check

- **3 new fact-checks today** — #26 (0/16), #27 (0/2), #28 (6/7), all verdict **needs-review**.
- **#29: fact-check still failed** (unchanged from before — not caused by this run).
- **#30: fact-check still stale** (unchanged from before — not caused by this run).
- #33 has not been fact-checked yet.

## 5. SEO

- **3 new SEO checks today** — #28, #29, #30 (needs-review).
- No new SEO on #26/#27 — the guard held (protected articles are not re-checked).

## 6. Task queue — big improvement

- **10 tasks drained** (done 19 → 29), queued **12 → 4**.
- Remaining queued: **36, 37** (from 21 Nov) and **39, 40** (new today).
- Failed task **#31 is still the only failed task**. No running tasks. No duplicate keys.

## 7. Publishing

- **Nothing published.** Published still **25**, today 0, gateApproved 0.

## 8. LLM provider

- **Workers AI only** — no other provider used.
- Total: **48 calls / 814 Neurons**. One new call today (content-creation, 36 Neurons).

## 9. Protected articles untouched

- **#26 / #27:** body 4895 / 245 chars, `updated_at` still 19 Nov, protected = 1. Byte-identical to baseline.

## 10. Article #31

- Still **draft**, body **549 chars**. Unchanged.

## 11. Settings (unchanged)

- Auto-publishing **OFF**, auto-correction **OFF**, social **OFF**, publishing mode **approved_only**.

## 12. Emergency Stop

- **OFF.**

## 13. Cost

- **$0.00.**

## 14. Not verified in this report

- Dashboard-only items (Control Center rendering, live dashboard counts) — **UNVERIFIED**, need a live browser session.

## Note — daily Short state

For the 10:13 daily Short run, the state file had Short #06 set as `pending_upload`, so the already-built file was uploaded instead of rebuilding article 6. (Short #06 was uploaded later that morning: https://youtube.com/shorts/kVLyvMp8DoA, Public, copyright check passed.)

## What was NOT done

- Nothing published, nothing changed, the run was **not** manually triggered — it fired on its schedule.
