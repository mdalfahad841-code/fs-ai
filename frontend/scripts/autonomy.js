/* FS AI — Autonomous Operations section for the Command Center.
   Reads ONLY the real Worker autonomy API with the owner's Bearer token
   (sessionStorage 'fsai-session', the exact mechanism authentication.js
   and dashboard.js use). Nothing is invented: revenue is honestly $0.00
   and traffic is honestly "Data unavailable" unless the API returns a
   real row, and every count comes from GET /api/autonomy/status.
   Honest limits, stated in the section itself: no LLM is connected, so
   article writing is scaffold-only; social posting is preparation only
   (nothing is posted); analytics reporting is "Data unavailable" until
   a GA4 Data API is authorized. A 401 anywhere shows "Sign in again".
   This file only builds its own section AFTER the dashboard has been
   revealed by a verified server session — it never unhides
   #dashboardContent itself and never bypasses the login gate. */
(function () {
  'use strict';
  var API_BASE = 'https://fs-ai.mdalfahad841.workers.dev';
  var started = false;
  var emergencyStopped = null;
  var taskFilter = '';
  // The article whose corrections the review section is showing.
  var correctionArticleId = null;
  var queuedTasks = [];
  // Phase 4 (2026-11-20) — in-flight guards. The dashboard must not
  // re-fire a manual run or a re-check while one is already running
  // for the same target: the duplicate request used to hit the
  // server's 'already running' guard and surface as a 409 failure
  // while the real run was still in progress. The sets survive
  // list re-renders (loadTasks/loadPipeline rebuild the DOM); the
  // clicked button is also disabled for immediate feedback.
  var inFlightTasks = {};
  var inFlightRechecks = {};

  function token() {
    try {
      var raw = sessionStorage.getItem('fsai-session');
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.mode === 'server' && s.token) ? s.token : null;
    } catch (e) { return null; }
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function el(id) { return document.getElementById(id); }
  function setText(id, text) { var n = el(id); if (n) n.textContent = text; }
  function esc(s) { return window.FSAI ? window.FSAI.esc(s) : String(s == null ? '' : s); }

  function statusPill(status) {
    var s = String(status == null ? '' : status);
    var lower = s.toLowerCase();
    var cls = 'status-pill';
    if (['active', 'connected', 'verified', 'exists', 'created', 'published', 'done', 'running', 'completed'].indexOf(lower) !== -1) cls += ' ok';
    else if (['pending', 'paused', 'draft', 'pending_approval', 'approved', 'queued', 'skipped'].indexOf(lower) !== -1) cls += ' pending';
    else if (['failed', 'disabled', 'rejected', 'suspended', 'archived', 'unsubscribed'].indexOf(lower) !== -1) cls += ' failed';
    return '<span class="' + cls + '">' + esc(s || 'Unknown') + '</span>';
  }

  function apiError(r) {
    if (r.status === 401) return 'Sign in required — your session is not valid. Sign in again.';
    if (r.status === 423) return 'Blocked by the Emergency Stop (HTTP 423): ' + ((r.data && r.data.error) || 'agent runs are blocked while the Emergency Stop is ON.');
    if (r.status === 409) return 'Conflict (HTTP 409): ' + ((r.data && r.data.error) || 'the server refused this action.');
    return 'API error (HTTP ' + r.status + '): ' + ((r.data && r.data.error) || 'could not complete this action.');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    if (window.FSAI) return window.FSAI.formatDate(String(iso).slice(0, 10));
    return String(iso).slice(0, 10);
  }

  function mark(state) { return state ? '✓' : '—'; }

  /* Division slug -> D1 id (seed order). Used only by the create-content
     form so the task carries the same division_id the API validates. */
  var DIVISION_IDS = {
    automotive: 1, 'ai-technology': 2, 'gadgets-electronics': 3,
    'finance-money': 4, 'travel-lifestyle': 5, 'digital-tools': 6,
    'health-wellness': 7, 'education-learning': 8,
  };

  function slugifyTitle(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
  }

  /* Facebook, WhatsApp Business and Business Email are paused by the
     owner — not created, pending his authorization (same standing fact
     dashboard.js records). Whatever the API reports, those three rows
     show all dashes with 'Pending Owner Authorization'. */
  function isPendingOwnerAccount(a) {
    var hay = ((a.id || '') + ' ' + (a.platform || '') + ' ' + (a.handle || '')).toLowerCase();
    return hay.indexOf('facebook') !== -1 || hay.indexOf('whatsapp') !== -1 ||
      hay.indexOf('business email') !== -1 || hay.indexOf('business-email') !== -1;
  }

  /* --- Section markup (built at runtime, after the gate opens) --- */
  function buildSection() {
    if (el('section-autonomy')) return;
    var content = el('dashboardContent');
    if (!content) return;
    var sec = document.createElement('section');
    sec.className = 'card dashboard-section';
    sec.setAttribute('data-section', 'autonomy');
    sec.id = 'section-autonomy';
    sec.setAttribute('aria-label', 'Autonomous Operations');
    sec.innerHTML =
      '<h2>Autonomous Operations</h2>' +
      '<p class="muted">What is autonomous here, and what is not: task queuing, agent control, ' +
      'publishing rules and reports run through the Worker API below. Article writing uses the free LLM ' +
      'providers listed under “Article generation (LLM)” when one is available; otherwise it falls back to a ' +
      'scaffold — no article body is ever fabricated. Social posting is preparation ' +
      'only — nothing is posted from here. Analytics reporting is “Data unavailable” until a GA4 ' +
      'Data API is authorized. Publishing happens only after owner approval.</p>' +
      '<p id="autonomyStatus" aria-live="polite">Loading autonomy status…</p>' +
      '<h3>Article generation (LLM)</h3>' +
      '<p id="autonomyLlmStatus" aria-live="polite">Loading LLM provider status…</p>' +
      '<div class="kpi-grid" id="autonomyKpiGrid"></div>' +
      '<h3>Research sources</h3>' +
      '<p class="muted">Free public RSS/Atom feeds, 3 per division (24 total). The daily workflow fetches them when auto-research is on. A failed feed is recorded here with its last error — never treated as checked. ' +
      '“Discovered” is the total number of items ever stored from that feed; “Duplicates” is the total number of items skipped because they were already stored. Both are cumulative counters — they only change when a fetch actually runs. Reloading this page never changes them.</p>' +
      '<p id="autonomySourceStatus" aria-live="polite"></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Source</th><th>Division</th><th>Status</th><th>Last fetch</th><th>Last error</th><th>Discovered</th><th>Duplicates</th><th>Actions</th></tr></thead><tbody id="autonomySourceList"></tbody></table></div>' +
      '<h3>Fetch history (RSS audit)</h3>' +
      '<p class="muted">Every RSS fetch since the audit log started is recorded here — feed, time, trigger (manual / scheduled / daily workflow), items found, new, duplicates, errors, and final status. These are recorded rows; reloading never changes them. Fetches before the audit log started were never recorded and are not backfilled.</p>' +
      '<p><button class="btn btn-outline" type="button" id="autonomyLoadRssAuditBtn">Show fetch history</button> <span id="autonomyRssAuditStatus" class="muted" aria-live="polite"></span></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Feed</th><th>Started</th><th>Trigger</th><th>Found</th><th>New</th><th>Duplicates</th><th>Errors</th><th>Status</th></tr></thead><tbody id="autonomyRssAuditList"></tbody></table></div>' +
      '<h3>Add a research source</h3>' +
      '<p class="muted">The URL is fetched and validated live before it is stored — only a URL that returns valid RSS/Atom XML becomes a source.</p>' +
      '<div class="field"><label for="autonomySourceDivision">Division</label>' +
      '<select id="autonomySourceDivision">' +
      '<option value="automotive">Automotive</option>' +
      '<option value="ai-technology">AI &amp; Technology</option>' +
      '<option value="gadgets-electronics">Gadgets &amp; Electronics</option>' +
      '<option value="finance-money">Finance &amp; Money</option>' +
      '<option value="travel-lifestyle">Travel &amp; Lifestyle</option>' +
      '<option value="digital-tools">Digital Tools</option>' +
      '<option value="health-wellness">Health &amp; Wellness</option>' +
      '<option value="education-learning">Education &amp; Learning</option>' +
      '</select></div>' +
      '<div class="field"><label for="autonomySourceName">Source name</label>' +
      '<input id="autonomySourceName" type="text" placeholder="e.g. BBC News - Technology"></div>' +
      '<div class="field"><label for="autonomySourceUrl">Feed URL (https)</label>' +
      '<input id="autonomySourceUrl" type="text" placeholder="https://example.com/feed.xml"></div>' +
      '<p><button class="btn btn-primary" type="button" id="autonomyAddSourceBtn">Add source</button></p>' +
      '<p id="autonomyAddSourceStatus" aria-live="polite"></p>' +
      '<h3>Fact-check queue &amp; publish gate</h3>' +
      '<p class="muted">Every draft shows its publish-gate result. “Ready” means the content checks pass and the article waits for owner approval — nothing auto-publishes while publishing mode is “approved only”. Fact-check runs claim by claim against fetched source material; correction rewrites from evidence or removes the unsupported sentence.</p>' +
      '<p id="autonomyPipelineStatus" aria-live="polite"></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Draft</th><th>Status</th><th>Gate</th><th>Blocked by</th><th>Actions</th></tr></thead><tbody id="autonomyPipelineList"></tbody></table></div>' +
      '<p id="autonomyFactCheckDetail" aria-live="polite"></p>' +
      '<h3>Correction review</h3>' +
      '<p class="muted">Unresolved corrections for one draft: original claim, attempted correction, evidence, and why it failed. Open “Review” on a draft above. Resolving never marks an unsupported claim verified — it only records the owner’s decision, and the gate re-evaluates from the recorded state.</p>' +
      '<p id="autonomyCorrectionStatus" aria-live="polite">No article selected — open “Review” on a draft above.</p>' +
      '<div id="autonomyCorrectionList"></div>' +
      '<h3>Operations analytics</h3>' +
      '<p class="muted">First-party numbers from the live database only. GA4 reporting is not connected, so traffic stays “Data unavailable” and revenue stays $0.00.</p>' +
      '<div class="kpi-grid" id="autonomyAnalyticsGrid"></div>' +
      '<h3>Backup</h3>' +
      '<p id="autonomyBackupStatus" aria-live="polite"></p>' +
      '<p><button class="btn btn-outline" type="button" id="autonomyBackupBtn">Run backup now</button> <span class="muted">Exports the database as JSON and records the run. Restore is manual — see the backup docs.</span></p>' +
      '<h3>Agents</h3>' +
      '<ul class="clean" id="autonomyAgentList"></ul>' +
      '<h3>Controls</h3>' +
      '<p><strong>Emergency Stop: <span id="autonomyStopState">Unknown</span></strong> ' +
      '<button class="btn btn-danger" type="button" id="autonomyStopBtn">Turn Emergency Stop ON</button></p>' +
      '<p>' +
      '<button class="btn btn-primary" type="button" id="autonomyStartAllBtn">Start All Agents</button> ' +
      '<button class="btn btn-outline" type="button" id="autonomyPauseAllBtn">Pause All Agents</button> ' +
      '<button class="btn btn-outline" type="button" id="autonomyResumeBtn">Resume Operations</button> ' +
      '<button class="btn btn-primary" type="button" id="autonomyRunDailyBtn">Run Daily Workflow Now</button> ' +
      '<button class="btn btn-outline" type="button" id="autonomyRunWeeklyBtn">Run Weekly Workflow Now</button>' +
      '</p>' +
      '<p class="muted">Start / Pause / Resume act on all agents through the Worker. ' +
      '“Run Daily Workflow Now” runs the full daily workflow on demand; it is blocked (423) while the Emergency Stop is ON. ' +
      'A manual run is an explicit re-run, so it runs even if the workflow already ran today. ' +
      '“Run Weekly Workflow Now” runs the weekly workflow on demand (Sunday’s report); a second run in the same week reports “already completed” instead of duplicating it. ' +
      'The daily workflow also runs on schedule at 00:00 UTC (06:00 Dhaka) every day, and the weekly workflow on Sundays at 00:00 UTC.</p>' +
      '<p id="autonomyControlStatus" aria-live="polite"></p>' +
      '<p id="autonomyRunDailyStatus" aria-live="polite"></p>' +
      '<p id="autonomyRunWeeklyStatus" aria-live="polite"></p>' +
      '<h3>Create a content draft task</h3>' +
      '<p class="muted">Creates a queued content-creation task for one article. Run it below; when it finishes with an AI draft, convert its scaffold (run ID) to a CMS draft for owner review. AI drafts are marked “AI-DRAFT — needs fact-check + owner approval” and are never published automatically.</p>' +
      '<div class="field"><label for="autonomyContentTitle">Article title</label>' +
      '<input id="autonomyContentTitle" type="text" placeholder="e.g. How Artificial Intelligence Is Changing Everyday Life"></div>' +
      '<div class="field"><label for="autonomyContentDivision">Division</label>' +
      '<select id="autonomyContentDivision">' +
      '<option value="automotive">Automotive</option>' +
      '<option value="ai-technology" selected>AI &amp; Technology</option>' +
      '<option value="gadgets-electronics">Gadgets &amp; Electronics</option>' +
      '<option value="finance-money">Finance &amp; Money</option>' +
      '<option value="travel-lifestyle">Travel &amp; Lifestyle</option>' +
      '<option value="digital-tools">Digital Tools</option>' +
      '<option value="health-wellness">Health &amp; Wellness</option>' +
      '<option value="education-learning">Education &amp; Learning</option>' +
      '</select></div>' +
      '<div class="field"><label for="autonomyContentSources">Sources (optional, one per line)</label>' +
      '<textarea id="autonomyContentSources" rows="3" placeholder="One source per line — name or URL. Leave empty for general guidance only."></textarea></div>' +
      '<p><button class="btn btn-primary" type="button" id="autonomyCreateContentBtn">Create content task</button></p>' +
      '<p id="autonomyCreateContentStatus" aria-live="polite"></p>' +
      '<h3>Run a task manually</h3>' +
      '<p class="muted">Only queued tasks can be run. A run that finds nothing to do reports a no-op with the server’s reason — never a fake success.</p>' +
      '<div class="field"><label for="autonomyTaskSelect">Queued task</label>' +
      '<select id="autonomyTaskSelect"><option value="">No queued tasks loaded yet</option></select></div>' +
      '<p><button class="btn btn-primary" type="button" id="autonomyRunTaskBtn">Run selected task</button></p>' +
      '<p id="autonomyRunTaskStatus" aria-live="polite"></p>' +
      '<p><button class="btn btn-outline" type="button" id="autonomyRecoverStaleBtn">Recover stale running tasks</button></p>' +
      '<p class="muted">A task stuck “running” for over 10 minutes (a stalled run) is marked failed here so it can be retried — the same recovery the daily and weekly workflows run first. A task that is genuinely still running is left alone.</p>' +
      '<h3>Convert a content scaffold to a draft</h3>' +
      '<p class="muted">This converts an existing content scaffold — or an AI-written draft from a content run — into a CMS draft for owner review. AI drafts are marked “AI-DRAFT — needs fact-check + owner approval” and are never published automatically.</p>' +
      '<div class="field"><label for="autonomyScaffoldRunId">Scaffold run ID</label>' +
      '<input id="autonomyScaffoldRunId" type="text" placeholder="e.g. the run ID from a task result"></div>' +
      '<p><button class="btn btn-outline" type="button" id="autonomyConvertScaffoldBtn">Convert scaffold to draft</button></p>' +
      '<p id="autonomyConvertStatus" aria-live="polite"></p>' +
      '<h3>Task queue</h3>' +
      '<p class="muted">A research task with no division runs all divisions — it skips only when EVERY division’s research agent is paused. A research task for one division skips when that division’s research agent is paused.</p>' +
      '<p id="autonomyTaskFilters">' +
      '<button class="btn btn-small" type="button" data-autonomy-filter="">All</button> ' +
      '<button class="btn btn-small" type="button" data-autonomy-filter="queued">Queued</button> ' +
      '<button class="btn btn-small" type="button" data-autonomy-filter="running">Running</button> ' +
      '<button class="btn btn-small" type="button" data-autonomy-filter="done">Done</button> ' +
      '<button class="btn btn-small" type="button" data-autonomy-filter="failed">Failed</button> ' +
      '<button class="btn btn-small" type="button" data-autonomy-filter="skipped">Skipped</button>' +
      '</p>' +
      '<p id="autonomyTaskStatus" aria-live="polite"></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Task</th><th>Agent</th><th>Kind</th><th>Priority</th><th>Status</th><th>Attempts</th><th>Scheduled for</th><th>Created</th><th>Action</th></tr></thead><tbody id="autonomyTaskList"></tbody></table></div>' +
      '<h3>Review reports</h3>' +
      '<p class="muted">Reports are generated from real task and account data. Traffic inside a report is “Data unavailable” until a GA4 Data API is authorized.</p>' +
      '<div class="field"><label for="autonomyReportKind">Report kind</label>' +
      '<select id="autonomyReportKind"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>' +
      '<p><button class="btn btn-primary" type="button" id="autonomyGenerateReportBtn">Generate Report</button></p>' +
      '<p id="autonomyReportStatus" aria-live="polite"></p>' +
      '<ul class="clean" id="autonomyReportList"></ul>' +
      '<h3>Publishing rules</h3>' +
      '<p class="muted">Only the values below are allowed. Publishing mode stays “approved only” — nothing publishes without owner approval.</p>' +
      '<form id="autonomySettingsForm" class="form-grid">' +
      '<div class="field"><label for="autonomyLevel">Autonomy level</label>' +
      '<select id="autonomyLevel"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>' +
      '<div class="field"><label for="autonomyMaxArticles">Max articles per day (0–3)</label>' +
      '<select id="autonomyMaxArticles"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>' +
      '<div class="field"><label for="autonomyPublishingMode">Publishing mode</label>' +
      '<select id="autonomyPublishingMode"><option value="approved_only">Approved only</option></select></div>' +
      '<div class="field"><label for="autonomySocialAutoPost">Social auto-post</label>' +
      '<select id="autonomySocialAutoPost"><option value="off">Off</option></select></div>' +
      '<div class="field"><label for="autonomyAutoResearch">Auto-research</label>' +
      '<select id="autonomyAutoResearch"><option value="off">Off</option><option value="on">On</option></select></div>' +
      '<div class="field"><label for="autonomyAutoGeneration">Auto-generation</label>' +
      '<select id="autonomyAutoGeneration"><option value="off">Off</option><option value="on">On</option></select></div>' +
      '<div class="field"><label for="autonomyAutoFactcheck">Auto-fact-check</label>' +
      '<select id="autonomyAutoFactcheck"><option value="off">Off</option><option value="on">On</option></select></div>' +
      '<div class="field"><label for="autonomyAutoCorrection">Auto-correction</label>' +
      '<select id="autonomyAutoCorrection"><option value="off">Off</option><option value="on">On</option></select></div>' +
      '<div class="field"><label for="autonomyAutoPublishing">Auto-publishing</label>' +
      '<select id="autonomyAutoPublishing"><option value="off">Off</option><option value="on">On</option></select></div>' +
      '<div class="form-span"><button class="btn btn-primary" type="submit">Save publishing rules</button></div>' +
      '</form>' +
      '<p class="muted">Auto switches are off by default. Turning auto-publishing on only arms the gate — nothing publishes while publishing mode is “approved only”.</p>' +
      '<p id="autonomySettingsStatus" aria-live="polite"></p>' +
      '<h3>Account Management Center</h3>' +
      '<p class="muted">Real account states from the API. A check (✓) means that step is done; a dash (—) means it is not. ' +
      'Facebook, WhatsApp Business and Business Email are pending owner authorization — nothing is created or connected for them here.</p>' +
      '<p id="autonomyAccountStatus" aria-live="polite"></p>' +
      '<div class="table-scroll"><table><thead><tr><th>Account</th><th>Prepared</th><th>Created</th><th>Ownership Verified</th><th>Connected</th><th>API Authorized</th><th>Publishing Enabled</th><th>Note</th></tr></thead><tbody id="autonomyAccountList"></tbody></table></div>';
    var agents = el('section-agents');
    if (agents && agents.parentNode === content) {
      content.insertBefore(sec, agents.nextSibling);
    } else {
      content.appendChild(sec);
    }
    bindControls();
  }

  // Tell the Control Center (dashboard.js) that autonomy data changed,
  // so it re-fetches queue / failed-task / automation blocks instead of
  // showing stale counts until a reload. Same fsai:* window-event
  // convention as the Emergency Stop sync above. One-way only:
  // dashboard.js never dispatches this event, so there is no loop.
  function notifyControlCenter() {
    try { window.dispatchEvent(new CustomEvent('fsai:autonomy-refreshed')); } catch (e) {}
  }

  /* --- Control Center: recent activity (W5) ---
     Latest agent runs from GET /api/analytics/detail?section=activity,
     rendered into the Control Center section dashboard.js owns
     (#ccActivityList). Fallback: the latest tasks from the autonomy
     endpoint, honestly labelled as the task list — never invented runs. */
  function loadControlCenterActivity() {
    api('/api/analytics/detail?section=activity').then(function (r) {
      var list = el('ccActivityList');
      if (r.ok && r.data && Array.isArray(r.data.data)) {
        var runs = r.data.data;
        if (list) {
          list.innerHTML = runs.map(function (run) {
            return '<li><strong>' + esc(run.agent || '') + '</strong> — ' + esc(run.outcome || '') + ' ' + statusPill(run.outcome) +
              ' <span class="muted">' + fmtDate(run.startedAt) + (run.reason ? ' — ' + esc(String(run.reason).slice(0, 120)) : '') + '</span></li>';
          }).join('') || '<li>No agent runs recorded yet.</li>';
        }
        setText('ccActivityStatus', runs.length + ' latest run(s) from the API.');
        return;
      }
      api('/api/autonomy/tasks?limit=10').then(function (r2) {
        if (!r2.ok) {
          if (list) list.innerHTML = '<li>Recent activity: Data unavailable — ' + esc(apiError(r2)) + '</li>';
          setText('ccActivityStatus', 'Could not load recent activity.');
          return;
        }
        var tasks = (r2.data && r2.data.tasks) || [];
        if (list) {
          list.innerHTML = tasks.map(function (t) {
            return '<li><strong>' + esc(t.agent || '') + '</strong> — ' + esc(t.kind || '') + ' ' + statusPill(t.status) +
              ' <span class="muted">task #' + esc(String(t.id)) + ' · ' + fmtDate(t.updated_at || t.created_at) + '</span></li>';
          }).join('') || '<li>No tasks recorded yet.</li>';
        }
        setText('ccActivityStatus', 'Activity endpoint not wired yet — showing the latest tasks instead.');
      }).catch(function () { setText('ccActivityStatus', 'Could not reach the FS AI server.'); });
    }).catch(function () { setText('ccActivityStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- Status + agents (GET /api/autonomy/status) --- */
  // syncMessage=true when re-fetching because the OTHER section toggled:
  // the message line must match the server state too — the same
  // stale-message defect as dashboard.js, mirror image (the live
  // check only exercised the other direction: loadStatus() refreshed
  // state/button/KPI but never autonomyControlStatus, so a toggle
  // from AI Agent Control left the old message standing). The click
  // handler below sets the message itself, and every other
  // loadStatus() caller leaves the message to the action that
  // triggered it, so only the event-driven refresh syncs it here.
  function loadStatus(syncMessage) {
    setText('autonomyStatus', 'Loading autonomy status…');
    api('/api/autonomy/status').then(function (r) {
      var grid = el('autonomyKpiGrid');
      var list = el('autonomyAgentList');
      if (!r.ok) {
        setText('autonomyStatus', apiError(r));
        if (grid) grid.innerHTML = '';
        if (list) list.innerHTML = '';
        return;
      }
      var d = r.data || {};
      var tasks = d.tasks || {};
      var num = function (v) { return (v == null || isNaN(Number(v))) ? '—' : String(Number(v)); };
      emergencyStopped = !!d.emergencyStop;
      var stopState = el('autonomyStopState');
      var stopBtn = el('autonomyStopBtn');
      if (stopState) stopState.textContent = emergencyStopped ? 'ON — agent runs are blocked (423)' : 'OFF — agent runs allowed';
      if (stopBtn) { stopBtn.disabled = false; stopBtn.textContent = emergencyStopped ? 'Turn Emergency Stop OFF' : 'Turn Emergency Stop ON'; }
      if (syncMessage) setText('autonomyControlStatus', 'Emergency Stop is now ' + (emergencyStopped ? 'ON.' : 'OFF.'));
      setText('autonomyStatus', 'Status from the live API' + (d.source ? ' (source: ' + d.source + ')' : '') + '.');
      var level = d.autonomyLevel != null ? String(d.autonomyLevel) : '—';
      var target = d.targetLevel != null ? String(d.targetLevel) : '3';
      var cards = [
        { label: 'Autonomy level', value: level + ' of target ' + target, note: 'Target level is 3' },
        { label: 'Emergency Stop', value: emergencyStopped ? 'ON' : 'OFF', note: emergencyStopped ? 'Agent runs are blocked (423)' : 'Agent runs allowed' },
        { label: 'Tasks queued', value: num(tasks.queued), note: 'Waiting to run' },
        { label: 'Tasks running', value: num(tasks.running), note: 'In progress now' },
        { label: 'Tasks done', value: num(tasks.done), note: 'Completed' },
        { label: 'Tasks failed', value: num(tasks.failed), note: 'Failed — see the task queue' },
        { label: 'Tasks skipped', value: num(tasks.skipped), note: 'Skipped by the workflow' },
        { label: 'Revenue', value: d.revenue != null ? String(d.revenue) : '$0.00', note: 'Zero-cost platform — no paid services, no sales yet' },
        { label: 'Traffic', value: d.traffic != null ? String(d.traffic) : 'Data unavailable', note: 'No GA4 Data API is authorized yet' },
        { label: 'Last backup', value: d.lastBackup ? fmtDate(d.lastBackup.finishedAt) : 'Never', note: d.lastBackup ? (d.lastBackup.rowsExported + ' row(s) in ' + d.lastBackup.tablesExported + ' table(s)') : 'No successful backup recorded yet — use “Run backup now” below' },
      ];
      // Auto switches: ON/OFF per automation, what each one gates, and
      // why it is off. (Added 2026-11-20 — the flags existed in the
      // status payload but were never shown.) Auto-publishing stays off
      // while publishing mode is approved-only, regardless of its flag.
      var flags = d.autoFlags || {};
      var flagMeta = [
        { key: 'auto_research', label: 'Auto-research', gates: 'daily feed fetching' },
        { key: 'auto_generation', label: 'Auto-generation', gates: 'draft creation from fresh research' },
        { key: 'auto_factcheck', label: 'Auto-fact-check', gates: 'claim checking in the daily workflow' },
        { key: 'auto_correction', label: 'Auto-correction', gates: 'rewriting failed claims from evidence' },
        { key: 'auto_publishing', label: 'Auto-publishing', gates: 'publishing gate-passed articles' },
      ];
      flagMeta.forEach(function (f) {
        var on = flags[f.key] === 'on';
        cards.push({
          label: f.label, value: on ? 'ON' : 'OFF',
          note: on ? 'Gates ' + f.gates + ' — runs in the daily workflow.'
            : 'Off — ' + f.gates + ' does not run automatically.' +
              (f.key === 'auto_publishing' ? ' Publishing stays approved-only regardless.' : ''),
        });
      });
      if (grid) {
        grid.innerHTML = cards.map(function (c) {
          return '<div class="card kpi-card"><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note) + '</p></div>';
        }).join('');
      }
      var agents = d.agents || [];
      var lastRuns = d.lastRuns || {};
      if (list) {
        list.innerHTML = agents.map(function (a) {
          var lr = lastRuns[a.id] || null;
          var lastLine = lr
            // The step label (e.g. 'fact-check-run' vs 'correction-run')
            // is what tells the two 'fact-checking' steps apart — the
            // correction step's "auto_correction is off" note used to
            // show under Fact-Checking (minor fix A).
            ? ' <span class="muted">— last run ' + fmtDate(lr.startedAt) + ': ' + (lr.step ? esc(lr.step) + ' — ' : '') + esc(lr.outcome) + (lr.reason ? ' (' + esc(lr.reason) + ')' : '') + '</span>'
            : ' <span class="muted">— no run recorded yet</span>';
          var disabledNote = '';
          if (a.status === 'paused') disabledNote = ' <span class="muted">(paused by owner — resume it to run)</span>';
          else if (a.status === 'disabled') disabledNote = ' <span class="muted">(disabled)</span>';
          else if (a.status === 'not-in-registry') disabledNote = ' <span class="muted">(preparation only — no posting)</span>';
          return '<li><strong>' + esc(a.role || a.id || a.name || 'Agent') + '</strong>' +
            (a.id && a.role ? ' <span class="muted">(' + esc(a.id) + ')</span>' : '') +
            ' ' + statusPill(a.status) + disabledNote + lastLine + '</li>';
        }).join('') || '<li>No agents reported by the API.</li>';
      }
      notifyControlCenter();
    }).catch(function () { setText('autonomyStatus', 'Could not reach the FS AI server.'); });
  }

  // Tell the other dashboard sections that the E-Stop state changed, so
  // they re-fetch and re-render instead of showing a stale ON/OFF until
  // a full page reload. Live 2026-11-19: toggling here left the AI Agent
  // Control section (dashboard.js) stale, and vice versa. Uses the
  // codebase's existing fsai:* window-event convention. No new state
  // source: every listener re-fetches from the server with its own loader.
  function notifyEmergencyStopChanged() {
    try { window.dispatchEvent(new CustomEvent('fsai:emergency-stop-changed')); } catch (e) {}
  }

  /* --- LLM provider status (GET /api/autonomy/llm) --- */
  function loadLlm() {
    setText('autonomyLlmStatus', 'Loading LLM provider status…');
    api('/api/autonomy/llm').then(function (r) {
      if (!r.ok) {
        setText('autonomyLlmStatus', apiError(r));
        return;
      }
      var d = r.data || {};
      var providers = d.providers || [];
      if (!providers.length) {
        setText('autonomyLlmStatus', 'No LLM providers reported by the API. Article generation: paused.');
        return;
      }
      var lines = providers.map(function (p) {
        var usage = p.todayUsage || {};
        var used = '';
        // Phase 3, Priority 7: the header re-reads live usage after
        // every task run (see runTask/runWeekly/daily below) — the old
        // code called loadLlm() only once at dashboard init, so the
        // header froze at a stale snapshot (55) while D1 showed 259.
        // Neuron figures are ESTIMATES unless provider-reported; the
        // estimated part is labelled, never silently presented as exact.
        if (p.id === 'workers-ai' && usage.neurons != null) used = ' — ' + usage.neurons + ' of 10,000 free Neurons used today' + (usage.neuronsEstimated ? ' (' + usage.neuronsEstimated + ' estimated)' : '');
        else if (p.id === 'groq' && usage.tokensIn != null) used = ' — ' + ((usage.tokensIn || 0) + (usage.tokensOut || 0)) + ' of 200,000 free tokens used today';
        else if (p.id === 'gemini' && usage.requests != null) used = ' — ' + usage.requests + ' free-tier requests used today';
        return 'Provider: ' + (p.name || p.id) + ' — ' + (p.status || 'unknown') + used +
          (p.detail ? ' (' + p.detail + ')' : '');
      });
      var gen = d.generationPaused
        ? 'Article generation: paused' + (d.reason ? ' — ' + d.reason : '')
        : 'Article generation: active' + (d.reason ? ' — ' + d.reason : '');
      setText('autonomyLlmStatus', lines.join(' | ') + '. ' + gen + '.');
    }).catch(function () { setText('autonomyLlmStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- Task queue (GET /api/autonomy/tasks) --- */
  function loadTasks() {
    var q = '?limit=50' + (taskFilter ? '&status=' + encodeURIComponent(taskFilter) : '');
    setText('autonomyTaskStatus', 'Loading tasks…');
    api('/api/autonomy/tasks' + q).then(function (r) {
      var list = el('autonomyTaskList');
      if (!r.ok) {
        setText('autonomyTaskStatus', apiError(r));
        if (list) list.innerHTML = '';
        return;
      }
      var tasks = r.data.tasks || [];
      var total = r.data.total != null ? r.data.total : tasks.length;
      setText('autonomyTaskStatus', total + ' task(s)' + (taskFilter ? ' with status “' + taskFilter + '”' : '') + '.');
      queuedTasks = tasks.filter(function (t) { return t.status === 'queued'; });
      fillTaskSelect();
      if (!list) return;
      list.innerHTML = tasks.map(function (t) {
        var runBtn = t.status === 'queued'
          ? '<button class="btn btn-small" type="button" data-autonomy-run="' + esc(String(t.id)) + '">Run</button>'
          : '';
        var retryBtn = t.status === 'failed'
          ? '<button class="btn btn-small" type="button" data-autonomy-retry="' + esc(String(t.id)) + '">Retry</button>'
          : '';
        // Phase 4: a running task can be cancelled (it lands in
        // 'failed' and becomes retryable). Run/Retry are unchanged.
        var cancelBtn = t.status === 'running'
          ? '<button class="btn btn-small" type="button" data-autonomy-cancel="' + esc(String(t.id)) + '">Cancel</button>'
          : '';
        return '<tr><td>' + esc(String(t.id)) + '</td><td>' + esc(t.agent || '') + '</td><td>' + esc(t.kind || '') + '</td>' +
          '<td>' + esc(t.priority == null ? '' : String(t.priority)) + '</td><td>' + statusPill(t.status) + '</td>' +
          '<td>' + esc((t.attempts == null ? '0' : String(t.attempts)) + ' / ' + (t.max_attempts == null ? '—' : String(t.max_attempts))) + '</td>' +
          '<td>' + fmtDate(t.scheduled_for) + '</td><td>' + fmtDate(t.created_at) + '</td><td>' + runBtn + retryBtn + cancelBtn + '</td></tr>';
      }).join('') || '<tr><td colspan="9">No tasks found.</td></tr>';
    }).catch(function () { setText('autonomyTaskStatus', 'Could not reach the FS AI server.'); });
  }

  function fillTaskSelect() {
    var sel = el('autonomyTaskSelect');
    if (!sel) return;
    if (!queuedTasks.length) {
      sel.innerHTML = '<option value="">No queued tasks</option>';
      return;
    }
    sel.innerHTML = queuedTasks.map(function (t) {
      return '<option value="' + esc(String(t.id)) + '">' + esc(String(t.id) + ' — ' + (t.kind || '') + ' (' + (t.agent || '') + ')') + '</option>';
    }).join('');
  }

  // Phase 4: never re-fire a manual run while one is already in
  // flight for the same task — the duplicate used to surface as a
  // 409 while the real run was still in progress. A 202 in-flight
  // answer from the server is shown as "already running", not an error.
  function runTask(id, statusElId, btn) {
    if (!id) { setText(statusElId, 'Select a queued task first.'); return; }
    if (inFlightTasks[id]) { setText(statusElId, 'Task ' + id + ' is already running — wait for it to finish, or cancel it from the task queue.'); return; }
    inFlightTasks[id] = true;
    if (btn) btn.disabled = true;
    setText(statusElId, 'Running task ' + id + '…');
    api('/api/autonomy/tasks/' + encodeURIComponent(id) + '/run', { method: 'POST' }).then(function (r) {
      delete inFlightTasks[id];
      if (btn) btn.disabled = false;
      if (r.data && r.data.inFlight) {
        setText(statusElId, 'Task ' + id + ' is already running' + (r.data.updatedAt ? ' (since ' + r.data.updatedAt + ')' : '') + ' — wait for it to finish, or cancel it from the task queue.');
        loadTasks();
        return;
      }
      if (!r.ok) {
        setText(statusElId, apiError(r) + (r.data && r.data.recoveredStale ? ' The stale lock was recovered — click Retry to run it again.' : ''));
        if (r.data && r.data.recoveredStale) loadTasks();
        return;
      }
      var result = r.data.result || {};
      var outcome = r.data.outcome || result.outcome || 'done';
      var detail = result.reason || result.error || result.message || result.note || '';
      if (result && result.noop) detail = result.reason || result.message || 'nothing to do';
      // The run ID is shown so the owner can copy it into "Convert a
      // content scaffold to a draft" below; an AI draft is flagged so the
      // owner knows the run produced a draft (never auto-published).
      var runPart = r.data.runId != null ? ' (run #' + r.data.runId + ')' : '';
      var draftPart = (result && result.draft)
        ? ' — AI draft ready. Convert run #' + r.data.runId + ' to a CMS draft below.'
        : '';
      setText(statusElId, 'Task ' + id + ': ' + outcome + runPart + (detail ? ' — ' + detail : '') + draftPart +
        (result && result.articleId ? ' (article #' + result.articleId + ')' : '') +
        (r.data.cancelledDuringRun ? ' — note: the task was cancelled while this run was finishing, so the cancel stands.' : ''));
      loadTasks();
      loadStatus();
      loadPipeline();
      loadLlm(); // Phase 3, P7: a task run can consume LLM usage — re-read the header instead of leaving a stale snapshot.
    }).catch(function () {
      delete inFlightTasks[id];
      if (btn) btn.disabled = false;
      setText(statusElId, 'Could not reach the FS AI server.');
    });
  }

  // Phase 4: cancel a running task — it lands in 'failed' and can be
  // retried. Only running tasks have a Cancel button.
  function cancelTask(id, statusElId, btn) {
    if (!id) return;
    if (btn) btn.disabled = true;
    setText(statusElId, 'Cancelling task ' + id + '…');
    api('/api/autonomy/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
      setText(statusElId, 'Task ' + id + ' cancelled — it is now failed and can be retried.');
      loadTasks();
      loadStatus();
      loadPipeline();
    }).catch(function () {
      if (btn) btn.disabled = false;
      setText(statusElId, 'Could not reach the FS AI server.');
    });
  }

  // Phase 4: recover every task stuck 'running' past the 10-minute
  // lease. Each recovered task is marked failed so it can be retried.
  function recoverStaleTasks(statusElId, btn) {
    if (btn) btn.disabled = true;
    setText(statusElId, 'Recovering stale running tasks…');
    api('/api/autonomy/tasks/recover-stale', { method: 'POST' }).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
      var recovered = r.data.recovered || [];
      var msg = recovered.length
        ? 'Recovered ' + recovered.length + ' stale task(s) — now failed, retry them from the task queue: ' + recovered.map(function (t) { return '#' + t.taskId + ' (' + (t.agent || '') + ')'; }).join(', ') + '.'
        : 'No stale running tasks found — nothing to recover.';
      setText(statusElId, msg);
      loadTasks();
      loadStatus();
    }).catch(function () {
      if (btn) btn.disabled = false;
      setText(statusElId, 'Could not reach the FS AI server.');
    });
  }

  function retryTask(id, statusElId) {
    if (!id) return;
    setText(statusElId, 'Retrying task ' + id + '…');
    api('/api/autonomy/tasks/' + encodeURIComponent(id) + '/retry', { method: 'POST' }).then(function (r) {
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
      setText(statusElId, 'Task ' + id + ' is queued again (attempts reset).');
      loadTasks();
      loadStatus();
      loadPipeline();
    }).catch(function () { setText(statusElId, 'Could not reach the FS AI server.'); });
  }

  /* --- Reports (GET/POST /api/autonomy/reports) --- */
  // Stringify a report summary value readably. The old code did
  // `k + ': ' + parsed[k]` on the raw summary object, so nested objects
  // (steps, counts) rendered as "[object Object]" in the 19 Nov daily
  // report. Fixed 2026-11-20: objects render as `key: value` pairs
  // (one level deep for steps: `name: outcome`), never [object Object].
  function stringifyReportValue(v, depth) {
    if (v == null) return '—';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(function (x) { return stringifyReportValue(x, (depth || 0) + 1); }).join(', ');
    if (typeof v === 'object') {
      if (v.outcome != null) return String(v.outcome) + (v.error ? ' — ' + String(v.error).slice(0, 120) : '');
      if ((depth || 0) >= 2) return JSON.stringify(v).slice(0, 120);
      return Object.keys(v).map(function (k) { return k + ': ' + stringifyReportValue(v[k], (depth || 0) + 1); }).join('; ');
    }
    return String(v);
  }

  function reportSummaryText(rep) {
    var s = rep.summary_json;
    if (s == null) return '';
    if (typeof s === 'string') {
      try {
        var parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object') {
          if (parsed.summary) return String(parsed.summary);
          return Object.keys(parsed).map(function (k) { return k + ': ' + stringifyReportValue(parsed[k], 1); }).join(', ');
        }
        return s;
      } catch (e) { return s; }
    }
    if (typeof s === 'object') {
      if (s.summary) return String(s.summary);
      return Object.keys(s).map(function (k) { return k + ': ' + stringifyReportValue(s[k], 1); }).join(', ');
    }
    return String(s);
  }

  function loadReports() {
    var kind = el('autonomyReportKind');
    var k = kind && kind.value ? kind.value : 'daily';
    api('/api/autonomy/reports?kind=' + encodeURIComponent(k) + '&limit=10').then(function (r) {
      var list = el('autonomyReportList');
      if (!r.ok) {
        setText('autonomyReportStatus', apiError(r));
        if (list) list.innerHTML = '';
        return;
      }
      var reps = r.data.reports || [];
      setText('autonomyReportStatus', reps.length + ' ' + k + ' report(s) from the API.');
      if (!list) return;
      list.innerHTML = reps.map(function (rep) {
        var summary = reportSummaryText(rep);
        return '<li><strong>' + esc(rep.kind || k) + ' — ' + fmtDate(rep.date || rep.created_at) + '</strong>' +
          (summary ? '<br><span class="muted">' + esc(summary).slice(0, 300) + '</span>' : '') +
          ' <span class="muted">(' + fmtDate(rep.created_at) + ')</span></li>';
      }).join('') || '<li>No reports yet for this kind.</li>';
    }).catch(function () { setText('autonomyReportStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- Publishing rules (GET/POST /api/autonomy/settings) --- */
  function loadSettings() {
    api('/api/autonomy/settings').then(function (r) {
      if (!r.ok) { setText('autonomySettingsStatus', apiError(r)); return; }
      var s = r.data.settings || r.data || {};
      var set = function (id, v) { var n = el(id); if (n && v != null) n.value = String(v); };
      set('autonomyLevel', s.autonomy_level);
      set('autonomyMaxArticles', s.max_articles_per_day);
      set('autonomyPublishingMode', s.publishing_mode);
      set('autonomySocialAutoPost', s.social_auto_post);
      set('autonomyAutoResearch', s.auto_research);
      set('autonomyAutoGeneration', s.auto_generation);
      set('autonomyAutoFactcheck', s.auto_factcheck);
      set('autonomyAutoCorrection', s.auto_correction);
      set('autonomyAutoPublishing', s.auto_publishing);
    }).catch(function () { setText('autonomySettingsStatus', 'Could not reach the FS AI server.'); });
  }

  function saveSettings() {
    var level = el('autonomyLevel');
    var max = el('autonomyMaxArticles');
    var mode = el('autonomyPublishingMode');
    var social = el('autonomySocialAutoPost');
    var pairs = [
      { key: 'autonomy_level', value: level ? level.value : '' },
      { key: 'max_articles_per_day', value: max ? max.value : '' },
      { key: 'publishing_mode', value: mode ? mode.value : '' },
      { key: 'social_auto_post', value: social ? social.value : '' },
      { key: 'auto_research', value: el('autonomyAutoResearch') ? el('autonomyAutoResearch').value : '' },
      { key: 'auto_generation', value: el('autonomyAutoGeneration') ? el('autonomyAutoGeneration').value : '' },
      { key: 'auto_factcheck', value: el('autonomyAutoFactcheck') ? el('autonomyAutoFactcheck').value : '' },
      { key: 'auto_correction', value: el('autonomyAutoCorrection') ? el('autonomyAutoCorrection').value : '' },
      { key: 'auto_publishing', value: el('autonomyAutoPublishing') ? el('autonomyAutoPublishing').value : '' },
    ];
    var allowed = {
      autonomy_level: ['1', '2', '3'],
      max_articles_per_day: ['0', '1', '2', '3'],
      publishing_mode: ['approved_only'],
      social_auto_post: ['off'],
      auto_research: ['on', 'off'],
      auto_generation: ['on', 'off'],
      auto_factcheck: ['on', 'off'],
      auto_correction: ['on', 'off'],
      auto_publishing: ['on', 'off'],
    };
    var bad = pairs.filter(function (p) { return allowed[p.key].indexOf(String(p.value)) === -1; });
    if (bad.length) {
      setText('autonomySettingsStatus', 'Not saved — an unsupported value was selected for: ' + bad.map(function (p) { return p.key; }).join(', ') + '.');
      return;
    }
    setText('autonomySettingsStatus', 'Saving publishing rules…');
    var done = 0;
    var failures = [];
    pairs.forEach(function (p) {
      api('/api/autonomy/settings', { method: 'POST', body: { key: p.key, value: p.value } }).then(function (r) {
        done += 1;
        if (!r.ok) failures.push(p.key + ': ' + apiError(r));
        if (done === pairs.length) {
          setText('autonomySettingsStatus', failures.length
            ? 'Some rules were not saved — ' + failures.join(' ')
            : 'Publishing rules saved (autonomy level ' + pairs[0].value + ', max ' + pairs[1].value + ' article(s) per day, publishing ' + pairs[2].value + ', social auto-post ' + pairs[3].value + ').');
        }
      }).catch(function () {
        done += 1;
        failures.push(p.key + ': could not reach the server.');
        if (done === pairs.length) setText('autonomySettingsStatus', 'Some rules were not saved — ' + failures.join(' '));
      });
    });
  }

  /* --- Account Management Center (GET /api/autonomy/accounts) --- */
  function loadAccounts() {
    setText('autonomyAccountStatus', 'Loading accounts…');
    api('/api/autonomy/accounts').then(function (r) {
      var list = el('autonomyAccountList');
      if (!r.ok) {
        setText('autonomyAccountStatus', apiError(r));
        if (list) list.innerHTML = '';
        return;
      }
      var accounts = r.data.accounts || [];
      setText('autonomyAccountStatus', accounts.length + ' account(s) from the API. A check (✓) means that step is done; a dash (—) means it is not.');
      if (!list) return;
      list.innerHTML = accounts.map(function (a) {
        var st = a.states || {};
        var pending = isPendingOwnerAccount(a);
        var cells = pending
          ? ['—', '—', '—', '—', '—', '—']
          : [mark(st.prepared), mark(st.created), mark(st.ownershipVerified), mark(st.connected), mark(st.apiAuthorized), mark(st.publishingEnabled)];
        var note = pending ? 'Pending Owner Authorization' : (a.note || '');
        var name = a.platform || a.handle || a.id || 'Account';
        var handle = a.url
          ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.handle || name) + '</a>'
          : esc(a.handle || name);
        return '<tr><td><strong>' + esc(name) + '</strong><br>' + handle + '</td>' +
          cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') +
          '<td>' + esc(note) + '</td></tr>';
      }).join('') || '<tr><td colspan="8">No accounts reported by the API.</td></tr>';
    }).catch(function () { setText('autonomyAccountStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- Research sources (GET/POST /api/autonomy/sources) --- */
  function loadSources() {
    setText('autonomySourceStatus', 'Loading research sources…');
    api('/api/autonomy/sources').then(function (r) {
      var list = el('autonomySourceList');
      if (!r.ok) {
        setText('autonomySourceStatus', apiError(r));
        if (list) list.innerHTML = '';
        return;
      }
      var sources = r.data.sources || [];
      var active = sources.filter(function (s) { return s.is_active; }).length;
      setText('autonomySourceStatus', sources.length + ' source(s), ' + active + ' active. A source that fails keeps its last error here.');
      if (!list) return;
      list.innerHTML = sources.map(function (s) {
        var fetchBtn = '<button class="btn btn-small" type="button" data-autonomy-source-fetch="' + esc(String(s.id)) + '">Fetch now</button>';
        var toggleBtn = '<button class="btn btn-small" type="button" data-autonomy-source-toggle="' + esc(String(s.id)) + '" data-autonomy-source-active="' + (s.is_active ? '1' : '0') + '">' + (s.is_active ? 'Disable' : 'Enable') + '</button>';
        return '<tr><td><strong>' + esc(s.name || '') + '</strong><br><span class="muted">' + esc(s.url || '') + '</span></td>' +
          '<td>' + esc(s.division || '') + '</td><td>' + statusPill(s.is_active ? (s.last_status || 'active') : 'disabled') + '</td>' +
          '<td>' + fmtDate(s.last_fetched_at) + '</td><td>' + esc(s.last_error || '—') + '</td>' +
          '<td>' + esc(s.items_discovered == null ? '—' : String(s.items_discovered)) + '</td>' +
          '<td>' + esc(s.duplicates_found == null ? '—' : String(s.duplicates_found)) + '</td>' +
          '<td>' + fetchBtn + ' ' + toggleBtn + '</td></tr>';
      }).join('') || '<tr><td colspan="8">No research sources configured.</td></tr>';
    }).catch(function () { setText('autonomySourceStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- Fact-check queue, publish gate + operations analytics --- */
  function loadPipeline() {
    setText('autonomyPipelineStatus', 'Loading drafts and gate results…');
    api('/api/autonomy/analytics').then(function (r) {
      var list = el('autonomyPipelineList');
      var grid = el('autonomyAnalyticsGrid');
      if (!r.ok) {
        setText('autonomyPipelineStatus', apiError(r));
        if (list) list.innerHTML = '';
        if (grid) grid.innerHTML = '';
        return;
      }
      var d = r.data || {};
      var drafts = d.drafts || [];
      setText('autonomyPipelineStatus', drafts.length + ' draft(s) awaiting review. “Ready” = content checks pass; the article still waits for owner approval.');
      if (list) {
        list.innerHTML = drafts.map(function (a) {
          var gate = a.contentReady ? 'Ready' : 'Blocked';
          var blocked = (a.blockedBy || []).slice(0, 2).join('; ');
          var id = esc(String(a.id));
          // Protected articles (Fix 1): no automatic modification.
          // Fact-check, Re-check and SEO Check are advisory/check-only
          // and stay available; Correct and Optimize SEO are disabled
          // here (the server also refuses them with 403). Fetch evidence
          // is read-only research (migration 029) — it fetches a
          // recorded source page and stores its text as evidence; it
          // never modifies the article body, so it stays available for
          // protected drafts too.
          var prot = a.isProtected ? '<br><strong>PROTECTED — AUTOMATIC MODIFICATION DISABLED</strong>' : '';
          var fcBtn = '<button class="btn btn-small" type="button" data-autonomy-factcheck="' + id + '">Fact-check</button>';
          var recheckBtn = '<button class="btn btn-small" type="button" data-autonomy-recheck="' + id + '">Re-check</button>';
          var fetchEvBtn = '<button class="btn btn-small" type="button" data-autonomy-fetch-evidence="' + id + '">Fetch evidence</button>';
          var corrBtn = a.isProtected
            ? '<button class="btn btn-small" type="button" disabled title="Protected — automatic modification disabled">Correct</button>'
            : '<button class="btn btn-small" type="button" data-autonomy-correct="' + id + '">Correct</button>';
          var seoCheckBtn = '<button class="btn btn-small" type="button" data-autonomy-seo-check="' + id + '">SEO Check</button>';
          var seoOptBtn = a.isProtected
            ? '<button class="btn btn-small" type="button" disabled title="Protected — automatic modification disabled">Optimize SEO</button>'
            : '<button class="btn btn-small" type="button" data-autonomy-seo-optimize="' + id + '">Optimize SEO</button>';
          var reviewBtn = '<button class="btn btn-small" type="button" data-autonomy-review="' + id + '">Review</button>';
          var detailBtn = '<button class="btn btn-small" type="button" data-autonomy-fc-detail="' + id + '">Details</button>';
          return '<tr><td><strong>' + esc(a.title || '') + '</strong><br><span class="muted">#' + id + ' · ' + esc(a.division || '') + '</span>' + prot + '</td>' +
            '<td>' + statusPill(a.status) + '</td><td>' + statusPill(gate) + '</td>' +
            '<td>' + esc(blocked || '—') + '</td><td>' + fcBtn + ' ' + recheckBtn + ' ' + fetchEvBtn + ' ' + corrBtn + ' ' + seoCheckBtn + ' ' + seoOptBtn + ' ' + reviewBtn + ' ' + detailBtn + '</td></tr>';
        }).join('') || '<tr><td colspan="5">No drafts — nothing waiting for review.</td></tr>';
      }
      if (grid) {
        var byStatus = d.articlesByStatus || {};
        var cards = [
          { label: 'Articles published', value: String(byStatus.published || 0), note: 'Live on the site' },
          { label: 'Drafts', value: String(byStatus.draft || 0), note: 'Awaiting review' },
          { label: 'Published today', value: String(d.publishedToday != null ? d.publishedToday : '—'), note: 'UTC day, from D1' },
          { label: 'LLM calls today', value: String((d.llmToday && d.llmToday.calls) || 0), note: ((d.llmToday && d.llmToday.neurons) || 0) + ' Neurons today (free allowance 10,000/day)' + ((d.llmToday && d.llmToday.neuronsEstimated) ? ' — ' + d.llmToday.neuronsEstimated + ' estimated' : '') },
          { label: 'LLM calls (7 days)', value: String((d.llm7d && d.llm7d.calls) || 0), note: ((d.llm7d && d.llm7d.neurons) || 0) + ' Neurons in 7 days' },
          { label: 'Failed tasks', value: String((d.failedTasks || []).length), note: 'Retry them from the task queue' },
          { label: 'Research sources', value: String((d.research && d.research.activeSources) || 0), note: ((d.research && d.research.itemsDiscovered) || 0) + ' items discovered in total' },
          { label: 'Traffic', value: 'Data unavailable', note: 'GA4: Tracking Connected — Reporting API Not Connected' },
        ];
        grid.innerHTML = cards.map(function (c) {
          return '<div class="card kpi-card"><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note) + '</p></div>';
        }).join('');
      }
      setText('autonomyBackupStatus', 'Backup status comes from the status section above. “Run backup now” exports the database and records the run.');
      notifyControlCenter();
    }).catch(function () { setText('autonomyPipelineStatus', 'Could not reach the FS AI server.'); });
  }

  // Per-article detail: fact-check claims + the 10 publish-gate checks
  // + the 11 SEO checks, with the four states spelled out separately
  // (content-ready vs fact-check-passed vs SEO-passed vs eligible vs
  // authorized). Content-ready is NOT automatically eligible, and
  // eligible is NOT automatically authorized — the article still waits
  // for owner approval while publishing mode is "approved only".
  // (Extended 2026-11-20: gate + SEO detail were invisible before.)
  function loadFactCheckDetail(articleId) {
    setText('autonomyFactCheckDetail', 'Loading detail for article #' + articleId + '…');
    Promise.all([
      api('/api/autonomy/fact-checks?article_id=' + encodeURIComponent(articleId)),
      api('/api/autonomy/gate?article_id=' + encodeURIComponent(articleId)),
      api('/api/autonomy/seo?article_id=' + encodeURIComponent(articleId)),
    ]).then(function (rs) {
      var fcRes = rs[0] || {};
      var gateRes = rs[1] || {};
      var seoRes = rs[2] || {};
      var parts = ['Article #' + articleId + ' —'];
      if (fcRes.ok && fcRes.data && fcRes.data.factCheck) {
        var fc = fcRes.data.factCheck;
        var claims = fcRes.data.claims || [];
        var lines = claims.map(function (c) {
          return '[' + c.verdict + '] ' + (c.claim_text || '').slice(0, 120) + (c.evidence_url ? ' — evidence: ' + c.evidence_url : ' — no evidence');
        });
        parts.push('fact-check: ' + fc.verdict + ' (' + fc.claims_verified + '/' + fc.claims_total + ' claims verified, ' + fc.claims_failed + ' failed). ' + lines.join(' | '));
      } else if (fcRes.ok) {
        parts.push('fact-check: no fact-check on record yet.');
      } else {
        parts.push('fact-check: could not load (' + apiError(fcRes) + ').');
      }
      if (gateRes.ok && gateRes.data) {
        var g = gateRes.data;
        var checks = (g.checks || []).map(function (c) {
          return (c.ok ? '✓ ' : '✗ ') + c.name + (c.detail ? ' — ' + c.detail : '');
        });
        parts.push('publish gate (' + (g.contentReady ? 'content-ready' : 'not content-ready') + '): ' + checks.join(' | ') + '.');
        var fcCheck = (g.checks || []).find(function (c) { return c.name === 'fact-check-pass'; }) || {};
        var seoPassCheck = (g.checks || []).find(function (c) { return c.name === 'seo-pass'; }) || {};
        parts.push('States: content-ready ' + (g.contentReady ? 'YES' : 'NO') +
          ' · fact-check passed ' + (fcCheck.ok ? 'YES' : 'NO') +
          ' · SEO passed ' + (seoPassCheck.ok ? 'YES' : 'NO') +
          ' · eligible ' + (g.eligible ? 'YES' : 'NO') +
          ' · authorized to publish ' + (g.eligible ? 'YES' : 'NO') +
          ' (publishing mode is "' + (g.publishingMode || 'approved_only') + '"' +
          (g.eligible ? '' : ' — owner approval is still required') + ').');
      } else {
        parts.push('publish gate: could not load (' + apiError(gateRes) + ').');
      }
      if (seoRes.ok && seoRes.data && seoRes.data.seoCheck) {
        var sc = seoRes.data.seoCheck;
        var seoChecks = (seoRes.data.checks || []).map(function (c) {
          return (c.ok ? '✓ ' : '✗ ') + c.name + (c.detail ? ' — ' + c.detail : '');
        });
        parts.push('SEO (' + sc.verdict + '): ' + seoChecks.join(' | ') + '.');
      } else if (seoRes.ok) {
        parts.push('SEO: no SEO check on record yet — run an SEO task for this article.');
      } else {
        parts.push('SEO: could not load (' + apiError(seoRes) + ').');
      }
      setText('autonomyFactCheckDetail', parts.join(' '));
    }).catch(function () { setText('autonomyFactCheckDetail', 'Could not reach the FS AI server.'); });
  }

  /* --- Per-article actions: re-check, SEO check/optimize, correction
     review, RSS audit (Fixes 4, 5, 6, 9, 10) ---
     Results go to the detail line (autonomyFactCheckDetail) or their
     own status line, so the pipeline table can refresh without erasing
     them (minor C). Every result shows the ACTUAL state from the
     server — completed / already completed / blocked / failed /
     protected — never a blanket success (minor D/E). */

  // Fix 8: say what happened to the sources on a duplicate content
  // task instead of a bare "already existed".
  function sourceMergeText(sm) {
    if (!sm) return '';
    var parts = [];
    if (sm.status === 'sources-added') parts.push((sm.added || []).length + ' new source(s) added: ' + (sm.added || []).join(', '));
    if (sm.status === 'no-new-sources') parts.push('no new sources — the supplied source(s) were already on the task.');
    if (sm.status === 'existing-reused') parts.push('the existing task was reused unchanged (already done, running, or skipped — its sources cannot change now).');
    if (sm.status === 'rejected') parts.push('new sources rejected: ' + (sm.rejected || []).map(function (x) { return (x.source || '') + ' (' + (x.reason || '') + ')'; }).join(', '));
    if (sm.duplicates && sm.duplicates.length) parts.push(sm.duplicates.length + ' duplicate(s) ignored: ' + sm.duplicates.join(', '));
    if (sm.rejected && sm.rejected.length && sm.status !== 'rejected') parts.push('rejected: ' + sm.rejected.map(function (x) { return (x.source || '') + ' (' + (x.reason || '') + ')'; }).join(', '));
    return parts.length ? ' Sources: ' + parts.join(' ') : '';
  }

  function seoChecksText(checks) {
    if (!checks || !checks.length) return '';
    // The actionable Fix line lives inside each check's detail
    // (seo.js appends " Fix: …" to the readability detail).
    return checks.map(function (c) {
      return (c.ok ? '✓ ' : '✗ ') + (c.name || '') + (c.detail ? ' — ' + c.detail : '');
    }).join(' | ');
  }

  // Fix 5: per-article fact-check re-run — reuses the existing task,
  // records a new run, keeps history, never sets fact_checked.
  // Phase 4: never re-fire a re-check while one is already in flight
  // for the same article — the duplicate used to surface as a 409
  // while the real run was still in progress. A 202 in-flight answer
  // from the server is shown as "already running", not an error.
  function recheckArticle(articleId, btn) {
    if (inFlightRechecks[articleId]) { setText('autonomyFactCheckDetail', 'Re-check for article #' + articleId + ' is already running — wait for it to finish.'); return; }
    inFlightRechecks[articleId] = true;
    if (btn) btn.disabled = true;
    setText('autonomyFactCheckDetail', 'Re-checking article #' + articleId + '…');
    api('/api/autonomy/articles/' + encodeURIComponent(articleId) + '/recheck', { method: 'POST' }).then(function (r) {
      delete inFlightRechecks[articleId];
      if (btn) btn.disabled = false;
      if (r.data && (r.data.inFlight || r.data.status === 'already-running')) {
        setText('autonomyFactCheckDetail', 'Re-check for article #' + articleId + ' is already running (task #' + (r.data.taskId != null ? r.data.taskId : '—') + (r.data.runningSince ? ', started ' + r.data.runningSince : '') + ') — wait for it to finish, or cancel it from the task queue.');
        return;
      }
      if (!r.ok) { setText('autonomyFactCheckDetail', 'Re-check failed for article #' + articleId + ' — ' + apiError(r) + '.'); return; }
      var d = r.data || {};
      var latest = d.latest || {};
      var prev = d.previous || null;
      var msg = 'Re-check completed for article #' + articleId + ' (task #' + (d.taskId != null ? d.taskId : '—') + (d.taskReused ? ', task reused' : ', new task') + ', run #' + (d.runId != null ? d.runId : '—') + '): ' +
        'latest fact-check ' + (latest.verdict || '—') + ' (' + (latest.claimsVerified != null ? latest.claimsVerified : '—') + '/' + (latest.claimsTotal != null ? latest.claimsTotal : '—') + ' verified, ' + (latest.claimsFailed != null ? latest.claimsFailed : '—') + ' failed)' +
        (prev ? '; previous was ' + (prev.verdict || '—') + ' (' + (prev.claimsVerified != null ? prev.claimsVerified : '—') + '/' + (prev.claimsTotal != null ? prev.claimsTotal : '—') + ' verified)' : '; no previous run') +
        '. fact_checked stays ' + (d.factChecked != null ? d.factChecked : '0') + ' (advisory only).';
      setText('autonomyFactCheckDetail', msg);
      loadPipeline();
      loadLlm(); // Phase 3, P7: a re-check runs the LLM judge — re-read live usage.
    }).catch(function () {
      delete inFlightRechecks[articleId];
      if (btn) btn.disabled = false;
      setText('autonomyFactCheckDetail', 'Could not reach the FS AI server.');
    });
  }

  // Fix 6: per-article SEO — Check is check-only (nothing changes),
  // Optimize repairs an eligible unprotected draft. The two are
  // separate buttons so they can never be confused.
  function seoCheckArticle(articleId) {
    setText('autonomyFactCheckDetail', 'Running SEO check for article #' + articleId + '…');
    api('/api/autonomy/articles/' + encodeURIComponent(articleId) + '/seo-check', { method: 'POST' }).then(function (r) {
      if (!r.ok) { setText('autonomyFactCheckDetail', 'SEO check failed for article #' + articleId + ' — ' + apiError(r) + '.'); return; }
      var d = r.data || {};
      var msg = 'SEO check (check-only — nothing changed) for article #' + articleId + ': verdict ' + (d.verdict || '—') +
        (d.checks ? ' — ' + seoChecksText(d.checks) : '') + (d.note ? ' ' + d.note : '');
      setText('autonomyFactCheckDetail', msg);
      loadPipeline();
    }).catch(function () { setText('autonomyFactCheckDetail', 'Could not reach the FS AI server.'); });
  }

  function seoOptimizeArticle(articleId) {
    setText('autonomyFactCheckDetail', 'Optimizing SEO for article #' + articleId + '…');
    api('/api/autonomy/articles/' + encodeURIComponent(articleId) + '/seo-optimize', { method: 'POST' }).then(function (r) {
      if (!r.ok) { setText('autonomyFactCheckDetail', 'SEO optimize failed for article #' + articleId + ' — ' + apiError(r) + '.'); return; }
      var d = r.data || {};
      var msg = 'SEO optimize completed for article #' + articleId + ': verdict ' + (d.verdict || '—') +
        (d.repairedFields && d.repairedFields.length ? ' — repaired: ' + d.repairedFields.join(', ') : ' — nothing needed repair') +
        (d.checks ? ' — ' + seoChecksText(d.checks) : '') + (d.note ? ' ' + d.note : '');
      setText('autonomyFactCheckDetail', msg);
      loadPipeline();
    }).catch(function () { setText('autonomyFactCheckDetail', 'Could not reach the FS AI server.'); });
  }

  // Fix 4: owner-visible review of unresolved corrections.
  function loadCorrections(articleId) {
    correctionArticleId = articleId;
    setText('autonomyCorrectionStatus', 'Loading unresolved corrections for article #' + articleId + '…');
    api('/api/autonomy/corrections?article_id=' + encodeURIComponent(articleId)).then(function (r) {
      var list = el('autonomyCorrectionList');
      if (!r.ok) { setText('autonomyCorrectionStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var items = (r.data && r.data.corrections) || [];
      setText('autonomyCorrectionStatus', items.length + ' unresolved correction(s) for article #' + articleId + '. Resolving never marks an unsupported claim verified — it only records the owner’s decision, and the gate re-evaluates from the recorded state.');
      if (!list) return;
      list.innerHTML = items.map(function (c) {
        var ev = c.evidenceUrl ? '<a href="' + esc(c.evidenceUrl) + '" target="_blank" rel="noopener">' + esc(c.evidenceUrl) + '</a>' : '—';
        var hist = (c.resolutions || []).map(function (res) {
          return esc(res.resolution || '') + (res.note ? ' — ' + esc(res.note) : '') + ' (' + fmtDate(res.created_at) + ')';
        }).join(' | ');
        return '<div class="card"><p><strong>Original claim:</strong> ' + esc(c.originalText || '') + '</p>' +
          '<p><strong>Attempted correction:</strong> ' + esc(c.attemptedCorrection || '—') + '</p>' +
          '<p class="muted">Status: ' + esc(c.status || '') + ' · attempt ' + esc(String(c.attempt != null ? c.attempt : '—')) + ' · recheck verdict: ' + esc(c.recheckVerdict || '—') + '</p>' +
          '<p><strong>Evidence:</strong> ' + ev + '</p>' +
          '<p><strong>Why it failed:</strong> ' + esc(c.failureReason || '—') + '</p>' +
          (hist ? '<p class="muted"><strong>Resolution history:</strong> ' + hist + '</p>' : '') +
          '<div class="field"><label>Resolution</label><select data-autonomy-correction-resolution="' + esc(String(c.id)) + '">' +
          '<option value="accepted-unresolved-removed">Accept as unresolved — remove the claim</option>' +
          '<option value="manually-corrected-rechecked">Manually corrected — re-check it</option>' +
          '<option value="rejected-for-retry">Reject — try another attempt</option>' +
          '<option value="pending-human-review">Pending human review</option>' +
          '</select></div>' +
          '<div class="field"><label>Corrected text (only for “Manually corrected” — it is re-checked against the article’s own sources)</label><input type="text" data-autonomy-correction-text="' + esc(String(c.id)) + '" placeholder="The corrected claim"></div>' +
          '<div class="field"><label>Note (optional)</label><input type="text" data-autonomy-correction-note="' + esc(String(c.id)) + '" placeholder="Why this decision"></div>' +
          '<p><button class="btn btn-small" type="button" data-autonomy-correction-resolve="' + esc(String(c.id)) + '">Resolve</button></p></div>';
      }).join('') || '<p>No unresolved corrections for this article.</p>';
    }).catch(function () { setText('autonomyCorrectionStatus', 'Could not reach the FS AI server.'); });
  }

  function resolveCorrection(correctionId, card) {
    var resSel = card ? card.querySelector('[data-autonomy-correction-resolution]') : null;
    var txtEl = card ? card.querySelector('[data-autonomy-correction-text]') : null;
    var noteEl = card ? card.querySelector('[data-autonomy-correction-note]') : null;
    var resolution = resSel ? resSel.value : '';
    var body = { resolution: resolution };
    if (noteEl && noteEl.value.trim()) body.note = noteEl.value.trim();
    if (resolution === 'manually-corrected-rechecked') {
      if (!txtEl || !txtEl.value.trim()) { setText('autonomyCorrectionStatus', 'Enter the corrected text first — “Manually corrected” needs the corrected claim.'); return; }
      body.correctedText = txtEl.value.trim();
    }
    setText('autonomyCorrectionStatus', 'Recording resolution…');
    api('/api/autonomy/corrections/' + encodeURIComponent(correctionId) + '/resolve', { method: 'POST', body: body }).then(function (r) {
      if (!r.ok) { setText('autonomyCorrectionStatus', apiError(r)); return; }
      var d = r.data || {};
      var corr = d.correction || {};
      setText('autonomyCorrectionStatus', 'Resolution recorded: ' + (d.resolution || resolution) + ' — correction #' + correctionId + ' is now ' + (corr.status || '—') + '.' + (d.gateEffect ? ' ' + d.gateEffect : ''));
      if (correctionArticleId != null) loadCorrections(correctionArticleId);
      loadPipeline();
    }).catch(function () { setText('autonomyCorrectionStatus', 'Could not reach the FS AI server.'); });
  }

  // Fix 10: the recorded RSS fetch history (read-only — a reload
  // never changes the counts).
  function loadRssAudit() {
    setText('autonomyRssAuditStatus', 'Loading fetch history…');
    api('/api/autonomy/rss-audit?limit=50').then(function (r) {
      var list = el('autonomyRssAuditList');
      if (!r.ok) { setText('autonomyRssAuditStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var d = r.data || {};
      var totals = d.totals || {};
      setText('autonomyRssAuditStatus', (d.total != null ? d.total : 0) + ' recorded fetch(es); ' + (totals.sourcesReconciled != null ? totals.sourcesReconciled : '—') + ' of ' + (totals.sourcesTotal != null ? totals.sourcesTotal : '—') + ' sources reconcile. ' + (d.note || ''));
      if (!list) return;
      list.innerHTML = (d.audits || []).map(function (a) {
        return '<tr><td><strong>' + esc(a.feed_url || '') + '</strong><br><span class="muted">feed #' + esc(String(a.source_id)) + '</span></td>' +
          '<td>' + fmtDate(a.started_at) + '</td><td>' + esc(a.trigger_type || '') + '</td>' +
          '<td>' + esc(String(a.items_discovered != null ? a.items_discovered : '—')) + '</td>' +
          '<td>' + esc(String(a.items_inserted != null ? a.items_inserted : '—')) + '</td>' +
          '<td>' + esc(String(a.duplicates_skipped != null ? a.duplicates_skipped : '—')) + '</td>' +
          '<td>' + esc(a.errors ? String(a.errors).slice(0, 120) : '—') + '</td>' +
          '<td>' + statusPill(a.status) + '</td></tr>';
      }).join('') || '<tr><td colspan="8">No fetches recorded yet — the audit log starts with migration 014.</td></tr>';
    }).catch(function () { setText('autonomyRssAuditStatus', 'Could not reach the FS AI server.'); });
  }

  // Fix 9: manual weekly run. Owner-only; the server enforces the
  // E-Stop, protection and duplicate rules and answers with the real
  // status (completed / already_completed / blocked) — the button
  // never claims success for a no-op.
  function runWeekly(btn) {
    if (btn) btn.disabled = true;
    setText('autonomyRunWeeklyStatus', 'Running the weekly workflow…');
    api('/api/autonomy/run-weekly', { method: 'POST', body: {} }).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { setText('autonomyRunWeeklyStatus', apiError(r)); return; }
      var d = r.data || {};
      var status = d.status || 'completed';
      var msg;
      if (status === 'already_completed') {
        msg = 'Weekly workflow already ran this week (report #' + (d.reportId != null ? d.reportId : '—') + ') — no re-run. ' + (d.reason || '');
      } else if (status === 'blocked') {
        msg = 'Weekly workflow blocked — Emergency Stop is on.';
      } else {
        msg = 'Weekly workflow completed (report #' + (d.reportId != null ? d.reportId : '—') + ').';
      }
      setText('autonomyRunWeeklyStatus', msg);
      loadStatus();
      loadTasks();
      loadReports();
      loadPipeline();
      loadLlm(); // Phase 3, P7: the weekly workflow can consume LLM usage — re-read the header.
    }).catch(function () { if (btn) btn.disabled = false; setText('autonomyRunWeeklyStatus', 'Could not reach the FS AI server.'); });
  }

  function enqueueAgentTask(agent, kind, articleId, statusElId) {
    setText(statusElId, 'Creating ' + kind + ' task for article #' + articleId + '…');
    var key = 'manual-' + kind + '-' + articleId + '-' + new Date().toISOString().slice(0, 10);
    api('/api/autonomy/tasks', { method: 'POST', body: { agent: agent, kind: kind, payload: { article_id: Number(articleId) }, idempotency_key: key } }).then(function (r) {
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
      var task = r.data.task || {};
      setText(statusElId, kind + ' task created (task #' + task.id + ')' + (r.data.duplicate ? ' — already existed.' : '') + ' — run it from the task queue.' + sourceMergeText(r.data.sourceMerge));
      loadTasks();
      loadPipeline();
    }).catch(function () { setText(statusElId, 'Could not reach the FS AI server.'); });
  }

  /* --- Controls --- */
  function bindControls() {
    var control = function (action, label) {
      setText('autonomyControlStatus', label + '…');
      api('/api/autonomy/control', { method: 'POST', body: { action: action } }).then(function (r) {
        if (!r.ok) { setText('autonomyControlStatus', apiError(r)); return; }
        setText('autonomyControlStatus', label + ' done.' + (r.data.changed != null ? ' Changed: ' + r.data.changed + '.' : ''));
        loadStatus();
        loadTasks();
      }).catch(function () { setText('autonomyControlStatus', 'Could not reach the FS AI server.'); });
    };
    var startBtn = el('autonomyStartAllBtn');
    if (startBtn) startBtn.addEventListener('click', function () { control('start-all', 'Starting all agents'); });
    var pauseBtn = el('autonomyPauseAllBtn');
    if (pauseBtn) pauseBtn.addEventListener('click', function () { control('pause-all', 'Pausing all agents'); });
    var resumeBtn = el('autonomyResumeBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', function () { control('resume-all', 'Resuming operations'); });

    var stopBtn = el('autonomyStopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        // No confirmation dialog here, deliberately — see dashboard.js:
        // a dialog gate broke this toggle live on 2026-11-19, because
        // auto-dismissed dialogs return false and the handler then
        // returns before sending any request (silently). A safety
        // control must work on the first tap; the action is instantly
        // reversible and the button label states what will happen.
        var next = !emergencyStopped;
        api('/api/admin/emergency-stop', { method: 'POST', body: { stopped: next } }).then(function (r) {
          if (r.ok) {
            emergencyStopped = !!r.data.stopped;
            loadStatus();
            notifyEmergencyStopChanged();
            setText('autonomyControlStatus', 'Emergency Stop is now ' + (emergencyStopped ? 'ON.' : 'OFF.'));
          } else {
            setText('autonomyControlStatus', apiError(r));
          }
        }).catch(function () { setText('autonomyControlStatus', 'Could not reach the FS AI server.'); });
      });
    }

    var dailyBtn = el('autonomyRunDailyBtn');
    if (dailyBtn) {
      dailyBtn.addEventListener('click', function () {
        if (dailyBtn.disabled) return;
        dailyBtn.disabled = true;
        setText('autonomyRunDailyStatus', 'Running the daily workflow…');
        // A manual click is an explicit re-run: send force:true. The
        // server still answers with the REAL status (completed /
        // already_completed / blocked) — the button never claims success
        // for a no-op. (Fixed 2026-11-20: the old call sent no body, so
        // a second click on the same day silently no-op'd while the UI
        // still said "Daily workflow finished.")
        api('/api/autonomy/run-daily', { method: 'POST', body: { force: true } }).then(function (r) {
          dailyBtn.disabled = false;
          if (!r.ok) { setText('autonomyRunDailyStatus', apiError(r)); return; }
          var d = r.data || {};
          var status = d.status || 'completed';
          var counts = d.counts || {};
          var countLine = ['researchFetched', 'researchItemsStored', 'contentEnqueued', 'factChecksRun', 'correctionsRun', 'seoRun', 'gateEvaluated', 'published']
            .map(function (k) { return counts[k] != null ? k.replace(/([A-Z])/g, ' $1').toLowerCase() + ': ' + counts[k] : null; })
            .filter(function (x) { return x; }).join(', ');
          var msg;
          if (status === 'already_completed') {
            msg = 'Daily workflow already ran today (report #' + (d.reportId != null ? d.reportId : '—') + ') — no re-run. ' + (d.reason || '');
          } else if (status === 'blocked') {
            msg = 'Daily workflow blocked — Emergency Stop is on.';
          } else {
            msg = 'Daily workflow completed (report #' + (d.reportId != null ? d.reportId : '—') + ')' + (countLine ? ': ' + countLine + '.' : '.');
          }
          setText('autonomyRunDailyStatus', msg);
          loadStatus();
          loadTasks();
          loadReports();
          loadPipeline();
          loadLlm(); // Phase 3, P7: the daily workflow can consume LLM usage — re-read the header.
        }).catch(function () { dailyBtn.disabled = false; setText('autonomyRunDailyStatus', 'Could not reach the FS AI server.'); });
      });
    }

    var weeklyBtn = el('autonomyRunWeeklyBtn');
    if (weeklyBtn) {
      weeklyBtn.addEventListener('click', function () { runWeekly(weeklyBtn); });
    }

    var createContentBtn = el('autonomyCreateContentBtn');
    if (createContentBtn) {
      createContentBtn.addEventListener('click', function () {
        var titleEl = el('autonomyContentTitle');
        var divEl = el('autonomyContentDivision');
        var srcEl = el('autonomyContentSources');
        var title = titleEl ? titleEl.value.trim() : '';
        var division = divEl ? divEl.value : '';
        if (title.length < 5) { setText('autonomyCreateContentStatus', 'Enter an article title of at least 5 characters.'); return; }
        if (!DIVISION_IDS[division]) { setText('autonomyCreateContentStatus', 'Choose a division.'); return; }
        var sources = srcEl ? srcEl.value.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; }).slice(0, 10) : [];
        var key = 'manual-content-' + slugifyTitle(title) + '-' + new Date().toISOString().slice(0, 10);
        setText('autonomyCreateContentStatus', 'Creating content task…');
        api('/api/autonomy/tasks', { method: 'POST', body: { agent: 'content-creation', kind: 'article-draft', payload: { title: title, division: division, sources: sources }, division_id: DIVISION_IDS[division], idempotency_key: key } }).then(function (r) {
          if (!r.ok) { setText('autonomyCreateContentStatus', apiError(r)); return; }
          var task = r.data.task || {};
          setText('autonomyCreateContentStatus', 'Content task created (task #' + task.id + ')' + (r.data.duplicate ? ' — this task already existed (same title today).' : '') + ' — run it under “Run a task manually”, then convert its scaffold (run ID) to a draft.' + sourceMergeText(r.data.sourceMerge));
          loadTasks();
          loadStatus();
        }).catch(function () { setText('autonomyCreateContentStatus', 'Could not reach the FS AI server.'); });
      });
    }

    var runTaskBtn = el('autonomyRunTaskBtn');
    if (runTaskBtn) {
      runTaskBtn.addEventListener('click', function () {
        var sel = el('autonomyTaskSelect');
        runTask(sel ? sel.value : '', 'autonomyRunTaskStatus');
      });
    }

    // Phase 4: recover tasks stuck 'running' past the 10-minute lease.
    var recoverStaleBtn = el('autonomyRecoverStaleBtn');
    if (recoverStaleBtn) {
      recoverStaleBtn.addEventListener('click', function () {
        recoverStaleTasks('autonomyRunTaskStatus', recoverStaleBtn);
      });
    }

    var convertBtn = el('autonomyConvertScaffoldBtn');
    if (convertBtn) {
      convertBtn.addEventListener('click', function () {
        var input = el('autonomyScaffoldRunId');
        var runId = input ? input.value.trim() : '';
        if (!runId) { setText('autonomyConvertStatus', 'Enter a scaffold run ID first.'); return; }
        setText('autonomyConvertStatus', 'Converting scaffold ' + runId + ' to a draft…');
        api('/api/autonomy/scaffolds/' + encodeURIComponent(runId) + '/convert', { method: 'POST' }).then(function (r) {
          if (!r.ok) { setText('autonomyConvertStatus', apiError(r)); return; }
          var article = r.data.article || {};
          setText('autonomyConvertStatus', 'Scaffold converted to a CMS draft' + (article.id != null ? ' (article #' + article.id + ')' : '') + ' — owner review required before publishing.');
          loadPipeline();
        }).catch(function () { setText('autonomyConvertStatus', 'Could not reach the FS AI server.'); });
      });
    }

    var filters = el('autonomyTaskFilters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-autonomy-filter]');
        if (!btn) return;
        taskFilter = btn.getAttribute('data-autonomy-filter') || '';
        loadTasks();
      });
    }
    var taskList = el('autonomyTaskList');
    if (taskList) {
      taskList.addEventListener('click', function (e) {
        var runBtn = e.target.closest('[data-autonomy-run]');
        if (runBtn) { runTask(runBtn.getAttribute('data-autonomy-run'), 'autonomyRunTaskStatus', runBtn); return; }
        var retryBtn = e.target.closest('[data-autonomy-retry]');
        if (retryBtn) { retryTask(retryBtn.getAttribute('data-autonomy-retry'), 'autonomyRunTaskStatus'); return; }
        var cancelBtn = e.target.closest('[data-autonomy-cancel]');
        if (cancelBtn) { cancelTask(cancelBtn.getAttribute('data-autonomy-cancel'), 'autonomyRunTaskStatus', cancelBtn); }
      });
    }

    var sourceList = el('autonomySourceList');
    if (sourceList) {
      sourceList.addEventListener('click', function (e) {
        var fetchBtn = e.target.closest('[data-autonomy-source-fetch]');
        if (fetchBtn) {
          var sid = fetchBtn.getAttribute('data-autonomy-source-fetch');
          // Disable while the fetch is in flight: a double-click (or a
          // double-tap on mobile) would otherwise fire a second fetch,
          // and a re-fetch counts every item as a duplicate — that is
          // the most plausible trigger for the 19 Nov counter jump on
          // the three digital-tools sources (duplicates 0→50/10/40 with
          // no new items). (Hardened 2026-11-20.)
          if (fetchBtn.disabled) return;
          fetchBtn.disabled = true;
          setText('autonomySourceStatus', 'Fetching source #' + sid + '…');
          api('/api/autonomy/sources/' + encodeURIComponent(sid) + '/fetch', { method: 'POST' }).then(function (r) {
            fetchBtn.disabled = false;
            if (!r.ok) { setText('autonomySourceStatus', apiError(r)); return; }
            var s = r.data.source || {};
            setText('autonomySourceStatus', 'Source #' + sid + ': ' + (s.ok ? ('fetched ' + s.fetched + ' item(s), ' + s.added + ' new, ' + s.duplicates + ' duplicate(s).') : ('failed — ' + (s.error || 'unknown error') + '.')));
            loadSources();
          }).catch(function () { fetchBtn.disabled = false; setText('autonomySourceStatus', 'Could not reach the FS AI server.'); });
          return;
        }
        var toggleBtn = e.target.closest('[data-autonomy-source-toggle]');
        if (toggleBtn) {
          var tid = toggleBtn.getAttribute('data-autonomy-source-toggle');
          var currentlyActive = toggleBtn.getAttribute('data-autonomy-source-active') === '1';
          if (toggleBtn.disabled) return;
          toggleBtn.disabled = true;
          api('/api/autonomy/sources/' + encodeURIComponent(tid) + '/toggle', { method: 'POST', body: { is_active: currentlyActive ? 0 : 1 } }).then(function (r) {
            toggleBtn.disabled = false;
            if (!r.ok) { setText('autonomySourceStatus', apiError(r)); return; }
            setText('autonomySourceStatus', 'Source #' + tid + (currentlyActive ? ' disabled.' : ' enabled.'));
            loadSources();
          }).catch(function () { toggleBtn.disabled = false; setText('autonomySourceStatus', 'Could not reach the FS AI server.'); });
        }
      });
    }

    var rssAuditBtn = el('autonomyLoadRssAuditBtn');
    if (rssAuditBtn) {
      rssAuditBtn.addEventListener('click', loadRssAudit);
    }

    var addSourceBtn = el('autonomyAddSourceBtn');
    if (addSourceBtn) {
      addSourceBtn.addEventListener('click', function () {
        var divEl = el('autonomySourceDivision');
        var nameEl = el('autonomySourceName');
        var urlEl = el('autonomySourceUrl');
        var division = divEl ? divEl.value : '';
        var name = nameEl ? nameEl.value.trim() : '';
        var url = urlEl ? urlEl.value.trim() : '';
        if (!name || !url) { setText('autonomyAddSourceStatus', 'Enter a source name and a feed URL.'); return; }
        setText('autonomyAddSourceStatus', 'Validating the feed…');
        api('/api/autonomy/sources', { method: 'POST', body: { division: division, name: name, url: url } }).then(function (r) {
          if (!r.ok) { setText('autonomyAddSourceStatus', apiError(r)); return; }
          setText('autonomyAddSourceStatus', 'Source added — feed validated live (' + (r.data.itemsFound != null ? r.data.itemsFound : '—') + ' item(s) found, ' + (r.data.feedType || 'rss') + ').');
          if (nameEl) nameEl.value = '';
          if (urlEl) urlEl.value = '';
          loadSources();
        }).catch(function () { setText('autonomyAddSourceStatus', 'Could not reach the FS AI server.'); });
      });
    }

    var pipelineList = el('autonomyPipelineList');
    if (pipelineList) {
      pipelineList.addEventListener('click', function (e) {
        // Per-article action results go to the detail line, not the
        // pipeline status line: loadPipeline() refreshes the table
        // after every action and would erase a message written to the
        // pipeline status line (minor C).
        var fcBtn = e.target.closest('[data-autonomy-factcheck]');
        if (fcBtn) { enqueueAgentTask('fact-checking', 'fact-check', fcBtn.getAttribute('data-autonomy-factcheck'), 'autonomyFactCheckDetail'); return; }
        var recheckBtn = e.target.closest('[data-autonomy-recheck]');
        if (recheckBtn) { recheckArticle(recheckBtn.getAttribute('data-autonomy-recheck'), recheckBtn); return; }
        var fetchEvBtn = e.target.closest('[data-autonomy-fetch-evidence]');
        if (fetchEvBtn) { enqueueAgentTask('research', 'article-fetch', fetchEvBtn.getAttribute('data-autonomy-fetch-evidence'), 'autonomyFactCheckDetail'); return; }
        var corrBtn = e.target.closest('[data-autonomy-correct]');
        if (corrBtn) { enqueueAgentTask('fact-checking', 'correct', corrBtn.getAttribute('data-autonomy-correct'), 'autonomyFactCheckDetail'); return; }
        var seoCheckBtn = e.target.closest('[data-autonomy-seo-check]');
        if (seoCheckBtn) { seoCheckArticle(seoCheckBtn.getAttribute('data-autonomy-seo-check')); return; }
        var seoOptBtn = e.target.closest('[data-autonomy-seo-optimize]');
        if (seoOptBtn) { seoOptimizeArticle(seoOptBtn.getAttribute('data-autonomy-seo-optimize')); return; }
        var reviewBtn = e.target.closest('[data-autonomy-review]');
        if (reviewBtn) { loadCorrections(reviewBtn.getAttribute('data-autonomy-review')); return; }
        var detailBtn = e.target.closest('[data-autonomy-fc-detail]');
        if (detailBtn) { loadFactCheckDetail(detailBtn.getAttribute('data-autonomy-fc-detail')); }
      });
    }

    var correctionList = el('autonomyCorrectionList');
    if (correctionList) {
      correctionList.addEventListener('click', function (e) {
        var resolveBtn = e.target.closest('[data-autonomy-correction-resolve]');
        if (!resolveBtn) return;
        var card = resolveBtn.closest('.card');
        resolveCorrection(resolveBtn.getAttribute('data-autonomy-correction-resolve'), card);
      });
    }

    var backupBtn = el('autonomyBackupBtn');
    if (backupBtn) {
      backupBtn.addEventListener('click', function () {
        setText('autonomyBackupStatus', 'Running backup…');
        api('/api/admin/backup/run', { method: 'POST' }).then(function (r) {
          if (!r.ok) { setText('autonomyBackupStatus', apiError(r)); return; }
          var d = r.data || {};
          setText('autonomyBackupStatus', 'Backup ' + (d.status || 'done') + ' — ' + (d.rowsExported != null ? d.rowsExported : '—') + ' row(s) in ' + (d.tablesExported != null ? d.tablesExported : '—') + ' table(s), ' + (d.bytesExported != null ? d.bytesExported : '—') + ' bytes.' + (d.warnings && d.warnings.length ? ' Warnings: ' + d.warnings.join(' ') : ''));
          loadStatus();
        }).catch(function () { setText('autonomyBackupStatus', 'Could not reach the FS AI server.'); });
      });
    }

    var genBtn = el('autonomyGenerateReportBtn');
    if (genBtn) {
      genBtn.addEventListener('click', function () {
        var kind = el('autonomyReportKind');
        var k = kind && kind.value ? kind.value : 'daily';
        setText('autonomyReportStatus', 'Generating a ' + k + ' report…');
        api('/api/autonomy/reports/generate', { method: 'POST', body: { kind: k } }).then(function (r) {
          if (!r.ok) { setText('autonomyReportStatus', apiError(r)); return; }
          var rep = r.data.report || {};
          setText('autonomyReportStatus', 'Report generated (' + (rep.kind || k) + ' — ' + fmtDate(rep.date || rep.created_at) + ').');
          loadReports();
        }).catch(function () { setText('autonomyReportStatus', 'Could not reach the FS AI server.'); });
      });
    }
    var kindSel = el('autonomyReportKind');
    if (kindSel) kindSel.addEventListener('change', loadReports);

    var form = el('autonomySettingsForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveSettings();
      });
    }
  }

  function loadAll() {
    loadStatus();
    loadLlm();
    loadSources();
    loadPipeline();
    loadTasks();
    loadReports();
    loadSettings();
    loadAccounts();
    loadControlCenterActivity();
  }

  /* --- Gate: only run after a verified server session has revealed
     #dashboardContent. Never unhide it here; poll (the gate flips when
     authentication.js confirms the session) and also listen for the
     verified event dashboard.js uses. --- */
  function contentVisible() {
    var c = el('dashboardContent');
    return !!(c && !c.hidden && c.style.display !== 'none');
  }

  function sessionReady() {
    var auth = window.FSAI && window.FSAI.auth;
    var verified = (window.FSAI && window.FSAI.sessionVerified) ||
      (auth && auth.isSessionVerified && auth.isSessionVerified());
    return !!(verified && token());
  }

  function startIfReady() {
    if (started) return;
    if (sessionReady() && contentVisible()) {
      started = true;
      buildSection();
      loadAll();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    startIfReady();
    window.addEventListener('fsai:session-verified', startIfReady);
    // The AI Agent Control section (dashboard.js) toggles the same
    // E-Stop: re-fetch our display when it changes, instead of showing
    // a stale ON/OFF until a reload (live 2026-11-19). The message line
    // syncs too (loadStatus(true)) — the state line alone left the old
    // "Emergency Stop is now OFF." message standing.
    window.addEventListener('fsai:emergency-stop-changed', function () { loadStatus(true); });
    var poll = setInterval(function () {
      startIfReady();
      if (started) clearInterval(poll);
    }, 500);
  });
})();
