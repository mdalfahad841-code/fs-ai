# FIX PASS 2 — ITEM 4: #33 SEO SKIP — FINDINGS

**Date:** 2026-11-23 (investigation run ~12:50 Dhaka, read-only)
**Status: CAUSE CONFIRMED — code rule (selection cap), not a data bug and not an SEO-suite bug.**
**No code changed, no D1 writes, #33 untouched, no rows inserted.** Every D1 call below returned `changed_db: false`.

## Cause in one sentence

The daily run's `seoRun` step SEO-checks only the **3 oldest-`updated_at` drafts per day** (`LIMIT 3`); on 23 Nov the eligible pool ordered oldest-first was #28, #31, #29, **#33, #30** — so #33 ranked **4th**, was never selected, and `runSeo` was never invoked for it.

## 1. The code path

`backend/routes/scheduler.js:1388-1398` — `steps.seoRun`:

```js
steps.seoRun = await step(env, 'seo', 'seo-run', async () => {
  // Protected test articles #26/#27 are never auto-repaired (owner order).
  const guard = protectedExclusion('id');
  const rows = await d1All(env, "SELECT id FROM articles WHERE status IN ('draft', 'pending_approval') AND " + guard.clause + ' ORDER BY updated_at ASC LIMIT 3', guard.params) || [];
  const results = [];
  for (const r of rows) {
    const res = await runSeo({ agent: 'seo', kind: 'seo-pass', payload: { article_id: r.id } }, env);
    results.push({ articleId: r.id, outcome: res.outcome, verdict: res.verdict || null });
  }
  return { outcome: 'done', checked: results.length, results };
});
```

The selection has exactly three conditions, and nothing else:

| Condition | File:line | Effect on #33 |
|---|---|---|
| `status IN ('draft', 'pending_approval')` | scheduler.js:1391 | #33 is `draft` — **passes** |
| `id NOT IN (26, 27)` — `protectedExclusion` | scheduler.js:1390; protection.js:31 (`PROTECTED_TEST_ARTICLES = [26, 27]`), protection.js:36-39 | #33 is not protected — **passes** |
| `ORDER BY updated_at ASC LIMIT 3` | scheduler.js:1391 | **#33 ranks 4th — excluded** |

There is **no** "needs SEO" condition anywhere in this path: no check for an existing `seo_checks` row, no recency/staleness test, no division filter, no created-date filter. An article is selected purely by being one of the 3 oldest-updated eligible drafts.

`runSeo` itself (`backend/agents/autonomy/seo.js`) has no skip logic either: every invocation unconditionally stores a row via `insertSeoCheck` (seo.js:750, helper seo.js:50-72). So if #33 had been selected, a row would exist. Its absence proves non-selection, not a failed check.

The step wrapper (`scheduler.js:1187-1207`) records outcome `'failed'` if the loop throws. The 23 Nov step recorded `'done'` — so no in-loop failure or abort occurred.

The only other SEO path in the daily run, `steps.seoPass` (scheduler.js:1400-1414), selects **published** articles with missing `seo_title`/`seo_description` for queueing. #33 is a draft, so it can never be reached that way. On 23 Nov it found `needingSeo: 0, enqueued: 0` (agent_runs id 189).

## 2. Reconstruction of the 23 Nov pool

Re-running the exact `seoRun` selection as of the run (pool = draft/pending_approval, excluding #26/#27, created before 00:04 UTC 23 Nov), ordered by `updated_at ASC`:

| Rank | Article | `updated_at` (UTC) | Why that timestamp |
|---|---|---|---|
| 1 | #28 | 2026-11-19T18:53:35 | untouched since 19 Nov |
| 2 | #31 | 2026-11-21T01:19:10 | untouched since 21 Nov |
| 3 | #29 | 2026-11-22T00:02:47 | 22 Nov daily run's SEO repair bumped it |
| **4** | **#33** | **2026-11-22T08:07:49** | **22 Nov correction (14:07 Dhaka) rewrote the body** |
| 5 | #30 | 2026-11-22T13:30:12 | 22 Nov correction (19:30 Dhaka) rewrote the body |
| — | #34 | 2026-11-23T00:03:27 | created during the run; newest in any case |

`LIMIT 3` takes {#28, #31, #29}. **#33 is 4th.** The irony is structural: the correction that made #33 most in need of a fresh SEO check is exactly what bumped its `updated_at` and pushed it out of the window.

## 3. Live D1 evidence

**`agent_runs` id 188** (agent `seo`, started 2026-11-23T00:04:04.894Z, outcome `done`) — the run's own record of what it checked:

```json
{"step":"seo-run","outcome":"done","checked":3,"results":[
  {"articleId":28,"outcome":"done","verdict":"needs-review"},
  {"articleId":31,"outcome":"done","verdict":"needs-review"},
  {"articleId":29,"outcome":"done","verdict":"needs-review"}]}
```

**`seo_checks` rows written by that run** — exactly those three, in selection order, ~2 s apart:

| seo_checks id | article_id | verdict | body_length | created_at (UTC) |
|---|---|---|---|---|
| 23 | 28 | needs-review | 2157 | 2026-11-23 00:04:00 |
| 24 | 31 | needs-review | 549 | 2026-11-23 00:04:02 |
| 25 | 29 | needs-review | 601 | 2026-11-23 00:04:04 |

**#33 has ZERO `seo_checks` rows — ever** (full-table query for article_id 33 returns no rows). Its latest `fact_checks` rows (fc 33/34, PASS 15/15) were created 2026-11-22 08:07:50 / 08:08:16 — the correction's own re-check on 22 Nov, not the 23 Nov daily run.

**`daily_reports` id 14** (date 2026-11-23, created 2026-11-23T00:04:26Z): `steps.seoRun.outcome = "done"`, `counts.seoRun = 3`, `counts.factChecksRun = 3`, `counts.gateEvaluated = 8`. The summary keeps counts only (scheduler.js:1519); the per-article list survives only in `agent_runs` detail (id 188, above).

**`articles` row for #33** (read 23 Nov ~12:50 Dhaka): status `draft`, body length 3478 (unchanged), `created_at` 2026-11-22T00:02:10Z, `updated_at` 2026-11-22T08:07:49Z. Its only `article_revisions` row (id 20, `revised_by` `fact-checking`) is dated 2026-11-22 08:07:49 — the correction. Nothing has touched #33 since.

**No queue involvement:** `agent_tasks` has zero `seo` rows since 2026-11-22, and zero `agent_runs` for agent `seo` outside the two daily-step rows (ids 188/189). No SEO task for #33 was ever enqueued, queued, or dropped.

## 4. Why the window is frozen (starvation mechanism)

`updated_at` moves only when an article is **mutated**. `repairSeoFields` (seo.js) writes `UPDATE articles SET ... updated_at = ?` only when it actually repairs something; a check-only run that finds nothing to repair leaves `updated_at` untouched. Consequence, visible in the data:

- #28's last revision is 2026-11-19 18:53:35, yet it received SEO rows on 20, 21, 22 and 23 Nov (seo_checks ids 4, 7, 16, 20, 23). Same body, re-checked every day, never ages out of slot 1.
- #31 likewise (last revision 21 Nov 01:19:10; rows on 21 and 23 Nov).
- #29 was repaired once (22 Nov 00:02:47) and still sits 3rd.

So the same three articles occupy the window day after day, and #33/#30 sit behind them. **Prediction without a fix:** the 24 Nov run will check #28, #31, #29 again (their `updated_at` values are unchanged and still the three oldest). #33 and #30 will be reached only if one of the front three gets repaired (bumping its `updated_at` to now), is published, or is deleted — #28 has needed no repair in four consecutive daily checks, so no near-term unblocking is expected. #34 (created 23 Nov, newest `updated_at`) starves behind them too.

## 5. Ruled out

- **Protected-article guard** — excludes only #26/#27 (protection.js:31). #33 is not protected (`is_protected = 0`).
- **Status filter** — #33 is `draft`, which the query includes.
- **Division / created-date / "needs SEO" filter** — none exists in the selection (scheduler.js:1391).
- **SEO-suite skip or failure** — `runSeo` always inserts a row (seo.js:750); the step outcome was `done`, not `failed`; a throw would have stopped the loop before #29's 00:04:04 row.
- **Queue-drain loss** — no `seo` task for #33 ever existed in `agent_tasks`; `seoRun` runs inline, not via the queue.
- **Stale/corrupt #33 state** — #33's body (3478), fact-check PASS 15/15 (fc 33/34, 22 Nov 08:07–08:08), and gate Blocked are all as recorded; nothing about its state excludes it.
- **A second, later SEO attempt that failed** — no `agent_runs`/`seo_checks` evidence of any kind for #33 on 23 Nov.

Nothing is NOT FOUND: the run's own `agent_runs` detail (id 188) names the three articles checked, and the reconstructed selection reproduces that list exactly.

## 6. Classification

**Code rule / design limitation, not a data bug.** The daily SEO budget is "3 oldest-updated drafts per day" with no freshness awareness and no memory of which articles have already been checked. It works when the draft backlog is ≤ 3; with 5–6 eligible drafts (28, 29, 30, 31, 33, 34) the newest ones starve, and the just-corrected articles — the ones most needing a fresh check — are systematically last.

Note the same shape exists in the sibling step `factCheckRun` (scheduler.js:1360-1368, identical `ORDER BY updated_at ASC LIMIT 3` without the guard). It produced the same 3-article day on 23 Nov (`factChecksRun: 3`; only #28 got a new fact-check row, fc 38 at 00:03:57 — #29/#31 already had fresh-enough checks). #33's fact-check PASS came from its correction re-check, not the daily run. The fact-check side is out of scope for this item but has the identical starvation property; flagging it for the parent, not fixing it here.

## 7. Recommended fix (for the parent to deploy as a separate item — NOT applied here)

**Goal:** the daily SEO window must advance past articles whose latest SEO check is already fresh for their current body, so a just-corrected draft is reached the next day instead of starving behind unchanged drafts.

**Exact change — `backend/routes/scheduler.js`, `steps.seoRun` (lines 1388-1398) only:**

1. Widen the candidate fetch from `LIMIT 3` to `LIMIT 10` (bounded; 8 drafts exist today), keeping `ORDER BY updated_at ASC` and the protected guard unchanged.
2. Inside the loop, before calling `runSeo`, compute the article's current body hash (the `bodyHash` helper `insertSeoCheck` already uses) and compare it with the latest `seo_checks` row for that article (`ORDER BY created_at DESC LIMIT 1`). If `body_hash` **and** `body_length` both match the current body, record `{ articleId, outcome: 'skipped-fresh' }` and **continue without counting toward the 3** — the slot goes to the next candidate.
3. Stop after **3 real checks** (`checked === 3`), as today. Return `checked` (real checks only) plus a `skippedFresh` count in the step result, so the daily report shows the skip explicitly instead of silently.

**Expected effect on the current data:** on the next daily run, #28/#31/#29 are all skipped-fresh (their 23 Nov rows record body_length 2157/549/601, equal to their current lengths, with no revisions since), and the run checks **#33 and #30** (and #34 if still a draft) — the skip is selective and self-correcting, and the daily budget of 3 real checks is preserved.

**Alternative considered and not recommended:** raising `LIMIT 3` alone (e.g. to 10) without the freshness skip would check everything tomorrow but would keep re-checking unchanged #28/#31/#29 every day thereafter — the window would still be spent on already-fresh articles first. The skip is the part that fixes the starvation; the wider fetch is only what lets the loop reach past them.

**Tests to add (with the fix item):** a scheduler test seeding drafts {#28 (fresh SEO row, old `updated_at`), #33 (no SEO row, newer `updated_at`)} asserting the run checks #33 and records #28 as `skipped-fresh`; a test that the cap still stops at 3 real checks when 5 stale drafts exist; the existing seoRun tests must keep passing unchanged (guard, status filter, ordering).

**Also recommended (same item, one line in the daily health report is NOT needed):** no change to `backend/services/daily-health-report.js` — it reads `seo_checks` honestly and #33 correctly shows "no SEO yet". The fix belongs in the selection, not the report. Do **not** hand-insert a `seo_checks` row for #33: a fabricated row would make the gate read a verdict no suite ever computed.

## 8. Method note

Read-only investigation. Code read from `~/workspace/fs-ai-source/fs-ai/` (no file modified). All D1 access was SELECT/PRAGMA via the D1 helper; every response returned `changed_db: false`, `rows_written: 0`. The pre-pass backup at `~/workspace/goals/fs-ai-autonomous-business-platform/hidden_files/d1-backup-2026-11-23-fixpass2-pre-deploy.json` was not needed and not touched.
