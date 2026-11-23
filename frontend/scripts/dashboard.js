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
  // Workstream A (task G): article ids with a delete request in
  // flight — a second click on the same row is ignored until the
  // first one finishes, so a double-click can never send two DELETEs.
  var deleteInFlight = {};

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
    else if (lower.indexOf('tracking connected') === 0) cls += ' ok'; /* "Tracking Connected — Reporting API Not Connected" is a live-tag state, not a failure. */
    else if (['pending', 'paused', 'draft', 'pending_approval', 'approved'].indexOf(lower) !== -1) cls += ' pending';
    else if (lower.indexOf('pending owner authorization') === 0) cls += ' pending';
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
     is Google Property Verified by the owner 2026-11-11 (verification file
     is served from this site — "Verification File Installed", not an API
     connection) and GA4 G-JVSCJT2DHJ is tagged on every public page.
     Analytics is therefore exactly "Tracking Connected — Reporting API Not
     Connected" — never "Connected" alone, because no GA4 Reporting API is
     used anywhere in this repo. Facebook / WhatsApp Business / Business
     Email are paused by the owner and pending his authorization. The live
     API (D1) still lists Search Console + Analytics as pending, so the
     dashboard corrects those two rows and labels the correction. */
  var ACCOUNT_OVERRIDES = {
    'search-console': { status: 'Verified', detail: 'Google Property Verified by the owner 2026-11-11 (URL-prefix + verification file google745797e85dfd966e.html served from this site). Verification File Installed — no Search Console API connection exists. (API still reports pending; corrected here from the site itself.)' },
    'analytics': { status: 'Tracking Connected — Reporting API Not Connected', detail: 'Tracking Connected — Reporting API Not Connected: GA4 tag G-JVSCJT2DHJ is on every public page, but no GA4 Reporting API is connected, so traffic is "Data unavailable". (API still reports pending; corrected here from the site itself.)' },
    'facebook': { status: 'Paused', detail: 'Pending owner authorization — Paused by owner, not created yet. Owner sign-in on his own phone is needed to create it.' },
    'whatsapp-business': { status: 'Paused', detail: 'Pending owner authorization — Paused by owner, not created yet. Owner sign-in on his own phone is needed to create it.' },
    'business-email': { status: 'Paused', detail: 'Pending owner authorization — Paused by owner, not created yet. Owner sign-in / provider choice is needed.' },
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
    } else if (a.status === 'Verified' || a.status === 'Connected' || a.status === 'active' ||
      String(a.status).indexOf('Tracking Connected') === 0) {
      /* Verified/Connected rows have no URL to link — show the status
         itself, never "Not yet created or connected", which contradicts
         the pill next to it (seen on the owner's phone, 2026-11-14).
         "Tracking Connected — Reporting API Not Connected" counts here:
         the GA4 tag is live, so the row must never claim nothing exists. */
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
        { label: 'Traffic', value: traffic, note: analytics && analytics.analyticsConnected ? 'GA4 connected — latest snapshot shown' : 'GA4 tag is live (tracking), but no GA4 Reporting API is connected — no traffic numbers are claimed' },
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
        return '<li><a href="article?id=' + a.id + '">' + esc(a.title) + '</a> <span class="muted">— ' + esc(a.division) + ', ' + F.formatDate(a.date) + '</span></li>';
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
        // Fix 1: show the protection state in the CMS list. The API
        // returns is_protected once migration 013 is applied; on an
        // older database the field is absent and the two protected
        // test articles fall back to their ids (display only).
        var isProt = (a.is_protected === 1 || a.is_protected === '1' || (a.is_protected == null && (a.id === 26 || a.id === 27)));
        var prot = isProt
          ? '<br><strong>PROTECTED — AUTOMATIC MODIFICATION DISABLED</strong>' : '';
        return '<tr><td>' + esc(a.title) + prot + '</td><td>' + esc(a.divisionName || a.division || '') + '</td><td>' + statusPill(a.status) + '</td><td>' + fmtDate(a.publishedAt || a.published_at) + '</td>' +
          '<td><button class="btn btn-small" type="button" data-article-action="publish" data-id="' + a.id + '">Publish</button> ' +
          '<button class="btn btn-small" type="button" data-article-action="unpublish" data-id="' + a.id + '">Unpublish</button> ' +
          '<button class="btn btn-small" type="button" data-article-action="edit" data-id="' + a.id + '">Edit</button> ' +
          '<button class="btn btn-small" type="button" data-article-action="revisions" data-id="' + a.id + '">Revisions</button> ' +
          // Workstream A (task G): the Delete button carries the facts
          // the delete handler needs — title, status and protected
          // state — so it can refuse protected articles client-side
          // and warn about published ones before any request is sent.
          '<button class="btn btn-small btn-danger" type="button" data-article-action="delete" data-id="' + a.id + '" data-title="' + esc(a.title || '') + '" data-status="' + esc(a.status || '') + '" data-protected="' + (isProt ? '1' : '0') + '">Delete</button></td></tr>';
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
          // Workstream A (task G, 2026-11-21): the old handler was one
          // bare confirm() away from deleting anything — including
          // protected articles #26/#27 — and a double-click sent two
          // DELETEs (the second 404ed). The repair: refuse protected
          // articles client-side (the server also refuses them 403 —
          // see backend/routes/admin-articles.js, WS-E H1), warn
          // loudly for published articles, disable the button while
          // a delete is in flight, and VERIFY the row is actually
          // gone before reporting success. CSRF: the dashboard sends
          // the owner Bearer token on every request and the Worker
          // only accepts same-origin / CORS-preflighted calls — the
          // crypto.js CSRF helpers exist but are unwired anywhere,
          // so no token header is invented here; see the notes file.
          if (deleteInFlight[id]) return;
          if (btn.getAttribute('data-protected') === '1') {
            setText('articleFormStatus', 'Article #' + id + ' is protected — automatic modification disabled. Deletion refused.');
            return;
          }
          var delTitle = btn.getAttribute('data-title') || '';
          var delStatus = btn.getAttribute('data-status') || '';
          var delConfirm = 'Delete article #' + id + (delTitle ? ' "' + delTitle + '"' : '') + '? Its revisions are kept.';
          if (delStatus === 'published') {
            delConfirm = 'This article is PUBLISHED — deleting removes it from the live site.\n\n' + delConfirm;
          }
          if (!window.confirm(delConfirm)) return;
          deleteInFlight[id] = true;
          btn.disabled = true;
          setText('articleFormStatus', 'Deleting article #' + id + '…');
          api('/api/admin/articles/' + id, { method: 'DELETE' }).then(function (r) {
            if (!r.ok) {
              deleteInFlight[id] = false;
              btn.disabled = false;
              setText('articleFormStatus', apiError(r));
              return;
            }
            // Verify the row is actually gone before claiming success:
            // a 200 that left the row behind must not read "deleted".
            api('/api/admin/articles/' + id).then(function (v) {
              deleteInFlight[id] = false;
              btn.disabled = false;
              if (v.status === 404) {
                setText('articleFormStatus', 'Article deleted.');
                loadArticles();
              } else if (v.ok) {
                setText('articleFormStatus', 'Delete reported success but article #' + id + ' is still there — please check the list before retrying.');
                loadArticles();
              } else {
                setText('articleFormStatus', 'Delete request succeeded but the verification check failed (' + apiError(v) + ') — please check the list.');
                loadArticles();
              }
            }).catch(function () {
              deleteInFlight[id] = false;
              btn.disabled = false;
              setText('articleFormStatus', 'Delete request succeeded but the verification check could not run — please check the list.');
              loadArticles();
            });
          }).catch(function () {
            deleteInFlight[id] = false;
            btn.disabled = false;
            setText('articleFormStatus', 'Could not reach the FS AI server.');
          });
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
  // syncMessage=true when re-fetching because the OTHER section toggled:
  // the message line must match the server state too, or it keeps the
  // stale "Emergency Stop is now ON." from the earlier toggle (live
  // 2026-11-19: OFF toggled from Autonomous Operations left the AI
  // Agent Control message saying ON). The click handler below sets the
  // message itself, and the initial load leaves it to loadAgents'
  // agent-count line, so only the event-driven refresh syncs it here.
  function loadEmergencyStop(syncMessage) {
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
      if (syncMessage) setText('agentStatus', 'Emergency Stop is now ' + (emergencyStopped ? 'ON.' : 'OFF.'));
    }).catch(function () {
      var state = el('emergencyStopState');
      if (state) state.textContent = 'Unknown — could not reach the server.';
    });
  }

  // Tell the other dashboard sections that the E-Stop state changed, so
  // they re-fetch and re-render instead of showing a stale ON/OFF until
  // a full page reload. Live 2026-11-19: toggling here left the
  // Autonomous Operations section (autonomy.js) stale, and vice versa.
  // Uses the codebase's existing fsai:* window-event convention
  // (fsai:session-verified, fsai:theme-change). No new state source:
  // every listener re-fetches from the server with its own loader.
  function notifyEmergencyStopChanged() {
    try { window.dispatchEvent(new CustomEvent('fsai:emergency-stop-changed')); } catch (e) {}
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
        // No confirmation dialog here, deliberately: this is a safety
        // control and must work on the first tap in every browser.
        // A dialog gate broke the toggle live on 2026-11-19 — in
        // browsers that auto-dismiss dialogs the dialog returns false,
        // the handler returned early, and NO request was ever sent
        // (silently, with no error and no state change). The action
        // is instantly reversible (one more click turns it back) and
        // the button label states exactly what will happen.
        var next = !emergencyStopped;
        api('/api/admin/emergency-stop', { method: 'POST', body: { stopped: next } }).then(function (r) {
          if (r.ok) { emergencyStopped = !!r.data.stopped; loadEmergencyStop(); notifyEmergencyStopChanged(); setText('agentStatus', 'Emergency Stop is now ' + (emergencyStopped ? 'ON.' : 'OFF.')); }
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
    checks.push({ label: 'Search Console', status: 'Verified', detail: 'Google Property Verified by the owner 2026-11-11 (URL-prefix + verification file google745797e85dfd966e.html). Verification File Installed — no Search Console API connection exists. Sitemap submitted — re-submit after the corrected sitemap is deployed.' });
    checks.push({ label: 'Analytics (GA4 G-JVSCJT2DHJ)', status: 'Tracking Connected — Reporting API Not Connected', detail: 'GA4 tag is on every public page (tracking). No GA4 Reporting API is connected, so no GA4 report is wired into this dashboard yet; traffic stays "Data unavailable".' });
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
        { label: 'Visitors', value: String(d.visitors != null ? d.visitors : 'Data unavailable'), note: d.analyticsConnected ? 'From the latest snapshot' : 'No GA4 Reporting API connected yet' },
        { label: 'Page views', value: String(d.pageViews != null ? d.pageViews : 'Data unavailable'), note: d.analyticsConnected ? 'From the latest snapshot' : 'No GA4 Reporting API connected yet' },
        { label: 'Clicks', value: String(d.clicks != null ? d.clicks : 'Data unavailable'), note: d.analyticsConnected ? 'From the latest snapshot' : 'No GA4 Reporting API connected yet' },
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
    loadCspReports();
  }

  /* --- CSP violation reports, last 7 days (close-out A4) --- */
  function loadCspReports() {
    var list = el('cspReportList');
    if (!list) return;
    if (typeof fetch !== 'function') { setText('cspReportStatus', 'CSP report counts need a browser fetch — unavailable here.'); return; }
    setText('cspReportStatus', 'Loading CSP violation reports…');
    api('/api/csp-report/stats').then(function (r) {
      if (!r.ok) { setText('cspReportStatus', apiError(r)); return; }
      var d = r.data || {};
      var rows = d.by_directive || [];
      if (!rows.length) {
        list.innerHTML = '<li>No CSP violations reported in the last 7 days.</li>';
      } else {
        list.innerHTML = rows.map(function (row) {
          return '<li><strong>' + esc(row.directive) + '</strong> — ' + esc(String(row.count)) + ' report(s)</li>';
        }).join('');
      }
      setText('cspReportStatus', 'CSP is Report-Only (nothing enforced). ' + (d.total || 0) + ' violation report(s) in the last 7 days. Enforcement rule: docs/CLOSEOUT-A4-CSP-ENFORCEMENT-RULE-2026-11-23.md — Report-Only stays until 14 clean days + owner approval.');
    }).catch(function () {
      setText('cspReportStatus', 'Could not reach the FS AI server.');
    });
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

  /* --- 0. Control Center (System status) — W5 ---
     One live view of the whole system. Every block fetches its own real
     API payload; anything the backend cannot supply renders
     "Data unavailable", never an invented number. All timestamps render
     in Asia/Dhaka. Alerts are collected per source so a new failure
     never silently overwrites an older one. */
  var DHAKA_TZ = 'Asia/Dhaka';
  var ccAlertsMap = {};
  var ccLoadedSources = 0;

  function fmtDhaka(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: DHAKA_TZ, day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      return parts + ' Dhaka';
    } catch (e) { return String(iso); }
  }

  function ccAsOf(iso) {
    return 'As of ' + fmtDhaka(iso || new Date().toISOString()) + '.';
  }

  function ageHours(iso) {
    if (!iso) return null;
    var ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    return Math.round((Date.now() - ms) / 3600000 * 10) / 10;
  }

  function nextUtcMidnight(from) {
    var d = new Date(from.getTime());
    d.setUTCHours(0, 0, 0, 0);
    if (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  function nextSundayUtcMidnight(from) {
    var d = nextUtcMidnight(from);
    var add = (7 - d.getUTCDay()) % 7;
    d.setUTCDate(d.getUTCDate() + add);
    return d;
  }

  function countdownText(targetMs) {
    var diff = targetMs - Date.now();
    if (diff <= 0) return 'due now';
    var mins = Math.floor(diff / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h >= 24) {
      var days = Math.floor(h / 24);
      return 'in ' + days + 'd ' + (h % 24) + 'h ' + m + 'm';
    }
    return 'in ' + h + 'h ' + m + 'm';
  }

  function ccAlert(key, severity, text) {
    ccAlertsMap[key] = { severity: severity, text: text };
    renderCcAlerts();
  }

  function ccClearAlert(key) {
    if (ccAlertsMap[key]) { delete ccAlertsMap[key]; renderCcAlerts(); }
  }

  function renderCcAlerts() {
    var box = el('ccAlerts');
    if (!box) return;
    var keys = Object.keys(ccAlertsMap);
    if (!keys.length) {
      box.innerHTML = ccLoadedSources >= 3
        ? '<li>No action needed — everything this dashboard can check is healthy.</li>'
        : '<li class="muted">Checking…</li>';
      return;
    }
    var order = { action: 0, warning: 1, info: 2 };
    keys.sort(function (a, b) { return order[ccAlertsMap[a].severity] - order[ccAlertsMap[b].severity]; });
    box.innerHTML = keys.map(function (k) {
      var a = ccAlertsMap[k];
      var label = a.severity === 'action' ? 'ACTION NEEDED' : a.severity === 'warning' ? 'WARNING' : 'INFO';
      return '<li><strong>' + esc(label) + ':</strong> ' + esc(a.text) + '</li>';
    }).join('');
  }

  function ccMarkLoaded() {
    ccLoadedSources += 1;
    setText('ccFreshness', 'Last refreshed ' + fmtDhaka(new Date().toISOString()) + ' — each block below shows its own as-of time.');
    renderCcAlerts();
  }

  function ccKpiCards(cards) {
    return cards.map(function (c) {
      return '<div class="card kpi-card"><div class="kpi-value">' + esc(String(c.value)) + '</div><div class="kpi-label">' + esc(c.label) + '</div><p class="muted">' + esc(c.note || '') + '</p></div>';
    }).join('');
  }

  function loadCcAutomation() {
    api('/api/autonomy/status').then(function (r) {
      var grid = el('ccAutomationGrid');
      if (!r.ok) {
        if (grid) grid.innerHTML = ccKpiCards([{ label: 'Automation', value: 'Data unavailable', note: apiError(r) }]);
        setText('ccAutomationStatus', 'Could not load automation status. ' + ccAsOf());
        ccAlert('automation', 'warning', 'Automation status is unavailable — ' + apiError(r));
        ccMarkLoaded();
        return;
      }
      var d = r.data || {};
      var flags = d.autoFlags || {};
      var onOff = function (v) { return v === 'on' ? 'ON' : 'OFF'; };
      var cards = [
        { label: 'Auto-research', value: onOff(flags.auto_research), note: 'Daily feed fetching' },
        { label: 'Auto-generation', value: onOff(flags.auto_generation), note: 'Draft creation from fresh research' },
        { label: 'Auto-fact-check', value: onOff(flags.auto_factcheck), note: 'Claim checking in the daily workflow' },
        { label: 'Auto-correction', value: onOff(flags.auto_correction), note: 'Rewriting failed claims from evidence' },
        { label: 'Auto-publishing', value: onOff(flags.auto_publishing), note: 'Publishing stays approved-only regardless' },
        { label: 'Publishing mode', value: d.publishingMode || 'approved_only', note: 'Nothing publishes without owner approval' },
        { label: 'Emergency Stop', value: d.emergencyStop ? 'ON' : 'OFF', note: d.emergencyStop ? 'Agent runs are blocked (423)' : 'Agent runs allowed' },
        { label: 'Autonomy level', value: String(d.autonomyLevel != null ? d.autonomyLevel : '—'), note: 'Target level ' + String(d.targetLevel != null ? d.targetLevel : '3') },
      ];
      if (grid) grid.innerHTML = ccKpiCards(cards);
      setText('ccAutomationStatus', 'Live from the API. ' + ccAsOf());
      if (d.emergencyStop) ccAlert('estop', 'action', 'Emergency Stop is ON — agent runs are blocked (423). Turn it off in AI Agent Control when ready.');
      else ccClearAlert('estop');
      if (d.publishingMode && d.publishingMode !== 'approved_only') ccAlert('publishing-mode', 'warning', 'Publishing mode is "' + d.publishingMode + '" — expected "approved_only".');
      else ccClearAlert('publishing-mode');
      ccMarkLoaded();
    }).catch(function () {
      setText('ccAutomationStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccAlert('automation', 'warning', 'Automation status is unavailable — could not reach the server.');
      ccMarkLoaded();
    });
  }

  function loadCcPublishing() {
    api('/api/autonomy/analytics').then(function (r) {
      var grid = el('ccPublishingGrid');
      var list = el('ccPublishingList');
      if (!r.ok) {
        if (grid) grid.innerHTML = ccKpiCards([{ label: 'Publishing', value: 'Data unavailable', note: apiError(r) }]);
        setText('ccPublishingStatus', 'Could not load publishing status. ' + ccAsOf());
        ccAlert('publishing', 'warning', 'Publishing status is unavailable — ' + apiError(r));
        ccMarkLoaded();
        return;
      }
      var d = r.data || {};
      var byStatus = d.articlesByStatus || {};
      var cards = [
        { label: 'Articles published', value: String(byStatus.published || 0), note: 'Live on the site' },
        { label: 'Drafts', value: String(byStatus.draft || 0), note: 'Awaiting review' },
        { label: 'Pending approval', value: String(byStatus.pending_approval || 0), note: 'Waiting for owner approval' },
        { label: 'Published today', value: String(d.publishedToday != null ? d.publishedToday : '—'), note: 'UTC day, from D1' },
      ];
      if (grid) grid.innerHTML = ccKpiCards(cards);
      var drafts = d.drafts || [];
      if (list) {
        list.innerHTML = drafts.map(function (a) {
          var gate = a.contentReady ? 'Ready' : 'Blocked';
          var stale = a.factCheckStale ? ' — fact-check is STALE (older than the article’s last edit)' : '';
          return '<li><strong>' + esc(a.title || '') + '</strong> (#' + esc(String(a.id)) + ') — ' + statusPill(a.status) + ' ' + statusPill(gate) +
            (a.blockedBy && a.blockedBy.length ? '<br><span class="muted">Blocked by: ' + esc(a.blockedBy.join('; ')) + '</span>' : '') + (stale ? '<br><span class="muted">' + esc(stale.trim()) + '</span>' : '') + '</li>';
        }).join('') || '<li>No drafts — nothing waiting for review.</li>';
      }
      setText('ccPublishingStatus', drafts.length + ' draft(s) shown with their gate state. ' + ccAsOf());
      var blocked = drafts.filter(function (a) { return !a.contentReady; }).length;
      if (blocked) ccAlert('publishing-blocked', 'info', blocked + ' draft(s) are gate-Blocked — see the fact-check queue in Autonomous Operations.');
      else ccClearAlert('publishing-blocked');
      ccMarkLoaded();
    }).catch(function () {
      setText('ccPublishingStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccAlert('publishing', 'warning', 'Publishing status is unavailable — could not reach the server.');
      ccMarkLoaded();
    });
  }

  /* Fallback social list (W4 /api/social/status not deployed yet):
     every platform is honestly "Not connected". A profile that exists
     is NOT an API connection — YouTube/Pinterest say so explicitly. */
  var CC_SOCIAL_FALLBACK = [
    { platform: 'YouTube', accountName: '@FSAI-e5f', connected: false, note: 'Profile exists — no API connection. Uploads happen in the browser.', action: 'Verify the browser session before each upload — see the YouTube session panel.' },
    { platform: 'Pinterest', accountName: 'watchwithf', connected: false, note: 'Profile exists — no API connection.', action: 'Authorization required — connect via the social integration when it is ready, or post manually.' },
    { platform: 'Facebook', accountName: null, connected: false, note: 'Not created — paused by the owner.', action: 'Authorization required — owner creates the Page on his own phone.' },
    { platform: 'WhatsApp Business', accountName: null, connected: false, note: 'Not created — paused by the owner.', action: 'Authorization required — owner sign-in on his own phone.' },
    { platform: 'Business Email', accountName: null, connected: false, note: 'Not created — paused by the owner.', action: 'Authorization required — owner sign-in / provider choice.' },
  ];

  function renderCcSocial(platforms, sourceNote) {
    var list = el('ccSocialList');
    if (list) {
      list.innerHTML = platforms.map(function (p) {
        var state = p.connected ? 'Connected' : 'Not connected';
        var last = p.lastPostAt ? '<br><span class="muted">Last post: ' + esc(fmtDhaka(p.lastPostAt)) + '</span>' : '';
        var err = p.lastError ? '<br><span class="muted">Last error: ' + esc(String(p.lastError).slice(0, 200)) + '</span>' : '';
        var action = p.connected
          ? ''
          : '<br><span class="muted">Authorization required — ' + esc(p.action || 'owner authorization is needed to connect this platform.') + '</span>';
        return '<li><strong>' + esc(p.platform) + '</strong>' + (p.accountName ? ' — ' + esc(p.accountName) : '') + ' ' + statusPill(state) +
          (p.note ? '<br><span class="muted">' + esc(p.note) + '</span>' : '') + last + err + action + '</li>';
      }).join('');
    }
    var notConnected = platforms.filter(function (p) { return !p.connected; });
    if (notConnected.length) {
      ccAlert('social', 'action', 'Authorization required: ' + notConnected.map(function (p) { return p.platform; }).join(', ') + ' — no API connection. ' + (notConnected[0] && notConnected[0].platform === 'YouTube' ? 'YouTube uploads need a manual browser-session check (see the YouTube session panel).' : 'See each row below for what to do.'));
    } else {
      ccClearAlert('social');
    }
    setText('ccSocialStatus', sourceNote + ' ' + ccAsOf());
    ccMarkLoaded();
  }

  function loadCcSocial() {
    api('/api/social/status').then(function (r) {
      if (!r.ok || !r.data || !Array.isArray(r.data.platforms)) {
        // W4 route absent — every platform is "Not connected".
        renderCcSocial(CC_SOCIAL_FALLBACK, 'Social status endpoint not deployed yet — showing the honest not-connected state for every platform.');
        return;
      }
      var platforms = r.data.platforms.map(function (p) {
        return {
          platform: p.platform, accountName: p.accountName || null,
          connected: !!p.connected, lastPostAt: p.lastPostAt || null,
          lastError: p.lastError || null,
          note: p.connected ? 'Connected via API.' : 'No API connection.',
          action: 'Authorization required — owner authorization is needed to connect this platform.',
        };
      });
      renderCcSocial(platforms, 'Live from GET /api/social/status.');
    }).catch(function () {
      renderCcSocial(CC_SOCIAL_FALLBACK, 'Social status endpoint unreachable — showing the honest not-connected state for every platform.');
    });
  }

  function loadCcSchedule() {
    var now = new Date();
    var nextDaily = nextUtcMidnight(now);
    var nextWeekly = nextSundayUtcMidnight(now);
    var list = el('ccScheduleList');
    if (list) {
      list.innerHTML =
        '<li><strong>Daily workflow</strong> — every day at 00:00 UTC (06:00 Dhaka).<br><span class="muted">Next run: ' + esc(fmtDhaka(nextDaily.toISOString())) + ' (' + esc(countdownText(nextDaily.getTime())) + ')</span></li>' +
        '<li><strong>Weekly workflow</strong> — Sundays at 00:00 UTC (06:00 Dhaka).<br><span class="muted">Next run: ' + esc(fmtDhaka(nextWeekly.toISOString())) + ' (' + esc(countdownText(nextWeekly.getTime())) + ')</span></li>' +
        '<li><strong>Hourly trigger</strong> — the Cloudflare Worker runs every hour; the daily/weekly workflows only fire at 00:00 UTC.<br><span class="muted">The schedule lives in the Cloudflare Worker, not in this dashboard.</span></li>';
    }
    setText('ccScheduleStatus', 'Computed in this browser from the Worker schedule. ' + ccAsOf());
    ccMarkLoaded();
  }

  function renderCcFailedTasks(failedTasks) {
    var body = el('ccFailedTasks');
    if (!body) return;
    body.innerHTML = (failedTasks || []).map(function (t) {
      return '<tr><td>#' + esc(String(t.id)) + '</td><td>' + esc(t.agent || '') + ' (' + esc(t.kind || '') + ')</td>' +
        '<td>' + esc(t.rootCause || '— no reason recorded') + '<br><span class="muted">Updated ' + esc(fmtDhaka(t.updatedAt)) + '</span></td>' +
        '<td>' + esc(String(t.attempts != null ? t.attempts : '—') + ' / ' + String(t.maxAttempts != null ? t.maxAttempts : '—')) + ' attempts' +
        (t.retryHistory && t.retryHistory.runs != null ? '<br><span class="muted">' + esc(String(t.retryHistory.runs)) + ' run(s) recorded</span>' : '') + '</td>' +
        '<td>' + statusPill(t.errorType === 'permanent' ? 'permanent' : 'temporary') + '</td>' +
        '<td>' + (t.ownerAction ? '<strong>Yes — owner decides</strong><br><span class="muted">' + esc(t.ownerActionNote || '') + '</span>' : 'No — retryable from the task queue') + '</td></tr>';
    }).join('') || '<tr><td colspan="6">No failed tasks.</td></tr>';
  }

  function loadCcQueue() {
    api('/api/analytics/detail?section=queue').then(function (r) {
      if (r.ok && r.data && r.data.data) {
        var d = r.data.data;
        var counts = d.counts || {};
        var grid = el('ccQueueGrid');
        if (grid) {
          grid.innerHTML = ccKpiCards([
            { label: 'Tasks queued', value: String(counts.queued != null ? counts.queued : '—'), note: 'Waiting to run' },
            { label: 'Tasks running', value: String(counts.running != null ? counts.running : '—'), note: 'In progress now' },
            { label: 'Tasks done', value: String(counts.done != null ? counts.done : '—'), note: 'Completed' },
            { label: 'Tasks failed', value: String(counts.failed != null ? counts.failed : '—'), note: 'See Failed tasks below' },
            { label: 'Tasks skipped', value: String(counts.skipped != null ? counts.skipped : '—'), note: 'Skipped by the workflow' },
            { label: 'Oldest queued', value: d.oldestQueuedAt ? fmtDhaka(d.oldestQueuedAt) : '—', note: d.oldestQueuedAgeHours != null ? 'Waiting ' + d.oldestQueuedAgeHours + 'h' : 'No queued tasks' },
          ]);
        }
        renderCcFailedTasks(d.failedTasks || []);
        setText('ccQueueStatus', 'Live from the API. ' + ccAsOf(r.data.asOf));
        setText('ccFailedStatus', (d.failedTasks || []).length + ' failed task(s). ' + ccAsOf(r.data.asOf));
        var failed = d.failedTasks || [];
        if (failed.length) {
          var needsOwner = failed.filter(function (t) { return t.ownerAction; });
          ccAlert('failed-tasks', needsOwner.length ? 'action' : 'warning',
            failed.length + ' failed task(s)' + (needsOwner.length ? ' — ' + needsOwner.length + ' need an owner decision (attempts exhausted): task #' + needsOwner.map(function (t) { return t.id; }).join(', #') + '.' : ' — all still retryable from the task queue.') +
            (failed[0].rootCause ? ' Latest root cause: ' + failed[0].rootCause : ''));
        } else ccClearAlert('failed-tasks');
        ccMarkLoaded();
        return;
      }
      // Fallback: the detail endpoint is not wired yet — counts and
      // failed tasks from the autonomy endpoints (oldest-queued age
      // is honestly unavailable until the detail route lands).
      return api('/api/autonomy/analytics').then(function (r2) {
        return api('/api/autonomy/status').then(function (r3) {
          var grid = el('ccQueueGrid');
          var tasks = (r3.ok && r3.data && r3.data.tasks) || {};
          var failed = (r2.ok && r2.data && r2.data.failedTasks) || [];
          if (grid) {
            grid.innerHTML = ccKpiCards([
              { label: 'Tasks queued', value: String(tasks.queued != null ? tasks.queued : '—'), note: 'Waiting to run' },
              { label: 'Tasks running', value: String(tasks.running != null ? tasks.running : '—'), note: 'In progress now' },
              { label: 'Tasks done', value: String(tasks.done != null ? tasks.done : '—'), note: 'Completed' },
              { label: 'Tasks failed', value: String(tasks.failed != null ? tasks.failed : failed.length), note: 'See Failed tasks below' },
              { label: 'Tasks skipped', value: String(tasks.skipped != null ? tasks.skipped : '—'), note: 'Skipped by the workflow' },
              { label: 'Oldest queued', value: 'Data unavailable', note: 'Needs GET /api/analytics/detail?section=queue' },
            ]);
          }
          renderCcFailedTasks(failed.map(function (t) {
            return { id: t.id, agent: t.agent, kind: t.kind, attempts: t.attempts, maxAttempts: t.maxAttempts, updatedAt: t.updatedAt, rootCause: null, errorType: 'temporary', ownerAction: false, retryHistory: null };
          }));
          setText('ccQueueStatus', 'Queue counts from the autonomy endpoints; oldest-queued age is Data unavailable until the analytics detail route is wired. ' + ccAsOf());
          setText('ccFailedStatus', failed.length + ' failed task(s) (root causes need the detail route). ' + ccAsOf());
          if (failed.length) ccAlert('failed-tasks', 'warning', failed.length + ' failed task(s) — retry them from the task queue.');
          else ccClearAlert('failed-tasks');
          ccMarkLoaded();
        });
      });
    }).catch(function () {
      setText('ccQueueStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccAlert('queue', 'warning', 'Queue health is unavailable — could not reach the server.');
      ccMarkLoaded();
    });
  }

  function loadCcAiUsage() {
    api('/api/analytics/detail?section=ai-usage').then(function (r) {
      var grid = el('ccAiUsageGrid');
      var bar = el('ccAiUsageBar');
      var render = function (today, last7d, cap, sourceNote, asOf) {
        var pct = cap ? Math.min(100, Math.round((today.neurons / cap) * 1000) / 10) : 0;
        if (grid) {
          grid.innerHTML = ccKpiCards([
            { label: 'LLM calls today', value: String(today.calls != null ? today.calls : '—'), note: 'Calls that reached a provider' },
            { label: 'Neurons today', value: String(today.neurons != null ? today.neurons : '—'), note: 'Of ' + cap + ' free Neurons/day' + (today.neuronsEstimated != null ? ' (' + today.neuronsEstimated + ' estimated)' : '') },
            { label: 'Neurons (7 days)', value: String(last7d.neurons != null ? last7d.neurons : '—'), note: (last7d.calls != null ? last7d.calls : '—') + ' calls in 7 days' },
            { label: 'Free-tier used today', value: pct + '%', note: Math.max(0, cap - (today.neurons || 0)) + ' Neurons remaining today' },
          ]);
        }
        if (bar) bar.style.width = pct + '%';
        setText('ccAiUsageStatus', sourceNote + ' ' + ccAsOf(asOf));
        if (pct >= 90) ccAlert('ai-cap', 'warning', 'Free-tier Neurons are ' + pct + '% used today (' + today.neurons + ' of ' + cap + '). Generation pauses automatically at the cap.');
        else ccClearAlert('ai-cap');
        ccMarkLoaded();
      };
      if (r.ok && r.data && r.data.data) {
        var d = r.data.data;
        render(d.today || {}, d.last7d || {}, d.capNeurons || 9000, 'Live from the API (Workers AI only).', r.data.asOf);
        return;
      }
      // Fallback: autonomy analytics payload (same counting rule).
      api('/api/autonomy/analytics').then(function (r2) {
        if (!r2.ok) {
          if (grid) grid.innerHTML = ccKpiCards([{ label: 'AI usage', value: 'Data unavailable', note: apiError(r2) }]);
          setText('ccAiUsageStatus', 'Could not load AI usage. ' + ccAsOf());
          ccAlert('ai-usage', 'warning', 'AI usage is unavailable — ' + apiError(r2));
          ccMarkLoaded();
          return;
        }
        var d2 = r2.data || {};
        render(d2.llmToday || {}, d2.llm7d || {}, 9000, 'From the autonomy analytics endpoint (Workers AI only).', null);
      }).catch(function () {
        setText('ccAiUsageStatus', 'Could not reach the FS AI server. ' + ccAsOf());
        ccAlert('ai-usage', 'warning', 'AI usage is unavailable — could not reach the server.');
        ccMarkLoaded();
      });
    }).catch(function () {
      setText('ccAiUsageStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccAlert('ai-usage', 'warning', 'AI usage is unavailable — could not reach the server.');
      ccMarkLoaded();
    });
  }

  function loadCcHealth() {
    api('/api/health/latest').then(function (r) {
      var list = el('ccHealthList');
      if (!r.ok || !r.data) {
        // Route not wired yet (coordinator registers it) — unknown,
        // never a fabricated healthy state.
        if (list) list.innerHTML = '<li>Health checks: <strong>unknown</strong> <span class="muted">— health service not yet deployed.</span></li>';
        setText('ccHealthStatus', 'GET /api/health/latest is not wired yet — the health endpoint answers unknown until the coordinator registers the route. ' + ccAsOf());
        ccAlert('health', 'info', 'System health checks are not deployed yet — the dashboard cannot verify component health. (W1 health service pending.)');
        ccMarkLoaded();
        return;
      }
      var d = r.data;
      var checks = d.checks || [];
      if (list) {
        list.innerHTML = (checks.length ? checks.map(function (c) {
          return '<li><strong>' + esc(c.component) + '</strong> ' + statusPill(c.status) +
            ' <span class="muted">checked ' + esc(fmtDhaka(c.checkedAt)) + (c.stale ? ' — STALE (older than 25 hours)' : '') + '</span>' +
            (c.detail ? '<br><span class="muted">' + esc(typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)).slice(0, 200) + '</span>' : '') + '</li>';
        }).join('') : '<li>Health checks: <strong>unknown</strong> <span class="muted">— no health checks recorded yet.</span></li>');
      }
      setText('ccHealthStatus', 'Overall: ' + (d.overall || 'unknown') + '. ' + (d.note || '') + ' ' + ccAsOf(d.asOf));
      if (d.overall === 'failing') ccAlert('health', 'action', 'System health is FAILING — see the failing component(s) above.');
      else if (d.overall === 'degraded') ccAlert('health', 'warning', 'System health is degraded — see the warning component(s) above.');
      else if (d.overall === 'unknown') ccAlert('health', 'info', 'System health is unknown — ' + (d.note || 'no health checks recorded yet.'));
      else ccClearAlert('health');
      if (checks.some(function (c) { return c.stale; })) ccAlert('health-stale', 'warning', 'One or more health checks are older than 25 hours — labelled stale above.');
      else ccClearAlert('health-stale');
      ccMarkLoaded();
    }).catch(function () {
      var list = el('ccHealthList');
      if (list) list.innerHTML = '<li>Health checks: <strong>unknown</strong> <span class="muted">— could not reach the server.</span></li>';
      setText('ccHealthStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccAlert('health', 'warning', 'System health is unavailable — could not reach the server.');
      ccMarkLoaded();
    });
  }

  function loadCcReports() {
    api('/api/analytics/detail?section=reports').then(function (r) {
      var list = el('ccReportsList');
      var render = function (daily, weekly, sourceNote, asOf) {
        if (list) {
          var row = function (label, rep) {
            if (!rep) return '<li><strong>' + esc(label) + ':</strong> Data unavailable — no report recorded yet.</li>';
            var summary = '';
            if (rep.summary) {
              var s = rep.summary;
              summary = ' — ' + (typeof s === 'string' ? s : (s.summary || Object.keys(s).slice(0, 4).map(function (k) { return k + ': ' + (typeof s[k] === 'object' ? JSON.stringify(s[k]).slice(0, 60) : String(s[k])); }).join(', ')));
            }
            return '<li><strong>' + esc(label) + ' — ' + esc(fmtDhaka(rep.date || rep.created_at)) + '</strong><span class="muted">' + esc(summary).slice(0, 200) + '</span></li>';
          };
          list.innerHTML = row('Latest daily report', daily) + row('Latest weekly report', weekly);
        }
        setText('ccReportsStatus', sourceNote + ' ' + ccAsOf(asOf));
        ccMarkLoaded();
      };
      if (r.ok && r.data && r.data.data) {
        var d = r.data.data;
        render(d.latestDaily || null, d.latestWeekly || null, 'Live from the API.', r.data.asOf);
        return;
      }
      api('/api/autonomy/reports?kind=daily&limit=1').then(function (r2) {
        var daily = (r2.ok && r2.data && r2.data.reports && r2.data.reports[0]) || null;
        api('/api/autonomy/reports?kind=weekly&limit=1').then(function (r3) {
          var weekly = (r3.ok && r3.data && r3.data.reports && r3.data.reports[0]) || null;
          render(daily, weekly, 'From the autonomy reports endpoint (detail route not wired yet).', null);
        }).catch(function () { render(daily, null, 'From the autonomy reports endpoint (detail route not wired yet).', null); });
      }).catch(function () {
        setText('ccReportsStatus', 'Could not reach the FS AI server. ' + ccAsOf());
        ccAlert('reports', 'warning', 'Daily/weekly reports are unavailable — could not reach the server.');
        ccMarkLoaded();
      });
    }).catch(function () {
      setText('ccReportsStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccAlert('reports', 'warning', 'Daily/weekly reports are unavailable — could not reach the server.');
      ccMarkLoaded();
    });
  }

  /* Daily Autonomy Health Report (close-out A5): one line per check
     from the latest daily report's summary.healthReport, plus the
     overall. The report is produced by the daily run at 00:00 UTC and
     is read-only — this block never publishes, edits or fixes
     anything. A missing report or a missing healthReport is an honest
     empty state, never an invented status. */
  var HEALTH_REPORT_LABELS = {
    workerHealth: 'Worker health',
    pages: 'Pages (home)',
    sitemap: 'Sitemap',
    recentArticles: 'Recent articles (last 24 h)',
    queue: 'Queue',
    lastRuns: 'Last daily / weekly runs',
    sitemapRefresh: 'Sitemap-refresh workflow',
    protectedDrafts: 'Protected drafts',
    settings: 'Settings',
    shortsCron: 'Daily Shorts cron',
    lastVideo: 'Last video',
    cspViolations: 'CSP violations (last 7 days)',
    autoPublishProof: 'Auto-publish proof',
  };

  function healthReportLine(key, check) {
    var d = (check && check.detail) || {};
    var reason = d.reason || d.error || '';
    var arr = function (v) { return Array.isArray(v) ? v : []; };
    switch (key) {
      case 'workerHealth':
        if (d.overall) {
          var c = d.counts || {};
          return 'overall ' + d.overall + ' — ' + (c.healthy || 0) + ' healthy, ' + (c.degraded || 0) + ' degraded, ' + (c.blocked || 0) + ' blocked';
        }
        return reason || 'no health-check result';
      case 'pages':
        return d.status ? 'home returned HTTP ' + d.status : (reason || 'home fetch failed');
      case 'sitemap':
        if (typeof d.urlCount === 'number') {
          return d.urlCount + ' URLs, ' + d.publishedCount + ' published, ' + arr(d.missingIds).length + ' missing, ' + arr(d.extraIds).length + ' extra';
        }
        return reason || 'sitemap fetch failed';
      case 'recentArticles':
        if (Array.isArray(d.published)) {
          return d.published.length + ' published in the last 24 h, ' + arr(d.reachable).length + ' reachable'
            + (arr(d.unreachable).length ? ', unreachable: ' + arr(d.unreachable).join(', ') : '');
        }
        return reason || 'could not read recent articles';
      case 'queue':
        if (typeof d.queued === 'number') {
          return d.queued + ' queued, ' + d.running + ' running, ' + d.stale + ' stale' + (d.reason ? ' — ' + d.reason : '');
        }
        return reason || 'no queue check result';
      case 'lastRuns': {
        var dl = d.daily ? ('daily ' + d.daily.date + (typeof d.daily.ageHours === 'number' ? ' (' + d.daily.ageHours + ' h ago)' : '')) : 'daily: none yet';
        var wl = d.weekly ? ('weekly ' + d.weekly.date + (typeof d.weekly.ageHours === 'number' ? ' (' + d.weekly.ageHours + ' h ago)' : '')) : 'weekly: none yet';
        return dl + '; ' + wl + (reason ? ' — ' + reason : '');
      }
      case 'sitemapRefresh':
        if (d.conclusion) {
          return d.conclusion + (d.createdAt ? ', ' + fmtDhaka(d.createdAt) : '')
            + (typeof d.ageHours === 'number' ? ' (' + d.ageHours + ' h ago)' : '');
        }
        return reason || 'GitHub API unavailable';
      case 'protectedDrafts':
        if (Array.isArray(d.drafts)) {
          if (arr(d.missing).length) return 'missing from D1: ' + arr(d.missing).join(', ');
          if (arr(d.changed).length) return 'changed: ' + arr(d.changed).map(function (c) { return '#' + c.id; }).join(', ');
          return d.drafts.length + ' drafts unchanged';
        }
        return reason || 'no baseline yet';
      case 'settings':
        if (Array.isArray(d.changed)) {
          return d.changed.length
            ? 'changed: ' + d.changed.map(function (c) { return c.key; }).join(', ')
            : 'unchanged (' + d.autonomyKeys + ' autonomy + ' + d.websiteKeys + ' website keys)';
        }
        return reason || 'no baseline yet';
      case 'shortsCron':
        return reason || 'state lives outside the Worker';
      case 'lastVideo':
        if (d.video) {
          return d.video.title + ' (' + d.video.kind + ')'
            + ((d.latestPerformance && d.latestPerformance.views != null) ? ' — ' + d.latestPerformance.views + ' views' : '');
        }
        return reason || 'no video row in D1';
      case 'cspViolations':
        if (typeof d.total === 'number') {
          return d.total === 0 ? '0 reports in the last 7 days'
            : d.total + ' report(s): ' + arr(d.byDirective).map(function (x) { return x.directive + ' ×' + x.count; }).join(', ');
        }
        return reason || 'could not read CSP reports';
      case 'autoPublishProof':
        if (d.articleId != null) {
          return 'article #' + d.articleId + ' verified' + (d.verifiedAt ? ' ' + fmtDhaka(d.verifiedAt) : '') + ' — verdict ' + d.verdict;
        }
        return reason || 'no auto-published article verified yet';
      default:
        return reason;
    }
  }

  function loadCcHealthReport() {
    api('/api/autonomy/reports?kind=daily&limit=1').then(function (r) {
      var list = el('ccHealthReportList');
      var report = (r.ok && r.data && r.data.reports && r.data.reports[0] && r.data.reports[0].summary && r.data.reports[0].summary.healthReport) || null;
      if (!report || !report.checks) {
        if (list) list.innerHTML = '<li class="muted">No health report recorded yet — the next daily run produces one.</li>';
        setText('ccHealthReportStatus', 'No health report recorded yet — the next daily run produces one. ' + ccAsOf());
        ccMarkLoaded();
        return;
      }
      if (list) {
        list.innerHTML = Object.keys(HEALTH_REPORT_LABELS).map(function (key) {
          var check = report.checks[key];
          if (!check) return '';
          return '<li><strong>' + esc(HEALTH_REPORT_LABELS[key]) + ':</strong> ' + esc(check.status) + ' <span class="muted">— ' + esc(healthReportLine(key, check)) + '</span></li>';
        }).join('');
      }
      setText('ccHealthReportStatus', 'Overall: ' + (report.overall || 'unknown') + ' — daily report for ' + (report.date || 'unknown date') + '. ' + ccAsOf(report.generatedAt));
      ccMarkLoaded();
    }).catch(function () {
      setText('ccHealthReportStatus', 'Could not reach the FS AI server. ' + ccAsOf());
      ccMarkLoaded();
    });
  }

  /* YouTube session panel: a stored note, not a live check. The button
     only reveals the manual steps — it never asks for, sends, or stores
     a password, and there is no password field anywhere in this panel. */
  function bindControlCenter() {
    var btn = el('ccYoutubeCheckBtn');
    var steps = el('ccYoutubeSteps');
    if (btn && steps) {
      btn.addEventListener('click', function () {
        var show = steps.hidden;
        steps.hidden = !show;
        btn.textContent = show ? 'Hide the session steps' : 'Check session — show the steps';
        setText('ccYoutubeStatus', show
          ? 'Follow the steps, then tell the assistant “YouTube session verified”. Never type a password into this dashboard.'
          : '');
      });
    }
    window.addEventListener('fsai:autonomy-refreshed', function () { loadControlCenter(); });
  }

  function loadControlCenter() {
    setText('ccStatus', 'Loading system status from the live API…');
    loadCcAutomation();
    loadCcPublishing();
    loadCcSocial();
    loadCcSchedule();
    loadCcQueue();
    loadCcAiUsage();
    loadCcHealth();
    loadCcReports();
    loadCcHealthReport();
    // Recent activity is rendered by autonomy.js (loadControlCenterActivity)
    // from the same detail endpoint — it shares this section's list.
    setText('ccStatus', 'System status loaded. Any block the API could not supply says “Data unavailable” instead of showing an invented number.');
  }

  function loadAll() {
    setText('dashboardApiStatus', 'Session verified — loading live data from the Worker API…');
    loadControlCenter();
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
    bindControlCenter();
    bindContent();
    bindDivisions();
    bindAgents();
    bindSubscribers();
    bindBackup();
    startIfVerified();
    window.addEventListener('fsai:session-verified', startIfVerified);
    // The Autonomous Operations section (autonomy.js) toggles the same
    // E-Stop: re-fetch our display when it changes, instead of showing
    // a stale ON/OFF until a reload (live 2026-11-19). The message line
    // syncs too (loadEmergencyStop(true)) — the state line alone left
    // the old "Emergency Stop is now ON." message standing.
    window.addEventListener('fsai:emergency-stop-changed', function () { loadEmergencyStop(true); });
  });
})();
