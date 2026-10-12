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
      if (s.dots) {
        // Marker series (the person's own calls): dots with a surface ring, joined by a thin line.
        if (s.points.length > 1) svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.2" opacity=".6"/>`;
        for (const pt of s.points) svg += `<circle cx="${x(pt.date).toFixed(1)}" cy="${y(pt.p).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
        return;
      }
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

  /**
   * General line chart on an index axis. opts: { series: [{ values, color, label, dash, width }],
   * bands: [{ lo, hi, color, opacity }], hlines: [{ y, label, color, dash }], xlabels: [left, right],
   * yfmt, height, tip(i) -> html }. Missing values (null) break the line.
   */
  function xy(el, o) {
    const W = Math.max(280, el.clientWidth || 340), H = o.height || 220;
    const padL = 4, padR = 54, padT = 12, padB = 24;
    const n = Math.max(...o.series.map((s) => s.values.length), ...(o.bands || []).map((b) => b.lo.length));
    const vals = [...o.series.flatMap((s) => s.values), ...(o.bands || []).flatMap((b) => [...b.lo, ...b.hi]), ...(o.hlines || []).map((h) => h.y)].filter((v) => v !== null && Number.isFinite(v));
    let lo = o.ymin ?? Math.min(...vals), hi = o.ymax ?? Math.max(...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const padV = (hi - lo) * 0.06; if (o.ymin === undefined) lo -= padV; if (o.ymax === undefined) hi += padV;
    const x = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const fmt = o.yfmt || ((v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)));
    let svg = `<svg class="pchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Chart')}">`;
    for (let g = 0; g <= 4; g++) { const v = lo + ((hi - lo) * g) / 4; svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${W - padR + 8}" y="${y(v) + 4}" class="axis">${esc(fmt(v))}</text>`; }
    if (o.xlabels) svg += `<text x="${padL}" y="${H - 6}" class="axis">${esc(o.xlabels[0])}</text><text x="${W - padR}" y="${H - 6}" class="axis" text-anchor="end">${esc(o.xlabels[1])}</text>`;
    for (const b of o.bands || []) {
      const top = b.hi.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
      const bot = b.lo.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
      svg += `<path d="${top}${bot}Z" fill="${b.color}" opacity="${b.opacity || 0.15}"/>`;
    }
    for (const h of o.hlines || []) svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(h.y)}" y2="${y(h.y)}" stroke="${h.color || 'var(--ink-3)'}" stroke-width="1.2" ${h.dash === false ? '' : 'stroke-dasharray="4 4"'}/><text x="${padL + 4}" y="${y(h.y) - 5}" class="hl-label" fill="${h.color || 'var(--ink-3)'}">${esc(h.label || '')}</text>`;
    for (const s of o.series) {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    const lead = o.series[0];
    const li = lead.values.length - 1;
    if (lead.values[li] !== null) svg += `<circle cx="${x(li)}" cy="${y(lead.values[li])}" r="4" fill="${lead.color}" stroke="var(--surface)" stroke-width="2"/>`;
    svg += `<g class="scrub" style="display:none"><line class="scrub-line" y1="${padT}" y2="${H - padB}"/></g></svg>${o.tip ? '<div class="scrub-tip" style="display:none"></div>' : ''}`;
    el.innerHTML = svg;
    if (!o.tip) return;
    const svgEl = el.querySelector('svg'), g = el.querySelector('.scrub'), tip = el.querySelector('.scrub-tip');
    const move = (cx) => { const r = svgEl.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.round(((cx - r.left - padL) / (W - padL - padR)) * (n - 1)))); g.style.display = ''; const ln = g.querySelector('line'); ln.setAttribute('x1', x(i)); ln.setAttribute('x2', x(i)); tip.style.display = ''; tip.innerHTML = o.tip(i); tip.style.left = `${Math.min(Math.max(0, x(i) - 60), W - 140)}px`; };
    svgEl.addEventListener('pointermove', (e) => move(e.clientX));
    svgEl.addEventListener('pointerdown', (e) => move(e.clientX));
    svgEl.addEventListener('pointerleave', () => { g.style.display = 'none'; tip.style.display = 'none'; });
  }

  /** Vertical bars. items: [{ label, value, color, title }]; values may be negative (bars grow from zero). */
  function bars(el, { items, height = 160, yfmt = (v) => String(v), label = 'Bar chart', every = 1 }) {
    const W = Math.max(280, el.clientWidth || 340), H = height, padB = 22, padT = 10, padR = 4;
    const vals = items.map((i) => i.value);
    const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
    const span = hi - lo || 1;
    const y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);
    const bw = (W - padR) / items.length;
    let svg = `<svg class="pchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><line x1="0" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="grid"/>`;
    items.forEach((it, i) => {
      const x = i * bw + Math.max(1, bw * 0.12), w = Math.max(2, bw * 0.76);
      const top = Math.min(y(it.value), y(0)), h = Math.max(1, Math.abs(y(it.value) - y(0)));
      svg += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, w / 3)}" fill="${it.color || 'var(--series-1)'}"><title>${esc(it.title || `${it.label}: ${yfmt(it.value)}`)}</title></rect>`;
      if (i % every === 0 && it.label) svg += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 6}" class="axis" text-anchor="middle">${esc(it.label)}</text>`;
    });
    el.innerHTML = `${svg}</svg>`;
  }

  root.Chart = { spark, probability, xy, bars };
})(window);
