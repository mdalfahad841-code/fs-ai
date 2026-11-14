# FS AI — Autonomy Integration Patch

**Date:** 2026-11-14
**Status:** NOT APPLIED. This document is the exact minimal integration
for the autonomy system described in
[docs/AUTONOMY-2026-11-14.md](./AUTONOMY-2026-11-14.md).

**Applying this patch is the parent's step.** The worker that wrote this
document did not apply it, did not push to GitHub, and did not touch
Cloudflare. The files below may be under edit by the concurrent
functional-test pass — re-check each hunk against the live file before
applying it, and run `npm test` after applying.

The patch has three parts:

1. `backend/worker.js` — route wiring + cron guards (code, then deploy).
2. `frontend/pages/dashboard.html` — one script tag.
3. D1 migrations 005 then 006 (via the Cloudflare D1 API token the
   parent holds).

No other file changes. No new dependency, no paid service, no secret is
introduced by this patch.

---

## 1. `backend/worker.js` — route wiring + cron guards

### 1a. Imports

Add two import lines after the existing `handleAdmin` import (line 22):

```diff
 import { handleAdmin } from './routes/admin.js';
+import { handleAutonomy } from './routes/orchestrator.js';
+import { runDailyWorkflow, runWeeklyWorkflow } from './routes/scheduler.js';
 import { requireOwner } from './middleware/auth.js';
```

Why these two: `handleAutonomy` serves every `/api/autonomy/*` route;
`runDailyWorkflow` / `runWeeklyWorkflow` are what the cron calls once a
day / once a week. Neither module imports `worker.js`, so there is no
import cycle. (The orchestrator assumes owner auth is already verified —
that is why the route block below calls `requireOwner` first, exactly
like the existing `/api/agents` and `/api/admin/*` blocks.)

### 1b. Owner-only route block

Add this block inside `route()` after the `/api/accounts` PUT block and
**before** the `'/'` fallback:

```diff
   if (path.startsWith('/api/accounts') && method !== 'GET') {
     const auth = await requireOwner(request, env);
     if (!auth.ok) return auth.response;
     return handleAccounts(request, env, ctx);
   }
+
+  // Autonomous Operations (owner-only). Auth is enforced here, before
+  // the orchestrator runs — handleAutonomy assumes a verified owner.
+  if (path.startsWith('/api/autonomy')) {
+    const auth = await requireOwner(request, env);
+    if (!auth.ok) return auth.response;
+    return handleAutonomy(request, env, ctx, auth);
+  }
 
   if (path === '/' && method === 'GET') {
     return jsonOk({ brand: BRAND_FULL, tagline: TAGLINE, api: '/api/health' });
   }
```

This exposes: `GET /api/autonomy/status`, `GET /api/autonomy/llm`,
`GET|POST /api/autonomy/tasks`, `POST /api/autonomy/tasks/:id/run`,
`POST /api/autonomy/control`, `GET|POST /api/autonomy/settings`,
`GET /api/autonomy/reports`, `POST /api/autonomy/reports/generate`,
`GET /api/autonomy/accounts`, `POST /api/autonomy/run-daily`,
`POST /api/autonomy/scaffolds/:runId/convert`. Without this block every
one of them answers 404.

### 1c. `scheduled()` replacement (default export only)

Replace the `scheduled(event, env, ctx)` method **inside the default
export** (the one whose comment says "Hourly cron … publish only the
owner-approved articles"). The publish step still runs every hour.
The daily workflow runs **only at 00:00 UTC** and the weekly workflow
**only on Sundays at 00:00 UTC** — that guard is load-bearing:

```diff
   // Hourly cron (see [triggers] in config/wrangler.toml): publish only the
   // owner-approved articles whose publish_at has passed. Nothing else is
   // ever auto-published, and the Emergency Stop skips the run entirely.
+  // At 00:00 UTC the daily workflow also runs, and on Sundays at 00:00 UTC
+  // the weekly workflow runs too. The 00:00 UTC guard is required:
+  // runDailyWorkflow writes one daily_reports row per invocation, so
+  // calling it on every hourly tick would write 24 rows/day.
   async scheduled(event, env, ctx) {
     try {
       const result = await publishDueArticles(env);
       console.log('FS AI scheduled publish:', JSON.stringify(result));
+      const now = new Date(event && event.scheduledTime ? event.scheduledTime : Date.now());
+      if (now.getUTCHours() === 0) {
+        const daily = await runDailyWorkflow(env);
+        console.log('FS AI scheduled daily workflow:', JSON.stringify(daily));
+        if (now.getUTCDay() === 0) {
+          const weekly = await runWeeklyWorkflow(env);
+          console.log('FS AI scheduled weekly workflow:', JSON.stringify(weekly));
+        }
+      }
       return result;
     } catch (err) {
       console.error('FS AI scheduled publish error:', err);
     }
   },
```

**Do NOT touch the named export at the bottom of the file:**

```js
// Named export for tests and for src/index.js.
export async function scheduled(event, env, ctx) {
  return publishDueArticles(env);
}
```

It stays publish-only — it is used by tests and by `src/index.js`
(`handleScheduled`). Changing it would change what the test suite
proves about the hourly tick.

**No change to `config/wrangler.toml` is needed.** The cron trigger
already exists (`[triggers] crons = ["0 * * * *"]`, hourly). The
`[ai]` Workers AI binding is already in the file. What the live Worker
still needs after this code patch is a **redeploy** (`npm run deploy`),
which is also what activates the Workers AI binding — until then live
LLM status stays `not-configured`.

---

## 2. `frontend/pages/dashboard.html` — one script tag

Add one line after the `dashboard.js` script tag (line 221), before the
`authentication.js` tag:

```diff
 <script src="../scripts/dashboard.js"></script>
+<script src="../scripts/autonomy.js"></script>
 <script src="../scripts/authentication.js"></script>
```

`frontend/scripts/autonomy.js` already exists: it builds its own
"Autonomous Operations" section (status cards, LLM status block, task
list + run, Emergency Stop toggle, Run Daily Workflow Now, control,
settings, reports, accounts, scaffold conversion) using the owner's
Bearer token from `sessionStorage` (`fsai-session`, the same mechanism
`authentication.js` / `dashboard.js` use). It only builds its section
after the dashboard has been revealed by a verified server session — it
never unhides `#dashboardContent` itself and never bypasses the login
gate. Without this one line the section never loads; with it, nothing
else about the dashboard changes.

---

## 3. D1 migrations 005 then 006

Apply in order, via the Cloudflare D1 API token the parent holds
(the same token path used for the earlier D1 work — the token is
D1-scoped; it is never pasted into chat or into this document):

1. `database/migrations/005_autonomy.sql` — creates `agent_tasks`,
   `agent_runs`, `agent_logs`, `autonomy_settings`, `daily_reports`,
   and seeds `autonomy_level=3`, `autonomy_target=3`,
   `publishing_mode=approved_only`, `max_articles_per_day=1`,
   `social_auto_post=off`, `llm_provider=none`.
2. `database/migrations/006_llm_usage.sql` — creates `llm_usage` and
   seeds `llm_provider_order=workers-ai,groq,gemini` and
   `llm_daily_cap_neurons=9000`.

Console-paste copies exist at:

- `database/console-chunks/migration-005-autonomy.sql`
  (same SQL statements as the migration; comments and blank lines
  stripped for console pasting)
- `database/console-chunks/migration-006-llm-usage.sql`
  (identical to the migration)

Apply 005 first, verify it succeeded, then 006. Do **not** apply
migration 004 as part of this step: the live D1 database was built by
the incremental chain and already has 004's changes; the 004-vs-
`schema.sql` duplicate-column conflict is a local full-chain rebuild
issue only (see `docs/AUTONOMY-2026-11-14.md` §13(a)).

Without these two migrations every `/api/autonomy/*` endpoint answers
503 ("requires the D1 database") or fails on missing tables — the code
does not create tables at runtime.

---

## Verify after applying

Run these in order. Stop at the first failure and report it rather than
working around it.

1. `npm test` — full suite must stay green (479 tests passing at the
   time this patch was written: 420 pre-existing + 49 autonomy tests +
   10 from the concurrent functional-test pass).
2. `npm run deploy` (Worker) + Pages deploy for the dashboard change —
   or the project's normal deploy path for both.
3. As the owner (signed in, server session), open the Command Center
   and confirm the "Autonomous Operations" section loads.
4. `GET /api/autonomy/status` (owner token) — expect 200 with
   `autonomyLevel: "3"`, `tasks` all zeros, `revenue: "$0.00"`,
   `traffic: "Data unavailable"`, `llm.provider: "none"`,
   `llm.generationPaused: true` (until a redeploy binds Workers AI
   and/or Groq/Gemini keys exist).
5. `GET /api/autonomy/llm` — expect all three providers
   `not-configured` before any redeploy/keys; after a redeploy,
   `workers-ai` should report `available` (0 of 9,000 Neurons used).
6. `GET /api/autonomy/accounts` — expect 10 accounts with the six-state
   table from `docs/AUTONOMY-2026-11-14.md` §5.
7. `POST /api/autonomy/run-daily` (owner token) — expect 200, one new
   `daily_reports` row (kind `daily`), two `daily-research` tasks
   enqueued for the two thinnest divisions. Run it a second time and
   confirm no duplicate research tasks appear for the same day.
8. Confirm the hourly cron still publishes only approved+due articles
   (nothing else changes about the hourly tick), and that the daily
   workflow does **not** run on non-midnight ticks (no new
   `daily_reports` row after an 01:00–23:00 UTC tick).

## Rollback

- Code: revert the three hunks above (worker.js imports/route/
  scheduled, dashboard.html script tag) and redeploy. The named export
  `scheduled()` was never touched, so the hourly publish tick is
  unaffected by a revert.
- Data: migrations 005/006 only add tables and settings rows; they do
  not alter existing tables. If the patch must be backed out of D1,
  drop `agent_tasks`, `agent_runs`, `agent_logs`,
  `autonomy_settings`, `daily_reports`, `llm_usage` — but note that
  drops the autonomy history with them, and dropping is irreversible.
  There is no need to drop them to disable autonomy: the Emergency
  Stop (`POST /api/admin/emergency-stop` `{"stopped": true}`) halts
  all autonomous work without touching the schema.
