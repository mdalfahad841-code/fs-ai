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
      '“Run Daily Workflow Now” runs the full daily workflow on demand; it is blocked (423) while the Emergency Stop is ON.</p>' +
      '<p id="autonomyControlStatus" aria-live="polite"></p>' +
      '<p id="autonomyRunDailyStatus" aria-live="polite"></p>' +
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
      '<div class="form-span"><button class="btn btn-primary" type="submit">Save publishing rules</button></div>' +
      '</form>' +
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
  function loadStatus() {
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
      ];
      if (grid) {
        grid.innerHTML = cards.map(function (c) {
          return '<div class="card kpi-card"><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note) + '</p></div>';
        }).join('');
      }
      var agents = d.agents || [];
      if (list) {
        list.innerHTML = agents.map(function (a) {
          return '<li><strong>' + esc(a.role || a.id || a.name || 'Agent') + '</strong>' +
            (a.id && a.role ? ' <span class="muted">(' + esc(a.id) + ')</span>' : '') +
            ' ' + statusPill(a.status) + '</li>';
        }).join('') || '<li>No agents reported by the API.</li>';
      }
    }).catch(function () { setText('autonomyStatus', 'Could not reach the FS AI server.'); });
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
        return '<tr><td>' + esc(String(t.id)) + '</td><td>' + esc(t.agent || '') + '</td><td>' + esc(t.kind || '') + '</td>' +
          '<td>' + esc(t.priority == null ? '' : String(t.priority)) + '</td><td>' + statusPill(t.status) + '</td>' +
          '<td>' + esc((t.attempts == null ? '0' : String(t.attempts)) + ' / ' + (t.max_attempts == null ? '—' : String(t.max_attempts))) + '</td>' +
          '<td>' + fmtDate(t.scheduled_for) + '</td><td>' + fmtDate(t.created_at) + '</td><td>' + runBtn + '</td></tr>';
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
      var task = r.data.task || {};
      var result = r.data.result || {};
      var outcome = task.status || result.status || 'done';
      var detail = result.reason || result.error || result.message || result.note || '';
      if (result && result.noop) detail = result.reason || result.message || 'nothing to do';
      setText(statusElId, 'Task ' + id + ': ' + outcome + (detail ? ' — ' + detail : '') +
        (result && result.articleId ? ' (article #' + result.articleId + ')' : ''));
      loadTasks();
      loadStatus();
    }).catch(function () { setText(statusElId, 'Could not reach the FS AI server.'); });
  }

  /* --- Reports (GET/POST /api/autonomy/reports) --- */
  function reportSummaryText(rep) {
    var s = rep.summary_json;
    if (s == null) return '';
    if (typeof s === 'string') {
      try {
        var parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object') {
          if (parsed.summary) return String(parsed.summary);
          return Object.keys(parsed).map(function (k) { return k + ': ' + parsed[k]; }).join(', ');
        }
        return s;
      } catch (e) { return s; }
    }
    if (typeof s === 'object') {
      if (s.summary) return String(s.summary);
      return Object.keys(s).map(function (k) { return k + ': ' + s[k]; }).join(', ');
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
    ];
    var allowed = {
      autonomy_level: ['1', '2', '3'],
      max_articles_per_day: ['0', '1', '2', '3'],
      publishing_mode: ['approved_only'],
      social_auto_post: ['off'],
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
        var next = !emergencyStopped;
        if (!window.confirm(next ? 'Turn the Emergency Stop ON? All agent runs will be blocked (423).' : 'Turn the Emergency Stop OFF? Agent runs will be allowed again.')) return;
        api('/api/admin/emergency-stop', { method: 'POST', body: { stopped: next } }).then(function (r) {
          if (r.ok) {
            emergencyStopped = !!r.data.stopped;
            loadStatus();
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
        setText('autonomyRunDailyStatus', 'Running the daily workflow…');
        api('/api/autonomy/run-daily', { method: 'POST' }).then(function (r) {
          if (!r.ok) { setText('autonomyRunDailyStatus', apiError(r)); return; }
          var d = r.data || {};
          var summary = d.summary || d.message || '';
          var detail = '';
          if (d.tasks) detail = ' Tasks — queued: ' + (d.tasks.queued != null ? d.tasks.queued : '—') + ', done: ' + (d.tasks.done != null ? d.tasks.done : '—') + ', failed: ' + (d.tasks.failed != null ? d.tasks.failed : '—') + '.';
          setText('autonomyRunDailyStatus', 'Daily workflow finished.' + (summary ? ' ' + summary : '') + detail);
          loadStatus();
          loadTasks();
          loadReports();
        }).catch(function () { setText('autonomyRunDailyStatus', 'Could not reach the FS AI server.'); });
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
        var btn = e.target.closest('[data-autonomy-run]');
        if (!btn) return;
        runTask(btn.getAttribute('data-autonomy-run'), 'autonomyRunTaskStatus');
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
    var poll = setInterval(function () {
      startIfReady();
      if (started) clearInterval(poll);
    }, 500);
  });
})();
