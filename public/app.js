// Jot: the app. Vanilla JS, hash routes, no build step.
(function () {
  'use strict';
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const I = (n, s = 20, c = '') => window.Icon(n, s, c);
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const S = { me: null, pub: null, notes: [], more: false, loading: false, sheet: null, tags: [] };
  const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? esc(u) : '#');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const money = (cents, cur = 'usd') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch { return `$${(cents / 100).toFixed(0)}`; } };
  const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function dayLabel(t) {
    const d = new Date(t), n = new Date();
    const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    if (key(d) === key(n)) return 'Today';
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (key(d) === key(y)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
  }
  function whenLabel(at) {
    const d = new Date(at), n = new Date();
    const same = d.toDateString() === n.toDateString();
    const tm = new Date(n); tm.setDate(n.getDate() + 1);
    return `${same ? 'today' : d.toDateString() === tm.toDateString() ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${timeOf(at)}`;
  }
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

  async function api(url, { method = 'GET', body, anon } = {}) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401 && !anon) { S.me = null; location.hash = '#/login'; }
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status, data: j });
    return j;
  }
  let toastT;
  function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = `toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2800); }
  function busy(b, on, label) { if (!b) return; if (on) { b.dataset.label = b.innerHTML; b.disabled = true; b.innerHTML = `<span class="spin"></span>${label ? ` ${esc(label)}` : ''}`; } else { b.disabled = false; if (b.dataset.label) b.innerHTML = b.dataset.label; } }
  const theme = () => { try { return localStorage.getItem('jt-theme') || ''; } catch { return ''; } };
  const applyTheme = () => { const t = theme(); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme();

  // Note text: links, #tags and search words, all escaped first.
  function richText(text, words = []) {
    let h = esc(text);
    h = h.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener" data-stop>${u.length > 60 ? `${u.slice(0, 57)}…` : u}</a>`);
    h = h.replace(/(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu, (m, pre, t) => `${pre}<span class="hash" data-tag="${t.toLowerCase()}">#${t}</span>`);
    for (const w of words.filter((x) => x.length > 1 && !x.startsWith('#'))) {
      const re = new RegExp(`(?![^<]*>)(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      h = h.replace(re, '<mark>$1</mark>');
    }
    return h;
  }

  // ---- routing ------------------------------------------------------------------------------
  const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
  window.addEventListener('hashchange', () => render());
  async function boot() {
    try { const s = await api('/api/session', { anon: true }); S.me = s.authed && s.allowed ? { ...s.user, admin: s.admin, primary: s.primary, ai: s.ai } : null; S.access = s.access; } catch { S.me = null; }
    try { S.pub = await api('/api/public', { anon: true }); } catch { S.pub = { access: 'open' }; }
    render();
    if (S.me) connect();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (S.me && window.InstallBanner) InstallBanner.offer({ name: 'Jot', icon: '/icon-180.png', above: '.nav', fresh: !!S.fresh, theme: { bg: 'var(--surface)', ink: 'var(--ink)', muted: 'var(--ink-2)', line: 'var(--line)', accent: 'var(--accent)', onAccent: 'var(--accent-ink)' } });
    S.fresh = false;
  }
  function render() {
    const [r0, r1] = route();
    closeSheet(true);
    window.scrollTo(0, 0);
    if (r0 === 'reset') return resetView(r1);
    if (r0 === 'welcome') return welcomeView(r1);
    if (r0 === 'privacy' || r0 === 'terms') return legalView(r0);
    if (!S.me) return r0 === 'login' ? loginView() : r0 === 'signup' ? signupView() : r0 === 'forgot' ? forgotView() : landingView();
    if (r0 === 'search') return searchView(r1 ? decodeURIComponent(r1) : '');
    if (r0 === 'reminders') return remindersView();
    if (r0 === 'settings') return settingsView();
    if (r0 === 'admin' && S.me.admin) return adminView();
    feedView();
    if (r0 === 'n' && r1) openNote(r1);
  }
  const nav = (tab) => `<nav class="nav" aria-label="Main">${[['', 'Jots', 'note-pencil'], ['search', 'Search', 'magnifying-glass'], ['reminders', 'Reminders', 'bell'], ...(S.me && S.me.admin ? [['admin', 'Admin', 'users-three']] : []), ['settings', 'Settings', 'gear']].map(([id, label, ic]) => `<a href="#/${id}" ${tab === id ? 'aria-current="page"' : ''}>${I(ic, 24)}<span>${label}</span></a>`).join('')}</nav>`;
  const mark = (s = 22) => `<span class="wordmark">${I('chat-text', s)}Jot</span>`;

  // ---- landing ------------------------------------------------------------------------------
  function cta() {
    const p = S.pub || {};
    if (p.access === 'paid' && p.payReady) return { label: `Get Jot, ${money(p.priceCents, p.currency)}`, act: 'buy' };
    if (p.access === 'open') return { label: 'Start free', href: '#/signup' };
    return { label: 'Sign in', href: '#/login' };
  }
  function landingView() {
    const c = cta();
    const btn = (cls = '') => (c.act ? `<button class="btn accent ${cls}" data-act="${c.act}">${esc(c.label)}${I('arrow-right', 18)}</button>` : `<a class="btn accent ${cls}" href="${c.href}">${esc(c.label)}${I('arrow-right', 18)}</a>`);
    const p = S.pub || {};
    app.innerHTML = `<div class="lp">
      <header class="lp-nav"><a class="wordmark" href="#/">${I('chat-text', 24)}Jot</a><span class="spacer"></span>${c.href === '#/login' ? '' : '<a class="link" href="#/login">Sign in</a>'}${btn('small')}</header>
      <main>
        <section class="wrap hero">
          <div>
            <h1>Text it once. <em>Find it</em> any time.</h1>
            <p class="sub">Send Jot a thought, link or photo from any phone. It lands in your private, searchable feed.</p>
            <div class="ctas">${btn()}</div>
          </div>
          <div class="demo" aria-label="A message to Jot becoming a tagged, searchable note">
            <div class="thread">
              <div class="bubble">pricing idea: annual plan at 2 months free #growth</div>
              <div class="bubble reply">Saved. #growth</div>
              <div class="bubble">remind me to send the deck to Priya at 4pm</div>
              <div class="bubble reply">I'll remind you today at 4:00 PM: Send the deck to Priya</div>
            </div>
            <div class="arrow">your feed</div>
            <div class="demo-feed">
              <div class="n"><span class="meta"><span>09:41</span><span class="tagc">#growth</span></span><span class="t">pricing idea: annual plan at 2 months free</span></div>
              <div class="n"><span class="meta"><span>09:42</span><span class="remchip due">${I('bell', 12)}today 4:00 PM</span></span><span class="t">Send the deck to Priya</span></div>
              <div class="n"><span class="meta"><span>Yesterday</span><span class="tagc">#reading</span></span><span class="t">The essay on attention residue, worth a reread</span></div>
            </div>
          </div>
        </section>
        <div class="channels"><div class="wrap"><span class="lead">Send from</span><span>${I('telegram-logo', 20)}Telegram</span><span>${I('chat-text', 20)}Text message</span><span>${I('lightning', 20)}iPhone share sheet</span><span>${I('globe-simple', 20)}The app</span><span>${I('device-mobile', 20)}Any phone or computer</span></div></div>
        <section class="block wrap reveal">
          <h2>No folders to set up. Nothing to open first.</h2>
          <div class="steps3">
            <div><span class="k">01</span><h3>Send it</h3><p>Whatever is in your head, the moment it shows up: an idea, a link, a screenshot, a voice-to-text ramble.</p><span class="ex">book idea: a heist told by the getaway driver #writing</span></div>
            <div><span class="k">02</span><h3>It sorts itself</h3><p>Add a #tag, or let Jot tag it for you. Links get their title and picture, so you can tell them apart later.</p><span class="ex">#writing · 1 link · Tue 23:14</span></div>
            <div><span class="k">03</span><h3>It comes back</h3><p>Say "remind me" with a time and Jot texts you back. Anything else is one search away.</p><span class="ex">remind me to renew the passport on Nov 3</span></div>
          </div>
        </section>
        <section class="block wrap reveal" style="padding-top:0">
          <h2>For anyone whose head is never quiet.</h2>
          <div class="wall"><b>Hooks</b><i>and captions,</i><b>bug fixes</b><i>and commands,</i><b>prompts</b><i>that worked,</i><b>startup ideas</b><i>at 2 a.m.,</i><b>palettes</b><i>and layouts,</i><b>quotes</b><i>for the essay,</i><b>lecture</b><i>screenshots,</i><b>sources</b><i>for the story,</i><b>ad angles</b><i>to test,</i><b>shot lists,</b><b>lyrics,</b><i>and the</i><b>dentist</b><i>you keep forgetting to call.</i></div>
        </section>
        <section class="block wrap reveal" style="padding-top:0">
          <h2>Half-remember it. Find it anyway.</h2>
          <div class="searchshow" aria-label="Searching notes">
            <div class="q">${I('magnifying-glass', 20)}<span>onboarding</span></div>
            <div class="r">fix <mark>onboarding</mark> drop-off at step 3, people stall on the permissions screen<div class="m">#product · 3 months ago</div></div>
            <div class="r">Linear's <mark>onboarding</mark> teardown, the checklist part is the bit to steal<div class="m">#product · linear.app · 5 months ago</div></div>
          </div>
        </section>
        <section class="block wrap reveal" style="padding-top:0">
          <h2>Ask your notes a question.</h2>
          <div class="bento">
            <div class="a"><h3>Answers from your own jots</h3><p>Ask in plain words and get an answer built only from what you saved, with the notes it came from.</p><div class="qa"><span class="q">What did I decide about pricing?</span><span class="ans">An annual plan at two months free, and testing it on the enterprise segment first [1][4].</span></div></div>
            <div class="b"><h3>Yours alone</h3><p>Your notes are private to your account: no ads, no trackers, no selling your data. Export everything as Markdown or JSON whenever you like.</p></div>
          </div>
        </section>
        <section class="block wrap reveal" style="padding-top:0" id="price">
          <h2>${p.access === 'paid' ? 'Pay once. Keep it.' : 'Start in a minute.'}</h2>
          <div class="offer">
            <div>${p.access === 'paid' ? `<div class="price">${money(p.priceCents || 2900, p.currency)}<small>one time</small></div>` : `<div class="price">Free<small>while in early access</small></div>`}
              <ul><li>${I('check', 18)}Unlimited jots, links and pictures</li><li>${I('check', 18)}Reminders on your phone, Telegram${p.sms ? ', text message' : ''} or email</li><li>${I('check', 18)}Search by words, tags and dates</li><li>${I('check', 18)}Light and dark, on every device</li></ul>
              ${btn()}</div>
            <div class="faq">
              <div><b>Do I need to install an app?</b><p>No. Send from Telegram${p.sms ? ', a text message' : ''} or your iPhone's share sheet, and read everything in the web app. Add it to your home screen for reminders.</p></div>
              <div><b>Who can read my notes?</b><p>Only you. Each account's notes and pictures are stored separately and never shared.</p></div>
              <div><b>Can I get my notes out?</b><p>Any time, as Markdown or JSON, from Settings.</p></div>
            </div>
          </div>
        </section>
      </main>
      <footer class="lp-foot"><div class="wrap"><span class="wordmark" style="font-size:16px">${I('chat-text', 18)}Jot</span><a href="#/privacy">Privacy</a><a href="#/terms">Terms</a><a href="mailto:jot@cashflowus.com">Contact</a></div></footer>
    </div>`;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }
  function legalView(kind) {
    app.innerHTML = `<header class="lp-nav"><a class="wordmark" href="#/">${I('chat-text', 24)}Jot</a></header><main class="wrap" style="max-width:680px;padding:40px 0 60px;display:grid;gap:14px">${kind === 'privacy' ? `<h1 style="font-size:34px;letter-spacing:-.04em">Privacy</h1><p>Jot stores what you send it (words, links, pictures, reminders) so you can find it later. Your notes are visible only to your account. We do not sell data and the site has no advertising trackers.</p><p>To show link previews, Jot's server opens the links you save. Reminders reach you through the channels you connect (notifications, Telegram, text message, email). AI features, when turned on for your account, send the relevant notes to an AI model to answer you; they are not used to train models by us.</p><p>You can export or delete everything at any time in Settings. Questions: jot@cashflowus.com.</p>` : `<h1 style="font-size:34px;letter-spacing:-.04em">Terms</h1><p>Jot is provided as is. Keep your own copies of anything critical: export from Settings any time. Don't use Jot to store anything illegal or to send messages to people who didn't ask for them. A one-time purchase covers your own personal use of the service for as long as it runs; if it ever shuts down you will get time to export your notes.</p>`}<p><a href="#/">Back to Jot</a></p></main>`;
  }

  // ---- accounts -----------------------------------------------------------------------------
  function authShell(title, lede, body, alt = '') {
    app.innerHTML = `<main class="auth"><a class="wordmark" href="#/">${I('chat-text', 26)}Jot</a><div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${body}${alt ? `<p class="alt">${alt}</p>` : ''}</main>`;
  }
  const field = (name, label, type = 'text', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" ${extra}><div class="err" id="e-${name}"></div></div>`;
  function loginView() {
    const c = cta();
    authShell('Welcome back', '', `<form id="login">${field('email', 'Email', 'email', 'autocomplete="email" required')}${field('password', 'Password', 'password', 'autocomplete="current-password" required')}<button class="btn block">Sign in</button><div class="err" id="e-login"></div></form>`, `<a href="#/forgot">Forgot password?</a>${S.pub && S.pub.access === 'open' ? ` · <a href="#/signup">Create an account</a>` : c.act ? ` · <a href="#/">Get Jot</a>` : ''}`);
    $('#login').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true);
      try { await api('/api/login', { method: 'POST', body: { email: $('#f-email').value, password: $('#f-password').value }, anon: true }); S.fresh = true; location.hash = '#/'; await boot(); }
      catch (err) { $('#e-login').textContent = err.message; busy(b, false); }
    };
  }
  function signupView() {
    if (!S.pub || S.pub.access !== 'open') { location.hash = '#/'; return; }
    authShell('Make your Jot', 'Free while in early access. We email you a link to confirm and choose a password.', `<form id="signup">${field('firstName', 'First name', 'text', 'autocomplete="given-name" required maxlength="60"')}${field('email', 'Email', 'email', 'autocomplete="email" required')}<button class="btn accent block">Create my account</button><div id="e-signup"></div></form>`, 'Already have one? <a href="#/login">Sign in</a>');
    $('#signup').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true);
      try { const r = await api('/api/signup', { method: 'POST', body: { firstName: $('#f-firstName').value, email: $('#f-email').value }, anon: true }); $('#signup').innerHTML = `<div class="notice ok">${esc(r.message)}</div><button type="button" class="btn quiet small" data-act="resend" data-v="${esc($('#f-email') ? $('#f-email').value : '')}">Send it again</button>`; }
      catch (err) { $('#e-signup').innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; busy(b, false); }
    };
  }
  function forgotView() {
    authShell('Reset your password', 'We email you a link to choose a new one.', `<form id="forgot">${field('email', 'Email', 'email', 'autocomplete="email" required')}<button class="btn block">Email me a link</button><div id="e-forgot"></div></form>`, '<a href="#/login">Back to sign in</a>');
    $('#forgot').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true);
      try { const r = await api('/api/forgot', { method: 'POST', body: { email: $('#f-email').value }, anon: true }); $('#e-forgot').innerHTML = `<div class="notice ok">${esc(r.message)}</div>`; } catch (err) { $('#e-forgot').innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
      busy(b, false);
    };
  }
  async function resetView(token) {
    authShell('Choose a password', '', '<div class="sk" style="height:120px"></div>');
    let v; try { v = await api(`/api/reset?token=${encodeURIComponent(token || '')}`, { anon: true }); } catch { v = { valid: false }; }
    if (!v.valid) return authShell('This link has expired', 'Links work for 24 hours. Ask for a new one.', '<a class="btn block" href="#/forgot">Email me a new link</a>');
    authShell('Choose a password', `For ${esc(v.email)}. At least 8 characters.`, `<form id="reset">${field('password', 'New password', 'password', 'autocomplete="new-password" required minlength="8"')}<button class="btn accent block">Save and sign in</button><div id="e-reset"></div></form>`);
    $('#reset').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true);
      try { const r = await api('/api/reset', { method: 'POST', body: { token, password: $('#f-password').value }, anon: true }); await api('/api/login', { method: 'POST', body: { email: r.email, password: $('#f-password').value }, anon: true }); S.fresh = true; location.hash = '#/'; await boot(); }
      catch (err) { $('#e-reset').innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; busy(b, false); }
    };
  }
  async function welcomeView(id) {
    authShell('Thank you', '', '<div class="sk" style="height:80px"></div>');
    let r = { paid: false };
    for (let i = 0; i < 5 && !r.paid; i++) { try { r = await api(`/api/checkout/${encodeURIComponent(id || '')}`, { anon: true }); } catch {} if (!r.paid) await new Promise((x) => setTimeout(x, 1500)); }
    authShell(r.paid ? 'Your Jot is ready' : 'Almost there', r.paid ? `We emailed ${esc(r.email || 'you')} a link to choose your password. It works for 24 hours; check Spam too.` : 'We are waiting for the payment to confirm. If you paid, the email with your link arrives in a minute or two.', '<a class="btn block" href="#/login">Sign in</a>');
  }

  // ---- the feed ------------------------------------------------------------------------------
  let pending = [];
  function feedView() {
    app.innerHTML = `<header class="top"><h1>${mark(22)}</h1><a class="iconbtn" href="#/search" aria-label="Search">${I('magnifying-glass', 22)}</a></header>
      <main class="page" id="feedpage">
        <div class="composer" id="composer"><form id="jotform"><input type="file" id="pic" accept="image/*" multiple hidden><button type="button" class="iconbtn attach" data-act="pick-image" aria-label="Add a picture">${I('camera', 22)}</button><textarea id="jottext" rows="1" placeholder="Jot anything" aria-label="New jot" maxlength="10000"></textarea><button class="send" aria-label="Save" id="sendbtn" disabled>${I('arrow-right', 20)}</button></form><div class="thumbs" id="thumbs"></div><div class="hint"><span><b>#tag</b> to sort</span><span><b>remind me … at 5pm</b> for a reminder</span></div></div>
        <div id="pinned"></div>
        <div id="feed"><div class="sk" style="height:18px;width:30%;margin:16px 0 10px"></div><div class="sk" style="height:64px;margin-bottom:12px"></div><div class="sk" style="height:48px;margin-bottom:12px"></div><div class="sk" style="height:80px"></div></div>
      </main>${nav('')}`;
    pending = [];
    wireComposer();
    loadFeed(true);
  }
  function wireComposer() {
    const ta = $('#jottext'), send = $('#sendbtn');
    const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`; send.disabled = !ta.value.trim() && !pending.length; document.documentElement.style.setProperty('--composer-h', `${$('#composer').offsetHeight}px`); };
    ta.addEventListener('input', fit); fit();
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#jotform').requestSubmit(); } });
    $('#pic').onchange = async (e) => { for (const f of [...e.target.files].slice(0, 6 - pending.length)) { try { pending.push(await shrink(f)); } catch { toast('That picture could not be read.', true); } } e.target.value = ''; drawThumbs(); fit(); };
    $('#jotform').onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text && !pending.length) return;
      busy(send, true);
      try {
        const r = await api('/api/notes', { method: 'POST', body: { text, images: pending, tz: TZ } });
        ta.value = ''; pending = []; drawThumbs(); fit();
        if (!S.notes.some((n) => n.id === r.note.id)) { S.notes.unshift(r.note); drawFeed(); }
        if (r.note.remind || /remind/i.test(text)) toast(r.reply.replace(/^Saved\. /, ''));
      } catch (err) { toast(err.message, true); }
      busy(send, false); fit(); ta.focus();
    };
  }
  /** Pictures shrink to 1600px JPEG on the phone before upload. */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  function drawThumbs() { const el = $('#thumbs'); if (el) el.innerHTML = pending.map((d, i) => `<span><img src="${d}" alt=""><button type="button" data-act="unpick" data-v="${i}" aria-label="Remove picture">${I('x', 12)}</button></span>`).join(''); }
  async function loadFeed(reset) {
    if (S.loading) return; S.loading = true;
    try {
      const before = !reset && S.notes.length ? S.notes[S.notes.length - 1].createdAt : 0;
      const r = await api(`/api/notes?limit=40${before ? `&before=${before}` : ''}${reset ? '&pinned=1' : ''}`);
      S.notes = reset ? r.notes : [...S.notes, ...r.notes]; S.more = r.more;
      if (reset) S.pinned = r.pinned || [];
      drawFeed();
    } catch (err) { const f = $('#feed'); if (f) f.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
    S.loading = false;
  }
  function noteHtml(n, words = [], plain = false) {
    const tags = [...n.tags.map((t) => `<button class="tagc" data-act="tag" data-v="${esc(t)}">#${esc(t)}</button>`), ...n.aiTags.filter((t) => !n.tags.includes(t)).map((t) => `<button class="tagc ai" data-act="tag" data-v="${esc(t)}" title="Tagged by AI">#${esc(t)}</button>`)].join('');
    const src = { telegram: 'telegram-logo', sms: 'chat-text', shortcut: 'lightning' }[n.source];
    const rem = n.remind ? `<span class="remchip ${n.remind.done ? 'done' : 'due'}">${I(n.remind.done ? 'check' : 'bell', 12)}${esc(whenLabel(n.remind.at))}</span>` : '';
    return `<article class="note${n.pinned && !plain ? ' pinned' : ''}" data-note="${n.id}" data-act="open" data-v="${n.id}">
      ${n.text ? `<div class="t">${richText(n.text, words)}</div>` : ''}
      ${n.images.length ? `<div class="pics">${n.images.map((s) => `<img src="${esc(s)}" alt="" loading="lazy">`).join('')}</div>` : ''}
      ${n.links.filter((l) => l.title || l.image).map((l) => `<a class="lprev${l.image ? '' : ' noimg'}" href="${safeUrl(l.url)}" target="_blank" rel="noopener" data-stop>${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : ''}<span style="min-width:0"><b>${esc(l.title || l.url)}</b><small>${esc(l.site || host(l.url))}</small></span></a>`).join('')}
      <div class="meta"><span>${esc(timeOf(n.createdAt))}</span>${src ? I(src, 13) : ''}${n.pinned ? I('push-pin', 13) : ''}${rem}${tags}</div>
    </article>`;
  }
  function drawFeed() {
    const f = $('#feed'); if (!f) return;
    const pin = $('#pinned');
    if (pin) pin.innerHTML = (S.pinned || []).length ? `<div class="day">Pinned</div>${S.pinned.map((n) => noteHtml(n)).join('')}` : '';
    if (!S.notes.length) {
      f.innerHTML = `<div class="empty"><h2>Your feed is empty, and quiet.</h2><p>Type in the box above, or tap one of these to see how Jot sorts things:</p><div class="tryline">${['idea: weekly digest email for power users #product', 'remind me to call the dentist tomorrow at 10am', 'https://www.paulgraham.com/greatwork.html #reading'].map((x) => `<button data-act="try" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div><p class="fine">You can also send jots from Telegram, a text message or your iPhone's share sheet: see Settings.</p></div>`;
      return;
    }
    let html = '', last = '';
    for (const n of S.notes.filter((x) => !x.pinned)) { const d = dayLabel(n.createdAt); if (d !== last) { html += `<div class="day">${esc(d)}</div>`; last = d; } html += noteHtml(n); }
    f.innerHTML = html + (S.more ? '<div id="more" class="sk" style="height:48px;margin:16px 0"></div>' : '');
    const m = $('#more');
    if (m) { const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); loadFeed(false); } }); io.observe(m); }
  }

  // ---- a note, in full ------------------------------------------------------------------------
  function openSheet(title, body) {
    closeSheet(true);
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('section'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = `<span class="grab"></span><div class="sheet-head"><h3>${title}</h3><button class="iconbtn" data-act="close" aria-label="Close">${I('x', 22)}</button></div><div class="sheet-body">${body}</div>`;
    document.body.append(scrim, sh);
    requestAnimationFrame(() => { scrim.classList.add('in'); sh.classList.add('in'); });
    scrim.onclick = () => closeSheet();
    S.sheet = { el: sh, scrim };
    return sh;
  }
  function closeSheet(now) {
    const s = S.sheet; if (!s) return; S.sheet = null;
    s.el.classList.remove('in'); s.scrim.classList.remove('in');
    setTimeout(() => { s.el.remove(); s.scrim.remove(); }, now ? 0 : 320);
    if (/^#\/n\//.test(location.hash)) history.replaceState(null, '', '#/');
  }
  async function openNote(id) {
    let n = [...S.notes, ...(S.pinned || []), ...(S.results || [])].find((x) => x.id === id);
    if (!n) { try { n = (await api(`/api/notes/${id}`)).note; } catch { return toast('That jot is gone.', true); } }
    S.open = n;
    const now = new Date(); const tonight = new Date(now); tonight.setHours(20, 0, 0, 0); const tmr = new Date(now); tmr.setDate(now.getDate() + 1); tmr.setHours(9, 0, 0, 0); const nextWeek = new Date(tmr); nextWeek.setDate(tmr.getDate() + 6);
    const presets = [['In 1 hour', Date.now() + 3600e3], ...(tonight > now ? [['Tonight 8 PM', +tonight]] : []), ['Tomorrow 9 AM', +tmr], ['Next week', +nextWeek]];
    const local = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
    openSheet(`${esc(dayLabel(n.createdAt))}, ${esc(timeOf(n.createdAt))}`, `
      <textarea id="edittext" rows="5" aria-label="Edit">${esc(n.text)}</textarea>
      ${n.images.length ? `<div class="pics">${n.images.map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt=""></a>`).join('')}</div>` : ''}
      ${n.links.map((l) => `<a class="lprev${l.image ? '' : ' noimg'}" href="${safeUrl(l.url)}" target="_blank" rel="noopener">${l.image ? `<img src="${esc(l.image)}" alt="">` : ''}<span style="min-width:0"><b>${esc(l.title || l.url)}</b><small>${esc(l.site || host(l.url))}</small></span></a>`).join('')}
      <div><div class="fine" style="margin-bottom:8px;font-weight:600">Reminder${n.remind ? `: ${esc(n.remind.done ? `sent ${whenLabel(n.remind.sentAt || n.remind.at)}${n.remind.via && n.remind.via.length ? ` by ${n.remind.via.join(', ')}` : ''}` : whenLabel(n.remind.at))}` : ''}</div>
        <div class="presets">${presets.map(([l, t]) => `<button class="btn small quiet" data-act="remind-at" data-v="${t}">${l}</button>`).join('')}${n.remind && !n.remind.done ? '<button class="btn small quiet" data-act="remind-off">Cancel reminder</button>' : ''}</div>
        <div class="dates" style="margin-top:8px"><input type="datetime-local" id="remat" value="${local(n.remind && !n.remind.done ? n.remind.at : +tmr)}" aria-label="Remind me at"><button class="btn small" data-act="remind-custom">Set</button></div></div>
      ${n.aiTags.length ? `<p class="fine">Tagged by AI: ${n.aiTags.map((t) => `#${esc(t)}`).join(' ')} <button class="link" data-act="drop-ai">Remove</button></p>` : ''}
      <div class="actions"><button class="btn" data-act="save-edit">Save</button><button class="btn quiet" data-act="pin">${I('push-pin', 18)}${n.pinned ? 'Unpin' : 'Pin'}</button><button class="btn quiet" data-act="copy-note">${I('copy', 18)}Copy</button><button class="btn quiet" data-act="delete-note" aria-label="Delete">${I('trash', 18)}</button></div>
      <p class="fine">From ${esc({ web: 'the app', telegram: 'Telegram', sms: 'a text message', shortcut: 'a Shortcut' }[n.source] || n.source)} · saved ${esc(ago(n.createdAt))}</p>`);
  }
  function replaceNote(n) {
    for (const list of [S.notes, S.pinned || [], S.results || []]) { const i = list.findIndex((x) => x.id === n.id); if (i >= 0) list[i] = n; }
    S.pinned = n.pinned ? [n, ...(S.pinned || []).filter((x) => x.id !== n.id)] : (S.pinned || []).filter((x) => x.id !== n.id);
    if ($('#feed')) drawFeed();
    if ($('#results')) drawResults();
  }

  // ---- search and ask -----------------------------------------------------------------------
  async function searchView(tag) {
    S.q = { q: '', tag: tag || '', from: '', to: '', mode: 'search' };
    app.innerHTML = `<header class="top"><h1>Search</h1>${S.me.ai ? '<div class="seg" role="group"><button data-act="mode" data-v="search" aria-pressed="true">Search</button><button data-act="mode" data-v="ask" aria-pressed="false">Ask</button></div>' : ''}</header>
      <main class="page"><div id="searchpane">
        <div class="searchbar"><div class="q">${I('magnifying-glass', 18)}<input id="q" type="search" placeholder="Words you remember" aria-label="Search your jots" autocomplete="off" enterkeyhint="search"></div>
        <div class="chiprow" id="tagrow"></div>
        <div class="chiprow" id="daterow">${[['all', 'Any time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Pick dates']].map(([v, l], i) => `<button data-act="range" data-v="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
        <div class="dates" id="custom" hidden><input type="date" id="dfrom" aria-label="From"><span class="fine">to</span><input type="date" id="dto" aria-label="To"></div></div>
        <div id="results"></div></div>
        <div id="askpane" hidden><form id="askform" style="display:grid;gap:10px;margin-top:12px"><div class="field"><label for="askq">Ask your jots</label><textarea id="askq" rows="2" placeholder="What did I decide about pricing?" maxlength="500"></textarea></div><button class="btn accent" style="justify-self:start">${I('sparkle', 18)}Ask</button></form><div id="answer"></div></div>
      </main>${nav('search')}`;
    try { S.tags = (await api('/api/tags')).tags; } catch { S.tags = []; }
    drawTagRow();
    let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(runSearch, 220); });
    $('#dfrom').onchange = $('#dto').onchange = runSearch;
    const af = $('#askform'); if (af) af.onsubmit = runAsk;
    runSearch();
    setTimeout(() => $('#q') && $('#q').focus(), 100);
  }
  function drawTagRow() { const el = $('#tagrow'); if (el) el.innerHTML = S.tags.length ? S.tags.slice(0, 40).map((t) => `<button data-act="filter-tag" data-v="${esc(t.tag)}" aria-pressed="${S.q.tag === t.tag}">#${esc(t.tag)} <span class="mono" style="opacity:.6">${t.count}</span></button>`).join('') : '<span class="fine">Tags you use show up here.</span>'; }
  function rangeOf(v) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (v === 'today') return [+d, 0];
    if (v === 'week') { const w = new Date(d); w.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [+w, 0]; }
    if (v === 'month') return [+new Date(d.getFullYear(), d.getMonth(), 1), 0];
    if (v === 'custom') { const f = $('#dfrom').value, t = $('#dto').value; return [f ? +new Date(`${f}T00:00`) : 0, t ? +new Date(`${t}T23:59:59`) : 0]; }
    return [0, 0];
  }
  async function runSearch() {
    const q = ($('#q') || {}).value || '';
    const [from, to] = rangeOf(S.q.range || 'all');
    const qs = new URLSearchParams({ q, ...(S.q.tag ? { tag: S.q.tag } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), limit: '60' });
    S.q.words = q.toLowerCase().split(/\s+/).filter(Boolean);
    try { const r = await api(`/api/notes?${qs}`); S.results = r.notes; S.resultsMore = r.more; drawResults(); } catch (err) { $('#results').innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
  }
  function drawResults() {
    const el = $('#results'); if (!el) return;
    const filtering = (($('#q') || {}).value || '').trim() || S.q.tag || (S.q.range && S.q.range !== 'all');
    if (!S.results.length) { el.innerHTML = `<div class="empty"><h2>${filtering ? 'Nothing matches.' : 'Nothing saved yet.'}</h2><p>${filtering ? 'Try fewer words, another tag or a wider date range.' : 'Jot something first, then find it here.'}</p></div>`; return; }
    let html = `<p class="fine" style="margin:12px 0 0">${S.results.length}${S.resultsMore ? '+' : ''} jot${S.results.length === 1 ? '' : 's'}</p>`, last = '';
    for (const n of S.results) { const d = dayLabel(n.createdAt); if (d !== last) { html += `<div class="day" style="top:auto;position:static">${esc(d)}</div>`; last = d; } html += noteHtml(n, S.q.words || []); }
    el.innerHTML = html;
  }
  async function runAsk(e) {
    e.preventDefault();
    const q = $('#askq').value.trim(); if (!q) return;
    const b = e.target.querySelector('.btn'); busy(b, true, 'Thinking');
    $('#answer').innerHTML = '<div class="sk" style="height:90px;margin-top:14px"></div>';
    try {
      const r = await api('/api/ask', { method: 'POST', body: { question: q } });
      S.results = r.cited.map((c) => c.note).filter(Boolean);
      const ks = new Set(r.cited.filter((c) => c.note).map((c) => String(c.k)));
      $('#answer').innerHTML = `<div class="answer">${esc(r.answer).replace(/\s?\[(\d{1,3})\]/g, (m, k) => (ks.has(k) ? `<sup>[${k}]</sup>` : '')).replace(/\s+([.,;])/g, '$1')}</div>${r.cited.length ? `<h2 class="sub">From these jots</h2>${r.cited.filter((c) => c.note).map((c) => `<div style="display:flex;gap:10px"><span class="mono fine" style="padding-top:16px">[${c.k}]</span><div style="flex:1;min-width:0">${noteHtml(c.note, [], true)}</div></div>`).join('')}` : ''}`;
    } catch (err) { $('#answer').innerHTML = `<div class="notice bad" style="margin-top:14px">${esc(err.message)}</div>`; }
    busy(b, false);
  }

  // ---- reminders ------------------------------------------------------------------------------
  async function remindersView() {
    app.innerHTML = `<header class="top"><h1>Reminders</h1></header><main class="page" id="rem"><div class="sk" style="height:120px;margin-top:12px"></div></main>${nav('reminders')}`;
    let r; try { r = await api('/api/reminders'); } catch (e) { $('#rem').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    S.results = [...r.upcoming, ...r.done];
    const row = (n) => `<article class="note" data-act="open" data-v="${n.id}"><div class="meta"><span class="remchip ${n.remind.done ? 'done' : 'due'}">${I(n.remind.done ? 'check' : 'bell', 12)}${esc(whenLabel(n.remind.done ? n.remind.sentAt || n.remind.at : n.remind.at))}</span>${n.remind.done && n.remind.via.length ? `<span>by ${esc(n.remind.via.join(', '))}</span>` : ''}</div><div class="t">${esc(n.remind.text)}</div>${n.remind.done ? '' : `<div class="actions" data-stop><button class="btn small quiet" data-act="snooze" data-v="${n.id}:60">Push 1 hour</button><button class="btn small quiet" data-act="snooze" data-v="${n.id}:1440">Push a day</button></div>`}</article>`;
    $('#rem').innerHTML = `${r.upcoming.length ? `<h2 class="sub">Coming up</h2>${r.upcoming.map(row).join('')}` : `<div class="empty"><h2>No reminders waiting.</h2><p>Say "remind me" with a time in any jot: "remind me to call Sam at 5pm", "in 30 minutes", "tomorrow morning", "on Friday".</p></div>`}${r.done.length ? `<h2 class="sub">Already sent</h2>${r.done.map(row).join('')}` : ''}`;
  }

  // ---- settings -------------------------------------------------------------------------------
  async function settingsView() {
    app.innerHTML = `<header class="top"><h1>Settings</h1></header><main class="page" id="set"><div class="sk" style="height:160px;margin-top:12px"></div></main>${nav('settings')}`;
    let s; try { s = await api('/api/settings'); } catch (e) { $('#set').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    S.settings = s;
    if (s.prefs.tz !== TZ) api('/api/settings', { method: 'POST', body: { tz: TZ } }).catch(() => {});
    const pushOk = 'PushManager' in window && 'serviceWorker' in navigator;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $('#set').innerHTML = `
      <h2 class="sub">Send jots from</h2>
      <div class="panel">
        <div class="row">${I('telegram-logo', 24)}<span class="grow"><b>Telegram</b><small>${s.telegram.linked ? 'Linked. Send the bot anything, including photos.' : s.telegram.ready ? 'Free and instant on every phone and computer.' : 'Not set up on this Jot yet.'}</small></span>${s.telegram.linked ? '<button class="btn small quiet" data-act="tg-off">Unlink</button>' : s.telegram.ready ? '<button class="btn small" data-act="tg-on">Connect</button>' : '<span class="state">Soon</span>'}</div>
        <div class="row">${I('chat-text', 24)}<span class="grow"><b>Text message</b><small>${s.sms.phone ? `Linked to ${esc(s.sms.phone)}. Text ${esc(s.sms.number)}.` : s.sms.ready ? `Text anything to ${esc(s.sms.number)}, including pictures.` : 'Not set up on this Jot yet.'}</small><span id="smsbox"></span></span>${s.sms.phone ? '<button class="btn small quiet" data-act="sms-off">Unlink</button>' : s.sms.ready ? '<button class="btn small" data-act="sms-on">Link my phone</button>' : '<span class="state">Soon</span>'}</div>
        <div class="row" style="display:block">
          <div style="display:flex;gap:12px;align-items:center">${I('lightning', 24)}<span class="grow"><b>iPhone share sheet and Siri</b><small>Your private link: anything posted to it lands here.</small></span></div>
          <div class="codebox" style="margin-top:10px">${esc(s.capture)}</div>
          <div class="actions" style="margin-top:8px"><button class="btn small" data-act="copy-text" data-v="${esc(s.capture)}">${I('copy', 16)}Copy link</button><button class="btn small quiet" data-act="new-capture">New link</button></div>
          <ol class="howto"><li>Open Shortcuts, tap +, add <b>Get Contents of URL</b>.</li><li>Paste the link, set Method to <b>POST</b>, Request Body <b>JSON</b>, add a field <b>text</b> set to <b>Shortcut Input</b>.</li><li>In the shortcut's details, turn on <b>Show in Share Sheet</b> and name it "Jot it". Now share any text or link to it, or say "Hey Siri, Jot it".</li></ol>
        </div>
      </div>
      <h2 class="sub">Reminders</h2>
      <div class="panel">
        <div class="row">${I('bell-ringing', 24)}<span class="grow"><b>Notifications on this device</b><small>${!pushOk ? 'This browser cannot show notifications.' : !standalone && /iphone|ipad/i.test(navigator.userAgent) ? 'On iPhone, first add Jot to your Home Screen (Share, then Add to Home Screen), then open it from there.' : `${s.push.devices} device${s.push.devices === 1 ? '' : 's'} set up.`}</small></span>${pushOk ? `<button class="btn small" data-act="push-on">${s.push.devices ? 'Test' : 'Turn on'}</button>` : ''}</div>
        ${s.sms.phone ? `<label class="row check"><input type="checkbox" data-act="pref" data-v="smsReminders" ${s.prefs.smsReminders ? 'checked' : ''}> Also text me reminders</label>` : ''}
        <label class="row check"><input type="checkbox" data-act="pref" data-v="emailReminders" ${s.prefs.emailReminders ? 'checked' : ''}> Always email reminders too (otherwise only when nothing else reached you)</label>
        <div class="row"><span class="grow"><b>Time zone</b><small>${esc(TZ)}, from this device</small></span></div>
      </div>
      <h2 class="sub">You</h2>
      <form class="panel" id="nameform" style="padding:14px 16px;display:grid;gap:10px"><div class="field"><label for="fn">First name</label><input id="fn" value="${esc(s.user.firstName || '')}" maxlength="60"></div><p class="fine">${esc(s.user.email)} · ${s.notes} jot${s.notes === 1 ? '' : 's'}${S.me.ai ? ' · AI tagging and Ask are on' : ''}</p><button class="btn small quiet" style="justify-self:start">Save name</button></form>
      <h2 class="sub">Look</h2>
      <div class="panel" style="padding:12px 16px"><div class="seg" role="group">${[['', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${theme() === v}">${l}</button>`).join('')}</div></div>
      <h2 class="sub">Your data</h2>
      <div class="panel"><div class="row">${I('download-simple', 22)}<span class="grow"><b>Export everything</b><small>All your jots, tags, links and reminders.</small></span><a class="btn small quiet" href="/api/export?format=md" download>Markdown</a><a class="btn small quiet" href="/api/export" download>JSON</a></div></div>
      ${S.me.admin ? `<div class="panel" style="margin-top:14px"><a class="row" href="#/admin" style="text-decoration:none;color:inherit">${I('users-three', 22)}<span class="grow"><b>Admin</b><small>People, invitations, payments and channels</small></span>${I('caret-right', 18)}</a></div>` : ''}
      <div class="actions" style="margin-top:22px"><button class="btn quiet" data-act="logout">${I('sign-out', 18)}Sign out</button>${S.me.primary ? '' : '<button class="btn quiet" data-act="delete-account">Delete my account</button>'}</div>`;
    $('#nameform').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/settings', { method: 'POST', body: { firstName: $('#fn').value } }); toast('Saved'); } catch (err) { toast(err.message, true); } };
  }
  function b64key(base64) { const pad = '='.repeat((4 - (base64.length % 4)) % 4); const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
  async function pushOn() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked for Jot in your settings.');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(S.settings.push.key) });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    await api('/api/push/test', { method: 'POST' });
  }

  // ---- admin ---------------------------------------------------------------------------------
  async function adminView() {
    app.innerHTML = `<header class="top"><h1>Admin</h1></header><main class="page" id="adm"><div class="sk" style="height:140px;margin-top:12px"></div></main>${nav('admin')}`;
    let r; try { r = await api('/api/admin'); } catch (e) { $('#adm').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    S.admin = r;
    const st = r.stats, own = r.viewerIsOwner;
    const tile = (n, l) => `<div class="tile"><small>${l}</small><b>${n}</b></div>`;
    const key = (name) => { const k = r.secrets[name]; return `<div class="keyrow"><label class="fine" for="k-${name}" style="font-weight:600">${esc(k.label)} ${k.set ? `<span class="state on">set, ${esc(k.hint)}</span>` : '<span class="state">not set</span>'}</label><div class="kv"><input id="k-${name}" type="password" autocomplete="off" placeholder="${k.set ? 'Paste to replace' : 'Paste here'}"><button class="btn small" data-act="save-key" data-v="${name}">Save</button>${k.set ? `<button class="btn small quiet" data-act="clear-key" data-v="${name}">Clear</button>` : ''}</div></div>`; };
    $('#adm').innerHTML = `<p class="fine" style="margin-top:6px">${own ? 'You are the owner.' : 'You are an administrator.'}</p>
      <div class="tiles" style="margin-top:12px">${tile(st.people, 'People')}${tile(st.activeToday, 'Active today')}${tile(st.active7, 'Active this week')}${tile(st.notes, 'Jots')}${tile(st.notes7, 'Jots this week')}${tile(st.reminders, 'Reminders')}${tile(st.viaTelegram, 'From Telegram')}${tile(st.viaSms, 'From texts')}${tile(st.viaShortcut, 'From Shortcuts')}${tile(st.purchases, 'Purchases')}${tile(money(st.revenue || 0, r.settings.currency), 'Revenue')}${tile(st.invitedWaiting, 'Invited, not joined')}</div>
      ${own ? `<h2 class="sub">Who can join</h2>
      <form class="panel" id="accessform" style="padding:14px 16px;display:grid;gap:12px">
        <div class="field"><label for="acc">Access</label><select id="acc"><option value="open" ${r.settings.access === 'open' ? 'selected' : ''}>Open: anyone signs up free</option><option value="invite" ${r.settings.access === 'invite' ? 'selected' : ''}>Invite only</option><option value="paid" ${r.settings.access === 'paid' ? 'selected' : ''}>Paid: one-time purchase</option></select></div>
        <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="price">Price (${esc(r.settings.currency.toUpperCase())})</label><input id="price" inputmode="decimal" value="${(r.settings.priceCents / 100).toFixed(2)}"></div><div class="field" style="flex:2"><label for="pname">Product name on the receipt</label><input id="pname" value="${esc(r.settings.productName)}" maxlength="80"></div></div>
        ${r.settings.access === 'paid' && !r.channels.stripe ? '<div class="notice bad">Paid access needs the Stripe keys below, or nobody can buy.</div>' : ''}
        <button class="btn small" style="justify-self:start">Save</button></form>
      <h2 class="sub">Keys for outside services</h2>
      <div class="panel" style="padding:4px 16px">
        <p class="fine" style="padding-top:12px"><b>Telegram</b> (free): message @BotFather, send /newbot, paste the token. ${r.channels.telegramBot ? `Running as @${esc(r.channels.telegramBot)}.` : ''}</p>${key('telegramToken')}
        <p class="fine" style="padding-top:12px"><b>Text messages</b> (Twilio, paid): buy a number at twilio.com, set its "A message comes in" webhook to <span class="mono">${esc(r.channels.smsWebhookUrl)}</span> (HTTP POST), then paste these.</p>${key('twilioSid')}${key('twilioToken')}${key('twilioFrom')}
        <p class="fine" style="padding-top:12px"><b>Payments</b> (Stripe): add a webhook endpoint <span class="mono">${esc(r.channels.webhookUrl)}</span> for <span class="mono">checkout.session.completed</span>, then paste the secret key and the signing secret.</p>${key('stripeSecret')}${key('stripeWebhook')}
      </div>` : ''}
      <h2 class="sub">Invite someone</h2>
      <form class="panel" id="inviteform" style="padding:14px 16px;display:grid;gap:10px;grid-template-columns:minmax(0,1fr)">
        <div class="field"><label for="iv-email">Email</label><input id="iv-email" type="email" required autocomplete="off"></div>
        <div class="field"><label for="iv-name">First name (optional)</label><input id="iv-name" maxlength="60"></div>
        <label class="check"><input type="checkbox" id="iv-ai"> Turn on AI tagging and Ask (uses your Claude plan)</label>
        <button class="btn" style="justify-self:start">${I('envelope-simple', 18)}Send invitation</button><div id="ivout"></div>
      </form>
      <h2 class="sub" id="pcount">People (${r.people.length})</h2>
      <div class="plist">${r.people.map(personHtml).join('')}</div>`;
    const af = $('#accessform');
    if (af) af.onsubmit = async (e) => { e.preventDefault(); try { await api('/api/admin/settings', { method: 'POST', body: { access: $('#acc').value, priceCents: Math.round(parseFloat($('#price').value) * 100), productName: $('#pname').value } }); toast('Saved'); S.pub = await api('/api/public', { anon: true }); adminView(); } catch (err) { toast(err.message, true); } };
    $('#inviteform').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true, 'Sending');
      try {
        const x = await api('/api/admin/invite', { method: 'POST', body: { email: $('#iv-email').value, name: $('#iv-name').value, ai: $('#iv-ai').checked } });
        $('#ivout').innerHTML = x.sent ? `<div class="notice ok">Invitation sent${x.existing ? ' (they already had an account: it is a fresh sign-in link)' : ''}.</div>` : `<div class="notice bad">The email did not go out. Send them this link yourself:</div><div class="codebox" style="margin-top:8px">${esc(x.link)}</div><button type="button" class="btn small" style="margin-top:8px" data-act="copy-text" data-v="${esc(x.link)}">${I('copy', 16)}Copy link</button>`;
        if (x.sent) { $('#iv-email').value = ''; $('#iv-name').value = ''; }
        const fresh = await api('/api/admin'); S.admin = fresh; $('.plist').innerHTML = fresh.people.map(personHtml).join(''); $('#pcount').textContent = `People (${fresh.people.length})`;
      } catch (err) { toast(err.message, true); }
      busy(b, false);
    };
  }
  function personHtml(u) {
    const own = S.admin && S.admin.viewerIsOwner;
    const badges = [u.primary ? 'Owner' : u.admin ? 'Administrator' : '', u.paid ? 'Paid' : '', u.status === 'unverified' ? 'Invited, not joined' : ''].filter(Boolean);
    const ch = [u.channels.telegram && 'Telegram', u.channels.sms && 'texts', u.channels.shortcut && 'Shortcut', u.channels.push && 'notifications'].filter(Boolean);
    return `<div class="person"><div class="ptop"><span class="av${u.admin ? ' admin' : ''}">${esc((u.name || u.email)[0].toUpperCase())}</span><span class="grow"><b>${esc(u.name)}</b>${badges.map((x) => `<span class="badge${/Invited/.test(x) ? ' warn' : ''}">${x}</span>`).join('')}<small>${esc(u.email)}${u.invitedBy ? ` · invited by ${esc(u.invitedBy)}` : ''}${u.joinedAt ? ` · since ${new Date(u.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</small></span></div>
      <p class="fine">${u.lastSeen ? `Last seen ${ago(u.lastSeen)} · ${u.activeDays30} active day${u.activeDays30 === 1 ? '' : 's'} this month · ${u.notes} jot${u.notes === 1 ? '' : 's'} (${u.notes7} this week) · ${u.reminders} reminder${u.reminders === 1 ? '' : 's'}` : 'Has not used Jot yet'}${ch.length ? ` · uses ${ch.join(', ')}` : ''}</p>
      ${u.primary ? '' : `<div class="pacts">${u.admin ? '<span class="fine">AI on (administrator)</span>' : `<label class="check"><input type="checkbox" data-act="person-ai" data-v="${u.id}" ${u.ai ? 'checked' : ''}> AI</label>`}
        ${own && u.status === 'approved' ? `<button class="btn small quiet" data-act="set-role" data-v="${u.id}:${u.admin ? 'user' : 'admin'}">${I('shield-check', 16)}${u.admin ? 'Remove admin' : 'Make admin'}</button>` : ''}
        <button class="btn small quiet" data-act="email-person" data-v="${u.id}">${I('envelope-simple', 16)}${u.status === 'unverified' ? 'Resend invite' : 'Send sign-in link'}</button>
        ${own ? `<button class="iconbtn" data-act="remove-person" data-v="${u.id}" aria-label="Remove ${esc(u.name)}">${I('trash', 18)}</button>` : ''}</div>`}</div>`;
  }

  // ---- actions --------------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stop]') && !e.target.closest('[data-act]:not(.note)')) { if (e.target.closest('a')) return; }
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'LABEL') return;
    if (t.classList.contains('note') && e.target.closest('a, button')) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (act === 'close') return closeSheet();
    if (act === 'open') { history.replaceState(null, '', `#/n/${v}`); return openNote(v); }
    if (act === 'tag' || act === 'filter-tag') {
      if (act === 'tag') { closeSheet(true); location.hash = `#/search/${encodeURIComponent(v)}`; return; }
      S.q.tag = S.q.tag === v ? '' : v; drawTagRow(); return runSearch();
    }
    if (act === 'range') { S.q.range = v; t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); $('#custom').hidden = v !== 'custom'; return runSearch(); }
    if (act === 'mode') { t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); $('#searchpane').hidden = v !== 'search'; $('#askpane').hidden = v !== 'ask'; if (v === 'ask') $('#askq').focus(); return; }
    if (act === 'pick-image') return $('#pic').click();
    if (act === 'unpick') { pending.splice(Number(v), 1); drawThumbs(); $('#jottext').dispatchEvent(new Event('input')); return; }
    if (act === 'try') { const ta = $('#jottext'); ta.value = v; ta.dispatchEvent(new Event('input')); return $('#jotform').requestSubmit(); }
    if (act === 'buy') { busy(t, true); try { const r = await api('/api/checkout', { method: 'POST', body: {}, anon: true }); location.href = r.url; } catch (err) { toast(err.message, true); busy(t, false); } return; }
    if (act === 'resend') { try { await api('/api/forgot', { method: 'POST', body: { email: v }, anon: true }); toast('Sent again. Both links work.'); } catch (err) { toast(err.message, true); } return; }
    if (act === 'logout') { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; location.hash = '#/'; return render(); }
    if (act === 'theme') { try { if (v) localStorage.setItem('jt-theme', v); else localStorage.removeItem('jt-theme'); } catch {} applyTheme(); t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return; }
    if (act === 'copy-text') { try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast('Select it and copy', true); } return; }
    // A note's sheet.
    const n = S.open;
    try {
      if (act === 'save-edit' && n) { const r = await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { text: $('#edittext').value } }); replaceNote(r.note); closeSheet(); toast('Saved'); }
      else if (act === 'pin' && n) { const r = await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { pinned: !n.pinned } }); replaceNote(r.note); closeSheet(); toast(r.note.pinned ? 'Pinned to the top' : 'Unpinned'); }
      else if (act === 'copy-note' && n) { await navigator.clipboard.writeText(n.text); toast('Copied'); }
      else if (act === 'delete-note' && n) { if (!confirm('Delete this jot?')) return; await api(`/api/notes/${n.id}`, { method: 'DELETE' }); S.notes = S.notes.filter((x) => x.id !== n.id); S.pinned = (S.pinned || []).filter((x) => x.id !== n.id); S.results = (S.results || []).filter((x) => x.id !== n.id); closeSheet(); drawFeed(); drawResults(); toast('Deleted'); }
      else if (act === 'drop-ai' && n) { const r = await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { removeAiTags: n.aiTags } }); replaceNote(r.note); closeSheet(); }
      else if ((act === 'remind-at' || act === 'remind-custom' || act === 'remind-off') && n) {
        const body = act === 'remind-off' ? { off: true } : { at: act === 'remind-at' ? Number(v) : +new Date($('#remat').value) };
        const r = await api(`/api/notes/${n.id}/remind`, { method: 'POST', body });
        replaceNote(r.note); closeSheet(); toast(r.when ? `I'll remind you ${r.when}` : 'Reminder cancelled');
        if (route()[0] === 'reminders') remindersView();
      }
      else if (act === 'snooze') { const [id, m] = v.split(':'); const r = await api(`/api/notes/${id}/remind`, { method: 'POST', body: { snoozeMin: Number(m) } }); toast(`I'll remind you ${r.when}`); remindersView(); }
      // Settings.
      else if (act === 'tg-on') { const r = await api('/api/channels/telegram', { method: 'POST' }); window.open(r.url, '_blank'); toast('Tap Start in Telegram to finish'); }
      else if (act === 'tg-off') { await api('/api/channels/telegram', { method: 'DELETE' }); settingsView(); }
      else if (act === 'sms-on') { const r = await api('/api/channels/sms', { method: 'POST' }); $('#smsbox').innerHTML = `<div class="notice" style="margin-top:8px">From your phone, text <b class="mono">LINK ${esc(r.code)}</b> to <b class="mono">${esc(r.number)}</b>. The code works for 30 minutes.</div>`; }
      else if (act === 'sms-off') { await api('/api/channels/sms', { method: 'DELETE' }); settingsView(); }
      else if (act === 'new-capture') { if (!confirm('Make a new link? Shortcuts using the old one stop working.')) return; await api('/api/channels/capture', { method: 'POST' }); settingsView(); }
      else if (act === 'push-on') { busy(t, true); await pushOn(); toast('Sent a test notification'); settingsView(); }
      else if (act === 'delete-account') { const c = prompt('This deletes your account and every jot. Type DELETE to confirm.'); if (c !== 'DELETE') return; await api('/api/account', { method: 'DELETE', body: { confirm: 'DELETE' } }); S.me = null; location.hash = '#/'; render(); }
      // Admin.
      else if (act === 'save-key' || act === 'clear-key') { await api('/api/admin/secret', { method: 'POST', body: { name: v, value: act === 'clear-key' ? '' : $(`#k-${v}`).value } }); toast(act === 'clear-key' ? 'Cleared' : 'Saved'); adminView(); }
      else if (act === 'set-role') { const [id, role] = v.split(':'); if (role === 'admin' && !confirm('Make this person an administrator? They will see everyone and can invite people.')) return; await api(`/api/people/${id}`, { method: 'POST', body: { role } }); toast(role === 'admin' ? 'Now an administrator' : 'No longer an administrator'); adminView(); }
      else if (act === 'email-person') { const r = await api(`/api/people/${v}`, { method: 'POST', body: { emailLink: true } }); if (r.sent) toast('Sent'); else prompt('The email failed. Copy this link and send it to them:', r.link); }
      else if (act === 'remove-person') { if (!confirm('Remove this person and all their jots?')) return; await api(`/api/people/${v}`, { method: 'POST', body: { remove: true } }); toast('Removed'); adminView(); }
    } catch (err) { busy(t, false); toast(err.message, true); }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    try {
      if (t.dataset.act === 'pref') { await api('/api/settings', { method: 'POST', body: { [t.dataset.v]: t.checked } }); toast('Saved'); }
      else if (t.dataset.act === 'person-ai') { await api(`/api/people/${t.dataset.v}`, { method: 'POST', body: { ai: t.checked } }); toast(t.checked ? 'AI on for them' : 'AI off for them'); }
    } catch (err) { toast(err.message, true); }
  });

  // ---- live updates: jots from Telegram, texts or Shortcuts appear by themselves ---------------
  let es;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    es.onmessage = async (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.event !== 'note') return;
      if (ev.removed) { S.notes = S.notes.filter((x) => x.id !== ev.id); drawFeed(); return; }
      try {
        const { note } = await api(`/api/notes/${ev.id}`);
        if (S.notes.some((x) => x.id === note.id)) replaceNote(note);
        else if ($('#feed')) { S.notes.unshift(note); drawFeed(); }
      } catch {}
    };
    es.onerror = () => { es.close(); es = null; setTimeout(() => { if (S.me) connect(); }, 5000); };
  }

  boot();
})();
