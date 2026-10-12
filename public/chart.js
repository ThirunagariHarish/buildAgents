// Small SVG charts: probability over time (with touch scrubbing) and sparklines.
// Marks follow the data-viz spec: 2px lines, r>=4 end dots, 10% area wash,
// hairline solid gridlines, a direct label on the latest value.
(function (root) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = (d) => Date.parse(`${d}T00:00:00Z`);
  const fmtDate = (d) => new Date(day(d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  function spark(values, { w = 96, h = 28, color = 'var(--ink-3)', min = null, max = null, fill = true } = {}) {
    const v = (values || []).filter((x) => Number.isFinite(x));
    if (v.length < 2) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
    const lo = min ?? Math.min(...v), hi = max ?? Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * (w - 4) + 2, h - 3 - ((x - lo) / span) * (h - 6)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    const l = pts[pts.length - 1];
    const area = fill ? `<path d="${d}L${l[0].toFixed(1)} ${h}L2 ${h}Z" fill="${color}" opacity=".1"/>` : '';
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${l[0].toFixed(1)}" cy="${l[1].toFixed(1)}" r="2.4" fill="${color}"/></svg>`;
  }

  /**
   * Probability chart. series: [{ points: [{date, p}], color, dashed, label }].
   * The last series is the headline one: it gets the area wash, end dot and label.
   */
  function probability(el, series, { height = 214 } = {}) {
    const all = series.flatMap((s) => s.points);
    if (!all.length) { el.innerHTML = '<div class="chart-empty">The line starts after the first reading.</div>'; return; }
    const W = Math.max(280, el.clientWidth || 340), H = height;
    const padL = 4, padR = 46, padT = 12, padB = 26;
    const t0 = Math.min(...all.map((p) => day(p.date)));
    let t1 = Math.max(...all.map((p) => day(p.date)));
    if (t1 === t0) t1 = t0 + 86400000;
    const x = (d) => padL + ((day(d) - t0) / (t1 - t0)) * (W - padL - padR);
    const y = (p) => padT + (1 - p / 100) * (H - padT - padB);
    let svg = `<svg class="pchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability over time">`;
    for (const g of [0, 25, 50, 75, 100]) svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${W - padR + 8}" y="${y(g) + 4}" class="axis">${g}%</text>`;
    svg += `<text x="${padL}" y="${H - 6}" class="axis">${esc(fmtDate(new Date(t0).toISOString().slice(0, 10)))}</text><text x="${W - padR}" y="${H - 6}" class="axis" text-anchor="end">${esc(fmtDate(new Date(t1).toISOString().slice(0, 10)))}</text>`;
    series.forEach((s, i) => {
      if (!s.points.length) return;
      const lead = i === series.length - 1;
      const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.p).toFixed(1)}`).join('');
      if (lead && s.points.length > 1) svg += `<path d="${d}L${x(s.points[s.points.length - 1].date).toFixed(1)} ${y(0)}L${x(s.points[0].date).toFixed(1)} ${y(0)}Z" fill="${s.color}" opacity=".1"/>`;
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      if (lead) {
        const l = s.points[s.points.length - 1];
        svg += `<circle cx="${x(l.date)}" cy="${y(l.p)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
        const ly = Math.min(Math.max(y(l.p) - 10, padT + 2), H - padB - 4);
        svg += `<text x="${Math.min(x(l.date), W - padR) - 8}" y="${ly}" class="end-label" text-anchor="end">${Math.round(l.p)}%</text>`;
      }
    });
    svg += `<g class="scrub" style="display:none"><line class="scrub-line" y1="${padT}" y2="${H - padB}"/><circle r="5" stroke="var(--surface)" stroke-width="2"/></g></svg><div class="scrub-tip" style="display:none"></div>`;
    el.innerHTML = svg;
    const svgEl = el.querySelector('svg'), g = el.querySelector('.scrub'), tip = el.querySelector('.scrub-tip');
    const pts = series.flatMap((s, i) => s.points.map((p) => ({ ...p, label: s.label, color: s.color, lead: i === series.length - 1 })));
    const move = (clientX) => {
      const r = svgEl.getBoundingClientRect();
      const px = clientX - r.left;
      let best = null;
      for (const p of pts) { const dx = Math.abs(x(p.date) - px) - (p.lead ? 3 : 0); if (!best || dx < best.dx) best = { ...p, dx }; }
      if (!best) return;
      g.style.display = '';
      const ln = g.querySelector('line'); ln.setAttribute('x1', x(best.date)); ln.setAttribute('x2', x(best.date));
      const c = g.querySelector('circle'); c.setAttribute('cx', x(best.date)); c.setAttribute('cy', y(best.p)); c.setAttribute('fill', best.color);
      tip.style.display = ''; tip.innerHTML = `<b>${best.p.toFixed(0)}%</b> on ${esc(fmtDate(best.date))}<span>${esc(best.label || '')}</span>`;
      tip.style.left = `${Math.min(Math.max(0, x(best.date) - 56), W - 124)}px`;
    };
    const hide = () => { g.style.display = 'none'; tip.style.display = 'none'; };
    svgEl.addEventListener('pointermove', (e) => move(e.clientX));
    svgEl.addEventListener('pointerdown', (e) => move(e.clientX));
    svgEl.addEventListener('pointerleave', hide);
    svgEl.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svgEl.addEventListener('touchend', () => setTimeout(hide, 1400));
  }

  root.Chart = { spark, probability };
})(window);
