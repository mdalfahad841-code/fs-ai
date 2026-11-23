# CLOSEOUT A4 — CSP ENFORCEMENT RULE — 2026-11-23

**Current state: Report-Only. Nothing is enforced.** The Pages CSP
(`frontend/_headers`) is `Content-Security-Policy-Report-Only`; browsers
report violations to `POST /api/csp-report` on the Worker, which stores
only the directive name, blocked URL, document URL and timestamp
(migration 030, `csp_reports`). The owner dashboard Security section
shows the 7-day counts per directive.

## The exact rule for switching to enforcement

Enforcement means ONE change, in ONE deploy: in `frontend/_headers`,
rename the header from `Content-Security-Policy-Report-Only` to
`Content-Security-Policy`, keeping the `report-uri` so violations keep
being recorded. Switch ONLY when ALL of the following hold:

1. **14 consecutive clean days.** For 14 straight days, ZERO reports
   whose blocked URL is first-party (`fs-ai-5w5.pages.dev`,
   `fs-ai.mdalfahad841.workers.dev`) or a required third party
   (`www.googletagmanager.com`, `www.google-analytics.com`) — i.e.
   no report shows a resource the site itself needs being blocked.
   Check this in the dashboard 7-day counts (two consecutive clean
   7-day windows), not from memory.
2. **No new directive in the window.** No directive appears in the
   7-day counts during those 14 days that was not already seen and
   explained before the window started.
3. **Every remaining report is explained.** Each report in the window
   is attributable to a browser extension, injected content, or a
   third party the site does not control (blocked URL outside the
   allow-list in rule 1). Unexplained reports reset the 14-day clock.
4. **Owner approval, explicit.** The owner reviews the dashboard
   7-day counts and gives one explicit go-ahead for the switch. No
   go-ahead, no switch — the autonomous system never flips this
   itself.
5. **Rollback ready before the deploy.** The revert is the same one-line
   header rename back to Report-Only, deployable in one push.

## After the switch

- Watch the dashboard CSP counts **daily for 7 days**. Any first-party
  breakage — a needed resource blocked, a page feature broken, a
  report naming a first-party or required third-party URL — means
  **revert to Report-Only immediately, in one deploy, with no
  approval needed**. A broken page is worse than an unenforced policy.
- If the 7 days pass clean, enforcement stays on and the reports keep
  flowing; review the counts weekly.

## What never justifies enforcement

- "The counts are low" without the 14-day clean window.
- "No reports at all" — zero reports can also mean the report-uri is
  broken; verify the endpoint is receiving reports (the stats
  endpoint answers, and a deliberate test violation lands in the
  table) before treating silence as clean.
- Any report naming a first-party URL that is not yet explained.

## Rollback

- Revert the one-line header rename (Report-Only again) and deploy.
  Reports keep flowing to the same endpoint; stored rows are kept.
  `DROP TABLE csp_reports` is NOT part of the rollback.
