/* FS AI — scroll-reveal animations.
   Unslop run 2026-11-20: the hero particle canvas is gone (decorative
   motion with no purpose). Only the reveal remains: one short fade and
   rise. Respects prefers-reduced-motion: no animation at all when the
   user asks for it.
   Close-out A1.1 (2026-11-23): the old version snapshotted .reveal
   elements ONCE on DOMContentLoaded — but the division/article/tool
   cards are rendered by renderShared() only after the live-articles
   fetch resolves (up to 5 s), so late cards were never observed and
   stayed opacity:0 forever. This version re-observes after every
   render: window.FSAI.refreshReveal() observes any .reveal element
   not seen yet (called from app.js after each render), and a
   MutationObserver on the body catches any other late insertion.
   Elements already observed are never observed twice. */
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var io = null;
  var seen = [];

  function alreadySeen(el) {
    for (var i = 0; i < seen.length; i += 1) if (seen[i] === el) return true;
    return false;
  }

  function revealNow(el) {
    if (el && el.classList && el.classList.add) el.classList.add('visible');
  }

  function observeOne(el) {
    if (!el || alreadySeen(el)) return;
    seen.push(el);
    if (reduced || !('IntersectionObserver' in window)) {
      revealNow(el);
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('visible'); io.unobserve(entry.target); }
        });
      }, { threshold: 0.12 });
    }
    io.observe(el);
  }

  /* Observe every .reveal element under root (default: the whole
     document) that has not been observed yet. Safe to call after
     every render — already-seen elements are skipped. */
  function refreshReveal(root) {
    var scope = root || document;
    var els = (scope.querySelectorAll) ? scope.querySelectorAll('.reveal') : [];
    for (var i = 0; i < els.length; i += 1) observeOne(els[i]);
    if (scope !== document && scope.classList && scope.classList.contains && scope.classList.contains('reveal')) observeOne(scope);
  }

  window.FSAI = window.FSAI || {};
  window.FSAI.refreshReveal = refreshReveal;

  document.addEventListener('DOMContentLoaded', function () {
    refreshReveal();
    /* Catch late-inserted .reveal nodes (renderShared and friends)
       even if nobody calls refreshReveal after them. */
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var mo = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          var added = m.addedNodes || [];
          for (var i = 0; i < added.length; i += 1) {
            var n = added[i];
            if (!n || n.nodeType !== 1) continue;
            refreshReveal(n);
          }
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  });
})();
