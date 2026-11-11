/* FS AI — Command Center dashboard. KPIs come ONLY from the real shared data.
   Revenue is honestly $0.00 and traffic is honestly "Data unavailable" — never invented. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('dashboard');
    if (!root) return;
    var F = window.FSAI;
    var counts = F.countsByDivision();
    var total = F.ARTICLES.length;
    var kpi = document.getElementById('kpiGrid');
    if (kpi) {
      var cards = [
        { label: 'Articles published', value: String(total), note: 'Across ' + F.DIVISIONS.length + ' divisions' },
        { label: 'Divisions', value: String(F.DIVISIONS.length), note: 'One platform, multiple possibilities' },
        { label: 'Free tools', value: String(F.TOOLS.length), note: 'Converters and calculators' },
        { label: 'AI agents', value: String(F.AGENTS.length), note: '14-agent system + Business Manager + Security' },
        { label: 'Revenue', value: F.SITE.revenue, note: 'Zero-cost platform — no paid services, no sales yet' },
        { label: 'Traffic', value: F.SITE.traffic, note: 'Analytics is pending — no traffic numbers are claimed' }
      ];
      kpi.innerHTML = cards.map(function (c) {
        return '<div class="card kpi-card"><div class="kpi-value">' + F.esc(c.value) + '</div><div class="kpi-label">' + F.esc(c.label) + '</div><p class="muted">' + F.esc(c.note) + '</p></div>';
      }).join('');
    }
    var divTable = document.getElementById('divisionCounts');
    if (divTable) {
      divTable.innerHTML = counts.map(function (c) {
        var pct = total ? Math.round((c.count / total) * 100) : 0;
        return '<tr><td>' + F.esc(c.division) + '</td><td>' + c.count + '</td><td>' + pct + '%</td></tr>';
      }).join('');
    }
    var agentList = document.getElementById('agentList');
    if (agentList) {
      agentList.innerHTML = F.AGENTS.map(function (a) {
        return '<li><strong>' + F.esc(a.name) + '</strong> — ' + F.esc(a.role) + ' <span class="status-pill">' + F.esc(a.status) + '</span></li>';
      }).join('');
    }
    var accountList = document.getElementById('accountList');
    if (accountList) {
      accountList.innerHTML = F.ACCOUNTS.map(function (a) {
        var link = a.url ? '<a href="' + a.url + '" target="_blank" rel="noopener">' + F.esc(a.handle || a.name) + '</a>' : '<span class="muted">Not yet created or connected</span>';
        var badge = a.status === 'Exists'
          ? '<span class="status-pill ok">Account exists — API not connected</span>'
          : '<span class="status-pill pending">Pending</span>';
        return '<li><strong>' + F.esc(a.name) + '</strong> — ' + link + ' ' + badge + '</li>';
      }).join('');
    }
    var latest = document.getElementById('latestArticles');
    if (latest) {
      var sorted = F.ARTICLES.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
      latest.innerHTML = sorted.map(function (a) {
        return '<li><a href="article.html?id=' + a.id + '">' + F.esc(a.title) + '</a> <span class="muted">— ' + F.esc(a.division) + ', ' + F.formatDate(a.date) + '</span></li>';
      }).join('');
    }
    var note = document.getElementById('dashboardNote');
    if (note) note.textContent = 'All numbers on this page come from the real content on this site. Revenue is $0.00 and traffic is "Data unavailable" because no analytics account is connected yet.';
  });
})();
