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
  var queuedTasks = [];

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
      '<button class="btn btn-primary" type="button" id="autonomyRunDailyBtn">Run Daily Workflow Now</button>' +
      '</p>' +
      '<p class="muted">Start / Pause / Resume act on all agents through the Worker. ' +
      '“Run Daily Workflow Now” runs the full daily workflow on demand; it is blocked (423) while the Emergency Stop is ON. ' +
      'A manual run is an explicit re-run, so it runs even if the workflow already ran today. ' +
      'The daily workflow also runs on schedule at 00:00 UTC (06:00 Dhaka) every day, and the weekly workflow on Sundays at 00:00 UTC.</p>' +
      '<p id="autonomyControlStatus" aria-live="polite"></p>' +
      '<p id="autonomyRunDailyStatus" aria-live="polite"></p>' +
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
            ? ' <span class="muted">— last run ' + fmtDate(lr.startedAt) + ': ' + esc(lr.outcome) + (lr.reason ? ' (' + esc(lr.reason) + ')' : '') + '</span>'
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
        if (p.id === 'workers-ai' && usage.neurons != null) used = ' — ' + usage.neurons + ' of 10,000 free Neurons used today';
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
        return '<tr><td>' + esc(String(t.id)) + '</td><td>' + esc(t.agent || '') + '</td><td>' + esc(t.kind || '') + '</td>' +
          '<td>' + esc(t.priority == null ? '' : String(t.priority)) + '</td><td>' + statusPill(t.status) + '</td>' +
          '<td>' + esc((t.attempts == null ? '0' : String(t.attempts)) + ' / ' + (t.max_attempts == null ? '—' : String(t.max_attempts))) + '</td>' +
          '<td>' + fmtDate(t.scheduled_for) + '</td><td>' + fmtDate(t.created_at) + '</td><td>' + runBtn + retryBtn + '</td></tr>';
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

  function runTask(id, statusElId) {
    if (!id) { setText(statusElId, 'Select a queued task first.'); return; }
    setText(statusElId, 'Running task ' + id + '…');
    api('/api/autonomy/tasks/' + encodeURIComponent(id) + '/run', { method: 'POST' }).then(function (r) {
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
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
        (result && result.articleId ? ' (article #' + result.articleId + ')' : ''));
      loadTasks();
      loadStatus();
    }).catch(function () { setText(statusElId, 'Could not reach the FS AI server.'); });
  }

  function retryTask(id, statusElId) {
    if (!id) return;
    setText(statusElId, 'Retrying task ' + id + '…');
    api('/api/autonomy/tasks/' + encodeURIComponent(id) + '/retry', { method: 'POST' }).then(function (r) {
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
      setText(statusElId, 'Task ' + id + ' is queued again (attempts reset).');
      loadTasks();
      loadStatus();
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
          var fcBtn = '<button class="btn btn-small" type="button" data-autonomy-factcheck="' + esc(String(a.id)) + '">Fact-check</button>';
          var corrBtn = '<button class="btn btn-small" type="button" data-autonomy-correct="' + esc(String(a.id)) + '">Correct</button>';
          var detailBtn = '<button class="btn btn-small" type="button" data-autonomy-fc-detail="' + esc(String(a.id)) + '">Details</button>';
          return '<tr><td><strong>' + esc(a.title || '') + '</strong><br><span class="muted">#' + esc(String(a.id)) + ' · ' + esc(a.division || '') + '</span></td>' +
            '<td>' + statusPill(a.status) + '</td><td>' + statusPill(gate) + '</td>' +
            '<td>' + esc(blocked || '—') + '</td><td>' + fcBtn + ' ' + corrBtn + ' ' + detailBtn + '</td></tr>';
        }).join('') || '<tr><td colspan="5">No drafts — nothing waiting for review.</td></tr>';
      }
      if (grid) {
        var byStatus = d.articlesByStatus || {};
        var cards = [
          { label: 'Articles published', value: String(byStatus.published || 0), note: 'Live on the site' },
          { label: 'Drafts', value: String(byStatus.draft || 0), note: 'Awaiting review' },
          { label: 'Published today', value: String(d.publishedToday != null ? d.publishedToday : '—'), note: 'UTC day, from D1' },
          { label: 'LLM calls today', value: String((d.llmToday && d.llmToday.calls) || 0), note: ((d.llmToday && d.llmToday.neurons) || 0) + ' Neurons today (free allowance 10,000/day)' },
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

  function enqueueAgentTask(agent, kind, articleId, statusElId) {
    setText(statusElId, 'Creating ' + kind + ' task for article #' + articleId + '…');
    var key = 'manual-' + kind + '-' + articleId + '-' + new Date().toISOString().slice(0, 10);
    api('/api/autonomy/tasks', { method: 'POST', body: { agent: agent, kind: kind, payload: { article_id: Number(articleId) }, idempotency_key: key } }).then(function (r) {
      if (!r.ok) { setText(statusElId, apiError(r)); return; }
      var task = r.data.task || {};
      setText(statusElId, kind + ' task created (task #' + task.id + ')' + (r.data.duplicate ? ' — already existed.' : '') + ' — run it from the task queue.');
      loadTasks();
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
        }).catch(function () { dailyBtn.disabled = false; setText('autonomyRunDailyStatus', 'Could not reach the FS AI server.'); });
      });
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
          setText('autonomyCreateContentStatus', 'Content task created (task #' + task.id + ')' + (r.data.duplicate ? ' — this task already existed (same title today).' : '') + ' — run it under “Run a task manually”, then convert its scaffold (run ID) to a draft.');
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
        if (runBtn) { runTask(runBtn.getAttribute('data-autonomy-run'), 'autonomyRunTaskStatus'); return; }
        var retryBtn = e.target.closest('[data-autonomy-retry]');
        if (retryBtn) { retryTask(retryBtn.getAttribute('data-autonomy-retry'), 'autonomyRunTaskStatus'); }
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
        var fcBtn = e.target.closest('[data-autonomy-factcheck]');
        if (fcBtn) { enqueueAgentTask('fact-checking', 'fact-check', fcBtn.getAttribute('data-autonomy-factcheck'), 'autonomyPipelineStatus'); return; }
        var corrBtn = e.target.closest('[data-autonomy-correct]');
        if (corrBtn) { enqueueAgentTask('fact-checking', 'correct', corrBtn.getAttribute('data-autonomy-correct'), 'autonomyPipelineStatus'); return; }
        var detailBtn = e.target.closest('[data-autonomy-fc-detail]');
        if (detailBtn) { loadFactCheckDetail(detailBtn.getAttribute('data-autonomy-fc-detail')); }
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
