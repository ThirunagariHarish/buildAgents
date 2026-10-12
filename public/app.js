// Run Scenario, the app. Tabs: Today, Scenarios, Build, Markets, You.
// Other routes: #/s/<id> (a scenario), #/people (owner), #/sources,
// #/signup, #/forgot, #/reset/<token>.
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
  const fmtShort = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const I = (n, s = 18, c = '') => window.Icon(n, s, c);
  const S = { me: null, list: null, cur: null, live: {}, range: 'all', open: {}, mode: null, filter: 'active', sort: 'updated', prefill: null };

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
  const pctS = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
  const fmtN = (x) => (x === null || x === undefined ? '-' : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
  /** A mic button that dictates into the field with id `target`. */
  const mic = (target, mode = 'text') => (window.Voice && Voice.supported ? `<button type="button" class="mic" data-act="mic" data-target="${target}" data-mode="${mode}" aria-label="Speak instead of typing" title="Speak">${I('microphone', 18)}</button>` : '');
  const mark = () => `<span class="brand-mark">${I('chart-line-up', 16)}</span>`;
  const DEPTHS = { quick: ['Quick', 'Data analysts only. Free, about a minute.'], standard: ['Standard', 'Plus Claude research, fact-checks and a judge.'], deep: ['Deep', 'Plus social pulse, bull and bear advocates and the strongest judge.'] };
  const FREQS = { twice: 'Twice a day (before the open and after the close)', daily: 'Every day after the US close', weekly: 'Once a week', off: 'Only when I tap Run' };

  // ---- routing --------------------------------------------------------------------------
  const route = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  const TABS = [['today', 'Today', 'sun-horizon'], ['scenarios', 'Scenarios', 'list-dashes'], ['build', 'Build', 'plus-circle'], ['discover', 'Discover', 'compass'], ['markets', 'Markets', 'globe-hemisphere-west']];
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  window.addEventListener('scroll', () => { const t = $('.top'); if (t) t.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });

  async function boot() {
    try { const s = await api('/api/session', { anon: true }); S.me = s.authed ? { ...s.user, allowed: s.allowed, claude: s.claude, owner: s.owner } : null; } catch { S.me = null; }
    if (S.me && S.me.allowed) connect();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  function render() {
    const [r0, r1] = route();
    if (r0 === 'reset') return resetView(r1);
    if (!S.me) return r0 === 'signup' ? signupView() : r0 === 'forgot' ? forgotView() : loginView();
    const views = { today: todayView, scenarios: scenariosView, build: buildView, discover: discoverView, markets: marketsView, you: youView, people: peopleView, sources: sourcesView };
    if (r0 === 's' && r1) return dashView(r1);
    return (views[r0] || todayView)();
  }
  function shell(tab, header, body) {
    app.innerHTML = `<a class="skip" href="#main">Skip to content</a>${header}<main id="main" class="wrap with-nav fade-in">${body}</main>
      <nav class="tabbar" aria-label="Main">${TABS.map(([id, label, ic]) => `<a href="#/${id}" class="tab${id === 'build' ? ' tab-build' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${I(ic, id === 'build' ? 26 : 22)}<span>${label}</span></a>`).join('')}</nav>`;
  }
  const top = (inner) => `<header class="top"><div class="top-in">${inner}</div></header>`;
  // You (track record, settings, people) lives behind the avatar in the top corner.
  const avatar = () => `<a class="avatar" href="#/you" aria-label="You: track record and settings" title="You">${esc(((S.me.firstName || S.me.email || '?')[0] || '?').toUpperCase())}</a>`;
  const titleTop = (title, extra = '') => top(`<a class="brand" href="#/today">${mark()}<span class="sr">Run Scenario</span></a><h1 class="top-title">${title}</h1><span class="spacer"></span>${extra}${avatar()}`);
  const backTop = (to, label, extra = '') => top(`<a class="back" href="${to}">${I('arrow-left', 18)}${label}</a><span class="spacer"></span>${extra}`);

  // ---- accounts ----------------------------------------------------------------------------
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
      try { await api('/api/login', { method: 'POST', body: { email, password }, anon: true }); if (/^#\/?(signup|forgot|reset)/.test(location.hash)) location.hash = '#/today'; await boot(); }
      catch (err) { busy(btn, false, 'Sign in'); $('#login-note').innerHTML = `<div class="notice bad">${esc(err.message)}${/link we emailed/.test(err.message) ? ` <button type="button" class="link" data-act="resend" data-v="${esc(email)}">Send the link again</button>` : ''}</div>`; }
    };
  }
  function signupView() {
    authShell('Create your account', 'We email you a link to confirm your address and choose a password.', `<form id="signup" class="stack" novalidate>
      <div class="row2">${field('firstName', 'First name', 'text', 'autocomplete="given-name" required')}${field('lastName', 'Last name', 'text', 'autocomplete="family-name" required')}</div>
      ${field('email', 'Email', 'email', 'autocomplete="email" inputmode="email" required')}
      <div class="field"><label for="f-phone">Phone <span class="muted">(optional)</span></label><input id="f-phone" name="phone" type="tel" autocomplete="tel"><div class="err" id="e-phone"></div></div>
      <button class="btn block">Create account</button></form>`,
    `Already have one? <a href="#/today">Sign in</a>`);
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
    authShell('Reset your password', 'Enter your email and we send a link to choose a new one.', `<form id="forgot" class="stack" novalidate>${field('email', 'Email', 'email', 'autocomplete="email" inputmode="email" required')}<button class="btn block">Send the link</button></form>`, `<a href="#/today">Back to sign in</a>`);
    $('#forgot').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, email = f.email.value.trim();
      if (formErrors(f, !validEmail(email) ? { email: 'Enter a valid email address.' } : {})) return;
      try { const r = await api('/api/forgot', { method: 'POST', body: { email }, anon: true }); authShell('Check your inbox', esc(r.message), '', `<a href="#/today">Back to sign in</a>`); } catch (err) { formErrors(f, { email: err.message }); }
    };
  }
  async function resetView(token) {
    let info = { valid: false };
    try { info = await api(`/api/reset?token=${encodeURIComponent(token || '')}`, { anon: true }); } catch {}
    if (!info.valid) return authShell('This link has expired', 'Links work once, for 24 hours. Ask for a fresh one.', `<a class="btn block" href="#/forgot">Send a new link</a>`, `<a href="#/today">Back to sign in</a>`);
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
        location.hash = '#/today'; await boot(); toast('Password saved. You are signed in.');
      } catch (err) { formErrors(f, { pw: err.message }); }
    };
  }

  // ---- Today ---------------------------------------------------------------------------------
  const skLines = (n) => Array.from({ length: n }, () => '<div class="sk sk-line"></div>').join('');
  async function todayView() {
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    shell('today', titleTop('Today'), `<div class="intro"><h1>${hello}${S.me.firstName ? `, ${esc(S.me.firstName)}` : ''}.</h1><p>${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</p></div><div id="today">${skLines(6)}</div>`);
    let t;
    try { t = await api('/api/today'); } catch (e) { $('#today').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    if (route()[0] !== 'today' && location.hash) return;
    if (!t.total) {
      $('#today').innerHTML = `<div class="hero-empty"><h2>Start with one claim</h2><p>Write what you think will happen in the market, or build one from a template. The desk tests it and re-checks it every day.</p><a class="btn" href="#/build">${I('plus', 16)}Build a scenario</a></div>`;
      return;
    }
    const unseen = t.movers.filter((m) => m.unseen);
    $('#today').innerHTML = `
      <div class="stats"><a class="stat" href="#/scenarios"><span class="num">${t.total}</span><small>scenarios</small></a><div class="stat"><span class="num">${t.working}</span><small>${t.working === 1 ? 'running now' : 'running now'}</small></div><div class="stat"><span class="num">${unseen.length}</span><small>new readings</small></div></div>
      ${t.movers.length ? `<section class="block"><h2>What moved</h2>${t.movers.map((m) => `<a class="mover" href="#/s/${m.id}"><span class="mover-t">${esc(m.title)}${m.unseen ? '<span class="new-dot" title="New since you looked"></span>' : ''}</span><span class="mover-p num">${m.from}% ${I('arrow-left', 12, 'flip')} ${m.p}%</span>${delta(m.change)}</a>`).join('')}</section>` : ''}
      ${t.evidence && t.evidence.length ? `<section class="block"><h2>New in your reading rooms</h2>${t.evidence.map((e) => `<a class="room-card" href="#/s/${e.id}/evidence"><div class="room-top"><b>${esc(e.title)}</b><span class="count">${e.unread}</span></div><div class="room-split"><span class="up">${e.for} support</span><span class="down">${e.against} against</span></div>${e.top.map((x) => `<div class="room-art ${x.stance}">${esc(x.title)}<small>${esc(x.source)}</small></div>`).join('')}</a>`).join('')}</section>` : ''}
      ${t.catalysts.length ? `<section class="block"><h2>Coming up</h2><div class="cats">${t.catalysts.map((c) => `<div class="cat"><div class="cat-d">${esc(fmtShort(c.date))}</div><div><b>${esc(c.event)}</b><p>${esc(c.why || '')}</p><p class="fine">${c.scenarios.map((x) => `<a href="#/s/${x.id}">${esc(x.title)}</a>`).join(', ')}</p></div></div>`).join('')}</div></section>` : ''}
      ${t.settled.length ? `<section class="block"><h2>Settled</h2>${t.settled.map((x) => `<a class="mover" href="#/s/${x.id}"><span class="mover-t">${esc(x.title)}</span><span class="tag ${x.outcome === 'yes' ? 'yes' : 'no'}">${x.outcome.toUpperCase()}</span></a>`).join('')}</section>` : ''}
      <p class="foot">Research, not financial advice.</p>`;
  }

  // ---- Scenarios -------------------------------------------------------------------------------
  async function scenariosView() {
    shell('scenarios', titleTop('Scenarios', `<a class="icon-btn" href="#/build" aria-label="New scenario">${I('plus', 20)}</a>`), `
      <div class="filters"><div class="chips" role="group" aria-label="Show">${[['active', 'Active'], ['settled', 'Settled'], ['archived', 'Archived'], ['all', 'All']].map(([v, t]) => `<button class="fchip" aria-pressed="${S.filter === v}" data-act="filter" data-v="${v}">${t}</button>`).join('')}</div>
      <label class="sort">${I('funnel-simple', 15)}<span class="sr">Sort</span><select data-act="sort">${[['updated', 'Recent'], ['move', 'Biggest move'], ['deadline', 'Deadline'], ['prob', 'Probability']].map(([v, t]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <div id="list">${[1, 2, 3].map(() => '<div class="srow"><div><div class="sk sk-line" style="width:70%"></div><div class="sk sk-line" style="width:40%;height:10px"></div></div><div class="sk" style="width:48px;height:24px"></div></div>').join('')}</div>`);
    try { S.list = (await api('/api/scenarios')).scenarios; } catch (e) { $('#list').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    drawList();
  }
  function drawList() {
    const el = $('#list'); if (!el || !S.list) return;
    let l = S.list.filter((s) => (S.filter === 'all' ? true : S.filter === 'archived' ? s.archived : S.filter === 'settled' ? s.status === 'resolved' && !s.archived : !s.archived && s.status !== 'resolved'));
    const by = { updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0), move: (a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0), deadline: (a, b) => String(a.horizonDate || '9').localeCompare(String(b.horizonDate || '9')), prob: (a, b) => (b.probability ?? -1) - (a.probability ?? -1) };
    l = l.sort(by[S.sort]);
    if (!l.length) { el.innerHTML = S.list.length ? '<div class="empty"><b>Nothing here</b>Try another filter.</div>' : `<div class="hero-empty"><h2>No scenarios yet</h2><p>Build your first one. It takes a sentence.</p><a class="btn" href="#/build">${I('plus', 16)}Build a scenario</a></div>`; return; }
    if (S.sort === 'updated') {
      const themes = new Map();
      for (const s of l) { if (!themes.has(s.themeId)) themes.set(s.themeId, []); themes.get(s.themeId).push(s); }
      el.innerHTML = [...themes.values()].map((g) => (g.length > 1 ? `<div class="theme-group">${g.map(rowHtml).join('')}</div>` : rowHtml(g[0]))).join('');
    } else el.innerHTML = l.map(rowHtml).join('');
  }
  function rowHtml(s) {
    const waiting = ['running', 'queued', 'new'].includes(s.status) && s.probability === null;
    const status = s.status === 'running' ? `<span class="inline"><span class="pulse"></span>Desk is working</span>` : s.status === 'queued' ? 'Queued' : s.status === 'error' ? '<span style="color:var(--no)">Needs a retry</span>' : s.status === 'resolved' ? 'Settled' : esc(s.verdict || '');
    return `<a class="srow" href="#/s/${s.id}"><div><div class="srow-title">${esc(s.title)}</div><div class="srow-meta">${status}${s.horizonDate && s.status !== 'resolved' ? `<span>${daysTo(s.horizonDate) > 0 ? `${daysTo(s.horizonDate)} days left` : 'Deadline passed'}</span>` : ''}${s.myCall !== null && s.myCall !== undefined ? `<span class="you-chip">You ${s.myCall}%</span>` : ''}${s.unread ? `<span class="new-badge">${s.unread} new</span>` : ''}${s.schedule === 'off' ? `<span class="inline">${I('pause', 12)}Manual</span>` : ''}</div></div>
      <div class="srow-side">${waiting ? '<div class="sk" style="width:48px;height:24px"></div>' : `<div class="srow-p">${s.probability === null ? '-' : `${Math.round(s.probability)}%`}</div>${delta(s.change)}`}</div></a>`;
  }

  // ---- Build ---------------------------------------------------------------------------------------
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
  const endOf = (y) => `${y}-12-31`;
  const yr = new Date().getFullYear();
  const TEMPLATES = [
    { group: 'Market', title: 'Bear market', sub: 'S&P 500 falls 20% from its high', build: { symbol: 'SPY', move: 'drawdown', value: 20, date: inMonths(12) } },
    { group: 'Market', title: 'Correction', sub: 'S&P 500 falls 10% within 3 months', build: { symbol: 'SPY', move: 'drawdown', value: 10, date: inMonths(3) } },
    { group: 'Market', title: 'Tech beats the market', sub: 'Nasdaq 100 beats the S&P 500 this year', build: { symbol: 'QQQ', move: 'beat', vs: 'SPY', value: 0, date: endOf(yr) } },
    { group: 'Market', title: 'Small caps catch up', sub: 'Russell 2000 beats the S&P 500 by 5%', build: { symbol: 'IWM', move: 'beat', vs: 'SPY', value: 5, date: inMonths(6) } },
    { group: 'Fear', title: 'Panic spike', sub: 'VIX trades up to 30', build: { symbol: '^VIX', move: 'touchAbove', value: 30, date: inMonths(3) } },
    { group: 'Rates', title: '10-year above 5.5%', sub: '10-year Treasury yield trades up to 5.5', build: { symbol: '^TNX', move: 'touchAbove', value: 5.5, date: inMonths(6) } },
    { group: 'Stocks', title: 'AI leader stumbles', sub: 'Nvidia falls 30% from its high', build: { symbol: 'NVDA', move: 'drawdown', value: 30, date: inMonths(6) } },
    { group: 'Stocks', title: 'Semis lag', sub: 'SMH trails the S&P 500', build: { symbol: 'SMH', move: 'trail', vs: 'SPY', value: 0, date: inMonths(6) } },
    { group: 'Commodities', title: 'Gold keeps running', sub: 'Gold gains 10% more', build: { symbol: 'GC=F', move: 'up', value: 10, date: inMonths(6) } },
    { group: 'Crypto', title: 'Bitcoin halves', sub: 'Bitcoin falls 50% from its high', build: { symbol: 'BTC-USD', move: 'drawdown', value: 50, date: inMonths(12) } },
    { group: 'Crypto', title: 'Bitcoin breaks out', sub: 'Bitcoin gains at least 50%', build: { symbol: 'BTC-USD', move: 'up', value: 50, date: inMonths(12) } },
    { group: 'Macro (Claude)', title: 'Recession', sub: 'The US enters a recession by the end of next year', claim: `The US economy enters a recession (NBER-dated or two negative GDP quarters) before the end of ${yr + 1}`, claude: true },
    { group: 'Macro (Claude)', title: 'Two Fed cuts', sub: 'The Fed cuts at least twice in 6 months', claim: 'The Federal Reserve cuts rates at least twice in the next 6 months', claude: true },
    { group: 'Macro (Claude)', title: 'Inflation comes back', sub: 'CPI inflation is back above 4%', claim: 'US CPI inflation (year over year) is back above 4% within 12 months', claude: true },
  ];

  function buildView() {
    if (S.prefill) S.mode = S.prefill.build ? 'build' : 'describe';
    if (!S.mode || (S.mode === 'describe' && !S.me.claude)) S.mode = S.me.claude ? 'describe' : 'build';
    shell('build', titleTop('Build'), `
      <div class="intro"><h1>What do you think happens next?</h1><p>The desk tests it against market data and re-checks it on your schedule.</p></div>
      <div class="tabs wide" role="tablist">${[['describe', 'Describe', 'sparkle'], ['build', 'Builder', 'crosshair'], ['templates', 'Templates', 'copy']].filter(([v]) => v !== 'describe' || S.me.claude).map(([v, t, ic]) => `<button role="tab" aria-selected="${S.mode === v}" data-act="mode" data-v="${v}">${I(ic, 15)}${t}</button>`).join('')}</div>
      <div id="composer-body">${composerBody()}</div>`);
    wireComposer();
  }
  const composerBody = () => (S.mode === 'templates' ? templatesHtml() : `<div class="composer">${S.mode === 'describe' ? describeForm() : buildForm()}${optionsHtml()}<button class="btn block" data-act="create" style="margin-top:16px">Run the desk</button></div>`);
  const describeForm = () => `<form id="describe" class="stack" novalidate>
      <div class="field"><label for="f-claim">Your claim</label><div class="with-mic"><textarea id="f-claim" name="claim" rows="2" maxlength="600" placeholder="${window.Voice && Voice.supported ? 'Type or tap the mic and say it' : 'The market crashes before the end of 2026'}">${esc(S.prefill && S.prefill.claim || '')}</textarea>${mic('f-claim', 'describe')}</div><div class="err" id="e-claim"></div><div class="mic-note" id="note-f-claim" hidden></div></div>
      <div class="field"><label for="f-facts">Your reasons <span class="muted">(optional, each one gets fact-checked)</span></label><div class="with-mic"><textarea id="f-facts" name="facts" rows="3" maxlength="3000" placeholder="Unemployment is rising. Valuations are the highest since 2000."></textarea>${mic('f-facts')}</div><div class="mic-note" id="note-f-facts" hidden></div></div>
      <div class="ideas">${IDEAS.map((x) => `<button type="button" class="idea" data-act="idea" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div></form>`;
  function buildForm() {
    const p = (S.prefill && S.prefill.build) || {};
    return `<form id="build" class="stack" novalidate>
      ${window.Voice && Voice.supported ? `<button type="button" class="say" data-act="mic" data-target="say-build" data-mode="build">${I('microphone', 18)}<span><b>Say it</b><small id="say-build">"Nvidia falls 30 percent by June"</small></span></button>` : ''}
      <div class="row2"><div class="field"><label for="f-symbol">Ticker</label><input id="f-symbol" name="symbol" autocapitalize="characters" autocomplete="off" value="${esc(p.symbol || 'SPY')}"><div class="err" id="e-symbol"></div></div>
      <div class="field"><label for="f-date">By</label><input id="f-date" name="date" type="date" value="${esc(p.date || inMonths(6))}" min="${inMonths(0)}"><div class="err" id="e-date"></div></div></div>
      <div class="field"><label for="f-move">What happens</label><select id="f-move" name="move">${MOVES.map(([v, t]) => `<option value="${v}" ${p.move === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="row2"><div class="field" id="value-field"><label for="f-value" id="value-label">Percent</label><input id="f-value" name="value" inputmode="decimal" value="${esc(p.value ?? 20)}"><div class="err" id="e-value"></div></div>
      <div class="field" id="vs-field" hidden><label for="f-vs">Compared with</label><input id="f-vs" name="vs" autocapitalize="characters" value="${esc(p.vs || 'SPY')}"><div class="err" id="e-vs"></div></div></div>
      <p class="fine" style="margin-top:-6px">Tickers like SPY, NVDA, ^GSPC, ^VIX, ^TNX, GC=F or BTC-USD.</p>
      <p class="preview" id="preview"></p></form>`;
  }
  function optionsHtml() {
    const o = (S.prefill && S.prefill.options) || {};
    const depth = S.me.claude ? (o.depth || 'deep') : 'quick';
    return `<details class="opts" ${S.prefill && S.prefill.options ? 'open' : ''}><summary>${I('gauge', 16)}Run options<span class="opts-sum">${esc(DEPTHS[depth][0])}, ${o.schedule === 'twice' ? 'twice a day' : o.schedule === 'weekly' ? 'weekly' : o.schedule === 'off' ? 'manual' : 'daily'}</span></summary>
      <div class="stack" style="margin-top:12px">
        ${S.me.claude ? `<div class="field"><span class="label">How deep</span><div class="seg wide" role="radiogroup">${Object.entries(DEPTHS).map(([v, [t]]) => `<button type="button" role="radio" aria-checked="${depth === v}" data-act="opt-depth" data-v="${v}">${t}</button>`).join('')}</div><div class="help" id="depth-help">${esc(DEPTHS[depth][1])}</div></div>` : '<p class="fine">Runs on the data desk (Quick). The owner can turn on the Claude analysts for you.</p>'}
        <div class="field"><label for="o-schedule">How often</label><select id="o-schedule">${Object.entries(FREQS).map(([v, t]) => `<option value="${v}" ${(o.schedule || 'daily') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="row2"><div class="field"><label for="o-move">Email me if it moves</label><select id="o-move">${[3, 5, 10, 15].map((n) => `<option value="${n}" ${n === 5 ? 'selected' : ''}>${n}+ points</option>`).join('')}<option value="0">Never</option></select></div>
        <div class="field"><label for="o-cross">Or crosses</label><input id="o-cross" inputmode="numeric" placeholder="e.g. 50" maxlength="2"></div></div>
        <div class="field"><label for="o-mycall">Your own call <span class="muted">(optional)</span></label><div class="slider-row"><input id="o-mycall" type="range" min="1" max="99" value="50" data-touched="0"><output id="o-mycall-v" class="num">-</output></div><div class="help">Your probability, kept next to the desk's so you can see who was closer.</div></div>
      </div></details>`;
  }
  function templatesHtml() {
    const groups = new Map();
    for (const t of TEMPLATES) { if (t.claude && !S.me.claude) continue; if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); }
    return [...groups.entries()].map(([g, ts]) => `<section class="block tight"><h2>${esc(g)}</h2><div class="tgrid">${ts.map((t) => `<button class="tcard" data-act="template" data-v="${TEMPLATES.indexOf(t)}"><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></button>`).join('')}</div></section>`).join('');
  }
  function readOptions() {
    const dep = document.querySelector('[data-act="opt-depth"][aria-checked="true"]');
    const mv = Number($('#o-move').value), cross = $('#o-cross').value.trim();
    const mc = $('#o-mycall');
    return {
      options: { depth: dep ? dep.dataset.v : 'quick', schedule: $('#o-schedule').value, alerts: { email: mv > 0 || !!cross, move: mv || 50, cross: cross ? Number(cross) : null, flip: mv > 0, settle: true } },
      myCall: mc.dataset.touched === '1' ? Number(mc.value) : null,
    };
  }
  function wireComposer() {
    const b = $('#build');
    if (b) {
      const upd = () => {
        const mv = MOVES.find((m) => m[0] === b.move.value);
        const cmp = mv[2] === 'vs';
        $('#vs-field').hidden = !cmp;
        $('#value-label').textContent = mv[2] === '%' ? 'Percent' : cmp ? 'By at least (%)' : 'Price';
        const sym = b.symbol.value.trim().toUpperCase() || 'SPY', v = b.value.value.trim();
        const what = cmp ? `${mv[1]} <b>${esc(b.vs.value.trim().toUpperCase() || '…')}</b>${Number(v) > 0 ? ` by <b>${esc(v)}%</b>+` : ''}` : `${mv[1]} <b>${mv[2] === '%' ? `${esc(v)}%` : esc(v)}</b>`;
        $('#preview').innerHTML = `<b>${esc(sym)}</b> ${what} by <b>${b.date.value ? esc(fmtDay(b.date.value)) : '…'}</b>.`;
      };
      b.addEventListener('input', upd); b.addEventListener('change', upd); upd();
      b.onsubmit = (e) => { e.preventDefault(); create(); };
    }
    const d = $('#describe'); if (d) d.onsubmit = (e) => { e.preventDefault(); create(); };
    const mc = $('#o-mycall');
    if (mc) mc.addEventListener('input', () => { mc.dataset.touched = '1'; $('#o-mycall-v').textContent = `${mc.value}%`; });
    S.prefill = null;
  }
  async function create() {
    const d = $('#describe'), b = $('#build'), btn = $('[data-act="create"]');
    const { options, myCall } = readOptions();
    let body;
    if (d) {
      const claim = d.claim.value.trim();
      if (formErrors(d, claim.length < 6 ? { claim: 'Say the claim in a sentence.' } : {})) return;
      body = { claim, facts: d.facts.value.trim(), options, myCall };
    } else body = { build: { symbol: b.symbol.value.trim(), move: b.move.value, value: b.value.value.trim(), vs: b.vs.value.trim(), date: b.date.value }, options, myCall };
    busy(btn, true, 'Starting');
    try { const r = await api('/api/scenarios', { method: 'POST', body }); location.hash = `#/s/${r.id}`; }
    catch (err) {
      busy(btn, false, 'Run the desk');
      if (d) formErrors(d, { claim: err.message });
      else formErrors(b, /ticker/i.test(err.message) ? { symbol: err.message } : /deadline/i.test(err.message) ? { date: err.message } : /compare/i.test(err.message) ? { vs: err.message } : { value: err.message });
    }
  }

  // ---- voice ----------------------------------------------------------------------------------------
  let micStop = null, micBtn = null;
  function toggleMic(btn) {
    if (micStop) { micStop(); return; }
    const target = btn.dataset.target, mode = btn.dataset.mode;
    const field = document.getElementById(target);
    const note = (msg) => { const n = document.getElementById(`note-${target}`); if (n) { n.hidden = !msg; n.textContent = msg || ''; } };
    const before = field && 'value' in field ? field.value.replace(/\s+$/, '') : '';
    micBtn = btn;
    micStop = Voice.start({
      onState(st) {
        btn.classList.toggle('rec', st === 'listening'); btn.classList.toggle('busy', st === 'thinking');
        if (st === 'listening') note(Voice.live ? 'Listening. Tap the mic again when you are done.' : 'Recording. Tap the mic again when you are done.');
        if (st === 'thinking') note('Transcribing on the server');
        if (st === 'idle') { micStop = null; micBtn = null; }
      },
      onText(text, final) {
        if (mode === 'build') { if (field) field.textContent = text ? `"${text}"` : 'Listening'; if (final && text) fillBuild(text); return; }
        if (field) { field.value = (before ? `${before} ` : '') + text; field.dispatchEvent(new Event('input', { bubbles: true })); }
        if (final) { note(''); if (mode === 'describe' && text && S.me.claude) tidyClaim(field.value); }
      },
      onError(msg) { note(''); toast(msg, true); },
    });
  }
  async function tidyClaim(text) {
    const n = $('#note-f-claim'); if (n) { n.hidden = false; n.textContent = 'Claude is tidying it into a claim and your reasons'; }
    try {
      const r = await api('/api/voice/tidy', { method: 'POST', body: { text, mode: 'describe' } });
      if ($('#f-claim') && r.claim) $('#f-claim').value = r.claim;
      if ($('#f-facts') && r.facts) $('#f-facts').value = [$('#f-facts').value.trim(), r.facts].filter(Boolean).join('\n');
      if (n) n.textContent = r.by === 'claude' ? 'Tidied by Claude. Edit anything before you run it.' : '';
    } catch { if (n) n.hidden = true; }
  }
  async function fillBuild(text) {
    const b = $('#build'); if (!b) return;
    try {
      const r = await api('/api/voice/tidy', { method: 'POST', body: { text, mode: 'build' } });
      if (r.symbol) b.symbol.value = r.symbol;
      if (r.move && MOVES.some((m) => m[0] === r.move)) b.move.value = r.move;
      if (r.value !== undefined && r.value !== null && r.value !== '') b.value.value = r.value;
      if (r.vs) b.vs.value = r.vs;
      if (/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) b.date.value = r.date;
      b.dispatchEvent(new Event('change', { bubbles: true }));
      toast(r.by === 'claude' ? 'Filled in by Claude. Check it, then run it.' : 'Filled in. Check it, then run it.');
    } catch (err) { toast(err.message, true); }
  }

  // ---- Discover --------------------------------------------------------------------------------------
  if (!S.disc) S.disc = { cat: 'All' };
  async function discoverView() {
    shell('discover', titleTop('Discover', `<button class="icon-btn" data-act="disc-refresh" aria-label="Refresh" title="Look again">${I('arrow-clockwise', 19)}</button>`), `<div class="intro"><h1>What people are claiming today</h1><p>Testable calls from Reddit, Hacker News, Mastodon and the news, plus the prediction markets with the most money moving.</p></div><div id="disc">${[1, 2, 3].map(() => '<div class="dcard"><div class="sk sk-line" style="width:40%"></div><div class="sk sk-line" style="height:20px"></div><div class="sk sk-line" style="width:70%"></div></div>').join('')}</div>`);
    let d;
    try { d = await api('/api/discover'); } catch (e) { $('#disc').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    if (route()[0] !== 'discover') return;
    S.disc.data = d;
    drawDiscover();
  }
  function drawDiscover() {
    const el = $('#disc'); const d = S.disc.data; if (!el || !d) return;
    if (d.pending) { el.innerHTML = `<div class="hero-empty"><h2>Reading today's posts</h2><p>The desk is gathering posts from Reddit, Hacker News, Mastodon and the news and pulling out the claims. This takes a minute; the page fills in by itself.</p></div>`; return; }
    const cats = ['All', ...new Set(d.claims.map((c) => c.category))];
    const list = d.claims.filter((c) => S.disc.cat === 'All' || c.category === S.disc.cat);
    const n = Object.values(d.sources || {}).reduce((a, b) => a + b, 0);
    el.innerHTML = `<p class="fine disc-meta">${d.refreshing ? '<span class="inline"><span class="pulse"></span>Looking again</span>' : `Updated ${esc(ago(d.at))}`} from ${n} posts and headlines. ${d.by === 'claude' ? 'Claims pulled out by Claude.' : 'Claims picked by keyword (Claude is off).'}</p>
      ${cats.length > 2 ? `<div class="chips" role="group" aria-label="Category" style="margin:12px 0 4px">${cats.map((c) => `<button class="fchip" aria-pressed="${S.disc.cat === c}" data-act="disc-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      <section class="block tight">${list.map((c) => claimCard(c, d.claims.indexOf(c))).join('') || '<p class="empty">No claims in this category today.</p>'}</section>
      ${(d.tickers && (d.tickers.trending.length || d.tickers.mentioned.length)) ? `<section class="block"><h2>Tickers people are talking about</h2><div class="tick-chips">${[...d.tickers.mentioned.map((t) => ({ symbol: t.symbol, note: `${t.mentions} post${t.mentions > 1 ? 's' : ''}` })), ...d.tickers.trending.filter((t) => !d.tickers.mentioned.some((m) => m.symbol === t.symbol)).map((t) => ({ symbol: t.symbol, note: 'trending on StockTwits' }))].slice(0, 18).map((t) => `<button class="tick" data-act="track-symbol" data-v="${esc(t.symbol)}"><b>${esc(t.symbol)}</b><small>${esc(t.note)}</small></button>`).join('')}</div><p class="fine" style="margin-top:8px">Tap one to build a scenario on it.</p></section>` : ''}
      ${d.markets && d.markets.length ? `<section class="block"><h2>Where the money is betting</h2><p class="fine" style="margin:-6px 0 10px">Busiest open markets on Polymarket and Kalshi.</p>${d.markets.map((x) => `<div class="pm"><div><a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.question)}</a><p class="fine">${esc(x.venue)}${x.closes ? `, closes ${esc(fmtShort(x.closes))}` : ''}${x.volume24h ? `, $${Math.round(x.volume24h).toLocaleString()} traded today` : ''}</p></div><div class="pm-side"><b class="num">${Math.round(x.p * 100)}%</b>${S.me.claude ? `<button class="link" data-act="track-claim" data-v="${esc(x.question)}">Test it</button>` : ''}</div></div>`).join('')}</section>` : ''}
      <p class="foot">What people say online is not evidence. Testing it is the point: each claim runs through the full desk.</p>`;
  }
  function claimCard(c, i) {
    const bull = c.lean === 'bullish';
    return `<article class="dcard">
      <div class="dcard-top"><span class="dcat">${esc(c.category)}</span><span class="lean-tag ${bull ? 'yes' : 'no'}">${I(bull ? 'trend-up' : 'trend-down', 12)} ${bull ? 'Bullish' : 'Bearish'}</span><span class="buzz">${I('chats-circle', 13)}${c.buzz} post${c.buzz === 1 ? '' : 's'}${c.platforms && c.platforms.length ? ` on ${esc(c.platforms.join(', '))}` : ''}</span></div>
      <h3 class="dclaim">${esc(c.claim)}</h3>
      ${c.why ? `<p class="dwhy">${esc(c.why)}</p>` : ''}
      ${(c.sources || []).length ? `<div class="dsrc">${c.sources.slice(0, 3).map((x) => `<a href="${safeUrl(x.url)}" target="_blank" rel="noopener"><small>${esc(x.where || x.platform)}</small>${esc(x.text)}</a>`).join('')}</div>` : ''}
      <div class="dact">${c.tracked ? `<a class="btn small quiet" href="#/s/${esc(c.tracked)}">${I('check', 14)}Tracking it</a>` : `<button class="btn small" data-act="disc-test" data-v="${i}">${I('lightning', 14)}Test it</button><button class="btn small quiet" data-act="disc-edit" data-v="${i}">Edit first</button>`}</div>
    </article>`;
  }

  // ---- Markets ---------------------------------------------------------------------------------------
  async function marketsView() {
    shell('markets', titleTop('Markets'), `<div id="mk">${'<div class="qgrid">' + Array.from({ length: 8 }, () => '<div class="qtile"><div class="sk sk-line"></div><div class="sk sk-line" style="width:60%"></div></div>').join('') + '</div>'}</div>`);
    let m;
    try { m = await api('/api/pulse'); } catch (e) { $('#mk').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    if (route()[0] !== 'markets') return;
    const fg = (f, label) => f ? `<div class="gauge"><div class="gauge-top"><span>${label}</span><b class="num">${Math.round(f.score)}</b></div><div class="gauge-bar"><span style="left:${Math.max(0, Math.min(100, f.score))}%"></span></div><div class="gauge-scale"><span>Fear</span><span>${esc(String(f.rating || '').replace(/^\w/, (c) => c.toUpperCase()))}</span><span>Greed</span></div><p class="fine">A week ago ${Math.round(f.weekAgo)}, a month ago ${Math.round(f.monthAgo)}.</p></div>` : '';
    $('#mk').innerHTML = `
      <section class="block tight"><h2>The market</h2><div class="qgrid">${m.quotes.map(qTile).join('')}</div><p class="fine" style="margin-top:8px">Daily closes. Tap one to build a scenario on it.</p></section>
      <section class="block"><h2>Mood</h2><div class="mood">${fg(m.fearGreed, 'Stocks')}${fg(m.cryptoFearGreed, 'Crypto')}</div></section>
      ${m.curve ? `<section class="block"><h2>Yield curve</h2><div class="panel flat curve"><div><span class="num big-s">${m.curve.spread >= 0 ? '+' : ''}${m.curve.spread.toFixed(2)}</span><p class="fine">10-year minus 2-year, ${esc(fmtShort(m.curve.date))}. ${m.curve.spread < 0 ? 'Inverted: historically a recession warning.' : 'Positive (not inverted).'}</p><p class="fine">3-month ${m.curve.m3}%, 2-year ${m.curve.y2}%, 10-year ${m.curve.y10}%.</p></div>${Chart.spark(m.curve.spark, { w: 130, h: 44 })}</div></section>` : ''}
      <section class="block"><div class="chart-head"><h2>Your watchlist</h2><button class="link" data-act="edit-watch">Edit</button></div><div id="watch">${watchHtml(m.watchlist)}</div></section>
      ${m.markets.length ? `<section class="block"><h2>Prediction markets</h2><p class="fine" style="margin:-6px 0 10px">Real-money odds on Polymarket and Kalshi right now.</p>${m.markets.map((x) => `<div class="pm"><div><a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.question)}</a><p class="fine">${esc(x.venue)}${x.closes ? `, closes ${esc(fmtShort(x.closes))}` : ''}${x.volume ? `, $${Math.round(x.volume).toLocaleString()} traded` : ''}</p></div><div class="pm-side"><b class="num">${Math.round(x.p * 100)}%</b>${S.me.claude ? `<button class="link" data-act="track-claim" data-v="${esc(x.question)}">Track</button>` : ''}</div></div>`).join('')}</section>` : ''}
      <p class="foot">Data from Yahoo Finance, CNN, alternative.me, the US Treasury, Polymarket and Kalshi. Updated every 20 minutes.</p>`;
  }
  const qTile = (q) => `<button class="qtile" data-act="track-symbol" data-v="${esc(q.symbol)}"><span class="q-name">${esc(q.name)}</span><span class="num q-last">${fmtN(q.last)}</span><span class="q-row"><span class="delta ${q.d1 > 0 ? 'up' : q.d1 < 0 ? 'down' : ''}">${pctS(q.d1)}</span>${Chart.spark(q.spark, { w: 64, h: 20, fill: false })}</span></button>`;
  const watchHtml = (wl) => (wl || []).map((q) => q.error ? `<div class="wrow"><b>${esc(q.symbol)}</b><span class="fine">no data</span></div>` : `<button class="wrow" data-act="track-symbol" data-v="${esc(q.symbol)}"><span><b>${esc(q.symbol)}</b><small>${q.trend ? (q.trend === 'up' ? 'Above' : 'Below') + ' its 200-day' : ''}${q.fromHigh !== undefined ? `, ${pctS(q.fromHigh)} from high` : ''}</small></span>${Chart.spark(q.spark, { w: 72, h: 24, fill: false })}<span class="w-r"><span class="num">${fmtN(q.last)}</span>${'<span class="delta ' + (q.m1 > 0 ? 'up' : q.m1 < 0 ? 'down' : '') + '">' + pctS(q.m1) + ' 1M</span>'}</span></button>`).join('') || '<p class="muted">Add tickers to follow them here.</p>';

  // ---- You ---------------------------------------------------------------------------------------------
  async function youView() {
    shell('you', titleTop('You'), `<div class="intro"><h1>${esc(S.me.name || 'You')}</h1><p>${esc(S.me.email)}</p></div><div id="you">${skLines(6)}</div>`);
    let rec, pr;
    try { [rec, pr] = await Promise.all([api('/api/record'), api('/api/prefs')]); } catch (e) { $('#you').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const b = (x) => (x === null || x === undefined ? '-' : x.toFixed(3));
    $('#you').innerHTML = `
      <section class="block"><h2>Track record</h2>
        <div class="stats"><div class="stat"><span class="num">${rec.settled.length}</span><small>settled</small></div><div class="stat"><span class="num">${b(rec.brier)}</span><small>desk Brier</small></div><div class="stat"><span class="num">${b(rec.myBrier)}</span><small>your Brier</small></div></div>
        <p class="fine" style="margin-top:8px">Brier score: 0 is perfect, 0.25 is always saying 50%. Superforecasters land around 0.10 to 0.15.</p>
        ${rec.settled.length ? `<table class="hist" style="margin-top:12px"><thead><tr><th>Scenario</th><th class="r">Desk</th><th class="r">You</th><th class="r">Result</th></tr></thead><tbody>${rec.settled.map((r) => `<tr><td><a href="#/s/${r.id}">${esc(r.title)}</a></td><td class="r num">${r.last}%</td><td class="r num">${r.myLast ?? '-'}${r.myLast !== null ? '%' : ''}</td><td class="r"><span class="tag ${r.outcome === 'yes' ? 'yes' : 'no'}">${r.outcome.toUpperCase()}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin-top:12px">Nothing has settled yet. Scores appear here as deadlines pass or targets are hit.</p>'}
        ${rec.calibration.length ? `<p class="sub">Calibration</p><table class="hist"><thead><tr><th>Desk said</th><th class="r">Readings</th><th class="r">Came true</th></tr></thead><tbody>${rec.calibration.map((c) => `<tr><td>${c.range}</td><td class="r num">${c.n}</td><td class="r num">${Math.round(c.hit * 100)}%</td></tr>`).join('')}</tbody></table>` : ''}
        ${rec.open.some((o) => o.mine !== null) ? `<p class="sub">Open calls: you vs the desk</p><table class="hist"><tbody>${rec.open.filter((o) => o.mine !== null).map((o) => `<tr><td><a href="#/s/${o.id}">${esc(o.title)}</a></td><td class="r num">desk ${o.p}%</td><td class="r num">you ${o.mine}%</td></tr>`).join('')}</tbody></table>` : ''}
      </section>
      <section class="block"><h2>Notifications</h2><div class="panel flat">
        <label class="toggle"><span>Daily digest email<small class="fine" style="display:block">One email after the close with every scenario.</small></span><span class="switch"><input type="checkbox" data-act="digest" ${pr.digest ? 'checked' : ''}><span></span></span></label>
        <p class="fine" style="margin-top:6px">Alerts for each scenario (big moves, verdict flips, your line, settling) are in its settings.</p></div></section>
      <section class="block"><h2>More</h2><div class="links">
        ${S.me.owner ? `<a class="lrow" href="#/people">${I('users-three', 18)}<span>People<small>Who can use the Claude analysts</small></span>${I('arrow-up-right', 14)}</a>` : ''}
        <a class="lrow" href="#/sources">${I('database', 18)}<span>Data sources<small>Every free source, checked live</small></span>${I('arrow-up-right', 14)}</a>
        <div class="lrow">${I('lightning', 18)}<span>Claude analysts<small>${S.me.claude ? 'On for you' : 'Off. The owner can turn them on.'}</small></span></div>
        <button class="lrow" data-act="logout">${I('sign-out', 18)}<span>Sign out</span></button></div></section>
      <p class="foot">Research, not financial advice.</p>`;
  }

  // ---- scenario ---------------------------------------------------------------------------------
  const ICONS = { quant: 'dice-five', technical: 'chart-line-up', macro: 'bank', sentiment: 'chats-circle', fundamentals: 'receipt', research: 'newspaper', options: 'chart-scatter', markets: 'target', social: 'broadcast' };
  const SEATS = [['Strategist', 'compass'], ['Data', 'database'], ['Quant', 'dice-five'], ['Technicals', 'chart-line-up'], ['Macro', 'bank'], ['Sentiment', 'chats-circle'], ['Options', 'chart-scatter'], ['Research', 'newspaper'], ['Social', 'broadcast'], ['Reading', 'list-dashes'], ['Judge', 'scales']];

  // A scenario is a room with its own sections; the main tab bar stays on Scenarios.
  const SECTIONS = [['overview', 'Overview'], ['evidence', 'Evidence'], ['desk', 'Desk'], ['ask', 'Ask'], ['settings', 'Settings']];
  const kinds = { market: 'Market', stock: 'Single stock', compare: 'Comparison', macro: 'Macro', crypto: 'Crypto', event: 'Event' };
  async function dashView(id, { keep } = {}) {
    const section = SECTIONS.some(([v]) => v === route()[2]) ? route()[2] : 'overview';
    const actions = `<button class="icon-btn" data-act="fork" title="Make a copy with changes" aria-label="Fork">${I('copy', 19)}</button><button class="icon-btn" data-act="share" title="Copy link" aria-label="Copy link">${I('share-network', 19)}</button>`;
    if (!keep || !S.cur || S.cur.id !== id) shell('scenarios', backTop('#/scenarios', 'Scenarios', actions), `<div class="hero"><div class="sk sk-line" style="width:30%"></div><div class="sk sk-line" style="width:85%;height:22px"></div><div class="sk sk-big"></div></div><div class="sk sk-chart"></div>`);
    let sc;
    try { sc = await api(`/api/scenarios/${id}`); } catch (e) { $('main').innerHTML = `<div class="empty"><b>Can't open this scenario</b>${esc(e.message)}</div>`; return; }
    if (route()[1] !== id) return;
    S.cur = sc;
    if (sc.progress) S.live[id] = sc.progress.steps;
    const y = window.scrollY;
    const nav = `<nav class="subnav" aria-label="Scenario sections"><div class="subnav-in">${SECTIONS.filter(([v]) => v !== 'ask' || S.me.claude).map(([v, t]) => `<a href="#/s/${sc.id}${v === 'overview' ? '' : `/${v}`}" ${section === v ? 'aria-current="page"' : ''}>${t}${v === 'evidence' && sc.unread ? `<span class="count">${sc.unread > 99 ? '99+' : sc.unread}</span>` : ''}</a>`).join('')}</div></nav>`;
    const agentId = section === 'desk' ? route()[3] : null;
    const body = section === 'overview' ? overviewHtml(sc) : `${roomStrip(sc)}${section === 'evidence' ? '<div id="evidence">' + skLines(6) + '</div>' : agentId ? `<div id="agent">${skLines(3)}<div class="sk sk-chart"></div></div>` : section === 'desk' ? deskSection(sc) : section === 'ask' ? askSection(sc) : settingsSection(sc)}`;
    shell('scenarios', backTop('#/scenarios', 'Scenarios', actions) + nav, body);
    $('main').classList.add('room');
    if (section === 'overview') drawChart();
    if (section === 'evidence') loadEvidence(sc.id);
    if (agentId) loadAgent(sc, agentId);
    if (keep) window.scrollTo(0, y);
    if (sc.latest && section === 'overview') api(`/api/scenarios/${id}/seen`, { method: 'POST' }).catch(() => {});
  }
  /** A slim reminder of where you are, on every section but Overview. */
  function roomStrip(sc) {
    const p = sc.latest ? sc.latest.probability : null;
    return `<div class="strip"><div class="strip-t">${esc(sc.thesis ? sc.thesis.title : sc.claim)}</div>${p !== null ? `<div class="strip-p"><span class="num">${p}%</span><span class="tag ${tone(p)}">${esc(sc.latest.verdict)}</span></div>` : ''}</div>`;
  }
  function overviewHtml(sc) {
    const run = sc.latest, th = sc.thesis;
    const working = ['running', 'queued', 'new'].includes(sc.status) || sc.queued;
    const p = run ? run.probability : null;
    const prevH = sc.history.length > 1 ? sc.history[sc.history.length - 2] : null;
    const my = sc.myCalls.length ? sc.myCalls[sc.myCalls.length - 1].p : null;
    return `
      <section class="hero">
        <div class="kicker">${th ? `<span>${esc(kinds[th.kind] || 'Scenario')}</span><span>by ${esc(fmtDay(th.horizonDate))}</span>` : '<span>New scenario</span>'}${sc.archived ? '<span class="chip">Archived</span>' : ''}</div>
        <h1>${esc(th ? th.title : sc.claim)}</h1>
        <p class="prop">${esc(th ? th.proposition : `"${sc.claim}"`)}</p>
        ${run ? `<div class="reading"><div class="big">${p}<small>%</small></div>
          <div class="reading-side"><span class="tag ${tone(p)}">${I(p >= 56 ? 'trend-up' : p <= 44 ? 'trend-down' : 'scales', 15)}${esc(run.verdict)}</span>
            <span class="reading-meta">${prevH ? `${delta(Math.round((p - prevH.p) * 10) / 10)} since ${esc(fmtShort(prevH.date))}` : 'First reading'}, ${esc(run.judge.confidence)} confidence${my !== null ? `. <span class="you-chip">You ${my}%</span>` : ''}</span></div></div>
          <p class="call">${esc(run.call)}</p>
          ${!run.claude ? `<p class="fine" style="margin-top:8px">${S.me.claude ? 'Quick run: data analysts only.' : 'Data desk reading. The Claude analysts are off for this account.'}</p>` : ''}` : ''}
        ${sc.resolved ? `<div class="notice settled ${sc.resolved.outcome === 'no' ? 'bad' : ''}">Settled ${esc(sc.resolved.outcome.toUpperCase())}. ${esc(sc.resolved.why)}</div>` : ''}
      </section>
      ${working ? liveHtml(sc, S.live[sc.id] || []) : ''}
      ${sc.status === 'error' ? `<div class="notice bad" style="margin-top:20px">The desk stopped: ${esc(sc.error || 'unknown error')} <button class="btn small quiet" data-act="run" style="margin-left:6px">Try again</button></div>` : ''}
      ${run || sc.backfill.length ? chartHtml(sc) : ''}
      ${run && run.reading && run.reading.added ? `<a class="evi-cta" href="#/s/${sc.id}/evidence">${I('newspaper', 20)}<span><b>${run.reading.added} new article${run.reading.added > 1 ? 's' : ''} today</b><small>${run.reading.for} support, ${run.reading.against} against, ${run.reading.context} context</small></span>${I('arrow-up-right', 16)}</a>` : sc.unread ? `<a class="evi-cta" href="#/s/${sc.id}/evidence">${I('newspaper', 20)}<span><b>${sc.unread} unread in the reading room</b><small>Articles for and against, sorted daily</small></span>${I('arrow-up-right', 16)}</a>` : ''}
      ${run && sc.status !== 'resolved' ? callHtml(sc, my) : ''}
      ${changesHtml(sc)}
      ${run ? casesHtml(run) : ''}
      ${catalystsHtml(run)}
      ${run ? `<p class="foot">Read on ${esc(fmtDay(run.date))} in ${Math.round(run.durationMs / 1000)}s (${esc((DEPTHS[run.depth || (run.claude ? 'deep' : 'quick')] || ['Deep'])[0])}). Research, not financial advice.</p>` : ''}`;
  }
  function deskSection(sc) {
    const run = sc.latest;
    if (!run) return '<div class="empty"><b>No reading yet</b>The desk is still working on the first one.</div>';
    return `${agentGrid(sc, run)}${factsHtml(run)}
      ${run.judge.watch.length ? `<section class="block"><h2>What would change the call</h2><div class="panel flat">${run.judge.watch.map((w) => `<div class="watch"><div class="watch-top"><b>${esc(w.signal)}</b><span class="thr">${esc(w.threshold)}</span></div><p>${esc(w.why)}</p></div>`).join('')}</div></section>` : ''}
      <p class="foot">Prices from ${esc((run.sources || []).join(', ') || 'n/a')}. Sentiment by ${esc(run.models.sentiment || 'n/a')}${run.models.forecast ? `, forecast by ${esc(run.models.forecast)}` : ''}${run.models.judge ? `, judged by Claude ${esc(run.models.judge)}` : ''}.${run.errors && run.errors.length ? ` ${run.errors.length} source${run.errors.length > 1 ? 's were' : ' was'} unavailable.` : ''}</p>`;
  }
  const askSection = (sc) => `${askHtml(sc)}${sc.theme.length ? `<section class="block"><h2>Same theme</h2>${sc.theme.map(rowHtml).join('')}</section>` : ''}`;
  const settingsSection = (sc) => `${settingsHtml(sc)}${sc.thesis ? measuredHtml(sc, sc.thesis) : ''}${historyHtml(sc)}`;

  // ---- the desk: one cell per analyst, each opening its own evidence page ----------------------
  const leanWord = (a) => (!a.confidence ? 'Context' : a.stance > 0.1 ? 'Supports' : a.stance < -0.1 ? 'Against' : 'Neutral');
  const leanTone = (a) => (!a.confidence ? '' : a.stance > 0.1 ? 'yes' : a.stance < -0.1 ? 'no' : 'mid');
  function miniViz(a) {
    if (a.chart && a.chart.close) return Chart.spark(a.chart.close.slice(-120), { w: 140, h: 34 });
    if (a.fan) return Chart.spark(a.fan.points.map((p) => p.p50), { w: 140, h: 34, fill: false });
    if (a.series && a.series[0]) return Chart.spark(a.series[0].spark, { w: 140, h: 34 });
    if (a.curve) return Chart.spark(a.curve.points.map((p) => p.p), { w: 140, h: 34, fill: false });
    if (a.quarters && a.quarters.length) return Chart.spark(a.quarters.map((q) => q.revenue), { w: 140, h: 34 });
    if (a.groups) { const b = a.groups.reduce((s, g) => s + g.bull, 0), r = a.groups.reduce((s, g) => s + g.bear, 0); return `<div class="split-bar"><span class="up" style="flex:${b || 0.01}"></span><span class="down" style="flex:${r || 0.01}"></span></div><small class="fine">${b} bullish, ${r} bearish posts</small>`; }
    if (a.factChecks) return `<small class="fine">${a.points.length} sources, ${a.factChecks.length} fact-checks</small>`;
    if (a.markets) return `<small class="fine">${a.markets.length} open markets</small>`;
    if (a.quotes) return `<small class="fine">${a.quotes.length} posts</small>`;
    return '';
  }
  function agentGrid(sc, run) {
    return `<section class="block tight"><h2>The desk</h2><p class="fine" style="margin:-6px 0 12px">${run.analysts.length} analysts. Tap one for its evidence.</p><div class="cells">${run.analysts.map((a) => `<a class="cell" href="#/s/${sc.id}/desk/${esc(a.id)}">
      <div class="cell-top"><span class="an-icon">${I(ICONS[a.id] || 'sparkle', 18)}</span><span class="lean-tag ${leanTone(a)}">${leanWord(a)}</span></div>
      <div class="cell-name"><b>${esc(a.name)}</b>${a.probability !== undefined ? `<span class="num">${Math.round(a.probability * 100)}%</span>` : ''}</div>
      <p class="cell-h">${esc(a.headline)}</p><div class="cell-viz">${miniViz(a)}</div></a>`).join('')}</div></section>`;
  }
  const METHOD = {
    quant: 'Replays this asset\'s own daily moves from the last 10 years in 10-day blocks (crashes and all), 4,000 times, to the deadline. Today\'s volatility counts more for short horizons; the drift is shrunk toward an ordinary market return so past winners aren\'t assumed to keep winning. The share of paths where the claim comes true is the probability. When installed, Chronos-Bolt (a Hugging Face forecasting model) gives a second opinion.',
    technical: 'Reads trend (price against its 50 and 200-day averages, and whether the 200-day is rising), momentum (3 and 12-month returns, MACD), stretch (RSI, Bollinger bands), volatility regime, strength against the S&P 500, support and resistance, seasonality and volume. Trend and momentum carry the most weight; the result is turned into a lean on your claim.',
    macro: 'Applies rules with a track record to FRED, US Treasury and BLS data: yield-curve inversion and un-inversion, the Sahm rule on unemployment, credit spreads, the VIX, jobless claims, financial conditions and the Fed\'s path. Stress supports a "markets fall" claim and works against a "markets rise" one.',
    sentiment: 'Scores what people post and publish this week (StockTwits, Reddit, Mastodon, Lemmy, Hacker News and headlines) with FinBERT, a finance language model, plus CNN\'s Fear & Greed and Wikipedia attention. Crowd mood is weak evidence and extreme agreement often marks turns, so this analyst carries little weight.',
    fundamentals: 'Reads the company\'s filings at the SEC: revenue growth, margins and earnings, and prices them (P/E). Strong growth supports "up" claims; a rich valuation leaves less room for disappointment.',
    options: 'Reads delayed option prices from Cboe. The slope of put prices across strikes gives the market\'s own odds of the price being below each level at expiry. Option buyers pay up for crash protection, so these odds run high for declines.',
    markets: 'Searches Polymarket, Kalshi and Manifold for open markets on related questions. Real-money odds on the same question are strong evidence; loosely related ones are context for the judge.',
    research: 'Claude searches the last two weeks of news and data, checks every fact you gave against sources, and lists upcoming catalysts. Every point carries its source.',
    social: 'Claude searches X, Reddit, YouTube and forums through the web for this week\'s discussion, separating well-known voices from retail chatter.',
  };
  async function loadAgent(sc, aid) {
    let r;
    try { r = await api(`/api/scenarios/${sc.id}/agent/${aid}`); } catch (e) { $('#agent').innerHTML = `<div class="empty"><b>No report yet</b>${esc(e.message)}</div>`; return; }
    const a = r.analyst;
    const run = sc.latest;
    $('#agent').innerHTML = `<a class="back-link" href="#/s/${sc.id}/desk">${I('arrow-left', 15)}All analysts</a>
      <header class="agent-head"><span class="an-icon big">${I(ICONS[a.id] || 'sparkle', 24)}</span><div><h1>${esc(a.name)}</h1><p class="fine">Report from ${esc(fmtDay(r.runDate))}</p></div>${a.probability !== undefined ? `<div class="agent-p"><span class="num">${Math.round(a.probability * 100)}%</span><small>its own odds</small></div>` : ''}</header>
      <p class="agent-line">${esc(a.headline)}</p>
      <div class="agent-lean">${lean(a)}<span class="fine">${a.confidence ? `Weight in the desk: ${a.confidence >= 0.5 ? 'high' : a.confidence >= 0.3 ? 'medium' : 'low'} (${a.confidence.toFixed(2)})` : 'Context only: the judge reads it, the pool does not count it'}</span></div>
      ${agentViz(a, sc)}
      <section class="block"><h2>The evidence</h2>${analystBody(a)}</section>
      ${a.factChecks && a.factChecks.length ? factsHtml({ analysts: [a], judge: { corrections: [], supports: [] } }) : ''}
      ${a.catalysts && a.catalysts.length ? catalystsHtml({ analysts: [a] }) : ''}
      <section class="block"><h2>Its lean over time</h2>${r.history.length > 1 ? '<div id="lean-chart" class="pchart-wrap"></div><p class="fine">Above the line it supports the claim, below it works against it.</p>' : '<p class="muted">This builds up as the desk re-runs the scenario.</p>'}</section>
      <section class="block"><h2>How this analyst works</h2><p class="method">${esc(METHOD[a.id] || '')}</p></section>`;
    drawAgentCharts(a, r.history);
  }
  function agentViz(a) {
    const box = (id, title, legend = '', note = '') => `<section class="block"><h2>${title}</h2><div id="${id}" class="pchart-wrap"></div>${legend ? `<div class="legend">${legend}</div>` : ''}${note ? `<p class="fine" style="margin-top:6px">${note}</p>` : ''}</section>`;
    let h = '';
    if (a.id === 'technical' && a.chart) {
      const sh = a.sheet || {};
      h += box('px-chart', `${esc(a.chart.symbol)}, last 12 months`, `<span><i class="key"></i>Price</span><span><i class="key" style="border-top-color:var(--series-2)"></i>50-day</span><span><i class="key" style="border-top-color:var(--series-3)"></i>200-day</span>${a.chart.level ? '<span><i class="key dash" style="border-top-color:var(--no)"></i>Your line</span>' : ''}`);
      const tiles = [
        ['RSI (14)', sh.rsi14 !== undefined && sh.rsi14 !== null ? sh.rsi14.toFixed(0) : '-', sh.rsi14 > 70 ? 'Overbought' : sh.rsi14 < 30 ? 'Oversold' : 'Neutral'],
        ['Bollinger %B', sh.bollinger ? `${Math.round(sh.bollinger.pctB * 100)}%` : '-', sh.bollinger ? `Band ${fmtN(sh.bollinger.lower)} to ${fmtN(sh.bollinger.upper)}` : ''],
        ['Typical day', sh.avgMove ? `${(sh.avgMove * 100).toFixed(2)}%` : '-', 'Average absolute move'],
        ['From 52-wk high', pctS(sh.fromHigh), `High ${fmtN(sh.hi52)}`],
        ...(sh.relative ? [['vs S&P 500 (3M)', pctS(sh.relative.m3), `1 year ${pctS(sh.relative.y1)}`]] : []),
        ...(sh.volume ? [['Volume', `${Math.round((sh.volume.avg20 / sh.volume.avg100 - 1) * 100)}%`, `vs 100-day avg${sh.volume.upDownRatio ? `, up/down ${sh.volume.upDownRatio.toFixed(2)}x` : ''}`]] : []),
        ['MACD', sh.macd ? (sh.macd.hist > 0 ? 'Above' : 'Below') : '-', 'vs its signal line'],
        ['Volatility', sh.vol20 ? `${Math.round(sh.vol20 * 100)}%` : '-', `1 year ${sh.vol1y ? Math.round(sh.vol1y * 100) + '%' : '-'}`],
      ];
      h += `<div class="stat-grid">${tiles.map(([k, v, sub]) => `<div class="st"><small>${k}</small><b class="num">${v}</b><span>${esc(sub)}</span></div>`).join('')}</div>`;
      if ((sh.supports || []).length || (sh.resistances || []).length) h += `<section class="block"><h2>Levels</h2><div class="levels">${(sh.resistances || []).slice().reverse().map((x) => `<div class="lv res"><span>Resistance</span><b class="num">${fmtN(x)}</b></div>`).join('')}<div class="lv now"><span>Now</span><b class="num">${fmtN(sh.last)}</b></div>${(sh.supports || []).map((x) => `<div class="lv sup"><span>Support</span><b class="num">${fmtN(x)}</b></div>`).join('')}</div></section>`;
      if (sh.seasonality) h += box('season-chart', 'Seasonality', '', 'Average return of each calendar month over the history. The next three months are highlighted.');
    }
    if (a.id === 'quant' && a.fan) {
      h += box('fan-chart', 'Where the paths end up', `<span><i class="key"></i>Median path</span><span><i class="sq" style="background:color-mix(in srgb,var(--series-1) 35%,transparent)"></i>Middle 50%</span><span><i class="sq" style="background:color-mix(in srgb,var(--series-1) 15%,transparent)"></i>90% of paths</span>${a.fan.level ? '<span><i class="key dash" style="border-top-color:var(--no)"></i>Your line</span>' : ''}`);
      if (a.fan.hist) h += box('hist-chart', 'Spread of outcomes at the deadline', '', a.fan.threshold !== null ? 'Colored bars are the outcomes past your line.' : '');
      if (a.ladder && a.ladder.length > 2) h += ladderHtml({ analysts: [a] });
      if (a.forecast) h += `<section class="block"><h2>Chronos-Bolt forecast</h2><div class="tiles"><div class="tile"><b>Median path</b>${Chart.spark(a.forecast.median, { w: 240, h: 44, fill: false })}<small>${esc(a.forecast.model)}, ${a.forecast.horizon} trading days</small></div></div></section>`;
    }
    if (a.id === 'options' && a.curve) h += box('opt-chart', `Odds of being below each price on ${esc(fmtShort(a.curve.expiry))}`, '', 'From put prices. Move along the line to read the odds at a level.');
    if (a.id === 'fundamentals' && a.quarters && a.quarters.length) h += box('rev-chart', 'Revenue by quarter');
    if (a.id === 'sentiment') {
      if (a.groups && a.groups.length) h += `<section class="block"><h2>By source</h2><div class="srcbars">${a.groups.map((g) => { const t = g.bull + g.bear + g.neutral || 1; return `<div class="sb"><span>${esc(g.name)}</span><div class="split-bar"><span class="up" style="flex:${g.bull || 0.001}"></span><span class="mid" style="flex:${g.neutral || 0.001}"></span><span class="down" style="flex:${g.bear || 0.001}"></span></div><small class="num">${g.bull}/${g.bear}</small></div>`; }).join('')}</div><div class="legend"><span><i class="sq" style="background:var(--accent)"></i>Bullish</span><span><i class="sq" style="background:var(--line-strong)"></i>Neutral</span><span><i class="sq" style="background:var(--no)"></i>Bearish</span></div></section>`;
      if (a.fearGreed && a.fearGreed.history && a.fearGreed.history.length > 5) h += box('fg-chart', `Fear & Greed: ${Math.round(a.fearGreed.score)} (${esc(a.fearGreed.rating)})`);
      if (a.attention && a.attention.points.length > 5) h += box('att-chart', `Attention: "${esc(a.attention.title)}" Wikipedia views`);
    }
    return h;
  }
  function drawAgentCharts(a, history) {
    const el = (id) => document.getElementById(id);
    if (a.id === 'technical' && a.chart && el('px-chart')) {
      const c = a.chart;
      Chart.xy(el('px-chart'), { label: 'Price with moving averages', series: [{ values: c.close, color: 'var(--series-1)' }, { values: c.sma50, color: 'var(--series-2)', width: 1.6 }, { values: c.sma200, color: 'var(--series-3)', width: 1.6 }], hlines: [...(c.level ? [{ y: c.level, label: `Your line ${fmtN(c.level)}`, color: 'var(--no)' }] : []), { y: c.hi52, label: `52-wk high ${fmtN(c.hi52)}` }], xlabels: [fmtShort(c.dates[0]), fmtShort(c.dates[c.dates.length - 1])], tip: (i) => `<b>${fmtN(c.close[i])}</b> on ${esc(fmtShort(c.dates[i]))}<span>50-day ${fmtN(c.sma50[i])}, 200-day ${fmtN(c.sma200[i])}</span>` });
      const sh = a.sheet || {};
      if (sh.seasonality && el('season-chart')) {
        const now = new Date().getUTCMonth() + 1, next = [now, (now % 12) + 1, ((now + 1) % 12) + 1];
        Chart.bars(el('season-chart'), { label: 'Average return by month', items: sh.seasonality.map((m) => ({ label: 'JFMAMJJASOND'[m.month - 1], value: (m.avg || 0) * 100, color: next.includes(m.month) ? 'var(--series-1)' : 'var(--line-strong)', title: `${new Date(Date.UTC(2000, m.month - 1, 1)).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })}: ${m.avg !== null ? pctS(m.avg) : '-'} average, up ${m.up !== null ? Math.round(m.up * 100) : '-'}% of ${m.years} years` })), yfmt: (v) => `${v.toFixed(1)}%` });
      }
    }
    if (a.id === 'quant' && a.fan && el('fan-chart')) {
      const f = a.fan, pts = [{ p05: f.last, p25: f.last, p50: f.last, p75: f.last, p95: f.last, t: 0 }, ...f.points];
      Chart.xy(el('fan-chart'), { label: 'Simulated price paths', series: [{ values: pts.map((p) => p.p50), color: 'var(--series-1)' }], bands: [{ lo: pts.map((p) => p.p05), hi: pts.map((p) => p.p95), color: 'var(--series-1)', opacity: 0.12 }, { lo: pts.map((p) => p.p25), hi: pts.map((p) => p.p75), color: 'var(--series-1)', opacity: 0.25 }], hlines: [...(f.level ? [{ y: f.level, label: `Your line ${fmtN(f.level)}`, color: 'var(--no)' }] : []), { y: f.last, label: `Now ${fmtN(f.last)}` }], xlabels: ['Today', fmtShort(f.horizon)], tip: (i) => `<b>${fmtN(pts[i].p50)}</b> median<span>Middle 50%: ${fmtN(pts[i].p25)} to ${fmtN(pts[i].p75)}</span>` });
      if (f.hist && el('hist-chart')) {
        const th = f.threshold;
        Chart.bars(el('hist-chart'), { label: 'Distribution of outcomes', items: f.hist.map((b) => ({ label: Math.abs(b.from % 0.1) < 0.001 ? `${Math.round(b.from * 100)}%` : '', value: b.share * 100, color: th !== null && (th < 0 ? b.from + 0.025 <= th + 1e-9 : b.from >= th - 1e-9) ? 'var(--series-1)' : 'var(--line-strong)', title: `${Math.round(b.from * 1000) / 10}% to ${Math.round((b.from + 0.025) * 1000) / 10}%: ${(b.share * 100).toFixed(1)}% of paths` })), yfmt: (v) => `${v.toFixed(1)}%` });
      }
    }
    if (a.id === 'options' && a.curve && el('opt-chart')) {
      const c = a.curve;
      Chart.xy(el('opt-chart'), { label: 'Option-implied odds by price', series: [{ values: c.points.map((p) => p.p * 100), color: 'var(--series-2)' }], hlines: [{ y: 50, label: '50%' }], ymin: 0, ymax: 100, yfmt: (v) => `${Math.round(v)}%`, xlabels: [fmtN(c.points[0].k), fmtN(c.points[c.points.length - 1].k)], tip: (i) => `<b>${(c.points[i].p * 100).toFixed(1)}%</b> below ${fmtN(c.points[i].k)}<span>Spot ${fmtN(c.spot)}${c.level ? `, your line ${fmtN(c.level)}` : ''}</span>` });
    }
    if (a.id === 'fundamentals' && a.quarters && el('rev-chart')) Chart.bars(el('rev-chart'), { label: 'Revenue by quarter', items: a.quarters.map((q) => ({ label: `Q${Math.ceil(Number(q.end.slice(5, 7)) / 3)}'${q.end.slice(2, 4)}`, value: q.revenue / 1e9, title: `${q.end}: $${(q.revenue / 1e9).toFixed(2)}B revenue${q.netIncome !== null ? `, $${(q.netIncome / 1e9).toFixed(2)}B net income` : ''}` })), yfmt: (v) => `$${v.toFixed(1)}B` });
    if (a.id === 'sentiment') {
      if (a.fearGreed && el('fg-chart')) { const hh = a.fearGreed.history; Chart.xy(el('fg-chart'), { series: [{ values: hh.map((x) => x[1]), color: 'var(--series-2)' }], ymin: 0, ymax: 100, hlines: [{ y: 50, label: 'Neutral' }], xlabels: [fmtShort(hh[0][0]), fmtShort(hh[hh.length - 1][0])], yfmt: (v) => Math.round(v), tip: (i) => `<b>${Math.round(hh[i][1])}</b> on ${esc(fmtShort(hh[i][0]))}` }); }
      if (a.attention && el('att-chart')) { const hh = a.attention.points; Chart.xy(el('att-chart'), { series: [{ values: hh.map((x) => x[1]), color: 'var(--series-2)' }], xlabels: [fmtShort(hh[0][0]), fmtShort(hh[hh.length - 1][0])], tip: (i) => `<b>${hh[i][1].toLocaleString()}</b> views on ${esc(fmtShort(hh[i][0]))}` }); }
    }
    if (history.length > 1 && el('lean-chart')) Chart.xy(el('lean-chart'), { label: 'Lean over time', series: [{ values: history.map((x) => x.stance), color: 'var(--ink-2)' }], ymin: -1, ymax: 1, hlines: [{ y: 0, label: 'Neutral' }], yfmt: (v) => (v > 0.05 ? `+${v.toFixed(1)}` : v.toFixed(1)), xlabels: [fmtShort(history[0].date), fmtShort(history[history.length - 1].date)], height: 150, tip: (i) => `<b>${history[i].stance >= 0 ? '+' : ''}${history[i].stance}</b> on ${esc(fmtShort(history[i].date))}${history[i].p !== null ? `<span>${history[i].p}% odds</span>` : ''}` });
  }

  // ---- the reading room ----------------------------------------------------------------------
  const STANCE = { for: ['Supports', 'trend-up'], against: ['Against', 'trend-down'], context: ['Context', 'arrow-up-right'] };
  if (!S.ev) S.ev = { filter: 'all', unread: false };
  async function loadEvidence(id) {
    let rv;
    try { rv = await api(`/api/scenarios/${id}/reading`); } catch (e) { $('#evidence').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    S.reading = rv;
    drawEvidence();
  }
  function relDay(d) { const t = new Date().toISOString().slice(0, 10); const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10); return d === t ? 'Today' : d === y ? 'Yesterday' : new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); }
  function balanceChart(days) {
    // Diverging bars: articles that support the claim above the line, against it below. Last 14 days.
    const span = 14, today = Date.now();
    const cols = Array.from({ length: span }, (_, i) => { const d = new Date(today - (span - 1 - i) * 86400000).toISOString().slice(0, 10); const g = days.find((x) => x.date === d); const it = g ? g.items : []; return { d, f: it.filter((x) => x.stance === 'for').length, a: it.filter((x) => x.stance === 'against').length }; });
    const max = Math.max(1, ...cols.map((c) => Math.max(c.f, c.a)));
    const W = 300, H = 92, mid = H / 2, bw = W / span - 4;
    const bars = cols.map((c, i) => { const x = i * (W / span) + 2; const hf = (c.f / max) * (mid - 6), ha = (c.a / max) * (mid - 6); return `<g><title>${esc(fmtShort(c.d))}: ${c.f} support, ${c.a} against</title>${c.f ? `<rect x="${x}" y="${mid - 1 - hf}" width="${bw}" height="${hf}" rx="2" fill="var(--accent)"/>` : ''}${c.a ? `<rect x="${x}" y="${mid + 1}" width="${bw}" height="${ha}" rx="2" fill="var(--no)"/>` : ''}</g>`; }).join('');
    const tf = cols.reduce((s, c) => s + c.f, 0), ta = cols.reduce((s, c) => s + c.a, 0);
    const lean = tf + ta ? Math.round((tf / (tf + ta)) * 100) : null;
    return `<div class="balance"><div class="balance-head"><div><b>The news flow</b><small>Last 14 days, by the day it arrived</small></div>${lean !== null ? `<div class="balance-n"><span class="num">${lean}%</span><small>supports</small></div>` : ''}</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="${tf} articles support and ${ta} are against over 14 days"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line-strong)" stroke-width="1"/>${bars}</svg>
      <div class="legend"><span><i class="sq" style="background:var(--accent)"></i>Supports ${tf}</span><span><i class="sq" style="background:var(--no)"></i>Against ${ta}</span></div></div>`;
  }
  function drawEvidence() {
    const el = $('#evidence'); const rv = S.reading; if (!el || !rv) return;
    if (!rv.total) { el.innerHTML = `<div class="hero-empty"><h2>The reading room fills up daily</h2><p>Each run gathers the day's articles from Google News, Yahoo Finance, Seeking Alpha and the Fed${S.me.claude ? ', plus what the research analyst cites,' : ''} and sorts them into supporting and against.</p><button class="btn" data-act="run">${I('arrow-clockwise', 16)}Run now</button></div>`; return; }
    const f = S.ev.filter;
    const keep = (x) => (f === 'all' ? true : f === 'saved' ? x.saved : x.stance === f) && (!S.ev.unread || !x.read);
    const days = rv.days.map((d) => ({ ...d, items: d.items.filter(keep) })).filter((d) => d.items.length);
    const counts = (st) => rv.days.reduce((s, d) => s + d.items.filter((x) => x.stance === st).length, 0);
    el.innerHTML = `${balanceChart(rv.days)}
      <div class="filters"><div class="chips" role="group" aria-label="Show">${[['all', 'All', rv.total], ['for', 'Supports', counts('for')], ['against', 'Against', counts('against')], ['context', 'Context', counts('context')], ['saved', 'Saved', rv.saved.length]].map(([v, t, n]) => `<button class="fchip" aria-pressed="${f === v}" data-act="evf" data-v="${v}">${t} <span class="num">${n}</span></button>`).join('')}</div></div>
      <div class="ev-tools"><label class="inline"><span class="switch small"><input type="checkbox" data-act="ev-unread" ${S.ev.unread ? 'checked' : ''}><span></span></span>Unread only (${rv.unread})</label>${rv.unread ? '<button class="link" data-act="ev-allread">Mark all read</button>' : ''}</div>
      ${days.map((d) => `<section class="day"><h2 class="day-h">${esc(relDay(d.date))}<span class="fine">${d.items.length}</span></h2>${d.items.map(articleHtml).join('')}</section>`).join('') || '<p class="empty">Nothing matches this filter.</p>'}
      <p class="foot">${S.me.claude ? 'Sorted by Claude against the claim, with a reason for each.' : 'Auto-sorted by a finance sentiment model and the claim\'s direction.'} Headlines only; open an article to read it at the source.</p>`;
  }
  function articleHtml(x) {
    const [label, ic] = STANCE[x.stance] || STANCE.context;
    const when = x.at ? ago(x.at) : '';
    return `<article class="art ${x.stance}${x.read ? ' read' : ''}">
      <div class="art-top"><span class="art-st">${I(ic, 13)}${label}</span><span class="art-src">${esc(x.source)}${when ? `, ${esc(when)}` : ''}${x.kind === 'social' ? ', social post' : ''}</span></div>
      <a class="art-title" href="${safeUrl(x.url)}" target="_blank" rel="noopener" data-read="${esc(x.key)}">${esc(x.title)}</a>
      ${x.why ? `<p class="art-why">${esc(x.why)}</p>` : ''}
      <div class="art-act"><button class="mini" data-act="ev-save" data-v="${esc(x.key)}" aria-pressed="${x.saved}">${I('star', 14)}${x.saved ? 'Saved' : 'Save'}</button><button class="mini" data-act="ev-read" data-v="${esc(x.key)}" aria-pressed="${x.read}">${I(x.read ? 'eye' : 'check', 14)}${x.read ? 'Mark unread' : 'Mark read'}</button>${x.by === 'claude' || x.by === 'research' ? '<span class="fine">Sorted by Claude</span>' : x.by === 'auto' ? '<span class="fine">Auto-sorted</span>' : ''}</div>
    </article>`;
  }
  async function markArticle(key, patch) {
    const it = S.reading && S.reading.days.flatMap((d) => d.items).find((x) => x.key === key);
    if (it) { if (patch.read !== undefined && it.read !== patch.read) S.reading.unread += patch.read ? -1 : 1; Object.assign(it, patch); if (patch.saved !== undefined) S.reading.saved = S.reading.days.flatMap((d) => d.items).filter((x) => x.saved); }
    try { await api(`/api/scenarios/${S.cur.id}/reading`, { method: 'POST', body: { key, ...patch } }); } catch (err) { toast(err.message, true); }
  }
  function liveHtml(sc, steps) {
    const last = steps.length ? steps[steps.length - 1].who : null;
    const seen = new Set(steps.map((s) => s.who));
    const ai = S.me.claude && (sc.depth || 'deep') !== 'quick';
    const seats = SEATS.filter(([w]) => ai || !['Research', 'Social', 'Judge'].includes(w) || seen.has(w)).filter(([w]) => w !== 'Social' || (sc.depth || 'deep') === 'deep' || seen.has(w));
    return `<section class="live" aria-live="polite"><div class="live-head"><span class="pulse"></span>${sc.status === 'queued' || sc.queued ? 'Queued. The desk works one scenario at a time.' : 'The desk is working'}</div>
      <div class="seats">${seats.map(([w, ic]) => `<div class="seat ${w === last ? 'now' : seen.has(w) ? 'done' : ''}" title="${w}">${I(ic, 20)}<small>${w}</small></div>`).join('')}</div>
      <ol class="steps">${steps.slice(-5).reverse().map((s) => `<li><b>${esc(s.who)}</b>${esc(s.text)}</li>`).join('') || '<li>Starting</li>'}</ol>
      <p class="fine" style="margin-top:10px">${ai ? 'A minute or two.' : 'About a minute.'} You can leave; it keeps going.</p></section>`;
  }
  function chartHtml(sc) {
    return `<section class="block"><div class="chart-head"><h2>Is it coming true?</h2><div class="seg" role="group" aria-label="Time range">${[['1w', '1W'], ['1m', '1M'], ['all', 'All']].map(([v, t]) => `<button aria-pressed="${S.range === v}" data-act="range" data-v="${v}">${t}</button>`).join('')}</div></div>
      <div id="pchart" class="pchart-wrap"></div>
      <div class="legend"><span><i class="key"></i>Desk's call</span>${sc.backfill.length ? '<span><i class="key dash"></i>Price-only replay</span>' : ''}${sc.myCalls.length ? '<span><i class="key dot"></i>Your calls</span>' : ''}</div></section>`;
  }
  function callHtml(sc, my) {
    return `<section class="block"><h2>Your call</h2><div class="panel flat"><div class="slider-row"><input type="range" id="my-call" min="1" max="99" value="${my ?? (sc.latest ? sc.latest.probability : 50)}"><output class="num" id="my-call-v">${my ?? (sc.latest ? sc.latest.probability : 50)}%</output><button class="btn small" data-act="save-call">Save</button></div>
      <p class="fine" style="margin-top:8px">${my !== null ? `You said ${my}% on ${esc(fmtShort(sc.myCalls[sc.myCalls.length - 1].date))}. ` : ''}Your calls are scored against the outcome next to the desk's under You.</p></div></section>`;
  }
  function ladderHtml(run) {
    const q = run.analysts.find((a) => a.id === 'quant');
    if (!q || !q.ladder || q.ladder.length < 3) return '';
    return `<section class="block"><h2>Odds at other levels</h2><p class="fine" style="margin:-6px 0 12px">The same question with a smaller or bigger move, by the numbers alone (the Monte Carlo).</p><div class="ladder">${q.ladder.map((l) => `<div class="lad ${l.claimed ? 'claimed' : ''}"><span class="lad-l">${esc(l.label)}${l.claimed ? ' <small>yours</small>' : ''}</span><span class="lad-bar"><span style="width:${Math.max(1, l.p)}%"></span></span><span class="num lad-p">${l.p < 1 && l.p > 0 ? '<1' : Math.round(l.p)}%</span></div>`).join('')}</div></section>`;
  }
  function changesHtml(sc) {
    const sv = sc.sinceVisit, run = sc.latest;
    const list = sv ? sv.changes : run ? run.changes || [] : [];
    const said = run && run.judge.changed && !/^first run/i.test(run.judge.changed) ? run.judge.changed : '';
    if (!list.length && !said) return '';
    return `<section class="block"><h2>${sv ? `Since you last looked (${esc(fmtShort(sv.from))}, ${sv.fromP}%)` : 'What changed'}</h2>
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
    return `<section class="block"><h2>Coming up</h2><div class="cats">${c.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((x) => `<div class="cat"><div class="cat-d">${esc(x.date ? fmtShort(x.date) : 'TBD')}</div><div><b>${esc(x.event)}</b><p>${esc(x.why)}</p></div></div>`).join('')}</div></section>`;
  }
  function askHtml(sc) {
    const qs = (sc.questions || []).slice().reverse();
    return `<section class="block"><h2>Ask the desk</h2>
      <form id="ask" class="ask-row"><label class="sr" for="f-q">Question</label><div class="with-mic grow"><input id="f-q" name="q" maxlength="600" placeholder="What happened to chip stocks in 2000?" autocomplete="off">${mic('f-q')}</div><button class="btn small">Ask</button></form>
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
    const a = sc.alerts || {};
    const sw = (act, on, label, sub = '') => `<label class="toggle"><span>${label}${sub ? `<small class="fine" style="display:block">${sub}</small>` : ''}</span><span class="switch"><input type="checkbox" data-act="${act}" ${on ? 'checked' : ''}><span></span></span></label>`;
    const depth = sc.depth || 'deep';
    return `<section class="block"><h2>Run options and alerts</h2><div class="panel flat">
      ${S.me.claude ? `<div class="toggle"><span>How deep<small class="fine" style="display:block">${esc(DEPTHS[depth][1])}</small></span><div class="seg" role="radiogroup">${Object.entries(DEPTHS).map(([v, [t]]) => `<button role="radio" aria-checked="${depth === v}" data-act="set-depth" data-v="${v}">${t}</button>`).join('')}</div></div>` : ''}
      <label class="toggle"><span>How often</span><select data-act="schedule" style="width:auto;max-width:56%">${Object.entries(FREQS).map(([v, t]) => `<option value="${v}" ${(sc.schedule || 'daily') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${sw('alert', a.email, 'Email alerts')}
      <label class="toggle"><span>When it moves</span><select data-act="move" style="width:auto">${[3, 5, 10, 15].map((n) => `<option value="${n}" ${a.move === n ? 'selected' : ''}>${n}+ points</option>`).join('')}</select></label>
      <label class="toggle"><span>When it crosses<small class="fine" style="display:block">Your own line, e.g. 50%</small></span><input data-act="cross" inputmode="numeric" maxlength="2" style="width:84px;text-align:right" value="${a.cross ?? ''}" placeholder="off"></label>
      ${sw('flip', a.flip !== false, 'When the verdict changes')}
      ${sw('settle', a.settle !== false, 'When it settles')}
      <div class="btns"><button class="btn small" data-act="run" ${['running', 'queued'].includes(sc.status) ? 'disabled' : ''}>${I('arrow-clockwise', 15)}Run now</button><button class="btn small quiet" data-act="fork">${I('copy', 15)}Fork</button><button class="btn small quiet" data-act="archive">${I('archive', 15)}${sc.archived ? 'Unarchive' : 'Archive'}</button><button class="btn small danger" data-act="delete">${I('trash', 15)}Delete</button></div></div></section>`;
  }
  function drawChart() {
    const el = $('#pchart'); const sc = S.cur;
    if (!el || !sc) return;
    const cut = S.range === '1w' ? 7 : S.range === '1m' ? 31 : 99999;
    const since = new Date(Date.now() - cut * 86400000).toISOString().slice(0, 10);
    const keep = (pts) => pts.filter((p) => p.date >= since);
    const series = [];
    if (sc.backfill.length) series.push({ points: keep(sc.backfill), color: 'var(--series-2)', dashed: true, label: 'Price-only replay' });
    if (sc.myCalls.length) series.push({ points: keep(sc.myCalls), color: 'var(--series-3)', dots: true, label: 'Your call' });
    series.push({ points: keep(sc.history.map((h) => ({ date: h.date, p: h.p }))), color: 'var(--series-1)', label: "Desk's call" });
    Chart.probability(el, series);
  }
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(drawChart, 150); });

  // Build from a scenario (fork) or from a symbol/claim elsewhere.
  function forkPrefill(sc) {
    const th = sc.thesis;
    const t = th && th.target;
    const opts = { depth: sc.depth, schedule: sc.schedule };
    if (!t || t.type === 'none') return { claim: sc.claim, options: opts };
    const move = t.type === 'drawdown' ? 'drawdown' : t.type === 'return' ? (t.direction === 'below' ? 'down' : 'up') : t.type === 'touch' ? (t.direction === 'below' ? 'touchBelow' : 'touchAbove') : t.type === 'close' ? (t.direction === 'below' ? 'below' : 'above') : t.direction === 'below' ? 'trail' : 'beat';
    const value = t.type === 'drawdown' ? Math.round(t.value * 100) : t.type === 'return' ? Math.round(Math.abs(t.value) * 100) : t.type === 'outperform' ? Math.round((t.value || 0) * 100) : t.level;
    return { build: { symbol: th.primary, move, value, vs: t.vs || 'SPY', date: th.horizonDate }, options: opts };
  }

  // ---- people (owner) --------------------------------------------------------------------------------
  async function peopleView() {
    shell('you', backTop('#/you', 'You'), `<div class="intro"><h1>People</h1><p>Everyone can use the data desk. The Claude analysts run on your Claude plan, so you choose who gets them.</p></div><div id="people" class="panel flat" style="margin-top:18px">${skLines(3)}</div>`);
    try {
      const { people } = await api('/api/people');
      $('#people').innerHTML = people.map((u) => `<div class="person"><div><b>${esc(u.name || u.email)}</b>${u.primary ? ' <span class="chip">owner</span>' : ''}<small>${esc(u.email)}, ${u.status === 'unverified' ? 'has not confirmed the email yet' : u.status}${u.scenarios ? `, ${u.scenarios} scenario${u.scenarios > 1 ? 's' : ''}` : ''}</small></div>
        ${u.primary || u.role === 'admin' ? '<span class="fine">Claude on</span>' : `<label class="switch" title="Claude analysts"><input type="checkbox" data-act="claude" data-v="${esc(u.id)}" ${u.claude ? 'checked' : ''} aria-label="Claude analysts for ${esc(u.name)}"><span></span></label>`}</div>`).join('') || '<p class="muted">No one yet.</p>';
    } catch (e) { $('#people').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  async function sourcesView() {
    shell('you', backTop('#/you', 'You'), `<div class="intro"><h1>Data sources</h1><p>Checked from the server. All free; nothing here costs money.</p></div>
      <div id="src" class="panel flat" style="margin-top:18px">${skLines(5)}<p class="fine">Checking each source, up to a minute.</p></div>`);
    try {
      const s = await api('/api/status');
      $('#src').innerHTML = `${s.sources.map((x) => `<div class="src-row"><span class="dot ${x.ok ? '' : 'bad'}"></span><b>${esc(x.name)}</b><span class="muted">${esc(x.detail)}</span></div>`).join('')}
        <p class="fine" style="margin-top:12px">Checked ${esc(ago(s.at))}. Models: ${s.models ? 'Chronos-Bolt and FinBERT from Hugging Face, on the server.' : 'Hugging Face models are not installed yet.'} Daily run at ${esc(s.daily)}. <button class="link" data-act="recheck">Check again</button></p>`;
    } catch (e) { $('#src').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  // ---- actions -----------------------------------------------------------------------------------------
  const patchCur = async (body, msg = 'Saved.') => { try { await api(`/api/scenarios/${S.cur.id}`, { method: 'PATCH', body }); Object.assign(S.cur, body.alerts ? { alerts: { ...S.cur.alerts, ...body.alerts } } : body); toast(msg); } catch (err) { toast(err.message, true); } };
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    if (act === 'go') { if (location.hash === v) render(); else location.hash = v; }
    else if (act === 'mode') { S.mode = v; $('#composer-body').innerHTML = composerBody(); document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v))); wireComposer(); }
    else if (act === 'idea') { const ta = $('#f-claim'); ta.value = v; ta.focus(); }
    else if (act === 'template') { const tp = TEMPLATES[Number(v)]; S.prefill = tp.build ? { build: tp.build } : { claim: tp.claim }; S.mode = tp.build ? 'build' : 'describe'; $('#composer-body').innerHTML = composerBody(); document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === S.mode))); wireComposer(); window.scrollTo(0, 0); }
    else if (act === 'create') create();
    else if (act === 'disc-cat') { S.disc.cat = v; drawDiscover(); }
    else if (act === 'disc-refresh') { try { await api('/api/discover/refresh', { method: 'POST' }); if (S.disc.data) { S.disc.data.refreshing = true; drawDiscover(); } toast('Looking at today\'s posts again. This takes a minute.'); } catch (err) { toast(err.message, true); } }
    else if (act === 'disc-edit') { const c = S.disc.data.claims[Number(v)]; S.prefill = S.me.claude || !c.build ? { claim: c.claim } : { build: c.build }; if (!S.me.claude && !c.build) { S.prefill = { build: { symbol: 'SPY', move: 'drawdown', value: 10, date: '' } }; } location.hash = '#/build'; }
    else if (act === 'disc-test') {
      const c = S.disc.data.claims[Number(v)];
      const body = S.me.claude ? { claim: c.claim, facts: (c.sources || []).map((x) => `${x.where}: ${x.text}`).join('\n') } : c.build ? { build: c.build } : null;
      if (!body) { S.prefill = { build: { symbol: 'SPY', move: 'drawdown', value: 10 } }; location.hash = '#/build'; return; }
      busy(t, true, 'Starting');
      try { const r = await api('/api/scenarios', { method: 'POST', body }); toast('Testing it now.'); location.hash = `#/s/${r.id}`; } catch (err) { busy(t, false); t.innerHTML = `${I('lightning', 14)}Test it`; toast(err.message, true); }
    }
    else if (act === 'mic') toggleMic(t);
    else if (act === 'opt-depth') { document.querySelectorAll('[data-act="opt-depth"]').forEach((b) => b.setAttribute('aria-checked', String(b === t))); $('#depth-help').textContent = DEPTHS[v][1]; }
    else if (act === 'resend') { try { const r = await api('/api/forgot', { method: 'POST', body: { email: v }, anon: true }); toast(r.message); } catch (err) { toast(err.message, true); } }
    else if (act === 'logout') { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; location.hash = '#/today'; render(); }
    else if (act === 'filter') { S.filter = v; document.querySelectorAll('.fchip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); drawList(); }
    else if (act === 'range') { S.range = v; document.querySelectorAll('.seg button[data-act=range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); drawChart(); }
    else if (act === 'evf') { S.ev.filter = v; drawEvidence(); }
    else if (act === 'ev-save') { const it = S.reading.days.flatMap((d) => d.items).find((x) => x.key === v); await markArticle(v, { saved: !it.saved }); drawEvidence(); }
    else if (act === 'ev-read') { const it = S.reading.days.flatMap((d) => d.items).find((x) => x.key === v); await markArticle(v, { read: !it.read }); drawEvidence(); }
    else if (act === 'ev-allread') { try { await api(`/api/scenarios/${S.cur.id}/reading`, { method: 'POST', body: { all: true, read: true } }); toast('All marked read.'); loadEvidence(S.cur.id); } catch (err) { toast(err.message, true); } }
    else if (act === 'toggle') { S.open[v] = !S.open[v]; dashView(S.cur.id, { keep: true }); }
    else if (act === 'run') { try { await api(`/api/scenarios/${S.cur.id}/run`, { method: 'POST' }); S.live[S.cur.id] = []; dashView(S.cur.id, { keep: true }); } catch (err) { toast(err.message, true); } }
    else if (act === 'delete') { if (!confirm('Delete this scenario and its history?')) return; await api(`/api/scenarios/${S.cur.id}`, { method: 'DELETE' }); location.hash = '#/scenarios'; }
    else if (act === 'archive') { await patchCur({ archived: !S.cur.archived }, S.cur.archived ? 'Back in your active list.' : 'Archived. It stops running.'); dashView(S.cur.id, { keep: true }); }
    else if (act === 'fork') { S.prefill = forkPrefill(S.cur); location.hash = '#/build'; }
    else if (act === 'set-depth') { document.querySelectorAll('[data-act="set-depth"]').forEach((b) => b.setAttribute('aria-checked', String(b === t))); await patchCur({ depth: v }, `${DEPTHS[v][0]} from the next run.`); }
    else if (act === 'save-call') { try { const r = await api(`/api/scenarios/${S.cur.id}/call`, { method: 'POST', body: { p: Number($('#my-call').value) } }); S.cur.myCalls = r.myCalls; toast('Your call is saved.'); dashView(S.cur.id, { keep: true }); } catch (err) { toast(err.message, true); } }
    else if (act === 'track') { try { const r = await api('/api/scenarios', { method: 'POST', body: { claim: v, parentId: S.cur.id } }); toast('Tracking it as a new scenario.'); location.hash = `#/s/${r.id}`; } catch (err) { toast(err.message, true); } }
    else if (act === 'track-symbol') { S.prefill = { build: { symbol: v, move: 'drawdown', value: 20, date: inMonths(6) } }; location.hash = '#/build'; }
    else if (act === 'track-claim') { S.prefill = { claim: v }; location.hash = '#/build'; }
    else if (act === 'edit-watch') {
      const cur = (await api('/api/prefs')).watchlist.join(', ');
      $('#watch').insertAdjacentHTML('afterbegin', `<form id="watch-form" class="stack" style="margin-bottom:12px"><div class="field"><label for="f-watch">Tickers, separated by commas (up to 12)</label><input id="f-watch" name="watch" autocapitalize="characters" value="${esc(cur)}"></div><div class="btns" style="margin:0"><button class="btn small">Save</button><button type="button" class="btn small quiet" data-act="go" data-v="#/markets">Cancel</button></div></form>`);
      t.hidden = true;
      $('#f-watch').focus();
      $('#watch-form').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('/api/prefs', { method: 'POST', body: { watchlist: $('#f-watch').value.split(/[\s,]+/).filter(Boolean) } }); toast('Watchlist saved.'); marketsView(); } catch (err) { toast(err.message, true); }
      };
    }
    else if (act === 'share') { try { await navigator.clipboard.writeText(location.href); toast('Link copied. Only you can open it.'); } catch { toast("Couldn't copy the link.", true); } }
    else if (act === 'recheck') { $('#src').innerHTML = skLines(2); await api('/api/status?fresh=1').catch(() => {}); sourcesView(); }
  });
  // Opening an article marks it read (the link still opens normally).
  document.addEventListener('click', (e) => { const a = e.target.closest('a[data-read]'); if (a && S.cur) { markArticle(a.dataset.read, { read: true }); a.closest('.art')?.classList.add('read'); } });
  document.addEventListener('input', (e) => { if (e.target.id === 'my-call') $('#my-call-v').textContent = `${e.target.value}%`; });
  document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'claude') {
      try { await api(`/api/people/${t.dataset.v}`, { method: 'POST', body: { claude: t.checked } }); toast(t.checked ? 'Claude analysts on.' : 'Claude analysts off.'); } catch (err) { t.checked = !t.checked; toast(err.message, true); }
      return;
    }
    if (act === 'digest') { try { await api('/api/prefs', { method: 'POST', body: { digest: t.checked } }); toast(t.checked ? 'Daily digest on.' : 'Daily digest off.'); } catch (err) { toast(err.message, true); } return; }
    if (act === 'sort') { S.sort = t.value; drawList(); return; }
    if (act === 'ev-unread') { S.ev.unread = t.checked; drawEvidence(); return; }
    if (!S.cur) return;
    if (act === 'schedule') return patchCur({ schedule: t.value });
    if (act === 'alert') return patchCur({ alerts: { email: t.checked } });
    if (act === 'move') return patchCur({ alerts: { move: Number(t.value) } });
    if (act === 'flip') return patchCur({ alerts: { flip: t.checked } });
    if (act === 'settle') return patchCur({ alerts: { settle: t.checked } });
    if (act === 'cross') { const v = t.value.trim(); if (v && !(Number(v) >= 1 && Number(v) <= 99)) return toast('Use a number from 1 to 99.', true); return patchCur({ alerts: { cross: v ? Number(v) : null, email: true } }, v ? `You'll get an email if it crosses ${v}%.` : 'Line removed.'); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ask') return;
    e.preventDefault();
    const inp = e.target.querySelector('input'); const q = inp.value.trim(); if (!q) return;
    inp.value = '';
    try { await api(`/api/scenarios/${S.cur.id}/ask`, { method: 'POST', body: { q } }); dashView(S.cur.id, { keep: true }); } catch (err) { toast(err.message, true); }
  });

  // ---- live events --------------------------------------------------------------------------------------------
  let es = null;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    let pending = null;
    const refresh = () => { clearTimeout(pending); pending = setTimeout(() => { const [r0, r1] = route(); if (r0 === 's' && r1) dashView(r1, { keep: true }); else if (r0 === 'scenarios') scenariosView(); else if (r0 === 'today') todayView(); }, 300); };
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      const [r0, r1] = route();
      if (ev.event === 'progress') {
        (S.live[ev.id] = S.live[ev.id] || []).push(ev.step);
        if (r0 === 's' && r1 === ev.id) { const box = $('.live'); if (box && S.cur) box.outerHTML = liveHtml(S.cur, S.live[ev.id]); else refresh(); }
      } else if (ev.event === 'scenario') {
        if (ev.done) { S.live[ev.id] = []; if (r0 === 's' && r1 === ev.id) toast('New reading in.'); }
        if ((r0 === 's' && r1 === ev.id) || r0 === 'scenarios' || r0 === 'today') refresh();
      } else if (ev.event === 'qstep') {
        S.live[`q:${ev.qid}`] = ev.text;
        const el = document.querySelector(`[data-qid="${ev.qid}"] .qtext`); if (el) el.textContent = ev.text;
      } else if (ev.event === 'question') { if (r0 === 's' && r1 === ev.id) refresh(); }
      else if (ev.event === 'discover') { if (r0 === 'discover') discoverView(); }
    };
    es.onerror = () => { es.close(); es = null; setTimeout(() => { if (S.me) connect(); }, 5000); };
  }

  boot();
})();
