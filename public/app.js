// Jot: the app. Vanilla JS, hash routes, no build step.
(function () {
  'use strict';
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const I = (n, s = 20, c = '') => window.Icon(n, s, c);
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const S = { me: null, pub: null, list: [], more: false, loading: false, sheet: null, tags: [], f: { q: '', tag: '', range: 'all' }, timers: [] };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? esc(u) : '#');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const money = (cents, cur = 'usd') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch { return `$${(cents / 100).toFixed(0)}`; } };
  const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayKey = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  function dayShort(t) {
    const d = new Date(t), n = new Date();
    if (dayKey(d) === dayKey(n)) return 'Today';
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (dayKey(d) === dayKey(y)) return 'Yesterday';
    if (n - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
  }
  const stamp = (t) => `${dayShort(t)} · ${timeOf(t)}`;
  function whenLabel(at) {
    const d = new Date(at), n = new Date();
    const tm = new Date(n); tm.setDate(n.getDate() + 1);
    return `${dayKey(d) === dayKey(n) ? 'today' : dayKey(d) === dayKey(tm) ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${timeOf(at)}`;
  }
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  /** Each tag keeps one colour everywhere. */
  const hue = (t) => { let h = 7; for (const c of String(t)) h = (h * 31 + c.codePointAt(0)) >>> 0; return `h${h % 7}`; };
  const later = (fn, ms) => { const id = setTimeout(fn, ms); S.timers.push(id); return id; };

  async function api(url, { method = 'GET', body, anon } = {}) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401 && !anon) { S.me = null; location.hash = '#/login'; }
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status, data: j });
    return j;
  }
  let toastT;
  function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = `toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2800); }
  /** Jot texting you back. */
  function reply(msg) { const t = $('#toast'); t.textContent = msg; t.className = 'toast reply show'; clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast reply'; }, 3600); }
  function busy(b, on, label) { if (!b) return; if (on) { b.dataset.label = b.innerHTML; b.disabled = true; b.innerHTML = `<span class="spin"></span>${label ? ` ${esc(label)}` : ''}`; } else { b.disabled = false; if (b.dataset.label) b.innerHTML = b.dataset.label; } }
  const theme = () => { try { return localStorage.getItem('jt-theme') || 'dark'; } catch { return 'dark'; } };
  function applyTheme() {
    const t = theme();
    document.documentElement.dataset.theme = t;
    const light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', light ? '#f5f5f5' : '#000000'));
  }
  applyTheme();

  // Note text: links, #tags and search words, all escaped first. Tags at the very end are shown as pills instead.
  function richText(text, words = []) {
    let h = esc(String(text).replace(/(\s+#[\p{L}\p{N}][\p{L}\p{N}_-]{0,31})+\s*$/u, ''));
    h = h.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, (u) => { const shown = u.replace(/^https?:\/\/(www\.)?/, ''); return `<a href="${u}" target="_blank" rel="noopener">${shown.length > 44 ? `${shown.slice(0, 42)}…` : shown}</a>`; });
    h = h.replace(/(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu, (m, pre, t) => `${pre}<span class="hash ${hue(t.toLowerCase())}">#${t}</span>`);
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
    try { const s = await api('/api/session', { anon: true }); S.me = s.authed && s.allowed ? { ...s.user, admin: s.admin, primary: s.primary, ai: s.ai } : null; S.speech = !!s.speech; } catch { S.me = null; }
    if (window.Voice) Voice.configure({ server: S.speech });
    try { S.pub = await api('/api/public', { anon: true }); } catch { S.pub = { access: 'open' }; }
    render();
    if (S.me) connect();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (S.me && window.InstallBanner) InstallBanner.offer({ name: 'Jot', icon: '/icon-180.png', above: '.nav', fresh: !!S.fresh, theme: { bg: 'var(--surface)', ink: 'var(--ink)', muted: 'var(--ink-2)', line: 'var(--line)', accent: 'var(--accent)', onAccent: 'var(--accent-ink)' } });
    S.fresh = false;
  }
  function render() {
    const [r0, r1] = route();
    S.timers.forEach(clearTimeout); S.timers = [];
    stopVoice();
    closeSheet(true);
    window.onresize = null;
    document.documentElement.style.setProperty('--dock-h', '0px');
    window.scrollTo(0, 0);
    if (r0 === 'reset') return resetView(r1);
    if (r0 === 'welcome') return welcomeView(r1);
    if (r0 === 'privacy' || r0 === 'terms') return legalView(r0);
    if (!S.me) return r0 === 'login' ? loginView() : r0 === 'signup' ? signupView() : r0 === 'forgot' ? forgotView() : landingView();
    if (r0 === 'ask' && S.me.ai) return askView();
    if (r0 === 'reminders') return remindersView();
    if (r0 === 'settings') return settingsView();
    if (r0 === 'admin' && S.me.admin) return adminView();
    if ((r0 === 't' || r0 === 'search') && r1) S.f = { q: '', tag: decodeURIComponent(r1), range: 'all' };
    else if (r0 !== 'n') S.f = { q: '', tag: '', range: 'all' };
    homeView();
    if (r0 === 'n' && r1) openNote(r1);
  }
  const nav = (tab) => `<nav class="nav" aria-label="Main">${[['', 'Jots', 'note-pencil'], ['reminders', 'Reminders', 'bell'], ...(S.me && S.me.admin ? [['admin', 'Admin', 'users-three']] : []), ['settings', 'Settings', 'gear']].map(([id, label, ic]) => `<a href="#/${id}" ${tab === id ? 'aria-current="page"' : ''}>${I(ic, 23)}<span>${label}</span></a>`).join('')}</nav>`;
  const mark = () => '<span class="wordmark">jot<span class="cur"></span></span>';

  // ---- landing ------------------------------------------------------------------------------
  function cta() {
    const p = S.pub || {};
    if (p.access === 'paid' && p.payReady) return { label: `Get Jot, ${money(p.priceCents, p.currency)}`, act: 'buy' };
    if (p.access === 'open') return { label: 'Start free', href: '#/signup' };
    return { label: 'Sign in', href: '#/login' };
  }
  const SAMPLE = [
    { t: 'annual plan at 2 months free, test it on teams first', tag: 'pricing', when: 'Today · 9:41 AM' },
    { t: 'people stall on the permissions screen in onboarding. ask later, not on step 3', tag: 'product', when: 'Today · 8:12 AM' },
    { t: 'Maya wants the blue running jacket, size M', tag: 'gifts', when: 'Yesterday · 6:03 PM' },
    { t: 'podcast idea: founders explain one launch that flopped', tag: 'ideas', when: 'Yesterday · 11:20 AM' },
    { t: 'Four Thousand Weeks, the chapter on patience', tag: 'reading', when: 'Mon · 7:45 PM' },
    { t: 'air purifier filter size 16x25x1', tag: 'home', when: 'Sun · 2:10 PM' },
  ];
  const sampleCard = (s, q = '') => `<div class="card"><div class="meta">${esc(s.when)}</div><div class="tags"><span class="tg ${hue(s.tag)}">#${esc(s.tag)}</span></div><div class="t">${q ? esc(s.t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>') : esc(s.t)}</div></div>`;
  const sampleMasonry = (items, q) => { const a = [], b = []; items.forEach((s, i) => (i % 2 ? b : a).push(sampleCard(s, q))); return `<div class="masonry" style="padding-top:0"><div class="col">${a.join('')}</div><div class="col">${b.join('')}</div></div>`; };

  function landingView() {
    const c = cta(), p = S.pub || {};
    const btn = (cls = '') => (c.act ? `<button class="btn ${cls}" data-act="${c.act}">${esc(c.label)}${I('arrow-right', 18)}</button>` : `<a class="btn ${cls}" href="${c.href}">${esc(c.label)}${I('arrow-right', 18)}</a>`);
    const personas = [['Founders', 'Pricing ideas at 1 a.m., investor names, the feature a customer begged for.'], ['Developers', 'The command that fixed it, an error and its cure, the prompt that finally worked.'], ['Writers', 'A line overheard on the train, plot holes, the word you were looking for.'], ['Students', 'Lecture photos, deadlines, the formula written on the board twice.'], ['Creators', 'Hooks, captions, video ideas, the trend you will forget by tomorrow.'], ['Designers', 'Screenshots, palettes, a layout you liked in someone else\'s app.'], ['Parents', 'School forms, shoe sizes, the question you meant to ask the doctor.'], ['Researchers', 'Sources, quotes, and the link you will never find again.'], ['Sales and marketing', 'Objections you heard, angles to test, who to follow up with.'], ['Everyone else', 'Gift ideas, book tips, where you parked, the movie a friend said to watch.']];
    app.innerHTML = `<div class="lp">
      <header class="lp-nav"><a href="#/" style="text-decoration:none">${mark()}</a><span class="spacer"></span>${c.href === '#/login' ? '' : '<a class="link" href="#/login">Sign in</a>'}${btn('small')}</header>
      <main>
        <section class="wrap hero">
          <h1 id="typed" aria-label="Text it once. Find it any time."></h1>
          <p class="sub">One text gets it out of your head. Jot keeps it in a private feed you can search in seconds.</p>
          ${btn('big')}
          <p class="note-under">${p.access === 'paid' ? `${money(p.priceCents || 2900, p.currency)} once. No subscription.` : 'Free while in early access.'}</p>
          <div class="phone" aria-label="A conversation with Jot">
            <div class="phone-head"><span class="av">j</span><span><b>Jot</b><small>always on</small></span></div>
            <div class="bubbles" id="thread"></div>
            <div class="phone-input"><span>Text Jot anything</span>${I('microphone', 20)}</div>
          </div>
        </section>
        <div class="channels"><div class="wrap"><span>${I('chat-text', 18)}Text message</span><span>${I('telegram-logo', 18)}Telegram</span><span>${I('microphone', 18)}Your voice</span><span>${I('lightning', 18)}iPhone share sheet</span><span>${I('globe-simple', 18)}The web app</span></div></div>
        <section class="block wrap reveal">
          <h2>Made for minds that never switch off.</h2>
          <div class="personas">${personas.map(([b, t]) => `<div><b>${b}</b><p>${t}</p></div>`).join('')}</div>
        </section>
        <section class="block alt reveal"><div class="wrap split">
          <div><span class="num">01</span><h2>Send it the second you think it.</h2><p class="lede">Text it, send it on Telegram, share it from any iPhone app, or just say it out loud. No folders to pick, nothing to open first.</p></div>
          <div class="mini"><div class="say"><span class="mic">${I('microphone', 34)}</span><p class="heard" id="heard"></p></div></div>
        </div></section>
        <section class="block reveal"><div class="wrap split">
          <div><span class="num">02</span><h2>Everything lands in one feed.</h2><p class="lede">Ideas, links, photos and reminders, newest first. Add a #tag and it gets its own colour; links show their title and picture so you can tell them apart.</p></div>
          <div class="mini">${sampleMasonry(SAMPLE)}</div>
        </div></section>
        <section class="block alt reveal"><div class="wrap split">
          <div><span class="num">03</span><h2>Type what you remember. It's there.</h2><p class="lede">Search by a word, a #tag or a day like "yesterday" or "oct 12". Say "remind me" with a time and Jot texts you back when it's due.</p></div>
          <div class="mini"><div class="bar">${I('magnifying-glass', 18)}<b id="sq"></b><span class="caret"></span></div><div id="sres">${sampleMasonry(SAMPLE.slice(0, 2))}</div></div>
        </div></section>
        <section class="block wrap reveal" id="price">
          <h2>${p.access === 'paid' ? 'Pay once. Keep it.' : 'Start in a minute.'}</h2>
          <div class="offer">
            <div>${p.access === 'paid' ? `<div class="price">${money(p.priceCents || 2900, p.currency)}<small>one time</small></div>` : '<div class="price">Free<small>while in early access</small></div>'}
              <ul><li>${I('check', 18)}Unlimited jots, links and pictures</li><li>${I('check', 18)}Speak instead of typing</li><li>${I('check', 18)}Reminders by notification, Telegram${p.sms ? ', text' : ''} or email</li><li>${I('check', 18)}Search by words, tags and dates</li><li>${I('check', 18)}Export everything, any time</li></ul>
              ${btn('big')}</div>
            <div class="faq">
              <div><b>Do I need to install an app?</b><p>No. Send from Telegram${p.sms ? ', a text message' : ''} or your iPhone's share sheet, and read everything in the web app. Add it to your home screen for reminders.</p></div>
              <div><b>Who can read my notes?</b><p>Only you. Each account's notes and pictures are stored separately and never shared, and there are no ad trackers.</p></div>
              <div><b>Where does my voice go?</b><p>Your phone turns speech into text where it can. Otherwise the recording goes to Jot's own server, is turned into text there and is not kept.</p></div>
              <div><b>Can I get my notes out?</b><p>Any time, as Markdown or JSON, from Settings.</p></div>
            </div>
          </div>
        </section>
      </main>
      <footer class="lp-foot"><div class="wrap">${mark()}<a href="#/privacy">Privacy</a><a href="#/terms">Terms</a><a href="mailto:jot@cashflowus.com">Contact</a></div></footer>
    </div>`;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    typeHero(); chatDemo(); voiceDemo(); searchDemo();
  }
  function typeHero() {
    const el = $('#typed'); const full = 'Text it once.\nFind it any time.';
    if (reduced) { el.innerHTML = esc(full).replace('\n', '<br>'); return; }
    let i = 0;
    const step = () => { if (!$('#typed')) return; i++; el.innerHTML = `${esc(full.slice(0, i)).replace('\n', '<br>')}<span class="caret"></span>`; if (i < full.length) later(step, full[i - 1] === '.' ? 380 : 55 + Math.random() * 45); };
    later(step, 300);
  }
  function chatDemo() {
    const script = [['me', 'pricing idea: annual plan, 2 months free #pricing'], ['bot', 'Saved. #pricing'], ['me', 'remind me to call mom at 6pm'], ['bot', "Got it. I'll remind you today at 6:00 PM: Call mom"], ['voice', '0:06'], ['bot', 'Saved what you said: "book the dentist for next week"'], ['me', 'find air purifier'], ['bot', 'Found 1: "air purifier filter size 16x25x1" (Sun)']];
    const box = $('#thread');
    const bub = (who, text) => (who === 'voice' ? `<div class="bub" style="display:inline-flex;gap:8px;align-items:center">${I('waveform', 18)}${esc(text)}</div>` : `<div class="bub${who === 'bot' ? ' bot' : ''}">${esc(text)}</div>`);
    const trim = () => { while (box.children.length > 6) box.firstElementChild.remove(); };
    if (reduced) { box.innerHTML = script.slice(0, 4).map(([w, t]) => bub(w, t)).join(''); return; }
    let i = 0;
    const next = () => {
      if (!$('#thread')) return;
      if (i >= script.length) { i = 0; box.innerHTML = ''; later(next, 600); return; }
      const [who, text] = script[i++];
      if (who === 'bot') {
        box.insertAdjacentHTML('beforeend', '<div class="bub bot typing"><i></i><i></i><i></i></div>');
        later(() => { const t = box.querySelector('.typing'); if (t) t.outerHTML = bub(who, text); trim(); later(next, 1500); }, 900);
      } else { box.insertAdjacentHTML('beforeend', bub(who, text)); trim(); later(next, 700); }
    };
    later(next, 1200);
  }
  function voiceDemo() {
    const said = ['remind me to water the plants on friday', 'idea: a weekly digest for power users #product', 'the dentist is Dr. Okafor, 555 0142'];
    if (reduced) { $('#heard').textContent = said[0]; return; }
    let k = 0;
    const run = () => {
      const s = said[k++ % said.length]; let i = 0;
      const t = () => { const el = $('#heard'); if (!el) return; i += 1 + Math.floor(Math.random() * 2); el.innerHTML = `${esc(s.slice(0, i))}<span class="soft">${i < s.length ? '…' : ''}</span>`; if (i < s.length) later(t, 70); else later(run, 2200); };
      t();
    };
    run();
  }
  function searchDemo() {
    const qs = ['pricing', 'jacket', 'filter'];
    if (reduced) { $('#sq').textContent = 'jacket'; return; }
    let k = 0;
    const run = () => {
      const q = qs[k++ % qs.length]; let i = 0;
      const t = () => {
        const el = $('#sq'); if (!el) return;
        i++; const cur = q.slice(0, i); el.textContent = cur;
        const hits = SAMPLE.filter((s) => s.t.toLowerCase().includes(cur) || s.tag.includes(cur));
        $('#sres').innerHTML = sampleMasonry(hits.length ? hits.slice(0, 2) : SAMPLE.slice(0, 2), i === q.length ? cur : '');
        if (i < q.length) later(t, 140); else later(run, 2400);
      };
      t();
    };
    later(run, 800);
  }
  function legalView(kind) {
    app.innerHTML = `<header class="lp-nav"><a href="#/" style="text-decoration:none">${mark()}</a></header><main class="wrap legal">${kind === 'privacy' ? '<h1>Privacy</h1><p>Jot stores what you send it (words, links, pictures, reminders) so you can find it later. Your notes are visible only to your account. We do not sell data and the site has no advertising trackers.</p><p>To show link previews, Jot\'s server opens the links you save. When you speak to Jot, your phone turns speech into text where it can; otherwise the recording is sent to Jot\'s own server, turned into text there and deleted. Reminders reach you through the channels you connect (notifications, Telegram, text message, email). AI features, when turned on for your account, send the relevant notes to an AI model to answer you.</p><p>You can export or delete everything at any time in Settings. Questions: jot@cashflowus.com.</p>' : '<h1>Terms</h1><p>Jot is provided as is. Keep your own copies of anything critical: export from Settings any time. Don\'t use Jot to store anything illegal or to send messages to people who didn\'t ask for them. A one-time purchase covers your own personal use of the service for as long as it runs; if it ever shuts down you will get time to export your notes.</p>'}<p><a href="#/">Back to Jot</a></p></main>`;
  }

  // ---- accounts -----------------------------------------------------------------------------
  function authShell(title, lede, body, alt = '') {
    app.innerHTML = `<main class="auth"><a href="#/" style="text-decoration:none">${mark()}</a><div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${body}${alt ? `<p class="alt">${alt}</p>` : ''}</main>`;
  }
  const field = (name, label, type = 'text', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" ${extra}><div class="err" id="e-${name}"></div></div>`;
  function loginView() {
    const c = cta();
    authShell('Welcome back', '', `<form id="login">${field('email', 'Email', 'email', 'autocomplete="email" required')}${field('password', 'Password', 'password', 'autocomplete="current-password" required')}<button class="btn block">Sign in</button><div class="err" id="e-login"></div></form>`, `<a href="#/forgot">Forgot password?</a>${S.pub && S.pub.access === 'open' ? ' · <a href="#/signup">Create an account</a>' : c.act ? ' · <a href="#/">Get Jot</a>' : ''}`);
    $('#login').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true);
      try { await api('/api/login', { method: 'POST', body: { email: $('#f-email').value, password: $('#f-password').value }, anon: true }); S.fresh = true; location.hash = '#/'; await boot(); }
      catch (err) { $('#e-login').textContent = err.message; busy(b, false); }
    };
  }
  function signupView() {
    if (!S.pub || S.pub.access !== 'open') { location.hash = '#/'; return; }
    authShell('Make your Jot', 'Free while in early access. We email you a link to confirm and choose a password.', `<form id="signup">${field('firstName', 'First name', 'text', 'autocomplete="given-name" required maxlength="60"')}${field('email', 'Email', 'email', 'autocomplete="email" required')}<button class="btn block">Create my account</button><div id="e-signup"></div></form>`, 'Already have one? <a href="#/login">Sign in</a>');
    $('#signup').onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector('.btn'); busy(b, true);
      const email = $('#f-email').value;
      try { const r = await api('/api/signup', { method: 'POST', body: { firstName: $('#f-firstName').value, email }, anon: true }); $('#signup').innerHTML = `<div class="notice ok">${esc(r.message)}</div><button type="button" class="btn quiet small" data-act="resend" data-v="${esc(email)}">Send it again</button>`; }
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
    authShell('Choose a password', `For ${esc(v.email)}. At least 8 characters.`, `<form id="reset">${field('password', 'New password', 'password', 'autocomplete="new-password" required minlength="8"')}<button class="btn block">Save and sign in</button><div id="e-reset"></div></form>`);
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

  // ---- search words that mean a day: "today", "yesterday", "friday", "oct 12", "10/12" -------
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function dateQuery(q) {
    let s = ` ${q.toLowerCase()} `, from = 0, to = 0, label = '';
    const now = new Date();
    const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const oneDay = (d) => { from = +day0(d); to = from + 864e5 - 1; label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
    const monthDay = (mo, d, y) => {
      let year = y ? Number(y) : now.getFullYear();
      if (mo < 0 || mo > 11) return;
      if (d) { let x = new Date(year, mo, Number(d)); if (!y && x > now) x = new Date(year - 1, mo, Number(d)); oneDay(x); return; }
      if (!y && new Date(year, mo, 1) > now) year -= 1;
      from = +new Date(year, mo, 1); to = +new Date(year, mo + 1, 1) - 1; label = new Date(year, mo, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
    };
    const take = (re, fn) => { const m = s.match(re); if (m) { s = s.replace(m[0], ' '); fn(m); return true; } return false; };
    const mon = MONTHS.join('|');
    take(/\s(today)\s/, () => oneDay(now))
      || take(/\s(yesterday)\s/, () => { const d = new Date(now); d.setDate(d.getDate() - 1); oneDay(d); })
      || take(/\s(this|last) week\s/, (m) => { const d = day0(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - (m[1] === 'last' ? 7 : 0)); from = +d; to = m[1] === 'last' ? from + 7 * 864e5 - 1 : 0; label = `${m[1]} week`; })
      || take(/\s(this|last) month\s/, (m) => { from = +new Date(now.getFullYear(), now.getMonth() - (m[1] === 'last' ? 1 : 0), 1); to = m[1] === 'last' ? +new Date(now.getFullYear(), now.getMonth(), 1) - 1 : 0; label = `${m[1]} month`; })
      || take(new RegExp(`\\s(${DAYS.join('|')}|${DAYS.map((d) => d.slice(0, 3)).join('|')})\\s`), (m) => { const want = DAYS.findIndex((d) => d.startsWith(m[1])); const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() - want + 7) % 7)); oneDay(d); })
      || take(new RegExp(`\\s(${mon})[a-z]*\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s+(\\d{4}))?\\s`), (m) => monthDay(MONTHS.indexOf(m[1]), m[2], m[3]))
      || take(new RegExp(`\\s(\\d{1,2})(?:st|nd|rd|th)?\\s+(${mon})[a-z]*\\.?(?:\\s+(\\d{4}))?\\s`), (m) => monthDay(MONTHS.indexOf(m[2]), m[1], m[3]))
      || take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, (m) => monthDay(Number(m[1]) - 1, m[2], m[3] && (m[3].length === 2 ? `20${m[3]}` : m[3])));
    return { words: s.trim(), from, to, label };
  }

  // ---- home: search, tags, cards, and the texting bar -----------------------------------------
  let pending = [], voiceUsed = false, stopVoiceFn = null;
  function homeView() {
    const ai = S.me.ai ? `<a class="iconbtn" href="#/ask" aria-label="Ask your jots">${I('sparkle', 22)}</a>` : '';
    app.innerHTML = `<header class="top"><h1>${mark()}</h1>${ai}</header>
      <main class="page" id="home">
        <div class="finder">
          <div class="searchrow"><div class="q">${I('magnifying-glass', 18)}<input id="q" type="search" placeholder="Search text, #tag, date" aria-label="Search your jots" autocomplete="off" enterkeyhint="search" value="${esc(S.f.q)}"><button class="iconbtn clear" data-act="clear-q" aria-label="Clear search" ${S.f.q ? '' : 'hidden'}>${I('x', 16)}</button></div>
            <button class="squarebtn" data-act="toggle-dates" aria-pressed="${S.f.range !== 'all'}" aria-label="Filter by date">${I('calendar-blank', 20)}</button></div>
          <div class="chiprow" id="tagrow"></div>
          <div id="datepane" ${S.f.range !== 'all' ? '' : 'hidden'} style="display:grid;gap:8px">
            <div class="chiprow">${[['all', 'Any time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Pick dates']].map(([v, l]) => `<button class="chip" data-act="range" data-v="${v}" aria-pressed="${S.f.range === v}">${l}</button>`).join('')}</div>
            <div class="dates" id="custom" ${S.f.range === 'custom' ? '' : 'hidden'}><input type="date" id="dfrom" aria-label="From"><span class="fine">to</span><input type="date" id="dto" aria-label="To"></div>
          </div>
        </div>
        <div class="resultline" id="resultline" hidden></div>
        <div id="feed"><div class="masonry"><div class="col"><div class="sk" style="height:150px"></div><div class="sk" style="height:96px"></div></div><div class="col"><div class="sk" style="height:110px"></div><div class="sk" style="height:170px"></div></div></div></div>
      </main>
      <div class="dock" id="dock"><div class="inner">
        <div class="status" id="vstatus" hidden><span class="lv"></span><span id="vtext">Listening.</span></div>
        <div class="thumbs" id="thumbs"></div>
        <form id="jotform"><input type="file" id="pic" accept="image/*" multiple hidden>
          <button type="button" class="iconbtn" data-act="pick-image" aria-label="Add a picture">${I('camera', 22)}</button>
          <textarea id="jottext" rows="1" placeholder="Text Jot anything" aria-label="New jot" maxlength="10000"></textarea>
          ${window.Voice && Voice.supported() ? `<button type="button" class="iconbtn mic" id="micbtn" data-act="mic" aria-label="Speak instead of typing">${I('microphone', 22)}</button>` : ''}
          <button class="send" aria-label="Save" id="sendbtn" disabled>${I('arrow-up', 20)}</button>
        </form></div></div>${nav('')}`;
    pending = []; voiceUsed = false;
    wireComposer();
    loadTags();
    let t; $('#q').addEventListener('input', () => { $('.clear').hidden = !$('#q').value; clearTimeout(t); t = setTimeout(() => { S.f.q = $('#q').value; load(true); }, 220); });
    $('#dfrom').onchange = $('#dto').onchange = () => load(true);
    let cols = colCount();
    window.onresize = () => { if ($('#feed') && colCount() !== cols) { cols = colCount(); drawFeed(); } };
    load(true);
  }
  async function loadTags() { try { S.tags = (await api('/api/tags')).tags; } catch { S.tags = []; } drawTagRow(); }
  function drawTagRow() {
    const el = $('#tagrow'); if (!el) return;
    el.hidden = !S.tags.length && !S.f.tag;
    el.innerHTML = `<button class="chip" data-act="filter-tag" data-v="" aria-pressed="${!S.f.tag}">All</button>${S.tags.slice(0, 40).map((t) => `<button class="chip" data-act="filter-tag" data-v="${esc(t.tag)}" aria-pressed="${S.f.tag === t.tag}">#${esc(t.tag)}<span class="n">${t.count}</span></button>`).join('')}`;
  }
  function rangeOf(v) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (v === 'today') return [+d, 0];
    if (v === 'week') { const w = new Date(d); w.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [+w, 0]; }
    if (v === 'month') return [+new Date(d.getFullYear(), d.getMonth(), 1), 0];
    if (v === 'custom') { const f = ($('#dfrom') || {}).value, t = ($('#dto') || {}).value; return [f ? +new Date(`${f}T00:00`) : 0, t ? +new Date(`${t}T23:59:59`) : 0]; }
    return [0, 0];
  }
  const filtering = () => !!(S.f.q.trim() || S.f.tag || S.f.range !== 'all');
  async function load(reset) {
    if (S.loading && !reset) return;
    S.loading = true;
    const seq = (S.seq = (S.seq || 0) + 1);
    const dq = dateQuery(S.f.q || '');
    let [from, to] = rangeOf(S.f.range);
    if (dq.from) { from = dq.from; to = dq.to; }
    const before = !reset && S.list.length ? S.list[S.list.length - 1].createdAt : 0;
    const qs = new URLSearchParams({ q: dq.words, limit: '40', ...(S.f.tag ? { tag: S.f.tag } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(before ? { before } : {}), ...(reset && !filtering() ? { pinned: '1' } : {}) });
    S.words = dq.words.toLowerCase().split(/\s+/).filter(Boolean);
    try {
      const r = await api(`/api/notes?${qs}`);
      if (seq !== S.seq) return;
      if (reset) { const pins = r.pinned || []; S.list = [...pins, ...r.notes.filter((n) => !pins.some((p) => p.id === n.id))]; } else S.list = [...S.list, ...r.notes.filter((n) => !S.list.some((x) => x.id === n.id))];
      S.more = r.more;
      const rl = $('#resultline');
      if (rl) { rl.hidden = !filtering(); rl.textContent = `${S.list.length}${S.more ? '+' : ''} jot${S.list.length === 1 ? '' : 's'}${S.f.tag ? ` in #${S.f.tag}` : ''}${dq.label ? `, ${dq.label}` : ''}`; }
      if (reset) drawFeed(); else appendCards(r.notes);
    } catch (err) { const f = $('#feed'); if (f && reset) f.innerHTML = `<div class="notice bad" style="margin-top:12px">${esc(err.message)}</div>`; }
    if (seq === S.seq) S.loading = false;
  }
  const colCount = () => { const w = Math.min(window.innerWidth, 1100); return w < 340 ? 1 : w < 680 ? 2 : w < 980 ? 3 : 4; };
  function cardHtml(n, words = [], cls = '') {
    const tags = [...n.tags.map((t) => `<span class="tg ${hue(t)}" data-act="tag" data-v="${esc(t)}">#${esc(t)}</span>`), ...n.aiTags.filter((t) => !n.tags.includes(t)).map((t) => `<span class="tg ai ${hue(t)}" data-act="tag" data-v="${esc(t)}" title="Tagged by AI">#${esc(t)}</span>`)].join('');
    const src = { telegram: 'telegram-logo', sms: 'chat-text', shortcut: 'lightning' }[n.source];
    const link = n.links.find((l) => l.title || l.image);
    return `<article class="card ${cls}" data-note="${n.id}" data-act="open" data-v="${n.id}">
      ${n.images.length ? `<img class="cover" src="${esc(n.images[0])}" alt="" loading="lazy">` : ''}
      <div class="meta"><span>${esc(stamp(n.createdAt))}</span>${src ? I(src, 13) : ''}${n.voice ? I('microphone', 13) : ''}${n.pinned ? `<span class="pin">${I('push-pin', 13)}</span>` : ''}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${n.text ? `<div class="t">${richText(n.text, words)}</div>` : ''}
      ${link ? `<a class="lprev${link.image ? '' : ' noimg'}" href="${safeUrl(link.url)}" target="_blank" rel="noopener">${link.image ? `<img src="${esc(link.image)}" alt="" loading="lazy">` : ''}<span style="min-width:0"><b>${esc(link.title || link.url)}</b><small>${esc(link.site || host(link.url))}</small></span></a>` : ''}
      ${n.images.length > 1 ? `<span class="more-pics">+${n.images.length - 1} more picture${n.images.length > 2 ? 's' : ''}</span>` : ''}
      ${n.remind ? `<span class="remchip ${n.remind.done ? 'done' : ''}">${I(n.remind.done ? 'check' : 'bell', 12)}${esc(whenLabel(n.remind.at))}</span>` : ''}
    </article>`;
  }
  function drawFeed(newId) {
    const f = $('#feed'); if (!f) return;
    if (!S.list.length) {
      f.innerHTML = filtering()
        ? '<div class="empty"><h2>Nothing matches.</h2><p>Try fewer words, another tag, or a wider date.</p></div>'
        : `<div class="empty"><h2>Your feed is empty, and quiet.</h2><p>Type or speak in the bar at the bottom. Tap one of these to see how Jot sorts things:</p><div class="tryline">${['idea: weekly digest email for power users #product', 'remind me to call the dentist tomorrow at 10am', 'https://www.paulgraham.com/greatwork.html #reading'].map((x) => `<button data-act="try" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div><p class="fine">You can also send jots from Telegram, a text message or your iPhone's share sheet: see Settings.</p></div>`;
      return;
    }
    f.innerHTML = `<div class="masonry">${'<div class="col"></div>'.repeat(colCount())}</div>${S.more ? '<div id="more" class="sk" style="height:60px;margin-top:12px"></div>' : ''}`;
    for (const n of S.list) place(cardHtml(n, S.words, n.id === newId ? 'new' : ''));
    watchMore();
  }
  /** Masonry: each card goes into the shortest column, so newest stays near the top. */
  function place(html) {
    const cols = [...document.querySelectorAll('#feed .col')];
    if (!cols.length) return;
    const c = cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a));
    c.insertAdjacentHTML('beforeend', html);
  }
  function appendCards(notes) {
    if (!$('#feed .masonry')) return drawFeed();
    for (const n of notes) place(cardHtml(n, S.words));
    const m = $('#more'); if (m) m.remove();
    if (S.more) $('#feed').insertAdjacentHTML('beforeend', '<div id="more" class="sk" style="height:60px;margin-top:12px"></div>');
    watchMore();
  }
  function watchMore() { const m = $('#more'); if (m) { const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); load(false); } }); io.observe(m); } }

  function wireComposer() {
    const ta = $('#jottext'), send = $('#sendbtn');
    const fit = () => { if (!$('#dock')) return; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.38)}px`; send.disabled = !ta.value.trim() && !pending.length; document.documentElement.style.setProperty('--dock-h', `${$('#dock').offsetHeight}px`); };
    ta.addEventListener('input', fit); fit();
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#jotform').requestSubmit(); } });
    $('#pic').onchange = async (e) => { for (const f of [...e.target.files].slice(0, 6 - pending.length)) { try { pending.push(await shrink(f)); } catch { toast('That picture could not be read.', true); } } e.target.value = ''; drawThumbs(); fit(); };
    $('#jotform').onsubmit = async (e) => {
      e.preventDefault();
      stopVoice();
      const text = ta.value.trim();
      if (!text && !pending.length) return;
      busy(send, true);
      try {
        const r = await api('/api/notes', { method: 'POST', body: { text, images: pending, tz: TZ, voice: voiceUsed } });
        ta.value = ''; pending = []; voiceUsed = false; drawThumbs(); fit();
        if (!filtering() && !S.list.some((n) => n.id === r.note.id)) { const pins = S.list.filter((n) => n.pinned); S.list = [...pins, r.note, ...S.list.filter((n) => !n.pinned)]; drawFeed(r.note.id); }
        else if (filtering()) load(true);
        reply(r.reply);
        if (r.note.tags.length) loadTags();
      } catch (err) { toast(err.message, true); }
      busy(send, false); fit();
    };
    S.fit = fit;
  }
  function toggleVoice() {
    if (stopVoiceFn) return stopVoice();
    const ta = $('#jottext');
    const base = ta.value.trim();
    stopVoiceFn = Voice.start({
      onText: (t, final) => { if (!$('#jottext')) return; if (t) { voiceUsed = true; ta.value = base ? `${base} ${t}` : t; } if (S.fit) S.fit(); if (final && t) ta.focus(); },
      onState: (s) => {
        const mic = $('#micbtn'), st = $('#vstatus');
        if (!mic) return;
        mic.classList.toggle('on', s === 'listening'); mic.classList.toggle('busy', s === 'thinking');
        mic.innerHTML = s === 'listening' ? I('stop', 20) : s === 'thinking' ? '<span class="spin"></span>' : I('microphone', 22);
        mic.setAttribute('aria-label', s === 'listening' ? 'Stop' : 'Speak instead of typing');
        st.hidden = s === 'idle';
        $('#vtext').textContent = s === 'thinking' ? 'Turning that into text…' : Voice.live() ? "Listening. Tap stop when you're done." : "Recording. Tap stop when you're done.";
        if (s === 'idle') stopVoiceFn = null;
        if (S.fit) S.fit();
      },
      onError: (m) => toast(m, true),
    });
  }
  function stopVoice() { if (stopVoiceFn) { const f = stopVoiceFn; try { f(); } catch {} } }
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

  // ---- a jot, in full -------------------------------------------------------------------------
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
    let n = [...S.list, ...(S.results || [])].find((x) => x.id === id);
    if (!n) { try { n = (await api(`/api/notes/${id}`)).note; } catch { return toast('That jot is gone.', true); } }
    S.open = n;
    const now = new Date(); const tonight = new Date(now); tonight.setHours(20, 0, 0, 0); const tmr = new Date(now); tmr.setDate(now.getDate() + 1); tmr.setHours(9, 0, 0, 0); const nextWeek = new Date(tmr); nextWeek.setDate(tmr.getDate() + 6);
    const presets = [['In 1 hour', Date.now() + 3600e3], ...(tonight > now ? [['Tonight 8 PM', +tonight]] : []), ['Tomorrow 9 AM', +tmr], ['Next week', +nextWeek]];
    const local = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    const tags = [...n.tags, ...n.aiTags.filter((t) => !n.tags.includes(t))];
    openSheet(esc(`${stamp(n.createdAt)}${n.voice ? ' · spoken' : ''}`), `
      ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tg ${n.tags.includes(t) ? '' : 'ai '}${hue(t)}" data-act="tag" data-v="${esc(t)}">#${esc(t)}</span>`).join('')}</div>` : ''}
      <textarea id="edittext" rows="5" aria-label="Edit">${esc(n.text)}</textarea>
      ${n.images.length ? `<div class="pics">${n.images.map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt=""></a>`).join('')}</div>` : ''}
      ${n.links.map((l) => `<a class="lprev${l.image ? '' : ' noimg'}" href="${safeUrl(l.url)}" target="_blank" rel="noopener">${l.image ? `<img src="${esc(l.image)}" alt="">` : ''}<span style="min-width:0"><b>${esc(l.title || l.url)}</b><small>${esc(l.site || host(l.url))}</small></span></a>`).join('')}
      <div><div class="fine" style="margin-bottom:8px;font-weight:600">Reminder${n.remind ? `: ${esc(n.remind.done ? `sent ${whenLabel(n.remind.sentAt || n.remind.at)}${n.remind.via && n.remind.via.length ? ` by ${n.remind.via.join(', ')}` : ''}` : whenLabel(n.remind.at))}` : ''}</div>
        <div class="presets">${presets.map(([l, t]) => `<button class="btn small quiet" data-act="remind-at" data-v="${t}">${l}</button>`).join('')}${n.remind && !n.remind.done ? '<button class="btn small quiet" data-act="remind-off">Cancel reminder</button>' : ''}</div>
        <div class="dates" style="margin-top:8px"><input type="datetime-local" id="remat" value="${local(n.remind && !n.remind.done ? n.remind.at : +tmr)}" aria-label="Remind me at"><button class="btn small" data-act="remind-custom">Set</button></div></div>
      ${n.aiTags.length ? '<p class="fine">Dashed tags were added by AI. <button class="link" data-act="drop-ai">Remove them</button></p>' : ''}
      <div class="actions"><button class="btn" data-act="save-edit">Save</button><button class="btn quiet" data-act="pin">${I('push-pin', 18)}${n.pinned ? 'Unpin' : 'Pin'}</button><button class="btn quiet" data-act="copy-note">${I('copy', 18)}Copy</button><button class="btn quiet" data-act="delete-note" aria-label="Delete">${I('trash', 18)}</button></div>
      <p class="fine">From ${esc({ web: 'the app', telegram: 'Telegram', sms: 'a text message', shortcut: 'a Shortcut' }[n.source] || n.source)} · saved ${esc(ago(n.createdAt))}</p>`);
  }
  function replaceNote(n) {
    for (const list of [S.list, S.results || []]) { const i = list.findIndex((x) => x.id === n.id); if (i >= 0) list[i] = n; }
    if ($('#feed')) {
      if (!filtering()) { const pins = S.list.filter((x) => x.pinned).sort((a, b) => b.createdAt - a.createdAt); S.list = [...pins, ...S.list.filter((x) => !x.pinned).sort((a, b) => b.createdAt - a.createdAt)]; }
      drawFeed();
    }
    if ($('#rem')) remindersView();
  }

  // ---- ask your jots ------------------------------------------------------------------------
  function askView() {
    app.innerHTML = `<header class="top"><a class="iconbtn" href="#/" aria-label="Back">${I('arrow-left', 22)}</a><h1>Ask your jots</h1></header>
      <main class="page narrow"><form id="askform" style="display:grid;gap:10px;margin-top:8px"><div class="field"><label for="askq">Ask in plain words. The answer comes only from what you saved.</label><textarea id="askq" rows="2" placeholder="What did I decide about pricing?" maxlength="500"></textarea></div><button class="btn" style="justify-self:start">${I('sparkle', 18)}Ask</button></form><div id="answer"></div></main>${nav('')}`;
    $('#askform').onsubmit = async (e) => {
      e.preventDefault();
      const q = $('#askq').value.trim(); if (!q) return;
      const b = e.target.querySelector('.btn'); busy(b, true, 'Thinking');
      $('#answer').innerHTML = '<div class="sk" style="height:90px;margin-top:14px"></div>';
      try {
        const r = await api('/api/ask', { method: 'POST', body: { question: q } });
        const cited = r.cited.filter((c) => c.note);
        S.results = cited.map((c) => c.note);
        const ks = new Set(cited.map((c) => String(c.k)));
        $('#answer').innerHTML = `<div class="answer">${esc(r.answer).replace(/\s?\[(\d{1,3})\]/g, (m, k) => (ks.has(k) ? `<sup>[${k}]</sup>` : '')).replace(/\s+([.,;])/g, '$1')}</div>${cited.length ? `<h2 class="sub">From these jots</h2><div class="cites">${cited.map((c) => `<div><span class="k">[${c.k}]</span>${cardHtml(c.note)}</div>`).join('')}</div>` : ''}`;
      } catch (err) { $('#answer').innerHTML = `<div class="notice bad" style="margin-top:14px">${esc(err.message)}</div>`; }
      busy(b, false);
    };
    setTimeout(() => $('#askq') && $('#askq').focus(), 100);
  }

  // ---- reminders ------------------------------------------------------------------------------
  async function remindersView() {
    if (!$('#rem')) app.innerHTML = `<header class="top"><h1>Reminders</h1></header><main class="page narrow" id="rem"><div class="sk" style="height:120px;margin-top:12px"></div></main>${nav('reminders')}`;
    let r; try { r = await api('/api/reminders'); } catch (e) { $('#rem').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    S.results = [...r.upcoming, ...r.done];
    const row = (n) => `<article class="card" data-act="open" data-v="${n.id}"><div class="meta"><span class="remchip ${n.remind.done ? 'done' : ''}">${I(n.remind.done ? 'check' : 'bell', 12)}${esc(whenLabel(n.remind.done ? n.remind.sentAt || n.remind.at : n.remind.at))}</span>${n.remind.done && n.remind.via.length ? `<span>by ${esc(n.remind.via.join(', '))}</span>` : ''}</div><div class="t">${esc(n.remind.text)}</div>${n.remind.done ? '' : `<div class="actions"><button class="btn small quiet" data-act="snooze" data-v="${n.id}:60">Push 1 hour</button><button class="btn small quiet" data-act="snooze" data-v="${n.id}:1440">Push a day</button></div>`}</article>`;
    $('#rem').innerHTML = `${r.upcoming.length ? `<h2 class="sub">Coming up</h2><div class="cites">${r.upcoming.map(row).join('')}</div>` : '<div class="empty"><h2>No reminders waiting.</h2><p>Say "remind me" with a time in any jot: "remind me to call Sam at 5pm", "in 30 minutes", "tomorrow morning", "on Friday".</p></div>'}${r.done.length ? `<h2 class="sub">Already sent</h2><div class="cites">${r.done.map(row).join('')}</div>` : ''}`;
  }

  // ---- settings -------------------------------------------------------------------------------
  async function settingsView() {
    app.innerHTML = `<header class="top"><h1>Settings</h1></header><main class="page narrow" id="set"><div class="sk" style="height:160px;margin-top:12px"></div></main>${nav('settings')}`;
    let s; try { s = await api('/api/settings'); } catch (e) { $('#set').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    S.settings = s;
    if (s.prefs.tz !== TZ) api('/api/settings', { method: 'POST', body: { tz: TZ } }).catch(() => {});
    const pushOk = 'PushManager' in window && 'serviceWorker' in navigator;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const voiceOk = window.Voice && Voice.supported();
    $('#set').innerHTML = `
      <h2 class="sub">Send jots from</h2>
      <div class="panel">
        <div class="row">${I('microphone', 24)}<span class="grow"><b>Your voice</b><small>${voiceOk ? 'Tap the mic in the bar at the bottom of Jots and talk. Your words appear as you speak; tap send when they look right.' : 'This browser cannot record. Try Safari or Chrome.'}${s.telegram.ready ? ' On Telegram, just send a voice note.' : ''}</small></span></div>
        <div class="row">${I('telegram-logo', 24)}<span class="grow"><b>Telegram</b><small>${s.telegram.linked ? 'Linked. Send the bot anything: words, photos, voice notes.' : s.telegram.ready ? 'Free and instant on every phone and computer.' : 'Not set up on this Jot yet.'}</small></span>${s.telegram.linked ? '<button class="btn small quiet" data-act="tg-off">Unlink</button>' : s.telegram.ready ? '<button class="btn small" data-act="tg-on">Connect</button>' : '<span class="state">Soon</span>'}</div>
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
      <div class="panel" style="padding:12px 16px"><div class="seg" role="group">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match phone']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${theme() === v}">${l}</button>`).join('')}</div></div>
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
    app.innerHTML = `<header class="top"><h1>Admin</h1></header><main class="page narrow" id="adm"><div class="sk" style="height:140px;margin-top:12px"></div></main>${nav('admin')}`;
    let r; try { r = await api('/api/admin'); } catch (e) { $('#adm').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    S.admin = r;
    const st = r.stats, own = r.viewerIsOwner;
    const tile = (n, l) => `<div class="tile"><small>${l}</small><b>${n}</b></div>`;
    const key = (name) => { const k = r.secrets[name]; return `<div class="keyrow"><label class="fine" for="k-${name}" style="font-weight:600">${esc(k.label)} ${k.set ? `<span class="state on">set, ${esc(k.hint)}</span>` : '<span class="state">not set</span>'}</label><div class="kv"><input id="k-${name}" type="password" autocomplete="off" placeholder="${k.set ? 'Paste to replace' : 'Paste here'}"><button class="btn small" data-act="save-key" data-v="${name}">Save</button>${k.set ? `<button class="btn small quiet" data-act="clear-key" data-v="${name}">Clear</button>` : ''}</div></div>`; };
    $('#adm').innerHTML = `<p class="fine" style="margin-top:6px">${own ? 'You are the owner.' : 'You are an administrator.'}</p>
      <div class="tiles" style="margin-top:12px">${tile(st.people, 'People')}${tile(st.activeToday, 'Active today')}${tile(st.active7, 'Active this week')}${tile(st.notes, 'Jots')}${tile(st.notes7, 'Jots this week')}${tile(st.viaVoice || 0, 'Spoken')}${tile(st.reminders, 'Reminders')}${tile(st.viaTelegram, 'From Telegram')}${tile(st.viaSms, 'From texts')}${tile(st.viaShortcut, 'From Shortcuts')}${tile(st.purchases, 'Purchases')}${tile(money(st.revenue || 0, r.settings.currency), 'Revenue')}${tile(st.invitedWaiting, 'Invited, not joined')}</div>
      ${own ? `<h2 class="sub">Who can join</h2>
      <form class="panel" id="accessform" style="padding:14px 16px;display:grid;gap:12px">
        <div class="field"><label for="acc">Access</label><select id="acc"><option value="open" ${r.settings.access === 'open' ? 'selected' : ''}>Open: anyone signs up free</option><option value="invite" ${r.settings.access === 'invite' ? 'selected' : ''}>Invite only</option><option value="paid" ${r.settings.access === 'paid' ? 'selected' : ''}>Paid: one-time purchase</option></select></div>
        <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="price">Price (${esc(r.settings.currency.toUpperCase())})</label><input id="price" inputmode="decimal" value="${(r.settings.priceCents / 100).toFixed(2)}"></div><div class="field" style="flex:2"><label for="pname">Name on the receipt</label><input id="pname" value="${esc(r.settings.productName)}" maxlength="80"></div></div>
        ${r.settings.access === 'paid' && !r.channels.stripe ? '<div class="notice bad">Paid access needs the Stripe keys below, or nobody can buy.</div>' : ''}
        <button class="btn small" style="justify-self:start">Save</button></form>
      <h2 class="sub">Keys for outside services</h2>
      <div class="panel" style="padding:4px 16px">
        <p class="fine" style="padding-top:12px"><b>Telegram</b> (free): message @BotFather, send /newbot, paste the token. ${r.channels.telegramBot ? `Running as @${esc(r.channels.telegramBot)}.` : ''}</p>${key('telegramToken')}
        <p class="fine" style="padding-top:12px"><b>Text messages</b> (Twilio, paid): buy a number at twilio.com, set its "A message comes in" webhook to <span class="mono">${esc(r.channels.smsWebhookUrl)}</span> (HTTP POST), then paste these.</p>${key('twilioSid')}${key('twilioToken')}${key('twilioFrom')}
        <p class="fine" style="padding-top:12px"><b>Payments</b> (Stripe): add a webhook endpoint <span class="mono">${esc(r.channels.webhookUrl)}</span> for <span class="mono">checkout.session.completed</span>, then paste the secret key and the signing secret.</p>${key('stripeSecret')}${key('stripeWebhook')}
        <p class="fine" style="padding:12px 0">Speech on this server: ${r.channels.speech ? `ready${r.channels.voiceNotes ? ', including Telegram voice notes' : ' (Telegram voice notes also need ffmpeg)'}` : 'not installed; phones that dictate by themselves still work'}.</p>
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
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'LABEL') return;
    // Links inside a card open the link, not the card.
    if (t.classList.contains('card') && e.target.closest('a')) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (act === 'close') return closeSheet();
    if (act === 'open') { history.replaceState(null, '', `#/n/${v}`); return openNote(v); }
    if (act === 'tag') { closeSheet(true); if ($('#feed')) { S.f.tag = v; drawTagRow(); window.scrollTo(0, 0); return load(true); } location.hash = `#/t/${encodeURIComponent(v)}`; return; }
    if (act === 'filter-tag') { S.f.tag = S.f.tag === v ? '' : v; drawTagRow(); window.scrollTo(0, 0); return load(true); }
    if (act === 'clear-q') { $('#q').value = ''; S.f.q = ''; t.hidden = true; return load(true); }
    if (act === 'toggle-dates') { const p = $('#datepane'); p.hidden = !p.hidden; if (p.hidden && S.f.range !== 'all') { S.f.range = 'all'; t.setAttribute('aria-pressed', 'false'); p.querySelectorAll('[data-act=range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === 'all'))); load(true); } return; }
    if (act === 'range') { S.f.range = v; t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); $('#custom').hidden = v !== 'custom'; $('[data-act=toggle-dates]').setAttribute('aria-pressed', String(v !== 'all')); return load(true); }
    if (act === 'pick-image') return $('#pic').click();
    if (act === 'mic') return toggleVoice();
    if (act === 'unpick') { pending.splice(Number(v), 1); drawThumbs(); $('#jottext').dispatchEvent(new Event('input')); return; }
    if (act === 'try') { const ta = $('#jottext'); ta.value = v; ta.dispatchEvent(new Event('input')); return $('#jotform').requestSubmit(); }
    if (act === 'buy') { busy(t, true); try { const r = await api('/api/checkout', { method: 'POST', body: {}, anon: true }); location.href = r.url; } catch (err) { toast(err.message, true); busy(t, false); } return; }
    if (act === 'resend') { try { await api('/api/forgot', { method: 'POST', body: { email: v }, anon: true }); toast('Sent again. Both links work.'); } catch (err) { toast(err.message, true); } return; }
    if (act === 'logout') { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; location.hash = '#/'; return render(); }
    if (act === 'theme') { try { localStorage.setItem('jt-theme', v); } catch {} applyTheme(); t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return; }
    if (act === 'copy-text') { try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast('Select it and copy', true); } return; }
    const n = S.open;
    try {
      if (act === 'save-edit' && n) { const r = await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { text: $('#edittext').value } }); closeSheet(); replaceNote(r.note); toast('Saved'); }
      else if (act === 'pin' && n) { const r = await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { pinned: !n.pinned } }); closeSheet(); replaceNote(r.note); toast(r.note.pinned ? 'Pinned to the top' : 'Unpinned'); }
      else if (act === 'copy-note' && n) { await navigator.clipboard.writeText(n.text); toast('Copied'); }
      else if (act === 'delete-note' && n) { if (!confirm('Delete this jot?')) return; await api(`/api/notes/${n.id}`, { method: 'DELETE' }); S.list = S.list.filter((x) => x.id !== n.id); S.results = (S.results || []).filter((x) => x.id !== n.id); closeSheet(); drawFeed(); if ($('#rem')) remindersView(); toast('Deleted'); }
      else if (act === 'drop-ai' && n) { const r = await api(`/api/notes/${n.id}`, { method: 'PATCH', body: { removeAiTags: n.aiTags } }); closeSheet(); replaceNote(r.note); }
      else if ((act === 'remind-at' || act === 'remind-custom' || act === 'remind-off') && n) {
        const body = act === 'remind-off' ? { off: true } : { at: act === 'remind-at' ? Number(v) : +new Date($('#remat').value) };
        const r = await api(`/api/notes/${n.id}/remind`, { method: 'POST', body });
        closeSheet(); replaceNote(r.note); toast(r.when ? `I'll remind you ${r.when}` : 'Reminder cancelled');
      }
      else if (act === 'snooze') { const [id, m] = v.split(':'); const r = await api(`/api/notes/${id}/remind`, { method: 'POST', body: { snoozeMin: Number(m) } }); toast(`I'll remind you ${r.when}`); remindersView(); }
      else if (act === 'tg-on') { const r = await api('/api/channels/telegram', { method: 'POST' }); window.open(r.url, '_blank'); toast('Tap Start in Telegram to finish'); }
      else if (act === 'tg-off') { await api('/api/channels/telegram', { method: 'DELETE' }); settingsView(); }
      else if (act === 'sms-on') { const r = await api('/api/channels/sms', { method: 'POST' }); $('#smsbox').innerHTML = `<div class="notice" style="margin-top:8px">From your phone, text <b>LINK ${esc(r.code)}</b> to <b>${esc(r.number)}</b>. The code works for 30 minutes.</div>`; }
      else if (act === 'sms-off') { await api('/api/channels/sms', { method: 'DELETE' }); settingsView(); }
      else if (act === 'new-capture') { if (!confirm('Make a new link? Shortcuts using the old one stop working.')) return; await api('/api/channels/capture', { method: 'POST' }); settingsView(); }
      else if (act === 'push-on') { busy(t, true); await pushOn(); toast('Sent a test notification'); settingsView(); }
      else if (act === 'delete-account') { const c = prompt('This deletes your account and every jot. Type DELETE to confirm.'); if (c !== 'DELETE') return; await api('/api/account', { method: 'DELETE', body: { confirm: 'DELETE' } }); S.me = null; location.hash = '#/'; render(); }
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
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

  // ---- live updates: jots from Telegram, texts or Shortcuts appear by themselves ---------------
  let es;
  function connect() {
    if (es) return;
    es = new EventSource('/api/events');
    es.onmessage = async (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.event !== 'note' || !$('#feed')) return;
      if (ev.removed) { S.list = S.list.filter((x) => x.id !== ev.id); drawFeed(); return; }
      try {
        const { note } = await api(`/api/notes/${ev.id}`);
        if (S.list.some((x) => x.id === note.id)) replaceNote(note);
        else if (!filtering()) { const pins = S.list.filter((n) => n.pinned); S.list = [...pins, note, ...S.list.filter((n) => !n.pinned)]; drawFeed(note.id); loadTags(); }
      } catch {}
    };
    es.onerror = () => { es.close(); es = null; setTimeout(() => { if (S.me) connect(); }, 5000); };
  }

  boot();
})();
