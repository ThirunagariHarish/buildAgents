// Pocket Box Studio: one page, hash routes, live updates over server-sent
// events. No framework; every screen is a function that returns HTML.
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const S = { session: null, meta: null, agents: [], agent: null, tab: 'thread', devices: null, open: new Set(), files: null, file: null, runs: null, users: null, es: null, version: null };

  // ---- small helpers ----------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error('No connection. Check your network and try again.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.login) { S.session = { authed: false }; go('#/login'); throw new Error(data.error); }
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status, data });
    return data;
  }

  function toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    $('#toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, kind === 'bad' ? 5200 : 3200);
  }

  function ago(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const clock = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  function greeting() { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

  // A small, safe markdown: text is escaped first; only these shapes come back.
  function md(src) {
    const blocks = [];
    let s = String(src || '').replace(/\r/g, '');
    s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => { blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const out = [];
    const lines = s.split('\n');
    let list = null, para = [], table = null;
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flushTable = () => {
      if (!table) return;
      const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()));
      out.push(`<table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table>`);
      table = null;
    };
    for (const line of lines) {
      const m = line.match(/^\u0000(\d+)\u0000$/);
      if (m) { flushPara(); flushList(); flushTable(); out.push(blocks[Number(m[1])]); continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); (table = table || []).push(line); continue; }
      flushTable();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const li = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
      if (li) {
        flushPara();
        const tag = li[1] ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push(li[2]);
        continue;
      }
      if (/^>\s?/.test(line)) { flushPara(); flushList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
      flushList();
      para.push(line.trim());
    }
    flushPara(); flushList(); flushTable();
    return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
  }

  const icon = {
    mic: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>',
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-3px"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1"/></svg>',
    addSquare: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-3px"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:inline;vertical-align:-3px"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    phone: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/></svg>',
    people: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.8a3.4 3.4 0 010 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2"/></svg>',
    user: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/></svg>',
  };

  // ---- installing the website as an app ---------------------------------------------
  // Android and desktop Chrome/Edge offer a real install prompt; iPhone does
  // not let a page add itself, so it gets a short guide instead.
  let installPrompt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; refreshInstall(); });
  addEventListener('appinstalled', () => { installPrompt = null; refreshInstall(); toast('Pocket Box is on your Home Screen.'); });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function devicePlatform() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }
  const canInstall = () => !standalone() && (!!installPrompt || devicePlatform() !== 'desktop');
  function installCard({ dismissible = false } = {}) {
    if (!canInstall() || (dismissible && store.get('pb.installHidden', false))) return '';
    return `<div class="glass row install-card pop" style="gap:14px;padding:12px 12px 12px 14px;border-radius:var(--r-md)">
      <img src="/icon-180.png" alt="" width="44" height="44" style="border-radius:12px;box-shadow:0 4px 12px -6px rgba(40,30,90,.4)">
      <div style="flex:1;min-width:0"><div class="h3">Install Pocket Box</div><div class="small muted">Open it from your Home Screen like an app.</div></div>
      <button class="btn sm" data-act="install">Install</button>
      ${dismissible ? '<button class="btn ghost sm icon" data-act="install-hide" aria-label="Hide">✕</button>' : ''}
    </div>`;
  }
  const installPill = () => (canInstall() ? `<button class="chip pop" data-act="install">${icon.addSquare} Install app</button>` : '');
  function refreshInstall() {
    for (const slot of document.querySelectorAll('[data-install-slot]')) {
      slot.innerHTML = slot.dataset.installSlot === 'pill' ? installPill() : installCard({ dismissible: slot.dataset.installSlot === 'home' });
    }
  }
  async function install() {
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      await p.prompt();
      const choice = await p.userChoice.catch(() => ({}));
      if (choice.outcome !== 'accepted') installPrompt = p;
      refreshInstall();
      return;
    }
    const ios = devicePlatform() === 'ios';
    const safari = ios && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    const steps = ios
      ? [
          safari ? `Tap ${icon.share} <strong>Share</strong> in Safari's toolbar. Don't see it? Tap ${icon.dots} first.` : `Tap ${icon.share} <strong>Share</strong> next to the address bar.`,
          `Scroll down and tap ${icon.addSquare} <strong>Add to Home Screen</strong>.`,
          'Tap <strong>Add</strong>, then open <strong>Pocket Box</strong> from your Home Screen.',
        ]
      : [
          `Tap ${icon.dots} in the browser's top-right corner.`,
          `Tap <strong>Install app</strong> or ${icon.addSquare} <strong>Add to Home screen</strong>.`,
          'Confirm, then open <strong>Pocket Box</strong> from your Home Screen.',
        ];
    sheet(`<div class="stack">
      <div class="row" style="gap:14px"><img src="/icon-180.png" alt="" width="52" height="52" style="border-radius:14px"><div><div class="h2" style="font-size:20px">Add Pocket Box to your Home Screen</div><div class="small muted">${ios ? 'iPhone adds web apps from the Share menu.' : 'Your browser adds it from its menu.'}</div></div></div>
      <ol class="install-steps">${steps.map((t) => `<li><span>${t}</span></li>`).join('')}</ol>
      ${ios ? '<p class="small muted" style="margin:0">Once it opens from the Home Screen, it can also show your agents\' notifications.</p>' : ''}
      <div class="row" style="justify-content:flex-end"><button class="btn sm" data-close>Got it</button></div>
    </div>`);
  }

  // ---- speaking instead of typing -------------------------------------------------------
  // The browser's own speech recognition (Chrome, Edge, Safari). The words
  // land in the box as you speak; tap the mic again, or pause, to stop.
  const Speech = self.SpeechRecognition || self.webkitSpeechRecognition;
  const micButton = () => (Speech ? `<button type="button" class="mic" data-act="mic" aria-label="Speak instead of typing" title="Speak">${icon.mic}</button>` : '');
  let listening = null;
  function toggleMic(btn) {
    if (listening) { listening.stop(); return; }
    const form = btn.closest('form');
    const ta = form && form.querySelector('textarea');
    if (!ta) return;
    const rec = new Speech();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    const before = ta.value.trim() ? `${ta.value.trim()} ` : '';
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      ta.value = (before + finalText + interim).replace(/\s+/g, ' ').trimStart();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for this site to speak your idea.', 'bad');
      else if (e.error === 'no-speech') toast('Didn\'t catch that. Tap the mic and try again.');
      else if (e.error !== 'aborted') toast(`Speech stopped: ${e.error}`, 'bad');
    };
    rec.onend = () => { listening = null; btn.classList.remove('listening'); btn.setAttribute('aria-label', 'Speak instead of typing'); ta.focus(); };
    try { rec.start(); } catch { toast('The microphone is busy. Try again.', 'bad'); return; }
    listening = rec;
    btn.classList.add('listening');
    btn.setAttribute('aria-label', 'Stop listening');
  }

  // ---- routing -----------------------------------------------------------------
  function route() {
    const h = location.hash.replace(/^#/, '') || '/';
    const parts = h.split('/').filter(Boolean);
    return { name: parts[0] || 'home', id: parts[1] || null, rest: parts.slice(2) };
  }
  function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

  let rendering = 0;
  async function render({ transition = true } = {}) {
    const ticket = ++rendering;
    const r = route();
    const publicRoutes = ['login', 'signup', 'forgot', 'reset'];
    if (!S.session) S.session = await api('/api/session').catch(() => ({ authed: false }));
    if (ticket !== rendering) return;
    if (!S.session.authed && !publicRoutes.includes(r.name)) return go('#/login');
    if (S.session.authed && ['login', 'signup'].includes(r.name)) return go('#/');
    if (S.session.authed) { connect(); if (!S.tzSent) { S.tzSent = true; api('/api/me/prefs', { method: 'POST', body: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).catch(() => {}); } }

    let html;
    try { html = await view(r); } catch (e) { html = errorView(e); }
    if (ticket !== rendering) return;
    const swap = () => { app.innerHTML = html; after(r); };
    if (transition && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
    else swap();
  }

  async function view(r) {
    switch (r.name) {
      case 'login': return loginView();
      case 'signup': return signupView();
      case 'forgot': return forgotView();
      case 'reset': return resetView(r.id);
      case 'a': return agentView(r.id);
      case 'phones': return phonesView();
      case 'people': return peopleView();
      case 'me': return meView();
      case 'templates': return templatesView(r.id);
      case 't': return templateView(r.id);
      case 'watch': return watchView();
      default: return homeView();
    }
  }

  function after(r) {
    window.scrollTo({ top: r.name === 'a' && S.tab === 'thread' ? document.body.scrollHeight : 0, behavior: 'instant' });
    for (const ta of app.querySelectorAll('textarea[data-grow]')) grow(ta);
    centerStage();
    const auto = app.querySelector('[autofocus]');
    if (auto && matchMedia('(hover: hover)').matches) auto.focus();
  }
  function centerStage() {
    const now = app.querySelector('.stage.now');
    const bar = now?.parentElement;
    if (bar) bar.scrollLeft = Math.max(0, now.offsetLeft - (bar.clientWidth - now.offsetWidth) / 2);
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.4)}px`; }

  // ---- live updates ----------------------------------------------------------
  function connect() {
    if (S.es) return;
    S.es = new EventSource('/api/events');
    S.es.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'hello') { if (S.version && m.version !== S.version) location.reload(); S.version = m.version; return; }
      onEvent(m);
    };
    S.es.onerror = () => { if (S.es && S.es.readyState === 2) { S.es = null; setTimeout(connect, 3000); } };
  }

  let refreshTimer = null;
  function softRefresh(delay = 250) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const r = route();
      if (r.name === 'a' && S.agent && S.agent.id === r.id) {
        try { S.agent = await api(`/api/agents/${r.id}`); } catch { return; }
        patchAgent();
      } else if (r.name === 'home') {
        render({ transition: false });
      }
    }, delay);
  }

  function onEvent(m) {
    const r = route();
    if (m.event === 'users' && r.name === 'people') return render({ transition: false });
    if (!m.agentId) return;
    const here = r.name === 'a' && r.id === m.agentId && S.agent;
    if (!here) { if (r.name === 'home') softRefresh(600); return; }
    if (m.event === 'deleted') { toast('That agent was deleted.'); return go('#/'); }
    if (m.event === 'message') {
      if (!S.agent.messages.some((x) => x.id === m.message.id)) S.agent.messages.push(m.message);
      S.agent.thinking = null;
      const list = $('#thread');
      if (list && S.tab === 'thread') {
        const near = innerHeight + scrollY > document.body.scrollHeight - 240;
        $('#thinking-slot')?.replaceChildren();
        list.insertAdjacentHTML('beforeend', msgView(m.message, true));
        if (near) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
      softRefresh(800);
      return;
    }
    if (m.event === 'thinking') {
      S.agent.thinking = { label: m.label || `${m.name} is thinking`, emoji: m.emoji };
      const slot = $('#thinking-slot');
      if (slot) slot.innerHTML = thinkingView(S.agent.thinking);
      return;
    }
    if (m.event === 'activity') {
      const el = $('#thinking-slot .label');
      if (el && m.activity) el.textContent = `${S.agent.thinking?.label || 'Working'} · ${m.activity.tool === 'say' ? '' : `${m.activity.tool} `}${String(m.activity.text || '').slice(0, 80)}`;
      return;
    }
    if (m.event === 'tasks') { S.agent.tasks = m.tasks; const t = $('#tasks'); if (t) t.outerHTML = tasksView(S.agent); return; }
    if (m.event === 'run') { if (S.tab === 'runs') { S.runs = null; softRefresh(100); loadRuns(); } else toast(`${S.agent.icon || '⚡'} New run from ${m.run.deviceName}`); return; }
    softRefresh();
  }

  // Re-render the parts of an open agent that change, keeping scroll and the draft.
  function patchAgent() {
    const a = S.agent;
    const head = $('#agent-head'); if (head) { head.outerHTML = agentHead(a); centerStage(); }
    const dock = $('#cta'); if (dock) dock.outerHTML = ctaView(a);
    const slot = $('#thinking-slot'); if (slot) slot.innerHTML = a.running ? thinkingView(a.thinking) : '';
    const t = $('#tasks'); if (t) t.outerHTML = tasksView(a);
    const tabs = $('#tabs'); if (tabs) tabs.outerHTML = tabsView(a);
    if (S.tab === 'settings') { const s = $('#tab-body'); if (s && !s.contains(document.activeElement)) s.innerHTML = settingsTab(a); }
  }

  // ---- auth screens ------------------------------------------------------------
  const authShell = (inner) => `<div class="center"><section class="auth glass rise">${inner}</section></div>`;
  function loginView() {
    return authShell(`
      <div class="row" style="margin-bottom:28px"><div class="brand"><span class="mark"></span>Pocket Box</div><span class="spacer"></span><span data-install-slot="pill">${installPill()}</span></div>
      <h1 class="display">Agents that live <em>in your pocket</em>.</h1>
      <p class="muted" style="margin:12px 0 24px">Describe what you want done. A room of experts designs it, a crew builds and tests it, and it runs on your phone.</p>
      <form data-form="login" class="stack">
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required autofocus></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <div id="form-note"></div>
        <button class="btn" style="width:100%">Sign in</button>
      </form>
      <div class="row" style="margin:14px 0 0;gap:10px;color:var(--faint)"><span style="flex:1;height:1px;background:var(--line-2)"></span><span class="small">New here?</span><span style="flex:1;height:1px;background:var(--line-2)"></span></div>
      <a class="btn soft" href="#/signup" style="width:100%;margin-top:14px">Create an account</a>
      <div class="row small" style="margin-top:16px;justify-content:center">
        <a class="link" href="#/forgot">Forgot password?</a>
      </div>`);
  }
  function signupView() {
    return authShell(`
      <a class="btn ghost sm" href="#/login" style="margin:-8px 0 12px -10px">${icon.back} Back</a>
      <h1 class="display" style="font-size:40px">Create your <em>account</em></h1>
      <p class="muted" style="margin:10px 0 22px">${S.session?.openSignup === false ? 'The administrator approves each new account. Once approved, you\'ll get a link to set your password.' : 'We\'ll email you a link to set your password. That\'s it.'}</p>
      <form data-form="signup" class="stack">
        <div class="row" style="gap:10px">
          <label class="field" style="flex:1"><span>First name</span><input class="input" name="firstName" autocomplete="given-name" required autofocus></label>
          <label class="field" style="flex:1"><span>Last name</span><input class="input" name="lastName" autocomplete="family-name" required></label>
        </div>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" autocomplete="tel" required></label>
        <div id="form-note"></div>
        <button class="btn" style="width:100%">Create account</button>
      </form>`);
  }
  function forgotView() {
    return authShell(`
      <a class="btn ghost sm" href="#/login" style="margin:-8px 0 12px -10px">${icon.back} Back</a>
      <h1 class="display" style="font-size:40px">Reset your <em>password</em></h1>
      <p class="muted" style="margin:10px 0 22px">We'll email a one-time link to set a new one.</p>
      <form data-form="forgot" class="stack">
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required autofocus></label>
        <div id="form-note"></div>
        <button class="btn" style="width:100%">Email me a link</button>
      </form>`);
  }
  async function resetView(token) {
    const r = await api(`/api/reset?token=${encodeURIComponent(token || '')}`).catch(() => ({ valid: false }));
    if (!r.valid) return authShell(`<h1 class="display" style="font-size:38px">This link has <em>expired</em></h1><p class="muted" style="margin:12px 0 22px">Links work once, for 24 hours.</p><a class="btn" href="#/forgot" style="width:100%">Get a new link</a>`);
    return authShell(`
      <h1 class="display" style="font-size:40px">Set a <em>password</em></h1>
      <p class="muted" style="margin:10px 0 22px">For ${esc(r.email)}. At least 10 characters.</p>
      <form data-form="reset" data-token="${esc(token)}" class="stack">
        <input type="email" name="username" value="${esc(r.email)}" autocomplete="username" hidden>
        <label class="field"><span>New password</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="10" required autofocus></label>
        <div id="form-note"></div>
        <button class="btn" style="width:100%">Save and sign in</button>
      </form>`);
  }

  // ---- chrome ------------------------------------------------------------------
  function topBar(extra = '') {
    const u = S.session?.user;
    return `<header class="top">
      <a class="brand" href="#/"><span class="mark"></span><span>Pocket Box</span></a>
      <span class="spacer"></span>${extra}
      <a class="btn ghost icon" href="#/phones" title="Your phones" aria-label="Your phones">${icon.phone}</a>
      ${u?.role === 'admin' ? `<a class="btn ghost icon" href="#/people" title="People" aria-label="People">${icon.people}</a>` : ''}
      <a class="btn ghost icon" href="#/me" title="You" aria-label="You">${icon.user}</a>
    </header>`;
  }

  const STAGES = [['room', 'Room'], ['brief', 'Brief'], ['planning', 'Plan'], ['building', 'Build'], ['shadow', 'Shadow'], ['live', 'Live']];
  const stageIndex = (s) => ({ room: 0, brief: 1, planning: 2, plan_review: 2, building: 3, shadow: 4, live: 5 }[s] ?? 0);
  const stageName = (a) => ({ room: 'In the room', brief: 'Brief ready', planning: 'Planning', plan_review: 'Plan ready', building: 'Building', shadow: 'Shadow mode', live: 'Live' }[a.stage] || a.stage);

  function statusPill(a) {
    if (a.status === 'running' || a.running) return '<span class="pill accent"><span class="dot live"></span>Working</span>';
    if (a.status === 'error') return '<span class="pill bad">Stopped</span>';
    if (a.status === 'paused') return '<span class="pill warn">Paused</span>';
    if (a.release?.channel === 'off') return '<span class="pill">Off</span>';
    if (a.stage === 'live') return '<span class="pill good"><span class="dot"></span>Live</span>';
    if (a.stage === 'shadow') return '<span class="pill accent">Shadow</span>';
    return `<span class="pill">${esc(stageName(a))}</span>`;
  }

  // ---- home ----------------------------------------------------------------------
  async function homeView() {
    const [list, , meta, devs] = await Promise.all([
      api('/api/agents'),
      loadTemplates(),
      S.meta ? Promise.resolve(S.meta) : api('/api/meta'),
      S.devices ? Promise.resolve({ devices: S.devices }) : api('/api/devices').catch(() => ({ devices: [] })),
    ]);
    S.agents = list.agents; S.meta = meta; S.devices = devs.devices;
    const name = S.session.user?.firstName || '';
    const waiting = S.agents.filter((a) => a.needsYou && a.mine);
    const rest = S.agents.filter((a) => !(a.needsYou && a.mine));
    const tpl = store.get('pb.template', null);
    return `<div class="shell">${topBar()}
      <section style="padding:36px 0 28px" class="rise">
        <div class="eyebrow">${esc(greeting())}${name ? `, ${esc(name)}` : ''}</div>
        <h1 class="display" style="margin-top:10px">What should <em>your agent</em> do?</h1>
        <p class="lede">Say it the way you'd ask a friend. The room turns it into a brief; the crew builds, tests and signs it; your phone runs it.</p>
      </section>
      <div data-install-slot="home" style="margin-bottom:16px">${installCard({ dismissible: true })}</div>
      <form data-form="new" class="composer glass rise">
        <textarea name="idea" data-grow rows="3" placeholder="Every weekday at 7:30, tell me if I need an umbrella and when to leave for my first meeting…" required></textarea>
        <div class="bar">
          <span class="small faint hide-sm">Shift + Enter for a new line</span>
          <span class="spacer"></span>
          ${micButton()}<button class="send" aria-label="Start" disabled>${icon.send}</button>
        </div>
      </form>
      <div class="row wrap rise" style="margin-top:14px;gap:8px">
        ${meta.templates.map((t) => `<button class="chip ${tpl === t.id ? 'on' : ''}" data-act="template" data-id="${esc(t.id)}" title="${esc(t.hint)}">${esc(t.emoji)} ${esc(t.name)}</button>`).join('')}
      </div>
      <section style="margin-top:36px" class="rise">
        <div class="row between" style="margin:0 4px 12px"><div class="eyebrow">Ready in one tap</div><a class="link small" href="#/templates">See all ${S.templates.length}</a></div>
        <a href="#/watch" class="glass card row watch-hero" style="text-decoration:none;gap:14px;margin-bottom:12px">
          <div class="avatar">👀</div><div style="flex:1;min-width:0"><div class="h3">Watch a page for me</div><div class="small muted">Visa bulletin, results, prices, restocks, any page. Paste a link; we tell you when it changes.</div></div><span class="faint">›</span></a>
        <div class="tpl-grid">${S.templates.filter((t) => !['watch-page', 'price-drop', 'back-in-stock'].includes(t.id)).slice(0, 6).map(templateCard).join('')}</div>
      </section>
      ${S.devices.length ? '' : `<a href="#/phones" class="glass card row rise" style="margin-top:28px;text-decoration:none;gap:14px">
        <div class="avatar">📱</div><div class="grow" style="flex:1"><div class="h3">Put Pocket Box on your phone</div><div class="small muted">Agents run on your phone, not here. Pair it once; it takes a minute.</div></div><span class="faint">›</span></a>`}
      ${waiting.length ? `<section style="margin-top:36px"><div class="eyebrow" style="margin:0 0 12px 4px">Waiting for you</div><div class="stack">${waiting.map(agentCard).join('')}</div></section>` : ''}
      <section style="margin-top:36px">
        <div class="eyebrow" style="margin:0 0 12px 4px">${waiting.length ? 'Everything else' : 'Your agents'}</div>
        ${rest.length ? `<div class="stack">${rest.map(agentCard).join('')}</div>` : (waiting.length ? '' : '<div class="glass empty">No agents yet. Describe one above; the room starts as soon as you send it.</div>')}
      </section>
    </div>`;
  }

  // ---- ready-made agents ---------------------------------------------------------------------
  async function loadTemplates() {
    if (!S.templates) S.templates = (await api('/api/templates')).templates;
    return S.templates;
  }
  const templateCard = (t) => `<a class="glass tpl-card" href="#/t/${esc(t.id)}"><div class="row" style="gap:10px"><div class="avatar sm">${esc(t.icon)}</div><div class="h3">${esc(t.name)}</div></div><div class="small muted" style="margin-top:8px">${esc(t.summary)}</div></a>`;

  async function templatesView(cat) {
    await loadTemplates();
    const cats = [...new Set(S.templates.map((t) => t.category))];
    const shown = cat ? S.templates.filter((t) => t.category === decodeURIComponent(cat)) : S.templates;
    return `<div class="shell">${topBar()}
      <section style="padding:28px 0 18px" class="rise"><h1 class="display" style="font-size:clamp(36px,8vw,52px)">Ready-made <em>agents</em></h1>
        <p class="lede">Tested and signed already. Fill in a detail or two and it starts working: no build, no wait.</p></section>
      <div class="row wrap rise" style="gap:8px;margin-bottom:16px"><a class="chip ${!cat ? 'on' : ''}" href="#/templates">All</a>${cats.map((c) => `<a class="chip ${cat && decodeURIComponent(cat) === c ? 'on' : ''}" href="#/templates/${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>
      <div class="tpl-grid rise">${shown.map(templateCard).join('')}</div>
      <p class="small muted rise" style="margin-top:24px;text-align:center">Want something else? <a class="link" href="#/">Describe it</a> and the room will design it.</p>
    </div>`;
  }

  const DAY_NAMES = [['mon', 'M'], ['tue', 'T'], ['wed', 'W'], ['thu', 'T'], ['fri', 'F'], ['sat', 'S'], ['sun', 'S']];
  function whenPicker(w) {
    if (!w) return '';
    if (w.type === 'schedule') {
      const days = new Set(w.days || DAY_NAMES.map(([d]) => d));
      return `<div class="field"><span>When</span><div class="row wrap" style="gap:10px"><input class="input" type="time" name="when_at" value="${esc(w.default)}" style="width:auto">
        <div class="row" style="gap:4px" data-days>${DAY_NAMES.map(([d, l]) => `<button type="button" class="chip day ${days.has(d) ? 'on' : ''}" data-day="${d}" aria-label="${d}">${l}</button>`).join('')}</div></div></div>`;
    }
    const fmt = (m) => (m >= 60 ? `${m / 60} h` : `${m} min`);
    return `<div class="field"><span>How often</span><div class="row wrap" style="gap:8px" data-every>${w.choices.map((m) => `<button type="button" class="chip ${m === w.default ? 'on' : ''}" data-min="${m}">Every ${fmt(m)}</button>`).join('')}</div></div>`;
  }
  function fieldInput(f) {
    const type = f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : f.type === 'secret' ? 'password' : f.type === 'time' ? 'time' : 'text';
    return `<label class="field"><span>${esc(f.label)}${f.optional ? ' <span class="faint">(optional)</span>' : ''}</span>
      <input class="input" name="v_${esc(f.key)}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(f.default || '')}" placeholder="${esc(f.placeholder || '')}" ${f.optional ? '' : 'required'} autocomplete="off">
      ${f.help ? `<p class="tiny faint" style="margin:6px 4px 0">${esc(f.help)}</p>` : ''}</label>`;
  }
  const runsOnPicker = () => `<div class="field"><span>Where it runs</span><div class="tabs" style="background:var(--line)" data-runs><button type="button" class="tab on" data-runs-on="cloud">In the cloud</button><button type="button" class="tab" data-runs-on="phone">On my phone</button></div>
    <p class="tiny faint" style="margin:6px 4px 0">Cloud runs on time even when your phone is off; you get a notification, or an email if no device is set up.</p></div>`;

  async function templateView(id) {
    await loadTemplates();
    const t = S.templates.find((x) => x.id === id);
    if (!t) return errorView(new Error('No such ready-made agent.'));
    return `<div class="shell">
      <header class="top"><a class="btn ghost icon" href="#/templates" aria-label="Back">${icon.back}</a></header>
      <section class="rise" style="padding:4px 0 18px"><div class="row" style="gap:16px"><div class="avatar xl">${esc(t.icon)}</div><div><h1 class="h2" style="font-size:26px">${esc(t.name)}</h1><div class="small muted" style="margin-top:4px">${esc(t.category)} · tested and signed</div></div></div>
        <p class="lede" style="margin-top:16px">${esc(t.summary)}</p>
        ${t.examples ? `<div class="row wrap" style="gap:6px;margin-top:12px">${t.examples.map((e) => `<span class="pill">${esc(e)}</span>`).join('')}</div>` : ''}</section>
      <form data-form="install" data-id="${esc(t.id)}" class="glass card stack rise">
        ${(t.fields || []).map(fieldInput).join('')}
        ${whenPicker(t.when)}
        ${runsOnPicker()}
        <label class="row" style="gap:10px"><input type="checkbox" name="live" checked style="width:20px;height:20px"><span>Notify me for real right away <span class="small faint">(untick to watch it quietly first)</span></span></label>
        <div class="small muted">It may: ${(t.permissions || []).map((x) => esc((S.meta?.permissions || {})[x] || x).toLowerCase()).join('; ')}.</div>
        <div class="row"><button class="btn accent">Start ${esc(t.name)}</button></div>
      </form>
    </div>`;
  }

  // ---- the "watch a page" wizard -----------------------------------------------------------------
  function watchView() {
    const modes = [
      ['change', '✨', 'Anything changes', 'A new date, a new notice, a new line.'],
      ['words', '🔎', 'Certain words appear', 'e.g. "Results declared", "Final action date".'],
      ['price', '🏷️', 'The price drops', 'To or below the price you want.'],
      ['stock', '📦', 'It\'s back in stock', 'When "out of stock" disappears.'],
    ];
    return `<div class="shell">
      <header class="top"><a class="btn ghost icon" href="#/" aria-label="Back">${icon.back}</a></header>
      <section class="rise" style="padding:8px 0 20px"><h1 class="display" style="font-size:clamp(36px,8vw,52px)">Watch a page <em>for me</em></h1>
        <p class="lede">Stop refreshing it. Paste the link and say what you're waiting for.</p></section>
      <form data-form="watch" class="stack rise">
        <div class="composer glass slim"><input class="input" name="url" type="url" required placeholder="https://… the page you keep checking" style="background:transparent;box-shadow:none;font-size:17px" autofocus></div>
        <div class="field"><span>Tell me when…</span><div class="watch-modes" data-modes>${modes.map(([k, i, l, d], n) => `<button type="button" class="glass watch-mode ${n === 0 ? 'on' : ''}" data-mode="${k}"><span style="font-size:22px">${i}</span><span><span class="h3" style="display:block">${l}</span><span class="small muted">${d}</span></span></button>`).join('')}</div></div>
        <label class="field" data-extra="words" hidden><span>Words to look for</span><input class="input" name="words" placeholder="e.g. Results declared"></label>
        <label class="field" data-extra="price" hidden><span>Tell me at or below</span><input class="input" name="price" type="number" step="any" inputmode="decimal" placeholder="e.g. 799"></label>
        <label class="field" data-extra="stock" hidden><span>Words the page shows when sold out</span><input class="input" name="soldOut" value="out of stock"></label>
        <div class="field"><span>Check</span><div class="row wrap" style="gap:8px" data-every>${[[30, 'Every 30 min'], [60, 'Every hour'], [180, 'Every 3 h'], [720, 'Twice a day']].map(([m, l]) => `<button type="button" class="chip ${m === 60 ? 'on' : ''}" data-min="${m}">${l}</button>`).join('')}</div></div>
        <div class="row"><button class="btn accent">Start watching</button></div>
      </form>
    </div>`;
  }

  function agentCard(a) {
    const line = a.needsYou && a.mine ? a.needsYou
      : a.lastRun ? `${a.lastRun.ok ? 'Last run' : 'Last run failed'} ${ago(a.lastRun.at)} · ${a.lastRun.summary || ''}`
      : a.release ? `Version ${a.release.version} · ${a.release.channel}` : stageName(a);
    return `<a class="glass agent-card rise" href="#/a/${a.id}">
      <div class="avatar">${esc(a.icon || '✳︎')}</div>
      <div class="meta"><div class="title">${esc(a.title)}</div><div class="sub">${esc(line)}</div></div>
      ${statusPill(a)}
    </a>`;
  }

  // ---- an agent ------------------------------------------------------------------
  async function agentView(id) {
    if (!S.agent || S.agent.id !== id) { S.tab = 'thread'; S.runs = null; S.files = null; S.file = null; S.open = new Set(); }
    const [a, meta] = await Promise.all([api(`/api/agents/${id}`), S.meta ? S.meta : api('/api/meta')]);
    S.agent = a; S.meta = meta;
    if (S.tab === 'runs' && !S.runs) await loadRuns(false);
    if (S.tab === 'code' && !S.files) await loadFiles(false);
    return `<div class="shell has-dock">
      <header class="top">
        <a class="btn ghost icon" href="#/" aria-label="Back">${icon.back}</a>
        <span class="spacer"></span>
        <button class="btn ghost sm" data-act="agent-menu">•••</button>
      </header>
      ${agentHead(a)}
      ${tabsView(a)}
      <div id="tab-body" style="margin-top:18px">${tabBody(a)}</div>
    </div>
    <div class="dock"><div class="dock-inner">
      ${ctaView(a)}
      ${a.ownerId === S.session.user.id ? `<form data-form="message" class="composer glass slim">
        <textarea name="text" data-grow rows="1" placeholder="${esc(placeholderFor(a))}"></textarea>
        <div class="bar"><span class="spacer"></span>${micButton()}<button class="send" aria-label="Send" disabled>${icon.send}</button></div>
      </form>` : ''}
    </div></div>`;
  }

  function placeholderFor(a) {
    if (a.stage === 'room' || a.stage === 'brief') return 'Add a detail, or answer the room…';
    if (a.stage === 'plan_review') return 'Ask about the plan or ask for a change…';
    return 'Ask a question, or tell the crew what to change…';
  }

  function agentHead(a) {
    const idx = stageIndex(a.stage);
    return `<section id="agent-head" style="padding:8px 0 4px">
      <div class="row" style="gap:16px;align-items:flex-start">
        <div class="avatar xl pop">${esc(a.icon || '✳︎')}</div>
        <div style="min-width:0;flex:1;padding-top:4px">
          <h1 class="h2" style="font-size:26px;line-height:1.15">${esc(a.title)}</h1>
          <div class="row wrap" style="margin-top:8px;gap:8px">${statusPill(a)}${a.package ? `<span class="pill">v${esc(a.package.version)}</span>` : ''}${a.ownerName ? `<span class="pill">${esc(a.ownerName)}</span>` : ''}</div>
        </div>
      </div>
      <nav class="stages" style="margin-top:18px" aria-label="Progress">
        ${STAGES.map(([, label], i) => `${i ? '<span class="stage-line"></span>' : ''}<span class="stage ${i < idx ? 'done' : i === idx ? 'now' : ''}">${label}</span>`).join('')}
      </nav>
      ${a.status === 'error' && a.error ? `<div class="note bad" style="margin-top:14px">${esc(a.error)}</div>` : ''}
      ${a.missingSettings?.length && a.package ? `<div class="note warn" style="margin-top:14px">It needs ${a.missingSettings.length === 1 ? 'a setting' : 'settings'} from you: ${esc(a.missingSettings.join(', '))}. <button class="link" data-act="tab" data-tab="settings">Add ${a.missingSettings.length === 1 ? 'it' : 'them'}</button></div>` : ''}
    </section>`;
  }

  function tabsView(a) {
    const tabs = [['thread', 'Thread']];
    if (a.package) tabs.push(['runs', 'Runs'], ['settings', 'Settings']);
    if (a.stage !== 'room' && a.stage !== 'brief') tabs.push(['code', 'Code']);
    if (!tabs.some(([k]) => k === S.tab)) S.tab = 'thread';
    return `<div id="tabs" class="tabs glass" role="tablist" style="margin-top:18px">${tabs.map(([k, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" role="tab" aria-selected="${S.tab === k}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  }

  function tabBody(a) {
    if (S.tab === 'runs') return runsTab(a);
    if (S.tab === 'settings') return settingsTab(a);
    if (S.tab === 'code') return codeTab(a);
    return `${tasksView(a)}<div class="thread" id="thread">${a.messages.map((m) => msgView(m)).join('')}</div><div id="thinking-slot" style="margin-top:14px">${a.running ? thinkingView(a.thinking) : ''}</div>`;
  }

  const DOC_KINDS = new Set(['brief', 'plan', 'evaluation']);
  function msgView(m, fresh = false) {
    const owner = m.kind === 'owner';
    const system = m.kind === 'system';
    const doc = DOC_KINDS.has(m.kind);
    const open = S.open.has(m.id) || owner || (doc && m.kind === 'brief');
    const long = !owner && m.content && m.content.trim() !== String(m.summary || '').trim();
    return `<article class="msg ${owner ? 'owner' : system ? 'system' : doc ? 'doc' : ''} ${fresh ? 'rise' : ''}" data-id="${esc(m.id)}">
      ${owner ? '' : `<div class="avatar sm">${esc(m.emoji || '✳︎')}</div>`}
      <div class="body">
        <div class="who">${esc(owner ? 'You' : m.agentName || 'Pocket Box')}${doc ? `<span class="pill accent">${esc(m.kind)}</span>` : ''}<span class="when">${clock(m.ts)}</span></div>
        <div class="bubble ${owner ? '' : 'glass'}">
          ${owner ? `<div class="prose">${md(m.content)}</div>` : `<div class="summary">${esc(m.summary || '')}</div>
          ${long ? (open ? `<div class="prose" style="margin-top:8px">${md(m.content)}</div><button class="more" data-act="fold" data-id="${esc(m.id)}">Show less</button>` : `<button class="more" data-act="fold" data-id="${esc(m.id)}">${doc ? `Read the ${esc(m.kind)}` : 'Read more'}</button>`) : ''}`}
        </div>
      </div>
    </article>`;
  }

  function thinkingView(t) {
    return `<div class="thinking glass pop"><span class="orb"></span><span class="label">${esc(t?.label || 'Working')}</span></div>`;
  }

  function tasksView(a) {
    const tasks = a.tasks || [];
    if (!tasks.length || !['building', 'shadow', 'live'].includes(a.stage)) return '<div id="tasks"></div>';
    const done = tasks.filter((t) => t.status === 'done').length;
    const pct = Math.round((done / tasks.length) * 100);
    return `<div id="tasks" class="glass card" style="margin-bottom:18px">
      <div class="row between"><div class="h3">Build tasks</div><span class="small muted">${done} of ${tasks.length}</span></div>
      <div style="height:6px;border-radius:3px;background:var(--line);margin:12px 0 6px;overflow:hidden"><div style="height:100%;width:${pct}%;border-radius:3px;background:linear-gradient(90deg,#7a64ff,#e46fa0);transition:width .8s var(--ease)"></div></div>
      ${tasks.map((t) => `<div class="row small" style="margin-top:8px"><span style="width:18px;text-align:center">${t.status === 'done' ? '✓' : t.status === 'doing' ? '<span class="dot live" style="display:inline-block;color:var(--accent)"></span>' : t.status === 'blocked' ? '!' : '·'}</span><span class="${t.status === 'done' ? 'muted' : ''}">${esc(t.title)}</span></div>`).join('')}
    </div>`;
  }

  function ctaView(a) {
    const mine = a.ownerId === S.session.user.id;
    const b = [];
    if (a.running || a.status === 'running') b.push('<button class="btn soft sm" data-act="pause">Pause</button>');
    else {
      if (a.status === 'error' || a.status === 'paused') b.push('<button class="btn sm" data-act="resume">Resume</button>');
      if (a.stage === 'brief') b.push('<button class="btn accent" data-act="build">Build this agent</button>');
      if (a.stage === 'plan_review') b.push('<button class="btn accent" data-act="approve">Approve plan and build</button>');
      if (a.package && mine) {
        if (a.package.channel === 'shadow') b.push('<button class="btn accent" data-act="channel" data-channel="live">Go live</button>');
        if (a.package.channel === 'live') b.push('<button class="btn soft sm" data-act="channel" data-channel="shadow">Back to shadow</button>');
        if (a.package.channel === 'off') b.push('<button class="btn sm" data-act="channel" data-channel="shadow">Turn on in shadow</button>');
      }
    }
    return `<div id="cta" class="cta">${b.join('')}</div>`;
  }

  // ---- runs ----
  async function loadRuns(rerender = true) {
    try { S.runs = (await api(`/api/agents/${S.agent.id}/runs`)).runs; } catch (e) { S.runs = []; toast(e.message, 'bad'); }
    if (rerender && S.tab === 'runs') { const b = $('#tab-body'); if (b) b.innerHTML = runsTab(S.agent); }
  }
  function runsTab(a) {
    if (!S.runs) return '<div class="glass empty">Loading runs…</div>';
    const shadow = a.package?.channel === 'shadow';
    const intro = shadow ? `<div class="note" style="margin-bottom:14px">Shadow mode: runs happen on your phone's real triggers, but notifications are only recorded here. When they look right, tap <strong>Go live</strong>.</div>` : '';
    if (!S.runs.length) return `${intro}<div class="glass empty">No runs yet. Open <a class="link" href="/runtime">the Runtime</a> on your phone; it runs agents on their triggers and when you tap Run.</div>`;
    return `${intro}<div class="stack">${S.runs.map((r) => `<article class="glass run-card rise">
      <div class="row between"><div class="row" style="gap:8px">${r.ok ? '<span class="pill good">Ran</span>' : '<span class="pill bad">Failed</span>'}<span class="pill">${esc(r.channel)}</span><span class="small muted">${esc(r.trigger)} · ${esc(r.deviceName || '')}</span></div><span class="small faint">${ago(r.at)}</span></div>
      ${r.notifications.length ? r.notifications.map((n) => `<div class="feed-item" style="margin-top:12px"><div class="t">${esc(n.title)}</div><div class="b">${esc(n.body)}</div></div>`).join('') : `<div class="small muted" style="margin-top:10px">${r.ok ? 'Nothing to tell you this time.' : esc(r.error || '')}</div>`}
      ${r.error && r.notifications.length ? `<div class="note bad small" style="margin-top:10px">${esc(r.error)}</div>` : ''}
      <div class="row between" style="margin-top:12px">
        <span class="tiny faint">v${esc(r.version)} · ${r.steps} steps · ${Math.round(r.durationMs)} ms${r.httpReads ? ` · ${r.httpReads} web reads` : ''}${r.handoffs ? ` · ${r.handoffs} hand-offs` : ''}</span>
        <span class="row" style="gap:4px">${r.log.length ? `<button class="btn ghost sm" data-act="runlog" data-id="${esc(r.id)}">Log</button>` : ''}${a.ownerId === S.session.user.id ? `<button class="btn soft sm" data-act="wrong" data-id="${esc(r.id)}">This was wrong</button>` : ''}</span>
      </div>
    </article>`).join('')}</div>`;
  }

  // ---- settings ----
  function settingsTab(a) {
    const mine = a.ownerId === S.session.user.id;
    const p = a.package;
    const perms = S.meta?.permissions || {};
    const trig = (t) => t.type === 'schedule' ? `Every ${t.days?.length ? t.days.join(', ') : 'day'} at ${t.at}` : t.type === 'interval' ? `Every ${t.minutes >= 60 ? `${t.minutes / 60} h` : `${t.minutes} min`} while it can` : t.type === 'manual' ? 'When you tap Run' : 'Each time the Runtime opens';
    const snoozed = a.snoozeUntil && a.snoozeUntil > Date.now();
    return `<div class="stack-lg">
      ${mine ? `<section class="glass card stack">
        <div class="row between wrap"><div class="h3">Where it runs</div>
          <div class="tabs" style="background:var(--line)">${[['phone', 'On my phone'], ['cloud', 'In the cloud']].map(([k, l]) => `<button class="tab ${a.runsOn === k ? 'on' : ''}" data-act="where" data-where="${k}">${l}</button>`).join('')}</div></div>
        <p class="small muted" style="margin:0">${a.runsOn === 'cloud' ? 'Pocket Box runs it on schedule even when your phone is off, in a sealed sandbox with no other access. It can\'t use your location.' : 'It runs on your paired phones, privately. Scheduled runs need the phone to get the wake-up notification.'}</p>
        <div class="row wrap" style="gap:8px">
          <button class="btn sm" data-act="run-cloud">${a.cloudRunning ? '<span class="spin"></span>' : 'Run now in the cloud'}</button>
          ${snoozed ? `<span class="pill warn">Snoozed until ${new Date(a.snoozeUntil).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span><button class="btn ghost sm" data-act="snooze" data-until="off">Unsnooze</button>`
            : '<button class="btn soft sm" data-act="snooze" data-minutes="60">Snooze 1 hour</button><button class="btn soft sm" data-act="snooze" data-until="today">Pause for today</button>'}
        </div>
      </section>` : ''}
      ${a.settings.length ? `<form data-form="settings" class="glass card stack">
        <div class="h3">Your values</div>
        <p class="small muted" style="margin:4px 0 0">Kept on your Studio and used only when this agent runs.${a.settings.some((s) => s.type === 'secret') ? ' Secrets are never shown again after saving.' : ''}</p>
        ${a.settings.map((s) => `<label class="field"><span>${esc(s.label)}</span>
          <input class="input" name="${esc(s.key)}" ${!mine ? 'disabled' : ''} type="${s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : s.type === 'url' ? 'url' : s.type === 'time' ? 'time' : 'text'}" value="${s.type === 'secret' ? '' : esc(s.value)}" placeholder="${s.type === 'secret' && s.set ? 'Saved — type to replace' : ''}" autocomplete="off"></label>`).join('')}
        ${mine ? '<div class="row"><button class="btn sm">Save</button></div>' : ''}
      </form>` : ''}
      <section class="glass card">
        <div class="h3">What it may do</div>
        <div class="stack" style="margin-top:12px">${(p.permissions || []).length ? p.permissions.map((x) => `<div class="row small"><span class="pill accent">${esc(x)}</span><span class="muted">${esc(perms[x] || '')}${x === 'http' && p.http?.allow ? `: ${esc(p.http.allow.join(', '))}` : ''}</span></div>`).join('') : '<div class="small muted">Nothing beyond running when triggered.</div>'}</div>
        <hr class="sep">
        <div class="row between"><div class="h3">When it runs</div>${mine && (p.triggers || []).some((t) => t.type === 'schedule' || t.type === 'interval') ? '<button class="btn soft sm" data-act="edit-when">Change</button>' : ''}</div>
        <div class="stack small" style="margin-top:10px">${(p.triggers || []).map((t) => `<div>• ${esc(trig(t))}</div>`).join('')}</div>
      </section>
      <section class="glass card">
        <div class="h3">Releases</div>
        <dl class="kv" style="margin-top:12px">
          <dt>Channel</dt><dd>${esc(p.channel)}</dd>
          <dt>Tests</dt><dd>${p.evals ? `${p.evals.passed} of ${p.evals.total} scenarios pass` : '—'}</dd>
          <dt>Signed</dt><dd>Ed25519 · ${esc((p.commit || '').slice(0, 8))}</dd>
        </dl>
        <div class="stack small" style="margin-top:14px">${[...(p.history || [])].reverse().slice(0, 8).map((h) => `<div class="row between"><span>v${esc(h.version)}</span><span class="muted">${esc(h.evals)} · ${ago(h.at)}</span></div>`).join('')}</div>
        ${mine && p.channel !== 'off' ? '<div class="row" style="margin-top:16px"><button class="btn danger sm" data-act="channel" data-channel="off">Turn off on my phones</button></div>' : ''}
      </section>
    </div>`;
  }

  // ---- code ----
  async function loadFiles(rerender = true) {
    try { S.files = (await api(`/api/agents/${S.agent.id}/files`)).files; } catch { S.files = []; }
    if (rerender && S.tab === 'code') { const b = $('#tab-body'); if (b) b.innerHTML = codeTab(S.agent); }
  }
  function codeTab() {
    if (!S.files) return '<div class="glass empty">Loading files…</div>';
    if (!S.files.length) return '<div class="glass empty">No files yet. They appear once the crew starts building.</div>';
    return `<div class="glass list">${S.files.map((f) => `<button class="item" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;cursor:pointer;text-align:left" data-act="file" data-path="${esc(f)}"><span class="mono grow">${esc(f)}</span><span class="faint">›</span></button>`).join('')}</div>
      ${S.file ? `<section class="glass card" style="margin-top:14px"><div class="row between"><span class="mono">${esc(S.file.path)}</span><button class="btn ghost sm" data-act="close-file">Close</button></div><div class="prose"><pre><code>${esc(S.file.text)}</code></pre></div></section>` : ''}`;
  }

  // ---- phones -------------------------------------------------------------------
  async function phonesView() {
    const { devices } = await api('/api/devices');
    S.devices = devices;
    return `<div class="shell">${topBar()}
      <section style="padding:28px 0 20px" class="rise">
        <h1 class="display" style="font-size:clamp(36px,8vw,52px)">Your <em>phones</em></h1>
        <p class="lede">Agents run on your phone in the Pocket Box Runtime. It checks every package's signature before it runs it, and nothing runs anywhere else.</p>
      </section>
      <section class="glass card stack rise">
        <div class="h3">Pair a phone</div>
        <ol class="prose" style="margin:0;padding-left:20px">
          <li>On your phone, open <strong>${esc(location.host)}/runtime</strong> and sign in.</li>
          <li>Tap <strong>Pair this phone</strong>.</li>
          <li>Add Pocket Box to the Home Screen (the sign-in page has an <strong>Install the app</strong> button), open it from there, and allow notifications. That's what lets scheduled agents wake it.</li>
        </ol>
        <div class="row"><a class="btn" href="/runtime">Open the Runtime here</a></div>
      </section>
      <section class="glass card stack rise" style="margin-top:14px">
        <div class="h3">Pair without signing in on the phone</div>
        <p class="small muted" style="margin:0">Get a one-time code here and type it on the Runtime's pairing screen. It works once, for 10 minutes.</p>
        <div class="row"><button class="btn soft" data-act="pair-code">Get a pairing code</button></div>
      </section>
      <section style="margin-top:28px">
        <div class="eyebrow" style="margin:0 0 12px 4px">Paired</div>
        ${devices.length ? `<div class="glass list">${devices.map((d) => `<div class="item"><div class="avatar sm">📱</div><div class="grow"><div class="h3">${esc(d.name)}</div><div class="small muted">${esc(d.tz)} · seen ${ago(d.lastSeenAt)}</div></div><button class="btn ghost sm" data-act="unpair" data-id="${esc(d.id)}">Remove</button></div>`).join('')}</div>` : '<div class="glass empty">No phones yet.</div>'}
      </section>
    </div>`;
  }

  // ---- people (administrators) -----------------------------------------------------
  async function peopleView() {
    if (S.session.user.role !== 'admin') return go('#/');
    const { users, mailConfigured } = await api('/api/admin/users');
    const order = { pending: 0, unverified: 1, approved: 2, disabled: 3, declined: 4 };
    users.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.createdAt || 0) - (a.createdAt || 0));
    const me = S.session.user;
    const acts = (u) => {
      if (u.id === me.id) return '<span class="pill">You</span>';
      const x = [];
      if (u.status === 'pending') x.push(['approve', 'Approve', 'btn sm'], ['decline', 'Decline', 'btn ghost sm']);
      if (u.status === 'approved') x.push(['resend', 'Send link', 'btn ghost sm'], ['disable', 'Disable', 'btn ghost sm']);
      if (u.status === 'unverified') x.push(['disable', 'Disable', 'btn ghost sm']);
      if (u.status === 'disabled' || u.status === 'declined') x.push(['enable', 'Enable', 'btn soft sm']);
      if (me.primary && u.status === 'approved') x.push(u.role === 'admin' ? ['remove-admin', 'Remove admin', 'btn ghost sm'] : ['make-admin', 'Make admin', 'btn ghost sm']);
      return x.map(([a, l, c]) => `<button class="${c}" data-act="user" data-op="${a}" data-id="${esc(u.id)}">${l}</button>`).join('');
    };
    return `<div class="shell wide">${topBar()}
      <section style="padding:28px 0 20px" class="rise"><h1 class="display" style="font-size:clamp(36px,8vw,52px)"><em>People</em></h1>
      ${mailConfigured ? '' : '<div class="note warn" style="margin-top:14px">Email is not set up, so approval links are shown here for you to send yourself.</div>'}</section>
      <div class="glass list rise">${users.map((u) => `<div class="item" style="flex-wrap:wrap">
        <div class="avatar sm">${esc((u.firstName || '?')[0])}</div>
        <div class="grow"><div class="h3">${esc(u.name)} ${u.role === 'admin' ? '<span class="pill accent">admin</span>' : ''}</div><div class="small muted">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''} · ${esc(u.status === 'unverified' ? 'email not confirmed yet' : u.status)}</div></div>
        <div class="row wrap" style="gap:6px">${acts(u)}</div></div>`).join('')}</div>
    </div>`;
  }

  // ---- you ------------------------------------------------------------------------
  async function meView() {
    const [{ about }, pk, pr] = await Promise.all([api('/api/me/about'), api('/api/push/key').catch(() => ({ devices: 0 })), api('/api/me/prefs').catch(() => ({}))]);
    S.prefs = pr.prefs; S.prefsMail = pr.mailConfigured;
    const u = S.session.user;
    const theme = store.get('pb.theme', 'system');
    return `<div class="shell">${topBar()}
      <section style="padding:28px 0 20px" class="rise"><h1 class="display" style="font-size:clamp(36px,8vw,52px)">${esc(u.firstName)}<em>.</em></h1><p class="lede">${esc(u.email)}</p></section>
      <div class="stack-lg">
        <form data-form="about" class="glass card stack rise">
          <div class="h3">About me</div>
          <p class="small muted" style="margin:0">The room's "Your Voice" speaks for you from this: your routine, where you live and work, what annoys you. Keep it short.</p>
          <textarea class="textarea input" name="about" data-grow rows="4" placeholder="I work 9–6 in Austin, commute by bike, hate notifications before 7…">${esc(about || '')}</textarea>
          <div class="row"><button class="btn sm">Save</button></div>
        </form>
        <form data-form="prefs" class="glass card stack rise">
          <div class="h3">How agents reach you</div>
          <label class="row" style="gap:10px"><input type="checkbox" name="emailAgents" ${S.prefs?.emailAgents ? 'checked' : ''} style="width:20px;height:20px"><span>Also email me what my live agents say${S.prefsMail === false ? ' <span class="small faint">(email isn\'t set up on the server)</span>' : ''}</span></label>
          <div class="row wrap" style="gap:10px"><span class="small muted">Quiet hours</span><input class="input" type="time" name="quietFrom" value="${esc(S.prefs?.quietFrom || '')}" style="width:auto"><span class="small muted">to</span><input class="input" type="time" name="quietTo" value="${esc(S.prefs?.quietTo || '')}" style="width:auto"></div>
          <p class="small muted" style="margin:0">During quiet hours agents still run; nothing buzzes. Time zone: ${esc(S.prefs?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone)}.</p>
          <div class="row"><button class="btn sm">Save</button></div>
        </form>
        <section class="glass card stack rise">
          <div class="h3">Studio notifications</div>
          <p class="small muted" style="margin:0">Hear when a brief or plan is ready, or a build finishes. ${pk.devices ? `${pk.devices} device${pk.devices === 1 ? '' : 's'} subscribed.` : ''}</p>
          <div class="row"><button class="btn soft sm" data-act="push">Turn on for this device</button></div>
        </section>
        <section class="glass card stack rise">
          <div class="h3">Appearance</div>
          <div class="row wrap" style="gap:8px">${['system', 'light', 'dark'].map((t) => `<button class="chip ${theme === t ? 'on' : ''}" data-act="theme" data-theme="${t}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join('')}</div>
        </section>
        <form data-form="password" class="glass card stack rise">
          <div class="h3">Change password</div>
          <input type="email" name="username" value="${esc(u.email)}" autocomplete="username" hidden>
          <label class="field"><span>Current</span><input class="input" name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>New (10+ characters)</span><input class="input" name="next" type="password" autocomplete="new-password" minlength="10" required></label>
          <div class="row"><button class="btn sm">Change it</button></div>
        </form>
        <div class="row rise"><button class="btn ghost" data-act="logout">Sign out</button></div>
      </div>
    </div>`;
  }

  function errorView(e) {
    return `<div class="shell">${S.session?.authed ? topBar() : ''}<div class="glass card rise" style="margin-top:40px"><div class="h3">That didn't load</div><p class="muted">${esc(e.message)}</p><div class="row"><button class="btn sm" data-act="reload">Try again</button><a class="btn ghost sm" href="#/">Home</a></div></div></div>`;
  }

  // ---- running an agent from the Studio (in the cloud) ---------------------------------------
  function showRunResult(run) {
    const said = run.notifications.map((n) => `<div class="feed-item"><div class="t">${esc(n.title)}</div><div class="b">${esc(n.body)}</div></div>`).join('');
    sheet(`<div class="stack"><div class="row between"><div class="h3">${run.ok ? 'It ran' : 'It failed'}</div><span class="pill ${run.channel === 'live' ? 'good' : 'accent'}">${esc(run.channel)}</span></div>
      ${said || `<p class="muted" style="margin:0">${run.ok ? 'Nothing to tell you this time.' : esc(run.error || '')}</p>`}
      ${run.channel === 'shadow' && run.notifications.length ? '<p class="small muted" style="margin:0">Shadow mode: this was recorded, not sent. Go live to get it as a notification.</p>' : ''}
      <div class="row" style="justify-content:flex-end"><button class="btn sm" data-close>Done</button></div></div>`);
    S.runs = null;
  }
  function askRunInputs(a) {
    const field = (i) => i.type === 'choice'
      ? `<select class="input" name="${esc(i.key)}">${i.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
      : `<input class="input" name="${esc(i.key)}" ${i.type === 'number' ? 'type="number" inputmode="decimal"' : ''} autocomplete="off">`;
    sheet(`<form class="stack"><div class="h3">Run ${esc(a.title)}</div>
      ${a.inputs.map((i) => `<label class="field"><span>${esc(i.label)}</span>${field(i)}</label>`).join('')}
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost sm" data-close>Cancel</button><button class="btn sm">Run</button></div></form>`,
    async (fd) => { const r = await api(`/api/agents/${a.id}/run`, { method: 'POST', body: { input: Object.fromEntries(fd) } }); setTimeout(() => showRunResult(r.run), 320); });
  }

  // ---- sheets --------------------------------------------------------------------
  function sheet(inner, onSubmit) {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div>`;
    const close = () => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 300); };
    scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) close(); });
    const form = scrim.querySelector('form');
    if (form && onSubmit) form.addEventListener('submit', async (e) => { e.preventDefault(); const btn = form.querySelector('button:not([data-close])'); busy(btn, true); try { if (await onSubmit(new FormData(form)) !== false) close(); } catch (err) { toast(err.message, 'bad'); } finally { busy(btn, false); } });
    document.body.append(scrim);
    scrim.querySelector('textarea, input')?.focus();
    return close;
  }

  function busy(btn, on) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
    else if (btn.dataset.label) { btn.disabled = false; btn.innerHTML = btn.dataset.label; }
  }

  // ---- events --------------------------------------------------------------------
  document.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-grow]');
    if (ta) grow(ta);
    const form = e.target.closest('form[data-form="new"], form[data-form="message"]');
    if (form) form.querySelector('.send').disabled = !form.querySelector('textarea').value.trim();
  });

  document.addEventListener('keydown', (e) => {
    const ta = e.target.closest('form[data-form="new"] textarea, form[data-form="message"] textarea');
    if (ta && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); ta.form.requestSubmit(); }
    if (e.key === 'Escape') $('.scrim')?.click();
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form || form.closest('.sheet')) return;
    e.preventDefault();
    const kind = form.dataset.form;
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button:not([type=button])');
    const note = form.querySelector('#form-note');
    const say = (text, cls = 'bad') => { if (note) note.innerHTML = `<div class="note ${cls} pop">${esc(text)}</div>`; else toast(text, cls === 'bad' ? 'bad' : ''); };
    busy(btn, true);
    try {
      if (kind === 'login') {
        const r = await api('/api/login', { method: 'POST', body: data });
        S.session = { authed: true, user: r.user };
        const next = new URLSearchParams(location.search).get('next');
        if (next === '/runtime') { location.href = '/runtime'; return; }
        go('#/');
      } else if (kind === 'signup') {
        const r = await api('/api/signup', { method: 'POST', body: data });
        form.innerHTML = `<div class="note good pop">${esc(r.message)}</div>`;
      } else if (kind === 'forgot') {
        const r = await api('/api/forgot', { method: 'POST', body: data });
        say(r.message, 'good');
      } else if (kind === 'reset') {
        const r = await api('/api/reset', { method: 'POST', body: { token: form.dataset.token, password: data.password } });
        const l = await api('/api/login', { method: 'POST', body: { email: r.email, password: data.password } });
        S.session = { authed: true, user: l.user };
        go('#/');
      } else if (kind === 'new') {
        const a = await api('/api/agents', { method: 'POST', body: { idea: data.idea, template: store.get('pb.template', null) } });
        store.set('pb.template', null);
        S.agent = null;
        go(`#/a/${a.id}`);
      } else if (kind === 'message') {
        const text = String(data.text || '').trim();
        if (!text) return;
        const ta = form.querySelector('textarea');
        ta.value = ''; grow(ta); form.querySelector('.send').disabled = true;
        const msg = await api(`/api/agents/${S.agent.id}/message`, { method: 'POST', body: { text } });
        if (!S.agent.messages.some((x) => x.id === msg.id)) {
          S.agent.messages.push(msg);
          if (S.tab !== 'thread') { S.tab = 'thread'; render({ transition: false }); }
          else { $('#thread')?.insertAdjacentHTML('beforeend', msgView(msg, true)); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
        }
      } else if (kind === 'settings') {
        const values = {};
        for (const s of S.agent.settings) { const v = data[s.key]; if (s.type === 'secret' && !v) continue; values[s.key] = v; }
        const r = await api(`/api/agents/${S.agent.id}/settings`, { method: 'POST', body: { values } });
        S.agent.settings = r.settings; S.agent.missingSettings = r.missing;
        toast('Saved. Your phones pick it up the next time the Runtime opens.');
        patchAgent();
      } else if (kind === 'install') {
        const id = form.dataset.id;
        const values = {};
        for (const [k, v] of Object.entries(data)) if (k.startsWith('v_')) values[k.slice(2)] = v;
        const when = {};
        const at = form.querySelector('[name="when_at"]');
        if (at) { when.at = at.value; when.days = [...form.querySelectorAll('[data-days] .on')].map((x) => x.dataset.day); if (when.days.length === 7) when.days = []; }
        const ev = form.querySelector('[data-every] .on');
        if (ev) when.minutes = Number(ev.dataset.min);
        const runsOn = form.querySelector('[data-runs] .on')?.dataset.runsOn || 'cloud';
        const a = await api(`/api/templates/${id}/install`, { method: 'POST', body: { values, when, live: !!data.live, runsOn } });
        toast(`${a.title} is on. ${a.runsOn === 'cloud' ? 'It runs in the cloud.' : 'Open the Runtime on your phone to start it.'}`);
        S.agent = null; go(`#/a/${a.id}`);
      } else if (kind === 'watch') {
        const mode = form.querySelector('[data-modes] .on')?.dataset.mode || 'change';
        const minutes = Number(form.querySelector('[data-every] .on')?.dataset.min || 60);
        const pick = { change: ['watch-page', {}], words: ['watch-page', { lookFor: data.words }], price: ['price-drop', { target: data.price }], stock: ['back-in-stock', { soldOutText: data.soldOut }] }[mode];
        if (mode === 'words' && !String(data.words || '').trim()) throw new Error('Type the words to look for.');
        if (mode === 'price' && !data.price) throw new Error('Type the price you want.');
        const t = (S.templates || []).find((x) => x.id === pick[0]);
        const allowed = t && t.when && t.when.choices ? t.when.choices : [minutes];
        const nearest = allowed.reduce((b, m) => (Math.abs(m - minutes) < Math.abs(b - minutes) ? m : b), allowed[0]);
        let host = 'page';
        try { host = new URL(data.url).hostname.replace(/^www\./, ''); } catch {}
        const a = await api(`/api/templates/${pick[0]}/install`, { method: 'POST', body: { values: { url: data.url, ...pick[1] }, when: { minutes: nearest }, live: true, runsOn: 'cloud', title: `Watch ${host}`.slice(0, 40) } });
        toast('Watching. You\'ll hear from it when something changes.');
        S.agent = null; go(`#/a/${a.id}`);
      } else if (kind === 'prefs') {
        const r = await api('/api/me/prefs', { method: 'POST', body: { emailAgents: !!data.emailAgents, quietFrom: data.quietFrom || null, quietTo: data.quietTo || null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
        S.prefs = r.prefs; toast('Saved.');
      } else if (kind === 'about') {
        await api('/api/me/about', { method: 'POST', body: data });
        toast('Saved.');
      } else if (kind === 'password') {
        await api('/api/password', { method: 'POST', body: data });
        form.reset(); toast('Password changed. Other devices were signed out.');
      }
    } catch (err) { say(err.message); } finally { if (document.contains(btn)) busy(btn, false); }
  });

  document.addEventListener('click', (e) => {
    const day = e.target.closest('[data-days] [data-day]');
    if (day) { day.classList.toggle('on'); return; }
    const every = e.target.closest('[data-every] [data-min]');
    if (every) { for (const c of every.parentElement.children) c.classList.toggle('on', c === every); return; }
    const ro = e.target.closest('[data-runs] [data-runs-on]');
    if (ro) { for (const c of ro.parentElement.children) c.classList.toggle('on', c === ro); return; }
    const mode = e.target.closest('[data-modes] [data-mode]');
    if (mode) {
      for (const c of mode.parentElement.children) c.classList.toggle('on', c === mode);
      for (const x of document.querySelectorAll('[data-extra]')) x.hidden = x.dataset.extra !== mode.dataset.mode;
      document.querySelector(`[data-extra="${mode.dataset.mode}"] input`)?.focus();
    }
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const a = S.agent;
    const post = async (path, body) => { busy(el, true); try { return await api(path, { method: 'POST', body: body || {} }); } catch (err) { toast(err.message, 'bad'); return null; } finally { if (document.contains(el)) busy(el, false); } };
    switch (act) {
      case 'template': {
        const cur = store.get('pb.template', null);
        const next = cur === el.dataset.id ? null : el.dataset.id;
        store.set('pb.template', next);
        for (const c of document.querySelectorAll('[data-act="template"]')) c.classList.toggle('on', c.dataset.id === next);
        const t = S.meta?.templates.find((x) => x.id === next);
        const ta = $('form[data-form="new"] textarea');
        if (t && ta && !ta.value.trim()) { ta.placeholder = t.hint; ta.focus(); }
        break;
      }
      case 'tab':
        S.tab = el.dataset.tab;
        for (const t of document.querySelectorAll('.tab')) { t.classList.toggle('on', t.dataset.tab === S.tab); t.setAttribute('aria-selected', t.dataset.tab === S.tab); }
        { const b = $('#tab-body'); if (b) { b.innerHTML = tabBody(a); b.classList.remove('rise'); void b.offsetWidth; b.classList.add('rise'); } }
        if (S.tab === 'runs') loadRuns();
        if (S.tab === 'code' && !S.files) loadFiles();
        if (S.tab === 'thread') window.scrollTo({ top: document.body.scrollHeight });
        break;
      case 'fold': {
        const id = el.dataset.id;
        if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
        const m = a.messages.find((x) => x.id === id);
        const node = el.closest('.msg');
        if (m && node) node.outerHTML = msgView(m);
        break;
      }
      case 'build': if (await post(`/api/agents/${a.id}/build`)) { toast('The Architect is writing the plan.'); softRefresh(100); } break;
      case 'approve': if (await post(`/api/agents/${a.id}/approve`)) { toast('Approved. The crew is building.'); softRefresh(100); } break;
      case 'resume': if (await post(`/api/agents/${a.id}/resume`)) softRefresh(100); break;
      case 'pause': if (await post(`/api/agents/${a.id}/pause`)) toast('Pausing after the current step.'); break;
      case 'channel': {
        const ch = el.dataset.channel;
        if (ch === 'off' && !confirm('Turn it off on all your phones? You can turn it back on later.')) break;
        const r = await post(`/api/agents/${a.id}/channel`, { channel: ch });
        if (r) { S.agent = r; patchAgent(); toast(ch === 'live' ? 'Live. It now notifies you for real.' : ch === 'off' ? 'Turned off.' : 'Shadow mode.'); }
        break;
      }
      case 'runlog': {
        const r = S.runs?.find((x) => x.id === el.dataset.id);
        if (r) sheet(`<div class="h3">Run log</div><div class="prose"><pre><code>${esc(r.log.join('\n'))}</code></pre></div><div class="row" style="justify-content:flex-end"><button class="btn soft sm" data-close>Close</button></div>`);
        break;
      }
      case 'wrong': {
        const id = el.dataset.id;
        sheet(`<form class="stack"><div class="h3">What should it have done?</div><p class="small muted" style="margin:0">The crew gets this run and your note, fixes the agent, re-tests it and ships a new version.</p>
          <textarea class="textarea input" name="note" rows="4" placeholder="It shouldn't have told me — it only rained after 9pm." required></textarea>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost sm" data-close>Cancel</button><button class="btn sm">Send to the crew</button></div></form>`,
        async (fd) => { await api(`/api/agents/${a.id}/runs/${id}/wrong`, { method: 'POST', body: { note: fd.get('note') } }); toast('Sent. The crew is on it.'); S.tab = 'thread'; render({ transition: false }); });
        break;
      }
      case 'file': {
        try { S.file = await api(`/api/agents/${a.id}/files?path=${encodeURIComponent(el.dataset.path)}`); } catch (err) { toast(err.message, 'bad'); }
        const b = $('#tab-body'); if (b) b.innerHTML = codeTab(a);
        b?.querySelector('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'close-file': S.file = null; { const b = $('#tab-body'); if (b) b.innerHTML = codeTab(a); } break;
      case 'agent-menu': {
        const close = sheet(`<div class="stack">
          <div class="row" style="gap:12px"><div class="avatar">${esc(a.icon || '✳︎')}</div><div class="h3">${esc(a.title)}</div></div>
          <button class="btn soft" style="width:100%" data-sheet="rename">Rename</button>
          ${a.package ? '<a class="btn soft" style="width:100%" href="/runtime">Open the Runtime</a>' : ''}
          <button class="btn danger" style="width:100%" data-sheet="delete">Delete agent</button>
          <button class="btn ghost" style="width:100%" data-close>Close</button></div>`);
        const root = $('.scrim:last-of-type');
        root.addEventListener('click', async (ev) => {
          const s = ev.target.closest('[data-sheet]');
          if (!s) return;
          if (s.dataset.sheet === 'rename') {
            const t = prompt('Name', a.title);
            if (t && t.trim()) { S.agent = await api(`/api/agents/${a.id}`, { method: 'PATCH', body: { title: t.trim() } }).catch((err) => { toast(err.message, 'bad'); return S.agent; }); patchAgent(); close(); }
          } else if (s.dataset.sheet === 'delete') {
            if (!confirm(`Delete ${a.title}? Your phones stop running it.`)) return;
            try { await api(`/api/agents/${a.id}`, { method: 'DELETE' }); close(); S.agent = null; go('#/'); } catch (err) { toast(err.message, 'bad'); }
          }
        });
        break;
      }
      case 'install': await install(); break;
      case 'where': { const r = await post(`/api/agents/${a.id}/where`, { runsOn: el.dataset.where }); if (r) { S.agent = r; const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(r); toast(r.runsOn === 'cloud' ? 'It now runs in the cloud.' : 'It now runs on your phone.'); } break; }
      case 'snooze': { const r = await post(`/api/agents/${a.id}/snooze`, el.dataset.until ? { until: el.dataset.until } : { minutes: Number(el.dataset.minutes) }); if (r) { S.agent = r; const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(r); toast(r.snoozeUntil ? 'Snoozed. It still runs; you just won\'t be notified.' : 'Notifications are back on.'); } break; }
      case 'edit-when': {
        const ts = a.package.triggers || [];
        const sch = ts.find((t) => t.type === 'schedule'), iv = ts.find((t) => t.type === 'interval');
        const picker = sch ? whenPicker({ type: 'schedule', default: sch.at, days: sch.days })
          : whenPicker({ type: 'interval', default: iv.minutes, choices: [...new Set([15, 30, 60, 120, 180, 360, 720, 1440, iv.minutes])].sort((x, y) => x - y) });
        sheet(`<form class="stack"><div class="h3">When should ${esc(a.title)} run?</div>${picker}
          <p class="small muted" style="margin:0">It's re-checked and re-signed in a few seconds. No rebuild.</p>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost sm" data-close>Cancel</button><button class="btn sm">Save</button></div></form>`,
        async (fd) => {
          const form = document.querySelector('.scrim:last-of-type form');
          const body = {};
          if (sch) { body.at = fd.get('when_at'); body.days = [...form.querySelectorAll('[data-days] .on')].map((x) => x.dataset.day); if (body.days.length === 7) body.days = []; }
          else body.minutes = Number(form.querySelector('[data-every] .on')?.dataset.min);
          const r = await api(`/api/agents/${a.id}/quick`, { method: 'POST', body });
          S.agent = r; patchAgent();
          const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(r);
          toast(r.changed && r.changed.length ? r.changed.join(' ') : 'Nothing changed.');
        });
        break;
      }
      case 'run-cloud': {
        if (a.inputs && a.inputs.length) { askRunInputs(a); break; }
        const r = await post(`/api/agents/${a.id}/run`, {});
        if (r) showRunResult(r.run);
        break;
      }
      case 'mic': toggleMic(el); break;
      case 'install-hide': store.set('pb.installHidden', true); refreshInstall(); break;
      case 'pair-code': {
        const r = await post('/api/devices/code');
        if (r) sheet(`<div class="stack" style="text-align:center">
          <div class="h3">Type this on the phone's pairing screen</div>
          <div class="mono" style="font-size:34px;letter-spacing:.12em;font-weight:600;padding:10px 0;user-select:all">${esc(r.code)}</div>
          <p class="small muted" style="margin:0">Server: <span class="mono">${esc(location.host)}</span> · works once, until ${new Date(r.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p>
          <div class="row" style="justify-content:center"><button class="btn sm" data-close>Done</button></div></div>`);
        break;
      }
      case 'unpair':
        if (!confirm('Remove this phone? Its agents stop and it has to be paired again.')) break;
        try { await api(`/api/devices/${el.dataset.id}`, { method: 'DELETE' }); S.devices = null; render({ transition: false }); } catch (err) { toast(err.message, 'bad'); }
        break;
      case 'user': {
        const r = await post(`/api/admin/users/${el.dataset.id}/${el.dataset.op}`);
        if (r) {
          if (r.link) sheet(`<div class="stack"><div class="h3">Email isn't set up</div><p class="small muted" style="margin:0">Send them this one-time link yourself (valid 24 hours):</p><input class="input mono" readonly value="${esc(r.link)}"><div class="row" style="justify-content:flex-end"><button class="btn sm" data-close>Done</button></div></div>`);
          else toast(r.emailed ? 'Done. They were emailed a link.' : 'Done.');
          render({ transition: false });
        }
        break;
      }
      case 'push': await enablePush(el); break;
      case 'theme': {
        const t = el.dataset.theme;
        store.set('pb.theme', t); applyTheme();
        for (const c of document.querySelectorAll('[data-act="theme"]')) c.classList.toggle('on', c.dataset.theme === t);
        break;
      }
      case 'logout': await api('/api/logout', { method: 'POST' }).catch(() => {}); S.session = { authed: false }; S.es?.close(); S.es = null; go('#/login'); break;
      case 'reload': render(); break;
    }
  });

  async function enablePush(btn) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser cannot receive notifications. On iPhone, add Pocket Box to your Home Screen first.', 'bad');
    busy(btn, true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications were not allowed.');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/key');
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      toast('Notifications are on for this device.');
    } catch (err) { toast(err.message, 'bad'); } finally { busy(btn, false); }
  }
  function b64u(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }

  function applyTheme() {
    const t = store.get('pb.theme', 'system');
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  }

  // ---- start -------------------------------------------------------------------------
  applyTheme();
  addEventListener('hashchange', () => { if (listening) listening.abort(); render(); });
  addEventListener('pageshow', (e) => { if (e.persisted) render({ transition: false }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && route().name === 'a') softRefresh(100); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'navigate' && e.data.url) location.href = e.data.url; });
  }
  render({ transition: false });
})();
