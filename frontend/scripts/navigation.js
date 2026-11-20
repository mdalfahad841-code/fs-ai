/* FS AI — navigation: mobile menu, theme toggle, active section, smooth scroll. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('navToggle');
    var nav = document.querySelector('.main-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      });
      nav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { nav.classList.remove('open'); });
      });
    }
    /* Theme: dark is the default; light is stored per browser only. */
    var saved = null;
    try { saved = localStorage.getItem('fsai-theme'); } catch (e) { saved = null; }
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var light = document.documentElement.getAttribute('data-theme') === 'light';
        if (light) {
          document.documentElement.removeAttribute('data-theme');
          try { localStorage.setItem('fsai-theme', 'dark'); } catch (e) {}
        } else {
          document.documentElement.setAttribute('data-theme', 'light');
          try { localStorage.setItem('fsai-theme', 'light'); } catch (e) {}
        }
        try { window.dispatchEvent(new CustomEvent('fsai:theme-change')); } catch (e) {}
      });
    }
    /* Highlight the nav link for the current page (in case markup was static).
       Phase 3, Priority 8: nav hrefs are the clean route form (no
       ".html"), so matching strips a trailing ".html" from both sides
       — a visitor who lands on the .html URL directly still gets the
       active state. */
    var path = window.location.pathname;
    var stripHtml = function (s) { return String(s || '').replace(/\.html$/, ''); };
    document.querySelectorAll('.main-nav a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var p = stripHtml(path);
      var h = stripHtml(href);
      if ((p === '/' || p.endsWith('/index')) && (h === '/' || h === '../' || h === 'index' || h.endsWith('/index'))) a.classList.add('active');
      if (p.indexOf('/division') !== -1 && h.indexOf('division') !== -1) a.classList.add('active');
      if (p.indexOf('/tools') !== -1 && h.indexOf('tools') !== -1) a.classList.add('active');
      if (p.indexOf('/dashboard') !== -1 && h.indexOf('dashboard') !== -1) a.classList.add('active');
    });
  });

  /* Section routing helper used by in-page links: scroll to a section id. */
  window.FSAI = window.FSAI || {};
  window.FSAI.goToSection = function (id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return !!el;
  };
})();
