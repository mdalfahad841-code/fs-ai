/* FS AI — scroll-reveal animations.
   Unslop run 2026-11-20: the hero particle canvas is gone (decorative
   motion with no purpose). Only the reveal remains: one short fade and
   rise. Respects prefers-reduced-motion: no animation at all when the
   user asks for it. */
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function () {
    /* Reveal on scroll. */
    var revealEls = document.querySelectorAll('.reveal');
    if (reduced || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('visible'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('visible'); io.unobserve(entry.target); }
        });
      }, { threshold: 0.12 });
      revealEls.forEach(function (el) { io.observe(el); });
    }
  });
})();
