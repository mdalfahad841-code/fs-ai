/* FS AI — scroll-reveal animations + cinematic hero particles.
   Respects prefers-reduced-motion: no animation at all when the user asks for it. */
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
    /* Hero particle canvas (lightweight 2D canvas, no 3D dependency). */
    var canvas = document.getElementById('heroParticles');
    if (!canvas) return;
    if (reduced) { canvas.style.display = 'none'; return; }
    var ctx = canvas.getContext('2d');
    var particles = [];
    var W = 0, H = 0;
    function resize() {
      var r = canvas.parentElement.getBoundingClientRect();
      W = canvas.width = Math.floor(r.width);
      H = canvas.height = Math.floor(r.height);
    }
    function make() {
      particles = [];
      var n = Math.min(90, Math.floor(W / 12));
      for (var i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * W, y: Math.random() * H,
          r: 0.8 + Math.random() * 2.2,
          vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
          a: 0.25 + Math.random() * 0.55
        });
      }
    }
    function tick() {
      ctx.clearRect(0, 0, W, H);
      particles.forEach(function (p) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(40, 120, 255, ' + p.a + ')';
        ctx.fill();
      });
      requestAnimationFrame(tick);
    }
    resize(); make(); tick();
    window.addEventListener('resize', function () { resize(); make(); });
  });
})();
