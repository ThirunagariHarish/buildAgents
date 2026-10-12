// Run Scenario, the app. Routes: #/ (your scenarios), #/s/<id> (a scenario),
// #/signup, #/forgot, #/reset/<token>, #/people (owner), #/sources.
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? esc(u) : null);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const daysTo = (d) => Math.ceil((Date.parse(`${d}T23:59:59Z`) - Date.now()) / 86400000);
  const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const I = (n, s = 18, c = '') => window.Icon(n, s, c);
  const S = { me: null, list: null, cur: null, live: {}, range: 'all', open: {}, mode: null };

  async function api(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !opts.anon) { S.me = null; render(); throw new Error(j.error || 'Sign in to continue.'); }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status}).`);
    return j;
  }
  function toast(msg, bad) {
    const t = document.createElement('div'); t.className = `toast${bad ? ' bad' : ''}`; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3400);
  }
  const tone = (p) => (p === null || p === undefined ? '' : p >= 56 ? 'yes' : p <= 44 ? 'no' : 'mid');
  const delta = (c) => (c === null || c === undefined ? '' : c === 0 ? '<span class="delta">0</span>' : `<span class="delta ${c > 0 ? 'up' : 'down'}">${c > 0 ? '+' : ''}${c}</span>`);
  const mark = () => `<span class="brand-mark">${I('chart-line-up', 16)}</span>`;

  // ---- routing ---------------------------------------------------------------------
  const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  window.addEventListener('scroll', () => { const t = $('.top'); if (t) t.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });

  async function boot() {
    try { const s = await api('/api/session', { anon: true }); S.me = s.authed ? { ...s.user, allowed: s.allowed, claude: s.claude, owner: s.owner } : null; S.openSignup = s.openSignup; } catch { S.me = null; }
    if (S.me && S.me.allowed) connect();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  function render() {
    const [r0, r1] = route();
    if (r0 === 'reset') return resetView(r1);
    if (!S.me) return r0 === 'signup' ? signupView() : r0 === 'forgot' ? forgotView() : loginView();
    if (r0 === 's' && r1) return dashView(r1);
    if (r0 === 'people') return peopleView();
    if (r0 === 'sources') return sourcesView();
    return homeView();
  }
  const top = (inner) => `<a class="skip" href="#main">Skip to content</a><header class="top"><div class="top-in">${inner}</div></header>`;
  const homeTop = () => top(`<a class="brand" href="#/">${mark()}Run Scenario</a><span class="spacer"></span>${S.me.owner ? `<a class="icon-btn" href="#/people" title="People" aria-label="People">${I('users-three', 20)}</a>` : ''}<a class="icon-btn" href="#/sources" title="Data sources and account" aria-label="Data sources and account">${I('gear-six', 20)}</a>`);
  const backTop = (extra = '') => top(`<a class="back" href="#/">${I('arrow-left', 18)}Scenarios</a><span class="spacer"></span>${extra}`);

  // ---- accounts ------------------------------------------------------------------------
  function authShell(title, lede, body, alt) {
    app.innerHTML = `<main id="main" class="auth fade-in"><div class="auth-mark">${I('chart-line-up', 22)}</div><h1>${title}</h1><p class="lede">${lede}</p>${body}${alt ? `<p class="alt">${alt}</p>` : ''}</main>`;
  }
  const field = (name, label, type = 'text', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" ${extra}><div class="err" id="e-${name}"></div></div>`;
  function formErrors(form, errs) {
    form.querySelectorAll('.err').forEach((e) => (e.textContent = ''));
    form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
    let first = null;
    for (const [k, msg] of Object.entries(errs)) {
      const el = form.querySelector(`[name="${k}"]`), e = form.querySelector(`#e-${k}`);
      if (el) { el.setAttribute('aria-invalid', 'true'); first = first || el; }
      if (e) e.textContent = msg;
    }
    if (first) first.focus();
    return Object.keys(errs).length > 0;
  }
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }

  function loginView() {
    authShell('Sign in', 'Test market claims against data, every day.', `<form id="login" class="stack" novalidate>
      ${field('email', 'Email', 'email', 'autocomplete="username" inputmode="email" required')}
      ${field('password', 'Password', 'password', 'autocomplete="current-password" required')}
      <div id="login-note"></div>
      <button class="btn block">Sign in</button>
      <button type="button" class="link" data-act="go" data-v="#/forgot">Forgot your password?</button></form>`,
    `New here? <a href="#/signup">Create an account</a>`);
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, email = f.email.value.trim(), password = f.password.value;
      if (formErrors(f, { ...(!validEmail(email) ? { email: 'Enter the email you signed up with.' } : {}), ...(!password ? { password: 'Enter your password.' } : {}) })) return;
      const btn = f.querySelector('.btn'); busy(btn, true, 'Signing in');
      try { await api('/api/login', { method: 'POST', body: { email, password }, anon: true }); await boot(); }
      catch (err) { busy(btn, false, 'Sign in'); $('#login-note').innerHTML = `<div class="notice bad">${esc(err.message)}${/link we emailed/.test(err.message) ? ` <button type="button" class="link" data-act="resend" data-v="${esc(email)}">Send the link again</button>` : ''}</div>`; }
    };
  }
  function signupView() {
    authShell('Create your account', 'We email you a link to confirm your address and choose a password.', `<form id="signup" class="stack" novalidate>
      <div class="row2">${field('firstName', 'First name', 'text', 'autocomplete="given-name" required')}${field('lastName', 'Last name', 'text', 'autocomplete="family-name" required')}</div>
      ${field('email', 'Email', 'email', 'autocomplete="email" inputmode="email" required')}
      <div class="field"><label for="f-phone">Phone <span class="muted">(optional)</span></label><input id="f-phone" name="phone" type="tel" autocomplete="tel"><div class="err" id="e-phone"></div></div>
      <button class="btn block">Create account</button></form>`,
    `Already have one? <a href="#/">Sign in</a>`);
    $('#signup').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, b = { firstName: f.firstName.value.trim(), lastName: f.lastName.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim() };
      if (formErrors(f, { ...(!b.firstName ? { firstName: 'Add your first name.' } : {}), ...(!b.lastName ? { lastName: 'Add your last name.' } : {}), ...(!validEmail(b.email) ? { email: 'Enter a valid email address.' } : {}) })) return;
      const btn = f.querySelector('.btn'); busy(btn, true, 'Creating');
      try {
        const r = await api('/api/signup', { method: 'POST', body: b, anon: true });
        authShell('Check your inbox', esc(r.message), `<div class="notice">${I('check', 16)} Sent to <b>${esc(b.email)}</b>. Open the link on this device to set your password.</div>`, `Wrong address? <a href="#/signup">Start again</a>`);
      } catch (err) { busy(btn, false, 'Create account'); formErrors(f, /email/i.test(err.message) ? { email: err.message } : /phone/i.test(err.message) ? { phone: err.message } : { firstName: err.message }); }
    };
  }
  function forgotView() {
    authShell('Reset your password', 'Enter your email and we send a link to choose a new one.', `<form id="forgot" class="stack" novalidate>${field('email', 'Email', 'email', 'autocomplete="email" inputmode="email" required')}<button class="btn block">Send the link</button></form>`, `<a href="#/">Back to sign in</a>`);
    $('#forgot').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, email = f.email.value.trim();
      if (formErrors(f, !validEmail(email) ? { email: 'Enter a valid email address.' } : {})) return;
      try { const r = await api('/api/forgot', { method: 'POST', body: { email }, anon: true }); authShell('Check your inbox', esc(r.message), '', `<a href="#/">Back to sign in</a>`); } catch (err) { formErrors(f, { email: err.message }); }
    };
  }
  async function resetView(token) {
    let info = { valid: false };
    try { info = await api(`/api/reset?token=${encodeURIComponent(token || '')}`, { anon: true }); } catch {}
    if (!info.valid) return authShell('This link has expired', 'Links work once, for 24 hours. Ask for a fresh one.', `<a class="btn block" href="#/forgot">Send a new link</a>`, `<a href="#/">Back to sign in</a>`);
    authShell('Choose a password', `For <b>${esc(info.email)}</b>. At least 8 characters.`, `<form id="reset" class="stack" novalidate>
      ${field('pw', 'New password', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${field('pw2', 'Type it again', 'password', 'autocomplete="new-password" required')}
      <button class="btn block">Save and sign in</button></form>`);
    $('#reset').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, pw = f.pw.value, pw2 = f.pw2.value;
      if (formErrors(f, { ...(pw.length < 8 ? { pw: 'Use at least 8 characters.' } : {}), ...(pw && pw2 !== pw ? { pw2: "The two passwords don't match." } : {}) })) return;
      try {
        await api('/api/reset', { method: 'POST', body: { token, password: pw }, anon: true });
        await api('/api/login', { method: 'POST', body: { email: info.email, password: pw }, anon: true }).catch(() => {});
        location.hash = '#/'; await boot(); toast('Password saved. You are signed in.');
      } catch (err) { formErrors(f, { pw: err.message }); }
    };
  }

  // ---- home ---------------------------------------------------------------------------------
  const IDEAS = [
    'The S&P 500 falls 20% before the end of 2026',
    'The AI trade cracks: semiconductors drop 30% from their high within 6 months',
    'Nvidia trails the S&P 500 over the next 6 months',
    'Bitcoin trades above $150,000 before mid-2027',
    'The Fed cuts rates at least twice by June 2027',
  ];
  const MOVES = [
    ['drawdown', 'falls from its 52-week high by', '%'], ['down', 'loses at least', '%'], ['up', 'gains at least', '%'],
    ['touchBelow', 'trades down to', '$'], ['touchAbove', 'trades up to', '$'], ['below', 'closes below, on the deadline,', '$'], ['above', 'closes above, on the deadline,', '$'],
    ['beat', 'beats', 'vs'], ['trail', 'trails', 'vs'],
  ];
  const inMonths = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };

  function homeView() {
    if (!S.mode) S.mode = S.me.claude ? 'describe' : 'build';
    app.innerHTML = `${homeTop()}<main id="main" class="wrap fade-in">
      <div class="intro"><h1>What do you think happens next?</h1><p>State a claim. The desk tests it against market data, then re-checks it every day.</p></div>
      <div class="composer">
        ${S.me.claude ? `<div class="tabs" role="tablist"><button role="tab" aria-selected="${S.mode === 'describe'}" data-act="mode" data-v="describe">${I('sparkle', 15)}Describe it</button><button role="tab" aria-selected="${S.mode === 'build'}" data-act="mode" data-v="build">${I('target', 15)}Build it</button></div>` : ''}
        <div id="composer-body">${S.mode === 'describe' ? describeForm() : buildForm()}</div>
      </div>
      <div id="list">${listSkeleton()}</div>
      <p class="foot">Research, not financial advice. Probabilities are estimates and can be wrong.</p>
    </main>`;
    wireComposer();
    loadList();
  }
  const describeForm = () => `<form id="describe" class="stack" novalidate>
      <div class="field"><label for="f-claim">Your claim</label><textarea id="f-claim" name="claim" rows="2" maxlength="600" placeholder="The market crashes before the end of 2026"></textarea><div class="err" id="e-claim"></div></div>
      <div class="field"><label for="f-facts">Your reasons <span class="muted">(optional, each one gets fact-checked)</span></label><textarea id="f-facts" name="facts" rows="3" maxlength="3000" placeholder="Unemployment is rising. Valuations are the highest since 2000."></textarea></div>
      <button class="btn block">Run the desk</button>
      <div class="ideas">${IDEAS.map((x) => `<button type="button" class="idea" data-act="idea" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div></form>`;
  const buildForm = () => `<form id="build" class="stack" novalidate>
      <div class="row2"><div class="field"><label for="f-symbol">Ticker</label><input id="f-symbol" name="symbol" autocapitalize="characters" autocomplete="off" placeholder="SPY" value="SPY"><div class="err" id="e-symbol"></div></div>
      <div class="field"><label for="f-date">By</label><input id="f-date" name="date" type="date" value="${inMonths(6)}" min="${inMonths(0)}"><div class="err" id="e-date"></div></div></div>
      <div class="field"><label for="f-move">What happens</label><select id="f-move" name="move">${MOVES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
      <div class="field" id="value-field"><label for="f-value" id="value-label">Percent</label><input id="f-value" name="value" inputmode="decimal" value="20"><div class="err" id="e-value"></div></div>
      <div class="field" id="vs-field" hidden><label for="f-vs">Compared with</label><input id="f-vs" name="vs" autocapitalize="characters" placeholder="SPY" value="SPY"><div class="err" id="e-vs"></div></div>
      <p class="fine" style="margin-top:-6px">Tickers like SPY, NVDA, ^GSPC or BTC-USD.</p>
      <p class="preview" id="preview"></p>
      <button class="btn block">Run the desk</button>
      ${S.me.claude ? '' : '<p class="fine">The builder runs the data desk: prices, options, macro, the crowd and Hugging Face models. Ask the owner if you want the Claude analysts too.</p>'}</form>`;

  function wireComposer() {
    const d = $('#describe'), b = $('#build');
    if (d) d.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, claim = f.claim.value.trim();
      if (formErrors(f, claim.length < 6 ? { claim: 'Say the claim in a sentence.' } : {})) return;
      const btn = f.querySelector('.btn'); busy(btn, true, 'Starting');
      try { const r = await api('/api/scenarios', { method: 'POST', body: { claim, facts: f.facts.value.trim() } }); location.hash = `#/s/${r.id}`; } catch (err) { busy(btn, false, 'Run the desk'); formErrors(f, { claim: err.message }); }
    };
    if (b) {
      const upd = () => {
        const mv = MOVES.find((m) => m[0] === b.move.value);
        $('#vs-field').hidden = mv[2] !== 'vs'; $('#value-field').hidden = mv[2] === 'vs';
        $('#value-label').textContent = mv[2] === '%' ? 'Percent' : 'Price';
        const sym = b.symbol.value.trim().toUpperCase() || 'SPY', v = b.value.value.trim();
        const what = mv[2] === 'vs' ? `${mv[1]} <b>${esc(b.vs.value.trim().toUpperCase() || '…')}</b>` : `${mv[1]} <b>${mv[2] === '%' ? `${esc(v)}%` : `$${esc(v)}`}</b>`;
        $('#preview').innerHTML = `<b>${esc(sym)}</b> ${what} by <b>${b.date.value ? esc(fmtDay(b.date.value)) : '…'}</b>.`;
      };
      b.addEventListener('input', upd); b.addEventListener('change', upd); upd();
      b.onsubmit = async (e) => {
        e.preventDefault();
        const build = { symbol: b.symbol.value.trim(), move: b.move.value, value: b.value.value.trim(), vs: b.vs.value.trim(), date: b.date.value };
        const btn = b.querySelector('.btn'); busy(btn, true, 'Starting');
        try { const r = await api('/api/scenarios', { method: 'POST', body: { build } }); location.hash = `#/s/${r.id}`; }
        catch (err) { busy(btn, false, 'Run the desk'); formErrors(b, /ticker/i.test(err.message) ? { symbol: err.message } : /deadline/i.test(err.message) ? { date: err.message } : /compare/i.test(err.message) ? { vs: err.message } : { value: err.message }); }
      };
    }
  }
  const listSkeleton = () => `<div class="list-head"><h2>Your scenarios</h2></div>${[1, 2, 3].map(() => '<div class="srow"><div><div class="sk sk-line" style="width:70%"></div><div class="sk sk-line" style="width:40%;height:10px"></div></div><div class="sk" style="width:48px;height:24px"></div></div>').join('')}`;
  async function loadList() {
    const el = $('#list'); if (!el) return;
    try { S.list = (await api('/api/scenarios')).scenarios; } catch (e) { el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    if (!$('#list')) return;
    if (!S.list.length) { el.innerHTML = '<div class="empty"><b>No scenarios yet</b>Start with a claim above, or tap one of the ideas.</div>'; return; }
    const themes = new Map();
    for (const s of S.list) { if (!themes.has(s.themeId)) themes.set(s.themeId, []); themes.get(s.themeId).push(s); }
    el.innerHTML = `<div class="list-head"><h2>Your scenarios</h2><span class="fine">${S.list.length}</span></div>${[...themes.values()].map((g) => (g.length > 1 ? `<div class="theme-group">${g.map(rowHtml).join('')}</div>` : rowHtml(g[0]))).join('')}`;
  }
  function rowHtml(s) {
    const waiting = ['running', 'queued', 'new'].includes(s.status) && s.probability === null;
    const status = s.status === 'running' ? `<span style="display:inline-flex;gap:6px;align-items:center"><span class="pulse"></span>Desk is working</span>` : s.status === 'queued' ? 'Queued' : s.status === 'error' ? '<span style="color:var(--no)">Needs a retry</span>' : s.status === 'resolved' ? 'Settled' : esc(s.verdict || '');
    return `<a class="srow" href="#/s/${s.id}"><div><div class="srow-title">${esc(s.title)}</div><div class="srow-meta">${status}${s.horizonDate ? `<span>${daysTo(s.horizonDate) > 0 ? `${daysTo(s.horizonDate)} days left` : 'Deadline passed'}</span>` : ''}</div></div>
      <div class="srow-side">${waiting ? '<div class="sk" style="width:48px;height:24px"></div>' : `<div class="srow-p">${s.probability === null ? '-' : `${Math.round(s.probability)}%`}</div>${delta(s.change)}`}</div></a>`;
  }

  // ---- scenario ---------------------------------------------------------------------------------
  const ICONS = { quant: 'dice-five', technical: 'chart-line-up', macro: 'bank', sentiment: 'chats-circle', fundamentals: 'receipt', research: 'newspaper', options: 'chart-scatter', markets: 'target', social: 'broadcast' };
  const SEATS = [['Strategist', 'compass'], ['Data', 'database'], ['Quant', 'dice-five'], ['Technicals', 'chart-line-up'], ['Macro', 'bank'], ['Sentiment', 'chats-circle'], ['Options', 'chart-scatter'], ['Research', 'newspaper'], ['Social', 'broadcast'], ['Judge', 'scales']];

  async function dashView(id, { keep } = {}) {
    if (!keep || !S.cur || S.cur.id !== id) app.innerHTML = `${backTop()}<main id="main" class="wrap"><div class="hero"><div class="sk sk-line" style="width:30%"></div><div class="sk sk-line" style="width:85%;height:22px"></div><div class="sk sk-big"></div></div><div class="sk sk-chart"></div></main>`;
    let sc;
    try { sc = await api(`/api/scenarios/${id}`); } catch (e) { app.querySelector('main').innerHTML = `<div class="empty"><b>Can't open this scenario</b>${esc(e.message)}</div>`; return; }
    if (route()[1] !== id) return;
    S.cur = sc;
    if (sc.progress) S.live[id] = sc.progress.steps;
    const y = window.scrollY;
    app.innerHTML = dashHtml(sc);
    drawChart();
    if (keep) window.scrollTo(0, y);
    if (sc.latest) api(`/api/scenarios/${id}/seen`, { method: 'POST' }).catch(() => {});
  }

  function dashHtml(sc) {
    const run = sc.latest, th = sc.thesis;
    const working = ['running', 'queued', 'new'].includes(sc.status) || sc.queued;
    const p = run ? run.probability : null;
    const prevH = sc.history.length > 1 ? sc.history[sc.history.length - 2] : null;
    const kinds = { market: 'Market', stock: 'Single stock', compare: 'Comparison', macro: 'Macro', crypto: 'Crypto', event: 'Event' };
    return `${backTop(`<button class="icon-btn" data-act="share" title="Copy link" aria-label="Copy link">${I('share-network', 19)}</button>`)}
    <main id="main" class="wrap">
      <section class="hero fade-in">
        <div class="kicker">${th ? `<span>${esc(kinds[th.kind] || 'Scenario')}</span><span>by ${esc(fmtDay(th.horizonDate))}</span>` : '<span>New scenario</span>'}</div>
        <h1>${esc(th ? th.title : sc.claim)}</h1>
        <p class="prop">${esc(th ? th.proposition : `"${sc.claim}"`)}</p>
        ${run ? `<div class="reading"><div class="big">${p}<small>%</small></div>
          <div class="reading-side"><span class="tag ${tone(p)}">${I(p >= 56 ? 'trend-up' : p <= 44 ? 'trend-down' : 'scales', 15)}${esc(run.verdict)}</span>
            <span class="reading-meta">${prevH ? `${delta(Math.round((p - prevH.p) * 10) / 10)} since ${esc(fmtDay(prevH.date))}` : 'First reading'}, ${esc(run.judge.confidence)} confidence</span></div></div>
          <p class="call">${esc(run.call)}</p>
          ${!run.claude ? '<p class="fine" style="margin-top:8px">Data desk reading. The Claude analysts are off for this account.</p>' : ''}` : ''}
        ${sc.resolved ? `<div class="notice settled ${sc.resolved.outcome === 'no' ? 'bad' : ''}">Settled ${esc(sc.resolved.outcome.toUpperCase())}. ${esc(sc.resolved.why)}</div>` : ''}
      </section>
      ${working ? liveHtml(sc, S.live[sc.id] || []) : ''}
      ${sc.status === 'error' ? `<div class="notice bad" style="margin-top:20px">The desk stopped: ${esc(sc.error || 'unknown error')} <button class="btn small quiet" data-act="run" style="margin-left:6px">Try again</button></div>` : ''}
      ${run || sc.backfill.length ? chartHtml(sc) : ''}
      ${changesHtml(sc)}
      ${run ? deskHtml(run) : ''}
      ${run ? factsHtml(run) : ''}
      ${run ? casesHtml(run) : ''}
      ${run && run.judge.watch.length ? `<section class="block"><h2>What would change the call</h2><div class="panel flat">${run.judge.watch.map((w) => `<div class="watch"><div class="watch-top"><b>${esc(w.signal)}</b><span class="thr">${esc(w.threshold)}</span></div><p>${esc(w.why)}</p></div>`).join('')}</div></section>` : ''}
      ${catalystsHtml(run)}
      ${S.me.claude ? askHtml(sc) : ''}
      ${th ? measuredHtml(sc, th) : ''}
      ${sc.theme.length ? `<section class="block"><h2>Same theme</h2>${sc.theme.map(rowHtml).join('')}</section>` : ''}
      ${historyHtml(sc)}
      ${settingsHtml(sc)}
      ${run ? `<p class="foot">Read on ${esc(fmtDay(run.date))} in ${Math.round(run.durationMs / 1000)}s. Prices from ${esc((run.sources || []).join(', ') || 'n/a')}. Sentiment by ${esc(run.models.sentiment || 'n/a')}${run.models.forecast ? `, forecast by ${esc(run.models.forecast)}` : ''}${run.models.judge ? `, judged by Claude ${esc(run.models.judge)}` : ''}.${run.errors && run.errors.length ? ` ${run.errors.length} source${run.errors.length > 1 ? 's were' : ' was'} unavailable.` : ''}<br>Research, not financial advice.</p>` : ''}
    </main>`;
  }
  function liveHtml(sc, steps) {
    const last = steps.length ? steps[steps.length - 1].who : null;
    const seen = new Set(steps.map((s) => s.who));
    const seats = SEATS.filter(([w]) => S.me.claude || !['Strategist', 'Research', 'Social', 'Judge'].includes(w) || seen.has(w));
    return `<section class="live fade-in" aria-live="polite"><div class="live-head"><span class="pulse"></span>${sc.status === 'queued' || sc.queued ? 'Queued. The desk works one scenario at a time.' : 'The desk is working'}</div>
      <div class="seats">${seats.map(([w, ic]) => `<div class="seat ${w === last ? 'now' : seen.has(w) ? 'done' : ''}" title="${w}">${I(ic, 20)}<small>${w}</small></div>`).join('')}</div>
      <ol class="steps">${steps.slice(-5).reverse().map((s) => `<li><b>${esc(s.who)}</b>${esc(s.text)}</li>`).join('') || '<li>Starting</li>'}</ol>
      <p class="fine" style="margin-top:10px">A few minutes. You can leave; it keeps going.</p></section>`;
  }
  function chartHtml(sc) {
    return `<section class="block"><div class="chart-head"><h2>Is it coming true?</h2><div class="seg" role="group" aria-label="Time range">${[['1w', '1W'], ['1m', '1M'], ['all', 'All']].map(([v, t]) => `<button aria-pressed="${S.range === v}" data-act="range" data-v="${v}">${t}</button>`).join('')}</div></div>
      <div id="pchart" class="pchart-wrap"></div>
      <div class="legend"><span><i class="key"></i>Desk's call</span>${sc.backfill.length ? '<span><i class="key dash"></i>Price-only replay</span>' : ''}</div></section>`;
  }
  function changesHtml(sc) {
    const sv = sc.sinceVisit, run = sc.latest;
    const list = sv ? sv.changes : run ? run.changes || [] : [];
    const said = run && run.judge.changed && !/^first run/i.test(run.judge.changed) ? run.judge.changed : '';
    if (!list.length && !said) return '';
    return `<section class="block"><h2>${sv ? `Since you last looked (${esc(fmtDay(sv.from))}, ${sv.fromP}%)` : 'What changed today'}</h2>
      ${said ? `<p class="summary" style="margin:0 0 12px">${esc(said)}</p>` : ''}
      <div class="changes">${list.map((c) => `<div class="chg-item ${c.up === true ? 'up' : c.up === false ? 'down' : ''}">${I(c.up === true ? 'trend-up' : c.up === false ? 'trend-down' : 'arrow-up-right', 15)}<span>${c.url && safeUrl(c.url) ? `<a href="${safeUrl(c.url)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text)}</span></div>`).join('')}</div></section>`;
  }
  function lean(a) {
    if (!a.confidence) return '<div class="lean"><span>Context for the judge</span></div>';
    const pos = (a.stance + 1) * 50;
    return `<div class="lean" title="Lean ${a.stance.toFixed(2)}, confidence ${a.confidence.toFixed(2)}"><span>Against</span><span class="lean-track"><span class="lean-dot ${a.stance > 0.1 ? 'yes' : a.stance < -0.1 ? 'no' : ''}" style="left:${pos.toFixed(1)}%;opacity:${(0.4 + a.confidence).toFixed(2)}"></span></span><span>For</span></div>`;
  }
  function deskHtml(run) {
    return `<section class="block"><h2>The desk</h2><div class="desk">${run.analysts.map((a) => {
      const open = !!S.open[a.id];
      return `<div class="an ${open ? 'open' : ''}"><button class="an-head" data-act="toggle" data-v="${esc(a.id)}" aria-expanded="${open}">
        <span class="an-icon">${I(ICONS[a.id] || 'sparkle', 19)}</span>
        <span><span class="an-name">${esc(a.name)}${a.probability !== undefined ? `<span class="an-p">${(a.probability * 100).toFixed(0)}%</span>` : ''}</span><span class="an-line" style="display:block">${esc(a.headline)}</span>${lean(a)}</span>
        <span class="chev">${I('plus', 16)}</span></button>
        ${open ? `<div class="an-body fade-in">${analystBody(a)}</div>` : ''}</div>`;
    }).join('')}</div></section>`;
  }
  const fmtN = (x) => (x === null || x === undefined ? '-' : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
  const pctS = (x) => (x === null || x === undefined ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
  function analystBody(a) {
    let extra = '';
    if (a.sheets) extra += `<div class="tiles">${a.sheets.map((s) => `<div class="tile"><b>${esc(s.symbol)}</b><span class="num">${fmtN(s.last)}</span>${Chart.spark(s.spark, { w: 108, h: 28 })}<small>${pctS(s.fromHigh)} from high</small></div>`).join('')}</div>`;
    if (a.series) extra += `<div class="tiles">${a.series.map((s) => `<div class="tile"><b>${esc(s.id)}</b><span class="num">${fmtN(s.last)}</span>${Chart.spark(s.spark, { w: 108, h: 28 })}<small>${esc(s.name)}</small></div>`).join('')}</div>`;
    if (a.forecast) extra += `<div class="tiles"><div class="tile"><b>Chronos-Bolt median path</b>${Chart.spark(a.forecast.median, { w: 200, h: 36, fill: false })}<small>${esc(a.forecast.model)}, ${a.forecast.horizon} trading days</small></div></div>`;
    if (a.quotes && a.quotes.length) extra += `<div class="quotes">${a.quotes.map((q) => `<a class="quote ${q.s > 0 ? 'up' : q.s < 0 ? 'down' : ''}" ${safeUrl(q.url) ? `href="${safeUrl(q.url)}" target="_blank" rel="noopener"` : ''}>${esc(q.text)}<small>${esc(q.where || q.group || '')}</small></a>`).join('')}</div>`;
    return `<ul class="pts">${a.points.map((p) => `<li class="${p.for === true ? 'for' : p.for === false ? 'against' : ''}">${I(p.for === true ? 'check' : p.for === false ? 'x' : 'arrow-up-right', 13)}<span>${esc(p.text)}${p.source || p.url ? ` <span class="src">${safeUrl(p.url) ? `<a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.source || host(p.url))}</a>` : esc(p.source)}${p.date ? `, ${esc(p.date)}` : ''}</span>` : ''}</span></li>`).join('')}</ul>${extra}`;
  }
  function factsHtml(run) {
    const r = run.analysts.find((a) => a.id === 'research');
    const fc = r ? r.factChecks || [] : [];
    const j = run.judge;
    if (!fc.length && !j.corrections.length && !j.supports.length) return '';
    const label = { true: 'True', false: 'False', partly: 'Partly', unverified: 'Unverified' };
    return `<section class="block"><h2>Your facts, checked</h2><div class="panel flat">
      ${fc.map((f) => `<div class="fact"><span class="verdict-chip ${f.verdict}">${label[f.verdict]}</span><div><b>${esc(f.claim)}</b><p>${esc(f.detail)}${safeUrl(f.url) ? ` <a href="${safeUrl(f.url)}" target="_blank" rel="noopener">${esc(f.source || host(f.url))}</a>` : ''}</p></div></div>`).join('')}
      ${j.corrections.length ? `<p class="sub" style="color:var(--no)">Where the data disagrees with you</p><ul class="plain">${j.corrections.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${j.supports.length ? `<p class="sub" style="color:var(--accent)">Where the data backs you</p><ul class="plain">${j.supports.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></section>`;
  }
  function casesHtml(run) {
    const j = run.judge, adv = run.advocates;
    if (!j.bull.length && !j.bear.length) return '';
    return `<section class="block"><h2>Both sides</h2><div class="cases">
      <div class="case yes"><h3>${I('trend-up', 16)}Case for yes</h3><ul class="plain">${j.bull.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${adv ? `<p class="weak">Weak spot: ${esc(adv.yes.weakest)}</p>` : ''}</div>
      <div class="case no"><h3>${I('trend-down', 16)}Case for no</h3><ul class="plain">${j.bear.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${adv ? `<p class="weak">Weak spot: ${esc(adv.no.weakest)}</p>` : ''}</div></div>
      ${j.summary ? `<p class="summary">${esc(j.summary)}</p>` : ''}</section>`;
  }
  function catalystsHtml(run) {
    const r = run && run.analysts.find((a) => a.id === 'research');
    const c = r ? (r.catalysts || []).filter((x) => x.event) : [];
    if (!c.length) return '';
    return `<section class="block"><h2>Coming up</h2><div class="cats">${c.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((x) => `<div class="cat"><div class="cat-d">${esc(x.date ? fmtDay(x.date).replace(/, \d{4}$/, '') : 'TBD')}</div><div><b>${esc(x.event)}</b><p>${esc(x.why)}</p></div></div>`).join('')}</div></section>`;
  }
  function askHtml(sc) {
    const qs = (sc.questions || []).slice().reverse();
    return `<section class="block"><h2>Ask the desk</h2>
      <form id="ask" class="ask-row"><label class="sr" for="f-q">Question</label><input id="f-q" name="q" maxlength="600" placeholder="What happened to chip stocks in 2000?" autocomplete="off"><button class="btn small">Ask</button></form>
      ${qs.map((q) => `<div class="qa"><div class="q">${esc(q.q)}</div>${q.status === 'thinking' ? `<div class="a" data-qid="${esc(q.id)}"><span class="sk" style="display:inline-block;width:12px;height:12px;vertical-align:-1px;border-radius:50%"></span> <span class="qtext">${esc(S.live[`q:${q.id}`] || 'Researching')}</span></div>` : `<div class="a">${esc(q.answer).replace(/\n/g, '<br>')}</div>${(q.sources || []).length ? `<div class="srcs">${q.sources.map((s) => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.title || host(s.url))}</a>`).join('')}</div>` : ''}${q.track ? `<button class="btn small quiet track-btn" data-act="track" data-v="${esc(q.track)}">${I('plus', 14)}Track: ${esc(q.track)}</button>` : ''}`}</div>`).join('')}
      ${sc.thesis && sc.thesis.followUps.length ? `<p class="sub">Related claims to track</p><div class="follow">${sc.thesis.followUps.map((f) => `<button class="idea" style="max-width:none" data-act="track" data-v="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : ''}</section>`;
  }
  function measuredHtml(sc, th) {
    return `<section class="block"><h2>How it's measured</h2><dl class="dl">
      <dt>Resolves</dt><dd>${esc(th.resolution)}</dd>
      <dt>Deadline</dt><dd>${esc(fmtDay(th.horizonDate))}, ${daysTo(th.horizonDate)} days</dd>
      <dt>Watching</dt><dd>${th.instruments.map((i) => `<span class="chip" title="${esc(i.why)}">${esc(i.symbol)}</span>`).join('')}${th.macro.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</dd>
      ${th.baseRate ? `<dt>Base rate</dt><dd>${(th.baseRate.p * 100).toFixed(0)}%. ${esc(th.baseRate.why)}</dd>` : ''}
      ${th.assumptions.length ? `<dt>Assumed</dt><dd>${th.assumptions.map(esc).join(' ')}</dd>` : ''}
      <dt>You said</dt><dd>"${esc(sc.claim)}"</dd></dl></section>`;
  }
  function historyHtml(sc) {
    if (sc.runs.length < 2) return '';
    const rows = sc.runs.slice().reverse().slice(0, 30);
    return `<section class="block"><h2>Every reading</h2><table class="hist"><thead><tr><th>Date</th><th class="r">Probability</th><th class="r">Change</th></tr></thead><tbody>${rows.map((r, i) => { const prev = rows[i + 1]; return `<tr><td>${esc(fmtDay(r.date))}</td><td class="r num">${r.p}%</td><td class="r">${prev ? delta(Math.round((r.p - prev.p) * 10) / 10) : ''}</td></tr>`; }).join('')}</tbody></table></section>`;
  }
  function settingsHtml(sc) {
    const sw = (act, on, label) => `<label class="toggle"><span>${label}</span><span class="switch"><input type="checkbox" data-act="${act}" ${on ? 'checked' : ''}><span></span></span></label>`;
    return `<section class="block"><h2>Settings</h2><div class="panel flat">
      ${sw('schedule', sc.schedule === 'daily', 'Re-run every day after the US close')}
      ${sw('alert', sc.alerts && sc.alerts.email, 'Email me when it moves a lot')}
      <label class="toggle"><span>Counts as a lot</span><select data-act="move" style="width:auto">${[3, 5, 10, 15].map((n) => `<option value="${n}" ${sc.alerts && sc.alerts.move === n ? 'selected' : ''}>${n} points</option>`).join('')}</select></label>
      <div class="btns"><button class="btn small" data-act="run" ${['running', 'queued'].includes(sc.status) ? 'disabled' : ''}>${I('arrow-clockwise', 15)}Run now</button><button class="btn small danger" data-act="delete">${I('trash', 15)}Delete</button></div></div></section>`;
  }
  function drawChart() {
    const el = $('#pchart'); const sc = S.cur;
    if (!el || !sc) return;
    const cut = S.range === '1w' ? 7 : S.range === '1m' ? 31 : 99999;
    const since = new Date(Date.now() - cut * 86400000).toISOString().slice(0, 10);
    const keep = (pts) => pts.filter((p) => p.date >= since);
    const series = [];
    if (sc.backfill.length) series.push({ points: keep(sc.backfill), color: 'var(--series-2)', dashed: true, label: 'Price-only replay' });
    series.push({ points: keep(sc.history.map((h) => ({ date: h.date, p: h.p }))), color: 'var(--series-1)', label: "Desk's call" });
    Chart.probability(el, series);
  }
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(drawChart, 150); });

  // ---- people (owner) ---------------------------------------------------------------------------
  async function peopleView() {
    app.innerHTML = `${backTop()}<main id="main" class="wrap fade-in"><div class="intro"><h1>People</h1><p>Everyone can use the data desk. The Claude analysts run on your Claude plan, so you choose who gets them.</p></div><div id="people" class="panel flat" style="margin-top:18px">${[1, 2, 3].map(() => '<div class="sk sk-line"></div>').join('')}</div></main>`;
    try {
      const { people } = await api('/api/people');
      $('#people').innerHTML = people.map((u) => `<div class="person"><div><b>${esc(u.name || u.email)}</b>${u.primary ? ' <span class="chip">owner</span>' : ''}<small>${esc(u.email)}, ${u.status === 'unverified' ? 'has not confirmed the email yet' : u.status}${u.scenarios ? `, ${u.scenarios} scenario${u.scenarios > 1 ? 's' : ''}` : ''}</small></div>
        ${u.primary || u.role === 'admin' ? '<span class="fine">Claude on</span>' : `<label class="switch" title="Claude analysts"><input type="checkbox" data-act="claude" data-v="${esc(u.id)}" ${u.claude ? 'checked' : ''} aria-label="Claude analysts for ${esc(u.name)}"><span></span></label>`}</div>`).join('') || '<p class="muted">No one yet.</p>';
    } catch (e) { $('#people').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  // ---- sources and account --------------------------------------------------------------------------
  async function sourcesView() {
    app.innerHTML = `${backTop()}<main id="main" class="wrap fade-in"><div class="intro"><h1>Data sources</h1><p>Checked from the server. All free; nothing here costs money.</p></div>
      <div id="src" class="panel flat" style="margin-top:18px">${[1, 2, 3, 4, 5].map(() => '<div class="sk sk-line"></div>').join('')}<p class="fine">Checking each source, up to a minute.</p></div>
      <section class="block"><h2>Account</h2><div class="panel flat"><p>${esc(S.me.name || '')} <span class="muted">${esc(S.me.email)}</span></p><p class="fine" style="margin-top:6px">${S.me.claude ? 'Claude analysts are on for you.' : 'You have the data desk. The owner can turn on the Claude analysts for you.'}</p><div class="btns"><button class="btn small quiet" data-act="logout">${I('sign-out', 15)}Sign out</button></div></div></section></main>`;
    try {
      const s = await api('/api/status');
      $('#src').innerHTML = `${s.sources.map((x) => `<div class="src-row"><span class="dot ${x.ok ? '' : 'bad'}"></span><b>${esc(x.name)}</b><span class="muted">${esc(x.detail)}</span></div>`).join('')}
        <p class="fine" style="margin-top:12px">Checked ${esc(ago(s.at))}. Models: ${s.models ? 'Chronos-Bolt and FinBERT from Hugging Face, on the server.' : 'Hugging Face models are not installed yet.'} Daily run at ${esc(s.daily)}. <button class="link" data-act="recheck">Check again</button></p>`;
    } catch (e) { $('#src').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  // ---- actions ---------------------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    if (act === 'go') location.hash = v;
    else if (act === 'mode') { S.mode = v; $('#composer-body').innerHTML = v === 'describe' ? describeForm() : buildForm(); document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v))); wireComposer(); }
    else if (act === 'idea') { const ta = $('#f-claim'); ta.value = v; ta.focus(); }
    else if (act === 'resend') { try { const r = await api('/api/forgot', { method: 'POST', body: { email: v }, anon: true }); toast(r.message); } catch (err) { toast(err.message, true); } }
    else if (act === 'logout') { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; location.hash = '#/'; render(); }
    else if (act === 'range') { S.range = v; document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); drawChart(); }
    else if (act === 'toggle') { S.open[v] = !S.open[v]; dashView(S.cur.id, { keep: true }); }
    else if (act === 'run') { try { await api(`/api/scenarios/${S.cur.id}/run`, { method: 'POST' }); S.live[S.cur.id] = []; dashView(S.cur.id, { keep: true }); } catch (err) { toast(err.message, true); } }
    else if (act === 'delete') { if (!confirm('Delete this scenario and its history?')) return; await api(`/api/scenarios/${S.cur.id}`, { method: 'DELETE' }); location.hash = '#/'; }
    else if (act === 'track') { try { const r = await api('/api/scenarios', { method: 'POST', body: { claim: v, parentId: S.cur.id } }); toast('Tracking it as a new scenario.'); location.hash = `#/s/${r.id}`; } catch (err) { toast(err.message, true); } }
    else if (act === 'share') { try { await navigator.clipboard.writeText(location.href); toast('Link copied. Only you can open it.'); } catch { toast("Couldn't copy the link.", true); } }
    else if (act === 'recheck') { $('#src').innerHTML = '<div class="sk sk-line"></div><div class="sk sk-line"></div>'; await api('/api/status?fresh=1').catch(() => {}); sourcesView(); }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.dataset.act === 'claude') {
      try { await api(`/api/people/${t.dataset.v}`, { method: 'POST', body: { claude: t.checked } }); toast(t.checked ? 'Claude analysts on.' : 'Claude analysts off.'); } catch (err) { t.checked = !t.checked; toast(err.message, true); }
      return;
    }
    if (!S.cur) return;
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
    try { await api(`/api/scenarios/${S.cur.id}/ask`, { method: 'POST', body: { q } }); dashView(S.cur.id, { keep: true }); } catch (err) { toast(err.message, true); }
  });

  // ---- live events ---------------------------------------------------------------------------------------
  let es = null;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    let pending = null;
    const refresh = () => { clearTimeout(pending); pending = setTimeout(() => { const [r0, r1] = route(); if (r0 === 's' && r1) dashView(r1, { keep: true }); else if (!r0) loadList(); }, 250); };
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      const [r0, r1] = route();
      if (ev.event === 'progress') {
        (S.live[ev.id] = S.live[ev.id] || []).push(ev.step);
        if (r0 === 's' && r1 === ev.id) { const box = $('.live'); if (box && S.cur) box.outerHTML = liveHtml(S.cur, S.live[ev.id]); else refresh(); }
      } else if (ev.event === 'scenario') {
        if (ev.done) { S.live[ev.id] = []; if (r0 === 's' && r1 === ev.id) toast('New reading in.'); }
        if ((r0 === 's' && r1 === ev.id) || !r0) refresh();
      } else if (ev.event === 'qstep') {
        S.live[`q:${ev.qid}`] = ev.text;
        const el = document.querySelector(`[data-qid="${ev.qid}"] .qtext`); if (el) el.textContent = ev.text;
      } else if (ev.event === 'question') { if (r0 === 's' && r1 === ev.id) refresh(); }
    };
    es.onerror = () => { es.close(); es = null; setTimeout(() => { if (S.me) connect(); }, 5000); };
  }

  boot();
})();
