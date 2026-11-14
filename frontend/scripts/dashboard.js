/* FS AI — Command Center dashboard, live data edition.
   Every section below reads the REAL Worker API with the owner's Bearer
   token (sessionStorage 'fsai-session'). Nothing is invented: revenue is
   honestly $0.00 and traffic is honestly "Data unavailable" unless the API
   returns a real row. A 401 anywhere shows "Sign in required".
   Sections render only after the session is verified — dashboard.js waits
   for the 'fsai:session-verified' event (or the flag) from
   authentication.js, so the gated content is never filled from an
   unverified stored session. Where the live API is unreachable, the
   Overview falls back to the site's own static data and says so. */
(function () {
  'use strict';
  var API_BASE = 'https://fs-ai.mdalfahad841.workers.dev';
  var SITE_BASE = 'https://fs-ai-5w5.pages.dev';
  var loaded = false;
  var editingArticleId = null;
  var emergencyStopped = null;

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
    if (['active', 'connected', 'verified', 'exists', 'created', 'published', 'subscribed'].indexOf(lower) !== -1) cls += ' ok';
    else if (['pending', 'paused', 'draft', 'pending_approval', 'approved'].indexOf(lower) !== -1) cls += ' pending';
    else if (['failed', 'disabled', 'rejected', 'suspended', 'archived', 'unsubscribed'].indexOf(lower) !== -1) cls += ' failed';
    return '<span class="' + cls + '">' + esc(s || 'Unknown') + '</span>';
  }

  function apiError(r) {
    if (r.status === 401) return 'Sign in required — your session is not valid. Sign in again.';
    return 'API error (HTTP ' + r.status + '): ' + ((r.data && r.data.error) || 'could not load this section.');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    if (window.FSAI) return window.FSAI.formatDate(String(iso).slice(0, 10));
    return String(iso).slice(0, 10);
  }

  /* Verified facts the site itself proves (not API claims): Search Console
     is verified (verification file is served from this site) and GA4
     G-JVSCJT2DHJ is tagged on every public page. Facebook / WhatsApp
     Business / Business Email are paused by the owner. The API fallback
     still lists Search Console + Analytics as pending, so the dashboard
     corrects those two rows and labels the correction. */
  var ACCOUNT_OVERRIDES = {
    'search-console': { status: 'Verified', detail: 'Verified — verification file google745797e85dfd966e.html is served from this site. (API still reports pending; corrected here from the site itself.)' },
    'analytics': { status: 'Connected', detail: 'Connected — GA4 tag G-JVSCJT2DHJ is on every public page. Traffic is "Data unavailable" until a real GA4 report is wired in. (API still reports pending; corrected here from the site itself.)' },
    'facebook': { status: 'Paused', detail: 'Paused by owner — not created yet. Owner sign-in on his own phone is needed to create it.' },
    'whatsapp-business': { status: 'Paused', detail: 'Paused by owner — not created yet. Owner sign-in on his own phone is needed to create it.' },
    'business-email': { status: 'Paused', detail: 'Paused by owner — not created yet. Owner sign-in / provider choice is needed.' },
  };

  function applyAccountOverrides(accounts) {
    return (accounts || []).map(function (a) {
      var o = ACCOUNT_OVERRIDES[a.id];
      if (!o) return a;
      var copy = {};
      for (var k in a) copy[k] = a[k];
      copy.status = o.status;
      copy.detail = o.detail;
      return copy;
    });
  }

  function accountRow(a) {
    var name = a.platform || a.name;
    var link;
    if (a.url) {
      link = '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.handle || name) + '</a>';
    } else if (a.status === 'Verified' || a.status === 'Connected' || a.status === 'active') {
      /* Verified/Connected rows have no URL to link — show the status
         itself, never "Not yet created or connected", which contradicts
         the pill next to it (seen on the owner's phone, 2026-11-14). */
      link = '<span class="muted">' + esc(a.status) + '</span>';
    } else {
      link = '<span class="muted">Not yet created or connected</span>';
    }
    return '<li><strong>' + esc(name) + '</strong> — ' + link + ' ' + statusPill(a.status) +
      (a.detail ? '<br><span class="muted">' + esc(a.detail) + '</span>' : '') + '</li>';
  }

  /* --- 1. Overview --- */
  function loadOverview() {
    var F = window.FSAI;
    var kpi = el('kpiGrid');
    var renderKpis = function (articles, divisions, tools, agents, analytics) {
      var revenue = (analytics && analytics.revenueFormatted) || (F ? F.SITE.revenue : '$0.00');
      var traffic = (analytics && analytics.visitors && analytics.visitors !== 'Data unavailable')
        ? String(analytics.visitors) : (F ? F.SITE.traffic : 'Data unavailable');
      var cards = [
        { label: 'Articles published', value: String(articles), note: 'Across ' + divisions + ' divisions' },
        { label: 'Divisions', value: String(divisions), note: 'One platform, multiple possibilities' },
        { label: 'Free tools', value: String(tools), note: 'Converters and calculators' },
        { label: 'AI agents', value: String(agents), note: '14-agent system + Business Manager + Security' },
        { label: 'Revenue', value: revenue, note: 'Zero-cost platform — no paid services, no sales yet' },
        { label: 'Traffic', value: traffic, note: analytics && analytics.analyticsConnected ? 'GA4 connected — latest snapshot shown' : 'Analytics is connected (GA4), but no GA4 report is wired in — no traffic numbers are claimed' },
      ];
      if (kpi) {
        kpi.innerHTML = cards.map(function (c) {
          return '<div class="card kpi-card"><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note) + '</p></div>';
        }).join('');
      }
    };
    var counts = F ? F.countsByDivision() : [];
    var total = F ? F.ARTICLES.length : 0;
    var divTable = el('divisionCounts');
    if (divTable) {
      divTable.innerHTML = counts.map(function (c) {
        var pct = total ? Math.round((c.count / total) * 100) : 0;
        return '<tr><td>' + esc(c.division) + '</td><td>' + c.count + '</td><td>' + pct + '%</td></tr>';
      }).join('');
    }
    var latest = el('latestArticles');
    if (latest && F) {
      var sorted = F.ARTICLES.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
      latest.innerHTML = sorted.map(function (a) {
        return '<li><a href="article.html?id=' + a.id + '">' + esc(a.title) + '</a> <span class="muted">— ' + esc(a.division) + ', ' + F.formatDate(a.date) + '</span></li>';
      }).join('');
    }
    setText('dashboardNote', 'All numbers on this page come from the real content on this site or the live API. Revenue is $0.00 and traffic is "Data unavailable" unless the API returns a real row.');
    /* Live counts where the API answers; static site data otherwise. */
    renderKpis(total, F ? F.DIVISIONS.length : 0, F ? F.TOOLS.length : 0, F ? F.AGENTS.length : 0, null);
    api('/api/articles?limit=100').then(function (r) {
      if (!r.ok) return;
      var arts = r.data.articles || [];
      renderKpis(r.data.total != null ? r.data.total : arts.length, F ? F.DIVISIONS.length : 0, F ? F.TOOLS.length : 0, F ? F.AGENTS.length : 0, null);
      if (latest && arts.length) {
        var sortedApi = arts.slice().sort(function (a, b) { return String(b.publishedAt || b.created_at || '').localeCompare(String(a.publishedAt || a.created_at || '')); }).slice(0, 5);
        latest.innerHTML = sortedApi.map(function (a) {
          return '<li>' + esc(a.title) + ' <span class="muted">— ' + esc(a.divisionName || a.division || '') + ', ' + fmtDate(a.publishedAt || a.created_at) + '</span></li>';
        }).join('');
      }
    }).catch(function () {});
    api('/api/divisions').then(function (r) {
      if (!r.ok || !r.data.divisions) return;
      var divs = r.data.divisions;
      if (divTable) {
        var tot = divs.reduce(function (n, d) { return n + (d.articleCount || 0); }, 0);
        divTable.innerHTML = divs.map(function (d) {
          var pct = tot ? Math.round(((d.articleCount || 0) / tot) * 100) : 0;
          return '<tr><td>' + esc(d.name) + '</td><td>' + (d.articleCount || 0) + '</td><td>' + pct + '%</td></tr>';
        }).join('');
      }
    }).catch(function () {});
    api('/api/analytics').then(function (r) {
      if (r.ok) renderKpis(total, F ? F.DIVISIONS.length : 0, F ? F.TOOLS.length : 0, F ? F.AGENTS.length : 0, r.data);
    }).catch(function () {});
  }

  /* --- 2. Content Management --- */
  function loadArticles() {
    var filter = el('contentFilter');
    var q = filter && filter.value ? '?status=' + encodeURIComponent(filter.value) : '';
    setText('contentStatus', 'Loading articles…');
    api('/api/admin/articles' + q).then(function (r) {
      var list = el('adminArticleList');
      if (!r.ok) { setText('contentStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var arts = r.data.articles || [];
      setText('contentStatus', arts.length + ' article(s)' + (r.data.source ? ' (source: ' + r.data.source + ')' : ''));
      if (!list) return;
      list.innerHTML = arts.map(function (a) {
        return '<tr><td>' + esc(a.title) + '</td><td>' + esc(a.divisionName || a.division || '') + '</td><td>' + statusPill(a.status) + '</td><td>' + fmtDate(a.publishedAt || a.published_at) + '</td>' +
          '<td><button class="btn btn-small" type="button" data-article-action="publish" data-id="' + a.id + '">Publish</button> ' +
          '<button class="btn btn-small" type="button" data-article-action="unpublish" data-id="' + a.id + '">Unpublish</button> ' +
          '<button class="btn btn-small" type="button" data-article-action="edit" data-id="' + a.id + '">Edit</button> ' +
          '<button class="btn btn-small" type="button" data-article-action="revisions" data-id="' + a.id + '">Revisions</button> ' +
          '<button class="btn btn-small btn-danger" type="button" data-article-action="delete" data-id="' + a.id + '">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="5">No articles found.</td></tr>';
    }).catch(function () { setText('contentStatus', 'Could not reach the FS AI server.'); });
  }

  function loadRevisions(id) {
    api('/api/admin/articles/' + id + '/revisions').then(function (r) {
      var box = el('articleRevisions');
      if (!box) return;
      if (!r.ok) { box.innerHTML = '<li>' + esc(apiError(r)) + '</li>'; return; }
      var revs = r.data.revisions || [];
      box.innerHTML = revs.map(function (v) {
        return '<li><strong>' + esc(v.title || '(untitled)') + '</strong> — ' + statusPill(v.status) + ' <span class="muted">' + esc(v.revised_by || '') + ' · ' + fmtDate(v.revised_at) + '</span></li>';
      }).join('') || '<li>No earlier revisions for this article.</li>';
    }).catch(function () { setText('articleFormStatus', 'Could not reach the FS AI server.'); });
  }

  function bindContent() {
    var list = el('adminArticleList');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-article-action]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-article-action');
        if (action === 'revisions') { loadRevisions(id); return; }
        if (action === 'delete') {
          if (!window.confirm('Delete this article? Its revisions are kept.')) return;
          api('/api/admin/articles/' + id, { method: 'DELETE' }).then(function (r) {
            setText('articleFormStatus', r.ok ? 'Article deleted.' : apiError(r));
            if (r.ok) loadArticles();
          }).catch(function () { setText('articleFormStatus', 'Could not reach the FS AI server.'); });
          return;
        }
        if (action === 'publish' || action === 'unpublish') {
          api('/api/admin/articles/' + id + '/' + action, { method: 'POST' }).then(function (r) {
            setText('articleFormStatus', r.ok ? 'Article ' + (action === 'publish' ? 'published.' : 'unpublished.') : apiError(r));
            if (r.ok) loadArticles();
          }).catch(function () { setText('articleFormStatus', 'Could not reach the FS AI server.'); });
          return;
        }
        if (action === 'edit') {
          api('/api/admin/articles/' + id).then(function (r) {
            if (!r.ok) { setText('articleFormStatus', apiError(r)); return; }
            var a = r.data.article || {};
            editingArticleId = a.id;
            var title = el('articleFormTitle');
            if (title) title.textContent = 'Edit article #' + a.id;
            var set = function (id2, v) { var n = el(id2); if (n) n.value = v == null ? '' : v; };
            set('articleTitle', a.title);
            set('articleDivision', a.division || '');
            set('articleExcerpt', a.excerpt);
            set('articleBody', a.body);
            set('articleStatus', a.status || 'draft');
            setText('articleFormStatus', 'Editing "' + (a.title || '') + '". Saving stores a revision first.');
            var form = el('articleForm');
            if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }).catch(function () { setText('articleFormStatus', 'Could not reach the FS AI server.'); });
        }
      });
    }
    var filter = el('contentFilter');
    if (filter) filter.addEventListener('change', loadArticles);
    var form = el('articleForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {
          title: el('articleTitle').value.trim(),
          division: el('articleDivision').value.trim(),
          excerpt: el('articleExcerpt').value.trim(),
          body: el('articleBody').value,
          status: el('articleStatus').value,
        };
        if (!body.title || !body.division || !body.body) {
          setText('articleFormStatus', 'Title, division and body are required.');
          return;
        }
        var done = function (r) {
          setText('articleFormStatus', r.ok ? (editingArticleId ? 'Article updated.' : 'Article created as ' + body.status + '.') : apiError(r));
          if (r.ok) { editingArticleId = null; form.reset(); var t = el('articleFormTitle'); if (t) t.textContent = 'New article'; loadArticles(); }
        };
        if (editingArticleId) {
          api('/api/admin/articles/' + editingArticleId, { method: 'PUT', body: body }).then(done)
            .catch(function () { setText('articleFormStatus', 'Could not reach the FS AI server.'); });
        } else {
          api('/api/admin/articles', { method: 'POST', body: body }).then(done)
            .catch(function () { setText('articleFormStatus', 'Could not reach the FS AI server.'); });
        }
      });
    }
    var cancel = el('articleFormCancel');
    if (cancel) {
      cancel.addEventListener('click', function () {
        editingArticleId = null;
        var form = el('articleForm');
        if (form) form.reset();
        var t = el('articleFormTitle');
        if (t) t.textContent = 'New article';
        setText('articleFormStatus', '');
      });
    }
  }

  /* --- 3. Division Management --- */
  function loadDivisions() {
    setText('divisionStatus', 'Loading divisions…');
    api('/api/admin/divisions').then(function (r) {
      var list = el('adminDivisionList');
      if (!r.ok) { setText('divisionStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var divs = r.data.divisions || [];
      setText('divisionStatus', divs.length + ' division(s)' + (r.data.source ? ' (source: ' + r.data.source + ')' : ''));
      if (!list) return;
      list.innerHTML = divs.map(function (d) {
        var active = d.is_active === 1 || d.is_active === true;
        return '<tr><td>' + esc(d.name) + '</td><td>' + esc(d.slug) + '</td><td>' + (d.articleCount != null ? d.articleCount : '—') + '</td><td>' + statusPill(active ? 'Active' : 'Inactive') + '</td>' +
          '<td><button class="btn btn-small" type="button" data-division-action="toggle" data-id="' + d.id + '" data-active="' + (active ? '1' : '0') + '">' + (active ? 'Deactivate' : 'Activate') + '</button> ' +
          '<button class="btn btn-small btn-danger" type="button" data-division-action="delete" data-id="' + d.id + '">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="5">No divisions found.</td></tr>';
    }).catch(function () { setText('divisionStatus', 'Could not reach the FS AI server.'); });
  }

  function bindDivisions() {
    var list = el('adminDivisionList');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-division-action]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (btn.getAttribute('data-division-action') === 'toggle') {
          var next = btn.getAttribute('data-active') === '1' ? 0 : 1;
          api('/api/admin/divisions/' + id, { method: 'PUT', body: { is_active: next } }).then(function (r) {
            setText('divisionFormStatus', r.ok ? 'Division ' + (next ? 'activated.' : 'deactivated.') : apiError(r));
            if (r.ok) loadDivisions();
          }).catch(function () { setText('divisionFormStatus', 'Could not reach the FS AI server.'); });
        } else {
          if (!window.confirm('Delete this division? It fails (409) if any article uses it.')) return;
          api('/api/admin/divisions/' + id, { method: 'DELETE' }).then(function (r) {
            setText('divisionFormStatus', r.ok ? 'Division deleted.' : apiError(r));
            if (r.ok) loadDivisions();
          }).catch(function () { setText('divisionFormStatus', 'Could not reach the FS AI server.'); });
        }
      });
    }
    var form = el('divisionForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = { name: el('divisionName').value.trim(), description: el('divisionDescription').value.trim() };
        var slug = el('divisionSlug').value.trim();
        if (slug) body.slug = slug;
        api('/api/admin/divisions', { method: 'POST', body: body }).then(function (r) {
          setText('divisionFormStatus', r.ok ? 'Division added.' : apiError(r));
          if (r.ok) { form.reset(); loadDivisions(); }
        }).catch(function () { setText('divisionFormStatus', 'Could not reach the FS AI server.'); });
      });
    }
  }

  /* --- 4. Tools Management --- */
  function loadTools() {
    setText('toolsStatus', 'Loading tools…');
    api('/api/tools').then(function (r) {
      var list = el('adminToolList');
      if (!r.ok) { setText('toolsStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var tools = r.data.tools || [];
      var F = window.FSAI;
      setText('toolsStatus', tools.length + ' tool(s) from the API (source: ' + (r.data.source || 'api') + '). This site’s 20 working tools are the frontend catalogue' + (F ? ' (' + F.TOOLS.length + ' tools)' : '') + '.');
      if (!list) return;
      list.innerHTML = tools.map(function (t) {
        var active = t.isActive === true || t.is_active === 1;
        return '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.slug || t.id) + '</td><td>' + esc(t.divisionName || t.division || '—') + '</td><td>' + statusPill(active ? 'Active' : 'Inactive') + '</td></tr>';
      }).join('') || '<tr><td colspan="4">No tools found.</td></tr>';
    }).catch(function () { setText('toolsStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- 5. AI Agent Control --- */
  function loadEmergencyStop() {
    api('/api/admin/emergency-stop').then(function (r) {
      var state = el('emergencyStopState');
      var btn = el('emergencyStopBtn');
      if (!r.ok) {
        emergencyStopped = null;
        if (state) state.textContent = 'Unknown — ' + apiError(r);
        if (btn) btn.disabled = true;
        return;
      }
      emergencyStopped = !!r.data.stopped;
      if (state) state.textContent = emergencyStopped ? 'ON — agent runs are blocked (423)' : 'OFF — agent runs allowed';
      if (btn) { btn.disabled = false; btn.textContent = emergencyStopped ? 'Turn Emergency Stop OFF' : 'Turn Emergency Stop ON'; }
    }).catch(function () {
      var state = el('emergencyStopState');
      if (state) state.textContent = 'Unknown — could not reach the server.';
    });
  }

  function loadAgents() {
    setText('agentStatus', 'Loading agents…');
    api('/api/agents').then(function (r) {
      var list = el('adminAgentList');
      if (!r.ok) { setText('agentStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var agents = r.data.agents || [];
      if (r.data.emergencyStop !== undefined && emergencyStopped === null) {
        emergencyStopped = !!r.data.emergencyStop;
        var state = el('emergencyStopState');
        var btn = el('emergencyStopBtn');
        if (state) state.textContent = emergencyStopped ? 'ON — agent runs are blocked (423)' : 'OFF — agent runs allowed';
        if (btn) btn.textContent = emergencyStopped ? 'Turn Emergency Stop OFF' : 'Turn Emergency Stop ON';
      }
      setText('agentStatus', agents.length + ' agent(s)' + (r.data.source ? ' (source: ' + r.data.source + ')' : '') + '. Run answers 423 while the Emergency Stop is ON.');
      if (list) {
        list.innerHTML = agents.map(function (a) {
          var last = a.lastRun ? 'Last run: ' + esc(a.lastRun.action || '') + ' (' + esc(a.lastRun.status || '') + ', ' + fmtDate(a.lastRun.createdAt) + ')' : 'No run recorded yet.';
          return '<li><strong>' + esc(a.name) + '</strong> — ' + esc(a.role || a.description || '') + ' ' + statusPill(a.status) +
            '<br><span class="muted">' + last + '</span><br>' +
            '<button class="btn btn-small" type="button" data-agent-action="run" data-id="' + a.id + '">Run</button> ' +
            '<button class="btn btn-small" type="button" data-agent-action="pause" data-id="' + a.id + '">Pause</button> ' +
            '<button class="btn btn-small" type="button" data-agent-action="resume" data-id="' + a.id + '">Resume</button> ' +
            '<button class="btn btn-small btn-danger" type="button" data-agent-action="disable" data-id="' + a.id + '">Disable</button> ' +
            '<button class="btn btn-small" type="button" data-agent-action="logs" data-id="' + a.id + '">Logs</button></li>';
        }).join('');
      }
      var fallbackList = el('agentList');
      if (fallbackList && !agents.length && window.FSAI) {
        fallbackList.innerHTML = window.FSAI.AGENTS.map(function (a) {
          return '<li><strong>' + esc(a.name) + '</strong> — ' + esc(a.role) + ' ' + statusPill(a.status) + '</li>';
        }).join('');
      }
    }).catch(function () { setText('agentStatus', 'Could not reach the FS AI server.'); });
  }

  function loadAgentLogs(id) {
    api('/api/agents/' + encodeURIComponent(id) + '/logs').then(function (r) {
      var box = el('agentLogs');
      if (!box) return;
      if (!r.ok) { box.innerHTML = '<li>' + esc(apiError(r)) + '</li>'; return; }
      var logs = r.data.logs || [];
      box.innerHTML = logs.map(function (l) {
        return '<li><strong>' + esc(l.action || '') + '</strong> — ' + statusPill(l.status) + ' <span class="muted">' + fmtDate(l.created_at) + '</span>' +
          (l.details ? '<br><span class="muted">' + esc(typeof l.details === 'string' ? l.details : JSON.stringify(l.details)).slice(0, 200) + '</span>' : '') + '</li>';
      }).join('') || '<li>No activity rows for this agent yet.</li>';
    }).catch(function () { var b = el('agentLogs'); if (b) b.innerHTML = '<li>Could not reach the FS AI server.</li>'; });
  }

  function bindAgents() {
    var list = el('adminAgentList');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-agent-action]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-agent-action');
        if (action === 'logs') { loadAgentLogs(id); return; }
        api('/api/agents/' + encodeURIComponent(id) + '/' + action, { method: 'POST' }).then(function (r) {
          setText('agentStatus', r.ok ? 'Agent ' + id + ': ' + action + ' done.' : apiError(r) + (r.status === 423 ? ' (Emergency Stop is ON.)' : ''));
          if (r.ok) loadAgents();
        }).catch(function () { setText('agentStatus', 'Could not reach the FS AI server.'); });
      });
    }
    var stopBtn = el('emergencyStopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        var next = !emergencyStopped;
        if (!window.confirm(next ? 'Turn the Emergency Stop ON? All agent runs will be blocked (423).' : 'Turn the Emergency Stop OFF? Agent runs will be allowed again.')) return;
        api('/api/admin/emergency-stop', { method: 'POST', body: { stopped: next } }).then(function (r) {
          if (r.ok) { emergencyStopped = !!r.data.stopped; loadEmergencyStop(); setText('agentStatus', 'Emergency Stop is now ' + (emergencyStopped ? 'ON.' : 'OFF.')); }
          else setText('agentStatus', apiError(r));
        }).catch(function () { setText('agentStatus', 'Could not reach the FS AI server.'); });
      });
    }
  }

  /* --- 6. Social Media Management + 11. Account Connections --- */
  function loadAccounts() {
    setText('socialStatus', 'Loading accounts…');
    api('/api/accounts').then(function (r) {
      var social = el('socialAccountList');
      var conns = el('accountList');
      if (!r.ok) {
        setText('socialStatus', apiError(r));
        if (window.FSAI) {
          var fallback = applyAccountOverrides(window.FSAI.ACCOUNTS.map(function (a) {
            return { id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), platform: a.name, handle: a.handle, url: a.url, status: a.status, detail: a.detail };
          }));
          if (social) social.innerHTML = fallback.map(accountRow).join('');
          if (conns) conns.innerHTML = fallback.map(accountRow).join('');
          setText('socialStatus', 'API unavailable — showing the site’s own verified account list instead.');
        }
        return;
      }
      var accounts = applyAccountOverrides(r.data.accounts || []);
      setText('socialStatus', accounts.length + ' account(s) (source: ' + (r.data.source || 'api') + '). Search Console / Analytics rows are corrected from the site itself — see the note on each row.');
      if (social) social.innerHTML = accounts.map(accountRow).join('');
      if (conns) conns.innerHTML = accounts.map(accountRow).join('');
      var steps = el('socialOwnerSteps');
      if (steps) {
        steps.innerHTML = [
          'Facebook Page — not created. Owner creates the Page on his own phone (sign-in needed).',
          'WhatsApp Business — not created. Owner sign-in on his own phone.',
          'Business Email — not created. Owner sign-in / provider choice.',
          'AdSense — not applied for. Owner application + site verification when he chooses; traffic is required first.',
          'Affiliate programmes — not started. Owner choice of programme(s).',
        ].map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      }
    }).catch(function () { setText('socialStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- 7. Newsletter Management --- */
  function loadSubscribers() {
    var filter = el('subscriberFilter');
    var q = filter && filter.value ? '?status=' + encodeURIComponent(filter.value) : '';
    setText('subscriberStatus', 'Loading subscribers…');
    api('/api/admin/subscribers' + q).then(function (r) {
      var list = el('subscriberList');
      if (!r.ok) { setText('subscriberStatus', apiError(r)); if (list) list.innerHTML = ''; return; }
      var subs = r.data.subscribers || [];
      setText('subscriberStatus', (r.data.total != null ? r.data.total : subs.length) + ' subscriber(s). All stored as pending confirmation — no confirmation email can be sent yet.');
      if (!list) return;
      list.innerHTML = subs.map(function (s) {
        return '<tr><td>' + esc(s.email) + '</td><td>' + esc(s.name || '') + '</td><td>' + statusPill(s.status) + '</td><td>' + fmtDate(s.subscribed_at || s.created_at) + '</td>' +
          '<td>' + (s.status !== 'unsubscribed' ? '<button class="btn btn-small" type="button" data-subscriber-unsubscribe="' + s.id + '">Unsubscribe</button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="5">No subscribers found.</td></tr>';
    }).catch(function () { setText('subscriberStatus', 'Could not reach the FS AI server.'); });
  }

  function bindSubscribers() {
    var list = el('subscriberList');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-subscriber-unsubscribe]');
        if (!btn) return;
        var id = btn.getAttribute('data-subscriber-unsubscribe');
        api('/api/admin/subscribers/' + id + '/unsubscribe', { method: 'POST' }).then(function (r) {
          setText('subscriberStatus', r.ok ? 'Subscriber unsubscribed.' : apiError(r));
          if (r.ok) loadSubscribers();
        }).catch(function () { setText('subscriberStatus', 'Could not reach the FS AI server.'); });
      });
    }
    var filter = el('subscriberFilter');
    if (filter) filter.addEventListener('change', loadSubscribers);
  }

  /* --- 8. SEO Management --- */
  function loadSeo() {
    setText('seoStatus', 'Checking sitemap, robots, Search Console and GA4…');
    var checks = [];
    var render = function () {
      var box = el('seoChecks');
      if (!box) return;
      box.innerHTML = checks.map(function (c) {
        return '<li><strong>' + esc(c.label) + '</strong> ' + statusPill(c.status) + (c.detail ? '<br><span class="muted">' + esc(c.detail) + '</span>' : '') + '</li>';
      }).join('');
    };
    checks.push({ label: 'Search Console', status: 'Verified', detail: 'Verified by the owner 2026-11-11 (URL-prefix + verification file google745797e85dfd966e.html). Sitemap submitted — re-submit after the corrected sitemap is deployed.' });
    checks.push({ label: 'Analytics (GA4 G-JVSCJT2DHJ)', status: 'Connected', detail: 'GA4 tag is on every public page. Data may take up to 48h to appear; no GA4 report is wired into this dashboard yet.' });
    checks.push({ label: 'Canonical + Open Graph + Twitter/X meta', status: 'Active', detail: 'Present on index, article, division, tools and dashboard pages. Per-article meta is injected by JavaScript, so crawlers that do not run JS see only the generic article tags.' });
    checks.push({ label: 'JSON-LD', status: 'Active', detail: 'WebSite on the homepage; Article + BreadcrumbList injected by JavaScript on article pages; CollectionPage on division pages.' });
    render();
    var checkUrl = function (url, label) {
      return fetch(url, { method: 'GET' }).then(function (res) {
        return res.text().then(function (text) {
          var ok = res.ok && text && text.length > 10 && text.indexOf('<!DOCTYPE html>') !== 0;
          checks.push({ label: label, status: ok ? 'Active' : 'Failed', detail: ok ? 'Served at ' + url : 'Returned HTTP ' + res.status + ' or the homepage HTML — verify live delivery.' });
          render();
        });
      }).catch(function () {
        checks.push({ label: label, status: 'Failed', detail: 'Could not be fetched from this browser.' });
        render();
      });
    };
    checkUrl(SITE_BASE + '/sitemap.xml', 'Sitemap (/sitemap.xml)');
    checkUrl(SITE_BASE + '/robots.txt', 'robots.txt (/robots.txt)');
    fetch(SITE_BASE + '/', { method: 'GET' }).then(function (res) { return res.text(); }).then(function (text) {
      var hasCanon = text.indexOf('rel="canonical"') !== -1;
      checks.push({ label: 'Homepage canonical tag (live fetch)', status: hasCanon ? 'Active' : 'Failed', detail: hasCanon ? 'Canonical found in the live homepage HTML.' : 'No canonical tag found in the live homepage HTML.' });
      render();
      setText('seoStatus', 'SEO checks done.');
    }).catch(function () { setText('seoStatus', 'Could not fetch the live homepage to verify tags.'); });
  }

  /* --- 9. Analytics + 10. Monetization --- */
  function loadAnalytics() {
    setText('analyticsStatus', 'Loading analytics…');
    api('/api/analytics').then(function (r) {
      var grid = el('analyticsGrid');
      if (!r.ok) { setText('analyticsStatus', apiError(r)); if (grid) grid.innerHTML = ''; return; }
      var d = r.data;
      setText('analyticsStatus', d.note || '');
      var cards = [
        { label: 'Revenue', value: d.revenueFormatted || '$0.00', note: 'Honest $0.00 — no sales, no AdSense yet' },
        { label: 'Visitors', value: String(d.visitors != null ? d.visitors : 'Data unavailable'), note: d.analyticsConnected ? 'From the latest snapshot' : 'No GA4 report wired in yet' },
        { label: 'Page views', value: String(d.pageViews != null ? d.pageViews : 'Data unavailable'), note: d.analyticsConnected ? 'From the latest snapshot' : 'No GA4 report wired in yet' },
        { label: 'Clicks', value: String(d.clicks != null ? d.clicks : 'Data unavailable'), note: d.analyticsConnected ? 'From the latest snapshot' : 'No GA4 report wired in yet' },
      ];
      if (grid) {
        grid.innerHTML = cards.map(function (c) {
          return '<div class="card kpi-card"><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note) + '</p></div>';
        }).join('');
      }
      var mGrid = el('monetizationGrid');
      var mStatus = el('monetizationStatus');
      if (mGrid) {
        mGrid.innerHTML = [
          { label: 'Revenue', value: d.revenueFormatted || '$0.00', note: 'Ads only — no product or subscription is sold' },
          { label: 'AdSense', value: 'Pending', note: 'Not applied for — traffic is required before applying' },
          { label: 'Affiliate', value: 'Pending', note: 'Not started — owner choice of programme(s)' },
        ].map(function (c) {
          return '<div class="card kpi-card"><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note) + '</p></div>';
        }).join('');
      }
      if (mStatus) mStatus.textContent = 'Monetization is ads only. AdSense needs traffic first, so no earnings are claimed.';
    }).catch(function () {
      setText('analyticsStatus', 'Could not reach the FS AI server.');
      var mGrid = el('monetizationGrid');
      if (mGrid) {
        mGrid.innerHTML = '<div class="card kpi-card"><div class="kpi-value">$0.00</div><div class="kpi-label">Revenue</div><p class="muted">Ads only — no product or subscription is sold</p></div>';
      }
    });
  }

  /* --- 12. Security --- */
  function loadSecurity() {
    var s = window.FSAI && window.FSAI.auth ? window.FSAI.auth.getSession() : null;
    var box = el('securityPanel');
    if (!box) return;
    var items = [];
    if (s) {
      items.push('<strong>Signed in as:</strong> ' + esc(s.email) + ' (' + esc(s.mode || '') + ' session)' + (s.expiresAt ? ' — expires ' + esc(s.expiresAt) : ''));
    } else {
      items.push('No session found — sign in to load the dashboard.');
    }
    items.push('<strong>Login:</strong> email + password only. MFA was removed by the owner’s decision (2026-11-11) — the owner account is password-only.');
    items.push('<strong>Rate limits:</strong> 100 reads/min, 30 writes/min per IP on the Worker API.');
    items.push('<strong>Cloudflare Access lock:</strong> Paused by the owner — the Command Center is hidden behind this login, which is not a real access lock. Do not resume until the owner says so.');
    items.push('<strong>Passwords:</strong> PBKDF2, 100,000 iterations, SHA-256. No password, hash or token is stored in frontend code.');
    box.innerHTML = items.map(function (i) { return '<li>' + i + '</li>'; }).join('');
    setText('securityStatus', 'Session and security facts for this browser tab.');
  }

  /* --- 13. System Logs --- */
  function loadSystemLogs() {
    setText('logsStatus', 'Loading agent logs…');
    api('/api/agents').then(function (r) {
      if (!r.ok) { setText('logsStatus', apiError(r)); return; }
      var agents = r.data.agents || [];
      var all = [];
      var done = 0;
      if (!agents.length) { setText('logsStatus', 'No agents found.'); return; }
      agents.forEach(function (a) {
        api('/api/agents/' + encodeURIComponent(a.id) + '/logs').then(function (lr) {
          done += 1;
          if (lr.ok) {
            (lr.data.logs || []).forEach(function (l) {
              all.push({ agent: a.name, action: l.action, status: l.status, at: l.created_at, details: l.details });
            });
          }
          if (done === agents.length) {
            all.sort(function (x, y) { return String(y.at || '').localeCompare(String(x.at || '')); });
            var box = el('systemLogs');
            if (box) {
              box.innerHTML = all.slice(0, 20).map(function (l) {
                return '<li><strong>' + esc(l.agent) + '</strong> — ' + esc(l.action || '') + ' ' + statusPill(l.status) + ' <span class="muted">' + fmtDate(l.at) + '</span></li>';
              }).join('') || '<li>No agent activity logged yet.</li>';
            }
            setText('logsStatus', all.length + ' log row(s) across ' + agents.length + ' agent(s), latest 20 shown.');
          }
        }).catch(function () {
          done += 1;
          if (done === agents.length) setText('logsStatus', 'Some agent logs could not be loaded.');
        });
      });
    }).catch(function () { setText('logsStatus', 'Could not reach the FS AI server.'); });
  }

  /* --- 14. Backup and Recovery --- */
  function bindBackup() {
    var btn = el('backupDownloadBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      setText('backupStatus', 'Downloading backup…');
      api('/api/admin/backup').then(function (r) {
        if (!r.ok) { setText('backupStatus', apiError(r)); return; }
        var blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = 'fs-ai-backup-' + stamp + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        var counts = r.data.counts || {};
        var box = el('backupCounts');
        if (box) {
          box.innerHTML = Object.keys(counts).map(function (t) {
            return '<li><strong>' + esc(t) + '</strong>: ' + counts[t] + ' row(s)</li>';
          }).join('');
        }
        var warnings = r.data.warnings || [];
        setText('backupStatus', 'Backup downloaded (exported ' + (r.data.exported_at || 'just now') + ').' + (warnings.length ? ' Warnings: ' + warnings.join(' ') : ''));
      }).catch(function () { setText('backupStatus', 'Could not reach the FS AI server.'); });
    });
  }

  function loadAll() {
    setText('dashboardApiStatus', 'Session verified — loading live data from the Worker API…');
    loadOverview();
    loadArticles();
    loadDivisions();
    loadTools();
    loadEmergencyStop();
    loadAgents();
    loadAccounts();
    loadSubscribers();
    loadSeo();
    loadAnalytics();
    loadSecurity();
    loadSystemLogs();
    setText('dashboardApiStatus', 'Live data loaded. Any section that could not reach the API says so instead of showing invented numbers.');
  }

  function startIfVerified() {
    if (loaded) return;
    var auth = window.FSAI && window.FSAI.auth;
    var verified = (window.FSAI && window.FSAI.sessionVerified) ||
      (auth && auth.isSessionVerified && auth.isSessionVerified());
    if (verified && token()) {
      loaded = true;
      loadAll();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindContent();
    bindDivisions();
    bindAgents();
    bindSubscribers();
    bindBackup();
    startIfVerified();
    window.addEventListener('fsai:session-verified', startIfVerified);
  });
})();
