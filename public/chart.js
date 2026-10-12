// Small SVG charts: the probability-over-time chart (with touch scrubbing)
// and sparklines. No libraries.
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = (d) => Date.parse(`${d}T00:00:00Z`);
  const fmtDate = (d) => new Date(day(d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  function spark(values, { w = 96, h = 28, color = 'currentColor', min = null, max = null, fill = true } = {}) {
    const v = (values || []).filter((x) => Number.isFinite(x));
    if (v.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const lo = min ?? Math.min(...v), hi = max ?? Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * (w - 2) + 1, h - 2 - ((x - lo) / span) * (h - 4)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    const area = fill ? `<path d="${d}L${pts[pts.length - 1][0].toFixed(1)} ${h}L1 ${h}Z" fill="${color}" opacity=".12"/>` : '';
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  /**
   * Probability chart. series: [{ points: [{date, p}], color, dashed, label }].
   * Renders into el and lets a finger or mouse scrub along it.
   */
  function probability(el, series, { height = 210, horizon = null } = {}) {
    const all = series.flatMap((s) => s.points);
    if (!all.length) { el.innerHTML = '<div class="chart-empty">The chart starts after the first run.</div>'; return; }
    const W = Math.max(280, el.clientWidth || 340), H = height;
    const padL = 6, padR = 38, padT = 14, padB = 24;
    const t0 = Math.min(...all.map((p) => day(p.date)));
    let t1 = Math.max(...all.map((p) => day(p.date)));
    if (t1 === t0) t1 = t0 + 86400000;
    const x = (d) => padL + ((day(d) - t0) / (t1 - t0)) * (W - padL - padR);
    const y = (p) => padT + (1 - p / 100) * (H - padT - padB);
    let svg = `<svg class="pchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability over time">`;
    for (const g of [0, 25, 50, 75, 100]) svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(g)}" y2="${y(g)}" class="grid${g === 50 ? ' mid' : ''}"/><text x="${W - padR + 6}" y="${y(g) + 4}" class="axis">${g}%</text>`;
    svg += `<text x="${padL}" y="${H - 6}" class="axis">${esc(fmtDate(new Date(t0).toISOString().slice(0, 10)))}</text><text x="${W - padR}" y="${H - 6}" class="axis" text-anchor="end">${esc(fmtDate(new Date(t1).toISOString().slice(0, 10)))}</text>`;
    for (const s of series) {
      if (!s.points.length) continue;
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.p).toFixed(1)}`).join('');
      if (!s.dashed && s.points.length > 1) svg += `<path d="${d}L${x(s.points[s.points.length - 1].date).toFixed(1)} ${y(0)}L${x(s.points[0].date).toFixed(1)} ${y(0)}Z" fill="${s.color}" opacity=".08"/>`;
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 1.6 : 2.6}" ${s.dashed ? 'stroke-dasharray="4 4" opacity=".75"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      if (!s.dashed) { const l = s.points[s.points.length - 1]; svg += `<circle cx="${x(l.date)}" cy="${y(l.p)}" r="9" fill="${s.color}" opacity=".18" class="pulse"/><circle cx="${x(l.date)}" cy="${y(l.p)}" r="4.5" fill="${s.color}"/>`; }
    }
    svg += `<g class="scrub" style="display:none"><line class="scrub-line" y1="${padT}" y2="${H - padB}"/><circle r="5" class="scrub-dot"/></g></svg><div class="scrub-tip" style="display:none"></div>`;
    el.innerHTML = svg;
    const svgEl = el.querySelector('svg'), g = el.querySelector('.scrub'), tip = el.querySelector('.scrub-tip');
    const pts = series.flatMap((s) => s.points.map((p) => ({ ...p, label: s.label, color: s.color, solid: !s.dashed })));
    const move = (clientX) => {
      const r = svgEl.getBoundingClientRect();
      const px = clientX - r.left;
      let best = null;
      for (const p of pts) { const dx = Math.abs(x(p.date) - px) - (p.solid ? 2 : 0); if (!best || dx < best.dx) best = { ...p, dx }; }
      if (!best) return;
      g.style.display = '';
      g.querySelector('line').setAttribute('x1', x(best.date)); g.querySelector('line').setAttribute('x2', x(best.date));
      const c = g.querySelector('circle'); c.setAttribute('cx', x(best.date)); c.setAttribute('cy', y(best.p)); c.setAttribute('fill', best.color);
      tip.style.display = ''; tip.innerHTML = `<b>${best.p.toFixed(0)}%</b> ${esc(fmtDate(best.date))}<span>${esc(best.label || '')}</span>`;
      tip.style.left = `${Math.min(Math.max(0, x(best.date) - 50), W - 110)}px`;
    };
    const hide = () => { g.style.display = 'none'; tip.style.display = 'none'; };
    svgEl.addEventListener('pointermove', (e) => move(e.clientX));
    svgEl.addEventListener('pointerdown', (e) => move(e.clientX));
    svgEl.addEventListener('pointerleave', hide);
    svgEl.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svgEl.addEventListener('touchend', () => setTimeout(hide, 1200));
  }

  root.Chart = { spark, probability };
})(window);
