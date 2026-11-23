/* FS AI — navigation: mobile menu, theme toggle, active section, smooth scroll. */
(function () {
  'use strict';

  /* Theme resolution: the saved choice wins; with no saved choice the
     OS preference decides; otherwise dark (the default). The pre-paint
     snippet in <head> (index.html, pages/*.html) implements the same
     resolution — keep the two in sync. */
  function resolveTheme(saved, prefersLight) {
    if (saved === 'light') return 'light';
    if (saved === 'dark') return 'dark';
    return prefersLight ? 'light' : 'dark';
  }
  function systemPrefersLight() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    } catch (e) { return false; }
  }
  function readSaved() {
    try { return localStorage.getItem('fsai-theme'); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }
  function toggleTheme() {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    applyTheme(light ? 'dark' : 'light');
    try { localStorage.setItem('fsai-theme', light ? 'dark' : 'light'); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('fsai:theme-change')); } catch (e) {}
  }

  /* FIX (Fix Pass 2, item 3): the header — and with it #themeToggle,
     #navToggle and .main-nav — is rendered by app.js renderShared(),
     which runs only after the live-articles fetch resolves (up to the
     5 s timeout), i.e. ALWAYS after this script's DOMContentLoaded
     handler (same dispatch, earlier handler; even a pre-resolved
     liveReady schedules renderShared as a microtask that runs after
     the dispatch). Binding by id at DOMContentLoaded therefore found
     nothing (null) and the toggle never got a handler: clicks did
     nothing, on every page. Delegate clicks on document instead, so
     the buttons work whenever the header appears and survive any
     later re-render. Registered at parse time, not on DOMContentLoaded. */
  document.addEventListener('click', function (e) {
    var target = (e && e.target) || null;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('#themeToggle')) { toggleTheme(); return; }
    var nav = document.querySelector('.main-nav');
    var navToggle = target.closest('#navToggle');
    if (navToggle && nav) {
      var open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      return;
    }
    if (nav && target.closest('.main-nav a')) nav.classList.remove('open');
  });

  /* Highlight the nav link for the current page (in case markup was static).
     Phase 3, Priority 8: nav hrefs are the clean route form (no
     ".html"), so matching strips a trailing ".html" from both sides
     — a visitor who lands on the .html URL directly still gets the
     active state. */
  function highlightActiveNav() {
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
  }

  /* Same race as the toggles: the nav links do not exist until app.js
     renders the header. Re-run the highlight once the header appears
     (one-shot observer; if the nav is already there, run at once). */
  function observeHeaderForNav() {
    var header = document.getElementById('siteHeader');
    if (!header) return;
    if (header.querySelector && header.querySelector('.main-nav')) { highlightActiveNav(); return; }
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(function () {
      if (header.querySelector && header.querySelector('.main-nav')) {
        highlightActiveNav();
        mo.disconnect();
      }
    });
    mo.observe(header, { childList: true, subtree: false });
  }

  document.addEventListener('DOMContentLoaded', function () {
    /* Apply the saved/system theme (the <head> snippet already did
       this before first paint; re-applying is idempotent). */
    applyTheme(resolveTheme(readSaved(), systemPrefersLight()));
    highlightActiveNav();
    observeHeaderForNav();
  });

  /* Section routing helper used by in-page links: scroll to a section id. */
  window.FSAI = window.FSAI || {};
  window.FSAI.goToSection = function (id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return !!el;
  };
})();
