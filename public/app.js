// Reinvent: the feed of reinvented products. Vanilla JS, hash routes.
(function () {
  'use strict';
  const MODEL_HINT = { haiku: 'Fastest and lightest on your plan, less depth', sonnet: 'The balance of depth and speed', opus: 'Thinks deepest but uses your plan fastest' };
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const I = (n, s = 20, c = '') => window.Icon(n, s, c);
  const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? esc(u) : '#');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const inMin = (t) => { const m = Math.round((t - Date.now()) / 60000); return m <= 1 ? 'in a minute' : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`; };
  const money = (v, d) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '-' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: d ?? (Math.abs(v) < 100 ? 2 : 0), maximumFractionDigits: d ?? (Math.abs(v) < 100 ? 2 : 0) })}`);
  const S = { me: null, posts: [], more: false, loading: false, live: null, info: {}, sheet: null, newCount: 0 };

  async function api(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !opts.anon) { S.me = null; render(); throw new Error(j.error || 'Sign in to continue.'); }
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status}).`), { data: j, status: r.status });
    return j;
  }
  let toastT;
  function toast(msg, bad) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function busy(b, on, label) { if (!b) return; if (on) { b.dataset.label = b.innerHTML; b.disabled = true; b.innerHTML = `<span class="spin"></span>${label ? ` ${esc(label)}` : ''}`; } else { b.disabled = false; if (b.dataset.label) b.innerHTML = b.dataset.label; } }

  // ---- routing ------------------------------------------------------------------------------
  const route = () => (location.hash.replace(/^#\/?/, '') || 'feed').split('/');
  window.addEventListener('hashchange', () => render());
  async function boot() {
    try { const s = await api('/api/session', { anon: true }); S.me = s.authed && s.allowed ? { ...s.user, claude: s.claude, owner: s.owner } : null; } catch { S.me = null; }
    if (S.me) connect();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (S.me && window.InstallBanner) InstallBanner.offer({ name: 'Reinvent', icon: '/icon-180.png', above: '.nav', fresh: !!S.fresh, theme: { bg: 'var(--sheet)', ink: 'var(--ink)', muted: 'var(--ink-2)', line: 'var(--line)', accent: 'var(--accent)', onAccent: 'var(--accent-ink)' } });
    S.fresh = false;
  }
  function render() {
    const [r0, r1] = route();
    closeSheet(true);
    if (r0 === 'reset') return resetView(r1);
    if (!S.me) return r0 === 'signup' ? signupView() : r0 === 'forgot' ? forgotView() : loginView();
    if (r0 === 'saved') return savedView();
    if (r0 === 'studio') return studioView();
    if (r0 === 'people' && S.me.owner) return peopleView();
    return feedView();
  }
  const nav = (tab) => `<nav class="nav" aria-label="Main">${[['feed', 'Feed', 'house'], ['saved', 'Saved', 'bookmark-simple'], ['studio', 'Studio', 'flask']].map(([id, label, ic]) => `<a href="#/${id}" ${tab === id ? 'aria-current="page"' : ''}>${I(ic, 24)}<span>${label}</span></a>`).join('')}</nav>`;
  const mark = () => `<span class="brand-mark">${I('lightbulb', 18)}</span>`;

  // ---- accounts -----------------------------------------------------------------------------
  function authShell(title, lede, body, alt = '') {
    app.innerHTML = `<main class="auth fade-in"><div class="auth-mark">${I('lightbulb', 28)}</div><div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${body}${alt ? `<p class="alt">${alt}</p>` : ''}</main>`;
  }
  const field = (name, label, type = 'text', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" ${extra}><div class="err" id="e-${name}"></div></div>`;
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const inboxHelp = (email) => `<p class="fine">Nothing after a couple of minutes? Look in Spam and Promotions. Links work for 24 hours; asking again doesn't cancel the first one.</p><button type="button" class="btn quiet small" data-act="resend" data-v="${esc(email)}">${I('arrows-clockwise', 16)}Send it again</button>`;
  function loginView() {
    authShell('Reinvent', 'Every half hour, one everyday product and three ways to reinvent it, researched by AI agents, with China sourcing and margins for any design you like.', `
      <div class="how3">
        <div>${I('magnifying-glass', 20)}<span><b>A Scout researches a real product</b>How it works, what people hate about it, and what has been tried.</span></div>
        <div>${I('lightbulb', 20)}<span><b>Three inventors reinvent it</b>An engineer, a designer and a futurist, each with a different method, each with a concept sketch.</span></div>
        <div>${I('factory', 20)}<span><b>Make it</b>Unit cost, price, margin and where in China to have it made.</span></div>
      </div>
      <form id="login" class="stack" novalidate>
        ${field('email', 'Email', 'email', 'autocomplete="username" inputmode="email" required')}
        ${field('password', 'Password', 'password', 'autocomplete="current-password" required')}
        <div id="login-note"></div>
        <button class="btn block">Sign in</button>
        <button type="button" class="link" data-act="go" data-v="#/forgot">Forgot your password?</button>
      </form>`, `New here? <a href="#/signup">Create an account</a>`);
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, email = f.email.value.trim(), password = f.password.value;
      if (!validEmail(email) || !password) { $('#login-note').innerHTML = '<div class="notice bad">Enter your email and password.</div>'; return; }
      const b = f.querySelector('.btn'); busy(b, true, 'Signing in');
      try { await api('/api/login', { method: 'POST', body: { email, password }, anon: true }); S.fresh = true; location.hash = '#/feed'; await boot(); }
      catch (err) { busy(b, false); $('#login-note').innerHTML = `<div class="notice bad">${esc(err.message)}${/link we emailed|confirm/i.test(err.message) ? ` <button type="button" class="link" data-act="resend" data-v="${esc(email)}">Send the link again</button>` : ''}</div>`; }
    };
  }
  function signupView() {
    authShell('Create your account', 'We email you a link to confirm your address and choose a password.', `<form id="signup" class="stack" novalidate>
      ${field('firstName', 'First name', 'text', 'autocomplete="given-name" required')}
      ${field('email', 'Email', 'email', 'autocomplete="email" inputmode="email" required')}
      <button class="btn block">Create account</button></form>`, 'Already have one? <a href="#/feed">Sign in</a>');
    $('#signup').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, firstName = f.firstName.value.trim(), email = f.email.value.trim();
      $('#e-firstName').textContent = firstName ? '' : 'Add your first name.';
      $('#e-email').textContent = validEmail(email) ? '' : 'Enter a valid email address.';
      if (!firstName || !validEmail(email)) return;
      const b = f.querySelector('.btn'); busy(b, true, 'Creating');
      try { const r = await api('/api/signup', { method: 'POST', body: { firstName, email }, anon: true }); authShell('Check your inbox', esc(r.message), `<div class="stack">${inboxHelp(email)}</div>`, '<a href="#/signup">Use a different email</a>'); }
      catch (err) { if (err.data && err.data.saved) return authShell('Almost there', esc(err.message), `<div class="stack">${inboxHelp(email)}</div>`); busy(b, false); $('#e-email').textContent = err.message; }
    };
  }
  function forgotView() {
    authShell('Reset your password', 'Enter your email and we send a link to choose a new one.', `<form id="forgot" class="stack" novalidate>${field('email', 'Email', 'email', 'autocomplete="email" inputmode="email"')}<button class="btn block">Send the link</button></form>`, '<a href="#/feed">Back to sign in</a>');
    $('#forgot').onsubmit = async (e) => {
      e.preventDefault();
      const email = e.target.email.value.trim();
      if (!validEmail(email)) { $('#e-email').textContent = 'Enter a valid email address.'; return; }
      try { const r = await api('/api/forgot', { method: 'POST', body: { email }, anon: true }); authShell('Check your inbox', esc(r.message), `<div class="stack">${inboxHelp(email)}</div>`, '<a href="#/feed">Back to sign in</a>'); } catch (err) { $('#e-email').textContent = err.message; }
    };
  }
  async function resetView(token) {
    let info = { valid: false };
    try { info = await api(`/api/reset?token=${encodeURIComponent(token || '')}`, { anon: true }); } catch {}
    if (!info.valid) return authShell('This link has expired', 'Links work for 24 hours. Ask for a fresh one.', '<a class="btn block" href="#/forgot">Send a new link</a>');
    authShell('Choose a password', `For <b>${esc(info.email)}</b>. At least 8 characters.`, `<form id="reset" class="stack" novalidate>${field('pw', 'New password', 'password', 'autocomplete="new-password" minlength="8"')}${field('pw2', 'Type it again', 'password', 'autocomplete="new-password"')}<button class="btn block">Save and sign in</button></form>`);
    $('#reset').onsubmit = async (e) => {
      e.preventDefault();
      const pw = e.target.pw.value, pw2 = e.target.pw2.value;
      if (pw.length < 8) { $('#e-pw').textContent = 'Use at least 8 characters.'; return; }
      if (pw !== pw2) { $('#e-pw2').textContent = "The two passwords don't match."; return; }
      try {
        await api('/api/reset', { method: 'POST', body: { token, password: pw }, anon: true });
        await api('/api/login', { method: 'POST', body: { email: info.email, password: pw }, anon: true }).catch(() => {});
        S.fresh = true; location.hash = '#/feed'; await boot(); toast('You are in.');
      } catch (err) { $('#e-pw').textContent = err.message; }
    };
  }

  // ---- the feed ------------------------------------------------------------------------------
  function livePill() {
    const l = S.live, i = S.info || {};
    if (l) return `<button class="livepill" data-act="go" data-v="#/studio"><span class="pulse"></span><span>${esc(l.activity ? `${l.label.split(' is ')[0]}: ${l.activity}` : l.label)}</span></button>`;
    if (i.paused) return '<button class="livepill" data-act="go" data-v="#/studio"><span>Studio paused</span></button>';
    if (i.nextRunAt) return `<button class="livepill" data-act="go" data-v="#/studio">${I('clock', 14)}<span>Next product ${inMin(i.nextRunAt)}</span></button>`;
    return '';
  }
  function drawLive() { const el = $('#livepill'); if (el) el.innerHTML = livePill(); }
  async function feedView() {
    app.innerHTML = `<header class="top"><a class="brand" href="#/feed">${mark()}<span>Reinvent</span></a><span class="spacer"></span><span id="livepill">${livePill()}</span></header>
      <div class="newbar" id="newbar" hidden><button class="btn small accent" data-act="fresh">${I('sparkle', 16)}New product</button></div>
      <main class="feed" id="feed"><section class="post"><div class="slide"><div class="card"><div class="visual sk"></div><div class="body"><div class="sk" style="height:14px;width:40%"></div><div class="sk" style="height:26px;width:70%"></div><div class="sk" style="height:14px"></div></div></div></div></section></main>${nav('feed')}`;
    S.newCount = 0;
    await loadFeed(true);
  }
  async function loadFeed(reset) {
    if (S.loading) return;
    S.loading = true;
    try {
      const before = !reset && S.posts.length ? S.posts[S.posts.length - 1].createdAt : '';
      const r = await api(`/api/feed?limit=6${before ? `&before=${before}` : ''}`);
      S.info = r; S.live = r.live; drawLive();
      S.posts = reset ? r.posts : [...S.posts, ...r.posts];
      S.more = r.more;
      const feed = $('#feed'); if (!feed) return;
      if (reset) feed.innerHTML = '';
      if (!S.posts.length) { feed.innerHTML = emptyFeed(r); return; }
      feed.insertAdjacentHTML('beforeend', r.posts.map(postHtml).join(''));
      wireSlides(feed);
      watchEnd();
    } catch (e) { const feed = $('#feed'); if (feed && reset) feed.innerHTML = `<div class="empty">${I('warning-circle', 32)}<b>Couldn't load the feed</b>${esc(e.message)}</div>`; }
    finally { S.loading = false; }
  }
  function emptyFeed(r) {
    return `<div class="empty" style="padding-top:calc(120px + var(--sat))">${I('flask', 40)}<b>The studio is warming up</b><p>${r.live ? esc(r.live.label) : r.paused ? 'The studio is paused.' : `The first product arrives ${r.nextRunAt ? inMin(r.nextRunAt) : 'soon'}.`} Each one takes the Scout and the three inventors 10 to 20 minutes.</p>${S.me.owner ? '<button class="btn" data-act="run-now">Research one now</button>' : ''}</div>`;
  }
  function postHtml(p) {
    const invs = p.inventions || [];
    const pr = p.product;
    const orig = `<div class="slide"><article class="card">
        <div class="visual ${p.image ? 'photo' : ''}">${p.image ? `<img src="${esc(p.image.src)}" alt="${esc(pr.name)}" loading="lazy">${p.image.credit ? `<a class="credit" href="${safeUrl(p.image.source)}" target="_blank" rel="noopener">${esc(p.image.credit)}</a>` : ''}` : p.sketch ? `<img src="${esc(p.sketch)}" alt="${esc(pr.name)}" loading="lazy">` : ''}<span class="tag">The original</span></div>
        <div class="body"><div class="kicker">${esc(pr.category || p.category || '')}${pr.priceRange ? `<span>·</span><span>${esc(pr.priceRange)}</span>` : ''}</div>
          <h2>${esc(pr.name)}</h2><p class="tagline">${esc(pr.oneLiner)}</p>
          ${pr.pains.length ? `<div class="pains">${pr.pains.slice(0, 2).map((x) => `<div><span>${esc(x)}</span></div>`).join('')}</div>` : ''}</div>
        <div class="cardbar"><button class="btn small quiet" data-act="dossier" data-v="${p.id}">${I('info', 16)}Research</button><button class="iconbtn" data-act="chat" data-v="${p.id}" aria-label="Talk about it">${I('chat-circle-dots', 22)}</button><span class="spacer"></span><span class="fine count">${invs.length} reinvention${invs.length === 1 ? '' : 's'}${I('caret-right', 14)}</span></div>
      </article></div>`;
    const slides = invs.map((inv, k) => `<div class="slide"><article class="card" style="--agent:${esc(inv.agent.color)}">
        <div class="visual">${inv.sketch ? `<img src="${esc(inv.sketch)}" alt="Concept sketch of ${esc(inv.title)}" loading="lazy">` : `<div class="fine">No sketch</div>`}<span class="tag inv">${esc(inv.agent.name)} · ${esc(inv.agent.role.replace(/^The /, ''))}</span></div>
        <div class="body"><div class="kicker"><span>Reinvention ${k + 1} of ${invs.length}</span>${inv.priceHint ? `<span>·</span><span>${esc(inv.priceHint)}</span>` : ''}</div>
          <h2>${esc(inv.title)}</h2><p class="tagline">${esc(inv.tagline)}</p>
          ${inv.whyBetter.length ? `<div class="chips">${inv.whyBetter.map((w) => `<span class="chip metric">${esc(w.metric || w.claim)}</span>`).join('')}</div>` : ''}</div>
        <div class="cardbar"><button class="btn small" data-act="detail" data-v="${p.id}:${inv.id}">Details</button><button class="iconbtn" data-act="chat" data-v="${p.id}" aria-label="Talk about it">${I('chat-circle-dots', 22)}</button><span class="spacer"></span>${saveBtn(inv)}</div>
      </article></div>`).join('');
    const note = p.round && p.round.by === 'feedback' && p.round.feedback ? `<div class="roundnote">${I('sparkle', 14)}Round ${p.round.n}, from your note: “${esc(p.round.feedback.slice(0, 80))}${p.round.feedback.length > 80 ? '…' : ''}”</div>` : '';
    return `<section class="post" data-post="${p.id}">${note}<div class="slides" data-slides>${orig}${slides}</div><div class="dots">${[0, ...invs.map(() => 1)].map((x, i) => `<i class="${x ? 'inv' : ''}${i === 0 ? ' on' : ''}"></i>`).join('')}</div></section>`;
  }
  const saveBtn = (inv) => `<button class="save" data-act="save" data-v="${inv.id}" aria-pressed="${!!inv.saved}" aria-label="${inv.saved ? 'Saved' : 'Save'}">${I(inv.saved ? 'bookmark-simple-fill' : 'bookmark-simple', 22)}</button>`;
  function wireSlides(root) {
    root.querySelectorAll('[data-slides]').forEach((el) => {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('scroll', () => {
        const k = Math.round(el.scrollLeft / el.clientWidth);
        el.parentElement.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === k));
      }, { passive: true });
    });
  }
  let io;
  function watchEnd() {
    if (io) io.disconnect();
    if (!S.more) return;
    const last = [...document.querySelectorAll('.post')].pop();
    if (!last) return;
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); loadFeed(false); } }, { root: $('#feed'), rootMargin: '0px 0px 200% 0px' });
    io.observe(last);
  }
  async function refreshPost(id) {
    const el = document.querySelector(`.post[data-post="${id}"]`);
    if (!el) return;
    try {
      const p = await api(`/api/posts/${id}`);
      const keep = el.querySelector('[data-slides]').scrollLeft;
      const i = S.posts.findIndex((x) => x.id === id); if (i >= 0) S.posts[i] = p;
      el.outerHTML = postHtml(p);
      const fresh = document.querySelector(`.post[data-post="${id}"]`);
      wireSlides(fresh.parentElement);
      fresh.querySelector('[data-slides]').scrollLeft = keep;
    } catch {}
  }

  // ---- sheets -----------------------------------------------------------------------------
  function openSheet({ title, body, foot = '', short = false, onClose }) {
    closeSheet(true);
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('section'); sh.className = `sheet${short ? ' short' : ''}`; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = `<span class="grab"></span><div class="sheet-head"><h3>${title}</h3><button class="iconbtn" data-act="close" aria-label="Close">${I('x', 22)}</button></div><div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
    document.body.append(scrim, sh);
    requestAnimationFrame(() => { scrim.classList.add('in'); sh.classList.add('in'); });
    scrim.onclick = () => closeSheet();
    S.sheet = { el: sh, scrim, onClose };
    return sh;
  }
  function closeSheet(now) {
    const s = S.sheet; if (!s) return;
    S.sheet = null;
    if (s.onClose) try { s.onClose(); } catch {}
    s.el.classList.remove('in'); s.scrim.classList.remove('in');
    setTimeout(() => { s.el.remove(); s.scrim.remove(); }, now ? 0 : 350);
  }

  // A reinvention in full, then how to make it.
  async function openDetail(postId, invId) {
    const sh = openSheet({ title: 'Reinvention', body: '<div class="hero sk"></div><div class="sk" style="height:28px;margin-top:16px;width:70%"></div><div class="sk" style="height:60px;margin-top:10px"></div>' });
    let p;
    try { p = await api(`/api/posts/${postId}`); } catch (e) { sh.querySelector('.sheet-body').innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const r = p.allRounds.find((x) => x.inventions.some((i) => i.id === invId));
    const inv = r && r.inventions.find((i) => i.id === invId);
    if (!inv) { sh.querySelector('.sheet-body').innerHTML = '<p>This design is no longer here.</p>'; return; }
    S.sheet.kind = { type: 'detail', postId, invId };
    sh.style.setProperty('--agent', inv.agent.color);
    sh.querySelector('.sheet-head h3').textContent = inv.title;
    sh.querySelector('.sheet-head').insertAdjacentHTML('beforeend', '');
    sh.querySelector('.sheet-body').innerHTML = detailHtml(p, r, inv);
    drawMake(inv);
  }
  function detailHtml(p, r, inv) {
    const sec = (title, html, ic) => (html ? `<div class="sec"><h3>${ic ? I(ic, 14) : ''}${title}</h3>${html}</div>` : '');
    const ul = (xs) => (xs && xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    return `<div class="hero">${inv.sketch ? `<img src="${esc(inv.sketch)}" alt="Concept sketch of ${esc(inv.title)}">` : ''}</div>
      <div class="dhead"><span class="agent"><span class="av">${esc(inv.agent.name[0])}</span>${esc(inv.agent.name)}, ${esc(inv.agent.role.toLowerCase())} · ${esc(inv.agent.method)}</span><h2>${esc(inv.title)}</h2><p>${esc(inv.tagline)}</p>
        <div style="display:flex;gap:8px;margin-top:6px">${saveBtn(inv)}<button class="btn small quiet" data-act="chat" data-v="${p.id}">${I('chat-circle-dots', 16)}Talk about it</button></div></div>
      <p class="fine" style="margin-top:12px">A reinvention of <b>${esc(p.product.name)}</b>, round ${r.n}${r.feedback ? ` from your note “${esc(r.feedback.slice(0, 120))}”` : ''}.</p>
      ${sec('The insight', `<div class="insight">${esc(inv.insight)}</div>`, 'lightbulb')}
      ${sec('What changes', ul(inv.changes))}
      ${sec('How it works', `<p>${esc(inv.howItWorks)}</p>`)}
      ${inv.whyBetter.length ? sec('Why it is better', `<div class="metrics">${inv.whyBetter.map((w) => `<div class="metric"><b>${esc(w.metric || '')}</b><span>${esc(w.claim)}</span></div>`).join('')}</div>`) : ''}
      ${sec('Materials', `<p>${esc(inv.materials)}</p>`)}
      ${sec('How it is made', `<p>${esc(inv.manufacturing)}</p>`, 'factory')}
      ${sec('Who buys it first', `<p>${esc(inv.targetCustomer)}</p>`)}
      ${sec('Rough numbers', `<dl class="kv"><dt>Retail</dt><dd>${esc(inv.priceHint || '-')}</dd><dt>Cost to make</dt><dd>${esc(inv.unitCostHint || '-')}</dd></dl>`, 'currency-dollar')}
      ${sec('Is it new?', `${inv.novelty.verdict ? `<p>${esc(inv.novelty.verdict)}</p>` : ''}${inv.novelty.closest.length ? `<div class="refs" style="margin-top:10px">${inv.novelty.closest.map((c) => `<a class="ref" href="${safeUrl(c.url)}" target="_blank" rel="noopener"><b>${esc(c.name)}</b>${esc(c.how)}${c.url ? `<small>${esc(host(c.url))}</small>` : ''}</a>`).join('')}</div>` : ''}`, 'magnifying-glass')}
      ${sec('Risks', ul(inv.risks), 'warning-circle')}
      ${inv.considered.length ? sec(`How ${esc(inv.agent.name)} got here`, `<ul class="considered">${inv.considered.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`) : ''}
      <div class="make" id="make"></div>
      ${inv.sources.length ? sec('Sources', `<div class="refs">${inv.sources.map((s) => `<a class="ref" href="${safeUrl(s.url)}" target="_blank" rel="noopener"><b>${esc(s.title)}</b><small>${esc(host(s.url))}</small></a>`).join('')}</div>`) : ''}`;
  }
  function drawMake(inv) {
    const el = $('#make'); if (!el) return;
    const s = inv.sourcing;
    const intro = `<h3>${I('factory', 22)}Make it</h3>`;
    if (!s || s.status === 'error') {
      el.innerHTML = `${intro}<p>What it would cost to make in China, who could make it, what it could sell for and the margin. Researched by the sourcing analyst in 5 to 10 minutes.</p>${s && s.status === 'error' ? `<div class="notice bad" style="margin-bottom:12px">Last try failed: ${esc(s.error || 'unknown error')}</div>` : ''}${S.me.claude ? `<button class="btn accent block" data-act="sourcing" data-v="${inv.id}">${I('factory', 18)}Get the sourcing and cost report</button>` : '<p class="fine">Ask the owner to turn on studio access for you to request reports.</p>'}`;
      return;
    }
    if (s.status === 'queued' || s.status === 'running') {
      const l = S.live && S.live.invId === inv.id ? S.live : null;
      el.innerHTML = `${intro}<div class="progress"><span class="spin"></span><span>${s.status === 'queued' ? 'Waiting for the studio (one job at a time)' : 'The sourcing analyst is researching'}<small>${esc(l && l.activity ? l.activity : 'factories, prices, freight and duty')}</small></span></div>`;
      return;
    }
    el.innerHTML = `${intro}${sourcingHtml(s.report)}<p class="fine" style="margin-top:14px">Researched ${esc(ago(s.at))}. Estimates: confirm with suppliers before you commit money. ${S.me.claude ? `<button class="link" data-act="sourcing-again" data-v="${inv.id}">Research again</button>` : ''}</p>`;
  }
  function sourcingHtml(r) {
    const u1 = r.unitCost.at1k || {}, u10 = r.unitCost.at10k || {};
    const sec = (title, html, ic) => (html ? `<div class="sec"><h3>${ic ? I(ic, 14) : ''}${title}</h3>${html}</div>` : '');
    return `<p style="color:var(--ink-2);margin-bottom:14px">${esc(r.summary)}</p>
      <div class="tiles">
        <div class="tile"><small>Cost / unit at 1k</small><b class="num">${money(u1.total)}</b><span>materials ${money(u1.materials)}</span></div>
        <div class="tile"><small>Cost / unit at 10k</small><b class="num">${money(u10.total)}</b><span>processing ${money(u10.processing)}</span></div>
        <div class="tile"><small>Landed (10k)</small><b class="num">${money(r.landed.landedAt10k)}</b><span>freight ${money(r.landed.freightPerUnit)}/unit</span></div>
        <div class="tile"><small>Retail</small><b class="num">${money(r.pricing.retail)}</b><span>wholesale ${money(r.pricing.wholesale)}</span></div>
        <div class="tile hi"><small>Margin at retail</small><b class="num">${r.pricing.marginRetailPct !== null ? `${Math.round(r.pricing.marginRetailPct)}%` : '-'}</b><span>after ${money(r.pricing.channelFeesPerUnit)} fees</span></div>
        <div class="tile hi"><small>Margin wholesale</small><b class="num">${r.pricing.marginWholesalePct !== null ? `${Math.round(r.pricing.marginWholesalePct)}%` : '-'}</b><span>${esc(r.moq ? `MOQ ${r.moq}` : '')}</span></div>
      </div>
      ${r.profitExample ? `<div class="insight" style="margin-top:12px">${esc(r.profitExample)}</div>` : ''}
      ${r.pricing.note ? `<p class="fine" style="margin-top:8px">${esc(r.pricing.note)}</p>` : ''}
      ${r.oneTime.length ? sec('One-time costs', `<table class="t"><tbody>${r.oneTime.map((o) => `<tr><td>${esc(o.item)}</td><td class="r num">${money(o.cost, 0)}</td></tr>`).join('')}</tbody></table>`, 'currency-dollar') : ''}
      ${r.bom.length ? sec('Bill of materials', `<table class="t"><thead><tr><th>Part</th><th>Material / process</th><th class="r">Unit</th></tr></thead><tbody>${r.bom.map((b) => `<tr><td>${esc(b.part)}</td><td>${esc([b.material, b.process].filter(Boolean).join(', '))}</td><td class="r num">${money(b.unitCost)}</td></tr>`).join('')}</tbody></table>`, 'package') : ''}
      ${r.productionRoute.length ? sec('How it gets made', `<ol style="margin:0;padding-left:20px;display:grid;gap:6px">${r.productionRoute.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`, 'factory') : ''}
      ${r.clusters.length ? sec('Where in China', `<div class="refs">${r.clusters.map((c) => `<div class="ref"><b>${I('map-pin', 14)} ${esc(c.place)}</b>${esc(c.why)}</div>`).join('')}</div>`, 'globe-hemisphere-east') : ''}
      ${r.suppliers.length ? sec('Suppliers to contact', `<div class="refs">${r.suppliers.map((s) => `<a class="ref" href="${safeUrl(s.url)}" target="_blank" rel="noopener"><b>${esc(s.name)}${s.city ? ` · ${esc(s.city)}` : ''}</b>${esc(s.makes)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</a>`).join('')}</div>`, 'factory') : ''}
      ${r.searchLinks.length ? sec('Search the marketplaces', `<div class="chips">${r.searchLinks.map((s) => `<a class="chip" href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.site)} ${I('arrow-up-right', 12)}</a>`).join('')}</div>`, 'magnifying-glass') : ''}
      ${sec('Timing', `<dl class="kv">${r.moq ? `<dt>MOQ</dt><dd>${esc(r.moq)}</dd>` : ''}${r.leadTime ? `<dt>Lead time</dt><dd>${esc(r.leadTime)}</dd>` : ''}${r.landed.dutyRate ? `<dt>US duty</dt><dd>${esc(r.landed.dutyRate)}</dd>` : ''}</dl>`, 'clock')}
      ${r.certifications.length ? sec('Certifications', `<ul>${r.certifications.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, 'certificate') : ''}
      ${r.ipCheck.note ? sec('Patents and designs', `<p>${esc(r.ipCheck.note)}</p>${r.ipCheck.links.length ? `<div class="chips" style="margin-top:8px">${r.ipCheck.links.map((u) => `<a class="chip" href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(host(u))} ${I('arrow-up-right', 12)}</a>`).join('')}</div>` : ''}`, 'scales') : ''}
      ${r.nextSteps.length ? sec('Next steps', `<ol style="margin:0;padding-left:20px;display:grid;gap:6px">${r.nextSteps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`, 'check') : ''}
      ${r.confidence ? `<p class="fine" style="margin-top:12px">Confidence: ${esc(r.confidence)}</p>` : ''}
      ${r.sources.length ? sec('Sources', `<div class="refs">${r.sources.map((s) => `<a class="ref" href="${safeUrl(s.url)}" target="_blank" rel="noopener"><b>${esc(s.title)}</b><small>${esc(host(s.url))}</small></a>`).join('')}</div>`) : ''}`;
  }

  // The Scout's research on the original product, and every round.
  async function openDossier(postId) {
    const sh = openSheet({ title: 'The original', body: '<div class="hero sk"></div>' });
    let p;
    try { p = await api(`/api/posts/${postId}`); } catch (e) { sh.querySelector('.sheet-body').innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const d = p.product;
    sh.querySelector('.sheet-head h3').textContent = d.name;
    const sec = (title, html) => (html ? `<div class="sec"><h3>${title}</h3>${html}</div>` : '');
    const ul = (xs) => (xs && xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    sh.querySelector('.sheet-body').innerHTML = `<div class="hero ${p.image ? 'photo' : ''}">${p.image ? `<img src="${esc(p.image.src)}" alt="${esc(d.name)}">` : p.sketch ? `<img src="${esc(p.sketch)}" alt="">` : ''}</div>
      ${p.image && p.image.credit ? `<p class="fine" style="margin-top:6px">Photo: <a href="${safeUrl(p.image.source)}" target="_blank" rel="noopener">${esc(p.image.credit)}</a></p>` : ''}
      <div class="dhead"><h2>${esc(d.name)}</h2><p>${esc(d.oneLiner)}</p></div>
      ${sec('How it works', `<p>${esc(d.howItWorks)}</p>`)}
      ${sec('What people complain about', d.pains.length ? `<div class="refs">${d.pains.map((x) => `<a class="ref" href="${safeUrl(x.url)}" target="_blank" rel="noopener"><b>${esc(x.pain)}</b>${x.evidence ? `“${esc(x.evidence)}”` : ''}${x.url ? `<small>${esc(host(x.url))}</small>` : ''}</a>`).join('')}</div>` : '')}
      ${sec('Already tried', d.priorArt.length ? `<div class="refs">${d.priorArt.map((x) => `<a class="ref" href="${safeUrl(x.url)}" target="_blank" rel="noopener"><b>${esc(x.name)}</b>${esc(x.what)}${x.url ? `<small>${esc(host(x.url))}</small>` : ''}</a>`).join('')}</div>` : '')}
      ${sec('The market', `<dl class="kv"><dt>Price</dt><dd>${esc(d.priceRange || '-')}</dd><dt>Brands</dt><dd>${esc(d.brands.join(', ') || '-')}</dd><dt>Size</dt><dd>${esc(d.market || '-')}</dd></dl>`)}
      ${sec('Parts', ul(d.parts))}${sec('Materials', ul(d.materials))}${sec('How it is made', `<p>${esc(d.manufacturing)}</p>`)}${sec('Constraints', ul(d.constraints))}
      ${sec('Every round', `<div class="invlist">${p.allRounds.slice().reverse().map((r) => `<p class="fine">Round ${r.n}${r.feedback ? ` · from your note “${esc(r.feedback.slice(0, 70))}”` : ''} · ${esc(ago(r.at))}</p>${r.inventions.map((i) => `<button class="invrow" data-act="detail" data-v="${p.id}:${i.id}">${i.sketch ? `<img src="${esc(i.sketch)}" alt="">` : '<span></span>'}<span><b>${esc(i.title)}</b><small>${esc(i.agent.name)}, ${esc(i.agent.role.toLowerCase())}</small></span>${I('caret-right', 18)}</button>`).join('')}`).join('')}</div>`)}
      ${d.sources.length ? sec('Sources', `<div class="refs">${d.sources.map((s) => `<a class="ref" href="${safeUrl(s.url)}" target="_blank" rel="noopener"><b>${esc(s.title)}</b><small>${esc(host(s.url))}</small></a>`).join('')}</div>`) : ''}
      ${S.me.owner ? `<p style="margin-top:22px"><button class="link" data-act="remove-post" data-v="${p.id}">Remove this product</button></p>` : ''}`;
  }

  // Talk to the studio about one product; feedback starts a new round.
  let chatPoll;
  async function openChat(postId) {
    const sh = openSheet({ title: 'Talk to the studio', body: '<div class="msgs" id="msgs"></div>', foot: S.me.claude ? `<div class="chips-row" id="chatchips"></div><form class="composer" id="chatform"><textarea id="chattext" rows="1" placeholder="Ask or suggest a change" maxlength="2000"></textarea><button class="btn" aria-label="Send">${I('paper-plane-right', 20)}</button></form><p class="fine" style="margin-top:6px">Send to talk it through. <button class="link" data-act="round-from-text" data-v="${postId}">Start a new round with this</button> to have the inventors redesign it.</p>` : '<p class="fine">Talking to the studio uses the owner\'s Claude plan. Ask the owner to turn it on for you.</p>', onClose: () => clearInterval(chatPoll) });
    S.sheet.kind = { type: 'chat', postId };
    const chips = ['What would you change first?', 'Make it cheaper to manufacture', 'Design it for kids', 'Which of the three has the best margin?'];
    const cc = $('#chatchips'); if (cc) cc.innerHTML = chips.map((c) => `<button type="button" data-act="chip" data-v="${esc(c)}">${esc(c)}</button>`).join('');
    const f = $('#chatform');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const ta = $('#chattext'), text = ta.value.trim(); if (!text) return;
      ta.value = '';
      try { const r = await api(`/api/posts/${postId}/chat`, { method: 'POST', body: { text } }); drawChat(r, postId); } catch (err) { toast(err.message, true); ta.value = text; }
    };
    await loadChat(postId);
  }
  async function loadChat(postId) {
    try { drawChat(await api(`/api/posts/${postId}/chat`), postId); } catch (e) { const m = $('#msgs'); if (m) m.innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  function drawChat(r, postId) {
    const m = $('#msgs'); if (!m) return;
    m.innerHTML = (r.messages.length ? '' : '<p class="fine">Ask anything about this product and its reinventions: why one design works, how to make it cheaper, who would buy it. Or tell the inventors what to change.</p>') +
      r.messages.map((x) => `<div class="msg ${x.role}${x.error ? ' err' : ''}">${esc(x.text)}</div>${x.suggest ? `<div class="suggest"><span>${I('sparkle', 14)} Suggested direction: ${esc(x.suggest)}</span><button class="btn small accent" data-act="round" data-v="${postId}" data-text="${esc(x.suggest)}">Reinvent with this</button></div>` : ''}`).join('') +
      (r.thinking ? '<div class="msg assistant"><span class="spin"></span></div>' : '');
    const body = m.closest('.sheet-body'); if (body) body.scrollTop = body.scrollHeight;
    clearInterval(chatPoll);
    if (r.thinking) chatPoll = setInterval(() => { if (S.sheet && S.sheet.kind && S.sheet.kind.type === 'chat') loadChat(postId); else clearInterval(chatPoll); }, 4000);
  }
  async function startRound(postId, feedback, btn) {
    if (!feedback || feedback.trim().length < 4) return toast('Say what the inventors should do differently.', true);
    if (btn) busy(btn, true);
    try { await api(`/api/posts/${postId}/reinvent`, { method: 'POST', body: { feedback } }); toast('The inventors are on it. The new round appears in the feed in about 10 to 15 minutes.'); closeSheet(); }
    catch (e) { if (btn) busy(btn, false); toast(e.message, true); }
  }

  // ---- saved ---------------------------------------------------------------------------------
  async function savedView() {
    app.innerHTML = `<header class="top solid"><a class="brand" href="#/feed">${mark()}<span>Saved</span></a></header><main class="page"><div id="saved" class="grid2">${[1, 2, 3, 4].map(() => '<div class="savedcard"><div class="v sk"></div><div class="b"><div class="sk" style="height:14px"></div></div></div>').join('')}</div></main>${nav('saved')}`;
    try {
      const r = await api('/api/saved');
      $('#saved').outerHTML = r.saved.length ? `<div class="grid2" id="saved">${r.saved.map((s) => `<button class="savedcard" data-act="detail" data-v="${s.postId}:${s.id}" style="--agent:${esc(s.agent.color)}"><span class="v">${s.sketch ? `<img src="${esc(s.sketch)}" alt="" loading="lazy">` : ''}</span><span class="b"><b>${esc(s.title)}</b><small>${esc(s.product)} · ${esc(s.agent.name)}</small></span></button>`).join('')}</div>`
        : `<div class="empty" id="saved">${I('bookmark-simple', 40)}<b>Nothing saved yet</b><p>Tap the bookmark on any reinvention you like. They all land here.</p><a class="btn" href="#/feed">Back to the feed</a></div>`;
    } catch (e) { $('#saved').innerHTML = `<p>${esc(e.message)}</p>`; }
  }

  // ---- the studio --------------------------------------------------------------------------------
  async function studioView() {
    app.innerHTML = `<header class="top solid"><a class="brand" href="#/feed">${mark()}<span>Studio</span></a></header><main class="page" id="studio"><div class="sk" style="height:120px;border-radius:22px"></div></main>${nav('studio')}`;
    let s;
    try { s = await api('/api/studio'); } catch (e) { $('#studio').innerHTML = `<p>${esc(e.message)}</p>`; return; }
    S.live = s.live; S.info = s;
    const ownerCtl = s.isOwner ? `
      <h2 class="sub">Schedule</h2>
      <div class="panel">
        <div class="row"><span class="grow"><b>Research new products</b><small>${s.paused ? 'Paused' : `Every ${s.intervalMin >= 60 ? `${s.intervalMin / 60} h` : `${s.intervalMin} min`}`}</small></span><label class="switch"><input type="checkbox" data-act="paused" ${s.paused ? '' : 'checked'} aria-label="Research on a schedule"><span></span></label></div>
        <div class="row"><span class="grow"><b>How often</b><small>Each product uses the Scout and three inventors on your Claude plan.</small></span><select data-act="interval">${[[30, 'Every 30 min'], [60, 'Every hour'], [120, 'Every 2 hours'], [240, 'Every 4 hours'], [480, 'Every 8 hours']].map(([v, t]) => `<option value="${v}" ${s.intervalMin === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="row"><span class="grow"><b>Focus</b><small>Optional: steer the Scout, e.g. "kitchen and baby products"</small></span></div>
        <form id="focusform" style="padding-bottom:14px;display:flex;gap:8px"><input id="focus" value="${esc(s.focus || '')}" placeholder="Any everyday product" maxlength="200"><button class="btn small">Save</button></form>
      </div>
      <h2 class="sub">Models</h2>
      <div class="panel">${[['scout', 'Scout'], ['inventor', 'Inventors'], ['sourcing', 'Sourcing analyst'], ['chat', 'Chat']].map(([k, t]) => `<div class="row"><span class="grow"><b>${t}</b><small>${MODEL_HINT[s.models[k]] || ''}</small></span><select data-act="model" data-v="${k}">${['haiku', 'sonnet', 'opus'].map((m) => `<option ${s.models[k] === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>`).join('')}</div>
      <h2 class="sub">People</h2>
      <div class="panel"><a class="row" href="#/people" style="text-decoration:none;color:inherit"><span class="grow"><b>Who can use the studio</b><small>Everyone can scroll and save; you choose who can chat and request reports</small></span>${I('caret-right', 18)}</a></div>` : '';
    $('#studio').innerHTML = `<h1 class="title">The studio</h1><p class="lede">${s.products} product${s.products === 1 ? '' : 's'} reinvented so far.</p>
      <div class="studio-live" id="studiolive">${studioLiveHtml(s)}</div>
      ${s.isOwner ? `<button class="btn block" data-act="run-now">${I('lightning', 18)}Research a product now</button>` : ''}
      <h2 class="sub">Who works here</h2>
      <div class="agents3">
        <div>${I('magnifying-glass', 22)}<span><b>The Scout</b><small>Picks one real product, reads reviews, forums, patents and past redesigns, and writes a sourced dossier.</small></span></div>
        <div style="--agent:#3b82f6"><span class="agent"><span class="av">M</span></span><span><b>Mara, the Engineer</b><small>TRIZ and first principles: finds the core contradiction and solves it with mechanism and material.</small></span></div>
        <div style="--agent:#e8613a"><span class="agent"><span class="av">K</span></span><span><b>Kenji, the Human-Centered Designer</b><small>Walks the real use journey and designs for the moments that frustrate people.</small></span></div>
        <div style="--agent:#10b981"><span class="agent"><span class="av">I</span></span><span><b>Ines, the Systems Futurist</b><small>Lifecycle, ecosystem and biomimicry: modular, refillable, merged with what it is used with.</small></span></div>
        <div>${I('factory', 22)}<span><b>The Sourcing Analyst</b><small>On request: cost to make, where in China, suppliers, price, margin and next steps.</small></span></div>
      </div>
      <p class="fine">The inventors work one after another and each sees what the others proposed, so the three ideas stay different. Each checks the web for existing products and patents before committing.</p>
      ${ownerCtl}
      <h2 class="sub">Account</h2>
      <div class="panel"><div class="row"><span class="grow"><b>${esc(S.me.firstName || S.me.email)}</b><small>${esc(S.me.email)}</small></span><button class="btn small quiet" data-act="logout">${I('sign-out', 16)}Sign out</button></div></div>`;
    const ff = $('#focusform');
    if (ff) ff.onsubmit = async (e) => { e.preventDefault(); try { await api('/api/studio', { method: 'POST', body: { focus: $('#focus').value } }); toast('The Scout will focus there.'); } catch (err) { toast(err.message, true); } };
  }
  function studioLiveHtml(s) {
    const l = s.live;
    if (l) return `<div class="now"><span class="pulse"></span><span>${esc(l.label)}</span></div>${l.activity ? `<p class="fine">${esc(l.activity)}</p>` : ''}<p class="fine">Started ${esc(ago(l.since))}${l.queued ? `, ${l.queued} more waiting` : ''}.</p>`;
    return `<div class="now">${I(s.paused ? 'pause' : 'clock', 20)}<span>${s.paused ? 'Paused' : s.nextRunAt ? `Next product ${inMin(s.nextRunAt)}` : 'Idle'}</span></div>${s.holdUntil ? `<p class="fine">Resting until ${new Date(s.holdUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} after hitting a limit. ${S.me.owner ? '<button class="link" data-act="clear-hold">Start again now</button>' : ''}</p>` : ''}${s.lastError ? `<p class="fine">Last problem: ${esc(s.lastError)}</p>` : ''}`;
  }

  async function peopleView() {
    app.innerHTML = `<header class="top solid"><a class="iconbtn" href="#/studio" aria-label="Back">${I('arrow-left', 22)}</a><b>People</b></header><main class="page"><p class="lede">Everyone with a confirmed account can scroll and save. Chat, new rounds and sourcing reports run on your Claude plan, so you choose who gets them.</p><div class="panel" id="people"><div class="sk" style="height:60px;margin:12px 0"></div></div></main>${nav('studio')}`;
    try {
      const { people } = await api('/api/people');
      $('#people').innerHTML = people.map((u) => `<div class="row"><span class="grow"><b>${esc(u.name || u.email)}${u.primary ? ' · owner' : ''}</b><small>${esc(u.email)} · ${u.status === 'unverified' ? 'has not confirmed yet' : esc(u.status)} · ${u.saved} saved</small>${u.primary ? '' : `<button class="link" data-act="email-person" data-v="${esc(u.id)}" style="margin-top:4px">${u.status === 'unverified' ? 'Email a confirm link' : 'Email a set-password link'}</button>`}</span>${u.primary || u.role === 'admin' ? '<span class="fine">Studio on</span>' : `<label class="switch"><input type="checkbox" data-act="claude" data-v="${esc(u.id)}" ${u.claude ? 'checked' : ''} aria-label="Studio access for ${esc(u.name || u.email)}"><span></span></label>`}</div>`).join('');
    } catch (e) { $('#people').innerHTML = `<p>${esc(e.message)}</p>`; }
  }

  // ---- actions ---------------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    if (act === 'go') { location.hash = v; if (location.hash === v) render(); }
    else if (act === 'close') closeSheet();
    else if (act === 'detail') { const [pid, iid] = v.split(':'); openDetail(pid, iid); }
    else if (act === 'dossier') openDossier(v);
    else if (act === 'chat') openChat(v);
    else if (act === 'chip') { const ta = $('#chattext'); if (ta) { ta.value = v; ta.focus(); } }
    else if (act === 'round') startRound(v, t.dataset.text, t);
    else if (act === 'round-from-text') { const ta = $('#chattext'); startRound(v, ta ? ta.value : '', t); }
    else if (act === 'save') {
      const on = t.getAttribute('aria-pressed') !== 'true';
      document.querySelectorAll(`[data-act="save"][data-v="${v}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(on)); b.innerHTML = I(on ? 'bookmark-simple-fill' : 'bookmark-simple', 22); });
      try { await api(`/api/inventions/${v}/save`, { method: 'POST', body: { on } }); if (on) toast('Saved'); for (const p of S.posts) for (const i of p.inventions || []) if (i.id === v) i.saved = on; } catch (err) { toast(err.message, true); }
    }
    else if (act === 'sourcing' || act === 'sourcing-again') {
      busy(t, true, 'Starting');
      try { const r = await api(`/api/inventions/${v}/sourcing`, { method: 'POST', body: { again: act === 'sourcing-again' } }); if (S.sheet && S.sheet.kind && S.sheet.kind.type === 'detail') { const k = S.sheet.kind; openDetailKeep(k.postId, k.invId, r.sourcing); } }
      catch (err) { busy(t, false); toast(err.message, true); }
    }
    else if (act === 'run-now') { busy(t, true, 'Starting'); try { const r = await api('/api/studio/run', { method: 'POST' }); toast(r.queued ? 'The Scout is on it. The product appears in about 15 minutes.' : 'The studio is already working on one.'); } catch (err) { toast(err.message, true); } busy(t, false); }
    else if (act === 'clear-hold') { await api('/api/studio', { method: 'POST', body: { clearHold: true } }).catch(() => {}); studioView(); }
    else if (act === 'fresh') { $('#newbar').hidden = true; S.newCount = 0; $('#feed').scrollTo({ top: 0 }); loadFeed(true); }
    else if (act === 'remove-post') { if (!confirm('Remove this product and all its reinventions?')) return; try { await api(`/api/posts/${v}`, { method: 'DELETE' }); closeSheet(); document.querySelector(`.post[data-post="${v}"]`)?.remove(); toast('Removed'); } catch (err) { toast(err.message, true); } }
    else if (act === 'logout') { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; location.hash = '#/feed'; render(); }
    else if (act === 'resend') { busy(t, true); try { await api('/api/forgot', { method: 'POST', body: { email: v }, anon: true }); toast('Sent again. Both links work.'); } catch (err) { toast(err.message, true); } busy(t, false); }
    else if (act === 'email-person') { try { const r = await api(`/api/people/${v}/email`, { method: 'POST', body: {} }); if (r.sent) toast('Sent.'); else if (r.link) prompt('Email failed. Copy this link and send it to them:', r.link); } catch (err) { toast(err.message, true); } }
  });
  async function openDetailKeep(postId, invId, sourcing) {
    // Redraw just the "Make it" block after a request, keeping the scroll position.
    try { const p = await api(`/api/posts/${postId}`); const inv = p.allRounds.flatMap((r) => r.inventions).find((i) => i.id === invId); if (inv) { if (sourcing && (!inv.sourcing || inv.sourcing.status !== 'ready')) inv.sourcing = sourcing; drawMake(inv); } } catch {}
  }
  document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    try {
      if (act === 'paused') { await api('/api/studio', { method: 'POST', body: { paused: !t.checked } }); toast(t.checked ? 'Research is on.' : 'Paused.'); studioView(); }
      else if (act === 'interval') { await api('/api/studio', { method: 'POST', body: { intervalMin: Number(t.value) } }); toast('Saved'); }
      else if (act === 'model') { await api('/api/studio', { method: 'POST', body: { models: { [t.dataset.v]: t.value } } }); const sm = t.closest('.row')?.querySelector('small'); if (sm) sm.textContent = MODEL_HINT[t.value] || ''; toast('Saved'); }
      else if (act === 'claude') { await api(`/api/people/${t.dataset.v}`, { method: 'POST', body: { claude: t.checked } }); toast(t.checked ? 'Studio access on' : 'Studio access off'); }
    } catch (err) { toast(err.message, true); }
  });

  // ---- live updates --------------------------------------------------------------------------------
  let es;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.event === 'live') {
        S.live = ev.live; drawLive();
        const sl = $('#studiolive'); if (sl && S.info) sl.innerHTML = studioLiveHtml({ ...S.info, live: ev.live });
        if (S.sheet && S.sheet.kind && S.sheet.kind.type === 'detail' && ev.live && ev.live.invId === S.sheet.kind.invId) { const p = $('.progress small'); if (p && ev.live.activity) p.textContent = ev.live.activity; }
      } else if (ev.event === 'post') {
        if (ev.removed) { document.querySelector(`.post[data-post="${ev.id}"]`)?.remove(); return; }
        if (document.querySelector(`.post[data-post="${ev.id}"]`)) refreshPost(ev.id);
        else if ($('#feed') && !S.posts.some((p) => p.id === ev.id)) api(`/api/posts/${ev.id}`).then((p) => { if (p.inventions && p.inventions.length && !S.posts.some((x) => x.id === p.id)) { const nb = $('#newbar'); if (nb) nb.hidden = false; } }).catch(() => {});
        if (S.sheet && S.sheet.kind && S.sheet.kind.type === 'detail' && S.sheet.kind.postId === ev.id && ev.invId === S.sheet.kind.invId) openDetailKeep(ev.id, ev.invId);
      } else if (ev.event === 'chat') {
        if (S.sheet && S.sheet.kind && S.sheet.kind.type === 'chat' && S.sheet.kind.postId === ev.id) loadChat(ev.id);
      }
    };
    es.onerror = () => { es.close(); es = null; setTimeout(() => { if (S.me) connect(); }, 5000); };
  }

  boot();
})();
