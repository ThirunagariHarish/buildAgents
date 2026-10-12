// Run Scenario — the app. Hash routes: #/ (your scenarios), #/s/<id>
// (a scenario's dashboard), #/status (data sources), #/reset/<token>.
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? esc(u) : null);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const daysTo = (d) => Math.ceil((Date.parse(`${d}T23:59:59Z`) - Date.now()) / 86400000);
  const S = { user: null, list: null, cur: null, live: {}, range: 'all', open: {} };

  async function api(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { S.user = null; render(); throw new Error(j.error || 'Sign in'); }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  function toast(msg, bad) {
    const t = document.createElement('div'); t.className = `toast${bad ? ' bad' : ''}`; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
  }
  const pClass = (p) => (p === null || p === undefined ? '' : p >= 56 ? 'yes' : p <= 44 ? 'no' : 'mid');
  const chg = (c) => (c === null || c === undefined || c === 0 ? '' : `<span class="chg ${c > 0 ? 'up' : 'down'}">${c > 0 ? '▲' : '▼'} ${Math.abs(c)}</span>`);

  // ---- routing ------------------------------------------------------------------
  const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

  async function boot() {
    try { const s = await api('/api/session'); S.user = s.authed ? { ...s.user, allowed: s.allowed } : null; } catch { S.user = null; }
    if (S.user && S.user.allowed) connect();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  function render() {
    const [r0, r1] = route();
    if (r0 === 'reset') return resetView(r1);
    if (!S.user) return loginView();
    if (!S.user.allowed) { app.innerHTML = `<main class="wrap narrow"><h1 class="brand">Run Scenario</h1><p class="muted">Signed in as ${esc(S.user.email)}. Run Scenario is invite-only for now.</p><button class="btn ghost" data-act="logout">Sign out</button></main>`; return; }
    if (r0 === 's' && r1) return dashView(r1);
    if (r0 === 'status') return statusView();
    return homeView();
  }

  // ---- sign in --------------------------------------------------------------------
  function loginView() {
    app.innerHTML = `<main class="wrap narrow login">
      <div class="logo">${logo()}</div>
      <h1 class="brand">Run Scenario</h1>
      <p class="muted">Your claims, tested against data every day.</p>
      <form id="login" class="stack">
        <input name="email" type="email" autocomplete="username" placeholder="Email" required>
        <input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
        <button class="btn">Sign in</button>
        <button type="button" class="link" data-act="forgot">Forgot password? / First time here?</button>
      </form>
      <p class="fine">Uses your Pocket Box account.</p></main>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api('/api/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); boot(); } catch (err) { toast(err.message, true); }
    };
  }
  function resetView(token) {
    app.innerHTML = `<main class="wrap narrow login"><div class="logo">${logo()}</div><h1 class="brand">Set your password</h1><form id="reset" class="stack"><input name="pw" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" required minlength="8"><button class="btn">Save</button></form></main>`;
    $('#reset').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/reset', { method: 'POST', body: { token, password: new FormData(e.target).get('pw') } }); toast('Saved. Sign in now.'); location.hash = '#/'; } catch (err) { toast(err.message, true); }
    };
  }
  const logo = () => `<svg viewBox="0 0 512 512" width="56" height="56"><rect width="512" height="512" rx="112" fill="#0b0f17"/><path d="M96 352 L176 288 L240 318 L320 200 L416 150" fill="none" stroke="#22c55e" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><circle cx="416" cy="150" r="30" fill="#22c55e"/></svg>`;

  // ---- home ---------------------------------------------------------------------------
  const EXAMPLES = [
    'The S&P 500 will crash 20% before the end of 2026',
    'The AI bubble is bursting: semiconductors fall 30% from their high within 6 months',
    'NVDA outperforms MSFT over the next 6 months',
    'Bitcoin reaches $150,000 before June 2027',
    'The Fed cuts rates at least twice by mid-2027',
  ];
  async function homeView() {
    app.innerHTML = `<header class="top"><div class="brand-row">${logo().replace('width="56" height="56"', 'width="28" height="28"')}<b>Run Scenario</b></div><div class="top-actions"><a href="#/status" class="icon-btn" title="Data sources">⚙︎</a></div></header>
    <main class="wrap">
      <section class="compose card">
        <h2>What's your claim?</h2>
        <form id="new" class="stack">
          <textarea name="claim" rows="2" maxlength="600" placeholder="e.g. The market might crash by the end of 2026" required></textarea>
          <details class="facts"><summary>Add your facts or reasoning (optional)</summary><textarea name="facts" rows="4" maxlength="3000" placeholder="Paste what makes you think so. Each statement gets fact-checked."></textarea></details>
          <button class="btn">Run the desk</button>
        </form>
        <div class="chips">${EXAMPLES.map((x) => `<button class="chip" data-act="example" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      </section>
      <section id="list"><div class="muted pad">Loading…</div></section>
      <p class="fine center">Research, not financial advice. Probabilities are estimates and can be wrong.</p>
    </main>`;
    $('#new').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Starting…';
      try { const r = await api('/api/scenarios', { method: 'POST', body: { claim: f.get('claim'), facts: f.get('facts') } }); location.hash = `#/s/${r.id}`; } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Run the desk'; }
    };
    loadList();
  }
  async function loadList() {
    const el = $('#list'); if (!el) return;
    try { S.list = (await api('/api/scenarios')).scenarios; } catch (e) { el.innerHTML = `<div class="muted pad">${esc(e.message)}</div>`; return; }
    if (!S.list.length) { el.innerHTML = '<div class="empty">No scenarios yet. State a claim above and the desk will start working on it.</div>'; return; }
    // Group by theme: a scenario and the follow-ups tracked from it.
    const themes = new Map();
    for (const s of S.list) { if (!themes.has(s.themeId)) themes.set(s.themeId, []); themes.get(s.themeId).push(s); }
    el.innerHTML = `<h3 class="section">Your scenarios</h3>${[...themes.values()].map((g) => `<div class="theme${g.length > 1 ? ' multi' : ''}">${g.map(rowCard).join('')}</div>`).join('')}`;
  }
  function rowCard(s) {
    const busy = ['running', 'queued', 'new'].includes(s.status) && s.probability === null;
    const p = s.probability;
    return `<a class="row card" href="#/s/${s.id}">
      <div class="row-main"><div class="row-title">${s.parentId ? '<span class="sub">↳</span> ' : ''}${esc(s.title)}</div>
        <div class="row-meta">${s.status === 'running' ? '<span class="live-dot"></span> Desk is working' : s.status === 'queued' ? 'Queued' : s.status === 'error' ? '<span class="bad">Needs a retry</span>' : s.status === 'resolved' ? 'Resolved' : esc(s.verdict || '')}${s.horizonDate ? ` · ${daysTo(s.horizonDate) > 0 ? `${daysTo(s.horizonDate)} days left` : 'deadline passed'}` : ''}</div></div>
      <div class="row-side">${busy ? '<div class="spinner"></div>' : `<div class="row-p ${pClass(p)}">${p === null ? '–' : `${Math.round(p)}%`}</div>${chg(s.change)}`}
        ${s.spark && s.spark.length > 1 ? Chart.spark(s.spark, { w: 72, h: 22, min: 0, max: 100, color: p >= 50 ? 'var(--yes)' : 'var(--no)' }) : ''}</div></a>`;
  }

  // ---- dashboard ------------------------------------------------------------------------
  async function dashView(id, { keepScroll } = {}) {
    if (!keepScroll || !S.cur || S.cur.id !== id) app.innerHTML = `<header class="top"><a href="#/" class="back">‹ Scenarios</a></header><main class="wrap"><div class="muted pad">Loading…</div></main>`;
    let sc;
    try { sc = await api(`/api/scenarios/${id}`); } catch (e) { app.querySelector('main').innerHTML = `<div class="muted pad">${esc(e.message)}</div>`; return; }
    S.cur = sc;
    if (sc.progress) S.live[id] = sc.progress.steps;
    const y = window.scrollY;
    app.innerHTML = dashHtml(sc);
    drawChart();
    if (keepScroll) window.scrollTo(0, y);
    if (sc.latest) api(`/api/scenarios/${id}/seen`, { method: 'POST' }).catch(() => {});
  }

  function dashHtml(sc) {
    const run = sc.latest;
    const th = sc.thesis;
    const busy = ['running', 'queued', 'new'].includes(sc.status) || sc.queued;
    const p = run ? run.probability : null;
    const steps = S.live[sc.id] || [];
    const prevH = sc.history.length > 1 ? sc.history[sc.history.length - 2] : null;
    return `<header class="top"><a href="#/" class="back">‹ Scenarios</a><div class="top-actions"><button class="icon-btn" data-act="share" title="Copy link">⤴︎</button></div></header>
    <main class="wrap dash">
      <section class="hero">
        <div class="eyebrow">${th ? esc(kindLabel(th)) : 'New scenario'}${th ? ` · by ${esc(fmtDay(th.horizonDate))}` : ''}</div>
        <h1>${esc(th ? th.title : sc.claim)}</h1>
        ${th ? `<p class="prop">${esc(th.proposition)}</p>` : `<p class="prop muted">“${esc(sc.claim)}”</p>`}
        ${run ? `<div class="big">
            <div class="big-p ${pClass(p)}">${p}<small>%</small></div>
            <div class="big-side"><div class="verdict ${pClass(p)}">${esc(run.verdict)}</div>
              <div class="delta">${prevH ? `${chg(Math.round((p - prevH.p) * 10) / 10) || '<span class="chg">no change</span>'} since ${esc(fmtDay(prevH.date))}` : 'first reading'}</div>
              <div class="trend">${trendWord(run.judge.trend)} · ${esc(run.judge.confidence)} confidence</div></div>
          </div>
          <p class="call">${esc(run.call)}</p>` : ''}
        ${sc.resolved ? `<div class="resolved ${sc.resolved.outcome}">Resolved ${sc.resolved.outcome.toUpperCase()}: ${esc(sc.resolved.why)}</div>` : ''}
      </section>

      ${busy || steps.length && sc.status === 'running' ? liveDesk(sc, steps) : ''}
      ${sc.status === 'error' ? `<div class="card warn">The desk stopped: ${esc(sc.error || 'unknown error')}. <button class="btn small" data-act="run">Try again</button></div>` : ''}

      ${run || sc.backfill.length ? `<section class="card chart-card">
        <div class="chart-head"><b>Is it coming true?</b><div class="seg">${['1w', '1m', 'all'].map((r) => `<button class="${S.range === r ? 'on' : ''}" data-act="range" data-v="${r}">${r.toUpperCase()}</button>`).join('')}</div></div>
        <div id="pchart" class="pchart-wrap"></div>
        <div class="legend"><span><i class="sw solid"></i>Desk's call</span>${sc.backfill.length ? '<span><i class="sw dash"></i>Model replay (price only)</span>' : ''}${sc.history.some((h) => h.q !== null) ? '<span><i class="sw q"></i>Monte Carlo</span>' : ''}</div>
      </section>` : ''}

      ${sinceVisit(sc)}
      ${run ? analystsHtml(run) : ''}
      ${run ? factsHtml(run) : ''}
      ${run && (run.judge.bull.length || run.judge.bear.length) ? `<section class="card"><h3>Both sides</h3><div class="cases"><div class="case yes"><h4>Case for YES</h4><ul>${run.judge.bull.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="case no"><h4>Case for NO</h4><ul>${run.judge.bear.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>${run.judge.summary ? `<p class="summary">${esc(run.judge.summary)}</p>` : ''}</section>` : ''}
      ${run && run.judge.watch.length ? `<section class="card"><h3>What would change the call</h3>${run.judge.watch.map((w) => `<div class="watch"><b>${esc(w.signal)}</b><span class="thr">${esc(w.threshold)}</span><p>${esc(w.why)}</p></div>`).join('')}</section>` : ''}
      ${catalystsHtml(run)}
      ${askHtml(sc)}
      ${th ? thesisHtml(sc, th) : ''}
      ${sc.theme.length ? `<section class="card"><h3>Same theme</h3>${sc.theme.map(rowCard).join('')}</section>` : ''}
      ${historyHtml(sc)}
      ${settingsHtml(sc)}
      ${run ? `<p class="fine center">Run ${esc(run.date)} · ${Math.round(run.durationMs / 1000)}s · prices: ${esc((run.sources || []).join(', ') || 'n/a')} · sentiment: ${esc(run.models.sentiment || 'n/a')}${run.models.forecast ? ` · forecast: ${esc(run.models.forecast)}` : ''}${run.errors && run.errors.length ? ` · <span title="${esc(run.errors.join('\n'))}">${run.errors.length} source(s) unavailable</span>` : ''}<br>Research, not financial advice.</p>` : ''}
    </main>`;
  }
  const kindLabel = (th) => ({ market: 'Market', stock: 'Single stock', compare: 'Comparison', macro: 'Macro', crypto: 'Crypto', event: 'Event' }[th.kind] || 'Scenario');
  const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const trendWord = (t) => (t === 'rising' ? '<span class="up">↗ Firming up</span>' : t === 'falling' ? '<span class="down">↘ Fading</span>' : '→ Holding steady');

  function liveDesk(sc, steps) {
    const who = ['Strategist', 'Data', 'Quant', 'Technicals', 'Macro', 'Sentiment', 'Research', 'Judge'];
    const icons = { Strategist: '🧭', Data: '🛰️', Quant: '🎲', Technicals: '📈', Macro: '🏛️', Sentiment: '🗣️', Research: '📰', Judge: '⚖️' };
    const lastWho = steps.length ? steps[steps.length - 1].who : null;
    const seen = new Set(steps.map((s) => s.who));
    return `<section class="card live"><div class="live-head"><span class="live-dot"></span><b>${sc.status === 'queued' || sc.queued ? 'Queued — the desk works one scenario at a time' : 'The desk is working'}</b></div>
      <div class="desk">${who.map((w) => `<div class="seat ${w === lastWho ? 'now' : seen.has(w) ? 'done' : ''}"><span>${icons[w]}</span><small>${w}</small></div>`).join('')}</div>
      <ol class="steps">${steps.slice(-6).reverse().map((s) => `<li><b>${esc(s.who)}</b> ${esc(s.text)}</li>`).join('') || '<li class="muted">Starting…</li>'}</ol>
      <p class="fine">Takes a few minutes. You can leave; it keeps going.</p></section>`;
  }

  function sinceVisit(sc) {
    const sv = sc.sinceVisit;
    const run = sc.latest;
    const list = sv ? sv.changes : run ? run.changes || [] : [];
    if (!list.length && !(run && run.judge.changed && run.judge.changed !== 'first run')) return '';
    return `<section class="card changes"><h3>${sv ? `Since your last look (${esc(fmtDay(sv.from))}, ${sv.fromP}%)` : 'What changed today'}</h3>
      ${run && run.judge.changed && !/^first run/i.test(run.judge.changed) ? `<p class="summary">${esc(run.judge.changed)}</p>` : ''}
      <ul class="clist">${list.map((c) => `<li class="${c.up === true ? 'up' : c.up === false ? 'down' : ''}">${c.url ? `<a href="${safeUrl(c.url)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text)}</li>`).join('')}</ul></section>`;
  }

  function stanceBar(a) {
    const pos = (a.stance + 1) * 50;
    return `<div class="stance" title="Stance ${a.stance.toFixed(2)}, confidence ${a.confidence.toFixed(2)}"><div class="track"><div class="mid"></div><div class="knob ${a.stance > 0.1 ? 'yes' : a.stance < -0.1 ? 'no' : ''}" style="left:${pos.toFixed(1)}%;opacity:${(0.45 + a.confidence * 0.8).toFixed(2)}"></div></div><div class="stance-l"><span>Against</span><span>For</span></div></div>`;
  }
  function analystsHtml(run) {
    return `<section><h3 class="section">The desk</h3><div class="analysts">${run.analysts.map((a) => {
      const open = S.open[a.id];
      return `<div class="card analyst ${open ? 'open' : ''}" data-act="toggle" data-v="${esc(a.id)}">
        <div class="a-head"><span class="a-icon">${a.icon}</span><div class="a-title"><b>${esc(a.name)}</b>${a.probability !== undefined ? `<span class="a-p ${pClass(a.probability * 100)}">${(a.probability * 100).toFixed(0)}%</span>` : ''}</div><span class="caret">${open ? '−' : '+'}</span></div>
        <p class="a-headline">${esc(a.headline)}</p>
        ${stanceBar(a)}
        ${open ? analystBody(a) : ''}
      </div>`;
    }).join('')}</div></section>`;
  }
  function analystBody(a) {
    let extra = '';
    if (a.sheets) extra += `<div class="sheets">${a.sheets.map((s) => `<div class="sheet"><b>${esc(s.symbol)}</b><span>${fmtN(s.last)}</span>${Chart.spark(s.spark, { w: 110, h: 30, color: s.ret3m >= 0 ? 'var(--yes)' : 'var(--no)' })}<small class="${s.fromHigh < -0.1 ? 'down' : ''}">${pctS(s.fromHigh)} from high</small></div>`).join('')}</div>`;
    if (a.series) extra += `<div class="sheets">${a.series.map((s) => `<div class="sheet"><b>${esc(s.id)}</b><span>${fmtN(s.last)}</span>${Chart.spark(s.spark, { w: 110, h: 30, color: 'var(--accent)' })}<small>${esc(s.name)}</small></div>`).join('')}</div>`;
    if (a.forecast) extra += `<div class="fc"><b>Chronos-Bolt</b> median path ${Chart.spark(a.forecast.median, { w: 160, h: 34, color: 'var(--accent)' })}</div>`;
    if (a.quotes && a.quotes.length) extra += `<div class="quotes">${a.quotes.map((q) => `<a class="quote ${q.s > 0 ? 'up' : 'down'}" ${safeUrl(q.url) ? `href="${safeUrl(q.url)}" target="_blank" rel="noopener"` : ''}><span>${esc(q.text)}</span><small>${esc(q.where || q.group)}</small></a>`).join('')}</div>`;
    return `<ul class="points">${a.points.map((p) => `<li class="${p.for === true ? 'for' : p.for === false ? 'against' : ''}">${esc(p.text)}${p.source || p.url ? ` <span class="src">${safeUrl(p.url) ? `<a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.source || host(p.url))}</a>` : esc(p.source)}${p.date ? ` · ${esc(p.date)}` : ''}</span>` : ''}</li>`).join('')}</ul>${extra}`;
  }
  const fmtN = (x) => (x === null || x === undefined ? '–' : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
  const pctS = (x) => (x === null || x === undefined ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

  function factsHtml(run) {
    const r = run.analysts.find((a) => a.id === 'research');
    const fc = r ? r.factChecks || [] : [];
    const j = run.judge;
    if (!fc.length && !j.corrections.length && !j.supports.length) return '';
    const label = { true: 'True', false: 'False', partly: 'Partly', unverified: 'Unverified' };
    return `<section class="card"><h3>Your facts, checked</h3>
      ${fc.map((f) => `<div class="fact"><span class="badge ${f.verdict}">${label[f.verdict]}</span><div><b>${esc(f.claim)}</b><p>${esc(f.detail)}${safeUrl(f.url) ? ` <a href="${safeUrl(f.url)}" target="_blank" rel="noopener">${esc(f.source || host(f.url))}</a>` : ''}</p></div></div>`).join('')}
      ${j.corrections.length ? `<h4 class="no-t">Where the data disagrees with you</h4><ul>${j.corrections.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${j.supports.length ? `<h4 class="yes-t">Where the data backs you</h4><ul>${j.supports.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`;
  }
  function catalystsHtml(run) {
    const r = run && run.analysts.find((a) => a.id === 'research');
    const c = r ? (r.catalysts || []).filter((x) => x.event) : [];
    if (!c.length) return '';
    return `<section class="card"><h3>Coming up</h3><div class="cats">${c.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((x) => `<div class="cat"><div class="cat-d">${esc(x.date ? fmtDay(x.date) : 'TBD')}</div><div><b>${esc(x.event)}</b><p>${esc(x.why)}</p></div></div>`).join('')}</div></section>`;
  }
  function askHtml(sc) {
    const qs = (sc.questions || []).slice().reverse();
    return `<section class="card ask"><h3>Ask the desk</h3>
      <form id="ask" class="ask-row"><input name="q" maxlength="600" placeholder="e.g. What happened to semis in the 2000 bubble?" autocomplete="off"><button class="btn small">Ask</button></form>
      ${qs.map((q) => `<div class="qa"><div class="q">${esc(q.q)}</div>${q.status === 'thinking' ? `<div class="a muted" data-qid="${esc(q.id)}"><span class="spinner small"></span> <span class="qtext">${esc(S.live[`q:${q.id}`] || 'Researching…')}</span></div>` : `<div class="a">${fmtText(q.answer)}</div>${(q.sources || []).length ? `<div class="srcs">${q.sources.map((s) => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.title || host(s.url))}</a>`).join('')}</div>` : ''}${q.track ? `<button class="chip track" data-act="track" data-v="${esc(q.track)}">＋ Track: ${esc(q.track)}</button>` : ''}`}</div>`).join('')}
      ${sc.thesis && sc.thesis.followUps.length ? `<div class="chips">${sc.thesis.followUps.map((f) => `<button class="chip" data-act="track" data-v="${esc(f)}">＋ ${esc(f)}</button>`).join('')}</div><p class="fine">Tap a suggestion to track it as its own scenario in this theme.</p>` : ''}
    </section>`;
  }
  const fmtText = (t) => esc(t).replace(/\n/g, '<br>');
  function thesisHtml(sc, th) {
    return `<section class="card thesis"><h3>How it's measured</h3>
      <p><b>Resolves:</b> ${esc(th.resolution)}</p>
      <p><b>Deadline:</b> ${esc(fmtDay(th.horizonDate))} (${daysTo(th.horizonDate)} days)</p>
      <p><b>Watching:</b> ${th.instruments.map((i) => `<span class="tag" title="${esc(i.why)}">${esc(i.symbol)}</span>`).join(' ')} ${th.macro.map((m) => `<span class="tag ghost">${esc(m)}</span>`).join(' ')}</p>
      ${th.baseRate ? `<p><b>Base rate:</b> ${(th.baseRate.p * 100).toFixed(0)}% — ${esc(th.baseRate.why)}</p>` : ''}
      ${th.assumptions.length ? `<p class="muted"><b>Assumptions:</b> ${th.assumptions.map(esc).join(' ')}</p>` : ''}
      <p class="muted"><b>You said:</b> “${esc(sc.claim)}”</p></section>`;
  }
  function historyHtml(sc) {
    if (sc.runs.length < 2) return '';
    return `<section class="card"><h3>Every run</h3><div class="hist">${sc.runs.slice().reverse().slice(0, 30).map((r, i, arr) => { const prev = arr[i + 1]; return `<div class="hrow"><span>${esc(fmtDay(r.date))}</span><b class="${pClass(r.p)}">${r.p}%</b>${prev ? chg(Math.round((r.p - prev.p) * 10) / 10) : ''}</div>`; }).join('')}</div></section>`;
  }
  function settingsHtml(sc) {
    return `<section class="card settings"><h3>Settings</h3>
      <label class="tog"><input type="checkbox" data-act="schedule" ${sc.schedule === 'daily' ? 'checked' : ''}> Re-run every day after the US close</label>
      <label class="tog"><input type="checkbox" data-act="alert" ${sc.alerts && sc.alerts.email ? 'checked' : ''}> Email me when it moves ≥ <select data-act="move">${[3, 5, 10, 15].map((n) => `<option ${sc.alerts && sc.alerts.move === n ? 'selected' : ''}>${n}</option>`).join('')}</select> pts</label>
      <div class="btns"><button class="btn small" data-act="run" ${['running', 'queued'].includes(sc.status) ? 'disabled' : ''}>Run now</button><button class="btn small ghost danger" data-act="delete">Delete</button></div></section>`;
  }

  function drawChart() {
    const el = $('#pchart'); const sc = S.cur;
    if (!el || !sc) return;
    const cut = S.range === '1w' ? 7 : S.range === '1m' ? 31 : 99999;
    const since = new Date(Date.now() - cut * 86400000).toISOString().slice(0, 10);
    const keep = (pts) => pts.filter((p) => p.date >= since);
    const desk = keep(sc.history.map((h) => ({ date: h.date, p: h.p })));
    const series = [];
    if (sc.backfill.length) series.push({ points: keep(sc.backfill), color: 'var(--muted2)', dashed: true, label: 'Model replay' });
    const q = keep(sc.history.filter((h) => h.q !== null && h.q !== undefined).map((h) => ({ date: h.date, p: h.q })));
    if (q.length > 1) series.push({ points: q, color: 'var(--accent)', dashed: true, label: 'Monte Carlo' });
    series.push({ points: desk, color: (desk.length ? desk[desk.length - 1].p : 50) >= 50 ? 'var(--yes)' : 'var(--no)', label: "Desk's call" });
    Chart.probability(el, series);
  }
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(drawChart, 150); });

  // ---- status ---------------------------------------------------------------------------------
  async function statusView() {
    app.innerHTML = `<header class="top"><a href="#/" class="back">‹ Scenarios</a></header><main class="wrap"><h2>Data sources</h2><div id="st" class="muted pad">Checking every source from the server… (up to a minute)</div></main>`;
    try {
      const s = await api('/api/status');
      $('#st').outerHTML = `<section class="card">${s.sources.map((x) => `<div class="srow"><span class="dot ${x.ok ? 'ok' : 'bad'}"></span><b>${esc(x.name)}</b><span class="muted">${esc(x.detail)}</span></div>`).join('')}<p class="fine">Checked ${esc(ago(s.at))}. <button class="link" data-act="recheck">Check again</button></p></section>
      <section class="card"><h3>Models</h3><p>${s.models ? `Hugging Face sidecar on: ${esc(JSON.stringify(s.models))}` : 'Hugging Face sidecar (Chronos-Bolt, FinBERT) is not installed on the server yet; the desk uses its own simulation and a finance word list.'}</p><p>Claude analysts: research (with web search) and judge.</p><p>Daily run: ${esc(s.daily)}. Email: ${s.mail ? 'on' : 'off'}.</p></section>
      <section class="card"><h3>Account</h3><p>${esc(S.user.email)}</p><button class="btn small ghost" data-act="logout">Sign out</button></section>`;
    } catch (e) { $('#st').textContent = e.message; }
  }

  // ---- actions ---------------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    if (act === 'example') { const ta = $('#new textarea[name=claim]'); ta.value = v; ta.focus(); }
    else if (act === 'logout') { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.user = null; location.hash = '#/'; render(); }
    else if (act === 'forgot') {
      const email = $('#login input[name=email]').value.trim();
      if (!email) return toast('Type your email first.', true);
      try { const r = await api('/api/forgot', { method: 'POST', body: { email } }); toast(r.message); } catch (err) { toast(err.message, true); }
    }
    else if (act === 'range') { S.range = v; app.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); drawChart(); }
    else if (act === 'toggle') { if (e.target.closest('a')) return; S.open[v] = !S.open[v]; dashView(S.cur.id, { keepScroll: true }); }
    else if (act === 'run') { try { await api(`/api/scenarios/${S.cur.id}/run`, { method: 'POST' }); S.live[S.cur.id] = []; dashView(S.cur.id, { keepScroll: true }); } catch (err) { toast(err.message, true); } }
    else if (act === 'delete') { if (!confirm('Delete this scenario and its history?')) return; await api(`/api/scenarios/${S.cur.id}`, { method: 'DELETE' }); location.hash = '#/'; }
    else if (act === 'track') { try { const r = await api('/api/scenarios', { method: 'POST', body: { claim: v, parentId: S.cur.id } }); toast('Tracking it as a new scenario.'); location.hash = `#/s/${r.id}`; } catch (err) { toast(err.message, true); } }
    else if (act === 'share') { try { await navigator.clipboard.writeText(location.href); toast('Link copied (only you can open it).'); } catch { toast('Copy failed.', true); } }
    else if (act === 'recheck') { $('main').innerHTML = '<div class="muted pad">Checking…</div>'; await api('/api/status?fresh=1').catch(() => {}); statusView(); }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t || !S.cur) return;
    const sc = S.cur;
    const body = t.dataset.act === 'schedule' ? { schedule: t.checked ? 'daily' : 'off' }
      : t.dataset.act === 'alert' ? { alerts: { ...(sc.alerts || {}), email: t.checked } }
        : t.dataset.act === 'move' ? { alerts: { ...(sc.alerts || {}), move: Number(t.value) } } : null;
    if (!body) return;
    try { await api(`/api/scenarios/${sc.id}`, { method: 'PATCH', body }); Object.assign(sc, body); toast('Saved.'); } catch (err) { toast(err.message, true); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ask') return;
    e.preventDefault();
    const inp = e.target.querySelector('input'); const q = inp.value.trim(); if (!q) return;
    inp.value = '';
    try { await api(`/api/scenarios/${S.cur.id}/ask`, { method: 'POST', body: { q } }); dashView(S.cur.id, { keepScroll: true }); } catch (err) { toast(err.message, true); }
  });

  // ---- live events -------------------------------------------------------------------------------
  let es = null;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    let pending = null;
    const refresh = () => { clearTimeout(pending); pending = setTimeout(() => { const [r0, r1] = route(); if (r0 === 's' && r1) dashView(r1, { keepScroll: true }); else if (!r0) loadList(); }, 250); };
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      const [r0, r1] = route();
      if (ev.event === 'progress') {
        (S.live[ev.id] = S.live[ev.id] || []).push(ev.step);
        if (r0 === 's' && r1 === ev.id) {
          const box = $('.card.live');
          if (box) box.outerHTML = liveDesk(S.cur, S.live[ev.id]); else refresh();
        }
      } else if (ev.event === 'scenario') {
        if (ev.done) { S.live[ev.id] = []; if (r0 === 's' && r1 === ev.id) toast('The desk finished a new reading.'); }
        if ((r0 === 's' && r1 === ev.id) || !r0) refresh();
      } else if (ev.event === 'qstep') {
        S.live[`q:${ev.qid}`] = ev.text;
        const el = document.querySelector(`[data-qid="${ev.qid}"] .qtext`);
        if (el) el.textContent = ev.text;
      } else if (ev.event === 'question') { if (r0 === 's' && r1 === ev.id) refresh(); }
    };
    es.onerror = () => { es.close(); es = null; setTimeout(() => { if (S.user) connect(); }, 5000); };
  }

  boot();
})();
