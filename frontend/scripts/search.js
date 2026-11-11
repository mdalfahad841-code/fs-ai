/* FS AI — full-text search over article titles, excerpts, divisions and categories. */
(function () {
  'use strict';
  function searchArticles(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return window.FSAI.ARTICLES.slice();
    var words = q.split(/\s+/);
    return window.FSAI.ARTICLES.filter(function (a) {
      var hay = (a.title + ' ' + a.excerpt + ' ' + a.division + ' ' + a.category).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }
  function searchDivisions(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return window.FSAI.DIVISIONS.slice();
    return window.FSAI.DIVISIONS.filter(function (d) {
      return (d.name + ' ' + d.tagline + ' ' + d.description).toLowerCase().indexOf(q) !== -1;
    });
  }
  function searchTools(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return window.FSAI.TOOLS.slice();
    return window.FSAI.TOOLS.filter(function (t) {
      return (t.name + ' ' + t.description + ' ' + t.category).toLowerCase().indexOf(q) !== -1;
    });
  }
  window.FSAI.searchArticles = searchArticles;
  window.FSAI.searchDivisions = searchDivisions;
  window.FSAI.searchTools = searchTools;

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('siteSearch');
    var results = document.getElementById('searchResults');
    var count = document.getElementById('searchCount');
    if (!input || !results) return;
    function run() {
      var q = input.value;
      var hits = searchArticles(q);
      if (!q.trim()) {
        results.innerHTML = '<p class="muted">Type to search all ' + window.FSAI.ARTICLES.length + ' articles.</p>';
        if (count) count.textContent = '';
        return;
      }
      if (count) count.textContent = hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for "' + q.trim() + '"';
      if (!hits.length) {
        results.innerHTML = '<p>No articles match "' + window.FSAI.esc(q.trim()) + '". Try a division name such as Automotive, or a word like budget, EV or workout.</p>';
        return;
      }
      results.innerHTML = hits.map(function (a) {
        return '<article class="card article-card"><div class="card-tag">' + window.FSAI.esc(a.division) + ' · ' + window.FSAI.esc(a.category) + '</div>' +
          '<h3><a href="pages/article.html?id=' + a.id + '">' + window.FSAI.esc(a.title) + '</a></h3>' +
          '<p>' + window.FSAI.esc(a.excerpt) + '</p><time datetime="' + a.date + '">' + window.FSAI.formatDate(a.date) + '</time></article>';
      }).join('');
      if (window.location.pathname.indexOf('/pages/') !== -1) {
        results.querySelectorAll('a[href^="pages/"]').forEach(function (a) {
          a.setAttribute('href', a.getAttribute('href').replace(/^pages\//, ''));
        });
      }
    }
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); run(); results.scrollIntoView({ behavior: 'smooth' }); }
    });
    /* Pre-fill from ?q= when arriving from another page's search box. */
    var params = new URLSearchParams(window.location.search);
    var preset = params.get('q');
    if (preset) { input.value = preset; run(); }
  });
})();
