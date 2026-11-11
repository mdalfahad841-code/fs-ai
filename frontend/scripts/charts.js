/* FS AI — charts drawn from REAL article counts by division (canvas, no libraries).
   No invented data: every bar is a count of the actual articles on this site. */
(function () {
  'use strict';
  function drawDivisionChart(canvas) {
    if (!canvas || !canvas.getContext) return false;
    var F = window.FSAI;
    var data = F.countsByDivision();
    var max = Math.max.apply(null, data.map(function (d) { return d.count; })) || 1;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 640;
    var cssH = 320;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    var padL = 150, padB = 28, padT = 12;
    var barH = (cssH - padT - padB) / data.length - 10;
    var barW = cssW - padL - 24;
    ctx.font = '13px Arial, sans-serif';
    data.forEach(function (d, i) {
      var y = padT + i * (barH + 10);
      var w = Math.max(4, (d.count / max) * barW);
      ctx.fillStyle = '#E9EFF7';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(d.division, padL - 10, y + barH / 2);
      ctx.fillStyle = '#2878FF';
      ctx.fillRect(padL, y, w, barH);
      ctx.fillStyle = '#E9EFF7';
      ctx.textAlign = 'left';
      ctx.fillText(String(d.count), padL + w + 8, y + barH / 2);
    });
    ctx.fillStyle = '#8995A7';
    ctx.textAlign = 'left';
    ctx.fillText('Articles per division — ' + F.ARTICLES.length + ' articles total', padL, cssH - 8);
    return true;
  }
  window.FSAI = window.FSAI || {};
  window.FSAI.drawDivisionChart = drawDivisionChart;

  document.addEventListener('DOMContentLoaded', function () {
    var canvas = document.getElementById('divisionChart');
    if (canvas) {
      /* Canvas needs layout first; draw after a tick so clientWidth is real. */
      setTimeout(function () { drawDivisionChart(canvas); }, 50);
      window.addEventListener('resize', function () { drawDivisionChart(canvas); });
    }
    var fallback = document.getElementById('divisionChartFallback');
    if (fallback && window.FSAI) {
      fallback.innerHTML = window.FSAI.countsByDivision().map(function (d) {
        return '<li>' + window.FSAI.esc(d.division) + ': ' + d.count + ' article' + (d.count === 1 ? '' : 's') + '</li>';
      }).join('');
    }
  });
})();
